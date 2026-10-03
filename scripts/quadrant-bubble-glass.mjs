#!/usr/bin/env node
/**
 * R3-D · 四象限计费气泡的液态玻璃 —— 保留率 + 结构 + 指针行为零变化，**可失败**。
 *
 * 这是全项目唯一一个**玻璃宿主不在"内容所在的那棵树"里**的浮层：
 * 气泡逻辑上属于画布（随 `translate + scale` 平移缩放），但玻璃层**不能**待在
 * 画布里 —— 因为 Chromium 里祖先的 `transform` 就是合成面，会把材质采到的
 * 背景截断（详见下）。于是玻璃层挂在 `.quadrant-viewport` 下、`.event-layer` 的**兄弟**位置，
 * 位置改由 `worldToScreenX/Y` 用 `view` 现算。
 *
 * 本探针因此要守四件别的宿主没有的事：
 *
 *   ① **祖先链上不能有 transform**（Chromium 档）。实测：真实 `translate+scale` 与
 *      **恒等矩阵**都让保留率停在 0.659（= 只剩染色），属性整个移除才回到 0.111。
 *      即"与数值无关、只要声明存在就致病"。
 *   ② **位置必须由 `view` 驱动、不是继承 DOM**。只改 `.event-layer` 的 transform
 *      而不动 React state 时：卡片**应当**动，气泡与材质板**应当**不动。
 *      这条把"谁在驱动位置"钉死，防止有人改回继承。
 *   ③ **材质锚点与气泡中心重合**（容差 1px）。守的是锚点表达式与内容盒对得上
 *      —— 曾因内容层里塞绝对定位子节点（不撑高）而两边错开一整块。
 *   ④ **指针行为零变化**。气泡的 `stopPropagation` 是为"拖拽/长按不得落到手势内核"
 *      而存在的（它挂在 `useCanvasGestures` 的地盘上）。玻璃层若吞掉或漏掉事件，
 *      几何断言全绿也发现不了，所以这里**真按一下**并断言副作用。
 *
 * 保留率口径（沿用项目）：条纹插在被测浮层**之前**的页面侧 → 同状态抓
 * 「材质开 / 材质关」两张 → `std(开)/std(关)`。**≤0.2 为活；≈1 − 染色 = 只剩染色（死）。**
 *
 * 硬约束：
 *   · 只用**页面级** `page.screenshot({ clip })`；元素级截图会把一切判成穿透。
 *   · 采样盒躲开文字（量保留率时藏 `.quadrant-cost-bubble`，它就是内容层）。
 *   · 手机档必须显式设 `forceEngine`（本探针两档都量）。
 *   · ⭐ 播种脚本要带**一次性闸门**（`sessionStorage`）：`addInitScript` 每次导航都重跑，
 *     而本探针中途会 reload 一次来让 store 按补齐后的 money.config 初始化 ——
 *     没有闸门时那一发 reload 会把补齐好的 config **盖回占位串**，整份 money 被
 *     静默丢掉、菜单里根本没有「标记完成」，症状是"气泡打不开"（踩过）。
 *
 * 前置（另开终端）：
 *   ./node_modules/.bin/vite --config vite.web.config.ts --port 5199 --host 127.0.0.1 --strictPort
 *
 * 用法：
 *   node scripts/quadrant-bubble-glass.mjs --out docs/probes/quadrant-bubble
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
const outDir = ARG('out', 'docs/probes/quadrant-bubble')
const base = `http://127.0.0.1:${port}/probe.html`
mkdirSync(outDir, { recursive: true })

const DATA_KEY = 'quadrant-web-data-v2'
const GLASS_KEY = 'quadrant-glass-v1'
const ALIVE_MAX = 0.2
const MIN_TEXT_CONTRAST = 4.5

const iso = (i) => new Date(Date.now() - i * 3600_000).toISOString()

/**
 * 播种数据。
 *
 * ⚠️ 必须逐字段满足 `platformApi.validAppData`，否则**整份静默作废**
 * （探针表现为"一个事件都没有"）。三个实体的必需字段照 `src/shared/types.ts` 抄：
 *   Goal 要 remark/order/groupTitles/subtasks（且**没有** quadrant 字段）
 *   QuadrantEvent 要 x/y/width
 *   WeekEvent 要 showInQuadrant
 * 另外 money 要 enabled=true，否则计费气泡的入口（菜单「标记完成」）整个不渲染。
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

  /*
   * ⚠️ 事件必须落在**屏幕可见处**，否则气泡虽然生成了却在视口外，
   * 采样盒取到空区域 ⇒ `page.screenshot` 抛 "Clipped area is outside the image"。
   *
   * 世界原点 (0,0) 映射到屏幕 (panX, panY)。初始 pan 由 `clampOrigin` 夹到
   * `[EDGE_MARGIN_PX, 尺寸−EDGE_MARGIN_PX]` 内，手机上实测约 (183, 369)，
   * 视口 390×844 ⇒ 可见世界范围 x≈[-9, 10]、y≈[-24, 9]。
   * 事件矩形是 `left = x*UNIT`、`top = -y*UNIT`（UNIT=20、zoom=1），
   * 且 `y` 是**卡片底边**（向上占 EVENT_HEIGHT_UNITS）。
   * 所以取 x 略负、y 略负，卡片就落在左上/左下的象限里、离轴有间距。
   * （这组数是量出来的，不是猜的 —— 详见 `tmp/r3d-geo.mjs` 的输出。）
   */
  const events = [
    { id: 'q0', quadrant: 2, x: -8, y: -2 },
    { id: 'q1', quadrant: 2, x: -8, y: -6 },
    { id: 'q2', quadrant: 3, x: -8, y: -10 }
  ].map((e, i) => ({
    ...e,
    text: `象限任务 ${i + 1}`,
    remark: '',
    width: 6,
    createdAt: iso(i)
  }))

  /*
   * money.config **不能用 `{}`**：`validMoney` 要求 MONEY_NUMERIC_KEYS 里的每个键
   * 都是有限数，缺一个整份 money 就会被三档降级丢掉 ⇒ `moneyEnabled` 为 false
   * ⇒ 菜单里的「标记完成」整个不渲染 ⇒ 气泡永远打不开。
   * （这条踩过：探针表现为"气泡没能打开"，而 DOM 里连入口都没有。）
   *
   * 值在 `openPage` 里用页面内的 `DEFAULT_MONEY_CONFIG` 补齐 ——
   * 手抄一份常量就是同一个数字的第二处定义，迟早与真源漂移。
   * 这里先占位，稍后 replace。
   */
  const money = {
    enabled: true,
    config: '__DEFAULT_MONEY_CONFIG__',
    days: [],
    weeks: []
  }

  return {
    version: 2,
    goals,
    events,
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

const PLATE = '.gs-layer--bubble .gs-plate'
const BUBBLE = '.quadrant-cost-bubble'

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
   * ⚠️ 播种脚本**每次导航都会重跑**（`addInitScript` 挂在 document-start 上）。
   *
   * 本探针后面要把 money.config 从占位串换成页面内的真源，然后 reload 一次让 store
   * 按新载荷初始化 —— 若播种脚本没有闸门，那一发 reload 会把换好的对象**又盖回占位串**，
   * `validMoney` 直接判死 ⇒ 整份 money 被三档降级丢掉 ⇒ 菜单里没有「标记完成」
   * ⇒ 看起来像"入口路径断了"。这条踩过：诊断脚本（在页面里 patch、不重复注入）能过，
   * 探针（`addInitScript` 注入）不过，差别只在这里。
   *
   * 闸门用 sessionStorage：它同样跨 reload 保留，但**不在新 context 之间共享**，
   * 所以每档每页仍是干净的第一次。
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
  await page.goto(`${base}?page=quadrant&sidebar=1&strict=0`, { waitUntil: 'load' })
  await page.waitForSelector('.event-card', { timeout: 20000 })

  /*
   * 用页面内的真源补齐 money.config（见 seedData 里那段注释：手抄常量会漂移）。
   * `DEFAULT_MONEY_CONFIG` 是共享模块的导出，探针页拿得到。
   */
  await page.evaluate(([dk]) => {
    const d = JSON.parse(window.localStorage.getItem(dk) || '{}')
    if (d.money && d.money.config === '__DEFAULT_MONEY_CONFIG__') {
      // 走 probe 页已有的模块图取真源；取不到就保持占位（下面会显式失败，不静默）
      d.money.config = window.__DEFAULT_MONEY_CONFIG__ ?? null
      window.localStorage.setItem(dk, JSON.stringify(d))
    }
  }, [DATA_KEY])

  // 校验补齐成功：没有 config 的 money 会被静默丢掉，必须显式发现
  const moneyOk = await page.evaluate(([dk]) => {
    const d = JSON.parse(window.localStorage.getItem(dk) || '{}')
    return Boolean(d.money && d.money.config && typeof d.money.config.weeklyTC === 'number')
  }, [DATA_KEY])
  if (!moneyOk) {
    await context.close()
    throw new Error('播种 money.config 失败：页面内取不到 DEFAULT_MONEY_CONFIG（见 seedData 注释）')
  }

  // config 变了要重新加载一次，让 store 按新载荷初始化
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('.event-card', { timeout: 20000 })
  await page.waitForTimeout(700)
  return { context, page, errors }
}

/**
 * 打开计费气泡。
 *
 * 走真实路径：右键事件卡 → 菜单 → 点「标记完成」。三处都不得抄近路 ——
 * 抄近路（直接给 store 塞一个 billingId）会绕开"菜单项在不在、点得动点不动"，
 * 而那正是玻璃化最容易碰坏的东西。
 */
async function openBubble(page) {
  /*
   * 必须挑**落在视口里**的那张卡片：右键点不在视口内的元素，浏览器会给一个
   * 越界坐标，菜单可能被钳回屏幕边缘、也可能点不中。
   * （播种已保证可见，这里再防一手，避免将来改种子时静默失效。）
   */
  const found = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.event-card')]
    const card = cards.find((c) => {
      const b = c.getBoundingClientRect()
      return b.width > 0 && b.x >= 0 && b.x + b.width <= innerWidth && b.y >= 0 && b.y + b.height <= innerHeight
    })
    if (!card) return null
    const b = card.getBoundingClientRect()
    card.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: b.x + b.width / 2,
        clientY: b.y + b.height / 2
      })
    )
    return { x: Math.round(b.x), y: Math.round(b.y) }
  })
  if (!found) return false
  await page.waitForSelector('.gs-layer--menu', { timeout: 8000 })
  await page.waitForTimeout(300)

  const clicked = await page.evaluate(() => {
    const item = [...document.querySelectorAll('.gs-layer--menu button, .gs-layer--menu [role="menuitem"]')].find(
      (b) => /完成/.test(b.textContent || '')
    )
    if (!item) return false
    item.click()
    return true
  })
  if (!clicked) return false
  await page.waitForSelector(BUBBLE, { timeout: 8000 })
  await page.waitForTimeout(500)
  return true
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
 * 气泡挂在 `.event-layer` 里，它自己的祖先链很长；最省事且最忠实的做法与
 * `liquid-glass-probe` 一致：把条纹插成 body 的第一个子节点（z-index 0），
 * 再把中间那些不透明底临时让开。
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
      '.app{background:transparent!important}.quadrant-viewport{background:transparent!important}'
    document.head.appendChild(st)
  }, on)

/* ------------------------------------------------------- 保留率 */
async function measureRetention(page, tag) {
  await setStripes(page, false)
  await page.evaluate(() => {
    document.getElementById('probeHideBody')?.remove()
    const st = document.createElement('style')
    st.id = 'probeHideBody'
    // 量材质要藏内容：气泡里的文字与按钮足以把保留率抬高（弹窗那边实测过 0.07→0.84）。
    // 内容层现在就是 `.quadrant-cost-bubble` 本身（R3-D 改法），
    // 直接 `visibility:hidden` 它 —— 它仍在流里、照旧撑开玻璃可见面，
    // 只是不再往采样盒里贡献文字高频细节。
    st.textContent = '.quadrant-cost-bubble{visibility:hidden!important}'
    document.head.appendChild(st)
  })
  await setStripes(page, true)
  await page.waitForTimeout(420)

  const rect = await page.evaluate((sel) => {
    const b = document.querySelector(sel).getBoundingClientRect()
    return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
  }, PLATE)
  const sample = insetClip(rect, 10, 8)

  // 控制盒：同一屏上另一处也有条纹的地方，用来证明"条纹本身是锐利的"
  const control = { x: 20, y: 200, width: 120, height: 80 }
  const controlStd = await stdOf(page, control)

  const onStd = await stdOf(page, sample)
  await page.screenshot({ path: `${outDir}/${tag}-material-on.png` })

  await setPlateOff(page)
  await page.waitForTimeout(360)
  const offStd = await stdOf(page, sample)
  await page.screenshot({ path: `${outDir}/${tag}-material-off.png` })

  await setPlateOn(page)
  await setStripes(page, false)
  await page.evaluate(() => document.getElementById('probeHideBody')?.remove())
  await page.waitForTimeout(280)

  return { tag, sample, controlStd, onStd, offStd, ratio: offStd ? +(onStd / offStd).toFixed(3) : null }
}

/* ------------------------------------------------------- 几何：锚点/材质板/气泡 三者对齐 */
async function geometry(page) {
  return page.evaluate(
    ([plateSel, bubbleSel]) => {
      const c = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const b = el.getBoundingClientRect()
        return {
          cx: +(b.x + b.width / 2).toFixed(1),
          cy: +(b.y + b.height / 2).toFixed(1),
          w: Math.round(b.width),
          h: Math.round(b.height)
        }
      }
      const layer = document.querySelector('.gs-layer--bubble')
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
      return {
        engine: layer?.dataset.glassEngine ?? '',
        plate: c(plateSel),
        bubble: c(bubbleSel),
        face: c('.gs-layer--bubble .glass') ?? c('.gs-layer--bubble .gs-fallback'),
        chain,
        plateBackdrop: (() => {
          const p = document.querySelector(plateSel)
          return p ? getComputedStyle(p).backdropFilter : null
        })(),
        contentBackdrop: (() => {
          const f = document.querySelector('.gs-layer--bubble .gs-fallback')
          return f ? getComputedStyle(f).backdropFilter : null
        })(),
        plateHasUrl: (() => {
          const p = document.querySelector(plateSel)
          return p ? /url\(/.test(getComputedStyle(p).backdropFilter) : false
        })()
      }
    },
    [PLATE, BUBBLE]
  )
}

/* ------------------------------------------------------- 指针行为（真按一下 + 断言副作用） */
async function pointerInvariance(page) {
  const before = await page.evaluate(() => ({
    cards: document.querySelectorAll('.event-card').length,
    menus: document.querySelectorAll('.gs-layer--menu').length,
    bubble: Boolean(document.querySelector('.quadrant-cost-bubble'))
  }))

  /*
   * 在气泡**内部**（标题那一行）按下并抬起。
   *
   * 期望：事件被气泡自己接住 ⇒ 既不开菜单、也不新建事件、气泡仍在。
   * 若玻璃层吞掉了事件或让它穿透到画布，副作用会立刻可见（多一个菜单 / 多一个编辑输入框）。
   */
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    const b = el.getBoundingClientRect()
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + 12) }
  }, BUBBLE)

  await page.mouse.move(box.x, box.y)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForTimeout(400)

  const after = await page.evaluate(() => ({
    cards: document.querySelectorAll('.event-card').length,
    menus: document.querySelectorAll('.gs-layer--menu').length,
    bubble: Boolean(document.querySelector('.quadrant-cost-bubble')),
    editing: Boolean(document.querySelector('.event-input'))
  }))

  return { before, after, clickPoint: box }
}

/* ------------------------------------------- 随画布平移 + 祖先链无 transform */
/**
 * 本宿主特有、且是 R3-D 全部麻烦来源的两条断言。
 *
 * ⭐ ① **祖先链上不能有 `transform`**（Chromium 档的硬要求）。
 *
 * 这条是 R3-D 实测新挖出来的，**推翻了既有认知**：项目此前只把
 * `fixed` / `sticky` / 非 auto 的 `z-index` 当合成面，`transform` 一向被当作无害。
 * 实测（同一组条纹、同一块材质板，只动 `.event-layer` 的 transform）：
 *
 *     translate(pan) scale(zoom)（真实值）  保留率 0.659  ← 死
 *     matrix(1,0,0,1,0,0)（**恒等**，仍在）   保留率 0.659  ← 死
 *     none（属性整个移除）                    保留率 0.111  ← 活
 *
 * 第二行是关键：连恒等矩阵都致病 ⇒ 与数值无关，**只要声明存在就成立**。
 * 而 `.event-layer` 恒写成 `translate(...) scale(...)`，没有侥幸。
 *
 * ⇒ 玻璃宿主必须挂在 `.event-layer` 的**兄弟**位置（`.quadrant-viewport` 下）。
 *   本断言就是把这条钉住：谁将来把宿主挪回 `.event-layer` 里，立刻失败。
 *
 * ⭐ ② **气泡位置由 `view` 现算，不是靠 DOM 继承**。
 *
 * 宿主搬出 `.event-layer` 之后，"随画布平移缩放"这件事不再免费 —— 得由组件
 * 用 `worldToScreenX/Y` 换算。验证方式：**只改 `.event-layer` 的 transform、
 * 不改 React 的 `view`**，此时卡片会动、气泡**不该**动（因为它读的是 view）。
 * 反过来说，真实平移时 `view` 会同步更新、气泡跟着重算 ⇒ 二者始终一致。
 * 这条件把"位置到底由谁驱动"钉死：若有人改成继承 DOM，本断言会翻。
 */
async function panFollow(page) {
  const read = () =>
    page.evaluate(([bubbleSel]) => {
      const g = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const b = el.getBoundingClientRect()
        return { x: Math.round(b.x), y: Math.round(b.y) }
      }
      return {
        layerTransform: (() => {
          const el = document.querySelector('.event-layer')
          return el ? getComputedStyle(el).transform : null
        })(),
        card: g('.event-card'),
        bubble: g(bubbleSel),
        plate: g('.gs-layer--bubble .gs-plate')
      }
    }, [BUBBLE])

  const before = await read()
  /*
   * 只加平移、不动 React state。用 DOMMatrix 读当前值再叠加，避免把 scale 弄丢
   * （scale 一丢，卡片的屏幕位置会以另一种方式变化，判据就不干净了）。
   */
  await page.evaluate(() => {
    const el = document.querySelector('.event-layer')
    if (!el) return
    const m = new DOMMatrix(getComputedStyle(el).transform)
    el.style.transform = `matrix(1,0,0,1,${m.e + 40},${m.f + 30})`
  })
  await page.waitForTimeout(260)
  const after = await read()

  return {
    before,
    after,
    // 卡片必须动（证明这次改动确实生效了，否则下面的"没动"毫无意义）
    cardMoved: before.card && after.card ? before.card.x !== after.card.x || before.card.y !== after.card.y : false,
    // 气泡与材质板必须**没动**（位置由 view 决定，而 view 没变）
    bubbleSteady: before.bubble && after.bubble ? before.bubble.x === after.bubble.x && before.bubble.y === after.bubble.y : false,
    plateSteady: before.plate && after.plate ? before.plate.x === after.plate.x && before.plate.y === after.plate.y : false
  }
}

/* ------------------------------------------------------------- 每档跑一轮 */
async function runEngine(engine) {
  const { context, page, errors } = await openPage(engine)

  const opened = await openBubble(page)
  if (!opened) {
    await context.close()
    return { engine, opened: false, errors }
  }

  const geoBefore = await geometry(page)
  const retention = await measureRetention(page, `${engine}-A`)
  const pointer = await pointerInvariance(page)
  const follow = await panFollow(page)
  const geoAfter = await geometry(page)

  /*
   * 材质板中心 == 气泡中心。
   *
   * 两者是同一次布局的产物（材质板按可见面实测尺寸居中在锚点上），
   * 所以这条在任何变换下都该成立；它守的是"锚点表达式与内容盒是否对得上"
   * （曾因 `%` 与 px 混用、以及内容层里塞绝对定位子节点而两边错开一整块）。
   */
  const aligned =
    geoAfter.plate && geoAfter.bubble
      ? Math.abs(geoAfter.plate.cx - geoAfter.bubble.cx) <= 1 &&
        Math.abs(geoAfter.plate.cy - geoAfter.bubble.cy) <= 1
      : false

  /*
   * 祖先链上不许出现 transform（第 ① 条）。
   * 材质板自己不算 —— 它带不带 transform 与本规则无关（实测自己的 transform
   * 不影响自己的 backdrop-filter），且库也不会给它加。
   */
  const offenders = geoAfter.chain
    .filter((n, i) => i > 0 && n.transform !== 'none')
    .map((n) => `${n.tag}.${n.cls}`)

  await context.close()
  return { engine, opened: true, geoBefore, geoAfter, aligned, retention, pointer, follow, offenders, errors }
}

/* ------------------------------------------------------------------ 主流程 */
const results = {}
for (const engine of ['fallback', 'chromium']) {
  console.log(`\n【${engine}】`)
  const r = await runEngine(engine)
  results[engine] = r
  if (!r.opened) {
    console.log('  ✗ 气泡没能打开（入口路径断了？）')
    continue
  }
  console.log(
    `  几何 材质板 ${r.geoAfter.plate?.w}×${r.geoAfter.plate?.h} @(${r.geoAfter.plate?.cx},${r.geoAfter.plate?.cy})｜气泡 ${r.geoAfter.bubble?.w}×${r.geoAfter.bubble?.h} @(${r.geoAfter.bubble?.cx},${r.geoAfter.bubble?.cy})`
  )
  console.log(`  中心对齐 ${r.aligned ? '✓' : '✗'}（容差 1px）`)
  console.log(
    `  祖先链无 transform ${r.offenders.length ? `✗ 命中 ${r.offenders.join(',')}` : '✓'}`
  )
  console.log(
    `  随画布：卡片位移 ${r.follow.cardMoved ? '✓' : '✗'}｜气泡稳如 view ${r.follow.bubbleSteady ? '✓' : '✗'}｜材质板稳 ${r.follow.plateSteady ? '✓' : '✗'}`
  )
  console.log(`  保留率 ${r.retention.ratio}（std 开 ${r.retention.onStd} / 关 ${r.retention.offStd}，条纹控制 ${r.retention.controlStd}）`)
  console.log(
    `  材质板 backdrop=${r.geoAfter.plateBackdrop}｜含 url( = ${r.geoAfter.plateHasUrl}`
  )
  console.log(
    `  指针：按下前后 卡片 ${r.pointer.before.cards}→${r.pointer.after.cards}｜菜单 ${r.pointer.before.menus}→${r.pointer.after.menus}｜气泡 ${r.pointer.before.bubble}→${r.pointer.after.bubble}｜编辑框 ${r.pointer.after.editing}`
  )
}

/* ------------------------------------------------------------------ 判定 */
const classify = (ratio) => (ratio === null ? 'undefined' : ratio <= ALIVE_MAX ? 'alive' : 'dead')
const failures = []

for (const [k, r] of Object.entries(results)) {
  if (!r.opened) {
    failures.push(`${k}: 气泡未能打开`)
    continue
  }
  const v = classify(r.retention.ratio)
  if (v !== 'alive') failures.push(`${k}: 保留率 ${r.retention.ratio} 判为 ${v}（阈值 ≤${ALIVE_MAX}）`)
  if (!r.aligned) failures.push(`${k}: 材质板中心与气泡中心不重合（差 >1px）`)
  if (r.geoAfter.plateHasUrl) failures.push(`${k}: 材质板 backdrop-filter 含 url( —— 不可接受（会替掉 blur）`)
  // 祖先链不许有 transform（chromium 档的合成面之一，R3-D 实测新发现）
  if (r.offenders.length) {
    failures.push(`${k}: 材质板的祖先链上有 transform（${r.offenders.join(',')}）—— 会让材质只剩染色`)
  }
  // 随画布：卡片动了才算"改动生效"，此时气泡与材质板必须稳住（位置由 view 决定）
  if (!r.follow.cardMoved) failures.push(`${k}: 改动未生效 —— 卡片没跟着 transform 动，后面的"跟随"判据无意义`)
  if (!r.follow.bubbleSteady || !r.follow.plateSteady) {
    failures.push(`${k}: 气泡/材质板的位置继承了 DOM 的 transform（应当由 view 现算）`)
  }
  // 指针零变化：不能多菜单、不能多编辑框、气泡必须还在、卡片数不变
  const p = r.pointer
  if (p.after.menus !== p.before.menus) failures.push(`${k}: 点气泡后菜单数从 ${p.before.menus} 变成 ${p.after.menus}`)
  if (p.after.editing) failures.push(`${k}: 点气泡后冒出了事件编辑输入框（事件穿透到画布）`)
  if (!p.after.bubble) failures.push(`${k}: 点气泡后气泡消失了`)
  if (p.after.cards !== p.before.cards) failures.push(`${k}: 事件卡片数变了 ${p.before.cards}→${p.after.cards}`)
}

console.log('\n【判定】')
for (const [k, r] of Object.entries(results)) {
  if (!r.opened) {
    console.log(`  ✗ ${k} 气泡未能打开`)
    continue
  }
  const mark = classify(r.retention.ratio) === 'alive' ? '✓' : '✗'
  console.log(
    `  ${mark} ${k} 保留率 ${r.retention.ratio} ⇒ ${classify(r.retention.ratio)}｜祖先无 transform ${r.offenders.length === 0 ? '✓' : '✗'}｜随画布 ${r.follow.cardMoved && r.follow.bubbleSteady ? '✓' : '✗'}｜指针零变化 ${r.pointer.after.bubble && r.pointer.after.menus === r.pointer.before.menus && !r.pointer.after.editing ? '✓' : '✗'}`
  )
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
    { meta: { browser: executablePath, engines: ['fallback', 'chromium'], aliveMax: ALIVE_MAX, plateSel: PLATE }, results, failures },
    null,
    2
  )
)
console.log(`\n结果已写入 ${outDir}/ 与 ${outDir}/retention.json`)

await browser.close()
if (failures.length) {
  console.error(`\n✗ 失败：${failures.join(' | ')}`)
  process.exit(1)
}
console.log('\n✓ 通过：两档材质均活、锚点与气泡重合、指针行为零变化')
process.exit(0)
