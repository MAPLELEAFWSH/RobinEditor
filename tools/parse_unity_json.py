"""
解包样本里的 Unity 材质 JSON，反推每个 shader 的贴图槽语义。

为什么这个比看图片可靠：样本里那些 .json 是 Unity 导出的材质定义，
`m_TexEnvs` 直接写明**槽名 → 哪张贴图**。比如绝区零身体材质的
`_LightTex` 指向 `Claret_Body_Map1_N`（法线图）—— 也就是说这个槽
装的不是"光照图"而是法线。这种事看图片看不出来（两张图长得都像灰度图），
看 JSON 一眼就清楚。

出来的东西直接用来：
  · 修正工具里对贴图的命名（"光照贴图"这种含糊说法换成槽里的实际含义）
  · 反推通道语义（哪张贴图的哪个通道是什么）
  · 建"槽名 → 贴图后缀"的对照表

只读样本，不改任何东西。

用法：python tools/parse_unity_json.py <模型根目录> [--out 文件]
"""
import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def load(path: Path):
    raw = path.read_text(encoding="utf-8", errors="replace")
    # Unity 的导出偶尔带 BOM 或者尾逗号
    raw = raw.lstrip("\ufeff")
    raw = re.sub(r",(\s*[}\]])", r"\1", raw)
    return json.loads(raw)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    root = Path(args.root)
    if not root.exists():
        print(__doc__)
        return 1

    jsons = sorted(root.rglob("*.json"))
    print(f"扫到 {len(jsons)} 个 json\n")

    # 槽名 -> 指向的贴图名（统计出现次数）
    slot_to_tex = defaultdict(Counter)
    shader_slots = defaultdict(set)
    # 材质名 -> 用到的槽（看哪些槽是必须的）
    all_slots = Counter()
    floats = defaultdict(Counter)
    colors = defaultdict(Counter)
    parsed = failed = 0
    rows = []

    for p in jsons:
        try:
            d = load(p)
        except Exception as e:
            failed += 1
            continue
        parsed += 1
        sp = d.get("m_SavedProperties", {}) or {}
        te = sp.get("m_TexEnvs", {}) or {}
        fl = sp.get("m_Floats", {}) or {}
        co = sp.get("m_Colors", {}) or {}
        # 样本里有的导出把这几项写成列表（老版 Unity），统一成字典再处理
        def as_dict(x):
            if isinstance(x, dict):
                return x
            if isinstance(x, list):
                out = {}
                for it in x:
                    if isinstance(it, dict) and "first" in it:
                        out[str(it["first"])] = it.get("second")
                return out
            return {}

        te, fl, co = as_dict(te), as_dict(fl), as_dict(co)
        # 用文件名前缀当"shader 族"（MAT_Claret_Body_1_UI → Body）
        base = p.stem
        fam = "?"
        for k in ("Body", "Hair", "Face", "Eye", "Weapon", "Cloth", "Skin", "Wing",
                  "Tail", "Head", "Brow", "Effect", "Prop", "HairR", "Ear"):
            if k.lower() in base.lower():
                fam = k
                break
        if fam == "?":
            m = re.search(r"_(Body|Hair|Face|Eye|Weapon|Cloth|Skin|Wing|Tail|Brow|Ear)[\d_]",
                          base, re.I)
            fam = m.group(1).title() if m else "other"

        for slot, ent in te.items():
            tex = ((ent or {}).get("m_Texture") or {}).get("Name", "") or ""
            if tex:
                slot_to_tex[slot][tex] += 1
            shader_slots[fam].add(slot)
        all_slots.update(te.keys())
        for k, v in fl.items():
            floats[k][round(float(v), 3)] += 1
        for k, v in co.items():
            if isinstance(v, dict):
                colors[k][tuple(round(float(v.get(x, 0)), 2) for x in "rgba")] += 1

        rows.append((str(p.relative_to(root)), fam, len(te), len(fl), len(co)))

    print("=" * 80)
    print("一、贴图槽 → 实际指向的贴图（这张表就是正确命名的依据）")
    print("=" * 80)
    for slot, ctr in sorted(slot_to_tex.items(), key=lambda kv: -sum(kv[1].values())):
        total = sum(ctr.values())
        tops = ctr.most_common(4)
        print(f"\n  {slot:<28} 出现 {total:>4} 次")
        for name, n in tops:
            # 贴图名末尾那一段（_N / _D / _LM / LightMap）就是它到底是什么
            tail = re.split(r"[_\s]+", name)[-1]
            print(f"      → {name[:56]:<56} ×{n:<3}  末尾段 {tail}")

    print()
    print("=" * 80)
    print("二、按材质族看用哪些槽（哪些是必须的，哪些可选）")
    print("=" * 80)
    for fam, slots in sorted(shader_slots.items()):
        print(f"  {fam:<10} {len(slots):>2} 个槽： {' '.join(sorted(slots))}")

    print()
    print("=" * 80)
    print("三、数值属性（反推中性值用）")
    print("=" * 80)
    for k, ctr in sorted(floats.items(), key=lambda kv: -sum(kv[1].values()))[:26]:
        tops = "  ".join(f"{v}({n})" for v, n in ctr.most_common(3))
        print(f"  {k:<34} {tops}")

    print()
    print("=" * 80)
    print("四、颜色属性")
    print("=" * 80)
    for k, ctr in sorted(colors.items(), key=lambda kv: -sum(kv[1].values()))[:20]:
        tops = "  ".join(f"{v}({n})" for v, n in ctr.most_common(2))
        print(f"  {k:<30} {tops}")

    print(f"\n解析成功 {parsed}，失败 {failed}")

    if args.out:
        out = defaultdict(dict)
        for slot, ctr in slot_to_tex.items():
            out["slots"][slot] = dict(ctr.most_common(12))
        out["families"] = {k: sorted(v) for k, v in shader_slots.items()}
        out["floats"] = {k: dict(v.most_common(6)) for k, v in floats.items()}
        Path(args.out).write_text(
            json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"已写出 {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
