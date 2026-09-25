# -*- coding: utf-8 -*-
"""
把 PMM 切成"条目 + 帧区"两段（用 .emm 的路径当锚），看帧区的实际形状。

为什么要用 .emm 当锚：模型条目之间的帧区长度随动画变，靠扫字符串会把名字和路径粘起来。
而 .emm 的 [Object] 段给了每一份用到的路径文本，在 .pmm 里搜到的位置就是路径字段起点；
路径字段是定长 256，所以：

    模型 i 的帧区 = [路径字段 i + 256, 条目 i+1 的名字长度字节)

条目 i+1 的起点靠"往回找两个长度前缀字符串"定（长度字节必须等于实际长度、
且内容像文字），这是能自证的。

用法：
  python tools/pmm-walk.py 切 <pmm> [emm]     打印每个模型的帧区范围与里面的字符串
  python tools/pmm-walk.py 全 <目录> [个数]    批量：多少工程能切干净
"""
import glob
import os
import re
import sys

sys.stdout.reconfigure(errors="backslashreplace")

路径字段长 = 256


def 读(路):
    with open(路, "rb") as f:
        return f.read()


def 单字符长(d, i):
    if i >= len(d):
        return 0
    b = d[i]
    if 32 <= b < 127 or 0xA1 <= b <= 0xDF:
        return 1
    if (0x81 <= b <= 0x9F or 0xE0 <= b <= 0xEF) and i + 1 < len(d):
        t = d[i + 1]
        if 0x40 <= t <= 0x7E or 0x80 <= t <= 0xFC:
            return 2
    return 0


def 扫串(d, 起, 止, 最少=3):
    出 = []
    i = 起
    while i < 止:
        if 单字符长(d, i) == 0:
            i += 1
            continue
        s = i
        while i < 止 and 单字符长(d, i) > 0:
            i += 单字符长(d, i)
        片段 = d[s:i].strip(b" ")
        if len(片段) >= 最少:
            出.append((s, 片段.decode("shift_jis", "replace")))
    return 出


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
    出 = []
    段 = ""
    for 行 in 文本.splitlines():
        行 = 行.strip()
        if 行.startswith("[") and 行.endswith("]"):
            段 = 行.strip("[]")
            continue
        if 段 != "Object" or "=" not in 行:
            continue
        键, 值 = 行.split("=", 1)
        出.append((键.strip(), 值.strip()))
    return 出


def 找路径位(d, 路):
    b = 路.encode("gbk")
    i = d.find(b)
    return i if i >= 0 else None


def 条目起(d, 路径起, 键):
    """定条目起点。

    两种条目的形状不一样（都是实测）：
      · 模型：`u8 名字长 + 名字 + u8 英文名长 + 英文名 + 路径[256]`
      · 附件：`名字[100] + 路径[256]`      ← 附件没有长度前缀，是定长 100 的名字字段
    所以键以 Acs 开头就走附件那条路。
    """
    if 键.startswith("Acs"):
        位 = 路径起 - 100
        if 位 >= 0:
            名 = d[位:路径起].rstrip(b"\x00")
            k = 0
            好 = bool(名)
            while k < len(名):
                步 = 单字符长(名, k)
                if 步 == 0:
                    好 = False
                    break
                k += 步
            if 好:
                return 位, 名.decode("shift_jis", "replace"), "附件(名字[100])"
        return None, "", ""
    候选 = 往回找条目起(d, 路径起)
    if 候选:
        return 候选[0]["起"], 候选[0]["名"], "模型(两个长度前缀名字)"
    return None, "", ""


def 往回找条目起(d, 路径起):
    """从路径字段起点往回找"名字长度+名字+英文名长度+英文名"，返回条目起点候选"""
    候选 = []
    for 英长 in range(0, 80):
        位英 = 路径起 - 1 - 英长
        if 位英 < 1 or d[位英] != 英长:
            continue
        英 = d[位英 + 1:路径起]
        if any(单字符长(英, k) == 0 for k in range(0, len(英), 1)):
            # 英名里必须逐字符合法
            k = 0
            好 = True
            while k < len(英):
                步 = 单字符长(英, k)
                if 步 == 0:
                    好 = False
                    break
                k += 步
            if not 好:
                continue
        for 名长 in range(1, 80):
            位名 = 位英 - 1 - 名长
            if 位名 < 1 or d[位名] != 名长:
                continue
            名 = d[位名 + 1:位英]
            k = 0
            好 = True
            while k < len(名):
                步 = 单字符长(名, k)
                if 步 == 0:
                    好 = False
                    break
                k += 步
            if not 好 or not 名:
                continue
            候选.append(
                {
                    "起": 位名,
                    "名长": 名长,
                    "名": 名.decode("shift_jis", "replace"),
                    "英长": 英长,
                    "英": 英.decode("shift_jis", "replace"),
                }
            )
    # 多个候选时挑"名字能被解码、且名字不含控制字符"的；再挑名长最小的（后缀匹配更短）
    候选.sort(key=lambda c: (c["名长"] + c["英长"]))
    return 候选


def 切(路, emm路=None, 出声=True):
    d = 读(路)
    emm路 = emm路 or os.path.splitext(路)[0] + ".emm"
    if not os.path.isfile(emm路):
        raise ValueError(f"没有配对的 .emm：{emm路}")
    对象 = 从emm(emm路)
    表 = []
    for 键, 路文 in 对象:
        位 = 找路径位(d, 路文)
        if 位 is None:
            continue
        起, 名, 形状 = 条目起(d, 位, 键)
        表.append({"键": 键, "路径": 路文, "路径起": 位, "条目起": 起,
                   "候选数": 1, "名": 名, "形状": 形状})
    表.sort(key=lambda x: x["路径起"])
    if 出声:
        print(f"{os.path.basename(路)}  {len(d):,} 字节   {len(表)} 个对象（按路径位置排）\n")
        for i, e in enumerate(表):
            下 = 表[i + 1] if i + 1 < len(表) else None
            帧起 = e["路径起"] + 路径字段长
            帧止 = 下["条目起"] if 下 and 下["条目起"] else None
            名 = e["名"] or "?"
            if 帧止:
                print(f"  [{e['键']:<7}] {e['形状']:<18} 名字 {名!r:<18} 路径@{e['路径起']:>10,}  "
                      f"帧区 [{帧起:>10,} , {帧止:>10,})  长 {帧止 - 帧起:>8,}")
                串 = 扫串(d, 帧起, min(帧止, 帧起 + 4096), 3)
                前几个 = "、".join(f"{s!r}@{o - 帧起}" for o, s in 串[:5])
                print(f"             帧区里的字符串 {len(串)} 个（只扫前 4KB）：{前几个}")
            else:
                print(f"  [{e['键']:<7}] 名字 {名!r:<20} 路径@{e['路径起']:>10,}  （最后一个对象，帧区到文件尾）")
    return 表


def 全(根, 个数=40):
    工程 = sorted(glob.glob(os.path.join(根, "**", "*.emm"), recursive=True))[:个数]
    好 = 坏 = 0
    帧区长 = []
    for e in 工程:
        pmm = os.path.splitext(e)[0] + ".pmm"
        if not os.path.isfile(pmm):
            continue
        try:
            表 = 切(pmm, e, 出声=False)
        except Exception as ex:
            坏 += 1
            print(f"  失败 {os.path.basename(pmm)}：{ex}")
            continue
        切干净 = all(x["条目起"] for x in 表) and len(表) >= 1
        if 切干净:
            好 += 1
        else:
            坏 += 1
            print(f"  切不干净 {os.path.basename(pmm)}：{len(表)} 个对象里有 "
                  f"{sum(1 for x in 表 if not x['条目起'])} 个定不出条目起点")
        for i in range(len(表) - 1):
            if 表[i]["条目起"] and 表[i + 1]["条目起"]:
                帧区长.append(表[i + 1]["条目起"] - (表[i]["路径起"] + 路径字段长))
    print(f"\n工程 {好 + 坏} 个：切干净 {好}，切不干净 {坏}")
    if 帧区长:
        print(f"帧区长度样本 {len(帧区长)} 个：最小 {min(帧区长):,}  最大 {max(帧区长):,}  "
              f"中位 {sorted(帧区长)[len(帧区长) // 2]:,}")
        print("样例：", sorted(帧区长)[:12])


def 最短(根, 个数=12):
    """把所有能切干净的帧区按长度排序，把最短的那些原样打出来。

    动机：帧区长度随动画变，语义不好猜；但**最短的帧区**等于"这个模型没有关键帧"，
    它的字节就是这套结构的骨架（计数为 0 时剩什么）。从骨架往回推比从大样本里猜容易。
    """
    import glob
    工程 = sorted(glob.glob(os.path.join(根, "**", "*.emm"), recursive=True))[:60]
    段 = []
    for e in 工程:
        pmm = os.path.splitext(e)[0] + ".pmm"
        if not os.path.isfile(pmm):
            continue
        try:
            表 = 切(pmm, e, 出声=False)
        except Exception:
            continue
        for i in range(len(表) - 1):
            a, b = 表[i], 表[i + 1]
            if not a["条目起"] or not b["条目起"]:
                continue
            起 = a["路径起"] + 路径字段长
            止 = b["条目起"]
            if 止 > 起:
                段.append((止 - 起, pmm, a["键"], a["名"], 起, 止))
    段.sort()
    print(f"能切干净的帧区共 {len(段)} 段，最短的 {个数} 段：\n")
    for 长, pmm, 键, 名, 起, 止 in 段[:个数]:
        d = 读(pmm)
        print(f"  {长:>6,} 字节   {os.path.basename(pmm)} [{键}] {名!r}   区间 [{起:,}, {止:,})")
        for i in range(起, min(止, 起 + 96), 16):
            b = d[i:i + 16]
            print(f"      {i:>10,}  {' '.join(f'{x:02X}' for x in b):<47}  "
                  f"{''.join(chr(x) if 32 <= x < 127 else '.' for x in b)}")
    print(f"\n长度分布：最小 {段[0][0] if 段 else '-'}，前 20 短：{[x[0] for x in 段[:20]]}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    if sys.argv[1] == "切":
        切(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
    elif sys.argv[1] == "全":
        全(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 40)
    elif sys.argv[1] == "最短":
        最短(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 12)
    else:
        print(__doc__)
