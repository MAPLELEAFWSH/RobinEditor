# -*- coding: utf-8 -*-
"""
量「SDF / FaceMap 规格」那一套参照图 —— 每个游戏一套，用来定各游戏的编码。

用户给的规格目录：`…\参考工具制作的效果\MSToon\原神\SDF规格\<游戏>\`
  原神     5 张 `Avatar_*_Tex_FaceLightmap.png`
  星铁    10 张 `*_FaceMap_*.png`
  绝区零   1 张 `Female_Face_Lightmap.png`

要回答的：**每个游戏那张图里，哪个通道放什么、用哪些档、通道之间什么关系。**
（我们现在的编码只有"原神式 / msToon 式 / 纯距离场"三种，而且"原神式"做出来的是
R 二值遮罩 + A 距离场 —— 拿星铁那张一比就对不上，所以要按游戏重定。）

只读。用法：python tools/sdf-spec.py <SDF规格目录>
"""
import os
import sys

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

根 = sys.argv[1]
GRID = 20


def 量(path):
    im = Image.open(path).convert('RGBA')
    return im, np.asarray(im, dtype=np.float64) / 255.0


def 档表(通道, 最少=0.02):
    lv = np.round(np.clip(通道, 0, 1) * GRID).astype(int)
    v, c = np.unique(lv, return_counts=True)
    return [(x / GRID, n / lv.size) for x, n in zip(v, c) if n / lv.size >= 最少]


for 游戏 in sorted(os.listdir(根)):
    目录 = os.path.join(根, 游戏)
    if not os.path.isdir(目录):
        continue
    文件 = sorted(f for f in os.listdir(目录) if f.lower().endswith('.png'))
    print(f'===== {游戏}（{len(文件)} 张）=====')
    汇总 = {c: {} for c in 'RGBA'}
    关系 = []
    for f in 文件:
        im, a = 量(os.path.join(目录, f))
        print(f'  {f}  {im.width}x{im.height}')
        for i, c in enumerate('RGBA'):
            for 档, p in 档表(a[..., i]):
                汇总[c][档] = 汇总[c].get(档, 0) + p / len(文件)
        # 通道之间：G 是不是就等于 R？A 是不是遮罩？
        同 = np.mean(np.abs(a[..., 0] - a[..., 1]) < 1 / 255) * 100
        关系.append((f, 同, float((a[..., 3] > 0.5).mean() * 100), float((a[..., 0] < 2 / 255).mean() * 100)))
        print('     ' + '  '.join(
            f'{c}:' + ','.join(f'{lv:.2f}×{p * 100:.0f}%' for lv, p in 档表(a[..., i])[:4]) for i, c in enumerate('RGBA')))
    print(f'  ── 全组平均档位占比（只在 >=2% 的档上）──')
    for c in 'RGBA':
        项 = sorted(汇总[c].items(), key=lambda kv: -kv[1])[:5]
        print(f'    {c}: ' + '  '.join(f'{lv:.2f} = {p * 100:4.1f}%' for lv, p in 项))
    print(f'  ── 通道关系 ──')
    print(f'    R 与 G 完全相同的比例：' + '  '.join(f'{x[1]:.0f}%' for x in 关系) )
    print(f'    A 平均不透明占比 {np.mean([x[2] for x in 关系]):.1f}%；R 的纯黑占比 {np.mean([x[3] for x in 关系]):.1f}%')
    print()
