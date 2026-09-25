#!/usr/bin/env node
/**
 * 液态玻璃视觉巡检：四个页面 × 两种视口 + 各类弹窗。
 *
 * 探针给数字，这个给眼睛。本项目已多次出现「数值全对、版式崩掉」
 * （按钮被挤到换行、文字被 sticky 裁掉），只有截图看得见。
 * 例如弹窗按钮行用 `margin: 20px -16px -16px` 向两侧出血，数值上
 * "弹窗居中"完全成立，但按钮比正文宽 32px、与标题左右不齐 —— 只有截图看出来。
 *
 * 用法：node scripts/glass-shots.mjs --out docs/probes/liquid-glass-shots
 */
import { existsSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const ARG = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d
}

const CANDIDATES = [
  process.env.UI_PROBE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean)
const executablePath = CANDIDATES.find((p) => existsSync(p))
if (!executablePath) {
  console.error('未找到可用浏览器')
  process.exit(2)
}

const port = ARG('port', '5199')
const outDir = ARG('out', 'docs/probes/liquid-glass-shots')
const base = `http://127.0.0.1:${port}/probe.html`
mkdirSync(outDir, { recursive: true })

const DATA_KEY = 'quadrant-web-data-v2'
const iso = (i) => new Date(Date.now() - i * 3600_000).toISOString()

/** 事件日期必须按「本周」动态算，写死某天会在别的运行日量到空画布 */
function mondayKey(offsetWeeks = 0) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const dow = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - dow + offsetWeeks * 7)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayKey(offset) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function seed() {
  const goals = [
    { title: '期末总目标', type: 'long' },
    { title: '考过六级', type: 'short' },
    { title: '读完十本书', type: 'long' }
  ].map(({ title, type }, i) => ({
    id: `g${i}`,
    title,
    type,
    done: false,
    remark: '备注文本，用来说明这个目标为什么要立',
    groupTitles: ['阶段一', '阶段二'],
    subtasks: [
      { id: `g${i}s0`, title: '子目标 1', done: false, group: 0, remark: '', order: 0 },
      { id: `g${i}s1`, title: '子目标 2', done: true, group: 1, remark: '', order: 1 }
    ],
    order: i,
    createdAt: iso(i)
  }))

  const events = Array.from({ length: 7 }, (_, i) => ({
    id: `q${i}`,
    text: `象限任务 ${i + 1}`,
    remark: '备注：这条任务的说明文字',
    quadrant: (i % 4) + 1,
    x: 40 + (i % 3) * 170,
    y: 40 + Math.floor(i / 3) * 110,
    width: 150,
    createdAt: iso(i)
  }))

  /*
   * 播种必须严格贴合 `AppData`（见 src/shared/types.ts）。字段名写错会被
   * `platformApi.validAppData` 整体拒绝 —— 症状是画布上一个块都没有，
   * 但页面看着正常，很容易误判成"页面坏了"。
   *   WeekEvent  需要 date / color / showInQuadrant（不是 day）
   *   WeekPreset 需要 remark
   */
  const weekEvents = [
    { id: 'w0', title: '高等数学', quadrant: 1, date: mondayKey(), startMin: 9 * 60, endMin: 10 * 60 + 30 },
    { id: 'w1', title: '精细化工实验', quadrant: 2, date: mondayKey(), startMin: 14 * 60, endMin: 17 * 60 },
    { id: 'w2', title: '英语听力', quadrant: 3, date: dayKey(0), startMin: 8 * 60, endMin: 9 * 60 },
    { id: 'w3', title: '组会', quadrant: 4, date: dayKey(0), startMin: 15 * 60, endMin: 16 * 60 }
  ].map((e, i) => ({
    ...e,
    color: ['#4da3ff', '#ffb84d', '#4ddb9a', '#e5484d'][i % 4],
    remark: '',
    showInQuadrant: false,
    createdAt: iso(i)
  }))

  const weekPresets = [
    { id: 'p0', title: '自习 2 小时', quadrant: 1, durationMin: 120, color: '#4da3ff', createdAt: iso(0) },
    { id: 'p1', title: '实验', quadrant: 2, durationMin: 180, color: '#ffb84d', createdAt: iso(1) },
    { id: 'p2', title: '运动', quadrant: 3, durationMin: 45, color: '#4ddb9a', createdAt: iso(2) }
  ].map((p) => ({ ...p, remark: '' }))

  return { version: 2, goals, events, weekPresets, weekEvents, weekCounterOffset: 0 }
}

const browser = await chromium.launch({ executablePath, headless: true })
const shots = []
const log = []
const errors = []

async function shoot(page, name) {
  const path = `${outDir}/${name}.png`
  await page.screenshot({ path })
  shots.push(name)
  console.log(`  · ${name}`)
}

async function newPage(viewport, mobile) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: mobile ? 2 : 1,
    colorScheme: 'dark',
    hasTouch: mobile,
    isMobile: mobile
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    [DATA_KEY, JSON.stringify(seed())]
  )
  return { context, page }
}

const VIEWPORTS = [
  { tag: 'mobile', viewport: { width: 390, height: 844 }, mobile: true },
  { tag: 'desktop', viewport: { width: 1440, height: 900 }, mobile: false }
]

for (const { tag, viewport, mobile } of VIEWPORTS) {
  console.log(`\n【${tag}】${viewport.width}×${viewport.height}`)
  const { context, page } = await newPage(viewport, mobile)

  for (const p of ['quadrant', 'weekly', 'goals', 'review']) {
    await page.goto(`${base}?page=${p}&sidebar=1&strict=0`, { waitUntil: 'load' })
    await page.waitForSelector('.sidebar', { timeout: 20000 })
    await page.waitForTimeout(800)
    await shoot(page, `${tag}-page-${p}`)
  }

  // 预设抽屉在**日视图**里（周视图不渲染该面板）：
  // 点今天那一列进入日视图，再点把手展开抽屉。
  await page.goto(`${base}?page=weekly&sidebar=1&strict=0`, { waitUntil: 'load' })
  await page.waitForSelector('.week-col-head', { timeout: 20000 })
  await page.waitForTimeout(500)
  const todayCol = page.locator('.week-col-head.today').first()
  if (await todayCol.count()) await todayCol.click()
  else await page.locator('.week-col-head').first().click()
  await page.waitForSelector('.day-scroll', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(700)
  await shoot(page, `${tag}-page-dayview`)
  const toggle = page.locator('.preset-toggle').first()
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click()
    await page.waitForTimeout(600)
    await shoot(page, `${tag}-preset-drawer-open`)
  } else {
    log.push(`${tag}: .preset-toggle 不可见，跳过抽屉展开`)
  }

  // 外观设置面板
  await page.click('.appearance-button')
  await page.waitForSelector('.glass-settings', { timeout: 10000 })
  await page.waitForTimeout(600)
  await shoot(page, `${tag}-settings`)
  await page.keyboard.press('Escape').catch(() => {})
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.glass-settings .modal-btn')].find((x) =>
      x.textContent.includes('完成')
    )
    b?.click()
  })
  await page.waitForTimeout(400)

  // 四象限：右键菜单 → 详细信息（事件详情弹窗）→ 遮罩关闭
  await page.goto(`${base}?page=quadrant&sidebar=1&strict=0`, { waitUntil: 'load' })
  /*
   * 必须用 state:'attached' 而不是默认的 'visible'：象限画布是世界坐标 + 缩放，
   * 播种的卡片经缩放后常常落在视口之外（实测 left: 7200px），元素在 DOM 里
   * 但不可见 —— 等 'visible' 会一直等到超时。下面派发 contextmenu 也带显式坐标，
   * 与卡片真实位置无关。
   */
  await page.waitForSelector('.event-card', { state: 'attached', timeout: 20000 })
  await page.waitForTimeout(600)
  await page.evaluate(() => {
    const card = document.querySelector('.event-card')
    const r = card.getBoundingClientRect()
    const x = Math.min(Math.max(r.left + 20, 40), window.innerWidth - 200)
    const y = Math.min(Math.max(r.top + 20, 40), window.innerHeight - 380)
    card.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: x,
        clientY: y
      })
    )
  })
  await page.waitForSelector('.gs-layer--menu', { timeout: 8000 })
  await page.waitForTimeout(400)
  await shoot(page, `${tag}-menu`)
  await page.locator('.gs-layer--menu .context-item', { hasText: '详细信息' }).first().click()
  await page.waitForTimeout(600)
  await shoot(page, `${tag}-dialog-event-detail`)
  await page.evaluate(() => {
    document.querySelector('.modal-mask')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await page.waitForTimeout(400)

  // 确认弹窗：菜单 → 删除
  await page.evaluate(() => {
    const card = document.querySelector('.event-card')
    const r = card.getBoundingClientRect()
    card.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: Math.min(Math.max(r.left + 20, 40), window.innerWidth - 200),
        clientY: Math.min(Math.max(r.top + 20, 40), window.innerHeight - 380)
      })
    )
  })
  await page.waitForSelector('.gs-layer--menu', { timeout: 8000 })
  await page.waitForTimeout(350)
  await page.locator('.gs-layer--menu .context-item', { hasText: '删除' }).first().click()
  await page.waitForTimeout(600)
  await shoot(page, `${tag}-dialog-confirm`)
  await page.evaluate(() => {
    document.querySelector('.modal-mask')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await page.waitForTimeout(400)

  // 目标页：详情弹窗 + 窄屏溢出菜单
  await page.goto(`${base}?page=goals&sidebar=1&strict=0`, { waitUntil: 'load' })
  await page.waitForSelector('.goal-more', { state: 'attached', timeout: 20000 })
  await page.waitForTimeout(700)
  if (await page.locator('.goal-more').first().isVisible().catch(() => false)) {
    await page.locator('.goal-more').first().click()
    await page.waitForSelector('.gs-layer--menu', { timeout: 8000 })
    await page.waitForTimeout(400)
    await shoot(page, `${tag}-goals-sheet`)
    await page.locator('.gs-layer--menu .context-item', { hasText: '详细信息' }).first().click()
    await page.waitForTimeout(600)
    await shoot(page, `${tag}-dialog-goal-detail`)
    await page.evaluate(() => {
      document.querySelector('.modal-mask')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForTimeout(400)
  } else {
    log.push(`${tag}: .goal-more 不可见，跳过目标溢出菜单`)
  }

  // 云登录弹窗（若入口可见）
  const loginBtn = page.locator('.login-button').first()
  if (await loginBtn.isVisible().catch(() => false)) {
    await loginBtn.click()
    await page.waitForTimeout(900)
    await shoot(page, `${tag}-dialog-login`)
  } else {
    log.push(`${tag}: .login-button 不可见，跳过登录弹窗`)
  }

  await context.close()
}

await browser.close()
console.log(`\n共 ${shots.length} 张截图 → ${outDir}/`)
if (log.length) log.forEach((l) => console.log(`  ! ${l}`))
if (errors.length) {
  console.log(`\n运行时报错 ${errors.length} 条：`)
  errors.slice(0, 10).forEach((e) => console.log(`  ⚠ ${e}`))
} else {
  console.log('无 pageerror / console error')
}
