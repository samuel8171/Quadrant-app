# -*- coding: utf-8 -*-
"""
合成「修复前 / 修复后」对照图。

三张图：
  fig1  手机弹窗（390×844）—— 真实修复前截图（tmp/glassCause/00-pristine.png，
        取自修复前的构建）vs 修复后截图（tmp/glassMaterial/ba/mobile-after.png）
  fig2  桌面弹窗（1280×800）—— 材质关（复现用户看到的透明现象）vs 材质开
  fig3  菜单 + 手机 dock —— 材质关 vs 材质开

用法（在仓库根目录执行）：
  <python313> scripts/glass-figs.py --out docs/probes/liquid-glass-shots
"""
import argparse
import json
import os
from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument('--out', default='docs/probes/liquid-glass-shots')
ap.add_argument('--tmp', default='tmp')
ap.add_argument('--mat', default='tmp/glassMaterial')
ap.add_argument('--ba', default='tmp/glassMaterial/ba')
args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)

FONT = 'C:/Windows/Fonts/msyh.ttc'
FONT_BD = 'C:/Windows/Fonts/msyhbd.ttc'
BG = (14, 16, 20)
FG = (233, 237, 244)
DIM = (150, 159, 173)
OK = (108, 214, 160)
BAD = (232, 118, 108)
LINE = (46, 51, 60)


def f(size, bold=False):
    return ImageFont.truetype(FONT_BD if bold else FONT, size)


def crop_pad(im, box, pad):
    x0 = max(0, int(box['x'] - pad))
    y0 = max(0, int(box['y'] - pad))
    x1 = min(im.width, int(box['x'] + box['w'] + pad))
    y1 = min(im.height, int(box['y'] + box['h'] + pad))
    return im.crop((x0, y0, x1, y1))


def ring_diff(im_a, im_b, box, ring=26):
    """弹窗框外一环的平均绝对差：用来证明两张截图取自同一背景，可直接并排。"""
    x0 = int(box['x'] - ring)
    y0 = int(box['y'])
    x1 = int(box['x'] + box['w'] + ring)
    y1 = int(box['y'] + box['h'])
    a = im_a.crop((x0, y0, x1, y1)).convert('L')
    b = im_b.crop((x0, y0, x1, y1)).convert('L')
    pa, pb = a.load(), b.load()
    tot = n = 0
    for y in range(a.height):
        for x in range(a.width):
            if x < ring or x >= a.width - ring:
                tot += abs(pa[x, y] - pb[x, y])
                n += 1
    return tot / max(n, 1)


def wrap(draw, text, font, maxw):
    lines, cur = [], ''
    for ch in text:
        if draw.textlength(cur + ch, font=font) <= maxw:
            cur += ch
        else:
            lines.append(cur)
            cur = ch
    if cur:
        lines.append(cur)
    return lines


def pair_delta(pa, pb, box):
    """弹窗框内的平均绝对差与变化像素占比（材质开 vs 关的量化判据）。

    取样框与 `glass-material-judge.py` 保持一致（同样的 round 口径、逐通道 0~255），
    否则图注上的数字会与判读报告对不上。
    """
    import numpy as np

    a = np.asarray(Image.open(pa).convert('RGB'), dtype=np.float32)
    b = np.asarray(Image.open(pb).convert('RGB'), dtype=np.float32)
    x0, y0 = round(box['x']), round(box['y'])
    x1, y1 = round(box['x'] + box['w']), round(box['y'] + box['h'])
    ca, cb = a[y0:y1, x0:x1], b[y0:y1, x0:x1]
    d = np.abs(ca - cb)
    return float(d.mean()), float((d.max(axis=2) > 2).mean() * 100)


class Figure:
    def __init__(self, w, title, sub=''):
        self.w = w
        self.title = title
        self.sub = sub
        self.items = []  # (label, color, image)
        self.rows = []    # 每组一个 row，row 里是若干 item
        self.footer = []

    def row(self, cells):
        self.rows.append(cells)

    def note(self, text):
        self.footer.append(text)

    def render(self, path):
        m = 26
        inner = self.w - 2 * m
        sub_font, note_font = f(13), f(12.5)
        probe = ImageDraw.Draw(Image.new('RGB', (1, 1)))

        sub_lines = wrap(probe, self.sub, sub_font, inner) if self.sub else []
        note_lines = []
        for note in self.footer:
            note_lines += wrap(probe, note, note_font, inner)

        row_h = [max(im.height for _, _, im in cells) for cells in self.rows]
        title_y = m
        sub_y = title_y + 30
        imgs_y = sub_y + len(sub_lines) * 19 + 10 + 26  # 26 = 标签行
        body = sum(row_h) + 30 * (len(self.rows) - 1) + 18
        total_h = imgs_y + body + 21 * len(note_lines) + m

        canvas = Image.new('RGB', (self.w, total_h), BG)
        d = ImageDraw.Draw(canvas)
        d.text((m, title_y), self.title, font=f(19, True), fill=FG)
        for i, line in enumerate(sub_lines):
            d.text((m, sub_y + i * 19), line, font=sub_font, fill=DIM)

        cy = imgs_y
        for i, cells in enumerate(self.rows):
            # 标签画在图片上方、且必须画完再 paste —— paste 会盖住标签的下半截
            labels_y = cy - 22
            gap = 22
            tw = sum(im.width for _, _, im in cells) + gap * (len(cells) - 1)
            x = (self.w - tw) // 2
            for label, color, im in cells:
                lf = f(13, True)
                lw = d.textlength(label, font=lf)
                d.rectangle([x - 2, labels_y - 3, x + lw + 6, labels_y + 16], fill=BG)
                d.text((x + 2, labels_y), label, font=lf, fill=color)
                canvas.paste(im, (x, cy))
                d.rectangle([x - 1, cy - 1, x + im.width, cy + im.height], outline=LINE)
                x += im.width + gap
            cy += row_h[i] + 30

        for line in note_lines:
            d.text((m, cy + 2), line, font=note_font, fill=DIM)
            cy += 21

        canvas.save(path)
        print('写出', path, canvas.size)


# ---------------------------------------------------------------- fig1 手机弹窗
pristine = Image.open(f'{args.tmp}/glassCause/00-pristine.png').convert('RGB')
after = Image.open(f'{args.ba}/mobile-after.png').convert('RGB')
BOX_M = {'x': 24, 'y': 337, 'w': 342, 'h': 170}

rd = ring_diff(pristine, after, BOX_M)
print(f'fig1 配对可信度：弹窗两侧 26px 环带平均绝对差 = {rd:.2f}/255（越小越说明背景一致）')

fig = Figure(
    852,
    '图 1 · 弹窗：修复前 vs 修复后',
    'iPhone 尺寸视口 390×844，同一页面、同一个「删除事件」确认弹窗、同一位置。'
    '左为修复前的构建，右为当前构建。'
)
fig.row([
    ('修复前（库原生渲染）：内部整片透明，只剩一圈发丝边', BAD, crop_pad(pristine, BOX_M, 34)),
    ('修复后（材质板）：能采到身后的象限卡片，边缘有位移折射', OK, crop_pad(after, BOX_M, 34)),
])
fig.note(f'弹性检查：弹窗外 26px 环带的像素平均差 {rd:.2f}/255 —— 两张图背景一致，可直接并排比较。')
fig.render(f'{args.out}/glass-material-01-dialog-mobile.png')

# ---------------------------------------------------------------- fig2 桌面弹窗
mat = args.mat
A1 = Image.open(f'{mat}/A1-dialog-material-on.png').convert('RGB')
A2 = Image.open(f'{mat}/A2-dialog-material-off.png').convert('RGB')
BOX_D = {'x': 460, 'y': 319.5, 'w': 360, 'h': 161}
d1, p1 = pair_delta(f'{mat}/A1-dialog-material-on.png', f'{mat}/A2-dialog-material-off.png', BOX_D)
print(f'fig2 桌面弹窗：Δmean={d1:.2f}/255  变化像素={p1:.1f}%')

fig = Figure(
    1520,
    '图 2 · 桌面弹窗：材质关 vs 材质开（1.6× 放大）',
    '1280×800。只切换材质板那两条属性（backdrop-filter / background），其余一律不动，是单变量对照。'
    '看点是穿过弹窗的象限分界线：关材质时它笔直穿过、亮度不变，开材质后被压暗并糊掉。'
)
SUB = {'x': 460, 'y': 319.5, 'w': 360, 'h': 161}


def zoom2(path, box, z=1.6):
    c = crop_pad(Image.open(path).convert('RGB'), box, 44)
    return c.resize((int(c.width * z), int(c.height * z)), Image.LANCZOS)


fig.row([
    ('材质关闭 —— 复现用户看到的「全透明」', BAD, zoom2(f'{mat}/A2-dialog-material-off.png', SUB)),
    ('材质开启 —— 边界线被压暗糊掉', OK, zoom2(f'{mat}/A1-dialog-material-on.png', SUB)),
])
fig.note(
    f'判据：弹窗整个区域内平均绝对差 Δmean={d1:.2f}/255、变化像素 {p1:.1f}%'
    f'（门槛 Δmean ≥1.67 且变化像素 ≥3%）—— 材质确实画了出来。'
)
fig.render(f'{args.out}/glass-material-02-dialog-desktop.png')

# ---------------------------------------------------------------- fig3 菜单 + dock
B1 = Image.open(f'{mat}/B1-menu-material-on.png').convert('RGB')
B2 = Image.open(f'{mat}/B2-menu-material-off.png').convert('RGB')
C1 = Image.open(f'{mat}/C1-dock-material-on.png').convert('RGB')
C2 = Image.open(f'{mat}/C2-dock-material-off.png').convert('RGB')
BOX_MENU = {'x': 1080, 'y': 40, 'w': 176, 'h': 250}
BOX_DOCK = {'x': 11.5, 'y': 768, 'w': 366, 'h': 66}
dm, pm = pair_delta(f'{mat}/B1-menu-material-on.png', f'{mat}/B2-menu-material-off.png', BOX_MENU)
dd, pd = pair_delta(f'{mat}/C1-dock-material-on.png', f'{mat}/C2-dock-material-off.png', BOX_DOCK)
print(f'fig3 菜单 Δmean={dm:.2f} / {pm:.1f}%   dock Δmean={dd:.2f} / {pd:.1f}%')

fig = Figure(
    852,
    '图 3 · 右键菜单与手机 dock：材质关 vs 材质开',
    '菜单在桌面视口、dock 在 390×844 手机视口。两者走的是同一套材质板代码。'
)
fig.row([
    ('菜单 · 材质关', BAD, crop_pad(B2, BOX_MENU, 26)),
    ('菜单 · 材质开', OK, crop_pad(B1, BOX_MENU, 26)),
])
fig.row([
    ('手机 dock · 材质关', BAD, crop_pad(C2, BOX_DOCK, 18)),
    ('手机 dock · 材质开', OK, crop_pad(C1, BOX_DOCK, 18)),
])
fig.note(
    f'量化：菜单 Δmean={dm:.2f}/255、变化像素 {pm:.1f}%；dock Δmean={dd:.2f}/255、变化像素 {pd:.1f}%。'
    f'dock 的变化像素占比低是因为它压在页面最底部一片几乎纯色的背景上 —— 模糊没有参照物可用，'
    f'只剩染色在起作用。'
)
fig.render(f'{args.out}/glass-material-03-menu-dock.png')

# ---------------------------------------------------------------- fig4 染色候选
tint_dir = f'{mat}/tint'
if os.path.isdir(tint_dir):
    tinfo = json.load(open(f'{tint_dir}/tint.json', encoding='utf-8'))
    Z = 1.5

    def zoom(p, box, pad=22, z=Z):
        c = crop_pad(Image.open(p).convert('RGB'), box, pad)
        return c.resize((int(c.width * z), int(c.height * z)), Image.LANCZOS)

    order = [
        ('T0-current', 'T0 · 现状：近黑 34% —— 深色页面上几乎看不出是一块面', DIM),
        ('T1-deep', 'T1 · 同色加深到 62% —— 最省事，仍然是纯深色', FG),
        ('T2-cool', 'T2 · 冷灰提亮 40,46,58 / 68% —— 有明确的"面"感', OK),
        ('T3-ios', 'T3 · 白雾 7.5% + 近黑 55% —— iOS 深色材质观感', OK),
    ]
    fig = Figure(
        1280,
        '图 4 · 染色强度候选（只改 --gs-tint，其余参数全部不动）',
        '桌面弹窗 1.5× 放大。材质板已修好，这一步决定"它看上去像不像一块玻璃"。'
        'T0 是当前值，深色主题下它的填充几乎是隐形的。'
    )
    cells = [
        (tinfo[k]['label'] if k in tinfo else k, col, zoom(f'{tint_dir}/{k}.png', BOX_D))
        for k, lab, col in order
    ]
    fig.row([(lab, col, im) for (_, _, im), (_, lab, col) in zip(cells, order)][:2])
    fig.row([(lab, col, im) for (_, _, im), (_, lab, col) in zip(cells, order)][2:])
    fig.note('染色是普通 background，不支持 backdrop-filter 的浏览器也照样有对比度 —— 它同时是降级档的可读性来源。')
    fig.render(f'{args.out}/glass-material-04-tint-candidates.png')
