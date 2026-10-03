#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
补齐远端缺失的 git 对象并创建提交 —— 定点版（比 api-push.mjs 的迭代器更直白、
且任何 4xx 都把响应体打出来）。

为什么不用 api-push.mjs：它 2026-09-25 那次卡在「子树上传停滞」——
`src` 与根树的 POST 返回 422，而 422 的成因（子对象不存在 / 条目重复 / mode 非法）
只报状态码分不出来。这里按 sha 自底向上补树，每一步都校验，失败即打印响应体。

输入（由 tmp/pushnow.sh 生成）：
  ls-tree.bin      `git ls-tree -r -t -z HEAD` 原样字节
  head.txt         HEAD 的 sha
  head-tree.txt    HEAD 的 tree sha
  remote.txt       远端 branch 顶点 sha
  commits/<i>.raw  三个提交对象的原文（`git cat-file commit <sha>`）
  order.txt        提交顺序（旧 → 新），每行一个 sha
"""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

OWNER, REPO = "samuel8171", "Quadrant-app"
API = "https://api.github.com"
D = Path(sys.argv[1] if len(sys.argv) > 1 else "tmp/pushdiag")
# 目标分支：默认 main，可用环境变量覆盖（首次推一个新分支时用）。
BRANCH = os.environ.get("PUSH_BRANCH", "main")
# 已存在的远端分支顶点（可为空 —— 首次推新分支时 branch 还不存在）。
# 它同时充当「孤儿保活提交」的 parent 与提交链的初始 parent。
# 首次推新分支时这里应当是**本地基准提交**（与远端 main 树等价的那个）。
remote = ""


def tok():
    t = os.environ.get("GH_TOKEN", "")
    if not t:
        sys.exit("缺少 GH_TOKEN")
    return t


TOK = tok()


def api(path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        API + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {TOK}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "quadrant-pushnow",
            **({"Content-Type": "application/json"} if data else {}),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def api_retry(path, method="GET", body=None, tries=6, what="", retry_4xx=()):
    """5xx（含空响应体的 500）与网络抖动都重试；4xx 是确定性错误，直接返回给调用方。

    2026-09-25 实测：密集建树时 GitHub 会零星返回 **500 且响应体为空**，
    不重试就会在链中途断掉（前面建的树白建）。退避 2/4/6/8 秒。
    """
    import time as _t

    code, text = -1, ""
    for i in range(tries):
        code, text = api(path, method=method, body=body)
        if code in (200, 201):
            return code, text
        if code != -1 and 400 <= code < 500 and code not in retry_4xx:
            return code, text
        if code in retry_4xx:
            print(f"    ↻ {what or path} → {code}（瞬态：刚建的对象读路径还没生效），{2 * (i + 1)}s 后重试")
        print(f"    ↻ {what or (method + ' ' + path)} → {code}，{2 * (i + 1)}s 后重试")
        _t.sleep(2 * (i + 1))
    return code, text


def parse_ls_tree(p):
    raw = Path(p).read_bytes()
    out = {}
    for rec in raw.split(b"\x00"):
        if not rec:
            continue
        meta, _, path = rec.partition(b"\t")
        mode, typ, sha = meta.decode().split()
        out[path.decode("utf-8")] = (mode, typ, sha)
    return out


def plan_from_lstree(binp, root_tree):
    """由**单个提交**的 `ls-tree -r -t -z` 输出，重建它引用的每一棵树。

    返回 [(treePath, treeSha, kids)]，其中 treePath 为 "" 表示该提交的根树。
    kids 是该树的**直接**子项（路径不含 `/`），已按 git 的树条目序排好。
    """
    objs = parse_ls_tree(binp)
    subs = [(p, v) for p, v in objs.items() if v[1] == "tree"]
    subs.append(("", ("040000", "tree", root_tree)))
    # 计算每个路径的"直接父路径"，用来把每个子项归到它所属的那棵树。
    #   一条记录 `p` 属于树 `T` ⟺ T 是 p 去掉最后一段后的前缀，且 / 分界。
    def parent_of(path):
        i = path.rfind("/")
        return path[:i] if i >= 0 else ""

    out = []
    for tpath, (mode, typ, sha) in subs:
        kids = []
        prefix = tpath + "/" if tpath else ""
        for p, (m, ty, s) in objs.items():
            if not p.startswith(prefix):
                continue
            rest = p[len(prefix):]
            # rest 里不含 `/` ⇒ 它是这棵树的直接子项。
            # 但前缀匹配有歧义风险（`a/bc` 以 `a/b` 开头却不同级），
            # 所以再用 parent_of 精确校验一次。
            if "/" in rest or parent_of(p) != tpath:
                continue
            kids.append({"path": rest, "mode": m, "type": ty, "sha": s})
        out.append((tpath, sha, git_tree_sort(kids)))
    return out


def git_tree_sort(entries):
    """git 的 tree 条目序：按名字原始字节升序，子树视作 `名字/`。"""
    return sorted(entries, key=lambda e: (e["path"] + ("/" if e["type"] == "tree" else "")).encode("utf-8"))


def ensure_ref(sha):
    """把目标分支 ref 指向 sha（已存在则 PATCH，不存在则 POST 新建）。

    ⭐ 这是"树可读"的必要条件：只有从某个 ref 可达的树，GET /git/trees/<sha> 才返回 200。
    """
    code, text = api(
        f"/repos/{OWNER}/{REPO}/git/refs/heads/{BRANCH}",
        method="PATCH",
        body={"sha": sha, "force": True},
    )
    if code == 200:
        return
    code2, text2 = api(
        f"/repos/{OWNER}/{REPO}/git/refs",
        method="POST",
        body={"ref": f"refs/heads/{BRANCH}", "sha": sha},
    )
    if code2 != 201:
        print(f"❌ 建/推 ref {BRANCH} → PATCH {code} / POST {code2}\n   {text[:200]}\n   {text2[:200]}")
        sys.exit(1)


def main():
    global remote
    head = (D / "head.txt").read_text().strip()
    remote = (D / "remote.txt").read_text().strip()
    if not remote:
        # 首次推这个分支：远端还没有顶点。用**远端已存在的父提交**作为挂载点，
        # 保证新分支是接在既有历史上、而不是一棵无根的历史。
        base = os.environ.get("PUSH_BASE", "")
        if not base:
            sys.exit("remote.txt 为空且未设 PUSH_BASE —— 无法确定新分支的挂载点")
        remote = base
        print(f"（远端分支不存在，用 PUSH_BASE={base[:8]} 作为挂载点）")

    # ⭐ 逐提交重建每棵树（含各自的根树）。
    #   为什么要逐提交、而不是把 ls-tree 合并成一个大字典：
    #   **根树没有路径**，它的直接子项就是该提交的顶层路径。一旦把多个提交的
    #   ls-tree 混进一个字典，"某棵根树有哪些子项"就无法还原（字典里是并集）。
    #   而且中间提交引用的树可能根本不在 HEAD 的树里（旧目录、内容不同的同名子树），
    #   只按 HEAD 建树 ⇒ 第一个中间提交就报 "Tree SHA does not exist"。
    plan = []
    seen = set()
    order = [l.strip() for l in (D / "order.txt").read_text().splitlines() if l.strip()]
    for csha in order:
        binp = D / "trees" / f"{csha}.bin"
        if not binp.exists():
            continue
        # 该提交的根树（从提交原文的 `tree ` 行取）
        ctree = None
        for l in (D / f"commits/{csha}.raw").read_bytes().split(b"\n\n")[0].decode().splitlines():
            if l.startswith("tree "):
                ctree = l[5:].strip()
        for tpath, sha, kids in plan_from_lstree(binp, ctree):
            key = (tpath, sha)
            if key in seen:
                continue
            seen.add(key)
            plan.append({"path": tpath, "sha": sha, "kids": kids})
    # 排序：深的先建（子树必须先于父树存在）
    plan.sort(key=lambda t: (0 if t["path"] == "" else t["path"].count("/") + 1), reverse=True)

    print(f"本地 trees：{len(plan)} 棵（跨 {len(order)} 个提交）；HEAD {head[:8]}；远端顶点 {remote[:8]}")

    # 先把目标分支 ref 建/推到挂载点 remote，之后每建一棵树就用一次「保活提交 + 推进 ref」。
    # ⭐ 2026-10-03 实测更正（本次首次推一个**全新分支**时挖出来的）：
    #   旧注释说"未被任何提交引用的树读 404" —— 只说对了一半。真正的判据是
    #   **"树必须从某个 ref 可达"**：仅被一个**孤儿提交**（自身不进任何 ref）引用的树，
    #   读回来**同样是 404**。证据链（同一棵 4a039029）：
    #     · POST /git/trees → 201，且响应体里 5 个 blob 条目齐全；
    #     · GET  /git/trees/4a039029 → 404（多次重试、等 5s 都一样）；
    #     · POST /git/commits 引用它 → 201；
    #     · GET  /git/trees/4a039029 → **仍 404**；
    #     · POST /git/refs 让一个分支指向那个提交 → **立刻 200**。
    #   ⇒ 所以每次建完树，要建的"保活提交"必须**立刻被 ref 指到**。
    #   旧脚本之所以一直没暴露这条，是因为它推的都是**已存在的分支**：
    #   建完树后提交链一路建下去、最后 PATCH ref，等 ref 一到位那些树就都活了 ——
    #   而中途"提交引用树"那一步依赖的正是**父树**，父树又依赖子树，于是只有
    #   **全新的、远端一棵都没有的子树**才会在建父树时炸出来（本次是 components/glass）。
    ensure_ref(remote)
    created = skipped = 0
    for t in plan:
        if not t["kids"]:
            continue
        code, _ = api_retry(f"/repos/{OWNER}/{REPO}/git/trees/{t['sha']}", what=f"探测树 {t['path'] or '<root>'}")
        if code == 200:
            skipped += 1
            continue
        code, text = api_retry(f"/repos/{OWNER}/{REPO}/git/trees", method="POST", body={"tree": t["kids"]}, what=f"建树 {t['path'] or '<root>'}", retry_4xx=(422,))
        if code != 201:
            print(f"❌ POST tree {t['path'] or '<root>'} ({t['sha'][:8]}) → {code}\n   {text[:600]}")
            sys.exit(1)
        got = json.loads(text)["sha"]
        if got != t["sha"]:
            print(f"❌ tree sha 不匹配：{t['path'] or '<root>'} 本地 {t['sha']} 远端 {got}")
            sys.exit(1)
        created += 1
        print(f"  ✓ 建树 {t['path'] or '<root>'} {got[:8]}（{len(t['kids'])} 条）")
        # ⭐ 保活：建一个引用这棵树的提交，并**立刻把分支 ref 推过去**，
        #   让这棵树进入"从 ref 可达"的对象图（这才是可读的充要条件）。
        #   这些提交是临时的：整条正式提交链建完之后，ref 会被推到真正的顶点，
        #   它们就自然变成不可达对象，GitHub 之后回收。
        rc, rt = api_retry(
            f"/repos/{OWNER}/{REPO}/git/commits",
            method="POST",
            body={
                "message": f"push tooling: keep tree {got[:10]} reachable ({t['path'] or '<root>'})",
                "tree": got,
                "parents": [remote],
            },
        )
        if rc != 201:
            print(f"❌ 让树 reachable 失败（{t['path'] or '<root>'}）→ {rc}\n   {rt[:300]}")
            sys.exit(1)
        ensure_ref(json.loads(rt)["sha"])
    print(f"建树完成：新建 {created}，远端已有 {skipped}")

    # 提交：按 order.txt 顺序，parent 依次串起来，元数据逐字节复刻
    order = [l.strip() for l in (D / "order.txt").read_text().splitlines() if l.strip()]
    parent = remote
    for sha in order:
        raw = (D / f"commits/{sha}.raw").read_bytes()
        head_part, _, msg = raw.partition(b"\n\n")
        tree = None
        author = committer = None
        for line in head_part.decode().splitlines():
            if line.startswith("tree "):
                tree = line[5:].strip()
            elif line.startswith("author "):
                author = line[7:]
            elif line.startswith("committer "):
                committer = line[10:]
        def person(s):
            # 形如 `Codex <codex@local> 1758...  +0800` → {name,email,date}
            name, _, rest = s.partition(" <")
            email, _, date = rest.partition("> ")
            ts, _, tz = date.rpartition(" ")
            import datetime
            d = datetime.datetime.fromtimestamp(int(ts), datetime.timezone.utc)
            iso = d.strftime("%Y-%m-%dT%H:%M:%S") + tz[:3] + ":" + tz[3:]
            return {"name": name, "email": email, "date": iso}

        code, text = api(
            f"/repos/{OWNER}/{REPO}/git/commits",
            method="POST",
            body={
                "message": msg.decode("utf-8"),
                "tree": tree,
                "parents": [parent],
                "author": person(author),
                "committer": person(committer),
            },
        )
        if code != 201:
            print(f"❌ 创建提交 {sha[:8]} → {code}\n   {text[:600]}")
            sys.exit(1)
        got = json.loads(text)["sha"]
        ok = "✓" if got == sha else "✗ sha 不一致（远端历史会与本地不同）"
        print(f"  {ok} 提交 {got[:8]}（本地 {sha[:8]}）parent={parent[:8]}")
        parent = got

    # 最后把 ref 推到真正的顶点。此前 ref 一直被保活提交推着走，
    # 这一步之后那些临时提交就不可达了（GitHub 回收），历史只剩正式提交链。
    ensure_ref(parent)
    ok = "✅" if parent == head else "⚠️"
    print(f"\n{ok} {BRANCH} → {parent[:8]}（本地 HEAD {head[:8]}）")
    if parent != head:
        print("   ⚠️ 远端顶点与本地 HEAD 的 sha 不一致：远端历史与本地不同（元数据差异所致）")


if __name__ == "__main__":
    main()
