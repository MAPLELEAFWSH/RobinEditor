"""精确解 B 窗口：用区间求交，不暴力搜。

对每对 (输入 v, 实测输出 out)：
    floor(255·(1 − v/hi)) == out
  ⟺ out ≤ 255 − 255v/hi < out + 1
  ⟺ 255v/(255−out) ≤ hi < 255v/(255−out−1)
把所有对的区间求交，交集就是 hi 的可行范围。
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(r'E:\deepseek-harness\mmd集成工具\参考工具样本\参考工具制作的效果\MSToon')
PAIRS = [
    ('原神\\Vesna', 'Avatar_Girl_Sword_Vesna_Tex_Body_Lightmap.png', 'GI_Converted_Body_Lightmap.png'),
    ('崩坏：星穹铁道\\RobinS', 'Avatar_RobinS_00_Body_LightMap_L.png', 'HSR_Converted_Body_Lightmap.png'),
    ('崩坏：星穹铁道\\RobinS', 'Avatar_RobinS_00_Hair_LightMap.png', 'HSR_Converted_Hair_Lightmap.png'),
]

for grp, src, prod in PAIRS:
    d = ROOT / grp
    G = np.asarray(Image.open(d / src).convert('RGBA')).astype(np.int16)[:, :, 1]
    B = np.asarray(Image.open(d / prod).convert('RGBA')).astype(np.int16)[:, :, 2]
    if G.shape != B.shape:
        print(f'{prod}: 尺寸不同，跳过')
        continue
    # 抽 LUT，顺便确认确定性
    lut = {}
    conflict = 0
    for v in np.unique(G):
        u = np.unique(B[G == v])
        if len(u) > 1:
            conflict += 1
        lut[int(v)] = int(u[0])

    lo_all, hi_all = 0.0, float('inf')
    tight = []
    for v, out in sorted(lut.items()):
        if v == 0:
            if out != 255:
                print(f'  !! v=0 时 out={out}，不是 255 —— 形式不对')
            continue
        if out >= 255:
            # 需要 255 − 255v/hi ≥ 255，只有 v=0 才可能
            print(f'  !! v={v} 时 out={out}，形式对不上')
            continue
        a = 255.0 * v / (255 - out) if out > 0 else 0.0
        b = 255.0 * v / (255 - out - 1) if (255 - out - 1) > 0 else float('inf')
        if a > lo_all:
            lo_all = a
        if b < hi_all:
            hi_all = b
            tight.append((v, out, a, b))
    print(f'\n{prod}   LUT {len(lut)} 项，冲突 {conflict}')
    if lo_all < hi_all:
        print(f'  hi 的可行区间：[{lo_all:.6f}, {hi_all:.6f})   宽度 {hi_all - lo_all:.6f}')
        mid = (lo_all + hi_all) / 2
        print(f'  取中值 {mid:.6f}（= 0..1 里的 {mid/255:.6f}）')
    else:
        print(f'  区间为空（lo {lo_all:.6f} ≥ hi {hi_all:.6f}）→ 形式还不对，或者窗口不止一个参数')
        # 报最紧的那几个约束
        tight.sort(key=lambda t: t[3] - t[2])
        for v, out, a, b in tight[:5]:
            print(f'    v={v:>3} out={out:>3} 要求 hi ∈ [{a:.4f}, {b:.4f})')
