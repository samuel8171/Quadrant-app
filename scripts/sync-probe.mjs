/**
 * 同步层与新增交互的端到端探针（开发期工具）。
 *
 * 用途：在真实 Chromium 里跑一遍本轮 S4–S6 的关键路径，而不是只靠读代码推断。
 * 三块内容：
 *   A. 网页端启动会写下同步元信息，且 deviceId 跨刷新稳定（真实持久化）。
 *   B. 桌面端「上传到云端 / 从云端恢复」两个按钮 + 差异摘要确认框
 *      （Supabase REST 与 auth 都用假响应拦截，不依赖网络与真实凭据）。
 *   C. 预设拖入时间轴时的落点预览与可放置反馈（合成 dragstart/dragover/dragend）。
 *
 * 前置：另开终端运行网页端开发服务器
 *   ./node_modules/.bin/vite --config vite.web.config.ts --port 5199 --host 127.0.0.1 --strictPort
 *
 * 用法：node scripts/sync-probe.mjs [--dev-dir docs]
 * 退出码：0 全部通过 / 1 有断言失败 / 2 环境不可用
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const ARG = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}

const BROWSER_CANDIDATES = [
  process.env.UI_PROBE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome'
].filter(Boolean)

const port = ARG('port', '5199')
const base = ARG('url', `http://127.0.0.1:${port}/probe.html`)
const shotDir = ARG('dev-dir', 'docs')

const SYNC_META_KEY = 'quadrant-web-sync-meta-v1'
const DATA_KEY = 'quadrant-web-data-v2'
const PRESET_MIME = 'application/x-preset-id'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`)
}

const executablePath = BROWSER_CANDIDATES.find((p) => existsSync(p))
if (!executablePath) {
  console.error(`未找到可用浏览器，请设置 UI_PROBE_BROWSER。已尝试：\n${BROWSER_CANDIDATES.join('\n')}`)
  process.exit(2)
}

mkdirSync(shotDir, { recursive: true })

const probeData = {
  version: 2,
  goals: [],
  events: [],
  weekPresets: [
    {
      id: 'preset-probe-1',
      title: '英语晨读',
      color: '#8AB4F8',
      quadrant: 2,
      durationMin: 60,
      remark: '',
      createdAt: '2026-09-01T00:00:00.000Z'
    }
  ],
  weekEvents: [],
  weekCounterOffset: 0
}

/** 云端假数据：修订号刻意设得比"本机记忆"新，用来触发覆盖警示。 */
const CLOUD_ROW = {
  data: { version: 2, goals: [], events: [], weekPresets: [], weekEvents: [], weekCounterOffset: 0 },
  updated_at: '2026-09-16T04:20:00.000Z'
}
const SESSION_KEY = 'sb-nktsnjbkvdyhxdjfbxkh-auth-token'
const SESSION = {
  access_token: 'probe-access-token',
  token_type: 'bearer',
  refresh_token: 'probe-refresh-token',
  expires_in: 86400,
  expires_at: Math.floor(Date.now() / 1000) + 86400,
  user: { id: 'probe-user-id', email: 'probe@quadrant.app' }
}

/**
 * 桌面壳模拟：注入 `window.quadrantApi`、假会话、以及拦截 Supabase REST 的 fetch。
 * 必须整体自包含（进入页面执行，闭包拿不到外面的变量），所以全部靠参数传入。
 */
function desktopShell(arg) {
  const { localData, cloudRow, sessionKey, session } = arg
  const store = new Map()
  store.set('quadrant-web-data-v2', JSON.stringify(localData))
  if (session) store.set(sessionKey, JSON.stringify(session))
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => void store.set(k, String(v)),
      removeItem: (k) => void store.delete(k),
      key: (i) => [...store.keys()][i] ?? null,
      get length() {
        return store.size
      }
    }
  })
  window.quadrantApi = {
    loadData: async () => JSON.parse(store.get('quadrant-web-data-v2')),
    saveData: async () => undefined,
    loadSyncMeta: async () => null,
    saveSyncMeta: async () => undefined,
    saveReview: async () => ({ fileName: '', filePath: '', size: 0, modifiedAt: '' }),
    listReviews: async () => [],
    openReview: async () => ({ ok: true })
  }
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    const headers = new Headers((init && init.headers) || (input && input.headers) || {})
    if (url.includes('/rest/v1/user_data')) {
      const singular = String(headers.get('accept') || '').includes('vnd.pgrst.object')
      return new Response(JSON.stringify(singular ? cloudRow : [cloudRow]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    if (url.includes('/auth/v1/')) {
      return new Response(JSON.stringify(session), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
    return realFetch(input, init)
  }
}

const browser = await chromium.launch({ executablePath, headless: true })

/**
 * 两个 HTML 入口都没有声明 favicon，浏览器会自动请求 `/favicon.ico` 并在控制台
 * 留下一条 404。它是环境噪声、与本轮改动无关，但会污染"无控制台报错"这条断言，
 * 所以在这里直接把它应答掉，让断言保持严格。
 */
async function stubFavicon(context) {
  await context.route('**/favicon.ico', (route) =>
    route.fulfill({ status: 200, contentType: 'image/x-icon', body: '' })
  )
}

try {
  // ------------------------------------------------------------ A. 网页端
  console.log('\n===== A. 网页端：同步元信息落地与 deviceId 稳定 =====')
  const webCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await stubFavicon(webCtx)
  const webPage = await webCtx.newPage()
  const webErrors = []
  const webBadResponses = []
  webPage.on('console', (m) => {
    if (m.type() === 'error') webErrors.push(m.text())
  })
  webPage.on('pageerror', (e) => webErrors.push(String(e)))
  webPage.on('response', (r) => {
    if (r.status() >= 400) webBadResponses.push(`${r.status()} ${r.url()}`)
  })

  await webPage.goto(`${base}?page=quadrant`, { waitUntil: 'load' })
  await webPage.waitForSelector('.quadrant-viewport', { timeout: 20000 })
  await webPage.waitForTimeout(500)

  const readMeta = (page) =>
    page.evaluate((key) => {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : null
    }, SYNC_META_KEY)

  const meta1 = await readMeta(webPage)
  check('启动即写入同步元信息', meta1 !== null)
  check(
    'deviceId 非空且形如 UUID',
    typeof meta1?.deviceId === 'string' && meta1.deviceId.length >= 8,
    meta1?.deviceId ?? '无'
  )
  check(
    '初始 dirty=false、cloudRevision=null',
    meta1?.dirty === false && meta1?.cloudRevision === null
  )

  await webPage.reload({ waitUntil: 'load' })
  await webPage.waitForSelector('.quadrant-viewport', { timeout: 20000 })
  await webPage.waitForTimeout(400)
  const meta2 = await readMeta(webPage)
  check('刷新后 deviceId 保持不变（真实持久化，而非每次冷启动重生）', meta2?.deviceId === meta1?.deviceId)
  check('网页端无控制台报错', webErrors.length === 0, webErrors.slice(0, 2).join(' | '))
  check('网页端无失败请求', webBadResponses.length === 0, webBadResponses.slice(0, 2).join(' | '))

  // ------------------------------------------------------------ B. 桌面端
  console.log('\n===== B. 桌面端：按钮语义与差异摘要确认框 =====')
  const deskCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await stubFavicon(deskCtx)
  await deskCtx.addInitScript(desktopShell, {
    localData: probeData,
    cloudRow: CLOUD_ROW,
    sessionKey: SESSION_KEY,
    session: SESSION
  })
  const deskPage = await deskCtx.newPage()
  const deskErrors = []
  deskPage.on('pageerror', (e) => deskErrors.push(String(e)))

  await deskPage.goto(`${base}?page=goals&sidebar=1`, { waitUntil: 'load' })
  await deskPage.waitForSelector('.sidebar', { timeout: 20000 })
  await deskPage.waitForTimeout(600)

  const labels = await deskPage.$$eval('.sidebar .nav-item span', (els) =>
    els.map((e) => e.textContent)
  )
  check('左侧出现「上传到云端」', labels.includes('上传到云端'), labels.join(' / '))
  check('左侧出现「从云端恢复」', labels.includes('从云端恢复'))
  check('旧文案「上传数据」「同步数据」已消失', !labels.includes('上传数据') && !labels.includes('同步数据'))

  await deskPage.getByText('上传到云端', { exact: true }).click()
  await deskPage.waitForSelector('.confirm-modal .confirm-detail', { timeout: 15000 })
  const pushDetail = await deskPage.$eval('.confirm-detail', (el) => el.textContent ?? '')
  check('确认框给出两侧差异摘要', pushDetail.includes('本地：') && pushDetail.includes('云端：'))
  check('摘要含云端最后更新时间', pushDetail.includes('云端最后更新：'))
  check('摘要含条数统计', /共 \d+ 条/.test(pushDetail))
  check(
    '云端被其他设备改过时给出覆盖警示',
    pushDetail.includes('⚠️') && pushDetail.includes('覆盖'),
    pushDetail.includes('⚠️') ? '有警示' : '无警示'
  )
  check(
    '警示态套用了 warning 样式',
    await deskPage.$eval('.confirm-detail', (el) => el.classList.contains('warning'))
  )
  await deskPage.screenshot({ path: join(shotDir, 'sync-confirm-push.png') })

  await deskPage.locator('.confirm-modal .modal-btn', { hasText: '取消' }).click()
  await deskPage.waitForTimeout(300)
  check('取消后确认框关闭', (await deskPage.$('.confirm-modal')) === null)

  await deskPage.getByText('从云端恢复', { exact: true }).click()
  await deskPage.waitForSelector('.confirm-modal .confirm-detail', { timeout: 15000 })
  const pullDetail = await deskPage.$eval('.confirm-detail', (el) => el.textContent ?? '')
  check('恢复方向同样给出摘要', pullDetail.includes('本地：') && pullDetail.includes('云端：'))
  await deskPage.screenshot({ path: join(shotDir, 'sync-confirm-pull.png') })
  await deskPage.locator('.confirm-modal .modal-btn', { hasText: '取消' }).click()
  check('桌面端无未捕获异常', deskErrors.length === 0, deskErrors.slice(0, 2).join(' | '))

  // ------------------------------------------------------- D. 侧栏底部几何
  console.log('\n===== D. 桌面端侧栏：云按钮成对贴底、与寄语相距 30px =====')

  /** 量出侧栏各块的纵向位置，返回相邻间隙。 */
  const sidebarGaps = (p) =>
    p.evaluate(() => {
      const box = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { top: r.top, bottom: r.bottom, height: r.height }
      }
      return {
        nav: box('.nav'),
        upload: box('.upload-button'),
        sync: box('.sync-button'),
        login: box('.login-button'),
        tagline: box('.tagline'),
        viewport: window.innerHeight
      }
    })

  const gaps = await sidebarGaps(deskPage)
  const pairGap = gaps.sync.top - gaps.upload.bottom
  const toTagline = gaps.tagline.top - gaps.sync.bottom
  const navToPair = gaps.upload.top - gaps.nav.bottom

  console.log(
    `  按钮组：nav 底=${Math.round(gaps.nav.bottom)} → upload ${Math.round(gaps.upload.top)}~${Math.round(
      gaps.upload.bottom
    )} → sync ${Math.round(gaps.sync.top)}~${Math.round(gaps.sync.bottom)} → tagline ${Math.round(
      gaps.tagline.top
    )}~${Math.round(gaps.tagline.bottom)}（视口 ${gaps.viewport}）`
  )
  console.log(`  实测间隙：nav→upload=${Math.round(navToPair)} upload→sync=${Math.round(pairGap)} sync→tagline=${Math.round(toTagline)}`)

  check('两个云按钮纵向相邻（不被 auto 外边距撑开）', pairGap > 0 && pairGap <= 30, `${Math.round(pairGap)}px`)
  check('云按钮组与下方寄语相距 30px', Math.abs(toTagline - 30) <= 1.5, `${toTagline.toFixed(1)}px`)
  check(
    '云按钮组被推到底部（上方留白远大于与寄语的间距）',
    navToPair > toTagline,
    `nav→upload=${Math.round(navToPair)}px`
  )
  check('寄语仍贴底（未被挤出视口）', gaps.tagline.bottom < gaps.viewport, `bottom=${Math.round(gaps.tagline.bottom)}`)

  await deskPage.locator('.sidebar').screenshot({ path: join(shotDir, 'sidebar-cloud-buttons.png') })

  /**
   * 开一个侧栏上下文。`desktop` 决定是否注入桌面壳——不注入即纯网页端，
   * 侧栏不会渲染云按钮（这正是需要单独验证的分支）。
   */
  const openSidebar = async (width, height, { desktop, session }) => {
    const ctx = await browser.newContext({ viewport: { width, height } })
    await stubFavicon(ctx)
    if (desktop) {
      await ctx.addInitScript(desktopShell, {
        localData: probeData,
        cloudRow: CLOUD_ROW,
        sessionKey: SESSION_KEY,
        session
      })
    }
    const page = await ctx.newPage()
    await page.goto(`${base}?page=goals&sidebar=1`, { waitUntil: 'load' })
    await page.waitForSelector('.sidebar', { timeout: 20000 })
    await page.waitForTimeout(400)
    return { ctx, page }
  }

  // 未登录：只有一个「登录云端」，同样应与寄语保持 30px
  const loggedOut = await openSidebar(1280, 800, { desktop: true, session: null })
  const outGaps = await sidebarGaps(loggedOut.page)
  const outToTagline = outGaps.tagline.top - outGaps.login.bottom
  check(
    '未登录时「登录云端」与寄语的间距同为 30px',
    Math.abs(outToTagline - 30) <= 1.5,
    `${outToTagline.toFixed(1)}px`
  )
  await loggedOut.ctx.close()

  // 平板断点把 --sidebar-gap 改成 18px，间距必须仍是 30px（而不是 18+30）
  const tablet = await openSidebar(900, 800, { desktop: true, session: SESSION })
  const tabGaps = await sidebarGaps(tablet.page)
  const tabToTagline = tabGaps.tagline.top - tabGaps.sync.bottom
  check(
    '平板断点（900px）下间距仍为 30px',
    Math.abs(tabToTagline - 30) <= 1.5,
    `${tabToTagline.toFixed(1)}px`
  )
  await tablet.ctx.close()

  // 纯网页端没有云按钮：此时寄语必须自己撑到底部，不能浮在导航下方
  const plainWeb = await openSidebar(1280, 800, { desktop: false })
  const webGaps = await sidebarGaps(plainWeb.page)
  const webBottomGap = webGaps.viewport - webGaps.tagline.bottom
  const navToTagline = webGaps.tagline.top - webGaps.nav.bottom
  check(
    '纯网页端（无云按钮）寄语仍贴底',
    webBottomGap <= 24 && navToTagline > 200,
    `距底=${Math.round(webBottomGap)}px nav→寄语=${Math.round(navToTagline)}px`
  )
  await plainWeb.ctx.close()

  // ------------------------------------------------------------ C. 预设拖放
  console.log('\n===== C. 周计划：预设拖入的落点预览 =====')
  const dragCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await stubFavicon(dragCtx)
  await dragCtx.addInitScript((data) => {
    localStorage.setItem('quadrant-web-data-v2', JSON.stringify(data))
  }, probeData)
  const dragPage = await dragCtx.newPage()
  const dragErrors = []
  dragPage.on('pageerror', (e) => dragErrors.push(String(e)))

  await dragPage.goto(`${base}?page=weekly`, { waitUntil: 'load' })
  await dragPage.waitForSelector('.week-col-head', { timeout: 20000 })
  await dragPage.locator('.week-col-head').first().click()
  await dragPage.waitForSelector('.day-canvas', { timeout: 20000 })
  await dragPage.waitForSelector('.preset-card', { timeout: 20000 })

  const dragStart = await dragPage.evaluate((mime) => {
    const card = document.querySelector('.preset-card')
    const canvas = document.querySelector('.day-canvas')
    if (!card || !canvas) return { error: '缺少预设卡或画布' }
    const dt = new DataTransfer()
    dt.setData(mime, card.dataset.presetId)
    card.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true }))
    window.__probeDt = dt
    return { presetId: card.dataset.presetId, registered: dt.getData(mime) }
  }, PRESET_MIME)
  check(
    '预设卡可发起拖动并写入载荷',
    !dragStart.error && dragStart.registered === dragStart.presetId,
    dragStart.error ?? `registered=${dragStart.registered}`
  )

  // dragover 后不能同步读取 DOM：React 的状态更新是异步提交的，必须等它渲染完。
  await dragPage.evaluate((mime) => {
    const canvas = document.querySelector('.day-canvas')
    const dt = window.__probeDt
    dt.setData(mime, document.querySelector('.preset-card').dataset.presetId)
    const rect = canvas.getBoundingClientRect()
    canvas.dispatchEvent(
      new DragEvent('dragover', {
        dataTransfer: dt,
        clientX: Math.round(rect.left + rect.width / 2),
        clientY: Math.round(rect.top + 260),
        bubbles: true,
        cancelable: true
      })
    )
  }, PRESET_MIME)
  await dragPage.waitForSelector('.day-event-ghost.drop-preview', { timeout: 5000 })
  const dropState = await dragPage.evaluate(() => {
    const ghost = document.querySelector('.day-event-ghost.drop-preview')
    return {
      canvasActive: document.querySelector('.day-canvas').classList.contains('drop-active'),
      ghostText: ghost ? (ghost.textContent ?? '') : ''
    }
  })
  check('画布进入可放置态', dropState.canvasActive)
  check('出现落点幽灵预览', dropState.ghostText.length > 0, dropState.ghostText)
  check('预览带时间区间提示', /\d{2}:\d{2}-\d{2}:\d{2}/.test(dropState.ghostText), dropState.ghostText)
  await dragPage.screenshot({ path: join(shotDir, 'preset-drop-preview.png') })

  await dragPage.evaluate(() => window.dispatchEvent(new DragEvent('dragend', { bubbles: true })))
  await dragPage.waitForTimeout(400)
  const afterEnd = await dragPage.evaluate(() => ({
    ghost: Boolean(document.querySelector('.day-event-ghost.drop-preview')),
    active: document.querySelector('.day-canvas').classList.contains('drop-active')
  }))
  check('dragend 后预览与高亮被清理（不留残影）', !afterEnd.ghost && !afterEnd.active)
  check('周计划页无未捕获异常', dragErrors.length === 0, dragErrors.slice(0, 2).join(' | '))

  await webCtx.close()
  await deskCtx.close()
  await dragCtx.close()
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n===== 结果：${results.length - failed.length}/${results.length} 通过 =====`)
for (const f of failed) console.log(`  ✗ ${f.name}`)
process.exit(failed.length ? 1 : 0)
