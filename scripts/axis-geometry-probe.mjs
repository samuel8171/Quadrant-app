#!/usr/bin/env node
/**
 * 日视图「轴系几何」探针（开发期工具）。
 *
 * 目的：把时间轴的两个视觉缺陷从「看起来不对」变成可复现的像素数字——
 *   1. 左侧小时标尺的背景条没有覆盖到 24:00（桌面端与手机端都短一截，且短得不一样）；
 *   2. 事件块的底边比它声明的时间区间短一点（块体没有真正贴到下一小时线）。
 *
 * 做法：进入日视图后，把每个相关元素的 `getBoundingClientRect()` 统一换算到
 * `.day-scroll` 的**内容坐标系**，再用 `内容坐标 → 分钟` 的逆映射把像素翻译成时刻。
 * 这样「背景条覆盖到几点」「事件块底部差几分钟」都是可以直接读的数字，不依赖目测。
 *
 * 前置（另开终端）：
 *   ./node_modules/.bin/vite --config vite.web.config.ts --port 5199 --host 127.0.0.1 --strictPort
 *
 * 用法：
 *   node scripts/axis-geometry-probe.mjs
 *   node scripts/axis-geometry-probe.mjs --viewports 1440x900,390x844 --out docs/probes/axis-geometry.md
 *   node scripts/axis-geometry-probe.mjs --shots docs/probes/axis-shots
 *
 * 参数：
 *   --viewports  逗号分隔的 WxH，默认 1440x900,1440x1200,390x844
 *   --port       开发服务器端口，默认 5199
 *   --out        写出 Markdown 报告
 *   --shots      每视口存一张时间轴截图（滚到 20:00 之后，让 24:00 的收尾进入画面）
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
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

const executablePath = BROWSER_CANDIDATES.find((p) => existsSync(p))
if (!executablePath) {
  console.error(`未找到可用浏览器，请设置 UI_PROBE_BROWSER。已尝试：\n${BROWSER_CANDIDATES.join('\n')}`)
  process.exit(2)
}

const DATA_KEY = 'quadrant-web-data-v2'
const viewports = ARG('viewports', '1440x900,1440x1200,390x844').split(',').map((s) => {
  const [w, h] = s.split('x').map(Number)
  return { w, h }
})
const port = ARG('port', '5199')
const out = ARG('out', '')
const shotsDir = ARG('shots', '')

/* ------------------------------------------------------------ 与源码一致的常量 */
const DAY_START_MIN = 420
const DAY_END_MIN = 1440
const DAY_HOUR_PX = 48
const DAY_PAD_PX = 10
/** 内容坐标 y → 当天分钟。 */
const yToMin = (y) => DAY_START_MIN + ((y - DAY_PAD_PX) / DAY_HOUR_PX) * 60
/** 当天分钟 → 内容坐标 y。 */
const minToY = (m) => DAY_PAD_PX + ((m - DAY_START_MIN) / 60) * DAY_HOUR_PX
const fmtMin = (m) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`

/* ------------------------------------------------------------------ 数据播种 */
const DAY_KEY = '2026-09-17'
const COLORS = ['#8AB4F8', '#8CD9C1', '#F8B18C', '#B4A7E6', '#E8A0A0']

/** 刻意覆盖三种边界：当天第一小时、中间、以及紧贴 24:00 的那一小时。 */
const SPANS = [
  [420, 480], // 7:00-8:00  贴 DAY_START
  [900, 960], // 15:00-16:00 整点对齐（用户截图里的「练琴」）
  [930, 975], // 15:30-16:15 非整点，验证偏差是否随时长缩放
  [1380, 1440] // 23:00-24:00 贴 DAY_END
]

function iso(dayOffset = 0) {
  return new Date(Date.UTC(2026, 8, 17, 2, 0, 0) + dayOffset * 86400000).toISOString()
}

function seedData() {
  const weekEvents = SPANS.map(([startMin, endMin], i) => ({
    id: `we${i}`,
    date: DAY_KEY,
    title: `日程 ${i + 1}`,
    color: COLORS[i % COLORS.length],
    quadrant: (i % 4) + 1,
    startMin,
    endMin,
    remark: '',
    showInQuadrant: false,
    createdAt: iso(i)
  }))

  return {
    version: 2,
    goals: [],
    events: [],
    weekPresets: [
      {
        id: 'p0',
        title: '背单词',
        color: COLORS[0],
        quadrant: 1,
        durationMin: 30,
        remark: '',
        createdAt: iso(0)
      }
    ],
    weekEvents,
    /*
     * 这个字段不能省：platformApi 的归一化要求 `Number.isFinite(weekCounterOffset)`，
     * 少一个字段会让**整份**数据回退成默认值，症状是"localStorage 里有数据、
     * DOM 里一个事件都没有"，排查起来非常费时。
     */
    weekCounterOffset: 0
  }
}

/* ---------------------------------------------------------------- 量测与换算 */
/**
 * 在页面里把关键元素的矩形换算到 `.day-scroll` 的内容坐标系。
 * 内容坐标基准取 `.day-scroll` 的 padding box 顶边（rect.top + clientTop），
 * 再加 scrollTop —— 这样即使容器已滚动，得到的仍是「文档流里的绝对位置」。
 */
async function measure(page) {
  return page.evaluate(
    ({ DAY_PAD_PX }) => {
      const scroll = document.querySelector('.day-scroll')
      const scrollRect = scroll.getBoundingClientRect()
      const originY = scrollRect.top + scroll.clientTop - scroll.scrollTop
      const originX = scrollRect.left + scroll.clientLeft

      /** 视口坐标 → 内容坐标 */
      const y = (el) => el.getBoundingClientRect().top - originY
      const h = (el) => el.getBoundingClientRect().height
      const rect = (el) => {
        const r = el.getBoundingClientRect()
        return { top: Math.round(r.top - originY), bottom: Math.round(r.bottom - originY), h: Math.round(r.height) }
      }

      const pick = (sel) => {
        const el = document.querySelector(sel)
        return el ? rect(el) : null
      }

      /*
       * 量的是**文字行盒**而不是 label 的盒子：label 高 48px 且 align-items:flex-start，
       * 文字只占顶部十几像素，用 label 盒的中心当"数字中心"会得出 +18px 的假偏差。
       * Range 取文本节点自身的矩形才是眼睛看到的那一行。
       */
      const labels = [...document.querySelectorAll('.day-hour-label')].map((el) => {
        const text = el.textContent.trim()
        const box = el.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(el)
        const line = range.getBoundingClientRect()
        const lineTop = line.height > 0 ? line.top : box.top
        const lineH = line.height > 0 ? line.height : 0
        return {
          text,
          top: Math.round(box.top - originY),
          bottom: Math.round(box.bottom - originY),
          h: Math.round(box.height),
          lineTop: Math.round((lineTop - originY) * 10) / 10,
          lineH: Math.round(lineH * 10) / 10
        }
      })

      const events = [...document.querySelectorAll('.day-event')].map((el) => {
        const r = el.getBoundingClientRect()
        // 事件块绝对定位在 .day-canvas 上，canvas 自身也可能有偏移。
        const canvasEl = el.closest('.day-canvas')
        const canvasTop = canvasEl ? canvasEl.getBoundingClientRect().top - originY : 0
        const timeEl = el.querySelector('.day-event-time')
        return {
          id: el.dataset.eventId || '',
          title: (el.querySelector('.day-event-title') || {}).textContent || '',
          time: timeEl ? timeEl.textContent.trim() : '',
          hasMeta: Boolean(timeEl),
          cls: el.className,
          docTop: Math.round(r.top - originY),
          docBottom: Math.round(r.bottom - originY),
          height: Math.round(r.height),
          canvasTop: Math.round(r.top - originY - canvasTop),
          canvasBottom: Math.round(r.bottom - originY - canvasTop)
        }
      })

      return {
        scroll: {
          clientH: scroll.clientHeight,
          clientTop: scroll.clientTop,
          scrollH: scroll.scrollHeight,
          scrollTop: Math.round(scroll.scrollTop),
          paddingBottom: parseFloat(getComputedStyle(scroll).paddingBottom) || 0,
          paddingTop: parseFloat(getComputedStyle(scroll).paddingTop) || 0,
          height: Math.round(scrollRect.height),
          maxScroll: scroll.scrollHeight - scroll.clientHeight
        },
        gutter: pick('.day-gutter'),
        canvas: pick('.day-canvas'),
        gridBg: pick('.day-grid-bg'),
        labels,
        events,
        target: { DAY_PAD_PX }
      }
    },
    { DAY_PAD_PX }
  )
}

/** 把一个「内容坐标区间」翻译成时刻区间，便于人读。 */
const spanToTime = (top, bottom) => `${fmtMin(yToMin(top))} ~ ${fmtMin(yToMin(bottom))}`

async function gotoDayView(page, base) {
  await page.addInitScript(
    ([key, payload]) => window.localStorage.setItem(key, payload),
    [DATA_KEY, JSON.stringify(seedData())]
  )
  await page.goto(`${base}?page=weekly&strict=0&sidebar=1`, { waitUntil: 'load' })
  await page.waitForSelector('.week-col-head', { timeout: 20000 })
  await page.waitForTimeout(400)
  // 第 4 列 = 周四 = 2026-09-17（seed 数据所在的日期）。
  await page.locator('.week-col-head').nth(3).click()
  await page.waitForSelector('.day-canvas', { timeout: 10000 })
  await page.waitForTimeout(600)
}

/* -------------------------------------------------------------------- 主流程 */
const lines = []
const say = (s = '') => {
  console.log(s)
  lines.push(s)
}

const browser = await chromium.launch({ executablePath, headless: true })

for (const vp of viewports) {
  const label = `${vp.w}x${vp.h}`
  const isMobile = vp.w <= 767
  say(`\n${'='.repeat(78)}`)
  say(`## 视口 ${label}${isMobile ? '（手机断点）' : '（桌面断点）'}`)
  say('='.repeat(78))

  const context = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: isMobile ? 3 : 1,
    hasTouch: isMobile,
    isMobile
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await gotoDayView(page, `http://127.0.0.1:${port}/probe.html`)
  const m = await measure(page)

  const diag = await page.evaluate(() => {
    const stored = JSON.parse(window.localStorage.getItem('quadrant-web-data-v2') || '{}')
    return {
      title: (document.querySelector('.day-title') || {}).textContent || '(无 .day-title)',
      seeded: Array.isArray(stored.weekEvents) ? stored.weekEvents.length : 'n/a',
      seededDates: Array.isArray(stored.weekEvents)
        ? [...new Set(stored.weekEvents.map((e) => e.date))].join(',')
        : 'n/a',
      eventNodes: document.querySelectorAll('.day-event').length
    }
  })

  /* ---------- 0. 诊断 ---------- */
  say(`\n### 0. 诊断`)
  say(`- 日视图标题：${diag.title}`)
  say(`- localStorage 中 weekEvents：${diag.seeded} 条，日期 ${diag.seededDates}`)
  say(`- DOM 中 .day-event 节点：${diag.eventNodes} 个`)

  /* ---------- 1. 容器 ---------- */
  say(`\n### 1. 容器`)
  say(`- .day-scroll  可视高 ${m.scroll.clientH}px / 内容高 ${m.scroll.scrollH}px / 可滚 ${m.scroll.maxScroll}px`)
  say(`- .day-scroll  padding-top ${m.scroll.paddingTop}px, padding-bottom ${m.scroll.paddingBottom}px`)
  say(`  （滚动容器高度 ${m.scroll.height}px，其中 border ${m.scroll.clientTop}px）`)

  /* ---------- 2. 轴本体：画布 / 网格背景 / 标尺背景 ---------- */
  say(`\n### 2. 轴本体（内容坐标系，y=0 是 .day-scroll 内容顶边）`)
  const c = m.canvas
  const g = m.gridBg
  const gu = m.gutter
  say(`- .day-canvas   顶 ${c.top}  底 ${c.bottom}  高 ${c.h}`)
  say(`- .day-grid-bg  顶 ${g.top}  底 ${g.bottom}  高 ${g.h}   → 覆盖 ${spanToTime(g.top, g.bottom)}`)
  say(`- .day-gutter   顶 ${gu.top}  底 ${gu.bottom}  高 ${gu.h}   → 覆盖 ${spanToTime(gu.top, gu.bottom)}`)

  const expectedGridBottom = minToY(DAY_END_MIN)
  say(`\n  期望：网格/标尺都应覆盖到 24:00，即内容坐标 ${expectedGridBottom}px。`)
  say(`  · 网格背景差 ${(expectedGridBottom - g.bottom).toFixed(0)}px`)
  say(`  · **标尺背景差 ${(expectedGridBottom - gu.bottom).toFixed(0)}px**（负值＝超出；正値＝没铺满，缺口 ${fmtMin(yToMin(gu.bottom))}→24:00）`)
  const gapMin = DAY_END_MIN - yToMin(gu.bottom)
  if (gapMin > 1) {
    say(`  → 标尺背景在 ${fmtMin(yToMin(gu.bottom))} 就结束了，24:00 前有约 ${gapMin.toFixed(0)} 分钟（${(minToY(DAY_END_MIN) - gu.bottom).toFixed(0)}px）没有底色。`)
  } else {
    say(`  → 标尺背景已铺满到 24:00。`)
  }

  /* ---------- 3. 小时标签落位 ---------- */
  say(`\n### 3. 小时标签落位（数字行的视觉中心 vs 整点线）`)
  let worstLabel = { diff: 0, text: '' }
  for (const l of m.labels) {
    const [hh] = l.text.split(':').map(Number)
    const expected = minToY(hh * 60)
    // 文字行盒（Range 量出来的那一条）的中心，才是眼睛看到的数字位置。
    const center = l.lineTop + l.lineH / 2
    const diff = center - expected
    if (Math.abs(diff) > Math.abs(worstLabel.diff)) worstLabel = { diff, text: l.text }
    if (l.text === '7:00' || l.text === '15:00' || l.text === '23:00' || l.text === '24:00') {
      say(
        `- ${l.text.padEnd(6)} 行盒顶 ${l.lineTop} 高 ${l.lineH}  中心 ${center.toFixed(1)}  整点线 ${expected}  偏差 ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}px`
      )
    }
  }
  say(`- 全部 ${m.labels.length} 个标签中最大偏差：${worstLabel.text} ${worstLabel.diff >= 0 ? '+' : ''}${worstLabel.diff.toFixed(1)}px`)
  const last = m.labels[m.labels.length - 1]
  say(`- 最后一个标签「${last.text}」盒高 ${last.h}px / 文字行高 ${last.lineH}px（前 17 个盒高 ${m.labels[0].h}px）`)

  /* ---------- 4. 事件块与时间线的贴合度 ---------- */
  say(`\n### 4. 事件块与时间线的贴合度（相对 .day-canvas 顶边）`)
  say(`| 事件 | 声明区间 | 实测顶 / 高 | 期望顶 / 高 | 顶差 | 底差 |`)
  say(`| --- | --- | --- | --- | --- | --- |`)
  say(`| — | 共渲染 ${m.events.length} 个 .day-event（seed ${SPANS.length} 个） | | | | |`)
  let worstTop = 0
  let worstBottom = 0
  let aligned = 0
  for (const ev of m.events) {
    const idx = Number((ev.id || '').replace('we', ''))
    const span = Number.isFinite(idx) ? SPANS[idx] : undefined
    if (!span) continue
    const [startMin, endMin] = span
    const wantTop = DAY_PAD_PX + ((startMin - DAY_START_MIN) / 60) * DAY_HOUR_PX
    const wantH = ((endMin - startMin) / 60) * DAY_HOUR_PX
    const topDiff = ev.canvasTop - wantTop
    const bottomDiff = ev.canvasBottom - (wantTop + wantH)
    worstTop = Math.max(worstTop, Math.abs(topDiff))
    worstBottom = Math.max(worstBottom, Math.abs(bottomDiff))
    if (Math.abs(topDiff) < 1 && Math.abs(bottomDiff) < 1) aligned += 1
    const hhmm = (m2) => `${Math.floor(m2 / 60)}:${String(m2 % 60).padStart(2, '0')}`
    say(
      `| ${ev.title} | ${hhmm(startMin)}-${hhmm(endMin)} | ${ev.canvasTop} / ${ev.height} | ${wantTop.toFixed(0)} / ${wantH.toFixed(0)} | ${topDiff >= 0 ? '+' : ''}${topDiff.toFixed(1)} | ${bottomDiff >= 0 ? '+' : ''}${bottomDiff.toFixed(1)} |`
    )
  }
  say(``)
  say(`- 完全贴合的块体：${aligned} / ${m.events.length}`)
  say(`- 最大顶边偏差 ${worstTop.toFixed(1)}px（越接近 0 越说明块体起于它声明的开始时刻）`)
  say(`- **最大底边偏差 ${worstBottom.toFixed(1)}px**（负值＝块体比时间区间短，即"略小一些"）`)
  const hourBlock = m.events.find((e) => e.id === 'we1')
  if (hourBlock) {
    say(
      `- 参照：1 小时应占 ${DAY_HOUR_PX}px，实测 ${hourBlock.height}px，缺口 ${(DAY_HOUR_PX - hourBlock.height).toFixed(0)}px`
    )
  }

  /* ---------- 5. 截图 ---------- */
  if (shotsDir) {
    if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true })
    // 滚到底：让 24:00 的收尾进入画面，这是缺陷 1 唯一看得见的视角。
    await page.evaluate(() => {
      const s = document.querySelector('.day-scroll')
      s.scrollTop = s.scrollHeight
    })
    await page.waitForTimeout(350)
    await page.screenshot({ path: `${shotsDir}/axis-bottom-${label}.png` })
    say(`\n- 已存截图 ${shotsDir}/axis-bottom-${label}.png（滚到最底部）`)
  }

  if (errors.length) say(`\n- 页面异常：${errors.join(' | ')}`)
  await context.close()
}

await browser.close()

if (out) {
  const dir = out.replace(/[\\/][^\\/]+$/, '')
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(out, `${lines.join('\n')}\n`, 'utf8')
  console.log(`\n已写出报告：${out}`)
}
