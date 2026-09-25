/**
 * 带符号距离场（SDF）。
 *
 * 「SDF 贴图」在这个圈子里指的是：**一个通道里，0.5 表示正好落在交界线上，
 * 大于 0.5 是一侧，小于 0.5 是另一侧，离得越远越接近 0 或 1**。
 * 着色器拿它算脸部阴影的过渡，就不用在纹理里画出软边。
 *
 * 实测量到的两种编码（`tools/probe_maps.py` 量的真图）：
 *
 *   原神 Avatar_Girl_Tex_FaceSDF.png (1024²)
 *     R  256 个值，均值 0.454，标准差 0.451，37.6% 在 0.00 / 31.0% 在 1.00
 *        → 二值化的区域遮罩（哪半边脸）
 *     A  256 个值，均值 0.170，68.4% 在 0.00
 *        → 带符号距离，0.5 是界线
 *     G / B 基本是 0
 *
 *   msToon GI_Converted_Face_SDF.png (256²) —— 拿 `vivian` 那套真实配对复测过
 *     R  98.2% 落在 126~128（=0.494~0.502），亮部最高 230（=0.902）
 *        → 中性 0.5 打底，只把交界线挑出来。正好是 msToon 预设的 0.5 / 0.9
 *     G / B = 0，A = 255
 *     这张的 R 跟 Female_Face_Lightmap.png 的 G 逐像素完全相同（残差 0），
 *     在这个包里这两个名字指的是同一份数据。
 *
 * 一条绕不过去的反面结论：那张 SDF 的界线跟面部漫反射没关系。
 * Vivian_Face_D 降到 256² 之后，四个通道跟 SDF 的相关性都 ≤ 0.075
 * （跟 D.A 只有 +0.0014）。所以「从面部贴图切出交界线」推不出作者那张 ——
 * 那条线是画上去的，或者来自 UV / 几何，纹理里压根没这个信息。
 * 这个面板能生成一张结构合法的 SDF，但想跟原版对上，界线得自己给。
 *
 * 所以这里不写死任何一种，把「哪一侧是正」「扩散多远」「要不要吸附 0.05 网格」
 * 都做成参数，两种编码各给一个预设。
 */

import { distanceField } from './img';

export type SdfOptions = {
  /**
   * 阈值。源图里比它亮的算「内侧」。
   * 脸部贴图上一般把画出来的那条过渡线当交界，所以这个值决定线切在哪。
   */
  threshold: number;
  /** 比阈值亮算内侧还是外侧 */
  invert: boolean;
  /** 扩散范围（像素）。超出这个距离就饱和到 0 / 1 */
  maxDist: number;
  /** 输出吸附到 0.05 的整数倍。游戏里的 lightmap / SDF 基本都是吸附过的 */
  snap: boolean;
  /** 交界线用「硬切」还是「按亮度渐变」。硬切出来的线更干净 */
  hardLine: boolean;
};

export const DEFAULT_SDF: SdfOptions = {
  threshold: 110,
  invert: false,
  maxDist: 24,
  snap: true,
  hardLine: true
};

/**
 * 算带符号距离。
 *
 * 做法：把掩膜拆成「内」「外」两张，各自算一遍到另一侧的距离，
 * 然后按掩膜决定正负。两遍 chamfer，O(n)，2048² 也跑得动。
 *
 * 返回 0-255 的 Uint8ClampedArray，128 就是 0.5（交界线）。
 */
export function signedDistanceField(
  luma: Uint8ClampedArray,
  w: number,
  h: number,
  o: SdfOptions
): { signed: Uint8ClampedArray; mask: Uint8ClampedArray } {
  const n = w * h;
  const mask = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    const on = luma[i] > o.threshold;
    mask[i] = (o.invert ? !on : on) ? 255 : 0;
  }

  // 内侧到最近外侧的距离（内侧自身为 0）
  //
  // 两个坑，都踩过：
  //   1. distanceField(x) 的语义是「到最近的 x 为真的像素的距离」。
  //      要量内侧像素到外侧的距离，得传反相掩膜 —— 传 mask 拿到的是
  //      "到最近内侧的距离"，恒等于 0，整张图糊成 0.5。
  //   2. distanceField 出来的**已经是 0-255 归一化值**（255 = maxDist 像素），
  //      不是像素数。再按像素距离缩一次就是双重缩放，边界两侧会立刻饱和，
  //      整张图只剩 0 / 0.5 / 1 三个值。第一版就是这么错的。
  const inv = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) inv[i] = mask[i] ? 0 : 255;
  const toOutside = distanceField(inv, w, h, o.maxDist); // 内侧像素有效：到外侧多远（已归一化）
  const toInside = distanceField(mask, w, h, o.maxDist); // 外侧像素有效：到内侧多远（已归一化）

  const signed = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    // 内侧取正、外侧取负。归一化值直接当 -1..1 用，除以 510 就落到 ±0.5
    const dd = mask[i] ? toOutside[i] : -toInside[i];
    let v = 0.5 + dd / 510;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    if (o.snap) v = Math.round(v * 20) / 20; // 0.05 一档
    signed[i] = v * 255;
  }
  return { signed, mask };
}

/** 交界线本身（用来看阈值切得对不对） */
export function boundaryOf(luma: Uint8ClampedArray, w: number, h: number, o: SdfOptions) {
  const n = w * h;
  const out = new Uint8ClampedArray(n);
  if (o.hardLine) {
    for (let i = 0; i < n; i++) {
      const on = luma[i] > o.threshold;
      out[i] = (o.invert ? !on : on) ? 255 : 0;
    }
    return out;
  }
  // 软线：阈值附近一段线性过渡，用来喂给距离场之前先柔化
  const a = Math.max(0, o.threshold - 20);
  const b = Math.min(255, o.threshold + 20);
  for (let i = 0; i < n; i++) {
    const v = luma[i];
    const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
    out[i] = (o.invert ? 1 - t : t) * 255;
  }
  return out;
}

/* ---------------------------------------------------------------- 编码 */

export type SdfEncoding = 'genshin' | 'hsr' | 'zzz' | 'mstoon' | 'plain';

/**
 * 排法按**实测**来，三套游戏各一套（`tools/sdf-spec.py` 量的规格目录 17 张，
 * 在 `…\参考工具制作的效果\MSToon\原神\SDF规格\<游戏>\`）：
 *
 * | 游戏 | R | G | B | A |
 * | --- | --- | --- | --- | --- |
 * | 原神 | 场 | **与 R 逐像素相同** | 同 R | 同 R（四通道 100% 一致） |
 * | 星铁 | 三档 0/0.5/1（0.5 那片占 9%，是**独立区域不是边界带**） | 两档 0/1 | 全 0 | 场 |
 * | 绝区零 | 场 | **恒 0.5** | 全 0 | 满 |
 *
 * 星铁那片 0.5 是作者按脸部结构画的（`tools/sdf-band.py`：R≈0.5 落在 G 边界 ±2px 里的只有 1~3%），
 * 算法推不出来 —— 所以那一层**从外面传进来**（`mark`），面板上让人手标。
 */
export const ENCODINGS: { id: SdfEncoding; name: string; hint: string }[] = [
  {
    id: 'genshin',
    name: '原神式',
    hint: '四个通道放**同一个**灰度场（实测 5 张 FaceLightmap 四通道逐像素完全一致）'
  },
  {
    id: 'hsr',
    name: '星铁式',
    hint: 'R 三档（0/0.5/1）、G 两档、B 空、A 放场；那片 0.5 要你手标（实测 11 张 FaceMap）'
  },
  {
    id: 'zzz',
    name: '绝区零式',
    hint: 'R 放场、G 恒 0.5、B 空、A 拉满（实测 Female_Face_Lightmap）'
  },
  {
    id: 'mstoon',
    name: 'msToon 式',
    hint: '一张中性 0.5 打底的图，只把交界线挑到 0.90。实测那张 256²：98.2% 落在 0.494~0.502'
  },
  {
    id: 'plain',
    name: '纯距离场',
    hint: 'R/G/B 都放同一个带符号距离，A 拉满。想自己再排通道的话用这个'
  }
];

/**
 * 按编码方式把距离场排进 RGBA。
 *
 * signed 是算出来的 0-255（128 = 界线），mask 是二值掩膜，
 * boundary 是交界线本身（msToon 式要用它挑线），
 * `mark` 是"要标成中间那一档的地方"（只有星铁式用；给 null 就当没有）。
 */
export function encodeSdf(
  w: number,
  h: number,
  signed: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  boundary: Uint8ClampedArray,
  encoding: SdfEncoding,
  opts: { lineValue: number; baseValue: number; mark?: Uint8ClampedArray | null }
): ImageData {
  const out = new ImageData(w, h);
  const d = out.data;
  const n = w * h;
  const base = Math.round(opts.baseValue * 255);
  const line = Math.round(opts.lineValue * 255);
  const mark = opts.mark ?? null;

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (encoding === 'genshin') {
      /* 四个通道同一个场 */
      const v = signed[i];
      d[o] = v;
      d[o + 1] = v;
      d[o + 2] = v;
      d[o + 3] = v;
    } else if (encoding === 'hsr') {
      /* R 三档：标过的 0.5、掩膜内 1、其余 0；G 两档；B 空；A 放场 */
      d[o] = mark && mark[i] > 127 ? 128 : mask[i];
      d[o + 1] = mask[i];
      d[o + 2] = 0;
      d[o + 3] = signed[i];
    } else if (encoding === 'zzz') {
      /* R 放场、G 恒 0.5、B 空、A 拉满 */
      d[o] = signed[i];
      d[o + 1] = 128;
      d[o + 2] = 0;
      d[o + 3] = 255;
    } else if (encoding === 'mstoon') {
      // R 用中性值打底，只在交界线上把值挑高；G/B 空，A 拉满
      d[o] = boundary[i] > 127 ? line : base;
      d[o + 1] = 0;
      d[o + 2] = 0;
      d[o + 3] = 255;
    } else {
      // 纯距离场：R/G/B 同一份，A 拉满
      const v = signed[i];
      d[o] = v;
      d[o + 1] = v;
      d[o + 2] = v;
      d[o + 3] = 255;
    }
  }
  return out;
}

/** 单通道预览图：把某一个通道拎出来当灰度看 */
export function channelView(src: ImageData, ch: 'r' | 'g' | 'b' | 'a'): ImageData {
  const out = new ImageData(src.width, src.height);
  const s = src.data;
  const d = out.data;
  const off = ch === 'r' ? 0 : ch === 'g' ? 1 : ch === 'b' ? 2 : 3;
  for (let i = 0; i < src.width * src.height; i++) {
    const v = s[i * 4 + off];
    d[i * 4] = v;
    d[i * 4 + 1] = v;
    d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  return out;
}
