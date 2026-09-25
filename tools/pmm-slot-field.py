# -*- coding: utf-8 -*-
"""两个结论一次跑完：① 模型帧区首字节 vs .emm 槽位（差值是否恒定）；② 0x35 合成 16 位后的含义。"""
import glob
import os
import struct
import sys

sys.stdout.reconfigure(errors="backslashreplace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib.machinery import SourceFileLoader

E = SourceFileLoader("e", os.path.join(os.path.dirname(os.path.abspath(__file__)), "pmm-entries.py")).load_module()

根 = sys.argv[1] if len(sys.argv) > 1 else r"D:\9.26mmd"
工程 = sorted(glob.glob(os.path.join(根, "**", "*.emm"), recursive=True))[:40]

差值统计 = {}
对子 = 0
工程数 = 0
十六位 = {}
for e in 工程:
    pmm = os.path.splitext(e)[0] + ".pmm"
    if not os.path.isfile(pmm):
        continue
    d = E.读(pmm)
    表 = E.扫条目(d)
    对象 = dict(E.从emm(e))
    模型数 = int(d[0x36])
    找模型 = sum(1 for x in 表 if x["种类"] == "模型")
    if 找模型 != 模型数:
        continue
    工程数 += 1
    # ① 模型帧区首字节 vs 槽位
    for x in 表:
        if x["种类"] != "模型":
            continue
        # 配对改成**整条路径字符串精确匹配**（上一版拿 basename 去比整条路径，配上是 0 个）
        键 = None
        用过的 = set()
        for m in 表:
            if m is not x:
                continue
        for k, v in 对象.items():
            if k.startswith("Pmd") and v == x["路径"] and k not in 用过的:
                键 = k
                用过的.add(k)
                break
        if not 键:
            continue
        槽 = int(键[3:])
        区首 = x["路径起"] + 256
        if 区首 >= len(d):
            continue
        b = d[区首]
        差值统计[b - 槽] = 差值统计.get(b - 槽, 0) + 1
        对子 += 1
    # ② 0x34..0x35 / 0x35..0x36 当 uint16
    十六位.setdefault("u16@0x34", []).append(struct.unpack_from("<H", d, 0x34)[0])
    十六位.setdefault("u16@0x35", []).append(struct.unpack_from("<H", d, 0x35)[0])
    十六位.setdefault("u16@0x36", []).append(struct.unpack_from("<H", d, 0x36)[0])
    # 参照量
    附件数 = sum(1 for k in 对象 if k.startswith("Acs"))
    十六位.setdefault("参照:附件数", []).append(附件数)
    十六位.setdefault("参照:模型数", []).append(模型数)
    十六位.setdefault("参照:帧数(u32@0x26)", []).append(struct.unpack_from("<I", d, 0x26)[0])

print(f"能对齐模型数的工程 {工程数} 个，比对上的模型帧区 {对子} 个\n")
print("① 帧区首字节 − .emm 槽位 的分布（差值 → 次数）：")
for k, v in sorted(差值统计.items()):
    print(f"   {k:>5} → {v}")

print("\n② 0x34/0x35/0x36 合成 16 位后与参照量的比较：")
锁 = list(十六位["参照:模型数"])
for 名 in ("u16@0x34", "u16@0x35", "u16@0x36"):
    vs = 十六位[名]
    匹模型 = sum(1 for a, b in zip(vs, 锁) if a == b)
    print(f"   {名}: 前 10 个 {vs[:10]}   等于模型数的 {匹模型}/{len(vs)}")
print(f"   参照 附件数 前 10 个 {十六位['参照:附件数'][:10]}")
print(f"   参照 模型数 前 10 个 {十六位['参照:模型数'][:10]}")
