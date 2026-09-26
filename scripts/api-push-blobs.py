#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 tmp/pushblobs.sh 收集的 blob 逐个补到远端（已存在就跳过）。

约定（与 tmp/pushnow.py 一致，别再踩）：
  · 5xx / 网络抖动要退避重试（密集调用时 GitHub 会零星 500 且响应体为空）；
  · blob 的"按 sha 读"路径是**可靠的**（未被引用的 blob 也 GET 200），
    只有"树"在那条路径上会 404 —— 所以这里 GET 探测就是准确的判据；
  · POST 返回的 sha 必须与本地一致，不一致说明传坏了。
"""
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

OWNER, REPO = "samuel8171", "Quadrant-app"
API = "https://api.github.com"
D = Path(sys.argv[1] if len(sys.argv) > 1 else "tmp/pushblobs")
TOK = os.environ.get("GH_TOKEN", "")
if not TOK:
    sys.exit("缺少 GH_TOKEN")


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
            "User-Agent": "quadrant-pushblobs",
            **({"Content-Type": "application/json"} if data else {}),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def retry(fn, what, tries=5):
    code, text = -1, ""
    for i in range(tries):
        code, text = fn()
        if code in (200, 201):
            return code, text
        if code != -1 and 400 <= code < 500:
            return code, text  # 4xx 是确定性的，交给调用方
        print(f"    ↻ {what} → {code}，{2 * (i + 1)}s 后重试")
        time.sleep(2 * (i + 1))
    return code, text


up = skip = 0
for line in (D / "blobs.tsv").read_text(encoding="utf-8").splitlines():
    if not line.strip():
        continue
    sha, _, path = line.partition("\t")
    sha, path = sha.strip(), path.strip()
    code, _ = retry(lambda: api(f"/repos/{OWNER}/{REPO}/git/blobs/{sha}"), f"探测 {path}")
    if code == 200:
        skip += 1
        continue
    if code != 404:
        sys.exit(f"❌ 探测 {path} → {code}")
    b64 = (D / "blobs" / f"{sha}.b64").read_text(encoding="ascii").strip()
    code, text = retry(
        lambda: api(f"/repos/{OWNER}/{REPO}/git/blobs", method="POST",
                    body={"content": b64, "encoding": "base64"}),
        f"上传 {path}",
    )
    if code != 201:
        sys.exit(f"❌ 上传 {path} → {code}\n   {text[:400]}")
    got = json.loads(text)["sha"]
    if got != sha:
        sys.exit(f"❌ {path} 上传后 sha 不符：本地 {sha} / 远端 {got}")
    up += 1
    print(f"  ✓ 上传 {path}  {sha[:10]}  {len(base64.b64decode(b64))} B")

print(f"blob 补齐完成：新上传 {up}，远端已有 {skip}")
