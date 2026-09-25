# -*- coding: utf-8 -*-
"""
涟漪截图对比：`tools/cdp-ripple-probe.mjs` 拍的那几张跟空白那张做像素差，
按宿主矩形裁开，报"点下去之后框里变了多少像素、变化集中在哪"。

判读：
  · 变化像素占宿主面积 > 1% → 涟漪看得见
  · ≈ 0 → 画到别的层上去了（被宿主/子元素的背景盖住），这就是"图层不对"
  · 变化在宿主框之外 → 定位算错了

用法：python tools/cdp-ripple-diff.py
"""
import json
import os

import numpy as np
from PIL import Image

目录 = "tmp/ripple"
空白 = np.asarray(Image.open(os.path.join(目录, "blank.png")).convert("RGB"), dtype=np.int16)
记录 = json.load(open(os.path.join(目录, "rects.json"), encoding="utf-8"))
# 截图是物理像素，矩形是 CSS 像素 —— 150% 屏上不乘这个比例会整体偏左上
比例 = 1.5 if os.path.exists(os.path.join(目录, "dpr.txt")) and open(os.path.join(目录, "dpr.txt")).read().strip() != "1" else 1.0

for r in 记录:
    im = np.asarray(Image.open(r["文件"]).convert("RGB"), dtype=np.int16)
    if im.shape != 空白.shape:
        print(f"{r['sel']}: 尺寸跟空白那张不一样，跳过")
        continue
    差 = np.abs(im - 空白).sum(axis=2)
    变化 = 差 > 12
    总变化 = int(变化.sum())
    x0, y0 = int(r["x"] * 比例), int(r["y"] * 比例)
    x1, y1 = int((r["x"] + r["w"]) * 比例), int((r["y"] + r["h"]) * 比例)
    框内 = 变化[max(0, y0):y1, max(0, x0):x1]
    框内数 = int(框内.sum())
    面积 = max(1, (y1 - max(0, y0)) * (x1 - max(0, x0)))
    在哪 = "–"
    if 总变化:
        ys, xs = np.nonzero(变化)
        在哪 = f"全图变化范围 x {xs.min()}~{xs.max()} y {ys.min()}~{ys.max()}"
    print(
        f"{r['sel']:14s} {str(r['text']):14s} 宿主 {x0},{y0} {x1 - x0}x{y1 - y0}"
        f"   框内变化 {框内数:6d} px（占宿主 {框内数 / 面积 * 100:5.2f}%）   全图变化 {总变化:6d} px   {在哪}"
    )
