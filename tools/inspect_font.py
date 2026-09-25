"""
看一眼 StarRailNeue 到底覆盖了哪些字符。

8 KB 太小了，怀疑只做了拉丁子集。这里直接读 TTF 的 cmap 表（不装 fontTools
也能读，格式很固定），把码位列出来，确认英文/数字/符号够不够用。

用法：python tools/inspect_font.py
"""
import struct
import sys


def read_cmap(path):
    with open(path, "rb") as f:
        data = f.read()

    # TTF 头：sfntVersion + numTables，然后是表目录
    num_tables = struct.unpack(">H", data[4:6])[0]
    cmap_off = None
    for i in range(num_tables):
        off = 12 + i * 16
        tag = data[off:off + 4]
        if tag == b"cmap":
            cmap_off = struct.unpack(">I", data[off + 8:off + 12])[0]
            break
    if cmap_off is None:
        return None

    n = struct.unpack(">H", data[cmap_off + 2:cmap_off + 4])[0]
    best = None
    for i in range(n):
        rec = cmap_off + 4 + i * 8
        pid, eid, sub_off = struct.unpack(">HHI", data[rec:rec + 8])
        fmt = struct.unpack(">H", data[cmap_off + sub_off:cmap_off + sub_off + 2])[0]
        # 只处理 format 4（BMP）和 format 12（全 Unicode）
        if fmt in (4, 12):
            best = (cmap_off + sub_off, fmt)
            if fmt == 12:
                break

    if not best:
        return set()

    off, fmt = best
    codes = set()

    if fmt == 4:
        seg_x2 = struct.unpack(">H", data[off + 6:off + 8])[0]
        seg = seg_x2 // 2
        ends = struct.unpack(">%dH" % seg, data[off + 14:off + 14 + seg_x2])
        starts_off = off + 14 + seg_x2 + 2
        starts = struct.unpack(">%dH" % seg, data[starts_off:starts_off + seg_x2])
        for s, e in zip(starts, ends):
            if s == 0xFFFF:
                continue
            codes.update(range(s, e + 1))
    else:
        ngroups = struct.unpack(">I", data[off + 12:off + 16])[0]
        p = off + 16
        for _ in range(ngroups):
            s, e, _g = struct.unpack(">III", data[p:p + 12])
            p += 12
            codes.update(range(s, e + 1))

    return codes


def main():
    # 控制台默认 GBK，打印非 Latin1 字符会炸，这里强制 UTF-8
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    path = sys.argv[1] if len(sys.argv) > 1 else "static/fonts/StarRailNeue-Serif-Regular.ttf"
    codes = read_cmap(path)
    if codes is None:
        print("读不到 cmap")
        return 1

    print(f"{path}")
    print(f"总码位数 {len(codes)}")

    groups = {
        "数字 0-9": lambda c: 0x30 <= c <= 0x39,
        "大写 A-Z": lambda c: 0x41 <= c <= 0x5A,
        "小写 a-z": lambda c: 0x61 <= c <= 0x7A,
        "基本标点": lambda c: c in range(0x20, 0x30) or c in range(0x3A, 0x41)
                              or c in range(0x5B, 0x61) or c in range(0x7B, 0x7F),
        "拉丁补充": lambda c: 0xA0 <= c <= 0x24F,
        "中日韩": lambda c: 0x3000 <= c <= 0x9FFF or 0xFF00 <= c <= 0xFFEF,
        "其他": lambda c: True,
    }
    seen = set()
    for name, pred in groups.items():
        hit = sorted(c for c in codes if c not in seen and pred(c))
        seen.update(hit)
        if hit:
            sample = "".join(chr(c) for c in hit[:48] if 0x20 <= c < 0x3000)
            print(f"  {name:<10} {len(hit):>5}   {sample}")
        else:
            print(f"  {name:<10} {0:>5}")

    has_digit = any(0x30 <= c <= 0x39 for c in codes)
    has_cjk = any(0x3000 <= c <= 0x9FFF for c in codes)
    print()
    if has_cjk:
        print("结论：含中日韩，可以当正文用")
    elif has_digit:
        print("结论：拉丁 + 数字。当中英文显示字体够用，中文靠后面的 CJK 字体")
    else:
        print("结论：**只有字母，连数字都没有**。数字会落到下一个字体（ZenMaruGothic），")
        print("      所以英文和数字的观感会不一致。有完整版就换掉这个子集。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
