#!/usr/bin/env node
/**
 * 状态栏遮挡的像素级取证。
 *
 * 与 safearea-slider-probe 的区别：那个只量「元素 top 有没有下移 47px」，
 * 结论必然是"达标"，但用户看到的仍是「被虚化了一部分」。原因是：
 *
 *   iOS 的状态栏不是一条硬边——`env(safe-area-inset-top)` 给的是「安全区上界」，
 *   而状态栏那层半透明毛玻璃（背景虚化）实际覆盖到 **safe-top 再往下约 6~14px**，
 *   且越靠下虚化越弱。元素 top 只要落在 safe-top 上，它的**上半部分墨迹**就已经
 *   进了羽化区。
 *
 * 所以本探针量的是「标题墨迹（cap-height 上沿）相对 safe-top 的余量」，
 * 并把结论落成一句人话：还要再下移多少 px 才算干净。
 *
 * 用法：node scripts/statusbar-clearance-probe.mjs [--port 5199]
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { chromium } from 'playwright-core'

const ARG = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}

const executablePath = [
  process.env.UI_PROBE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].filter(Boolean).find((p) => existsSync(p))

const DATA_KEY = 'quadrant-web-data-v2'
const port = ARG('port', '5199')
const out = ARG('out', '')

/**
 * 目标余量：标题墨迹上沿应至少比 safe-top 低这么多 px 才算脱离虚化区。
 *
 * 依据：状态栏毛玻璃的实心部分约 44~48px（含刘海/灵动岛），其下沿有 8~14px
 * 渐变羽化。取 12px 作为保守值——这样在 safe-top 本身就等于状态栏高度时，
 * 墨迹上沿距屏顶 ≈ safe-top + 12，落在羽化区之外。
 */
const CLEARANCE_TARGET = 12

const p2 = (n) => String(n).padStart(2, '0')
function mondayKey() {
  const d = new Date()
  const dow = (d.getDay() + 6) % 7
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow)
  return `${m.getFullYear()}-${p2(m.getMonth() + 1)}-${p2(m.getDate())}`
}
function seedData() {
  const [my, mm, md] = mondayKey().split('-').map(Number)
  const monday = new Date(my, mm - 1, md, 12, 0, 0)
  const weekEvents = []
  for (let d = 0; d < 7; d++) {
    const dt = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + d, 12, 0, 0)
    const key = `${dt.getFullYear()}-${p2(dt.getMonth() + 1)}-${p2(dt.getDate())}`
    for (let k = 0; k < 4; k++) {
      const s = 480 + k * 150
      weekEvents.push({
        id: `we${d}-${k}`, date: key, title: `日程 ${k + 1}`,
        color: ['#8AB4F8', '#8CD9C1', '#F8B18C', '#B4A7E6'][(d + k) % 4],
        quadrant: ((d + k) % 4) + 1, startMin: s, endMin: s + 90,
        remark: '', showInQuadrant: false, createdAt: new Date().toISOString()
      })
    }
  }
  /*
   * ⭐ money 必须逐字段满足 platformApi.validMoney，否则**整份种子静默作废**
   * （表现为"一个事件都没有"）。要求：enabled(bool) + config(全数值键) +
   * days(数组) + weeks(数组)。这里同时给 enabledAt 一个 8 天前的值，
   * 好让 pendingDays 非空 ⇒ `.settle-card` 真的渲染出来。
   *
   * 「时币趋势」那张卡是 R3-F 缺陷三的报告对象，也靠这一块才出现；
   * 本探针只量它的顶部余量（趋势卡在周计划页上不存在，只在「我的」页）。
   */
  const dk = (i) => {
    const d = new Date(Date.now() - i * 86400000)
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
  }
  const money = {
    enabled: true,
    enabledAt: dk(8),
    config: {
      weeklyTC: 560, dailyCapTC: 80, tcPerHour: 10,
      nightStartMin: 1410, nightEndMin: 360, nightMultiplier: 1.5,
      minCapRatio: 0.2, weeklyLT: 20, rewardLT: 0.5, penaltyLT: 0.5,
      missPenaltyLT: 1, videoLTPerHour: 1, gameLTPerHour: 1.5,
      restDayFactor: 0.8, abandonedDayTC: 80, latePhoneTC: 40, latePhoneLT: 2,
      quadrantMultiplier: { q1: 1.5, q2: 1.0, q3: 1.2, q4: 0.5 }
    },
    days: [], weeks: []
  }
  return {
    version: 2,
    goals: Array.from({ length: 3 }, (_, i) => ({
      id: `g${i}`, title: `目标 ${i + 1}`, type: 'long', done: false,
      remark: '', groupTitles: [], subtasks: [], order: i,
      createdAt: new Date().toISOString()
    })),
    events: [], weekPresets: [], weekEvents, weekCounterOffset: 0, money
  }
}

/* 三档机型：无刘海 / 刘海 / 灵动岛 */
const DEVICES = [
  { label: 'iPhone SE（无刘海）', safeTop: 20 },
  { label: 'iPhone 14（刘海）', safeTop: 47 },
  { label: 'iPhone 16 Pro（灵动岛）', safeTop: 59 }
]

/*
 * ⭐ 量「盒 top」作为墨迹上沿的**代理**，适用于没有文字的容器
 * （`.settle-card` 的第一行是「有 N 天待结算」的正文，盒 top + padding 才是墨迹）。
 * 但用 boxTop 直接比 safe-top 会**低估**风险：盒 top 达标不代表内部墨迹达标。
 * 所以这里对每个目标声明它自己的 `inkOffset`（盒顶到墨迹顶的距离，CSS px）。
 * 标题类元素走原路径（用字体的 cap-height 推），容器类用声明值。
 */
const PAGES = [
  { name: 'review', sel: '.review-header h1', label: '复盘标题' },
  { name: 'quadrant', sel: '.page-header h1', label: '四象限标题' },
  { name: 'goals', sel: '.page-header h1', label: '目标标题' },
  { name: 'weekly', sel: '.page-header h1', label: '周计划标题' },
  /*
   * ⭐ 日结栏（R3-F 缺陷一）。它是**唯一一个自己写顶部安全区的页面元素**：
   * 宿主 `.weekly-shell` 是 flex 容器、没有任何内边距，所以这条边距就是
   * 卡片到屏顶的全部距离。
   *
   * ⚠️ 判据**不是**"离 safe-top 多远"（那是给标题用的口径）。日结栏的问题
   * 从来不是"被裁掉"，而是**和页面其它内容的顶部留白看起来不一致**：
   * `.page` 系列统一是 `calc(24px + safe-top)`，卡片却只写了 `14px + safe-top`。
   *
   * ⭐ 所以这里量的是**卡片盒顶到 `.weekly-page` 内容起点的那条节律**：
   * 卡片自己的上边距（`margin-top - safe-top`）应当与
   * `.weekly-page` 的 `padding-top - safe-top` 相等（都是 24）。
   * 这个量是**差值**，与 safe-top 的具体数值无关 —— 三档机型给出同一个数，
   * 正是它该有的样子。
   */
  {
    name: 'weekly',
    sel: '.settle-card',
    label: '日结栏',
    padTop: 12,
    /* 记为「盒顶相对 safe-top 的边距」，应当 = 24（见 theme.css 的推导）。 */
    marginBelowSafeTop: 24
  }
]

const browser = await chromium.launch({ executablePath })
const results = []

for (const dev of DEVICES) {
  for (const p of PAGES) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      hasTouch: true,
      isMobile: true
    })
    const page = await context.newPage()
    await page.addInitScript(
      ([key, payload]) => window.localStorage.setItem(key, payload),
      [DATA_KEY, JSON.stringify(seedData())]
    )
    await page.goto(`http://127.0.0.1:${port}/probe.html?page=${p.name}&strict=0&sidebar=1`, {
      waitUntil: 'load'
    })
    await page.waitForSelector(p.sel, { timeout: 20000 })
    await page.addStyleTag({
      content: `:root{--safe-top:${dev.safeTop}px !important;--app-height:844px !important;}`
    })
    await page.waitForTimeout(380)

    const m = await page.evaluate(
      ({ sel, safeTop, padTop }) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const cs = getComputedStyle(el)
        const fontSize = parseFloat(cs.fontSize)
        const lineHeightRaw = cs.lineHeight
        const lh = lineHeightRaw === 'normal' ? fontSize * 1.2 : parseFloat(lineHeightRaw)
        const rect = el.getBoundingClientRect()

        /*
         * 盒模型 top ≠ 墨迹上沿。两条取法：
         *
         *  ① 元素**自己就是文字**（h1 之类）：行盒内文字垂直居中，墨迹（cap height）
         *     大约从行盒顶部下移 (lh - fontSize)/2 + fontSize*0.20。
         *     0.20 是常见无衬线字体的 ascent 之上留白比例。
         *
         *  ② 元素是**容器**（`.settle-card` 这种）：它的第一行墨迹在 `padding-top`
         *     之下，所以偏移直接取容器自己的上内边距。用 ① 那套公式会算出 ~3px，
         *     严重低估 —— 这正是日结栏此前被漏掉的原因。
         */
        const inkOffset =
          padTop != null ? padTop : (lh - fontSize) / 2 + fontSize * 0.2
        const inkTop = rect.top + inkOffset

        // 页面容器 padding-top，用于反推改哪里
        const container = el.closest(
          '.page, .quadrant-page, .weekly-page, .review-page, .day-page'
        )
        return {
          boxTop: Math.round(rect.top * 10) / 10,
          /*
           * 盒顶相对 safe-top 的边距。这是**差值**，三档机型应当给出同一个数 ——
           * 因为 CSS 里就是 `calc(Npx + var(--safe-top))`，N 不随机型变。
           * 判「节律是否统一」用它；判「有没有被裁」用 clearance。
           */
          marginBelowSafeTop: Math.round((rect.top - safeTop) * 10) / 10,
          boxHeight: Math.round(rect.height * 10) / 10,
          inkTop: Math.round(inkTop * 10) / 10,
          inkOffset: Math.round(inkOffset * 10) / 10,
          fontSize: cs.fontSize,
          lineHeight: lineHeightRaw,
          computedLh: Math.round(lh * 10) / 10,
          /*
           * 容器类元素**不在** `.weekly-page` 里（它是 `.weekly-page` 的**前一个
           * 兄弟**，见 `.weekly-shell`），所以 `.closest()` 取不到容器。
           * 回退到 `.weekly-shell` 的父级，好让报表里那列不为空。
           */
          padTop: container
            ? getComputedStyle(container).paddingTop
            : el.parentElement
              ? `(宿主 ${String(el.parentElement.className).trim() || el.parentElement.tagName})`
              : null,
          clearance: Math.round((inkTop - safeTop) * 10) / 10
        }
      },
      { sel: p.sel, safeTop: dev.safeTop, padTop: p.padTop ?? null }
    )

    results.push({ device: dev, page: p, m })
    await context.close()
  }
}

await browser.close()

const L = []
L.push('# 状态栏遮挡余量实测', '')
L.push(`生成时间：${new Date().toLocaleString('zh-CN')}`)
L.push('')
L.push(
  `**判定标准**：标题墨迹上沿相对 \`--safe-top\` 的余量应 ≥ **${CLEARANCE_TARGET}px**。`
)
L.push('')
L.push(
  '余量为 0 表示墨迹上沿恰好贴在安全区边界上——虽然"没被裁掉"，但上半截仍落在状态栏毛玻璃的羽化区里，肉眼看就是"被虚化了一部分"。'
)
L.push('')
L.push('| 机型 | 安全区 | 页面 | 盒 top | 墨迹 top | 余量 | 盒顶距 safe-top | 判定 |')
L.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
for (const r of results) {
  if (!r.m) {
    L.push(`| ${r.device.label} | ${r.device.safeTop} | ${r.page.label} | — | — | — | 元素缺失 |`)
    continue
  }
  /*
   * 两个口径取严：
   *   · clearance ≥ CLEARANCE_TARGET（标题们）：离羽化带够远，不被虚化；
   *   · marginBelowSafeTop === page.marginBelowSafeTop（日结栏）：
   *     与同页其它内容的顶部留白**逐字相等**，这才是"间隔统一"。
   * 后者是差值口径，与 safe-top 的数值无关。
   */
  const wantMargin = r.page.marginBelowSafeTop
  const okClr = r.m.clearance >= CLEARANCE_TARGET
  const okMargin = wantMargin == null || r.m.marginBelowSafeTop === wantMargin
  const ok = okClr && okMargin
  const why = !okMargin
    ? `❌ 节律不符（应 ${wantMargin}px，实 ${r.m.marginBelowSafeTop}px）`
    : !okClr
      ? `❌ 还差 ${Math.round((CLEARANCE_TARGET - r.m.clearance) * 10) / 10}px`
      : '✅'
  L.push(
    `| ${r.device.label} | ${r.device.safeTop} | ${r.page.label} | ${r.m.boxTop} | ${r.m.inkTop} | ${r.m.clearance} | ${r.m.marginBelowSafeTop}${wantMargin == null ? '' : ` / ${wantMargin}`} | ${why} |`
  )
}
L.push('')

/* 按页面汇总「需要追加多少 px」 */
L.push('## 需要追加的下移量', '')
L.push('')
const byPage = {}
for (const r of results) {
  if (!r.m) continue
  byPage[r.page.label] = byPage[r.page.label] || []
  byPage[r.page.label].push(r)
}
L.push('| 页面 | 最差余量 | 需追加 | 涉及机型 |')
L.push('| --- | --- | --- | --- |')
for (const [label, rs] of Object.entries(byPage)) {
  const worst = rs.reduce((a, b) => (a.m.clearance < b.m.clearance ? a : b))
  const target = worst.page.minClearance ?? CLEARANCE_TARGET
  const need = Math.max(0, Math.ceil(target - worst.m.clearance))
  L.push(
    `| ${label} | ${worst.m.clearance} | ${need > 0 ? `**+${need}px**` : '0'} | ${rs.filter((r) => r.m.clearance < target).map((r) => r.device.label).join('、') || '—'} |`
  )
}
L.push('')
L.push('## 页面容器 padding-top 现状', '')
L.push('')
L.push('| 页面 | padding-top | h1 字号 | h1 行高（计算值） |')
L.push('| --- | --- | --- | --- |')
for (const p of PAGES) {
  const r = results.find((x) => x.page.name === p.name && x.m)
  if (!r) continue
  L.push(`| ${p.label} | \`${r.m.padTop}\` | ${r.m.fontSize} | ${r.m.computedLh} |`)
}
L.push('')

const report = L.join('\n')
console.log(report)
if (out) {
  const dir = dirname(out)
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(out, report, 'utf8')
  console.log(`\n报告已写入：${out}`)
}

/*
 * 退出码：有任何一项未达门槛就非零退出，好让 CI / 探针编排能直接判成败。
 * 之前只打印表格、恒以 0 退出 —— 那些 ❌ 行在长输出里没人会看见。
 */
const bad = results.filter((r) => {
  if (!r.m) return false
  if (r.m.clearance < CLEARANCE_TARGET) return true
  const w = r.page.marginBelowSafeTop
  return w != null && r.m.marginBelowSafeTop !== w
})
if (bad.length) {
  const detail = bad
    .map((r) => {
      const w = r.page.marginBelowSafeTop
      if (w != null && r.m.marginBelowSafeTop !== w) {
        return `${r.device.label}/${r.page.label}: 节律 ${r.m.marginBelowSafeTop} ≠ ${w}`
      }
      return `${r.device.label}/${r.page.label}: 余量 ${r.m.clearance} < ${CLEARANCE_TARGET}`
    })
    .join('\n  ')
  console.error(`\n❌ 状态栏余量不足（${bad.length} 项）：\n  ${detail}`)
  process.exit(1)
}
console.log('\n✅ 全部目标的状态栏余量达标')
