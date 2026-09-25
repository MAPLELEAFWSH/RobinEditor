# -*- coding: utf-8 -*-
"""
找"模型条目"从哪一字节开始：拿一批模型数不同的样本，比对头部之后那十几个字节，
哪一字节跟着"模型数"变，它就是模型数。

用法：python tools/pmm-model-start.py
"""
import glob
import os
import struct

根 = r"D:\9.26mmd"
样本 = []
for 子 in (r"PMM数据", r"Henceforth\save"):
    for p in glob.glob(os.path.join(根, 子, "*.pmm")):
        样本.append(p)
样本.sort(key=os.path.getsize)
# 分布取：小、中、大
挑 = 样本[:8] + 样本[len(样本) // 3: len(样本) // 3 + 4] + 样本[-4:]
挑 = sorted(set(挑), key=os.path.getsize)


def 数模型(d):
    """数 .pmx / .pmd 出现次数（模型路径），只看前 4 MB，够用"""
    return d[: 4 << 20].lower().count(b".pmx") + d[: 4 << 20].lower().count(b".pmd")


print(f"{'文件':<30}{'大小':>12}{'.pmx数':>8}   偏移 0x28-0x3C 的字节")
print("-" * 118)
for p in 挑:
    with open(p, "rb") as f:
        d = f.read(0x60)
    with open(p, "rb") as f:
        头 = f.read(4 << 20)
    名 = os.path.basename(p)
    段 = d[0x28:0x3D]
    print(f"{名:<30}{os.path.getsize(p):>12,}{数模型(头):>8}   {' '.join(f'{b:02X}' for b in 段)}")

print()
print("逐字节统计（看哪一列跟模型数一起变）：")
表 = {}
for p in 挑:
    with open(p, "rb") as f:
        d = f.read(0x60)
        f.seek(0)
        头 = f.read(4 << 20)
    for i in range(0x28, 0x3D):
        表.setdefault(i, []).append((数模型(头), d[i]))
for i, 列 in 表.items():
    值 = [v for _, v in 列]
    print(f"  0x{i:02X}: 取值 {sorted(set(值))}")
