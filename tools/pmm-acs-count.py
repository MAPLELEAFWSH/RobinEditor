# -*- coding: utf-8 -*-
"""附件数在哪：三条假设一次试掉（只读）。"""
import glob, os, struct, sys
sys.stdout.reconfigure(errors="backslashreplace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib.machinery import SourceFileLoader
E = SourceFileLoader("e", os.path.join(os.path.dirname(os.path.abspath(__file__)), "pmm-entries.py")).load_module()
根 = r"D:\9.26mmd"
工程 = sorted(glob.glob(os.path.join(根, "**", "*.emm"), recursive=True))[:40]
命中 = {"头部0x2E..0x3F有#Acs": 0, "头部0x2E..0x3F有总数": 0, "附件区后有#Acs": 0, "附件区后有总数": 0}
样本 = 0
例 = []
for e in 工程:
    pmm = os.path.splitext(e)[0] + ".pmm"
    if not os.path.isfile(pmm):
        continue
    d = E.读(pmm)
    对象 = E.从emm(e)
    n模型 = sum(1 for k, _v in 对象 if k.startswith("Pmd"))
    n附件 = sum(1 for k, _v in 对象 if k.startswith("Acs"))
    if n附件 == 0 or d[0x36] != n模型:
        continue
    样本 += 1
    总数 = n模型 + n附件
    头 = d[0x2E:0x40]
    有附件 = any(头[i] == n附件 for i in range(len(头))) or any(struct.unpack_from("<H", 头, i)[0] == n附件 for i in range(len(头) - 1))
    有总数 = any(头[i] == 总数 for i in range(len(头))) or any(struct.unpack_from("<H", 头, i)[0] == 总数 for i in range(len(头) - 1))
    命中["头部0x2E..0x3F有#Acs"] += 1 if 有附件 else 0
    命中["头部0x2E..0x3F有总数"] += 1 if 有总数 else 0
    # 附件区之后：取最后一个附件条目的路径字段之后
    表 = E.扫条目(d)
    附 = [x for x in 表 if x["种类"] == "附件"]
    if 附:
        尾 = 附[-1]["路径起"] + 256
        后 = d[尾:尾 + 64]
        有A = any(后[i] == n附件 for i in range(len(后))) or any(struct.unpack_from("<H", 后, i)[0] == n附件 for i in range(len(后) - 1))
        有T = any(后[i] == 总数 for i in range(len(后))) or any(struct.unpack_from("<H", 后, i)[0] == 总数 for i in range(len(后) - 1))
        命中["附件区后有#Acs"] += 1 if 有A else 0
        命中["附件区后有总数"] += 1 if 有T else 0
        if len(例) < 5:
            例.append((os.path.basename(pmm), n模型, n附件, 尾, 后.hex(" ")))
print(f"可对账工程 {样本} 个\n")
for k, v in 命中.items():
    print(f"  {k:<22} {v}/{样本}")
print()
for n, a, b, 尾, h in 例:
    print(f"  {n}  模型{a} 附件{b}  附件尾 {尾:,}  后 64 字节 {h}")
