# -*- coding: utf-8 -*-
"""
PMM / EMM 结构量具。**只读**，一个字节都不改样本。

用法：
  python tools/pmm-scan.py head <文件> [字节数]        开头若干字节的十六进制 + 可读字符
  python tools/pmm-scan.py header <文件>               按已知的公开结构解析开头（签名/版本/计数）
  python tools/pmm-scan.py strings <文件> [最少长度]    扫出所有像字符串的片段（含偏移与前后字节）
  python tools/pmm-scan.py paths <文件>                只列像"文件路径"的片段（.pmx/.x/.fx/.png…）
  python tools/pmm-scan.py emm <文件>                  EMM 的结构（逐项打印）

只读：所有模式都只 read，不写回、不生成副本。
"""
import struct
import sys

# 控制台是 GBK：日文半角片假名（乱码名里常见）编不出去会直接抛异常，转义掉就行
sys.stdout.reconfigure(errors="backslashreplace")


def 读(路):
    with open(路, "rb") as f:
        return f.read()


def 显示(b):
    """字节转成便于人看的一行：可打印的照写，其余用 . 代替"""
    out = []
    for x in b:
        out.append(chr(x) if 32 <= x < 127 else ("." if x < 128 else "·"))
    return "".join(out)


def head(路, 字节数=512):
    d = 读(路)
    print(f"文件 {路}  共 {len(d):,} 字节\n")
    for i in range(0, min(字节数, len(d)), 16):
        chunk = d[i:i + 16]
        十六 = " ".join(f"{x:02X}" for x in chunk)
        print(f"{i:08X}  {十六:<47}  {显示(chunk)}")


# ---------------------------------------------------------------- 字符串扫描

def 扫字符串(d, 最少=4):
    """扫出所有像 Shift-JIS / ASCII 字符串的片段。

    判据：一段连续字节里，每个字符要么是可打印 ASCII、要么是 SJIS 半角片假名
    （0xA1-0xDF，单字节），要么是合法的 SJIS 双字节（前导 0x81-0x9F / 0xE0-0xEF，
    尾随 0x40-0x7E / 0x80-0xFC）。

    ⚠ 早先这函数要求"整段一直到最后都被终止符截断"才算数，于是 `Flyer` 后面紧跟
    一个长度字节 0x05 时整段被丢掉 —— 扫出来 0 段。现在改成"遇到不合法字节就收尾"。
    """
    出 = []
    i = 0
    n = len(d)

    def 单字符长(位置):
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
        if 单字符长(i) == 0:
            i += 1
            continue
        起 = i
        while 单字符长(i) > 0:
            i += 单字符长(i)
        片段 = d[起:i]
        去空 = 片段.strip(b" ")
        if len(去空) >= 最少:
            出.append((起 + (len(片段) - len(片段.lstrip(b" "))), 去空))
    return 出


def 解码(b):
    try:
        return b.decode("shift_jis")
    except UnicodeDecodeError:
        return b.decode("shift_jis", errors="replace")


def strings(路, 最少=4):
    d = 读(路)
    print(f"文件 {路}  共 {len(d):,} 字节\n")
    表 = 扫字符串(d, 最少)
    print(f"扫到 {len(表)} 段（长度 >= {最少}）\n")
    for 偏移, b in 表:
        前 = d[max(0, 偏移 - 8):偏移]
        print(f"@{偏移:>10,}  len={len(b):>4}  前8字节 {前.hex(' '):<23}  {解码(b)!r}")


扩展名 = (".pmx", ".pmd", ".x", ".fx", ".fxsub", ".png", ".jpg", ".bmp", ".tga", ".spa", ".sph",
          ".dds", ".wav", ".mp3", ".avi", ".accessory", ".vmd", ".vac", ".txt", ".fxconf", ".conf")


def paths(路):
    d = 读(路)
    print(f"文件 {路}  共 {len(d):,} 字节\n")
    表 = 扫字符串(d, 3)
    命中 = [(o, b) for o, b in 表 if any(解码(b).lower().endswith(e) or e in 解码(b).lower() for e in 扩展名)]
    print(f"扫到 {len(命中)} 段像路径的（全长 >= 3 的字符串共 {len(表)} 段）\n")
    for 偏移, b in 命中:
        前 = d[max(0, 偏移 - 24):偏移]
        print(f"@{偏移:>10,}  len={len(b):>4}  {解码(b)!r}")
        print(f"{'':>13}前24字节 {前.hex(' ')}")


# ---------------------------------------------------------------- PMM 头部

def header(路):
    d = 读(路)
    print(f"文件 {路}  共 {len(d):,} 字节\n")
    签名 = d[:4]
    print(f"签名 {签名!r}  十六进制 {签名.hex(' ')}")
    if 签名 not in (b"PMM ", b"PMM\x00"):
        print("  签名不是 PMM —— 可能不是 .pmm 文件")
    print(f"版本(float32) = {struct.unpack_from('<f', d, 4)[0]}")
    print(f"接下来 32 字节: {d[8:40].hex(' ')}")
    print(f"               {显示(d[8:40])}")
    print(f"偏移 8 处的 byte = {d[8]}   uint32 = {struct.unpack_from('<I', d, 8)[0]}")
    print(f"偏移 9 处的 byte = {d[9]}   uint32 = {struct.unpack_from('<I', d, 9)[0]}")


# ---------------------------------------------------------------- EMM

def emm(路):
    d = 读(路)
    print(f"文件 {路}  共 {len(d):,} 字节\n")
    print(f"开头 64 字节:\n{d[:64].hex(' ')}\n")
    签名 = d[:4]
    print(f"签名 {签名!r}")
    print(f"版本(float32) = {struct.unpack_from('<f', d, 4)[0]}")
    print(f"偏移 8 处 uint32 = {struct.unpack_from('<I', d, 8)[0]}   byte = {d[8]}")
    print()


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    模式 = sys.argv[1]
    文件 = sys.argv[2]
    if 模式 == "head":
        head(文件, int(sys.argv[3]) if len(sys.argv) > 3 else 512)
    elif 模式 == "strings":
        strings(文件, int(sys.argv[3]) if len(sys.argv) > 3 else 4)
    elif 模式 == "paths":
        paths(文件)
    elif 模式 == "header":
        header(文件)
    elif 模式 == "emm":
        emm(文件)
    else:
        print(__doc__)
        sys.exit(1)
