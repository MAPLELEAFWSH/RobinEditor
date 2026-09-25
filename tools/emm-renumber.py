# -*- coding: utf-8 -*-
"""
`.emm` 删一个对象之后的**前移规则**验证。

已知：编号是位置编号（60 个工程里 57 个正好稠密 1..K）→ 删掉中间一个，
排在后面的键必须整体前移。这个脚本在**副本**上把规则跑一遍，并验证结果自洽：

  规则：删掉编号 N 的对象；所有编号 > N 的键（`Pmd*` / `Acs*`）编号减 1；
        它们的 `.show` 键、`Pmd<N>[m]` 逐材质键一起减 1；编号 == N 的全部删掉。
  自洽判据：结果里编号不重不漏、正好是 1..K-1；逐材质键的材质序号 `[m]` 不动。

用法：python tools/emm-renumber.py <emm> <要删的编号> [输出副本]
"""
import os
import re
import sys

sys.stdout.reconfigure(errors="backslashreplace")


def 读(路):
    with open(路, "rb") as f:
        return f.read()


def 读文本(路):
    for 编码 in ("utf-8-sig", "gbk", "shift_jis"):
        try:
            return 读(路).decode(编码), 编码
        except UnicodeDecodeError:
            continue
    return 读(路).decode("gbk", "replace"), "gbk(replace)"


对象键 = re.compile(r"^(Pmd|Acs)(\d+)(\[(\d+)\])?(\.show)?$")


def 主(路, 删号, 出=None):
    文本, 编码 = 读文本(路)
    行们 = 文本.splitlines()
    print(f"{os.path.basename(路)}  编码 {编码}  共 {len(行们)} 行")
    删号 = int(删号)
    新 = []
    去掉 = []
    改了 = 0
    for 行 in 行们:
        s = 行.strip()
        if not s or s.startswith("[") or "=" not in s:
            新.append(行)
            continue
        名 = s.split("=", 1)[0].strip()
        m = 对象键.match(名)
        if not m:
            新.append(行)
            continue
        种, 号, _, 材质, 显示 = m.group(1), int(m.group(2)), m.group(3), m.group(4), m.group(5)
        if 号 == 删号:
            去掉.append(名)
            continue
        if 号 > 删号:
            新名 = f"{种}{号 - 1}" + (m.group(3) or "") + (m.group(5) or "")
            # 保持原来的键与值之间的空格样式
            等号 = s.index("=")
            新.append(行.replace(名, 新名, 1))
            改了 += 1
        else:
            新.append(行)
    结果 = "\n".join(新) + ("\n" if 文本.endswith("\n") else "")
    # 校验：编号是否不重不漏 1..K-1
    号们 = []
    for 行 in 新:
        s = 行.strip()
        if "=" not in s:
            continue
        m = 对象键.match(s.split("=", 1)[0].strip())
        if m and not m.group(3) and not m.group(5):
            号们.append(int(m.group(2)))
    号们.sort()
    期望 = list(range(1, len(号们) + 1))
    print(f"删掉编号 {删号} 的键 {len(去掉)} 个：{去掉[:8]}{'…' if len(去掉) > 8 else ''}")
    print(f"前移的键 {改了} 个")
    print(f"删后对象编号：{号们[:12]}{'…' if len(号们) > 12 else ''}  共 {len(号们)} 个")
    print(f"是否不重不漏正好 1..{len(号们)}：{'是' if 号们 == 期望 else '否'}")
    if 出:
        with open(出, "w", encoding=编码.split("(")[0], newline="") as f:
            f.write(结果)
        print(f"写副本 {出}（{len(结果.encode(编码.split('(')[0])) if 编码 != 'gbk(replace)' else len(结果.encode('gbk', 'replace'))} 字节）")
        # 复核：副本读回来编号同样自洽
        文本2, _ = 读文本(出)
        号2 = []
        for 行 in 文本2.splitlines():
            s = 行.strip()
            if "=" not in s:
                continue
            m = 对象键.match(s.split("=", 1)[0].strip())
            if m and not m.group(3) and not m.group(5):
                号2.append(int(m.group(2)))
        号2.sort()
        print(f"副本读回：{len(号2)} 个对象键，是否 1..{len(号2)}：{'是' if 号2 == list(range(1, len(号2) + 1)) else '否'}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    主(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
