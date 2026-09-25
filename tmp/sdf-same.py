import os, numpy as np
from PIL import Image
根 = r"E:\deepseek-harness\mmd集成工具\参考工具样本\参考工具制作的效果\MSToon\原神\SDF规格"
for 游戏 in ["原神", "崩坏：星穹铁道", "绝区零"]:
    d = os.path.join(根, 游戏)
    同 = {"RG": [], "RB": [], "RA": [], "GB": [], "GA": [], "BA": []}
    for f in sorted(os.listdir(d)):
        if not f.lower().endswith(".png"): continue
        a = np.asarray(Image.open(os.path.join(d, f)).convert("RGBA"), dtype=np.int16)
        for k, (i, j) in {"RG": (0,1), "RB": (0,2), "RA": (0,3), "GB": (1,2), "GA": (1,3), "BA": (2,3)}.items():
            同[k].append(float(np.mean(a[..., i] == a[..., j]) * 100))
    print(游戏, "  逐像素完全相同的比例：", "  ".join(f"{k} {np.mean(v):.1f}%" for k, v in 同.items()))
