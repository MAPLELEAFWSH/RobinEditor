/**
 * msToon 四张控制图要用的运算。
 *
 * 分两件事，别混：
 *
 * · **通道是干什么用的 —— 有出处。** 作者自己的 `*_common.fxsub` 里写着，
 *   带行号的整理见下面 `MSTOON_CONVENTION` 的注释。
 * · **怎么从一张贴图推出这几张 —— 没有出处。** 官方包里只有产物、没有源图，
 *   拿不到配对就推不出来。所以界面上每个参数都露出来，别指望默认值就是对的。
 *
 * 能自证的部分只有两处：
 *   · ladder → 直方图匹配是标准算法，实现对不对可以拿分布去验
 *   · 边界 → 距离场走的是 img.ts 的 distanceField，那个有单测
 */

import {
  type ChannelKey,
  CHANNEL_KEYS,
  blankImageData,
  distanceField,
  extractChannel,
  grayToImageData,
  lumaOf,
  pack,
  sobel,
  autoRange,
  threshold
} from '$lib/img';
/* 三条验过配对的映射只有 ⑦ 那一份。这里引它，不打算再抄一遍 */
import { type ChanPlan4, type GamePreset, getGame, applyPlan } from '$lib/modules/channels/ops';
/* 距离场与各游戏的排法也各只有一份（`$lib/sdf.ts`，⑤ 用的是同一份） */
import { boundaryOf, encodeSdf, signedDistanceField, type SdfEncoding } from '$lib/sdf';

/** ladder 的一档：这个值要占多少比例的像素 */
export type Rung = { v: number; share: number };

export type Ladder = {
  /** 没被任何档位分走的像素用这个值 */
  def: number;
  rungs: Rung[];
};

/**
 * 直方图匹配。
 *
 * ladder 说的是"这个值占多少比例的像素"（星铁的规格探测就是用这句话量的：
 * `档位 0.00:16% 0.40:74%`）。所以生成一张符合这个分布的图，
 * 本质上是把源通道的分布**重映射**到目标分布上 —— 标准的直方图规定化。
 *
 * 做法：把目标分布离散成 256 格的直方图 → 求它的累积 → 按累积把源的每个值
 * 映到目标里对应的那一格。这样源的排序关系保住了（暗的还是暗的），
 * 但每个值的占比被拉到 ladder 说的样子。
 *
 * 源是空的（比如这一路选了常量）就直接按 ladder 铺。
 */
export function histMatch(src: Uint8ClampedArray, ladder: Ladder): Uint8ClampedArray {
  const n = src.length;
  const out = new Uint8ClampedArray(n);

  // 目标直方图。份额按 0-1 给，超出 1 的部分忽略，不足 1 的补给 def
  const target = new Float64Array(256);
  let used = 0;
  for (const r of ladder.rungs) {
    const v = clampByte(r.v * 255);
    const share = Math.max(0, r.share);
    target[v] += share;
    used += share;
  }
  const rest = Math.max(0, 1 - used);
  target[clampByte(ladder.def * 255)] += rest;

  // 目标累积分布
  const cdf = new Float64Array(256);
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += target[i];
    cdf[i] = acc;
  }
  if (acc <= 0) {
    out.fill(clampByte(ladder.def * 255));
    return out;
  }
  for (let i = 0; i < 256; i++) cdf[i] /= acc;

  // 反查表：目标 CDF 的每个刻度对应哪个值
  const lut = new Uint8ClampedArray(256);
  let k = 0;
  for (let i = 0; i < 256; i++) {
    while (k < 255 && cdf[k] < (i + 0.5) / 256) k++;
    lut[i] = k;
  }

  // 源累积分布 → 查表
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[src[i]]++;
  const scdf = new Float64Array(256);
  let sacc = 0;
  for (let i = 0; i < 256; i++) {
    sacc += hist[i];
    scdf[i] = n ? sacc / n : 0;
  }
  const smap = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const p = Math.min(255, Math.max(0, Math.round(scdf[i] * 255)));
    smap[i] = lut[p];
  }

  for (let i = 0; i < n; i++) out[i] = smap[src[i]];
  return out;
}

function clampByte(v: number): number {
  const i = Math.round(v);
  return i < 0 ? 0 : i > 255 ? 255 : i;
}

/** 按 0-1 的上下限拉伸，用 img.ts 的 autoRange 自动找，也可以手填 */
export function stretch(
  src: Uint8ClampedArray,
  mode: 'none' | 'auto' | 'manual',
  lo: number,
  hi: number
): Uint8ClampedArray {
  if (mode === 'none') return src;
  let a = lo;
  let b = hi;
  if (mode === 'auto') {
    const r = autoRange(src);
    a = r.lo;
    b = r.hi;
  }
  const out = new Uint8ClampedArray(src.length);
  const span = Math.max(1, b - a);
  for (let i = 0; i < src.length; i++) {
    out[i] = ((src[i] - a) / span) * 255;
  }
  return out;
}

/** 3×3 均值模糊。Sobel 之前压一下噪点，不然描边全是麻点 */
export function blur3(ch: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          s += ch[ny * w + nx];
          c++;
        }
      }
      out[y * w + x] = s / c;
    }
  }
  return out;
}

/**
 * 梯度 → 描边强度。
 * soft=false 就是硬阈值切；soft=true 按阈值附近一段线性过渡。
 */
export function edgeStrength(
  grad: Uint8ClampedArray,
  t: number,
  soft: boolean,
  softWidth = 40
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(grad.length);
  if (!soft) {
    for (let i = 0; i < grad.length; i++) out[i] = grad[i] > t ? 255 : 0;
    return out;
  }
  const a = t - softWidth / 2;
  const b = t + softWidth / 2;
  for (let i = 0; i < grad.length; i++) {
    const v = grad[i];
    out[i] = v <= a ? 0 : v >= b ? 255 : ((v - a) / (b - a)) * 255;
  }
  return out;
}

/** 走一遍 sobel 的完整流程，界面上的"降噪 / 归一化"开关都在这儿 */
export function gradientOf(
  luma: Uint8ClampedArray,
  w: number,
  h: number,
  opts: { denoise: boolean; normalize: boolean }
): Uint8ClampedArray {
  let src = luma;
  if (opts.denoise) src = blur3(src, w, h);
  if (opts.normalize) src = stretch(src, 'auto', 0, 255);
  return sobel(src, w, h);
}

export { threshold, distanceField, blankImageData };

/**
 * 输出吸附到 0.05 的整数倍。
 *
 * 游戏里的 lightmap / SDF / 控制图基本都是吸附过的 —— `tools/probe_maps.py`
 * 里「0.05 网格上」那个比例就是量这个的，实测值：
 *   msToon Lumine Clothes Lightmap   G 97.2%  B 99.8%  A 81.0%
 *   msToon ZZZ_Converted_Body        G 99.6%
 *   msToon Avatar_Tex_Face_Shadow    R/G 99.3%  A 96.4%
 *   原神 Avatar_Girl_Tex_FaceSDF     R 75.0%  A 77.0%
 * 原神那张不是 100%，说明它中间还做过别的处理，不是纯吸附出来的。
 *
 * 0.05 × 255 = 12.75 落不到整数上，所以存成 8 位之后字节值一定有几个偏差。
 * 这是 8 位存储的固有限制，不是实现问题。
 */
export function snapToGrid(src: ImageData, step = 0.05): ImageData {
  const out = new ImageData(src.width, src.height);
  const s = src.data;
  const d = out.data;
  for (let i = 0; i < src.width * src.height * 4; i++) {
    d[i] = Math.round((Math.round(s[i] / 255 / step) * step) * 255);
  }
  return out;
}

/** 量一张图有多大比例的像素落在 0.05 网格上，界面拿来跟实测数字对照 */
export function onGridRatio(ch: Uint8ClampedArray, step = 0.05): number {
  let hit = 0;
  for (let i = 0; i < ch.length; i++) {
    const v = ch[i] / 255 / step;
    if (Math.abs(v - Math.round(v)) < 0.08) hit++;
  }
  return hit / ch.length;
}

/**
 * msToon 的通道约定。
 *
 * 两路来源，都是真的，别混：
 *
 * **一、通道干什么用 —— 作者自己的 shader，带行号。**
 *
 * 读的是 `D:\9.26mmd\mme\mstoon` 官方 ver1.1（ましまし）里那三个 `*_common.fxsub`。
 * 它们是 そぼろ「基礎エフェクトセット」的派生，`Color` 不是最终颜色，
 * 是「受光 / 高光 / 阴影」三层权重 —— 靠三档强制模式能反推出来：
 *
 *     BE_SHADOW    Color.rgb = 0.0;                  → 阴影 = (0,0,0)
 *     BE_BASE      Color.rb = 1.0; Color.g = 0.0;    → Base = (1,0,1)
 *     BE_HIGHLIGHT Color.rgb = 1.0;                  → 高光 = (1,1,1)
 *
 * 所以 R 和 B 是「受光程度」、G 是「高光程度」。代进各效果里：
 *
 *   ShadowRate    Shade_common.fxsub:438-441
 *                 Color.b *= (1.0 - ShadowRate.b)   → B 高 = 压成阴影
 *                 Color.r += ShadowRate.r           → R 高 = 强制 Base
 *                 Color.g += ShadowRate.g           → G 高 = 强制高光
 *   SubLightRate  SubLight_common.fxsub:454-455
 *                 Color.rgb += SublightRate         → 三路直接加权重
 *                 （配 437-450 三档强制 r=1,g=0,b=0 / r=0,g=1,b=0 / b=1,rg=0）
 *   EdgeRate      Edge_common.fxsub:118-119
 *                 float3 EdgeRate = …rgb;  Color.r *= (1.0 - EdgeRate.r)
 *                 → **只读 R**。G 没用 —— readme 更新履历里作者自己承认过
 *                 （「実際はGチャンネルは何も使っていません」），代码对得上。
 *
 * 所以 ④ 界面上那三句「R 基础 / G 高光 / B 阴影」「R 副光1 / G 副光2 / B 取消」
 * 「R 描边强度」有出处，不是推的。
 *
 * 注意一条：有篇流传较广的中文教程写「ShadowRate 的 B 越接近 0.0 越强制阴影」，
 * 跟这里的 `Color.b *= (1.0 - B)` **反着**。以 shader 为准。
 *
 * **二、作者没留下"怎么从贴图推出这几张"的算法。** 这条没有出处 ——
 * 官方包里只有产物，没有源图（`character\` 那几张也都是单通道控制图），
 * 拿不到配对，所以推不出来。参数全开在界面上就是这个原因。
 *
 * 四张控制图的实测形态（`tools/probe_maps.py` 量的）：
 *
 *   Shade\GI_Converted_Body_Lightmap.png  2048²
 *     R 恒定 0.00（没用）    G 主数据 230 个值，26.8% 在网格上
 *     B 次要 70 个值，77.6% 在网格上      A 恒定 1.00
 *   Shade\Lumine Clothes Lightmap.png     2048²
 *     R 恒定 0.00    G 主数据（54.9% 落 0.50 / 41.2% 落 0.00）
 *     B 基本为 0     A 有 239 个值、81% 在网格上、78% 落 0.45 → 分层
 *   Shade\Avatar_Tex_Face_Shadow.png      512²
 *     R 和 G 几乎一样（都 72% 落 1.00、26% 落 0.00）→ 同一张二值遮罩铺两路
 *     B ≈ 1     A 分档：79.6% 落 0.00、14.5% 落 0.50 → 脸部阴影的过渡带
 *   Shade\GI_Converted_Face_SDF.png       256²
 *     R 89.9% 落 0.50，另有一条约 0.90 的界线      G/B = 0，A = 1
 *
 * 一句话总结形态：**R/G/B 一通道一件事、A 放分层或过渡带、值普遍吸附网格**。
 */
export const MSTOON_CONVENTION = {
  note:
    '通道用法的出处是作者自己的 *_common.fxsub（带行号，见 ops.ts 的注释）；'
    + '"怎么从贴图推出这几张"没有出处，参数全开。',
  measured: [
    'GI_Converted_Body_Lightmap 2048²：R 恒 0.00，G 主数据，B 次要，A 恒 1.00',
    'Lumine Clothes Lightmap 2048²：G 主数据（54.9% 落 0.50），A 分层（78% 落 0.45）',
    'Avatar_Tex_Face_Shadow 512²：R/G 同一张二值遮罩，A 是分档过渡带',
    'GI_Converted_Face_SDF 256²：R 89.9% 落 0.50，另有一条 0.90 的界线'
  ]
} as const;

/** 星铁那四套 ladder，抄自 贴图样本\honkaiSR\_验证\星铁预设.json */
export const LADDER_PRESETS: { id: string; name: string; per: Record<'R' | 'G' | 'B' | 'A', Ladder> }[] = [
  {
    id: 'sr-body',
    name: '星铁 身体',
    per: {
      R: { def: 1.0, rungs: [{ v: 0.85, share: 0.078 }, { v: 0.0, share: 0.126 }] },
      G: { def: 0.4, rungs: [{ v: 0.0, share: 0.205 }] },
      B: { def: 0.0, rungs: [{ v: 0.65, share: 0.048 }] },
      A: { def: 0.0, rungs: [{ v: 0.55, share: 0.178 }, { v: 0.45, share: 0.207 }] }
    }
  },
  {
    id: 'sr-hair',
    name: '星铁 头发',
    per: {
      R: { def: 1.0, rungs: [{ v: 0.85, share: 0.125 }] },
      G: { def: 0.4, rungs: [{ v: 0.0, share: 0.135 }] },
      B: { def: 0.0, rungs: [{ v: 0.65, share: 0.049 }, { v: 0.45, share: 0.027 }] },
      A: {
        def: 0.0,
        rungs: [
          { v: 0.95, share: 0.095 },
          { v: 0.55, share: 0.222 },
          { v: 0.45, share: 0.230 },
          { v: 0.3, share: 0.041 },
          { v: 0.2, share: 0.024 }
        ]
      }
    }
  },
  {
    id: 'sr-shawl',
    name: '星铁 披风',
    per: {
      R: { def: 1.0, rungs: [{ v: 0.85, share: 0.068 }, { v: 0.0, share: 0.131 }] },
      G: { def: 0.4, rungs: [{ v: 0.0, share: 0.197 }] },
      B: { def: 0.0, rungs: [{ v: 0.65, share: 0.047 }] },
      A: {
        def: 0.0,
        rungs: [
          { v: 0.95, share: 0.095 },
          { v: 0.55, share: 0.144 },
          { v: 0.45, share: 0.092 },
          { v: 0.3, share: 0.024 }
        ]
      }
    }
  },
  {
    id: 'sr-weapon',
    name: '星铁 武器',
    per: {
      R: { def: 1.0, rungs: [{ v: 0.85, share: 0.106 }, { v: 0.0, share: 0.134 }] },
      G: { def: 0.4, rungs: [{ v: 0.0, share: 0.240 }] },
      B: { def: 0.0, rungs: [{ v: 0.45, share: 0.026 }] },
      A: {
        def: 0.0,
        rungs: [
          { v: 0.95, share: 0.095 },
          { v: 0.55, share: 0.122 },
          { v: 0.45, share: 0.161 },
          { v: 0.3, share: 0.041 },
          { v: 0.2, share: 0.024 }
        ]
      }
    }
  }
];

/* ============================================================
   四张控制图的组装。
   ------------------------------------------------------------
   这几段原来在 Mstoon.svelte 里，`buildFrom` 和两个 `build*` 都算载荷
   —— 于是"预览显示的"和"导出写的"是两份手抄的映射（复查 B6），
   而且想离线出图只能另写一份复现。搬过来之后组件只做状态和画界面。
   ============================================================ */

/** 通道怎么给：取源图的某一路、按 ladder 铺、还是常量 */
export type ChMode = 'source' | 'ladder' | 'const';

export type ChSpec = {
  mode: ChMode;
  ch: ChannelKey;
  invert: boolean;
  stretchMode: 'none' | 'auto' | 'manual';
  lo: number;
  hi: number;
  ladder: Ladder;
};

export function blankChain(def: number): ChSpec {
  return {
    mode: 'ladder',
    ch: 'r',
    invert: false,
    stretchMode: 'none',
    lo: 0,
    hi: 255,
    ladder: { def, rungs: [] }
  };
}

/**
 * ShadowRate / SubLightRate：四个通道各按自己的规格算出来，再拼成一张 RGBA。
 *
 * `src` 传进来之前该缩的已经缩过（预览用 `previewOf`，导出用原图）。
 */
export function buildControlMaps(
  src: ImageData,
  spec: Record<ChannelKey, ChSpec>,
  snap = true
): ImageData {
  const w = src.width;
  const h = src.height;
  const chans: Record<ChannelKey, Uint8ClampedArray> = {} as never;

  for (const k of CHANNEL_KEYS) {
    const s = spec[k];
    if (s.mode === 'const') {
      const arr = new Uint8ClampedArray(w * h);
      arr.fill(Math.round(s.ladder.def * 255));
      chans[k] = arr;
      continue;
    }
    // 取哪一路：ladder 模式下固定用源图的对应通道当"排序依据"
    const from = s.mode === 'source' ? s.ch : k;
    let arr = extractChannel(src, from, s.invert);
    arr = stretch(arr, s.stretchMode, s.lo, s.hi);
    if (s.mode === 'ladder') arr = histMatch(arr, s.ladder);
    chans[k] = arr;
  }

  const planes = new Map<string, ImageData>();
  for (const k of CHANNEL_KEYS) planes.set(`p_${k}`, grayToImageData(chans[k], w, h));
  const map = {
    r: { slot: 'p_r', ch: 'r' as ChannelKey, constant: 0, invert: false },
    g: { slot: 'p_g', ch: 'r' as ChannelKey, constant: 0, invert: false },
    b: { slot: 'p_b', ch: 'r' as ChannelKey, constant: 0, invert: false },
    a: { slot: 'p_a', ch: 'r' as ChannelKey, constant: 255, invert: false }
  };
  const out = pack(w, h, map, planes);
  // 真包里的控制图基本都是吸附过 0.05 的（实测见上面的注释）
  return snap ? snapToGrid(out) : out;
}

export type EdgeOpts = {
  threshold: number;
  soft: boolean;
  softWidth: number;
  denoise: boolean;
  normalize: boolean;
  /** 把强度也铺到 G / B —— 官方 ver1.1 说 G 没用，这个是给别的框架留的 */
  toGB: boolean;
};

/**
 * EdgeRate：亮度 →（降噪 / 归一）→ Sobel → 阈值或软过渡。
 *
 * 强度平面单独返回：界面要拿它叠一张半透明红的对照图。
 */
export function buildEdge(
  src: ImageData,
  o: EdgeOpts
): { out: ImageData; strength: Uint8ClampedArray } {
  const grad = gradientOf(lumaOf(src), src.width, src.height, {
    denoise: o.denoise,
    normalize: o.normalize
  });
  const strength = edgeStrength(grad, o.threshold, o.soft, o.softWidth);
  const planes = new Map<string, ImageData>([
    ['e', grayToImageData(strength, src.width, src.height)],
    ['base', src]
  ]);
  const on = { slot: 'e', ch: 'r' as ChannelKey, constant: 0, invert: false };
  const off = (ch: ChannelKey) => ({ slot: '', ch, constant: 0, invert: false });
  const map = {
    r: on,
    g: o.toGB ? on : off('g'),
    b: o.toGB ? on : off('b'),
    a: o.toGB
      ? { slot: '', ch: 'a' as ChannelKey, constant: 255, invert: false }
      : { slot: 'base', ch: 'a' as ChannelKey, constant: 255, invert: false }
  };
  return { out: pack(src.width, src.height, map, planes), strength };
}

export type SdfOpts = {
  threshold: number;
  maxDist: number;
  invert: boolean;
  toA: boolean;
};

/**
 * FaceSDF「切交界线 → 距离场」这条路的**唯一实现**（预览和导出都调它）。
 *
 * 排法按游戏走，三套都是量出来的（`tools/sdf-spec.py`，规格目录 17 张）：
 * 原神四通道同一个场、星铁 R 三档 G 两档 B 空 A 场、绝区零 R 场 G 恒 0.5 A 满。
 * 星铁那片 0.5 算法推不出来，从外面传（`mark`）。
 *
 * 为什么把预览和导出并成一个函数：原来组件里预览走 `buildSdf`、导出走另一条，
 * 两份容易越改越不一样（`ops.ts` 的模块头注释就是为修这一类写的）。
 */
export function buildSdfEncoded(
  src: ImageData,
  o: SdfOpts & { game: SdfEncoding; mark?: ImageData | null }
): { out: ImageData; mask: Uint8ClampedArray; field: Uint8ClampedArray } {
  const opts = { threshold: o.threshold, invert: o.invert, maxDist: o.maxDist, snap: false, hardLine: true };
  const luma = lumaOf(src);
  const boundary = boundaryOf(luma, src.width, src.height, opts);
  const { signed, mask } = signedDistanceField(luma, src.width, src.height, opts);
  const mk = o.mark ? extractChannel(o.mark, 'r', false) : null;
  const out = encodeSdf(src.width, src.height, signed, mask, boundary, o.game, {
    lineValue: 0.9,
    baseValue: 0.5,
    mark: mk
  });
  return { out, mask, field: signed };
}

/**
 * FaceSDF 的另一条路：**直接取源图的某个通道**（可反相），不做距离场。
 *
 * 这两个游戏走的都是这条 —— 见 `docs/产物配对实测.md`，
 * 都是拿真配对逐像素对出来的：
 *
 *   原神  取脸部 lightmap 的 **G**，直接铺（`GI_Converted_Face_SDF_G_Channel.png`
 *         跟 `SDF.R` 逐像素相同）
 *   星铁  取脸部图的 **A**，**反相**（`HSR_Converted_Face_SDF.R = 255 − A`，逐像素验过）
 *
 * 上面那条「阈值切交界线 → 距离场」的路留着（⑤ 那边的 SDF 就吃这一套），
 * 但**别把它当成 msToon 的做法** —— 这两个游戏都不做距离场。
 *
 * **形状是量出来的**：那两张 SDF 产物都是 **R 放数据、G 和 B 恒 0、A 恒 1**。
 * （第一版我把通道铺满四路，拿真配对一比只有 R 对得上，G/B/A 全差 —— 已改。）
 */
export function buildSdfFromChannel(
  src: ImageData,
  o: { ch: ChannelKey; invert: boolean }
): ImageData {
  const plane = extractChannel(src, o.ch, o.invert);
  const planes = new Map<string, ImageData>([['f', grayToImageData(plane, src.width, src.height)]]);
  const map = {
    r: { slot: 'f', ch: 'r' as ChannelKey, constant: 0, invert: false },
    g: { slot: '', ch: 'g' as ChannelKey, constant: 0, invert: false },
    b: { slot: '', ch: 'b' as ChannelKey, constant: 0, invert: false },
    a: { slot: '', ch: 'a' as ChannelKey, constant: 255, invert: false }
  };
  return pack(src.width, src.height, map, planes);
}

/**
 * 把某一路单独导成灰度图。
 *
 * 素材里会额外带这么一份灰度文件（原神那份叫 `…_G_Channel.png`，星铁叫 `…_A_Channel.png`，
 * 都是 L 模式、三路同值）—— 名字里的字母就是**它取的是源图哪一路**。
 * 它是给人拿去核对的，不是拿来用的，所以单独一个函数。
 */
export function channelGray(src: ImageData, ch: ChannelKey, invert = false): ImageData {
  return grayToImageData(extractChannel(src, ch, invert), src.width, src.height);
}

/* ================================================================
   lightmap → msToon 控制图
   ----------------------------------------------------------------
   映射**不在这儿写第二遍**：三条模板在 ⑦ 的 `GAMES` 里，是拿同一目录的
   「输入 → 产物」配对逐像素验过的。这里只做两件事 —— 把模板指出来、
   把源图递进去。写第二份就会跟 ⑦ 分叉，那种错在界面上看不出来。

   产物形状：R 恒 0、A 恒 1，G 取源 lightmap 的 B，B 取源 G 反相后过窗口。
   ================================================================ */

export type MstoonPreset = {
  id: string;
  /** ⑦ `GAMES` 里那条模板 */
  gameId: string;
  name: string;
  /** 这一档要丢什么进去。绝区零吃的是 `_M`，不是 lightmap */
  srcLabel: string;
  srcHint: string;
  /** G 那一路从源图的哪个通道搬 */
  gFrom: ChannelKey;
};

export const MSTOON_PRESETS: MstoonPreset[] = [
  {
    id: 'gi',
    gameId: 'mstoon-gi',
    name: '原神',
    srcLabel: 'Body / Hair Lightmap',
    srcHint: '原神那套 lightmap',
    gFrom: 'b'
  },
  {
    id: 'hsr',
    gameId: 'mstoon-hsr',
    name: '星铁',
    srcLabel: 'Body / Hair LightMap',
    srcHint: '星铁那套 lightmap',
    gFrom: 'b'
  },
  {
    id: 'zzz',
    gameId: 'mstoon-zzz',
    name: '绝区零',
    srcLabel: '_M（金属度 / 阴影图）',
    srcHint: '这一档要的是 _M，不是 lightmap',
    gFrom: 'g'
  }
];

export function findPreset(id: string): MstoonPreset {
  return MSTOON_PRESETS.find((p) => p.id === id) ?? MSTOON_PRESETS[0];
}

/** 星铁那个 B 窗口：身体和头发量出来不一样，两个都是实测值 */
export const HSR_WINDOWS: { id: string; label: string; hi: number; note: string }[] = [
  { id: 'body', label: '身体', hi: 255 / 3.5, note: '255 / 3.5 ≈ 72.857，斜率正好 3.5' },
  { id: 'hair', label: '头发', hi: 85, note: '单独量的，hair 比 body 收得窄' }
];

const eq = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/**
 * 改模板里那条通道的窗口。
 *
 * 只认「按窗口归一化后反相」那种形状 —— 不是这个形状就不动它，
 * 免得把别的规则改坏。绝区零那条 B 恒 0，本来就没有窗口。
 */
export function withWindow(plan: ChanPlan4, hi: number, ch: ChannelKey = 'b'): ChanPlan4 {
  const cur = plan[ch];
  if (cur.stretch !== 'manual' || !cur.invert) return plan;
  if (eq(cur.lo, 255 - hi) && eq(cur.hi, 255)) return plan;
  return { ...plan, [ch]: { ...cur, lo: 255 - hi, hi: 255 } };
}

/** 按预设出控制图。源图尺寸就是产物尺寸 */
export function buildFromLightmap(
  src: ImageData,
  presetId: string,
  opt: { windowHi?: number } = {}
): { out: ImageData; preset: MstoonPreset; gameDef: GamePreset; plan: ChanPlan4 } {
  const preset = findPreset(presetId);
  const game = getGame(preset.gameId);
  let plan = game.plan;
  if (opt.windowHi !== undefined) plan = withWindow(plan, opt.windowHi);

  const sources = new Map<string, ImageData>();
  for (const s of game.slots) sources.set(s.id, src);

  return { out: applyPlan(src.width, src.height, plan, sources), preset, gameDef: game, plan };
}

