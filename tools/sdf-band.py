# -*- coding: utf-8 -*-
"""
星铁 FaceMap 里 R 的三档到底是什么：拿 G 当二值遮罩，看 R==0.5 落在哪。

如果 R==0.5 正好是"G 遮罩的边界那一圈"，那 R 就是「外 / 边界 / 内」三值图，G 是二值遮罩；
不是的话（比如 R==0.5 是一片独立区域），那就得另找语义 —— 这个不能猜，写进算法之前必须定死。

只读。用法：python tools/sdf-band.py <FaceMap 目录>
"""
import os
import sys

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

根 = sys.argv[1]
档0 = 0.5 / 20  # 0.5 的网格档


def 邻域边(面):
    """二值掩膜的边界：自己跟四邻里有一边不同"""
    b = 面
    边 = np.zeros_like(b)
    边[1:, :] |= b[1:, :] != b[:-1, :]
    边[:-1, :] |= b[1:, :] != b[:-1, :]
    边[:, 1:] |= b[:, 1:] != b[:, :-1]
    边[:, :-1] |= b[:, 1:] != b[:, :-1]
    return 边


文件 = sorted(f for f in os.listdir(根) if f.lower().endswith('.png') and 'FaceMap' in f)
for f in 文件[:4]:
    a = np.asarray(Image.open(os.path.join(根, f)).convert('RGBA'), dtype=np.float64) / 255.0
    R = np.abs(a[..., 0] - 0.5) < 0.03
    G = a[..., 1] > 0.5
    边 = 邻域边(G)
    # 把边界往外扩 2 像素，看 R==0.5 有多少落在这个带里
    带 = 边.copy()
    for _ in range(2):
        扩 = 带.copy()
        扩[1:, :] |= 带[:-1, :]
        扩[:-1, :] |= 带[1:, :]
        扩[:, 1:] |= 带[:, :-1]
        扩[:, :-1] |= 带[:, 1:]
        带 = 扩
    n = int(R.sum())
    print(f'{f}')
    print(f'  R≈0.5 的像素 {n}（{n / R.size * 100:.2f}%）  其中落在 G 边界 ±2px 带里的：'
          f'{int((R & 带).sum()) / max(1, n) * 100:.1f}%')
    print(f'  R==1 的像素里 G==1 的占 {int((a[..., 0] > 0.95)[G].sum()) / max(1, int(G.sum())) * 100:.1f}%'
          f'   R==0 的像素里 G==0 的占 '
          f'{int((a[..., 0] < 0.02)[~G].sum()) / max(1, int((~G).sum())) * 100:.1f}%')
    A = a[..., 3]
    print(f'  A：G==1 处均值 {A[G].mean():.3f}；A 的取值去重 {len(np.unique(np.round(A * 20)))} 档')
