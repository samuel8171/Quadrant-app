#!/usr/bin/env node
/**
 * 染色强度候选对比：同一次运行里只换 `--gs-tint`，各拍一帧。
 *
 * 背景：材质板修好之后，弹窗确实有材质了（材质开/关像素差 Δ≈4.4/255、91.7% 像素变化），
 * 但深色主题下「近黑的染色 + 34% 不透明度」叠在同样近黑的页面上 ≈ 没有可见填充，
 * 观感仍偏「镂空」。这里把几个候选一次性拍出来，供选型。
 *
 * 用法：node scripts/glass-tint-candidates.mjs --out tmp/glassMaterial/tint
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const ARG = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d
}
const executablePath = [
  process.env.UI_PROBE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean).find((p) => existsSync(p))
if (!executablePath) process.exit(2)

const port = ARG('port', '5199')
const outDir = ARG('out', 'tmp/glassMaterial/tint')
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

/* 候选：T0 = 现状，其余为「一眼能看出是一块面」的方向 */
const CANDIDATES = [
  ['T0-current', 'rgba(20,23,29,0.34)', '现状：近黑 34%'],
  ['T1-deep', 'rgba(20,23,29,0.62)', '同色加深：近黑 62%'],
  ['T2-cool', 'rgba(40,46,58,0.68)', '冷灰提亮：40,46,58 68%'],
  [
    'T3-ios',
    'linear-gradient(rgba(255,255,255,0.075), rgba(255,255,255,0.03)), rgba(18,20,26,0.55)',
    'iOS 深色材质风：白雾 7.5% + 近黑 55%'
  ]
]

const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  colorScheme: 'dark',
  isMobile: false
})
const page = await context.newPage()
await page.addInitScript(
  ([k, v]) => window.localStorage.setItem(k, v),
  ['quadrant-web-data-v2', JSON.stringify(seed)]
)
await page.goto(`http://127.0.0.1:${port}/probe.html?page=quadrant&sidebar=1&strict=0`, {
  waitUntil: 'load'
})
await page.waitForSelector('.event-card', { state: 'attached', timeout: 20000 })
await page.waitForTimeout(600)
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
await page.waitForTimeout(500)

const report = {}
for (const [tag, value, label] of CANDIDATES) {
  await page.evaluate((css) => {
    document.querySelectorAll('style.__tint').forEach((el) => el.remove())
    const s = document.createElement('style')
    s.className = '__tint'
    s.textContent = `:root, html { --gs-tint: ${css} !important; }`
    document.head.appendChild(s)
  }, value)
  await page.waitForTimeout(260)
  await page.screenshot({ path: `${outDir}/${tag}.png` })
  const box = await page.evaluate(() => {
    const el = document.querySelector('.gs-layer--dialog .gs-plate')
    const r = el.getBoundingClientRect()
    return {
      x: +r.x.toFixed(2),
      y: +r.y.toFixed(2),
      w: +r.width.toFixed(2),
      h: +r.height.toFixed(2),
      background: getComputedStyle(el).backgroundImage + ' | ' + getComputedStyle(el).backgroundColor
    }
  })
  report[tag] = { label, value, ...box }
  console.log(`${tag}  ${label}`)
  console.log(`   box ${JSON.stringify({ x: box.x, y: box.y, w: box.w, h: box.h })}`)
  console.log(`   background = ${box.background}`)
}
await page.evaluate(() => document.querySelectorAll('style.__tint').forEach((el) => el.remove()))
writeFileSync(`${outDir}/tint.json`, JSON.stringify(report, null, 2))
await browser.close()
