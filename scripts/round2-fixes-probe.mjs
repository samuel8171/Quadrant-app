#!/usr/bin/env node
/**
 * 第二轮四项修复的取证探针。
 *
 * 覆盖：
 *  1. 标题被状态栏虚化 —— 量「标题油墨起始 y」与「伪造状态栏底边」的关系
 *  2. 复盘滑块未填充段的颜色 vs 卡片背景 —— 量实际计算值
 *  3. 复盘标题与蓝条的对齐 —— 量两者的 top / height / 垂直中心
 *  4. 目标勾选框 —— 量 border-radius 与 :checked 的内阴影
 *
 * 桌面 `env(safe-area-inset-*)` 恒为 0，故伪造 --safe-top 复现 iPhone 场景。
 *
 * 用法：node scripts/round2-fixes-probe.mjs [--port 5199] [--shots dir] [--out file]
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

const FAKE_SAFE_TOP = 47
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
      done: i === 0, // 第一个打勾，用于量 :checked 样式
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

const browser = await chromium.launch({ executablePath })

async function openPage(name, { width = 390, height = 844 } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true
  })
  const page = await context.newPage()
  await page.addInitScript(
    ([key, payload]) => window.localStorage.setItem(key, payload),
    [DATA_KEY, JSON.stringify(seedData())]
  )
  await page.goto(`http://127.0.0.1:${port}/probe.html?page=${name}&strict=0&sidebar=1`, {
    waitUntil: 'load'
  })
  return { context, page }
}

const rows = []

/* ============ 问题 1：标题被状态栏虚化 ============ */
for (const p of [
  { name: 'review', sel: '.review-header h1', label: '复盘' },
  { name: 'quadrant', sel: '.page-header h1', label: '四象限' },
  { name: 'goals', sel: '.page-header h1', label: '目标' },
  { name: 'weekly', sel: '.page-header h1', label: '周计划' }
]) {
  const { context, page } = await openPage(p.name)
  await page.waitForSelector(p.sel, { timeout: 20000 })
  await page.waitForTimeout(420)

  const measure = async () => {
    const r = await page.evaluate(({ sel }) => {
      const el = document.querySelector(sel)
      if (!el) return null
      el.scrollIntoView({ block: 'start' })
      const b = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      const rootCs = getComputedStyle(document.documentElement)
      // 页面容器的顶部内边距
      const container = el.closest('.page, .quadrant-page, .weekly-page, .review-page, .day-page')
      return {
        inkTop: Math.round(b.top * 10) / 10,
        inkBottom: Math.round(b.bottom * 10) / 10,
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        safeTop: rootCs.getPropertyValue('--safe-top').trim(),
        containerPadTop: container ? getComputedStyle(container).paddingTop : null,
        navHeight: rootCs.getPropertyValue('--mobile-nav-height').trim()
      }
    }, p)
    return r
  }

  const noFake = await measure()
  await page.addStyleTag({ content: `:root{--safe-top:${FAKE_SAFE_TOP}px !important;--app-height:844px !important;}` })
  await page.waitForTimeout(320)
  const withFake = await measure()

  if (shots) {
    if (!existsSync(shots)) mkdirSync(shots, { recursive: true })
    await page.screenshot({ path: `${shots}/issue1-${p.name}.png` })
  }

  // 状态栏底边（模糊区下界）≈ safe-top + 一小段羽化，取 safe-top + 12 作为保守判定线
  const deadline = FAKE_SAFE_TOP + 12
  rows.push({
    label: p.label,
    sel: p.sel,
    inkTopNoFake: noFake?.inkTop ?? null,
    inkTopFake: withFake?.inkTop ?? null,
    delta: Math.round(((withFake?.inkTop ?? 0) - (noFake?.inkTop ?? 0)) * 10) / 10,
    deadline,
    safeTop: withFake?.safeTop,
    padTop: withFake?.containerPadTop,
    fontSize: withFake?.fontSize,
    ok: (withFake?.inkTop ?? 0) >= deadline
  })
  await context.close()
}

/* ============ 问题 2 & 3：复盘页颜色与对齐 ============ */
let reviewInfo = null
{
  const { context, page } = await openPage('review')
  await page.waitForSelector('.review-sliders', { timeout: 20000 })
  await page.waitForTimeout(500)

  reviewInfo = await page.evaluate(() => {
    const rgb = (s) => s
    const sliders = document.querySelector('.review-sliders')
    const cardBg = sliders ? rgb(getComputedStyle(sliders).backgroundColor) : null
    const cardBorder = sliders ? getComputedStyle(sliders).borderColor : null

    const row = document.querySelector('.review-slider-row')
    const rowBg = row ? getComputedStyle(row).backgroundColor : null

    const segs = [...document.querySelectorAll('.review-slider-segment')]
    const segColors = segs.slice(0, 3).map((s) => getComputedStyle(s).backgroundColor)

    const track = document.querySelector('.review-slider-track')
    const trackBg = track ? getComputedStyle(track).backgroundColor : null

    // 复盘页容器
    const pageEl = document.querySelector('.review-page')
    const pageBg = pageEl ? getComputedStyle(pageEl).backgroundColor : null

    // 对齐：标题与蓝条
    const h1 = document.querySelector('.review-header h1')
    const bar = document.querySelector('.review-header .title-underline')
    const header = document.querySelector('.review-header')
    const geometry = (el) => {
      if (!el) return null
      const b = el.getBoundingClientRect()
      return {
        top: Math.round(b.top * 10) / 10,
        bottom: Math.round(b.bottom * 10) / 10,
        left: Math.round(b.left * 10) / 10,
        height: Math.round(b.height * 10) / 10,
        width: Math.round(b.width * 10) / 10,
        centerY: Math.round((b.top + b.height / 2) * 10) / 10
      }
    }
    const hcs = h1 ? getComputedStyle(h1) : null
    const barCs = bar ? getComputedStyle(bar) : null

    return {
      cardBg,
      cardBorder,
      rowBg,
      segColors,
      trackBg,
      pageBg,
      header: geometry(header),
      headerFlexWrap: header ? getComputedStyle(header).flexWrap : null,
      headerAlign: header ? getComputedStyle(header).alignItems : null,
      h1: geometry(h1),
      h1LineHeight: hcs?.lineHeight,
      h1FontSize: hcs?.fontSize,
      bar: geometry(bar),
      barBg: barCs?.backgroundColor,
      barRadius: barCs?.borderRadius,
      // 垂直中心差：正数表示蓝条比标题低
      centerDelta: h1 && bar ? Math.round((geometry(bar).centerY - geometry(h1).centerY) * 10) / 10 : null
    }
  })

  if (shots) {
    if (!existsSync(shots)) mkdirSync(shots, { recursive: true })
    await page.screenshot({ path: `${shots}/review-full.png`, fullPage: true })
  }
  await context.close()
}

/* ============ 问题 4：目标勾选框 ============ */
let checkInfo = null
{
  const { context, page } = await openPage('goals')
  await page.waitForSelector('.goal-check', { timeout: 20000 })
  await page.waitForTimeout(500)

  checkInfo = await page.evaluate(() => {
    const wrap = document.querySelector('.goal-check')
    const marks = [...document.querySelectorAll('.goal-check .checkmark')]
    const info = (el) => {
      if (!el) return null
      const cs = getComputedStyle(el)
      const b = el.getBoundingClientRect()
      return {
        width: Math.round(b.width * 10) / 10,
        height: Math.round(b.height * 10) / 10,
        borderRadius: cs.borderRadius,
        border: `${cs.borderWidth} ${cs.borderStyle} ${cs.borderTopColor}`,
        background: cs.backgroundColor,
        boxShadow: cs.boxShadow,
        // 半径相对短边的比例：0.5 即正圆
        radiusRatio: null
      }
    }
    const out = {
      wrap: info(wrap),
      marks: marks.slice(0, 3).map((m) => {
        const r = info(m)
        const short = Math.min(r.width, r.height)
        const rad = parseFloat(r.borderRadius) || 0
        r.radiusRatio = short ? Math.round((rad / (short / 2)) * 100) / 100 : null
        return r
      }),
      // 找出已勾选的（input:checked）
      checkedCount: document.querySelectorAll('.goal-check input:checked').length,
      total: document.querySelectorAll('.goal-check input').length
    }
    // 已勾选那个 mark 的样式
    const checkedInput = document.querySelector('.goal-check input:checked')
    if (checkedInput) {
      const mark = checkedInput.parentElement.querySelector('.checkmark')
      const r = info(mark)
      const short = Math.min(r.width, r.height)
      const rad = parseFloat(r.borderRadius) || 0
      r.radiusRatio = short ? Math.round((rad / (short / 2)) * 100) / 100 : null
      out.checkedMark = r
    }
    return out
  })

  if (shots) {
    if (!existsSync(shots)) mkdirSync(shots, { recursive: true })
    await page.screenshot({ path: `${shots}/goals-checkbox.png` })
  }
  await context.close()
}

await browser.close()

/* ---------- 报告 ---------- */
const L = []
L.push('# 第二轮四项修复 · 实测取证', '')
L.push(`生成时间：${new Date().toLocaleString('zh-CN')}`)
L.push('')
L.push('---', '')
L.push('')
L.push('## 问题 1：标题是否被状态栏虚化', '')
L.push('')
L.push(`伪造 \`--safe-top = ${FAKE_SAFE_TOP}px\`。判定线 = safe-top + 12px 羽化 = **${FAKE_SAFE_TOP + 12}px**。`)
L.push('')
L.push('| 页面 | 标题 | 无安全区 top | 有安全区 top | 位移 | 判定线 | 判定 |')
L.push('| --- | --- | --- | --- | --- | --- | --- |')
for (const r of rows) {
  L.push(
    `| ${r.label} | \`${r.sel}\` | ${r.inkTopNoFake} | ${r.inkTopFake} | ${r.delta > 0 ? '+' : ''}${r.delta} | ${r.deadline} | ${r.ok ? '✅ 清晰' : `❌ 低于判定线 ${Math.round((r.deadline - r.inkTopFake) * 10) / 10}px`} |`
  )
}
L.push('')
L.push('容器内边距与字号：')
L.push('')
L.push('| 页面 | 页面容器 padding-top | h1 字号 | 安全区变量 |')
L.push('| --- | --- | --- | --- |')
for (const r of rows) {
  L.push(`| ${r.label} | \`${r.padTop}\` | ${r.fontSize} | \`${r.safeTop}\` |`)
}
L.push('')
L.push('---', '')
L.push('')
L.push('## 问题 2：复盘滑块未填充段 vs 卡片背景', '')
L.push('')
if (reviewInfo) {
  L.push(`- 页面背景 \`.review-page\`：\`${reviewInfo.pageBg}\``)
  L.push(`- 滑块卡片 \`.review-sliders\` 背景：\`${reviewInfo.cardBg}\`，描边 \`${reviewInfo.cardBorder}\``)
  L.push(`- 每行 \`.review-slider-row\` 背景：\`${reviewInfo.rowBg}\``)
  L.push(`- 轨道 \`.review-slider-track\` 背景：\`${reviewInfo.trackBg}\``)
  L.push(`- 前三段 \`.review-slider-segment\` 背景：${reviewInfo.segColors.map((c) => `\`${c}\``).join(' / ')}`)
  L.push('')
  const segSet = [...new Set(reviewInfo.segColors)]
  L.push(
    segSet.length === 1 && segSet[0] === reviewInfo.cardBg
      ? '✅ 未填充段与卡片背景一致。'
      : `❌ 未填充段（${segSet.join(', ')}）与卡片背景（${reviewInfo.cardBg}）**不一致**——这就是用户看到的"颜色未统一"。`
  )
  if (reviewInfo.rowBg && reviewInfo.rowBg !== 'rgba(0, 0, 0, 0)') {
    L.push(`⚠️ 注意每行还有一层额外底色 \`${reviewInfo.rowBg}\`，叠加在卡片之上，构成第二处不一致。`)
  }
} else {
  L.push('未取到复盘页数据。')
}
L.push('')
L.push('---', '')
L.push('')
L.push('## 问题 3：复盘标题与蓝条对齐', '')
L.push('')
if (reviewInfo) {
  const { h1, bar, header } = reviewInfo
  L.push(`\`.review-header\`：flex-wrap \`${reviewInfo.headerFlexWrap}\`，align-items \`${reviewInfo.headerAlign}\``)
  L.push('')
  L.push('| 元素 | top | bottom | 高 | 垂直中心 |')
  L.push('| --- | --- | --- | --- | --- |')
  if (h1) L.push(`| \`h1\`（周日复盘） | ${h1.top} | ${h1.bottom} | ${h1.height} | ${h1.centerY} |`)
  if (bar) L.push(`| \`.title-underline\`（蓝条） | ${bar.top} | ${bar.bottom} | ${bar.height} | ${bar.centerY} |`)
  L.push('')
  L.push(`- h1 行高：\`${reviewInfo.h1LineHeight}\`，字号 \`${reviewInfo.h1FontSize}\``)
  L.push(`- 蓝条：\`${bar?.width}×${bar?.height}\`，底色 \`${reviewInfo.barBg}\`，圆角 \`${reviewInfo.barRadius}\``)
  L.push('')
  const d = reviewInfo.centerDelta
  L.push(
    d === null
      ? '未能比对。'
      : Math.abs(d) <= 1.5
        ? `✅ 垂直中心差 ${d}px，已对齐。`
        : `❌ 蓝条垂直中心比标题低 **${d}px**——标题若换行会更高，差距还会拉大。`
  )
} else {
  L.push('未取到复盘页数据。')
}
L.push('')
L.push('---', '')
L.push('')
L.push('## 问题 4：目标勾选框', '')
L.push('')
if (checkInfo) {
  L.push(`共 ${checkInfo.total} 个勾选框，其中 ${checkInfo.checkedCount} 个已勾选。`)
  L.push('')
  L.push('| 状态 | 尺寸 | border-radius | radiusRatio（0.5=正圆） | 边框 | 底色 | box-shadow |')
  L.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const [i, m] of checkInfo.marks.entries()) {
    if (!m) continue
    L.push(
      `| 未勾选#${i + 1} | ${m.width}×${m.height} | ${m.borderRadius} | ${m.radiusRatio} | ${m.border} | ${m.background} | ${m.boxShadow} |`
    )
  }
  const cm = checkInfo.checkedMark
  if (cm) {
    L.push(
      `| **已勾选** | ${cm.width}×${cm.height} | ${cm.borderRadius} | ${cm.radiusRatio} | ${cm.border} | ${cm.background} | ${cm.boxShadow} |`
    )
  }
  L.push('')
  const target = { coreR: 22, gap: 5, ring: 5.5, outerR: 33 }
  L.push(`参考图目标形态：实心核 r≈${target.coreR}px → 浅色间隙 ≈${target.gap}px → 圆环 ≈${target.ring}px，外径 r≈${target.outerR}px（核:环 ≈ 4:1，间隙占外径 ≈15%）。`)
} else {
  L.push('未取到目标页数据。')
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
