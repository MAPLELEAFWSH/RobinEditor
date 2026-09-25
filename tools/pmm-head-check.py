# -*- coding: utf-8 -*-
"""
PMM 头部字段的交叉验证：拿十几份不同大小、不同分辨率的样本一起量，
只有**在所有样本上都成立**的解释才算结论。

用法：python tools/pmm-head-check.py
"""
import glob
import os
import struct

根 = r"D:\9.26mmd"
样本 = []
for 子 in (r"PMM数据", r"Henceforth\save", r"mme\RAY", r"mme\ComicalEdge_v0_54\samples"):
    for p in glob.glob(os.path.join(根, 子, "*.pmm")):
        样本.append(p)
样本.sort(key=os.path.getsize)
# 挑小的、中的、大的各几份，别只量一类
挑 = 样本[:6] + 样本[len(样本) // 2: len(样本) // 2 + 3] + 样本[-3:]
挑 = sorted(set(挑), key=os.path.getsize)

print(f"共 {len(挑)} 份样本（{os.path.getsize(挑[0]):,} ~ {os.path.getsize(挑[-1]):,} 字节）\n")
print(f"{'文件':<34}{'大小':>12}  {'0x18-0x30 的 uint32':<34}  {'签名':<28}")
print("-" * 116)

可能 = {}
for p in 挑:
    with open(p, "rb") as f:
        d = f.read(0x40)
    名 = os.path.basename(p)
    大小 = os.path.getsize(p)
    u32 = [struct.unpack_from("<I", d, o)[0] for o in (0x1A, 0x1E, 0x22, 0x26, 0x2A)]
    签名 = d[:26].rstrip(b"\x00").decode("ascii", "replace")
    print(f"{名:<34}{大小:>12,}  {str(u32):<34}  {签名:<28}")
    # 统计每个偏移上出现的值，看哪个偏移像"屏幕宽/高"
    for o, v in zip((0x1A, 0x1E, 0x22, 0x26, 0x2A), u32):
        可能.setdefault(o, []).append(v)

print("\n各偏移上出现过的值（只列前 40 个不同的）：")
for o, vs in 可能.items():
    独 = sorted(set(vs))
    print(f"  0x{o:02X}: {len(独)} 种  例 {独[:12]}")

print("\n哪种解释站得住：")
for o in (0x1A, 0x1E, 0x22, 0x26, 0x2A):
    vs = 可能[o]
    合理 = sum(1 for v in vs if 320 <= v <= 7680)
    print(f"  偏移 0x{o:02X} 落在 320~7680 的样本数：{合理}/{len(vs)}")
