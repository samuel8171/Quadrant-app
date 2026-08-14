import { _electron } from 'playwright-core'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const electronPath = require('electron')

const ROOT = 'D:\\Samuel\\Vibe Coding'
const USER_DATA = path.join(ROOT, 'docs', '.qa-weekly-userdata')
const OUT = path.join(ROOT, 'docs', 'qa-weekly')
fs.mkdirSync(OUT, { recursive: true })
fs.rmSync(USER_DATA, { recursive: true, force: true })

const results = {}
const shot = async (page, name) => {
  const file = path.join(OUT, name)
  await page.screenshot({ path: file })
  results[name] = file
}

const app = await _electron.launch({
  executablePath: electronPath,
  args: ['out/main/index.js', `--user-data-dir=${USER_DATA}`],
  cwd: ROOT
})
const page = await app.firstWindow()
await page.waitForTimeout(1200)

// 进入周计划页：7:00 标签应隐藏
await page.click('.nav-item:has-text("周计划")')
await page.waitForTimeout(500)
results.overviewFirstLabel = await page.evaluate(
  () => document.querySelector('.week-hour-label')?.textContent ?? null
)
await shot(page, '01-week-overview-empty.png')

// 点击周一进入单日视图：应有 18 个刻度（7:00..24:00）
await page.click('.week-col-head:has-text("周一")')
await page.waitForTimeout(500)
results.dayLabels = await page.evaluate(() => {
  const labels = [...document.querySelectorAll('.day-hour-label')].map((e) => e.textContent)
  return { count: labels.length, first: labels[0], last: labels[labels.length - 1] }
})
await shot(page, '02-day-view.png')
await page.evaluate(() => {
  const scroller = document.querySelector('.day-scroll')
  scroller.scrollTo(0, scroller.scrollHeight)
})
await page.waitForTimeout(200)
await shot(page, '03-day-bottom.png')
results.dayBottomMeasure = await page.evaluate(() => {
  const scroller = document.querySelector('.day-scroll')
  const last = [...document.querySelectorAll('.day-hour-label')].pop()
  const sRect = scroller.getBoundingClientRect()
  const lRect = last.getBoundingClientRect()
  return {
    scrollTop: scroller.scrollTop,
    clientHeight: scroller.clientHeight,
    scrollHeight: scroller.scrollHeight,
    labelTop: lRect.top - sRect.top,
    labelBottom: lRect.bottom - sRect.top,
    labelText: last.textContent
  }
})
await page.evaluate(() => document.querySelector('.day-scroll').scrollTo(0, 0))
await page.waitForTimeout(200)

// 预设 1：健身 / 薄荷青绿 / 重要不紧急 / 1.5 小时
await page.click('.preset-head .icon-btn')
await page.waitForTimeout(300)
await page.fill('.weekly-dialog .modal-field input', '健身')
await page.click('.weekly-dialog .color-dot:nth-child(2)')
await page.click('.weekly-dialog .quad-option:nth-child(2)')
await page.click('.weekly-dialog .duration-chip:has-text("1.5小时")')
await page.click('.weekly-dialog .modal-btn.primary')
await page.waitForTimeout(400)

// 预设 2：复习高数 / 自定义 1小时25分钟
await page.click('.preset-head .icon-btn')
await page.waitForTimeout(300)
await page.fill('.weekly-dialog .modal-field input', '复习高数')
await page.click('.weekly-dialog .quad-option:nth-child(1)')
await page.click('.weekly-dialog .duration-chip:has-text("自定义")')
await page.selectOption('.weekly-dialog .duration-select >> nth=0', '1')
await page.selectOption('.weekly-dialog .duration-select >> nth=1', '25')
await page.click('.weekly-dialog .modal-btn.primary')
await page.waitForTimeout(400)

// 预设 3：复盘 / 自定义 25 分钟（小于 45 分钟，应只显示标题+时长）
await page.click('.preset-head .icon-btn')
await page.waitForTimeout(300)
await page.fill('.weekly-dialog .modal-field input', '复盘')
await page.click('.weekly-dialog .color-dot:nth-child(7)')
await page.click('.weekly-dialog .quad-option:nth-child(3)')
await page.click('.weekly-dialog .duration-chip:has-text("自定义")')
await page.selectOption('.weekly-dialog .duration-select >> nth=0', '0')
await page.selectOption('.weekly-dialog .duration-select >> nth=1', '25')
await page.click('.weekly-dialog .modal-btn.primary')
await page.waitForTimeout(400)
results.presetCards = await page.evaluate(() =>
  [...document.querySelectorAll('.preset-card')].map((card) => ({
    title: card.querySelector('.preset-title')?.textContent ?? '',
    hasMeta: !!card.querySelector('.preset-meta'),
    duration: card.querySelector('.preset-duration')?.textContent ?? ''
  }))
)
await shot(page, '04-custom-preset.png')

// 把"健身"预设拖到 8:00（画布顶部 10px 内边距 + 1 小时）
const presetId = await page.evaluate(
  () => document.querySelectorAll('.preset-card')[0]?.getAttribute('data-preset-id') ?? null
)
await page.evaluate(({ presetId }) => {
  const canvas = document.querySelector('.day-canvas')
  const rect = canvas.getBoundingClientRect()
  const dt = new DataTransfer()
  dt.setData('application/x-preset-id', presetId)
  canvas.dispatchEvent(
    new DragEvent('drop', {
      dataTransfer: dt,
      clientX: rect.left + 200,
      clientY: rect.top + 58,
      bubbles: true,
      cancelable: true
    })
  )
}, { presetId })
await page.waitForTimeout(400)
results.eventMetaAfterDrop = await page.evaluate(() =>
  [...document.querySelectorAll('.day-event-meta')].map((e) => e.textContent)
)

// 双击 11:00 新建"开会"（默认 1 小时）
const canvas = await page.locator('.day-canvas').boundingBox()
await page.mouse.dblclick(canvas.x + 220, canvas.y + 10 + 4 * 48 + 12)
await page.waitForTimeout(300)
await page.fill('.weekly-dialog .modal-field input', '开会')
await page.click('.weekly-dialog .modal-btn.primary')
await page.waitForTimeout(400)

// 双击 13:00 新建"短会"，并把截止时间改成 13:25（25 分钟 → 只显示标题）
await page.mouse.dblclick(canvas.x + 220, canvas.y + 10 + 6 * 48 + 12)
await page.waitForTimeout(300)
await page.fill('.weekly-dialog .modal-field input', '短会')
await page.selectOption('.weekly-dialog .time-row >> nth=1 >> select >> nth=0', '13')
await page.selectOption('.weekly-dialog .time-row >> nth=1 >> select >> nth=1', '25')
await page.click('.weekly-dialog .modal-btn.primary')
await page.waitForTimeout(400)
results.shortEventBlock = await page.evaluate(() => {
  const block = [...document.querySelectorAll('.day-event')].find(
    (el) => el.querySelector('.day-event-title')?.textContent === '短会'
  )
  return block
    ? {
        hasTitle: !!block.querySelector('.day-event-title'),
        hasMeta: !!block.querySelector('.day-event-meta')
      }
    : null
})
await shot(page, '06-events.png')

// 拖动"健身"事件下移 30px → 吸附到 9:00-10:30
const block = await page.locator('.day-event').first().boundingBox()
await page.mouse.move(block.x + 60, block.y + block.height / 2)
await page.mouse.down()
await page.mouse.move(block.x + 60, block.y + block.height / 2 + 30, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(400)
results.eventMetaAfterDrag = await page.evaluate(() =>
  [...document.querySelectorAll('.day-event-meta')].map((e) => e.textContent)
)
await shot(page, '08-after-drag.png')

// 右键"开会" → 修改信息 → 勾选"在四象限中呈现" → 保存
const meeting = await page.locator('.day-event', { hasText: '开会' }).boundingBox()
await page.mouse.click(meeting.x + 60, meeting.y + meeting.height / 2, { button: 'right' })
await page.waitForTimeout(300)
await page.click('.day-menu .context-item:has-text("修改信息")')
await page.waitForTimeout(300)
await page.check('.weekly-dialog .toggle-row input')
await page.click('.weekly-dialog .modal-btn.primary')
await page.waitForTimeout(400)
results.togglePersisted = await page.evaluate(async () => {
  const data = await window.quadrantApi.loadData()
  const meeting = data.weekEvents.find((e) => e.title === '开会')
  const synced = data.events.find((e) => e.id === meeting?.quadrantEventId)
  return {
    showInQuadrant: meeting?.showInQuadrant ?? null,
    quadrantEventId: meeting?.quadrantEventId ?? null,
    synced: synced
      ? { text: synced.text, quadrant: synced.quadrant, x: synced.x, y: synced.y }
      : null
  }
})

// 到四象限页验证联动事件
await page.click('.nav-item:has-text("四象限")')
await page.waitForTimeout(600)
results.quadrantCard = await page.evaluate(() => ({
  count: document.querySelectorAll('.event-card.q1').length,
  texts: [...document.querySelectorAll('.event-card.q1 .event-text')].map((e) => e.textContent)
}))
await shot(page, '09-quadrant-linked.png')

// 回周计划总览：事件块只显示标题（无象限/时间元信息）
await page.click('.nav-item:has-text("周计划")')
await page.waitForTimeout(500)
results.overviewBlocks = await page.evaluate(() => {
  const blocks = [...document.querySelectorAll('.week-col:nth-child(2) .day-event')]
  return {
    count: blocks.length,
    allTitleOnly: blocks.every(
      (b) => b.querySelector('.day-event-title') && !b.querySelector('.day-event-meta')
    ),
    titles: blocks.map((b) => b.querySelector('.day-event-title')?.textContent ?? '')
  }
})
await shot(page, '10-week-overview-with-events.png')

// 持久化数据核对
results.persisted = await page.evaluate(async () => {
  const data = await window.quadrantApi.loadData()
  return {
    version: data.version,
    presets: data.weekPresets.map((p) => ({ title: p.title, durationMin: p.durationMin })),
    weekEvents: data.weekEvents.map((e) => ({
      title: e.title,
      startMin: e.startMin,
      endMin: e.endMin,
      showInQuadrant: e.showInQuadrant
    })),
    quadrantEvents: data.events.map((e) => ({ text: e.text, quadrant: e.quadrant }))
  }
})

console.log(JSON.stringify(results, null, 2))
await app.close()
process.exit(0)
