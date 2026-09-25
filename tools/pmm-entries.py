# -*- coding: utf-8 -*-
"""
按**条目形状**扫出 PMM 里所有对象的起点（不靠搜路径）。

为什么必须这样：`.pmm` 的路径字段是定长 256、**写入时不清零**（旧路径片段会残留在别的字段里），
所以"全局搜路径的第一处"会定到残留上；上一轮的负长度（-356 = 100+256）就是这么来的。

两种条目的形状（都实测过）：
  · 模型：`u8 名字长 + 名字(SJIS) + u8 英文名长 + 英文名(SJIS) + 路径[256]`
  · 附件：`名字[100]（0 补齐） + 路径[256]`

扫法：全文件逐字节试这两个签名，路径字段要求"256 字节内有 \0 结尾、内容像盘符路径"。
扫完按偏移排序，相邻条目之间就是**帧区**，首尾相接不留缝即为切干净。

用法：
  python tools/pmm-entries.py 扫 <pmm> [emm]      列出所有条目 + 帧区长度
  python tools/pmm-entries.py 批 <目录> [个数]     批量：30 个工程能切干净几个
  python tools/pmm-entries.py 序 <pmm> [emm]      列出"帧区首字节/首 u32" vs .emm 槽位（查有没有槽位号）
"""
import glob
import os
import re
import struct
import sys

sys.stdout.reconfigure(errors="backslashreplace")

路径字段长 = 256
附件名字长 = 100


def 读(路):
    with open(路, "rb") as f:
        return f.read()


def 单字符长(d, i, 止=None):
    止 = 止 if 止 is not None else len(d)
    if i >= 止:
        return 0
    b = d[i]
    if 32 <= b < 127 or 0xA1 <= b <= 0xDF:
        return 1
    if (0x81 <= b <= 0x9F or 0xE0 <= b <= 0xEF) and i + 1 < 止:
        t = d[i + 1]
        if 0x40 <= t <= 0x7E or 0x80 <= t <= 0xFC:
            return 2
    return 0


def 全合法文本(d, 起, 止, 最少=0):
    if 止 <= 起:
        return 最少 == 0
    k = 起
    n = 0
    while k < 止:
        步 = 单字符长(d, k, 止)
        if 步 == 0:
            return False
        k += 步
        n += 1
    return n >= 最少


def 读路径字段(d, 起):
    """路径字段：定长 256，取到第一个 \\0；没有 \\0 就整段都算（超长路径会被截断）。

    解码**不能只试 GBK**：路径多数是 ANSI/GBK，但野生文件里也有按 SJIS 存的日文路径，
    严格 GBK 解码会把整条条目丢掉（这就是模型侧漏检的原因之一）。
    """
    if 起 + 路径字段长 > len(d):
        return None
    字段 = d[起:起 + 路径字段长]
    终 = 字段.find(b"\x00")
    if 终 < 0:
        终 = 路径字段长
    if 终 <= 0:
        return None
    内容 = 字段[:终]
    # 只收绝对路径。**试过放开成"相对路径也收"，结果假阳性暴涨（附件数 16/13、22/18 全超标，
    # 批量判据从 16/30 掉到 4/30）** —— 因为残留片段常常也是"像相对路径"的短串。所以退回严格版。
    if not (b":" in 内容 or b"\\" in 内容):
        return None
    for x in 内容:
        if x < 32:
            return None
    文本 = None
    for 编 in ("gbk", "shift_jis", "cp932", "latin-1"):
        try:
            文本 = 内容.decode(编)
            break
        except UnicodeDecodeError:
            continue
    return 文本


def 基名(路):
    return re.split(r"[\\/]", 路)[-1]


def 名与路径一致(名, 路, 种类):
    """条目名必须等于路径的文件名。

    这条是**假阳性的解药**：路径字段写入时不清零，旧路径片段会残留在其它字段里，
    那些片段也能凑出"名字[100] + 像路径的 256 字节"，但它的名字是路径片段、
    跟后面那个路径字段的文件名对不上。实测（Flyer1）五条真条目全部满足：
    `Flyer`↔`Flyer.pmx`、`Time of day`↔`Time of day.pmx`、`ray_controller`↔`ray_controller.pmx`、
    `ray.x`↔`ray.x`、`WorkingFloorAL.x`↔`WorkingFloorAL.x`。
    """
    基 = 基名(路)
    干 = 基.rsplit(".", 1)[0] if "." in 基 else 基
    if 种类 == "附件":
        return 名 == 基 or 名 == 干
    return 名 == 干 or 名 == 基 or 名.startswith(干) or 干.startswith(名)


def 试模型(d, o):
    if o < 1 or o + 3 > len(d):
        return None
    名长 = d[o]
    if not (1 <= 名长 <= 60):
        return None
    if not 全合法文本(d, o + 1, o + 1 + 名长, 1):
        return None
    名 = d[o + 1:o + 1 + 名长].decode("shift_jis", "replace")
    位英长 = o + 1 + 名长
    if 位英长 >= len(d):
        return None
    英长 = d[位英长]
    if not (0 <= 英长 <= 60):
        return None
    if not 全合法文本(d, 位英长 + 1, 位英长 + 1 + 英长):
        return None
    英 = d[位英长 + 1:位英长 + 1 + 英长].decode("shift_jis", "replace")
    路起 = 位英长 + 1 + 英长
    路 = 读路径字段(d, 路起)
    if 路 is None:
        return None
    # 模型名不强制等于文件名（用户会给模型改名），只要求路径是模型文件
    if not re.search(r"\.(pmx|pmd)$", 路, re.I):
        return None
    return {"种类": "模型", "起": o, "名": 名, "英": 英, "路径": 路, "路径起": 路起,
            "名对得上": 名与路径一致(名, 路, "模型")}


def 试附件(d, o):
    """附件：名字[100]（0 补齐）+ 路径[256]"""
    if o < 1 or o + 附件名字长 + 路径字段长 > len(d):
        return None
    名字段 = d[o:o + 附件名字长]
    终 = 名字段.find(b"\x00")
    if 终 <= 0:
        return None
    内容 = 名字段[:终]
    if not 全合法文本(d, o, o + 终, 1):
        return None
    名 = 内容.decode("shift_jis", "replace")
    # 名字要像文件名（附件名几乎都是 xxx.x / xxx.pmx 这种）
    if not re.search(r"\.(x|pmx|pmd|fx|accessory|sph|spa)$", 名, re.I):
        return None
    路起 = o + 附件名字长
    路 = 读路径字段(d, 路起)
    if 路 is None:
        return None
    if not 名与路径一致(名, 路, "附件"):
        return None
    return {"种类": "附件", "起": o, "名": 名, "英": "", "路径": 路, "路径起": 路起}


def 扫条目(d):
    """扫候选 + 用头部计数做数量约束挑出真正的条目。

    约束来自实测：**`0x36` = 模型数**（40 个工程里 37 个与 `.emm` 的 `#Pmd` 严丝合缝）。
    模型名允许用户改（所以不强制"名字=文件名"）；候选多于 `0x36` 时，
    优先保留"名字跟文件名对得上"的，再按名字更长的优先（残留片段通常更短更怪）。
    附件侧反之：**强制"名字=路径文件名"**，实测几个工程的附件数与 `.emm` 完全一致。
    """
    n = len(d)
    模型候选 = []
    附件候选 = []
    o = 0
    while o < n:
        b = 试附件(d, o)
        if b:
            附件候选.append(b)
            o += 1
            continue
        a = 试模型(d, o)
        if a:
            模型候选.append(a)
        o += 1

    # 附件：互不重叠（保留靠前的）
    附件 = []
    for e in sorted(附件候选, key=lambda x: x["起"]):
        if 附件 and e["起"] < 附件[-1]["路径起"] + 路径字段长:
            continue
        附件.append(e)

    模型上限 = d[0x36] if len(d) > 0x36 else len(模型候选)
    # 先按偏移取（靠前的优先占位），避免"高分但靠后"的候选把靠前的真条目挡住
    模型 = []
    for e in sorted(模型候选, key=lambda x: x["起"]):
        if 模型 and e["起"] < 模型[-1]["路径起"] + 路径字段长:
            continue
        if any(e["起"] < a["路径起"] + 路径字段长 and a["起"] < e["路径起"] + 路径字段长 for a in 附件):
            continue
        模型.append(e)
    # 超过计数就按分数裁（名字跟文件名对得上的留下）
    if len(模型) > 模型上限:
        模型.sort(key=lambda x: (not x.get("名对得上"), x["起"]))
        模型 = 模型[:模型上限]
    模型.sort(key=lambda x: x["起"])
    # 试过第三条"模型必须成组排在附件之前"的顺序约束：**16/30 没变**，按"没变好就回退"的规矩已回退。
    # 原因是失败样本的问题在**漏检**（模型扫少了），顺序约束只能砍多余候选，砍不动漏检。
    # 那条不变式本身是对的（所有干净样本都满足），但没有判别力，留着只是多一层可能出错的逻辑。
    表 = sorted(模型 + 附件, key=lambda x: x["起"])
    return 表


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
    段 = ""
    出 = []
    for 行 in 文本.splitlines():
        行 = 行.strip()
        if 行.startswith("[") and 行.endswith("]"):
            段 = 行.strip("[]")
            continue
        if 段 != "Object" or "=" not in 行:
            continue
        k, v = 行.split("=", 1)
        出.append((k.strip(), v.strip()))
    return 出


def 扫(路, emm路=None, 出声=True):
    d = 读(路)
    表 = 扫条目(d)
    emm路 = emm路 or os.path.splitext(路)[0] + ".emm"
    配对 = {}
    if os.path.isfile(emm路):
        对象 = 从emm(emm路)
        按路 = {}
        for k, v in 对象:
            按路.setdefault(v, []).append(k)
        用过的 = set()
        for e in 表:
            候选 = [k for k in 按路.get(e["路径"], []) if k not in 用过的]
            if not 候选:
                continue
            e["键"] = 候选[0]
            用过的.add(候选[0])
    if 出声:
        模型数 = sum(1 for e in 表 if e["种类"] == "模型")
        附件数 = sum(1 for e in 表 if e["种类"] == "附件")
        print(f"{os.path.basename(路)}  {len(d):,} 字节   扫到模型 {模型数} 个、附件 {附件数} 个")
        头计数 = (d[0x35], d[0x36]) if len(d) > 0x36 else (None, None)
        print(f"  头部 0x35={头计数[0]}  0x36={头计数[1]}   ← 对比：模型数 {模型数}、附件数 {附件数}")
        print()
        for i, e in enumerate(表):
            尾 = e["路径起"] + 路径字段长
            下 = 表[i + 1]["起"] if i + 1 < len(表) else len(d)
            缝 = 下 - 尾
            print(f"  [{i:>3}] {e['种类']} 名字 {e['名']!r:<22} 条目起 {e['起']:>10,}  "
                  f"路径起 {e['路径起']:>10,}  {'键 ' + e.get('键', '?'):<8} 帧区 {缝:>9,}")
        if 表:
            缝们 = []
            for i, e in enumerate(表):
                尾 = e["路径起"] + 路径字段长
                下 = 表[i + 1]["起"] if i + 1 < len(表) else len(d)
                缝们.append(下 - 尾)
            负 = [x for x in 缝们 if x < 0]
            print(f"\n  帧区/尾段共 {len(缝们)} 段：负的 {len(负)} 段"
                  f"{'（说明还有条目没被扫出来或扫多了）' if 负 else '（首尾相接，切干净）'}")
    return 表


def 批(根, 个数=30):
    工程 = sorted(glob.glob(os.path.join(根, "**", "*.emm"), recursive=True))[:个数]
    好 = 坏 = 0
    坏例 = []
    for e in 工程:
        pmm = os.path.splitext(e)[0] + ".pmm"
        if not os.path.isfile(pmm):
            continue
        d = 读(pmm)
        表 = 扫条目(d)
        缝 = []
        for i, x in enumerate(表):
            尾 = x["路径起"] + 路径字段长
            下 = 表[i + 1]["起"] if i + 1 < len(表) else len(d)
            缝.append(下 - 尾)
        对象 = 从emm(e)
        n模型 = sum(1 for k, _ in 对象 if k.startswith("Pmd"))
        n附件 = sum(1 for k, _ in 对象 if k.startswith("Acs"))
        找模型 = sum(1 for x in 表 if x["种类"] == "模型")
        找附件 = sum(1 for x in 表 if x["种类"] == "附件")
        一致 = (找模型 == n模型 and 找附件 == n附件 and d[0x36] == n模型)
        if 缝 and min(缝) >= 0 and 一致:
            好 += 1
        else:
            坏 += 1
            if len(坏例) < 8:
                坏例.append((os.path.basename(pmm), 找模型, n模型, 找附件, n附件,
                             d[0x36], min(缝) if 缝 else None, d[0x35]))
    print(f"抽查 {好 + 坏} 个工程：**首尾相接 + 与 .emm 数量一致 + 0x36 对得上** 的 {好} 个，不满足 {坏} 个")
    if 坏例:
        print(f"\n{'工程':<28}{'扫到模型':>8}{'.emm模型':>9}{'扫到附件':>8}{'.emm附件':>9}{'0x36':>6}{'最短缝':>9}{'0x35':>6}")
        for n, a, b, c, dd, h36, mn, h35 in 坏例:
            print(f"{n:<28}{a:>8}{b:>9}{c:>8}{dd:>9}{h36:>6}{mn if mn is not None else '-':>9}{h35:>6}")


def 序(路, emm路=None):
    """每个条目的帧区首字节/首 u32 vs .emm 槽位号（查帧区里有没有槽位号）"""
    d = 读(路)
    表 = 扫(路, emm路, 出声=False)
    print(f"{os.path.basename(路)}   （文件序）\n")
    print(f"{'文件序':>5}  {'键':<8}{'种类':<6}{'名字':<22}{'帧区起':>11}{'首字节':>8}{'首 u32':>10}{'槽位号':>8}{'首字节-槽位':>12}")
    for i, e in enumerate(表):
        区首 = e["路径起"] + 路径字段长
        b = d[区首] if 区首 < len(d) else None
        u = struct.unpack_from("<I", d, 区首)[0] if 区首 + 4 <= len(d) else None
        键 = e.get("键", "?")
        m = re.match(r"^(Pmd|Acs)(\d+)$", 键)
        槽 = int(m.group(2)) if m else None
        差 = (b - 槽) if (b is not None and 槽 is not None) else None
        print(f"{i:>5}  {键:<8}{e['种类']:<6}{e['名']!r:<22}{区首:>11,}"
              f"{b if b is not None else '-':>8}{u if u is not None else '-':>10}"
              f"{槽 if 槽 is not None else '-':>8}{差 if 差 is not None else '-':>12}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    m = sys.argv[1]
    if m == "扫":
        扫(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
    elif m == "批":
        批(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 30)
    elif m == "序":
        序(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
    else:
        print(__doc__)
