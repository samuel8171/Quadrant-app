#!/usr/bin/env node
/**
 * 玻璃材质的**像素级验收**：材质到底画出来了没有。
 *
 * 为什么需要它：上一轮的报告说「33/33 通过」，而真实情况是全部弹窗透明。
 * 那批断言查的全是「节点在不在、类名对不对、计算值等不等于」，**没有一条
 * 去量"屏幕上有没有东西"**。这个脚本只判一件事：同一块玻璃，
 * 把材质关掉（backdrop-filter: none + 背景透明）前后，像素差多少。
 *
 *   差 ≈ 0   → 材质是空心的（就是"弹窗全透明"那个故障）
 *   差 很大  → 材质真的画出来了
 * 再配一个 grad（区域内平均梯度）看有没有真的糊化：折射/磨砂生效时它必然下降。
 *
 * 覆盖四处真实宿主（都是在真实页面上操作出来的，不是探针页拼的假结构）：
 *   弹窗 / 右键菜单 / 手机端底部 dock / 降级引擎下的弹窗
 * 外加一条**动画期检查**：材质板的入场动画期间材质必须仍然可见。
 * 做法是把动画暂停在固定进度（`animation-delay` 负值 + `play-state: paused`），
 * 这样"材质开"与"材质关"两帧的动画状态逐帧一致，差值是纯净的。
 * 材质一旦被放到"带 transform 的祖先"下面，动画期间就会被抽干，这条会立刻红。
 *
 * 用法：
 *   node scripts/glass-material-probe.mjs --out tmp/glassMaterial
 *   "C:/Users/Samuel/AppData/Local/Programs/Python/Python313/python.exe" \
 *     scripts/glass-material-judge.py tmp/glassMaterial
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
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean)
const executablePath = CANDIDATES.find((p) => existsSync(p))
if (!executablePath) {
  console.error('找不到可用的 Edge/Chromium 可执行文件（可用 UI_PROBE_BROWSER 指定）')
  process.exit(2)
}

const port = ARG('port', '5199')
const outDir = ARG('out', 'tmp/glassMaterial')
const base = `http://127.0.0.1:${port}/probe.html`
mkdirSync(outDir, { recursive: true })

const iso = (i) => new Date(Date.now() - i * 3600_000).toISOString()
const mondayKey = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const seed = {
  version: 2,
  goals: [],
  events: Array.from({ length: 7 }, (_, i) => ({
    id: `q${i}`,
    text: `象限任务 ${i + 1}`,
    remark: '备注文本',
    quadrant: (i % 4) + 1,
    x: 40 + (i % 3) * 170,
    y: 40 + Math.floor(i / 3) * 110,
    width: 150,
    createdAt: iso(i)
  })),
  weekPresets: [],
  weekEvents: [
    {
      id: 'w0',
      title: '高等数学',
      quadrant: 1,
      date: mondayKey(),
      startMin: 540,
      endMin: 630,
      color: '#4da3ff',
      remark: '',
      showInQuadrant: false,
      createdAt: iso(0)
    }
  ],
  weekCounterOffset: 0
}

const cases = []
const notes = []
const wiring = []

/* 材质关：只动材质板自己的这两条属性，其余一律不碰 */
const materialOff = (sel = '.gs-plate') => `
  ${sel} { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; background: transparent !important; }
`
const MATERIAL_OFF = materialOff()
/* 动画冻结在固定进度：负 delay 跳到中点，paused 定住 */
const ANIM_FROZEN = `
  @keyframes probePop { 0% { opacity: 0.78; transform: scale(0.92); } 100% { opacity: 0.78; transform: scale(1); } }
  .gs-plate { animation: probePop 3s linear infinite !important; animation-delay: -1.5s !important; animation-play-state: paused !important; }
`

const setCss = (text) => {
  document.querySelectorAll('style.__probe').forEach((el) => el.remove())
  if (!text) return
  const s = document.createElement('style')
  s.className = '__probe'
  s.textContent = text
  document.head.appendChild(s)
}

const SAMPLE = (sel) => {
  const plate = document.querySelector(sel)
  if (!plate) return null
  const anchor = plate.closest('.gs-anchor')
  const layer = plate.closest('.gs-layer')
  // 可见面在动画包装层里，是材质板的**兄弟**（不是子节点）
  const face =
    anchor.querySelector('.glass') ?? anchor.querySelector('.gs-panel, .gs-fallback')
  const root = anchor.querySelector('.gs-panel, .gs-fallback')
  const pcs = getComputedStyle(plate)
  /* 库面板（含文字）必须不带 filter —— 位移只允许发生在空空的材质板上 */
  const panelEl = anchor.querySelector('.gs-panel, .gs-fallback')
  const r = (el) => {
    const b = el.getBoundingClientRect()
    return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }
  }
  return {
    plate: r(plate),
    face: face ? r(face) : null,
    rootBox: root ? r(root) : null,
    anchor: anchor ? r(anchor) : null,
    plateSizeVar: `${pcs.getPropertyValue('--gs-panel-w').trim()} x ${pcs.getPropertyValue('--gs-panel-h').trim()}`,
    backdropFilter: pcs.backdropFilter,
    elementFilter: pcs.filter,
    panelFilter: panelEl ? getComputedStyle(panelEl).filter : null,
    plateChildren: plate.children.length,
    background: pcs.backgroundColor,
    borderRadius: pcs.borderRadius,
    plateTransform: pcs.transform,
    engine: layer?.dataset.glassEngine ?? '',
    hasRefractClass: plate.classList.contains('gs-refract'),
    hasPopClass: plate.classList.contains('gs-pop-in') || plate.classList.contains('gs-pop-out'),
    anchorTransform: anchor ? getComputedStyle(anchor).transform : null,
    /*
     * 定位层自己的 position / z-index —— 2026-09-24 新增，必查项。
     *
     * Chromium 里 backdrop-filter 只采「最近的 backdrop root」以内的内容，而
     * **带 position: fixed 或 z-index 的祖先就是那个边界**：材质板在层里面时，
     * 身后页面在层外面 ⇒ 采不到 ⇒ 材质整体失效（后面只剩染色）。
     * 单变量实测（系统级抓屏）：
     *   .gs-layer{position:fixed}    身后条纹 std 78.4（锐利＝没采到）
     *   .gs-layer{position:absolute} 身后条纹 std  3.5（糊平＝正常）
     * 所以这里必须把层自己的这两个值记下来，判定脚本据此把关。
     */
    layerPosition: layer ? getComputedStyle(layer).position : null,
    layerZIndex: layer ? getComputedStyle(layer).zIndex : null,
    layerClass: layer ? layer.className : null
  }
}

async function newPage({ width, height, glass }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    isMobile: false
  })
  const page = await context.newPage()
  await page.addInitScript(
    ([k, v, g]) => {
      window.localStorage.setItem(k, v)
      if (g) window.localStorage.setItem('quadrant-glass-v1', g)
    },
    ['quadrant-web-data-v2', JSON.stringify(seed), glass ? JSON.stringify(glass) : '']
  )
  await page.goto(`${base}?page=quadrant&sidebar=1&strict=0`, { waitUntil: 'load' })
  await page.waitForSelector('.event-card', { state: 'attached', timeout: 20000 })
  await page.waitForTimeout(600)
  return { context, page }
}

async function openMenu(page) {
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
  await page.waitForSelector('.gs-layer--menu .gs-plate', { timeout: 8000 })
  await page.waitForTimeout(340)
}

async function openDialog(page) {
  await openMenu(page)
  await page.locator('.gs-layer--menu .context-item', { hasText: '删除' }).first().click()
  await page.waitForSelector('.gs-layer--dialog .gs-plate', { timeout: 8000 })
  await page.waitForTimeout(430)
}

async function shoot(page, name, extraCss = '') {
  await page.evaluate(setCss, extraCss)
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${outDir}/${name}.png` })
  await page.evaluate(setCss, '')
  return `${name}.png`
}

const printSample = (tag, info) => {
  console.log(`${tag}`)
  console.log(`    plate  ${JSON.stringify(info.plate)}   尺寸变量=${info.plateSizeVar}`)
  console.log(`    face   ${JSON.stringify(info.face)}`)
  console.log(`    root   ${JSON.stringify(info.rootBox)}`)
  console.log(`    anchor ${JSON.stringify(info.anchor)}  transform=${info.anchorTransform}`)
  console.log(`    backdrop-filter = ${info.backdropFilter}`)
  console.log(`    材质板 filter = ${info.elementFilter}（折射挂这里；只允许是 url(#库滤镜) 或 none）`)
  console.log(`    库面板 filter = ${info.panelFilter}（必须 none：文字与按钮不能被位移）`)
  console.log(`    材质板子节点 = ${info.plateChildren}（必须 0：空盒子才没有内容可糊）`)
  console.log(`    background = ${info.background}  radius=${info.borderRadius}`)
  console.log(`    引擎=${info.engine}  gs-refract=${info.hasRefractClass}  pop=${info.hasPopClass}`)
}

const browser = await chromium.launch({ executablePath, headless: true })

/* ---------------- 一、弹窗（Chromium 档） ---------------- */
{
  const { context, page } = await newPage({ width: 1280, height: 800 })
  await openDialog(page)

  const info = await page.evaluate(SAMPLE, '.gs-layer--dialog .gs-plate')
  printSample('· 弹窗材质板（打开后 430ms）：', info)
  // 再等一会儿看尺寸会不会收敛（ResizeObserver 是否跟上了后续布局变化）
  await page.waitForTimeout(1200)
  const later = await page.evaluate(SAMPLE, '.gs-layer--dialog .gs-plate')
  if (JSON.stringify(later.plate) !== JSON.stringify(info.plate)) {
    console.log(`    ↳ 1.6s 后复测：plate ${JSON.stringify(later.plate)} 尺寸变量=${later.plateSizeVar}`)
  } else {
    console.log('    ↳ 1.6s 后复测：尺寸已稳定')
  }

  const on = await shoot(page, 'A1-dialog-material-on')
  const off = await shoot(page, 'A2-dialog-material-off', MATERIAL_OFF)
  // 动画冻结在固定进度：两帧动画状态一致，差值纯净
  const midOn = await shoot(page, 'A3-dialog-anim-on', ANIM_FROZEN)
  const midOff = await shoot(page, 'A4-dialog-anim-off', `${ANIM_FROZEN}${MATERIAL_OFF}`)
  const midInfo = await page.evaluate(SAMPLE, '.gs-layer--dialog .gs-plate')
  console.log(`    动画冻结后 plate.transform=${midInfo.plateTransform}`)

  cases.push(
    { name: on, ref: off, box: info.plate, label: '弹窗 · 材质开 vs 关' },
    { name: midOn, ref: midOff, box: info.plate, label: '弹窗 · 入场动画中期（冻结）' }
  )
  notes.push(
    `弹窗几何：plate ${JSON.stringify(info.plate)} / face ${JSON.stringify(info.face)} / root ${JSON.stringify(info.rootBox)}`
  )
  writeFileSync(`${outDir}/dialog.json`, JSON.stringify(info, null, 2))
  await context.close()
}

/* ---------------- 二、右键菜单 ---------------- */
{
  const { context, page } = await newPage({ width: 1280, height: 800 })
  await openMenu(page)
  const info = await page.evaluate(SAMPLE, '.gs-layer--menu .gs-plate')
  printSample('\n· 菜单材质板：', info)
  const on = await shoot(page, 'B1-menu-material-on')
  const off = await shoot(page, 'B2-menu-material-off', MATERIAL_OFF)
  cases.push({ name: on, ref: off, box: info.plate, label: '菜单 · 材质开 vs 关' })
  notes.push(`菜单几何：plate ${JSON.stringify(info.plate)} / face ${JSON.stringify(info.face)}`)
  writeFileSync(`${outDir}/menu.json`, JSON.stringify(info, null, 2))
  await context.close()
}

/* ---------------- 三、手机端 dock ---------------- */
{
  const { context, page } = await newPage({ width: 390, height: 844 })
  await page.waitForSelector('.gs-layer--dock .gs-plate', { timeout: 8000 })
  await page.waitForTimeout(430)
  const info = await page.evaluate(SAMPLE, '.gs-layer--dock .gs-plate')
  printSample('\n· dock 材质板：', info)
  const on = await shoot(page, 'C1-dock-material-on')
  const off = await shoot(page, 'C2-dock-material-off', MATERIAL_OFF)
  cases.push({ name: on, ref: off, box: info.plate, label: '手机 dock · 材质开 vs 关' })
  notes.push(`dock 几何：plate ${JSON.stringify(info.plate)} / face ${JSON.stringify(info.face)}`)
  writeFileSync(`${outDir}/dock.json`, JSON.stringify(info, null, 2))
  await context.close()
}

/* ---------------- 四、降级引擎 ---------------- */
{
  const { context, page } = await newPage({
    width: 390,
    height: 844,
    glass: { forceEngine: 'fallback' }
  })
  await openDialog(page)
  const info = await page.evaluate(SAMPLE, '.gs-layer--dialog .gs-plate')
  printSample('\n· 降级档材质板：', info)
  const on = await shoot(page, 'D1-fallback-dialog-on')
  const off = await shoot(page, 'D2-fallback-dialog-off', MATERIAL_OFF)
  cases.push({ name: on, ref: off, box: info.plate, label: '降级档弹窗 · 材质开 vs 关' })
  writeFileSync(`${outDir}/fallback.json`, JSON.stringify(info, null, 2))
  await context.close()
}

/* ---------------- 五、设置面板（内含嵌套的折射预览条） ---------------- */
{
  const { context, page } = await newPage({ width: 1280, height: 900 })
  await page.locator('.nav-item.appearance-button').click()
  await page.waitForSelector('.gs-layer--dialog .glass-settings', { timeout: 8000 })
  await page.waitForTimeout(520)

  const info = await page.evaluate(SAMPLE, '.gs-layer--dialog .gs-plate')
  printSample('\n· 设置面板材质板：', info)
  const on = await shoot(page, 'E1-settings-material-on')
  const off = await shoot(page, 'E2-settings-material-off', MATERIAL_OFF)
  cases.push({ name: on, ref: off, box: info.plate, label: '设置面板 · 材质开 vs 关' })
  writeFileSync(`${outDir}/settings.json`, JSON.stringify(info, null, 2))

  /*
   * 预览条是**嵌在设置面板内部**的另一块玻璃：它的锚点祖先里有库根节点的
   * transform，所以它的材质板采不到页面，只能采到设置面板自己画的内容 ——
   * 而预览条要看的正是那块高频条纹底，所以嵌套反而成立。
   * 单独量，只关它自己的材质，避免与设置面板的材质混在一起。
   */
  const pv = await page.evaluate(SAMPLE, '.gs-layer--preview .gs-plate')
  if (pv) {
    printSample('· 折射预览条材质板（嵌套在设置面板内部）：', pv)
    const pvOn = await shoot(page, 'E3-preview-material-on')
    const pvOff = await shoot(
      page,
      'E4-preview-material-off',
      materialOff('.gs-layer--preview .gs-plate')
    )
    cases.push({ name: pvOn, ref: pvOff, box: pv.plate, label: '折射预览条 · 材质开 vs 关' })
    writeFileSync(`${outDir}/preview.json`, JSON.stringify(pv, null, 2))
  } else {
    console.log('  ⚠ 没找到预览条的材质板（.gs-layer--preview .gs-plate）')
    notes.push('⚠ 预览条材质板缺失')
  }

  /* 设置要真的接得上：拖「模糊量」滑块，看材质板的 backdrop-filter 有没有跟着变 */
  const wired = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.glass-row input[type=range]')]
    const el = rows[1]
    if (!el) return { ok: false, why: '找不到模糊量滑块' }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, '0.8')
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return { ok: true }
  })
  await page.waitForTimeout(260)
  const after = await page.evaluate(() => ({
    cssVar: getComputedStyle(document.documentElement).getPropertyValue('--gs-blur').trim(),
    plateBdf: getComputedStyle(document.querySelector('.gs-layer--dialog .gs-plate')).backdropFilter
  }))
  console.log(`\n· 滑块联动：${wired.ok ? '' : wired.why}`)
  console.log(`    --gs-blur = ${after.cssVar}（期望 29.6px = 4 + 0.8 × 32）`)
  console.log(`    材质板 backdrop-filter = ${after.plateBdf}`)
  wiring.push({ varOk: after.cssVar === '29.6px', bdfOk: after.plateBdf.includes('29.6px') })
  await context.close()
}

/* ---------------- 六、事件表单弹窗（内容高、正文可滚） ---------------- */
{
  const { context, page } = await newPage({ width: 1280, height: 900 })
  await openMenu(page)
  await page.locator('.gs-layer--menu .context-item', { hasText: '详细信息' }).first().click()
  await page.waitForSelector('.gs-layer--dialog .gs-plate', { timeout: 8000 })
  await page.waitForTimeout(520)
  const info = await page.evaluate(SAMPLE, '.gs-layer--dialog .gs-plate')
  printSample('\n· 事件表单弹窗材质板：', info)
  const on = await shoot(page, 'F1-form-material-on')
  const off = await shoot(page, 'F2-form-material-off', MATERIAL_OFF)
  cases.push({ name: on, ref: off, box: info.plate, label: '事件表单 · 材质开 vs 关' })
  writeFileSync(`${outDir}/form.json`, JSON.stringify(info, null, 2))
  await context.close()
}

writeFileSync(`${outDir}/cases.json`, JSON.stringify({ cases, notes, wiring }, null, 2))
await browser.close()
console.log(`\n截图 → ${outDir}/  （${cases.length} 组对照）`)
console.log('判读：scripts/glass-material-judge.py')
