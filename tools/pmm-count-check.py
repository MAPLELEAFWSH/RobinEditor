# -*- coding: utf-8 -*-
"""
头部两个计数（0x35 / 0x36）到底是什么？拿 .emm 的对象数当参照反推。

思路：`.emm` 的 [Object] 段把模型（Pmd*）和附件（Acs*）分开列，数量是可数的。
如果某个计数字节在多个工程上都等于"模型数"或"对象数"，它就是那个计数。

用法：python tools/pmm-count-check.py [根目录] [个数]
"""
import glob
import os
import sys

sys.stdout.reconfigure(errors="backslashreplace")

根 = sys.argv[1] if len(sys.argv) > 1 else r"D:\9.26mmd"
个数 = int(sys.argv[2]) if len(sys.argv) > 2 else 60


def 读(路):
    with open(路, "rb") as f:
        return f.read()


def 从emm(emm路):
    文本 = None
    for 编码 in ("utf-8-sig", "gbk", "shift_jis"):
        try:
            文本 = 读(emm路).decode(编码)
            break
        except UnicodeDecodeError:
            continue
    if 文本 is None:
        文本 = 读(emm路).decode("gbk", "replace")
    pmd, acs = [], []
    段 = ""
    for 行 in 文本.splitlines():
        行 = 行.strip()
        if 行.startswith("[") and 行.endswith("]"):
            段 = 行.strip("[]")
            continue
        if 段 != "Object" or "=" not in 行:
            continue
        键 = 行.split("=", 1)[0].strip()
        if 键.startswith("Pmd"):
            pmd.append(键)
        elif 键.startswith("Acs"):
            acs.append(键)
    return pmd, acs


工程 = sorted(glob.glob(os.path.join(根, "**", "*.emm"), recursive=True))[:个数]
print(f"抽查 {len(工程)} 个工程\n")
print(f"{'工程':<32}{'0x35':>5}{'0x36':>5}{'#Pmd':>6}{'#Acs':>6}   命中")
print("-" * 86)
命中 = {"0x35=#Pmd": 0, "0x35=#Acs": 0, "0x35=#Pmd+#Acs": 0,
        "0x36=#Pmd": 0, "0x36=#Acs": 0, "0x36=#Pmd+#Acs": 0}
有效 = 0
样例 = []
for e in 工程:
    pmm = os.path.splitext(e)[0] + ".pmm"
    if not os.path.isfile(pmm):
        continue
    d = 读(pmm)
    if len(d) < 0x40 or not d.startswith(b"Polygon Movie maker"):
        continue
    c35, c36 = d[0x35], d[0x36]
    pmd, acs = 从emm(e)
    n, a = len(pmd), len(acs)
    命中行 = []
    if c35 == n:
        命中["0x35=#Pmd"] += 1
        命中行.append("0x35=模型数")
    if c35 == a:
        命中["0x35=#Acs"] += 1
    if c35 == n + a:
        命中["0x35=#Pmd+#Acs"] += 1
        命中行.append("0x35=对象数")
    if c36 == n:
        命中["0x36=#Pmd"] += 1
        命中行.append("0x36=模型数")
    if c36 == a:
        命中["0x36=#Acs"] += 1
        命中行.append("0x36=附件数")
    if c36 == n + a:
        命中["0x36=#Pmd+#Acs"] += 1
        命中行.append("0x36=对象数")
    有效 += 1
    if len(样例) < 25:
        样例.append((os.path.basename(pmm)[:30], c35, c36, n, a, "、".join(命中行) or "都不等"))
for 行 in 样例:
    print(f"{行[0]:<32}{行[1]:>5}{行[2]:>5}{行[3]:>6}{行[4]:>6}   {行[5]}")
print(f"\n有效工程 {有效} 个，各假设命中数：")
for k, v in sorted(命中.items(), key=lambda kv: -kv[1]):
    print(f"  {k:<16} {v:>4}  ({v / 有效 * 100 if 有效 else 0:.0f}%)")
