"""法线贴图的"打包形态"在真实素材里各占多少 —— ⑦ 那张识别表要用这个定门槛。

要回答的是：**能不能只看四路的统计，就认出 R 恒定且高（AG 打包，X 在 A）/ B 空（RG 双通道）/
B 高（已经是标准蓝）**。这三条是参考工具里做识别用的形态，但门槛必须用本库自己的数落下来。

只读，不改任何文件。为了不把 4K 图全读进来，统计在**最邻近降到 256 长边**的那份上做
（最邻近不会造出新值，唯一值/恒定比例都还有意义）。

用法：python tools/probe_normal_pack.py <根目录> [--limit 400]
"""
import argparse
import re
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PAT = re.compile(r"(_N\d?$)|([Nn]ormal$)|(_n$)")


def stats(p: Path):
    try:
        im = Image.open(p).convert("RGBA")
    except Exception:
        return None
    m = max(im.size)
    if m > 256:
        k = 256 / m
        im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.NEAREST)
    a = np.asarray(im)
    out = {"size": a.shape[1], "h": a.shape[0], "px": a.shape[0] * a.shape[1]}
    for i, c in enumerate("RGBA"):
        v = a[:, :, i]
        u, cnt = np.unique(v, return_counts=True)
        out[c] = {"uniq": int(len(u)), "top": float(cnt.max() / v.size), "mean": float(v.mean()),
                  "sd": float(v.std()), "span": int(v.max() - v.min())}
    return out


def bucket(s):
    r, g, b, a = s["R"], s["G"], s["B"], s["A"]
    # R 恒定（唯一值 1）或近乎恒定（最常见值 >=99%）且高
    r_flat_high = (r["uniq"] == 1 and r["mean"] >= 200) or (r["top"] >= 0.99 and r["mean"] >= 200)
    b_flat = b["uniq"] <= 2 or b["top"] >= 0.99
    b_high = b["mean"] >= 150
    a_rich = a["uniq"] >= 16 and a["top"] < 0.98
    if r_flat_high and a_rich:
        return "AG 打包（R 恒定高 + A 有数据）"
    if b_flat and b["mean"] <= 32 and r["uniq"] >= 16 and g["uniq"] >= 16:
        return "RG 双通道（B 恒定低）"
    if b_high:
        return "标准蓝（B 均值高）"
    if r["uniq"] >= 16 and g["uniq"] >= 16 and b["span"] < 64:
        return "B 不是 z（窄幅，R/G 有层次）"
    if b_flat:
        return "B 恒定但不在低端"
    return "其它"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--limit", type=int, default=400)
    args = ap.parse_args()
    root = Path(args.root)
    if not root.exists():
        print(__doc__)
        return 1

    picked = []
    seen = 0
    for p in root.rglob("*"):
        if p.suffix.lower() not in (".png", ".tga", ".bmp", ".jpg"):
            continue
        if PAT.search(p.stem):
            seen += 1
            if len(picked) < args.limit:
                picked.append(p)
    print(f"{root}\n名字像法线的 {seen} 张，取前 {len(picked)} 张统计\n")

    rows = []
    for p in picked:
        s = stats(p)
        if s:
            rows.append((p, s, bucket(s)))

    cnt = Counter(b for _, _, b in rows)
    print("=== 形态分布 ===")
    for k, v in cnt.most_common():
        print(f"  {k:<28} {v:>4} 张  {v/len(rows)*100:5.1f}%")

    print("\n=== 每一类的读数（中位）===")
    for k in cnt:
        grp = [s for _, s, b in rows if b == k]
        def med(key, sub):
            xs = sorted(s[key][sub] for s in grp)
            return xs[len(xs) // 2]
        print(f"  {k:<28} R均 {med('R','mean'):6.1f} R唯一 {med('R','uniq'):4d} "
              f"B均 {med('B','mean'):6.1f} B唯一 {med('B','uniq'):4d} "
              f"A唯一 {med('A','uniq'):4d} A最常见 {med('A','top')*100:5.1f}%")

    print("\n=== 全部扫到的：几路读数的分位（定『像不像法线』门槛用）===")
    for key, sub in (("R", "mean"), ("G", "mean"), ("B", "mean"), ("B", "span"), ("A", "uniq")):
        xs = sorted(s[key][sub] for _, s, _ in rows)
        q = lambda p: xs[min(len(xs) - 1, int(p * len(xs)))]
        print(f"  {key}.{sub:<5} 5% {q(0.05):8.1f}   50% {q(0.5):8.1f}   95% {q(0.95):8.1f}")

    print("\n=== 那三种形态各自的边界值（用来定门槛）===")
    for k in ["AG 打包（R 恒定高 + A 有数据）", "RG 双通道（B 恒定低）", "标准蓝（B 均值高）"]:
        grp = [s for _, s, b in rows if b == k]
        if not grp:
            print(f"  {k}: 一张都没有")
            continue
        rmin = min(s["R"]["mean"] for s in grp)
        bmax = max(s["B"]["mean"] for s in grp)
        rflat = sum(1 for s in grp if s["R"]["uniq"] == 1)
        alow = min(s["A"]["uniq"] for s in grp)
        print(f"  {k}: R 均值最小 {rmin:.1f}；R 唯一值=1 的 {rflat}/{len(grp)}；"
              f"B 均值最大 {bmax:.1f}；A 唯一值最小 {alow}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
