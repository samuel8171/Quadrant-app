// Run against the web dev server: node scripts/mobile-editor-probe.mjs [port]
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const origin = 'http://127.0.0.1:' + (process.argv[2] || 5199)
const executablePath = process.env.UI_PROBE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const browser = await chromium.launch({ executablePath })

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block',
    reducedMotion: 'reduce'
  })
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  const page = await context.newPage()
  await page.addInitScript(() => {
    const weekEvents = Array.from({ length: 15 }, (_, index) => {
      const d = new Date()
      d.setDate(d.getDate() + index - 7)
      const date = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
      return { id: 'test-' + date, date, title: '编辑已有日程', quadrant: 1, startMin: 480, endMin: 570,
        color: '#8AB4F8', remark: '', showInQuadrant: false, createdAt: d.toISOString() }
    })
    localStorage.setItem('quadrant-web-data-v2', JSON.stringify({
      version: 2, events: [], weekEvents, weekPresets: [], goals: [], weekCounterOffset: 0
    }))
  })
  await page.goto(origin + '/probe.html?page=weekly&sidebar=1')
  await page.locator('.week-col-head').nth(3).click()
  const block = page.locator('.day-event').first()
  await block.scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  const rect = await block.boundingBox()
  for (let i = 0; i < 2; i++) await page.touchscreen.tap(rect.x + 20, rect.y + 8)
  await page.waitForTimeout(400)
  const dialog = page.locator('.weekly-dialog')
  assert.equal(await dialog.count(), 1)
  assert.equal(await dialog.locator('input').first().inputValue(), '编辑已有日程')
  assert.equal(await page.evaluate(() => document.activeElement.matches('input,textarea')), false)
  await page.touchscreen.tap(4, 150)
  await dialog.waitFor({ state: 'detached' })
  console.log('PASS touch double-tap edits existing event and waits for intentional dismissal')

  const cdp = await context.newCDPSession(page)
  const before = await block.boundingBox()
  const x = before.x + before.width / 3
  const y = before.y + 12
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await page.locator('.day-event.armed').waitFor()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + 61 }] })
  await page.locator('.day-event.dragging').waitFor()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const floating = await block.boundingBox()
  assert.ok(Math.abs(floating.y - before.y - 61) < 2, 'The event must follow the first drag frame')
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.locator('.day-event.dragging').waitFor({ state: 'detached' })
  assert.ok((await block.boundingBox()).y > before.y + 48)
  assert.equal(await block.evaluate(el => el.getAnimations().length), 0)
  console.log('PASS touch drag follows the finger with reduced motion')

  await page.goto(origin + '/probe.html?page=quadrant')
  const canvas = page.locator('.quadrant-viewport')
  await canvas.waitFor()
  const view = await canvas.boundingBox()
  const input = page.locator('.event-input')
  for (const [action, x, y, count] of [['blur', .7, .3, 1], ['Escape', .23, .72, 1], ['Enter', .23, .72, 2]]) {
    await page.waitForTimeout(450)
    for (let i = 0; i < 2; i++) await page.touchscreen.tap(view.x + view.width * x, view.y + view.height * y)
    await input.fill(action)
    await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
    assert.equal(await input.count(), 1, 'Enter during text composition must not commit')
    if (action === 'blur') await input.evaluate(el => el.blur())
    else await input.press(action)
    await input.waitFor({ state: 'detached' })
    assert.equal(await page.locator('.event-card').count(), count)
  }
  console.log('PASS touch inline event blur, Escape and Enter')
} finally {
  await browser.close()
}
