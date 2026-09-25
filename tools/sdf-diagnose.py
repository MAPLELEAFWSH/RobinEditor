# -*- coding: utf-8 -*-
"""
SDF / FaceMap 这条路的诊断：把"基础色 → 期望的 SDF"这层关系量出来。

背景：用户给了一张脸部 diffuse（`Face_Color.png`）和一张 SDF/FaceMap
（`W_160_Maid_FaceMap_02.png`），说我们出的 `..._FaceSDF.png` 严重偏差。
我们那张是**原神式编码**（R 二值遮罩 + A 带符号距离、G/B 空），
而参照那张 R/G 都是有内容的档 —— 所以先量清楚参照里每个档"对应基础色的什么"。

只读。用法：python tools/sdf-diagnose.py <基础色> <参照SDF> [我们的输出...]
"""
import os
import sys

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def 载灰度档(path):
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im, dtype=np.float64) / 255.0
    档 = np.round(a * 255).astype(np.uint8)
    return im, a, 档


底路, 参路 = sys.argv[1], sys.argv[2]
其他 = sys.argv[3:]

底, 底a, 底档 = 载灰度档(底路)
参, 参a, 参档 = 载灰度档(参路)
print(f'基础色 {os.path.basename(底路)}  {底.width}x{底.height}')
print(f'参照   {os.path.basename(参路)}  {参.width}x{参.height}')
if (底.width, 底.height) != (参.width, 参.height):
    print('  尺寸不同：先把参照缩到基础色的尺寸再比')
    参 = 参.resize(底.size, Image.LANCZOS)
    参a = np.asarray(参.convert('RGBA'), dtype=np.float64) / 255.0
    参档 = np.round(参a * 255).astype(np.uint8)

底灰 = 底a[..., 0] * 0.299 + 底a[..., 1] * 0.587 + 底a[..., 2] * 0.114
底彩 = 底a[..., :3].max(axis=2) - 底a[..., :3].min(axis=2)
底亮 = 底灰 > 0.5

print('\n=== 参照每个档位对应基础色的什么 ===')
for 通 in ['R', 'G', 'B', 'A']:
    列 = 参档[..., 'RGBA'.index(通)]
    值, 数 = np.unique(列, return_counts=True)
    主要 = [(v, c) for v, c in zip(值, 数) if c / 列.size >= 0.005]
    if len(主要) > 6:
        主要 = sorted(主要, key=lambda x: -x[1])[:6]
    print(f'  参照 {通}:')
    for v, c in sorted(主要, key=lambda x: -x[0]):
        面 = 列 == v
        print(f'    {v:3d}（{c / 列.size * 100:5.1f}%）→ 基础色 灰度均值 {底灰[面].mean():.3f}'
              f'  彩度 {底彩[面].mean():.3f}  亮部占比 {底亮[面].mean() * 100:5.1f}%'
              f'  R/G/B 均值 {底a[..., 0][面].mean():.2f}/{底a[..., 1][面].mean():.2f}/{底a[..., 2][面].mean():.2f}')

print('\n=== 参照内部：A 与 R、G 的关系（掩膜是不是在 A 里）===')
for 通 in ['R', 'G']:
    列 = 参档[..., 'RGBA'.index(通)]
    for v in [0, 128, 255]:
        面 = 列 == v
        if 面.sum() < 100:
            continue
        print(f'  {通}=={v} 的像素里：A==0 {np.mean(参档[..., 3][面] == 0) * 100:5.1f}%，'
              f'A==255 {np.mean(参档[..., 3][面] == 255) * 100:5.1f}%，A 均值 {参a[..., 3][面].mean():.3f}')

for 路 in 其他:
    if not os.path.isfile(路):
        print(f'\n（没有 {路}）')
        continue
    我, 我a, 我档 = 载灰度档(路)
    print(f'\n=== 我们出的 {os.path.basename(路)} ===')
    for 通 in ['R', 'G', 'B', 'A']:
        列 = 我档[..., 'RGBA'.index(通)]
        值, 数 = np.unique(列, return_counts=True)
        top = sorted(zip(值, 数), key=lambda x: -x[1])[:4]
        print(f'  {通}: 去重 {len(值):3d} 档  ' + '  '.join(f'{v}({c / 列.size * 100:.1f}%)' for v, c in top))
    # 跟参照的 R/G 比：二值遮罩落在参照的哪些档上
    if (我.width, 我.height) == (参.width, 参.height):
        我白 = 我档[..., 0] > 128
        for 通 in ['R', 'G']:
            列 = 参档[..., 'RGBA'.index(通)]
            print(f'  我们 R==白 的那片，在参照 {通} 上是：'
                  + '  '.join(f'{v} {np.mean(列[我白] == v) * 100:5.1f}%' for v in [0, 128, 255] if (列 == v).sum() > 100))
        for 通 in ['R', 'G']:
            列 = 参档[..., 'RGBA'.index(通)] > 128
            print(f'  参照 {通}==白 的那片，在我们 R 上是：白 {np.mean(我档[..., 0][列] > 128) * 100:5.1f}%'
                  f' / 黑 {np.mean(我档[..., 0][列] <= 128) * 100:5.1f}%'
                  f'   重叠 IoU {np.mean(我白 & 列) / max(1, np.mean(我白 | 列)):.3f}')
