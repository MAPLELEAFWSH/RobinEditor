"""量 `_N` → `ZZZ_Converted_Normal` 到底是哪条转换。

只读素材，不改任何东西。两组配对（Vivian / Pheony）都跑，两组都对上才算事实。
"""
import numpy as np
from PIL import Image

BASE = r"E:\deepseek-harness\mmd集成工具\参考工具样本\参考工具制作的效果\MSToon\绝区零"

PAIRS = [
    ("Vivian", r"Vivian\Vivian_Body_2_N.png", r"Vivian\ZZZ_Converted_Normal.png"),
    ("Pheony", r"Pheony\Pheony_Body_N.png", r"Pheony\ZZZ_Converted_Normal.png"),
]


def load(p):
    im = Image.open(p)
    a = np.asarray(im.convert("RGBA")).astype(np.int32)
    return im.size, a


def stats(a, tag):
    print(f"  {tag}: size={a.shape[1]}x{a.shape[0]}")
    for i, c in enumerate("RGBA"):
        v = a[:, :, i]
        print(f"    {c}: mean={v.mean():8.3f} sd={v.std():7.3f} min={v.min():3d} max={v.max():3d} uniq={len(np.unique(v))}")


for name, src_p, out_p in PAIRS:
    print(f"=== {name} ===")
    ssz, s = load(f"{BASE}\\{src_p}")
    osz, o = load(f"{BASE}\\{out_p}")
    print(f"  尺寸 源={ssz} 产物={osz}  一致={ssz == osz}")
    if ssz != osz:
        # 缩到同一尺寸再比
        im = Image.open(f"{BASE}\\{src_p}").convert("RGBA").resize(osz, Image.NEAREST)
        s = np.asarray(im).astype(np.int32)
        print("  源已用最邻近缩到产物尺寸")
    stats(s, "源 _N")
    stats(o, "产物")

    # 1) 产物每一路 vs 源每一路：MAE / 逐像素相同比例
    print("  --- 通道对通道（MAE / 完全相同%） ---")
    print("        " + "".join(f"{c:>16s}" for c in "RGBA") )
    for oc in range(4):
        row = f"    产物{'RGBA'[oc]} "
        for sc in range(4):
            d = np.abs(o[:, :, oc] - s[:, :, sc])
            row += f"{d.mean():7.3f}/{100.0*(d==0).mean():6.2f}%"
        print(row)

    # 2) 假设：源是 AG 打包（X=A, Y=G）→ 产物 RGB 标准法线
    for label, xch, ych in [("AG(A,G)", 3, 1), ("RG(R,G)", 0, 1), ("RGB(R,G)", 0, 1)]:
        x = (s[:, :, xch].astype(np.float64) / 255.0) * 2 - 1
        y = (s[:, :, ych].astype(np.float64) / 255.0) * 2 - 1
        for flipy in (False, True):
            yy = -y if flipy else y
            z = np.sqrt(np.maximum(0.0, 1 - x * x - yy * yy))
            for tag, zz in (("rebuild", z), ("srcB", (s[:, :, 2].astype(np.float64) / 255.0) * 2 - 1)):
                out = np.clip((np.stack([x, yy, zz], -1) * 0.5 + 0.5) * 255, 0, 255)
                d = np.abs(out - o[:, :, :3])
                print(f"  {label:8s} flipY={int(flipy)} z={tag:8s} RGB MAE={d.mean():7.3f} 全同={100.0*(d==0).mean():6.2f}% 逐像素全通道同={100.0*(d.max(-1)==0).mean():6.2f}%")
