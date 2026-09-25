# -*- coding: utf-8 -*-
"""
两份"几乎相同"的 PMM 差分：用长度不同的两份样本，找出**记录边界**。

思路：两份文件的差别只在于多/少了一个对象或几帧，差分处就是记录边界；
偏移错位的起点能告诉我们被插入/删除的那一段有多长。

用法：python tools/pmm-diff.py <a.pmm> <b.pmm> [最多打印几处]
"""
import sys

sys.stdout.reconfigure(errors="backslashreplace")


def 读(路):
    with open(路, "rb") as f:
        return f.read()


def 主(a, b, 上限=12):
    A = 读(a)
    B = 读(b)
    print(f"A {a}  {len(A):,} 字节")
    print(f"B {b}  {len(B):,} 字节   差 {len(B) - len(A):+,}\n")

    # 从两边各找一个"锚点"：把共同前缀和共同后缀剥掉
    前 = 0
    while 前 < min(len(A), len(B)) and A[前] == B[前]:
        前 += 1
    后 = 0
    while 后 < min(len(A), len(B)) - 前 and A[len(A) - 1 - 后] == B[len(B) - 1 - 后]:
        后 += 1
    print(f"共同前缀 {前:,} 字节；共同后缀 {后:,} 字节")
    print(f"→ A 中间 {len(A) - 前 - 后:,} 字节，B 中间 {len(B) - 前 - 后:,} 字节\n")

    def 显示(d, 起, 长):
        行 = []
        for i in range(起, min(起 + 长, len(d)), 16):
            段 = d[i:i + 16]
            十六 = " ".join(f"{x:02X}" for x in 段)
            可读 = "".join(chr(x) if 32 <= x < 127 else "." for x in 段)
            行.append(f"    {i:>12,}  {十六:<47}  {可读}")
        return "\n".join(行)

    print("A 的分歧处前后（含 64 字节上下文）：")
    print(显示(A, max(0, 前 - 64), (len(A) - 前 - 后) + 128))
    print("\nB 的分歧处前后：")
    print(显示(B, max(0, 前 - 64), (len(B) - 前 - 后) + 128))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    主(sys.argv[1], sys.argv[2])
