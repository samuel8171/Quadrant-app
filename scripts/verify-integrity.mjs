#!/usr/bin/env node
/**
 * 象限 · 程序完整性验证
 * ============================================================================
 * 只读校验，不修改任何文件。回答一个问题：
 *   「当前这份程序（源码 + 依赖 + 构建产物 + 运行数据 + 安装包）是否完整可用？」
 *
 * 用法：
 *   node scripts/verify-integrity.mjs                 # 全部检查（不含类型检查）
 *   node scripts/verify-integrity.mjs --typecheck     # 附加 tsc 类型检查（慢，可能被沙箱拦）
 *   node scripts/verify-integrity.mjs --json          # 输出机器可读 JSON
 *   node scripts/verify-integrity.mjs --strict        # 有 WARN 也返回非 0
 *   node scripts/verify-integrity.mjs --appdata <dir> # 覆盖应用数据目录（默认 %APPDATA%\象限）
 *
 * 退出码：0 = 无 FAIL；1 = 存在 FAIL（或 --strict 下存在 WARN）
 *
 * 检查分组：
 *   [源码与配置]  必要文件、package.json 元数据、tsconfig 可解析
 *   [依赖]        dependencies/devDependencies 落地情况与入口文件可用性
 *   [构建产物]    out/ 与 dist-web/ 的 HTML/CSS/manifest 引用是否闭合
 *   [运行数据]    plan.json 是否通过 validAppData 规则（不合规会被静默重置）
 *   [模型同步]    types.ts 与 platformApi.validAppData 的字段集是否一致（启发式）
 *   [安装包]      dist/*.exe 的 PE 头与版本对应
 *   [类型检查]    可选，--typecheck 开启
 *
 * ⚠️ 维护提示：本脚本第 5 组是「第 4 处」字段校验副本。
 *    新增事件字段时，原三处为 shared/types.ts、main/dataCodec.normalizeEvent、
 *    renderer/lib/platformApi.validAppData；本脚本的 validAppData 复刻块也要同步。
 *    第 5 组会尽力发现这类漏同步，但它只是启发式，不能替代人工确认。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import process from 'node:process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

const argv = process.argv.slice(2)
const OPT = {
  json: argv.includes('--json'),
  strict: argv.includes('--strict'),
  typecheck: argv.includes('--typecheck'),
  appData: (() => {
    const i = argv.indexOf('--appdata')
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null
  })(),
}

// ---------------------------------------------------------------- 结果收集

const results = []
const add = (group, level, title, detail = '') => results.push({ group, level, title, detail })
const GROUPS = ['源码与配置', '依赖', '构建产物', '运行数据', '模型同步', '安装包', '类型检查']

// ---------------------------------------------------------------- 工具函数

const abs = (rel) => path.join(ROOT, rel)
const exists = (p) => {
  try { fs.statSync(p); return true } catch { return false }
}
const isFile = (p) => {
  try { return fs.statSync(p).isFile() } catch { return false }
}
const readText = (p) => fs.readFileSync(p, 'utf8')
const sizeOf = (p) => {
  try { return fs.statSync(p).size } catch { return 0 }
}
/** 自适应单位，避免 35 KB 显示成 0.0 MB */
const human = (n) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)

/** 剥离 JSONC 注释后解析（tsconfig 允许注释与尾逗号） */
function parseJsonc(text) {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1')
    .replace(/,(\s*[}\]])/g, '$1')
  return JSON.parse(stripped)
}

// ============================================================================
// 第 1 组 · 源码与配置
// ============================================================================

const REQUIRED_FILES = [
  'package.json',
  'package-lock.json',
  'electron.vite.config.ts',
  'vite.web.config.ts',
  'vitest.config.ts',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.web.json',
  'electron-builder.yml',
  'src/main/index.ts',
  'src/preload/index.ts',
  'src/shared/types.ts',
  'src/renderer/index.html',
  'src/renderer/probe.html',
  'src/renderer/src/main.tsx',
  'src/renderer/src/lib/platformApi.ts',
  'src/renderer/src/lib/cloudSync2.ts',
]

function checkSources() {
  const missing = REQUIRED_FILES.filter((f) => !isFile(abs(f)))
  const empty = REQUIRED_FILES.filter((f) => isFile(abs(f)) && sizeOf(abs(f)) === 0)
  if (missing.length === 0) {
    add('源码与配置', 'pass', `${REQUIRED_FILES.length} 个必要文件齐备`)
  } else {
    add('源码与配置', 'fail', `缺失 ${missing.length} 个必要文件`, missing.join(', '))
  }
  if (empty.length) add('源码与配置', 'fail', `存在空文件`, empty.join(', '))

  // tests/ 不能为空（测试基线靠它）
  let testCount = 0
  try {
    testCount = fs.readdirSync(abs('tests')).filter((f) => f.endsWith('.ts')).length
  } catch { /* tests 缺失 */ }
  if (testCount === 0) add('源码与配置', 'warn', 'tests/ 下没有 .ts 测试文件')
  else add('源码与配置', 'pass', `tests/ 下 ${testCount} 个测试文件`)

  // package.json 元数据
  let pkg = null
  try {
    pkg = JSON.parse(readText(abs('package.json')))
  } catch (e) {
    add('源码与配置', 'fail', 'package.json 无法解析', String(e.message))
    return { pkg: null }
  }
  const need = ['name', 'productName', 'version', 'main']
  const lack = need.filter((k) => typeof pkg[k] !== 'string' || !pkg[k])
  if (lack.length) add('源码与配置', 'fail', `package.json 缺少字段`, lack.join(', '))
  else add('源码与配置', 'pass', `package.json 可解析：${pkg.productName} v${pkg.version}`)

  for (const f of ['tsconfig.json', 'tsconfig.node.json', 'tsconfig.web.json']) {
    try {
      parseJsonc(readText(abs(f)))
    } catch (e) {
      add('源码与配置', 'fail', `${f} 无法解析`, String(e.message))
    }
  }

  // electron-builder.yml 里的产物名要与 package.json 一致
  try {
    const yml = readText(abs('electron-builder.yml'))
    const m = yml.match(/artifactName\s*:\s*["']?([^\n"']+)/)
    if (m && !m[1].includes('${version}')) {
      add('源码与配置', 'warn', 'electron-builder.yml 的 artifactName 未使用 ${version}', m[1])
    }
  } catch { /* 忽略 */ }

  return { pkg }
}

// ============================================================================
// 第 2 组 · 依赖
// ============================================================================

/** 从包描述里取出入口文件候选 */
function entryCandidates(pkg, dir) {
  const out = []
  const push = (v) => {
    if (typeof v === 'string' && v) out.push(path.resolve(dir, v))
  }
  const exp = pkg.exports
  if (typeof exp === 'string') push(exp)
  else if (exp && typeof exp === 'object') {
    const dot = exp['.'] ?? exp
    if (typeof dot === 'string') push(dot)
    else if (dot && typeof dot === 'object') {
      push(dot.import); push(dot.require); push(dot.default); push(dot.node)
    }
  }
  push(pkg.module); push(pkg.main)
  out.push(path.join(dir, 'index.js'))
  return out
}

function checkDeps(pkg) {
  if (!pkg) return
  const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  const names = Object.keys(all)
  const missing = []
  const noEntry = []

  for (const name of names) {
    const dir = path.join(ROOT, 'node_modules', name)
    const pj = path.join(dir, 'package.json')
    if (!isFile(pj)) { missing.push(name); continue }
    let meta
    try { meta = JSON.parse(readText(pj)) } catch { missing.push(name); continue }

    // 类型声明包只有 .d.ts，没有运行时入口 —— 用 types/typings 字段判断，别按 main 要求
    const typesEntry = meta.types || meta.typings
    if (typesEntry) {
      if (!isFile(path.resolve(dir, typesEntry))) noEntry.push(`${name}@${meta.version ?? '?'}`)
      continue
    }
    if (name.startsWith('@types/')) continue

    const cands = entryCandidates(meta, dir)
    if (!cands.some((c) => isFile(c) || (exists(c) && fs.statSync(c).isDirectory()))) {
      noEntry.push(`${name}@${meta.version ?? '?'}`)
    }
  }

  if (missing.length === 0) add('依赖', 'pass', `${names.length} 个直接依赖已落地`)
  else add('依赖', 'fail', `${missing.length} 个直接依赖未安装`, missing.join(', '))

  if (noEntry.length) add('依赖', 'warn', `${noEntry.length} 个包找不到入口文件（可能是半棵树）`, noEntry.join(', '))

  // 全量锁文件校验交给既有脚本，避免重复实现
  add('依赖', 'info', '如需全量校验，运行 python scripts/heal-node-modules.py --dry')
}

// ============================================================================
// 第 3 组 · 构建产物与引用闭合
// ============================================================================

const EXTERNAL = /^(https?:|data:|mailto:|tel:|blob:|#|\/\/)/i

/** 从 HTML 收集 src/href 相对引用 */
function htmlRefs(html) {
  const out = []
  for (const m of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
    const v = m[1].trim()
    if (v && !EXTERNAL.test(v)) out.push(v)
  }
  return out
}

/** 从 CSS 收集 url() 相对引用 */
function cssRefs(css) {
  const out = []
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    const v = m[1].trim()
    if (v && !EXTERNAL.test(v)) out.push(v)
  }
  return out
}

/** 校验一组引用是否都能解析到真实文件 */
function checkRefs(group, label, baseDir, refs) {
  const bad = []
  for (const r of refs) {
    const clean = r.split('?')[0].split('#')[0]
    if (!clean) continue
    const p = path.resolve(baseDir, clean)
    if (!isFile(p)) bad.push(r)
  }
  if (refs.length === 0) {
    add(group, 'info', `${label}：无外部引用`)
  } else if (bad.length === 0) {
    add(group, 'pass', `${label}：${refs.length} 个引用全部闭合`)
  } else {
    add(group, 'fail', `${label}：${bad.length} 个引用指向不存在的文件`, bad.join(', '))
  }
}

/** 校验产物目录里的 JS/CSS 体积是否健全（抓空产物与被截断的产物） */
function checkBundleHeft(label, dir) {
  if (!exists(dir)) { add('构建产物', 'fail', `${label} 目录缺失`); return }
  let entries = []
  try { entries = fs.readdirSync(dir) } catch { add('构建产物', 'fail', `${label} 无法读取`); return }

  const js = entries.filter((f) => f.endsWith('.js')).map((f) => ({ f, s: sizeOf(path.join(dir, f)) }))
  const css = entries.filter((f) => f.endsWith('.css')).map((f) => ({ f, s: sizeOf(path.join(dir, f)) }))

  if (js.length === 0) {
    add('构建产物', 'fail', `${label} 下没有 JS bundle`)
  } else {
    const tiny = js.filter((x) => x.s < 50 * 1024)
    const biggest = Math.max(...js.map((x) => x.s))
    if (tiny.length) add('构建产物', 'fail', `${label} 有体积异常的 JS（可能被截断）`, tiny.map((x) => `${x.f} ${human(x.s)}`).join(', '))
    else add('构建产物', 'pass', `${label} JS ${js.length} 个，主包 ${human(biggest)}`)
  }
  if (css.length) {
    const tinyCss = css.filter((x) => x.s < 5 * 1024)
    if (tinyCss.length) add('构建产物', 'warn', `${label} 有体积偏小的 CSS`, tinyCss.map((x) => `${x.f} ${human(x.s)}`).join(', '))
    else add('构建产物', 'pass', `${label} CSS ${css.length} 个，最大 ${human(Math.max(...css.map((x) => x.s)))}`)
  }
}

function checkArtifacts(pkg) {
  // ---- out/（桌面端产物）----
  const outIdx = abs('out/renderer/index.html')
  const outMain = abs('out/main/index.js')
  const outPreload = abs('out/preload/index.js')

  if (isFile(outMain)) add('构建产物', 'pass', 'out/main/index.js 存在')
  else add('构建产物', 'fail', 'out/main/index.js 缺失（需 electron-vite build）')
  if (isFile(outPreload)) add('构建产物', 'pass', 'out/preload/index.js 存在')
  else add('构建产物', 'fail', 'out/preload/index.js 缺失（需 electron-vite build）')

  if (isFile(outIdx)) {
    const dir = path.dirname(outIdx)
    checkRefs('构建产物', 'out/renderer/index.html', dir, htmlRefs(readText(outIdx)))
    // main 入口引用
    const m = readText(outIdx).match(/src\s*=\s*["']([^"']+\.js)["']/)
    if (m && isFile(path.resolve(dir, m[1]))) add('构建产物', 'pass', 'out/renderer 主入口可解析')
  } else {
    add('构建产物', 'info', 'out/renderer/index.html 不存在（未构建过桌面端渲染层）')
  }
  checkBundleHeft('out/renderer/assets', abs('out/renderer/assets'))

  // package.json 的 main 是否指向真实产物
  if (pkg?.main) {
    const p = abs(pkg.main)
    if (isFile(p)) add('构建产物', 'pass', `package.json main → ${pkg.main} 存在`)
    else add('构建产物', 'warn', `package.json main → ${pkg.main} 不存在（桌面端未构建）`)
  }

  // ---- dist-web/（网页端产物）----
  const webIdx = abs('dist-web/index.html')
  if (!isFile(webIdx)) {
    add('构建产物', 'warn', 'dist-web/index.html 缺失（网页端未构建）')
  } else {
    const dir = abs('dist-web')
    const html = readText(webIdx)
    checkRefs('构建产物', 'dist-web/index.html', dir, htmlRefs(html))

    // manifest 与其 icons
    const mf = abs('dist-web/manifest.webmanifest')
    if (!isFile(mf)) {
      add('构建产物', 'fail', 'dist-web/manifest.webmanifest 缺失')
    } else {
      try {
        const man = JSON.parse(readText(mf))
        const icons = Array.isArray(man.icons) ? man.icons.map((i) => i.src).filter(Boolean) : []
        checkRefs('构建产物', 'manifest.icons', dir, icons)
        if (html.includes('manifest')) add('构建产物', 'pass', 'index.html 已声明 manifest')
      } catch (e) {
        add('构建产物', 'fail', 'manifest.webmanifest 无法解析', String(e.message))
      }
    }

    // 产物内 CSS 的 url() 引用
    let cssChecked = 0
    try {
      for (const f of fs.readdirSync(abs('dist-web/assets'))) {
        if (!f.endsWith('.css')) continue
        const p = abs(`dist-web/assets/${f}`)
        checkRefs('构建产物', `dist-web/assets/${f}`, path.dirname(p), cssRefs(readText(p)))
        cssChecked++
      }
    } catch { /* assets 缺失 */ }
    if (cssChecked === 0) add('构建产物', 'info', 'dist-web/assets 下没有 CSS 可校验')
    checkBundleHeft('dist-web/assets', abs('dist-web/assets'))

    // 产物新鲜度：源文件是否比产物新
    const newest = newestMtime(abs('src'))
    const idxTime = fs.statSync(webIdx).mtimeMs
    if (newest > idxTime + 1000) {
      add('构建产物', 'warn', 'dist-web/ 比 src/ 旧（源码已改动但未重新构建）',
        `src 最新 ${new Date(newest).toLocaleString()} > 产物 ${new Date(idxTime).toLocaleString()}`)
    } else {
      add('构建产物', 'pass', 'dist-web/ 不旧于 src/')
    }
  }
}

/** 递归取目录内最新 mtime */
function newestMtime(dir) {
  let max = 0
  const walk = (d) => {
    let items = []
    try { items = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const it of items) {
      const p = path.join(d, it.name)
      if (it.isDirectory()) walk(p)
      else {
        try { max = Math.max(max, fs.statSync(p).mtimeMs) } catch { /* ignore */ }
      }
    }
  }
  walk(dir)
  return max
}

// ============================================================================
// 第 4 组 · 运行数据
// ============================================================================
//
// ⚠️ 本块是 renderer/lib/platformApi.ts:28-68 的忠实复刻（含 isRecord / hasStringFields
//    的精确语义）。规则改动时必须同步这里。

function isRecord(v) {
  return !!v && typeof v === 'object'
}
function hasStringFields(v, fields) {
  return isRecord(v) && fields.every((f) => typeof v[f] === 'string')
}
function validPhotos(v) {
  return v === undefined || (Array.isArray(v) && v.every((id) => typeof id === 'string'))
}

const MONEY_NUMERIC_KEYS = [
  'weeklyTC', 'dailyCapTC', 'tcPerHour', 'nightStartMin', 'nightEndMin', 'nightMultiplier',
  'minCapRatio', 'weeklyLT', 'rewardLT', 'penaltyLT', 'missPenaltyLT',
  'videoLTPerHour', 'gameLTPerHour', 'restDayFactor', 'abandonedDayTC', 'latePhoneTC', 'latePhoneLT'
]
// 配置里唯一的非标量字段：四个键都必须存在且为有限数字，与 platformApi.validMoney 同口径。
const QUADRANT_MULTIPLIER_KEYS = ['q1', 'q2', 'q3', 'q4']
const WEEK_SETTLEMENT_NUMERIC_KEYS = [
  'weekTC', 'spentTC', 'weekOver', 'plannedMin', 'actualMin', 'doneCount', 'missCount',
  'unplannedCount', 'unplannedMin', 'nightMin', 'overLimitDays', 'nextWeekTC', 'nextWeekLT'
]
const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n)
const isDateKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

function validLedgerEntry(v) {
  if (!isRecord(v)) return false
  if (typeof v.id !== 'string' || typeof v.title !== 'string') return false
  if (v.kind !== 'planned' && v.kind !== 'unplanned') return false
  if (typeof v.done !== 'boolean') return false
  if (v.sourceId !== null && typeof v.sourceId !== 'string') return false
  if (v.plannedMin !== null && !isFiniteNum(v.plannedMin)) return false
  if (!isFiniteNum(v.actualMin) || !isFiniteNum(v.nightMin)) return false
  if (!isFiniteNum(v.costTC) || !isFiniteNum(v.deltaLT)) return false
  return v.quadrant === null || [1, 2, 3, 4].includes(v.quadrant)
}

// videoMin / gameMin 是后加的娱币纯消费字段：缺席放行、存在则必须是有限数字，
// 与 platformApi.validLedgerDay 的 validOptionalMinutes 同口径（免得旧账本被判非法而丢整本账）。
const validOptionalMinutes = (v) => v === undefined || isFiniteNum(v)

// isRestDay（休息日申报）/ latePhone（昨夜是否刷手机）同样是后加的可选字段：缺席放行、
// 存在则必须是布尔，与 platformApi.validLedgerDay 的 validOptionalBoolean 同口径。
const validOptionalBoolean = (v) => v === undefined || typeof v === 'boolean'

function validLedgerDay(v) {
  if (!isRecord(v)) return false
  if (!isDateKey(v.date)) return false
  if (v.settledAt !== null && typeof v.settledAt !== 'string') return false
  if (typeof v.nightPending !== 'boolean') return false
  if (!validOptionalMinutes(v.videoMin) || !validOptionalMinutes(v.gameMin)) return false
  if (!validOptionalBoolean(v.isRestDay) || !validOptionalBoolean(v.latePhone)) return false
  if (!isFiniteNum(v.dayLimit) || !isFiniteNum(v.spentTC)) return false
  if (!isFiniteNum(v.overdraft) || !isFiniteNum(v.deltaLT)) return false
  return Array.isArray(v.entries) && v.entries.every(validLedgerEntry)
}

function validWeekSettlement(v) {
  if (!isRecord(v)) return false
  if (!isDateKey(v.weekStart) || !isDateKey(v.weekEnd)) return false
  if (![0, 1, 2, 3].includes(v.penaltyTier)) return false
  if (!Array.isArray(v.notes) || !v.notes.every((note) => typeof note === 'string')) return false
  return WEEK_SETTLEMENT_NUMERIC_KEYS.every((k) => isFiniteNum(v[k]))
}

function validQuadrantMultiplier(v) {
  return isRecord(v) && QUADRANT_MULTIPLIER_KEYS.every((k) => isFiniteNum(v[k]))
}

function validMoney(v) {
  if (!isRecord(v)) return false
  if (typeof v.enabled !== 'boolean') return false
  if (!isRecord(v.config) || !MONEY_NUMERIC_KEYS.every((k) => isFiniteNum(v.config[k]))) return false
  if (!validQuadrantMultiplier(v.config.quadrantMultiplier)) return false
  if (!Array.isArray(v.days) || !v.days.every(validLedgerDay)) return false
  if (!Array.isArray(v.weeks) || !v.weeks.every(validWeekSettlement)) return false
  return true
}

function validAppData(value) {
  if (!isRecord(value)) return false
  const d = value
  if (d.version !== 2 || !Number.isFinite(d.weekCounterOffset) ||
    !Array.isArray(d.goals) || !Array.isArray(d.events) ||
    !Array.isArray(d.weekPresets) || !Array.isArray(d.weekEvents)) return false

  const num = (n) => typeof n === 'number' && Number.isFinite(n)
  const quad = (n) => [1, 2, 3, 4].includes(n)

  return d.goals.every((g) => isRecord(g) && hasStringFields(g, ['id', 'title', 'type', 'remark', 'createdAt']) &&
    (g.type === 'long' || g.type === 'short') && typeof g.done === 'boolean' && num(g.order) &&
    Array.isArray(g.groupTitles) && g.groupTitles.every((v) => typeof v === 'string') &&
    Array.isArray(g.subtasks) && g.subtasks.every((s) => isRecord(s) && hasStringFields(s, ['id', 'title', 'remark']) &&
      typeof s.done === 'boolean' && num(s.group) && num(s.order))) &&
    d.events.every((e) => isRecord(e) && hasStringFields(e, ['id', 'text', 'remark', 'createdAt']) &&
      quad(e.quadrant) && validPhotos(e.photos) &&
      ['x', 'y', 'width'].every((f) => num(e[f]))) &&
    d.weekPresets.every((p) => isRecord(p) && hasStringFields(p, ['id', 'title', 'color', 'remark', 'createdAt']) &&
      quad(p.quadrant) && num(p.durationMin)) &&
    d.weekEvents.every((e) => isRecord(e) && hasStringFields(e, ['id', 'date', 'title', 'color', 'remark', 'createdAt']) &&
      quad(e.quadrant) && num(e.startMin) && num(e.endMin) && typeof e.showInQuadrant === 'boolean') &&
    (d.money === undefined || validMoney(d.money))
}

/** 定位不合规的具体实体，便于排查（仍不打印任何正文） */
function firstViolation(value) {
  if (!isRecord(value)) return '顶层不是对象'
  const d = value
  if (d.version !== 2) return `version=${JSON.stringify(d.version)}（期望 2）`
  if (!Number.isFinite(d.weekCounterOffset)) return 'weekCounterOffset 不是有限数字'
  for (const k of ['goals', 'events', 'weekPresets', 'weekEvents']) {
    if (!Array.isArray(d[k])) return `${k} 不是数组`
  }
  const num = (n) => typeof n === 'number' && Number.isFinite(n)
  const quad = (n) => [1, 2, 3, 4].includes(n)
  const idx = (arr, fn) => arr.findIndex((x) => !fn(x))

  let i = idx(d.goals, (g) => isRecord(g) && hasStringFields(g, ['id', 'title', 'type', 'remark', 'createdAt']) &&
    (g.type === 'long' || g.type === 'short') && typeof g.done === 'boolean' && num(g.order) &&
    Array.isArray(g.groupTitles) && g.groupTitles.every((v) => typeof v === 'string') &&
    Array.isArray(g.subtasks) && g.subtasks.every((s) => isRecord(s) && hasStringFields(s, ['id', 'title', 'remark']) &&
      typeof s.done === 'boolean' && num(s.group) && num(s.order)))
  if (i >= 0) return `goals[${i}] 不合规（检查 id/title/type/remark/createdAt/done/order/groupTitles/subtasks）`

  i = idx(d.events, (e) => isRecord(e) && hasStringFields(e, ['id', 'text', 'remark', 'createdAt']) &&
    quad(e.quadrant) && validPhotos(e.photos) && ['x', 'y', 'width'].every((f) => num(e[f])))
  if (i >= 0) return `events[${i}] 不合规（检查 id/text/remark/createdAt/quadrant/x/y/width/photos）`

  i = idx(d.weekPresets, (p) => isRecord(p) && hasStringFields(p, ['id', 'title', 'color', 'remark', 'createdAt']) &&
    quad(p.quadrant) && num(p.durationMin))
  if (i >= 0) return `weekPresets[${i}] 不合规（检查 id/title/color/remark/createdAt/quadrant/durationMin）`

  i = idx(d.weekEvents, (e) => isRecord(e) && hasStringFields(e, ['id', 'date', 'title', 'color', 'remark', 'createdAt']) &&
    quad(e.quadrant) && num(e.startMin) && num(e.endMin) && typeof e.showInQuadrant === 'boolean')
  if (i >= 0) return `weekEvents[${i}] 不合规（检查 id/date/title/color/remark/createdAt/quadrant/startMin/endMin/showInQuadrant）`

  if (d.money !== undefined && !validMoney(d.money)) return 'money 不合规（检查 enabled/config/days/weeks）'

  return '未知'
}

function checkRuntimeData() {
  const dir = OPT.appData
    ? path.resolve(OPT.appData)
    : (process.env.APPDATA ? path.join(process.env.APPDATA, '象限') : null)
  if (!dir) {
    add('运行数据', 'skip', '无法定位应用数据目录（APPDATA 未设置）')
    return
  }
  if (!exists(dir)) {
    add('运行数据', 'info', `应用数据目录不存在：${dir}（从未运行过桌面端？）`)
    return
  }
  add('运行数据', 'pass', `应用数据目录：${dir}`)

  const planPath = path.join(dir, 'plan.json')
  if (!isFile(planPath)) {
    add('运行数据', 'warn', 'plan.json 缺失', '桌面端首次启动时会生成默认数据')
  } else {
    try {
      const raw = readText(planPath)
      const data = JSON.parse(raw)
      if (validAppData(data)) {
        add('运行数据', 'pass', `plan.json 通过 validAppData 规则（${human(sizeOf(planPath))}）`)
        add('运行数据', 'info',
          `实体计数：目标 ${data.goals.length} · 四象限事件 ${data.events.length} · 周预设 ${data.weekPresets.length} · 周事件 ${data.weekEvents.length}`)
      } else {
        add('运行数据', 'fail', 'plan.json 不通过 validAppData —— 启动时会被静默替换为默认数据！',
          firstViolation(data))
        add('运行数据', 'info', `文件保留在 ${planPath}，处理前请先复制一份`)
      }
    } catch (e) {
      add('运行数据', 'fail', 'plan.json 无法解析（JSON 损坏）',
        `${String(e.message)}｜文件 ${human(sizeOf(planPath))}，位于 ${planPath}`)
    }
  }

  // 备份与同步元数据
  const bak = path.join(dir, 'plan.backup.json')
  if (isFile(bak)) {
    try {
      JSON.parse(readText(bak))
      add('运行数据', 'pass', `plan.backup.json 可解析（${human(sizeOf(bak))}，${new Date(fs.statSync(bak).mtimeMs).toLocaleDateString()}）`)
    } catch {
      add('运行数据', 'warn', 'plan.backup.json 无法解析')
    }
  } else {
    add('运行数据', 'info', 'plan.backup.json 不存在')
  }

  const sync = path.join(dir, 'sync.json')
  if (isFile(sync)) {
    try { JSON.parse(readText(sync)); add('运行数据', 'pass', 'sync.json 可解析') }
    catch { add('运行数据', 'warn', 'sync.json 无法解析') }
  }

  // reviews 目录
  const rev = path.join(dir, 'reviews')
  if (exists(rev)) {
    let n = 0
    try { n = fs.readdirSync(rev).length } catch { /* ignore */ }
    add('运行数据', 'pass', `reviews/ 存在，${n} 个条目`)
  } else {
    add('运行数据', 'info', 'reviews/ 目录不存在（尚无复盘记录）')
  }

  // photos 目录（桌面端照片实体）
  const photos = path.join(dir, 'photos')
  if (exists(photos)) {
    let n = 0
    try { n = fs.readdirSync(photos).filter((f) => f.endsWith('.txt')).length } catch { /* ignore */ }
    add('运行数据', 'pass', `photos/ 存在，${n} 个照片实体`)
  } else {
    add('运行数据', 'info', 'photos/ 目录不存在（尚无桌面端照片）')
  }

  // 残留临时文件（写流程未清理）
  try {
    const junk = fs.readdirSync(dir).filter((f) => /\.tmp$/i.test(f) || f === '.wbwrite-test')
    if (junk.length) add('运行数据', 'warn', `数据目录有 ${junk.length} 个残留临时文件`, junk.join(', '))
  } catch { /* ignore */ }
}

// ============================================================================
// 第 5 组 · 数据模型同步（启发式）
// ============================================================================

function checkModelSync() {
  const typesPath = abs('src/shared/types.ts')
  const apiPath = abs('src/renderer/src/lib/platformApi.ts')
  if (!isFile(typesPath) || !isFile(apiPath)) {
    add('模型同步', 'skip', '缺少 types.ts 或 platformApi.ts，跳过')
    return
  }

  // types.ts 里 AppData 的顶层字段
  let typeFields = []
  try {
    const src = readText(typesPath)
    const m = src.match(/(?:export\s+)?(?:interface|type)\s+AppData\s*[={]([\s\S]*?)\n\}/)
    if (m) {
      const body = m[1]
      for (const line of body.split('\n')) {
        const fm = line.match(/^\s{2}([A-Za-z_$][\w$]*)\??\s*:/)
        if (fm) typeFields.push(fm[1])
      }
    }
  } catch { /* ignore */ }

  // validAppData 体内引用的 data.<field>
  let apiFields = []
  try {
    const src = readText(apiPath)
    const start = src.indexOf('function validAppData')
    if (start >= 0) {
      const end = src.indexOf('\n}', start)
      const body = src.slice(start, end >= 0 ? end : start + 4000)
      const set = new Set()
      for (const m of body.matchAll(/\bdata\.([A-Za-z_$][\w$]*)/g)) set.add(m[1])
      apiFields = [...set]
    }
  } catch { /* ignore */ }

  if (typeFields.length === 0 || apiFields.length === 0) {
    add('模型同步', 'skip', '启发式提取失败（types.ts 或 validAppData 结构变化过大）')
    return
  }

  const t = new Set(typeFields)
  const a = new Set(apiFields)
  const unchecked = [...t].filter((f) => !a.has(f))   // 类型里有、校验器不管
  const unknown = [...a].filter((f) => !t.has(f))     // 校验器管、类型里没有

  if (unchecked.length === 0 && unknown.length === 0) {
    add('模型同步', 'pass', `AppData 顶层字段一致（${typeFields.length} 个）`)
  } else {
    if (unchecked.length) {
      add('模型同步', 'warn', `validAppData 未校验这些顶层字段（可能是可选字段）`, unchecked.join(', '))
    }
    if (unknown.length) {
      add('模型同步', 'fail', `validAppData 校验了 types.ts 里不存在的字段`, unknown.join(', '))
    }
  }

  add('模型同步', 'info', '提示：实体级字段（Goal/QuadrantEvent/WeekEvent/WeekPreset）仍需人工核对三处同步')
}

// ============================================================================
// 第 6 组 · 安装包
// ============================================================================

function checkPackages(pkg) {
  const distDir = abs('dist')
  if (!exists(distDir)) {
    add('安装包', 'info', 'dist/ 不存在（未打包过桌面端）')
    return
  }
  let files = []
  try { files = fs.readdirSync(distDir).filter((f) => f.toLowerCase().endsWith('.exe')) } catch { /* ignore */ }

  if (files.length === 0) {
    add('安装包', 'warn', 'dist/ 下没有 .exe')
    return
  }

  const bad = []
  for (const f of files) {
    const p = path.join(distDir, f)
    const size = sizeOf(p)
    let okPe = false
    try {
      const fd = fs.openSync(p, 'r')
      const buf = Buffer.alloc(2)
      fs.readSync(fd, buf, 0, 2, 0)
      fs.closeSync(fd)
      okPe = buf[0] === 0x4d && buf[1] === 0x5a // 'MZ'
    } catch { /* ignore */ }
    if (!okPe || size < 10 * 1024 * 1024) bad.push(`${f}（${human(size)}${okPe ? '' : '，PE 头异常'}）`)
  }

  if (bad.length === 0) {
    add('安装包', 'pass', `${files.length} 个 .exe 均为有效 PE 且体积正常`)
  } else {
    add('安装包', 'fail', `${bad.length} 个 .exe 异常（可能未下载完整）`, bad.join(', '))
  }

  if (pkg?.version) {
    const expected = files.filter((f) => f.includes(pkg.version))
    if (expected.length) add('安装包', 'pass', `存在当前版本 v${pkg.version} 的产物：${expected.join(', ')}`)
    else add('安装包', 'warn', `dist/ 下没有 v${pkg.version} 的产物（最新版本未打包）`)
  }
}

// ============================================================================
// 第 7 组 · 类型检查（可选）
// ============================================================================

function checkTypecheck() {
  if (!OPT.typecheck) {
    add('类型检查', 'skip', '默认跳过（加 --typecheck 开启，约 30-60 秒）')
    return
  }
  const tsc = abs('node_modules/typescript/bin/tsc')
  if (!isFile(tsc)) {
    add('类型检查', 'skip', 'node_modules 里没有 typescript，跳过')
    return
  }
  for (const proj of ['tsconfig.node.json', 'tsconfig.web.json']) {
    try {
      execFileSync(process.execPath, [tsc, '--noEmit', '-p', proj], {
        cwd: ROOT, stdio: 'pipe', timeout: 180000,
      })
      add('类型检查', 'pass', `${proj} 通过`)
    } catch (e) {
      const msg = (e.stdout || e.stderr || Buffer.from('')).toString().trim()
      if (e.code === 'ETIMEDOUT' || e.signal) {
        add('类型检查', 'skip', `${proj} 超时或被打断`)
      } else if (msg) {
        const lines = msg.split('\n').filter(Boolean)
        add('类型检查', 'fail', `${proj} 存在类型错误（${lines.length} 行输出）`, lines.slice(0, 8).join(' ｜ '))
      } else {
        const blocked = /EPERM|EBUSY|EACCES|ENOENT/.test(`${e.code || ''} ${e.message || ''}`)
        add('类型检查', 'skip',
          `${proj} ${blocked ? '未能执行（沙箱拦截了子进程）' : '未能执行'}`,
          `手动运行：./node_modules/.bin/tsc --noEmit -p ${proj}`)
      }
    }
  }
}

// ============================================================================
// 主流程
// ============================================================================

const t0 = Date.now()
const { pkg } = checkSources()
checkDeps(pkg)
checkArtifacts(pkg)
checkRuntimeData()
checkModelSync()
checkPackages(pkg)
checkTypecheck()

const counts = { pass: 0, warn: 0, fail: 0, info: 0, skip: 0 }
for (const r of results) counts[r.level]++

if (OPT.json) {
  console.log(JSON.stringify({
    root: ROOT, version: pkg?.version ?? null, counts, results,
    elapsedMs: Date.now() - t0,
  }, null, 2))
} else {
  const SYM = { pass: ' OK ', warn: 'WARN', fail: 'FAIL', info: 'INFO', skip: 'SKIP' }
  const title = pkg ? `象限 · 程序完整性验证  (v${pkg.version})` : '象限 · 程序完整性验证'
  console.log(title)
  console.log('='.repeat(64))
  for (const g of GROUPS) {
    const rows = results.filter((r) => r.group === g)
    if (!rows.length) continue
    console.log(`\n[${g}]`)
    for (const r of rows) {
      console.log(`  ${SYM[r.level]}  ${r.title}`)
      if (r.detail) console.log(`        ${r.detail}`)
    }
  }
  console.log('\n' + '-'.repeat(64))
  console.log(`汇总：通过 ${counts.pass} · 警告 ${counts.warn} · 失败 ${counts.fail} · 提示 ${counts.info} · 跳过 ${counts.skip}`)
  console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(2)}s`)
  if (counts.fail > 0) console.log('结论：存在失败项，程序不完整，请按上面 FAIL 逐条修复。')
  else if (counts.warn > 0) console.log('结论：无失败项，但有警告，建议逐条确认。')
  else console.log('结论：程序完整。')
}

process.exit(counts.fail > 0 || (OPT.strict && counts.warn > 0) ? 1 : 0)
