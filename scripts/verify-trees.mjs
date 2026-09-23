/**
 * 离线校验：用 trees.tsv 重建每棵 git tree 对象，比对 sha 是否与本地一致。
 *
 * **为什么需要它**：树重建一旦出错，只有在真实推送时才会以
 * 「子树上传后 sha 不匹配」暴露出来，而一次推送要 6 分钟。
 * 这里在本地把同样的重建逻辑跑一遍（复刻 api-push.mjs 的 gitTreeSort
 * 与 git 的 tree 对象字节格式），几秒内就能定位到具体哪棵树、差在哪。
 *
 * 用法：node tmp/vt/verify-trees.mjs <trees.tsv>
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const tsvPath = process.argv[2]
if (!tsvPath) {
  console.error('用法：node tmp/vt/verify-trees.mjs <trees.tsv>')
  process.exit(2)
}

const map = new Map()
for (const line of readFileSync(tsvPath, 'utf8').split('\n')) {
  if (!line) continue
  const parts = line.split('\t')
  const kids = []
  /* 行格式：<treeSha> \t <meta> \t <name> \t <meta> \t <name> … */
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const meta = parts[i].split(/\s+/)
    kids.push({ mode: meta[0], type: meta[1], sha: meta[2], path: parts[i + 1] })
  }
  map.set(parts[0], kids)
}

/* 与 api-push.mjs 保持一致的排序：子树按「路径 + /」参与字节序比较 */
function gitTreeSort(children) {
  const key = (c) => {
    const b = Buffer.from(c.path, 'utf8')
    return c.type === 'tree' ? Buffer.concat([b, Buffer.from('/')]) : b
  }
  return [...children].sort((a, b) => Buffer.compare(key(a), key(b)))
}

/**
 * 归一化 mode：**子树必须写成 5 位的 `40000`**。
 *
 * `git ls-tree` 显示的是 6 位 `040000`，但 git 对象里实际写的是 `40000`
 * （无前导零）。按显示值去拼字节序列，含子树的树算出的 sha 必然不同：
 *   blob → `100644 <name>\0`（一致，所以纯 blob 的树全对）
 *   tree → ls-tree 给 `040000`，对象里是 `40000`（差一个字节 → sha 全错）
 * 这正是"41 棵纯 blob 树全对、18 棵含子树树全错"的原因。
 *
 * GitHub API 接受 `040000`（它会自行归一化），所以推送本身是安全的；
 * 但**离线校验必须复刻 git 的真实编码**，否则会误报。
 */
function normalizeMode(mode) {
  return mode === '040000' ? '40000' : mode
}

/* git tree 对象字节格式：<mode> <name>\0<20 字节二进制 sha> 串联 */
function treeSha(kids) {
  const chunks = []
  for (const c of gitTreeSort(kids)) {
    chunks.push(Buffer.from(normalizeMode(c.mode) + ' ' + c.path + '\0'))
    chunks.push(Buffer.from(c.sha, 'hex'))
  }
  const body = Buffer.concat(chunks)
  const header = Buffer.from('tree ' + body.length + '\0')
  return createHash('sha1').update(Buffer.concat([header, body])).digest('hex')
}

let ok = 0
let bad = 0
for (const [sha, kids] of map) {
  const calc = treeSha(kids)
  if (calc === sha) {
    ok++
    continue
  }
  bad++
  if (bad <= 5) {
    console.log('MISMATCH 本地 ' + sha + '\n         算出 ' + calc)
    console.log('         子项 ' + kids.map((k) => k.path).join(', '))
  }
}
console.log('\n树重建校验：' + ok + ' 棵一致，' + bad + ' 棵不一致（共 ' + map.size + '）')
process.exit(bad === 0 ? 0 : 1)
