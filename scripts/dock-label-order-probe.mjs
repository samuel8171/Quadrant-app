#!/usr/bin/env node
/**
 * R3-F2 守门：dock 导航文字不被材质板压住 **且** 材质仍糊。
 * 直接量**真实源码**（无 CSS 注入），两档各跑。
 *   判据① 文字：|Δ 笔画对比度(材质开−关)| < 0.2
 *   判据② 材质：趋势线 FWHM(材质开) > 8（不糊时 ≈ stroke-width×DPR = 4）
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].filter(Boolean)
const executablePath = CANDIDATES.find((p) => existsSync(p))
if (!executablePath) { console.error('no browser'); process.exit(2) }

const port = '5199'
const outDir = 'docs/probes/dock-labels'
const p2 = (n) => String(n).padStart(2, '0')
const dayKey = (i) => { const d = new Date(Date.now() - i * 86400000); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` }
mkdirSync(outDir, { recursive: true })

const MONEY = {
  enabled: true, enabledAt: dayKey(8),
  config: {
    weeklyTC: 560, dailyCapTC: 80, tcPerHour: 10, nightStartMin: 1410, nightEndMin: 360,
    nightMultiplier: 1.5, minCapRatio: 0.2, weeklyLT: 20, rewardLT: 0.5, penaltyLT: 0.5,
    missPenaltyLT: 1, videoLTPerHour: 1, gameLTPerHour: 1.5, restDayFactor: 0.8,
    abandonedDayTC: 80, latePhoneTC: 40, latePhoneLT: 2,
    quadrantMultiplier: { q1: 1.5, q2: 1.0, q3: 1.2, q4: 0.5 }
  },
  days: [], weeks: []
}
const seed = { version: 2, goals: [], events: [], weekPresets: [], weekEvents: [], weekCounterOffset: 0, money: MONEY }

/** 判据② 的阈值 */
const FWHM_MIN = 8
/** 判据① 的阈值 */
const DELTA_MAX = 0.2

const browser = await chromium.launch({ executablePath, headless: true })
let failed = 0
const rows = []

for (const engine of ['fallback', 'chromium']) {
  const r = {}
  for (const on of [true, false]) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
      colorScheme: 'dark', hasTouch: true, isMobile: true
    })
    const page = await ctx.newPage()
    await page.addInitScript(
      ([d, g, k1, k2]) => { localStorage.setItem(k1, JSON.stringify(d)); localStorage.setItem(k2, g) },
      [seed, JSON.stringify({
        displacementScale: on ? 118 : 0, blurAmount: on ? 0.4 : 0, saturation: on ? 140 : 100,
        aberrationIntensity: on ? 3 : 0, elasticity: 0.1, cornerRadius: 32, mode: 'standard', forceEngine: engine
      }), 'quadrant-web-data-v2', 'quadrant-glass-v1']
    )
    await page.goto(`http://127.0.0.1:${port}/probe.html?page=mine&sidebar=1`, { waitUntil: 'load' })
    await page.waitForTimeout(2400)

    const tcBox = await page.evaluate(() => {
      const it = document.querySelector('.nav .nav-item').getBoundingClientRect()
      return { x: Math.round(it.x + 4), y: Math.round(it.y + 34), width: Math.round(it.width - 8), height: 16 }
    })
    const tcB64 = (await page.screenshot({ clip: tcBox })).toString('base64')
    const tc = await page.evaluate(async (b) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b; await img.decode()
      const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext('2d'); g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height).data; const lum = []
      for (let i = 0; i < d.length; i += 4) lum.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])
      lum.sort((a, b2) => a - b2); const q = (p) => lum[Math.round(p * (lum.length - 1))]
      const hi = q(0.97), lo = q(0.03)
      return +((Math.max(hi, lo) + 5) / (Math.min(hi, lo) + 5)).toFixed(2)
    }, tcB64)

    const fullB64 = (await page.screenshot()).toString('base64')
    const f = await page.evaluate(async (b) => {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b)).blob())
      const g = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d'); g.drawImage(bmp, 0, 0)
      const col = g.getImageData(Math.round(bmp.width / 2), 0, 1, bmp.height).data
      const sig = []; let best = -1e9, bestY = 0
      for (let y = 0; y < bmp.height; y++) { const v = col[y * 4 + 2] - col[y * 4]; sig.push(v); if (v > best) { best = v; bestY = y } }
      const half = best / 2; let up = bestY, dn = bestY
      while (up > 0 && sig[up] > half) up--
      while (dn < bmp.height - 1 && sig[dn] > half) dn++
      return { peak: +best.toFixed(1), y: bestY, fwhm: dn - up }
    }, fullB64)

    r[on ? 'on' : 'off'] = { tc, f }
    writeFileSync(`${outDir}/${engine}-${on ? 'material-on' : 'material-off'}.png`,
      await page.screenshot({ clip: { x: 0, y: 750, width: 390, height: 94 } }))
    await ctx.close()
  }
  const dTc = +(r.on.tc - r.off.tc).toFixed(2)
  const textOk = Math.abs(dTc) < DELTA_MAX
  const blurOk = r.on.f.fwhm > FWHM_MIN
  if (!textOk || !blurOk) failed++
  rows.push({ engine, tcOn: r.on.tc, tcOff: r.off.tc, dTc, fwhm: r.on.f.fwhm, peak: r.on.f.peak, textOk, blurOk })
  console.log(`\n=== ${engine} ===`)
  console.log(`  ①文字 开 ${r.on.tc} / 关 ${r.off.tc}  Δ=${dTc}  ${textOk ? '✅' : '❌ 被压'}`)
  console.log(`  ②材质 FWHM ${r.on.f.fwhm}  峰值 ${r.on.f.peak}  ${blurOk ? '✅ 糊了' : '❌ 没糊'}`)
}

console.log(`\n档位       | 文字Δ    | FWHM | 判`)
console.log(`-----------+----------+------+------`)
for (const x of rows) {
  console.log(`${x.engine.padEnd(10)} | ${String(x.dTc).padStart(8)} | ${String(x.fwhm).padStart(4)} | ${x.textOk && x.blurOk ? '✅' : '❌'}`)
}
console.log(failed === 0 ? '\n全部通过' : `\n${failed} 档失败`)

const md = [
  '# dock 导航文字 vs 材质板的图层顺序（R3-F2）',
  '',
  `生成时间：${new Date().toLocaleString('zh-CN')}`,
  '',
  '**背景**：R3-F 为修「趋势图荧光条没被糊」给材质板提级到 `z-index: 103`，',
  '结果压过了 `.sidebar`(z:100) 里的导航文字（用户报"底栏遮罩挡住底栏文字"）。',
  '现行修法把**保底底搬进玻璃层**（`.gs-dock-floor`，材质板之前），`.sidebar` 底色置透明，',
  '三层：底 z:0 → 板 z:50 → `.sidebar` z:100。',
  '',
  '**判据**（两条都要过）：',
  '',
  '1. **文字未被压**：`|Δ 笔画对比度(材质开 − 材质关)| < 0.2`。板压在文字上时，',
  '   开态被玻璃糊掉 ⇒ 比值显著下降（实测 −1.10）。',
  '2. **材质仍糊**：趋势线 `FWHM(材质开) > 8` 设备像素。不糊时 ≈ `stroke-width × DPR` = **4**，',
  '   糊过时 **12~133**。',
  '',
  '| 档位 | 文字(开) | 文字(关) | Δ | FWHM | 峰值 | 判 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((x) =>
    `| ${x.engine} | ${x.tcOn} | ${x.tcOff} | ${x.dTc} | ${x.fwhm} | ${x.peak} | ${x.textOk && x.blurOk ? '✅' : '❌'} |`
  ),
  '',
  `**结论**：${failed === 0 ? '两档均通过（文字未被压 + 材质仍糊）' : `${failed} 档失败`}`,
  '',
  '截图见本目录 `{engine}-material-{on,off}.png`（dock 区域，左=材质开、右=材质关）。',
  '',
  '复跑：`node scripts/dock-label-order-probe.mjs`（前置：vite 探针服务跑在 5199）。',
  ''
].join('\n')
writeFileSync(`${outDir}/report.md`, md, 'utf8')
console.log(`报告已写入 ${outDir}/report.md`)

await browser.close()
process.exit(failed === 0 ? 0 : 1)
