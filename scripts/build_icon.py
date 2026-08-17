from PIL import Image, ImageDraw

PANEL = (26, 29, 35)          # 侧边栏面板色 #1a1d23
ACCENT = (77, 163, 255)       # 强调色 #4da3ff
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def dim(color, panel, alpha=0.55):
    return tuple(round(alpha * c + (1 - alpha) * p) for c, p in zip(color, panel))


def render(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin = max(1, round(size * 0.094))
    panel_box = (margin, margin, size - margin, size - margin)
    draw.rounded_rectangle(panel_box, radius=max(1, round(size * 0.1875)), fill=PANEL + (255,))

    gap = max(1, round(size * 0.047))
    inner_pad = max(0, round(size * 0.11))
    inner = (
        panel_box[0] + inner_pad,
        panel_box[1] + inner_pad,
        panel_box[2] - inner_pad,
        panel_box[3] - inner_pad,
    )
    total = max(2, inner[2] - inner[0])
    side = (total - gap) // 2
    side = max(1, side)

    cells = [
        ((inner[0], inner[1]), ACCENT),                              # 左上
        ((inner[0] + side + gap, inner[1]), dim(ACCENT, PANEL)),     # 右上
        ((inner[0], inner[1] + side + gap), dim(ACCENT, PANEL)),     # 左下
        ((inner[0] + side + gap, inner[1] + side + gap), ACCENT),    # 右下
    ]

    for (x, y), color in cells:
        draw.rounded_rectangle(
            (x, y, x + side, y + side),
            radius=max(1, round(side * 0.22)),
            fill=color + (255,),
        )
    return img


base = render(256)
small_frames = [render(size) for size in (16, 24, 32, 48, 64, 128)]
base.save(
    "build/icon.ico",
    format="ICO",
    sizes=[(s, s) for s in ICO_SIZES],
    append_images=small_frames,
)
render(512).save("build/icon.png")
print("saved build/icon.ico (16..256) and build/icon.png (512)")
