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
HEAD_MSG_B64=$(printf '%s' "$HEAD_MSG" | "$PYTHON_BIN" -c "import sys,base64; sys.stdout.write(base64.b64encode(sys.stdin.buffer.read()).decode())")

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
# 「新提交的完整 tree 快照」导出成一个清单文件，交给 Node 上传。
#
# 导出内容（TSV，每行）：<object_type>\t<sha>\t<path|->\t<mode>
#   - tree 由 git 自身表示，blob 需要二进制内容
# 二进制内容单独存到临时目录，避免混在文本清单里。
##############################################################################

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "导出本地对象清单…"
# 全量递归列出 HEAD 的 tree（含所有子树与 blob）。
#
# 必须带 -z：不加时 git 会对含非 ASCII 字节的路径做 C 风格引用
# （形如 "ChatGPT Image 2026\345\271\2648..."，带引号与八进制转义）。
# 若把这种文本原样当路径发给 API，重建出的 tree 与本地不等价（sha 不同），
# 报「子树上传后 sha 不匹配」。-z 输出以 NUL 分隔、路径原样不加引号。
git -c core.quotepath=false ls-tree -r -t -z HEAD > "$WORK/tree.z"

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

export OBJ_WORKDIR="$WORK"
node scripts/api-push.mjs --branch "$BRANCH"
