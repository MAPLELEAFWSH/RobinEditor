"""
跨全部样本聚合通道统计，用来定规格。

为什么要它：之前"原神 G 是离散两档"那条结论是从一两个文件推的，量了两张
就发现站不住。现在样本多了（genshin 75 个角色、HSR 2 个、ZZZ 6 个），
应该一次把所有同类图都扫一遍，看**共性**和**离散度**，而不是挑一个文件下结论。

输出每类图（按文件名后缀分组）的：样本数、每通道的唯一值中位数、
落在 0.05 网格上的比例中位数、最常见档位的占比中位数。
判断"是不是离散"看唯一值中位数和网格比例；判断"中性值是多少"看最常见档位。

用法：python tools/aggregate_maps.py <训练样本目录>
"""
import re
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

GRID_STEP = 0.05


def channel_stats(a: np.ndarray) -> dict:
    """a 是 HxW 的 uint8 单通道"""
    flat = a.ravel()
    uniq = np.unique(flat)
    v = flat / 255.0
    grid = np.abs(v / GRID_STEP - np.round(v / GRID_STEP))
    on_grid = float((grid < 0.08).mean())
    cnt = Counter(flat.tolist())
    top_val, top_n = cnt.most_common(1)[0]
    return {
        "uniq": len(uniq),
        "on_grid": on_grid,
        "top_val": top_val / 255.0,
        "top_share": top_n / flat.size,
        "std": float(v.std()),
    }


def suffix_of(stem: str) -> str:
    """把 Avatar_Xxx_00_Body_Lightmap_L 这种收敛成 Lightmap / LM / D 之类的尾巴"""
    parts = re.split(r"[_\s]+", stem)
    tail = parts[-1]
    # _A / _M / _N / _D / _LM 这种单段直接认
    if len(tail) <= 3 and tail.isupper():
        return tail
    # Lightmap_L / Color_A_L 这种，往前拼一级
    if len(parts) >= 2:
        return parts[-2] + "_" + tail
    return tail


def main():
    root = Path(sys.argv[1])
    if not root.exists():
        print(__doc__)
        return 1

    by_group = defaultdict(lambda: defaultdict(list))
    for p in sorted(root.rglob("*.png")):
        game = p.relative_to(root).parts[0]
        suf = suffix_of(p.stem)
        try:
            im = Image.open(p)
            a = np.asarray(im.convert("RGBA"))
        except Exception:
            continue
        # 只统计真的有数据的通道（恒定通道没信息量，单独标出来）
        stats = []
        for i in range(4):
            ch = a[:, :, i]
            if len(np.unique(ch)) == 1:
                stats.append({"const": int(ch[0, 0])})
            else:
                s = channel_stats(ch)
                s["const"] = None
                stats.append(s)
        by_group[(game, suf)][p.name] = stats

    for (game, suf), byname in sorted(by_group.items(), key=lambda kv: (kv[0][0], -len(kv[1]))):
        items = list(byname.values())
        if len(items) < 2:
            continue
        print(f"\n{'=' * 74}\n{game}  *{suf}   样本 {len(items)} 张\n{'=' * 74}")
        for ci, cname in enumerate("RGBA"):
            consts = [s[ci]["const"] for s in items]
            nconst = sum(1 for c in consts if c is not None)
            if nconst == len(items):
                vals = sorted(set(consts))
                print(f"  {cname}: 全部样本都是常量  {[round(v/255,2) for v in vals]}")
                continue
            live = [s[ci] for s in items if s[ci]["const"] is None]
            uniq = statistics.median(s["uniq"] for s in live)
            grid = statistics.median(s["on_grid"] for s in live)
            std = statistics.median(s["std"] for s in live)
            tops = Counter(round(s["top_val"], 2) for s in live)
            top_txt = "  ".join(f"{v:.2f}({n}/{len(live)}张)" for v, n in tops.most_common(3))
            share = statistics.median(s["top_share"] for s in live)
            verdict = "离散" if uniq <= 24 and grid > 0.85 else ("偏离散" if uniq <= 60 else "连续")
            print(
                f"  {cname}: 唯一值中位 {uniq:>3}  网格上 {grid*100:5.1f}%  std {std:.3f}  "
                f"→ {verdict}\n      最常见档位 {top_txt}   该档位占比中位 {share*100:.1f}%"
                + (f"   （另有 {len(items)-len(live)} 张这一路是常量）" if nconst else "")
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
