/*
 * ============================================================ 桌面端玻璃层取证（走 CDP）
 *
 * 为什么需要它：2026-09-24 出现了一次「桌面端打开无画面」——用户在「外观」里
 * 把折射模式切成 `Shader` 之后，窗口里只剩 body 底色。根因是库在挂载 effect 里
 * 对 **CSS 隐藏的底部 dock** 量到 0×0，`createImageData(0, ·)` 抛 `IndexSizeError`，
 * 而全应用没有错误边界 ⇒ React 卸载整棵树。
 *
 * 那次的教训是：**现有探针全都跑在网页端**，桌面端只被"打包产物能不能起来"覆盖，
 * 而"起来之后画面在不在"没有任何自动判据。本脚本补这一格。
 *
 * 做法是接管**真实运行的桌面端**（不是网页端、不是探测页）：
 *   ./node_modules/.bin/electron-vite dev --remoteDebuggingPort 9333
 *   node scripts/desktop-glass-cdp.mjs --port 9333
 *
 * 注意 electron-vite 的这个开关叫 `--remoteDebuggingPort`（驼峰），
 * 而 9222 常被其他 Electron 宿主（如 WorkBuddy 自身）占着，届时日志里会出现
 * `bind() returned an error ... 只允许使用一次` + `Cannot start http server for devtools`，
 * 换个端口即可。这两个环境事实都是踩出来的，写在这里省一次排查。
 *
 * 断言（任一失败即退出码 1）：
 *   1. 挂载后**没有任何** Uncaught / pageerror；
 *   2. 桌面档：CSS 隐藏的 dock 层**没有布局盒**，且里面**没有**挂库（闸门生效）；
 *   3. 桌面档：打开「外观」弹窗后，库确实挂上了、材质板的 `filter` 含 `url(`；
 *   4. 切到手机档：dock 层有布局盒、库里挂上了（闸门是双向的，不是"永远不挂"）；
 *   5. 桌面档 ↔ 手机档往返**没有触发异常**（这条覆盖 resize 期间
 *      "库先量到 0、闸门下一帧才收走面板"的时序风险）。
 */

import { chromium } from 'playwright-core'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const PORT = argOf('port', '9333')
const OUT = argOf('out', 'tmp/desktop-glass-cdp.json')
/**
 * 可选：先把折射模式切成指定档。传 `shader` 就是复现那次事故的操作路径
 * （用户在原版里点了 Shader → 桌面端从此打不开）。
 * 不传则沿用当前设置，只做只读取证。
 */
const MODE = argOf('mode', '')

const fails = []
const check = (ok, label, detail) => {
  if (!ok) fails.push(`${label}${detail ? `：${detail}` : ''}`)
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? `　${detail}` : ''}`)
}

/** 页面侧取一份快照：闸门状态、库的挂载情况、材质板与库的滤镜 id */
const SNAPSHOT = () => {
  const q = (s) => document.querySelector(s)
  const rects = (el) => (el ? el.getClientRects().length : -1)
  const bf = (el) => (el ? getComputedStyle(el).backdropFilter : null)
  const fl = (el) => (el ? getComputedStyle(el).filter : null)

  const dock = q('.gs-layer--dock')
  const panel = q('.gs-layer--dialog .gs-panel')
  const plate = q('.gs-layer--dialog .gs-plate')
  const anim = q('.gs-layer--dialog .gs-anim')

  /*
   * 库的 6 层装饰（2 底色 + 4 镜面边）落在 `.gs-anim` 的直接子节点里，
   * 全部按库内部的 `glassSize` 定尺寸。它和材质板的宽度一比，
   * 就知道"描边到底贴不贴边" —— 这条断言就是为了那次 0.94 事故加的。
   */
  const decor = anim
    ? [...anim.children].filter((el) => !el.classList.contains('gs-panel'))
    : []
  const decorW = Number.parseFloat(decor[0]?.style.width ?? 'NaN')
  const plateW = plate ? +plate.getBoundingClientRect().width.toFixed(2) : NaN

  return {
    mobile: window.matchMedia('(max-width: 767px)').matches,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    /** 桌面端是否已经把整棵 React 树渲染出来（黑屏事故的直接判据） */
    appMounted: Boolean(q('.app')),
    panelsTotal: document.querySelectorAll('.gs-panel').length,
    svgFiltersTotal: document.querySelectorAll('.gs-layer svg filter').length,
    dock: {
      rects: rects(dock),
      hasPanel: Boolean(dock?.querySelector('.gs-panel')),
      hasFilter: Boolean(dock?.querySelector('svg filter'))
    },
    dialog: {
      hasPanel: Boolean(panel),
      hasPlate: Boolean(plate),
      panelBox: panel
        ? { w: Math.round(panel.getBoundingClientRect().width), h: Math.round(panel.getBoundingClientRect().height) }
        : null,
      plateBackdrop: bf(plate),
      /*
       * 折射必须挂在材质板自己的 `filter:` 上，**不能**写在 backdrop-filter 里：
       * Chromium 不实现 backdrop-filter 的 url() 引用，写上等于没写
       * （实测两者逐位相同，见 tmp/filter-mode-test.mjs）。
       */
      plateFilter: fl(plate),
      panelFilter: fl(panel),
      /** 材质板必须是空 div —— 这是"filter: 位移不会糊到文字"的前提 */
      plateChildren: plate ? plate.children.length : null,
      plateW,
      decorW: Number.isFinite(decorW) ? decorW : null,
      /** 0.9400 就是那次事故的指纹 */
      decorRatio: Number.isFinite(decorW) && plateW ? +(decorW / plateW).toFixed(4) : null,
      /**
       * shader 档的标志：位移贴图是运行时用 canvas 逐像素算出来后塞进 feImage 的 data URL。
       * 选择器用属性匹配而不是 `image[...]`：库渲染的是 SVG 的 `feImage`，
       * 它在 DOM 里的标签名保留大小写，写 `image` 一个都匹配不到（踩过）。
       */
      dataUrlMapBytes: (
        q('.gs-layer--dialog .gs-panel svg [href^="data:image"]')?.getAttribute('href') ?? ''
      ).length
    }
  }
}

const main = async () => {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
  const ctx = browser.contexts()[0]
  const page = ctx.pages()[0]
  if (!page) throw new Error('没有找到页面目标，确认桌面端已启动且带了 --remoteDebuggingPort')

  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`)
  })

  /** 长任务：shader 档要逐像素算位移贴图，主线程是否被卡住由这里回答 */
  await page.evaluate(() => {
    window.__lt = []
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__lt.push(Math.round(e.duration))
      }).observe({ entryTypes: ['longtask'] })
    } catch {
      /* 不支持就留空数组 */
    }
  })

  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Page.enable')

  /*
   * 两条纪律，都是这一轮踩出来的：
   *   ① 点击走 evaluate。`page.click()` 要做可操作性检查（等元素稳定），
   *      而窗口被遮挡时渲染器的 rAF 被节流，它会一直等到超时。
   *   ② 截图走原生 CDP。`page.screenshot()` 会卡在"等字体/等稳定帧"，同样超时。
   */
  const click = (sel) =>
    page.evaluate((s) => document.querySelector(s)?.click(), sel)
  // 按可见文本点：走 evaluate 就用不了 playwright 的 `:has-text()`。
  // 忽略大小写——按钮上是 `Shader`，命令行里通常写成 `shader`。
  const clickByText = (sel, text) =>
    page.evaluate(
      ([s, t]) =>
        [...document.querySelectorAll(s)]
          .find((e) => e.textContent.trim().toLowerCase() === t.toLowerCase())
          ?.click(),
      [sel, text]
    )
  const shoot = async (path) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path, Buffer.from(data, 'base64'))
  }
  const emulate = async (w, h) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: 1,
      mobile: false
    })
    // Emulation 会改媒体查询，但 resize 监听不保证被触发，手工补一次
    await page.evaluate(() => window.dispatchEvent(new Event('resize')))
    await page.waitForTimeout(600)
  }

  await page.waitForSelector('.app', { timeout: 15000 })
  await page.waitForTimeout(600)

  const settings = await page.evaluate(() => localStorage.getItem('quadrant-glass-v1'))
  console.log(`\n读取到的外观设置：${settings ?? '(空)'}\n`)

  // ── 桌面档 ────────────────────────────────────────────────
  console.log('【桌面档 1280×800】')
  const desktop = await page.evaluate(SNAPSHOT)
  check(desktop.appMounted, 'React 树已渲染（不是空白窗口）')
  check(desktop.mobile === false, '媒体查询处于桌面档', `innerWidth=${desktop.viewport.w}`)
  check(
    desktop.dock.rects === 0,
    'CSS 隐藏的 dock 层没有布局盒',
    `getClientRects().length=${desktop.dock.rects}`
  )
  check(
    !desktop.dock.hasPanel && !desktop.dock.hasFilter,
    '隐藏的 dock 里没有挂库（零尺寸宿主闸门生效）'
  )

  // 打开「外观」弹窗（它自己也是玻璃，且内部还嵌一条折射预览玻璃）
  //
  // 点击一律走 evaluate 而不是 `page.click()`：后者要做可操作性检查
  // （等元素稳定），而窗口被遮挡时渲染器的 rAF 会被节流，它会一直等到超时。
  // 截图同理用原生 CDP —— `page.screenshot()` 会卡在"等字体/等稳定帧"。
  await click('.appearance-button')
  await page.waitForSelector('.gs-layer--dialog .gs-panel, .gs-layer--dialog .gs-fallback', { timeout: 8000 })
  await page.waitForTimeout(1200)

  if (MODE) {
    console.log(`\n【复现用户操作：把折射模式切成 ${MODE}】`)
    await clickByText('.gs-layer--dialog .glass-mode', MODE)
    await page.waitForTimeout(900)
    check(
      (await page.evaluate(() => localStorage.getItem('quadrant-glass-v1')))?.includes(`"${MODE}"`) ??
        false,
      `设置已持久化为 ${MODE}`
    )
    check(await page.evaluate(() => Boolean(document.querySelector('.app'))), '切换后 React 树仍然存在')
  }

  const withDialog = await page.evaluate(SNAPSHOT)
  check(withDialog.dialog.hasPanel, '外观弹窗里库已挂载')
  /*
   * 材质板的 `filter` 必须是 none。2026-09-24 实测：把库的位移滤镜挂成材质板的
   * `filter:` 会让它按规范成为 backdrop root，自己的 `backdrop-filter` 随即采不到
   * 东西 —— 材质整个消失（分区逐位等于"无材质"）。曾经为了"修折射"这么改过一次，
   * 是回归，这条断言就是防它回来。
   */
  check(
    (withDialog.dialog.plateFilter ?? 'none') === 'none',
    '材质板自身不带 filter（带了会把材质掐死）',
    withDialog.dialog.plateFilter ?? 'null'
  )
  check(
    (withDialog.dialog.plateBackdrop ?? '').includes('blur('),
    '材质板的 backdrop-filter 仍在提供磨砂',
    withDialog.dialog.plateBackdrop ?? 'null'
  )
  check(
    withDialog.dialog.plateChildren === 0,
    '材质板是空 div（材质板不该承载内容）',
    `children=${withDialog.dialog.plateChildren}`
  )
  check(
    (withDialog.dialog.panelFilter ?? 'none') === 'none',
    '库面板自身不带 filter（文字与按钮不被位移）',
    withDialog.dialog.panelFilter ?? 'null'
  )
  /*
   * 这条是那次 0.94 事故的回归判据：库内部的 glassSize 与玻璃体必须同尺寸，
   * 否则镜面边会缩在玻璃体里面（实测曾经是 439.92 vs 468 = 0.9400）。
   */
  check(
    withDialog.dialog.decorRatio !== null &&
      Math.abs(withDialog.dialog.decorRatio - 1) < 0.005,
    '库的装饰层与玻璃体同尺寸（镜面边贴在边上）',
    `decor=${withDialog.dialog.decorW} plate=${withDialog.dialog.plateW} 比值=${withDialog.dialog.decorRatio}`
  )
  if (MODE === 'shader') {
    check(
      withDialog.dialog.dataUrlMapBytes > 1000,
      'shader 档确实生成了位移贴图 data URL',
      `${withDialog.dialog.dataUrlMapBytes} 字符`
    )
  }
  await shoot('tmp/desktop-dialog.png')

  // ── 往返断点：覆盖 resize 期间"库先量到 0"的时序风险 ────────
  console.log('\n【切到手机档 390×844，再切回桌面档】')
  await emulate(390, 844)
  const phone = await page.evaluate(SNAPSHOT)
  check(phone.dock.rects > 0, '手机档 dock 层有布局盒', `getClientRects().length=${phone.dock.rects}`)
  check(phone.dock.hasPanel, '手机档 dock 里挂上了库（闸门双向）')
  await shoot('tmp/desktop-phone.png')

  await emulate(1280, 800)
  const back = await page.evaluate(SNAPSHOT)
  check(back.dock.rects === 0 && !back.dock.hasPanel, '切回桌面档后 dock 里的库被收走')

  const longTasks = await page.evaluate(() => window.__lt ?? [])
  const maxLt = longTasks.length ? Math.max(...longTasks) : 0
  console.log(`\n长任务：${longTasks.length} 个，最长 ${maxLt}ms`)

  check(errors.length === 0, '全程没有未捕获异常', errors.slice(0, 3).join(' | '))

  const report = {
    port: PORT,
    settings,
    desktop,
    withDialog,
    phone,
    back,
    longTasks: { count: longTasks.length, max: maxLt },
    errors
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(report, null, 2))

  await browser.close()

  console.log(fails.length ? `\n${fails.length} 项失败：\n- ${fails.join('\n- ')}` : '\n全部通过')
  process.exit(fails.length ? 1 : 0)
}

main().catch((e) => {
  console.error('探针自身出错：', e.message)
  process.exit(2)
})
