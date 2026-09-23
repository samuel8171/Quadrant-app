#!/usr/bin/env node
/**
 * 状态栏遮挡的像素级取证。
 *
 * 与 safearea-slider-probe 的区别：那个只量「元素 top 有没有下移 47px」，
 * 结论必然是"达标"，但用户看到的仍是「被虚化了一部分」。原因是：
 *
 *   iOS 的状态栏不是一条硬边——`env(safe-area-inset-top)` 给的是「安全区上界」，
 *   而状态栏那层半透明毛玻璃（背景虚化）实际覆盖到 **safe-top 再往下约 6~14px**，
 *   且越靠下虚化越弱。元素 top 只要落在 safe-top 上，它的**上半部分墨迹**就已经
 *   进了羽化区。
 *
 * 所以本探针量的是「标题墨迹（cap-height 上沿）相对 safe-top 的余量」，
 * 并把结论落成一句人话：还要再下移多少 px 才算干净。
 *
 * 用法：node scripts/statusbar-clearance-probe.mjs [--port 5199]
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

/**
 * 目标余量：标题墨迹上沿应至少比 safe-top 低这么多 px 才算脱离虚化区。
 *
 * 依据：状态栏毛玻璃的实心部分约 44~48px（含刘海/灵动岛），其下沿有 8~14px
 * 渐变羽化。取 12px 作为保守值——这样在 safe-top 本身就等于状态栏高度时，
 * 墨迹上沿距屏顶 ≈ safe-top + 12，落在羽化区之外。
 */
const CLEARANCE_TARGET = 12

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
        id: `we${d}-${k}`, date: key, title: `日程 ${k + 1}`,
        color: ['#8AB4F8', '#8CD9C1', '#F8B18C', '#B4A7E6'][(d + k) % 4],
        quadrant: ((d + k) % 4) + 1, startMin: s, endMin: s + 90,
        remark: '', showInQuadrant: false, createdAt: new Date().toISOString()
      })
    }
  }
  return {
    version: 2,
    goals: Array.from({ length: 3 }, (_, i) => ({
      id: `g${i}`, title: `目标 ${i + 1}`, type: 'long', done: false,
      remark: '', groupTitles: [], subtasks: [], order: i,
      createdAt: new Date().toISOString()
    })),
    events: [], weekPresets: [], weekEvents, weekCounterOffset: 0
  }
}

/* 三档机型：无刘海 / 刘海 / 灵动岛 */
const DEVICES = [
  { label: 'iPhone SE（无刘海）', safeTop: 20 },
  { label: 'iPhone 14（刘海）', safeTop: 47 },
  { label: 'iPhone 16 Pro（灵动岛）', safeTop: 59 }
]

const PAGES = [
  { name: 'review', sel: '.review-header h1', label: '复盘' },
  { name: 'quadrant', sel: '.page-header h1', label: '四象限' },
  { name: 'goals', sel: '.page-header h1', label: '目标' },
  { name: 'weekly', sel: '.page-header h1', label: '周计划' }
]

const browser = await chromium.launch({ executablePath })
const results = []

for (const dev of DEVICES) {
  for (const p of PAGES) {
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
    await page.waitForSelector(p.sel, { timeout: 20000 })
    await page.addStyleTag({
      content: `:root{--safe-top:${dev.safeTop}px !important;--app-height:844px !important;}`
    })
    await page.waitForTimeout(380)

    const m = await page.evaluate(
      ({ sel, safeTop }) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const cs = getComputedStyle(el)
        const fontSize = parseFloat(cs.fontSize)
        const lineHeightRaw = cs.lineHeight
        const lh = lineHeightRaw === 'normal' ? fontSize * 1.2 : parseFloat(lineHeightRaw)
        const rect = el.getBoundingClientRect()

        /*
         * 盒模型 top ≠ 墨迹上沿。行盒内文字垂直居中，墨迹（cap height）
         * 大约从行盒顶部下移 (lh - fontSize)/2 + fontSize*0.20。
         * 0.20 是常见无衬线字体的 ascent 之上留白比例。
         */
        const halfLeading = (lh - fontSize) / 2
        const inkOffset = halfLeading + fontSize * 0.2
        const inkTop = rect.top + inkOffset

        // 页面容器 padding-top，用于反推改哪里
        const container = el.closest(
          '.page, .quadrant-page, .weekly-page, .review-page, .day-page'
        )
        return {
          boxTop: Math.round(rect.top * 10) / 10,
          boxHeight: Math.round(rect.height * 10) / 10,
          inkTop: Math.round(inkTop * 10) / 10,
          fontSize: cs.fontSize,
          lineHeight: lineHeightRaw,
          computedLh: Math.round(lh * 10) / 10,
          padTop: container ? getComputedStyle(container).paddingTop : null,
          clearance: Math.round((inkTop - safeTop) * 10) / 10
        }
      },
      { sel: p.sel, safeTop: dev.safeTop }
    )

    results.push({ device: dev, page: p, m })
    await context.close()
  }
}

await browser.close()

const L = []
L.push('# 状态栏遮挡余量实测', '')
L.push(`生成时间：${new Date().toLocaleString('zh-CN')}`)
L.push('')
L.push(
  `**判定标准**：标题墨迹上沿相对 \`--safe-top\` 的余量应 ≥ **${CLEARANCE_TARGET}px**。`
)
L.push('')
L.push(
  '余量为 0 表示墨迹上沿恰好贴在安全区边界上——虽然"没被裁掉"，但上半截仍落在状态栏毛玻璃的羽化区里，肉眼看就是"被虚化了一部分"。'
)
L.push('')
L.push('| 机型 | 安全区 | 页面 | 盒 top | 墨迹 top | 余量 | 判定 |')
L.push('| --- | --- | --- | --- | --- | --- | --- |')
for (const r of results) {
  if (!r.m) {
    L.push(`| ${r.device.label} | ${r.device.safeTop} | ${r.page.label} | — | — | — | 元素缺失 |`)
    continue
  }
  const ok = r.m.clearance >= CLEARANCE_TARGET
  const short = Math.round((CLEARANCE_TARGET - r.m.clearance) * 10) / 10
  L.push(
    `| ${r.device.label} | ${r.device.safeTop} | ${r.page.label} | ${r.m.boxTop} | ${r.m.inkTop} | ${r.m.clearance} | ${ok ? '✅' : `❌ 还差 ${short}px`} |`
  )
}
L.push('')

/* 按页面汇总「需要追加多少 px」 */
L.push('## 需要追加的下移量', '')
L.push('')
const byPage = {}
for (const r of results) {
  if (!r.m) continue
  byPage[r.page.label] = byPage[r.page.label] || []
  byPage[r.page.label].push(r)
}
L.push('| 页面 | 最差余量 | 需追加 | 涉及机型 |')
L.push('| --- | --- | --- | --- |')
for (const [label, rs] of Object.entries(byPage)) {
  const worst = rs.reduce((a, b) => (a.m.clearance < b.m.clearance ? a : b))
  const need = Math.max(0, Math.ceil(CLEARANCE_TARGET - worst.m.clearance))
  L.push(
    `| ${label} | ${worst.m.clearance} | ${need > 0 ? `**+${need}px**` : '0'} | ${rs.filter((r) => r.m.clearance < CLEARANCE_TARGET).map((r) => r.device.label).join('、') || '—'} |`
  )
}
L.push('')
L.push('## 页面容器 padding-top 现状', '')
L.push('')
L.push('| 页面 | padding-top | h1 字号 | h1 行高（计算值） |')
L.push('| --- | --- | --- | --- |')
for (const p of PAGES) {
  const r = results.find((x) => x.page.name === p.name && x.m)
  if (!r) continue
  L.push(`| ${p.label} | \`${r.m.padTop}\` | ${r.m.fontSize} | ${r.m.computedLh} |`)
}
L.push('')

const report = L.join('\n')
console.log(report)
if (out) {
  const dir = dirname(out)
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(out, report, 'utf8')
  console.log(`\n报告已写入：${out}`)
}
