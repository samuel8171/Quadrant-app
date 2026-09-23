#!/usr/bin/env node
/**
 * 移动端「可操作面积」探针（开发期工具）。
 *
 * 目的：量出各页面在真实手机视口下**真正可用于交互的像素**，而不是靠读 CSS 推断
 * （本项目已多次因纯读代码得出错误结论）。输出可对比的量化指标：
 *
 *   四象限页  画布有效像素、页头吃掉的高度
 *   周计划页  单屏可见天数、日视图时间轴可见小时数、预设面板占位
 *   目标页    单屏可见目标卡张数、被页头/内边距吃掉的像素
 *   复盘页    三条滑块与文本框各自的高度、页头吃掉的高度
 *
 * 前置（另开终端）：
 *   ./node_modules/.bin/vite --config vite.web.config.ts --port 5199 --host 127.0.0.1 --strictPort
 *
 * 用法：
 *   node scripts/mobile-density-probe.mjs
 *   node scripts/mobile-density-probe.mjs --presets 0,6,12 --out docs/probes/mobile-density.md
 *
 * 参数：
 *   --presets  逗号分隔的预设条数场景，默认 0,12
 *   --viewports 逗号分隔的 WxH，默认 375x667,390x844,430x932
 *   --port     开发服务器端口，默认 5199
 *   --out      额外写出 Markdown 报告
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { chromium } from 'playwright-core'

const ARG = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}

const BROWSER_CANDIDATES = [
  process.env.UI_PROBE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome'
].filter(Boolean)

const DATA_KEY = 'quadrant-web-data-v2'
const presetsScenarios = ARG('presets', '0,12').split(',').map(Number)
const viewports = ARG('viewports', '375x667,390x844,430x932').split(',').map((s) => {
  const [w, h] = s.split('x').map(Number)
  return { w, h }
})
const port = ARG('port', '5199')
const out = ARG('out', '')
const shotsDir = ARG('shots', '')

async function shot(page, name, vp) {
  if (!shotsDir) return
  if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true })
  await page.screenshot({ path: `${shotsDir}/${name}-${vp.w}x${vp.h}.png` })
}

const executablePath = BROWSER_CANDIDATES.find((p) => existsSync(p))
if (!executablePath) {
  console.error(`未找到可用浏览器，请设置 UI_PROBE_BROWSER。已尝试：\n${BROWSER_CANDIDATES.join('\n')}`)
  process.exit(2)
}

/* ---------------------------------------------------------------- 数据播种 */

function iso(dayOffset = 0) {
  const d = new Date(Date.UTC(2026, 8, 17, 2, 0, 0) + dayOffset * 86400000)
  return d.toISOString()
}

/**
 * 本周周一的日期键。
 *
 * 必须动态算：日视图默认打开「今天」那一列。种子数据曾写死在 9/14 那周，
 * 而运行日是 9/23（周四=9/24），于是画布上一个事件块都没有——
 * 「预设面板/时间轴比」这类指标看着正常，实际量的是空画布。
 */
function mondayKey() {
  const d = new Date()
  const dow = (d.getDay() + 6) % 7
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow)
  const p = (n) => String(n).padStart(2, '0')
  return `${monday.getFullYear()}-${p(monday.getMonth() + 1)}-${p(monday.getDate())}`
}

function seedData(presetCount) {
  const colors = ['#8AB4F8', '#8CD9C1', '#F8B18C', '#B4A7E6', '#E8A0A0', '#DBC8A8', '#A9C49C', '#C2C8D0']
  const presets = Array.from({ length: presetCount }, (_, i) => ({
    id: `p${i}`,
    title: `预设 ${i + 1} · ${['背单词', '跑步', '写代码', '实验报告', '预习', '社团', '复盘', '读文献'][i % 8]}`,
    color: colors[i % colors.length],
    quadrant: (i % 4) + 1,
    durationMin: [30, 45, 60, 90][i % 4],
    remark: '',
    createdAt: iso(i)
  }))

  const [my, mm, md] = mondayKey().split('-').map(Number)
  const monday = new Date(my, mm - 1, md, 12, 0, 0)
  const p2 = (n) => String(n).padStart(2, '0')
  const weekEvents = []
  for (let d = 0; d < 7; d++) {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + d, 12, 0, 0)
    const key = `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`
    for (let k = 0; k < 4; k++) {
      const startMin = 480 + k * 150
      weekEvents.push({
        id: `we${d}-${k}`,
        date: key,
        title: `日程 ${k + 1}`,
        color: colors[(d + k) % colors.length],
        quadrant: ((d + k) % 4) + 1,
        startMin,
        endMin: startMin + 90,
        remark: '',
        showInQuadrant: false,
        createdAt: iso(d)
      })
    }
  }

  const goals = [
    '期末总目标',
    '考过六级',
    '读完十本书',
    '学完线性代数',
    '拿下实习',
    '练出引体向上',
    '写完课程设计',
    '背完六级词汇'
  ].map((title, i) => ({
    id: `g${i}`,
    title,
    type: i % 2 === 0 ? 'long' : 'short',
    done: false,
    remark: '备注文本',
    groupTitles: ['阶段一', '阶段二'],
    subtasks: Array.from({ length: 6 }, (_, s) => ({
      id: `g${i}s${s}`,
      title: `子目标 ${s + 1}`,
      done: false,
      group: s % 2,
      remark: '',
      order: s
    })),
    order: i,
    createdAt: iso(i)
  }))

  const events = Array.from({ length: 10 }, (_, i) => ({
    id: `q${i}`,
    text: `象限任务 ${i + 1}`,
    remark: '',
    quadrant: (i % 4) + 1,
    x: 60 + (i % 4) * 120,
    y: 40 + Math.floor(i / 4) * 90,
    width: 110,
    createdAt: iso(i)
  }))

  return { version: 2, goals, events, weekPresets: presets, weekEvents, weekCounterOffset: 0 }
}

/* ---------------------------------------------------------------- 采集工具 */

/** 每个页面要量的元素（选择器 → 报告用短名）。 */
const TARGETS = {
  goals: {
    page: '.goals-page',
    header: '.page-header',
    columns: '.goal-columns',
    column: '.goal-column',
    list: '.goal-list',
    card: '.goal-card'
  },
  quadrant: {
    page: '.quadrant-page',
    header: '.page-header',
    hint: '.hint-pill',
    viewport: '.quadrant-viewport',
    canvas: '.quadrant-canvas'
  },
  week: {
    page: '.weekly-page',
    header: '.page-header',
    range: '.week-range',
    board: '.week-board',
    grid: '.week-grid',
    colHead: '.week-col-head',
    colBody: '.week-col-body'
  },
  day: {
    page: '.day-page',
    topbar: '.day-topbar',
    body: '.day-body',
    scroll: '.day-scroll',
    gutter: '.day-gutter',
    canvas: '.day-canvas',
    panel: '.preset-panel',
    panelList: '.preset-list',
    card: '.preset-card'
  },
  review: {
    page: '.review-page',
    header: '.review-header',
    sliders: '.review-sliders',
    sliderRow: '.review-slider-row',
    textarea: '.review-textarea',
    records: '.review-records'
  }
}

const DAY_HOUR_PX = 48
const WEEK_HEADER_H = 44

async function collect(page, selectors) {
  return page.evaluate((sels) => {
    const out = { __vp: { w: window.innerWidth, h: window.innerHeight } }
    for (const [key, sel] of Object.entries(sels)) {
      const el = document.querySelector(sel)
      if (!el) {
        out[key] = null
        continue
      }
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      out[key] = {
        w: Math.round(r.width),
        h: Math.round(r.height),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        clientH: el.clientHeight,
        scrollH: el.scrollHeight,
        clientW: el.clientWidth,
        scrollW: el.scrollWidth,
        padTop: parseFloat(cs.paddingTop) || 0,
        padBottom: parseFloat(cs.paddingBottom) || 0,
        count: el.children.length
      }
    }
    // 固定底部导航：它盖在内容之上，其顶边就是内容可用高度的下界。
    const nav = document.querySelector('.sidebar')
    out.__navTop = nav ? Math.round(nav.getBoundingClientRect().top) : window.innerHeight
    // 目标页：统计有多少张卡完整落在「导航顶边之上」。
    const cards = [...document.querySelectorAll('.goal-card')]
    out.__goalCardsVisible = cards.filter(
      (c) => c.getBoundingClientRect().bottom <= out.__navTop
    ).length
    out.__goalCardsTotal = cards.length
    return out
  }, selectors)
}

/** 载入某一页并等待稳定。 */
async function gotoPage(page, base, pageName, data) {
  await page.addInitScript(
    ([key, payload]) => window.localStorage.setItem(key, payload),
    [DATA_KEY, JSON.stringify(data)]
  )
  await page.goto(`${base}?page=${pageName}&strict=0&sidebar=1`, { waitUntil: 'load' })
  await page.waitForSelector('.sidebar', { timeout: 20000 })
  await page.waitForTimeout(450)
}

const rows = []
const fmt = (n) => (n === null || n === undefined ? '—' : String(Math.round(n)))

function record(vp, scenario, section, name, value, unit = 'px') {
  rows.push({ vp, scenario, section, name, value: Math.round(value), unit })
}

/** 文本型指标（保持原样，不参与取整，例如「345×46」）。 */
function text(vp, scenario, section, name, value) {
  rows.push({ vp, scenario, section, name, value: String(value), unit: 'text' })
}

const browser = await chromium.launch({ executablePath, headless: true })

for (const vp of viewports) {
  const label = `${vp.w}x${vp.h}`
  const base = `http://127.0.0.1:${port}/probe.html`
  const context = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true
  })
  const page = await context.newPage()
  const noise = []
  page.on('pageerror', (e) => noise.push(`pageerror: ${e.message}`))

  /* ---------- 四象限 ---------- */
  await gotoPage(page, base, 'quadrant', seedData(0))
  {
    await shot(page, 'quadrant', vp)
    const m = await collect(page, TARGETS.quadrant)
    const usableH = m.__navTop - m.page.top - m.page.padTop
    const px = m.viewport.clientW * Math.min(m.viewport.h, usableH)
    record(label, '-', '四象限', '视口宽', m.viewport.w)
    record(label, '-', '四象限', '页头高', m.header.h)
    record(label, '-', '四象限', '提示条高', m.hint ? m.hint.h : 0)
    record(label, '-', '四象限', '画布可视宽', m.viewport.clientW)
    record(label, '-', '四象限', '画布可视高', m.viewport.h)
    record(label, '-', '四象限', '画布有效像素', px, 'px²')
    record(label, '-', '四象限', '内容区占用比', Math.round((px / (m.viewport.w * m.__navTop)) * 100), '%')
  }

  /* ---------- 周计划 · 周视图 ---------- */
  await gotoPage(page, base, 'weekly', seedData(0))
  {
    await shot(page, 'week-overview', vp)
    const m = await collect(page, TARGETS.week)
    const hourPx = Math.min(64, Math.max(28, (m.board.clientH - WEEK_HEADER_H) / 17))
    const visibleDays = m.grid.clientW / m.colHead.w
    record(label, '-', '周计划·周视图', '页头+日期条', m.header.h + m.range.h)
    record(label, '-', '周计划·周视图', '网格可视宽', m.grid.clientW)
    record(label, '-', '周计划·周视图', '单列宽', m.colHead.w)
    record(label, '-', '周计划·周视图', '单屏可见天数', visibleDays, '天')
    record(label, '-', '周计划·周视图', '小时像素', hourPx)
  }

  /* ---------- 周计划 · 日视图（预设条数场景） ---------- */
  for (const scenario of presetsScenarios) {
    const tag = `${scenario} 条预设`
    await gotoPage(page, base, 'weekly', seedData(scenario))
    // 进入日视图：点今天那一列的表头
    await page.locator('.week-col-head').nth(3).click()
    await page.waitForSelector('.day-canvas', { timeout: 10000 })
    await page.waitForTimeout(650)

    // 抽屉是浮层，它会盖住时间轴底部一段——被盖住的部分既看不见也点不到，
    // 所以「可操作高度」要按未被遮挡的那一段算，不能直接拿容器高度充数。
    // 注意必须同时要求**横向**重叠：桌面端预设面板是并排的侧栏，纵向区间天然完全重叠，
    // 只按纵向算会得出"时间轴被遮了 803px"这种荒唐结论。
    const occl = async () =>
      page.evaluate(() => {
        const scroll = document.querySelector('.day-scroll').getBoundingClientRect()
        const panelRect = document.querySelector('.preset-panel').getBoundingClientRect()
        const overlapX = Math.min(scroll.right, panelRect.right) - Math.max(scroll.left, panelRect.left)
        const overlapY = Math.min(scroll.bottom, panelRect.bottom) - Math.max(scroll.top, panelRect.top)
        const covered = overlapX > 0 && overlapY > 0 ? Math.round(overlapY) : 0
        return { covered, clear: Math.round(scroll.height - covered) }
      })

    const expanded = await collect(page, TARGETS.day)
    const occlExpanded = await occl()
    record(label, tag, '周计划·日视图', '顶部工具条高', expanded.topbar.h)
    record(label, tag, '周计划·日视图', '时间轴可视高', expanded.scroll.clientH)
    record(label, tag, '周计划·日视图', '可见小时数', expanded.scroll.clientH / DAY_HOUR_PX, '小时')
    record(label, tag, '周计划·日视图', '时间轴可视宽', expanded.canvas.clientW)
    record(label, tag, '周计划·日视图', '预设面板高', expanded.panel.h)
    record(label, tag, '周计划·日视图', '预设列表可视高', expanded.panelList ? expanded.panelList.clientH : 0)
    record(label, tag, '周计划·日视图', '预设面板/时间轴比', ((expanded.panel.h / expanded.scroll.clientH) * 100), '%')
    record(label, tag, '周计划·日视图', '抽屉遮挡时间轴', occlExpanded.covered)
    record(label, tag, '周计划·日视图', '时间轴未被遮挡高', occlExpanded.clear)
    record(label, tag, '周计划·日视图', '未被遮挡时可点小时数', occlExpanded.clear / DAY_HOUR_PX, '小时')

    /*
     * 折叠按钮的往返验证。这里必须点两次：面板默认收起，只点一次是"展开"，
     * 只能证明展开有效，证明不了 P0 那个 `hidden` 被覆盖的缺陷真的修好了
     * （旧代码里点一次类名和属性都变、面板却纹丝不动）。
     */
    const panelState = () =>
      page.evaluate(() => {
        const panel = document.querySelector('.preset-panel')
        const list = document.querySelector('.preset-list')
        return {
          collapsed: panel ? panel.className.includes('collapsed') : null,
          hasHidden: list ? list.hasAttribute('hidden') : null,
          display: list ? getComputedStyle(list).display : '',
          /* 真值判据：收起是否生效看列表**实际高度**，不看 display。
             现在的收起是 grid 轨道归零 + 延迟 visibility，display 仍是 flex。 */
          listHeight: list ? Math.round(list.getBoundingClientRect().height) : -1,
          visibility: list ? getComputedStyle(list).visibility : ''
        }
      })

    /* 桌面端不存在收起态（列表恒显），折叠判据只在窄屏成立。 */
    const narrow = vp.w <= 767

    const initial = await panelState()
    if (narrow) {
      record(label, tag, '预设抽屉·折叠', '默认态是否收起', initial.collapsed ? 1 : 0, '（1=收起）')
      record(label, tag, '预设抽屉·折叠', '默认态列表高', initial.listHeight)
    } else {
      record(label, tag, '预设抽屉·折叠', '桌面端默认列表高', initial.listHeight)
    }
    await shot(page, `day-drawer-collapsed-${scenario}p`, vp)

    await page.locator('.preset-toggle').click()
    await page.waitForTimeout(420)
    const opened = await panelState()
    record(
      label,
      tag,
      narrow ? '预设抽屉·折叠' : '预设抽屉·桌面端',
      narrow ? '第 1 次点击后已展开' : '点击标题后列表是否保持',
      !opened.collapsed && opened.listHeight > 0 ? 1 : 0,
      narrow ? '（1=展开且列表有高）' : '（1=保持展开）'
    )
    await shot(page, `day-drawer-expanded-${scenario}p`, vp)
    const expandMetrics = await collect(page, TARGETS.day)
    const occlOpen = await occl()
    record(label, tag, '周计划·日视图(展开态)', '预设面板高', expandMetrics.panel.h)
    record(label, tag, '周计划·日视图(展开态)', '时间轴未被遮挡高', occlOpen.clear)
    record(label, tag, '周计划·日视图(展开态)', '未被遮挡时可点小时数', occlOpen.clear / DAY_HOUR_PX, '小时')

    await page.locator('.preset-toggle').click()
    await page.waitForTimeout(420)
    const closed = await panelState()
    if (narrow) {
      record(
        label,
        tag,
        '预设抽屉·折叠',
        '第 2 次点击后已收起',
        closed.collapsed && closed.listHeight === 0 ? 1 : 0,
        '（1=收起且列表高 0）'
      )
      record(label, tag, '预设抽屉·折叠', '收起后列表 visibility', closed.visibility === 'hidden' ? 1 : 0, '（1=hidden）')
    }
    /* 桌面端没有收起态，这三条只对窄屏有意义。 */
    if (narrow) {
      const collapseMetrics = await collect(page, TARGETS.day)
      const occlClosed = await occl()
      record(label, tag, '周计划·日视图(收起态)', '预设面板高', collapseMetrics.panel.h)
      record(label, tag, '周计划·日视图(收起态)', '时间轴未被遮挡高', occlClosed.clear)
      record(label, tag, '周计划·日视图(收起态)', '未被遮挡时可点小时数', occlClosed.clear / DAY_HOUR_PX, '小时')
    }
  }

  /* ---------- 目标 ---------- */
  await gotoPage(page, base, 'goals', seedData(0))
  {
    await shot(page, 'goals', vp)
    const m = await collect(page, TARGETS.goals)
    record(label, '-', '目标', '页头高', m.header.h)
    record(label, '-', '目标', '单列宽', m.column.w)
    record(label, '-', '目标', '单卡高', m.card ? m.card.h : 0)
    record(label, '-', '目标', '单屏可见卡数', m.__goalCardsVisible, '张')
    record(label, '-', '目标', '总卡数', m.__goalCardsTotal, '张')

    // 卡片内部为什么会变高：量出每张卡里各子元素的占宽，验证「是否被挤到换行」。
    const inner = await page.evaluate(() => {
      const card = document.querySelector('.goal-card')
      if (!card) return null
      const kids = [...card.children]
        .map((el) => {
          const r = el.getBoundingClientRect()
          return { cls: el.className, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }
        })
        .filter((k) => k.w > 0 || k.h > 0)
      const title = kids.find((k) => k.cls.includes('goal-title'))
      const rows = new Set(kids.map((k) => k.top)).size
      return {
        cardW: Math.round(card.getBoundingClientRect().width),
        kids,
        rows,
        titleW: title ? title.w : 0,
        titleH: title ? title.h : 0
      }
    })
    if (inner) {
      if (process.argv.includes('--dump-goal-card')) {
        console.log(`[${label}] 目标卡子元素明细：\n${JSON.stringify(inner, null, 1)}`)
      }
      record(label, '-', '目标卡内部', '卡片宽', inner.cardW)
      record(label, '-', '目标卡内部', '子元素行数', inner.rows, '行')
      record(label, '-', '目标卡内部', '标题实际宽', inner.titleW)
      record(label, '-', '目标卡内部', '标题实际高', inner.titleH)
      const iconRow = inner.kids.find((k) => k.cls.includes('icon-btn'))
      if (iconRow) {
        record(label, '-', '目标卡内部', '首个图标按钮宽', iconRow.w)
        record(label, '-', '目标卡内部', '图标按钮区行号', iconRow.top - inner.kids[0].top, 'px偏移')
      }
      record(label, '-', '目标卡内部', '子元素占宽合计', inner.kids.reduce((s, k) => s + k.w, 0))
    }

    // 反事实：把「三个图标平铺在卡片上」的旧布局临时注回去，同一次运行内直接对表，
    // 免得为了一个对比数字去回滚代码（回滚过一次 .git，代价太大）。
    const legacy = await page.evaluate(() => {
      const style = document.createElement('style')
      style.textContent =
        '.goal-actions{display:flex!important}.goal-more{display:none!important}'
      document.head.appendChild(style)
      const card = document.querySelector('.goal-card')
      const title = document.querySelector('.goal-card .goal-title')
      const cardRect = card.getBoundingClientRect()
      const titleRect = title.getBoundingClientRect()
      const navTop = document.querySelector('.sidebar').getBoundingClientRect().top
      const visible = [...document.querySelectorAll('.goal-card')].filter(
        (c) => c.getBoundingClientRect().bottom <= navTop
      ).length
      return {
        cardH: Math.round(cardRect.height),
        titleW: Math.round(titleRect.width),
        titleH: Math.round(titleRect.height),
        visible
      }
    })
    record(label, '-', '目标卡(旧布局反事实)', '单卡高', legacy.cardH)
    record(label, '-', '目标卡(旧布局反事实)', '标题实际宽', legacy.titleW)
    record(label, '-', '目标卡(旧布局反事实)', '标题实际高', legacy.titleH)
    record(label, '-', '目标卡(旧布局反事实)', '单屏可见卡数', legacy.visible, '张')
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('.goal-card', { timeout: 10000 })
    await page.waitForTimeout(300)

    // 窄屏的三项操作是否可通过「…」到达（宽屏不渲染 "…"，此步自然为 0）。
    const moreBtn = page.locator('.goal-more').first()
    const moreDisplay = await page.evaluate(() => {
      const el = document.querySelector('.goal-more')
      return el ? getComputedStyle(el).display : 'absent'
    })
    text(label, '-', '目标卡菜单', '「…」按钮 display', moreDisplay)
    if ((await moreBtn.count()) > 0 && (await moreBtn.isVisible())) {
      await moreBtn.click()
      await page.waitForTimeout(320)
      const menu = await page.evaluate(() => {
        const el = document.querySelector('.context-menu')
        return el ? { items: el.querySelectorAll('.context-item').length } : { items: 0 }
      })
      record(label, '-', '目标卡菜单', '「…」点开的菜单项数', menu.items, '项')
      await page.keyboard.press('Escape')
      await page.mouse.click(5, 5)
      await page.waitForTimeout(240)
    } else {
      record(label, '-', '目标卡菜单', '「…」点开的菜单项数', 0, '项')
    }
  }

  /* ---------- 复盘 ---------- */
  await gotoPage(page, base, 'review', seedData(0))
  {
    const m = await collect(page, TARGETS.review)
    record(label, '-', '复盘', '页头高', m.header.h)
    record(label, '-', '复盘', '滑块区高', m.sliders.h)
    record(label, '-', '复盘', '单行滑块高', m.sliderRow.h)
    record(label, '-', '复盘', '文本框高', m.textarea ? m.textarea.h : 0)
  }

  /* ---------- 底部导航 ---------- */
  {
    const nav = await page.evaluate(() => {
      const el = document.querySelector('.sidebar')
      const items = [...document.querySelectorAll('.nav-item')]
      const r = el.getBoundingClientRect()
      return {
        h: Math.round(r.height),
        top: Math.round(r.top),
        itemW: items.length ? Math.round(items[0].getBoundingClientRect().width) : 0,
        itemH: items.length ? Math.round(items[0].getBoundingClientRect().height) : 0
      }
    })
    record(label, '-', '底部导航', '导航条高', nav.h)
    record(label, '-', '底部导航', '导航顶边距底', nav.top)
    text(label, '-', '底部导航', '单个入口尺寸', `${nav.itemW}×${nav.itemH}`)
  }

  if (noise.length) console.log(`[${label}] 页面错误：\n${noise.join('\n')}`)
  await context.close()
}

await browser.close()

/* ---------------------------------------------------------------- 报告 */

const sections = [...new Set(rows.map((r) => r.section))]
const byViewport = {}
for (const r of rows) {
  byViewport[r.vp] ??= {}
  byViewport[r.vp][`${r.section} / ${r.name}`] ??= {}
  byViewport[r.vp][`${r.section} / ${r.name}`][r.scenario] = r
}

const lines = []
lines.push('# 移动端可操作面积实测（真实浏览器）', '')
lines.push(`生成时间：${new Date().toLocaleString('zh-CN')}`)
lines.push('')
lines.push('| 指标 | ' + viewports.map((v) => `${v.w}×${v.h}`).join(' | ') + ' |')
lines.push('| --- | ' + viewports.map(() => '---').join(' | ') + ' |')

const allMetrics = [...new Set(rows.map((r) => `${r.section} / ${r.name}`))]
const suffix = (unit) => (unit === 'px' || unit === 'text' ? '' : unit)

for (const metric of allMetrics) {
  const cells = viewports.map((v) => {
    const m = byViewport[`${v.w}x${v.h}`]?.[metric]
    if (!m) return '—'
    return Object.entries(m)
      .map(([sc, r]) =>
        sc === '-' ? `${r.value}${suffix(r.unit)}` : `${r.value}${suffix(r.unit)}（${sc}）`
      )
      .join(' / ')
  })
  lines.push(`| ${metric} | ${cells.join(' | ')} |`)
}
lines.push('')

const report = lines.join('\n')
console.log(report)

if (out) {
  const dir = dirname(out)
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(out, report, 'utf8')
  console.log(`\n报告已写入：${out}`)
}
