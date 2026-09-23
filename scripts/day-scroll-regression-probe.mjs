#!/usr/bin/env node
/**
 * 回归探针：确认问题 5 的改动没有破坏其它路径。
 *
 * 覆盖：
 *   1. 鼠标在事件块上拖动 → 仍能即时起拖（桌面端不受长按闸门限制）。
 *   2. 移动端在上滑**画布空白处**（非事件块）→ 时间轴能滚动（原生 pan-y 路径）。
 *   3. 移动端在下滑**画布空白处** → 同上。
 *   4. 鼠标滚轮 → 时间轴滚动正常。
 *
 * 用法：node scripts/day-scroll-regression-probe.mjs
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
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + d, 12, 0, 0)
    const key = `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`
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
        createdAt: new Date().toISOString()
      })
    }
  }
  return { version: 2, goals: [], events: [], weekPresets: [], weekEvents, weekCounterOffset: 0 }
}

const browser = await chromium.launch({ executablePath, headless: true })

async function openDayView(opts) {
  const context = await browser.newContext(opts)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(
    ([key, payload]) => window.localStorage.setItem(key, payload),
    [DATA_KEY, JSON.stringify(seedData())]
  )
  await page.goto(`http://127.0.0.1:${port}/probe.html?page=weekly&strict=0&sidebar=1`, {
    waitUntil: 'load'
  })
  await page.waitForSelector('.sidebar', { timeout: 20000 })
  await page.waitForTimeout(450)
  await page.locator('.week-col-head').nth(3).click()
  await page.waitForSelector('.day-canvas', { timeout: 10000 })
  await page.waitForTimeout(700)
  return { context, page, errors }
}

const read = (page) =>
  page.evaluate(() => {
    const scroll = document.querySelector('.day-scroll')
    const evs = [...document.querySelectorAll('.day-event')]
    return {
      scrollTop: Math.round(scroll.scrollTop),
      blockTops: evs.map((e) => Math.round(e.getBoundingClientRect().top)),
      dragging: evs.some((e) => e.classList.contains('dragging')),
      /* 画布空白处：取无块区域用于测试原生滚动。
       * 上下各留 GAP_MARGIN 的余量——取到紧贴块边界的点会被判定为落在块上，
       * 于是手势进了块的处理路径，测出来的就不是"空白处滚动"。 */
      emptyY: (() => {
        const GAP_MARGIN = 8
        const canvas = document.querySelector('.day-canvas').getBoundingClientRect()
        const scroll = document.querySelector('.day-scroll').getBoundingClientRect()
        const tops = evs.map((e) => {
          const r = e.getBoundingClientRect()
          return [r.top, r.bottom]
        })
        const lo = Math.round(Math.max(canvas.top, scroll.top)) + GAP_MARGIN
        const hi = Math.round(Math.min(canvas.bottom, scroll.bottom)) - GAP_MARGIN
        for (let y = lo; y < hi; y += 2) {
          if (!tops.some(([a, b]) => y >= a - GAP_MARGIN && y <= b + GAP_MARGIN)) return y
        }
        return null
      })()
    }
  })

const results = []

/* ---------- 1. 鼠标在事件块上拖动 ---------- */
{
  const { context, page, errors } = await openDayView({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1
  })
  const before = await read(page)
  const box = await page.locator('.day-event').first().boundingBox()
  const say = await page.evaluate(() => {
    const r = document.querySelector('.day-event').getBoundingClientRect()
    return Math.round(r.top + r.height / 2)
  })
  await page.mouse.move(box.x + box.width / 2, say)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, say + 40, { steps: 6 })
  const midDrag = await page.evaluate(() =>
    [...document.querySelectorAll('.day-event')].some((e) => e.classList.contains('dragging'))
  )
  await page.mouse.move(box.x + box.width / 2, say + 90, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  const after = await read(page)
  results.push({
    name: '1. 鼠标拖块（桌面，应即时起拖）',
    scrollDelta: after.scrollTop - before.scrollTop,
    blockMoved: after.blockTops[0] - before.blockTops[0],
    sawDragging: midDrag,
    pass: midDrag
  })
  if (errors.length) console.log('pageerrors:', errors.join(' | '))
  await context.close()
}

/* ---------- 2/3. 移动端在画布空白处滑动 ---------- */
{
  const { context, page, errors } = await openDayView({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true
  })
  const cdp = await context.newCDPSession(page)
  const touch = (type, pts) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i }))
    })

  /* 上滑 */
  {
    await page.evaluate(() => (document.querySelector('.day-scroll').scrollTop = 0))
    await page.waitForTimeout(200)
    const m = await read(page)
    if (m.emptyY !== null) {
      await touch('touchStart', [{ x: 200, y: m.emptyY }])
      await page.waitForTimeout(50)
      for (const d of [30, 60, 100]) {
        await touch('touchMove', [{ x: 200, y: m.emptyY - d }])
        await page.waitForTimeout(60)
      }
      await touch('touchEnd', [])
      await page.waitForTimeout(300)
      const after = await read(page)
      results.push({
        name: '2. 画布空白处上滑（原生滚动）',
        scrollDelta: after.scrollTop - m.scrollTop,
        blockMoved: 0,
        sawDragging: false,
        pass: after.scrollTop > m.scrollTop
      })
    } else {
      results.push({ name: '2. 画布空白处上滑（原生滚动）', scrollDelta: 0, blockMoved: 0, pass: false, note: '未找到空白点' })
    }
  }

  /* 下滑 */
  {
    /* 先滚到**中间位置**：别写到 300 —— 内容高 892、视口 694，最大值只有 198，
     * 写 300 会被浏览器钳回 198，此时想再向下滚已经没有空间，测出来必是 Δ=0。
     * 取中段同时保证上下都有可滚余量。 */
    await page.evaluate(() => {
      const s = document.querySelector('.day-scroll')
      s.scrollTop = Math.round((s.scrollHeight - s.clientHeight) / 2)
    })
    await page.waitForTimeout(250)
    const m = await read(page)
    if (m.emptyY !== null) {
      await touch('touchStart', [{ x: 200, y: m.emptyY }])
      await page.waitForTimeout(50)
      for (const d of [40, 90]) {
        await touch('touchMove', [{ x: 200, y: m.emptyY + d }])
        await page.waitForTimeout(60)
      }
      await touch('touchEnd', [])
      await page.waitForTimeout(300)
      const after = await read(page)
      results.push({
        name: '3. 画布空白处下滑（原生滚动）',
        scrollDelta: after.scrollTop - m.scrollTop,
        blockMoved: 0,
        sawDragging: false,
        pass: after.scrollTop < m.scrollTop
      })
    } else {
      results.push({ name: '3. 画布空白处下滑（原生滚动）', scrollDelta: 0, blockMoved: 0, pass: false, note: '未找到空白点' })
    }
  }

  /* 4. 滚轮（触摸设备上少见，但外接鼠标常见） */
  {
    await page.evaluate(() => (document.querySelector('.day-scroll').scrollTop = 0))
    await page.waitForTimeout(200)
    const m = await read(page)
    await page.mouse.move(200, 400)
    await page.mouse.wheel(0, 240)
    await page.waitForTimeout(300)
    const after = await read(page)
    results.push({
      name: '4. 滚轮滚动',
      scrollDelta: after.scrollTop - m.scrollTop,
      blockMoved: 0,
      sawDragging: false,
      pass: after.scrollTop > 0
    })
  }

  if (errors.length) console.log('pageerrors:', errors.join(' | '))
  await context.close()
}

await browser.close()

const lines = []
lines.push('# 日视图滚动/拖动回归实测', '')
lines.push(`生成时间：${new Date().toLocaleString('zh-CN')}`)
lines.push('')
lines.push('| 场景 | 滚动Δ | 块位移 | 见过 dragging | 判定 |')
lines.push('| --- | --- | --- | --- | --- |')
for (const r of results) {
  lines.push(
    `| ${r.name}${r.note ? `（${r.note}）` : ''} | ${r.scrollDelta > 0 ? '+' : ''}${r.scrollDelta} | ${r.blockMoved} | ${r.sawDragging ? '是' : '否'} | ${r.pass ? '✅ 通过' : '❌ 失败'} |`
  )
}
lines.push('')
const failed = results.filter((r) => !r.pass)
lines.push(failed.length === 0 ? `**全部 ${results.length} 项通过。**` : `**${failed.length} 项失败：**`)
for (const f of failed) lines.push(`- ${f.name}`)
lines.push('')

const report = lines.join('\n')
console.log(report)
if (out) {
  const dir = dirname(out)
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(out, report, 'utf8')
  console.log(`报告已写入：${out}`)
}
