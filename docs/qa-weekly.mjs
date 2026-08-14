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

// 进入周计划页
await page.click('.nav-item:has-text("周计划")')
await page.waitForTimeout(500)
await shot(page, '01-week-overview-empty.png')

// 修改"坚持第 n 周"：改成 3（offset=2）
await page.click('.streak-value')
await page.fill('.streak-input', '3')
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
results.streak = await page.evaluate(() => document.querySelector('.streak-value')?.textContent ?? null)

// 点击周一进入单日视图
await page.click('.week-col-head:has-text("周一")')
await page.waitForTimeout(500)
results.dayTitle = await page.evaluate(() => document.querySelector('.day-title')?.textContent ?? null)
await shot(page, '02-day-view.png')

// 新建预设 1：健身 / 薄荷青绿 / 重要不紧急 / 1.5 小时
await page.click('.preset-head .icon-btn')
await page.waitForTimeout(300)
await page.fill('.weekly-dialog .modal-field input', '健身')
await page.click('.weekly-dialog .color-dot:nth-child(2)')
await page.click('.weekly-dialog .quad-option:nth-child(2)')
await page.click('.weekly-dialog .duration-chip:has-text("1.5小时")')
await page.fill('.weekly-dialog textarea', '每周三练')
await page.click('.weekly-dialog .modal-btn.primary')
await page.waitForTimeout(400)
results.presetCount1 = await page.evaluate(() => document.querySelectorAll('.preset-card').length)
await shot(page, '03-preset-created.png')

// 新建预设 2：复习高数 / 自定义 1小时25分钟 / 重要紧急
await page.click('.preset-head .icon-btn')
await page.waitForTimeout(300)
await page.fill('.weekly-dialog .modal-field input', '复习高数')
await page.click('.weekly-dialog .quad-option:nth-child(1)')
await page.click('.weekly-dialog .duration-chip:has-text("自定义")')
await page.selectOption('.weekly-dialog .duration-select >> nth=0', '1')
await page.selectOption('.weekly-dialog .duration-select >> nth=1', '25')
await page.click('.weekly-dialog .modal-btn.primary')
await page.waitForTimeout(400)
results.presetDurations = await page.evaluate(() =>
  [...document.querySelectorAll('.preset-card .preset-duration')].map((e) => e.textContent)
)
await shot(page, '04-custom-preset.png')

// 把"健身"预设拖到 8:00 位置（1 小时 = 48px，8:00 距 7:00 为 48px）
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
      clientY: rect.top + 48,
      bubbles: true,
      cancelable: true
    })
  )
}, { presetId })
await page.waitForTimeout(400)
results.eventMetaAfterDrop = await page.evaluate(() =>
  [...document.querySelectorAll('.day-event-meta')].map((e) => e.textContent)
)
await shot(page, '05-event-dropped.png')

// 双击空白处（11:00，距 7:00 为 4 小时 = 192px）新建事件
const canvas = await page.locator('.day-canvas').boundingBox()
await page.mouse.dblclick(canvas.x + 220, canvas.y + 192 + 12)
await page.waitForTimeout(300)
await page.fill('.weekly-dialog .modal-field input', '开会')
await page.click('.weekly-dialog .modal-btn.primary')
await page.waitForTimeout(400)
results.eventCount = await page.evaluate(() => document.querySelectorAll('.day-event').length)
await shot(page, '06-two-events.png')

// 右键第一个事件 → 菜单 → 修改信息（打开后取消）
const firstEvent = await page.locator('.day-event').first().boundingBox()
await page.mouse.click(firstEvent.x + 60, firstEvent.y + firstEvent.height / 2, {
  button: 'right'
})
await page.waitForTimeout(300)
results.menuItems = await page.evaluate(() =>
  [...document.querySelectorAll('.day-menu .context-item')].map((e) => e.textContent)
)
await shot(page, '07-event-menu.png')
await page.click('.day-menu .context-item:has-text("修改信息")')
await page.waitForTimeout(300)
results.editDialogTitle = await page.evaluate(
  () => document.querySelector('.weekly-dialog h3')?.textContent ?? null
)
await page.click('.weekly-dialog .modal-btn:has-text("取消")')
await page.waitForTimeout(200)

// 拖动"健身"事件下移 30px → 开始时间应吸附到 9:00（1.5 小时事件 9:00-10:30）
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

// 下一日按钮 → 周二
await page.click('.day-nav-btn[title="下一日"]')
await page.waitForTimeout(300)
results.tuesdayTitle = await page.evaluate(
  () => document.querySelector('.day-title')?.textContent ?? null
)
await shot(page, '09-tuesday.png')

// 返回周视图 → 周一列应有事件块；再切下一周验证周数与日期范围
await page.click('.back-btn')
await page.waitForTimeout(400)
results.overviewEventBlocks = await page.evaluate(
  () => document.querySelector('.week-col:nth-child(2) .week-col-body')?.querySelectorAll('.day-event').length ?? 0
)
await shot(page, '10-week-overview-with-events.png')
await page.click('.week-nav .icon-btn[title="下一周"]')
await page.waitForTimeout(300)
results.nextWeekRange = await page.evaluate(
  () => document.querySelector('.week-range')?.textContent ?? null
)
results.nextWeekStreak = await page.evaluate(
  () => document.querySelector('.streak-value')?.textContent ?? null
)
await shot(page, '11-next-week.png')

// 持久化数据核对
results.persisted = await page.evaluate(async () => {
  const data = await window.quadrantApi.loadData()
  return {
    version: data.version,
    presets: data.weekPresets.map((p) => ({
      title: p.title,
      durationMin: p.durationMin,
      quadrant: p.quadrant
    })),
    events: data.weekEvents.map((e) => ({
      date: e.date,
      title: e.title,
      startMin: e.startMin,
      endMin: e.endMin,
      presetId: e.presetId ?? null
    })),
    weekCounterOffset: data.weekCounterOffset
  }
})

console.log(JSON.stringify(results, null, 2))
await app.close()
process.exit(0)
