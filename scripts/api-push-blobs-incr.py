#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
只补**指定清单**里的 blob（用于 amend 后增量补几处改动，避免全量探测一轮）。

用法：
  git rev-list BASE..HEAD | while read c; do git ls-tree -r "$c" --format='%(objectname) %(path)'; done \
    | sort -u > tmp/incr/pairs.txt
  python scripts/api-push-blobs-incr.py tmp/incr/pairs.txt

即与 api-push-blobs.sh 同一套收集口径，但可以只传一个**子集**（调用方自己裁剪）。
约定沿用 api-push-blobs.py：GET 探测是可靠判据；POST 回的 sha 必须与本地一致。
"""
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

TOKEN = os.environ.get('GH_TOKEN')
if not TOKEN:
    print('❌ 缺 GH_TOKEN', file=sys.stderr)
    sys.exit(1)
REPO = 'samuel8171/Quadrant-app'
API = f'https://api.github.com/repos/{REPO}/git'
HDR = {
    'Authorization': f'Bearer {TOKEN}',
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'quadrant-push'
}


def req(url, method='GET', body=None, tries=5):
    data = None if body is None else json.dumps(body).encode()
    for i in range(tries):
        try:
            r = urllib.request.Request(url, data=data, headers=HDR, method=method)
            with urllib.request.urlopen(r, timeout=40) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code >= 500 or e.code == 403:
                time.sleep(1.5 * (i + 1))
                continue
            raise
        except Exception:
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f'{method} {url} 重试 {tries} 次仍失败')


def git(*args):
    return subprocess.run(['git', *args], capture_output=True, check=True).stdout


def main():
    pairs = Path(sys.argv[1] if len(sys.argv) > 1 else 'tmp/incr/pairs.txt')
    seen = set()
    todo = []
    for line in pairs.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line:
            continue
        sha, _, path = line.partition(' ')
        if sha in seen:
            continue
        seen.add(sha)
        if git('cat-file', '-t', sha).decode().strip() != 'blob':
            continue
        todo.append((sha, path))

    print(f'清单 {len(todo)} 个 blob，开始探测…')
    posted = skipped = 0
    for i, (sha, path) in enumerate(todo, 1):
        if req(f'{API}/blobs/{sha}') is not None:
            skipped += 1
            continue
        content = base64.b64encode(git('cat-file', 'blob', sha)).decode()
        r = req(f'{API}/blobs', 'POST', {'content': content, 'encoding': 'base64'})
        got = r.get('sha') if r else None
        if got != sha:
            print(f'❌ {path} 返回 sha 不符：{got} != {sha}')
            sys.exit(1)
        posted += 1
        if posted % 10 == 0:
            print(f'  已传 {posted}…')
    print(f'✅ 新传 {posted} 个，已存在 {skipped} 个')


if __name__ == '__main__':
    main()
