#!/usr/bin/env bash
#
# 通过 GitHub REST API 推送当前 HEAD —— 完整版（会补齐缺失的 git 对象）。
#
# 背景：本机 git 传输通道不通（配置里的代理 127.0.0.1:7897 已死；环境变量的
# 14829 只应付得了小请求，push 会 schannel 中断 / 502；直连也不通）。
# 而 api.github.com 直连稳定，故改走 Git Data API。
#
# 流程：
#   1. shell 侧导出本地 HEAD 的 tree、以及相对远端缺失的对象清单
#      （Node 侧 spawn git 会被沙箱拦成 EBUSY，所以 git 操作全在这里做）
#   2. Node 侧对照远端已有对象，逐个 PUT 缺失的 blob/tree
#   3. 创建 commit 并更新 ref
#
# 用法：
#   bash scripts/api-push.sh --dry-run   # 只检查条件与缺口
#   bash scripts/api-push.sh             # 实推
#
set -euo pipefail

cd "$(dirname "$0")/.."

BRANCH="${BRANCH:-main}"
MODE="${1:-}"

# 受管 Python（本机 Python 3.13.12）。用于把 git 的 NUL 分隔输出转成安全文本，
# 避免 bash 处理非 ASCII 路径时踩编码坑。
PYTHON_BIN="${PYTHON_BIN:-C:/Users/Samuel/.workbuddy/binaries/python/versions/3.13.12/python.exe}"

# 凭据：从 Windows 凭据管理器取（系统的 helper-selector 是交互式的，
# 叠加 GIT_TERMINAL_PROMPT=0 会让非交互调用直接失败，故指名 manager）。
# 提前到这里取，因为下面算远端祖先关系时就要用 token 调 API。
GH_TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' \
  | git -c credential.helper=manager credential fill 2>/dev/null \
  | sed -n 's/^password=//p')
if [ -z "$GH_TOKEN" ]; then
  echo "❌ 未能从凭据管理器取出 token" >&2
  exit 1
fi
export GH_TOKEN

HEAD_SHA=$(git rev-parse HEAD)
HEAD_TREE=$(git rev-parse 'HEAD^{tree}')
HEAD_PARENT=$(git rev-parse 'HEAD^')

# 远端顶点是否为本地 HEAD 的祖先。
#
# 本地一次可能攒了多个未推提交（本脚本一次只推一个），此时 HEAD^ 是上一个
# **本地**提交而非远端顶点，光靠等值比较会被误判成"远端有新提交"。
# 远端顶点先经 API 取回来（shell 里没有远程跟踪引用可用），再在本地算祖先关系。
# 取不到远端 sha 时留空，Node 侧会退回严格的等值判断——宁可保守也不要漏掉真分叉。
REMOTE_SHA=$(curl -s --noproxy '*' \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/samuel8171/Quadrant-app/git/ref/heads/$BRANCH" 2>/dev/null \
  | "$PYTHON_BIN" -c "import sys,json;print(json.load(sys.stdin).get('object',{}).get('sha',''))" 2>/dev/null || echo "")

REMOTE_IS_ANCESTOR=0
if [ -n "$REMOTE_SHA" ] && git merge-base --is-ancestor "$REMOTE_SHA" "$HEAD_SHA" 2>/dev/null; then
  REMOTE_IS_ANCESTOR=1
fi

# commit message 必须与本地逐字节一致，否则远端算出的 commit sha 会不同。
# 坑 1：`$(git log --format=%B)` 的命令替换会吃掉**所有**行尾换行，而 git 的
#       commit 对象要求 message 末尾恰好有一个 \n。故显式补回一个。
# 坑 2：把消息塞进 JSON 字符串时要经过两层转义（shell → JSON），行尾空白与
#       尾部换行极易被吞。改为走 base64：先在这里编码，Node 侧原样透传
#       给 API 的 `?` —— 但 Git Data API 的 commits 端点不吃 base64，
#       所以 Node 侧解码后写入 JSON，编码环节完全绕开 shell 转义。
HEAD_MSG=$(git log -1 --format=%B | sed -e 's/[[:space:]]*$//')
HEAD_MSG="${HEAD_MSG}
"
HEAD_MSG_B64=$(printf '%s' "$HEAD_MSG" | "$PYTHON_BIN" -c "import sys,base64; sys.stdout.buffer.write(base64.b64encode(sys.stdin.buffer.read()))")

# 作者/提交者：Git Data API 默认用 token 持有者身份与当前时间建提交，
# 那会算出与本地不同的 sha。这里的做法是**取本地 commit 的原始
# author/committer 行**（含姓名、邮箱、Unix 时间戳、时区偏移），
# 原样透传给 API，从而复刻出逐字节相同的提交对象。
HEAD_AUTHOR_NAME=$(git log -1 --format=%an)
HEAD_AUTHOR_EMAIL=$(git log -1 --format=%ae)
HEAD_AUTHOR_DATE=$(git log -1 --format=%aI)
HEAD_COMMITTER_NAME=$(git log -1 --format=%cn)
HEAD_COMMITTER_EMAIL=$(git log -1 --format=%ce)
HEAD_COMMITTER_DATE=$(git log -1 --format=%cI)

export HEAD_SHA HEAD_TREE HEAD_PARENT HEAD_MSG GH_TOKEN
export HEAD_AUTHOR_NAME HEAD_AUTHOR_EMAIL HEAD_AUTHOR_DATE
export HEAD_COMMITTER_NAME HEAD_COMMITTER_EMAIL HEAD_COMMITTER_DATE
export HEAD_MSG_B64
export REMOTE_IS_ANCESTOR

if [ "$MODE" = "--dry-run" ]; then
  node scripts/api-push.mjs --branch "$BRANCH" --dry-run
  exit $?
fi

##############################################################################
# 实推：需要把本地对象补到远端。Node 侧不能 spawn git，所以在这里把
# 「待推提交的完整链」导出成一份清单，交给 Node 逐个创建。
#
# 为什么是**一整条链**而不是只有 HEAD：
# Git Data API 建提交时 parents 必须已存在于远端对象库。本地攒了多个未推
# 提交时，HEAD 的 parent 是上一个**本地**提交、远端还没有，直接建 HEAD
# 会报 `422 Parent SHA does not exist or is not a commit object`。
# 所以先把链上最老的提交建出来，再依次往上建。
#
# 导出格式（TSV，每行一个提交，**由老到新**）：
#   sha \t tree \t parent(首父，可为空) \t authorName \t authorEmail \t
#   authorDate \t committerName \t committerEmail \t committerDate \t msgB64
# 其中 msgB64 走 base64，避免 shell/JSON 双层转义吞掉行尾换行。
# 二进制内容（blob）单独存到临时目录，避免混在文本清单里。
##############################################################################

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "导出本地对象清单…"

##############################################################################
# 待创建的提交链（由老到新）。**必须先算出来**，因为对象清单要覆盖链上每一个
# 提交的 tree——而不只是 HEAD 的。
#
# 坑：只导出 HEAD 的 `ls-tree` 是不够的。中间提交的 tree 里可能有**已从 HEAD
# 删掉/改掉**的条目（本次就有一个：滑块回退那次改了 theme.css，该文件的旧版本
# 只存在于 4cc0d62 的 tree 中，HEAD 里已换成新版本）。那棵中间 tree 因此不在
# 清单里，创建它时报 `422 Tree SHA does not exist`。
#
# 起点是「远端顶点」之后的第一个提交；终点是 HEAD。远端顶点已在前面取到
# （REMOTE_SHA）；取不到时退化成只处理 HEAD。
##############################################################################
CHAIN_BASE="$REMOTE_SHA"
if [ -z "$CHAIN_BASE" ] || ! git cat-file -e "$CHAIN_BASE^{commit}" 2>/dev/null; then
  # 远端顶点不在本地对象库里（少见：远端有本地没 fetch 的提交）。
  # 此时只能保守地只推 HEAD，让 Node 侧的祖先判定去决定是否放行。
  CHAIN_BASE=""
fi

if [ -n "$CHAIN_BASE" ]; then
  CHAIN_LIST=$(git rev-list --reverse "$CHAIN_BASE..HEAD")
else
  CHAIN_LIST="$HEAD_SHA"
fi
CHAIN_COUNT=$(printf '%s\n' "$CHAIN_LIST" | grep -c . || true)
echo "待创建的提交：$CHAIN_COUNT 个"

# 依次列出链上每个提交的完整 tree（含所有子树与 blob），去重后合成一份清单。
#
# 必须带 -z：不加时 git 会对含非 ASCII 字节的路径做 C 风格引用
# （形如 "ChatGPT Image 2026\345\271\2648..."，带引号与八进制转义）。
# 若把这种文本原样当路径发给 API，重建出的 tree 与本地不等价（sha 不同），
# 报「子树上传后 sha 不匹配」。-z 输出以 NUL 分隔、路径原样不加引号。
: > "$WORK/tree.z"
while read -r csha; do
  [ -z "$csha" ] && continue
  git -c core.quotepath=false ls-tree -r -t -z "$csha" >> "$WORK/tree.z"
done <<< "$CHAIN_LIST"

# 去重：不同提交会重复列出大量相同条目（sha 相同即内容相同）。
# 按 NUL 记录切分后去重，再写回 NUL 分隔形式——保持与 -z 输出一致。
#
# 注意：这里去重保留的是**原始记录**（mode+type+sha+path 全同才算重复）。
# 同一路径在不同提交下内容不同 → sha 不同 → **两条都保留**。
# 这正是必须的：tree 对象由 sha 唯一标识，不能按路径归并。
"$PYTHON_BIN" - "$WORK/tree.z" <<'PY'
import sys
raw = open(sys.argv[1], 'rb').read()
seen = set()
out = []
for rec in raw.split(b'\0'):
    if not rec or rec in seen:
        continue
    seen.add(rec)
    out.append(rec)
with open(sys.argv[1], 'wb') as f:
    f.write(b'\0'.join(out) + (b'\0' if out else b''))
PY

# 各提交的**根树** sha。
#
# 根树必须单独传：`git ls-tree -r -t <commit>` 只列「有路径的条目」，根树自身
# 没有路径、永远不出现。漏掉它 → 建提交时 422 "Tree SHA does not exist"。
# 链上每个提交的根树都不同（内容不同），因此要逐个给。
: > "$WORK/roots.txt"
while read -r csha; do
  [ -z "$csha" ] && continue
  git rev-parse "$csha^{tree}" >> "$WORK/roots.txt"
done <<< "$CHAIN_LIST"

##############################################################################
# 导出「每棵树的直接子项」映射：trees.tsv，每行
#   <treeSha> \t <mode> <type> <childSha> \t <childName> \t …
#
# **为什么必须按 sha 索引、而不是按路径**：
# 同一路径在不同提交下内容不同（本次实测 `src/renderer/src` 有 7ffd9b5 与
# 0ed08e6 两个 sha）。若按路径匹配"直接子项"，两棵同名树的孩子会被混在一起，
# 重建出的 tree 内容错误 → 报「子树上传后 sha 不匹配」。
#
# 用 `ls-tree <treeSha>`（非 -r）逐个树取直接子项即可，天然按 sha 区分。
# 需要导出的树 = 清单里所有 type=tree 的条目 + 各提交的根树。
##############################################################################
: > "$WORK/trees.tsv"
{
  # 清单里所有子树（去重后已是唯一 (sha,path) 组合）。
  #
  # **必须写 sys.stdout.buffer**：Windows 上 Python 的 stdout 在**管道**里是文本
  # 模式，会把 '\n' 翻译成 '\r\n'。下游 `read -r` 拿到的 sha 就变成 "0728...\r"，
  # 拼成 "<sha>\r^{tree}" 是非法对象名，校验必然失败（症状极具误导性：明明本地
  # 有这个对象却报"缺少树"）。走 buffer 写字节，换行不受任何翻译。
  "$PYTHON_BIN" - "$WORK/tree.z" <<'PY'
import sys
raw = open(sys.argv[1], 'rb').read()
out = []
for rec in raw.split(b'\0'):
    if not rec:
        continue
    meta, _, path = rec.partition(b'\t')
    parts = meta.split()
    if len(parts) >= 2 and parts[1] == b'tree':
        out.append(parts[2])
sys.stdout.buffer.write(b'\n'.join(out) + (b'\n' if out else b''))
PY
  # 各提交的根树
  cat "$WORK/roots.txt"
} | tr -d '\r' | sort -u | while read -r tsha; do
  [ -z "$tsha" ] && continue
  # 空树（无子项）是合法的，但 `ls-tree` 失败也是空输出——两者无法从输出区分。
  # 所以先显式校验对象确实存在且是 tree，避免把"查不到"当成"空树"静默写进映射
  # （那会重建出一棵错误的空树，报莫名其妙的 sha 不匹配）。
  #
  # 上游的 `tr -d '\r'` 是防御性的：即便某处仍有 Windows 换行翻译，也不会污染 sha。
  if ! git cat-file -e "$tsha^{tree}" 2>/dev/null; then
    echo "❌ 本地对象库缺少树 $tsha，无法导出其子项" >&2
    exit 1
  fi
  line="$tsha"
  while IFS= read -r -d '' entry; do
    meta="${entry%%$'\t'*}"
    name="${entry#*$'\t'}"
    line="$line"$'\t'"$meta"$'\t'"$name"
  done < <(git -c core.quotepath=false ls-tree -z "$tsha")
  printf '%s\n' "$line" >> "$WORK/trees.tsv"
done

echo "  树映射：$(wc -l < "$WORK/trees.tsv") 棵（按 sha 索引）"

# 把 NUL 分隔的记录转成「meta<TAB>path」的按行格式（供 Node 侧解析）。
# 注意：路径本身可能含任何字符，但**不含 TAB 与换行**（git 保证），故 TAB 分隔安全。
"$PYTHON_BIN" - "$WORK/tree.z" "$WORK/tree.txt" <<'PY'
import sys
raw = open(sys.argv[1], 'rb').read()
out = []
for rec in raw.split(b'\0'):
    if not rec:
        continue
    meta, _, path = rec.partition(b'\t')
    out.append(meta.decode('ascii') + '\t' + path.decode('utf-8', 'surrogateescape'))
with open(sys.argv[2], 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n'.join(out) + '\n')
PY

# 逐个导出 blob 的原始内容（用 cat-file 拿字节流，不经文本层）
BLOB_COUNT=0
while IFS=$'\t' read -r meta path; do
  set -- $meta
  mode="$1"; type="$2"; sha="$3"
  if [ "$type" = "blob" ]; then
    printf '%s' "$sha" >> "$WORK/blobs.txt"
    printf '\n' >> "$WORK/blobs.txt"
    git cat-file blob "$sha" > "$WORK/blob-$sha.bin"
    BLOB_COUNT=$((BLOB_COUNT + 1))
  fi
done < "$WORK/tree.txt"

echo "  子树与 blob 条目：$(wc -l < "$WORK/tree.txt")，其中 blob：$BLOB_COUNT"

##############################################################################
# 逐提交导出 tree / 首父 / 身份 / message 到 TSV（CHAIN_LIST 已在上面算好）。
# 身份必须逐字复刻，否则 API 生成的 sha 与本地不同（会拒绝更新 ref）。
##############################################################################
: > "$WORK/commits.tsv"
while read -r csha; do
  [ -z "$csha" ] && continue
  ctree=$(git rev-parse "$csha^{tree}")
  # 首父：根提交没有 parent，此时留空。
  cparent=$(git rev-parse "$csha^" 2>/dev/null || true)
  can=$(git log -1 --format=%an "$csha")
  cae=$(git log -1 --format=%ae "$csha")
  cad=$(git log -1 --format=%aI "$csha")
  ccn=$(git log -1 --format=%cn "$csha")
  cce=$(git log -1 --format=%ce "$csha")
  ccd=$(git log -1 --format=%cI "$csha")
  # message 走 base64：命令替换会剥掉所有行尾换行（commit 对象要求末尾恰一个 \n），
  # 而经 shell → JSON 两层转义也极易被吞。base64 让字节完全不变。
  cmsg=$(git log -1 --format=%B "$csha" | sed -e 's/[[:space:]]*$//')
  cmsg="${cmsg}
"
  cmsg_b64=$(printf '%s' "$cmsg" | "$PYTHON_BIN" -c "import sys,base64; sys.stdout.buffer.write(base64.b64encode(sys.stdin.buffer.read()))")
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$csha" "$ctree" "$cparent" "$can" "$cae" "$cad" "$ccn" "$cce" "$ccd" "$cmsg_b64" \
    >> "$WORK/commits.tsv"
done <<< "$CHAIN_LIST"

export OBJ_WORKDIR="$WORK"
export COMMITS_TSV="$WORK/commits.tsv"
export ROOTS_FILE="$WORK/roots.txt"
export TREES_TSV="$WORK/trees.tsv"
node scripts/api-push.mjs --branch "$BRANCH"
