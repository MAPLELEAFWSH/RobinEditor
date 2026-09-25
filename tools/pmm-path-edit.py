# -*- coding: utf-8 -*-
"""
PMM 路径原地改写验证：模型/附件路径都在定长 256 字节的字段里，
那把旧路径换成新路径时，**只要不超过 256 字节就能原地覆写** —— 文件长度不变、
后面的东西一律不动、也不需要解码关键帧区。

这一步要是成立，"工程搬到别处还能直接打开"这一半现在就能做；
("缺文件就把条目删掉"那一半不行，那要动关键帧区的计数，见规格 §4。)

用法：
  python tools/pmm-path-edit.py 列 <文件>                    列出所有路径字段的位置与内容
  python tools/pmm-path-edit.py 改 <文件> <出文件> <第几条> <新路径>
"""
import os
import sys

sys.stdout.reconfigure(errors="backslashreplace")

路径字段长 = 256


def 读(路):
    with open(路, "rb") as f:
        return f.read()


def 名单起(d):
    """模型条目从这个偏移开始（实测：签名24 + 4 + 宽4 + 高4 + 帧4 + 帧率4 + 7开关 + 2计数 + 1）"""
    return 0x38


def 扫条目(d):
    """按"长度前缀名字 + 长度前缀英文名 + 定长256路径"走模型条目。

    只走名字与路径这一段（关键帧区还没解，所以走到第一个模型的路径末尾就停，
    后面的路径字段用**扫描**的办法找：凡是定长 256 里装着像路径的串的都算）。
    """
    出 = []
    o = 名单起(d)
    条数 = 0
    while o < len(d):
        名长 = d[o]
        if not (1 <= 名长 <= 60) or o + 1 + 名长 > len(d):
            break
        名 = d[o + 1:o + 1 + 名长]
        o2 = o + 1 + 名长
        英长 = d[o2]
        if not (0 <= 英长 <= 60) or o2 + 1 + 英长 > len(d):
            break
        英 = d[o2 + 1:o2 + 1 + 英长]
        o3 = o2 + 1 + 英长
        路起 = o3
        路 = d[o3:o3 + 路径字段长]
        终止 = 路.find(b"\x00")
        内容 = 路[:终止] if 终止 >= 0 else 路
        可读 = 内容.decode("gbk", "replace")
        if not (内容 and (b":" in 内容 or b"\\" in 内容)):
            break
        出.append(
            {
                "序": len(出),
                "名字起": o,
                "名": 名.decode("shift_jis", "replace"),
                "英": 英.decode("shift_jis", "replace"),
                "路径起": 路起,
                "路径": 可读,
                "字节长": len(内容),
            }
        )
        条数 += 1
        # 第一个模型之后，用扫描找后面的路径（关键帧区不解析）
        剩 = d[路起 + 路径字段长:]
        break
    # 扫描：找所有"定长 256 字段"里的路径（判据：字段末尾（偏移+256）落在零区或下一个字段边界）
    i = 路起 + 路径字段长 if 出 else 名单起(d)
    while i < len(d) - 路径字段长:
        if d[i] in (0x00,):
            i += 1
            continue
        # 试着从 i 开始读一段非零、然后到 256 字节处应当是 0 或下一个条目
        终止 = d.find(b"\x00", i, i + 路径字段长)
        if 终止 < 0:
            i += 1
            continue
        内容 = d[i:终止]
        像 = (b":" in 内容 or b"\\" in 内容) and all(32 <= x < 127 or x >= 0x80 for x in 内容)
        if not 像:
            i += 1
            continue
        # 起点是否落在"256 边界"上：以第一个模型路径起为基准
        基准 = (i - 出[0]["路径起"]) % 路径字段长 == 0 if 出 else False
        出.append(
            {
                "序": len(出),
                "名字起": None,
                "名": "",
                "英": "",
                "路径起": i,
                "路径": 内容.decode("gbk", "replace"),
                "字节长": len(内容),
                "对齐256": 基准,
            }
        )
        i = 终止 + 1
    return 出


def 列(路):
    d = 读(路)
    print(f"{路}  {len(d):,} 字节\n")
    for e in 扫条目(d):
        print(f"  [{e['序']:>3}] 路径起 {e['路径起']:>10,}  长 {e['字节长']:>3}  "
              f"{'对齐256' if e.get('对齐256') else '      '}  {e['路径']}")
        if e["名"]:
            print(f"        名字 {e['名']!r} / 英文 {e['英']!r}")


def 改(路, 出, 序, 新):
    d = bytearray(读(路))
    表 = 扫条目(路)
    序 = int(序)
    if 序 >= len(表):
        print(f"  只有 {len(表)} 条，没有第 {序} 条")
        return
    e = 表[序]
    新字节 = 新.encode("gbk")
    if len(新字节) > 路径字段长 - 1:
        print(f"  新路径 {len(新字节)} 字节，超过字段上限（{路径字段长 - 1}），原地写不下")
        return
    起 = e["路径起"]
    旧 = bytes(d[起:起 + 路径字段长])
    d[起:起 + 路径字段长] = 新字节 + b"\x00" * (路径字段长 - len(新字节))
    with open(出, "wb") as f:
        f.write(bytes(d))
    print(f"  写副本 {出}")
    print(f"    第 {序} 条：{e['路径']!r} → {新!r}（{e['字节长']} → {len(新字节)} 字节）")
    print(f"    文件长度 {len(读(路)):,} → {os.path.getsize(出):,}（必须相等）")
    a = 读(路)
    b = 读(出)
    差 = [i for i in range(len(a)) if a[i] != b[i]]
    print(f"    与原件不同的字节：{len(差)} 个，全部落在路径字段内："
          f"{'是' if 差 and min(差) >= 起 and max(差) < 起 + 路径字段长 else '否'}")
    if 差:
        print(f"    差异区间 {min(差):,} ~ {max(差):,}（字段 {起:,} ~ {起 + 路径字段长 - 1:,}）")


def 从emm(emm路):
    """读 .emm 的 [Object] 段：{键: 路径}，按出现顺序"""
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


def 找(pmm路, emm路):
    """用 .emm 里的路径去 .pmm 里定位字段。

    为什么这么绕：PMM 的模型条目之间夹着关键帧区（还没解），
    靠扫字符串会把"模型名"和"路径"粘成一条。而 .emm 里**正好有同一批路径的文本**，
    拿它当锚点搜 .pmm，命中位置就是路径字段的起点 —— 而且能顺带验两者是否一致。
    """
    d = 读(pmm路)
    print(f"{pmm路}  {len(d):,} 字节")
    print(f"{emm路}\n")
    对象 = 从emm(emm路)
    print(f"  .emm 的 [Object] 共 {len(对象)} 条\n")
    好 = 0
    for 键, 路 in 对象:
        字节 = 路.encode("gbk")
        位置 = []
        起 = 0
        while True:
            i = d.find(字节, 起)
            if i < 0:
                break
            位置.append(i)
            起 = i + 1
        标记 = ""
        if len(位置) == 1:
            i = 位置[0]
            字段 = d[i:i + 路径字段长]
            终止 = 字段.find(b"\x00")
            对 = 终止 == len(字节) and all(x == 0 for x in d[i + 终止:i + 路径字段长])
            标记 = "← 字段尾部是补零，像定长 256 字段" if 对 else "← 尾部不是补零，可疑"
            好 += 1 if 对 else 0
        print(f"  [{键:<8}] 命中 {len(位置)} 处 {位置}  {标记}")
        print(f"            {路}")
    print(f"\n  只有一处命中且尾部补零的（可安全原地改写）：{好} / {len(对象)}")


def 改(pmm路, 出, 键, 新):
    """按 .emm 的键定位 .pmm 里的路径字段，原地覆写（长度不变）"""
    emm路 = os.path.splitext(pmm路)[0] + ".emm"
    if not os.path.isfile(emm路):
        print(f"  找不到配对的 .emm：{emm路}")
        return
    对象 = dict(从emm(emm路))
    if 键 not in 对象:
        print(f"  .emm 里没有键 {键}；有的是：{list(对象)[:12]}")
        return
    d = bytearray(读(pmm路))
    旧字节 = 对象[键].encode("gbk")
    新字节 = 新.encode("gbk")
    if len(新字节) > 路径字段长 - 1:
        print(f"  新路径 {len(新字节)} 字节，超过定长字段上限（{路径字段长 - 1}）")
        return
    i = bytes(d).find(旧字节)
    if i < 0:
        print("  .pmm 里找不到这条旧路径")
        return
    d[i:i + 路径字段长] = 新字节 + b"\x00" * (路径字段长 - len(新字节))
    with open(出, "wb") as f:
        f.write(bytes(d))
    a = 读(pmm路)
    b = 读(出)
    差 = [k for k in range(len(a)) if a[k] != b[k]]
    print(f"  写副本 {出}")
    print(f"    {键}: {对象[键]!r}（{len(旧字节)} 字节）→ {新!r}（{len(新字节)} 字节）")
    print(f"    文件长度 {len(a):,} → {os.path.getsize(出):,}  相等：{'是' if len(a) == os.path.getsize(出) else '否'}")
    print(f"    与原件不同的字节 {len(差)} 个，区间 {min(差):,} ~ {max(差):,}"
          f"（字段 {i:,} ~ {i + 路径字段长 - 1:,}，全在字段内："
          f"{'是' if min(差) >= i and max(差) < i + 路径字段长 else '否'}）")


def 扫(根, 最多=40):
    """一批工程：.emm 里的路径能不能在 .pmm 里定位、文件在不在盘上。

    这组数字直接决定"打包成自包含目录"要处理多少缺失。
    """
    import glob
    emms = sorted(glob.glob(os.path.join(根, "**", "*.emm"), recursive=True))
    print(f"{根} 下 {len(emms)} 个 .emm，抽查前 {min(最多, len(emms))} 个\n")
    工程数 = 0
    路径总 = 定位到 = 在盘上 = 0
    缺清单 = []
    for e in emms[:最多]:
        pmm = os.path.splitext(e)[0] + ".pmm"
        if not os.path.isfile(pmm):
            continue
        工程数 += 1
        d = 读(pmm)
        对象 = 从emm(e)
        for 键, 路 in 对象:
            路径总 += 1
            i = d.find(路.encode("gbk"))
            if i >= 0:
                定位到 += 1
            候选 = 路 if os.path.isabs(路) else os.path.join(os.path.dirname(os.path.dirname(pmm)), 路)
            if os.path.isfile(候选):
                在盘上 += 1
            else:
                缺清单.append((os.path.basename(pmm), 键, 路))
    print(f"工程 {工程数} 个；.emm 里的对象路径 {路径总} 条")
    print(f"  能在 .pmm 里定位到的：{定位到}（{定位到 / 路径总 * 100 if 路径总 else 0:.1f}%）")
    print(f"  文件在盘上的：{在盘上}（{在盘上 / 路径总 * 100 if 路径总 else 0:.1f}%）")
    print(f"  找不到的：{len(缺清单)} 条，例：")
    for n, k, 路 in 缺清单[:10]:
        print(f"    [{n}] {k} = {路}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    模式 = sys.argv[1]
    if 模式 == "列":
        列(sys.argv[2])
    elif 模式 == "找":
        找(sys.argv[2], sys.argv[3])
    elif 模式 == "改":
        改(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
    elif 模式 == "扫":
        扫(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 40)
    else:
        print(__doc__)
