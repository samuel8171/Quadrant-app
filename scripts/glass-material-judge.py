"""材质验收判读：材质到底有没有画出来。

对照方式：同一块玻璃，"材质开"与"材质关"（backdrop-filter:none + 背景透明）
各截一张，差值就是材质本身对画面的贡献。

  Δmean ≈ 0   → 材质空心（弹窗全透明那个故障）
  Δmean 很大  → 材质真的画出来了

**单位统一为逐通道 0~255**（不要对通道求和，否则同样的画面会报出 3 倍的 Δ）。
门槛：Δmean < 0.35 判空心、< 1.67 判极弱、变化像素 < 3% 也判失败。

grad 是区域内相邻像素的平均梯度（锐度）。磨砂/折射会把背景糊掉，
所以"材质开"的 grad 应当低于"材质关"；若两者相同，说明只有染色没有模糊。

另判几何：材质板的盒子必须与玻璃可见面逐边重合（差 ≤ 1.5px），
否则圆角与染色会从面板边上露出来。

用法：
  "C:/Users/Samuel/AppData/Local/Programs/Python/Python313/python.exe" \
    scripts/glass-material-judge.py tmp/glassMaterial
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("tmp/glassMaterial")
manifest = json.loads((out / "cases.json").read_text(encoding="utf-8"))

fails = []


def load(name, box):
    img = Image.open(out / name).convert("RGB")
    x0, y0, x1, y1 = box
    if x1 > img.width or y1 > img.height:
        raise ValueError(f"{name} 的取样框超出图像 {img.width}x{img.height}：{box}")
    return np.asarray(img.crop(box)).astype(np.int16)


def grad(a):
    dx = np.abs(np.diff(a, axis=1)).mean()
    dy = np.abs(np.diff(a, axis=0)).mean()
    return float((dx + dy) / 2)


print(f"输出目录 {out}")
print()
print(f"{'场景':34s} {'Δmean':>8s} {'Δmax':>6s} {'变化像素%':>9s} {'grad开':>7s} {'grad关':>7s}  判读")
print("-" * 104)

for c in manifest["cases"]:
    p = c["box"]
    box = (round(p["x"]), round(p["y"]), round(p["x"] + p["w"]), round(p["y"] + p["h"]))
    a = load(c["name"], box)
    b = load(c["ref"], box)
    d = np.abs(a - b)  # 逐通道，单位 0~255（不要 .sum(axis=2)，那会变成 0~765，与文档口径对不上）
    dm, dmax = float(d.mean()), int(d.max())
    frac = float((d.max(axis=2) > 2).mean() * 100)
    ga, gb = grad(a), grad(b)

    if dm < 0.35:
        verdict = "❌ 材质无输出（空心）"
        fails.append(f"{c['label']}：Δmean={dm:.2f}")
    elif dm < 1.67:
        verdict = "⚠️ 极弱"
        fails.append(f"{c['label']}：Δmean={dm:.2f} 偏弱")
    else:
        verdict = "✅ 材质可见"
        if ga < gb * 0.98:
            verdict += " · 且已糊化"
    # Δmean 是均值，可能被"只有一小块材质"拉高；再加一条覆盖率的硬门槛
    if frac < 3.0:
        verdict += " · 但变化像素不足 3%"
        fails.append(f"{c['label']}：变化像素只有 {frac:.1f}%")
    print(f"{c['label']:34s} {dm:8.2f} {dmax:6d} {frac:8.1f}% {ga:7.2f} {gb:7.2f}  {verdict}")

print()
print("【几何：材质板 vs 玻璃可见面】")
GEOS = ("dialog.json", "menu.json", "dock.json", "fallback.json", "settings.json", "preview.json", "form.json")
for f in GEOS:
    p = out / f
    if not p.exists():
        continue
    info = json.loads(p.read_text(encoding="utf-8"))
    plate, face = info.get("plate"), info.get("face")
    if not plate or not face:
        continue
    diffs = {k: abs(plate[k] - face[k]) for k in ("x", "y", "w", "h")}
    bad = {k: v for k, v in diffs.items() if v > 1.5}
    tag = "✅ 逐边重合" if not bad else f"❌ 错位 {bad}"
    print(f"  {f:16s} {tag}   最大偏差 {max(diffs.values()):.1f}px")
    if bad:
        fails.append(f"{f} 几何错位 {bad}")

print()
print("【材质计算值】")
GEOS = ("dialog.json", "menu.json", "dock.json", "fallback.json", "settings.json", "preview.json", "form.json")
for f in GEOS:
    p = out / f
    if not p.exists():
        continue
    info = json.loads(p.read_text(encoding="utf-8"))
    print(
        f"  {f:16s} engine={info.get('engine'):9s} refract={str(info.get('hasRefractClass')):5s} "
        f"plateFilter={info.get('elementFilter'):26s} panelFilter={info.get('panelFilter')}"
    )
    # 位移只允许发生在空空的材质板上（children 必须 0），库面板必须不带 filter
    if info.get("plateChildren") not in (0, None):
        fails.append(f"{f} 材质板有 {info.get('plateChildren')} 个子节点：filter 位移会糊到内容")
    if info.get("panelFilter") not in ("none", None):
        fails.append(f"{f} 库面板自身带了 filter（{info.get('panelFilter')}）：文字与按钮会被位移")
    # 材质板自己也不能带 filter：按规范那会让它成为 backdrop root，把材质整条掐死
    pf = info.get("elementFilter") or "none"
    if pf != "none":
        fails.append(
            f"{f} 材质板带了 filter（{pf}）—— 它会让材质板成为 backdrop root，material 会被抹掉"
        )
    if info.get("engine") == "chromium" and not info.get("hasRefractClass"):
        fails.append(f"{f} chromium 档缺少 gs-refract 标记（该标记现在只是引擎标记）")
    if info.get("engine") == "fallback" and info.get("hasRefractClass"):
        fails.append(f"{f} 降级档不该带 gs-refract 标记")
    if "blur(" not in (info.get("backdropFilter") or ""):
        fails.append(f"{f} backdrop-filter 里没有 blur：磨砂丢了")

print()
print("【定位层必须不是 fixed（否则 Chromium 采不到身后页面）】")
GEOS = ("dialog.json", "menu.json", "dock.json", "fallback.json", "settings.json", "preview.json", "form.json")
for f in GEOS:
    p = out / f
    if not p.exists():
        continue
    info = json.loads(p.read_text(encoding="utf-8"))
    t = info.get("anchorTransform")
    ok = t in ("none", None)
    print(f"  {f:16s} anchor.transform = {t}  {'✅' if ok else '❌ 祖先带 transform，材质会被抽干'}")
    if not ok:
        fails.append(f"{f} 锚点带 transform（{t}）")
    lp = info.get("layerPosition")
    lz = info.get("layerZIndex")
    if lp is not None:
        good = lp != "fixed"
        extra = ""
        if lz not in ("auto", None):
            extra = f"  ⚠ z-index={lz}：它同样会把 backdrop 截在层内（菜单档实测材质失效，待修）"
        print(
            f"  {f:16s} .gs-layer position={lp} z-index={lz}  "
            f"{'✅' if good else '❌ position:fixed 会让材质完全失效'}{extra}"
        )
        if not good:
            fails.append(f"{f} 定位层是 position:fixed —— 材质采不到身后页面（改 absolute）")
    # 锚点是否带 transform 的原始断言（保留在同一个循环里）

print()
print("【设置要真的接得上】")
for w in manifest.get("wiring", []):
    ok = w.get("varOk") and w.get("bdfOk")
    print(f"  模糊量滑块 → --gs-blur 与材质板 backdrop-filter 同步：{'✅' if ok else '❌'} {w}")
    if not ok:
        fails.append("设置滑块没有驱动材质板")

print()
for n in manifest.get("notes", []):
    print(f"  · {n}")

print()
print("【本节能证明什么、不能证明什么（2026-09-25 第七轮重写，旧文案已作废）】")
print("  能证明：材质板挂在正确的位置、几何与可见面逐边重合、染色与圆角生效、")
print("          定位层是 absolute 且 z-index:auto（这两条一破材质就死）、设置滑块真的驱动 --gs-blur。")
print("  **不能**证明磨砂（backdrop-filter）真的画出来了 —— 本脚本量的是结构。")
print("  ⚠️ 旧文案曾说「CDP 截图不忠实地渲染 backdrop-filter，只能用真实屏幕抓图」，")
print("     第七轮已推翻：**页面级** `page.screenshot({ clip })` 是忠实的")
print("     （实测材质开 std 0.4 / 材质关 119.0，与真实屏幕同向同量级）。")
print("     唯一不可信的是**元素级** `locator().screenshot()`（连 opacity:0.95 正对照都判穿透）。")
print("  量磨砂请用「保留率」那套（条纹插在浮层之前 + 同状态开/关两张 + 两个采样盒）：")
print("     node tmp/menu-fix-verify.mjs      # 菜单")
print("     node tmp/dialog-final-verify.mjs  # 弹窗（含交互与手机档几何）")
print("  要「屏幕上真正长什么样」才用系统级抓图：")
print("     node scripts/glass-material-screen.mjs && python scripts/glass-material-screen.py")
print()
if fails:
    print(f"❌ {len(fails)} 项未通过：")
    for x in fails:
        print(f"   - {x}")
    sys.exit(1)
print("✅ 全部通过：结构与几何正确、定位层未截断 backdrop、染色与设置接线正常")
print("   （磨砂是否真的生效，请跑上面的保留率脚本）")
