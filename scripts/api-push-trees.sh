#!/usr/bin/env bash
# 定点推送：shell 侧收集对象清单与提交元数据，Python 侧补对象并建提交。
set -euo pipefail
cd "$(dirname "$0")/.."
PY="${PYTHON_BIN:-C:/Users/Samuel/AppData/Local/Programs/Python/Python313/python.exe}"
BRANCH="${BRANCH:-main}"

GH_TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' \
  | git -c credential.helper=manager credential fill 2>/dev/null \
  | sed -n 's/^password=//p')
[ -n "$GH_TOKEN" ] || { echo "❌ 取不到 token"; exit 1; }
export GH_TOKEN

mkdir -p tmp/pushdiag/commits
git rev-parse HEAD > tmp/pushdiag/head.txt
git rev-parse 'HEAD^{tree}' > tmp/pushdiag/head-tree.txt
git ls-tree -r -t -z HEAD > tmp/pushdiag/ls-tree.bin
curl -s --noproxy '*' \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/samuel8171/Quadrant-app/git/ref/heads/$BRANCH" \
  | "$PY" -c "import json,sys; print(json.load(sys.stdin)['object']['sha'])" > tmp/pushdiag/remote.txt

# 本次要推的提交：**本地**这一段（旧 → 新）。
#
# 为什么不用 `$(remote.txt)..HEAD`：远端顶点是 API 建的提交，从来没被 fetch 下来过
# （本机 git-over-HTTPS 不通），本地没有那个对象 ⇒ rev-list 直接报 unknown revision。
# 改用"树等价的本地基准"：远端顶点的树 == 本地某个提交的树（这里是 9bc9feb），
# 于是 `9bc9feb..HEAD` 就是要补的那几个提交。
LOCAL_BASE="${LOCAL_BASE:-9bc9feb}"
git rev-list --reverse "$LOCAL_BASE..HEAD" > tmp/pushdiag/order.txt
: > tmp/pushdiag/commits/.keep
while read -r sha; do
  [ -n "$sha" ] || continue
  git cat-file commit "$sha" > "tmp/pushdiag/commits/$sha.raw"
done < tmp/pushdiag/order.txt

echo "待推提交：$(wc -l < tmp/pushdiag/order.txt) 个"
cat tmp/pushdiag/order.txt | while read -r sha; do [ -n "$sha" ] && git log -1 --format='  %h %s' "$sha"; done
"$PY" scripts/api-push-trees.py tmp/pushdiag
