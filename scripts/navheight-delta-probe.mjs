#!/usr/bin/env node
/**
 * 底部导航增高（58px → 66px）的代价实测（开发期工具）。
 *
 * 目的：把「导航条高了 8px，内容区实际少了多少」量成数字，而不是靠读 CSS 推断。
 *
 * 做法：先量当前构建的真实几何，再在同一个页面里注入一段 CSS 把导航的几条相关
 * 变量/尺寸改回改动前的值（58px 导航高、6px 内边距、22px 圆角、46px 按钮），
 * 重新量一次。两次相减即得代价。同一次运行内对表，避免回滚代码。
 *
 * 前置（另开终端）：
 *   ./node_modules/.bin/vite --config vite.web.config.ts --port 5199 --host 127.0.0.1 --strictPort
 *
 * 用法：
 *   node scripts/navheight-delta-probe.mjs
 *   node scripts/navheight-delta-probe.mjs --out docs/probes/navheight-delta.md
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { chromium } from 'playwright-core'

const ARG = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}

const BROWSER_CANDIDATES = [
  process.env.UI_PROBE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome'
].filter(Boolean)

const DATA_KEY = 'quadrant-web-data-v2'
const port = ARG('port', '5199')
const out = ARG('out', '')

const executablePath = BROWSER_CANDIDATES.find((p) => existsSync(p))
if (!executablePath) {
  console.error(`未找到可用浏览器，请设置 UI_PROBE_BROWSER。已尝试：\n${BROWSER_CANDIDATES.join('\n')}`)
  process.exit(2)
}

function iso(dayOffset = 0) {
  const d = new Date(Date.UTC(2026, 8, 17, 2, 0, 0) + dayOffset * 86400000)
  return d.toISOString()
}

function seedData() {
  const colors = ['#8AB4F8', '#8CD9C1', '#F8B18C', '#B4A7E6']
  const monday = new Date(Date.UTC(2026, 8, 14, 12, 0, 0))
  const weekEvents = []
  for (let d = 0; d < 7; d++) {
    const date = new Date(monday.getTime() + d * 86400000)
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
    for (let k = 0; k < 4; k++) {
      const startMin = 480 + k * 150
      weekEvents.push({
        id: `we${d}-${k}`,
        date: key,
        title: `日程 ${k + 1}`,
        color: colors[(d + k) % 4],
        quadrant: ((d + k) % 4) + 1,
        startMin,
        endMin: startMin + 90,
        remark: '',
        showInQuadrant: false,
        createdAt: iso(d)
      })
    }
  }
  const goals = Array.from({ length: 8 }, (_, i) => ({
    id: `g${i}`,
    title: `目标 ${i + 1}`,
    type: i % 2 === 0 ? 'long' : 'short',
    done: false,
    remark: '备注',
    groupTitles: ['阶段一', '阶段二'],
    subtasks: Array.from({ length: 6 }, (_, s) => ({
      id: `g${i}s${s}`,
      title: `子目标 ${s + 1}`,
      done: false,
      group: s % 2,
      remark: '',
      order: s
    })),
    order: i,
    createdAt: iso(i)
  }))
  const events = Array.from({ length: 8 }, (_, i) => ({
    id: `q${i}`,
    text: `象限任务 ${i + 1}`,
    remark: '',
    quadrant: (i % 4) + 1,
    x: 60 + (i % 4) * 120,
    y: 40 + Math.floor(i / 4) * 90,
    width: 110,
    createdAt: iso(i)
  }))
  return { version: 2, goals, events, weekPresets: [], weekEvents, weekCounterOffset: 0 }
}

/* 改动前（HEAD）的导航相关尺寸。数字取自 git show HEAD:.../theme.css。 */
const BEFORE_CSS = `
:root { --mobile-nav-height: 58px; }
@media (max-width: 767px) {
  .sidebar { padding: 6px 8px; border-radius: 22px; }
  .nav-indicator { border-radius: 20px; }
  .nav-item { border-radius: 20px; }
  .sync-button, .login-button { top: 6px; height: 46px; }
  .page, .quadrant-page, .weekly-page, .review-page, .day-page {
    padding: 12px 12px calc(16px + var(--mobile-nav-height) + env(safe-area-inset-bottom));
  }
  .quadrant-header { top: 12px; }
}
`

/** 关注「内容区净高」与「导航条自身尺寸」。 */
async function measure(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('.sidebar')
    const navRect = nav.getBoundingClientRect()
    const item = document.querySelector('.nav-item')
    const itemRect = item.getBoundingClientRect()
    const sync = document.querySelector('.sync-button')
    const pageEl = document.querySelector('.page, .quadrant-page, .weekly-page')
    const cs = pageEl ? getComputedStyle(pageEl) : null
    return {
      navH: Math.round(navRect.height),
      navTop: Math.round(navRect.top),
      navRadius: Math.round(parseFloat(getComputedStyle(nav).borderRadius) || 0),
      navPadY: Math.round(parseFloat(getComputedStyle(nav).paddingTop) || 0),
      itemH: Math.round(itemRect.height),
      itemRadius: Math.round(parseFloat(getComputedStyle(item).borderRadius) || 0),
      syncH: sync ? Math.round(sync.getBoundingClientRect().height) : 0,
      syncTop: sync ? Math.round(sync.getBoundingClientRect().top) : 0,
      pagePadTop: cs ? Math.round(parseFloat(cs.paddingTop) || 0) : 0,
      pagePadBottom: cs ? Math.round(parseFloat(cs.paddingBottom) || 0) : 0,
      viewportH: window.innerHeight,
      /** 内容区净高：视口高 - 导航占位高度（含其上方 10px 边距近似）。 */
      contentH: Math.round(navRect.top)
    }
  })
}

const browser = await chromium.launch({ executablePath, headless: true })
const viewports = [
  { w: 375, h: 667 },
  { w: 390, h: 844 },
  { w: 430, h: 932 }
]

const rows = []

for (const vp of viewports) {
  const label = `${vp.w}x${vp.h}`
  const context = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true
  })
  const page = await context.newPage()
  await page.addInitScript(
    ([key, payload]) => window.localStorage.setItem(key, payload),
    [DATA_KEY, JSON.stringify(seedData())]
  )
  await page.goto(`http://127.0.0.1:${port}/probe.html?page=goals&strict=0&sidebar=1`, {
    waitUntil: 'load'
  })
  await page.waitForSelector('.sidebar', { timeout: 20000 })
  await page.waitForTimeout(450)

  const after = await measure(page)

  /* 注回改动前的导航尺寸，重新量一次。 */
  await page.addStyleTag({ content: BEFORE_CSS })
  await page.waitForTimeout(320)
  const before = await measure(page)

  rows.push({ label, before, after })
  await context.close()
}

await browser.close()

/* ---------------------------------------------------------------- 报告 */

const lines = []
lines.push('# 底部导航 58px → 66px 的几何代价实测', '')
lines.push(`生成时间：${new Date().toLocaleString('zh-CN')}`)
lines.push('')
lines.push('方法：同一页面内先后测量「当前构建」与「注回改动前尺寸」，避免回滚代码。')
lines.push('')
lines.push('| 指标 | 375×667 | 390×844 | 430×932 |')
lines.push('| --- | --- | --- | --- |')

const metrics = [
  ['导航条高', 'navH', 'px'],
  ['导航条内边距(纵)', 'navPadY', 'px'],
  ['导航条圆角', 'navRadius', 'px'],
  ['单个入口高', 'itemH', 'px'],
  ['入口圆角', 'itemRadius', 'px'],
  ['右上按钮高', 'syncH', 'px'],
  ['右上按钮顶边', 'syncTop', 'px'],
  ['页面 padding-top', 'pagePadTop', 'px'],
  ['页面 padding-bottom', 'pagePadBottom', 'px'],
  ['导航顶边(=内容净高)', 'contentH', 'px']
]

for (const [name, key, unit] of metrics) {
  const cells = rows.map((r) => {
    const b = r.before[key]
    const a = r.after[key]
    const d = a - b
    const sign = d > 0 ? '+' : ''
    return d === 0 ? `${a}${unit}` : `${a}${unit}（${sign}${d}）`
  })
  lines.push(`| ${name} | ${cells.join(' | ')} |`)
}

lines.push('')
lines.push('## 结论', '')
const r0 = rows[1] ?? rows[0]
const lossContent = r0.before.contentH - r0.after.contentH
const gainNav = r0.after.navH - r0.before.navH
const gainItem = r0.after.itemH - r0.before.itemH
lines.push(
  `- 导航条本体增高 **${gainNav}px**（58 → 66），单个入口触控高从 ${r0.before.itemH}px 增到 **${r0.after.itemH}px**（+${gainItem}）。`
)
lines.push(
  `- 代价：内容区净高从 ${r0.before.contentH}px 减到 **${r0.after.contentH}px**，即 **-${lossContent}px**（视口高的 ${((lossContent / r0.after.viewportH) * 100).toFixed(1)}%）。`
)
lines.push(
  `- 入口触控高 ${r0.after.itemH}px 已明显超过 iOS HIG 的 44px 下限，达到 ${(r0.after.itemH / 44).toFixed(1)}×；此前 ${r0.before.itemH}px 是刚好过线。`
)
lines.push('')

const report = lines.join('\n')
console.log(report)

if (out) {
  const dir = dirname(out)
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(out, report, 'utf8')
  console.log(`\n报告已写入：${out}`)
}
