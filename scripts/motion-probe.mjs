#!/usr/bin/env node
/**
 * 动效探针（开发期工具）：验证"看上去在动"和"真的在动"是两回事。
 *
 * 覆盖两处本轮改动：
 *   1. 底部导航的滑动指示块——桌面端纵向、手机端横向，是否真的对准激活项，
 *      以及切换时是否产生中间帧（否则只是瞬间跳过去，等于没动画）；
 *   2. 事件预设抽屉的展开/收起——高度是否走 grid-template-rows 过渡（有中间帧），
 *      收起动画结束后列表是否脱离了焦点序列。
 *
 * 关键手法：点击与采样放在同一次 page.evaluate 里，用 requestAnimationFrame 连续
 * 记录尺寸序列。分两次往返（先点、再量）会丢掉整个过渡过程，只能看到终态。
 *
 * 前置（另开终端）：
 *   ./node_modules/.bin/vite --config vite.web.config.ts --port 5199 --host 127.0.0.1 --strictPort
 *
 * 用法：
 *   node scripts/motion-probe.mjs
 *   node scripts/motion-probe.mjs --viewports 1440x900,390x844 --out docs/probes/motion.md
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
const viewports = ARG('viewports', '1440x900,390x844').split(',').map((s) => {
  const [w, h] = s.split('x').map(Number)
  return { w, h }
})
const port = ARG('port', '5199')
const out = ARG('out', '')
const shotsDir = ARG('shots', '')

const iso = (n = 0) => new Date(Date.UTC(2026, 8, 17, 2, 0, 0) + n * 86400000).toISOString()

function seedData(presetCount) {
  const colors = ['#8AB4F8', '#8CD9C1', '#F8B18C', '#B4A7E6', '#E8A0A0']
  return {
    version: 2,
    goals: [],
    events: [],
    weekPresets: Array.from({ length: presetCount }, (_, i) => ({
      id: `p${i}`,
      title: `预设 ${i + 1}`,
      color: colors[i % colors.length],
      quadrant: (i % 4) + 1,
      durationMin: [30, 45, 60, 90][i % 4],
      remark: '',
      createdAt: iso(i)
    })),
    weekEvents: [{ id: 'we0', date: '2026-09-17', title: '日程', color: colors[0], quadrant: 1, startMin: 900, endMin: 960, remark: '', showInQuadrant: false, createdAt: iso(0) }],
    weekCounterOffset: 0
  }
}

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
  const base = `http://127.0.0.1:${port}/probe.html`

  /* ======================= 一、底部导航指示块 ======================= */
  await page.addInitScript(
    ([key, payload]) => window.localStorage.setItem(key, payload),
    [DATA_KEY, JSON.stringify(seedData(0))]
  )
  await page.goto(`${base}?page=weekly&strict=0&sidebar=1`, { waitUntil: 'load' })
  await page.waitForSelector('.nav-indicator', { timeout: 20000 })
  await page.waitForTimeout(400)

  say(`\n### 一、底部导航指示块`)
  const navInfo = await page.evaluate(() => {
    const ind = document.querySelector('.nav-indicator')
    const cs = getComputedStyle(ind)
    const r = ind.getBoundingClientRect()
    return {
      display: cs.display,
      w: Math.round(r.width),
      h: Math.round(r.height),
      transform: cs.transform,
      transition: cs.transitionProperty + ' ' + cs.transitionDuration,
      items: document.querySelectorAll('.nav-item').length
    }
  })
  say(`- 指示块：display ${navInfo.display}，${navInfo.w}×${navInfo.h}px，transition ${navInfo.transition}`)
  say(`- 导航项数量 ${navInfo.items}（含移动端绝对定位的云同步按钮）`)

  /* 逐项切换，量指示块中心与激活项中心的偏差；同时采样中间帧确认真的在滑动。 */
  say(`\n| 点击第 N 项 | 指示块中心 | 激活项中心 | 偏差 | 过渡中间帧数 | 位移轨迹 |`)
  say(`| --- | --- | --- | --- | --- | --- |`)
  for (let i = 0; i < 4; i++) {
    const r = await page.evaluate(
      async (idx) => {
        const items = [...document.querySelectorAll('.nav-item')]
        const ind = document.querySelector('.nav-indicator')
        const isRow = getComputedStyle(document.querySelector('.nav')).display === 'grid'
        const read = () => {
          const b = ind.getBoundingClientRect()
          return isRow ? b.left + b.width / 2 : b.top + b.height / 2
        }
        const itemCenter = () => {
          const b = items[idx].getBoundingClientRect()
          return isRow ? b.left + b.width / 2 : b.top + b.height / 2
        }
        const before = read()
        items[idx].click()
        const track = [before]
        const t0 = performance.now()
        await new Promise((resolve) => {
          const tick = () => {
            track.push(read())
            if (performance.now() - t0 < 420) requestAnimationFrame(tick)
            else resolve()
          }
          requestAnimationFrame(tick)
        })
        // 过渡结束后停 60ms 再取终值，避免采到最后一个中间帧。
        await new Promise((r) => setTimeout(r, 60))
        const mid = new Set(track.map((v) => Math.round(v))).size
        return {
          center: Math.round(read() * 10) / 10,
          target: Math.round(itemCenter() * 10) / 10,
          mid: mid - 2, // 去掉起点与终点两个必然值，剩下的才是"中间帧"
          from: Math.round(before * 10) / 10,
          to: Math.round(track[track.length - 1] * 10) / 10
        }
      },
      i
    )
    const diff = Math.round((r.center - r.target) * 10) / 10
    say(
      `| 第 ${i + 1} 项 | ${r.center} | ${r.target} | ${diff >= 0 ? '+' : ''}${diff} | ${r.mid} | ${r.from} → ${r.to} |`
    )
  }

  /* ======================= 二、预设抽屉展开/收起 ======================= */
  // 用 12 条预设而不是空列表：空态的 .preset-empty 只有十几像素高，
  // 量不出卡片被压扁、横向滚动这类真实布局问题。
  // 带上 sidebar=1，好让截图同时拍到抽屉与底部导航条，核对两者不重叠。
  await page.addInitScript(
    ([key, payload]) => window.localStorage.setItem(key, payload),
    [DATA_KEY, JSON.stringify(seedData(12))]
  )
  await page.goto(`${base}?page=weekly&strict=0&sidebar=1`, { waitUntil: 'load' })
  await page.waitForSelector('.week-col-head', { timeout: 20000 })
  await page.waitForTimeout(300)
  await page.locator('.week-col-head').nth(3).click()
  await page.waitForSelector('.preset-panel', { timeout: 10000 })
  await page.waitForTimeout(600)

  say(`\n### 二、预设面板`)
  const panelInfo = await page.evaluate(() => {
    const panel = document.querySelector('.preset-panel')
    const toggle = document.querySelector('.preset-toggle')
    const list = document.querySelector('.preset-list')
    return {
      panelClass: panel.className,
      panelH: Math.round(panel.getBoundingClientRect().height),
      toggleTag: toggle.tagName,
      hasChevron: Boolean(toggle.querySelector('svg')),
      collapseDisplay: getComputedStyle(document.querySelector('.preset-collapse')).display,
      collapseRows: getComputedStyle(document.querySelector('.preset-collapse')).gridTemplateRows,
      listVisibility: getComputedStyle(list).visibility,
      listHeight: Math.round(list.getBoundingClientRect().height),
      isDesktop: Boolean(window.quadrantApi)
    }
  })
  say(`- 面板类名 ${panelInfo.panelClass}，高 ${panelInfo.panelH}px`)
  say(`- 折叠控件 <${panelInfo.toggleTag}>，是否渲染箭头：${panelInfo.hasChevron ? '是' : '否'}`)
  say(`- .preset-collapse display ${panelInfo.collapseDisplay}，grid-template-rows ${panelInfo.collapseRows}`)
  say(`- 列表 visibility ${panelInfo.listVisibility}，高 ${panelInfo.listHeight}px`)

  /*
   * 卡片尺寸必须在**展开态**量：收起时列表高 0，卡片会被一起压扁，
   * 那时读到的 22px 只是它的外边距，不是真实尺寸。
   */
  const cardInfo = await page.evaluate(async () => {
    const panel = document.querySelector('.preset-panel')
    if (panel.classList.contains('collapsed')) {
      document.querySelector('.preset-toggle').click()
      await new Promise((r) => setTimeout(r, 560))
    }
    const list = document.querySelector('.preset-list')
    const card = document.querySelector('.preset-card')
    const actions = document.querySelector('.preset-actions')
    const listRect = list.getBoundingClientRect()
    const cardRect = card ? card.getBoundingClientRect() : null
    const actRect = actions ? actions.getBoundingClientRect() : null
    const nav = document.querySelector('.sidebar')
    return {
      panelH: Math.round(panel.getBoundingClientRect().height),
      listH: Math.round(listRect.height),
      cardCount: document.querySelectorAll('.preset-card').length,
      cardW: cardRect ? Math.round(cardRect.width) : 0,
      cardH: cardRect ? Math.round(cardRect.height) : 0,
      scrollW: list.scrollWidth,
      clientW: list.clientWidth,
      actionH: actRect ? Math.round(actRect.height) : 0,
      actionsInside: actRect ? actRect.bottom <= listRect.bottom + 0.5 : null,
      listVisibility: getComputedStyle(list).visibility,
      /* 抽屉是浮层，必须停在底部导航条上方，否则最后一张卡的按钮点不到。 */
      gapToNav: nav ? Math.round(nav.getBoundingClientRect().top - panel.getBoundingClientRect().bottom) : null
    }
  })
  say(`\n**展开态实测**（面板高 ${cardInfo.panelH}px）`)
  say(
    `- 卡片 ${cardInfo.cardCount} 张，单张 ${cardInfo.cardW}×${cardInfo.cardH}px；横向可滚 ${
      cardInfo.scrollW > cardInfo.clientW ? '是' : '否'
    }（内容 ${cardInfo.scrollW} vs 可视 ${cardInfo.clientW}）`
  )
  say(
    `- 卡片内操作区高 ${cardInfo.actionH}px，是否完整落在列表可视区内：${
      cardInfo.actionsInside === null
        ? '无操作区'
        : cardInfo.actionsInside
          ? '是'
          : '**否（会被裁掉）**'
    }`
  )
  /*
   * 只在手机端检查这条：桌面端面板与左侧栏是**并排**的，纵向区间本来就完全重叠，
   * 拿纵向距离当"是否压住"会得出 -872px 这种荒唐结论（上一轮的"遮挡"指标也栽过同一个坑，
   * 判据必须同时要求横向重叠）。
   */
  if (isMobile && cardInfo.gapToNav !== null) {
    say(
      `- 抽屉底边与底部导航条顶边的间距 ${cardInfo.gapToNav}px → ${
        cardInfo.gapToNav >= 0 ? '通过（不重叠）' : '**失败（压在导航条上）**'
      }`
    )
  }

  /*
   * 采样：点击折叠控件，在同一次 evaluate 里用 rAF 连续记录外层高度。
   * 只在移动端有折叠控件，桌面端这一节按"列表恒显"验证。
   */
  // 读的是**当下**的状态：上面量卡片的段落已经点过一次，不能用更早的 panelInfo。
  const stateNow = await page.evaluate(() =>
    document.querySelector('.preset-panel').classList.contains('collapsed') ? 'collapsed' : 'expanded'
  )
  const frames = await page.evaluate(async () => {
    const toggle = document.querySelector('.preset-toggle')
    const collapse = document.querySelector('.preset-collapse')
    const list = document.querySelector('.preset-list')
    const heights = []
    const t0 = performance.now()
    toggle.click()
    await new Promise((resolve) => {
      const tick = () => {
        heights.push(Math.round(collapse.getBoundingClientRect().height * 10) / 10)
        if (performance.now() - t0 < 600) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    await new Promise((r) => setTimeout(r, 80))
    return {
      samples: heights.length,
      distinct: new Set(heights).size,
      from: heights[0],
      to: heights[heights.length - 1],
      listVisibility: getComputedStyle(list).visibility,
      listHeight: Math.round(list.getBoundingClientRect().height)
    }
  })

  if (panelInfo.toggleTag === 'BUTTON') {
    const firstDir = stateNow === 'collapsed' ? '收起 → 展开' : '展开 → 收起'
    const secondDir = firstDir === '收起 → 展开' ? '展开 → 收起' : '收起 → 展开'
    const endStateOf = (dir) => (dir.endsWith('展开') ? '展开' : '收起')

    say(`\n**${firstDir}**（采样 ${frames.samples} 帧）`)
    say(`- 高度 ${frames.from} → ${frames.to}px，不同高度值 ${frames.distinct} 个`)
    say(
      `- 判据：不同高度值 ≥ 3 才算"渐变"；实测 ${frames.distinct} 个 → ${frames.distinct >= 3 ? '通过' : '**失败（瞬变）**'}`
    )
    say(
      `- ${endStateOf(firstDir)}后列表：visibility ${frames.listVisibility}，高 ${frames.listHeight}px` +
        (endStateOf(firstDir) === '收起'
          ? ` → ${frames.listHeight === 0 ? '通过（已完全收起）' : `**失败（残留 ${frames.listHeight}px）**`}`
          : '')
    )

    const back = await page.evaluate(async () => {
      const toggle = document.querySelector('.preset-toggle')
      const collapse = document.querySelector('.preset-collapse')
      const heights = []
      const t0 = performance.now()
      toggle.click()
      await new Promise((resolve) => {
        const tick = () => {
          heights.push(Math.round(collapse.getBoundingClientRect().height * 10) / 10)
          if (performance.now() - t0 < 600) requestAnimationFrame(tick)
          else resolve()
        }
        requestAnimationFrame(tick)
      })
      await new Promise((r) => setTimeout(r, 80))
      const list = document.querySelector('.preset-list')
      return {
        samples: heights.length,
        distinct: new Set(heights).size,
        from: heights[0],
        to: heights[heights.length - 1],
        listVisibility: getComputedStyle(list).visibility,
        listHeight: Math.round(list.getBoundingClientRect().height)
      }
    })
    say(`\n**${secondDir}**（采样 ${back.samples} 帧）`)
    say(
      `- 高度 ${back.from} → ${back.to}px，不同高度值 ${back.distinct} 个 → ${back.distinct >= 3 ? '通过' : '**失败（瞬变）**'}`
    )
    say(
      `- ${endStateOf(secondDir)}后列表：visibility ${back.listVisibility}，高 ${back.listHeight}px` +
        (endStateOf(secondDir) === '收起'
          ? ` → ${back.listHeight === 0 ? '通过（已完全收起）' : `**失败（残留 ${back.listHeight}px）**`}`
          : ` → ${back.listVisibility === 'visible' ? '通过（可见）' : '**失败（仍隐藏）**'}`)
    )

    if (shotsDir) {
      if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true })
      // 两次采样结束后停在收起态，截图前先确保展开，再收起拍第二张。
      await page.evaluate(() => {
        const panel = document.querySelector('.preset-panel')
        if (panel.classList.contains('collapsed')) {
          document.querySelector('.preset-toggle').click()
        }
      })
      await page.waitForTimeout(520)
      await page.screenshot({ path: `${shotsDir}/preset-expanded-${label}.png` })
      await page.evaluate(() => document.querySelector('.preset-toggle').click())
      await page.waitForTimeout(520)
      await page.screenshot({ path: `${shotsDir}/preset-collapsed-${label}.png` })
      say(`- 已存截图 ${shotsDir}/preset-{expanded,collapsed}-${label}.png`)
    }
  } else {
    const stillOpen = await page.evaluate(async () => {
      const toggle = document.querySelector('.preset-toggle')
      const list = document.querySelector('.preset-list')
      const before = Math.round(list.getBoundingClientRect().height)
      toggle.click()
      await new Promise((r) => setTimeout(r, 400))
      return { before, after: Math.round(list.getBoundingClientRect().height) }
    })
    say(`\n**桌面端：点击标题不应收起列表**`)
    say(`- 点击前 ${stillOpen.before}px → 点击后 ${stillOpen.after}px → ${stillOpen.before === stillOpen.after ? '通过（列表恒显）' : '**失败（被折叠了）**'}`)
    if (shotsDir) {
      if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true })
      await page.screenshot({ path: `${shotsDir}/preset-desktop-${label}.png` })
      say(`- 已存截图 ${shotsDir}/preset-desktop-${label}.png`)
    }
  }

  /* 底栏截图：让指示块停在第二项，便于目视核对位置 */
  if (shotsDir && isMobile) {
    await page.goto(`${base}?page=quadrant&strict=0&sidebar=1`, { waitUntil: 'load' })
    await page.waitForSelector('.nav-indicator', { timeout: 20000 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${shotsDir}/nav-indicator-${label}.png` })
    say(`- 已存底栏截图 ${shotsDir}/nav-indicator-${label}.png`)
  }

  await context.close()
}

await browser.close()

if (out) {
  const dir = out.replace(/[\\/][^\\/]+$/, '')
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(out, `${lines.join('\n')}\n`, 'utf8')
  console.log(`\n已写出报告：${out}`)
}
