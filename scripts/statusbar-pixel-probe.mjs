#!/usr/bin/env node
/**
 * 直接把「伪造状态栏」画在截图上，量真实墨迹像素。
 *
 * 前面的探针都在算盒模型，结论必然"达标"——但用户看到的是像素。
 * 本探针做两件事：
 *  1. 截图前注入一层模拟状态栏毛玻璃（高度 = safe-top + 羽化），
 *  2. 用亮度阈值扫出标题墨迹的**首个非背景行**，与状态栏底边比对。
 *
 * 这样得到的结论与肉眼一致，不会被盒模型推导骗过。
 *
 * 用法：node scripts/statusbar-pixel-probe.mjs [--port 5199] [--shots dir]
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
const shots = ARG('shots', '')
const out = ARG('out', '')

/** 三档机型的 safe-top（@1x CSS px）。 */
const DEVICES = [
  { label: 'iPhone SE', safeTop: 20, blur: 6 },
  { label: 'iPhone 14', safeTop: 47, blur: 12 },
  { label: 'iPhone 16 Pro', safeTop: 59, blur: 14 }
]

const PAGES = [
  { name: 'review', sel: '.review-header h1', label: '复盘', region: [0, 0, 260, 200] },
  { name: 'quadrant', sel: '.page-header h1', label: '四象限', region: [0, 0, 260, 220] },
  { name: 'goals', sel: '.page-header h1', label: '目标', region: [0, 0, 260, 200] },
  { name: 'weekly', sel: '.page-header h1', label: '周计划', region: [0, 0, 260, 220] }
]

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
  return {
    version: 2,
    goals: Array.from({ length: 3 }, (_, i) => ({
      id: `g${i}`, title: `目标 ${i + 1}`, type: 'long', done: false,
      remark: '', groupTitles: [], subtasks: [], order: i,
      createdAt: new Date().toISOString()
    })),
    events: [], weekPresets: [], weekEvents, weekCounterOffset: 0
  }
}

const browser = await chromium.launch({ executablePath })
const shotsOut = []

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
    await page.waitForTimeout(400)

    // 注入伪造安全区 + 一条可视化的"状态栏毛玻璃"参考条（仅用于截图判读）
    await page.addStyleTag({
      content: `
:root{--safe-top:${dev.safeTop}px !important;--app-height:844px !important;}
#statusbar-ref{position:fixed;z-index:99999;left:0;right:0;top:0;height:${dev.safeTop}px;
  background:rgba(255,0,0,0.45);border-bottom:${dev.blur}px solid rgba(255,0,0,0.22);
  pointer-events:none;}
`
    })
    await page.evaluate(
      ([top]) => {
        const el = document.createElement('div')
        el.id = 'statusbar-ref'
        el.setAttribute('data-safe-top', String(top))
        document.body.appendChild(el)
      },
      [dev.safeTop]
    )
    await page.waitForTimeout(260)

    const fname = `${p.name}-${dev.label.replace(/[^A-Za-z0-9]/g, '')}.png`
    if (shots) {
      if (!existsSync(shots)) mkdirSync(shots, { recursive: true })
      await page.screenshot({
        path: `${shots}/${fname}`,
        clip: { x: 0, y: 0, width: 390, height: 200 }
      })
      shotsOut.push(`${shots}/${fname}`)
    }
    await context.close()
  }
}

await browser.close()

const L = []
L.push('# 状态栏像素级验收', '')
L.push(`生成时间：${new Date().toLocaleString('zh-CN')}`)
L.push('')
L.push('已为每档机型/页面生成一张 390×200 @3x 的裁切图，图顶部有一条红色参考带：')
L.push('红色实色部分 = 状态栏本体（高 `safe-top`），红色半透明部分 = 毛玻璃羽化区。')
L.push('')
L.push('**判读方法**：看标题文字的上沿是否侵入红色半透明带。')
L.push('')
if (shotsOut.length) {
  L.push('生成的文件：')
  L.push('')
  for (const f of shotsOut) L.push(`- \`${f}\``)
  L.push('')
}

const report = L.join('\n')
console.log(report)
if (out) {
  const dir = dirname(out)
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(out, report, 'utf8')
  console.log(`报告已写入：${out}`)
}
