"""看一眼壁纸和容器的宽高比差多少 —— 决定 object-fit 该怎么设。"""
import json
import sys

from PIL import Image

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

meta = json.load(open("src/lib/bg-meta.json", encoding="utf-8"))

print("壁纸：")
print(f"{'图':<7}{'尺寸':<14}{'宽高比':<10}{'亮度':<8}遮罩")
ratios = []
for m in meta:
    im = Image.open(f"static/bg/{m['id']}.jpg")
    w, h = im.size
    r = w / h
    ratios.append(r)
    print(f"{m['id']:<7}{f'{w}x{h}':<14}{r:<10.3f}{m['luma']:<8.3f}{m['scrim']:.3f}")

print(f"\n壁纸宽高比范围 {min(ratios):.3f} – {max(ratios):.3f}")

print("\n容器：")
for name, w, h in [
    ("全窗 1707x876", 1707, 876),
    ("全窗 1040x680（最小窗）", 1040, 680),
    ("内容区 1371x774", 1371, 774),
    ("内容区 704x608（1040 窗）", 704, 608),
]:
    print(f"  {name:<26} {w/h:.3f}")

print("\n结论：")
print("  壁纸普遍比容器更宽（壁纸 2.0–2.35，容器 1.5–1.95）。")
print("  object-fit: cover 会把左右裁掉，人物如果在边上就没了。")
print("  需要给个可选的适应方式，并且默认值要能保住中间的主体。")
