# -*- coding: utf-8 -*-
"""
`.emm` 的编号是不是"稠密的位置编号"？这直接决定删条目要不要整体前移。

判据：把 `[Object]` 里所有 `Pmd<N>` / `Acs<N>` 的 N 收起来，
看它们是不是**正好等于 1..K**（K = 模型数 + 附件数，不重不漏）。
若不是（有空洞），说明 N 是"历史编号"，删掉一个不用动别人；
若是，说明 N 是位置编号，删掉一个后面全要前移。

用法：python tools/emm-numbering.py [根目录] [个数]
"""
import glob
import os
import re
import sys

sys.stdout.reconfigure(errors="backslashreplace")

根 = sys.argv[1] if len(sys.argv) > 1 else r"D:\9.26mmd"
个数 = int(sys.argv[2]) if len(sys.argv) > 2 else 60


def 读(路):
    with open(路, "rb") as f:
        return f.read()


def 键(emm路):
    文本 = None
    for 编码 in ("utf-8-sig", "gbk", "shift_jis"):
        try:
            文本 = 读(emm路).decode(编码)
            break
        except UnicodeDecodeError:
            continue
    if 文本 is None:
        文本 = 读(emm路).decode("gbk", "replace")
    段 = ""
    对象 = {}
    for 行 in 文本.splitlines():
        行 = 行.strip()
        if 行.startswith("[") and 行.endswith("]"):
            段 = 行.strip("[]")
            continue
        if 段 != "Object" or "=" not in 行:
            continue
        名 = 行.split("=", 1)[0].strip()
        m = re.match(r"^(Pmd|Acs)(\d+)$", 名)
        if m:
            对象[名] = (m.group(1), int(m.group(2)))
    return 对象


工程 = sorted(glob.glob(os.path.join(根, "**", "*.emm"), recursive=True))[:个数]
稠密 = 空洞 = 0
重号 = 0
例 = []
for e in 工程:
    对象 = 键(e)
    if not 对象:
        continue
    号 = sorted(v for _, v in 对象.values())
    K = len(号)
    if len(set(号)) != K:
        重号 += 1
        if len(例) < 6:
            例.append((os.path.basename(e), "重号", 号[:12]))
        continue
    if 号 == list(range(1, K + 1)):
        稠密 += 1
    else:
        空洞 += 1
        if len(例) < 6:
            缺 = [x for x in range(1, max(号) + 1) if x not in 号]
            例.append((os.path.basename(e), f"号 {号[0]}..{号[-1]} 共 {K} 个，缺 {缺[:8]}", 号[:12]))

print(f"抽查 {len(工程)} 个 .emm\n")
print(f"编号正好是 1..K（稠密、位置编号）：**{稠密} 个**")
print(f"有空洞（历史编号）：{空洞} 个")
print(f"有重号：{重号} 个")
for n, 说, 号 in 例:
    print(f"  {n}：{说}   前几个 {号}")
print()
if 稠密 and 空洞 == 0 and 重号 == 0:
    print("结论：编号是**位置编号**（稠密）→ 删掉中间一个，后面的键必须整体前移。")
elif 空洞:
    print("结论：至少有一部分 .emm 的编号有空洞 → 删条目后的重写规则不能只按'前移'来做，"
          "必须按'保留原有编号、只处理被删的那个'或另找规则（见规格）。")
