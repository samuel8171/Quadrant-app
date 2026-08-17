import { _electron } from 'playwright-core'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const electronPath = require('electron')

const ROOT = 'D:\\Samuel\\Vibe Coding'
const USER_DATA = path.join(ROOT, 'docs', '.qa-userdata')
const OUT = path.join(ROOT, 'docs', 'qa')
fs.mkdirSync(OUT, { recursive: true })
fs.rmSync(USER_DATA, { recursive: true, force: true })

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
await page.waitForTimeout(1500)

// 分组布局专项：4 组与 6 组卡片尺寸一致，6 组时页面可滚动
const measureGroups = async () =>
  evalJson(
    page,
    `JSON.stringify({
      cards: document.querySelectorAll('.group-card').length,
      cardWidth: document.querySelector('.group-card')?.getBoundingClientRect().width ?? 0,
      cardHeight: document.querySelector('.group-card')?.getBoundingClientRect().height ?? 0,
      areaClient: document.querySelector('.subtask-area')?.clientHeight ?? 0,
      areaScroll: document.querySelector('.subtask-area')?.scrollHeight ?? 0,
      overflowY: document.querySelector('.subtask-area')
        ? getComputedStyle(document.querySelector('.subtask-area')).overflowY
        : null
    })`
  )

// 1. 目标页初始
await shot(page, '01-goals-empty.png')

// 2. 创建长期目标并进入子目标页
await page.click('.goal-column.accent-blue .add-goal-btn')
await page.fill('.goal-column.accent-blue .add-goal-row input', '考研')
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
await page.click('.goal-column.accent-blue .goal-card .icon-btn[title="展开子目标"]')
await page.waitForTimeout(300)
await shot(page, '02-single-group.png')

// 3. 单个分组内添加子目标
await page.fill('.group-card .add-subtask-row input', '背单词')
await page.keyboard.press('Enter')
await page.waitForTimeout(200)
await shot(page, '03-single-group-with-sub.png')

// 4. 两个分组
await page.click('.add-group-btn')
await page.waitForTimeout(200)
await shot(page, '04-two-groups.png')

// 5. 分组 2 添加子目标（应锁定）
await page.fill('.group-card:nth-child(2) .add-subtask-row input', '做真题')
await page.keyboard.press('Enter')
await page.waitForTimeout(200)
const lockState = await evalJson(
  page,
  `JSON.stringify({
    titles: [...document.querySelectorAll('.group-card-title')].map((e) => e.textContent),
    cards: document.querySelectorAll('.group-card').length,
    locked: document.querySelectorAll('.group-card:nth-child(2) .goal-check.locked').length,
    disabled: document.querySelectorAll('.group-card:nth-child(2) input[type="checkbox"]:disabled').length
  })`
)
results.lockState = lockState
await shot(page, '05-two-groups-locked.png')

// 6. 三个分组（2x2 去掉右下角）
await page.click('.add-group-btn')
await page.waitForTimeout(300)
const threeGroups = await evalJson(
  page,
  `JSON.stringify({
    cards: document.querySelectorAll('.group-card').length,
    gridRows: getComputedStyle(document.querySelector('.group-grid')).gridTemplateRows
  })`
)
results.threeGroups = threeGroups
await shot(page, '06-three-groups.png')

// 7. 四个分组（2x2）
await page.click('.add-group-btn')
await page.waitForTimeout(300)
results.fourGroups = await measureGroups()
await shot(page, '07-four-groups.png')

// 7.1 加到六个分组：卡片尺寸不变，页面出现纵向滚动
await page.click('.add-group-btn')
await page.click('.add-group-btn')
await page.waitForTimeout(300)
results.sixGroups = await measureGroups()
await page.screenshot({ path: OUT + '\\07b-six-groups-top.png' })
await page.evaluate(() => {
  document.querySelector('.subtask-area')?.scrollTo(0, 9999)
})
await page.waitForTimeout(200)
await page.screenshot({ path: OUT + '\\07c-six-groups-bottom.png' })
// 滚回顶部，方便后续操作
await page.evaluate(() => {
  document.querySelector('.subtask-area')?.scrollTo(0, 0)
})
await page.waitForTimeout(200)

// 8. 双击重命名分组
await page.dblclick('.group-card:nth-child(1) .group-card-title')
await page.keyboard.press('Control+a')
await page.keyboard.type('基础阶段')
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
results.groupTitlesAfterRename = await evalJson(
  page,
  `JSON.stringify([...document.querySelectorAll('.group-card-title')].map((e) => e.textContent))`
)

// 9. 目标详情备注保存
await page.click('.back-btn')
await page.waitForTimeout(200)
// 删除确认框（不再使用原生 confirm）
await page.click('.goal-column.accent-blue .goal-card .icon-btn[title="删除"]')
await page.waitForTimeout(300)
results.confirmDialog = await evalJson(
  page,
  `JSON.stringify({
    mask: !!document.querySelector('.confirm-modal'),
    message: document.querySelector('.confirm-message')?.textContent ?? null
  })`
)
await shot(page, '07d-confirm-dialog.png')
await page.click('.confirm-modal .modal-btn:has-text("取消")')
await page.waitForTimeout(200)

// 目标详情备注保存
await page.click('.goal-column.accent-blue .goal-card .icon-btn[title="详细信息"]')
await page.waitForTimeout(300)
await page.fill('.modal-field textarea', '这是一段目标备注')
await page.click('.modal-btn:has-text("保存")')
await page.waitForTimeout(200)
await page.click('.goal-column.accent-blue .goal-card .icon-btn[title="详细信息"]')
await page.waitForTimeout(300)
results.goalRemark = await page.evaluate(
  () => document.querySelector('.modal-field textarea')?.value ?? null
)
await shot(page, '08-goal-detail.png')
await page.click('.modal-btn:has-text("取消")')
await page.waitForTimeout(200)

// 长标题子目标：应换行增高而不是横向滚动
await page.click('.goal-column.accent-blue .goal-card .icon-btn[title="展开子目标"]')
await page.waitForTimeout(300)
await page.evaluate(() => {
  document.querySelector('.subtask-area')?.scrollTo(0, 0)
})
await page.fill(
  '.group-card:first-child .add-subtask-row input',
  '这是一个特别长的子目标标题用来验证文字超过一行时会自动换行并增加高度'
)
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
results.longTitle = await evalJson(
  page,
  `JSON.stringify({
    cardHeight: document.querySelector('.group-card:first-child .subtask-card:last-child')?.getBoundingClientRect().height ?? 0,
    shortCardHeight: document.querySelector('.group-card:first-child .subtask-card:first-child')?.getBoundingClientRect().height ?? 0,
    titleHeight: document.querySelector('.group-card:first-child .subtask-card:last-child .goal-title')?.getBoundingClientRect().height ?? 0
  })`
)
await shot(page, '07e-long-title.png')

// 删除分组卡片（组内子目标一并删除，后续分组前移）
await page.click('.group-card:nth-child(2) .group-delete-btn')
await page.waitForTimeout(300)
results.groupDeleteConfirm = await evalJson(
  page,
  `JSON.stringify({
    mask: !!document.querySelector('.confirm-modal'),
    message: document.querySelector('.confirm-message')?.textContent ?? null
  })`
)
await shot(page, '07f-group-delete-confirm.png')
await page.click('.confirm-modal .modal-btn:has-text("确认")')
await page.waitForTimeout(300)
results.afterGroupDelete = await evalJson(
  page,
  `JSON.stringify({
    cards: document.querySelectorAll('.group-card').length,
    titles: [...document.querySelectorAll('.group-card-title')].map((e) => e.textContent)
  })`
)
await page.click('.back-btn')
await page.waitForTimeout(200)

// 10. 四象限页：原点居中
await page.click('.nav-item:has-text("四象限")')
await page.waitForTimeout(500)
await shot(page, '09-quadrant-centered.png')

// 11. 创建事件（单行输入框）
const vp = await page.locator('.quadrant-viewport').boundingBox()
const cx = vp.x + vp.width / 2
const cy = vp.y + vp.height / 2
await page.mouse.dblclick(cx + 200, cy - 150)
await page.waitForTimeout(200)
await page.keyboard.type('明天交高数作业')
const inputStyle = await evalJson(
  page,
  `JSON.stringify({
    tag: document.querySelector('.event-input')?.tagName,
    value: document.querySelector('.event-input')?.value
  })`
)
results.createInput = inputStyle
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
await shot(page, '10-event-created.png')

// 12. 悬停第一象限 1 秒显示正确标签
await page.mouse.move(cx + 220, cy - 160)
await page.waitForTimeout(1400)
const labelText = await page.evaluate(
  () => document.querySelector('.quadrant-label')?.textContent ?? null
)
results.hoverLabel = labelText
await shot(page, '11-hover-label.png')

// 13. 事件右键菜单 + 左键外部点击关闭
const card = await page.locator('.event-card').boundingBox()
await page.mouse.click(card.x + card.width / 2, card.y + card.height / 2, { button: 'right' })
await page.waitForTimeout(300)
const menuItems = await evalJson(
  page,
  `JSON.stringify([...document.querySelectorAll('.context-item')].map((e) => e.textContent))`
)
results.eventMenu = menuItems
await shot(page, '12-event-menu.png')
await page.mouse.click(cx, cy)
await page.waitForTimeout(200)
const menuAfterClick = await page.evaluate(() => !!document.querySelector('.context-menu'))
results.menuClosedOnOutsideClick = !menuAfterClick

// 14. 空白处右键仅粘贴
await page.mouse.click(cx - 220, cy + 150, { button: 'right' })
await page.waitForTimeout(300)
const emptyMenu = await evalJson(
  page,
  `JSON.stringify([...document.querySelectorAll('.context-item')].map((e) => e.textContent))`
)
results.emptyAreaMenu = emptyMenu
await shot(page, '13-empty-menu.png')

// 15. 双击事件行内改名（不是独立对话框）
await page.mouse.dblclick(card.x + card.width / 2, card.y + card.height / 2)
await page.waitForTimeout(300)
const inlineEdit = await evalJson(
  page,
  `JSON.stringify({
    modal: !!document.querySelector('.modal'),
    input: document.querySelector('.event-input')?.value ?? null
  })`
)
results.inlineEdit = inlineEdit
await page.keyboard.press('Control+a')
await page.keyboard.type('改名后的任务')
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
results.renamedCard = await evalJson(
  page,
  `JSON.stringify({
    text: document.querySelector('.event-card .event-text')?.textContent ?? null,
    width: document.querySelector('.event-card')?.getBoundingClientRect().width ?? null
  })`
)
await page.waitForTimeout(200)

// 16. Ctrl+C / Ctrl+V
const card2 = await page.locator('.event-card').boundingBox()
await page.mouse.click(card2.x + card2.width / 2, card2.y + card2.height / 2)
await page.keyboard.press('Control+c')
await page.mouse.move(cx - 180, cy + 180)
await page.waitForTimeout(100)
await page.keyboard.press('Control+v')
await page.waitForTimeout(300)
const eventCount = await page.evaluate(
  () => document.querySelectorAll('.event-card').length
)
results.eventsAfterCtrlV = eventCount
await shot(page, '14-after-ctrlv.png')

// 17. 事件详细信息：深色 color-scheme
const card3 = await page.locator('.event-card').first().boundingBox()
await page.mouse.click(card3.x + card3.width / 2, card3.y + card3.height / 2, {
  button: 'right'
})
await page.waitForTimeout(250)
await page.click('.context-item:has-text("详细信息")')
await page.waitForTimeout(300)
const colorScheme = await page.evaluate(() => ({
  root: getComputedStyle(document.documentElement).colorScheme,
  input: getComputedStyle(document.querySelector('.modal-field input')).colorScheme
}))
results.colorScheme = colorScheme
await shot(page, '15-event-detail.png')

console.log(JSON.stringify(results, null, 2))
await app.close()
process.exit(0)
