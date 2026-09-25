#!/usr/bin/env node
/**
 * liquid-glass-react 折射验证探针。
 *
 * 判据不是「看起来像不像玻璃」，而是**同布局下位移强度 0 与 118 的像素差**：
 * 位移为 0 时 SVG 滤镜把身后像素原样搬回（恒等），非 0 时把条纹拉弯。
 * 若两组截图逐像素一致，折射就没生效——无论 DOM 里挂了多少个 filter。
 *
 * 用法（前置：另开终端起 vite --port 5199）：
 *   node scripts/glass-refraction-ab.mjs --out tmp/spike
 *   python scripts/diff-glass.py tmp/spike        # 逐像素比对各场景
 *
 * 探针页 `src/renderer/probe-glass.html`（源码 `src/renderer/probe/glass.tsx`）
 * 只服务于本脚本：它把玻璃压在一张条纹背景上，让位移有东西可搬。
 * **不进构建产物**（Vite 只以 index.html 为入口）。
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
const outDir = ARG('out', 'tmp/spike')
const base = `http://127.0.0.1:${port}/probe-glass.html`
mkdirSync(outDir, { recursive: true })

const bg = '#0f1115'

const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext({
  viewport: { width: 900, height: 600 },
  deviceScaleFactor: 1,
  colorScheme: 'dark'
})
const page = await context.newPage()

const rows = []

/** 读回到页面里，把玻璃的渲染实况取出来 */
const diagnose = () =>
  page.evaluate(() => {
    const warps = [...document.querySelectorAll('.glass__warp')]
    const glass = [...document.querySelectorAll('.glass')]
    const filters = [...document.querySelectorAll('filter[id]')]
    const imgs = [...document.querySelectorAll('filter feImage')]
    const warp = warps[0]
    const cs = warp ? getComputedStyle(warp) : null
    const g = glass[0]
    const rect = g ? g.getBoundingClientRect() : null
    return {
      warpCount: warps.length,
      filterIds: filters.map((f) => f.id),
      // id 含冒号（React useId 的产物）时，能否被 getElementById 解析
      filterResolvable: filters.map((f) => document.getElementById(f.id) === f),
      feImageHrefLen: imgs.map((i) => (i.getAttribute('href') || '').length),
      feImageHrefHead: imgs.map((i) => (i.getAttribute('href') || '').slice(0, 30)),
      warpFilter: cs ? cs.filter : null,
      warpBackdrop: cs ? (cs.webkitBackdropFilter || cs.backdropFilter) : null,
      glassRect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
      /*
       * 根节点矩形 vs .glass 矩形。
       * 库的 glassSize 量的是**根节点**，边框层与位移贴图都按它定尺寸；
       * 而 .glass 是 inline-flex（随内容收缩）。两者不等 → 边框层与玻璃体错位，
       * 这是接入时最容易忽略的一处几何契约。
       */
      rootRect: (() => {
        const root = document.querySelector('.glass')?.parentElement
        if (!root) return null
        const r = root.getBoundingClientRect()
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
      })(),
      inlineFont: g ? getComputedStyle(g.querySelector('div[style*="z-index"]') || g).font : null
    }
  })

const scenarios = [
  { name: 'ds0-blur0', q: 'ds=0&blur=0' },
  { name: 'ds118-blur0', q: 'ds=118&blur=0' },
  { name: 'ds0-blur0.4', q: 'ds=0&blur=0.4' },
  { name: 'ds118-blur0.4', q: 'ds=118&blur=0.4' },
  // 模式差异补测：在 blur=0 下量，才能区分「模式本身没差别」与「差别被模糊抹掉了」
  { name: 'polar-blur0', q: 'ds=118&blur=0&mode=polar' },
  { name: 'prominent-blur0', q: 'ds=118&blur=0&mode=prominent' },
  { name: 'shader-blur0', q: 'ds=118&blur=0&mode=shader' },
  { name: 'polar-blur0.4', q: 'ds=118&blur=0.4&mode=polar' },
  { name: 'prominent-blur0.4', q: 'ds=118&blur=0.4&mode=prominent' },
  { name: 'shader-blur0.4', q: 'ds=118&blur=0.4&mode=shader' }
]

for (const s of scenarios) {
  const errs = []
  const onErr = (e) => errs.push(String(e))
  page.on('pageerror', onErr)
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })

  await page.goto(`${base}?${s.q}`, { waitUntil: 'load' })
  await page.waitForSelector('.glass__warp', { timeout: 15000 })
  // 库在 mount 后的 useEffect 里量尺寸，需要等一帧以上
  await page.waitForTimeout(700)

  const diag = await diagnose()
  const file = `${outDir}/${s.name}.png`
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 900, height: 600 } })

  rows.push({ scenario: s.name, query: s.q, file, errors: errs, ...diag })
  page.off('pageerror', onErr)
}

await browser.close()

writeFileSync(`${outDir}/diagnostics.json`, JSON.stringify({ bg, rows }, null, 2))

for (const r of rows) {
  console.log(`\n[${r.scenario}]  ${r.query}`)
  console.log(`  warp 数=${r.warpCount}  filter id=${JSON.stringify(r.filterIds)}  可解析=${JSON.stringify(r.filterResolvable)}`)
  console.log(`  feImage href 长度=${JSON.stringify(r.feImageHrefLen)}  前缀=${JSON.stringify(r.feImageHrefHead)}`)
  console.log(`  computed filter=${JSON.stringify(r.warpFilter)}`)
  console.log(`  computed backdrop=${JSON.stringify(r.warpBackdrop)}`)
  console.log(`  根节点矩形=${JSON.stringify(r.rootRect)}  玻璃体=.glass ${JSON.stringify(r.glassRect)}`)
  console.log(`  内容层 font=${JSON.stringify(r.inlineFont)}`)
  if (r.errors.length) console.log(`  ⚠ 页面错误: ${JSON.stringify(r.errors.slice(0, 3))}`)
}
console.log(`\n截图与诊断已写入 ${outDir}/`)
