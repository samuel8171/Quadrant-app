#!/usr/bin/env node
/**
 * 阶段二：查清"稳定后材质为什么比动画期弱一半"。
 *
 * 阶段一（dialog-settle-diag.mjs）的结论：
 *   稳定态  Δ(材质开/关) = 4.39   92.4% 像素有变化   ← 材质在画，但很弱
 *   动画期  Δ            = 8.24   67.3% 像素有变化   ← 强近一倍
 *   滤镜 id 有效、声明完好 ⇒ 不是"没画"，也不是悬空 url()。
 *
 * 所以弱的是**可见度**。两个嫌疑：
 *   A. `.modal-mask` 的 rgba(0,0,0,0.55) 遮罩是材质板 backdrop 的一部分，
 *      把材质赖以成立的反差吃掉 55%。而 `fade-in` 与 `pop-in` 几乎同时（0.18s / 0.2s），
 *      "载入时看得见、稳定后看不见"恰好对应"遮罩淡入完成"。
 *   B. 库自己那两层 `bg-black` 装饰画在材质板**之上**，把材质压暗/盖住。
 *      （`.gs-plate` 是 `.gs-anim > .gs-panel` 的兄弟且在 DOM 里靠前 ⇒ 库的内容在上层）
 *
 * 三组测量：
 *   1. 遮罩 alpha 扫描（0 / 0.2 / 0.35 / 0.55）→ 材质 Δ 与玻璃区亮度如何随之变化
 *   2. 库装饰层清单 → 谁画在材质板之上、是不是不透明黑
 *   3. 折射分量单独隔离（blur+saturate vs blur+url+saturate）在两种遮罩下的贡献
 * 外加一张"材质板涂成纯红"的定位图，确认它到底落在哪、覆盖多大。
 *
 * 用法：node scripts/dialog-settle-phase2.mjs --out tmp/dialogSettle2
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
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean)
const executablePath = CANDIDATES.find((p) => existsSync(p))
if (!executablePath) {
  console.error('找不到可用的 Edge/Chromium')
  process.exit(2)
}

const port = ARG('port', '5199')
const outDir = ARG('out', 'tmp/dialogSettle2')
const base = `http://127.0.0.1:${port}/probe.html`
mkdirSync(outDir, { recursive: true })

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
    remark: '备注文本',
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

const browser = await chromium.launch({ executablePath, headless: true })
const report = { scrim: [], decor: [], refraction: [], paintOrder: [] }

async function openDialogOn(page) {
  await page.evaluate(() => {
    const card = document.querySelector('.event-card')
    const r = card.getBoundingClientRect()
    card.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: Math.min(Math.max(r.left + 20, 40), window.innerWidth - 200),
        clientY: Math.min(Math.max(r.top + 20, 380), window.innerHeight - 380)
      })
    )
  })
  await page.waitForSelector('.gs-layer--menu .gs-plate', { timeout: 8000 })
  await page.waitForTimeout(340)
  await page.locator('.gs-layer--menu .context-item', { hasText: '删除' }).first().click()
  await page.waitForSelector('.gs-layer--dialog .gs-plate', { timeout: 8000 })
  await page.waitForTimeout(600)
}

const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  colorScheme: 'dark'
})
const page = await context.newPage()
await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [
  'quadrant-web-data-v2',
  JSON.stringify(seed)
])
await page.goto(`${base}?page=quadrant&sidebar=1&strict=0`, { waitUntil: 'load' })
await page.waitForSelector('.event-card', { state: 'attached', timeout: 20000 })
await page.waitForTimeout(700)
await openDialogOn(page)

const setCss = (text) =>
  page.evaluate((css) => {
    document.querySelectorAll('style.__probe').forEach((el) => el.remove())
    if (!css) return
    const s = document.createElement('style')
    s.className = '__probe'
    s.textContent = css
    document.head.appendChild(s)
  }, text)

const plateRect = await page.evaluate(() => {
  const b = document.querySelector('.gs-layer--dialog .gs-plate').getBoundingClientRect()
  return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
})

/* ---------- 2. 库装饰层清单：谁画在材质板之上 ---------- */
{
  const inv = await page.evaluate(() => {
    const plate = document.querySelector('.gs-layer--dialog .gs-plate')
    const layer = plate.closest('.gs-layer')
    const out = []
    const walk = (root, tag) => {
      root.querySelectorAll('*').forEach((el) => {
        const cs = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        if (!r.width || !r.height) return
        out.push({
          where: tag,
          cls: (el.className && String(el.className).slice(0, 60)) || el.tagName.toLowerCase(),
          tag: el.tagName.toLowerCase(),
          bg: cs.backgroundColor,
          opacity: cs.opacity,
          zIndex: cs.zIndex,
          position: cs.position,
          backdrop: cs.backdropFilter && cs.backdropFilter !== 'none' ? cs.backdropFilter : '',
          filter: cs.filter && cs.filter !== 'none' ? cs.filter : '',
          size: `${Math.round(r.width)}x${Math.round(r.height)}`,
          /* 在材质板**之后**出现在 DOM 里 = 画在它上面 */
          afterPlate: !!(plate.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
        })
      })
    }
    const anchor = plate.closest('.gs-anchor')
    walk(anchor, 'anchor')
    /* 顺便记下材质板自己的位置 */
    return {
      plateIndex: [...anchor.querySelectorAll('*')].indexOf(plate),
      nodes: out.filter((n) => n.bg !== 'rgba(0, 0, 0, 0)' || n.backdrop || n.filter || n.opacity !== '1')
    }
  })
  report.decor = inv
  console.log('· 锚点子树里"会画东西"的节点（按 DOM 顺序）')
  console.log(`    材质板在锚点子元素里的序号 = ${inv.plateIndex}`)
  for (const n of inv.nodes) {
    console.log(
      `    ${n.afterPlate ? '↑板上' : '↓板下'} ${n.tag}.${n.cls}`.padEnd(52) +
        ` bg=${n.bg} op=${n.opacity} z=${n.zIndex} ${n.size}` +
        (n.backdrop ? ` backdrop=${n.backdrop}` : '') +
        (n.filter ? ` filter=${n.filter}` : '')
    )
  }
}

/* ---------- 材质板定位图：涂成纯红，看它落在哪 ---------- */
await setCss(`.gs-layer--dialog .gs-plate { background: rgba(255, 0, 0, 1) !important; }`)
await page.waitForTimeout(200)
await page.screenshot({ path: `${outDir}/locate-plate-red.png` })
await setCss('')

/* ---------- 1. 遮罩 alpha 扫描 ---------- */
const MAT_OFF = `.gs-layer--dialog .gs-plate { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; background: transparent !important; }`
console.log('\n· 遮罩 alpha 扫描（材质 Δ = 材质开 vs 关，0~255）')
console.log('    scrim    delta      changed%    glass-luma')
for (const alpha of ['0', '0.2', '0.35', '0.55']) {
  const scrim = `.modal-mask { background: rgba(0, 0, 0, ${alpha}) !important; }`
  await setCss(scrim)
  await page.waitForTimeout(220)
  await page.screenshot({ path: `${outDir}/scrim${alpha}-on.png`, clip: plateRect })
  await setCss(`${scrim}\n${MAT_OFF}`)
  await page.waitForTimeout(220)
  await page.screenshot({ path: `${outDir}/scrim${alpha}-off.png`, clip: plateRect })
  await setCss('')
  report.scrim.push({ alpha: Number(alpha) })
  console.log(`    ${String(alpha).padEnd(8)}  （像素数据由 judge 输出）`)
}

/* ---------- 3. 折射分量隔离 ---------- */
console.log('\n· 折射分量隔离（去掉 url() 看掉了多少）')
for (const alpha of ['0.55', '0']) {
  const scrim = `.modal-mask { background: rgba(0, 0, 0, ${alpha}) !important; }`
  await setCss(scrim)
  await page.waitForTimeout(220)
  await page.screenshot({ path: `${outDir}/refract${alpha}-with.png`, clip: plateRect })
  await setCss(`${scrim}\n.gs-layer--dialog .gs-plate { backdrop-filter: blur(var(--gs-blur)) saturate(var(--gs-sat)) !important; }`)
  await page.waitForTimeout(220)
  await page.screenshot({ path: `${outDir}/refract${alpha}-without.png`, clip: plateRect })
  await setCss('')
  report.refraction.push({ alpha: Number(alpha) })
  console.log(`    scrim=${alpha} 已拍 with/without url()`)
}

writeFileSync(`${outDir}/phase2.json`, JSON.stringify(report, null, 2))
await context.close()
await browser.close()
console.log(`\n产物 → ${outDir}/`)
