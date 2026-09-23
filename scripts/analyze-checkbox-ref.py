"""从参考图中提取「圆环 + 实心核」勾选框的精确几何。

参考图 ref-checkbox.jpg 是 1206x180 的截图（@3x），左侧有一个橙色圆环勾选框。
目标是量出：外环外径、环厚、间隙厚度、实心核直径，换算成 @1x CSS px。
"""
from PIL import Image
import math

im = Image.open(r"D:/Samuel/Vibe Coding/tmp/refs/ref-checkbox.jpg").convert("RGB")
W, H = im.size
px = im.load()
print(f"图片: {W}x{H}")

# 1) 找到橙色像素的包围盒
def is_orange(c):
    r, g, b = c
    return r > 150 and 90 < g < 210 and b < 140 and (r - b) > 60

xs, ys = [], []
for y in range(H):
    for x in range(W):
        if is_orange(px[x, y]):
            xs.append(x)
            ys.append(y)

if not xs:
    raise SystemExit("未找到橙色像素")

x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
print(f"橙色包围盒: x {x0}..{x1} (宽 {x1-x0+1}), y {y0}..{y1} (高 {y1-y0+1})")

cx = (x0 + x1) / 2
cy = (y0 + y1) / 2
print(f"中心: ({cx:.1f}, {cy:.1f})")

# 2) 沿水平方向从中心向右扫描，记录颜色变化（分类为 核/间隙/环/背景）
def classify(c):
    r, g, b = c
    if is_orange(c):
        return "RING"
    # 背景是浅灰白
    if r > 225 and g > 225 and b > 225:
        return "BG"
    return "?"

print("\n水平扫描（中心向右，第 0 步 = 中心点）:")
runs = []
prev = None
run_start = 0
for d in range(0, 70):
    x = int(round(cx + d))
    if x >= W:
        break
    c = px[x, int(round(cy))]
    k = classify(c)
    if k != prev:
        if prev is not None:
            runs.append((prev, run_start, d - 1, d - run_start))
        prev = k
        run_start = d
if prev is not None:
    runs.append((prev, run_start, 69, 70 - run_start))

for kind, s, e, ln in runs:
    print(f"  d={s:>3}..{e:>3}  {kind:<5} 跨度 {ln}")

# 3) 垂直扫描做交叉验证
print("\n垂直扫描（中心向下）:")
prev = None
run_start = 0
vruns = []
for d in range(0, 70):
    y = int(round(cy + d))
    if y >= H:
        break
    c = px[int(round(cx)), y]
    k = classify(c)
    if k != prev:
        if prev is not None:
            vruns.append((prev, run_start, d - 1, d - run_start))
        prev = k
        run_start = d
if prev is not None:
    vruns.append((prev, run_start, 69, 70 - run_start))
for kind, s, e, ln in vruns:
    print(f"  d={s:>3}..{e:>3}  {kind:<5} 跨度 {ln}")

# 4) 几何推算
print("\n=== 几何推算（@3x 原始像素） ===")
# 水平方向：从中心起算，
#   核半径 = 第一段 RING 的末端
#   间隙 = 之后的非 RING 段
#   环外径 = 最后一段 RING 的末端
seg = [r for r in runs if r[0] != "BG"]
if len(seg) >= 3:
    core_r = seg[0][2] + 0.5
    gap_start = seg[1][1]
    gap_end = seg[1][2]
    ring_start = seg[2][1]
    ring_end = seg[2][2]
    outer_r = ring_end + 0.5
    gap_thick = gap_end - gap_start + 1
    ring_thick = ring_end - ring_start + 1
    print(f"实心核半径  = {core_r:.1f} px  → CSS {core_r/3:.2f}")
    print(f"间隙起止    = {gap_start}..{gap_end}  厚 {gap_thick} px  → CSS {gap_thick/3:.2f}")
    print(f"圆环起止    = {ring_start}..{ring_end}  厚 {ring_thick} px  → CSS {ring_thick/3:.2f}")
    print(f"外径半径    = {outer_r:.1f} px  → CSS {outer_r/3:.2f}")
    print(f"外径直径    = {2*outer_r:.1f} px  → CSS {2*outer_r/3:.2f}")
    print(f"核直径      = {2*core_r:.1f} px  → CSS {2*core_r/3:.2f}")
    print()
    print(f"核直径 / 外径 = {(2*core_r)/(2*outer_r):.3f}")
    print(f"核半径 / 外径 = {core_r/outer_r:.3f}")
    print(f"间隙占外径比  = {gap_thick/(2*outer_r):.3f}")
    print(f"环厚占外径比  = {ring_thick/(2*outer_r):.3f}")
    print(f"核半径 / 环厚 = {core_r/ring_thick:.2f}")
