/**
 * 用 Linux 的文件名比对规则，检查测试里引用到的每个路径。
 *
 * Windows 文件系统不区分大小写，所以 tests 里写错的路径（或 import 大小写不符）
 * 在本机会照常解析，到 Linux CI 上才会炸——而且是在模块加载阶段就炸，
 * 表现为 vitest 秒退。这个脚本复现的就是那条判据。
 *
 * 用法：node scripts/case-audit.mjs [仓库根目录]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const root = resolve(process.argv[2] ?? process.cwd())

/** 递归收集目录下的全部文件，返回以 / 分隔的相对路径（大小写保持原样）。 */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(relative(root, full).split(sep).join('/'))
  }
  return out
}

const files = walk(root)
const byLower = new Map()
for (const f of files) {
  const key = f.toLowerCase()
  if (!byLower.has(key)) byLower.set(key, [])
  byLower.get(key).push(f)
}

/** 按 Linux 语义判断路径是否存在，并给出“真实大小写”。 */
function probe(relPath) {
  const hits = byLower.get(relPath.toLowerCase())
  if (!hits) return { ok: false, reason: '不存在' }
  if (hits.includes(relPath)) return { ok: true, actual: relPath }
  return { ok: false, reason: `大小写不符，实际为 ${hits.join(' / ')}`, actual: hits[0] }
}

const testFiles = files.filter((f) => f.startsWith('tests/') && f.endsWith('.ts'))
const problems = []

for (const file of testFiles) {
  const source = readFileSync(join(root, file), 'utf8')

  // 1) 相对 import / export ... from '...'
  const importRe = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g
  for (const m of source.matchAll(importRe)) {
    const spec = m[1]
    const base = resolve(dirname(join(root, file)), spec)
    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, join(base, 'index.ts')]
    const found = candidates.some((c) => {
      const rel = relative(root, c).split(sep).join('/')
      return probe(rel).ok
    })
    if (!found) {
      const rel = relative(root, base).split(sep).join('/')
      problems.push(`${file}: import '${spec}' → ${probe(rel).reason}`)
    }
  }

  // 2) resolve(process.cwd(), '...') 这类按字符串读盘的路径
  const cwdRe = /resolve\(\s*process\.cwd\(\)\s*,\s*['"]([^'"]+)['"]/g
  for (const m of source.matchAll(cwdRe)) {
    const rel = m[1].split(sep).join('/')
    const r = probe(rel)
    if (!r.ok) problems.push(`${file}: 读盘路径 '${m[1]}' → ${r.reason}`)
  }
}

// 3) 顺带查 src/ 内部的相对 import（CI 的 typecheck 在 Linux 上也会踩到）
const srcFiles = files.filter((f) => f.startsWith('src/') && /\.(ts|tsx)$/.test(f))
for (const file of srcFiles) {
  const source = readFileSync(join(root, file), 'utf8')
  const importRe = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g
  for (const m of source.matchAll(importRe)) {
    const base = resolve(dirname(join(root, file)), m[1])
    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, join(base, 'index.ts')]
    const found = candidates.some((c) => probe(relative(root, c).split(sep).join('/')).ok)
    if (!found) {
      const rel = relative(root, base).split(sep).join('/')
      problems.push(`${file}: import '${m[1]}' → ${probe(rel).reason}`)
    }
  }
}

console.log(`扫描根目录: ${root}`)
console.log(`文件总数: ${files.length}，测试文件: ${testFiles.length}，源码文件: ${srcFiles.length}`)
if (problems.length === 0) {
  console.log('结论: 未发现大小写/缺失路径问题')
} else {
  console.log(`结论: 发现 ${problems.length} 处问题（在 Linux 上会加载失败）`)
  for (const p of problems) console.log('  - ' + p)
  process.exitCode = 1
}
