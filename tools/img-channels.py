# -*- coding: utf-8 -*-
"""
看几张图的通道结构：尺寸、每通道的档位分布、去重个数、纯黑/纯白占比、alpha、相关性。

为什么单独一个：这个工程里"某张图到底是什么"这种问题反复出现
（SDF 是哪条、lightmap 的哪条通道对得上、这张是不是纯色底）。
一张一张用不同脚本量，结论就没法互相比。统一口径：**每通道**的
去重档数 / 前几名占比 / 纯黑纯白占比 / 均值，外加任选两张的逐通道相关。

只读。用法：
  python tools/img-channels.py <图片...>
  python tools/img-channels.py --对 <图A> <图B>     # 逐通道相关 + 只在"有数据"处相关
"""
import sys

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def 载(p):
    im = Image.open(p)
    a = np.asarray(im.convert('RGBA'), dtype=np.float64) / 255.0
    return im, a


def 报一通道(a, i, 名, 每行=6):
    通道 = a[..., i]
    档 = np.round(通道 * 255).astype(np.uint8)
    值, 数 = np.unique(档, return_counts=True)
    n = 档.size
    排 = np.argsort(-数)[:每行]
    top = '  '.join(f'{值[k]}({数[k] / n * 100:.1f}%)' for k in 排)
    print(f'    {名}: 去重 {len(值):3d} 档  纯黑 {np.mean(档 == 0) * 100:5.1f}%  纯白 {np.mean(档 == 255) * 100:5.1f}%  均值 {通道.mean():.3f}')
    print(f'         最常见 {top}')


def 报一张(p):
    im, a = 载(p)
    print(f'{p}')
    print(f'  模式 {im.mode}  尺寸 {im.width}x{im.height}')
    for i, 名 in enumerate('RGBA'):
        报一通道(a, i, 名)
    # 灰度化之后还剩多少档 —— "纯色底 vs 手绘" 就看这个
    灰 = np.round((a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114) * 255).astype(np.uint8)
    值, 数 = np.unique(灰, return_counts=True)
    主 = np.sort(数)[::-1]
    print(f'    灰度: 去重 {len(值)} 档；前 8 档合计 {主[:8].sum() / 灰.size * 100:.1f}%，'
          f'前 64 档合计 {主[:64].sum() / 灰.size * 100:.1f}%')
    if im.mode == 'RGBA' or True:
        非全不透明 = np.mean(a[..., 3] < 1) * 100
        print(f'    alpha: 去重 {len(np.unique(np.round(a[..., 3] * 255)))}  不全不透明 {非全不透明:.1f}%')
    print()


def 对两张(pa, pb):
    ia, a = 载(pa)
    ib, b = 载(pb)
    print(f'A {pa}  {ia.width}x{ia.height}')
    print(f'B {pb}  {ib.width}x{ib.height}')
    if a.shape != b.shape:
        print('  尺寸不一致，逐像素比不了；先把 B 缩到 A 的尺寸再看有没有关系')
        b = np.asarray(Image.open(pb).convert('RGBA').resize((ia.width, ia.height), Image.LANCZOS), dtype=np.float64) / 255.0
    print('  逐通道相关（全图 / 只在 A 该通道"有数据"的像素上）:')
    for i, 名 in enumerate('RGBA'):
        x = a[..., i].ravel()
        y = b[..., i].ravel()
        r = np.corrcoef(x, y)[0, 1] if x.std() > 1e-9 and y.std() > 1e-9 else float('nan')
        面 = a[..., i].ravel() > 2 / 255
        r2 = float('nan')
        if 面.sum() > 100 and y[面].std() > 1e-9:
            r2 = np.corrcoef(x[面], y[面])[0, 1]
        print(f'    {名}: 全图 {r:+.3f}   有数据处 {r2:+.3f}（{面.mean() * 100:.1f}% 的像素）')
    print('  交叉最大相关（A 的哪条最像 B 的哪条）:')
    for i, 名 in enumerate('RGBA'):
        best = max(((np.corrcoef(a[..., i].ravel(), b[..., j].ravel())[0, 1], j) for j in range(4)
                    if a[..., i].std() > 1e-9 and b[..., j].std() > 1e-9), default=(float('nan'), 0))
        print(f'    A.{名} ↔ B.{"RGBA"[best[1]]}  {best[0]:+.3f}')


if __name__ == '__main__':
    args = sys.argv[1:]
    if args and args[0] == '--对':
        对两张(args[1], args[2])
    else:
        for p in args:
            报一张(p)
