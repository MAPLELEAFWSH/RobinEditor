import numpy as np, glob
from PIL import Image
for 前缀 in [".leaf", ".btn"]:
    pass
for 组 in [("leaf", ["tmp/ripple/zoom-0-未点.png","tmp/ripple/zoom-120ms.png","tmp/ripple/zoom-300ms.png"])]:
    基 = np.asarray(Image.open(组[1][0]).convert("RGB"), dtype=np.int16)
    for p in 组[1][1:]:
        a = np.asarray(Image.open(p).convert("RGB"), dtype=np.int16)
        d = np.abs(a - 基).sum(axis=2)
        print(f"{p}: 最大差 {int(d.max())}  差>6 的像素 {int((d>6).sum())} / {d.size}   平均 {d.mean():.2f}")
