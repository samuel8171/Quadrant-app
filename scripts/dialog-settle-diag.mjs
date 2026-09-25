#!/usr/bin/env node
/**
 * 诊断「弹窗稳定后材质消失」—— 把"载入时有折射，稳定后透明"拆成可判读的数字。
 *
 * 用户的原话（两次）：
 *   「折射效果只有在菜单栏或弹窗播放动画时才有，一旦稳定背景就变透明」
 *   「载入弹窗时有渲染折射、模糊等等，稳定后弹窗直接变透明」
 *
 * 这个脚本回答三个问题，每个都要数字不要推断：
 *
 *   Q1 稳定后材质板的 backdrop-filter 还在不在？引用的那个 SVG 滤镜 id
 *      在 DOM 里还存不存在？（id 悬空会让整条声明失效 ⇒ 页面原样透出来）
 *   Q2 稳定后玻璃区域内**还有没有模糊**？判据是区域内的平均梯度（结构量）：
 *      模糊会让梯度大幅下降；若无变化 ⇒ 材质其实没在作用。
 *   Q3 到底是 pop-in 的哪个分量在稳定时杀掉了材质？opacity 还是 transform？
 *      做法是把两个分量分别单独钉住做对照，而不是只测"动画中 vs 稳定"。
 *
 * 用法：
 *   node scripts/dialog-settle-diag.mjs --out tmp/dialogSettle
 *   "$PY313" scripts/dialog-settle-judge.py tmp/dialogSettle
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
  console.error('找不到可用的 Edge/Chromium（可用 UI_PROBE_BROWSER 指定）')
  process.exit(2)
}

const port = ARG('port', '5199')
const outDir = ARG('out', 'tmp/dialogSettle')
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

async function newPage(page) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'dark'
  })
  const p = await context.newPage()
  await p.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [
    'quadrant-web-data-v2',
    JSON.stringify(seed)
  ])
  await p.goto(`${base}?page=quadrant&sidebar=1&strict=0`, { waitUntil: 'load' })
  await p.waitForSelector('.event-card', { state: 'attached', timeout: 20000 })
  await p.waitForTimeout(700)
  return { context, page: p }
}

/* 打开「删除确认」弹窗：右键事件卡 → 点删除 */
async function openDialog(page, { sampleTimeline = false } = {}) {
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
  await page.waitForSelector('.gs-layer--menu .gs-plate', { timeout: 8000 })
  await page.waitForTimeout(340)

  /* 用 evaluate 触发点击，才能紧接着开始采样（locator.click 会等到稳定，错过动画） */
  const timeline = []
  if (sampleTimeline) {
    await page.evaluate(() => {
      window.__diag = []
      const t0 = performance.now()
      const tick = () => {
        const t = performance.now() - t0
        const plate = document.querySelector('.gs-layer--dialog .gs-plate')
        if (plate) {
          const pcs = getComputedStyle(plate)
          const anim = plate.parentElement?.querySelector('.gs-anim')
          const mask = plate.closest('.gs-layer--dialog')
          /* 抽出 backdrop-filter 里的滤镜 id，逐个查它还在不在 DOM 里 */
          const raw = pcs.backdropFilter || 'none'
          const url = /url\(["']?#([^"')]+)["']?\)/.exec(raw)
          const id = url ? url[1] : null
          const ref = id ? document.getElementById(id) : null
          window.__diag.push({
            t: +t.toFixed(0),
            bdf: raw,
            id,
            idInDom: !!ref,
            idTag: ref ? ref.tagName : null,
            opacity: pcs.opacity,
            transform: pcs.transform,
            bg: pcs.backgroundColor,
            animTransform: anim ? getComputedStyle(anim).transform : null,
            maskOpacity: mask ? getComputedStyle(mask).opacity : null,
            maskBg: mask ? getComputedStyle(mask).backgroundColor : null,
            plateW: +plate.getBoundingClientRect().width.toFixed(1)
          })
        }
        if (t < 1400) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await page
      .locator('.gs-layer--menu .context-item', { hasText: '删除' })
      .first()
      .evaluate((el) => el.click())
  } else {
    await page.locator('.gs-layer--menu .context-item', { hasText: '删除' }).first().click()
  }
  await page.waitForSelector('.gs-layer--dialog .gs-plate', { timeout: 8000 })
  if (sampleTimeline) {
    await page.waitForTimeout(1600)
    timeline.push(...(await page.evaluate(() => window.__diag || [])))
  } else {
    await page.waitForTimeout(520)
  }
  return timeline
}

const setCss = async (page, text) => {
  await page.evaluate((css) => {
    document.querySelectorAll('style.__probe').forEach((el) => el.remove())
    if (!css) return
    const s = document.createElement('style')
    s.className = '__probe'
    s.textContent = css
    document.head.appendChild(s)
  }, text)
}

const SAMPLE = () => {
  const plate = document.querySelector('.gs-layer--dialog .gs-plate')
  if (!plate) return null
  const pcs = getComputedStyle(plate)
  const raw = pcs.backdropFilter || 'none'
  const url = /url\(["']?#([^"')]+)["']?\)/.exec(raw)
  const id = url ? url[1] : null
  const mask = plate.closest('.gs-layer--dialog')
  const b = plate.getBoundingClientRect()
  return {
    bdf: raw,
    filterId: id,
    idInDom: id ? !!document.getElementById(id) : false,
    idTag: id ? document.getElementById(id)?.tagName ?? null : null,
    plateOpacity: pcs.opacity,
    plateTransform: pcs.transform,
    plateBackground: pcs.backgroundColor,
    plateBorderRadius: pcs.borderRadius,
    hasRefract: plate.classList.contains('gs-refract'),
    hasPopIn: plate.classList.contains('gs-pop-in'),
    maskOpacity: mask ? getComputedStyle(mask).opacity : null,
    maskBackground: mask ? getComputedStyle(mask).backgroundColor : null,
    rect: {
      x: Math.round(b.x),
      y: Math.round(b.y),
      w: Math.round(b.width),
      h: Math.round(b.height)
    },
    /* 稳定后 CSS 变量值，用于核对设置里的数值真的到了材质上 */
    vars: {
      blur: pcs.getPropertyValue('--gs-blur').trim(),
      sat: pcs.getPropertyValue('--gs-sat').trim(),
      fid: pcs.getPropertyValue('--gs-fid').trim(),
      tint: pcs.getPropertyValue('--gs-tint').trim()
    }
  }
}

/* 只关材质板自己的这两条，其余一律不碰 —— 差值就是"材质"的贡献 */
const MAT_OFF = `.gs-layer--dialog .gs-plate { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; background: transparent !important; }`

/*
 * 把 pop-in 的两个分量与原动画**分开**钉住。
 * 原动画是 `pop-in 0.2s cubic-bezier(...)`，from{opacity:0;transform:scale(0.94)}。
 *   FROZEN_MID : 用同一个 pop-in 关键帧，拉到 6s、停在 50%  → opacity .5 + scale .97
 *   NO_ANIM    : 直接去掉动画                              → opacity 1  + transform none
 *   ONLY_OP    : 只留 opacity 分量，压到 0.5，不加 transform
 *   ONLY_TF    : 只留 transform 分量 scale(0.97)，opacity 不动
 * 四个状态各拍「材质开 / 材质关」一对，就能确定是哪个分量在起作用。
 */
const A_FROZEN = `.gs-layer--dialog .gs-plate.gs-pop-in, .gs-layer--dialog .gs-anim.gs-pop-in { animation: pop-in 6s linear !important; animation-delay: -3s !important; animation-play-state: paused !important; }`
const A_NONE = `.gs-layer--dialog .gs-plate.gs-pop-in, .gs-layer--dialog .gs-anim.gs-pop-in { animation: none !important; }`
const A_ONLY_OP = `${A_NONE} .gs-layer--dialog .gs-plate { opacity: 0.5 !important; }`
const A_ONLY_TF = `${A_NONE} .gs-layer--dialog .gs-anim { transform: scale(0.97) !important; }`

const browser = await chromium.launch({ executablePath, headless: true })

const report = { states: {}, timeline: [], gradient: {}, env: {} }

/* ---------- 一、时间线：稳定前后到底变了什么 ---------- */
{
  const { context, page } = await newPage()
  const timeline = await openDialog(page, { sampleTimeline: true })
  report.timeline = timeline
  const info = await page.evaluate(SAMPLE)
  report.states.settled = info
  report.env.userAgent = await page.evaluate(() => navigator.userAgent)

  console.log('· 时间线（打开弹窗后逐帧，节选）')
  const pick = timeline.filter((r) => r.t % 100 < 40 || r.t > 1300)
  for (const r of pick.slice(0, 22)) {
    console.log(
      `    t=${String(r.t).padStart(4)}ms  opacity=${r.opacity}  transform=${r.transform}  ` +
        `anim=${r.animTransform}  plateW=${r.plateW}  id=${r.id}(${r.idInDom ? '在' : '失'})`
    )
  }
  const last = timeline[timeline.length - 1]
  if (last) {
    console.log(`    ↳ 末帧 t=${last.t}ms  bdf=${last.bdf}`)
    console.log(`       maskOpacity=${last.maskOpacity}  maskBg=${last.maskBg}`)
  }
  await context.close()
}

/* ---------- 二、像素：四个动画分量状态下材质各有多强，玻璃里还有没有模糊 ---------- */
{
  const { context, page } = await newPage()
  await openDialog(page)
  const settled = await page.evaluate(SAMPLE)
  /* Playwright 的 clip 要 width/height；rect 里是 w/h，这里显式换算 */
  const clip = {
    x: settled.rect.x,
    y: settled.rect.y,
    width: settled.rect.w,
    height: settled.rect.h
  }
  console.log(`\n· 稳定态样本  clip=${JSON.stringify(clip)}`)
  console.log(`    bdf        = ${settled.bdf}`)
  console.log(`    滤镜 id    = ${settled.filterId} → DOM 里${settled.idInDom ? '存在' : '**不存在**'} (${settled.idTag})`)
  console.log(`    plate      opacity=${settled.plateOpacity}  transform=${settled.plateTransform}`)
  console.log(`    mask       opacity=${settled.maskOpacity}  bg=${settled.maskBackground}`)
  console.log(`    vars       ${JSON.stringify(settled.vars)}`)

  const variants = [
    ['settled', '', settled],
    ['frozenMid', A_FROZEN, null],
    ['noAnim', A_NONE, null],
    ['onlyOpacity', A_ONLY_OP, null],
    ['onlyTransform', A_ONLY_TF, null]
  ]

  for (const [name, css, snap] of variants) {
    await setCss(page, css)
    await page.waitForTimeout(220)
    const info = await page.evaluate(SAMPLE)
    await page.screenshot({ path: `${outDir}/${name}-on.png`, clip })
    await setCss(page, `${css}\n${MAT_OFF}`)
    await page.waitForTimeout(220)
    await page.screenshot({ path: `${outDir}/${name}-off.png`, clip })
    await setCss(page, '')
    report.gradient[name] = {
      label: name,
      plateOpacity: info?.plateOpacity,
      plateTransform: info?.plateTransform,
      maskOpacity: info?.maskOpacity,
      bdf: info?.bdf,
      idInDom: info?.idInDom
    }
    console.log(
      `    ${name.padEnd(13)} opacity=${String(info?.plateOpacity).padEnd(5)} ` +
        `transform=${String(info?.plateTransform).padEnd(28)} idInDom=${info?.idInDom}`
    )
    if (snap === settled) report.states.settledProbe = info
  }

  /* 基线：同一位置、同一裁切，但**没有弹窗**（页面原样） */
  await setCss(page, `.modal-mask { display: none !important; }`)
  await page.waitForTimeout(260)
  await page.screenshot({ path: `${outDir}/baseline.png`, clip })
  await setCss(page, '')

  writeFileSync(`${outDir}/variants.json`, JSON.stringify(report, null, 2))
  await context.close()
}

await browser.close()
console.log(`\n截图与数据 → ${outDir}/`)
console.log('判读：scripts/dialog-settle-judge.py')
