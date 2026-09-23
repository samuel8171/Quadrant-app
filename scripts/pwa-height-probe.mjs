/**
 * PWA 高度与导航条几何探针
 *
 * 解决两个读 CSS 推不出结论的问题：
 *   1. PWA standalone 下 --app-height 是否真的被修正为全屏高？
 *      （100dvh 会短掉 env(safe-area-inset-top)，底部露缝）
 *   2. 导航条内容区高度是否够用？（曾因安全区双重计算只剩 12px）
 *
 * 用法：
 *   node scripts/pwa-height-probe.mjs
 *   node scripts/pwa-height-probe.mjs --out docs/probes/pwa-height.md
 *
 * ⚠️ 关键限制（两条，都实测确认过，别指望探针能替代真机）：
 *
 *  1. 桌面浏览器里 env(safe-area-inset-*) 恒为 0，无法通过 viewport
 *     设置模拟 iOS 安全区。所以本探针用注入样式覆写的方式伪造安全区，
 *     否则「导航条是否被安全区挤扁」这类判据在 PC 上永远测不出，
 *     只会得到一堆假通过。
 *
 *  2. **高度修正本身无法在本探针里被证伪。** 把 theme.css 还原到修复前
 *     （.app 为 height: 100dvh、无 --app-height），探针依然报「全部通过」——
 *     因为 PC 上 100dvh 就等于视口高。iOS 那个「standalone 冷启动少
 *     env(safe-area-inset-top)」的行为是 WebKit 特有的，桌面 Chromium
 *     不重现。所以判定 1 只能验证「变量确实被应用且等于全屏高」，
 *     证明不了「不修就会坏」。真机验收仍是必需的。
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const BROWSER_CANDIDATES = [
  process.env.UI_PROBE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].filter(Boolean)

const browserPath = BROWSER_CANDIDATES.find((p) => existsSync(p))
if (!browserPath) {
  console.error('找不到可用浏览器')
  process.exit(1)
}

const argv = process.argv.slice(2)
const outArg = argv.indexOf('--out')
const outPath = outArg >= 0 ? argv[outArg + 1] : null

const PROBE_URL =
  process.env.PROBE_URL ?? 'http://127.0.0.1:5199/probe.html?page=weekly&sidebar=1'

/* iOS 16.4+ 起 iPhone 的真实安全区（CSS px）。
   14 Pro / 15 / 16 这一代：顶部灵动岛 59、底部 home indicator 34。 */
const IOS_INSETS = { top: 59, bottom: 34 }

const VIEWPORTS = [
  { name: 'iPhone 14 Pro', width: 393, height: 852 },
  { name: 'iPhone SE', width: 375, height: 667 }
]

const browser = await chromium.launch({ executablePath: browserPath, headless: true })
const rows = []

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true
  })
  const page = await context.newPage()

  await page.goto(PROBE_URL, { waitUntil: 'domcontentloaded' })

  /*
   * 等 .app 真正挂载。探测页会先 await init()（读 localStorage 播种数据），
   * 期间渲染的是 "loading…"，此处若直接测量会拿到 null。
   */
  await page.waitForSelector('.app', { timeout: 15000 })
  await page.waitForSelector('.sidebar', { timeout: 15000 })

  /* 测量函数。两个场景一起测：
     A. 模拟 Safari 标签页：安全区按 iOS 真机注入，data-standalone 不设 → 应走 100dvh
     B. 模拟 PWA standalone：同样注入安全区 + data-standalone=true → 应走 100lvh
     两场景都注入安全区（标签页下 iOS 也有 inset，只是 Safari 的 chrome 盖住了
     一部分视觉，但 env() 仍然有值），这样才对比得出「安全区是否被重复计算」。 */
  const measure = async (standalone) =>
    page.evaluate(
      async ({ standalone, insets, vpHeight }) => {
        const root = document.documentElement

        if (standalone) {
          root.dataset.standalone = 'true'
        } else {
          delete root.dataset.standalone
        }

        /*
         * 伪造 iOS 安全区：桌面浏览器里 env(safe-area-inset-*) 恒为 0，
         * 无法用 viewport 设置模拟。做法是往页面注入一条高优先级样式，
         * 让原本读 env() 的地方改读我们设定的值。
         *
         * 目前需覆盖的是 .sidebar 的 bottom（theme.css 里为
         * max(10px, env(safe-area-inset-bottom))）——它是唯一决定
         * 「导航条是否避开 home indicator」的属性。padding 里那处
         * 重复计算已修复移除，此处一并按真机值模拟以便回归。
         */
        const simId = '__probe_inset_sim__'
        document.getElementById(simId)?.remove()
        const style = document.createElement('style')
        style.id = simId
        style.textContent = `
          html[data-standalone='true'] .sidebar {
            bottom: max(10px, ${insets.bottom}px) !important;
          }
          .sidebar { bottom: max(10px, ${insets.bottom}px) !important; }
        `
        document.head.appendChild(style)

        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

        const app = document.querySelector('.app')
        const nav = document.querySelector('.sidebar')

        const appH = app ? app.getBoundingClientRect().height : null
        const appStyle = app ? getComputedStyle(app) : null
        const varValue = appStyle?.getPropertyValue('--app-height').trim() ?? null

        let navInfo = null
        if (nav) {
          const cs = getComputedStyle(nav)
          const r = nav.getBoundingClientRect()
          // 导航条内部「内容可见高」= 高度 - 上下 padding - 上下 border
          const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
          const borY = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
          navInfo = {
            rectHeight: r.height,
            paddingY: padY,
            borderY: borY,
            contentHeight: r.height - padY - borY,
            bottomOffset: vpHeight - r.bottom,
            paddingBottomRaw: cs.paddingBottom
          }
        }

        return {
          rootVar: getComputedStyle(root).getPropertyValue('--app-height').trim(),
          appHeight: appH,
          varFromApp: varValue,
          nav: navInfo,
          // 真实屏幕高（模拟 standalone 时 = viewport 高，因为无地址栏）
          viewportHeight: vpHeight,
          insets
        }
      },
      { standalone, insets: IOS_INSETS, vpHeight: vp.height }
    )

  const tabMode = await measure(false)
  const standaloneMode = await measure(true)

  rows.push({ viewport: vp, tabMode, standaloneMode })
  await context.close()
}

await browser.close()

/* ---------- 判定 ---------- */

const lines = []
const push = (s = '') => lines.push(s)

push('# PWA 高度与导航条几何探针报告')
push('')
push(`- 地址：${PROBE_URL}`)
push(`- iOS 假定安全区：top ${IOS_INSETS.top}px / bottom ${IOS_INSETS.bottom}px（iPhone 14 Pro 量级）`)
push('')
push('> **验证边界**：安全区由注入样式伪造（桌面 `env()` 恒为 0）。判定 1')
push('> 只能证明「`--app-height` 被正确应用且等于全屏高」，**证明不了**')
push('> 「不修就会坏」——iOS standalone 少算 `env(safe-area-inset-top)` 是')
push('> WebKit 特有行为，桌面 Chromium 不重现（已把 theme.css 还原到修复前')
push('> 实测过，探针照样全绿）。真机验收不可替代。')
push('')

let failures = 0

for (const { viewport, tabMode, standaloneMode } of rows) {
  push(`## ${viewport.name}（${viewport.width}×${viewport.height}）`)
  push('')
  push('| 场景 | --app-height | .app 实测高 | 导航条内容高 | 导航条底距 |')
  push('| --- | --- | --- | --- | --- |')
  for (const [label, m] of [
    ['Safari 标签页', tabMode],
    ['PWA standalone', standaloneMode]
  ]) {
    push(
      `| ${label} | \`${m.rootVar}\` | ${m.appHeight?.toFixed(1) ?? '—'}px | ` +
        `${m.nav ? `${m.nav.contentHeight.toFixed(1)}px` : '—'} | ` +
        `${m.nav ? `${m.nav.bottomOffset.toFixed(1)}px` : '—'} |`
    )
  }
  push('')

  // 判定 1：standalone 下 .app 必须等于全屏高（允许 1px 亚像素误差）
  const diff = Math.abs(standaloneMode.appHeight - viewport.height)
  if (diff > 1) {
    push(
      `- ❌ **standalone 高度不足**：.app 为 ${standaloneMode.appHeight.toFixed(1)}px，` +
        `应为 ${viewport.height}px，差 ${diff.toFixed(1)}px（底部会露缝）`
    )
    failures++
  } else {
    push(`- ✅ standalone 高度正确：${standaloneMode.appHeight.toFixed(1)}px = 全屏高`)
  }

  /*
   * 判定 2：两种模式下导航条内容高都不应被安全区挤扁。
   *
   * 阈值口径：导航条固定高 58，减去 padding(6+6) 与 border(1+1) 后
   * 内容区为 44px，正好等于内部按钮的高度（触摸下限亦为 44px）。
   * 所以 44px 是「贴合」而非「拥挤」——真正的缺陷形态是它被安全区
   * 二次挤压到 12px 那一类量级。此处用 44 作为下限，低于即判失败。
   */
  const need = 44
  for (const [label, m] of [
    ['标签页', tabMode],
    ['standalone', standaloneMode]
  ]) {
    if (m.nav && m.nav.contentHeight < need - 1) {
      push(
        `- ❌ **${label} 下导航条被挤扁**：内容高仅 ${m.nav.contentHeight.toFixed(1)}px，` +
          `需 ${need}px（padding-bottom 实测 ${m.nav.paddingBottomRaw}）`
      )
      failures++
    } else if (m.nav) {
      push(`- ✅ ${label} 下导航条内容高 ${m.nav.contentHeight.toFixed(1)}px ≥ ${need}px`)
    }
  }

  // 判定 3：standalone 下导航条底距应 ≥ 底部安全区（避让 home indicator）
  if (standaloneMode.nav && standaloneMode.nav.bottomOffset < IOS_INSETS.bottom - 1) {
    push(
      `- ❌ standalone 下导航条未避开 home indicator：底距 ` +
        `${standaloneMode.nav.bottomOffset.toFixed(1)}px < ${IOS_INSETS.bottom}px`
    )
    failures++
  } else if (standaloneMode.nav) {
    push(`- ✅ standalone 下导航条避开 home indicator（底距 ${standaloneMode.nav.bottomOffset.toFixed(1)}px）`)
  }

  push('')
}

push('---')
push('')
push(failures === 0 ? '**结论：全部通过。**' : `**结论：${failures} 项未通过。**`)

const report = lines.join('\n')
console.log(report)

if (outPath) {
  const abs = resolve(outPath)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, report + '\n', 'utf8')
  console.log(`\n已写入 ${abs}`)
}

process.exit(failures === 0 ? 0 : 1)
