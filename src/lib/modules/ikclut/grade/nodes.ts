/**
 * 链上的三类节点。每个都是 `(ImageData, 参数) => ImageData` 的纯函数。
 *
 * 逐像素的算式不在这儿：基本与曲线都落到 `img.ts` 的 `applyGrade`（一份），
 * 亮度/第四条曲线落到 `applyLut`（也是一份）。这里只管"往那两份里填什么参数"。
 */
import { applyGrade, applyLut, bakeCurve, blankImageData, 绕灰轴, 字节值, type CurvePoint } from '$lib/img';
import { 采Lut } from './lut';
import { HSL段, 变形边, 色轮是恒等, Hsl是恒等, Log是恒等, 变形是恒等, 曲线是恒等, 基本是恒等 } from './types';
import { 三段权重, 亮度, 色相饱和, 色度方向, 段权重, 采格, 查正余弦 } from './color';
import type {
  BasicParams,
  CurveParams,
  HslParams,
  LogParams,
  LutParams,
  WarpParams,
  WheelsParams
} from './types';

/** 恒等曲线表：基本节点上那三条曲线必须是它（填了才叫"不经过曲线"） */
const 恒等表 = (() => {
  const t = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) t[i] = i;
  return t;
})();

/** 原样复制一份（不改输入是硬规矩：链上会有多个节点读同一张图） */
function 复制(src: ImageData): ImageData {
  const out = blankImageData(src.width, src.height);
  out.data.set(src.data);
  return out;
}

/* ------------------------------------------------------------ 基本 */

export function 跑基本(src: ImageData, p: BasicParams): ImageData {
  /* 全恒等就原样还回去：`applyGrade` 本来就是逐字节恒等的，但没必要白跑一遍 */
  if (基本是恒等(p)) return 复制(src);
  return applyGrade(src, {
    exposure: p.exposure,
    contrast: p.contrast,
    saturation: p.saturation,
    hue: p.hue,
    temperature: p.temperature,
    tint: p.tint,
    highlights: p.highlights,
    shadows: p.shadows,
    black: p.black,
    white: p.white,
    curveR: 恒等表,
    curveG: 恒等表,
    curveB: 恒等表
  });
}

/* ------------------------------------------------------------ 曲线 */

export function 跑曲线(src: ImageData, p: CurveParams): ImageData {
  let 出 = src;
  const 有RGB = !曲线是恒等(p.r) || !曲线是恒等(p.g) || !曲线是恒等(p.b);
  if (有RGB) {
    出 = applyGrade(出, {
      exposure: 1,
      contrast: 1,
      saturation: 1,
      hue: 0,
      curveR: 表(p.r, p.kind),
      curveG: 表(p.g, p.kind),
      curveB: 表(p.b, p.kind)
    });
  }

  /*
   * 亮度 / 第四条曲线挂在 `applyLut` 上（就是"按亮度比例缩放三条通道"那个规则）。
   *
   * 恒等的曲线**必须跳过**，不能"跑一遍也没关系"：`applyLut` 是按整数索引取表的，
   * 恒等表跑一遍也会有不到 0.5% 的偏差（l = 127.7 取到 127），逐字节恒等那条验收就没了。
   */
  if (!曲线是恒等(p.luma)) 出 = applyLut(出, 表(p.luma, p.kind), 'luma');
  if (!曲线是恒等(p.extra)) 出 = applyLut(出, 表(p.extra, p.kind), p.extraCh);
  return 出 === src ? 复制(src) : 出;
}

/** 曲线烘成 256 项查表。每条算一次就够，别每个像素都求值 */
function 表(pts: CurvePoint[], kind: CurveParams['kind']): Uint8ClampedArray {
  return bakeCurve(pts, kind);
}

/* ------------------------------------------------------------ LUT */

export function 跑Lut(src: ImageData, p: LutParams): ImageData {
  const lut = p.lut;
  const 强度 = p.strength;
  if (!lut || 强度 <= 0) return 复制(src);

  const out = blankImageData(src.width, src.height);
  const s = src.data;
  const d = out.data;
  const n = src.width * src.height;
  const px = { r: 0, g: 0, b: 0 };
  const 全用 = 强度 >= 1;

  for (let i = 0; i < n; i++) {
    const si = i * 4;
    采Lut(lut, s[si] / 255, s[si + 1] / 255, s[si + 2] / 255, px);
    if (全用) {
      d[si] = px.r;
      d[si + 1] = px.g;
      d[si + 2] = px.b;
    } else {
      /* 掺：按强度在"原色"和"表色"之间插。表色是 0~255 的浮点，直接插值 */
      d[si] = s[si] + (px.r - s[si]) * 强度;
      d[si + 1] = s[si + 1] + (px.g - s[si + 1]) * 强度;
      d[si + 2] = s[si + 2] + (px.b - s[si + 2]) * 强度;
    }
    d[si + 3] = s[si + 3];
  }
  return out;
}

/* ------------------------------------------------------------ 色轮 */

/** 色度能推多远：满强度下的位移量（0~1 单位）。0.5 大约等于"三条通道拉开 ±0.2" */
const 色轮量 = 0.5;

/** 该段整体明暗的满量程，比色度小一点，免得一动就死白/死黑 */
const 明暗量 = 0.35;

/**
 * 色轮：把某一个明暗段的**色度朝指定色相推**，外加这一段整体的明暗。
 *
 * 为什么是"推色度"而不是"转色相"：纯旋转对灰色没有作用（灰没有色度可转），
 * 而色轮在调色里就是"给这一段上色"—— 灰的地方也该被推上色。
 * 方向向量按色相算一次（`色度方向`），循环里只做乘加。
 */
export function 跑色轮(src: ImageData, p: WheelsParams): ImageData {
  if (色轮是恒等(p)) return 复制(src);
  const out = blankImageData(src.width, src.height);
  const s = src.data;
  const d = out.data;
  const n = src.width * src.height;
  const 权重: [number, number, number] = [0, 0, 0];
  const 向暗: [number, number, number] = [0, 0, 0];
  const 向中: [number, number, number] = [0, 0, 0];
  const 向高: [number, number, number] = [0, 0, 0];
  const 向全: [number, number, number] = [0, 0, 0];
  色度方向(p.暗.h, 向暗);
  色度方向(p.中.h, 向中);
  色度方向(p.高.h, 向高);
  色度方向(p.全局.h, 向全);
  const 强暗 = p.暗.s;
  const 强中 = p.中.s;
  const 强高 = p.高.s;
  const 强全 = p.全局.s;
  const 亮暗 = p.暗.l;
  const 亮中 = p.中.l;
  const 亮高 = p.高.l;
  const 亮全 = p.全局.l;
  const 偏R = p.偏移[0] * 0.25;
  const 偏G = p.偏移[1] * 0.25;
  const 偏B = p.偏移[2] * 0.25;

  for (let i = 0; i < n; i++) {
    const si = i * 4;
    const r = s[si] / 255;
    const g = s[si + 1] / 255;
    const b = s[si + 2] / 255;
    const L = 亮度(r, g, b);
    三段权重(L, 权重);

    /* 三段各推各的，全局那个不分段 —— 合成一个位移向量再一次加完 */
    const 暗 = 强暗 * 权重[0];
    const 中 = 强中 * 权重[1];
    const 高 = 强高 * 权重[2];
    const dr = (向暗[0] * 暗 + 向中[0] * 中 + 向高[0] * 高 + 向全[0] * 强全) * 色轮量;
    const dg = (向暗[1] * 暗 + 向中[1] * 中 + 向高[1] * 高 + 向全[1] * 强全) * 色轮量;
    const db = (向暗[2] * 暗 + 向中[2] * 中 + 向高[2] * 高 + 向全[2] * 强全) * 色轮量;

    /* 明暗加在三条通道上的**同一个量**：只动亮度，不动色相（跟 applyGrade 的高光阴影同一条规矩） */
    const add = (亮暗 * 权重[0] + 亮中 * 权重[1] + 亮高 * 权重[2] + 亮全) * 明暗量;

    d[si] = 字节值((r + dr + add + 偏R) * 255);
    d[si + 1] = 字节值((g + dg + add + 偏G) * 255);
    d[si + 2] = 字节值((b + db + add + 偏B) * 255);
    d[si + 3] = s[si + 3];
  }
  return out;
}

/* ------------------------------------------------------------ HSL */

/** 每段的基础半宽（度）。段中心相隔 45°，半宽 30° 时相邻两段在中点各占一半 */
const HSL半宽 = 30;

/** 饱和度与亮度的满量程变化（倍数偏离 1 的最大幅度用倍数直接给，这里只是兜底夹断用） */
const HSL最大倍数 = 3;

/**
 * 色相 → （角度, 饱, 亮）三张表，360 项（1° 一格）。
 *
 * 段权重只跟色相有关，所以能先烘出来 —— 不烘的话每个像素都要跑八段的
 * `段权重`（每段一次环距 + smoothstep），实测 1024×614 要 **144.7ms**，
 * 一帧预算 33ms 差四倍多。烘成表之后每像素只查三次表。
 */
function HSL色相表(p: HslParams): { 角: Float64Array; 饱: Float64Array; 亮: Float64Array } {
  const 角 = new Float64Array(360);
  const 饱 = new Float64Array(360);
  const 亮 = new Float64Array(360);
  const 半宽 = HSL半宽 * p.平滑;
  const 段数 = Math.min(p.bands.length, HSL段.length);
  for (let i = 0; i < 360; i++) {
    let 角和 = 0;
    let 饱积 = 0;
    let 亮积 = 0;
    let 权和 = 0;
    for (let k = 0; k < 段数; k++) {
      const w = 段权重(i, HSL段[k].中心, 半宽);
      if (w <= 0) continue;
      const bd = p.bands[k];
      角和 += w * bd.h;
      饱积 += w * bd.s;
      亮积 += w * bd.l;
      权和 += w;
    }
    if (权和 > 0) {
      角[i] = 角和 / 权和;
      饱[i] = 饱积 / 权和;
      亮[i] = 亮积 / 权和;
    } else {
      饱[i] = 1;
      亮[i] = 1;
    }
  }
  return { 角, 饱, 亮 };
}

/**
 * HSL：八个色相段各调 色相偏移 / 饱和倍数 / 亮度倍数，段与段之间平滑过渡。
 *
 * 权重**按和归一化**：平滑调大时一段的覆盖会压到邻居上，不归一化的话
 * 中间地带会被两个段各加一次，颜色一下就翻过去了。
 *
 * 色相那一步走 **1° 精度的表 + 线性插值**（见 `HSL色相表`）—— 精度上
 * 1° 的差别肉眼看不出来，代价却差十几倍。
 */
export function 跑Hsl(src: ImageData, p: HslParams): ImageData {
  if (Hsl是恒等(p)) return 复制(src);
  const out = blankImageData(src.width, src.height);
  const s = src.data;
  const d = out.data;
  const n = src.width * src.height;
  const 表 = HSL色相表(p);
  const 转出: [number, number, number] = [0, 0, 0];
  const 色 = [0, 0] as [number, number];
  const 余弦 = [0, 0] as [number, number];

  for (let i = 0; i < n; i++) {
    const si = i * 4;
    let r = s[si] / 255;
    let g = s[si + 1] / 255;
    let b = s[si + 2] / 255;
    色相饱和(r, g, b, 色);
    const H = 色[0];
    const i0 = Math.floor(H) % 360;
    const i1 = (i0 + 1) % 360;
    const f = H - Math.floor(H);
    const 角度 = 表.角[i0] + (表.角[i1] - 表.角[i0]) * f;
    let 饱 = 表.饱[i0] + (表.饱[i1] - 表.饱[i0]) * f;
    let 亮 = 表.亮[i0] + (表.亮[i1] - 表.亮[i0]) * f;
    饱 = 饱 < 0 ? 0 : 饱 > HSL最大倍数 ? HSL最大倍数 : 饱;
    亮 = 亮 < 0 ? 0 : 亮 > HSL最大倍数 ? HSL最大倍数 : 亮;

    if (角度 !== 0) {
      查正余弦(角度, 余弦);
      绕灰轴(r, g, b, 余弦[0], 余弦[1], 转出);
      r = 转出[0];
      g = 转出[1];
      b = 转出[2];
    }
    /* 饱和度绕亮度缩放，亮度最后当增益乘上去 */
    const L2 = 亮度(r, g, b);
    r = (L2 + (r - L2) * 饱) * 亮;
    g = (L2 + (g - L2) * 饱) * 亮;
    b = (L2 + (b - L2) * 饱) * 亮;

    d[si] = 字节值(r * 255);
    d[si + 1] = 字节值(g * 255);
    d[si + 2] = 字节值(b * 255);
    d[si + 3] = s[si + 3];
  }
  return out;
}

/* ------------------------------------------------------------ LOG / HDR */

/**
 * 两条对数曲线。都是**按对数编码的公开形式自己写的**，没搬任何实现：
 *   · `log2`  —— 直接 log2，0 附近加一个偏移免得去 −∞（出来是负值，给 log 空间内部用）
 *   · `log10` —— 0~1 映回 0~1 的那一种（黑白两端各落在 0 和 1，像 Cineon 那一类）
 * 这一对是**互逆**的，往返误差有断言（`tmp/grade-chain.test.mjs`）。
 */
const LOG偏移 = 0.01;
const LOG底 = 0.99;

export function 转LOG(x: number, 曲线: LogParams['曲线']): number {
  const v = x < 0 ? 0 : x;
  if (曲线 === 'log2') {
    return Math.log2(v + LOG偏移);
  }
  return (Math.log10(v * LOG底 + LOG偏移) + 2) / 2;
}

export function 转线性(y: number, 曲线: LogParams['曲线']): number {
  if (曲线 === 'log2') {
    const v = Math.pow(2, y) - LOG偏移;
    return v < 0 ? 0 : v;
  }
  const v = (Math.pow(10, y * 2 - 2) - LOG偏移) / LOG底;
  return v < 0 ? 0 : v;
}

/**
 * 高光滚降：把膝以上的一段压进 `[膝, 1)`，**渐近到 1 但到不了**。
 *
 * 第一版写成"1 以上再压"，那是错的：函数在 v=1 处等于 1 又要单调增，就必然超过 1，
 * 结果 8 位一存照样夹断 —— 测试里"滚降与硬夹断结果不同"直接红了。
 * 现在膝降到 1 以下（`滚降=1` 时膝在 0.5），高光才有地方落。
 */
function 滚降(v: number, 滚: number): number {
  const 膝 = 1 - 滚 * 0.5;
  if (v <= 膝) return v;
  const 宽 = 1 - 膝;
  return 膝 + 宽 * (1 - Math.exp(-(v - 膝) / 宽));
}

/**
 * 一个通道的整段换算：黑白点 → 曝光 → 进 log 推色度 → 滚降。
 *
 * **参数全是常数，所以这是"字节 → 字节"的一元函数**，可以整段烘成一张 256 项的表。
 * 不烘的话每个像素要算 3 次 log + 3 次 pow（而且乘三个通道），实测 1024×614 要 61.8ms。
 * 烘完是精确等价，不是近似：这里就是原来那条算式，只是把输入穷举了。
 */
export function LOG通道表(
  通道: 0 | 1 | 2,
  p: LogParams,
  向: [number, number, number],
  推量: number
): Uint8ClampedArray {
  const 表 = new Uint8ClampedArray(256);
  const 曲线 = p.曲线;
  const 增益 = Math.pow(2, p.曝光);
  const 用黑白 = (p.黑 > 0 || p.白 < 1) && p.白 > p.黑;
  const 白黑 = p.白 - p.黑 || 1;
  const 推 = p.色轮强度 > 0;
  const 滚 = p.滚降;
  const 推这一路 = 向[通道] * 推量;

  for (let i = 0; i < 256; i++) {
    let v = i / 255;
    if (用黑白) {
      v = (v - p.黑) / 白黑;
      v = v < 0 ? 0 : v > 1 ? 1 : v;
    }
    if (p.曝光 !== 0) v *= 增益;
    if (推) v = 转线性(转LOG(v, 曲线) + 推这一路, 曲线);
    if (滚 > 0) v = 滚降(v, 滚);
    表[i] = 字节值(v * 255);
  }
  return 表;
}

/**
 * LOG / HDR：线性 → log 空间 → （色轮 / 曝光）→ 线性 → 滚降。
 *
 * "HDR"指的是**运算在 log 空间里带超 1 的余量**（推曝光/色轮时高光不至于一推就断），
 * 不是"能读 16/32 位浮点图" —— 进这个节点的还是 8 位图，这里说清楚免得误会。
 * 曝光放在**线性域**做（乘 2^EV），这样两条曲线下的手感一致。
 */
export function 跑Log(src: ImageData, p: LogParams): ImageData {
  if (Log是恒等(p)) return 复制(src);
  const out = blankImageData(src.width, src.height);
  const s = src.data;
  const d = out.data;
  const n = src.width * src.height;
  const 向: [number, number, number] = [0, 0, 0];
  if (p.色轮强度 > 0) 色度方向(p.色轮色相, 向);
  const 推量 = p.色轮强度 * 色轮量;
  /* 三个通道各一张 256 项的表：动参数才重烘一次，跟像素数无关 */
  const 表R = LOG通道表(0, p, 向, 推量);
  const 表G = LOG通道表(1, p, 向, 推量);
  const 表B = LOG通道表(2, p, 向, 推量);

  for (let i = 0; i < n; i++) {
    const si = i * 4;
    d[si] = 表R[s[si]];
    d[si + 1] = 表G[s[si + 1]];
    d[si + 2] = 表B[s[si + 2]];
    d[si + 3] = s[si + 3];
  }
  return out;
}

/* ------------------------------------------------------------ 色彩变形 */

/**
 * 色彩变形：两张二维网格（横轴都是色相，纵轴分别是饱和度 / 亮度）。
 *
 * 每一格的位移同时做两件事：把该处的**饱和度（或亮度）**加一点，
 * 以及把**色相**朝一个方向偏一点 —— 只改不偏的话，拖出来的是一条条横带，
 * 不像"变形"。色相那一份由两张网格的位移**合起来**给。
 */
export function 跑变形(src: ImageData, p: WarpParams): ImageData {
  if (变形是恒等(p)) return 复制(src);
  const out = blankImageData(src.width, src.height);
  const s = src.data;
  const d = out.data;
  const n = src.width * src.height;
  const 边 = 变形边;
  const 格1 = Float64Array.from(p.色相饱和);
  const 格2 = Float64Array.from(p.色相亮度);
  const 用色相 = p.色相量 !== 0;
  const 转出: [number, number, number] = [0, 0, 0];
  const 色 = [0, 0] as [number, number];
  const 余弦 = [0, 0] as [number, number];

  for (let i = 0; i < n; i++) {
    const si = i * 4;
    let r = s[si] / 255;
    let g = s[si + 1] / 255;
    let b = s[si + 2] / 255;
    const L = 亮度(r, g, b);
    色相饱和(r, g, b, 色);
    const H = 色[0] / 360;
    const S = 色[1];

    const t1 = 采格(格1, 边, H, S);
    const t2 = 采格(格2, 边, H, L);
    const 角度 = (t1 + t2) * p.色相量;
    const 饱 = 1 + t1 * p.饱和量;
    const 亮 = 1 + t2 * p.亮度量;

    if (用色相 && 角度 !== 0) {
      查正余弦(角度, 余弦);
      绕灰轴(r, g, b, 余弦[0], 余弦[1], 转出);
      r = 转出[0];
      g = 转出[1];
      b = 转出[2];
    }
    const L2 = 亮度(r, g, b);
    const 饱夹 = 饱 < 0 ? 0 : 饱;
    r = (L2 + (r - L2) * 饱夹) * 亮;
    g = (L2 + (g - L2) * 饱夹) * 亮;
    b = (L2 + (b - L2) * 饱夹) * 亮;

    d[si] = 字节值(r * 255);
    d[si + 1] = 字节值(g * 255);
    d[si + 2] = 字节值(b * 255);
    d[si + 3] = s[si + 3];
  }
  return out;
}
