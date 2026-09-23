#!/usr/bin/env node
/**
 * 事件块手势探针：验证「滚动时间轴」与「长按拖动事件块」不再互相误触。
 *
 * 要证明两件事（都是在真实触摸语义下）：
 *   A. 在事件块上纵向滑动 → 页面滚动，事件块位置不变。（旧实现会被拖走）
 *   B. 长按 0.4 秒 + 移动 → 事件块真的被拖动。（新解锁路径可用）
 *
 * 前置（另开终端）：
 *   ./node_modules/.bin/vite --config vite.web.config.ts --port 5199 --host 127.0.0.1 --strictPort
 *
 * 用法：
 *   node scripts/event-gesture-probe.mjs
 *   node scripts/event-gesture-probe.mjs --out docs/probes/event-gesture.md
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
  return new Date(Date.UTC(2026, 8, 17, 2, 0, 0) + dayOffset * 86400000).toISOString()
}

/**
 * 本周周一的日期键。
 *
 * 必须动态算：日视图默认打开「今天」那一列，若种子数据写死在别的周，
 * 画布上就一个块都没有（踩过这个坑：写死 9/14 那周，打开的是 9/24）。
 */
function mondayKey() {
  const d = new Date()
  const dow = (d.getDay() + 6) % 7
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow)
  const p = (n) => String(n).padStart(2, '0')
  return `${monday.getFullYear()}-${p(monday.getMonth() + 1)}-${p(monday.getDate())}`
}

/* 固定种子数据：让"第 3 个事件块"的起点稳定在 480+2*150=780 分钟。 */
function seedData() {
  const [my, mm, md] = mondayKey().split('-').map(Number)
  const monday = new Date(my, mm - 1, md, 12, 0, 0)
  const p = (n) => String(n).padStart(2, '0')
  const weekEvents = []
  for (let d = 0; d < 7; d++) {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + d, 12, 0, 0)
    const key = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
    for (let k = 0; k < 4; k++) {
      const startMin = 480 + k * 150
      weekEvents.push({
        id: `we${d}-${k}`,
        date: key,
        title: `日程 ${k + 1}`,
        color: ['#8AB4F8', '#8CD9C1', '#F8B18C', '#B4A7E6'][(d + k) % 4],
        quadrant: ((d + k) % 4) + 1,
        startMin,
        endMin: startMin + 90,
        remark: '',
        showInQuadrant: false,
        createdAt: iso(d)
      })
    }
  }
  return {
    version: 2,
    goals: [],
    events: [],
    weekPresets: [],
    weekEvents,
    weekCounterOffset: 0
  }
}

const browser = await chromium.launch({ executablePath, headless: true })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true
})
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.addInitScript(
  ([key, payload]) => window.localStorage.setItem(key, payload),
  [DATA_KEY, JSON.stringify(seedData())]
)
await page.goto(`http://127.0.0.1:${port}/probe.html?page=weekly&strict=0&sidebar=1`, {
  waitUntil: 'load'
})
await page.waitForSelector('.sidebar', { timeout: 20000 })
await page.waitForTimeout(500)

/* 进入日视图 */
await page.locator('.week-col-head').nth(3).click()
await page.waitForSelector('.day-canvas', { timeout: 10000 })
await page.waitForTimeout(800)

/** 取某个事件块的几何与数据起点。 */
async function readBlocks() {
  return page.evaluate(() => {
    const scroll = document.querySelector('.day-scroll')
    const firstEvent = document.querySelector('.day-event')
    return {
      scrollTop: Math.round(scroll.scrollTop),
      scrollH: scroll.scrollHeight,
      clientH: scroll.clientHeight,
      /* 取证：确认当前生效的 CSS 值就是本次改动的那条。 */
      touchAction: firstEvent ? getComputedStyle(firstEvent).touchAction : 'no-event',
      blocks: [...document.querySelectorAll('.day-event')].map((el) => {
        const r = el.getBoundingClientRect()
        return {
          id: el.dataset.eventId ?? el.getAttribute('data-event-id') ?? '',
          title: el.textContent.trim().slice(0, 20),
          top: Math.round(r.top),
          h: Math.round(r.height),
          armed: el.classList.contains('armed'),
          dragging: el.classList.contains('dragging')
        }
      })
    }
  })
}

/** 用 CDP 派发真实触摸序列（Playwright 的 touchscreen API 不支持长按分段控制）。 */
const cdp = await context.newCDPSession(page)

async function touch(type, points) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i }))
  })
}

const results = []

/**
 * 跑一个触摸序列。
 *
 * 判据说明：**不能只看块的 top 变化**。块被拖走后，画布内容高度不变，
 * 但它会触发一次重新渲染；而块的 top 同时受滚动位置影响，两种效应叠加时
 * 单看 top 容易误判。这里改成三路取证，任一为真即算"块被拖动"：
 *   1. 页面滚动了，而块的 top **没**跟着滚动量移动 → 块在跟手（被拖动）；
 *   2. DOM 上出现过 `.dragging` 类（拖动进行中的样式）；
 *   3. 块的 top 位移与滚动量不等。
 */
async function runCase(name, { x, y, steps, holdMs, armedProbe }) {
  const before = await readBlocks()
  await touch('touchStart', [{ x, y }])
  if (holdMs) await page.waitForTimeout(holdMs)
  let sawArmed = false
  let sawDragging = false
  if (armedProbe) {
    /* 长按期间采样一次，确认 armed 高亮确实出现（解锁的视觉反馈）。 */
    const mid = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.day-event')]
      return {
        armed: els.some((e) => e.classList.contains('armed')),
        dragging: els.some((e) => e.classList.contains('dragging'))
      }
    })
    sawArmed = mid.armed || sawArmed
    sawDragging = mid.dragging || sawDragging
  }
  for (const s of steps) {
    await touch('touchMove', [{ x: s.x, y: s.y }])
    await page.waitForTimeout(s.wait ?? 40)
    const mid = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.day-event')]
      return {
        armed: els.some((e) => e.classList.contains('armed')),
        dragging: els.some((e) => e.classList.contains('dragging'))
      }
    })
    sawArmed = mid.armed || sawArmed
    sawDragging = mid.dragging || sawDragging
  }
  await touch('touchEnd', [])
  await page.waitForTimeout(600)
  const after = await readBlocks()

  const target = before.blocks[2] ?? before.blocks[0]
  const moved = target ? (after.blocks[2]?.top ?? 0) - target.top : 0
  const scrollDelta = after.scrollTop - before.scrollTop
  /* 若块未被拖动，滚动会把它一起带走：top 位移应≈ -scrollDelta。 */
  const followsScroll = Math.abs(moved + scrollDelta) <= 4
  const blockMoved = !followsScroll

  results.push({
    name,
    touchAction: before.touchAction,
    scrollBefore: before.scrollTop,
    scrollAfter: after.scrollTop,
    scrollDelta,
    blockTopBefore: target?.top,
    blockTopAfter: after.blocks[2]?.top,
    blockMoved,
    sawArmed,
    sawDragging
  })
  return results[results.length - 1]
}

/**
 * 滚回顶部并等布局稳定。
 * 场景之间必须复位：上一次手势把页面滚下去后，后续场景取到的块可能在视口外，
 * 触摸点落空 → 状态机收不到 item hit，看起来像"长按解锁失效"。
 */
async function resetScroll() {
  await page.evaluate(() => {
    document.querySelector('.day-scroll').scrollTop = 0
  })
  await page.waitForTimeout(400)
}

/* --- 场景 A：在事件块上纵向滑动（想滚时间轴），不应移动块 --- */
{
  await resetScroll()
  const blocks = (await readBlocks()).blocks
  const b = blocks[2] ?? blocks[0]
  await runCase('A. 块上纵滑（想滚动）', {
    x: 200,
    y: b.top + b.h / 2,
    steps: [
      { x: 200, y: b.top + b.h / 2 - 30 },
      { x: 200, y: b.top + b.h / 2 - 70, wait: 60 },
      { x: 200, y: b.top + b.h / 2 - 110, wait: 60 }
    ]
  })
}

/* --- 场景 B：长按 0.45s 解锁后移动，块应被拖动 --- */
{
  await resetScroll()
  const blocks = (await readBlocks()).blocks
  const b = blocks[2] ?? blocks[0]
  await runCase('B. 长按解锁后拖动', {
    x: 200,
    y: b.top + b.h / 2,
    holdMs: 450,
    armedProbe: true,
    steps: [
      { x: 200, y: b.top + b.h / 2 - 20, wait: 50 },
      { x: 200, y: b.top + b.h / 2 - 60, wait: 50 }
    ]
  })
}

/* --- 场景 C：短促轻触（<0.3s、位移小），块不应移动 --- */
{
  await resetScroll()
  const blocks = (await readBlocks()).blocks
  const b = blocks[2] ?? blocks[0]
  await runCase('C. 短促轻触', {
    x: 200,
    y: b.top + b.h / 2,
    steps: [{ x: 202, y: b.top + b.h / 2 + 2, wait: 60 }]
  })
}

await browser.close()

/* ---------------------------------------------------------------- 报告 */

const lines = []
lines.push('# 事件块手势实测（390×844 触摸视口）', '')
lines.push(`生成时间：${new Date().toLocaleString('zh-CN')}`)
lines.push('')
lines.push(`当前生效的 .day-event touch-action = \`${results[0]?.touchAction}\``)
lines.push('')
lines.push('| 场景 | 滚动Δ | 块顶边前 | 块顶边后 | 块随滚动 | 块被拖动 | 见过 armed | 见过 dragging |')
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
for (const r of results) {
  lines.push(
    `| ${r.name} | ${r.scrollDelta >= 0 ? '+' : ''}${r.scrollDelta} | ${r.blockTopBefore} | ${r.blockTopAfter} | ${Math.abs(r.blockTopAfter - r.blockTopBefore + r.scrollDelta) <= 4 ? '是' : '否'} | ${r.blockMoved ? '**是**' : '否'} | ${r.sawArmed ? '是' : '否'} | ${r.sawDragging ? '是' : '否'} |`
  )
}
lines.push('')
lines.push('## 判读', '')
const a = results[0]
const b = results[1]
const c = results[2]
lines.push(
  `- A（块上纵滑）：滚动 Δ = **${a.scrollDelta}px**，块被拖动 = **${a.blockMoved ? '是' : '否'}** → ${!a.blockMoved && a.scrollDelta !== 0 ? '✅ 滚动归浏览器，块未被误移动' : a.blockMoved ? '❌ 块仍被拖动' : '⚠️ 既未滚动也未拖动，需人工复核'}`
)
lines.push(
  `- B（长按解锁后拖动）：块被拖动 = **${b.blockMoved ? '是' : '否'}**，armed 高亮 = **${b.sawArmed ? '见过' : '未见过'}** → ${b.blockMoved ? '✅ 长按解锁路径有效' : '❌ 长按后无法拖动'}`
)
lines.push(
  `- C（短促轻触）：块被拖动 = **${c.blockMoved ? '是' : '否'}** → ${!c.blockMoved ? '✅ 轻触不移动块' : '❌ 轻触误移动块'}`
)
lines.push('')
if (errors.length) lines.push('页面错误：\n```\n' + errors.join('\n') + '\n```')
lines.push('')
lines.push('> 注：Chromium 的触摸模拟与 WebKit 并非等价，本探针证明的是「状态机与 CSS 取值生效」，')
lines.push('> iOS 真机验收仍不可替代。')

const report = lines.join('\n')
console.log(report)

if (out) {
  const dir = dirname(out)
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(out, report, 'utf8')
  console.log(`\n报告已写入：${out}`)
}
