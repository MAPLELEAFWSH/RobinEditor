/**
 * 从参考图取色做 CLUT。
 *
 * 这是 ikClut 原作者在公开 readme 里写的那条路的手工流程：
 *   1. 截一张调好色的图
 *   2. 把身份 CLUT（clut.png，1024×32）贴上去
 *   3. 对着参考图调色
 *   4. 把 CLUT 那块切下来存成新文件
 * 手工做很麻烦，而且要一张一张对。这里把它自动化：参考图进来之后，
 * **按亮度分带取色**，直接拼出一张 CLUT。
 *
 * 做法（按亮度分带的色调迁移）：
 *   · 把参考图按感知亮度分成 N 个带（N = 32，跟 CLUT 的蓝轴对齐）
 *   · 每个带取平均色 → 得到"这个亮度下参考图长这样"
 *   · 蓝轴每一层按层号往两端拉伸这条色带 → 铺成 1024×32
 *   · 强度滑块决定往原色拉回多少
 *
 * 为什么不逐像素采样：CLUT 是 32³ 的查找表，参考图里不可能覆盖全部
 * 32768 种输入色，只能从"亮度 → 颜色"这个统计关系去补。
 * 这不是精确的色彩还原，是给个起点，出来之后接着在曲线页调。
 */

import { lumaOf } from '$lib/img';
import type { Clut } from '$lib/img';
import { CLUT_SIZE } from './ops';

export type RefSampleOptions = {
  /** 分多少个亮度带。跟 CLUT 的蓝轴一致时最自然 */
  bands: number;
  /** 往原色拉回多少。1 = 完全用参考图的色调，0 = 完全不动 */
  strength: number;
  /** 忽略参考图里过暗和过亮的像素，避免黑边和白边把平均值带歪 */
  trim: number;
  /** 饱和度整体缩放。抄色调容易抄过头 */
  saturation: number;
};

export const DEFAULT_REF: RefSampleOptions = {
  bands: 32,
  strength: 0.85,
  trim: 0.02,
  saturation: 1
};

export type BandColor = { lo: number; hi: number; count: number; rgb: [number, number, number] };

/**
 * 按亮度分带求平均色。
 * trim 是每端丢掉的像素比例 —— 参考图常带纯黑背景和过曝高光，
 * 不丢的话最暗和最亮那两个带的平均色会被它们拉爆。
 */
export function sampleBands(src: ImageData, bands: number, trim: number): BandColor[] {
  const n = src.width * src.height;
  const luma = lumaOf(src);
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  // 按亮度排序拿分位点。n 大的时候全排序有点慢，但只在换参考图时跑一次
  const sorted = Array.from(idx).sort((a, b) => luma[a] - luma[b]);
  const cut = Math.floor(n * Math.min(0.2, Math.max(0, trim)));
  const from = cut;
  const to = n - cut;
  const span = Math.max(1, to - from);

  const out: BandColor[] = [];
  const d = src.data;
  for (let b = 0; b < bands; b++) {
    const i0 = from + Math.floor((span * b) / bands);
    const i1 = from + Math.floor((span * (b + 1)) / bands);
    let r = 0;
    let g = 0;
    let bl = 0;
    let c = 0;
    let l0 = 255;
    let l1 = 0;
    for (let k = i0; k < i1; k++) {
      const p = sorted[k] * 4;
      // 跳过全透明的像素
      if (d[p + 3] < 8) continue;
      r += d[p];
      g += d[p + 1];
      bl += d[p + 2];
      const l = luma[sorted[k]];
      if (l < l0) l0 = l;
      if (l > l1) l1 = l;
      c++;
    }
    out.push({
      lo: c ? l0 / 255 : 0,
      hi: c ? l1 / 255 : 0,
      count: c,
      rgb: c ? [r / c, g / c, bl / c] : [0, 0, 0]
    });
  }
  return out;
}

/** 按亮度在带之间线性插值取色，得到一条连续的 0-1 → RGB 曲线 */
export function bandLookup(bands: BandColor[], t: number): [number, number, number] {
  if (!bands.length) return [t * 255, t * 255, t * 255];
  const x = Math.min(1, Math.max(0, t)) * (bands.length - 1);
  const i = Math.min(bands.length - 2, Math.floor(x));
  const f = bands.length === 1 ? 0 : x - i;
  const a = bands[i].rgb;
  const b = bands[Math.min(bands.length - 1, i + 1)].rgb;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

function clamp255(v: number): number {
  const r = Math.round(v);
  return r < 0 ? 0 : r > 255 ? 255 : r;
}

/** 围绕亮度做饱和度缩放，免得抄来的色调过艳 */
function applySat(r: number, g: number, b: number, k: number): [number, number, number] {
  if (k === 1) return [r, g, b];
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [l + (r - l) * k, l + (g - l) * k, l + (b - l) * k];
}

/**
 * 用参考图的色调拼一张 CLUT。
 *
 * CLUT 的排法跟 `ops.ts` 里的一致：横向 32 个切片，切片内 x 是红、y 是绿。
 * 蓝轴按层号决定"这条色带往哪偏"—— 这里用最简单也最稳的做法：
 * 三层数据其实是同一条亮度曲线，蓝轴只在两端做一点冷热偏移，
 * 因为参考图给不出"蓝分量变化时该怎么变"这个信息。
 *
 * 这点要如实告诉用户：**参考图只能定色调，定不了立方体的全部三个轴**。
 */
export function clutFromReference(ref: ImageData, o: RefSampleOptions): Clut {
  const bands = sampleBands(ref, Math.max(2, Math.min(64, o.bands)), o.trim);
  const size = CLUT_SIZE;
  const data = new Uint8ClampedArray(size * size * size * 3);
  const k = Math.max(0, Math.min(1, o.strength));

  for (let bl = 0; bl < size; bl++) {
    const bt = bl / (size - 1);
    // 蓝轴两端给一点冷热偏移：低蓝偏暖、高蓝偏冷
    const lean = (bt - 0.5) * 2;
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const t = (r + g) / (2 * (size - 1));
        const srcR = r / (size - 1);
        const srcG = g / (size - 1);
        const srcB = bl / (size - 1);
        const [br, bg, bb] = bandLookup(bands, t);
        // 参考色按 (r,g) 这对输入色的自身亮度再校一次，不然整层会同一个色
        const inL = (srcR * 0.5 + srcG * 0.5) * 255;
        const outL = 0.2126 * br + 0.7152 * bg + 0.0722 * bb;
        const gain = outL > 4 ? inL / outL : 1;
        let rr = br * gain * (1 + lean * 0.02);
        let gg = bg * gain;
        let bbv = bb * gain * (1 - lean * 0.02);
        [rr, gg, bbv] = applySat(rr, gg, bbv, o.saturation);
        // 跟"什么都不做"按强度混。恒等那一侧就是输入色本身
        const idx = ((bl * size + g) * size + r) * 3;
        data[idx] = clamp255(rr * k + srcR * 255 * (1 - k));
        data[idx + 1] = clamp255(gg * k + srcG * 255 * (1 - k));
        data[idx + 2] = clamp255(bbv * k + srcB * 255 * (1 - k));
      }
    }
  }
  return { size, data };
}
