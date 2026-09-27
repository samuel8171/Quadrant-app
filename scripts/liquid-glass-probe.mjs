#!/usr/bin/env node
/**
 * 液态玻璃接入验证探针。
 *
 * 每个断言都用可复核的数字，不靠"看起来像"：
 *
 *   ① dock 玻璃与 .sidebar 的盒模型是否**逐像素重合**
 *      （玻璃体 = 内容盒 + 2×内边距，任一边算错都会错位一两像素，
 *        在深色底上肉眼几乎看不出，只会觉得"哪里不太对"）
 *   ② 内容层的 font 是否真的被重置（库内联 font: 500 20px/1，不重置的话
 *      弹窗正文会变成 20px）
 *   ③ 右键菜单玻璃的**左上角**是否落在鼠标点上（库的 top/left 是中心点语义，
 *      差半个尺寸就说明几何算错了）
 *   ④ 弹窗玻璃的中心是否在视口中心
 *   ⑤ 降级引擎下是否真的换成 .gs-fallback（且不再有 .glass）
 *   ⑥ **菜单项点得动**：只是几何对不够 —— 曾经出过一次回归，守卫按
 *      `.context-menu` 找菜单，而这个类在玻璃化后消失了，于是"点菜单项"
 *      在 pointerdown 阶段就把菜单收起，click 永远派发不到元素上。
 *      几何断言全绿也发现不了，必须真点一下并检查副作用。
 *
 * 前置（另开终端）：
 *   ./node_modules/.bin/vite --config vite.web.config.ts --port 5199 --host 127.0.0.1 --strictPort
 *
 * 用法：
 *   node scripts/liquid-glass-probe.mjs --out docs/probes/liquid-glass
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const ARG = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d
}

const CANDIDATES = [
  process.env.UI_PROBE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].filter(Boolean)

const executablePath = CANDIDATES.find((p) => existsSync(p))
if (!executablePath) {
  console.error('未找到可用浏览器')
  process.exit(2)
}

const port = ARG('port', '5199')
const outDir = ARG('out', 'docs/probes/liquid-glass')
const base = `http://127.0.0.1:${port}/probe.html`
mkdirSync(outDir, { recursive: true })

const DATA_KEY = 'quadrant-web-data-v2'
const GLASS_KEY = 'quadrant-glass-v1'

const iso = (i) => new Date(Date.now() - i * 3600_000).toISOString()

function seedData() {
  const goals = ['期末总目标', '考过六级', '读完十本书'].map((title, i) => ({
    id: `g${i}`,
    title,
    type: i % 2 === 0 ? 'long' : 'short',
    done: false,
    remark: '备注文本',
    groupTitles: ['阶段一', '阶段二'],
    subtasks: [
      { id: `g${i}s0`, title: '子目标 1', done: false, group: 0, remark: '', order: 0 }
    ],
    order: i,
    createdAt: iso(i)
  }))

  const events = Array.from({ length: 6 }, (_, i) => ({
    id: `q${i}`,
    text: `象限任务 ${i + 1}`,
    remark: '',
    quadrant: (i % 4) + 1,
    x: 60 + (i % 3) * 150,
    y: 40 + Math.floor(i / 3) * 120,
    width: 130,
    createdAt: iso(i)
  }))

  return { version: 2, goals, events, weekPresets: [], weekEvents: [], weekCounterOffset: 0 }
}

/*
 * 向事件块派发一个**指定坐标**的 contextmenu。
 *
 * 不点真实像素位置，是因为象限画布用的是世界坐标 + 缩放，播种的数值经缩放后
 * 落在视口之外（实测卡片渲染在 left: 7200px，视口只有 390px 宽）——
 * 那样测出来的是"点在空白处"，而不是菜单几何错。
 *
 * 这里要验的本来也只是「菜单玻璃的左上角是否等于指针坐标」，
 * 与卡片实际在哪无关，所以直接指定坐标反而更纯粹。
 */
async function openMenuAt(page, x, y) {
  const ok = await page.evaluate(
    ([cx, cy]) => {
      const card = document.querySelector('.event-card')
      if (!card) return false
      card.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: cx,
          clientY: cy
        })
      )
      return true
    },
    [x, y]
  )
  if (!ok) return false
  await page.waitForSelector('.gs-layer--menu', { timeout: 8000 })
  await page.waitForTimeout(350)
  return true
}

const results = []
const check = (name, pass, detail) => {
  results.push({ name, pass, detail })
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`)
}

const browser = await chromium.launch({ executablePath, headless: true })

/** 在页面里量一组玻璃相关的盒子 */
const measure = (page) =>
  page.evaluate(() => {
    const rect = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return {
        x: Math.round(r.x * 10) / 10,
        y: Math.round(r.y * 10) / 10,
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        cx: Math.round((r.x + r.width / 2) * 10) / 10,
        cy: Math.round((r.y + r.height / 2) * 10) / 10
      }
    }
    const chromiumPanels = [...document.querySelectorAll('.glass')]
    const fallbackPanels = [...document.querySelectorAll('.gs-fallback')]
    const dockLayer = document.querySelector('.gs-layer--dock')
    const content = document.querySelector('.gs-content')
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      glassCount: chromiumPanels.length,
      fallbackCount: fallbackPanels.length,
      // 库的 filter 是否真的挂在 warp 层上
      warpFilter: document.querySelector('.glass__warp')
        ? getComputedStyle(document.querySelector('.glass__warp')).filter
        : null,
      dockDisplay: dockLayer ? getComputedStyle(dockLayer).display : null,
      sidebarRect: rect(document.querySelector('.sidebar')),
      dockGlassRect: dockLayer ? rect(dockLayer.querySelector('.glass, .gs-fallback')) : null,
      dockPlateRect: rect(document.querySelector('.gs-dock-plate')),
      navItemCount: document.querySelectorAll('.nav .nav-item').length,
      navColumns: document.querySelector('.nav')
        ? getComputedStyle(document.querySelector('.nav')).gridTemplateColumns
        : null,
      navItemRect: rect(document.querySelector('.nav .nav-item')),
      firstContentFont: content ? getComputedStyle(content).font : null,
      firstContentWidth: content ? Math.round(parseFloat(getComputedStyle(content).width)) : null
    }
  })

/* ------------------------------------------------------------------ 场景一 */
console.log('\n【场景一】移动视口 · Chromium 全效果')

let context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  hasTouch: true,
  isMobile: true
})
let page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})

await page.addInitScript(
  ([k, v]) => window.localStorage.setItem(k, v),
  [DATA_KEY, JSON.stringify(seedData())]
)
await page.goto(`${base}?page=quadrant&sidebar=1&strict=0`, { waitUntil: 'load' })
await page.waitForSelector('.sidebar', { timeout: 20000 })
await page.waitForSelector('.gs-layer--dock .glass', { timeout: 20000 })
await page.waitForTimeout(600)

let m = await measure(page)
console.log(`  视口 ${m.viewport.w}×${m.viewport.h}｜玻璃实例 ${m.glassCount}｜dock 层 display=${m.dockDisplay}`)

// ① dock 玻璃与 .sidebar 盒模型重合
{
  const s = m.sidebarRect
  const g = m.dockGlassRect
  const dx = g ? Math.abs(g.x - s.x) : 999
  const dy = g ? Math.abs(g.y - s.y) : 999
  const dw = g ? Math.abs(g.w - s.w) : 999
  const dh = g ? Math.abs(g.h - s.h) : 999
  check(
    'dock 玻璃与 .sidebar 逐边重合（容差 1.5px）',
    dx <= 1.5 && dy <= 1.5 && dw <= 1.5 && dh <= 1.5,
    `侧栏 ${s.w}×${s.h} @(${s.x},${s.y})　玻璃 ${g ? `${g.w}×${g.h} @(${g.x},${g.y})` : '缺失'}　偏差 x${dx} y${dy} w${dw} h${dh}`
  )
}

// ② 导航项数量与触摸高度
check(
  '导航为 5 项（4 个页面 + 外观入口）',
  m.navItemCount === 5,
  `实际 ${m.navItemCount} 项，列宽模板 ${m.navColumns}`
)
check(
  '单个导航项高度 ≥ 44px（iOS 触摸下限）',
  m.navItemRect && m.navItemRect.h >= 44,
  `实测 ${m.navItemRect ? m.navItemRect.h : '—'}px`
)

// ③ 库的 filter 确实挂上了
check(
  '谱变层 computed filter 引用 SVG 滤镜',
  typeof m.warpFilter === 'string' && m.warpFilter.includes('url('),
  `${m.warpFilter}`
)

// ④ 内容层字体被重置（否则弹窗正文会变 20px）
check(
  '内容层 font 已重置（不再是库内联的 20px）',
  m.firstContentFont !== null && !/20px/.test(m.firstContentFont),
  `${m.firstContentFont}`
)

await page.screenshot({ path: `${outDir}/01-dock-mobile.png` })

// ---- 打开外观设置面板
await page.click('.appearance-button')
await page.waitForSelector('.glass-settings', { timeout: 10000 })
await page.waitForTimeout(500)

const modal = await page.evaluate(() => {
  const panel = document.querySelector('.glass-settings')
  const warp = panel.querySelector('.glass__warp')
  const r = panel.getBoundingClientRect()
  return {
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    cx: Math.round(r.x + r.width / 2),
    cy: Math.round(r.y + r.height / 2),
    engineTag: document.querySelector('.glass-engine-tag')?.textContent ?? '',
    sliderCount: document.querySelectorAll('.glass-settings input[type=range]').length,
    disabledSliders: document.querySelectorAll('.glass-settings input[type=range]:disabled').length,
    modeButtons: document.querySelectorAll('.glass-settings .glass-mode').length,
    effective: document.querySelector('.glass-effective')?.textContent ?? '',
    previewGlass: Boolean(document.querySelector('.glass-preview .glass')),
    filter: warp ? getComputedStyle(warp).filter : null
  }
})
console.log(
  `  设置面板 ${modal.rect.w}×${modal.rect.h} @(${modal.rect.x},${modal.rect.y})｜引擎标签「${modal.engineTag}」`
)
check(
  '弹窗玻璃水平居中于视口',
  Math.abs(modal.cx - 195) <= 2,
  `中心 x=${modal.cx}，视口中心 195`
)
check('设置面板含 6 个滑块 + 7 个模式/引擎按钮', modal.sliderCount === 6 && modal.modeButtons === 7, `滑块 ${modal.sliderCount}，按钮 ${modal.modeButtons}`)
check('折射预览条内嵌了一块玻璃', modal.previewGlass, modal.previewGlass ? '已渲染' : '未找到')
console.log(`  有效模糊读数：「${modal.effective.trim().slice(0, 60)}」`)

/*
 * ⭐ ⑤ 材质板的祖先链上不许出现"合成面"（2026-09-27 第十七轮新增）
 *
 * 规则：`position: fixed`（或 sticky）与**非 auto 的 `z-index`** 出现在材质板到
 * `documentElement` 之间的**任一祖先**上，都会把那一层变成合成面；当同一层里还有
 * 库那棵含 `mix-blend-mode` 的元素时，材质板的背景采样会被读空 —— 现象是弹窗整块透明、
 * 只剩 0.34 的染色（保留率 0.662 = 1 − 0.34）。
 *
 * 这条规则第十三轮加的 `.gs-viewport{position:fixed;z-index:70}` 撞了个正着，
 * 于是**桌面端与网页端的弹窗材质死了两天**（只有"全效果档"发病：降级档不渲染库，
 * 没有那个前提），而当时本探针 34 项**全绿** —— 因为没有一项看过祖先链。
 * 排查时不要只看定位层自己：**从材质板一路走到 documentElement**。
 *
 * 例外：`.gs-layer--dock`（手机底栏）不查。它挂在 `aside.sidebar`（手机档 fixed+z100）
 * 里，而 sidebar 的背景是**不透明的** `rgb(26,29,35)` —— 材质板身后本来就没有可糊的东西，
 * 保不保留都是同一个观感，属于设计取舍而不是缺陷（2026-09-27 实测，见 tmp/dbg-dock-real.mjs）。
 */
const ancestorAudit = await page.evaluate(() => {
  const bad = []
  for (const layer of document.querySelectorAll('.gs-layer')) {
    // 例外一：手机底栏 —— 它的祖先 `aside.sidebar` 是 fixed+z100，但 sidebar 的底色是
    // 不透明的 rgb(26,29,35)，材质板身后没有可糊的东西，属于设计取舍（见上面注释）。
    if (layer.classList.contains('gs-layer--dock')) continue
    // 例外二：嵌在别层里的子浮层（设置面板的折射预览条就是 `.gs-layer--preview`）。
    // 它的祖先必然包含库根节点（带着宿主自己的 `--gs-z`），那不是可选的修饰；
    // 而预览条贴在面板正文上，身后本来是平的，同样没有可糊的对象。
    if (layer.parentElement?.closest('.gs-layer')) continue
    const r = layer.getBoundingClientRect()
    if (!r.width || !r.height) continue
    for (let n = layer; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n)
      const z = cs.zIndex
      if (cs.position === 'fixed' || cs.position === 'sticky' || (z !== 'auto' && z !== '')) {
        bad.push(
          `${n.tagName.toLowerCase()}.${String(n.className || '').trim().split(/\s+/)[0]}(pos=${cs.position} z=${z})`
        )
      }
    }
  }
  return bad
})
check(
  '材质板祖先链上没有合成面（fixed / 非 auto 的 z-index）',
  ancestorAudit.length === 0,
  ancestorAudit.join(' | ') || '干净'
)

/*
 * ⭐ ⑥ 弹窗材质**真的在糊页面**（不是只糊了自己那一面）
 *
 * 判据用「对比度保留率」而不是像素差：材质板的染色（0.34）本身就会产生很大的像素差，
 * 所以"材质开/关像素差 > 0"在材质完全失效时同样成立 —— 那正是这一条能抓出缺陷、
 * 而历史断言抓不出的原因。做法：把高频条纹插在**弹窗之前**（页面侧），
 * 再用同一个采样盒抓"材质开/关"两张，比 std。≈0 糊平（活），≈0.66 只剩染色（死）。
 */
{
  const plateSel = '.gs-layer--dialog .gs-plate'
  await page.evaluate(() => {
    document.getElementById('probeStripeBackdrop')?.remove()
    const d = document.createElement('div')
    d.id = 'probeStripeBackdrop'
    d.style.cssText =
      'position:fixed;inset:0;pointer-events:none;' +
      'background:repeating-linear-gradient(0deg,#0b0f16 0 6px,#e8f1ff 6px 12px)'
    // 插成 body 的第一个子节点：树序在页面与弹窗之前 ⇒ 它才是"身后的东西"
    document.body.insertBefore(d, document.body.firstChild)
    const st = document.createElement('style')
    st.id = 'probeRetentionCss'
    // 页面容器自带不透明底色，会盖住条纹；只在探针里临时让开，测完立刻恢复
    st.textContent =
      '.quadrant-viewport{background:transparent!important}' +
      '.gs-layer--dialog .gs-content{visibility:hidden!important}'
    document.head.appendChild(st)
  })
  await page.waitForTimeout(420)
  const stdOf = async (clip) => {
    const b64 = (await page.screenshot({ clip })).toString('base64')
    return page.evaluate(async (b) => {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b)).blob())
      const g = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')
      g.drawImage(bmp, 0, 0)
      const d = g.getImageData(0, 0, bmp.width, bmp.height).data
      let s = 0
      let s2 = 0
      const n = bmp.width * bmp.height
      for (let i = 0; i < d.length; i += 4) {
        const v = (d[i] + d[i + 1] + d[i + 2]) / 3
        s += v
        s2 += v * v
      }
      const mean = s / n
      return +Math.sqrt(Math.max(0, s2 / n - mean * mean)).toFixed(2)
    }, b64)
  }
  const clip = await page.evaluate((sel) => {
    const b = document.querySelector(sel).getBoundingClientRect()
    return {
      x: Math.round(b.x) + 10,
      y: Math.round(b.y) + 10,
      width: Math.round(b.width) - 20,
      height: Math.round(b.height) - 20
    }
  }, plateSel)
  const onStd = await stdOf(clip)
  await page.evaluate((sel) => {
    const p = document.querySelector(sel)
    p.dataset.probeBackup = p.style.cssText
    p.style.setProperty('backdrop-filter', 'none', 'important')
    p.style.setProperty('-webkit-backdrop-filter', 'none', 'important')
    p.style.setProperty('background', 'transparent', 'important')
  }, plateSel)
  await page.waitForTimeout(360)
  const offStd = await stdOf(clip)
  await page.evaluate((sel) => {
    const p = document.querySelector(sel)
    p.style.cssText = p.dataset.probeBackup || ''
    p.removeAttribute('data-probeBackup')
    document.getElementById('probeStripeBackdrop')?.remove()
    document.getElementById('probeRetentionCss')?.remove()
  }, plateSel)
  await page.waitForTimeout(300)
  const retention = offStd ? onStd / offStd : 1
  console.log(`  弹窗材质保留率 ${retention.toFixed(3)}（材质开 std ${onStd} / 关 std ${offStd}）`)
  check('弹窗材质真的糊住了身后页面（保留率 < 0.35）', retention < 0.35, `实测 ${retention.toFixed(3)}`)
}

await page.screenshot({ path: `${outDir}/02-settings-chromium.png` })

// ---- 拖动位移强度滑块，确认即时生效且不报错
await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('.glass-settings input[type=range]')]
  const target = inputs[0]
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  ).set
  setter.call(target, '20')
  target.dispatchEvent(new Event('input', { bubbles: true }))
  target.dispatchEvent(new Event('change', { bubbles: true }))
})
await page.waitForTimeout(400)
const afterDrag = await page.evaluate(() => ({
  stored: window.localStorage.getItem('quadrant-glass-v1'),
  filter: document.querySelector('.glass__warp')
    ? getComputedStyle(document.querySelector('.glass__warp')).filter
    : null
}))
const storedDs = JSON.parse(afterDrag.stored || '{}').displacementScale
check('拖动滑块即时写入持久化存储', storedDs === 20, `displacementScale=${storedDs}`)

// 复原默认，避免影响后续断言
await page.evaluate(() => {
  window.localStorage.setItem(
    'quadrant-glass-v1',
    JSON.stringify({ displacementScale: 118, blurAmount: 0.4, saturation: 140, aberrationIntensity: 3, elasticity: 0.1, cornerRadius: 32, mode: 'standard', forceEngine: 'auto' })
  )
})

// 关闭面板
await page.keyboard.press('Escape').catch(() => {})
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.glass-settings .modal-btn')].find((b) =>
    b.textContent.includes('完成')
  )
  btn?.click()
})
await page.waitForSelector('.glass-settings', { state: 'detached', timeout: 5000 }).catch(() => {})
await page.waitForTimeout(300)

// ---- 右键菜单几何
let menuReport = null
{
  const clickX = 120
  const clickY = 300
  const opened = await openMenuAt(page, clickX, clickY)
  if (opened) {
    menuReport = await page.evaluate(
      ([cx, cy]) => {
        const layer = document.querySelector('.gs-layer--menu')
        const panel = layer.querySelector('.glass, .gs-fallback')
        const r = panel.getBoundingClientRect()
        const rows = layer.querySelectorAll('.context-item').length
        const rowH = getComputedStyle(layer.querySelector('.context-item')).height
        return {
          clickX: cx,
          clickY: cy,
          left: Math.round(r.x * 10) / 10,
          top: Math.round(r.y * 10) / 10,
          w: Math.round(r.width),
          h: Math.round(r.height),
          rows,
          rowH
        }
      },
      [clickX, clickY]
    )
    console.log(
      `  指定指针点 (${menuReport.clickX},${menuReport.clickY})　菜单玻璃 左上(${menuReport.left},${menuReport.top}) ${menuReport.w}×${menuReport.h}　${menuReport.rows} 行·行高 ${menuReport.rowH}`
    )
    check(
      '菜单玻璃左上角落在指针点上（容差 2px）',
      Math.abs(menuReport.left - menuReport.clickX) <= 2 && Math.abs(menuReport.top - menuReport.clickY) <= 2,
      `偏差 x${(menuReport.left - menuReport.clickX).toFixed(1)} y${(menuReport.top - menuReport.clickY).toFixed(1)}`
    )
    const rowHNum = Number.parseFloat(menuReport.rowH)
    const expectH = menuReport.rows * rowHNum + 12
    check(
      '菜单玻璃高度 = 行数 × 实测行高 + 2 × 内边距',
      Math.abs(menuReport.h - expectH) <= 1,
      `实测 ${menuReport.h}，推算 ${expectH}（${menuReport.rows} 行 × ${rowHNum}px + 12）`
    )
    check(
      '手机端菜单行高为 48px（触摸目标）',
      rowHNum === 48,
      `实测 ${menuReport.rowH}`
    )
    check(
      '事件菜单行数 ≥ 5',
      menuReport.rows >= 5,
      `${menuReport.rows} 行（剪切/复制/粘贴/添加照片/删除/保存/详细信息）`
    )
    await page.screenshot({ path: `${outDir}/03-context-menu.png` })
  } else {
    check('在当前视图内找到事件块并打开菜单', false, '未找到 .event-card')
  }
}

writeFileSync(`${outDir}/scenario1.json`, JSON.stringify({ m, modal, afterDrag, menuReport, errors }, null, 2))

/* ------------------------------------------------------------------ 场景二 */
console.log('\n【场景二】强制降级引擎（模拟 iOS WebKit）')

const fallbackContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  hasTouch: true,
  isMobile: true
})
const fbPage = await fallbackContext.newPage()
const fbErrors = []
fbPage.on('pageerror', (e) => fbErrors.push(`pageerror: ${e.message}`))
fbPage.on('console', (msg) => {
  if (msg.type() === 'error') fbErrors.push(`console: ${msg.text()}`)
})

await fbPage.addInitScript(
  ([dk, dv, gk, gv]) => {
    window.localStorage.setItem(dk, dv)
    window.localStorage.setItem(gk, gv)
  },
  [
    DATA_KEY,
    JSON.stringify(seedData()),
    GLASS_KEY,
    JSON.stringify({ displacementScale: 118, blurAmount: 0.4, saturation: 140, aberrationIntensity: 3, elasticity: 0.1, cornerRadius: 32, mode: 'standard', forceEngine: 'fallback' })
  ]
)

await fbPage.goto(`${base}?page=quadrant&sidebar=1&strict=0`, { waitUntil: 'load' })
await fbPage.waitForSelector('.sidebar', { timeout: 20000 })
await fbPage.waitForSelector('.gs-fallback', { timeout: 20000 })
await fbPage.waitForTimeout(600)

const fb = await fbPage.evaluate(() => {
  const el = document.querySelector('.gs-fallback')
  const cs = getComputedStyle(el)
  const r = el.getBoundingClientRect()
  const sidebar = document.querySelector('.sidebar').getBoundingClientRect()
  const panel = document.querySelector('.gs-layer--dock .gs-fallback')
  const pr = panel ? panel.getBoundingClientRect() : null
  /*
   * 材质与染色已从 `.gs-fallback` 搬到 `.gs-plate`（材质板）——
   * 降级面的宿主是库根节点的 transform 子树，backdrop-filter 在那里会被抽干
   * （见 docs/probes/liquid-glass.md）。所以这里量材质板，不再量降级面。
   */
  const plate = document.querySelector('.gs-layer--dock .gs-plate')
  const pcs = plate ? getComputedStyle(plate) : null
  return {
    glassCount: document.querySelectorAll('.glass').length,
    fallbackCount: document.querySelectorAll('.gs-fallback').length,
    backdrop: pcs ? pcs.webkitBackdropFilter || pcs.backdropFilter : null,
    plateBg: pcs ? pcs.backgroundColor : null,
    faceBackdrop: cs.backdropFilter,
    radius: cs.borderRadius,
    engineAttr: document.querySelector('.gs-layer')?.dataset.glassEngine ?? '',
    dockPanel: pr
      ? {
          x: Math.round(pr.x * 10) / 10,
          y: Math.round(pr.y * 10) / 10,
          w: Math.round(pr.width * 10) / 10,
          h: Math.round(pr.height * 10) / 10
        }
      : null,
    sidebar: {
      x: Math.round(sidebar.x * 10) / 10,
      y: Math.round(sidebar.y * 10) / 10,
      w: Math.round(sidebar.width * 10) / 10,
      h: Math.round(sidebar.height * 10) / 10
    }
  }
})

check('降级引擎下不再渲染库的 .glass', fb.glassCount === 0, `仍有 ${fb.glassCount} 个 .glass`)
check('降级引擎渲染了 .gs-fallback', fb.fallbackCount > 0, `${fb.fallbackCount} 个`)
check(
  '降级材质带 -webkit-backdrop-filter（iOS 必需前缀）',
  typeof fb.backdrop === 'string' && fb.backdrop.includes('blur'),
  `${fb.backdrop}`
)
check(
  '降级档染色压在材质板上（降级面无自己的底色，避免叠两层）',
  typeof fb.plateBg === 'string' && fb.plateBg.startsWith('rgba(26, 29, 35'),
  `plate=${fb.plateBg} fallback=${fb.faceBackdrop}`
)
check('降级玻璃圆角来自设置（32px）', fb.radius === '32px', `${fb.radius}`)
{
  const d = fb.dockPanel
  const s = fb.sidebar
  const ok =
    d &&
    Math.abs(d.x - s.x) <= 1.5 &&
    Math.abs(d.y - s.y) <= 1.5 &&
    Math.abs(d.w - s.w) <= 1.5 &&
    Math.abs(d.h - s.h) <= 1.5
  check(
    '降级档 dock 玻璃同样与 .sidebar 重合',
    ok,
    d ? `侧栏 ${s.w}×${s.h}　降级玻璃 ${d.w}×${d.h}` : '未找到 dock 玻璃'
  )
}

// 打开设置面板，确认 Chromium 专属项被置灰
await fbPage.click('.appearance-button')
await fbPage.waitForSelector('.glass-settings', { timeout: 10000 })
await fbPage.waitForTimeout(500)
const fbModal = await fbPage.evaluate(() => ({
  engineTag: document.querySelector('.glass-engine-tag')?.textContent ?? '',
  total: document.querySelectorAll('.glass-settings input[type=range]').length,
  disabled: document.querySelectorAll('.glass-settings input[type=range]:disabled').length,
  modeDisabled: document.querySelectorAll('.glass-settings .glass-mode:disabled').length
}))
check(
  '降级引擎下 Chromium 专属滑块被置灰',
  fbModal.disabled === 3,
  `${fbModal.disabled}/${fbModal.total} 个滑块禁用（应为位移强度、色差、弹性 3 个）`
)
check('降级引擎下折射模式选项被置灰', fbModal.modeDisabled === 4, `${fbModal.modeDisabled}/4`)
console.log(`  引擎标签：「${fbModal.engineTag}」`)
await fbPage.screenshot({ path: `${outDir}/04-settings-fallback.png` })

/* ------------------------------------------------------------------ 场景三 */
console.log('\n【场景三】桌面视口 · 菜单行高应回到 34px')

const desktopContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: 'dark'
})
const dPage = await desktopContext.newPage()
const dErrors = []
dPage.on('pageerror', (e) => dErrors.push(`pageerror: ${e.message}`))
dPage.on('console', (m) => {
  if (m.type() === 'error') dErrors.push(`console: ${m.text()}`)
})
await dPage.addInitScript(
  ([k, v]) => window.localStorage.setItem(k, v),
  [DATA_KEY, JSON.stringify(seedData())]
)
await dPage.goto(`${base}?page=quadrant&sidebar=1&strict=0`, { waitUntil: 'load' })
await dPage.waitForSelector('.sidebar', { timeout: 20000 })
await dPage.waitForTimeout(700)

const dockHidden = await dPage.evaluate(() => {
  const layer = document.querySelector('.gs-layer--dock')
  return layer ? getComputedStyle(layer).display : 'missing'
})
check('桌面端 dock 玻璃层已隐藏', dockHidden === 'none', `display=${dockHidden}`)

const dOpened = await openMenuAt(dPage, 500, 400)
if (dOpened) {
  const dm = await dPage.evaluate(
    ([cx, cy]) => {
      const layer = document.querySelector('.gs-layer--menu')
      const panel = layer.querySelector('.glass, .gs-fallback')
      const r = panel.getBoundingClientRect()
      const rowH = getComputedStyle(layer.querySelector('.context-item')).height
      return {
        left: Math.round(r.x * 10) / 10,
        top: Math.round(r.y * 10) / 10,
        h: Math.round(r.height),
        rows: layer.querySelectorAll('.context-item').length,
        rowH,
        clickX: cx,
        clickY: cy
      }
    },
    [500, 400]
  )
  const dRowH = Number.parseFloat(dm.rowH)
  console.log(
    `  桌面菜单 左上(${dm.left},${dm.top}) 高 ${dm.h}　${dm.rows} 行·行高 ${dm.rowH}`
  )
  check('桌面端菜单行高为 34px', dRowH === 34, `实测 ${dm.rowH}`)
  check(
    '桌面端菜单左上角同样落在指针点上',
    Math.abs(dm.left - dm.clickX) <= 2 && Math.abs(dm.top - dm.clickY) <= 2,
    `偏差 x${(dm.left - dm.clickX).toFixed(1)} y${(dm.top - dm.clickY).toFixed(1)}`
  )
  await dPage.screenshot({ path: `${outDir}/05-desktop-menu.png` })
} else {
  check('桌面端能打开菜单', false, '未找到 .event-card')
}

/* ------------------------------------------------------------------ 场景四 */
console.log('\n【场景四】菜单可点性与目标卡底部抽屉')

/*
 * 这一节守的是一次**真实发生过的回归**，几何断言全绿也发现不了：
 *
 * 菜单玻璃化之后 `.context-menu` 这个类消失了，而 QuadrantPage 的
 * 「点菜单外收起」守卫还在查 `target.closest('.context-menu')` —— 守卫恒不命中，
 * 于是**在菜单项上按下指针也会立刻收起菜单**。click 要等 pointerup 才派发，
 * 那时元素已经卸载，"详细信息"永远点不开。
 *
 * 教训：菜单这类交互不能只验几何，必须真的点一下并检查**副作用**。
 */

// 先确保没有残留菜单（场景一留下了一个）
await page.mouse.click(320, 760)
await page.waitForTimeout(300)

const zReport = await (async () => {
  if (!(await openMenuAt(page, 120, 300))) return null
  return page.evaluate(() => {
    const layer = document.querySelector('.gs-layer--menu')
    const sidebar = document.querySelector('.sidebar')
    /*
     * 层级从定位层搬到了材质板（glass.css §一/§四：定位层上非 auto 的 z-index
     * 会让材质采不到背景，菜单的磨砂就是这么死的）。所以这里断言的元素也要跟着换：
     *   材质板 z  = 生效的层级（手机档 110）
     *   定位层 z  = **必须是 auto** —— 这条本身就是回归断言
     */
    const plate = layer.querySelector('.gs-plate')
    return {
      plateZ: plate ? Number(getComputedStyle(plate).zIndex) : NaN,
      layerZ: getComputedStyle(layer).zIndex,
      sidebarZ: Number(getComputedStyle(sidebar).zIndex),
      role: layer.querySelector('.gs-content')?.getAttribute('role') ?? ''
    }
  })
})()

if (zReport) {
  check(
    '手机端菜单层级压过底部 dock（否则被 dock 盖住点不到）',
    zReport.plateZ === 110 && zReport.plateZ > zReport.sidebarZ && zReport.layerZ === 'auto',
    `材质板 z=${zReport.plateZ}，dock 所在层 z=${zReport.sidebarZ}，` +
      `定位层 z=${zReport.layerZ}（必须是 auto：非 auto 会让材质采不到背景）`
  )
  check('菜单内容层带 role="menu"', zReport.role === 'menu', `role=${zReport.role || '(空)'}`)

  // 真的点一下：点「详细信息」的副作用是打开事件详情弹窗
  await page.locator('.gs-layer--menu .context-item', { hasText: '详细信息' }).first().click()
  await page.waitForTimeout(500)
  const afterClick = await page.evaluate(() => ({
    menuGone: !document.querySelector('.gs-layer--menu'),
    detailOpen: Boolean(document.querySelector('.modal-field')),
    itemRole: document.querySelector('.gs-layer--menu .context-item')?.getAttribute('role') ?? ''
  }))
  check(
    '点击菜单项确实触发了动作（事件详情弹窗打开）',
    afterClick.detailOpen,
    afterClick.detailOpen ? '已打开事件详情' : '未打开 —— 守卫可能又按类名失配'
  )
  check('点击后菜单自身收起', afterClick.menuGone, afterClick.menuGone ? '已卸载' : '仍在文档中')

  // 关掉详情弹窗：直接对遮罩派发 click，绕开"点哪儿"的不确定性
  await page.evaluate(() => {
    document.querySelector('.modal-mask')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await page.waitForTimeout(400)
} else {
  check('手机端能打开菜单', false, '未找到 .event-card')
}

// ---- 目标页：窄屏「贴底抽屉」菜单的几何
await page.goto(`${base}?page=goals&sidebar=1&strict=0`, { waitUntil: 'load' })
await page.waitForSelector('.goal-more', { timeout: 20000 })
await page.waitForTimeout(700)

const moreVisible = await page.locator('.goal-more').first().isVisible()
if (moreVisible) {
  await page.locator('.goal-more').first().click()
  await page.waitForSelector('.gs-layer--menu', { timeout: 8000 })
  await page.waitForTimeout(350)

  const sheet = await page.evaluate(() => {
    const layer = document.querySelector('.gs-layer--menu')
    const panel = layer.querySelector('.glass, .gs-fallback')
    const r = panel.getBoundingClientRect()
    const item = layer.querySelector('.context-item')
    return {
      x: Math.round(r.x * 10) / 10,
      right: Math.round(r.right * 10) / 10,
      bottom: Math.round(r.bottom * 10) / 10,
      h: Math.round(r.height * 10) / 10,
      cx: Math.round((r.x + r.width / 2) * 10) / 10,
      rows: layer.querySelectorAll('.context-item').length,
      rowH: Number.parseFloat(getComputedStyle(item).height),
      navH: Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--mobile-nav-height')
      ),
      vw: window.innerWidth,
      vh: window.innerHeight
    }
  })

  const expectBottom = sheet.vh - 12 - sheet.navH
  /*
   * 内边距取 glassMenu 的 MENU_PAD(6) × 2 = 12，与另两处菜单同源。
   * 改动前 `.context-menu` 手机档用的是 8px（= 16），抽屉玻璃化后统一到
   * MENU_PAD —— 面板外宽仍是 `100vw − 24`，只是内衬略紧 4px。
   */
  const expectH = sheet.rows * sheet.rowH + 12
  console.log(
    `  抽屉玻璃 x=${sheet.x} right=${sheet.right} bottom=${sheet.bottom} ${sheet.rows} 行 × ${sheet.rowH}px = 高 ${sheet.h}`
  )
  check(
    '抽屉与视口左右各留 12px',
    Math.abs(sheet.x - 12) <= 1.5 && Math.abs(sheet.right - (sheet.vw - 12)) <= 1.5,
    `左 ${sheet.x}（应 12）右 ${sheet.right}（应 ${sheet.vw - 12}）`
  )
  check(
    '抽屉底边 = 视口底 − 12 − 导航条高',
    Math.abs(sheet.bottom - expectBottom) <= 1.5,
    `实测 ${sheet.bottom}，应 ${expectBottom}（视口 ${sheet.vh} − 12 − ${sheet.navH}）`
  )
  check(
    '抽屉高 = 行数 × 行高 + 2 × 内边距',
    Math.abs(sheet.h - expectH) <= 2,
    `实测 ${sheet.h}，推算 ${expectH}`
  )
  check('抽屉水平居中于视口', Math.abs(sheet.cx - sheet.vw / 2) <= 1.5, `中心 x=${sheet.cx}`)

  // 同样验一次可点性：点「详细信息」应打开目标详情
  await page.locator('.gs-layer--menu .context-item', { hasText: '详细信息' }).first().click()
  await page.waitForTimeout(500)
  const goalDetail = await page.evaluate(() => ({
    open: Boolean(document.querySelector('.goal-detail-title')),
    menuGone: !document.querySelector('.gs-layer--menu')
  }))
  check(
    '目标抽屉菜单项可点（目标详情弹窗打开）',
    goalDetail.open,
    goalDetail.open ? '已打开目标详情' : '未打开'
  )
  await page.screenshot({ path: `${outDir}/06-goals-sheet.png` })
} else {
  check('窄屏下目标卡的「…」按钮可见', false, '未找到可见的 .goal-more')
}

/* ------------------------------------------------------------------ 汇总 */
console.log('\n【错误收集】')
const allErrors = [...errors, ...fbErrors, ...dErrors].filter(
  // 探针页在无网络时可能报 favicon 之类，这里只关心应用自身
  (e) => !/favicon|ERR_FILE_NOT_FOUND.*photos/i.test(e)
)
if (allErrors.length) {
  allErrors.slice(0, 8).forEach((e) => console.log(`  ⚠ ${e}`))
} else {
  console.log('  无 pageerror / console error')
}
check('运行时无错误', allErrors.length === 0, `${allErrors.length} 条`)

await browser.close()

const passed = results.filter((r) => r.pass).length
console.log(`\n结论：${passed}/${results.length} 项通过`)
writeFileSync(
  `${outDir}/summary.json`,
  JSON.stringify({ results, allErrors, passed, total: results.length }, null, 2)
)
console.log(`截图与数据已写入 ${outDir}/`)
if (passed !== results.length) process.exit(1)
