#!/usr/bin/env bash
# 补齐远端缺失的 **blob**（GitHub Git Data API）。
#
# 为什么单独一步：tmp/pushnow.py 只建树与提交，它引用的 blob 必须先在远端存在
# （上一轮是靠 api-push.mjs 那 9 分钟把这些 blob 传完的）。
# 差异集取 `9bc9feb..HEAD`：远端顶点 83435118 的树与本地 9bc9feb 的树逐字节相同，
# 所以这段 diff 就是"远端还没有的对象"。
set -euo pipefail
cd "$(dirname "$0")/.."
PY="${PYTHON_BIN:-C:/Users/Samuel/AppData/Local/Programs/Python/Python313/python.exe}"
BASE="${BASE_COMMIT:-9bc9feb}"
OUT=tmp/pushblobs
rm -rf "$OUT" && mkdir -p "$OUT/blobs"

GH_TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' \
  | git -c credential.helper=manager credential fill 2>/dev/null \
  | sed -n 's/^password=//p')
[ -n "$GH_TOKEN" ] || { echo "❌ 取不到 token"; exit 1; }
export GH_TOKEN

git diff-tree -r --no-commit-id --name-only "$BASE" HEAD > "$OUT/changed.txt"
: > "$OUT/blobs.tsv"
while read -r path; do
  [ -n "$path" ] || continue
  [ "$(git cat-file -t "HEAD:$path" 2>/dev/null || echo none)" = "blob" ] || continue
  sha=$(git rev-parse "HEAD:$path")
  printf '%s\t%s\n' "$sha" "$path" >> "$OUT/blobs.tsv"
  git cat-file blob "$sha" | base64 -w0 > "$OUT/blobs/$sha.b64"
done < "$OUT/changed.txt"

echo "差异集：$(wc -l < "$OUT/blobs.tsv") 个 blob（基准 $BASE → HEAD）"
"$PY" scripts/api-push-blobs.py "$OUT"
