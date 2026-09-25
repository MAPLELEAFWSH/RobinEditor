# -*- coding: utf-8 -*-
"""
批量差分：从一堆成对样本里挑出"共同前缀最长、差异最小"的那些。

思路：共同前缀越长，分歧点越靠近某个**记录边界**；差异越小，被增删的那一段越短、
越容易看出它是什么。所以先按"共同前缀长度"排序，再逐个拆。

用法：python tools/pmm-diff-batch.py [根目录] [最少共同前缀]
"""
import glob
import os
import sys

sys.stdout.reconfigure(errors="backslashreplace")

根 = sys.argv[1] if len(sys.argv) > 1 else r"D:\9.26mmd"
至少前缀 = int(sys.argv[2]) if len(sys.argv) > 2 else 200

文件 = sorted(glob.glob(os.path.join(根, "**", "*.pmm"), recursive=True))
print(f"{根} 下 {len(文件)} 个 .pmm\n")


def 读(路):
    with open(路, "rb") as f:
        return f.read()


def 比(a, b):
    A, B = 读(a), 读(b)
    n = min(len(A), len(B))
    前 = 0
    while 前 < n and A[前] == B[前]:
        前 += 1
    后 = 0
    while 后 < n - 前 and A[len(A) - 1 - 后] == B[len(B) - 1 - 后]:
        后 += 1
    return 前, 后, len(A), len(B)


结果 = []
for i in range(len(文件)):
    for j in range(i + 1, len(文件)):
        a, b = 文件[i], 文件[j]
        大小a, 大小b = os.path.getsize(a), os.path.getsize(b)
        # 只看大小接近的配对，差太多不用比
        if 大小a == 0 or 大小b == 0:
            continue
        if max(大小a, 大小b) / max(1, min(大小a, 大小b)) > 1.05:
            continue
        前, 后, la, lb = 比(a, b)
        if 前 >= 至少前缀:
            结果.append((前, abs(la - lb), a, b, la, lb, 后))

结果.sort(key=lambda x: (-x[0], x[1]))
print(f"共同前缀 >= {至少前缀} 的配对：{len(结果)} 组，按共同前缀从长到短：\n")
print(f"{'共同前缀':>10}{'大小差':>9}   A / B")
print("-" * 110)
for 前, 差, a, b, la, lb, 后 in 结果[:25]:
    print(f"{前:>10,}{差:>9,}   {os.path.basename(a)} ({la:,})")
    print(f"{'':>19}   {os.path.basename(b)} ({lb:,})   共同后缀 {后:,}")
