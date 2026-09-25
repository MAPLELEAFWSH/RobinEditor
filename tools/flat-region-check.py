# -*- coding: utf-8 -*-
"""
验证「手工灰度绘制 + 纯色化辅助选区」这条路站不站得住。

要回答的问题：**参照产物（lightmap / ILM / FaceSDF）是不是"按基础色里的纯色块整块平涂"的？**
如果是，那"把基础色量化成纯色块 → 让人一块一块定档"就是对的；
如果同一块纯色里产物本身花样很多，那选区辅助也没用，得靠人一笔一笔画。

做法：
  1. 基础色先量化（默认每通道 16 级）取连通块 —— 这就是"纯色化选区"能给出来的东西；
  2. 对每块，看参照产物在该块内的"主档占比"（整块平涂 → 接近 1）；
  3. 对照：把同样的块**随机打散**（打乱空间位置）再测一次，得到"完全没有区域结构"时的基线。
     两个数字的差才是"区域结构真的存在"的证据 —— 只看绝对值会被大片平坦背景骗。

只读。用法：python tools/flat-region-check.py <基础色> <参照产物> [每通道量化级数=16]
"""
import sys

import cv2
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

基础路, 产物路 = sys.argv[1], sys.argv[2]
级数 = int(sys.argv[3]) if len(sys.argv) > 3 else 16


def 载(path, 缩小=2):
    im = Image.open(path).convert('RGBA')
    if 缩小 > 1:
        im = im.resize((max(1, im.width // 缩小), max(1, im.height // 缩小)), Image.NEAREST)
    return np.asarray(im, dtype=np.uint8), im.size


底, 尺寸 = 载(基础路)
产, 产尺寸 = 载(产物路)
if 底.shape != 产.shape:
    产 = np.asarray(Image.open(产物路).convert('RGBA').resize(尺寸, Image.NEAREST), dtype=np.uint8)
    print(f'（参照尺寸不同，缩到 {尺寸[0]}x{尺寸[1]} 再比）')

# 1) 基础色量化成纯色块：先降到每通道 级数 级，再取连通块
阶 = 256 // 级数
量 = (底[..., :3] // 阶).astype(np.int32)
键 = 量[..., 0] * 级数 * 级数 + 量[..., 1] * 级数 + 量[..., 2]
数, 计数 = np.unique(键, return_counts=True)
# 只处理"面积够大"的颜色档（几十个），全 256 档逐个跑连通域在 4096² 上要几分钟
够大 = [(int(v), int(c)) for v, c in zip(数, 计数) if c >= 键.size * 0.002]
够大.sort(key=lambda x: -x[1])
标签 = np.full(键.shape, -1, dtype=np.int32)
联 = np.zeros_like(标签)
块号 = 0
块大小 = []
for v, _c in 够大:
    面 = (键 == v).astype(np.uint8)
    n, m = cv2.connectedComponents(面, connectivity=4)
    for j in range(1, n):
        这 = m == j
        s = int(这.sum())
        if s < 64:
            continue
        标签[这] = v
        联[这] = 块号
        块号 += 1
        块大小.append(s)

print(f'基础色 {基础路.split(chr(92))[-1]}  {尺寸[0]}x{尺寸[1]}（比之前先缩 2 倍）')
非零 = (底[..., :3].max(axis=2) > 2)
print(f'  非黑区 {非零.mean() * 100:.1f}%；量化到每通道 {级数} 级之后：'
      f'占画面 >=0.2% 的颜色 {len(够大)} 档 → {块号} 个连通块（>=64 像素）')
if 块号:
    小 = np.sort(块大小)
    print(f'  块大小：最小 {小[0]}  中位 {int(np.median(小))}  最大 {小[-1]}  合计占画面 {小.sum() / 联.size * 100:.1f}%')

产灰 = 产.astype(np.float64) / 255.0


def 主档占比(标签图, 通道, 取样块数=400, 随机=False):
    """每块内"占最多的那一档"占整块多少 —— 1 就是整块平涂"""
    n = int(标签图.max()) + 1
    候选 = [b for b in range(n) if (标签图 == b).sum() >= 64]
    if len(候选) > 取样块数:
        rng = np.random.default_rng(7)
        候选 = list(rng.choice(候选, 取样块数, replace=False))
    值 = []
    for b in 候选:
        面 = 标签图 == b
        v = 通道[面]
        if v.size == 0:
            continue
        档 = np.round(v * 20).astype(int)
        _, c = np.unique(档, return_counts=True)
        值.append(c.max() / 档.size)
    return float(np.mean(值)) if 值 else float('nan')


rng = np.random.default_rng(11)
# 随机打散：把块号随机重排到空间位置上 —— 保留块大小分布，抹掉"哪块挨着哪块"的结构
打散 = 联.copy()
有块 = 联 > 0
平面 = 打散[有块]
rng.shuffle(平面)
打散[有块] = 平面

名 = ['R', 'G', 'B', 'A']
print(f'\n产物 {产物路.split(chr(92))[-1]}：块内主档占比（越接近 1 越像"整块平涂"）')
print('  通道   按纯色块分（真）   随机打散（基线）   差')
for i in range(4):
    真 = 主档占比(联, 产灰[..., i])
    基 = 主档占比(打散, 产灰[..., i])
    print(f'  {名[i]}      {真:0.3f}              {基:0.3f}          {真 - 基:+.3f}')

# 顺带：产物里到底有多少个不同的档（整块平涂的话档数会很少）
for i in range(4):
    档 = np.round(产灰[..., i] * 20).astype(int)
    u = np.unique(档[非零]) if 非零.any() else np.unique(档)
    print(f'  （{名[i]} 在非黑区上用到的档数：{len(u)}）', end='')
print()
