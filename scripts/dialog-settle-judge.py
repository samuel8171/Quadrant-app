#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
判读 dialog-settle-diag.mjs 的产物：稳定后玻璃里到底还有没有材质、有没有模糊。

三个量（都是逐像素、0~255 口径，与本项目其他探针一致）：
  Δmean      同一状态下「材质开 vs 关」的逐像素平均差 —— 材质贡献了多少
  changed%   逐通道差 > 2 的像素占比 —— 材质影响的面积
  结构保留率 grad(on) / grad(baseline)
             baseline 是**同一裁切位置、没有弹窗**的页面原样。
             模糊会把结构抹掉，所以这个比值应当明显 < 1；
             若 ≈ 1，说明玻璃背后被原样透出来 = 没有模糊。
用法：
  "$PY313" scripts/dialog-settle-judge.py tmp/dialogSettle
"""
import os
import sys
import json

import numpy as np
from PIL import Image

out = sys.argv[1] if len(sys.argv) > 1 else "tmp/dialogSettle"
variants_path = os.path.join(out, "variants.json")
if not os.path.exists(variants_path):
    print("找不到 variants.json —— 先跑 scripts/dialog-settle-diag.mjs")
    sys.exit(2)

with open(variants_path, encoding="utf-8") as fh:
    report = json.load(fh)


def load(name):
    p = os.path.join(out, name)
    if not os.path.exists(p):
        return None
    return np.asarray(Image.open(p).convert("RGB"), dtype=np.float64)


def grad(img):
    """平均梯度幅值：结构量。模糊会让它下降。"""
    gx = np.abs(np.diff(img, axis=1)).mean()
    gy = np.abs(np.diff(img, axis=0)).mean()
    return (gx + gy) / 2.0


base = load("baseline.png")

print("=" * 78)
print("弹窗稳定后材质是否还在（Δ=材质开/关的像素差，0~255）")
print("=" * 78)
print(f"{'状态':<16}{'Δmean':>9}{'变化像素%':>11}{'模糊后grad':>12}{'基线grad':>10}{'结构保留':>10}")
print("-" * 78)

rows = []
order = ["settled", "frozenMid", "noAnim", "onlyOpacity", "onlyTransform"]
labels = {
    "settled": "稳定态",
    "frozenMid": "动画中(50%)",
    "noAnim": "去动画",
    "onlyOpacity": "只留opacity .5",
    "onlyTransform": "只留scale .97",
}
for name in order:
    on = load(f"{name}-on.png")
    off = load(f"{name}-off.png")
    if on is None or off is None:
        continue
    if on.shape != off.shape:
        print(f"{labels.get(name, name):<16}  尺寸不一致，跳过")
        continue
    d = np.abs(on - off)
    dmean = d.mean()
    changed = (d.max(axis=2) > 2).mean() * 100.0
    g_on = grad(on)
    g_base = grad(base) if base is not None and base.shape == on.shape else float("nan")
    keep = g_on / g_base if g_base and g_base > 0 else float("nan")
    rows.append((name, dmean, changed, g_on, g_base, keep))
    print(
        f"{labels.get(name, name):<16}{dmean:>9.2f}{changed:>10.1f}%"
        f"{g_on:>12.3f}{g_base:>10.3f}{keep:>9.0%}"
    )

print("-" * 78)

# ---------- 结论 ----------
res = {r[0]: r for r in rows}
if "settled" in res:
    _, dmean, changed, g_on, g_base, keep = res["settled"]
    print()
    print("判读口径：")
    print("  Δmean ≥ 0.6 且 变化像素 ≥ 3%  → 材质确实画出来了")
    print("  结构保留 > 85%                 → 几乎没有模糊（玻璃在'原样透出'）")

    verdict = []
    if dmean >= 0.6 and changed >= 3:
        verdict.append("材质在稳定态**仍在绘制**（非零），问题不是'完全没画'")
    else:
        verdict.append("材质在稳定态**基本没有绘制** ← 与'透明'的描述一致")
    if keep > 0.85:
        verdict.append("但玻璃区域内**结构几乎原样透出 ⇒ 模糊没有作用于背景**")
    print()
    for v in verdict:
        print("  · " + v)

if "onlyOpacity" in res and "settled" in res:
    print()
    print("分量对照（看 pop-in 的哪个分量影响材质）：")
    for k in ["settled", "noAnim", "frozenMid", "onlyOpacity", "onlyTransform"]:
        if k in res:
            print(f"  {labels[k]:<16} Δmean={res[k][1]:.2f}   变化像素={res[k][2]:.1f}%")

# ---------- 时间线里值得看的几行 ----------
tl = report.get("timeline") or []
if tl:
    print()
    print("时间线摘要：")
    first = tl[0]
    last = tl[-1]
    for tag, r in (("首帧", first), ("末帧", last)):
        print(
            f"  {tag} t={r['t']}ms  opacity={r['opacity']} transform={r['transform']} "
            f"anim={r['animTransform']}"
        )
        print(f"        bdf={r['bdf']}")
        print(
            f"        滤镜 id={r['id']} DOM里{'在' if r['idInDom'] else '**不在**'}"
            f"  maskOpacity={r['maskOpacity']} maskBg={r['maskBg']}  plateW={r['plateW']}"
        )
    ids = {(r["id"], r["idInDom"]) for r in tl}
    print(f"  时间线上出现过的 (滤镜id, 是否在DOM) = {sorted(ids, key=str)}")
    if any((not r["idInDom"]) for r in tl):
        print("  ⚠ 有帧的滤镜 id 在 DOM 里查不到 ⇒ backdrop-filter 的 url() 悬空，整条声明可能失效")
