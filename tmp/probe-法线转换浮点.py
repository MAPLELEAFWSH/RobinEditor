"""找那条转换的浮点写法：R/G 那 63 个差 1 的输入是"先转 float 再截断"的签名。

目标：找到一种写法让三个通道都 100% 逐像素相同。找不到就记下最好的那组。
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


def run(s, o, dtype, formula, zform, rnd):
    R = s[:, :, 0].astype(dtype)
    G = s[:, :, 1].astype(dtype)
    if formula == "2v-1":
        x = R / dtype(255.0) * dtype(2.0) - dtype(1.0)
    elif formula == "v-127.5":
        x = (R - dtype(127.5)) / dtype(127.5)
    elif formula == "mul-1":
        x = R * (dtype(2.0) / dtype(255.0)) - dtype(1.0)
    elif formula == "div128":
        x = R / dtype(128.0) - dtype(1.0)
    else:
        raise ValueError(formula)
    if formula == "2v-1":
        y = G / dtype(255.0) * dtype(2.0) - dtype(1.0)
    elif formula == "v-127.5":
        y = (G - dtype(127.5)) / dtype(127.5)
    elif formula == "mul-1":
        y = G * (dtype(2.0) / dtype(255.0)) - dtype(1.0)
    else:
        y = G / dtype(128.0) - dtype(1.0)
    inner = dtype(1.0) - x * x - y * y
    inner = np.maximum(inner, dtype(0.0))
    if zform == "sqrt":
        z = np.sqrt(inner)
    else:
        z = np.sqrt(inner)
    out = np.stack([(x * dtype(0.5) + dtype(0.5)) * dtype(255.0),
                    (y * dtype(0.5) + dtype(0.5)) * dtype(255.0),
                    (z * dtype(0.5) + dtype(0.5)) * dtype(255.0)], -1)
    if rnd == "floor":
        out = np.floor(out)
    elif rnd == "round":
        out = np.rint(out)
    out = np.clip(out, 0, 255).astype(np.int64)
    per = []
    for i in range(3):
        d = np.abs(out[:, :, i] - o[:, :, i])
        per.append((d.mean(), 100.0 * (d == 0).mean(), int(d.max())))
    return per


for name, sp, op in PAIRS:
    print(f"=== {name} ===")
    s = load(f"{BASE}\\{sp}")
    o = load(f"{BASE}\\{op}")
    rows = []
    for dname, dtype in (("f64", np.float64), ("f32", np.float32)):
        for formula in ("2v-1", "v-127.5", "mul-1", "div128"):
            for zform in ("sqrt",):
                for rnd in ("floor", "round"):
                    per = run(s, o, dtype, formula, zform, rnd)
                    score = sum(p[0] for p in per)
                    rows.append((score, dname, formula, zform, rnd, per))
    for score, dname, formula, zform, rnd, per in sorted(rows)[:5]:
        txt = "  ".join(f"{c}同{pc:6.2f}%/MAE{m:.4f}/max{int(mx)}" for c, (m, pc, mx) in zip("RGB", per))
        print(f"    {dname} {formula:8s} {zform} {rnd:5s} 总分{score:.4f}  {txt}")
