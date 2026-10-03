#!/usr/bin/env node
/**
 * R3-F · 「我的」页趋势图荧光条在玻璃 dock 下是否真的被模糊 —— 可失败的复现探针。
 *
 * 用户报告（2026-10-03 图三）：「我的」的趋势图荧光条在液态玻璃下**没有模糊**，
 * 其他情况下底部栏的模糊正常。
 *
 * 这个报告很具体：dock 的材质本身在工作（"其他情况模糊正常"），只有**趋势图这一块**不糊。
 * 所以嫌疑不是「材质死了」，而是「趋势图这一块**没有进入 dock 的背景采样**」或
 * 「它被某种东西**排除在模糊之外**」。三个候选：
 *   ① 趋势图 SVG 那层光晕（`feGaussianBlur`）本身就是模糊的，用户把"已经是模糊的"
 *      看成"没有被二次模糊"——需要看数字，不是靠眼。
 *   ② SVG 有 `overflow: hidden` + 光晕裁切 ⇒ 边缘像"锐利的矩形"，被误读成"没糊"。
 *   ③ 真正的结构问题：趋势图所在的卡片/容器上有某种东西让 dock 采不到它
 *      （比如 `will-change`、`transform`、独立的合成层）。
 *
 * 判据（沿用项目口径）：**保留率 = std(材质开)/std(材质关)**，条纹插在**页面侧**。
 *   ≤0.2 活（背后被糊化）；≈ 1 − 染色 死（只剩染色）。
 * 本探针额外做一件事：**分区域量**。把采样盒分别放在
 *   · dock 正上方的**趋势图**区域
 *   · dock 正上方的**普通文字/卡片**区域（对照组）
 * 如果对照组达标而趋势图组不达标 ⇒ 复现，且根因在趋势图本身。
 *
 * 前置（另开终端）：
 *   ./node_modules/.bin/vite --config vite.web.config.ts --port 5199 --host 127.0.0.1 --strictPort
 *
 * 用法：
 *   node scripts/trend-chart-glass.mjs --out docs/probes/trend-glass
 */
import { existsSync, mkdirSync } from 'node:fs'
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
const outDir = ARG('out', 'docs/probes/trend-glass')
const base = `http://127.0.0.1:${port}/probe.html`
mkdirSync(outDir, { recursive: true })

const DATA_KEY = 'quadrant-web-data-v2'
const GLASS_KEY = 'quadrant-glass-v1'
const ALIVE_MAX = 0.2
/*
 * 荧光条锐度比的上限。sharpRatio = 峰值(材质开)/峰值(材质关)。
 *
 * 物理意义：未糊的线是一条饱和亮线，峰值高；被 blur 摊开后峰值降。
 * 实测（R3-F，375×667 DPR 2，采样盒 311×30）：
 *   · 修好前：1.00 —— 材质开与关两张的峰值**逐字相同**（板根本没输出到那条线上，
 *     眼睛看到的是 .sidebar 的 50% 保底底下面透上来的未糊内容）；
 *   · 修好后：0.23(fallback) / 0.33(chromium)。
 * 取 0.6：在"完全没糊"（1.0）与"糊了"（0.2~0.35）之间留足两侧余量。
 *
 * ⚠️ 这不是"模糊度"的精确刻画 —— 峰值下降同时受条纹相位、线在盒内的位置影响。
 * 它只回答一个是非题：这条线到底有没有被材质板处理过。1.0 vs 0.25 差得足够远。
 */
const SHARP_MAX = 0.6

const iso = (i) => new Date(Date.now() - i * 3600_000).toISOString()
const dayKey = (i) => {
  const d = new Date(Date.now() - i * 86400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/*
 * `money` 配置：必须**逐字段合规**（`validMoney` 逐字段查），否则整份 money 被
 * 静默丢弃 ⇒ `moneyEnabled` false ⇒ 「我的」页的金钱组**整组不渲染**，趋势图不存在。
 * 形状照 `src/shared/types.ts` 的 `MoneyState` / `LedgerDay` 抄：
 *   `enabled`(bool) + `config`(全数值键) + `days`(数组) + `weeks`(数组)。
 * `enabledAt` 可以省（可选），但这里给上以免窗口下界行为干扰。
 */
const MONEY = {
  enabled: true,
  enabledAt: dayKey(8),
  config: {
    weeklyTC: 560,
    dailyCapTC: 80,
    tcPerHour: 10,
    nightStartMin: 1410,
    nightEndMin: 360,
    nightMultiplier: 1.5,
    minCapRatio: 0.2,
    weeklyLT: 20,
    rewardLT: 0.5,
    penaltyLT: 0.5,
    missPenaltyLT: 1,
    videoLTPerHour: 1,
    gameLTPerHour: 1.5,
    restDayFactor: 0.8,
    abandonedDayTC: 80,
    latePhoneTC: 40,
    latePhoneLT: 2,
    quadrantMultiplier: { q1: 1.5, q2: 1.0, q3: 1.2, q4: 0.5 }
  },
  days: [],
  weeks: []
}

/**
 * 种子：逐字段满足 `platformApi.validAppData`。
 *
 * ⚠️ `WeekEvent` 的字段名是 `startMin`/`endMin`（不是 `startMinutes`），且必须有
 * `color`；`QuadrantEvent` 必须有 `x`/`y`/`width`；`Goal` 必须有 `remark`/`order`/
 * `groupTitles`/`subtasks` 且**没有** `quadrant`。任一处漏了 ⇒ 整份静默作废。
 */
function seedData() {
  const goals = ['期末总目标', '考过六级', '读完十本书'].map((title, i) => ({
    id: `g${i}`,
    title,
    type: i % 2 === 0 ? 'long' : 'short',
    done: false,
    remark: '备注文本',
    groupTitles: ['阶段一', '阶段二'],
    subtasks: [{ id: `g${i}s0`, title: '子目标 1', done: false, group: 0, remark: '', order: 0 }],
    order: i,
    createdAt: iso(i)
  }))

  const events = Array.from({ length: 6 }, (_, i) => ({
    id: `q${i}`,
    text: `象限任务 ${i + 1}`,
    remark: '',
    quadrant: (i % 4) + 1,
    x: 60 + (i % 3) * 150,
    y: 40 + Math.floor(i / 3) * 120,
    width: 130,
    createdAt: iso(i)
  }))

  // 本周七天都给一些时间块，让趋势线有起伏（平线判不出模糊）
  const weekEvents = []
  const COLORS = ['#8AB4F8', '#8CD9C1', '#F8B18C', '#B4A7E6', '#E8A0A0']
  for (let d = 0; d < 7; d++) {
    for (let k = 0; k < 3 + (d % 3); k++) {
      weekEvents.push({
        id: `w${d}-${k}`,
        date: dayKey(d),
        title: `任务 ${d}-${k}`,
        color: COLORS[(d + k) % COLORS.length],
        quadrant: ((d + k) % 4) + 1,
        startMin: 9 * 60 + k * 60,
        endMin: 10 * 60 + k * 60 + (d % 2 ? 30 : 0),
        remark: '',
        showInQuadrant: true,
        createdAt: iso(d * 3 + k)
      })
    }
  }

  return {
    version: 2,
    goals,
    events,
    weekPresets: [],
    weekEvents,
    weekCounterOffset: 0,
    money: MONEY
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

const insetClip = (r, dx, dy) => ({
  x: Math.round(r.x) + dx,
  y: Math.round(r.y) + dy,
  width: Math.max(1, Math.round(r.width) - dx * 2),
  height: Math.max(1, Math.round(r.height) - dy * 2)
})

const PLATE = '.gs-layer--dock .gs-plate'
const DOCK = '.gs-layer--dock'

const browser = await chromium.launch({ executablePath, headless: true })
const results = []

async function openPage(engine) {
  /*
   * ⭐ 视口取 **375×667（iPhone SE / 8 一档的短屏）**，不是 390×844。
   * 原因（R3-F 实测）：只有在短屏上，「时币趋势」那张卡在 scrollTop=0 时
   * 才**天然有一段压在 dock 后面**（390×844 下它整块在 dock 上方，两者
   * overlap=0 ⇒ 量不出东西）。用户的截图正是短屏。
   */
  const context = await browser.newContext({
    viewport: { width: 375, height: 667 },
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
  await page.addInitScript(
    ([dk, dv, gk, gv]) => {
      // ⭐ addInitScript 每次导航都重跑 ⇒ 用 sessionStorage 守卫，免得 reload 覆盖真配置
      if (window.sessionStorage.getItem('probeSeeded') === '1') return
      window.sessionStorage.setItem('probeSeeded', '1')
      window.localStorage.setItem(dk, dv)
      window.localStorage.setItem(gk, gv)
    },
    [DATA_KEY, JSON.stringify(seedData()), GLASS_KEY, glassFor(engine)]
  )
  await page.goto(`${base}?page=mine&sidebar=1&strict=0`, { waitUntil: 'load' })
  await page.waitForSelector('.sidebar', { timeout: 20000 })
  await page.waitForSelector(PLATE, { timeout: 20000 })
  await page.waitForTimeout(900)
  /*
   * 断言趋势图真的渲染出来了 —— 否则后面量的是一个不存在的元素，
   * 会得到"全 NaN 但看着像通过"的假结果。
   */
  const hasTrend = await page.locator('.money-trend').first().isVisible().catch(() => false)
  return { context, page, errors, hasTrend }
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

/**
 * 量一根**荧光细线**的锐度：返回 `σ_line = 该区域"线的信号"的峰值宽度指标`。
 *
 * 用「蓝 − 红」把线从背景里剥出来（线的色相偏蓝，背景偏中性偏暖；
 * 探针注入的黑白条纹是中性的，R=G=B，对这个差值零贡献）。
 *
 * ⭐ 判据用「信号峰值」（`peak`），不是 FWHM（R3-F 第三版更正）。
 * 原因：探针把条纹插在页面侧，条纹的黑白跳变本身就带**一大片**蓝−红信号，
 * 且它的量级（~178）远高于线本身（未糊 94 / 糊过 ~17）。
 * 无论挑哪一列，"最强列"都会被条纹跳变抢走，量出的宽度是条纹的、不是线的。
 *
 * 而**峰值**恰好把这两者分得很开，且物理意义直接：
 *   · 线未糊 ⇒ 它是一条 `stroke-width:2` 的饱和亮线 ⇒ 蓝−红峰值 ≈ 94；
 *   · 线被糊 ⇒ 能量被摊到 16.8px 宽的范围里 ⇒ 峰值掉到 ≈ 17。
 * 实测（从本探针输出的截图里量同一列同一段）：
 *   材质开：...15,15,15,15,15,15,15,15,16,16,16,16,17,17,17,17,17,17,17,16,16...
 *   材质关：...21,23,24,25,27,29,30,31,33,34,35,48,94,94,94,92,32,31,31,28,27...
 * 两道山峰 ⇒ 峰值比 94/17 = 5.5 倍，远超噪声。
 *
 * ⚠️ 因此本项**只在"材质开"那张上量**，并与同一个探针里"材质关"那张的
 * 峰值比（`sharpnessRatio`）。单独一个绝对值没有意义 —— 它取决于
 * 条纹相位与卡片位置。
 */
async function sharpnessAt(page, rect) {
  const b64 = (await page.screenshot({ clip: rect })).toString('base64')
  return page.evaluate(async (b) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b)).blob())
    const g = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')
    g.drawImage(bmp, 0, 0)
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data
    const sig = (x, y) => {
      const i = (y * bmp.width + x) * 4
      return d[i + 2] - d[i]
    }
    /*
     * 取"全图案 90 分位"作为线的信号上限：条纹跳变是少数几列、且幅度极端，
     * 用分位数能把它们甩掉；剩下的大多数像素就是背景与线本身。
     */
    const all = []
    for (let y = 0; y < bmp.height; y++) for (let x = 0; x < bmp.width; x++) all.push(sig(x, y))
    all.sort((a, b) => a - b)
    const q = (p) => all[Math.min(all.length - 1, Math.max(0, Math.floor(all.length * p)))]
    // 线心附近的峰值：取 97.5 分位（线只占纵向几个像素，比例很小）
    const peak = q(0.975)
    return { peak: +peak.toFixed(1), p50: +q(0.5).toFixed(1), p99: +q(0.99).toFixed(1) }
  }, b64)
}

const setPlateOff = (page) =>
  page.evaluate((sel) => {
    const p = document.querySelector(sel)
    p.dataset.probeBackup = p.style.cssText
    p.style.setProperty('backdrop-filter', 'none', 'important')
    p.style.setProperty('-webkit-backdrop-filter', 'none', 'important')
    p.style.setProperty('background', 'transparent', 'important')
  }, PLATE)

const setPlateOn = (page) =>
  page.evaluate((sel) => {
    const p = document.querySelector(sel)
    p.style.cssText = p.dataset.probeBackup || ''
    p.removeAttribute('data-probeBackup')
  }, PLATE)

const hideChrome = (page, on) =>
  page.evaluate((use) => {
    document.getElementById('probeHideChrome')?.remove()
    if (!use) return
    const st = document.createElement('style')
    st.id = 'probeHideChrome'
    st.textContent =
      '.nav{visibility:hidden!important}.gs-layer--dock .gs-content{visibility:hidden!important}'
    document.head.appendChild(st)
  }, on)

/**
 * 把「被测区域」滚到 dock 正后方，并返回**两者的重叠矩形**。
 *
 * ⭐ 这是本探针的关键几何步骤（R3-F 第一版就在这上面出过错）：
 * 保留率只在**材质板身后**才有意义。第一版天真地把目标"滚到 dock 中心"，
 * 结果 `want` 是负数（目标在 dock **上方**，只能靠向上滚才压上去，而
 * scrollTop ≥ 0）⇒ 两者从不重叠，量出来开/关两张**逐位相同**（保留率 1.0），
 * 看着像"材质完全死了"，其实是**采样盒根本没落在材质板后面**。
 *
 * 第二版改成：**先按当前视口算重叠，把采样盒取在重叠区**（而不是硬把目标
 * 搬到 dock 中心）。在本项目里这自动落到短屏（375×667）上 —— 那里趋势卡
 * 天然有一段压在 dock 后面；高屏上若不重叠则**明确报错**，不产生假读数。
 */
async function parkTargetUnderDock(page, sel) {
  return page.evaluate(
    ([targetSel, plateSel]) => {
      const t = document.querySelector(targetSel)
      const p = document.querySelector(plateSel)
      if (!t || !p) return null
      const scroller = document.querySelector('.page') || document.scrollingElement
      // 先把目标尽量往 dock 那边挪（能挪多少算多少）
      const tb0 = t.getBoundingClientRect()
      const pb0 = p.getBoundingClientRect()
      const want = tb0.y + tb0.height / 2 - (pb0.y + pb0.height / 2)
      const max = scroller.scrollHeight - scroller.clientHeight
      scroller.scrollTop = Math.max(0, Math.min(max, scroller.scrollTop + want))

      const tb = t.getBoundingClientRect()
      const pb = p.getBoundingClientRect()
      const ovTop = Math.max(tb.top, pb.top)
      const ovBottom = Math.min(tb.bottom, pb.bottom)
      return {
        target: { x: Math.round(tb.x), y: Math.round(tb.y), w: Math.round(tb.width), h: Math.round(tb.height) },
        plate: { x: Math.round(pb.x), y: Math.round(pb.y), w: Math.round(pb.width), h: Math.round(pb.height) },
        overlap: {
          x: Math.round(Math.max(tb.x, pb.x)),
          y: Math.round(ovTop),
          width: Math.round(Math.min(tb.right, pb.right) - Math.max(tb.left, pb.left)),
          height: Math.round(Math.max(0, ovBottom - ovTop))
        }
      }
    },
    [sel, PLATE]
  )
}

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
    // 页面容器自带不透明底会盖住条纹；只在探针里临时让开
    st.textContent =
      '.app{background:transparent!important}.page{background:transparent!important}.money-widget{background:transparent!important}'
    document.head.appendChild(st)
  }, on)

async function measure(page, { sel, tag, allowScroll }) {
  await setStripes(page, false)
  await hideChrome(page, true)
  await setStripes(page, true)
  await page.waitForTimeout(420)

  let geo = null
  if (allowScroll) geo = await parkTargetUnderDock(page, sel)
  else {
    geo = await page.evaluate((s) => {
      const b = document.querySelector(s).getBoundingClientRect()
      return {
        target: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
        plate: null,
        overlap: null
      }
    }, sel)
  }
  await page.waitForTimeout(260)

  /*
   * ⭐ 采样盒取**目标与材质板的交集**，不是目标的整体。
   * 只有交集里的像素才真正"透过玻璃"；取整体会掺进大量没被覆盖的像素，
   * 把保留率稀释成假读数（这正是第一版的第二个错误）。
   */
  const ov = geo.overlap
  if (!ov || ov.height < 8 || ov.width < 8) {
    await setStripes(page, false)
    await hideChrome(page, false)
    return {
      tag,
      geo,
      sample: null,
      onStd: null,
      offStd: null,
      ratio: null,
      note: `无有效重叠（overlap ${ov ? `${ov.width}×${ov.height}` : 'null'}）—— 该视口下目标没落在 dock 后面，拒绝出数`
    }
  }
  const sample = insetClip(ov, 3, 3)

  const onStd = await stdOf(page, sample)
  const sharpOn = await sharpnessAt(page, sample)
  const onShot = `${outDir}/${tag}-on.png`
  await page.screenshot({ path: onShot })

  await setPlateOff(page)
  await page.waitForTimeout(360)
  const offStd = await stdOf(page, sample)
  const sharpOff = await sharpnessAt(page, sample)
  await page.screenshot({ path: `${outDir}/${tag}-off.png` })

  await setPlateOn(page)
  await setStripes(page, false)
  await hideChrome(page, false)
  await page.waitForTimeout(280)

  return {
    tag,
    geo,
    sample,
    onStd,
    offStd,
    ratio: offStd ? +(onStd / offStd).toFixed(3) : null,
    sharpOn,
    sharpOff,
    // 材质开/关两张上"线的信号峰值"之比。糊过则远小于 1。
    sharpRatio: sharpOff && sharpOff.peak > 0 ? +(sharpOn.peak / sharpOff.peak).toFixed(3) : null
  }
}

/* ------------------------------------------------------------------ 主流程 */
for (const engine of ['fallback', 'chromium']) {
  const { context, page, errors, hasTrend } = await openPage(engine)
  if (!hasTrend) {
    console.error(`[${engine}] 趋势图未渲染 —— 种子/开关链路有问题，拒绝出数`)
    await context.close()
    process.exit(3)
  }

  /*
   * 组 A：趋势图卡片压在 dock 正后方 —— 这是用户的报告对象。
   * 组 B：对照，同一张卡片的**标题/副标题区**（不带荧光折线）压在 dock 后面。
   *   两组共用同一张卡、同一段几何 ⇒ 唯一变量就是"荧光折线"这一层。
   *   若 A 不达标而 B 达标 ⇒ 复现，且根因锁定在荧光折线本身。
   */
  const a = await measure(page, { sel: '.money-trend-tc, .money-trend', tag: `${engine}-trend`, allowScroll: true })
  const b = await measure(page, { sel: '.money-widget-head', tag: `${engine}-control`, allowScroll: true })

  results.push({ engine, group: 'trend', ...a, errors })
  results.push({ engine, group: 'control', ...b, errors })
  await context.close()
}

await browser.close()

/* ------------------------------------------------------------------ 报告 */
const lines = ['# 趋势图荧光条在玻璃 dock 下的保留率（R3-F）', '']
lines.push('视口 375×667（短屏；只有这一档趋势卡才落在 dock 后面）。')
lines.push('保留率 = std(材质开)/std(材质关)，采样盒取「目标 ∩ 材质板」。≤0.2 判活。')
lines.push('线的信号 = (B − R) 的 97.5 分位（条纹是中性色，对这个差值零贡献）。')
lines.push('sharpRatio = 峰值(开)/峰值(关)：线被糊过则显著小于 1（实测糊 0.23 / 未糊 1.00）。')
lines.push('')
lines.push('| 档位 | 组 | 重叠区 | std(开) | std(关) | 保留率 | 峰值(开) | 峰值(关) | sharpRatio | 判 |')
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
let failed = 0
for (const r of results) {
  if (!r.ratio) {
    lines.push(`| ${r.engine} | ${r.group} | — | — | — | — | — | — | — | ⚠️ ${r.note} |`)
    if (r.group === 'trend') failed++
    continue
  }
  const alive = r.ratio <= ALIVE_MAX
  /*
   * 两条判据都要过（趋势图组）：
   *   · 保留率 ≤ ALIVE_MAX —— 材质确实在输出；
   *   · sharpRatio ≤ SHARP_MAX —— 输出的是"糊过的"那份，而不是底层未糊的内容透过来。
   * 只保留率一条会漏掉缺陷三那种"板画在 50% 保底底之下"的结构错误：
   * 那时保留率读数 0.218（看着接近活），但线的峰值与关掉材质时一模一样。
   */
  const sr = r.sharpRatio
  const sharp = sr == null ? true : sr <= SHARP_MAX
  const ok = alive && sharp
  if (r.group === 'trend' && !ok) failed++
  const verdict = ok ? '活' : `❌ ${!alive ? '未糊' : '锐度未过'}` +
    (r.group === 'trend' ? '' : '（对照，不计入失败）')
  lines.push(
    `| ${r.engine} | ${r.group} | ${r.sample.width}×${r.sample.height} @ (${r.sample.x},${r.sample.y}) | ${r.onStd} | ${r.offStd} | ${r.ratio} | ${r.sharpOn?.peak ?? '—'} | ${r.sharpOff?.peak ?? '—'} | ${sr ?? '—'} | ${verdict} |`
  )
}
const txt = lines.join('\n') + '\n'
console.log(txt)
const { writeFileSync } = await import('node:fs')
writeFileSync(`${outDir}/report.md`, txt)

if (failed > 0) {
  console.error(
    `\n❌ 趋势图组有 ${failed} 个档位未通过（保留率 > ${ALIVE_MAX} 或 sharpRatio > ${SHARP_MAX}）`
  )
  process.exit(1)
}
console.log('\n✅ 趋势图组全部通过')
