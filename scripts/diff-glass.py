"""折射验证的像素判读。

判据：同布局下 ds=0 与 ds=118 的差异必须**显著大于噪声**。
位移为 0 时 SVG 滤镜是恒等映射（把身后像素原样搬回），非 0 时把条纹拉弯；
若两者逐像素一致，说明折射没生效。

同时输出差异热力图，用于目视确认差异是否**集中在边缘**（这正是液玻的特征：
中心干净、边缘被折射弯曲）。中心与边缘若差异相当，说明只是整体偏移而非折射。
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path("tmp/spike")


def load(name: str) -> Image.Image:
    return Image.open(ROOT / f"{name}.png").convert("RGB")


def stats(a: Image.Image, b: Image.Image, box=None):
    if box:
        a = a.crop(box)
        b = b.crop(box)
    d = ImageChops.difference(a, b)
    px = list(d.getdata())
    chan_max = [max(p[i] for p in px) for i in range(3)]
    mean = sum(sum(p) / 3 for p in px) / len(px)
    # 差异超过 8（人眼在深色底上可辨的量级）的像素占比
    big = sum(1 for p in px if max(p) > 8) / len(px)
    return chan_max, mean, big, d


def report(label: str, x: Image.Image, y: Image.Image, box=None):
    cm, mean, big, _ = stats(x, y, box)
    print(f"  {label:26} 最大通道差={cm}  平均={mean:6.2f}  明显差异像素占比={big*100:5.1f}%")
    return cm, mean, big


pairs = [
    ("ds0-blur0", "ds118-blur0", "纯位移（blur=0）"),
    ("ds0-blur0.4", "ds118-blur0.4", "默认模糊下（blur=0.4）"),
    ("ds0-blur0.4", "polar-blur0.4", "standard vs polar"),
    ("ds0-blur0.4", "prominent-blur0.4", "standard vs prominent"),
    ("ds0-blur0.4", "shader-blur0.4", "standard vs shader"),
]

# 玻璃体矩形（由探针诊断读出）：根节点 240,265 420x70；.glass 240,265 364x70
GLASS = (240, 265, 604, 335)
# 边缘带（外框 10px 环）与中心区，用于判断差异是否由折射的边缘特性主导
CENTER = (330, 285, 514, 315)
# 边缘环 = 玻璃体去掉中心区
EDGE_RING = (240, 265, 604, 335)

print("=" * 78)
print("liquid-glass-react 折射验证 · 像素判读")
print("=" * 78)
print("\n① 全玻璃体区域（240,265 → 604,335）")
for a, b, label in pairs:
    report(label, load(a), load(b), GLASS)

print("\n② 中心区（330,285 → 514,315）：液玻的中心应当**干净**，位移主要发生在边缘")
for a, b, label in pairs[:2]:
    report(label, load(a), load(b), CENTER)

print("\n③ 玻璃体外（右侧漫画布，x 620→860）：应当完全一致，作为阴性对照")
for a, b, label in pairs[:2]:
    report(label, load(a), load(b), (620, 200, 860, 400))

print("\n④ 差异热力图（×6 增强）")
for a, b, label in pairs[:2]:
    x, y = load(a), load(b)
    _, _, _, d = stats(x, y, GLASS)
    d = d.crop(GLASS)
    d = d.point(lambda v: min(255, v * 6))
    out = ROOT / f"diff-{a}__{b}.png"
    d.save(out)
    print(f"  {label:26} → {out}")

print(
    "\n判读：① 的差异必须显著（否则折射没生效）；③ 必须为 0（阴性对照，"
    "证明差异不是截图时序造成的整体漂移）。"
)
