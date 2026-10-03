#!/usr/bin/env node
/**
 * R2-K · 手机端底部 dock 的液态玻璃 —— 保留率 + 标签可读性实测，并**可失败**。
 *
 * 方法不另起炉灶：`stdOf`（对比度保留率）与"页面侧插条纹"的做法来自
 * `scripts/liquid-glass-probe.mjs`（第六节 ⑥）；本探针只把被测宿主从弹窗换成底栏 dock，
 * 并补上两件它没有的事：
 *
 *   ① **标签可读性**：dock 的文字（`.nav`）是玻璃层的**兄弟**节点，量材质要藏它，
 *      量可读性则相反 —— 要在它可见时量「文字色 vs 玻璃身后」的 WCAG 对比度。
 *      两档（fallback / chromium）各量一次，且分"材质开 / 材质关"两种状态：
 *      后者就是"引擎判成 chromium 但 backdrop-filter 悄悄无输出"的兜底场景。
 *   ② **非零退出**：判据不达标就 `process.exit(1)`（对齐 liquid-glass-probe 的 969 行），
 *      否则"回归只会被印成数字、什么都不会失败"。
 *      纳入退出码的判据：
 *        · **两档的生产态保留率**（fallback = iOS 实际走的档；chromium = 桌面/网页
 *          全效果档。R2-K2 之后两档都必须活，阈值 ≤ 0.2）；
 *        · **两档的标签可读性**（真实背景下，材质开/关都 ≥ 4.5:1）。
 *      ⚠️ 历史（已作废）：chromium 档曾"照量照打印但不判红"，因为当时材质板是
 *      `.sidebar(fixed+z100)` 的后代 ⇒ 结构性必死（0.33）。R2-K2 把玻璃层搬到
 *      `.app` 上之后它实测 0.05（活），那条豁免随之撤销 —— 现在两档都判红。
 *
 * 保留率口径（沿用项目）：
 *   保留率 = std(材质开) / std(材质关)。条纹插在**页面侧**（被测浮层之前）。
 *   判据的"只剩染色"读数**随在役染色推导**（tintOnly = 1 − 材质板背景的不透明度），
 *   而不是写死某一档的数字：fallback 染色 0.62 ⇒ ≈0.38；chromium 染色 0.34 ⇒ ≈0.66。
 *   ≤ 0.2 ⇒ 活。
 *
 * 硬约束（缺一不可）：
 *   · 只用**页面级** `page.screenshot({ clip })`；元素级截图会把一切判成穿透。
 *   · 采样盒必须躲开导航文字（量保留率时显式藏 `.nav`）。
 *   · 手机档 `forceEngine` 必须显式设置（本探针两档都量，不再只测 fallback）。
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

/** 保留率上限：≤ 此值判"活" */
const ALIVE_MAX = 0.2
/** 标签可读性下限：WCAG 正文对比度（dock 文字 11px，属正文尺寸） */
const MIN_TEXT_CONTRAST = 4.5

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
  width: Math.round(r.width) - dx * 2,
  height: Math.round(r.height) - dy * 2
})

const PLATE = '.gs-layer--dock .gs-plate'

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
  await page.addInitScript(
    ([dk, dv, gk, gv]) => {
      window.localStorage.setItem(dk, dv)
      window.localStorage.setItem(gk, gv)
    },
    [DATA_KEY, JSON.stringify(seedData()), GLASS_KEY, glassFor(engine)]
  )
  await page.goto(`${base}?page=quadrant&sidebar=1&strict=0`, { waitUntil: 'load' })
  await page.waitForSelector('.sidebar', { timeout: 20000 })
  await page.waitForSelector(PLATE, { timeout: 20000 })
  await page.waitForTimeout(700)
  return { context, page, errors }
}

/* 通用：抓一块页面区域，算像素亮度标准差（对比度保留率用） */
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

/** 插/撤页面侧条纹；`stripes=false` 时只清场 */
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
      '.app{background:transparent!important}.quadrant-viewport{background:transparent!important}'
    document.head.appendChild(st)
  }, on)

/* ------------------------------------------------------- 保留率（页面侧条纹） */
async function measureRetention(page, { extraCss, tag }) {
  await setStripes(page, false)
  // 额外样式单独一个 id，避免与 setStripes 的 `probeRetentionCss` 互相覆盖
  await page.evaluate((extra) => {
    document.getElementById('probeExtraCss')?.remove()
    if (!extra) return
    const st = document.createElement('style')
    st.id = 'probeExtraCss'
    st.textContent = extra
    document.head.appendChild(st)
  }, extraCss || '')

  // 量保留率时藏掉导航文字（它是玻璃的兄弟，藏不掉内容层）与玻璃内容层
  await page.evaluate(() => {
    document.getElementById('probeHideLabels')?.remove()
    const st = document.createElement('style')
    st.id = 'probeHideLabels'
    st.textContent = '.nav{visibility:hidden!important}.gs-layer--dock .gs-content{visibility:hidden!important}'
    document.head.appendChild(st)
  })

  await setStripes(page, true)
  await page.waitForTimeout(420)

  const rect = await page.evaluate((sel) => {
    const b = document.querySelector(sel).getBoundingClientRect()
    return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
  }, PLATE)
  const sample = insetClip(rect, 12, 10)

  const control = { x: 20, y: 240, width: 120, height: 80 }
  const controlStd = await stdOf(page, control)

  const onStd = await stdOf(page, sample)
  await page.screenshot({ path: `${outDir}/${tag}-material-on.png` })

  await setPlateOff(page)
  await page.waitForTimeout(360)
  const offStd = await stdOf(page, sample)
  await page.screenshot({ path: `${outDir}/${tag}-material-off.png` })

  await setPlateOn(page)
  await setStripes(page, false)
  await page.evaluate(() => {
    document.getElementById('probeHideLabels')?.remove()
    document.getElementById('probeExtraCss')?.remove()
    document.getElementById('probeRetentionCss')?.remove()
  })
  await page.waitForTimeout(280)

  return { tag, extraCss: extraCss || '', sample, controlStd, onStd, offStd, ratio: offStd ? +(onStd / offStd).toFixed(3) : null }
}

/* ------------------------------------------------------- 标签可读性（WCAG） */
/*
 * 每个导航项的整体矩形。**不能只取文字那个 `<span>`**：中文字形密，span 这么小的盒子里
 * 文字像素占比很高，像素亮度的中位数会落到字上，于是对比度被算成 ~2:1 的假低值。
 * 取整项（图标 + 文字 + 四周留白）时文字只是少数像素，中位数才是背景。
 * 背景用**中位数**而不是"较暗的一侧"，所以无论文字比背景亮还是暗都成立。
 */
async function labelContrast(page) {
  const items = await page.evaluate(() =>
    [...document.querySelectorAll('.nav .nav-item')].map((el) => {
      const b = el.getBoundingClientRect()
      return {
        x: Math.round(b.x),
        y: Math.round(b.y),
        width: Math.max(1, Math.round(b.width)),
        height: Math.max(1, Math.round(b.height)),
        color: getComputedStyle(el).color,
        label: (el.querySelector('span')?.textContent || '').trim(),
        active: el.classList.contains('active')
      }
    })
  )

  const one = async (it) => {
    const b64 = (await page.screenshot({ clip: { x: it.x, y: it.y, width: it.width, height: it.height } })).toString('base64')
    const r = await page.evaluate(
      async ([b, css]) => {
        const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b)).blob())
        const g = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')
        g.drawImage(bmp, 0, 0)
        const d = g.getImageData(0, 0, bmp.width, bmp.height).data
        const f = (c) => {
          c /= 255
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
        }
        const L = (r, gg, bb) => 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(bb)
        const lums = []
        for (let i = 0; i < d.length; i += 4) lums.push(L(d[i], d[i + 1], d[i + 2]))
        lums.sort((a, b2) => a - b2)
        const bg = lums[Math.floor(lums.length / 2)]
        const m = css.match(/(\d+)\D+(\d+)\D+(\d+)/)
        const t = L(+m[1], +m[2], +m[3])
        return {
          bg: +bg.toFixed(4),
          text: +t.toFixed(4),
          contrast: +(((Math.max(bg, t) + 0.05) / (Math.min(bg, t) + 0.05)).toFixed(2))
        }
      },
      [b64, it.color]
    )
    return { label: it.label, color: it.color, ...r }
  }

  const per = []
  for (const it of items) per.push(await one(it))
  const worst = per.reduce((a, b) => (b.contrast < a.contrast ? b : a), per[0])
  return { per, worst }
}

async function measureContrast(page, { stripes, tag }) {
  await setStripes(page, false)
  await setPlateOn(page)
  await setStripes(page, stripes)
  await page.waitForTimeout(420)

  const on = await labelContrast(page)
  await page.screenshot({ path: `${outDir}/${tag}-labels-material-on.png` })

  await setPlateOff(page)
  await page.waitForTimeout(360)
  const off = await labelContrast(page)
  await page.screenshot({ path: `${outDir}/${tag}-labels-material-off.png` })

  await setPlateOn(page)
  await setStripes(page, false)
  await page.waitForTimeout(280)
  return { tag, stripes, on, off }
}

/* ------------------------------------------------------------- 每档跑一轮 */
async function runEngine(engine) {
  const { context, page, errors } = await openPage(engine)

  const diag = await page.evaluate((sel) => {
    const layer = document.querySelector('.gs-layer--dock')
    const plate = document.querySelector(sel)
    const sidebar = document.querySelector('.sidebar')
    const chain = []
    for (let n = plate; n; n = n.parentElement) {
      const cs = getComputedStyle(n)
      chain.push({
        tag: n.tagName.toLowerCase(),
        cls: String(n.className || '').trim().split(/\s+/).slice(0, 3).join('.'),
        position: cs.position,
        zIndex: cs.zIndex,
        transform: cs.transform === 'none' ? 'none' : 'non-none'
      })
      if (n === document.documentElement) break
    }
    const plateBg = plate ? getComputedStyle(plate).backgroundColor : ''
    const am = plateBg.match(/rgba?\([^)]*?,\s*([\d.]+)\)$/)
    return {
      engine: layer?.dataset.glassEngine ?? '',
      sidebarBackground: sidebar ? getComputedStyle(sidebar).backgroundColor : null,
      plateBackground: plateBg,
      tintAlpha: am ? Number(am[1]) : null,
      plateBackdrop: plate ? getComputedStyle(plate).backdropFilter : null,
      navItems: document.querySelectorAll('.nav .nav-item').length,
      sidebarRect: (() => {
        const b = sidebar.getBoundingClientRect()
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
      })(),
      chain
    }
  }, PLATE)

  const production = await measureRetention(page, { extraCss: '', tag: `${engine}-A-production` })
  const isolated = await measureRetention(page, {
    extraCss: '.sidebar{background:transparent!important}',
    tag: `${engine}-B-sidebar-transparent`
  })
  const contrastReal = await measureContrast(page, { stripes: false, tag: `${engine}-real` })
  const contrastStress = await measureContrast(page, { stripes: true, tag: `${engine}-stress` })

  await context.close()
  return { engine, diag, production, isolated, contrastReal, contrastStress, errors }
}

/* ------------------------------------------------------------------ 主流程 */
const results = {}
for (const engine of ['fallback', 'chromium']) {
  console.log(`\n【${engine}】`)
  const r = await runEngine(engine)
  results[engine] = r
  const tintOnly = r.diag.tintAlpha === null ? null : +(1 - r.diag.tintAlpha).toFixed(3)
  console.log(
    `  .sidebar 底=${r.diag.sidebarBackground}｜材质板 染色=${r.diag.plateBackground}（α=${r.diag.tintAlpha} ⇒ "只剩染色"读 ≈${tintOnly}）｜backdrop=${r.diag.plateBackdrop}`
  )
  console.log(
    `  几何 dock ${r.diag.sidebarRect.w}×${r.diag.sidebarRect.h} @(${r.diag.sidebarRect.x},${r.diag.sidebarRect.y})｜导航 ${r.diag.navItems} 项`
  )
  console.log(
    `  保留率 A(生产) ${r.production.ratio}（std 开 ${r.production.onStd} / 关 ${r.production.offStd}，条纹控制 ${r.production.controlStd}）`
  )
  console.log(`  保留率 B(隔离) ${r.isolated.ratio}（std 开 ${r.isolated.onStd} / 关 ${r.isolated.offStd}）`)
  console.log(
    `  可读性 · 真实背景：材质开 最差 ${r.contrastReal.on.worst.contrast}:1（${r.contrastReal.on.worst.label}）｜材质关 ${r.contrastReal.off.worst.contrast}:1（${r.contrastReal.off.worst.label}）`
  )
  console.log(
    `  可读性 · 条纹压力：材质开 最差 ${r.contrastStress.on.worst.contrast}:1｜材质关 ${r.contrastStress.off.worst.contrast}:1`
  )
  r.tintOnly = tintOnly
}

/* 判定：两档都算（见下方"两档都纳入退出码"的说明） */
const classify = (ratio, tintOnly) => {
  if (ratio === null) return 'undefined'
  if (ratio <= ALIVE_MAX) return 'alive'
  if (tintOnly !== null && ratio >= tintOnly - 0.05) return 'tint-only'
  return 'degraded'
}
const verdicts = {}
for (const [k, r] of Object.entries(results)) {
  verdicts[k] = { production: classify(r.production.ratio, r.tintOnly), isolated: classify(r.isolated.ratio, r.tintOnly) }
}

const contrastFailures = []
for (const [k, r] of Object.entries(results)) {
  for (const [state, c] of [
    ['材质开/真实背景', r.contrastReal.on],
    ['材质关/真实背景', r.contrastReal.off]
  ]) {
    if (c.worst.contrast < MIN_TEXT_CONTRAST) {
      contrastFailures.push(`${k} ${state} ${c.worst.contrast}:1 < ${MIN_TEXT_CONTRAST}:1`)
    }
  }
}

/*
 * 两档**都**纳入退出码（2026-10-03 R2-K2 起）。
 *
 * 历史：本探针一度只守 fallback 档，chromium 档照量照打印但不判红 ——
 * 因为当时它在"材质板是 .sidebar(fixed+z100) 的后代"这个结构下**必然是死的**
 * （0.33），把一条结构性的、超出当轮授权的问题永久判红，会盖掉"主档有没有坏"
 * 这个真正要守的信号。
 *
 * 现在前提变了：R2-K2 把玻璃层搬到 `.app` 上，chromium 档实测 0.05（活）。
 * 那个"已知死"的豁免随之作废 —— 两档都是必须守的回归信号。
 * 若哪天 chromium 又掉回 ≈1 − 染色（0.34 ⇒ 0.66 / 0.62 ⇒ 0.38），
 * 说明材质板又落进了某个合成面里，探针必须失败，而不是把数字印出来让人自己看。
 */
console.log('\n【判定】')
for (const k of ['fallback', 'chromium']) {
  const r = results[k]
  const v = verdicts[k].production
  const mark = v === 'alive' ? '✓' : '✗'
  console.log(`  ${mark} ${k} 保留率 ${r.production.ratio} ⇒ ${v}（阈值 ≤${ALIVE_MAX} 为活；"只剩染色"≈${r.tintOnly}）`)
}
if (contrastFailures.length) contrastFailures.forEach((f) => console.log(`  ✗ 可读性 ${f}`))
else console.log(`  ✓ 标签对比度：两档 × 开/关 均 ≥ ${MIN_TEXT_CONTRAST}:1`)

writeFileSync(
  `${outDir}/retention.json`,
  JSON.stringify({ meta: { browser: executablePath, engines: ['fallback', 'chromium'], aliveMax: ALIVE_MAX, minTextContrast: MIN_TEXT_CONTRAST, plateSel: PLATE, clipInset: { x: 12, y: 10 } }, verdicts, contrastFailures, results }, null, 2)
)

let code = 0
const reasons = []
for (const k of ['fallback', 'chromium']) {
  if (verdicts[k].production !== 'alive') {
    reasons.push(
      `${k} 保留率 ${results[k].production.ratio} 判为 ${verdicts[k].production}（非 alive；"只剩染色"≈${results[k].tintOnly}）`
    )
  }
}
if (contrastFailures.length) reasons.push(`标签对比度不达标：${contrastFailures.join('；')}`)

console.log('\n【错误收集】')
const allErrors = Object.values(results)
  .flatMap((r) => r.errors)
  .filter((e) => !/favicon|ERR_FILE_NOT_FOUND.*photos/i.test(e))
console.log(allErrors.length ? allErrors.slice(0, 8).map((e) => `  ⚠ ${e}`).join('\n') : '  无 pageerror / console error')
if (allErrors.length) reasons.push(`${allErrors.length} 条运行时错误`)

console.log(`\n结果已写入 ${outDir}/ 与 ${outDir}/retention.json`)

if (reasons.length) {
  console.error(`\n✗ 失败：${reasons.join(' | ')}`)
  code = 1
} else {
  console.log('\n✓ 通过：两档材质均活，且两档标签可读性达标')
}
await browser.close()
process.exit(code)
