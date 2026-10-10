#!/usr/bin/env node
/**
 * 目标历史 + 预设排序的**行为守门探针**（真实浏览器，走探测页绕开登录门禁）。
 *
 * 为什么单测不够：这两条需求的主体是**时序与指针**——
 *   ① 「确认完成后 3 秒内不得从主页消失」是一条定时器行为；
 *   ② 排序模式要先展开抽屉、再靠 pointerdown/move/up 拖动，还要写回 localStorage。
 * 单测只能覆盖纯函数（`partitionGoals` / `resolveDropIndex` / `reorderPresetsInList`），
 * 覆盖不到「JSX 挂对了没有、定时器接线对不对、指针捕获会不会被滚动抢走」。
 *
 * 用法：先起探测服务，再跑本脚本。
 *   ./node_modules/.bin/vite --config tmp/vite.probe.config.ts --port 5199 --strictPort &
 *   node scripts/goal-history-preset-probe.mjs
 *
 * 退出码 0 = 全绿；1 = 至少一条断言失败（失败项会逐条打印）。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
]
const executablePath = CANDIDATES.find((p) => existsSync(p))
if (!executablePath) {
  console.error('找不到可用的浏览器可执行文件')
  process.exit(2)
}

const PORT = 5199
const DATA_KEY = 'quadrant-web-data-v2'
const OUT = 'docs/probes/goal-history-preset'
mkdirSync(OUT, { recursive: true })

const failures = []
function check(name, ok, extra = '') {
  const mark = ok ? 'ok  ' : 'FAIL'
  console.log(`  [${mark}] ${name}${extra ? ` — ${extra}` : ''}`)
  if (!ok) failures.push(name)
}

const goals = [
  {
    id: 'g-long-1',
    title: '考研英语 85+',
    type: 'long',
    done: false,
    remark: '',
    groupTitles: [''],
    subtasks: [],
    order: 0,
    createdAt: '2026-09-01T00:00:00.000Z'
  },
  {
    id: 'g-long-2',
    title: '读完《深度学习》',
    type: 'long',
    done: false,
    remark: '',
    groupTitles: [''],
    subtasks: [],
    order: 1,
    createdAt: '2026-09-02T00:00:00.000Z'
  },
  {
    id: 'g-short-1',
    title: '写完周报',
    type: 'short',
    done: false,
    remark: '',
    groupTitles: [''],
    subtasks: [],
    order: 2,
    createdAt: '2026-09-03T00:00:00.000Z'
  }
]

/**
 * 两个预设，且**数组顺序与 createdAt 顺序故意相反** —— 用来证明显示顺序取自数组。
 *
 * 时长刻意拉开（10 小时 vs 1 小时）：桌面档的卡片高度随时长伸缩，两者差得越远，
 * 「让位」时兄弟块的位移量越大（实测 180px 量级），"补间而非瞬移"那条判据才站得住。
 * 若两者同高，位移只剩一个 8~12px 的间隙差，判据会退化得几乎测不出来。
 */
const weekPresets = [
  {
    id: 'p-b',
    title: '乙预设',
    color: '#8CD9C1',
    quadrant: 2,
    durationMin: 600,
    remark: '',
    createdAt: '2026-09-02T00:00:00.000Z'
  },
  {
    id: 'p-a',
    title: '甲预设',
    color: '#8AB4F8',
    quadrant: 1,
    durationMin: 60,
    remark: '',
    createdAt: '2026-09-01T00:00:00.000Z'
  }
]

const seed = {
  version: 2,
  goals,
  events: [],
  weekPresets,
  weekEvents: [],
  weekCounterOffset: 0
}

/** 播种走 sessionStorage 守卫：`addInitScript` 每次导航（含 reload）都会重跑。 */
const seedScript = ([data, key]) => {
  if (sessionStorage.getItem('__probeSeeded') === '1') return
  sessionStorage.setItem('__probeSeeded', '1')
  localStorage.setItem(key, JSON.stringify(data))
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  /*
   * 关掉后台节流。headless 页面默认会被当成"不可见"而把 `setTimeout` 压到 ≥1s 粒度，
   * 于是 3000ms 的保持窗口会漂到 4s 上下 —— 那是环境噪声，会被误读成产品行为。
   * 真机上页面可见时不存在这一层节流。
   */
  args: [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding'
  ]
})
const consoleErrors = []

async function newPage(viewport, hasTouch, isMobile) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    hasTouch,
    isMobile
  })
  const page = await ctx.newPage()
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))
  await page.addInitScript(seedScript, [seed, DATA_KEY])
  return { ctx, page }
}

// ============================================================================
// 一、目标主页 → 历史子页面
// ============================================================================
console.log('\n== 目标主页：完成 → 3 秒保持 → 移入历史 ==')
{
  const { ctx, page } = await newPage({ width: 1280, height: 900 }, false, false)
  await page.goto(`http://127.0.0.1:${PORT}/probe.html?page=goals&strict=0`, { waitUntil: 'load' })
  await page.waitForSelector('.goal-card')

  check('两列各有历史入口', (await page.locator('.goal-history-btn').count()) === 2)
  check('主页初始 3 张卡片', (await page.locator('.goal-card').count()) === 3)

  /*
   * 先装一个 MutationObserver 记录「移出动画是否真的播过」。
   * 不用 `waitForSelector('.is-leaving')`：那个类只存在约 200ms，靠轮询去抓是碰运气。
   */
  await page.evaluate(() => {
    window.__leavingSeen = false
    new MutationObserver(() => {
      if (document.querySelector('.goal-card-slot.is-leaving')) window.__leavingSeen = true
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] })
  })

  // 勾选第一列的第一张（长期目标「考研英语 85+」）。
  const firstCard = page.locator('.goal-column').first().locator('.goal-card').first()
  const t0 = Date.now()
  await firstCard.locator('.goal-check').click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/01-just-checked.png` })

  check('确认完成后立刻置为 done', (await firstCard.getAttribute('class'))?.includes('done') === true)
  check(
    '400ms 时仍在主页（未被摘除）',
    (await page.locator('.goal-card').count()) === 3 &&
      (await page.locator('.goal-card-slot.is-leaving').count()) === 0
  )

  // 按**实际流逝的时间**量一次中点：这里才是"不是瞬间消失"的证据。
  await page.waitForTimeout(Math.max(0, t0 + 1500 - Date.now()))
  check(
    `1.5 秒（实测 ${Date.now() - t0}ms）时仍在主页`,
    (await page.locator('.goal-card').count()) === 3
  )

  const leftOk = await page
    .waitForFunction(() => document.querySelectorAll('.goal-card').length === 2, null, {
      timeout: 5000,
      /*
       * 显式按定时器轮询（默认是 rAF）。headless 里 rAF 会被压到 ~1Hz，
       * 于是"卡片在 3.2s 离开"会被量成 4.2s —— 那是观测手段的延迟，不是产品行为。
       */
      polling: 25
    })
    .then(() => true)
    .catch(() => false)
  const leftAt = Date.now() - t0
  check('保持窗口过后离开主页', leftOk, `${leftAt}ms 后剩 2 张`)
  check('离开主页发生在 3 秒之后', leftAt >= 3000, `${leftAt}ms`)
  check('播放了移出动画（.is-leaving 出现过）', await page.evaluate(() => window.__leavingSeen === true))

  const historyBtnText = await page
    .locator('.goal-column')
    .first()
    .locator('.goal-history-btn')
    .innerText()
  check('长期列历史入口显示计数', historyBtnText.includes('1'), `文案「${historyBtnText}」`)
  await page.screenshot({ path: `${OUT}/02-after-hold.png` })

  // 进历史子页面
  await page.locator('.goal-column').first().locator('.goal-history-btn').click()
  await page.waitForSelector('.subtask-header h1')
  await page.waitForTimeout(300)
  const historyTitle = await page.locator('.subtask-header h1').innerText()
  check(
    '历史子页面标题正确',
    historyTitle.includes('长期目标') && historyTitle.includes('历史'),
    `「${historyTitle}」`
  )
  const historyTitles = await page.locator('.goal-card .goal-title').allInnerTexts()
  check('已完成目标出现在历史里', historyTitles.includes('考研英语 85+'), historyTitles.join(' / '))
  check('历史页没有"暂无"空态', (await page.locator('.goal-history-empty').count()) === 0)
  await page.screenshot({ path: `${OUT}/03-history-page.png` })

  // 历史内取消勾选 → 回主页
  await page.locator('.goal-card').first().locator('.goal-check').click()
  await page.waitForTimeout(250)
  check('取消勾选后该项立刻离开历史', (await page.locator('.goal-history-empty').count()) === 1)

  await page.locator('.back-btn').click()
  await page.waitForSelector('.goal-columns')
  await page.waitForTimeout(300)
  const backCount = await page.locator('.goal-card').count()
  const doneCount = await page.locator('.goal-card.done').count()
  check(
    '返回主页后该项目回到主列表',
    backCount === 3 && doneCount === 0,
    `${backCount} 张 / done ${doneCount}`
  )
  await page.screenshot({ path: `${OUT}/04-back-to-main.png` })

  await ctx.close()
}

// ============================================================================
// 二、预设拖动排序（桌面侧栏 + 手机全屏面板，两者都是纵向）
// ============================================================================
for (const profile of [
  { name: '桌面', viewport: { width: 1280, height: 900 }, hasTouch: false, isMobile: false },
  { name: '手机', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
]) {
  console.log(`\n== 预设排序（${profile.name}） ==`)
  const { ctx, page } = await newPage(profile.viewport, profile.hasTouch, profile.isMobile)
  await page.goto(`http://127.0.0.1:${PORT}/probe.html?page=weekly&strict=0`, { waitUntil: 'load' })
  await page.waitForSelector('.week-col-head')
  await page.locator('.week-col-head').first().click()
  await page.waitForSelector('.preset-panel')
  await page.waitForTimeout(400)

  /*
   * 用 `textContent` 而不是 `innerText`：手机档的面板默认是**收起**的
   * （`.preset-panel.collapsed .preset-list { visibility: hidden }`），
   * 而 `innerText` 对不可见元素返回空串 —— 那会把"看不到"误读成"没有内容"。
   */
  const titles = () => page.locator('.preset-card .preset-title').allTextContents()
  const persistedOrder = () =>
    page.evaluate((key) => {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw).weekPresets.map((p) => p.id) : null
    }, DATA_KEY)

  check(
    '面板按**数组顺序**渲染（与 createdAt 顺序相反）',
    (await titles()).join(',') === '乙预设,甲预设',
    (await titles()).join(',')
  )

  /*
   * 进入调整顺序模式。
   *
   * 手机档会切成**全屏面板**（`.preset-sort-sheet`），所以先进一个采样器观察它的
   * 放大动画 —— 必须在点击之前装好，否则动画已经播完了。
   */
  if (profile.isMobile) {
    await page.evaluate(() => {
      window.__sheetSamples = []
      const t0 = performance.now()
      window.__sheetIv = setInterval(() => {
        const el = document.querySelector('.preset-sort-sheet')
        if (el) {
          const r = el.getBoundingClientRect()
          window.__sheetSamples.push({ w: Math.round(r.width), h: Math.round(r.height) })
        }
        if (performance.now() - t0 > 900) clearInterval(window.__sheetIv)
      }, 16)
    })
  }
  await page.locator('.preset-head-actions .icon-btn').first().click()
  await page.waitForTimeout(320)

  if (profile.isMobile) {
    const sheetBox = await page.locator('.preset-sort-sheet').boundingBox()
    check('手机档排序是全屏面板', (await page.locator('.preset-sort-sheet').count()) === 1)
    check(
      '全屏面板铺满视口',
      sheetBox !== null &&
        Math.abs(sheetBox.width - profile.viewport.width) <= 1 &&
        Math.abs(sheetBox.height - profile.viewport.height) <= 1,
      sheetBox ? `${Math.round(sheetBox.width)}×${Math.round(sheetBox.height)}` : '不存在'
    )
    check('原抽屉已让位（避免两份列表同时挂 ref）', (await page.locator('.preset-panel').count()) === 0)
    const dir = await page.evaluate(
      () => getComputedStyle(document.querySelector('.preset-sort-list')).flexDirection
    )
    check('面板里的列表是纵向（与桌面端同一套排布）', dir === 'column', `flex-direction=${dir}`)
    const sheetSamples = await page.evaluate(() => window.__sheetSamples ?? [])
    const minW = sheetSamples.length > 0 ? Math.min(...sheetSamples.map((s) => s.w)) : 0
    check(
      '打开有放大动画（实测到缩放中间态）',
      minW > 0 && minW < profile.viewport.width - 4,
      `最小宽 ${minW}px → 终态 ${profile.viewport.width}px（${sheetSamples.length} 帧）`
    )

    /*
     * 2026-10-10 用户报的两个显示缺陷，各留一条判据（都是"真出过错的形状"）：
     *
     * ① **标题被压成 0 高**。卡片高度是内联写死的（随预设时长伸缩），而 `.preset-title`
     *    带 `overflow: hidden` —— 按 Flexbox 规范这类元素在 flex 列里的"自动最小尺寸"
     *    退化为 **0**，高度不够时它会被 `flex-shrink` 压得比一行字还矮（实测 h=0，
     *    2.5 小时那张剩 8px，于是与象限文字糊成重影）。判据 = 标题盒高至少一行字。
     * ② **箭头组落到卡片下沿、还被裁掉一截**（`.preset-actions` 在抽屉里被改成
     *    `position: static`，那条规则同时命中了排序面板）。判据 = 箭头组的中线与卡片中线重合。
     */
    const cardGeom = await page.evaluate(() =>
      [...document.querySelectorAll('.preset-sort-list .preset-card')].map((card) => {
        const cr = card.getBoundingClientRect()
        const titleEl = card.querySelector('.preset-title')
        const tr = titleEl.getBoundingClientRect()
        const actions = card.querySelector('.preset-actions')
        const ar = actions.getBoundingClientRect()
        return {
          text: titleEl.textContent ?? '',
          titleH: Math.round(tr.height),
          centerDev: Math.round((ar.top + ar.height / 2 - (cr.top + cr.height / 2)) * 10) / 10,
          actionsPos: getComputedStyle(actions).position,
          actionsBottom: Math.round(ar.bottom - cr.top),
          cardH: Math.round(cr.height)
        }
      })
    )
    check(
      '排序面板里标题不被压扁（每张卡都有完整一行标题）',
      cardGeom.length === 2 && cardGeom.every((c) => c.titleH >= 12 && c.text.length > 0),
      cardGeom.map((c) => `${c.text}:${c.titleH}px`).join(' / ')
    )
    check(
      '上下移按钮在卡片里垂直居中',
      cardGeom.every((c) => Math.abs(c.centerDev) <= 1 && c.actionsPos === 'absolute'),
      cardGeom.map((c) => `偏差 ${c.centerDev}px（${c.actionsPos}）`).join(' / ')
    )
  }

  check('排序模式：卡片标记为 reordering', (await page.locator('.preset-card.reordering').count()) === 2)
  check('排序模式：每张卡片出现拖柄', (await page.locator('.preset-grip').count()) === 2)
  await page.screenshot({ path: `${OUT}/05-reorder-${profile.name}.png` })

  // ① 按钮路径：第一张「下移」→ 顺序反转
  await page.locator('.preset-card').first().locator('.preset-actions .icon-btn').last().click()
  await page.waitForTimeout(250)
  check('下移按钮换了顺序', (await titles()).join(',') === '甲预设,乙预设', (await titles()).join(','))
  await page.waitForTimeout(700)
  check('按钮改的顺序已落盘', (await persistedOrder())?.join(',') === 'p-a,p-b', String(await persistedOrder()))

  // ② 拖拽路径：把现在的第一张拖到最后（跨过第二张的中线）
  const dragged = (await titles())[0]
  const sibling = (await titles())[1]
  const siblingKey = dragged === '甲预设' ? 'p-b' : 'p-a'
  const draggedKey = dragged === '甲预设' ? 'p-a' : 'p-b'
  const sourceBox = await page.locator('.preset-card').first().boundingBox()
  const targetBox = await page.locator('.preset-card').last().boundingBox()
  const siblingBefore = await page.locator(`[data-preset-id="${siblingKey}"]`).boundingBox()
  /*
   * 两种档位现在都是**纵向**拖拽：桌面是侧栏竖排，手机是全屏面板竖排
   * （抽屉那条横向排布出不来了 —— 手机一进排序模式就被全屏面板替换掉）。
   * 也就是说 `resolveDropIndex` 的 `x` 轴分支在生产路径上已不可达，保留它是防御性写法。
   */
  const horizontal = false
  // 拖柄在卡片内固定于 left:2px、宽 22px、纵向居中 —— 两种布局同源，按下点可直接算。
  const pressX = sourceBox.x + 13
  const pressY = sourceBox.y + sourceBox.height / 2
  const grabX = pressX - sourceBox.x
  const grabY = pressY - sourceBox.y
  const endX = horizontal ? targetBox.x + targetBox.width : targetBox.x + targetBox.width / 2
  const endY = horizontal ? targetBox.y + targetBox.height / 2 : targetBox.y + targetBox.height

  await page.mouse.move(pressX, pressY)
  await page.mouse.down()
  await page.waitForTimeout(90)
  await page.screenshot({ path: `${OUT}/06-dragging-${profile.name}.png` })

  check('起拖后出现跟手幽灵', (await page.locator('.preset-drag-ghost').count()) === 1)
  check(
    '被拖卡片在本体位置隐身（自己就是那个"空位"）',
    (await page.locator('.preset-card.is-drag-source').count()) === 1
  )
  const snapDuring = await page.evaluate(
    () => getComputedStyle(document.querySelector('.preset-list')).scrollSnapType
  )
  check(
    '拖拽期间关掉横向吸附',
    (await page.locator('.preset-list.is-dragging').count()) === 1 && snapDuring === 'none',
    `scroll-snap-type=${snapDuring}`
  )

  /*
   * 让位过程的采样器。
   *
   * ⚠️ 用 `setInterval` 而不是 `requestAnimationFrame`：headless 下 rAF 被压到 ~1Hz
   * （同一个坑在量「3 秒保持窗口」时也踩过），逐帧采样会几乎采不到点。
   * 定时器 + `getBoundingClientRect` 能读到 WAAPI 动画**当前**的插值结果。
   */
  await page.evaluate((key) => {
    const el = document.querySelector(`[data-preset-id="${key}"]`)
    window.__samples = []
    if (!el) return
    const t0 = performance.now()
    window.__sampler = setInterval(() => {
      const r = el.getBoundingClientRect()
      window.__samples.push({ t: Math.round(performance.now() - t0), x: r.left, y: r.top })
      if (performance.now() - t0 > 1100) clearInterval(window.__sampler)
    }, 20)
  }, siblingKey)

  await page.mouse.move(endX, endY, { steps: 14 })
  await page.waitForTimeout(340)

  const ghostBox = await page.locator('.preset-drag-ghost').boundingBox()
  check(
    '幽灵跟手（与指针的偏差 ≤2px）',
    ghostBox !== null && Math.abs(ghostBox.x - (endX - grabX)) <= 2 && Math.abs(ghostBox.y - (endY - grabY)) <= 2,
    ghostBox ? `dx=${(ghostBox.x - (endX - grabX)).toFixed(2)} dy=${(ghostBox.y - (endY - grabY)).toFixed(2)}` : '幽灵不存在'
  )

  /*
   * 幽灵是**本体的副本**，两者内部的排版必须逐项对齐 —— 否则起拖那一刻文字会跳一下
   * （本体按新排布居中、副本还顶在上沿）。手机全屏面板里本体换了排布（内容垂直居中 +
   * 右侧按钮通道），副本必须同步换，靠 `sheet` 类认亲（它挂在 body 上，没有列表祖先）。
   *
   * 比的是"标题相对**自己盒子**的纵向偏移"，与两者此刻各自的绝对位置无关
   * —— 兄弟块早已让位，不能用绝对坐标比。
   */
  const ghostAlign = await page.evaluate(() => {
    const pair = (root) => {
      const title = root?.querySelector('.preset-title')
      if (!root || !title) return null
      return {
        offset: Math.round((title.getBoundingClientRect().top - root.getBoundingClientRect().top) * 10) / 10
      }
    }
    return {
      ghost: pair(document.querySelector('.preset-drag-ghost')),
      source: pair(document.querySelector('.preset-card.is-drag-source'))
    }
  })
  check(
    '幽灵内部排版与本体逐项对齐（起拖不跳字）',
    ghostAlign.ghost !== null &&
      ghostAlign.source !== null &&
      Math.abs(ghostAlign.ghost.offset - ghostAlign.source.offset) <= 1,
    `幽灵标题偏移 ${ghostAlign.ghost?.offset}px / 本体 ${ghostAlign.source?.offset}px`
  )

  await page.mouse.up()
  await page.waitForTimeout(120)
  check(
    '松手后幽灵仍在飞（落位过渡进行中）',
    (await page.locator('.preset-drag-ghost.settling').count()) === 1
  )

  await page.waitForTimeout(500)
  const samples = await page.evaluate(() => window.__samples ?? [])
  check('松手后幽灵消失', (await page.locator('.preset-drag-ghost').count()) === 0)
  check('松手后本体恢复可见', (await page.locator('.preset-card.is-drag-source').count()) === 0)
  check('拖拽换了顺序', (await titles()).join(',') === `${sibling},${dragged}`, (await titles()).join(','))

  // 让位动画的核心判据：兄弟块**经过中间态**，而不是瞬移。
  const axis = horizontal ? 'x' : 'y'
  const siblingAfter = await page.locator(`[data-preset-id="${siblingKey}"]`).boundingBox()
  const oldPos = siblingBefore[axis]
  const newPos = siblingAfter[axis]
  const lo = Math.min(oldPos, newPos)
  const hi = Math.max(oldPos, newPos)
  const between = samples.filter((s) => s[axis] > lo + 2 && s[axis] < hi - 2)
  const seen = samples.map((s) => Math.round(s[axis]))
  check(
    '兄弟块位移是可观的（判据才有意义）',
    hi - lo > 8,
    `${axis} 由 ${Math.round(oldPos)} → ${Math.round(newPos)}`
  )
  check(
    '兄弟块让位是**补间**而不是瞬移',
    between.length >= 2,
    `${between.length}/${samples.length} 帧处于中间态；采样=[${seen.slice(0, 12).join(',')}${seen.length > 12 ? ',…' : ''}]`
  )

  await page.screenshot({ path: `${OUT}/07-reordered-${profile.name}.png` })
  check('落位后无残留的拖拽态', (await page.locator('.preset-list.is-dragging').count()) === 0)

  /*
   * 收尾与"横向吸附"的恢复。
   *
   * ⚠️ 判据要注意：CSS 写的是 `scroll-snap-type: x proximity`，而 `proximity` 是该属性的
   * **初始值**，浏览器序列化时会把默认值省掉 ⇒ 计算样式读回来是 `x` 而不是 `x proximity`。
   * 断言写成"以 x 开头"才不会把这条算成失败。
   *
   * 手机档要先把全屏面板关掉，回到抽屉才谈得上"吸附恢复" —— 面板里本来就没有横向吸附。
   */
  if (profile.isMobile) {
    await page.locator('.preset-sort-done').click()
    await page.waitForTimeout(360)
    check(
      '点「完成」后关闭全屏面板、回到抽屉',
      (await page.locator('.preset-sort-sheet').count()) === 0 &&
        (await page.locator('.preset-panel').count()) === 1
    )
    const snapBack = await page.evaluate(
      () => getComputedStyle(document.querySelector('.preset-list')).scrollSnapType
    )
    check('抽屉的横向吸附已恢复', snapBack.startsWith('x'), `scroll-snap-type=${snapBack}`)
  } else {
    const snapDesktop = await page.evaluate(
      () => getComputedStyle(document.querySelector('.preset-list')).scrollSnapType
    )
    check('桌面列表本就没有横向吸附', snapDesktop === 'none', `scroll-snap-type=${snapDesktop}`)
  }

  // ③ 持久化：等过 500ms 防抖后读 localStorage
  await page.waitForTimeout(900)
  check(
    '拖拽改的顺序已落盘',
    (await persistedOrder())?.join(',') === `${siblingKey},${draggedKey}`,
    String(await persistedOrder())
  )

  await ctx.close()
}

// ============================================================================
// 三、拖动期间滚动列表：落点必须跟着"指针下面的内容"走（而不是按下时的视口位置）
// ============================================================================
/*
 * 用户报告：桌面端拖动时把预设栏上下滑动之后，松手无法落到"原本不在屏幕内、
 * 因滑动才出现"的位置。根因是落点判定用的是**视口坐标**，而视口坐标会随滚动整片平移。
 * 修法是把槽位与指针都换算到**列表内容坐标系**（`内容 = 视口 − 列表矩形 + 滚动量`），
 * 并额外监听 `scroll`（指针不动、内容在动时也必须重算）。
 *
 * 这里用一个**矮视口**逼出可滚动的列表，然后做一次决定性对比：
 * 指针的视口位置停在第一张卡片中线之上，但滚动之后它下面的**内容**已是第二张。
 * 修好了 ⇒ 落到第 2 位；没修好 ⇒ 落回第 1 位。
 */
console.log('\n== 拖动期间滚动列表（桌面矮视口 1280×320） ==')
{
  const { ctx, page } = await newPage({ width: 1280, height: 320 }, false, false)
  await page.goto(`http://127.0.0.1:${PORT}/probe.html?page=weekly&strict=0`, { waitUntil: 'load' })
  await page.waitForSelector('.week-col-head')
  await page.locator('.week-col-head').first().click()
  await page.waitForSelector('.preset-panel')
  await page.waitForTimeout(400)
  await page.locator('.preset-head-actions .icon-btn').first().click()
  await page.waitForTimeout(320)

  /*
   * 先把顺序换成 [甲(矮), 乙(高)] —— 让"没修好"时的期望结果与"修好了"不同，
   * 这条判据才不是白过的（第一次写成初始顺序时，两种情况的结果恰好一样）。
   */
  await page.locator('.preset-card').first().locator('.preset-actions .icon-btn').last().click()
  await page.waitForTimeout(260)
  const orderStart = await page
    .locator('.preset-card:not(.preset-drag-ghost) .preset-title')
    .allTextContents()
  check('基准顺序为 甲,乙', orderStart.join(',') === '甲预设,乙预设', orderStart.join(','))

  const metrics = await page.evaluate(() => {
    const el = document.querySelector('.preset-list')
    return { range: el.scrollHeight - el.clientHeight, content: el.scrollHeight, box: el.clientHeight }
  })
  check(
    '矮视口下列表确实可滚动（判据才有意义）',
    metrics.range > 120,
    `可滚 ${Math.round(metrics.range)}px / 内容 ${metrics.content}px / 视口 ${metrics.box}px`
  )

  const cardBox = await page.locator('.preset-card').first().boundingBox()
  const listBox = await page.locator('.preset-list').boundingBox()
  await page.mouse.move(cardBox.x + 13, cardBox.y + cardBox.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(90)
  // 指针移到列表底部附近 —— 仍落在第一张卡的内容区间里（不滚动的话就是原位）
  await page.mouse.move(cardBox.x + 13, listBox.y + listBox.height - 8, { steps: 10 })
  await page.waitForTimeout(80)
  const draftBeforeScroll = await page
    .locator('.preset-card:not(.preset-drag-ghost) .preset-title')
    .allTextContents()
  check('未滚动时仍在第 1 位', draftBeforeScroll.join(',') === '甲预设,乙预设', draftBeforeScroll.join(','))

  /*
   * 滚动列表。
   *
   * 用 `scrollTop` 直接赋值而**不是** `page.mouse.wheel`：wheel 能不能送到滚动容器
   * 取决于环境（实测 headless 下 scrollTop 一直是 0，判据会退化成白过）。而产品侧
   * 监听的是 `scroll` 事件本身、与"谁触发的滚动"无关（滚轮 / 触屏 / 键盘 / 惯性
   * 都一样），所以直接改 scrollTop 是对产品逻辑的忠实模拟。
   */
  const scrollInfo = await page.evaluate(() => {
    const el = document.querySelector('.preset-list')
    const before = { client: el.clientHeight, scrollH: el.scrollHeight }
    el.scrollTop = el.scrollHeight
    return {
      ...before,
      after: el.scrollTop,
      lists: document.querySelectorAll('.preset-list').length
    }
  })
  check(
    '滚动已生效',
    scrollInfo.after > 60,
    `scrollTop=${Math.round(scrollInfo.after)} / client=${scrollInfo.client} / scrollH=${scrollInfo.scrollH} / 列表元素=${scrollInfo.lists}`
  )

  const draftAfterScroll = await page
    .locator('.preset-card:not(.preset-drag-ghost) .preset-title')
    .allTextContents()
  check(
    '滚动后**草稿顺序实时跟着变**（指针没动）',
    draftAfterScroll.join(',') === '乙预设,甲预设',
    `滚动前 ${draftBeforeScroll.join(',')} → 滚动后 ${draftAfterScroll.join(',')}`
  )

  await page.mouse.up()
  await page.waitForTimeout(420)
  const order = await page
    .locator('.preset-card:not(.preset-drag-ghost) .preset-title')
    .allTextContents()
  check('松手落到指针下面那个槽位', order.join(',') === '乙预设,甲预设', order.join(','))
  await page.screenshot({ path: `${OUT}/09-scroll-drop.png` })

  /*
   * 反向对照：不滚动时同一套动作必须**不换位** —— 证明上一条不是碰巧成立的。
   */
  await page.locator('.preset-card').first().locator('.preset-actions .icon-btn').last().click()
  await page.waitForTimeout(260)
  await page.evaluate(() => {
    document.querySelector('.preset-list').scrollTop = 0
  })
  await page.waitForTimeout(120)
  const cardBox2 = await page.locator('.preset-card').first().boundingBox()
  const listBox2 = await page.locator('.preset-list').boundingBox()
  await page.mouse.move(cardBox2.x + 13, cardBox2.y + cardBox2.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(90)
  await page.mouse.move(cardBox2.x + 13, listBox2.y + listBox2.height - 8, { steps: 10 })
  await page.waitForTimeout(80)
  await page.mouse.up()
  await page.waitForTimeout(420)
  const orderNoScroll = await page
    .locator('.preset-card:not(.preset-drag-ghost) .preset-title')
    .allTextContents()
  check(
    '反向对照：同样动作但不滚动 ⇒ 顺序不变',
    orderNoScroll.join(',') === '甲预设,乙预设',
    orderNoScroll.join(',')
  )
  await ctx.close()
}

// ============================================================================
// 四、窄屏不溢出（历史入口是新增控件，手机密度在本项目踩过坑）
// ============================================================================
console.log('\n== 目标页窄屏（390×844） ==')
{
  const { ctx, page } = await newPage({ width: 390, height: 844 }, true, true)
  await page.goto(`http://127.0.0.1:${PORT}/probe.html?page=goals&strict=0&sidebar=1`, { waitUntil: 'load' })
  await page.waitForSelector('.goal-card')
  await page.waitForTimeout(300)

  const fits = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.goal-history-btn')]
    if (btns.length !== 2) return { ok: false, reason: `入口数 ${btns.length}` }
    for (const b of btns) {
      const r = b.getBoundingClientRect()
      if (r.right > window.innerWidth || r.left < 0) return { ok: false, reason: `越界 ${r.left}..${r.right}` }
    }
    // 标题不能被历史入口挤成 0 宽（本项目出现过标题被挤成 25px 竖排的先例）。
    const titles = [...document.querySelectorAll('.goal-column-title')]
    for (const t of titles) {
      if (t.getBoundingClientRect().width < 120) return { ok: false, reason: `列标题只有 ${t.getBoundingClientRect().width}px` }
    }
    return { ok: true, reason: '' }
  })
  check('历史入口完整落在视口内且未挤扁列标题', fits.ok, fits.reason)
  await page.screenshot({ path: `${OUT}/08-goals-mobile.png`, fullPage: false })
  await ctx.close()
}

await browser.close()

console.log('\n== 页面错误 ==')
for (const e of consoleErrors) console.log(`  [err ] ${e}`)
check('无 console error', consoleErrors.length === 0, `${consoleErrors.length} 条`)

console.log(`\n结果：${failures.length === 0 ? '全绿' : `${failures.length} 条失败`}`)
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log(`截图在 ${OUT}/`)
