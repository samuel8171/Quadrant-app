#!/usr/bin/env node
/**
 * 材质板 backdrop 采样边界判定（真实屏幕取证）。
 *
 * ⚠️ **只能配系统抓图用**（`scripts/glass-material-screen.py`）。
 * 无头 / 元素级截图 / 屏幕外窗口三种口径在本仓库都实测为"全穿透"，
 * 判断不出"采样有没有被挡住"——见 docs/probes/liquid-glass.md 第六节。
 *
 * ── 要回答的问题
 *
 * 材质板（.gs-plate）到底看得见哪一层？层级内 / 层级外？
 * 做法是放**两条颜色不同的**高频条纹：
 *   in  → 目标浮层内部首位（红）
 *   out → 目标浮层的兄弟位，即页面层（蓝）
 * 只显示其中一条，量材质板区域的 **R−B 通道偏向**：
 *   偏红 ⇒ 材质板看的是层内；偏蓝 ⇒ 采样穿透到了页面。
 * 单色条纹做不到这个区分 —— "糊掉"与"只采到纯色遮罩"在像素上都是均匀的。
 *
 * 另外附带一组 `setBdf` 单变量（现状 / 摘 url / blur 0 / blur 30 / none），
 * 用来确认磨砂本身是否有效；以及一组 `setLayer` 变体，用来测层级属性是否截断。
 *
 * ── 用法（两步，缺一不可；Node 侧不能 spawn 进程，沙箱会 EBUSY）
 *
 *   终端 A：node scripts/glass-backdrop-boundary.mjs --host dialog --out tmp/brBound-dialog
 *   终端 B：python scripts/glass-material-screen.py tmp/brBound-dialog
 * （两侧用 `token.txt` / `ready-<token>.txt` 握手，谁先启动都行。）
 *
 * 依赖开发服务器：
 *   ./node_modules/.bin/vite --config vite.web.config.ts --port 5199 --host 127.0.0.1 --strictPort
 * 抓图时窗口必须可见 —— Python 侧会持续把标题匹配的窗口置顶，
 * 但**遇到别的置顶浮层（腾讯会议 / NVIDIA Overlay）仍会被压住**，此时读数无效（会打印 `[clientrect(可能被遮挡)]`）。
 */

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
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

const HOST = ARG('host', 'dialog')
const outDir = ARG('out', `tmp/brBound-${HOST}`)
mkdirSync(outDir, { recursive: true })
const HOLD = Number(ARG('hold', 6))
const VW = Number(ARG('w', 1280))
const VH = Number(ARG('h', 820))
const TITLE = `PROBE-BRBOUND-${HOST.toUpperCase()}`

const iso = (i) => new Date(Date.now() - i * 3600_000).toISOString()
const mondayKey = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
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
  args: ['--window-position=0,0', `--window-size=${VW + 60},${VH + 150}`]
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

/* ── 打开目标浮层 ───────────────────────────────────────────── */
let SEL /* 目标层的选择器 */
if (HOST === 'dialog') {
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
  SEL = '.gs-layer--dialog'
} else {
  await page.evaluate(() => {
    const card = document.querySelector('.event-card')
    const r = card.getBoundingClientRect()
    card.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: Math.min(Math.max(r.left + 20, 40), window.innerWidth - 260),
        clientY: Math.min(Math.max(r.top + 20, 40), window.innerHeight - 420)
      })
    )
  })
  await page.waitForSelector('.gs-layer--menu .context-item', { timeout: 8000 })
  await page.waitForTimeout(1200)
  SEL = '.gs-layer--menu'
}

/* ── 布置：条纹 + 定位标记 + 采样区 ─────────────────────────── */
const geo = await page.evaluate(
  ([title, sel, host]) => {
    document.title = title
    const root = document.querySelector(sel)
    const plate = root.querySelector('.gs-plate')
    const r = plate.getBoundingClientRect()

    /*
     * 条纹两条，**颜色不同**：
     *   in   目标层内部首位（与材质板同一个 backdrop root）→ 红
     *   out  目标层的兄弟位（页面层，在目标层之外）        → 蓝
     * 只显示其中一条。判据不是"糊不糊"，而是**材质板区域的 R/B 通道偏向**：
     *   · 偏红 ⇒ 材质板采到的是层内（backdrop root 被截在目标层）
     *   · 偏蓝 ⇒ 材质板采到了层外的页面
     * 单色条纹做不到这个区分 —— 糊掉与"采到纯色遮罩"在像素上都是均匀的。
     */
    const stripe = (parent, zIndex, where, color) => {
      const st = document.createElement('div')
      st.id = `probeStripes-${where}`
      st.style.cssText =
        `position:fixed;inset:0;z-index:${zIndex};pointer-events:none;` +
        `background:repeating-linear-gradient(90deg,${color} 0 6px,#000000 6px 12px)`
      parent.insertBefore(st, parent.firstChild)
      st.dataset.where = where
      st.style.display = 'none'
      return st
    }

    stripe(root, '0', 'in', '#ff0000')
    stripe(root.parentElement, host === 'dialog' ? '55' : '45', 'out', '#0000ff')

    /*
     * 定位标记用**青 / 品红**，不能用红/绿：
     * 条纹本身是红(#ff0000)与蓝(#0000ff)，纯红标记会被红条纹顶掉
     * （find_mark 会取到条纹的最左像素而不是标记），绿也不安全。
     */
    const mk = (side, color) => {
      const d = document.createElement('div')
      d.style.cssText =
        `position:fixed;${side}:0;top:0;width:24px;height:24px;background:${color};` +
        'z-index:2147483647;pointer-events:none'
      document.body.appendChild(d)
    }
    mk('left', '#00ffff')
    mk('right', '#ff00ff')

    const layer = plate.closest('.gs-layer')
    return {
      plate: { x: r.x, y: r.y, w: r.width, h: r.height },
      // 采样取右侧 42%、纵向 12%~40%：菜单与弹窗的这一带都是空白（文字左对齐）
      sample: { x: r.x + r.width * 0.54, y: r.y + r.height * 0.12, w: r.width * 0.42, h: r.height * 0.28 },
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      title: document.title,
      layerPosition: getComputedStyle(layer).position,
      layerZIndex: getComputedStyle(layer).zIndex,
      maskBg: host === 'dialog' ? getComputedStyle(root).backgroundColor : null
    }
  },
  [TITLE, SEL, HOST]
)
writeFileSync(`${outDir}/geo.json`, JSON.stringify(geo, null, 2))
console.log(`[${HOST}] 材质板 ${geo.plate.x.toFixed(0)},${geo.plate.y.toFixed(0)} ${geo.plate.w.toFixed(0)}x${geo.plate.h.toFixed(0)}`)
console.log(`[${HOST}] .gs-layer position=${geo.layerPosition} z-index=${geo.layerZIndex}`)
if (geo.maskBg) console.log(`[${HOST}] 遮罩底色=${geo.maskBg}`)

/* 与抓图端握手：等 `ready-<token>.txt` 出现再开始状态循环。
 * token 每次运行唯一 —— 固定文件名会在 Node 侧"启动时清理"与 py 写入之间打架。 */
const TOKEN = String(Date.now())
writeFileSync(`${outDir}/token.txt`, TOKEN)
process.stdout.write('等待抓图端就绪 ')
const t0 = Date.now()
while (!existsSync(`${outDir}/ready-${TOKEN}.txt`) && Date.now() - t0 < 120_000) {
  await sleep(400)
}
console.log(existsSync(`${outDir}/ready-${TOKEN}.txt`) ? 'ok' : '超时（继续）')

/* ── 状态机 ───────────────────────────────────────────────────
 * 辅助函数必须先注入页面（page.evaluate 的函数在页面上下文里跑，
 * 取不到 Node 侧的闭包）。 */
await page.evaluate((host) => {
  const SEL = host === 'dialog' ? '.gs-layer--dialog' : '.gs-layer--menu'
  window.__brb = {
    root: () => document.querySelector(SEL),
    showOnly(where) {
      for (const s of document.querySelectorAll('[id^="probeStripes-"]')) {
        s.style.display = s.dataset.where === where ? 'block' : 'none'
      }
    },
    thaw() {
      const r = document.querySelector(SEL)
      if (!r) return 'NO-ROOT'
      r.style.background = ''
      for (const e of r.querySelectorAll('.gs-plate, .gs-anim')) {
        e.style.animation = ''
        e.style.animationPlayState = ''
        e.style.animationDelay = ''
      }
      return 'ok'
    },
    freezeMid() {
      const r = document.querySelector(SEL)
      if (!r) return 'NO-ROOT'
      for (const e of r.querySelectorAll('.gs-plate, .gs-anim')) {
        e.style.animation = 'none'
        void e.offsetWidth
        e.style.animation = 'pop-in 0.2s cubic-bezier(0.2,0.9,0.3,1.15)'
        e.style.animationPlayState = 'paused'
        e.style.animationDelay = '-0.1s'
      }
      return 'ok'
    },
    noMask() {
      const m = document.querySelector('.modal-mask')
      if (m) m.style.background = 'rgba(0,0,0,0)'
    },
    /* 就地改定位层的定位/层级（内联覆盖类），用来单变量验证"哪一层截断采样" */
    setLayer(css) {
      const sel = document.querySelector(SEL)
      const el = sel.classList.contains('gs-layer') ? sel : document.querySelector(`${SEL} .gs-layer`)
      if (!el) return 'NO-LAYER'
      el.style.cssText = css
      const cs = getComputedStyle(el)
      return `${cs.position}/${cs.zIndex}`
    },
    /* 就地换材质板的 backdrop-filter：内联优先于 CSS，用来做单变量对照 */
    setBdf(v) {
      const p = document.querySelector(`${SEL} .gs-plate`)
      if (!p) return null
      p.style.backdropFilter = v
      p.style.webkitBackdropFilter = v
      return p.style.backdropFilter
    },
    /* 材质板与面板的实际几何/视觉状态，用于解释读数 */
    probe() {
      const p = document.querySelector(`${SEL} .gs-plate`)
      if (!p) return { missing: `${SEL} .gs-plate 不在 DOM 里` }
      const a = document.querySelector(`${SEL} .gs-anim`)
      const pa = document.querySelector(`${SEL} .gs-panel`)
      const cs = getComputedStyle(p)
      const r = p.getBoundingClientRect()
      return {
        plateRect: `${r.width.toFixed(1)}x${r.height.toFixed(1)}`,
        plateFilter: cs.filter,
        plateBdf: (cs.backdropFilter || cs.webkitBackdropFilter || '').slice(0, 60),
        plateOpacity: cs.opacity,
        animTransform: a ? getComputedStyle(a).transform : null,
        animPlay: a ? getComputedStyle(a).animationPlayState : null,
        panelVisible: pa ? getComputedStyle(pa).visibility : null
      }
    }
  }
}, HOST)

const run = async (label, expr) => {
  const info = await page.evaluate(expr)
  await page.bringToFront()
  writeFileSync(`${outDir}/state.txt`, label)
  console.log(`  ${label.padEnd(18)} ${typeof info === 'object' ? JSON.stringify(info) : ''}`)
  await page.waitForTimeout(HOLD * 1000)
}

const pre = HOST === 'dialog' ? 'D' : 'M'
/* 核心判据是材质板区域的 R/B 偏向：
 *   IN-red  层内红条纹  → 材质板区域应偏红（红是"自己的 backdrop"，无论糊否）
 *   OUT-blue 层外蓝条纹 → 材质板区域若偏蓝 ⇒ 采样范围包含页面；若仍偏红/中性 ⇒ 被截断
 * 第三条只改定位层的 z-index，用来验证"z-index 祖先是否就是那道墙"：
 *   dialog 原本 z-index: auto → 试 50；menu 原本 50 → 试 auto。 */
await run(
  `${pre}1-IN-red`,
  `(() => { window.__brb.thaw(); window.__brb.setBdf(''); window.__brb.showOnly('in'); return window.__brb.probe() })()`
)
await run(
  `${pre}2-OUT-blue`,
  `(() => { window.__brb.showOnly('out'); return window.__brb.probe() })()`
)
await run(
  `${pre}3-OUT-blue-ZCHG`,
  `(() => { const l = window.__brb.setLayer('${HOST === 'dialog' ? 'z-index:50' : 'z-index:auto'}'); window.__brb.showOnly('out'); return { layer: l, ...window.__brb.probe() } })()`
)
await run(
  `${pre}4-OUT-blue-ZBACK`,
  `(() => { const l = window.__brb.setLayer(''); window.__brb.showOnly('out'); return { layer: l, ...window.__brb.probe() } })()`
)
await run(
  `${pre}5-IN-red-again`,
  `(() => { window.__brb.showOnly('in'); return window.__brb.probe() })()`
)

writeFileSync(`${outDir}/state.txt`, 'DONE')
if (errs.length) console.log('页面错误:', errs.slice(0, 5))
await context.close()
await browser.close()
console.log(`产物 → ${outDir}/  （接着跑 python scripts/glass-material-screen.py ${outDir}）`)
