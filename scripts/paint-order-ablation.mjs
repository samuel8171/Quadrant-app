/*
 * 绘制顺序单变量消融（R3-F 缺陷三的取证脚本）。
 *
 * 问题：`我的` 页「时币趋势」的荧光条压在手机 dock 上时**完全没有被糊**。
 * 假说：`.gs-layer--dock`（材质板所在层）在 `.app` 里排在 `<Sidebar>` 之前，
 * 两者都是 `z:auto` ⇒ **板画在 `.sidebar`（fixed + z100）之下**；
 * `.sidebar` 那层 50% 不透明的 `--gs-dock-floor` 于是盖住板糊出来的那份，
 * 眼睛看到的是底之下透上来的**未糊**页面内容。
 *
 * 本脚本把"改绘制顺序"作为唯一变量，量同一根荧光线的锐度：
 *   A base              —— 现状（板在 `.sidebar` 之下）
 *   B plate 抬到 300     —— 板 `.sidebar` 之上（会盖住导航文字，只看读数）
 *   C `.sidebar` 降 auto —— 让 `.sidebar` 与板同一步，按树序（材质层在前）⇒ 板在上
 *   D `.sidebar` 完全透明 —— 对照：去掉那层 50% 底，但**板仍在下面**
 *
 * 判读：FWHM（半高全宽，设备像素）。不糊时应 ≈ `stroke-width × DPR` = 4。
 *
 * ⚠️ **修复前后 A 的读数会反过来，别把"修复后的 A"当成失败**：
 *
 *   | 组 | 修复前 | 修复后 | 说明 |
 *   | --- | --- | --- | --- |
 *   | A base | **4（未糊）** | 130（糊了） | 现状 |
 *   | B 板抬到最上 | 130 | 130 | 与 A 同 —— 修好后 A 本来就该糊 |
 *   | C `.sidebar` auto | 11 | 124 | 同上 |
 *   | D `.sidebar` 透明 | **4（未糊）** | 133 | 同上 |
 *
 * 修复**前**的关键读数是 **A = 4 而 D 也 = 4**：把保底底拿掉，板依然没输出到
 * 这条线上 ⇒ 排除"只是被 50% 底盖住的错觉"，板画的整块确实在 `.sidebar` 之下。
 * 没有 D 这一组就无法区分"被盖住"与"根本没画到"。
 * 修复**后**四组都糊了，本脚本就退化成一个回归检查（A 必须 > 8）。
 *
 * 跑：node scripts/paint-order-ablation.mjs
 * 前置：Vite dev server 起在 5199（`/probe.html` 可访问）。
 */
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'

const CAND = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
]
const executablePath = CAND.find((p) => existsSync(p))
const PORT = Number(process.env.PORT || 5199)

const browser = await chromium.launch({ executablePath, headless: true })
/*
 * 视口 375×667（短屏）：**只有短屏**趋势卡在 `scrollTop = 0` 时才天然有一段
 * 压在 dock 后面。390×844 下它整块在 dock 上方，两者 overlap = 0 ⇒ 量不出东西。
 */
const ctx = await browser.newContext({
  viewport: { width: 375, height: 667 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  hasTouch: true,
  isMobile: true
})
const page = await ctx.newPage()

const iso = (i) => new Date(Date.now() - i * 3600000).toISOString()
const p2 = (n) => String(n).padStart(2, '0')
const dayKey = (i) => {
  const d = new Date(Date.now() - i * 86400000)
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

/*
 * 种子必须**逐字段**满足 `platformApi.validAppData`，否则整份静默作废
 * （表现：一个事件都没有、趋势图不渲染）。字段形状照 `src/shared/types.ts` 抄。
 */
const MONEY = {
  enabled: true,
  enabledAt: dayKey(8),
  config: {
    weeklyTC: 560, dailyCapTC: 80, tcPerHour: 10,
    nightStartMin: 1410, nightEndMin: 360, nightMultiplier: 1.5,
    minCapRatio: 0.2, weeklyLT: 20, rewardLT: 0.5, penaltyLT: 0.5,
    missPenaltyLT: 1, videoLTPerHour: 1, gameLTPerHour: 1.5,
    restDayFactor: 0.8, abandonedDayTC: 80, latePhoneTC: 40, latePhoneLT: 2,
    quadrantMultiplier: { q1: 1.5, q2: 1.0, q3: 1.2, q4: 0.5 }
  },
  days: [],
  weeks: []
}
const COLORS = ['#8AB4F8', '#8CD9C1', '#F8B18C', '#B4A7E6', '#E8A0A0']
const weekEvents = []
for (let d = 0; d < 7; d++) {
  for (let k = 0; k < 3 + (d % 3); k++) {
    weekEvents.push({
      id: `w${d}-${k}`, date: dayKey(d), title: `t${d}-${k}`,
      color: COLORS[(d + k) % 5], quadrant: ((d + k) % 4) + 1,
      startMin: 540 + k * 60, endMin: 600 + k * 60 + (d % 2 ? 30 : 0),
      remark: '', showInQuadrant: true, createdAt: iso(d * 3 + k)
    })
  }
}
const goals = ['a', 'b'].map((t, i) => ({
  id: `g${i}`, title: t, type: 'long', done: false, remark: 'r',
  groupTitles: ['x'],
  subtasks: [{ id: `g${i}s0`, title: 's', done: false, group: 0, remark: '', order: 0 }],
  order: i, createdAt: iso(i)
}))
const seed = {
  version: 2, goals, events: [], weekPresets: [], weekEvents,
  weekCounterOffset: 0, money: MONEY
}

await page.addInitScript(
  ([k, v, dk, dv]) => {
    if (sessionStorage.getItem('p') === '1') return
    sessionStorage.setItem('p', '1')
    localStorage.setItem(k, v)
    localStorage.setItem(dk, dv)
  },
  [
    'quadrant-web-data-v2', JSON.stringify(seed),
    'quadrant-glass-v1', JSON.stringify({ forceEngine: 'fallback' })
  ]
)
await page.goto(`http://127.0.0.1:${PORT}/probe.html?page=mine&sidebar=1&strict=0`, {
  waitUntil: 'load'
})
await page.waitForSelector('.money-trend', { timeout: 20000 })
await page.waitForTimeout(900)

/*
 * 沿画面正中那一**列**扫一遍，取「蓝 − 红」信号的峰值与半高全宽。
 * 中线穿过折线中段，那里只有单段斜线（圆点与交叠段都在别的 x 上）。
 */
const sampleCol = async () => {
  const b64 = (await page.screenshot()).toString('base64')
  return page.evaluate(async (b) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b)).blob())
    const g = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')
    g.drawImage(bmp, 0, 0)
    const x = Math.round(bmp.width / 2)
    const col = g.getImageData(x, 0, 1, bmp.height).data
    const sig = []
    let best = -1e9
    let bestY = 0
    for (let y = 0; y < bmp.height; y++) {
      const i = y * 4
      const v = col[i + 2] - col[i]
      sig.push(v)
      if (v > best) {
        best = v
        bestY = y
      }
    }
    const half = best / 2
    let up = bestY
    let dn = bestY
    while (up > 0 && sig[up] > half) up--
    while (dn < bmp.height - 1 && sig[dn] > half) dn++
    return { peakBlue: +best.toFixed(1), y: bestY, fwhm: dn - up }
  }, b64)
}

const out = {}
out.A_base = await sampleCol()

// B：材质板抬到 `.sidebar` 之上
await page.evaluate(() => {
  const l = document.querySelector('.gs-layer--dock')
  l.dataset.bk = l.style.cssText
  l.style.setProperty('z-index', '300', 'important')
})
await page.waitForTimeout(400)
out.B_plateOnTop = await sampleCol()
await page.evaluate(() => {
  const l = document.querySelector('.gs-layer--dock')
  l.style.cssText = l.dataset.bk
})
await page.waitForTimeout(300)

// C：`.sidebar` 降 z:auto（与板同一步，板树序在前 ⇒ 板在上）
await page.evaluate(() => {
  const s = document.querySelector('.sidebar')
  s.dataset.bk = s.style.cssText
  s.style.setProperty('z-index', 'auto', 'important')
})
await page.waitForTimeout(400)
out.C_sidebarAuto = await sampleCol()
await page.evaluate(() => {
  const s = document.querySelector('.sidebar')
  s.style.cssText = s.dataset.bk
})
await page.waitForTimeout(300)

// D：`.sidebar` 底透明（板仍在下面 —— 用来排除"只是被底盖住"）
await page.evaluate(() => {
  const s = document.querySelector('.sidebar')
  s.dataset.bk = s.style.cssText
  s.style.setProperty('background', 'transparent', 'important')
})
await page.waitForTimeout(400)
out.D_noFloor = await sampleCol()
await page.evaluate(() => {
  const s = document.querySelector('.sidebar')
  s.style.cssText = s.dataset.bk
})

console.log(JSON.stringify(out, null, 1))

/*
 * 判读（不写死期望值，只把结论印出来）：
 *   不糊时 FWHM ≈ 4（stroke-width 2 × DPR 2）。
 */
const SHARP = 8
const verdict = (k) => (out[k].fwhm > SHARP ? '糊了' : '未糊')
console.log(`\nA base          ${verdict('A_base')}（FWHM ${out.A_base.fwhm}）`)
console.log(`B 板抬到最上    ${verdict('B_plateOnTop')}（FWHM ${out.B_plateOnTop.fwhm}）`)
console.log(`C .sidebar auto ${verdict('C_sidebarAuto')}（FWHM ${out.C_sidebarAuto.fwhm}）`)
console.log(`D .sidebar 透明 ${verdict('D_noFloor')}（FWHM ${out.D_noFloor.fwhm}）`)
console.log(
  '\n判读：B/C 糊了 ⇒ 绘制顺序就是根因；' +
    'D 若仍未糊 ⇒ 排除"只是被 50% 底盖住的错觉"。'
)

await browser.close()
