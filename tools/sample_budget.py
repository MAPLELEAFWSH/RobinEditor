"""
算"要多少样本才够"。

做法：自助采样（bootstrap）。对每个统计量，从 N 张里随机抽 k 张算一遍，
重复很多次，看**结论的波动**随 k 怎么变。波动收敛到可接受范围的那个 k，
就是"够用"的门槛。这比拍一个"要 500 张"靠谱，因为它是从你自己的样本量出来的。

同时在算之前先分清楚三件事，它们的边际收益完全不同：
  1. 输入-输出**成对**的样本 → 唯一能用来做生成映射的
  2. 只有输出（比如只有 lightmap、没有 diffuse）→ 只能定格式和分布，学不了映射
  3. 同类图的数量 → 决定"这类图的共性"估得准不准

用法：python tools/sample_budget.py <训练样本目录>
"""
import random
import re
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

GRID = 0.05


def top_value(a: np.ndarray) -> tuple[float, float]:
    flat = a.ravel()
    cnt = Counter(flat.tolist())
    v, n = cnt.most_common(1)[0]
    return v / 255.0, n / flat.size


def on_grid(a: np.ndarray) -> float:
    v = a.ravel() / 255.0
    return float((np.abs(v / GRID - np.round(v / GRID)) < 0.08).mean())


def classify(p: Path, root: Path):
    """(游戏, 后缀) —— 后缀用来分组同类图"""
    parts = p.relative_to(root).parts
    game = parts[0]
    stem = p.stem
    seg = re.split(r"[_\s]+", stem)
    tail = seg[-1]
    if len(tail) <= 3 and tail.isupper():
        suf = tail
    else:
        suf = (seg[-2] + "_" + tail) if len(seg) >= 2 else tail
    return game, suf


def main():
    root = Path(sys.argv[1])
    if not root.exists():
        print(__doc__)
        return 1

    # ---------- 1. 先把"成对"和"只有输出"分清楚 ----------
    have = defaultdict(set)  # (game, 角色目录) -> {后缀}
    for p in root.rglob("*.png"):
        rel = p.relative_to(root).parts
        if len(rel) < 3:
            continue
        game, char = rel[0], rel[1]
        have[(game, char)].add(classify(p, root)[1])

    # 什么算"输入"、什么算"输出"
    INPUTS = {'D', 'Color', 'Color_A_L', 'Color_A_La', 'Color', 'Face_Color', 'Body_Color'}
    OUTPUTS = {'LM', 'Lightmap', 'Body_Lightmap', 'Hair_Lightmap', 'LightMap',
               'LightMap_L', 'Hair_LightMap', 'LightMapR', 'A', 'M', 'N', 'E', 'Ramp',
               'Shadow_Ramp', 'Cool_Ramp', 'Warm_Ramp', 'Mask', 'Mask_01'}

    print("=" * 78)
    print("一、输入 / 输出配对情况（决定能不能做生成）")
    print("=" * 78)
    pair_stats = defaultdict(lambda: {"chars": 0, "paired": 0, "out_only": 0, "in_only": 0})
    for (game, char), sufs in sorted(have.items()):
        has_in = bool(sufs & INPUTS)
        has_out = bool(sufs & OUTPUTS)
        s = pair_stats[game]
        s["chars"] += 1
        if has_in and has_out:
            s["paired"] += 1
        elif has_out:
            s["out_only"] += 1
        elif has_in:
            s["in_only"] += 1
    for game, s in pair_stats.items():
        print(f"  {game:<10} 角色 {s['chars']:>3}   有成对的 {s['paired']:>3}   "
              f"只有输出 {s['out_only']:>3}   只有输入 {s['in_only']:>3}")
        if s["paired"] == 0:
            print(f"             ↑ 这个游戏**加多少张都没用**：没有输入就学不出映射")

    # ---------- 2. 同类图的收敛曲线 ----------
    groups = defaultdict(list)
    for p in sorted(root.rglob("*.png")):
        game, suf = classify(p, root)
        groups[(game, suf)].append(p)

    print()
    print("=" * 78)
    print("二、统计量随样本数的收敛（自助采样，每档抽 300 次）")
    print("=" * 78)

    # 每个统计量报"重复抽样之间的波动"，单位是它自己的量纲
    def converge(paths, ch_index, stat_fn, label, unit):
        N = len(paths)
        if N < 4:
            print(f"  {label}: 只有 {N} 张，太少，跳过")
            return
        data = []
        for p in paths:
            try:
                a = np.asarray(Image.open(p).convert("RGBA"))[:, :, ch_index]
            except Exception:
                continue
            data.append(stat_fn(a))
        if len(data) < 4:
            return
        print(f"  {label}  （总共 {len(data)} 张）")
        for k in [2, 3, 5, 8, 13, 21, 34, 55]:
            if k > len(data):
                break
            vals = []
            for _ in range(300):
                sub = random.sample(data, k)
                vals.append(statistics.median(sub))
            sd = statistics.pstdev(vals)
            full = statistics.median(data)
            flag = ""
            if sd / max(abs(full), 1e-6) < 0.05:
                flag = "  ← 波动 <5%，这档就够"
            print(f"      k={k:>3}  中位估计 {statistics.median(vals):.4f}  "
                  f"波动 ±{sd:.4f}{unit}{flag}")

    # 原神 Body Lightmap 的 G：中性值和网格比例
    for game, suf in [("genshin", "Body_Lightmap"), ("genshin", "Hair_Lightmap"),
                      ("ZZZ", "LM"), ("genshin", "Shadow_Ramp")]:
        paths = groups.get((game, suf), [])
        if not paths:
            continue
        print(f"\n  ── {game} *{suf} ──")
        converge(paths, 1, lambda a: top_value(a)[0], "G 通道最常见档位（定中性值）", "")
        converge(paths, 1, on_grid, "G 通道落在 0.05 网格上的比例", "")
    return 0


if __name__ == "__main__":
    sys.exit(main())
