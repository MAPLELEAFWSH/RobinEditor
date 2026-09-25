# -*- coding: utf-8 -*-
"""
绝区零 `_N` 放大核的裁决：同一组真配对，**同时**算两个指标。

背景：这个默认核被两个模块各量过一次，结论相反 —— ⑤ 用 MAE 量出 lanczos 更好
（0.131 vs 最邻近 0.533），⑦ 用"逐像素完全相同比例"量出最邻近更好（85.28%）。
两个数都是真的，量的是不同的东西：MAE 惩罚"每个像素都差一点点"（平滑核的特征），
相同比例惩罚"本来该一模一样的地方被改了"（最邻近的优势）。

本脚本把两个指标放在**同一组配对**上一起算，结论（复测，四核）：
lanczos 两个样本的 MAE 都最低，相同比例也只差 0.2 / 0.6 个百分点 → **默认 lanczos**。
⑦ 那个 85.28% 复现不出来 —— 拿真值 LM 当参照，最邻近是 84.26% / 73.09%。
不论它当时量的是哪一组，结论都不变。

素材（只读）：`实战测试用例\\渲染联动\\养乐多\\MMDStarRail4Fun_v2.2.1\\ZZZ\\vivian\\`
  Vivian_Body_1_{A,M,N,D,LM}.png、Vivian_Body_2_{...} —— 真配对：A/M/N → LM

用法：python tools/zzz-kernel.py
"""
import os

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

根 = r"E:\deepseek-harness\mmd集成工具\实战测试用例\渲染联动\养乐多\MMDStarRail4Fun_v2.2.1\ZZZ\vivian"


def 载(path, size=None, 核=Image.NEAREST):
    im = Image.open(path).convert("RGBA")
    if size and im.size != size:
        im = im.resize(size, 核)
    return im.size, np.asarray(im, dtype=np.float64)


print(f"目录：{根}\n")
for 名 in ["Vivian_Body_1", "Vivian_Body_2"]:
    A = os.path.join(根, f"{名}_A.png")
    M = os.path.join(根, f"{名}_M.png")
    N = os.path.join(根, f"{名}_N.png")
    LM = os.path.join(根, f"{名}_LM.png")
    if not all(os.path.isfile(p) for p in (A, M, N, LM)):
        print(f"{名}：缺文件，跳过")
        continue
    尺寸A, a = 载(A)
    尺寸M, m = 载(M)
    尺寸N, n = 载(N)
    尺寸L, lm = 载(LM)
    print(f"=== {名} ===")
    print(f"  _A {尺寸A}   _M {尺寸M}   _N {尺寸N}   LM {尺寸L}")
    if not (尺寸A == 尺寸M == 尺寸L):
        print("  A/M/LM 尺寸不一致，这条配对不适合拿来量（先别用）\n")
        continue

    # LM 的排法：R ← _A.G、G ← _N.B、B ← _M.B、A = 1
    参考R = lm[:, :, 0]
    参考G = lm[:, :, 1]
    参考B = lm[:, :, 2]

    print("  （先看两个不涉及缩放的通道，确认配对是同一套 UV）")
    for 通道, 源 in (("R ← _A.G", a[:, :, 1]), ("B ← _M.B", m[:, :, 2])):
        差 = np.abs(源 - 参考R if 通道.startswith("R") else 源 - 参考B)
        同 = float((np.round(源) == (参考R if 通道.startswith("R") else 参考B)).mean()) * 100
        print(f"    {通道}: MAE {差.mean():.3f}  完全相同 {同:.2f}%")

    print("  （G ← _N.B 要缩放，三种核各来一遍）")
    print("     核        MAE(0-255)   完全相同比例   相关")
    for 名字, 核 in (
        ("最邻近", Image.NEAREST),
        ("双线性", Image.BILINEAR),
        ("双三次", Image.BICUBIC),
        ("Lanczos", Image.LANCZOS),
    ):
        _, n2 = 载(N, 尺寸L, 核)
        源 = n2[:, :, 2]
        差 = np.abs(源 - 参考G)
        # 完全相同比例按四舍五入后的整数比（素材是 8 位，差 0.4 也是"同一个值"）
        同 = float((np.round(源) == 参考G).mean()) * 100
        精确 = float((np.abs(源 - 参考G) < 1e-6).mean()) * 100
        r = np.corrcoef(源.ravel(), 参考G.ravel())[0, 1]
        print(f"     {名字:6s}   {差.mean():8.3f}   {同:9.2f}%   {精确:6.2f}%   {r:+.4f}")
    print()

print("判读：")
print("  · 完全相同比例高 = 没动到不该动的地方（比如大片常量区）")
print("  · MAE 低 = 整体更贴（但平滑核会把边界糊开）")
print("  · 两个指标打架时，看**哪一片在贡献差异**：常量区内被改 → 相同比例掉；边界处被糊 → MAE 好")
