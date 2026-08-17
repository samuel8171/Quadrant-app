import { _electron } from 'playwright-core'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const electronPath = require('electron')

const ROOT = 'D:\\Samuel\\Vibe Coding'
const USER_DATA = path.join(ROOT, 'docs', '.qa-review-userdata')
const OUT = path.join(ROOT, 'docs', 'qa-review')
fs.rmSync(USER_DATA, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const results = {}
const shot = async (page, name) => {
  const file = path.join(OUT, name)
  await page.screenshot({ path: file })
  results[name] = file
}
const evalJson = async (page, expression) => {
  const value = await page.evaluate(expression)
  return typeof value === 'string' ? JSON.parse(value) : value
}

const app = await _electron.launch({
  executablePath: electronPath,
  args: ['out/main/index.js', `--user-data-dir=${USER_DATA}`],
  cwd: ROOT
})
const page = await app.firstWindow()
await page.waitForTimeout(1200)

await page.click('.nav-item:has-text("周日复盘")')
await page.waitForTimeout(500)
await shot(page, '01-review-empty.png')

const setSlider = async (index, ratio) => {
  const box = await page
    .locator('.review-slider-row .review-slider-track')
    .nth(index)
    .boundingBox()
  await page.mouse.click(box.x + box.width * ratio, box.y + box.height / 2)
  await page.waitForTimeout(180)
}

await setSlider(0, 0.8)
await setSlider(1, 0.6)
await setSlider(2, 0.4)
results.sliderValues = await evalJson(
  page,
  `JSON.stringify([...document.querySelectorAll('.review-slider-value')].map((e) => e.textContent))`
)
results.sliderSegmentStyles = await evalJson(
  page,
  `JSON.stringify([...document.querySelectorAll('.review-slider-row')].map((row) =>
    [...row.querySelectorAll('.review-slider-segment')].slice(0, 10).map((s) => s.getAttribute('style') ?? '')
  ))`
)
await shot(page, '02-review-values.png')

await page.click('.review-textarea')
await page.keyboard.type('本周完成度不错，高数复习到位。\n下周要补英语阅读。')
await page.waitForTimeout(250)
await shot(page, '03-review-text.png')

// 未保存草稿就切页面 -> 弹确认框
await page.click('.nav-item:has-text("目标")')
await page.waitForTimeout(300)
results.leavePrompt = await evalJson(
  page,
  `JSON.stringify({
    shown: !!document.querySelector('.confirm-modal'),
    message: document.querySelector('.confirm-message')?.textContent ?? null,
    buttons: [...document.querySelectorAll('.confirm-modal .modal-btn')].map((e) => e.textContent.trim())
  })`
)
await shot(page, '04-leave-prompt.png')
await page.click('.confirm-modal .modal-btn:has-text("取消")')
await page.waitForTimeout(250)

// 保存草稿后再切换，应直接切换
await page.click('.review-btn:has-text("保存草稿")')
await page.waitForTimeout(250)
await page.click('.nav-item:has-text("目标")')
await page.waitForTimeout(350)
results.pageAfterSavedDraft = await page.evaluate(
  () => document.querySelector('.page-header h1')?.textContent ?? null
)

await page.click('.nav-item:has-text("周日复盘")')
await page.waitForTimeout(400)
results.draftRetained = await evalJson(
  page,
  `JSON.stringify([...document.querySelectorAll('.review-slider-value')].map((e) => e.textContent))`
)
await shot(page, '05-draft-retained.png')

// 输出 Word
await page.click('.review-btn.primary')
await page.waitForTimeout(700)
results.toast = await page.evaluate(
  () => document.querySelector('.review-toast')?.textContent ?? null
)

await page.click('.review-btn:has-text("复盘记录")')
await page.waitForTimeout(700)
results.records = await evalJson(
  page,
  `JSON.stringify([...document.querySelectorAll('.review-record-row')].map((e) => ({
    name: e.querySelector('.review-record-name')?.textContent,
    meta: e.querySelector('.review-record-meta')?.textContent,
    date: e.querySelector('.review-record-date')?.textContent,
    size: e.querySelector('.review-record-size')?.textContent
  })))`
)
await shot(page, '06-records.png')

// 删除已生成文件后双击，触发“文件不存在”报错框
const reviewsDir = path.join(USER_DATA, 'reviews')
const docxFiles = fs.existsSync(reviewsDir) ? fs.readdirSync(reviewsDir) : []
if (docxFiles.length > 0) {
  fs.rmSync(path.join(reviewsDir, docxFiles[0]), { force: true })
  const row = await page.locator('.review-record-row').first().boundingBox()
  await page.mouse.dblclick(row.x + row.width / 2, row.y + row.height / 2)
  await page.waitForTimeout(400)
  results.openError = await evalJson(
    page,
    `JSON.stringify({
      shown: !!document.querySelector('.confirm-modal'),
      title: document.querySelector('.confirm-modal h3')?.textContent ?? null,
      message: document.querySelector('.confirm-message')?.textContent ?? null
    })`
  )
  await shot(page, '07-open-error.png')
  await page.click('.confirm-modal .modal-btn')
}

// 侧边栏高亮条
results.navIndicator = await evalJson(
  page,
  `JSON.stringify({
    exists: !!document.querySelector('.nav-indicator'),
    transform: document.querySelector('.nav-indicator')?.getAttribute('style') ?? null
  })`
)

// 周计划单日打开/关闭动画类名
await page.click('.nav-item:has-text("周计划")')
await page.waitForTimeout(350)
results.pageSwitchClass = await page.evaluate(
  () => document.querySelector('.page-switch')?.className ?? null
)
await page.click('.icon-btn[title="下一周"]')
await page.waitForTimeout(80)
results.weekSlideClass = await page.evaluate(
  () => document.querySelector('.week-grid')?.className ?? null
)
await page.waitForTimeout(300)
await page.click('.week-col-head')
await page.waitForTimeout(120)
results.dayOpenClass = await page.evaluate(
  () => document.querySelector('.day-page')?.className ?? null
)
await page.click('.day-nav-btn[title="下一日"]')
await page.waitForTimeout(80)
results.daySlideClass = await page.evaluate(
  () => document.querySelector('.day-body')?.className ?? null
)
await page.waitForTimeout(300)
await shot(page, '08-day-open.png')
await page.click('.day-topbar .back-btn')
await page.waitForTimeout(100)
results.dayCloseClass = await page.evaluate(
  () => document.querySelector('.day-page')?.className ?? null
)
await shot(page, '09-day-close.png')
await page.waitForTimeout(500)
results.backToOverview = await page.evaluate(
  () => !!document.querySelector('.week-board')
)

console.log(JSON.stringify(results, null, 2))
await app.close()
process.exit(0)
