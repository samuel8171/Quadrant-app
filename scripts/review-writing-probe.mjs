// Run against the web dev server: node scripts/review-writing-probe.mjs [port]
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const origin = 'http://127.0.0.1:' + (process.argv[2] || 5199)
const executablePath = process.env.UI_PROBE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const browser = await chromium.launch({ executablePath })

async function geometry(area) {
  return area.evaluate(el => ({
    height: el.clientHeight,
    content: el.scrollHeight,
    inner: el.scrollTop,
    outer: el.closest('.review-page').scrollTop,
    cursor: el.selectionEnd
  }))
}

try {
  for (const [mobile, withLedger] of [[false, false], [true, false], [true, true]]) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 375, height: 667 } : { width: 1280, height: 800 },
      hasTouch: mobile, isMobile: mobile, serviceWorkers: 'block'
    })
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    const page = await context.newPage()
    await page.goto(origin + '/probe.html?page=review&sidebar=1')
    const area = page.locator('.review-textarea')
    await area.waitFor()
    if (withLedger) {
      const config = await page.evaluate(() => window.__DEFAULT_MONEY_CONFIG__)
      const week = {
        weekStart: '2026-11-09', weekEnd: '2026-11-15', weekTC: 560, spentTC: 120,
        weekOver: 0, plannedMin: 720, actualMin: 710, doneCount: 6, missCount: 1, unplannedCount: 0,
        unplannedMin: 0, nightMin: 0, overLimitDays: 0, penaltyTier: 0, nextWeekTC: 560, nextWeekLT: 20, notes: []
      }
      await page.addInitScript((money) => {
        localStorage.setItem('quadrant-web-data-v2', JSON.stringify({
          version: 2, goals: [], events: [], weekEvents: [], weekPresets: [], weekCounterOffset: 0, money
        }))
      }, { enabled: true, config, days: [], weeks: [week] })
      await page.reload()
      await page.locator('.week-ledger').waitFor()
    }
    const initial = await geometry(area)
    const draft = Array.from({ length: 80 }, (_, i) => `${i + 1} 本周复盘，希望下周还是先做最重要的一件事。`).join('\n')
    await area.fill(draft)
    await area.press('Control+End')
    for (let i = 0; i < 4; i++) {
      await area.press('Enter')
      await page.keyboard.insertText('继续')
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const state = await geometry(area)
      assert.ok((mobile ? state.inner : state.outer) > 100, 'The editor jumped to the top while typing')
    }
    const before = await geometry(area)
    await page.getByRole('button', { name: '复盘记录' }).click()
    await page.getByRole('button', { name: '返回' }).click()
    const after = await geometry(area)
    assert.equal(after.cursor, before.cursor)
    assert.equal(await area.inputValue(), draft + '\n继续'.repeat(4))
    if (mobile) {
      assert.equal(after.height, initial.height)
      assert.equal(after.inner, before.inner)
      await page.setViewportSize({ width: 375, height: 410 })
      await area.scrollIntoViewIfNeeded()
      await area.press('Control+End')
      await page.keyboard.insertText('输入法确认后的末行')
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const resized = await geometry(area)
      assert.ok(resized.content - resized.inner - resized.height < 30, 'Last line outside the resized editor: ' + JSON.stringify(resized))
      await page.setViewportSize({ width: 375, height: 667 })
    } else {
      assert.ok(after.height >= after.content - 2, 'Draft clipped on return')
      assert.ok(Math.abs(after.outer - before.outer) < 3, `Desktop reading position changed from ${before.outer} to ${after.outer}`)
    }
    await area.fill('短文')
    assert.equal((await geometry(area)).height, initial.height)
    console.log('PASS review editor', { mobile, withLedger })
    await context.close()
  }
} finally {
  await browser.close()
}
