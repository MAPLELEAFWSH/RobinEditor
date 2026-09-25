# -*- coding: utf-8 -*-
"""
量"模型路径"这个字段到底多长：路径是定长缓冲，没有长度前缀。
办法：找到第一条路径的结尾（\0），再看它之后**第一个非零字节**离结尾多远。
多份样本一致的话，那个距离就是缓冲大小（或某个字段的起点）。

用法：python tools/pmm-path-size.py
"""
import glob
import os
import struct
import sys

sys.stdout.reconfigure(errors="backslashreplace")

根 = r"D:\9.26mmd"
样本 = []
for 子 in (r"PMM数据", r"Henceforth\save"):
    for p in glob.glob(os.path.join(根, 子, "*.pmm")):
        样本.append(p)
样本.sort(key=os.path.getsize)
挑 = 样本[:6] + 样本[len(样本) // 2: len(样本) // 2 + 3] + 样本[-3:]
挑 = sorted(set(挑), key=os.path.getsize)

# 头部长度：签名 26 + 4(恒0) + 4宽 + 4高 + 4帧数 + 4帧率 + 7 flag + 2 计数 + 1 = 0x38 处是第一个名字长度
名字起 = 0x38


def 读名(d, o):
    """读 uint8 长度 + 该长度的字节；返回 (字符串, 下一个偏移)"""
    n = d[o]
    b = d[o + 1: o + 1 + n]
    try:
        s = b.decode("shift_jis")
    except UnicodeDecodeError:
        s = b.decode("shift_jis", "replace")
    return s, o + 1 + n


print(f"{'文件':<30}{'第一个模型名':<18}{'英文名':<14}{'路径结尾':>10}{'路径后第一个非零':>18}{'距离':>8}")
print("-" * 112)
结论 = []
for p in 挑:
    with open(p, "rb") as f:
        d = f.read(1 << 20)
    if len(d) < 0x400:
        continue
    名1, o1 = 读名(d, 名字起)
    名2, o2 = 读名(d, o1)
    # 路径从 o2 开始，到第一个 \0 结束
    结尾 = d.index(b"\x00", o2)
    # 往后找第一个非零字节
    非零 = 结尾 + 1
    while 非零 < len(d) and d[非零] == 0:
        非零 += 1
    距离 = 非零 - 结尾
    结论.append((os.path.basename(p), 结尾, 非零, 距离))
    print(f"{os.path.basename(p):<30}{名1:<18}{名2:<14}{结尾:>10}{非零:>18}{距离:>8}")

print()
距离们 = sorted(set(c[3] for c in 结论))
print(f"距离取值：{距离们}")
print(f"模型路径字段本身的长度（路径结尾 - 路径起点）：看下面")
for p in 挑[:6]:
    with open(p, "rb") as f:
        d = f.read(1 << 20)
    名1, o1 = 读名(d, 名字起)
    名2, o2 = 读名(d, o1)
    结尾 = d.index(b"\x00", o2)
    print(f"  {os.path.basename(p):<30} 路径起点 0x{o2:04X} 结尾 0x{结尾:04X} 内容长度 {结尾 - o2}")
