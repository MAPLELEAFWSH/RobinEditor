# -*- coding: utf-8 -*-
"""
两张图到底对不对得上（同一套 UV 吗）。

这个工程吃过两轮亏：拿错参照比出来的数字**看着很精确，其实毫无意义**
（RobinS 那组底图的内容区跟 lightmap 的 IoU 只有 0.048）。所以做任何"像不像"的结论之前，
先跑这个。

判据四条，任何一条明显不对就该停下来问：
  1. 尺寸
  2. 内容区 IoU（底图非黑 / 产物非黑；底图整张不透明时用非黑当内容）
  3. 底图亮度 ↔ 产物各通道的相关（工程里一直在用的判据是 G 上 > 0.15 才算配上了）
  4. 粗网格占用重叠（64x32 格：两边都有内容的格子占多少）—— 大结构对不上一眼能看出来

只读。用法：python tools/pair-align.py <底图> <产物>
"""
import sys

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

底路, 产路 = sys.argv[1], sys.argv[2]


def 载(p, 缩=2):
    im = Image.open(p).convert('RGBA')
    if 缩 > 1:
        im = im.resize((max(1, im.width // 缩), max(1, im.height // 缩)), Image.LANCZOS)
    return np.asarray(im, dtype=np.float64) / 255.0, im.size


底, 尺寸 = 载(底路)
产, 产尺寸 = 载(产路)
print(f'底 {底路.split(chr(92))[-1]}  {尺寸[0]}x{尺寸[1]}')
print(f'产 {产路.split(chr(92))[-1]}  {产尺寸[0]}x{产尺寸[1]}')
if 底.shape != 产.shape:
    print('  **尺寸不同** —— 先确认这两张是不是同一套 UV，别直接比')
    im = Image.open(产路).convert('RGBA').resize(尺寸, Image.LANCZOS)
    产 = np.asarray(im, dtype=np.float64) / 255.0

底有 = 底[..., :3].max(axis=2) > 2 / 255
产有 = 产[..., :3].max(axis=2) > 2 / 255
if 底有.mean() > 0.995:
    print('  （底图整张不透明/不黑，内容区这条判据对它没有区分力，只看相关与网格）')
else:
    交 = float((底有 & 产有).sum())
    并 = float((底有 | 产有).sum())
    print(f'  内容区：底 {底有.mean() * 100:.1f}%  产 {产有.mean() * 100:.1f}%  '
          f'IoU {交 / max(1, 并):.3f}   （配对的经验线：>0.5 才算同一套 UV）')

底灰 = (0.2126 * 底[..., 0] + 0.7152 * 底[..., 1] + 0.0722 * 底[..., 2]).ravel()
print('  底图亮度 ↔ 产物各通道相关：', end='')
for i, 名 in enumerate('RGBA'):
    y = 产[..., i].ravel()
    r = np.corrcoef(底灰, y)[0, 1] if 底灰.std() > 1e-9 and y.std() > 1e-9 else float('nan')
    print(f'  {名} {r:+.3f}', end='')
print('   （经验线：G > +0.15 才算配上了）')

# 粗网格占用：64x32 格，两边都有内容的格子
H, W = 底有.shape
gh, gw = 32, 64
bh, bw = H // gh, W // gw
if bh > 0 and bw > 0:
    a = 底有[: bh * gh, : bw * gw].reshape(gh, bh, gw, bw).mean(axis=(1, 3)) > 0.15
    b = 产有[: bh * gh, : bw * gw].reshape(gh, bh, gw, bw).mean(axis=(1, 3)) > 0.15
    if a.sum() and b.sum():
        网格 = float((a & b).sum()) / max(1, float((a | b).sum()))
    else:
        网格 = float('nan')
    print(f'  粗网格（{gw}x{gh}）两边都有内容的格子：底 {a.sum()}  产 {b.sum()}  重叠 {网格:.3f}')
    印 = ''.join(''.join('#' if (a[r, c] and b[r, c]) else ('a' if a[r, c] else ('b' if b[r, c] else '·'))
                         for c in range(gw)) + '\n' for r in range(gh))
    if 底有.mean() <= 0.995:
        print('  网格图（# 两边都有 / a 只有底图有 / b 只有产物有）：')
        print(印, end='')
