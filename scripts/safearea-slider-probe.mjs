#!/usr/bin/env node
/**
 * 安全区与滑块投影的取证探针。
 *
 * 覆盖问题 2（顶部避让状态栏）与问题 4（滑块下方灰影）。
 *
 * **为什么必须在桌面浏览器里伪造安全区**：桌面 `env(safe-area-inset-*)` 恒为 0，
 * 直接量出来永远是 0，证明不了修复。这里用 CSS 覆盖把 `--safe-top` 钉成 47px
 * （iPhone 灵动岛机型的典型值），再量页面顶部第一个内容元素的位置。
 *
 * 用法：node scripts/safearea-slider-probe.mjs
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { chromium } from 'playwright-core'

const ARG = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}

const executablePath = [
  process.env.UI_PROBE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].filter(Boolean).find((p) => existsSync(p))

const DATA_KEY = 'quadrant-web-data-v2'
const port = ARG('port', '5199')
const out = ARG('out', '')
const shots = ARG('shots', '')

/** 伪造的安全区值（px），取自 iPhone 灵动岛机型的状态栏高。 */
const FAKE_SAFE_TOP = 47
const FAKE_SAFE_BOTTOM = 34

const p2 = (n) => String(n).padStart(2, '0')
function mondayKey() {
  const d = new Date()
  const dow = (d.getDay() + 6) % 7
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow)
  return `${m.getFullYear()}-${p2(m.getMonth() + 1)}-${p2(m.getDate())}`
}
function seedData() {
  const [my, mm, md] = mondayKey().split('-').map(Number)
  const monday = new Date(my, mm - 1, md, 12, 0, 0)
  const weekEvents = []
  for (let d = 0; d < 7; d++) {
    const dt = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + d, 12, 0, 0)
    const key = `${dt.getFullYear()}-${p2(dt.getMonth() + 1)}-${p2(dt.getDate())}`
    for (let k = 0; k < 4; k++) {
      const s = 480 + k * 150
      weekEvents.push({
        id: `we${d}-${k}`,
        date: key,
        title: `日程 ${k + 1}`,
        color: ['#8AB4F8', '#8CD9C1', '#F8B18C', '#B4A7E6'][(d + k) % 4],
        quadrant: ((d + k) % 4) + 1,
        startMin: s,
        endMin: s + 90,
        remark: '',
        showInQuadrant: false,
        createdAt: new Date().toISOString()
      })
    }
  }
  return {
    version: 2,
    goals: Array.from({ length: 3 }, (_, i) => ({
      id: `g${i}`,
      title: `目标 ${i + 1}`,
      type: 'long',
      done: false,
      remark: '',
      groupTitles: [],
      subtasks: [],
      order: i,
      createdAt: new Date().toISOString()
    })),
    events: [],
    weekPresets: [],
    weekEvents,
    weekCounterOffset: 0
  }
}

const browser = await chromium.launch({ executablePath, headless: true })

/* 伪造安全区：直接覆盖 CSS 变量。--safe-top 是本项目统一入口；
   standalone 高度校正那套规则也用同一批变量。 */
const FAKE_CSS = `
:root {
  --safe-top: ${FAKE_SAFE_TOP}px !important;
  --app-height: 844px !important;
}
`

const pages = [
  { name: 'quadrant', sel: '.page-header', label: '四象限' },
  { name: 'weekly', sel: '.page-header, .day-topbar', label: '周计划' },
  { name: 'goals', sel: '.page-header', label: '目标' },
  { name: 'review', sel: '.review-header', label: '复盘' }
]

const rows = []

for (const p of pages) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true
  })
  const page = await context.newPage()
  await page.addInitScript(
    ([key, payload]) => window.localStorage.setItem(key, payload),
    [DATA_KEY, JSON.stringify(seedData())]
  )
  await page.goto(`http://127.0.0.1:${port}/probe.html?page=${p.name}&strict=0&sidebar=1`, {
    waitUntil: 'load'
  })
  await page.waitForSelector('.sidebar', { timeout: 20000 })
  await page.waitForTimeout(500)

  const measure = async (label) =>
    page.evaluate(
      ({ sel }) => {
        const el = document.querySelector(sel)
        const nav = document.querySelector('.sidebar')
        const cs = getComputedStyle(document.documentElement)
        return {
          selTop: el ? Math.round(el.getBoundingClientRect().top) : null,
          safeTop: cs.getPropertyValue('--safe-top').trim(),
          navTop: nav ? Math.round(nav.getBoundingClientRect().top) : null
        }
      },
      { sel: p.sel }
    )

  const withoutFake = await measure('no-fake')
  await page.addStyleTag({ content: FAKE_CSS })
  await page.waitForTimeout(320)
  const withFake = await measure('fake')

  if (shots) {
    if (!existsSync(shots)) mkdirSync(shots, { recursive: true })
    await page.screenshot({ path: `${shots}/${p.name}-safetop-${FAKE_SAFE_TOP}.png` })
  }

  rows.push({
    label: p.label,
    selector: p.sel,
    topNoFake: withoutFake.selTop,
    topFake: withFake.selTop,
    delta: (withFake.selTop ?? 0) - (withoutFake.selTop ?? 0),
    safeTop: withFake.safeTop
  })

  await context.close()
}

/* ---------- 问题 4：滑块投影 ---------- */
let sliderInfo = null
{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true
  })
  const page = await context.newPage()
  await page.addInitScript(
    ([key, payload]) => window.localStorage.setItem(key, payload),
    [DATA_KEY, JSON.stringify(seedData())]
  )
  await page.goto(`http://127.0.0.1:${port}/probe.html?page=review&strict=0&sidebar=1`, {
    waitUntil: 'load'
  })
  await page.waitForSelector('.review-page', { timeout: 20000 })
  await page.waitForTimeout(500)
  sliderInfo = await page.evaluate(() => {
    const t = document.querySelector('.review-slider-thumb')
    if (!t) return { found: false }
    const cs = getComputedStyle(t)
    return {
      found: true,
      boxShadow: cs.boxShadow,
      border: cs.border,
      radius: cs.borderRadius,
      hasShadow: cs.boxShadow !== 'none' && cs.boxShadow !== ''
    }
  })
  if (shots) await page.screenshot({ path: `${shots}/review-slider.png` })
  await context.close()
}

await browser.close()

const lines = []
lines.push('# 安全区避让与滑块投影实测', '')
lines.push(`生成时间：${new Date().toLocaleString('zh-CN')}`)
lines.push('')
lines.push(`伪造 \`--safe-top = ${FAKE_SAFE_TOP}px\`（iPhone 灵动岛状态栏典型值）。`)
lines.push('')
lines.push('## 问题 2：顶部内容是否随安全区下移')
lines.push('')
lines.push('| 页面 | 顶部元素 | 安全区=0 时 top | 安全区=47px 时 top | 位移 | 判定 |')
lines.push('| --- | --- | --- | --- | --- | --- |')
for (const r of rows) {
  lines.push(
    `| ${r.label} | \`${r.selector}\` | ${r.topNoFake} | ${r.topFake} | ${r.delta > 0 ? '+' : ''}${r.delta} | ${r.delta === FAKE_SAFE_TOP ? '✅ 恰好下移 47px' : r.delta > 0 ? `⚠️ 下移 ${r.delta}px（非 47）` : '❌ 未下移'} |`
  )
}
lines.push('')
lines.push('## 问题 4：复盘滑块投影')
lines.push('')
if (sliderInfo?.found) {
  lines.push(`- \`box-shadow\`: \`${sliderInfo.boxShadow}\``)
  lines.push(`- \`border\`: \`${sliderInfo.border}\``)
  lines.push(`- \`border-radius\`: \`${sliderInfo.radius}\``)
  lines.push('')
  lines.push(
    sliderInfo.hasShadow
      ? '❌ 仍存在投影——滑块下方会有灰影。'
      : '✅ 已无投影（`box-shadow: none`），只剩 2px 描边。'
  )
} else {
  lines.push('未找到 `.review-slider-thumb`。')
}
lines.push('')

const report = lines.join('\n')
console.log(report)
if (out) {
  const dir = dirname(out)
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(out, report, 'utf8')
  console.log(`报告已写入：${out}`)
}
