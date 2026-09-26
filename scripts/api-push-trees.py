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

OWNER, REPO, BRANCH = "samuel8171", "Quadrant-app", "main"
API = "https://api.github.com"
D = Path(sys.argv[1] if len(sys.argv) > 1 else "tmp/pushdiag")


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


def git_tree_sort(entries):
    """git 的 tree 条目序：按名字原始字节升序，子树视作 `名字/`。"""
    return sorted(entries, key=lambda e: (e["path"] + ("/" if e["type"] == "tree" else "")).encode("utf-8"))


def main():
    objs = parse_ls_tree(D / "ls-tree.bin")
    head = (D / "head.txt").read_text().strip()
    remote = (D / "remote.txt").read_text().strip()

    # 每棵树的路径（-r -t 会列出所有子树及其完整路径）
    trees = [(p, v) for p, v in objs.items() if v[1] == "tree"]
    trees.append(("", ("040000", "tree", (D / "head-tree.txt").read_text().strip())))
    # 直接子项：全局清单里以 `<treePath>/` 开头、且其后不再有 `/` 的项
    by_path = objs
    plan = []
    for tpath, (mode, typ, sha) in trees:
        prefix = tpath + "/" if tpath else ""
        kids = []
        for p, (m, ty, s) in by_path.items():
            if not p.startswith(prefix):
                continue
            rest = p[len(prefix):]
            if "/" in rest:
                continue
            kids.append({"path": rest, "mode": m, "type": ty, "sha": s})
        plan.append({"path": tpath, "sha": sha, "kids": git_tree_sort(kids)})
    plan.sort(key=lambda t: (0 if t["path"] == "" else t["path"].count("/") + 1), reverse=True)

    print(f"本地 trees：{len(plan)} 棵；HEAD {head[:8]}；远端顶点 {remote[:8]}")
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
        # ⭐ 关键一步：立刻用一个**孤儿提交**把这个树变成 reachable。
        #   为什么必须这么做（2026-09-25 实测）：
        #     · API 建的树**能被提交引用**（POST /git/commits 返回 201），
        #     · 但 GitHub 校验「父树的子项」时走的是"按 sha 读树"这条读路径，
        #       对**未被任何提交引用**的树返回 404 ⇒ 父树报
        #       `tree.sha X is not a valid tree`（422），于是整条链建不起来。
        #     · 而 blob 的读路径是可靠的（未引用的 blob 也 GET 200），
        #       所以只有"树套树"会踩到。
        #   孤儿提交不进任何分支，GitHub 之后会回收，安全。
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

    code, text = api(
        f"/repos/{OWNER}/{REPO}/git/refs/heads/{BRANCH}",
        method="PATCH",
        body={"sha": parent, "force": False},
    )
    if code != 200:
        print(f"❌ 更新 ref → {code}\n   {text[:400]}")
        sys.exit(1)
    print(f"\n✅ {BRANCH} 已更新到 {parent[:8]}（本地 HEAD {head[:8]}）")


if __name__ == "__main__":
    main()
