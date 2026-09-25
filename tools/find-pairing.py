"""在素材目录里找配对：产物的每个通道是不是来自某张源图的某个通道。

判据跟 ⑤ 那轮一样：**先要 bit-exact**，对不上再看平均差（走重采样/重映射的通道
永远到不了 100%，只看比例会误判成"没对上"）。

用法：python tools/find-pairing.py <分组目录>
      python tools/find-pairing.py "E:\\...\\MSToon\\绝区零\\Vivian"
"""
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PRODUCT = re.compile(r'^(GI|HSR|ZZZ)_Converted_', re.I)
CH = 'RGBA'


def load(p):
    im = Image.open(p)
    return np.asarray(im.convert('RGBA')).astype(np.int16), im.mode


def stat(a):
    u = np.unique(a)
    return f'唯一值 {len(u):>4}  均值 {a.mean()/255:.3f}  恒定={"是" if len(u)==1 else "否"}'


def main():
    d = Path(sys.argv[1])
    files = sorted(p for p in d.iterdir() if p.suffix.lower() == '.png')
    prods = [p for p in files if PRODUCT.match(p.name)]
    srcs = [p for p in files if not PRODUCT.match(p.name)]

    print(f'分组 {d.name}   共 {len(files)} 张：产物 {len(prods)}，源图 {len(srcs)}')
    print(f'  产物：{", ".join(p.name for p in prods)}')
    print(f'  源图：{", ".join(p.name for p in srcs)}')

    cache = {}
    for p in files:
        try:
            cache[p.name] = load(p)
        except Exception as e:
            print(f'  读不了 {p.name}: {e}')
    print()
    print('=== 产物形态 ===')
    for p in prods:
        a, mode = cache[p.name]
        print(f'  {p.name}  {a.shape[1]}×{a.shape[0]}  {mode}')
        for i, c in enumerate(CH):
            print(f'    {c}: {stat(a[:, :, i])}')

    print()
    print('=== 逐通道找源 ===')
    print('  候选 = 所有别的图（含产物）的四个通道，先按原尺寸比；尺寸不同就双线性缩过去再比。')
    print('  判据：逐像素相同 > 平均差小。平均差 < 1 就算对上了（重采样到不了 100%）。')
    for p in prods:
        pa, _ = cache[p.name]
        ph, pw = pa.shape[:2]
        print(f'\n  【{p.name}】{pw}×{ph}')
        for i, c in enumerate(CH):
            plane = pa[:, :, i]
            if len(np.unique(plane)) == 1:
                print(f'    {c}: 恒定 {plane[0,0]/255:.2f} —— 不用找')
                continue
            cands = []
            for s in files:
                if s.name == p.name:
                    continue
                sa, _ = cache[s.name]
                for j, sc in enumerate(CH):
                    sp = sa[:, :, j]
                    if len(np.unique(sp)) == 1:
                        continue
                    for how in ('原尺寸', '双线性'):
                        if sp.shape != plane.shape:
                            if how == '原尺寸':
                                continue
                            im = Image.fromarray(sp.astype(np.uint8)).resize((pw, ph), Image.BILINEAR)
                            sp2 = np.asarray(im).astype(np.int16)
                        else:
                            if how == '双线性':
                                continue
                            sp2 = sp
                        d = np.abs(sp2 - plane)
                        cands.append((float((d == 0).mean()), -float(d.mean()), s.name, sc, how, float(d.mean())))
            cands.sort(reverse=True)
            if not cands:
                print(f'    {c}: 没有可比的源')
                continue
            for rank, (exact, negmae, sname, sc, how, mae) in enumerate(cands[:2]):
                tag = '逐像素相同' if exact == 1 else f'相同 {exact*100:.2f}%'
                mark = '←' if rank == 0 else ' '
                print(f'    {c}: {mark} {sname} 的 {sc} [{how}]   {tag}  平均差 {mae:.4f}')


if __name__ == '__main__':
    main()
