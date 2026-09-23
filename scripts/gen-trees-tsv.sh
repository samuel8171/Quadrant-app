#!/usr/bin/env bash
#
# 导出 trees.tsv：按 **sha** 索引的「每棵树的直接子项」映射，供离线校验使用。
#
# 与 api-push.sh 里生成 trees.tsv 的那段逻辑保持一致；单独拆出来是为了
# **在不推送的情况下**先校验树重建是否正确（推送一次要 5-6 分钟，
# 而树重建的 bug 只在推送末尾才暴露）。
#
# 用法：
#   REMOTE_SHA=<远端当前 sha> bash scripts/gen-trees-tsv.sh [输出路径]
#   node scripts/verify-trees.mjs <输出路径>
#
# 缺省输出：tmp/vt/trees.tsv
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${1:-tmp/vt/trees.tsv}"
PYTHON_BIN="${PYTHON_BIN:-C:/Users/Samuel/.workbuddy/binaries/python/versions/3.13.12/python.exe}"

# 远端顶点：只导出它之后的新提交。不传则只处理 HEAD。
REMOTE_SHA="${REMOTE_SHA:-}"
if [ -z "$REMOTE_SHA" ]; then
  REMOTE_SHA=$(curl -s --noproxy '*' \
    "https://api.github.com/repos/samuel8171/Quadrant-app/git/ref/heads/${BRANCH:-main}" \
    | "$PYTHON_BIN" -c "import sys,json;print(json.load(sys.stdin).get('object',{}).get('sha',''))" 2>/dev/null || echo "")
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

if [ -n "$REMOTE_SHA" ] && git cat-file -e "$REMOTE_SHA^{commit}" 2>/dev/null; then
  CHAIN_LIST=$(git rev-list --reverse "$REMOTE_SHA..HEAD")
else
  echo "⚠️ 无法解析远端顶点，只导出 HEAD" >&2
  CHAIN_LIST=$(git rev-parse HEAD)
fi
echo "提交链：$(printf '%s\n' "$CHAIN_LIST" | grep -c .) 个"

# 链上每个提交的完整对象清单（含子树与 blob），按 NUL 记录去重。
# 必须覆盖整条链：中间提交的 tree 里可能有已从 HEAD 改掉的条目。
: > "$WORK/tree.z"
while read -r csha; do
  [ -z "$csha" ] && continue
  git -c core.quotepath=false ls-tree -r -t -z "$csha" >> "$WORK/tree.z"
done <<< "$CHAIN_LIST"

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
open(sys.argv[1], 'wb').write(b'\0'.join(out) + (b'\0' if out else b''))
PY

# 各提交的根树 sha
: > "$WORK/roots.txt"
while read -r csha; do
  [ -z "$csha" ] && continue
  git rev-parse "$csha^{tree}" >> "$WORK/roots.txt"
done <<< "$CHAIN_LIST"

mkdir -p "$(dirname "$OUT")"
: > "$OUT"
{
  # 清单里所有 type=tree 的 sha。
  # 必须走 sys.stdout.buffer：Windows 上 Python 的 stdout 在管道里是文本模式，
  # 会把 '\n' 翻成 '\r\n'，污染下游 read 到的 sha。
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
  cat "$WORK/roots.txt"
} | tr -d '\r' | sort -u | while read -r tsha; do
  [ -z "$tsha" ] && continue
  # `ls-tree` 失败与"空树"输出都是空，无法区分——先显式确认对象存在。
  if ! git cat-file -e "$tsha^{tree}" 2>/dev/null; then
    echo "❌ 本地对象库缺少树 $tsha" >&2
    exit 1
  fi
  line="$tsha"
  while IFS= read -r -d '' entry; do
    meta="${entry%%$'\t'*}"
    name="${entry#*$'\t'}"
    line="$line"$'\t'"$meta"$'\t'"$name"
  done < <(git -c core.quotepath=false ls-tree -z "$tsha")
  printf '%s\n' "$line" >> "$OUT"
done

echo "写出 $OUT：$(wc -l < "$OUT") 棵"
