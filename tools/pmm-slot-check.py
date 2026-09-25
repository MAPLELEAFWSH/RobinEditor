# -*- coding: utf-8 -*-
"""
把附件块（96 字节）逐字段解出来，并核对"文件里存的序号"与 `.emm` 的槽位号关系。

动机：帧区最短的都是 96 字节的附件块，而它们的第一个 u32 是 0,1,2,3,4,5 这样的连续值 ——
说明**文件里存着显式序号**。这决定了"删掉一个条目之后，剩下的要不要改文件内部"。

用法：
  python tools/pmm-slot-check.py 解 <pmm> [最多几块]     逐字段打附件块
  python tools/pmm-slot-check.py 序 <pmm>                列出每个对象的 .emm 槽位 vs 文件里存的序号
  python tools/pmm-slot-check.py 批 <目录> [个数]         批：存的序号是否与某种编号一致
"""
import glob
import os
import struct
import sys

sys.stdout.reconfigure(errors="backslashreplace")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib.machinery import SourceFileLoader  # noqa: E402

走 = SourceFileLoader("pmm_walk", os.path.join(os.path.dirname(os.path.abspath(__file__)), "pmm-walk.py")).load_module()
路径字段长 = 256


def 附件块(d, 路径起, 止):
    """附件块从路径字段之后开始"""
    return 路径起 + 路径字段长, 止


def 解(路, 最多=3):
    d = 走.读(路)
    emm = os.path.splitext(路)[0] + ".emm"
    表 = 走.切(路, emm, 出声=False)
    print(f"{os.path.basename(路)}  {len(d):,} 字节\n")
    n = 0
    for i, e in enumerate(表):
        if not e["键"].startswith("Acs"):
            continue
        if not e["条目起"]:
            continue
        起, 止 = 附件块(d, e["路径起"], 表[i + 1]["条目起"] if i + 1 < len(表) and 表[i + 1]["条目起"] else len(d))
        长 = 止 - 起
        print(f"[{e['键']}] {e['名']!r}  块 [{起:,}, {止:,})  长 {长}")
        if 长 <= 0 or 长 > 512:
            print("    长度不合理，跳过")
            continue
        for o in range(0, 长 - 3, 4):
            u = struct.unpack_from("<I", d, 起 + o)[0]
            f = struct.unpack_from("<f", d, 起 + o)[0]
            i32 = struct.unpack_from("<i", d, 起 + o)[0]
            print(f"    +{o:>3}  u32 {u:>12,}   i32 {i32:>12,}   f32 {f:>14.6g}")
        n += 1
        if n >= 最多:
            break


def 序(路):
    d = 走.读(路)
    emm = os.path.splitext(路)[0] + ".emm"
    表 = 走.切(路, emm, 出声=False)
    print(f"{os.path.basename(路)}  {len(d):,} 字节   （按文件里的先后顺序）\n")
    print(f"{'文件序':>6}  {'键':<8}{'形状':<20}{'名字':<16}{'路径起':>11}{'区首第一个 u32':>16}{'区首第一个字节':>14}")
    for i, e in enumerate(表):
        if not e["条目起"]:
            print(f"{i:>6}  {e['键']:<8}{e.get('形状', '?'):<20}{'(定不出条目起点)'}")
            continue
        区首 = e["路径起"] + 路径字段长
        u = struct.unpack_from("<I", d, 区首)[0] if 区首 + 4 <= len(d) else None
        b = d[区首]
        print(f"{i:>6}  {e['键']:<8}{e.get('形状', '?'):<20}{e['名']!r:<16}{e['路径起']:>11,}"
              f"{u if u is not None else '-':>16}{b:>14}")


def 批(根, 个数=20):
    工程 = sorted(glob.glob(os.path.join(根, "**", "*.emm"), recursive=True))[:个数]
    一致 = 不一致 = 0
    for e in 工程:
        pmm = os.path.splitext(e)[0] + ".pmm"
        if not os.path.isfile(pmm):
            continue
        d = 走.读(pmm)
        try:
            表 = 走.切(pmm, e, 出声=False)
        except Exception:
            continue
        附件序 = []
        for it in 表:
            if it["键"].startswith("Acs") and it["条目起"]:
                区首 = it["路径起"] + 路径字段长
                if 区首 + 4 <= len(d):
                    附件序.append((int(it["键"][3:]) if it["键"][3:].isdigit() else -1,
                                  struct.unpack_from("<I", d, 区首)[0]))
        if len(附件序) < 2:
            continue
        槽 = [k for k, _ in 附件序]
        存 = [v for _, v in 附件序]
        # 假设 A：存的序号 = 0..n-1 的某种排列（按 .emm 槽位从小到大排之后）
        配对 = sorted(zip(槽, 存))
        按槽排 = [v for _, v in 配对]
        if 按槽排 == list(range(len(按槽排))):
            一致 += 1
        else:
            不一致 += 1
            print(f"  {os.path.basename(pmm)}：(槽位, 存序号) = {配对}")
    print(f"\n工程 {一致 + 不一致} 个：存的序号按 .emm 槽位从小到大排后正好是 0..n-1 的 {一致} 个，否 {不一致} 个")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    m = sys.argv[1]
    if m == "解":
        解(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 3)
    elif m == "序":
        序(sys.argv[2])
    elif m == "批":
        批(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 20)
    else:
        print(__doc__)
