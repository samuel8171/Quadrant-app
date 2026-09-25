#!/usr/bin/env node
/**
 * 错误边界的自检：**故意制造一次渲染崩溃，确认恢复界面真的出现**。
 *
 * 为什么需要：错误边界只在出事故时才生效，平时没有任何机会被执行。
 * 2026-09-24 那次「桌面端打开无画面」就是因为它不存在 ——
 * 库在 effect 里抛的 `IndexSizeError` 无人接住，React 卸载整棵树，窗口只剩底色。
 * 补上边界之后，如果只写不验，"它到底接不接得住"就还是个假设。
 *
 * 做法：探测页支持 `?crash=1`，会在树里抛一个错误。本脚本加载该地址，判定
 *   ① 恢复界面出现（而不是空白）② 两个出口按钮都在 ③ 有 pageerror 被记录
 * 并留一张截图供目视。
 *
 * 用法：
 *   ./node_modules/.bin/vite --config vite.web.config.ts --port 5199 --host 127.0.0.1 --strictPort
 *   node scripts/error-boundary-check.mjs --out tmp/errorBoundary
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const ARG = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d
}
const OUT = ARG('out', 'tmp/errorBoundary')
const BASE = ARG('base', 'http://127.0.0.1:5199')

const CANDIDATES = [
  process.env.UI_PROBE_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean)
const executablePath = CANDIDATES.find((p) => existsSync(p))
if (!executablePath) {
  console.error('找不到可用的 Edge/Chromium（可用 UI_PROBE_BROWSER 指定）')
  process.exit(2)
}

const fails = []
const check = (ok, label, detail) => {
  if (!ok) fails.push(`${label}${detail ? `：${detail}` : ''}`)
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? `　${detail}` : ''}`)
}

const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(`${BASE}/probe.html?page=quadrant&crash=1`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)

const info = await page.evaluate(() => {
  const root = document.getElementById('root')
  const btns = [...document.querySelectorAll('button')].map((b) => b.textContent.trim())
  return {
    rootChildren: root?.children.length ?? 0,
    text: (root?.textContent ?? '').trim().slice(0, 200),
    buttons: btns,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    /** 有崩溃时根节点里应该是一张带内联样式的恢复卡片 */
    card: Boolean(root?.querySelector('div[style*="border-radius"]'))
  }
})

console.log('\n【crash=1】故意抛错的页面')
check(errors.length > 0, '错误确实被抛出来了', errors[0]?.slice(0, 80) ?? '（没有捕获到异常）')
check(info.rootChildren > 0, '根节点不是空的（没有变成空白窗口）', `children=${info.rootChildren}`)
check(info.text.includes('界面出错了'), '显示的是恢复界面', info.text.slice(0, 40))
check(
  info.buttons.some((b) => b.includes('重新加载')) &&
    info.buttons.some((b) => b.includes('重置外观设置')),
  '两个出口按钮都在',
  JSON.stringify(info.buttons)
)
check(info.card, '兜底界面用内联样式（CSS 失效时也能显示）')

mkdirSync(OUT, { recursive: true })
await page.screenshot({ path: `${OUT}/crash.png` })
writeFileSync(`${OUT}/crash.json`, JSON.stringify({ info, errors }, null, 2))
console.log(`\n截图：${OUT}/crash.png`)

// 反面对照：不带 crash 时必须正常渲染，否则上面那条"恢复了"就没意义
const okPage = await browser.newPage({ viewport: { width: 1100, height: 760 } })
await okPage.goto(`${BASE}/probe.html?page=quadrant&sidebar=1`, { waitUntil: 'domcontentloaded' })
await okPage.waitForSelector('.app', { timeout: 10000 })
const normal = await okPage.evaluate(() => ({
  app: Boolean(document.querySelector('.app')),
  recovery: (document.getElementById('root')?.textContent ?? '').includes('界面出错了')
}))
console.log('\n【对照】正常页面')
check(normal.app && !normal.recovery, '正常页面照常渲染，没被边界拦住')

await browser.close()
console.log(fails.length ? `\n${fails.length} 项失败：\n- ${fails.join('\n- ')}` : '\n全部通过')
process.exit(fails.length ? 1 : 0)
