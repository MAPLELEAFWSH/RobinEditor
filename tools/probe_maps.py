"""
量样本贴图的通道规格。

不猜、不抄，直接对真图做统计：每张图的四个通道各自是什么，
值是不是离散的、分几档、有没有渐变结构。

msToon 的控制图和原神 / 星铁的 lightmap 都能喂进来 —— 它们都是
"一个通道一件事" 的打包图，量一遍就知道哪个通道该放什么。

用法：python tools/probe_maps.py <文件或目录> [更多...]
"""
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def channel_report(a: np.ndarray, name: str) -> str:
    """单个通道 0-255 的分布描述。"""
    u = np.unique(a)
    n = a.size
    # 离散程度：唯一值个数 / 理论上限
    discrete = len(u) <= 32
    # 头几档占比
    cnt = Counter(a.ravel().tolist())
    top = cnt.most_common(4)
    top_s = "  ".join(f"{v/255:.2f}:{c/n*100:.1f}%" for v, c in top)
    # 在不在 0.05 网格上（原神 / 星铁的 lightmap 是吸附过的）
    grid = np.abs(a / 255 * 20 - np.round(a / 255 * 20))
    on_grid = float((grid < 0.08).mean())
    # 空间梯度：距离场会有明显的大范围渐变
    gx = np.abs(np.diff(a.astype(np.int16), axis=1)).mean()
    gy = np.abs(np.diff(a.astype(np.int16), axis=0)).mean()
    return (
        f"    {name}: 唯一值 {len(u):>4}  均值 {a.mean()/255:.3f}  标准差 {a.std()/255:.3f}"
        f"  恒定={'是' if len(u)==1 else '否'}"
        f"\n           档位 {'离散' if discrete else '连续'}   0.05 网格上 {on_grid*100:.1f}%"
        f"   邻域差 x={gx:.2f} y={gy:.2f}"
        f"\n           主要档位 {top_s}"
    )


def probe(p: Path) -> None:
    try:
        im = Image.open(p)
    except Exception as e:
        print(f"  读不了：{e}")
        return
    a = np.asarray(im.convert("RGBA"))
    h, w = a.shape[:2]
    print(f"\n{p.name}   {w}×{h}   {im.mode}→RGBA   {p.stat().st_size/1024:.1f} KB")
    for i, ch in enumerate("RGBA"):
        print(channel_report(a[:, :, i], ch))
    # 猜用途：恒定通道、alpha 全 255 这类一眼能看出来
    hints = []
    for i, ch in enumerate("RGBA"):
        if len(np.unique(a[:, :, i])) == 1:
            hints.append(f"{ch} 恒定 {a[0,0,i]/255:.2f}")
    if hints:
        print("    → " + "；".join(hints))


def main():
    targets = []
    for arg in sys.argv[1:]:
        p = Path(arg)
        if p.is_dir():
            for ext in ("*.png", "*.jpg", "*.tga", "*.bmp"):
                targets.extend(sorted(p.rglob(ext)))
        elif p.exists():
            targets.append(p)
        else:
            print(f"找不到 {p}")
    if not targets:
        print(__doc__)
        return 1
    for t in targets:
        probe(t)
    return 0


if __name__ == "__main__":
    sys.exit(main())
