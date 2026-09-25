#!/usr/bin/env node
/**
 * 真实屏幕材质取证（第 1 步 / 共 2 步）。
 *
 * ── 为什么需要它
 *
 * CDP `Page.captureScreenshot`（也就是 `page.screenshot()`）**不忠实地渲染 backdrop-filter**。
 * 同一时刻、同一页面，一个普通 div 挂 `backdrop-filter: blur(18px)`：
 *   真实屏幕  身后条纹 std 3.2（糊平，效果真实存在）
 *   CDP 截图  身后条纹 std 38.0（只糊了一点）
 * 于是本项目基于 CDP 截图的"材质 Δ"读数全部只量到了**染色**，磨砂整整一年是死的也测不出来。
 * 结论：凡是判断"磨砂/背景模糊到底有没有画出来"，**只能用系统级抓图**。
 *
 * ── 做法
 *
 * 有头浏览器打开真实弹窗 → 往 `.modal-mask` 里塞一层高频条纹（它在材质板身后，
 * 且与材质板同处一个 backdrop root）→ 页角放纯红/纯绿标记供定位视口 → 按 state 文件
 * 逐个状态停留，由 `glass-material-screen.py` 抓屏并量条纹清晰度。
 * 三个状态互为对照，证明因果而不只是相关：
 *   ON       当前代码（.gs-layer 应为 absolute）→ 条纹应被抹平
 *   OFF      就地改回 position:fixed            → 条纹应锐利
 *   ON-again 再切回当前代码                      → 条纹应再被抹平
 *
 * ── 用法（两步，缺一不可；Node 侧不能再 spawn 进程，沙箱会 EBUSY）
 *
 *   终端 A：node scripts/glass-material-screen.mjs --out tmp/glassScreen
 *   终端 B：python scripts/glass-material-screen.py tmp/glassScreen
 * （Python 轮询 state.txt 抓图，所以 B 可以紧接着 A 启动，或由 shell 串起来。）
 *
 * 依赖：开发服务器 `./node_modules/.bin/vite --config vite.web.config.ts --port 5199 --host 127.0.0.1 --strictPort`
 * 抓图时需要窗口在最前 —— Python 侧会用 Win32 SetWindowPos 把标题匹配的窗口置顶。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const ARG = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d
}
const executablePath = [
  process.env.UI_PROBE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
]
  .filter(Boolean)
  .find((p) => existsSync(p))
const outDir = ARG('out', 'tmp/glassScreen')
mkdirSync(outDir, { recursive: true })
const HOLD = Number(ARG('hold', 6))
const VW = Number(ARG('w', 1280))
const VH = Number(ARG('h', 820))
const TITLE = 'PROBE-GLASS-SCREEN'

const iso = (i) => new Date(Date.now() - i * 3600_000).toISOString()
const mondayKey = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/* 日期必须按"本周"动态算：日视图默认打开今天那一列，写死某天会量到空画布 */
const seed = {
  version: 2,
  goals: [],
  events: Array.from({ length: 7 }, (_, i) => ({
    id: `q${i}`,
    text: `象限任务 ${i + 1}`,
    remark: '',
    quadrant: (i % 4) + 1,
    x: 40 + (i % 3) * 170,
    y: 40 + Math.floor(i / 3) * 110,
    width: 150,
    createdAt: iso(i)
  })),
  weekPresets: [],
  weekEvents: [
    {
      id: 'w0',
      title: '高等数学',
      quadrant: 1,
      date: mondayKey(),
      startMin: 540,
      endMin: 630,
      color: '#4da3ff',
      remark: '',
      showInQuadrant: false,
      createdAt: iso(0)
    }
  ],
  weekCounterOffset: 0
}

const browser = await chromium.launch({
  executablePath,
  headless: false,
  args: ['--window-position=40,40', `--window-size=${VW + 60},${VH + 120}`]
})
const context = await browser.newContext({
  viewport: { width: VW, height: VH },
  deviceScaleFactor: 1,
  colorScheme: 'dark'
})
const page = await context.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [
  'quadrant-web-data-v2',
  JSON.stringify(seed)
])
await page.goto('http://127.0.0.1:5199/probe.html?page=quadrant&sidebar=1&strict=0', {
  waitUntil: 'load'
})
await page.waitForSelector('.event-card', { state: 'attached', timeout: 20000 })
await page.waitForTimeout(700)

/* 右键事件卡 → 删除：打开"删除确认"弹窗（比 ‹详情› 矮，采样区不容易压到正文） */
await page.evaluate(() => {
  const card = document.querySelector('.event-card')
  const r = card.getBoundingClientRect()
  card.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: Math.min(Math.max(r.left + 20, 40), window.innerWidth - 200),
      clientY: Math.min(Math.max(r.top + 20, 40), window.innerHeight - 380)
    })
  )
})
await page.waitForSelector('.gs-layer--menu .context-item', { timeout: 8000 })
await page.waitForTimeout(340)
await page.locator('.gs-layer--menu .context-item', { hasText: '删除' }).first().evaluate((el) => el.click())
await page.waitForSelector('.gs-layer--dialog .gs-plate', { timeout: 8000 })
await page.waitForTimeout(1300)

const geo = await page.evaluate((t) => {
  document.title = t
  const mask = document.querySelector('.modal-mask')
  const plate = mask.querySelector('.gs-plate')
  const r = plate.getBoundingClientRect()

  /*
   * 条纹要塞进 `.modal-mask` 内部、且是它的首个子节点：
   *   · 塞进更外层（如 body / 页面根）会落在材质板 backdrop root 之外 —— 看得见，但不参与模糊；
   *   · 塞成末子节点会盖在材质板之上 —— 量到的是条纹本身。
   */
  const st = document.createElement('div')
  st.id = 'probeStripes'
  st.style.cssText =
    'position:absolute;inset:0;z-index:0;pointer-events:none;' +
    'background:repeating-linear-gradient(90deg,#f4f6fa 0 5px,#07080a 5px 10px)'
  mask.insertBefore(st, mask.firstChild)

  const mk = (side, color) => {
    const d = document.createElement('div')
    d.style.cssText =
      `position:fixed;${side}:0;top:0;width:24px;height:24px;background:${color};` +
      'z-index:2147483647;pointer-events:none'
    document.body.appendChild(d)
  }
  mk('left', '#ff0000')
  mk('right', '#00ff00')

  const layer = plate.closest('.gs-layer')
  const se = document.scrollingElement
  return {
    plate: { x: r.x, y: r.y, w: r.width, h: r.height },
    // 采样取材质板右侧 40%（避开左对齐的标题），纵向 10%~35%
    sample: { x: r.x + r.width * 0.55, y: r.y + r.height * 0.1, w: r.width * 0.4, h: r.height * 0.25 },
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    title: document.title,
    layerPosition: getComputedStyle(layer).position,
    layerZIndex: getComputedStyle(layer).zIndex,
    scroll: { overflow: se.scrollHeight - se.clientHeight, scrollTop: se.scrollTop }
  }
}, TITLE)
writeFileSync(`${outDir}/geo.json`, JSON.stringify(geo, null, 2))
console.log(`材质板 ${geo.plate.x.toFixed(0)},${geo.plate.y.toFixed(0)} ${geo.plate.w.toFixed(0)}x${geo.plate.h.toFixed(0)}`)
console.log(`.gs-layer position=${geo.layerPosition} z-index=${geo.layerZIndex}`)
console.log(`文档滚动溢出=${geo.scroll.overflow}（absolute 要求为 0）`)

const STATES = [
  { label: 'ON', css: '' },
  { label: 'OFF-fixed', css: 'position:fixed' },
  { label: 'ON-again', css: '' }
]
for (const s of STATES) {
  const read = await page.evaluate((css) => {
    const layer = document.querySelector('.gs-layer--dialog .gs-plate').closest('.gs-layer')
    layer.style.cssText = css
    const p = document.querySelector('.gs-layer--dialog .gs-plate')
    const r = p.getBoundingClientRect()
    return {
      pos: getComputedStyle(layer).position,
      rect: `${r.x.toFixed(1)},${r.y.toFixed(1)} ${r.width.toFixed(1)}x${r.height.toFixed(1)}`
    }
  }, s.css)
  await page.bringToFront()
  writeFileSync(`${outDir}/state.txt`, s.label)
  console.log(`${s.label.padEnd(10)} pos=${read.pos}  板=${read.rect}`)
  await page.waitForTimeout(HOLD * 1000)
}
writeFileSync(`${outDir}/state.txt`, 'DONE')
if (errs.length) console.log('页面错误:', errs.slice(0, 5))
await context.close()
await browser.close()
console.log(`产物 → ${outDir}/  （接着跑 python scripts/glass-material-screen.py ${outDir}）`)
