# -*- coding: utf-8 -*-
"""
PMM ↔ EMM 对照：这两个文件之间是靠什么对上的？

重点验一件事：`.emm` 里的 `Pmd<N>` / `Acs<N>` 编号，是不是跟 `.pmm` 里对象的**出现顺序**绑定。
如果是，那"删掉一个模型"就必须把后面所有对象的编号往后挪，`.emm` 的键也要跟着改。

用法：python tools/pmm-emm-pair.py <名字关键字>      例如 `Flyer1`
      python tools/pmm-emm-pair.py --all              把有配对的样本都过一遍
"""
import glob
import os
import re
import sys

sys.stdout.reconfigure(errors="backslashreplace")

根 = r"D:\9.26mmd"


def 读(路):
    with open(路, "rb") as f:
        return f.read()


def 扫路径(d):
    """按文件顺序扫出所有 .pmx/.pmd/.x 的路径片段（用 pmm-scan 里那套判据）"""
    out = []
    n = len(d)
    i = 0

    def 单(位置):
        if 位置 >= n:
            return 0
        b = d[位置]
        if 32 <= b < 127 or 0xA1 <= b <= 0xDF:
            return 1
        if (0x81 <= b <= 0x9F or 0xE0 <= b <= 0xEF) and 位置 + 1 < n:
            t = d[位置 + 1]
            if 0x40 <= t <= 0x7E or 0x80 <= t <= 0xFC:
                return 2
        return 0

    while i < n:
        if 单(i) == 0:
            i += 1
            continue
        起 = i
        while 单(i) > 0:
            i += 单(i)
        片段 = d[起:i].strip(b" ")
        if len(片段) >= 4:
            小 = 片段.lower()
            if 小.endswith((b".pmx", b".pmd", b".x")):
                # 路径里可能混着上一段的尾巴（跨过补零区读到的），取最后一个盘符或反斜杠之后的整段
                try:
                    s = 片段.decode("shift_jis")
                except UnicodeDecodeError:
                    s = 片段.decode("shift_jis", "replace")
                if "\\" in s or ":" in s:
                    out.append((起, s))
    return out


def emm键(文本):
    """把 .emm 里的 [Object] / [Effect] 键按出现顺序列出来"""
    出 = []
    段 = ""
    for 行 in 文本.splitlines():
        行 = 行.strip()
        if 行.startswith("[") and 行.endswith("]"):
            段 = 行.strip("[]")
            continue
        if not 行 or "=" not in 行:
            continue
        键, 值 = 行.split("=", 1)
        键 = 键.strip()
        值 = 值.strip()
        出.append((段, 键, 值))
    return 出


def 跑一对(名):
    pmms = glob.glob(os.path.join(根, "**", 名 + ".pmm"), recursive=True)
    emms = glob.glob(os.path.join(根, "**", 名 + ".emm"), recursive=True)
    if not pmms:
        print(f"  {名}：没有 .pmm")
        return
    pmm = pmms[0]
    路 = 扫路径(读(pmm))
    print(f"\n{'=' * 100}\n{名}\n{'=' * 100}")
    print(f"  .pmm 里按顺序的模型/附件路径（共 {len(路)} 条）：")
    for 偏移, s in 路:
        尾 = s
        if len(尾) > 80:
            尾 = "…" + 尾[-78:]
        print(f"    @{偏移:>10,}  {尾}")
    if not emms:
        print("  （没有 .emm）")
        return
    e = emms[0]
    文本 = None
    for 编码 in ("utf-8-sig", "shift_jis", "gbk"):
        try:
            文本 = 读(e).decode(编码)
            print(f"  .emm 编码 = {编码}")
            break
        except UnicodeDecodeError:
            continue
    if 文本 is None:
        文本 = 读(e).decode("gbk", "replace")
    print(f"  .emm 的键（共 {len(emm键(文本))} 行）：")
    for 段, 键, 值 in emm键(文本):
        尾 = 值 if len(值) <= 78 else "…" + 值[-76:]
        print(f"    [{段}] {键} = {尾}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    if sys.argv[1] == "--all":
        # 只挑小的配对，输出别太长
        名 = set()
        for p in glob.glob(os.path.join(根, "**", "*.emm"), recursive=True):
            if os.path.getsize(p) < 30_000:
                名.add(os.path.splitext(os.path.basename(p))[0])
        for n in sorted(名)[:6]:
            跑一对(n)
    else:
        跑一对(sys.argv[1])
