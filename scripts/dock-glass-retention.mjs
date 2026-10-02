#!/usr/bin/env node
/**
 * R2-K · 手机端底部 dock 的液态玻璃 —— 保留率实测。
 *
 * 本探针不重复造方法：`stdOf`（对比度保留率）与"页面侧插条纹"的做法
 * 全部来自 `scripts/liquid-glass-probe.mjs`（第六节 ⑥），此处只是把被测
 * 宿主从弹窗换成底栏 dock，并把口径补全为**两级**：
 *
 *   ① 生产态：`.sidebar` 的底色原样不动 —— 量的是"用户实际看到的"。
 *   ② 隔离态：临时把 `.sidebar` 底色置透明 —— 量的是"材质本身还能不能采到
 *      身后的时间轴画布"，也就是简报里 ≈0.66（只染色=死）/ ≤0.2（活）那条口径。
 *      两者必须一起看：若 ① 的 std 已经是平的，说明材质板身后本就没有可采样
 *      的结构，② 才是"材质是否活着"的唯一有意义读数。
 *
 * 判据（沿用项目口径）：
 *   保留率 ≈ 0.66 = 1 − 0.34 染色 ⇒ 只剩染色（死）
 *   保留率 ≤ 0.2                ⇒ 真的糊住了（活）
 *
 * 硬约束（照搬探针，缺一不可）：
 *   · 只用**页面级** `page.screenshot({ clip })`；元素级截图会把一切判成穿透。
 *   · 采样盒必须躲开导航文字（dock 的文字是玻璃层的**兄弟**节点，藏不掉内容层，
 *     必须显式隐藏 `.nav`）。
 *   · 手机档必须 `forceEngine=fallback`（iOS 走的就是这一档）。
 *
 * 前置（另开终端）：
 *   ./node_modules/.bin/vite --config vite.web.config.ts --port 5199 --host 127.0.0.1 --strictPort
 *
 * 用法：
 *   node scripts/dock-glass-retention.mjs --out docs/probes/dock-glass
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
const outDir = ARG('out', 'docs/probes/dock-glass')
const base = `http://127.0.0.1:${port}/probe.html`
mkdirSync(outDir, { recursive: true })

const DATA_KEY = 'quadrant-web-data-v2'
const GLASS_KEY = 'quadrant-glass-v1'

const iso = (i) => new Date(Date.now() - i * 3600_000).toISOString()

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

  return { version: 2, goals, events, weekPresets: [], weekEvents: [], weekCounterOffset: 0 }
}

/** fallback 档：与探针场景二同源，只把引擎定为降级（iOS 走的那一档） */
const GLASS_FALLBACK = JSON.stringify({
  displacementScale: 118,
  blurAmount: 0.4,
  saturation: 140,
  aberrationIntensity: 3,
  elasticity: 0.1,
  cornerRadius: 32,
  mode: 'standard',
  forceEngine: 'fallback'
})

/** 盒子（视口坐标）转 clip，向内收边，避开玻璃圆角与边缘 */
const insetClip = (r, dx, dy) => ({
  x: Math.round(r.x) + dx,
  y: Math.round(r.y) + dy,
  width: Math.round(r.width) - dx * 2,
  height: Math.round(r.height) - dy * 2
})

const browser = await chromium.launch({ executablePath, headless: true })

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

await page.addInitScript(
  ([dk, dv, gk, gv]) => {
    window.localStorage.setItem(dk, dv)
    window.localStorage.setItem(gk, gv)
  },
  [DATA_KEY, JSON.stringify(seedData()), GLASS_KEY, GLASS_FALLBACK]
)

await page.goto(`${base}?page=quadrant&sidebar=1&strict=0`, { waitUntil: 'load' })
await page.waitForSelector('.sidebar', { timeout: 20000 })
await page.waitForSelector('.gs-layer--dock', { timeout: 20000 })
await page.waitForTimeout(700)

/* ---------------------------------------------------------------- 诊断 */
/*
 * 先把"材质板到 html 的整条祖先链"打出来 —— 这正是简报里那条自相矛盾的要害：
 * 按项目规则，链上任一 fixed / sticky / 非 auto 的 z-index 都会让材质只剩染色。
 * 这里不推理，只把浏览器算出来的值原样记下来。
 */
const diag = await page.evaluate(() => {
  const layer = document.querySelector('.gs-layer--dock')
  const plate = layer?.querySelector('.gs-plate')
  const sidebar = document.querySelector('.sidebar')
  const nav = document.querySelector('.nav')

  const r = (el) => {
    if (!el) return null
    const b = el.getBoundingClientRect()
    return {
      x: +b.x.toFixed(1),
      y: +b.y.toFixed(1),
      w: +b.width.toFixed(1),
      h: +b.height.toFixed(1)
    }
  }

  const chain = []
  for (let n = plate; n && n !== document.documentElement.parentElement; n = n.parentElement) {
    const cs = getComputedStyle(n)
    chain.push({
      tag: n.tagName.toLowerCase(),
      cls: String(n.className || '').trim().split(/\s+/).slice(0, 3).join('.'),
      position: cs.position,
      zIndex: cs.zIndex,
      transform: cs.transform === 'none' ? 'none' : 'non-none',
      filter: cs.filter === 'none' ? 'none' : cs.filter,
      backdropFilter: cs.backdropFilter === 'none' ? 'none' : cs.backdropFilter,
      isolation: cs.isolation,
      willChange: cs.willChange,
      opacity: cs.opacity,
      contain: cs.contain,
      mixBlend: cs.mixBlendMode
    })
  }

  const scs = sidebar ? getComputedStyle(sidebar) : null
  const pcs = plate ? getComputedStyle(plate) : null
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    engine: layer?.dataset.glassEngine ?? '',
    sidebar: {
      rect: r(sidebar),
      position: scs?.position,
      zIndex: scs?.zIndex,
      backgroundColor: scs?.backgroundColor,
      backdropFilter: scs?.backdropFilter
    },
    layer: {
      rect: r(layer),
      display: getComputedStyle(layer).display,
      position: getComputedStyle(layer).position,
      zIndex: getComputedStyle(layer).zIndex,
      gsZ: getComputedStyle(layer).getPropertyValue('--gs-z').trim()
    },
    plate: plate
      ? {
          rect: r(plate),
          backgroundColor: pcs.backgroundColor,
          backdropFilter: pcs.backdropFilter,
          webkitBackdropFilter: pcs.webkitBackdropFilter,
          borderRadius: pcs.borderRadius,
          zIndex: pcs.zIndex
        }
      : null,
    navRect: r(nav),
    navItems: document.querySelectorAll('.nav .nav-item').length,
    chain
  }
})

console.log('\n【诊断】手机档 · fallback 引擎')
console.log(
  `  视口 ${diag.viewport.w}×${diag.viewport.h}｜引擎 ${diag.engine}｜导航 ${diag.navItems} 项`
)
console.log(
  `  .sidebar rect ${JSON.stringify(diag.sidebar.rect)} pos=${diag.sidebar.position} z=${diag.sidebar.zIndex} bg=${diag.sidebar.backgroundColor}`
)
console.log(
  `  .gs-layer--dock pos=${diag.layer.position} z=${diag.layer.zIndex} --gs-z=${diag.layer.gsZ} display=${diag.layer.display}`
)
console.log(
  `  .gs-plate rect ${JSON.stringify(diag.plate.rect)} backdrop=${diag.plate.backdropFilter} bg=${diag.plate.backgroundColor}`
)
console.log('  祖先链（材质板 → 上）：')
diag.chain.forEach((n, i) => {
  console.log(
    `    ${i === 0 ? '·' : '↑'} ${n.tag}.${n.cls}  pos=${n.position} z=${n.zIndex} tf=${n.transform} iso=${n.isolation} blur-filter=${n.backdropFilter}`
  )
})

await page.screenshot({ path: `${outDir}/00-dock-raw.png` })

/* ------------------------------------------------------- 保留率测量助手 */
/**
 * 在页面侧插入条纹（body 首子节点 ⇒ 树序在被测浮层之前），抓"材质开/关"两张，
 * 返回 std(on)/std(off)/ratio。`extraCss` 用来做隔离态（把 .sidebar 底色置透明）。
 */
async function measureRetention({ extraCss, tag }) {
  // 每次测量前清干净
  await page.evaluate(() => {
    document.getElementById('probeStripeBackdrop')?.remove()
    document.getElementById('probeRetentionCss')?.remove()
    const p = document.querySelector('.gs-layer--dock .gs-plate')
    if (p) p.style.cssText = ''
  })

  await page.evaluate((extra) => {
    const d = document.createElement('div')
    d.id = 'probeStripeBackdrop'
    d.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:0;' +
      'background:repeating-linear-gradient(0deg,#0b0f16 0 6px,#e8f1ff 6px 12px)'
    document.body.insertBefore(d, document.body.firstChild)

    const st = document.createElement('style')
    st.id = 'probeRetentionCss'
    /*
     * 逐条：
     *   .app / .quadrant-viewport 自带不透明底，会盖住条纹 ⇒ 探针内临时让开。
     *   .nav 是 dock 玻璃的**兄弟**（不是子节点，`.gs-content` 藏不掉它）⇒ 必须显式隐藏，
     *     否则导航文字落进采样盒会把读数抬起来（历史上就因此把 0.24 当成 0.01）。
     *   .gs-layer--dock .gs-content 是玻璃自己的内容层（dock 上为空），一并隐藏。
     */
    st.textContent =
      '.app{background:transparent!important}' +
      '.quadrant-viewport{background:transparent!important}' +
      '.nav{visibility:hidden!important}' +
      '.gs-layer--dock .gs-content{visibility:hidden!important}' +
      (extra || '')
    document.head.appendChild(st)
  }, extraCss || '')

  await page.waitForTimeout(420)

  const plateSel = '.gs-layer--dock .gs-plate'
  const clip = await page.evaluate((sel) => {
    const b = document.querySelector(sel).getBoundingClientRect()
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
  }, plateSel)
  const sample = insetClip({ x: clip.x, y: clip.y, width: clip.w, height: clip.h }, 12, 10)

  const stdOf = async (rect) => {
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

  // 条纹可见性控制：取页面中部一块（dock 之外）的 std，证明确实插进去了
  const control = { x: 20, y: 240, width: 120, height: 80 }
  const controlStd = await stdOf(control)

  const onStd = await stdOf(sample)
  await page.screenshot({ path: `${outDir}/${tag}-material-on.png` })

  await page.evaluate((sel) => {
    const p = document.querySelector(sel)
    p.dataset.probeBackup = p.style.cssText
    p.style.setProperty('backdrop-filter', 'none', 'important')
    p.style.setProperty('-webkit-backdrop-filter', 'none', 'important')
    p.style.setProperty('background', 'transparent', 'important')
  }, plateSel)
  await page.waitForTimeout(360)
  const offStd = await stdOf(sample)
  await page.screenshot({ path: `${outDir}/${tag}-material-off.png` })

  // 复原
  await page.evaluate((sel) => {
    const p = document.querySelector(sel)
    p.style.cssText = p.dataset.probeBackup || ''
    p.removeAttribute('data-probeBackup')
    document.getElementById('probeStripeBackdrop')?.remove()
    document.getElementById('probeRetentionCss')?.remove()
  }, plateSel)
  await page.waitForTimeout(300)

  const ratio = offStd ? +(onStd / offStd).toFixed(3) : null
  return {
    tag,
    extraCss: extraCss || '',
    sample,
    controlStd,
    onStd,
    offStd,
    ratio
  }
}

/* ------------------------------------------------------------- 两级测量 */
const production = await measureRetention({ extraCss: '', tag: 'A-production' })
const isolated = await measureRetention({
  extraCss: '.sidebar{background:transparent!important}',
  tag: 'B-sidebar-transparent'
})

const verdictOf = (r) => {
  if (r.ratio === null) return '无法判定（std(off)=0）'
  if (r.ratio <= 0.2) return 'ALIVE（活）'
  if (r.ratio <= 0.45) return '中间'
  if (r.ratio <= 0.8) return '≈0.66 ⇒ TINT ONLY（死）'
  return '≈1.0 ⇒ 完全没采样（死）'
}

const report = (label, r) => {
  console.log(`\n【保留率 · ${label}】`)
  console.log(
    `  采样盒 ${r.sample.width}×${r.sample.height} @(${r.sample.x},${r.sample.y})｜条纹可见性控制 std=${r.controlStd}`
  )
  console.log(`  std(开)=${r.onStd}  std(关)=${r.offStd}  保留率=${r.ratio}`)
  console.log(`  ⇒ ${verdictOf(r)}`)
}

report('A · 生产态（.sidebar 底色原样）', production)
report('B · 隔离态（.sidebar 底色置透明）', isolated)

const out = {
  diag,
  production,
  isolated,
  errors,
  meta: {
    browser: executablePath,
    viewport: { w: 390, h: 844 },
    deviceScaleFactor: 2,
    engine: 'fallback',
    plateSel: '.gs-layer--dock .gs-plate',
    clipInset: { x: 12, y: 10 },
    thresholds: { alive: 0.2, tintOnly: 0.66 }
  }
}
writeFileSync(`${outDir}/retention.json`, JSON.stringify(out, null, 2))

console.log('\n【错误收集】')
console.log(errors.length ? errors.slice(0, 8).map((e) => `  ⚠ ${e}`).join('\n') : '  无 pageerror / console error')
console.log(`\n结果已写入 ${outDir}/retention.json 与 ${outDir}/*.png`)

await browser.close()
