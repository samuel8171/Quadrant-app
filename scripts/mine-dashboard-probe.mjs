// Run against the web dev server: node scripts/mine-dashboard-probe.mjs [port]
// Set MINE_PROBE_SCREENSHOTS to an existing directory to save sample captures.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const origin = 'http://127.0.0.1:' + (process.argv[2] || 5199)
const executablePath = process.env.UI_PROBE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const screenshotDir = process.env.MINE_PROBE_SCREENSHOTS
const browser = await chromium.launch({ executablePath })

function syntheticLedger(config) {
  const readings = [
    [1, 48, 1.5], [2, 88, 3], [3, 65, -0.5], [5, 104, 2], [6, 72, 1],
    [7, 13, -1.5], [8, 42, 2.5], [9, 118, -0.5], [11, 62, 1], [12, 97, 2],
    [14, 52, 0.5], [15, 35, 1.5], [16, 0, 0], [17, 68, 1.5], [19, 128, -2], [20, 36, -3]
  ]
  const day = (date, spentTC, deltaLT) => ({
    date, settledAt: date + 'T14:00:00Z', entries: [], videoMin: 0, gameMin: 0,
    latePhone: false, dayLimit: 80, spentTC, overdraft: Math.max(0, spentTC - 80),
    deltaLT, nightPending: false, isRestDay: false
  })
  const days = [day('2026-10-28', 47, 1), ...readings.map(([n, spentTC, deltaLT]) =>
    day('2026-11-' + String(n).padStart(2, '0'), spentTC, deltaLT))]
  days.at(-1).entries = [
    { id: 'practice', kind: 'planned', sourceId: null, title: '练习', quadrant: 2, plannedMin: 90,
      actualMin: 84, done: true, nightMin: 35, costTC: 20, deltaLT: 0.5 },
    { id: 'review', kind: 'planned', sourceId: null, title: '整理笔记', quadrant: 1, plannedMin: 30,
      actualMin: 36, done: true, nightMin: 0, costTC: 16, deltaLT: 0 },
    { id: 'missed', kind: 'planned', sourceId: null, title: '查资料', quadrant: 2, plannedMin: 40,
      actualMin: 0, done: false, nightMin: 0, costTC: 0, deltaLT: -1 }
  ]
  return {
    version: 2, weekCounterOffset: 0, goals: [], events: [], weekPresets: [], weekEvents: [],
    money: { enabled: true, enabledAt: '2026-10-28', config, days, weeks: [] }
  }
}

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1, `${message}: ${actual} vs ${expected}`)
}

async function settlePaint(page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}

async function sampleImage(page, image, regions) {
  return page.evaluate(async ({ encoded, regions }) => {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    return regions.map(region => {
      const { data } = ctx.getImageData(region.x, region.y, region.width, region.height)
      let bright = 0
      let sum = 0
      let squareSum = 0
      for (let i = 0; i < data.length; i += 4) {
        sum += data[i]
        squareSum += data[i] ** 2
        if (data[i] > 205 && data[i + 1] > 205 && data[i + 2] > 205) bright++
      }
      const count = data.length / 4
      return { bright, deviation: Math.sqrt(squareSum / count - (sum / count) ** 2) }
    })
  }, { encoded: image.toString('base64'), regions })
}

async function captureDashboard(page, path) {
  const keyText = await page.locator('.mine-page h1, .mine-overview-heading h2, .money-metric-value strong').evaluateAll(elements =>
    elements.map(el => {
      const bounds = el.getBoundingClientRect()
      return {
        x: Math.floor(bounds.x),
        y: Math.floor(bounds.y),
        width: Math.ceil(bounds.width),
        height: Math.ceil(bounds.height)
      }
    })
  )
  // A cold headless screenshot can return before the text tiles have been composited.
  for (let attempt = 0; attempt < 3; attempt++) {
    await settlePaint(page)
    const png = await page.screenshot({ scale: 'css' })
    const samples = await sampleImage(page, png, keyText)
    if (samples.every(({ bright }) => bright > 10)) {
      await writeFile(path, png)
      return
    }
  }
  assert.fail('The dashboard title and four metric values should be visible in the preview')
}

async function checkLayout(page, width) {
  const layout = await page.evaluate(() => {
    const box = (el) => el.getBoundingClientRect().toJSON()
    return {
      page: box(document.querySelector('.mine-page')),
      viewportScrollWidth: document.documentElement.scrollWidth,
      metrics: Array.from(document.querySelectorAll('.money-metric'), box),
      firstChart: box(document.querySelector('.money-widget--trend')),
      insights: box(document.querySelector('.mine-insights')),
      details: Array.from(document.querySelectorAll('.mine-insights .money-widget'), box),
      daily: box(document.querySelector('[data-chart="daily"]')),
      cumulative: box(document.querySelector('[data-chart="cumulative"]')),
      picker: box(document.querySelector('.money-chart-picker')),
      grid: box(document.querySelector('.mine-dashboard-grid')),
      utilities: box(document.querySelector('.mine-utility-grid'))
    }
  })
  const gap = width < 768 ? 12 : 24
  const metricsPerRow = width < 1024 ? 2 : 4
  assert.equal(layout.metrics.length, 4)
  assert.equal(layout.viewportScrollWidth, width, 'Viewport must fit all cards')
  for (const [index, metric] of layout.metrics.entries()) {
    const rowFirst = layout.metrics[Math.floor(index / metricsPerRow) * metricsPerRow]
    near(metric.top, rowFirst.top, 'Metric tops in a row')
    near(metric.bottom, rowFirst.bottom, 'Metric bottoms in a row')
    near(metric.width, rowFirst.width, 'Equal metric widths')
    if (index % metricsPerRow) near(metric.left - layout.metrics[index - 1].right, gap, 'Horizontal metric gap')
  }
  if (metricsPerRow === 2) near(layout.metrics[2].top - layout.metrics[0].bottom, gap, 'Vertical metric gap')
  for (const metric of layout.metrics.slice(-metricsPerRow)) near(layout.firstChart.top - metric.bottom, gap, 'Gap from metrics to trend')
  if (width >= 1120) {
    near(layout.firstChart.top, layout.insights.top, 'Analysis row tops')
    near(layout.firstChart.bottom, layout.insights.bottom, 'Analysis row bottoms')
    near(layout.insights.left - layout.firstChart.right, gap, 'Analysis row gap')
  } else {
    near(layout.insights.top - layout.firstChart.bottom, gap, 'Stacked analysis gap')
  }
  for (const card of layout.details) assert.ok(card.width >= 200, 'Summary card usable width')
  near(layout.utilities.top - layout.grid.bottom, gap, 'Gap above settings')
  assert.ok(layout.daily.height >= 110 && layout.daily.width >= 200, 'Daily bars have room at all widths')
  assert.ok(layout.cumulative.height >= 74, 'Weekly curve has room on compact screens')
  near(layout.daily.left, layout.cumulative.left, 'Plots share a date origin')
  near(layout.daily.right, layout.cumulative.right, 'Plots share a date width')
  near(layout.daily.top, layout.picker.top, 'Picker starts at the bars')
  near(layout.cumulative.bottom, layout.picker.bottom, 'Picker extends to the curve')
  return { gap, columns: metricsPerRow, plotWidth: Math.round(layout.daily.width) }
}

async function checkGlass(page, engine) {
  await settlePaint(page)
  await page.waitForFunction(() => [...document.querySelectorAll('.mine-card-glass')].every((host) =>
    host.querySelector('.gs-plate')?.getBoundingClientRect().width > 0))
  const panels = await page.locator('.mine-card-glass').evaluateAll(hosts => hosts.map(host => {
    const plate = host.querySelector('.gs-plate')
    const face = host.querySelector('.glass, .gs-fallback')
    const box = plate.getBoundingClientRect()
    const card = host.getBoundingClientRect()
    return {
      engine: host.querySelector('.gs-layer').dataset.glassEngine,
      filter: getComputedStyle(plate).backdropFilter,
      input: getComputedStyle(face).pointerEvents,
      library: !!host.querySelector('.gs-panel svg filter'),
      shaderMode: Number(host.querySelector('.gs-panel svg feDisplacementMap')?.getAttribute('scale')) > 0,
      left: box.left - card.left,
      top: box.top - card.top,
      width: box.width - card.width,
      height: box.height - card.height,
      radius: getComputedStyle(plate).borderTopLeftRadius,
      frameRadius: getComputedStyle(host).borderTopLeftRadius
    }
  }))
  assert.equal(panels.length, 9, 'All dashboard panels have glass')
  for (const panel of panels) {
    assert.equal(panel.engine, engine)
    assert.equal(panel.input, 'none', 'Glass must leave the controls clickable')
    assert.equal(panel.library, engine === 'chromium')
    assert.equal(panel.shaderMode, false, 'Embedded panels skip the per-card shader raster')
    assert.match(panel.filter, /blur\(/)
    assert.equal(panel.radius, panel.frameRadius)
    for (const edge of ['left', 'top', 'width', 'height']) near(panel[edge], 0, 'Glass matches card ' + edge)
  }
}

async function checkBlur(page) {
  const metric = page.locator('.money-metric').first()
  await metric.scrollIntoViewIfNeeded()
  const box = await metric.boundingBox()
  const region = { x: Math.floor(box.x + 36), y: Math.floor(box.y + box.height / 2), width: 80, height: 1 }
  const contrast = async () => {
    await settlePaint(page)
    const [sample] = await sampleImage(page, await page.screenshot({ scale: 'css' }), [region])
    return sample.deviation
  }
  const fixture = await page.addStyleTag({ content: `
    .page.mine-page { background: repeating-linear-gradient(90deg, #fff 0 4px, #000 4px 8px) !important; }
    .money-metric > :not(.mine-card-glass) { visibility: hidden; }
  ` })
  try {
    const blurred = await contrast()
    const plate = metric.locator('.gs-plate')
    await plate.evaluate(el => { el.style.backdropFilter = 'none' })
    try {
      const sharp = await contrast()
      assert.ok(sharp > 20 && blurred / sharp < .3, 'Glass blurs the page behind the card: ' + blurred + ' / ' + sharp)
    } finally {
      await plate.evaluate(el => el.style.removeProperty('backdrop-filter'))
    }
  } finally {
    await fixture.evaluate(el => el.remove())
  }
}

try {
  const profiles = [[1440, 900], [1280, 800], [1024, 768], [390, 844], [375, 667], [320, 640], [390, 844, 'fallback']]
  for (const [width, height, engine = 'chromium'] of profiles) {
    const mobile = width < 768
    const context = await browser.newContext({
      viewport: { width, height }, isMobile: mobile, hasTouch: mobile,
      reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block'
    })
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    const page = await context.newPage()
    const failures = []
    page.on('pageerror', error => failures.push(error.message))
    await page.clock.setFixedTime(new Date('2026-11-20T12:00:00+08:00'))
    await page.goto(origin + '/probe.html?page=mine&sidebar=1')
    await page.locator('.mine-page').waitFor()
    const data = syntheticLedger(await page.evaluate(() => window.__DEFAULT_MONEY_CONFIG__))
    await page.evaluate(({ data, engine, mode }) => {
      localStorage.setItem('quadrant-web-data-v2', JSON.stringify(data))
      localStorage.setItem('quadrant-glass-v1', JSON.stringify({ forceEngine: engine, mode }))
    }, { data, engine, mode: width === 1440 ? 'shader' : 'standard' })
    await page.reload()
    await page.locator('.money-widget--trend').waitFor()
    const geometry = await checkLayout(page, width)
    await checkGlass(page, engine)
    const slider = page.getByRole('slider', { name: '查看某天账目' })
    const selectDay = (key) => slider.press(key)
    const capture = async (period) => {
      if (!screenshotDir || (width !== 1440 && width !== 390)) return
      const profile = !mobile ? 'desktop' : engine === 'chromium' ? 'mobile' : 'mobile-fallback'
      await page.evaluate(() => {
        document.activeElement?.blur()
        document.querySelector('.mine-page').scrollTop = 0
      })
      await captureDashboard(page, join(screenshotDir, 'vision-glass-' + period + '-' + profile + '.png'))
    }

    assert.equal(await slider.getAttribute('aria-valuemax'), '7')
    assert.match(await slider.getAttribute('aria-valuetext'), /累计 232 时币，娱币累计净变化 -3.5/)
    for (const kind of ['time', 'leisure']) {
      const bars = page.locator(`[data-bars="${kind}"]`)
      assert.equal(await bars.locator('[data-day]').count(), 4)
      assert.equal(await bars.locator('line[data-day="0"]').count(), 1)
      assert.equal(await bars.locator('[data-day="2"]').count(), 0)
      const series = page.locator(`[data-chart="cumulative"] [data-series="${kind}"]`)
      assert.match(await series.locator('.money-series-line').first().getAttribute('d'), / C /)
      const gap = series.locator('.money-series-line.is-interpolated')
      assert.match(await gap.getAttribute('d'), / C /)
      assert.notEqual(await gap.evaluate(el => getComputedStyle(el).strokeDasharray), 'none')
    }
    await capture('week')
    await selectDay('Home')
    assert.match(await slider.getAttribute('aria-valuetext'), /11月16日，0 时币/)
    if (mobile) {
      const box = await slider.boundingBox()
      await slider.tap({ position: { x: box.width * 4.5 / 7, y: box.height - 8 } })
      assert.match(await slider.getAttribute('aria-valuetext'), /11月20日.*累计 232 时币/)
      await selectDay('Home')
    }
    await selectDay('ArrowRight')
    await selectDay('ArrowRight')
    assert.match(await slider.getAttribute('aria-valuetext'), /11月18日，未记录/)
    await selectDay('End')
    assert.match(await slider.getAttribute('aria-valuetext'), /日期未到/)

    await page.getByRole('button', { name: '月', exact: true }).click()
    assert.equal(await slider.getAttribute('aria-valuemax'), '30')
    assert.equal(await page.locator('.money-chart-axis span').count(), 5)
    assert.equal(await page.locator('[data-chart="cumulative"], .money-series-line').count(), 0)
    for (const kind of ['time', 'leisure']) {
      const bars = page.locator(`[data-bars="${kind}"]`)
      assert.equal(await bars.locator('[data-day]').count(), 16)
      assert.equal(await bars.locator('line[data-day="15"]').count(), 1)
      assert.equal(await bars.locator('[data-day="17"], [data-day="20"]').count(), 0)
    }
    await checkGlass(page, engine)
    await capture('month')
    await page.getByRole('button', { name: '上个月' }).click()
    assert.equal(await slider.getAttribute('aria-valuemax'), '31')
    assert.match(await page.locator('.money-trend-range').innerText(), /2026年10月/)
    await page.getByRole('button', { name: '下个月' }).click()
    assert.equal(await slider.getAttribute('aria-valuemax'), '30')
    assert.equal(await page.getByRole('button', { name: '下个月' }).isDisabled(), true)
    if (mobile) {
      await slider.scrollIntoViewIfNeeded()
      const box = await slider.boundingBox()
      await slider.tap({ position: { x: box.width * (18 - 0.5) / 30, y: box.height / 2 } })
      assert.match(await slider.getAttribute('aria-valuetext'), /11月18日，未记录/)
    }
    if (width === 1440 || engine === 'fallback') await checkBlur(page)

    if (width === 390 && engine === 'chromium') {
      await page.getByRole('button', { name: '外观 液态玻璃' }).click()
      await page.locator('.gs-viewport .modal').waitFor()
      await page.locator('.gs-viewport .modal').getByRole('button', { name: '完成', exact: true }).click()
      await page.locator('.gs-viewport .modal').waitFor({ state: 'detached' })
      await page.getByRole('switch', { name: '金钱系统' }).click()
      await page.locator('.mine-dashboard-grid').waitFor({ state: 'detached' })
    }
    assert.deepEqual(failures, [])
    console.log('PASS', `${width}×${height} ${engine}`, geometry)
    await context.close()
  }
} finally {
  await browser.close()
}
