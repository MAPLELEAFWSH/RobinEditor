"""
裁头像 —— 给候选，不瞎猜。

这张立绘上肤色判据会全图触发（每行都有 5–45% 命中，横向铺满），
所以自动找脸不可靠。改成列出候选裁法，编号拼成一张对比图，
看一眼挑个号就行。

用法：
  python tools/make_icon.py sheet            出候选对比图（tmp/icon-candidates.png）
  python tools/make_icon.py pick <编号>      按选中的编号生成整套图标
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

SRC = r"E:\deepseek-harness\mmd集成工具\Image_1789638084595_952.jpg"
ICON_DIR = os.path.join("src-tauri", "icons")
SHEET = os.path.join("tmp", "icon-candidates.png")

# 候选：(编号, 说明, 方框边长占图宽比例, 方框上沿占图高比例, 水平偏移占图宽比例)
# 水平偏移 0 = 居中，负数往左
CANDIDATES = [
    ("01", "头肩 · 大", 0.62, 0.02, 0.00),
    ("02", "头肩 · 中", 0.52, 0.04, 0.00),
    ("03", "头肩 · 小", 0.44, 0.06, 0.00),
    ("04", "头 · 大", 0.52, 0.00, 0.00),
    ("05", "头 · 中", 0.42, 0.02, 0.00),
    ("06", "头 · 小", 0.34, 0.04, 0.00),
    ("07", "偏左上", 0.46, 0.02, -0.10),
    ("08", "偏右上", 0.46, 0.02, 0.10),
    ("09", "偏左中", 0.50, 0.06, -0.08),
    ("10", "偏右中", 0.50, 0.06, 0.08),
    ("11", "抬头", 0.48, -0.04, 0.00),
    ("12", "全宽头肩", 0.72, 0.00, 0.00),
]


def box(im, side_ratio, top_ratio, dx_ratio):
    w, h = im.size
    side = int(min(w, h * 0.98) * side_ratio) if side_ratio * w <= h * 0.98 else int(h * 0.98)
    side = int(w * side_ratio)
    if side > h:
        side = h
    x0 = int(w / 2 - side / 2 + dx_ratio * w)
    y0 = int(h * top_ratio)
    x0 = max(0, min(x0, w - side))
    y0 = max(0, min(y0, h - side))
    return x0, y0, side


def sheet():
    im = Image.open(SRC).convert("RGB")
    os.makedirs("tmp", exist_ok=True)

    cell = 200
    pad = 10
    label_h = 22
    cols = 4
    rows = (len(CANDIDATES) + cols - 1) // cols
    W = cols * (cell + pad) + pad
    H = rows * (cell + label_h + pad) + pad
    out = Image.new("RGB", (W, H), (24, 24, 28))
    d = ImageDraw.Draw(out)

    try:
        font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 13)
    except Exception:
        font = ImageFont.load_default()

    for i, (no, desc, sr, tr, dxr) in enumerate(CANDIDATES):
        c, r = i % cols, i // cols
        x = pad + c * (cell + pad)
        y = pad + r * (cell + label_h + pad)
        x0, y0, side = box(im, sr, tr, dxr)
        out.paste(im.crop((x0, y0, x0 + side, y0 + side)).resize((cell, cell), Image.LANCZOS), (x, y))
        d.text((x + 2, y + cell + 3), f"{no}  {desc}", fill=(230, 230, 235), font=font)
        # 标一下这是原图哪块，方便核对
        d.rectangle([x - 1, y - 1, x + cell, y + cell], outline=(90, 90, 100))

    out.save(SHEET)
    print(f"候选图已存 {SHEET}（{W}x{H}）")
    print("每一格左上角是编号，看中哪个就 tell 我编号。")
    for no, desc, sr, tr, dxr in CANDIDATES:
        x0, y0, side = box(im, sr, tr, dxr)
        print(f"  {no}  {desc:<10} {side}x{side} @ ({x0}, {y0})")
    return 0


def rounded(im, ratio=0.22):
    from PIL import ImageDraw as D
    w, h = im.size
    r = int(min(w, h) * ratio)
    m = Image.new("L", (w * 4, h * 4), 0)
    D.Draw(m).rounded_rectangle([0, 0, w * 4 - 1, h * 4 - 1], radius=r * 4, fill=255)
    m = m.resize((w, h), Image.LANCZOS)
    o = im.convert("RGBA")
    o.putalpha(m)
    return o


def make_icons(no):
    hit = [c for c in CANDIDATES if c[0] == no]
    if not hit:
        print(f"没有编号 {no}")
        return 1
    _, desc, sr, tr, dxr = hit[0]
    im = Image.open(SRC).convert("RGB")
    x0, y0, side = box(im, sr, tr, dxr)
    print(f"用 {no} {desc}：{side}x{side} @ ({x0}, {y0})")

    os.makedirs(ICON_DIR, exist_ok=True)
    crop = im.crop((x0, y0, x0 + side, y0 + side))

    sizes = [16, 24, 32, 48, 64, 128, 256, 512]
    png = {}
    for s in sizes:
        r = crop.resize((s, s), Image.LANCZOS)
        if s >= 128:
            from PIL import ImageFilter
            r = r.filter(ImageFilter.UnsharpMask(radius=1.4, percent=55, threshold=3))
        png[s] = r

    png[32].save(os.path.join(ICON_DIR, "32x32.png"))
    png[128].save(os.path.join(ICON_DIR, "128x128.png"))
    png[256].save(os.path.join(ICON_DIR, "128x128@2x.png"))
    png[512].save(os.path.join(ICON_DIR, "icon.png"))
    for name, s in [("Square30x30Logo.png", 30), ("Square44x44Logo.png", 44),
                    ("Square71x71Logo.png", 71), ("Square89x89Logo.png", 89),
                    ("Square107x107Logo.png", 107), ("Square142x142Logo.png", 142),
                    ("Square150x150Logo.png", 150), ("Square284x284Logo.png", 284),
                    ("Square310x310Logo.png", 310), ("StoreLogo.png", 50)]:
        crop.resize((s, s), Image.LANCZOS).save(os.path.join(ICON_DIR, name))
    png[256].save(os.path.join(ICON_DIR, "icon.ico"), format="ICO",
                  sizes=[(s, s) for s in [16, 24, 32, 48, 64, 128, 256]])

    print(f"已写出到 {ICON_DIR}/：32/128/256/512 PNG + 10 个方形 logo + 多尺寸 icon.ico")
    return 0


def from_file(path):
    """直接拿一张方图出整套图标。不是方的就居中裁成正方。"""
    from PIL import ImageFilter

    im = Image.open(path)
    w, h = im.size
    print(f"源图 {path}  {w}x{h}  {im.mode}")

    if w != h:
        side = min(w, h)
        x0 = (w - side) // 2
        y0 = (h - side) // 2
        im = im.crop((x0, y0, x0 + side, y0 + side))
        print(f"居中裁成正方 {side}x{side}")

    os.makedirs(ICON_DIR, exist_ok=True)
    png = {}
    for s in [16, 24, 32, 48, 64, 128, 256, 512]:
        r = im.resize((s, s), Image.LANCZOS)
        if s >= 128:
            # 缩图会糊，大尺寸上补一点锐
            r = r.filter(ImageFilter.UnsharpMask(radius=1.4, percent=55, threshold=3))
        png[s] = r

    png[32].save(os.path.join(ICON_DIR, "32x32.png"))
    png[128].save(os.path.join(ICON_DIR, "128x128.png"))
    png[256].save(os.path.join(ICON_DIR, "128x128@2x.png"))
    png[512].save(os.path.join(ICON_DIR, "icon.png"))
    for name, s in [("Square30x30Logo.png", 30), ("Square44x44Logo.png", 44),
                    ("Square71x71Logo.png", 71), ("Square89x89Logo.png", 89),
                    ("Square107x107Logo.png", 107), ("Square142x142Logo.png", 142),
                    ("Square150x150Logo.png", 150), ("Square284x284Logo.png", 284),
                    ("Square310x310Logo.png", 310), ("StoreLogo.png", 50)]:
        im.resize((s, s), Image.LANCZOS).save(os.path.join(ICON_DIR, name))

    # ICO 里塞多档，Windows 自己挑
    png[256].convert("RGBA").save(
        os.path.join(ICON_DIR, "icon.ico"), format="ICO",
        sizes=[(s, s) for s in [16, 24, 32, 48, 64, 128, 256]])

    # 浏览器标签页 / 桌面快捷方式用的那份。不放这个的话标签页还是 SvelteKit 默认图标。
    os.makedirs("static", exist_ok=True)
    im.resize((512, 512), Image.LANCZOS).save("static/favicon.png")
    im.resize((180, 180), Image.LANCZOS).save("static/apple-touch-icon.png")
    png[64].convert("RGBA").save("static/favicon.ico", format="ICO",
                                 sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    # 界面里当 logo 用的。侧栏那个方块显示 22px、开场那个 52px，
    # 出 256 够 HiDPI 了。别直接指 favicon.png —— 512 的 470KB，
    # 为一个小方块加载那个不值。
    im.resize((256, 256), Image.LANCZOS).save("static/app-icon.png")

    print(f"已写出到 {ICON_DIR}/：32/128/256/512 PNG + 10 个方形 logo + 多尺寸 icon.ico")
    print("已写出到 static/：favicon.png(512)  favicon.ico  apple-touch-icon.png(180)  app-icon.png(256)")
    return 0


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    cmd = sys.argv[1] if len(sys.argv) > 1 else "sheet"
    if cmd == "pick":
        return make_icons(sys.argv[2])
    if cmd == "from":
        return from_file(sys.argv[2])
    return sheet()


if __name__ == "__main__":
    sys.exit(main())
