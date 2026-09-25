#!/usr/bin/env python
"""真实屏幕材质取证（第 2 步 / 共 2 步）—— 配 scripts/glass-material-screen.mjs 使用。

轮询 state.txt，对每个状态做一次**系统级**屏幕抓图（ImageGrab），
按 geo.json 里的 sample 区域量"身后条纹的清晰度"：
    std 小（<20） = 条纹被抹平 = 磨砂真的在采背景
    std 大（>55） = 条纹锐利   = 磨砂没生效（只剩染色）

抓图前会用 Win32 SetWindowPos 把标题匹配的窗口置顶，否则浏览器窗口常被
IDE / 通知遮挡，标记块找不到（实测 SetForegroundWindow 会被前台锁挡住）。

用法：python scripts/glass-material-screen.py tmp/glassScreen
"""
import ctypes
import ctypes.wintypes as wt
import json
import sys
import threading
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageGrab

user32 = ctypes.windll.user32
EnumProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)

# 必须显式声明签名：SetWindowPos 的 hWndInsertAfter 要传 (HWND)-1（HWND_TOPMOST）。
# 不声明 argtypes 时 ctypes 按 C int 传参，-1 在 x64 上被零扩展成
# 0x00000000FFFFFFFF，于是 SetWindowPos **静默失败** —— 置顶一次都没生效，
# 表现为"窗口被遮挡"，而日志里看不出任何错。这个坑排查了很久。
user32.SetWindowPos.argtypes = [
    wt.HWND, wt.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_uint
]
user32.SetWindowPos.restype = wt.BOOL
user32.ShowWindow.argtypes = [wt.HWND, ctypes.c_int]
user32.ShowWindow.restype = wt.BOOL
user32.SetForegroundWindow.argtypes = [wt.HWND]
user32.BringWindowToTop.argtypes = [wt.HWND]
user32.ClientToScreen.argtypes = [wt.HWND, ctypes.POINTER(wt.POINT)]
user32.ClientToScreen.restype = wt.BOOL
user32.GetClientRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
user32.GetClientRect.restype = wt.BOOL
user32.GetWindowTextLengthW.argtypes = [wt.HWND]
user32.GetWindowTextW.argtypes = [wt.HWND, ctypes.c_wchar_p, ctypes.c_int]
user32.IsWindowVisible.argtypes = [wt.HWND]


SW_RESTORE = 9
HWND_TOPMOST = -1
SWP_NOSIZE = 0x0001
SWP_SHOWWINDOW = 0x0040


def topmost(substr, settle=0.7, move_to_origin=True):
    """把标题含 substr 的可见窗口置顶（避开 Windows 抢焦点限制）。

    IDE 会在后台把焦点抢回去，实测单次置顶经常撑不到抓图那一刻，
    所以这里做三件事：先 SW_RESTORE（防止窗口被最小化）、
    再把窗口**移到屏幕左上角**并置为 topmost、最后抢前台。
    调用方仍应在找不到标记时重试。
    """
    hits = []

    def cb(hwnd, _):
        n = user32.GetWindowTextLengthW(hwnd)
        if n and user32.IsWindowVisible(hwnd):
            buf = ctypes.create_unicode_buffer(n + 1)
            user32.GetWindowTextW(hwnd, buf, n + 1)
            if substr.lower() in buf.value.lower():
                hits.append(hwnd)
        return True

    user32.EnumWindows(EnumProc(cb), 0)
    for hwnd in hits:
        user32.ShowWindow(hwnd, SW_RESTORE)
        user32.SetWindowPos(hwnd, wt.HWND(-1), 0, 0, 0, 0, SWP_NOSIZE | SWP_SHOWWINDOW)
        user32.BringWindowToTop(hwnd)
        try:
            user32.SetForegroundWindow(hwnd)
        except Exception:
            pass
    if hits:
        time.sleep(settle)
    return hits[0] if hits else None


def find_mark(a, color):
    r, g, b = color
    m = (np.abs(a[:, :, 0] - r) < 30) & (np.abs(a[:, :, 1] - g) < 30) & (np.abs(a[:, :, 2] - b) < 30)
    ys, xs = np.nonzero(m)
    return (int(xs.min()), int(ys.min()), int(xs.max())) if len(xs) >= 50 else None


def client_box(hwnd):
    """窗口客户区在屏幕上的原点与缩放比（不依赖页面里的定位标记）。

    标记法更可靠（它直接证明页面真的渲染出来了），但窗口被置顶浮层
    （腾讯会议浮窗、NVIDIA Overlay 之流）压住时标记会消失，
    这时退回用 Win32 算出的客户区矩形，至少能把采样点对齐。
    """
    pt = wt.POINT(0, 0)
    user32.ClientToScreen(hwnd, ctypes.byref(pt))
    rc = wt.RECT()
    user32.GetClientRect(hwnd, ctypes.byref(rc))
    return (pt.x, pt.y, rc.right - rc.left, rc.bottom - rc.top)


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else 'tmp/glassScreen')
    geo_path = out / 'geo.json'
    t0 = time.time()
    while not geo_path.exists() and time.time() - t0 < 120:
        time.sleep(0.5)
    geo = json.loads(geo_path.read_text(encoding='utf-8'))
    sf = out / 'state.txt'
    S = geo['sample']
    title = geo.get('title') or 'PROBE-GLASS-SCREEN'

    # 告知 Node 侧"抓图端已就绪"，让两步之间不再竞态（否则常整段状态漏采）。
    # 用一次性 token 文件名：README 式的固定名会被 Node 侧"启动时清理"误删。
    token_file = out / 'token.txt'
    token = token_file.read_text(encoding='utf-8').strip() if token_file.exists() else 'default'
    (out / f'ready-{token}.txt').write_text('1', encoding='utf-8')

    # 后台持续置顶：IDE 会在后台反复抢焦点，只在每帧抓图前置顶一次会经常失败。
    stop = threading.Event()

    def keep():
        while not stop.is_set():
            topmost(title, settle=0)
            time.sleep(0.25)

    th = threading.Thread(target=keep, daemon=True)
    th.start()

    rows, seen = [], None
    deadline = time.time() + 260
    try:
        while time.time() < deadline:
            cur = sf.read_text(encoding='utf-8').strip() if sf.exists() else ''
            if cur in ('', seen):
                time.sleep(0.3)
                continue
            if cur == 'DONE':
                break
            seen = cur
            shot = None
            how = 'marker'
            for attempt in range(5):
                A = np.asarray(ImageGrab.grab(all_screens=True).convert('RGB')).astype(np.int16)
                left = find_mark(A, (0, 255, 255))   # 左标记：青
                right = find_mark(A, (255, 0, 255))  # 右标记：品红
                if left and right:
                    shot = (A, left[0], left[1], (right[2] + 1 - left[0]) / (geo['innerW'] - 24))
                    break
                time.sleep(0.5)
            if not shot:
                # 标记找不到：可能仍是"页面没渲染"，也可能被置顶浮层压住了标记。
                # 退回按客户区矩形定位，并明确标注（这类读数要打折扣看）。
                hwnd = topmost(title, settle=0.25)
                if hwnd:
                    ox, oy, cw, _ = client_box(hwnd)
                    A = np.asarray(ImageGrab.grab(all_screens=True).convert('RGB')).astype(np.int16)
                    shot = (A, ox, oy, cw / geo['innerW'])
                    how = 'clientrect(可能被遮挡)'
            if not shot:
                print(f'{cur}: 窗口被遮挡，跳过')
                continue
            A, x0, y0, scale = shot
            px, py = int(round(x0 + S['x'] * scale)), int(round(y0 + S['y'] * scale))
            pw, ph = int(round(S['w'] * scale)), int(round(S['h'] * scale))
            band = A[py:py + ph, px:px + pw]
            lum = band.astype(np.float64).mean(axis=2)
            rgb = band.reshape(-1, 3).mean(axis=0)
            Image.fromarray(band.astype(np.uint8)).save(out / f'band-{cur}.png')
            Image.fromarray(A.astype(np.uint8)).save(out / f'screen-{cur}.png')
            std = float(lum.std())
            v = '糊平' if std < 20 else ('锐利' if std > 55 else '部分模糊')
            rows.append((cur, std, float(lum.mean()), v))
            print(
                f'{cur:<20} std={std:>6.1f}  亮度={lum.mean():>6.1f}  '
                f'R={rgb[0]:>5.1f} G={rgb[1]:>5.1f} B={rgb[2]:>5.1f}  R-B={rgb[0] - rgb[2]:>6.1f}  {v}  [{how}]'
            )
    finally:
        stop.set()

    print()
    ok = True
    for cur, std, mean, v in rows:
        print(f'  {cur:<12} std={std:>6.1f}  {v}')
    d = {r[0]: r[1] for r in rows}
    if 'ON' in d and 'OFF-fixed' in d:
        print()
        if d['ON'] < 20 and d['OFF-fixed'] > 55:
            print('✅ 因果成立：absolute 下条纹被抹平，fixed 下条纹锐利 ⇒ 修法有效')
        else:
            ok = False
            print(f'❌ 不成立：ON std={d["ON"]:.1f}（应 <20），OFF std={d["OFF-fixed"]:.1f}（应 >55）')
    if not ok:
        sys.exit(1)


if __name__ == '__main__':
    main()
