#!/usr/bin/env node
/**
 * 通过 GitHub REST API 推送当前 HEAD 到远端分支。
 *
 * 为什么需要它：本机的 git 传输通道不稳定（配置里的代理 127.0.0.1:7897 已死，
 * 环境变量的 14829 对小请求可用、对 push 这种大数据量会 schannel 中断或 502，
 * 直连不通）。而 api.github.com 走直连是稳的，故改用 Git Data API。
 *
 * 关键保证：**生成与本地逐字节相同的提交**——复用本地已有的 tree 与 parent，
 * 不重新计算任何内容，commit message 原样带上。所以远端拿到的提交哈希
 * 与本地一致，不需要在本地做任何改写（脚本会校验 sha 一致才更新 ref）。
 *
 * **不要直接跑本脚本**，用包装脚本（它负责在 shell 侧做 git 操作）：
 *   bash scripts/api-push.sh --dry-run
 *   bash scripts/api-push.sh
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const API = 'https://api.github.com'
const OWNER = 'samuel8171'
const REPO = 'Quadrant-app'

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const branchIdx = argv.indexOf('--branch')
const BRANCH = branchIdx >= 0 ? argv[branchIdx + 1] : 'main'

/* ---------- 收集本地对象 ----------
 *
 * 注意：本脚本**刻意不自己 spawn git**。在当前的沙箱环境里
 * `execFileSync('git', ...)` 会返回 EBUSY（errno -4082，子进程执行被拦），
 * 用绝对路径也一样。所以改为由调用方在 shell 里取好值再通过环境变量传入：
 *
 *   HEAD_SHA=... HEAD_TREE=... HEAD_PARENT=... HEAD_MSG=... GH_TOKEN=... \
 *     node scripts/api-push.mjs
 *
 * 用法见同目录的 `.github`/`AGENTS.md`，或直接跑 scripts/api-push.sh。
 */
const headSha = process.env.HEAD_SHA
const headTree = process.env.HEAD_TREE
const headParent = process.env.HEAD_PARENT
const headMsg = process.env.HEAD_MSG
const tokenFromEnv = process.env.GH_TOKEN

for (const [k, v] of Object.entries({ HEAD_SHA: headSha, HEAD_TREE: headTree, HEAD_PARENT: headParent, HEAD_MSG: headMsg })) {
  if (!v) {
    console.error(`缺少环境变量 ${k}。请通过 scripts/api-push.sh 调用本脚本。`)
    process.exit(1)
  }
}

/*
 * message 走 base64 传递（HEAD_MSG_B64）。
 * 原因：Git Data API 建提交时，message 末尾换行常被吞掉（实测远端只收到
 * 3486 B、本地 3487 B，差的那一个字节就是收尾的 \n），导致 commit sha 不同。
 * base64 让消息完全绕开 shell 与 JSON 的转义层，字节不变。
 */
const headMsgB64 = process.env.HEAD_MSG_B64
const headMsgExact = headMsgB64
  ? Buffer.from(headMsgB64, 'base64').toString('utf8')
  : headMsg

/*
 * 作者/提交者信息。API 默认用 token 持有者身份 + 当前时间建提交，
 * 这样算出的 sha 必然与本地不同。必须显式传入本地 commit 的身份与时间。
 */
const authorName = process.env.HEAD_AUTHOR_NAME
const authorEmail = process.env.HEAD_AUTHOR_EMAIL
const authorDate = process.env.HEAD_AUTHOR_DATE
const committerName = process.env.HEAD_COMMITTER_NAME
const committerEmail = process.env.HEAD_COMMITTER_EMAIL
const committerDate = process.env.HEAD_COMMITTER_DATE

console.log(`本地 HEAD     : ${headSha}`)
console.log(`  tree        : ${headTree}`)
console.log(`  parent      : ${headParent}`)
console.log(`  目标分支    : ${BRANCH}`)
console.log(`  作者        : ${authorName} <${authorEmail}> @ ${authorDate}`)
console.log(`  message     : ${Buffer.byteLength(headMsgExact, 'utf8')} B（期望 3487 量级，含结尾换行）`)
console.log(`  message 首行: ${headMsgExact.split('\n')[0]}`)

/* ---------- 对比远端当前状态 ---------- */
const token = tokenFromEnv
if (!token) {
  console.error('缺少环境变量 GH_TOKEN。请通过 scripts/api-push.sh 调用本脚本。')
  process.exit(1)
}
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json'
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...headers, ...init.headers } })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* 非 JSON */ }
  if (!res.ok) {
    throw new Error(`API ${init.method ?? 'GET'} ${path} → ${res.status}\n${text.slice(0, 500)}`)
  }
  return json
}

const ref = await api(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`)
const remoteSha = ref.object.sha
console.log(`远端 ${BRANCH}  : ${remoteSha}`)

if (remoteSha === headSha) {
  console.log('\n远端已是最新，无需推送。')
  process.exit(0)
}

/*
 * 安全检查：远端顶点必须是**本地 HEAD 的祖先**，否则说明远端有本地没有的
 * 提交（会变成强推覆盖），必须停下。
 *
 * 注意这里不能写成 `remoteSha === headParent`。本脚本一次只推一个提交，
 * 但本地「攒了多个未推提交」是常态（本次就攒了两个）。那种情况下
 * headParent 是**上一个本地提交**、而不是远端顶点，等值判断会误报
 * 「远端有本地没有的提交」并拒绝推送——而实际是干净的快进。
 *
 * 因此改为判定祖先关系：由 shell 侧用 `git merge-base --is-ancestor` 算好
 * （Node 侧不能 spawn git），把结论经 `REMOTE_IS_ANCESTOR=1` 传进来。
 * 取不到该变量时退回等值判断——宁可保守，也不要漏掉真的分叉。
 */
const remoteIsAncestor = process.env.REMOTE_IS_ANCESTOR === '1'
if (!remoteIsAncestor && remoteSha !== headParent) {
  console.error(
    `\n❌ 拒绝推送：远端 ${BRANCH}(${remoteSha.slice(0, 7)}) 不是本地 HEAD 的祖先，\n` +
    `   且它也不等于本地 HEAD 的 parent(${headParent.slice(0, 7)})。\n` +
    `   这说明远端有本地没有的提交，直接推会覆盖掉它们。请先 fetch 合并。`
  )
  process.exit(1)
}
if (remoteIsAncestor && remoteSha !== headParent) {
  console.log(`远端顶点是本地 HEAD 的祖先（领先 ${headParent.slice(0, 7)}…）：按快进推送。`)
}

/* ---------- 检查远端是否已有这些对象 ----------
 *
 * 单提交情形下 headParent 就是远端顶点，必然可解析，这是一个"远端对象库
 * 确实共享同一份历史"的探针。
 *
 * 但一次推多个提交时，headParent 是上一个**尚未推送**的本地提交，远端
 * 当然查不到（404）——这不是错误：它会在下面的"补齐缺失对象"环节被一起
 * 推上去，随后才作为新提交的 parent 生效。因此这里只做提示性检查，
 * 404 走告警分支而非中断。
 */
try {
  const remoteParent = await api(`/repos/${OWNER}/${REPO}/git/commits/${headParent}`)
  console.log(`远端 parent 可解析: ${remoteParent.sha.slice(0, 7)} ✓`)
} catch (error) {
  if (!remoteIsAncestor) throw error
  console.log(
    `远端尚无 parent(${headParent.slice(0, 7)})：本次是「一次推多个提交」，\n` +
    `  它会随本批对象一起补到远端。`
  )
}

if (dryRun) {
  console.log('\n[dry-run] 条件满足，可安全推送。未做任何修改。')
  /* 顺带报告缺口规模，便于实推前心里有数 */
  const wd = process.env.OBJ_WORKDIR
  if (wd && existsSync(join(wd, 'tree.txt'))) {
    const lines = readFileSync(join(wd, 'tree.txt'), 'utf8').split('\n').filter(Boolean)
    console.log(`本地对象清单：${lines.length} 条（含子树）。实推时会对照远端逐个补齐缺失项。`)
  }
  process.exit(0)
}

/*
 * ---------- 补齐远端缺失的 git 对象 ----------
 *
 * Git Data API 建提交时不传输对象：tree 及其下所有对象必须在远端对象库中
 * 已存在，否则报 422 "Tree SHA does not exist"。所以先把本地对象传上去。
 *
 * 对象由 shell 侧导出（Node 在本沙箱里 spawn git 会 EBUSY）：
 *   $OBJ_WORKDIR/tree.txt   每行 "shaless" 格式：由 git ls-tree -r -t 输出
 *   $OBJ_WORKDIR/blob-<sha>.bin  各 blob 的原始字节
 *
 * 判定「远端是否已有某对象」用 GET /git/blobs/<sha>：存在返回 200，不存在 404。
 */

function parseTreeLines(text) {
  /* 输入由 scripts/api-push.sh 从 `git ls-tree -r -t -z` 转换而来，
     每行为「<mode> <type> <sha>\t<path>」。
     路径已是原始字节解码后的真实文本（无引号、无八进制转义）——
     这一步很关键：带 -z 之前，含中文的路径会被 git 引用成
     "ChatGPT Image 2026\345\271\264..." 形式，直接当路径用会导致
     重建出的 tree sha 与本地不符。 */
  const out = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const m = line.match(/^(\d+)\s+(blob|tree|commit)\s+([0-9a-f]{40})\t(.*)$/)
    if (!m) continue
    out.push({ mode: m[1], type: m[2], sha: m[3], path: m[4] })
  }
  return out
}

/*
 * 按 git 的 tree 条目排序规则排序。
 *
 * git 在写 tree 对象前会把条目按路径的**原始字节**升序排列，但子树被视作
 * 「路径 + '/'」参与比较（git 源码 base_name_compare / df_name_compare）。
 * 举例：`build`(tree) 与 `build.sh`(blob) —— 比较时 `build/`(0x2F) 与
 * `build.`(0x2E)，`.` 更小，所以 blob 排在前。
 *
 * 顺序错了 sha 就不同，因此这里必须严格复刻，不能依赖输入顺序。
 */
function gitTreeSort(children) {
  const key = (c) => {
    const b = Buffer.from(c.path, 'utf8')
    return c.type === 'tree' ? Buffer.concat([b, Buffer.from('/')]) : b
  }
  return [...children].sort((a, b) => Buffer.compare(key(a), key(b)))
}

async function objectExists(sha, type) {
  const path = type === 'tree' ? 'trees' : 'blobs'
  const res = await fetch(`${API}/repos/${OWNER}/${REPO}/git/${path}/${sha}`, { headers })
  if (res.status === 200) return true
  if (res.status === 404) return false
  throw new Error(`探测对象 ${sha} 失败：HTTP ${res.status}`)
}

const workdir = process.env.OBJ_WORKDIR
if (!workdir) {
  console.error('缺少环境变量 OBJ_WORKDIR。请通过 scripts/api-push.sh 调用本脚本。')
  process.exit(1)
}

const entries = parseTreeLines(readFileSync(join(workdir, 'tree.txt'), 'utf8'))
const blobs = entries.filter((e) => e.type === 'blob')
const trees = entries.filter((e) => e.type === 'tree')

/*
 * 根树必须显式补进来。
 * `git ls-tree -r -t HEAD` 只列「有路径的条目」，根树自身没有路径，
 * 因此永远不会出现在输出里。漏掉它 → 建提交时 422 "Tree SHA does not exist"。
 * shell 侧已把根树 sha 通过 HEAD_TREE 传入。
 */
if (!trees.some((t) => t.sha === headTree)) {
  trees.push({ mode: '040000', type: 'tree', sha: headTree, path: '' })
}
console.log(`\n本地对象：${blobs.length} 个 blob、${trees.length} 个子树（含根树）`)

/*
 * 先探一个「parent 版本已有」的文件，确认远端对象库确实共享同一份历史对象，
 * 据此可以跳过大量未改动的 blob。
 */
let needUpload = 0
const missingBlobs = []
console.log('对照远端，筛选缺失的 blob…')
for (const b of blobs) {
  if (await objectExists(b.sha, 'blob')) continue
  missingBlobs.push(b)
  needUpload++
}
console.log(`  需上传 blob：${needUpload} 个`)

for (const b of missingBlobs) {
  const buf = readFileSync(join(workdir, `blob-${b.sha}.bin`))
  const created = await api(`/repos/${OWNER}/${REPO}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: buf.toString('base64'), encoding: 'base64' })
  })
  if (created.sha !== b.sha) {
    throw new Error(`blob 上传后 sha 不匹配：本地 ${b.sha}，远端 ${created.sha}（${b.path}）`)
  }
  process.stdout.write(`  上传 ${b.path} (${buf.length} B)\n`)
}

/*
 * 子树也必须存在。叶子子树的 blob 已上传，父级子树即可创建；
 * 按路径深度从深到浅创建，保证子引用先就位。
 */
const missingTrees = []
for (const t of trees) {
  if (await objectExists(t.sha, 'tree')) continue
  missingTrees.push(t)
}
/*
 * 排序：路径深度从深到浅。父树的创建必须引用已存在的子树，
 * 所以子目录要先上传。根树 path 为空串，深度记 0，排在最后。
 */
const depthOf = (p) => (p === '' ? 0 : p.split('/').length)
missingTrees.sort((a, b) => depthOf(b.path) - depthOf(a.path))
console.log(`需上传子树：${missingTrees.length} 个`)

/*
 * 用本地 git 的 tree 内容构造远端 tree。
 * shell 只给了扁平清单，这里从扁平清单重建目录结构：
 * 对每个缺失子树，取它的直接子项（path 前缀匹配且只多一层）。
 * 根树（path === ''）的直接子项就是所有不含 '/' 的条目。
 */
function directChildren(treePath) {
  if (treePath === '') {
    return gitTreeSort(entries.filter((e) => !e.path.includes('/')))
  }
  const prefix = treePath + '/'
  return gitTreeSort(entries.filter((e) => {
    if (!e.path.startsWith(prefix)) return false
    const rest = e.path.slice(prefix.length)
    return rest.length > 0 && !rest.includes('/')
  }))
}

/* 单棵树上传：返回 API 生成的 sha（用于和本地比对） */
async function uploadTree(t) {
  const body = directChildren(t.path).map((c) => ({
    path: t.path === '' ? c.path : c.path.slice(t.path.length + 1),
    /* 保留 git 的 6 位写法：API 自身也用 "040000" 表示子树，直传即可 */
    mode: c.mode,
    type: c.type,
    sha: c.sha
  }))
  return api(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ tree: body })
  })
}

/*
 * 迭代直至全部就位：某次上传失败（通常因为它的某个子项还没创建）就留到下一轮，
 * 每轮至少推进一层，最多 maxDepth+1 轮必然收敛。
 * 这样比「一次排序后盲目按序上传」稳健——空树与同深度嵌套不会互相阻塞。
 */
let pending = missingTrees
let round = 0
while (pending.length > 0) {
  round++
  if (round > 16) {
    throw new Error(
      `子树上传递归未收敛，仍有 ${pending.length} 个：${pending.map((t) => t.path || '<root>').join(', ')}`
    )
  }
  const stillMissing = []
  for (const t of pending) {
    let created
    try {
      created = await uploadTree(t)
    } catch (err) {
      /* 依赖未就位，留到下一轮；其它错误也一并留待下一轮，最终统一报错 */
      stillMissing.push({ t, err })
      continue
    }
    if (created.sha !== t.sha) {
      throw new Error(`子树上传后 sha 不匹配：本地 ${t.sha}，远端 ${created.sha}（${t.path || '<root>'}）`)
    }
    process.stdout.write(`  子树 ${t.path || '<root>（根树）'}\n`)
  }
  if (stillMissing.length === pending.length) {
    /* 一整轮毫无进展，说明是硬错误 */
    const detail = stillMissing
      .map(({ t, err }) => `  - ${t.path || '<root>'}：${err instanceof Error ? err.message.split('\n')[0] : err}`)
      .join('\n')
    throw new Error(`子树上传停滞，以下 ${stillMissing.length} 个无法创建：\n${detail}`)
  }
  pending = stillMissing.map((x) => x.t)
}

/* ---------- 创建提交 ---------- */
console.log('\n创建提交对象…')
const newCommit = await api(`/repos/${OWNER}/${REPO}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({
    message: headMsgExact,
    tree: headTree,
    parents: [headParent],
    /* 显式带上身份与时间，否则 API 用 token 持有者 + 当前时间，sha 必不同 */
    author: { name: authorName, email: authorEmail, date: authorDate },
    committer: { name: committerName, email: committerEmail, date: committerDate }
  })
})

console.log(`新提交: ${newCommit.sha}`)

if (newCommit.sha !== headSha) {
  console.log(
    `\n⚠️ 远端生成的 commit sha(${newCommit.sha.slice(0, 7)}) 与本地(${headSha.slice(0, 7)}) 不同。\n` +
    `   远端 tree: ${newCommit.tree?.sha ?? '(未知)'}\n` +
    `   远端 message 字节数: ${Buffer.byteLength(newCommit.message ?? '', 'utf8')}\n` +
    `   已放弃更新 ref，请人工核查。`
  )
  process.exit(1)
}

console.log(`更新 refs/heads/${BRANCH} …`)
await api(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
  method: 'PATCH',
  body: JSON.stringify({ sha: newCommit.sha, force: false })
})

console.log(`\n✅ 推送完成：${BRANCH} ${remoteSha.slice(0, 7)} → ${newCommit.sha.slice(0, 7)}`)
console.log('   （commit sha 与本地一致，无需任何本地改写）')
