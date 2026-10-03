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

# ⚠️ 收集范围不能用 `git diff-tree BASE HEAD`：那只覆盖"首尾差异"。
#    中间提交如果**新增过又删掉了**某个文件（本项目典型：mine/BalanceWidget.tsx
#    在 78dcb19 新增、后来又改过），它的旧版本 blob 不在首尾差异里，但构建那条
#    中间提交的树时需要它 ⇒ 报 `tree.sha ... is not a valid blob`（422）。
#    所以改成：**待推范围内所有提交引用到的 (blob, path) 对**。
#    另外同一路径会有多个版本（同一个路径的新旧 blob），必须**全部**推送，
#    不能只挑一个 —— 那正是本次卡住的第二个原因。
: > "$OUT/pairs.txt"
git rev-list "$BASE"..HEAD \
  | while read -r c; do git ls-tree -r "$c" --format='%(objectname) %(path)'; done \
  | sort -u > "$OUT/pairs.txt"

: > "$OUT/blobs.tsv"
seen_sha="$OUT/.seen_sha"
: > "$seen_sha"
while read -r sha path; do
  [ -n "$sha" ] && [ -n "$path" ] || continue
  [ "$(git cat-file -t "$sha" 2>/dev/null || echo none)" = "blob" ] || continue
  # 同一个 blob 可能在多个路径出现 ⇒ 去重，避免重复 POST。
  grep -qxF "$sha" "$seen_sha" && continue
  echo "$sha" >> "$seen_sha"
  printf '%s\t%s\n' "$sha" "$path" >> "$OUT/blobs.tsv"
  git cat-file blob "$sha" | base64 -w0 > "$OUT/blobs/$sha.b64"
done < "$OUT/pairs.txt"

echo "差异集：$(wc -l < "$OUT/blobs.tsv") 个 blob（基准 $BASE → HEAD）"
"$PY" scripts/api-push-blobs.py "$OUT"
