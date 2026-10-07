"""把 `_N` → `ZZZ_Converted_Normal` 那条转换的细节钉死：逐通道 MAE、LUT、取整方式、要不要归一化。

只读素材。两组配对（Vivian / Pheony）必须给出同一个答案。
"""
import numpy as np
from PIL import Image

BASE = r"E:\deepseek-harness\mmd集成工具\参考工具样本\参考工具制作的效果\MSToon\绝区零"
PAIRS = [
    ("Vivian", r"Vivian\Vivian_Body_2_N.png", r"Vivian\ZZZ_Converted_Normal.png"),
    ("Pheony", r"Pheony\Pheony_Body_N.png", r"Pheony\ZZZ_Converted_Normal.png"),
]


def load(p):
    return np.asarray(Image.open(p).convert("RGBA")).astype(np.int64)


def lut_check(x_in, y_out, tag):
    """同一输入值是否总给同一个输出（确定性），若是则打印映射表的不同项"""
    m = {}
    bad = 0
    for a, b in zip(x_in.ravel(), y_out.ravel()):
        if a in m:
            if m[a] != b:
                bad += 1
        else:
            m[a] = b
    conflicts = len(m) and bad
    diff = sum(1 for k, v in m.items() if k != v)
    print(f"    {tag}: 定义域 {len(m)} 项，冲突对 {bad}，与恒等不同的输入 {diff}")
    return m


for name, sp, op in PAIRS:
    print(f"=== {name} ===")
    s = load(f"{BASE}\\{sp}")
    o = load(f"{BASE}\\{op}")
    R, G, B = s[:, :, 0], s[:, :, 1], s[:, :, 2]
    print("  -- 产物 R / G 是不是就是源 R / G --")
    lut_check(R, o[:, :, 0], "R→R")
    lut_check(G, o[:, :, 1], "G→G")

    print("  -- 各种重建写法下逐通道的差 --")
    variants = {}
    for tag, scale in (("x=2v-1", 2.0), ("x=(v-127.5)/127.5", 255.0 / 127.5)):
        x = (R.astype(np.float64) / 255.0) * 2 - 1 if scale == 2.0 else (R.astype(np.float64) - 127.5) / 127.5
        y = (G.astype(np.float64) / 255.0) * 2 - 1 if scale == 2.0 else (G.astype(np.float64) - 127.5) / 127.5
        z = np.sqrt(np.maximum(0.0, 1.0 - x * x - y * y))
        for norm in (False, True):
            xx, yy, zz = x.copy(), y.copy(), z.copy()
            if norm:
                ln = np.sqrt(xx * xx + yy * yy + zz * zz)
                ln[ln < 1e-5] = 1
                xx, yy, zz = xx / ln, yy / ln, zz / ln
            for rnd in ("none", "round", "floor"):
                if rnd == "round":
                    f = lambda a: np.rint(a)
                elif rnd == "floor":
                    f = lambda a: np.floor(a)
                else:
                    f = lambda a: a
                out = np.stack([f((xx * 0.5 + 0.5) * 255), f((yy * 0.5 + 0.5) * 255), f((zz * 0.5 + 0.5) * 255)], -1)
                for i, c in enumerate("RGB"):
                    d = np.abs(out[:, :, i] - o[:, :, i])
                    variants.setdefault((tag, norm, rnd), []).append((c, d.mean(), 100.0 * (d == 0).mean(), d.max()))
    best = sorted(variants.items(), key=lambda kv: sum(t[1] for t in kv[1]))[:4]
    for (tag, norm, rnd), rows in best:
        print(f"    {tag:18s} norm={int(norm)} {rnd:5s} " + "  ".join(f"{c}:MAE={m:.3f}/同{pc:6.2f}%/max{int(mx)}" for c, m, pc, mx in rows))

    print("  -- 只差在取整上时，看余数分布 --")
    x = (R.astype(np.float64) / 255.0) * 2 - 1
    y = (G.astype(np.float64) / 255.0) * 2 - 1
    z = np.sqrt(np.maximum(0.0, 1.0 - x * x - y * y))
    bf = (z * 0.5 + 0.5) * 255
    d = bf - o[:, :, 2]
    print(f"    B: 连续值-产物  mean={d.mean():.4f} min={d.min():.3f} max={d.max():.3f}  |差|<0.51 的比例={100.0*(np.abs(d)<0.51).mean():.2f}%")
