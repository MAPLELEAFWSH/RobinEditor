"""
把 mmd集成工具 里新增的壁纸处理成能用的尺寸，并量出每张的亮度。

做两件事：
  1. 压尺寸。源图最大 11 MB，直接塞进桌面应用不合适。
     统一压到宽 1920、JPEG q82，再各出一张 320 宽的缩略图给设置面板。
  2. **量亮度，写进 static/bg/meta.json**。
     壁纸有亮有暗，正文压在亮图上和压在暗图上需要的遮罩强度不一样。
     与其拍一个折中值，不如每张量出来：取 128×128 缩放后的平均相对亮度，
     再反推一个遮罩强度。运行时按当前是哪张取，不用临时算。

用法：python tools/import_wallpapers.py
"""
import glob
import json
import os
import sys

from PIL import Image, ImageStat

SRC_DIR = r"E:\deepseek-harness\mmd集成工具"
OUT = os.path.join("static", "bg")
THUMB = os.path.join(OUT, "thumb")

FULL_W = 1920
THUMB_W = 320
Q = 82

# 遮罩强度的上下限。
#
# 这组值调过一轮。之前是 0.06–0.46，配 --cover-veil 0.8，
# 最亮那张（luma 0.68）实际可见度只有 0.8 × 0.668 = 0.53 —— 壁纸基本被洗掉了。
# 而且壁纸只在内容区的空隙里露出来，卡片本身是 92% 不透明，正文根本不受影响，
# 那层厚遮罩是在防一个不存在的问题。
#
# 现在 0.03–0.16，配 veil 0.9，可见度落在 0.79–0.85。
SCRIM_MIN = 0.03
SCRIM_MAX = 0.16


def mean_luma(im):
    """平均相对亮度 0–1。缩到 128 宽再算，快且够准。"""
    small = im.convert("L").resize((128, 128), Image.BILINEAR)
    return ImageStat.Stat(small).mean[0] / 255.0


def scrim_for(luma):
    """
    亮度 → 遮罩强度。线性映射到 [SCRIM_MIN, SCRIM_MAX]。
    亮图（luma→1）要更厚的遮罩，暗图薄一点就够。
    """
    s = SCRIM_MIN + (SCRIM_MAX - SCRIM_MIN) * luma
    return round(min(SCRIM_MAX, max(SCRIM_MIN, s)), 3)


def main():
    os.makedirs(THUMB, exist_ok=True)
    files = sorted(
        glob.glob(os.path.join(SRC_DIR, "元气壁纸_*.jpg"))
        + glob.glob(os.path.join(SRC_DIR, "元气壁纸_*.png"))
    )
    if not files:
        print("没找到 元气壁纸_* 文件")
        return 1

    total_src = 0
    total_out = 0
    rows = []
    meta = []

    for i, src in enumerate(files, start=1):
        total_src += os.path.getsize(src)
        name = f"wp-{i:02d}"
        with Image.open(src) as im:
            im = im.convert("RGB")
            w, h = im.size
            luma = mean_luma(im)

            if w > FULL_W:
                im2 = im.resize((FULL_W, round(h * FULL_W / w)), Image.LANCZOS)
            else:
                im2 = im
            dst = os.path.join(OUT, f"{name}.jpg")
            im2.save(dst, "JPEG", quality=Q, optimize=True, progressive=True)

            im3 = im.resize((THUMB_W, max(1, round(h * THUMB_W / w))), Image.LANCZOS)
            im3.save(os.path.join(THUMB, f"{name}.jpg"), "JPEG", quality=78, optimize=True)

        scrim = scrim_for(luma)
        meta.append({
            "id": name,
            "src": os.path.basename(src),
            "w": w,
            "h": h,
            "luma": round(luma, 3),
            "scrim": scrim,
        })

        out_kb = os.path.getsize(dst) // 1024
        total_out += os.path.getsize(dst)
        rows.append((name, f"{w}x{h}", f"{os.path.getsize(src)//1024}KB", f"{out_kb}KB",
                     f"{luma:.3f}", f"{scrim:.3f}"))

    print(f"{'名':<8}{'原始尺寸':<13}{'源':<9}{'输出':<9}{'亮度':<9}遮罩")
    for r in rows:
        print(f"{r[0]:<8}{r[1]:<13}{r[2]:<9}{r[3]:<9}{r[4]:<9}{r[5]}")

    with open(os.path.join("src", "lib", "bg-meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
        f.write("\n")

    lumas = [m["luma"] for m in meta]
    veil = 0.9
    print(f"\n源 {total_src/1024/1024:.1f} MB → 输出 {total_out/1024/1024:.1f} MB"
          f"（压到 {total_out/total_src*100:.1f}%）")
    print(f"亮度 {min(lumas):.3f}–{max(lumas):.3f}，"
          f"遮罩 {min(m['scrim'] for m in meta):.3f}–{max(m['scrim'] for m in meta):.3f}")
    eff = [veil * (1 - m["scrim"]) for m in meta]
    print(f"壁纸实际可见度（veil {veil} × (1-遮罩)）：{min(eff):.2f}–{max(eff):.2f}")
    print("已写出 src/lib/bg-meta.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
