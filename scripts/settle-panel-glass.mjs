#!/usr/bin/env node
/**
 * R3-E · 日结面板的液态玻璃 —— 材质可见度 + 结构 + **打开耗时**，**可失败**。
 *
 * 日结面板走 `GlassModal`（与其余 7 个弹窗同一条路径）。本探针守四件事：
 *
 *   ① **材质真的画出来了**（Δmean + grad 口径，与 `glass-material-probe.mjs`
 *      的弹窗判据**同一套**，见下）。
 *   ② **旧结构不得残留**：`.settle-overlay`（旧遮罩，`fixed + z-index:130` 的合成面）
 *      必须彻底消失；`.settle-panel` 只允许作为**玻璃根节点上的样式钩子**存在。
 *   ③ **祖先链上没有合成面**：`fixed` / `sticky` / 非 auto 的 `z-index` / `transform`
 *      任一出现在材质板之上（含定位层自己）都会致病。R3-D 刚补的 `transform` 一并在内。
 *   ④ **打开耗时**：R3-E 特有要求 —— 这是本项目里**每天开一次**的高频宿主，
 *      要给出"开一次要多久"的数字（不是为 shader 档，是为了知道 standard/fallback 下的真实代价）。
 *
 * ── 为什么这里**不用**保留率口径（重要，别改回去）
 *
 * 保留率（`std(开)/std(关) ≤ 0.2`）是 **dock / 气泡**那一类宿主的判据：它们背后是
 * **锐利的页面**，材质在这层画布上"糊没糊"可以直接用标准差比值量出来。
 *
 * 但**弹窗不一样**：`.modal-mask` 铺满整屏，虽然它被 mask 挖掉了面板所占的那块洞，
 * 它的染色与（默认 20px 的）虚化仍然重塑了整个采样参照 —— 实测把遮罩整个 `display:none`
 * 之后，同一块材质板的开/关两张**逐位相同**（0.305/0.45 一动不动），
 * 说明那个比值量的是"遮罩 + 页面 vs 材质 + 遮罩 + 页面"，不是材质本身。
 *
 * ⇒ 弹窗的材质可见度**必须**用 Δmean（材质开 vs 关的逐通道平均绝对差）+ grad（锐度下降）
 *   来判，这正是 `glass-material-probe.mjs` 判其它 7 个弹窗的口径：
 *     Δmean < 0.35 → 空心（材质没输出，就是"弹窗全透明"那个故障）
 *     Δmean < 0.8  → 极弱
 *     否则可见；`grad(开) < grad(关)·0.98` 再加一句"已糊化"
 *   本探针**照抄这套门槛**，好让日结面板与其余弹窗在同一个尺度上被衡量。
 *
 * 同时仍**额外记录**保留率（`retention`），只作参考、**不进退出码** ——
 * 它随宿主结构漂移，不适合当弹窗的门槛。
 *
 * 硬约束（沿用项目）：
 *   · 只用**页面级** `page.screenshot({ clip })`；元素级截图会把一切判成穿透。
 *   · 采样盒取**材质板**（`.gs-layer--dialog .gs-plate`），躲开文字（量时藏 `.settle-day`）。
 *   · 手机档必须显式设 `forceEngine`（本探针两档都量）。
 *
 * 前置（另开终端）：
 *   ./node_modules/.bin/vite --config vite.web.config.ts --port 5199 --host 127.0.0.1 --strictPort
 *
 * 用法：
 *   node scripts/settle-panel-glass.mjs --out docs/probes/settle-panel
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const ARG = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d
}

const CANDIDATES = [
  process.env.UI_PROBE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].filter(Boolean)

const executablePath = CANDIDATES.find((p) => existsSync(p))
if (!executablePath) {
  console.error('未找到可用浏览器')
  process.exit(2)
}

const port = ARG('port', '5199')
const outDir = ARG('out', 'docs/probes/settle-panel')
const base = `http://127.0.0.1:${port}/probe.html`
mkdirSync(outDir, { recursive: true })

const DATA_KEY = 'quadrant-web-data-v2'
const GLASS_KEY = 'quadrant-glass-v1'
const ALIVE_MAX = 0.2 // 仅保留率参考口径（dock/气泡用；弹窗不进退出码，见文件头）
const DM_EMPTY = 0.35 // Δmean < 此值 ⇒ 空心（材质没输出）
const DM_WEAK = 0.8 // Δmean < 此值 ⇒ 极弱
const MIN_FRAC = 3.0 // 变化像素占比下限 %
const OPEN_BUDGET_MS = 1200 // standard/fallback 档下的可接受上限（shader 档另计，见报告）

/** 本地日期键 `YYYY-MM-DD`（与项目同一套约定，不能用 toISOString 的 UTC 日）。 */
const localKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const daysAgo = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return localKey(d)
}

const iso = (i) => new Date(Date.now() - i * 3600_000).toISOString()

/**
 * 播种数据。
 *
 * ⚠️ 逐字段满足 `platformApi.validAppData`（漏一处整份静默作废）：
 *   Goal 要 remark/order/groupTitles/subtasks（且**没有** quadrant 字段）
 *   QuadrantEvent 要 x/y/width
 *   WeekEvent 要 showInQuadrant
 *   LedgerDay 要 date/settledAt/nightPending/dayLimit/spentTC/overdraft/deltaLT/entries
 *
 * 日结面板的入口是「待结算 ≥1 天」⇒ 必须种一条 `settledAt: null` 且日期早于今天、
 * 又晚于窗口下界的日账本。今天减 1 天正好落在 `[today−7, today)` 区间内。
 *
 * `enabledAt` 也一并种上（= 8 天前），保证窗口下界不会把这条待结算日夹掉：
 * 夹取规则是 `max(today−7, enabledAt)`，种 8 天前等价于不夹。
 */
function seedData() {
  const goals = ['期末总目标'].map((title, i) => ({
    id: `g${i}`,
    title,
    type: 'long',
    done: false,
    remark: '备注文本',
    groupTitles: ['阶段一'],
    subtasks: [{ id: `g${i}s0`, title: '子目标 1', done: false, group: 0, remark: '', order: 0 }],
    order: i,
    createdAt: iso(i)
  }))

  // 一条待结算日（昨天）：entries 为空也能结算（走「无计划」分支），
  // 但为了让面板内容更接近真实（有 ① 计划内事项、③ 娱乐、④ 昨夜刷手机），
  // 给它挂一条计划内条目 —— 于是否则走 hasPlan 路径，面板更高、更有代表性。
  const pendingDate = daysAgo(1)
  const days = [
    {
      date: pendingDate,
      settledAt: null,
      entries: [
        {
          id: 'e0',
          kind: 'planned',
          sourceId: null,
          title: '写周报',
          quadrant: 2,
          plannedMin: 60,
          actualMin: 60,
          done: true,
          nightMin: 0,
          costTC: 30,
          deltaLT: 0
        }
      ],
      videoMin: 0,
      gameMin: 0,
      latePhone: false,
      dayLimit: 0,
      spentTC: 0,
      overdraft: 0,
      deltaLT: 0,
      nightPending: false,
      isRestDay: false
    }
  ]

  /*
   * `enabledAt` 种在**昨天**：这是让面板落在"我种的那一天"的关键。
   *
   * `ensureLedgerDays` 会把 `[windowStart, today)` 的**每一天**都物化出来
   * （空日子也补），而面板永远结算**最早**的那一天。窗口下界是
   * `max(today − 7, enabledAt)` —— 若把 `enabledAt` 种在 8 天前，窗口就是整整 7 天，
   * 面板会落在 7 天前那个**空日子**上（`hasPlan` 为假 ⇒ 走"没有安排计划"分支），
   * 于是种下的计划内条目根本不出现在面板里（踩过：截图里一个「① 计划内的事」条目都没有）。
   * 种成昨天 ⇒ 窗口下界 = 昨天 ⇒ 只剩昨天一天待结算，面板正好落在它有计划的昨天。
   */
  const money = {
    enabled: true,
    config: '__DEFAULT_MONEY_CONFIG__',
    enabledAt: pendingDate,
    days,
    weeks: []
  }

  return {
    version: 2,
    goals,
    events: [],
    weekPresets: [],
    weekEvents: [],
    weekCounterOffset: 0,
    money
  }
}

const glassFor = (engine) =>
  JSON.stringify({
    displacementScale: 118,
    blurAmount: 0.4,
    saturation: 140,
    aberrationIntensity: 3,
    elasticity: 0.1,
    cornerRadius: 32,
    mode: 'standard',
    forceEngine: engine
  })

const PLATE = '.gs-layer--dialog .gs-plate'
const CONTENT = '.settle-day'

const browser = await chromium.launch({ executablePath, headless: true })

async function openPage(engine) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    hasTouch: true,
    isMobile: true
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  /*
   * ⚠️ 与 R3-D 同样的坑：`page.addInitScript` **每次导航都会重跑**。
   * 这里换 money.config 之后要 reload 一次，若没有一次性闸门，reload 会把 config
   * 盖回占位串 ⇒ `validMoney` 判死 ⇒ 整份 money 被静默丢掉 ⇒ 日结卡不显示
   * ⇒ 面板永远打不开（症状极具误导性，看着像"入口路径断了"）。
   * 闸门用 sessionStorage：跨 reload 保留，但不跨 context 共享。
   */
  await page.addInitScript(
    ([dk, dv, gk, gv]) => {
      if (window.sessionStorage.getItem('__probeSeeded') === '1') return
      window.sessionStorage.setItem('__probeSeeded', '1')
      window.localStorage.setItem(dk, dv)
      window.localStorage.setItem(gk, gv)
    },
    [DATA_KEY, JSON.stringify(seedData()), GLASS_KEY, glassFor(engine)]
  )
  await page.goto(`${base}?page=weekly&strict=0&sidebar=1`, { waitUntil: 'load' })
  await page.waitForSelector('.weekly-shell', { timeout: 20000 })

  // 用页面内真源补齐 money.config（见 seedData 注释）
  await page.evaluate(([dk]) => {
    const d = JSON.parse(window.localStorage.getItem(dk) || '{}')
    if (d.money && d.money.config === '__DEFAULT_MONEY_CONFIG__') {
      d.money.config = window.__DEFAULT_MONEY_CONFIG__ ?? null
      window.localStorage.setItem(dk, JSON.stringify(d))
    }
  }, [DATA_KEY])

  const moneyOk = await page.evaluate(([dk]) => {
    const d = JSON.parse(window.localStorage.getItem(dk) || '{}')
    return Boolean(d.money && d.money.config && typeof d.money.config.weeklyTC === 'number')
  }, [DATA_KEY])
  if (!moneyOk) {
    await context.close()
    throw new Error('播种 money.config 失败：页面内取不到 DEFAULT_MONEY_CONFIG（见 seedData 注释）')
  }

  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('.weekly-shell', { timeout: 20000 })
  await page.waitForTimeout(700)

  // 断言种子确实渲染出了「待结算」入口 —— 否则后面量的是空气
  const hasEntry = await page.evaluate(() => Boolean(document.querySelector('.settle-card')))
  if (!hasEntry) {
    await context.close()
    throw new Error('种子未渲染出日结入口（.settle-card）：money 被静默丢弃或 pendingDays 为 0')
  }
  return { context, page, errors }
}

/**
 * 打开日结面板，并**返回打开耗时**（毫秒）。
 *
 * 计时窗口：从点击「打开日结」的那一刻，到面板可见且材质板 backdrop-filter 已生效。
 * 用 `performance.now()` 在页面内取（同一条时间线，不受 Node 侧调度抖动影响）。
 *
 * 为什么不夹"等一帧"：R3-E 要的数字正是**用户点下去到看见**的时长，
 * 多等一帧就把开销抹掉了。这里在 rAF 回调里判定"可见 + backdrop 生效"，取那一刻的 t。
 */
async function openPanelTimed(page) {
  const opened = await page.evaluate(async () => {
    const btn = document.querySelector('.settle-card')
    if (!btn) return { ok: false, reason: 'no .settle-card' }
    // 日结卡本身可点（SettleCard 的 onOpen）；找不到按钮就点卡片
    const target =
      btn.querySelector('button') ??
      [...btn.querySelectorAll('*')].find((el) => el.tagName === 'BUTTON') ??
      btn

    const t0 = performance.now()
    target.click()

    const deadline = t0 + 8000
    return await new Promise((resolve) => {
      const tick = () => {
        const panel = document.querySelector('.gs-layer--dialog .settle-head')
        const plate = document.querySelector('.gs-layer--dialog .gs-plate')
        const face = document.querySelector('.gs-layer--dialog .gs-panel, .gs-layer--dialog .gs-fallback')
        if (panel && face) {
          const bf = plate ? getComputedStyle(plate).backdropFilter : 'none'
          const bg = plate ? getComputedStyle(plate).backgroundColor : ''
          // 材质板只要已有"糊"或"染色"二者之一就说明接线到位（两档表现不同）
          const wired = (bf && bf !== 'none') || (bg && bg !== 'rgba(0, 0, 0, 0)')
          if (wired) {
            resolve({ ok: true, ms: +(performance.now() - t0).toFixed(1) })
            return
          }
        }
        if (performance.now() > deadline) {
          resolve({ ok: false, reason: '面板或材质板未在 8s 内就绪' })
          return
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  })
  if (!opened.ok) return opened
  await page.waitForTimeout(400) // 让入场动画落定，后续几何才稳定
  return opened
}

async function stdOf(page, rect) {
  const b64 = (await page.screenshot({ clip: rect })).toString('base64')
  return page.evaluate(async (b) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b)).blob())
    const g = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')
    g.drawImage(bmp, 0, 0)
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data
    let s = 0
    let s2 = 0
    const n = bmp.width * bmp.height
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i] + d[i + 1] + d[i + 2]) / 3
      s += v
      s2 += v * v
    }
    const mean = s / n
    return +Math.sqrt(Math.max(0, s2 / n - mean * mean)).toFixed(2)
  }, b64)
}

const insetClip = (r, dx, dy) => ({
  x: Math.round(r.x) + dx,
  y: Math.round(r.y) + dy,
  width: Math.max(1, Math.round(r.width) - dx * 2),
  height: Math.max(1, Math.round(r.height) - dy * 2)
})

const setPlateOff = (page) =>
  page.evaluate((sel) => {
    const p = document.querySelector(sel)
    if (!p) return
    p.dataset.probeBackup = p.style.cssText
    p.style.setProperty('backdrop-filter', 'none', 'important')
    p.style.setProperty('-webkit-backdrop-filter', 'none', 'important')
    p.style.setProperty('background', 'transparent', 'important')
  }, PLATE)

const setPlateOn = (page) =>
  page.evaluate((sel) => {
    const p = document.querySelector(sel)
    if (!p) return
    p.style.cssText = p.dataset.probeBackup || ''
    p.removeAttribute('data-probeBackup')
  }, PLATE)

/*
 * 条纹插在**页面侧**（被测浮层之前）。
 *
 * 弹窗已 portal 到 body，其祖先链是 `.gs-plate → .gs-anchor → .gs-layer--dialog
 * → .gs-viewport → body → html`。遮罩 `.modal-mask` 是材质板的**兄弟**（layerPrefix），
 * 所以条纹插成 body 第一个子节点即可（z-index 0，排在 portal 出来的 `.gs-viewport` 之前）。
 * 同时把 `.app` 与页面底色让开，免得它们把条纹盖住。
 */
const setStripes = (page, on) =>
  page.evaluate((use) => {
    document.getElementById('probeStripeBackdrop')?.remove()
    document.getElementById('probeRetentionCss')?.remove()
    if (!use) return
    const d = document.createElement('div')
    d.id = 'probeStripeBackdrop'
    d.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:0;' +
      'background:repeating-linear-gradient(0deg,#0b0f16 0 6px,#e8f1ff 6px 12px)'
    document.body.insertBefore(d, document.body.firstChild)
    const st = document.createElement('style')
    st.id = 'probeRetentionCss'
    st.textContent =
      '.app{background:transparent!important}.content{background:transparent!important}' +
      '.weekly-shell{background:transparent!important}'
    document.head.appendChild(st)
  }, on)

/* ------------------------------------------------------- 材质可见度 */
/**
 * 取一张页面级截图并**在 Node 侧**做像素统计（Δmean / Δmax / 变化像素% / grad）。
 *
 * 为什么不在浏览器里算：Δmean 与 grad 要与 `glass-material-probe.mjs` +
 * `glass-material-judge.py` **逐字对得上**（同一套门槛、同一套单位）。
 * judge 是 Python + numpy 按 0~255 逐通道算的，浏览器侧再写一遍就是第二处定义，
 * 迟早与它漂移。这里只把 PNG 原样取回 Node，交给同一支 Python 判。
 */
const shoot = async (page, name) => {
  await page.screenshot({ path: `${outDir}/${name}.png` })
  // 返回**带扩展名**的名字：judge 的 `load()` 直接 `Image.open(out / name)`，
  // 不会替你补 `.png`（照 `glass-material-probe.mjs` 的 shoot 契约）。
  return `${name}.png`
}
/**
 * 量材质可见度。返回 Δmean / grad 等，并给出与 judge 同门槛的判读。
 *
 * 采样盒取**材质板**（`.gs-layer--dialog .gs-plate`）—— 与其余弹窗一致。
 * 量之前关掉遮罩虚化（`--gs-mask-blur:0`）：让材质板面对**锐利**背景，
 * 「材质开」这一帧的 grad 才会明显低于「材质关」那一帧（"已糊化"的正证据）。
 * 这一步是 `glass-material-probe.mjs` 的既有做法（A5/A6 那一组）。
 */
async function measureMaterial(page, tag) {
  await setStripes(page, false)
  await page.evaluate(() => {
    for (const id of ['probeHideBody', 'probeSharpMask']) document.getElementById(id)?.remove()
    const st = document.createElement('style')
    st.id = 'probeHideBody'
    // 量材质要藏内容：面板里的文字/输入框足以把 Δmean 抬高（弹窗那边实测过 0.07→0.84）。
    // 内容层就是 `.settle-day`（`DayForm` 生成的主体）；`visibility:hidden` 它 ——
    // 它仍在流里、照旧撑开玻璃可见面，只是不往采样盒里贡献文字高频细节。
    st.textContent = '.settle-day{visibility:hidden!important}'
    document.head.appendChild(st)

    /*
     * 关掉遮罩虚化。⚠️ 必须带 `!important`：`--gs-mask-blur` 定义在 glass.css 的
     * `:root` 上，而 Vite dev 注入的样式表**排在探针注入的 <style> 之后**，
     * 同权重按源序后者胜 ⇒ 不带 `!important` 时这条覆盖会静默失效（踩过）。
     */
    const sharp = document.createElement('style')
    sharp.id = 'probeSharpMask'
    sharp.textContent = ':root{--gs-mask-blur:0px !important}'
    document.head.appendChild(sharp)
  })
  await setStripes(page, true)
  await page.waitForTimeout(420)

  const rect = await page.evaluate((sel) => {
    const b = document.querySelector(sel).getBoundingClientRect()
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
  }, PLATE)
  const sample = insetClip({ x: rect.x, y: rect.y, width: rect.w, height: rect.h }, 12, 10)

  const onName = await shoot(page, `${tag}-material-on`)

  // 保留率（参考口径，不进退出码）：条纹在页面侧、材质板在浮层侧
  const control = { x: 20, y: 700, width: 120, height: 80 }
  const controlStd = await stdOf(page, control)
  const onStd = await stdOf(page, sample)

  await setPlateOff(page)
  await page.waitForTimeout(360)
  const offName = await shoot(page, `${tag}-material-off`)
  const offStd = await stdOf(page, sample)
  await setPlateOn(page)

  await setStripes(page, false)
  await page.evaluate(() => {
    for (const id of ['probeHideBody', 'probeSharpMask']) document.getElementById(id)?.remove()
  })
  await page.waitForTimeout(280)

  return {
    tag,
    box: { x: sample.x, y: sample.y, w: sample.width, h: sample.height },
    on: onName,
    ref: offName,
    controlStd,
    onStd,
    offStd,
    ratio: offStd ? +(onStd / offStd).toFixed(3) : null
  }
}

/* ---------------------------- 结构与祖先链 */
async function structure(page) {
  return page.evaluate(
    ([plateSel]) => {
      const chain = []
      for (let n = document.querySelector(plateSel); n; n = n.parentElement) {
        const cs = getComputedStyle(n)
        chain.push({
          tag: n.tagName.toLowerCase(),
          cls: String(n.className || '').trim().split(/\s+/).slice(0, 2).join('.'),
          position: cs.position,
          zIndex: cs.zIndex,
          transform: cs.transform === 'none' ? 'none' : 'non-none'
        })
        if (n === document.documentElement) break
      }
      const layer = document.querySelector('.gs-layer--dialog')
      const plateEl = document.querySelector(plateSel)
      const face = document.querySelector('.gs-layer--dialog .gs-panel, .gs-layer--dialog .gs-fallback')
      const geo = (el) => {
        if (!el) return null
        const b = el.getBoundingClientRect()
        return {
          cx: +(b.x + b.width / 2).toFixed(1),
          cy: +(b.y + b.height / 2).toFixed(1),
          w: Math.round(b.width),
          h: Math.round(b.height)
        }
      }
      return {
        engine: layer?.dataset.glassEngine ?? '',
        plate: geo(plateEl),
        face: geo(face),
        maskExists: Boolean(document.querySelector('.modal-mask')),
        /*
         * 断言"面板落在种下的那一天"：`① 计划内的事` 里应当有种子那条「写周报」。
         *
         * 这条守的是**种子有效**，不是产品行为：窗口物化会把更早的空日子一起补出来，
         * 而面板永远结算最早一天 —— `enabledAt` 一旦种错，面板就落在空日子上，
         * 后面量到的是"没有计划"那一种形态（更矮、内容更少），数字会悄悄失真。
         */
        seededRowVisible: /写周报/.test(document.body.textContent || ''),
        sessionTitle: document.querySelector('.settle-sub')?.textContent?.trim() ?? '',
        legacyOverlay: Boolean(document.querySelector('.settle-overlay')),
        legacyPanelStandalone: (() => {
          const el = document.querySelector('.settle-panel')
          if (!el) return false
          return !el.closest('.gs-layer--dialog')
        })(),
        chain,
        plateBackdrop: plateEl ? getComputedStyle(plateEl).backdropFilter : null,
        plateHasUrl: plateEl ? /url\(/.test(getComputedStyle(plateEl).backdropFilter) : false
      }
    },
    [PLATE]
  )
}

/* ------------------------------------------------------------- 每档跑一轮 */
async function runEngine(engine) {
  const { context, page, errors } = await openPage(engine)

  const timing = await openPanelTimed(page)
  if (!timing.ok) {
    await context.close()
    return { engine, opened: false, reason: timing.reason, errors }
  }

  const struct = await structure(page)
  const material = await measureMaterial(page, `${engine}-A`)

  await context.close()
  return { engine, opened: true, openMs: timing.ms, struct, material, errors }
}

/* ------------------------------------------------------------------ 主流程 */
const results = {}
for (const engine of ['fallback', 'chromium']) {
  console.log(`\n【${engine}】`)
  const r = await runEngine(engine)
  results[engine] = r
  if (!r.opened) {
    console.log(`  ✗ 面板没能打开：${r.reason}`)
    continue
  }
  console.log(`  打开耗时 ${r.openMs} ms`)
  console.log(
    `  材质板 ${r.struct.plate?.w}×${r.struct.plate?.h} @(${r.struct.plate?.cx},${r.struct.plate?.cy})｜遮罩存在 ${r.struct.maskExists ? '✓' : '✗'}`
  )
  console.log(
    `  旧结构残留：.settle-overlay ${r.struct.legacyOverlay ? '✗ 仍在' : '✓ 已消失'}｜.settle-panel 独立壳 ${r.struct.legacyPanelStandalone ? '✗ 仍在' : '✓ 无'}`
  )
  console.log(`  面板落在种下的那天（含「写周报」）${r.struct.seededRowVisible ? '✓' : '✗'}｜${r.struct.sessionTitle}`)
  const offenders = r.struct.chain.filter((n, i) => i > 0 && (n.position === 'fixed' || n.position === 'sticky' || (n.zIndex && n.zIndex !== 'auto') || n.transform !== 'none'))
  console.log(`  祖先链合成面 ${offenders.length ? `✗ 命中 ${offenders.map((n) => `${n.tag}.${n.cls}(${n.position}/${n.zIndex}/${n.transform})`).join(',')}` : '✓'}`)
  console.log(
    `  保留率（参考）${r.material.ratio}（std 开 ${r.material.onStd} / 关 ${r.material.offStd}，条纹控制 ${r.material.controlStd}）`
  )
  console.log(`  材质板 backdrop=${r.struct.plateBackdrop}｜含 url( = ${r.struct.plateHasUrl}`)
}

/* --------------------------- 材质可见度：交给 judge（Δmean + grad） */
/*
 * 与其余弹窗**同一支判据**。这里不自己实现 Δmean/grad —— 那是同一个数字的第二处定义。
 * 把两组（开/关）PNG 与采样盒写成 `cases.json`，交给
 * `glass-material-judge.py` 输出与其它弹窗可比的 Δmean/grad 表。
 * （文件名必须是 `cases.json`，且 `name`/`ref` 要**带 `.png`** —— judge 直接
 * `Image.open(out / name)`，不替你补扩展名。见脚本第 30 / 64 行。）
 */
const manifest = {
  cases: []
}
for (const [k, r] of Object.entries(results)) {
  if (!r.opened) continue
  manifest.cases.push({
    label: `日结面板 · ${k} · 材质开 vs 关（遮罩不虚化）`,
    name: r.material.on,
    ref: r.material.ref,
    box: r.material.box
  })
}
writeFileSync(`${outDir}/cases.json`, JSON.stringify(manifest, null, 2))

/* ------------------------------------------------------------------ 判定 */
const failures = []

for (const [k, r] of Object.entries(results)) {
  if (!r.opened) {
    failures.push(`${k}: 面板未能打开（${r.reason}）`)
    continue
  }
  if (!r.struct.maskExists) failures.push(`${k}: 没找到遮罩 .modal-mask（GlassModal 的 layerPrefix 没生效？）`)
  if (!r.struct.seededRowVisible) {
    failures.push(`${k}: 面板没落在种下的那一天（种子里的「写周报」没出现）—— 大概率是 enabledAt 种错，量到的是空日子的形态`)
  }
  if (r.struct.legacyOverlay) failures.push(`${k}: 旧结构 .settle-overlay 仍在 DOM —— 它会截断背景采样`)
  if (r.struct.legacyPanelStandalone) failures.push(`${k}: 存在独立的旧面板壳 .settle-panel（它不属于玻璃树 —— 旧结构没清干净）`)
  if (r.struct.plateHasUrl) failures.push(`${k}: 材质板 backdrop-filter 含 url( —— 会替掉 blur`)
  const off = r.struct.chain.filter(
    (n, i) => i > 0 && (n.position === 'fixed' || n.position === 'sticky' || (n.zIndex && n.zIndex !== 'auto') || n.transform !== 'none')
  )
  if (off.length) {
    failures.push(
      `${k}: 材质板祖先链上有合成面（${off.map((n) => `${n.tag}.${n.cls}`).join(',')}）—— 会让材质只剩染色`
    )
  }
  if (r.openMs > OPEN_BUDGET_MS) {
    failures.push(`${k}: 打开耗时 ${r.openMs}ms 超过预算 ${OPEN_BUDGET_MS}ms（standard/fallback 档）`)
  }
}

console.log('\n【判定】')
for (const [k, r] of Object.entries(results)) {
  if (!r.opened) {
    console.log(`  ✗ ${k} 面板未能打开`)
    continue
  }
  const off = r.struct.chain.filter(
    (n, i) => i > 0 && (n.position === 'fixed' || n.position === 'sticky' || (n.zIndex && n.zIndex !== 'auto') || n.transform !== 'none')
  )
  console.log(
    `  ✓ ${k} 结构 ✓（旧结构已消失、祖先无合成面）｜保留率（参考）${r.material.ratio}｜打开 ${r.openMs}ms｜材质可见度见下方 judge 表`
  )
  void off
}

const allErrors = Object.values(results)
  .flatMap((r) => r.errors || [])
  .filter((e) => !/favicon|ERR_FILE_NOT_FOUND.*photos/i.test(e))
console.log('\n【错误收集】')
console.log(allErrors.length ? allErrors.slice(0, 8).map((e) => `  ⚠ ${e}`).join('\n') : '  无 pageerror / console error')
if (allErrors.length) failures.push(`${allErrors.length} 条运行时错误`)

writeFileSync(
  `${outDir}/retention.json`,
  JSON.stringify(
    {
      meta: {
        browser: executablePath,
        engines: ['fallback', 'chromium'],
        retentionAliveMax: ALIVE_MAX,
        materialThresh: { empty: DM_EMPTY, weak: DM_WEAK, minFrac: MIN_FRAC },
        openBudgetMs: OPEN_BUDGET_MS,
        plateSel: PLATE
      },
      results,
      failures
    },
    null,
    2
  )
)
console.log(`\n结果已写入 ${outDir}/ 与 ${outDir}/retention.json`)
console.log(
  `材质可见度请接着跑：\n  "C:/Users/Samuel/.workbuddy/binaries/python/envs/default/Scripts/python.exe" \\\n    scripts/glass-material-judge.py ${outDir}`
)

await browser.close()
if (failures.length) {
  console.error(`\n✗ 失败：${failures.join(' | ')}`)
  process.exit(1)
}
console.log('\n✓ 通过：结构正确、旧结构已消失、祖先无合成面、打开耗时在预算内（材质可见度见 judge）')
process.exit(0)
