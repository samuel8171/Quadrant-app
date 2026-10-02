#!/usr/bin/env node
/**
 * R3-A 人工验收探针（开发期工具，一次性）。
 *
 * 验证「外观」入口从侧栏迁到「我的」设置组之后：
 *   1. 导航恰好 5 个页面项、没有 appearance-button、两个档位一致；
 *   2. 指示块仍能对准第 5 格（我的）；标签不折行；
 *   3. 手机档 --mobile-nav-height 仍 66px、dock 不折行；
 *   4. 设置组两行；外观对话框两个档位都能打开 / 关闭；
 *   5. 窄屏（390×844）下对话框可用：能滚动、每个控件都能到达并能操作、能关闭。
 *
 * 前置（另开终端）：
 *   ./node_modules/.bin/vite --config vite.web.config.ts --port 5199 --host 127.0.0.1 --strictPort
 *
 * 用法：node scripts/r3a-probe.mjs
 *
 * 数据隔离：本探针跑在**网页构建**上，数据只写进当前浏览器 context 的 localStorage，
 * 从不触及 Electron 的 userData（%APPDATA%）。每次 newContext 都是全新、空的存储。
 */
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'

const BROWSER_CANDIDATES = [
  process.env.UI_PROBE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].filter(Boolean)

const executablePath = BROWSER_CANDIDATES.find((p) => existsSync(p))
if (!executablePath) {
  console.error('未找到可用浏览器，请设置 UI_PROBE_BROWSER')
  process.exit(2)
}

const DATA_KEY = 'quadrant-web-data-v2'
const base = 'http://127.0.0.1:5199/probe.html'
const EMPTY_DATA = { version: 2, goals: [], events: [], weekPresets: [], weekEvents: [], weekCounterOffset: 0 }

const out = []
const say = (s) => {
  out.push(s)
  console.log(s)
}

async function open(page, url) {
  await page.addInitScript(
    ([key, payload]) => window.localStorage.setItem(key, payload),
    [DATA_KEY, JSON.stringify(EMPTY_DATA)]
  )
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForSelector('.mine-page', { timeout: 20000 })
  await page.waitForTimeout(500)
}

/** 导航几何 + 设置组结构。 */
const measure = () =>
  JSON.stringify(
    (() => {
      const navItems = [...document.querySelectorAll('.nav .nav-item')]
      const indicator = document.querySelector('.nav-indicator')
      const nav = document.querySelector('.nav')
      const sidebar = document.querySelector('.sidebar')
      const lineCount = (el) => {
        if (!el) return 0
        const r = document.createRange()
        r.selectNodeContents(el)
        return r.getClientRects().length
      }
      const groups = [...document.querySelectorAll('.mine-group')]
      const titleOf = (g) => g.querySelector('.mine-group-title')?.textContent.trim()
      const settingGroup = groups.find((g) => titleOf(g) === '设置')
      const rows = settingGroup ? [...settingGroup.querySelectorAll('.mine-row')] : []
      const fifth = navItems[4]
      const irect = indicator?.getBoundingClientRect()
      const frect = fifth?.getBoundingClientRect()
      return {
        navItemCount: navItems.length,
        appearanceButtonCount: document.querySelectorAll('.appearance-button').length,
        navLabels: navItems.map((b) => b.textContent.trim()),
        navLabelLines: navItems.map((b) => lineCount(b.querySelector('span'))),
        navDistinctTops: new Set(navItems.map((b) => Math.round(b.getBoundingClientRect().top))).size,
        mobileNavHeight: getComputedStyle(document.documentElement).getPropertyValue('--mobile-nav-height').trim(),
        sidebarHeight: Math.round(sidebar.getBoundingClientRect().height),
        navScrollH: nav.scrollHeight,
        navClientH: nav.clientHeight,
        navScrollW: nav.scrollWidth,
        navClientW: nav.clientWidth,
        indicator: irect
          ? { left: Math.round(irect.left), top: Math.round(irect.top), w: Math.round(irect.width), h: Math.round(irect.height) }
          : null,
        fifth: frect
          ? { left: Math.round(frect.left), top: Math.round(frect.top), w: Math.round(frect.width), h: Math.round(frect.height) }
          : null,
        moneyGroupPresent: groups.some((g) => titleOf(g) === '金钱'),
        settingRowCount: rows.length,
        settingRowTexts: rows.map((r) => r.textContent.trim()),
        settingsHasDesktopOnly: !!settingGroup?.querySelector('.desktop-only')
      }
    })()
  )

/** 对话框结构 + 滚动能力。 */
const dialogMetrics = () =>
  JSON.stringify(
    (() => {
      const panel = document.querySelector('.glass-settings')
      const body = document.querySelector('.gs-dialog-body')
      const controls = [
        ...document.querySelectorAll(
          '.glass-settings .glass-mode, .glass-settings input[type=range], .glass-settings .modal-btn'
        )
      ]
      return {
        panelFound: !!panel,
        panelRect: panel
          ? {
              top: Math.round(panel.getBoundingClientRect().top),
              bottom: Math.round(panel.getBoundingClientRect().bottom),
              h: Math.round(panel.getBoundingClientRect().height)
            }
          : null,
        viewportH: window.innerHeight,
        bodyClientH: body?.clientHeight ?? null,
        bodyScrollH: body?.scrollHeight ?? null,
        scrollable: body ? body.scrollHeight > body.clientHeight + 1 : null,
        controlCount: controls.length,
        controls: controls.map((c) => ({
          tag: c.tagName.toLowerCase(),
          type: c.getAttribute('type') ?? c.getAttribute('role') ?? '',
          label: (c.textContent || c.getAttribute('aria-label') || '').trim().slice(0, 24),
          disabled: c.disabled === true,
          w: Math.round(c.getBoundingClientRect().width),
          h: Math.round(c.getBoundingClientRect().height)
        }))
      }
    })()
  )

const browser = await chromium.launch({ executablePath, headless: true })
const tiers = [
  { name: 'desktop', vp: { width: 1440, height: 900 }, mobile: false },
  { name: 'mobile', vp: { width: 390, height: 844 }, mobile: true }
]

for (const tier of tiers) {
  const context = await browser.newContext({
    viewport: tier.vp,
    deviceScaleFactor: tier.mobile ? 3 : 1,
    hasTouch: tier.mobile,
    isMobile: tier.mobile
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })

  await open(page, `${base}?page=mine&strict=0&sidebar=1`)

  /* ---- 1. 导航几何 + 设置组 ---- */
  const nav = JSON.parse(await page.evaluate(measure))
  say(`\n===== ${tier.name} ${tier.vp.width}×${tier.vp.height} =====`)
  say(`[导航] 页面项数=${nav.navItemCount} appearance-button=${nav.appearanceButtonCount} 标签=${JSON.stringify(nav.navLabels)}`)
  say(`[导航] 标签行数=${JSON.stringify(nav.navLabelLines)} 不同顶边数(行数)=${nav.navDistinctTops}`)
  say(`[导航] --mobile-nav-height=${nav.mobileNavHeight} sidebar高=${nav.sidebarHeight} nav溢出(横)=${nav.navScrollW - nav.navClientW} (纵)=${nav.navScrollH - nav.navClientH}`)
  say(`[导航] 指示块=${JSON.stringify(nav.indicator)} 第5项=${JSON.stringify(nav.fifth)}`)
  const indCenterX = nav.indicator && nav.fifth ? (nav.indicator.left + nav.indicator.w / 2) : null
  const fifthCenterX = nav.fifth ? nav.fifth.left + nav.fifth.w / 2 : null
  const indCenterY = nav.indicator && nav.fifth ? (nav.indicator.top + nav.indicator.h / 2) : null
  const fifthCenterY = nav.fifth ? nav.fifth.top + nav.fifth.h / 2 : null
  if (tier.mobile) {
    say(`[指示块] 水平中心 差=${indCenterX !== null ? Math.round(indCenterX - fifthCenterX) : '—'}px`)
  } else {
    say(`[指示块] 垂直中心 差=${indCenterY !== null ? Math.round(indCenterY - fifthCenterY) : '—'}px`)
  }
  say(`[设置组] 金钱组存在=${nav.moneyGroupPresent}（应为 false，关闭态不渲染）`)
  say(`[设置组] 行数=${nav.settingRowCount} 文本=${JSON.stringify(nav.settingRowTexts)} 含 desktop-only=${nav.settingsHasDesktopOnly}`)

  /* ---- 2. 打开对话框 ---- */
  await page.locator('.mine-row-action').click()
  await page.waitForSelector('.glass-settings', { timeout: 8000 })
  await page.waitForTimeout(350)
  const dlg = JSON.parse(await page.evaluate(dialogMetrics))
  say(`[对话框] 打开成功=${dlg.panelFound} 面板高=${dlg.panelRect?.h} 顶=${dlg.panelRect?.top} 底=${dlg.panelRect?.bottom} 视口高=${dlg.viewportH}`)
  say(`[对话框] 内容可滚动=${dlg.scrollable} (clientH=${dlg.bodyClientH} scrollH=${dlg.bodyScrollH}) 控件数=${dlg.controlCount}`)
  say(`[对话框] 控件=${JSON.stringify(dlg.controls)}`)

  /* ---- 3. 每个控件能否到达并能操作 ---- */
  const controlLocator = page.locator(
    '.glass-settings .glass-mode, .glass-settings input[type=range], .glass-settings .modal-btn'
  )
  const n = await controlLocator.count()
  const reach = []
  for (let i = 0; i < n; i++) {
    const el = controlLocator.nth(i)
    const label = ((await el.textContent()) || (await el.getAttribute('type')) || '').trim().slice(0, 20)
    const disabled = await el.isDisabled().catch(() => false)
    await el.scrollIntoViewIfNeeded().catch(() => {})
    await page.waitForTimeout(60)
    const info = await el.evaluate((node) => {
      const r = node.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const hit = document.elementFromPoint(cx, cy)
      return {
        inViewport: r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0 && r.height > 0,
        hitSelf: !!hit && (hit === node || node.contains(hit) || hit.contains(node))
      }
    })
    reach.push({ i, label, disabled, ...info })
  }
  say(`[到达性] ${JSON.stringify(reach)}`)

  // 实际操作：滑块用方向键、模式按钮点击、完成按钮关闭
  const ops = {}
  const firstRange = page.locator('.glass-settings input[type=range]').first()
  if ((await firstRange.count()) > 0 && !(await firstRange.isDisabled())) {
    await firstRange.scrollIntoViewIfNeeded()
    const before = await firstRange.inputValue()
    await firstRange.focus()
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(80)
    const after = await firstRange.inputValue()
    ops.slider = { before, after, changed: before !== after }
  }
  const firstMode = page.locator('.glass-settings [role=radio]').first()
  if ((await firstMode.count()) > 0 && !(await firstMode.isDisabled())) {
    await firstMode.scrollIntoViewIfNeeded()
    const before = await firstMode.getAttribute('aria-checked')
    await firstMode.click()
    await page.waitForTimeout(80)
    const after = await firstMode.getAttribute('aria-checked')
    ops.modeRadio = { before, after, operable: true }
  }
  const engineBtn = page.locator('.glass-settings .modal-field', { hasText: '渲染引擎' }).locator('.glass-mode').nth(1)
  if ((await engineBtn.count()) > 0) {
    await engineBtn.click()
    await page.waitForTimeout(120)
    ops.engine = { clicked: true, active: await engineBtn.evaluate((b) => b.className.includes('active')) }
  }
  const resetBtn = page.locator('.glass-settings .modal-btn', { hasText: '恢复默认' })
  if ((await resetBtn.count()) > 0) {
    await resetBtn.click()
    await page.waitForTimeout(150)
    ops.reset = { clicked: true, stillOpen: (await page.locator('.glass-settings').count()) > 0 }
  }
  say(`[操作] ${JSON.stringify(ops)}`)

  /* ---- 4. 关闭 ---- */
  const doneBtn = page.locator('.glass-settings .modal-btn', { hasText: '完成' })
  await doneBtn.scrollIntoViewIfNeeded()
  await doneBtn.click()
  await page.waitForTimeout(500)
  const closed = (await page.locator('.glass-settings').count()) === 0
  say(`[关闭] 点「完成」后对话框已移除=${closed}`)

  say(`[错误] ${errors.length === 0 ? '无' : JSON.stringify(errors)}`)
  await context.close()
}

await browser.close()
