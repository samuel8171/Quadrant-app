// Start Vite with vite.web.config.ts, then run:
// node scripts/quadrant-workspace-probe.mjs [port] [scenario name fragment]
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright-core'

const origin = 'http://127.0.0.1:' + (process.argv[2] || 5199)
const probeUrl = origin + '/probe.html?page=quadrant&sidebar=1'
const executablePath = process.env.UI_PROBE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const snapshotKey = 'quadrant-web-data-v2'
const cameraKey = 'quadrant-local-camera-v1'
const createdAt = '2025-01-06T00:00:00.000Z'
const desktop = { width: 1280, height: 800 }
const shortPhone = { width: 375, height: 667 }
const tallPhone = { width: 390, height: 844 }
const browser = await chromium.launch({ executablePath })

const event = (id, text, quadrant, x, y, width = 6) =>
  ({ id, text, remark: '', quadrant, x, y, width, createdAt })
const card = (page, id) => page.locator(`.event-card[data-event-id="${id}"]`)
const listCard = (page, id) => page.locator(`.quadrant-list-event[data-event-id="${id}"]`)
const toolbar = (page, name) => page.locator('.quadrant-toolbar').getByRole('button', { name, exact: true })

async function withPage(viewport, events, test, { mobile = false, camera, canvasBounds } = {}) {
  const context = await browser.newContext({
    viewport,
    isMobile: mobile,
    hasTouch: mobile,
    serviceWorkers: 'block'
  })
  const errors = []
  try {
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await context.routeWebSocket('**/*', route => route.close())
    const page = await context.newPage()
    page.setDefaultTimeout(4500)
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(({ dataKey, cameraKey, seed, camera }) => {
      if (localStorage.getItem(dataKey) === null) localStorage.setItem(dataKey, JSON.stringify(seed))
      if (camera && localStorage.getItem(cameraKey) === null) localStorage.setItem(cameraKey, JSON.stringify(camera))
    }, {
      dataKey: snapshotKey, cameraKey, camera,
      seed: { version: 2, events, canvasBounds, weekEvents: [], weekPresets: [], goals: [], weekCounterOffset: 0 }
    })
    await page.goto(probeUrl)
    await card(page, events[0].id).waitFor({ state: 'attached' })
    await test(page, context)
    assert.deepEqual(errors, [], 'uncaught page errors')
  } catch (error) {
    if (errors.length) console.error('Page errors:', errors)
    throw error
  } finally {
    await context.close()
  }
}

async function viewTransform(page) {
  return page.locator('.event-layer').evaluate(element => {
    const { a, e, f } = new DOMMatrixReadOnly(getComputedStyle(element).transform)
    return { zoom: a, x: e, y: f }
  })
}

async function box(locator) {
  const result = await locator.boundingBox()
  assert(result, `missing geometry for ${locator}`)
  return result
}

async function point(locator, x = 0.5, y = 0.5) {
  const rect = await box(locator)
  return { x: rect.x + rect.width * x, y: rect.y + rect.height * y }
}

function inside(outer, inner, label) {
  assert(inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height,
  `${label} outside usable viewport: ${JSON.stringify({ inner, outer })}`)
}

async function matchingViewLayout() {
  const events = [
    event('right-top', '准备这一周要交的报告和参考材料', 1, 1, 3),
    event('left-top', '安排本周阅读', 2, -7.5, 5),
    event('left-bottom', '整理待读清单', 3, -7.5, -5),
    event('right-bottom', '回复小组消息', 4, 1, -4)
  ]
  for (const viewport of [{ width: 320, height: 640 }, tallPhone, desktop]) {
    const mobile = viewport.width < 768
    await withPage(viewport, events, async page => {
      const sameHeaderRow = async () => {
        const title = await box(page.locator('.quadrant-header h1'))
        const mode = await box(page.locator('.quadrant-view-toggle'))
        assert(title.x + title.width <= mode.x)
        assert(Math.abs((title.y + title.height / 2) - (mode.y + mode.height / 2)) <= 1,
          'The view switch stays on the title row')
      }
      const choose = name => mobile ? toolbar(page, name).tap() : toolbar(page, name).click()
      await sameHeaderRow()
      await choose('全览')
      await sameHeaderRow()
      await choose('列表')
      await sameHeaderRow()
      const grid = await page.locator('.quadrant-list-column').evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect()
        return { quadrant: element.dataset.quadrant, x: rect.x, y: rect.y, height: rect.height }
      }))
      assert.deepEqual(grid.map(column => column.quadrant), ['2', '1', '3', '4'])
      if (mobile) {
        assert(grid.every(column => column.x === grid[0].x), 'Phone sections share a single column')
        assert(grid.slice(1).every((column, i) => column.y >= grid[i].y + grid[i].height),
          'Phone sections stack vertically in reading order')
      } else {
        assert.equal(grid[0].y, grid[1].y)
        assert.equal(grid[2].y, grid[3].y)
        assert.equal(grid[0].x, grid[2].x)
        assert.equal(grid[1].x, grid[3].x)
        assert(grid[0].x < grid[1].x && grid[0].y < grid[2].y)
      }
      assert(await page.locator('.quadrant-list-view, .quadrant-list-event').evaluateAll(
        elements => elements.every(element => element.scrollWidth <= element.clientWidth + 1)
      ), 'List and long card titles fit without horizontal scrolling')
      console.log('PASS matching view layout at', viewport.width)
    }, { mobile })
  }
}

async function mobileListDetails() {
  const item = event('phone-event', '手机事件', 2, -8, 5)
  await withPage(tallPhone, [item], async page => {
    await toolbar(page, '列表').tap()
    const row = listCard(page, item.id)
    assert((await box(row)).height <= 54, 'A short card fits on a compact row')
    assert.equal(await row.locator('.quadrant-list-drag').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)')
    assert.equal(await row.locator('select').isVisible(), false)
    await row.getByRole('button', { name: '详细信息「手机事件」' }).tap()

    const detail = page.locator('.modal').filter({ has: page.getByRole('heading', { name: '事件详细信息' }) })
    await detail.waitFor()
    const title = detail.getByLabel('名称')
    assert.equal(await title.evaluate(el => document.activeElement === el), false)
    await detail.getByLabel('备注').fill('照片操作期间的未保存备注')
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 32
      const context = canvas.getContext('2d')
      context.fillStyle = '#4da3ff'
      context.fillRect(0, 0, 32, 32)
      return canvas.toDataURL('image/png').split(',')[1]
    })
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      detail.getByRole('button', { name: '添加照片' }).tap()
    ])
    await chooser.setFiles({ name: 'probe.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
    await detail.getByRole('img', { name: '第 1 张照片' }).waitFor()
    await persisted(page, data => data.events.find(event => event.id === item.id)?.photos?.length === 1)
    assert.equal(await detail.getByLabel('备注').inputValue(), '照片操作期间的未保存备注')

    const confirm = page.locator('.confirm-modal')
    await detail.getByRole('button', { name: '删除第 1 张照片' }).tap()
    await confirm.getByRole('button', { name: '取消', exact: true }).tap()
    await confirm.waitFor({ state: 'detached' })
    assert.equal(await detail.getByRole('img', { name: '第 1 张照片' }).count(), 1)
    await detail.getByRole('button', { name: '删除第 1 张照片' }).tap()
    await confirm.getByRole('button', { name: '确认', exact: true }).tap()
    await confirm.waitFor({ state: 'detached' })
    await persisted(page, data => {
      const target = data.events.find(event => event.id === item.id)
      return target && !target.photos?.length
    })
    assert.equal(await detail.getByLabel('备注').inputValue(), '照片操作期间的未保存备注')
    await detail.getByRole('button', { name: '保存', exact: true }).tap()
    await detail.waitFor({ state: 'detached' })
    await persisted(page, data => data.events.find(event => event.id === item.id)?.remark === '照片操作期间的未保存备注')

    await row.getByRole('button', { name: '删除事件「手机事件」' }).tap()
    assert.match(await confirm.locator('.confirm-message').innerText(), /手机事件/)
    await confirm.getByRole('button', { name: '确认', exact: true }).tap()
    await row.waitFor({ state: 'detached' })
    await persisted(page, data => !data.events.some(event => event.id === item.id))
    console.log('PASS compact mobile row, shared detail, photo add and delete, draft retention and event deletion')
  }, { mobile: true })
}

async function overview(viewport, mobile) {
  const camera = { zoom: 1, x: mobile ? 3 : -4, y: mobile ? 2 : -3 }
  const events = [
    event('upper', '远端上缘', 2, -137, 120, 9),
    event('lower', '远端下缘', 4, 143, -128, 12),
    event('near', '近处基准', 1, 1, 5)
  ]
  await withPage(viewport, events, async page => {
    const click = name => mobile ? toolbar(page, name).tap() : toolbar(page, name).click()
    const initial = await viewTransform(page)
    assert.equal(initial.zoom, 1, 'editing camera opens at readable scale')
    await click('全览')
    const overviewView = await viewTransform(page)
    assert(overviewView.zoom < 0.2, 'overview zooms out from edit scale')
    const visible = await box(page.locator('.quadrant-viewport'))
    if (mobile) {
      const dock = await box(page.locator('.sidebar'))
      const header = await box(page.locator('.quadrant-header'))
      const bottom = Math.min(visible.y + visible.height, dock.y)
      visible.y = Math.max(visible.y, header.y + header.height)
      visible.height = bottom - visible.y
    }
    const upper = await box(card(page, 'upper'))
    const lower = await box(card(page, 'lower'))
    inside(visible, upper, 'upper card')
    inside(visible, lower, 'lower card')
    assert(upper.y < lower.y && upper.x < lower.x, 'far cards retain their offset world positions')
    const marker = page.getByRole('button', { name: '定位「远端上缘」', exact: true })
    if (mobile) await marker.tap()
    else await marker.click()
    assert((await viewTransform(page)).zoom >= 0.79, 'locating a far card restores readable zoom')
    inside(visible, await box(card(page, 'upper')), 'located card')
    await click('返回刚才位置')
    assert.deepEqual(await viewTransform(page), overviewView, 'returns from located card to overview')
    await click('返回刚才位置')
    assert.deepEqual(await viewTransform(page), initial, 'restores prior editing camera')
    await page.waitForFunction(({ key, camera }) => {
      const saved = JSON.parse(localStorage.getItem(key) || 'null')
      return saved?.zoom === camera.zoom && Math.abs(saved.x - camera.x) < 0.02 && Math.abs(saved.y - camera.y) < 0.02
    }, { key: cameraKey, camera }, { timeout: 3000 })
    await page.reload()
    await card(page, 'near').waitFor()
    assert.deepEqual(await viewTransform(page), initial, 'saved editing camera reloads')
    console.log(`PASS full extents and camera restore at ${viewport.width} × ${viewport.height}`)
  }, { mobile, camera })
}

async function mouseDrag(page, from, to, { dwell, release = true } = {}) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  if (dwell) await dwell.waitFor()
  if (release) await page.mouse.up()
}

function touchDriver(cdp) {
  const send = (type, point) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: point ? [{ x: point.x, y: point.y, id: 1 }] : []
  })
  return {
    start: point => send('touchStart', point),
    move: point => send('touchMove', point),
    end: () => send('touchEnd'),
    cancel: () => send('touchCancel')
  }
}

async function persisted(page, matches, values) {
  // Read the browser persistence path to verify commit, including hidden stack members.
  const until = Date.now() + 3500
  let data
  do {
    data = await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), snapshotKey)
    if (matches(data, values)) return data
    await delay(40)
  } while (Date.now() < until)
  assert.fail(`expected persisted snapshot for ${JSON.stringify(values)}: ${matches}\n${JSON.stringify(data)}`)
}

async function expandWorkspace() {
  const events = [event('edge', '边界卡', 1, 109, 6)]
  const initialBounds = { minX: -120, maxX: 120, minY: -100, maxY: 100 }
  await withPage(desktop, events, async page => {
    assert.equal((await viewTransform(page)).zoom, 1)
    const viewport = await box(page.locator('.quadrant-viewport'))
    const from = await point(card(page, 'edge'), 0.33)
    const to = { x: viewport.x + viewport.width - 14, y: from.y }
    await mouseDrag(page, from, to, { release: false })
    const beforeEdgePan = await viewTransform(page)
    await page.waitForFunction(x => {
      const layer = document.querySelector('.event-layer')
      return new DOMMatrixReadOnly(getComputedStyle(layer).transform).e < x - 25
    }, beforeEdgePan.x, { timeout: 1500 })
    const floating = await point(card(page, 'edge'), 0.33)
    assert(Math.abs(floating.x - to.x) < 4, 'stationary grip is preserved while the camera pans')
    await page.mouse.up()
    const snapshot = await persisted(page, (data, maxX) =>
      data.canvasBounds?.maxX > maxX && data.events[0].x > maxX, initialBounds.maxX)
    assert(snapshot.canvasBounds.maxX >= snapshot.events[0].x + snapshot.events[0].width)
    await page.reload()
    await card(page, 'edge').waitFor({ state: 'attached' })
    await toolbar(page, '全览').click()
    inside(await box(page.locator('.quadrant-viewport')), await box(card(page, 'edge')), 'stored extremity')
    console.log('PASS stationary edge pans at 100%, preserves grip and persists expanded bounds')
  }, { camera: { zoom: 1, x: 118, y: 6 }, canvasBounds: initialBounds })
}

async function canvasGroups() {
  const events = [
    event('target', '准备答辩', 1, 3, 7),
    event('first', '整理资料', 1, 11, 7),
    event('second', '练习讲稿', 1, 11, 3),
    event('sweep', '快速经过', 1, 3, 11),
    event('keep', '保留象限', 2, -10, 12),
    event('move', '移动象限', 2, -10, 8),
    event('cancel', '取消操作', 2, -10, 4)
  ]
  await withPage(desktop, events, async page => {
    const target = card(page, 'target')
    const dwellOnTarget = async id => mouseDrag(page, await point(card(page, id), 0.28), await point(target), {
      dwell: page.locator('.event-card.group-drop-target')
    })
    await mouseDrag(page, await point(card(page, 'sweep')), await point(card(page, 'target')), { release: false })
    await page.waitForTimeout(100)
    assert.equal(await page.locator('.event-card.group-drop-target').count(), 0, 'fast passage does not arm grouping')
    const view = await box(page.locator('.quadrant-viewport'))
    await page.mouse.move(view.x + view.width * 0.72, view.y + view.height * 0.27, { steps: 4 })
    await page.mouse.up()
    assert.equal(await page.locator('.event-group-badge').count(), 0, 'fast passage does not form a group')

    await dwellOnTarget('first')
    const created = await persisted(page, data => data.eventGroups?.length === 1 &&
      data.events.filter(event => event.groupId === data.eventGroups[0].id).length === 2)
    const groupId = created.eventGroups[0].id
    await dwellOnTarget('second')
    await persisted(page, (data, groupId) => data.events.find(event => event.id === 'second')?.groupId === groupId, groupId)

    const dialog = page.getByRole('dialog', { name: '加入卡组？' })
    for (const [id, choice, expectedQuadrant] of [
      ['keep', '保留原象限并加入', 2],
      ['move', '移到目标象限并加入', 1],
      ['cancel', '取消', 2]
    ]) {
      await dwellOnTarget(id)
      await dialog.waitFor()
      assert.match(await dialog.innerText(), /准备答辩.*重要不紧急.*重要紧急/s)
      const before = await persisted(page, (data, id) => data.events.some(event => event.id === id && !event.groupId), id)
      await dialog.getByRole('button', { name: choice, exact: true }).click()
      await dialog.waitFor({ state: 'detached' })
      const expectedGroup = id === 'cancel' ? null : groupId
      const after = await persisted(page, (data, { id, expectedQuadrant, expectedGroup }) =>
        data.events.some(event => event.id === id && event.quadrant === expectedQuadrant && (event.groupId ?? null) === expectedGroup),
      { id, expectedQuadrant, expectedGroup })
      if (id === 'cancel') assert.deepEqual(after.events, before.events, 'cancel leaves all event fields intact')
    }

    const badge = target.locator('.event-group-badge')
    await badge.click()
    const groupDialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: '卡组名称' }) })
    await groupDialog.waitFor()
    assert.equal(await groupDialog.locator('article').count(), 5)
    const name = groupDialog.getByRole('textbox', { name: '卡组名称' })
    await name.fill('答辩准备清单')
    await name.press('Enter')
    await persisted(page, (data, groupId) => data.eventGroups?.find(group => group.id === groupId)?.name === '答辩准备清单', groupId)
    await groupDialog.getByRole('button', { name: '关闭', exact: true }).click()
    await groupDialog.waitFor({ state: 'detached' })

    const remote = page.getByRole('button', { name: '定位卡组「答辩准备清单」', exact: true })
    const beforeLocate = await viewTransform(page)
    await remote.focus()
    await page.locator('.quadrant-group-connectors path').waitFor({ state: 'attached' })
    await remote.click()
    assert.notDeepEqual(await viewTransform(page), beforeLocate, 'remote tab locates the main stack')
    await toolbar(page, '返回刚才位置').click()
    assert.deepEqual(await viewTransform(page), beforeLocate, 'remote anchor location can be reversed')

    const from = await point(target, 0.26)
    const to = { x: view.x + view.width * 0.66, y: view.y + view.height * 0.74 }
    await mouseDrag(page, from, to, { release: false })
    const floating = await point(page.locator('.event-card.dragging'), 0.26)
    assert(Math.abs(floating.x - to.x) < 4 && Math.abs(floating.y - to.y) < 4,
      `card should preserve pointer grip: ${JSON.stringify({ floating, to })}`)
    await page.mouse.up()
    await persisted(page, (data, groupId) =>
      data.eventGroups?.find(group => group.id === groupId)?.anchorQuadrant === 4 &&
      data.events.filter(event => event.groupId === groupId && event.quadrant === 4).length === 5, groupId)
    await toolbar(page, '列表').click()
    const moved = page.locator('.quadrant-list-column[data-quadrant="4"] .quadrant-list-event')
      .filter({ hasText: '答辩准备清单' })
    await moved.waitFor()
    assert.match(await moved.innerText(), /5 张/)
    console.log('PASS real mouse drag, sweep, group create/append, cross-quadrant choices, group dialog, move and list parity')
  })
}

async function touchList() {
  const events = [
    event('target', '清单主卡', 1, 1, 3),
    event('first', '清单待分组', 1, 2, 6),
    event('cancel', '清单取消卡', 1, 3, 9),
    event('remote', '清单跨列卡', 2, -10, 4),
    ...Array.from({ length: 14 }, (_, i) => event('overflow-' + i, '补充卡 ' + i, 3, -14, -8 - i * 3))
  ]
  await withPage(tallPhone, events, async (page, context) => {
    await toolbar(page, '列表').tap()
    await page.evaluate(() => {
      window.listPointerTrace = []
      for (const type of ['pointerdown', 'pointermove', 'pointercancel', 'pointerup', 'gotpointercapture', 'lostpointercapture']) {
        document.addEventListener(type, event => {
          const target = event.target instanceof Element ? event.target : null
          window.listPointerTrace.push([type, event.pointerType, event.clientX, event.clientY,
            target?.tagName, target?.className, event.isPrimary,
            target?.closest('[data-quadrant]')?.getAttribute('data-quadrant'),
            type === 'pointerdown' ? target?.outerHTML.slice(0, 150) : undefined])
        }, true)
      }
      window.addEventListener('blur', () => window.listPointerTrace.push(['window blur']))
    })
    const touch = touchDriver(await context.newCDPSession(page))
    const target = listCard(page, 'target')
    const hold = async (id, destination) => {
      const from = await point(listCard(page, id).locator('.quadrant-list-drag'))
      const to = await point(destination)
      const startHit = await page.evaluate(({ x, y }) => document.elementsFromPoint(x, y).slice(0, 6)
        .map(element => [element.tagName, element.className, element.getBoundingClientRect().y]), from)
      await touch.start(from)
      await touch.move(to)
      try {
        await destination.and(page.locator('.group-drop-target')).waitFor()
      } catch (error) {
        const diagnostics = await page.evaluate(({ x, y }) => ({
          hit: document.elementFromPoint(x, y)?.outerHTML.slice(0, 240),
          trace: window.listPointerTrace.slice(-18),
          scrollTop: document.querySelector('.quadrant-list-view').scrollTop,
          preview: document.querySelector('.quadrant-list-drag-preview')?.textContent
        }), to)
        const list = await box(page.locator('.quadrant-list-view'))
        throw new Error(`touch dwell for ${id}: ${JSON.stringify({ from, to, startHit, list, ...diagnostics })}\n${error.message}`)
      }
    }
    await hold('first', target)
    await touch.end()
    const grouped = await persisted(page, data => data.eventGroups?.length === 1 &&
      data.events.filter(event => event.groupId === data.eventGroups[0].id).length === 2)
    const groupId = grouped.eventGroups[0].id
    const representative = page.locator('.quadrant-list-event').filter({ hasText: '清单主卡' }).first()
    await hold('cancel', representative)
    await touch.cancel()
    await page.locator('.quadrant-list-drag-preview').waitFor({ state: 'detached' })
    assert.equal(await representative.evaluate(el => el.classList.contains('group-drop-target')), false)
    assert.equal((await persisted(page, data => data.eventGroups?.length === 1)).events.find(event => event.id === 'cancel').groupId, undefined)

    await hold('remote', representative)
    await touch.end()
    const dialog = page.getByRole('dialog', { name: '加入卡组？' })
    await dialog.getByRole('button', { name: '保留原象限并加入' }).tap()
    await dialog.waitFor({ state: 'detached' })
    await persisted(page, (data, groupId) =>
      data.events.some(event => event.id === 'remote' && event.quadrant === 2 && event.groupId === groupId), groupId)

    const list = page.locator('.quadrant-list-view')
    const listBox = await box(list)
    const dockBox = await box(page.locator('.sidebar'))
    await touch.start(await point(listCard(page, 'cancel').locator('.quadrant-list-drag')))
    await touch.move({ x: listBox.x + listBox.width / 2, y: Math.min(listBox.y + listBox.height, dockBox.y) - 12 })
    await page.waitForFunction(() => document.querySelector('.quadrant-list-view').scrollTop > 48)
    await touch.cancel()
    await page.locator('.quadrant-list-drag-preview').waitFor({ state: 'detached' })

    await toolbar(page, '画布').tap()
    await page.locator('.event-card[data-event-id="remote"] .event-group-badge').waitFor()
    console.log('PASS real touch list dwell, cancellation, cross-quadrant join, edge scrolling and canvas parity')
  }, { mobile: true })
}

async function touchCanvas() {
  const events = [
    event('target', '手机主卡', 1, 1, 7),
    event('join', '手机待分组', 1, 1, 3),
    event('cancel', '触摸取消', 2, -7, 6)
  ]
  await withPage(tallPhone, events, async (page, context) => {
    const touch = touchDriver(await context.newCDPSession(page))
    const waitForDwell = page.locator('.event-card.group-drop-target')
    const dragTo = async (id, target) => {
      const from = await point(card(page, id), 0.25)
      const to = await point(target)
      await touch.start(from)
      await touch.move({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 })
      await touch.move(to)
      await waitForDwell.waitFor()
    }
    await dragTo('join', card(page, 'target'))
    await touch.end()
    const grouped = await persisted(page, data => data.eventGroups?.length === 1 &&
      data.events.filter(event => event.groupId === data.eventGroups[0].id).length === 2)
    const representative = page.locator('.event-card').filter({ hasText: '手机主卡' }).first()
    await dragTo('cancel', representative)
    await touch.cancel()
    await waitForDwell.waitFor({ state: 'detached' })
    await page.locator('.event-card.dragging').waitFor({ state: 'detached' })
    assert.equal(await page.getByRole('dialog', { name: '加入卡组？' }).count(), 0)
    assert.deepEqual(
      (await persisted(page, data => data.eventGroups?.length === 1)).events,
      grouped.events,
      'canvas pointer cancel discards the preview'
    )
    console.log('PASS real touch canvas dwell and pointer cancellation')
  }, { mobile: true })
}

const scenarios = [
  ['matching view layout', matchingViewLayout],
  ['mobile list details and photos', mobileListDetails],
  ['desktop overview', () => overview(desktop, false)],
  ['375px overview', () => overview(shortPhone, true)],
  ['390px overview', () => overview(tallPhone, true)],
  ['workspace expansion at 100%', expandWorkspace],
  ['canvas group interactions', canvasGroups],
  ['touch canvas interactions', touchCanvas],
  ['touch list interactions', touchList]
]

try {
  const filter = process.argv[3] ?? ''
  const selected = scenarios.filter(([name]) => name.includes(filter))
  assert(selected.length, `unknown scenario: ${filter}`)
  // Keep one tab active at a time. List drags intentionally cancel when the window blurs.
  for (const [name, run] of selected) {
    try {
      await run()
    } catch (error) {
      console.error('FAIL ' + name, error.message)
      process.exitCode = 1
    }
  }
} finally {
  await browser.close()
}
