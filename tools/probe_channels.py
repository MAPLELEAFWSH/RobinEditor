"""
扫三个模型库，统计"通道里到底装了什么"的实际分布。

要回答的是三条具体的说法：
  1. `_D`（不是 _D1 / _D2）结尾的贴图，透明通道里是平滑度/粗糙度
  2. 法线贴图的透明通道里有东西（需要分离并反相）
  3. 金属度在 FTM 的 G 通道里

这三条是特定工作流的约定，不能凭一句话就写进算法 —— 先量它们在真实素材里
到底成立不成立、覆盖率多少。量出来是"只有一部分模型这么做"的话，
算法就必须能识别而不是硬套。

只读，不改任何文件。

用法：python tools/probe_channels.py <模型根目录> [--limit 400]
"""
import argparse
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def alpha_state(p: Path):
    """返回 (唯一值数, 最常见值占比, 是否恒定)。读不出返回 None"""
    try:
        im = Image.open(p)
        a = np.asarray(im.convert("RGBA"))[:, :, 3]
    except Exception:
        return None
    u, c = np.unique(a, return_counts=True)
    top = c.max() / a.size
    return (len(u), float(top), len(u) == 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--limit", type=int, default=400)
    args = ap.parse_args()
    root = Path(args.root)
    if not root.exists():
        print(__doc__)
        return 1

    # 按"文件名后缀模式"分组统计
    buckets = defaultdict(list)
    name_hits = Counter()
    PATTERNS = [
        ("法线 _N", re.compile(r"_N\d?$")),
        ("法线 Normal", re.compile(r"[Nn]ormal")),
        ("_D 基础色", re.compile(r"_D$")),
        ("_D1", re.compile(r"_D1$")),
        ("_D2", re.compile(r"_D2$")),
        ("_M", re.compile(r"_M\d?$")),
        ("_A", re.compile(r"_A\d?$")),
        ("_E 自发光", re.compile(r"_E\d?$")),
        ("_LM / Lightmap", re.compile(r"_LM$|[Ll]ightmap")),
        ("_Ramp", re.compile(r"[Rr]amp")),
        ("_Mask", re.compile(r"[Mm]ask")),
        ("_SDF", re.compile(r"SDF|_S[Dd][Ff]")),
    ]
    # 用户提到的关键词，看库里有没有
    KEYWORDS = ["FTM", "Rough", "rough", "Gloss", "gloss", "Smooth", "Metal", "metal",
                "Specular", "Occlusion", "AO", "Thickness", "Detail"]

    files = [p for p in root.rglob("*") if p.suffix.lower() in (".png", ".tga", ".bmp")]
    print(f"扫到 {len(files)} 张贴图\n")

    for kw in KEYWORDS:
        n = sum(1 for f in files if kw in f.stem)
        if n:
            name_hits[kw] = n
    print("=== 文件名里出现这些关键词的有多少 ===")
    if name_hits:
        for k, v in name_hits.most_common():
            print(f"  {k:<12} {v:>5} 张")
    else:
        print("  一个都没有")

    print()
    for label, pat in PATTERNS:
        picked = [f for f in files if pat.search(f.stem)][: args.limit]
        if not picked:
            continue
        stats = []
        for f in picked:
            s = alpha_state(f)
            if s:
                stats.append(s)
        if not stats:
            continue
        const = sum(1 for u, t, c in stats if c)
        live = [(u, t) for u, t, c in stats if not c]
        buckets[label] = stats
        line = f"  {label:<16} {len(stats):>4} 张   透明通道恒定 {const:>4} ({const/len(stats)*100:.0f}%)"
        if live:
            uniq = sorted(u for u, _ in live)
            tops = sorted(t for _, t in live)
            line += (f"   有数据的 {len(live)} 张：唯一值中位 {uniq[len(uniq)//2]}"
                     f"  最常见值占比中位 {tops[len(tops)//2]*100:.1f}%")
        print(line)

    print()
    print("=== 判读 ===")
    for label, stats in buckets.items():
        live = [(u, t) for u, t, c in stats if not c]
        if not live:
            print(f"  {label}: 透明通道全都是常量 —— 这里没有藏数据")
            continue
        # "藏着数据"的判据：有较多唯一值、且不是一边倒
        rich = [1 for u, t in live if u >= 16 and t < 0.98]
        print(f"  {label}: {len(live)} 张透明通道有变化，其中 {len(rich)} 张"
              f"（唯一值≥16 且最常见值<98%）像真的藏了图 —— 占全部的 "
              f"{len(rich)/len(stats)*100:.0f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
