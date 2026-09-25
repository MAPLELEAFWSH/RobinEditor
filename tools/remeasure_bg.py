"""
重新量一遍内置壁纸的亮度，刷新 src/lib/bg-meta.json。

为什么需要单独一个：`import_wallpapers.py` 是"从源图重新导一遍"，
它会把 1920 的版本写回去；而 `slim.py` 为了压体积把壁纸压成了 1600 宽 q80，
像素跟原始那版不再逐位相同，亮度也就差一点点。
遮罩强度是按亮度算的，所以压完要重新量一次，不然元数据和实际文件对不上。

这个脚本**只读 static/bg 里现有的图**，不碰源目录，也不改图。

用法：python tools/remeasure_bg.py
"""
import json
import os
import sys

from PIL import Image, ImageStat

BG = os.path.join("static", "bg")
META = os.path.join("src", "lib", "bg-meta.json")

SCRIM_MIN = 0.03
SCRIM_MAX = 0.16


def mean_luma(im):
    small = im.convert("L").resize((128, 128), Image.BILINEAR)
    return ImageStat.Stat(small).mean[0] / 255.0


def scrim_for(luma):
    s = SCRIM_MIN + (SCRIM_MAX - SCRIM_MIN) * luma
    return round(min(SCRIM_MAX, max(SCRIM_MIN, s)), 3)


def main():
    if not os.path.exists(META):
        print("没有 bg-meta.json，先跑 import_wallpapers.py")
        return 1
    with open(META, encoding="utf-8") as f:
        meta = json.load(f)

    print(f"{'名':<8}{'实际尺寸':<13}{'旧亮度':<10}{'新亮度':<10}{'旧遮罩':<9}新遮罩")
    changed = 0
    for m in meta:
        p = os.path.join(BG, f"{m['id']}.jpg")
        if not os.path.exists(p):
            print(f"{m['id']:<8}缺文件，跳过")
            continue
        with Image.open(p) as im:
            w, h = im.size
            luma = mean_luma(im)
        old_luma, old_scrim = m["luma"], m["scrim"]
        m["w"], m["h"] = w, h
        m["luma"] = round(luma, 3)
        m["scrim"] = scrim_for(luma)
        if m["luma"] != old_luma or m["scrim"] != old_scrim:
            changed += 1
        print(f"{m['id']:<8}{f'{w}x{h}':<13}{old_luma:<10}{m['luma']:<10}{old_scrim:<9}{m['scrim']}")

    with open(META, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
        f.write("\n")

    lumas = [m["luma"] for m in meta]
    print(f"\n亮度 {min(lumas):.3f}–{max(lumas):.3f}，"
          f"遮罩 {min(m['scrim'] for m in meta):.3f}–{max(m['scrim'] for m in meta):.3f}")
    print(f"有变化的：{changed} 张。已刷新 {META}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
