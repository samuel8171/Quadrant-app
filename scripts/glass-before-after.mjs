#!/usr/bin/env node
/**
 * 修复前 / 修复后 对照截图采集。
 *
 * 修复前的真实截图已存档在 tmp/glassCause/00-pristine.png（同一页面、同一视口、
 * 同一弹窗位置，取自修复前的构建），这里只补"修复后"的对应帧，保证两者可直接并排。
 * 同时拍一帧「故障态臂」：把材质板关掉、库的 warp 重新显示。
 * ⚠️ 该臂**只是故障态示意，不是修复前的忠实复现**——warp 参与面板的 shrink-to-fit，
 *    重新显示它会改变面板尺寸与位置（实测 face 从 342×170 变成 179×170 并位移）。
 *    真正可信的"修复前"是 tmp/glassCause 里的存档帧。
 *
 * 用法：node scripts/glass-before-after.mjs --out tmp/glassMaterial/ba
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const ARG = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d
}
const CANDIDATES = [
  process.env.UI_PROBE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean)
const executablePath = CANDIDATES.find((p) => existsSync(p))
if (!executablePath) process.exit(2)

const port = ARG('port', '5199')
const outDir = ARG('out', 'tmp/glassMaterial/ba')
const base = `http://127.0.0.1:${port}/probe.html`
mkdirSync(outDir, { recursive: true })

const iso = (i) => new Date(Date.now() - i * 3600_000).toISOString()
const mondayKey = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/* 必须与 scripts/glass-material-probe.mjs 的 seed 逐字段一致：
   AppData 少字段会被 validAppData 判为非法 → 应用重置 → 画布上一个块都没有 */
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
const results = {}

for (const [tag, width, height] of [
  ['mobile', 390, 844],
  ['desktop', 1280, 800]
]) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    isMobile: false
  })
  const page = await context.newPage()
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    ['quadrant-web-data-v2', JSON.stringify(seed)]
  )
  await page.goto(`${base}?page=quadrant&sidebar=1&strict=0`, { waitUntil: 'load' })
  await page.waitForSelector('.event-card', { state: 'attached', timeout: 20000 })
  await page.waitForTimeout(600)

  // 打开右键菜单 → 点「删除」→ 打开确认弹窗
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
  await page.locator('.gs-layer--menu .context-item', { hasText: '删除' }).first().click()
  await page.waitForSelector('.gs-layer--dialog .gs-plate', { timeout: 8000 })
  await page.waitForTimeout(500) // 等入场动画结束，几何收敛

  const probe = () => {
    const q = (s) => {
      const el = document.querySelector(s)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) }
    }
    const plate = document.querySelector('.gs-layer--dialog .gs-plate')
    const panel = document.querySelector('.gs-layer--dialog .gs-panel')
    const warp = document.querySelector('.gs-layer--dialog .gs-panel .glass__warp')
    return {
      plate: q('.gs-layer--dialog .gs-plate'),
      face: q('.gs-layer--dialog .glass'),
      engine: plate?.closest('.gs-layer')?.dataset.glassEngine ?? '',
      panelTransform: panel ? getComputedStyle(panel).transform : null,
      plateBackdrop: plate ? getComputedStyle(plate).backdropFilter : null,
      warpDisplay: warp ? getComputedStyle(warp).display : null,
      warpFilter: warp ? getComputedStyle(warp).filter : null
    }
  }

  await page.screenshot({ path: `${outDir}/${tag}-after.png` })

  /* 故障态对照臂：把材质栈还原成修复前的样子 —— 只有库的 warp 承担材质
     （材质板隐藏 + warp 重新显示）。材质板是**纯增量**的，关掉它就等于回退到旧结构。 */
  await page.addStyleTag({
    content: `
      .gs-plate { display: none !important; }
      .gs-panel .glass__warp { display: block !important; }
    `
  })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${outDir}/${tag}-before-arm.png` })
  const beforeArm = await page.evaluate(probe)
  results[`${tag}-beforeArm`] = beforeArm
  console.log(`   [故障态臂] plate ${JSON.stringify(beforeArm.plate)}`)
  console.log(`   [故障态臂] warp display=${beforeArm.warpDisplay} filter=${beforeArm.warpFilter}`)
  console.log(
    `   [故障态臂] 面板位移：plate ${JSON.stringify(beforeArm.plate)} vs face ${JSON.stringify(beforeArm.face)}`
  )
  await page.evaluate(() => {
    document.querySelectorAll('style').forEach((s) => {
      if (s.textContent.includes('.gs-panel .glass__warp')) s.remove()
    })
  })
  await page.waitForTimeout(300)

  const after = await page.evaluate(probe)
  results[tag] = after
  console.log(`${tag} ${width}x${height}  engine=${after.engine}`)
  console.log(`   plate ${JSON.stringify(after.plate)}`)
  console.log(`   face  ${JSON.stringify(after.face)}`)
  console.log(`   plate backdrop-filter = ${after.plateBackdrop}`)
  console.log(`   warp display=${after.warpDisplay} filter=${after.warpFilter}`)
  await context.close()
}

writeFileSync(`${outDir}/boxes.json`, JSON.stringify(results, null, 2))
await browser.close()
