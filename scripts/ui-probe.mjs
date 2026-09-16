#!/usr/bin/env node
/**
 * 真实浏览器交互探针（开发期工具）。
 *
 * 用途：在真实 Chromium 中驱动真实页面组件，打印**完整指针/鼠标事件序列**与
 * DOM 事实，用于定位"只在真实事件时序下暴露"的问题——例如浏览器在 `pointerup`
 * 之后补发的兼容性 `mousedown` 抢走刚打开输入框的焦点（输入框闪现即消失）。
 *
 * 前置：另开一个终端运行网页端开发服务器
 *   ./node_modules/.bin/vite --config vite.web.config.ts --port 5199 --host 127.0.0.1 --strictPort
 *
 * 用法示例：
 *   node scripts/ui-probe.mjs --mode touch  --action dbl-tap --page quadrant
 *   node scripts/ui-probe.mjs --mode mouse  --action dbl-tap --page quadrant
 *   node scripts/ui-probe.mjs --mode touch  --action long-press --at 0.5,0.5
 *   node scripts/ui-probe.mjs --mode touch  --action drag --from 0.3,0.3 --to 0.6,0.6
 *
 * 参数：
 *   --mode   mouse | touch           指针类型（touch 走真实触摸事件与其补发序列）
 *   --action none | tap | dbl-tap | long-press | drag
 *   --page   quadrant | weekly | goals | review
 *   --target CSS 选择器             动作落点参照元素，默认取页面首个 .quadrant-page/.page
 *   --at     x,y                    相对 --target 的分数坐标，默认 0.72,0.30
 *   --from/--to x,y                 drag 的起止分数坐标
 *   --hold   ms                     长按按住时长，默认 1200
 *   --strict 0                      关闭 React.StrictMode（默认为开启，与线上一致）
 *   --sidebar 1                     同时渲染侧边栏（默认不渲染）
 *   --url    覆盖探测页地址，默认 http://127.0.0.1:5199/probe.html
 *   --out    截图输出路径
 */
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { chromium } from 'playwright-core'

const ARG = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)

const BROWSER_CANDIDATES = [
  process.env.UI_PROBE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome'
].filter(Boolean)

const mode = ARG('mode', 'touch')
const action = ARG('action', 'dbl-tap')
const pageName = ARG('page', 'quadrant')
const targetSel = ARG('target', '.quadrant-viewport')
const at = ARG('at', '0.72,0.30').split(',').map(Number)
const from = ARG('from', '0.3,0.3').split(',').map(Number)
const to = ARG('to', '0.6,0.6').split(',').map(Number)
const hold = Number(ARG('hold', '1200'))
const port = ARG('port', '5199')
const base = ARG('url', `http://127.0.0.1:${port}/probe.html`)
const out = ARG('out', '')

const query = new URLSearchParams({ page: pageName })
if (ARG('strict', '1') === '0') query.set('strict', '0')
if (flag('sidebar')) query.set('sidebar', '1')

/** 采集：捕获阶段记录全部指针/鼠标/焦点事件，并记录输入框挂载与卸载。 */
const INSTRUMENT = `
window.__log = [];
window.__t0 = performance.now();
function desc(el) {
  if (!el) return 'null';
  if (el === document) return '#document';
  if (el.nodeType !== 1) return el.nodeName;
  let s = el.tagName.toLowerCase();
  if (el.id) s += '#' + el.id;
  const cn = el.className;
  if (typeof cn === 'string' && cn.trim()) s += '.' + cn.trim().split(/\\s+/).join('.');
  return s;
}
window.__desc = desc;
const TYPES = ['pointerdown','pointerup','pointercancel','touchstart','touchend','mousedown','mouseup','click','dblclick','focusin','focusout','keydown'];
for (const type of TYPES) {
  document.addEventListener(type, (e) => {
    window.__log.push({
      t: Math.round(performance.now() - window.__t0),
      ev: type,
      target: desc(e.target),
      active: desc(document.activeElement),
      pt: e.pointerType || '',
      prevented: e.defaultPrevented
    });
  }, true);
}
const watched = ['event-input', 'event-card', 'context-menu', 'day-event'];
const mo = new MutationObserver((records) => {
  for (const r of records) {
    for (const [list, verb] of [[r.addedNodes, 'MOUNT'], [r.removedNodes, 'UNMOUNT']]) {
      for (const n of list) {
        if (n.nodeType !== 1 || !n.classList) continue;
        for (const cls of watched) {
          if (n.classList.contains(cls)) {
            window.__log.push({ t: Math.round(performance.now() - window.__t0), ev: cls + '_' + verb, active: desc(document.activeElement) });
          }
        }
      }
    }
  }
});
function attach() {
  if (document.documentElement) mo.observe(document.documentElement, { childList: true, subtree: true });
  else setTimeout(attach, 1);
}
attach();
window.__mark = () => { window.__markT = Math.round(performance.now() - window.__t0); };
`

const executablePath = BROWSER_CANDIDATES.find((p) => existsSync(p))
if (!executablePath) {
  console.error(`未找到可用浏览器，请设置 UI_PROBE_BROWSER 环境变量。已尝试：\n${BROWSER_CANDIDATES.join('\n')}`)
  process.exit(2)
}

const touchContext = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true
}

const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext(
  mode === 'touch' ? touchContext : { viewport: { width: 1280, height: 800 } }
)
const page = await context.newPage()
await page.addInitScript(INSTRUMENT)

const noise = []
page.on('console', (m) => noise.push(`${m.type()}: ${m.text()}`))
page.on('pageerror', (e) => noise.push(`pageerror: ${e.message}`))

await page.goto(`${base}?${query.toString()}`, { waitUntil: 'load' })
await page.waitForSelector(targetSel, { timeout: 20000 })
await page.waitForTimeout(500)

const box = await page.locator(targetSel).first().boundingBox()
if (!box) {
  console.error(`目标元素 ${targetSel} 没有可见尺寸`)
  await browser.close()
  process.exit(1)
}
const point = (f) => [Math.round(box.x + box.width * f[0]), Math.round(box.y + box.height * f[1])]

console.log(
  `\n===== page=${pageName} mode=${mode} action=${action} target=${targetSel} ` +
    `size=${Math.round(box.width)}x${Math.round(box.height)} strict=${ARG('strict', '1')} =====`
)

const cdp = mode === 'touch' ? await context.newCDPSession(page) : null
const touchStart = (x, y) =>
  cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
const touchMove = (x, y) =>
  cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
const touchEnd = () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })

const [cx, cy] = point(at)
const [fx, fy] = point(from)
const [tx, ty] = point(to)

await page.evaluate(() => window.__mark())

switch (action) {
  case 'none':
    break
  case 'tap':
    if (mode === 'touch') await page.touchscreen.tap(cx, cy)
    else await page.mouse.click(cx, cy)
    break
  case 'dbl-tap':
    if (mode === 'touch') {
      await page.touchscreen.tap(cx, cy)
      await page.touchscreen.tap(cx, cy)
    } else {
      // 两次独立的 mouse.click 其 clickCount 各为 1，浏览器不会合成 dblclick。
      await page.mouse.dblclick(cx, cy)
    }
    break
  case 'long-press':
    if (mode === 'touch') {
      await touchStart(cx, cy)
      await page.waitForTimeout(hold)
      await touchEnd()
    } else {
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.waitForTimeout(hold)
      await page.mouse.up()
    }
    break
  case 'drag':
    if (mode === 'touch') {
      await touchStart(fx, fy)
      for (let i = 1; i <= 8; i++) {
        await touchMove(fx + ((tx - fx) * i) / 8, fy + ((ty - fy) * i) / 8)
        await page.waitForTimeout(16)
      }
      await touchEnd()
    } else {
      await page.mouse.move(fx, fy)
      await page.mouse.down()
      for (let i = 1; i <= 8; i++) {
        await page.mouse.move(fx + ((tx - fx) * i) / 8, fy + ((ty - fy) * i) / 8)
      }
      await page.mouse.up()
    }
    break
  default:
    console.error(`未知 action: ${action}`)
}

await page.waitForTimeout(600)

const facts = await page.evaluate(() => ({
  input: document.querySelectorAll('.event-input').length,
  cards: document.querySelectorAll('.event-card').length,
  menu: document.querySelectorAll('.context-menu').length,
  dayEvents: document.querySelectorAll('.day-event').length,
  active: window.__desc(document.activeElement)
}))
console.log(
  `结果：输入框=${facts.input} 事件卡=${facts.cards} 右键菜单=${facts.menu} ` +
    `日视图事件块=${facts.dayEvents} 焦点=${facts.active}`
)

const { log, markT } = await page.evaluate(() => ({ log: window.__log, markT: window.__markT }))
console.log('--- 事件序列 ---')
for (const entry of log) {
  if (entry.t >= markT - 5) console.log(JSON.stringify(entry))
}

const real = noise.filter((m) => !/vite|DevTools|404/.test(m))
if (real.length) console.log('--- console（已滤除 vite / DevTools / 404 噪声）---\n' + real.join('\n'))

if (out) {
  const dir = dirname(out)
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: out })
  console.log(`截图：${out}`)
}

await browser.close()
