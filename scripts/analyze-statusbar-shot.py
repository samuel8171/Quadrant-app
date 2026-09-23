"""量出截图里标题墨迹的上沿像素行，与状态栏参考带比对。

参考带定义（由 statusbar-pixel-probe 注入到 y=0）：
  - y = 0 .. safeTop*3                纯红 rgba(255,0,0,0.45)  = 状态栏本体
  - y = safeTop*3 .. (safeTop+blur)*3 淡红 rgba(255,0,0,0.22) = 毛玻璃羽化区

判定：标题墨迹（白字）上沿应高于（y 更小）参考带最底部。
"""
from PIL import Image

CASES = [
    ("tmp/statusbar/review-iPhoneSE.png", 20, 6, "复盘"),
    ("tmp/statusbar/review-iPhone14.png", 47, 12, "复盘"),
    ("tmp/statusbar/review-iPhone16Pro.png", 59, 14, "复盘"),
    ("tmp/statusbar/quadrant-iPhone14.png", 47, 12, "四象限"),
    ("tmp/statusbar/goals-iPhone14.png", 47, 12, "目标"),
    ("tmp/statusbar/weekly-iPhone14.png", 47, 12, "周计划"),
]

print("判读：bandBottom 之上 = 被状态栏/羽化区覆盖；inkTop 应 >= bandBottom\n")

for path, safe_top, blur, label in CASES:
    im = Image.open(path).convert("RGB")
    W, H = im.size
    px = im.load()
    scale = W / 390.0

    def is_reddish(c, strong=True):
        r, g, b = c
        if strong:
            return r > 50 and r > g * 2.2 and r > b * 2.2
        return r > 25 and r > g * 1.5 and r > b * 1.5

    # 采样 x = 60% 宽处（避开左侧文字），从上往下找参考带下沿
    x_probe = int(W * 0.6)
    band_bottom = 0
    for y in range(H):
        c = px[x_probe, y]
        if is_reddish(c, strong=False):
            band_bottom = y
        elif y > 20:
            break

    body_bottom = round(safe_top * scale)
    expect_bottom = round((safe_top + blur) * scale)

    # 标题墨迹：左侧 x 30..250 @1x，找首个"亮"行
    def row_max_luma(y):
        m = 0
        for x in range(int(30 * scale), min(int(250 * scale), W)):
            c = px[x, y]
            luma = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
            # 排除红色参考带本身
            if c[0] > c[1] * 1.6 and c[0] > c[2] * 1.6:
                continue
            if luma > m:
                m = luma
        return m

    ink_top = None
    for y in range(band_bottom + 1, min(H, band_bottom + 300)):
        if row_max_luma(y) > 130:
            ink_top = y
            break

    print(f"=== {label} / {path.split('/')[-1]} ===")
    print(f"  scale={scale}  safeTop={safe_top}  blur={blur}")
    print(f"  状态栏本体下沿 测得/期望 y={body_bottom}/{round(safe_top*scale)}")
    print(f"  参考带下沿     测得 y={band_bottom}  期望 y={expect_bottom}")
    if ink_top is None:
        print("  ❌ 未找到标题墨迹")
        print()
        continue
    print(f"  标题墨迹上沿   y={ink_top}  (CSS {ink_top/scale:.1f})")
    d = ink_top - band_bottom
    print(f"  墨迹 - 参考带下沿 = {d}px @3x = {d/scale:.1f} CSS px")
    if d >= 0:
        print(f"  ✅ 墨迹完全在参考带之下，余量 {d/scale:.1f} CSS px")
    else:
        print(f"  ❌ 墨迹上沿侵入参考带 {-d/scale:.1f} CSS px —— 这就是肉眼看到的「被虚化一部分」")
    print()
