"""
压体积。交付前跑一次。

压哪儿、为什么：
  · 三张模板自带的 svg（svelte / tauri / vite）是脚手架留下的，没人引用，删。
  · favicon.png 是壁纸源图整张出的 512 版，473KB —— 一个 favicon 不值这个体积。
    缩到 180，跟 apple-touch-icon 一档就够。
  · 壁纸是大头（9 张 1920 宽共 3.1MB）。改成 1600 宽、q80、progressive + optimize。
    progressive 对 JPEG 本身不省字节，但 optimize 会重算霍夫曼表，通常能省几个点。

不动的东西：bg/thumb/ 那批本来就是缩略图；app-icon.png 256 是界面里在用的，
150KB 是它该有的体积（PNG 存照片类图标压不动，换 webp 又要动引用，不值）。

用法：python tools/slim.py [--dry]
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
DRY = "--dry" in sys.argv

removed = []
saved_before = 0
saved_after = 0


def report(label: str, before: int, after: int):
    global saved_before, saved_after
    saved_before += before
    saved_after += after
    delta = before - after
    pct = (delta / before * 100) if before else 0
    print(f"  {label:<34} {before/1024:8.1f} KB -> {after/1024:8.1f} KB  ({-delta/1024:+.1f} KB, {-pct:+.1f}%)")


print("== 删脚手架留下的图 ==")
for name in ("svelte.svg", "tauri.svg", "vite.svg"):
    p = STATIC / name
    if p.exists():
        size = p.stat().st_size
        if not DRY:
            p.unlink()
        removed.append((name, size))
        print(f"  - {name}  {size/1024:.1f} KB")

print("\n== favicon.png ==")
fv = STATIC / "favicon.png"
if fv.exists():
    before = fv.stat().st_size
    if not DRY:
        im = Image.open(fv).convert("RGBA")
        im = im.resize((180, 180), Image.LANCZOS)
        im.save(fv, "PNG", optimize=True)
    report("favicon.png 512 -> 180", before, fv.stat().st_size)

print("\n== 壁纸 ==")
for p in sorted((STATIC / "bg").glob("*.jpg")):
    before = p.stat().st_size
    if not DRY:
        im = Image.open(p)
        w, h = im.size
        if w > 1600:
            im = im.resize((1600, round(h * 1600 / w)), Image.LANCZOS)
        if im.mode != "RGB":
            im = im.convert("RGB")
        im.save(p, "JPEG", quality=80, optimize=True, progressive=True, subsampling=1)
    report(p.name, before, p.stat().st_size)

total_before = sum(b for _, b in removed) + saved_before
total_after = saved_after
print(f"\n合计：{total_before/1024/1024:.2f} MB -> {total_after/1024/1024:.2f} MB"
      f"  省 {(total_before-total_after)/1024/1024:.2f} MB")
if DRY:
    print("（--dry，没真写）")
