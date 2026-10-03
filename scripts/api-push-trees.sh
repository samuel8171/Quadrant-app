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
# 远端分支顶点：分支不存在时接口返回 404（JSON 里没有 object 键）⇒ 写空文件。
# 此时 PUSH_BASE 必须由调用方给出**远端已有的**提交 sha。⚠️ 不能给本地等价提交的 sha：
# 本地基准提交与远端那个"树逐字节相同"的提交**是两个不同的对象**（后端上一次推送
# 用了不同的 author/committer 元数据 ⇒ sha 不同），GitHub 只认已经存在的那一个。
curl -s --noproxy '*' \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/samuel8171/Quadrant-app/git/ref/heads/$BRANCH" \
  | "$PY" -c "import json,sys
try:
    print(json.load(sys.stdin)['object']['sha'])
except Exception:
    print('')" > tmp/pushdiag/remote.txt

# 本次要推的提交：**本地**这一段（旧 → 新）。
#
# 为什么不用 `$(remote.txt)..HEAD`：远端顶点是 API 建的提交，从来没被 fetch 下来过
# （本机 git-over-HTTPS 不通），本地没有那个对象 ⇒ rev-list 直接报 unknown revision。
# 改用"树等价的本地基准"：远端顶点的树 == 本地某个提交的树（这里是 7ca5856），
# 于是 `7ca5856..HEAD` 就是要补的那几个提交。
LOCAL_BASE="${LOCAL_BASE:-7ca5856}"
git rev-list --reverse "$LOCAL_BASE..HEAD" > tmp/pushdiag/order.txt
: > tmp/pushdiag/commits/.keep
while read -r sha; do
  [ -n "$sha" ] || continue
  git cat-file commit "$sha" > "tmp/pushdiag/commits/$sha.raw"
done < tmp/pushdiag/order.txt

echo "待推提交：$(wc -l < tmp/pushdiag/order.txt) 个"
cat tmp/pushdiag/order.txt | while read -r sha; do [ -n "$sha" ] && git log -1 --format='  %h %s' "$sha"; done

# ⚠️ 关键：中间提交引用的树**不一定在 HEAD 的树里**（例如旧版本里存在、后来删掉的目录，
#    或路径相同但内容不同的子树）。只按 HEAD 建树会让第一个中间提交就报
#    "Tree SHA does not exist"。所以把**每个待推提交**的完整树清单各存一份，
#    由 Python 侧逐提交重建每棵树（含各自的根树）。
rm -rf tmp/pushdiag/trees && mkdir -p tmp/pushdiag/trees
while read -r sha; do
  [ -n "$sha" ] || continue
  git ls-tree -r -t -z "$sha" > "tmp/pushdiag/trees/$sha.bin"
done < tmp/pushdiag/order.txt

# PUSH_BASE 是**新分支的挂载点**，必须是远端已存在对象的完整 40 位 sha。
#   ① 分支已存在 → remote.txt 有值，Python 侧直接用，PUSH_BASE 会被忽略；
#   ② 分支不存在 → 必须显式传 PUSH_BASE=<远端父提交的完整 sha>；
#      若只给了本地等价提交的短 sha，会得到 422 "Parent SHA does not exist"。
PUSH_BRANCH="$BRANCH" PUSH_BASE="${PUSH_BASE:-$LOCAL_BASE}" "$PY" scripts/api-push-trees.py tmp/pushdiag
