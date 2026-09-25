# -*- coding: utf-8 -*-
"""
量「涟漪到底在文字上面还是下面」：用像素判，不靠看。

做法：先在没点的那张里找出**宿主框内的浅色像素**（按钮上的白字这类），
再看点下去之后那些像素有没有变。变了 = 涟漪盖在文字上面；没变 = 在下面。

第一版栽过：面具没裁到宿主框里，把卡片的白底也当成"文字"了（占 35%），
量出来的是"背景变了没有"，跟文字层级无关。

用法：
  node tools/cdp-ripple-zoom.mjs .btn
  python tools/cdp-ripple-layer.py
"""
import json
import os

import numpy as np
from PIL import Image

元 = json.load(open('tmp/ripple/zoom-rect.json', encoding='utf-8'))
边 = 元['边'] * 元['scale']
基 = np.asarray(Image.open('tmp/ripple/zoom-0-未点.png').convert('RGB'), dtype=np.int16)
高, 宽 = 基.shape[:2]
x0, y0 = int(边), int(边)
x1, y1 = int(元['w'] * 元['scale'] + 边), int(元['h'] * 元['scale'] + 边)
内 = np.zeros((高, 宽), dtype=bool)
内[max(0, y0):min(高, y1), max(0, x0):min(宽, x1)] = True

灰 = 基.mean(axis=2)
彩度 = 基.max(axis=2) - 基.min(axis=2)
文字 = 内 & (灰 > 205) & (彩度 < 26)
宿主面积 = int(内.sum())
print(f"{元['选']}：宿主框内 {宿主面积} 个像素，其中浅色（字/图标）{int(文字.sum())} 个，占 {文字.sum() / max(1, 宿主面积) * 100:.1f}%")
if 文字.sum() < 30:
    print('  浅色像素太少，这个判据在这台宿主上不适用。')
    raise SystemExit(0)

for 名 in ['zoom-120ms.png', 'zoom-300ms.png']:
    p = f'tmp/ripple/{名}'
    if not os.path.exists(p):
        continue
    图 = np.asarray(Image.open(p).convert('RGB'), dtype=np.int16)
    差 = np.abs(图 - 基).sum(axis=2)
    变的字 = int((差[文字] > 6).sum())
    print(
        f'  {名:16s} 字像素变了 {变的字:6d} / {int(文字.sum())}（{变的字 / max(1, int(文字.sum())) * 100:5.1f}%）'
        f'   宿主框内变了 {int((差[内] > 6).sum()):6d} / {宿主面积}'
    )
print('  判读：字像素大量变 → 涟漪盖在字**上面**；几乎不变 → 画在字下面')
