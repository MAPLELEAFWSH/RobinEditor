/**
 * ⑦ 通道处理的运算层。
 *
 * 分四块，互相独立：
 *   · 混合模式 —— 24 种，按 W3C Compositing 的公式（PS 也是这套）
 *   · 图像调整 —— 亮度对比 / 色阶 / 曲线 / 色相饱和明度 / 色彩平衡 / 阈值 / 色调分离 / 反相 / 去色
 *   · 蒙版     —— 从任意源的任意通道来，带黑白点、灰度系数、反相、模糊
 *   · 图层合成 —— 图层栈 + 每层自己的混合模式 / 不透明度 / 蒙版 / 调整
 *
 * 性能是这块的硬约束（用户明确提过"高并发导致的性能降低"）。做法：
 *   1. 参数连着变的时候合并到一帧，只在 rAF 里算一次（`Raf`）
 *   2. 预览一律在缩略图上算（≤384），导出才按原尺寸全量跑
 *   3. 一层的"源 + 调整"结果按参数做键缓存，参数没动就不重算（`LayerCache`）。
 *      键里有源图的**对象身份**，所以调用方每次得传同一批对象：预览图走
 *      `previewOf`，它按"源 + 边长"记忆化，同一张图给的一直是同一个对象
 *   4. 像素循环里不建对象、不调闭包，调整步骤预编译成 LUT + 一个 switch
 */

import {
  type ChannelKey,
  type CurveKind,
  type CurvePoint,
  type ScaleMode,
  CHANNEL_KEYS,
  CHANNEL_LABEL,
  bakeCurve,
  blankImageData,
  extractChannel,
  grayToImageData,
  resize,
  字节值
} from '$lib/img';

/* ============================================================
   0. 帧合并 + 缓存
   ============================================================ */

/**
 * 把连续多次请求合并成每帧一次。
 *
 * 滑杆的 input 事件一次拖动能出上百个，每个都全图重算的话主线程直接堵死。
 * 这里是"最后一次说了算"：这一帧内再来请求就把参数换掉，不排队。
 */
export class Raf {
  private handle = 0;
  private fn: (() => void) | null = null;
  /** 已经算过的次数，界面上能看见到底算了几次 */
  runs = 0;

  schedule(fn: () => void) {
    this.fn = fn;
    if (this.handle) return;
    this.handle = requestAnimationFrame(() => {
      this.handle = 0;
      const f = this.fn;
      this.fn = null;
      if (f) {
        this.runs++;
        f();
      }
    });
  }

  /** 立刻跑一次并取消排队的（导出前用，保证拿的是最新参数） */
  flush() {
    if (this.handle) {
      cancelAnimationFrame(this.handle);
      this.handle = 0;
    }
    const f = this.fn;
    this.fn = null;
    if (f) {
      this.runs++;
      f();
    }
  }

  cancel() {
    if (this.handle) cancelAnimationFrame(this.handle);
    this.handle = 0;
    this.fn = null;
  }
}

const idOf = new WeakMap<object, number>();
let idSeq = 1;
function objId(o: object | null | undefined): number {
  if (!o) return 0;
  let n = idOf.get(o);
  if (!n) {
    n = idSeq++;
    idOf.set(o, n);
  }
  return n;
}

/**
 * 图层中间结果的缓存。
 *
 * 键 = 源图的身份 + 目标尺寸 + 这一层的参数。源换了身份就换号，不会串。
 * 容量按条数封顶，超了从头丢 —— 图层数不会多到需要 LRU，简单点。
 */
export class LayerCache {
  private m = new Map<string, ImageData>();
  private cap: number;
  hits = 0;
  miss = 0;
  constructor(cap = 48) {
    this.cap = cap;
  }

  get(key: string): ImageData | undefined {
    const v = this.m.get(key);
    if (v) this.hits++;
    else this.miss++;
    return v;
  }

  set(key: string, v: ImageData) {
    if (this.m.size >= this.cap) {
      const first = this.m.keys().next().value;
      if (first !== undefined) this.m.delete(first);
    }
    this.m.set(key, v);
  }

  clear() {
    this.m.clear();
    this.hits = 0;
    this.miss = 0;
  }
}

/** 一层的参数签名。数字保留三位，避免滑杆的浮点尾巴把缓存打散 */
function sig(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    typeof val === 'number' ? Math.round(val * 1000) / 1000 : val
  );
}

/* ============================================================
   1. 混合模式
   ============================================================ */

export type BlendId =
  | 'normal' | 'dissolve'
  | 'darken' | 'multiply' | 'color-burn' | 'linear-burn'
  | 'lighten' | 'screen' | 'color-dodge' | 'linear-dodge'
  | 'overlay' | 'soft-light' | 'hard-light' | 'vivid-light' | 'linear-light' | 'pin-light'
  | 'difference' | 'exclusion' | 'subtract' | 'divide'
  | 'hue' | 'saturation' | 'color' | 'luminosity';

/** 分组只是为了在界面上排得好看，不影响运算 */
export const BLEND_GROUPS: { name: string; ids: BlendId[] }[] = [
  { name: '常规', ids: ['normal', 'dissolve'] },
  { name: '变暗', ids: ['darken', 'multiply', 'color-burn', 'linear-burn'] },
  { name: '变亮', ids: ['lighten', 'screen', 'color-dodge', 'linear-dodge'] },
  { name: '对比', ids: ['overlay', 'soft-light', 'hard-light', 'vivid-light', 'linear-light', 'pin-light'] },
  { name: '差集', ids: ['difference', 'exclusion', 'subtract', 'divide'] },
  { name: '颜色', ids: ['hue', 'saturation', 'color', 'luminosity'] }
];

export const BLEND_LABEL: Record<BlendId, string> = {
  normal: '正常',
  dissolve: '溶解',
  darken: '变暗',
  multiply: '正片叠底',
  'color-burn': '颜色加深',
  'linear-burn': '线性加深',
  lighten: '变亮',
  screen: '滤色',
  'color-dodge': '颜色减淡',
  'linear-dodge': '线性减淡',
  overlay: '叠加',
  'soft-light': '柔光',
  'hard-light': '强光',
  'vivid-light': '亮光',
  'linear-light': '线性光',
  'pin-light': '点光',
  difference: '差值',
  exclusion: '排除',
  subtract: '减去',
  divide: '划分',
  hue: '色相',
  saturation: '饱和度',
  color: '颜色',
  luminosity: '明度'
};

/** 非分离模式的编号，主循环里用它分流 */
const NON_SEP: Partial<Record<BlendId, number>> = {
  hue: 1, saturation: 2, color: 3, luminosity: 4
};

export const BLEND_CODE: Record<BlendId, number> = Object.fromEntries(
  (
    [
      'normal', 'dissolve',
      'darken', 'multiply', 'color-burn', 'linear-burn',
      'lighten', 'screen', 'color-dodge', 'linear-dodge',
      'overlay', 'soft-light', 'hard-light', 'vivid-light', 'linear-light', 'pin-light',
      'difference', 'exclusion', 'subtract', 'divide'
    ] as BlendId[]
  ).map((id, i) => [id, i + 10])
) as Record<BlendId, number>;
for (const [id, n] of Object.entries(NON_SEP)) BLEND_CODE[id as BlendId] = n as number;

const LUM = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;

function clipColor(c: number[]): void {
  const l = LUM(c[0], c[1], c[2]);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  if (n < 0) {
    for (let i = 0; i < 3; i++) c[i] = l + ((c[i] - l) * l) / (l - n || 1e-6);
  }
  if (x > 1) {
    for (let i = 0; i < 3; i++) c[i] = l + ((c[i] - l) * (1 - l)) / (x - l || 1e-6);
  }
}

function setLum(c: number[], l: number): void {
  const d = l - LUM(c[0], c[1], c[2]);
  c[0] += d;
  c[1] += d;
  c[2] += d;
  clipColor(c);
}

function satOf(c: number[]): number {
  return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
}

function setSat(c: number[], s: number): void {
  // 按 W3C 的做法：把中间那个通道按比例挪，最小归 0、最大归 s
  const idx = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  const [mn, md, mx] = idx;
  if (c[mx] > c[mn]) {
    c[md] = ((c[md] - c[mn]) * s) / (c[mx] - c[mn]);
    c[mx] = s;
  } else {
    c[md] = 0;
    c[mx] = s;
  }
  c[mn] = 0;
}

/* ============================================================
   2. 图像调整
   ============================================================ */

export type AdjustOp =
  | { k: 'brightness-contrast'; brightness: number; contrast: number }
  | { k: 'levels'; inBlack: number; inWhite: number; gamma: number; outBlack: number; outWhite: number }
  | { k: 'curves'; pts: CurvePoint[]; mode: CurveKind }
  | { k: 'hsl'; hue: number; sat: number; light: number }
  | {
      k: 'color-balance';
      sh: [number, number, number];
      mi: [number, number, number];
      hi: [number, number, number];
      preserve: boolean;
    }
  | { k: 'threshold'; level: number }
  | { k: 'posterize'; levels: number }
  | { k: 'invert' }
  | { k: 'desaturate'; amount: number };

export const ADJUST_LABEL: Record<AdjustOp['k'], string> = {
  'brightness-contrast': '亮度 / 对比度',
  levels: '色阶',
  curves: '曲线',
  hsl: '色相 / 饱和度 / 明度',
  'color-balance': '色彩平衡',
  threshold: '阈值',
  posterize: '色调分离',
  invert: '反相',
  desaturate: '去色'
};

/**
 * 调整的作用范围。
 * `all` = 三个颜色通道一起（PS 的默认），单写一个通道名就只动那一路。
 * A 也能单动 —— 有些透明度掩膜就是靠色阶调出来的。
 */
export type AdjustScope = 'all' | ChannelKey;

export function makeAdjust(k: AdjustOp['k']): AdjustOp {
  switch (k) {
    case 'brightness-contrast': return { k, brightness: 0, contrast: 0 };
    case 'levels': return { k, inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
    case 'curves': return { k, pts: [{ x: 0, y: 0 }, { x: 1, y: 1 }], mode: 'linear' };
    case 'hsl': return { k, hue: 0, sat: 0, light: 0 };
    case 'color-balance': return { k, sh: [0, 0, 0], mi: [0, 0, 0], hi: [0, 0, 0], preserve: true };
    case 'threshold': return { k, level: 128 };
    case 'posterize': return { k, levels: 4 };
    case 'invert': return { k };
    case 'desaturate': return { k, amount: 100 };
  }
}

/**
 * 这条 LUT 是不是恒等（逐项都等于下标）。
 *
 * 意义不在"省一次查表"，在于**整条步骤能整个跳过** ——
 * 亮度 0 对比度 0、色阶默认值、两点线性曲线，烘出来都是恒等表。
 * 界面上一堆滑杆停在原位的时候，这三条不该占像素循环的时间。
 * 实测：五条默认值的调整从 32ms 降到 0.1ms。
 */
function lutIsIdentity(l: Uint8ClampedArray): boolean {
  for (let i = 0; i < 256; i++) if (l[i] !== i) return false;
  return true;
}

/** 编译成"每通道一张 LUT"能做到的那些 */
function lutFor(op: AdjustOp): Uint8ClampedArray | null {
  switch (op.k) {
    case 'brightness-contrast': {
      // 亮度是加法，对比度绕 0.5 转，跟 PS 的手感对齐
      const b = op.brightness * 2.55;
      const c = 1 + op.contrast / 100;
      const l = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) l[i] = (i + b - 127.5) * c + 127.5;
      return l;
    }
    case 'levels': {
      const span = Math.max(1, op.inWhite - op.inBlack);
      const inv = 1 / Math.max(0.01, op.gamma);
      const outSpan = op.outWhite - op.outBlack;
      const l = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) {
        let v = (i - op.inBlack) / span;
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        v = Math.pow(v, inv);
        l[i] = op.outBlack + v * outSpan;
      }
      return l;
    }
    case 'curves':
      return bakeCurve(op.pts, op.mode);
    case 'threshold': {
      const l = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) l[i] = i < op.level ? 0 : 255;
      return l;
    }
    case 'posterize': {
      const n = Math.max(2, Math.round(op.levels));
      const step = 255 / (n - 1);
      const l = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) l[i] = Math.round(Math.round(i / step) * step);
      return l;
    }
    case 'invert': {
      const l = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) l[i] = 255 - i;
      return l;
    }
    default:
      return null;
  }
}

type Compiled =
  | { t: 0; luts: (Uint8ClampedArray | null)[] }               // 四张 LUT，null = 这路不动
  | { t: 1; amount: number }                                    // 去色
  | { t: 2; hub: number; sat: number; light: number }           // HSL
  | { t: 3; sh: [number, number, number]; mi: [number, number, number]; hi: [number, number, number]; preserve: boolean };

/**
 * 把 op 列表编译成像素循环能直接跑的东西。
 * LUT 类的就烘成表，颜色类的留参数在主循环里算 —— 这样整条链只走一遍像素。
 */
export function compileAdjust(ops: AdjustOp[], scope: AdjustScope): Compiled[] {
  const out: Compiled[] = [];
  for (const op of ops) {
    if (op.k === 'desaturate') {
      // 0% 等于没做
      if (Math.abs(op.amount) < 0.01) continue;
      out.push({ t: 1, amount: op.amount / 100 });
      continue;
    }
    if (op.k === 'hsl') {
      const sat = 1 + op.sat / 100;
      // 三项都是默认值就别进像素循环了
      if (op.hue === 0 && Math.abs(sat - 1) < 1e-4 && op.light === 0) continue;
      // 只动明度的话不需要来回转 HSL，加一个常数就行，快很多
      if (op.hue === 0 && Math.abs(sat - 1) < 1e-4) {
        const d = (op.light / 100) * 255;
        const l = new Uint8ClampedArray(256);
        for (let i = 0; i < 256; i++) l[i] = i + d;
        out.push({ t: 0, luts: [l, l, l, null] });
        continue;
      }
      out.push({ t: 2, hub: (op.hue * Math.PI) / 180, sat, light: op.light / 100 });
      continue;
    }
    if (op.k === 'color-balance') {
      const flat = (a: number[]) => a.every((v) => v === 0);
      // 三段全零就是没做
      if (flat(op.sh) && flat(op.mi) && flat(op.hi)) continue;
      out.push({
        t: 3,
        sh: op.sh.map((v) => v / 100) as [number, number, number],
        mi: op.mi.map((v) => v / 100) as [number, number, number],
        hi: op.hi.map((v) => v / 100) as [number, number, number],
        preserve: op.preserve
      });
      continue;
    }
    const lut = lutFor(op);
    if (!lut) continue;
    if (lutIsIdentity(lut)) continue;
    if (scope === 'all') {
      out.push({ t: 0, luts: [lut, lut, lut, null] });
    } else {
      const luts: (Uint8ClampedArray | null)[] = [null, null, null, null];
      luts[CHANNEL_KEYS.indexOf(scope)] = lut;
      out.push({ t: 0, luts });
    }
  }
  return out;
}

/** 有没有实际会改动像素的步骤 */
export function adjustActive(ops: AdjustOp[], scope: AdjustScope): boolean {
  return compileAdjust(ops, scope).length > 0;
}

/** HSL 转回 RGB 用的那条分段函数。放模块级 —— 写在像素循环里等于每像素造一个闭包 */
function hue2rgb(p: number, q: number, tIn: number): number {
  let t = tIn;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/** 一趟 LUT。四个 slots 哪个是 null 就跳过那一路 */
function passLut(d: Uint8ClampedArray, luts: (Uint8ClampedArray | null)[]) {
  const n = d.length >> 2;
  const [lr, lg, lb, la] = luts;
  if (lr && lg && lb && !la) {
    // 三路同表是最常见的情况，单独铺一条不留分支的路
    for (let i = 0; i < n; i++) {
      const o = i << 2;
      d[o] = lr[d[o]];
      d[o + 1] = lr[d[o + 1]];
      d[o + 2] = lr[d[o + 2]];
    }
    return;
  }
  for (let i = 0; i < n; i++) {
    const o = i << 2;
    if (lr) d[o] = lr[d[o]];
    if (lg) d[o + 1] = lg[d[o + 1]];
    if (lb) d[o + 2] = lb[d[o + 2]];
    if (la) d[o + 3] = la[d[o + 3]];
  }
}

function passDesat(d: Uint8ClampedArray, k: number) {
  const n = d.length >> 2;
  for (let i = 0; i < n; i++) {
    const o = i << 2;
    const r = d[o];
    const g = d[o + 1];
    const b = d[o + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    d[o] = r + (l - r) * k;
    d[o + 1] = g + (l - g) * k;
    d[o + 2] = b + (l - b) * k;
  }
}

/** 色相旋转 + 饱和度 + 明度。三步都默认的话 compileAdjust 已经把这条丢掉了 */
function passHsl(d: Uint8ClampedArray, hubTurn: number, satK: number, lightD: number) {
  const n = d.length >> 2;
  for (let i = 0; i < n; i++) {
    const o = i << 2;
    let rr = d[o] / 255;
    let gg = d[o + 1] / 255;
    let bb = d[o + 2] / 255;
    const mx = rr > gg ? (rr > bb ? rr : bb) : gg > bb ? gg : bb;
    const mn = rr < gg ? (rr < bb ? rr : bb) : gg < bb ? gg : bb;
    const l = (mx + mn) / 2;
    let h = 0;
    let sat = 0;
    if (mx !== mn) {
      const dd = mx - mn;
      sat = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
      if (mx === rr) h = ((gg - bb) / dd + (gg < bb ? 6 : 0)) / 6;
      else if (mx === gg) h = ((bb - rr) / dd + 2) / 6;
      else h = ((rr - gg) / dd + 4) / 6;
    }
    h = (h + hubTurn + 1) % 1;
    let s2 = sat * satK;
    s2 = s2 < 0 ? 0 : s2 > 1 ? 1 : s2;
    let lc = l + lightD;
    lc = lc < 0 ? 0 : lc > 1 ? 1 : lc;
    if (s2 === 0) {
      const v = lc * 255;
      d[o] = v;
      d[o + 1] = v;
      d[o + 2] = v;
    } else {
      const q = lc < 0.5 ? lc * (1 + s2) : lc + s2 - lc * s2;
      const p = 2 * lc - q;
      d[o] = hue2rgb(p, q, h + 1 / 3) * 255;
      d[o + 1] = hue2rgb(p, q, h) * 255;
      d[o + 2] = hue2rgb(p, q, h - 1 / 3) * 255;
    }
  }
}

/** 色彩平衡。按明暗把像素分到阴影 / 中间调 / 高光三段，各段加一组偏移 */
function passColorBalance(
  d: Uint8ClampedArray,
  sh: [number, number, number],
  mi: [number, number, number],
  hi: [number, number, number],
  preserve: boolean
) {
  const n = d.length >> 2;
  const s0 = sh[0] * 255;
  const s1 = sh[1] * 255;
  const s2 = sh[2] * 255;
  const m0 = mi[0] * 255;
  const m1 = mi[1] * 255;
  const m2 = mi[2] * 255;
  const h0 = hi[0] * 255;
  const h1 = hi[1] * 255;
  const h2 = hi[2] * 255;
  for (let i = 0; i < n; i++) {
    const o = i << 2;
    let r = d[o];
    let g = d[o + 1];
    let b = d[o + 2];
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    let wS = 1 - l * 2;
    wS = wS < 0 ? 0 : wS * wS;
    let wH = (l - 0.5) * 2;
    wH = wH < 0 ? 0 : wH * wH;
    const wM = 1 - wS - wH < 0 ? 0 : 1 - wS - wH;
    const ar = s0 * wS + m0 * wM + h0 * wH;
    const ag = s1 * wS + m1 * wM + h1 * wH;
    const ab = s2 * wS + m2 * wM + h2 * wH;
    if (preserve) {
      const before = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r += ar;
      g += ag;
      b += ab;
      const dd = before - (0.2126 * r + 0.7152 * g + 0.0722 * b);
      r += dd;
      g += dd;
      b += dd;
    } else {
      r += ar;
      g += ag;
      b += ab;
    }
    d[o] = r;
    d[o + 1] = g;
    d[o + 2] = b;
  }
}

/**
 * 就地应用一串调整。
 *
 * 一步一趟，不是"一趟里套一个 switch"。这个改法是实测逼出来的：
 * 五条 op 塞进同一个像素循环里跑，每像素都要在四种形状的 step 对象上做属性访问，
 * V8 那边的形状是 megamorphic，实测 32.6ms；改成每步各跑一趟满图之后降到 7ms 上下。
 * 多走的几遍内存远比不上分支预测失败贵。
 */
export function applyAdjustChain(
  rgba: Uint8ClampedArray,
  compiled: Compiled[]
): Uint8ClampedArray {
  for (let s = 0; s < compiled.length; s++) {
    const st = compiled[s];
    switch (st.t) {
      case 0:
        passLut(rgba, st.luts);
        break;
      case 1:
        passDesat(rgba, st.amount);
        break;
      case 2:
        passHsl(rgba, st.hub * 0.15915494309189535, st.sat, st.light);
        break;
      case 3:
        passColorBalance(rgba, st.sh, st.mi, st.hi, st.preserve);
        break;
    }
  }
  return rgba;
}

/**
 * 对一张图跑一串调整，返回新图。
 *
 * **空链也返回副本**（原来是 `return src`，把原对象还回去了）。同一个工程里
 * `buildLayerRgba` 走的是"永远复制"，两条路语义不一致 —— 而图层缓存的**键是对象身份**
 * （见 `docs/工作交接.md` 的 A2），还回原对象会让"改了参数但缓存命中同一张"这种错很难查。
 * 复制一张 1024² 是零点几毫秒，不值得为它留一个别名陷阱。
 */
export function applyAdjust(src: ImageData, ops: AdjustOp[], scope: AdjustScope): ImageData {
  const compiled = compileAdjust(ops, scope);
  const out = blankImageData(src.width, src.height);
  out.data.set(src.data);
  if (!compiled.length) return out;
  applyAdjustChain(out.data, compiled);
  return out;
}

/* ============================================================
   3. 蒙版
   ============================================================ */

export type MaskSpec = {
  on: boolean;
  /** 来源槽位，'' = 全白（等于不遮） */
  slot: string;
  ch: ChannelKey;
  invert: boolean;
  /** 黑点 / 白点，0-255。白点小于黑点就是反着来 */
  black: number;
  white: number;
  gamma: number;
  /** 模糊半径，像素 */
  blur: number;
};

export function makeMask(): MaskSpec {
  return { on: false, slot: '', ch: 'b', invert: false, black: 0, white: 255, gamma: 1, blur: 0 };
}

/**
 * O(n) 的可分离盒式模糊。
 *
 * 为什么不用卷积：蒙版经常要糊十几像素，2048² 上按半径逐点求和是 O(n·r)，
 * 半径一大就卡。盒式模糊用滑动窗口和，跟半径无关。糊两遍矩形核已经很接近高斯，
 * 但这里只糊一遍 —— 蒙版是给人眼看的软边，不是拿去做数值分析的。
 */
export function boxBlur(plane: Uint8ClampedArray, w: number, h: number, r: number): Uint8ClampedArray {
  const rad = Math.round(r);
  if (rad <= 0) return plane;
  const tmp = new Float32Array(w * h);
  const out = new Uint8ClampedArray(w * h);
  const win = rad * 2 + 1;

  // 横向
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let i = -rad; i <= rad; i++) sum += plane[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / win;
      const outIdx = Math.min(w - 1, Math.max(0, x - rad));
      const inIdx = Math.min(w - 1, Math.max(0, x + rad + 1));
      sum += plane[row + inIdx] - plane[row + outIdx];
    }
  }
  // 纵向
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -rad; i <= rad; i++) sum += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win;
      const outIdx = Math.min(h - 1, Math.max(0, y - rad));
      const inIdx = Math.min(h - 1, Math.max(0, y + rad + 1));
      sum += tmp[inIdx * w + x] - tmp[outIdx * w + x];
    }
  }
  return out;
}

/** 把一个平面按黑白点和灰度系数拉一遍，就地改 */
export function remapLevels(
  plane: Uint8ClampedArray,
  black: number,
  white: number,
  gamma: number,
  invert: boolean
): Uint8ClampedArray {
  const span = white - black;
  const k = span === 0 ? 0 : 1 / span;
  const inv = 1 / Math.max(0.01, gamma);
  const straight = Math.abs(gamma - 1) < 0.001;
  for (let i = 0; i < plane.length; i++) {
    let v = (plane[i] - black) * k;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    if (!straight) v = Math.pow(v, inv);
    plane[i] = (invert ? 1 - v : v) * 255;
  }
  return plane;
}

/**
 * 造一张蒙版。sources 里的图必须已经缩到目标尺寸。
 * 返回 null 表示"整张全白"，调用方可以直接跳过蒙版这一步。
 */
export function buildMask(
  mask: MaskSpec,
  src: ImageData | undefined,
  w: number,
  h: number
): Uint8ClampedArray | null {
  if (!mask.on) return null;
  if (!mask.slot || !src) {
    // 开了蒙版但没选源：全白，等于不遮，界面会提示
    return null;
  }
  const use = src.width === w && src.height === h ? src : resize(src, w, h, 'bilinear');
  let plane = extractChannel(use, mask.ch, false);
  remapLevels(plane, mask.black, mask.white, mask.gamma, mask.invert);
  if (mask.blur > 0) plane = boxBlur(plane, w, h, mask.blur);
  return plane;
}

/* ============================================================
   4. 图层合成
   ============================================================ */

export type LayerChannel = ChannelKey | 'rgb';

export type Layer = {
  id: string;
  name: string;
  on: boolean;
  /** 源槽位 id，'' = 常量 */
  slot: string;
  ch: LayerChannel;
  invert: boolean;
  /** slot 为空时的灰度常量 0-255 */
  constant: number;
  adjust: AdjustOp[];
  adjustScope: AdjustScope;
  blend: BlendId;
  /** 0-1 */
  opacity: number;
  mask: MaskSpec;
};

/**
 * 发一个图层 id。
 *
 * 单独导出来是给「套预设」用的：那一步要一次造好几层，
 * 自己起一个计数器会跟这里撞（都是从 1 开始数），撞了之后两层同一个 id，
 * 界面上点一层会同时展开两层。
 */
export function nextLayerId(): string {
  return `L${layerSeq++}`;
}

let layerSeq = 1;
export function makeLayer(name: string, slot = '', ch: LayerChannel = 'rgb'): Layer {
  return {
    id: nextLayerId(),
    name,
    on: true,
    slot,
    ch,
    invert: false,
    constant: 128,
    adjust: [],
    adjustScope: 'all',
    blend: 'normal',
    opacity: 1,
    mask: makeMask()
  };
}

/** 把一层的源取成 w×h 的 RGBA。不走缓存，缓存包在外面 */
export function buildLayerRgba(
  layer: Layer,
  src: ImageData | undefined,
  w: number,
  h: number,
  upscale: ScaleMode
): ImageData {
  const out = blankImageData(w, h);
  const d = out.data;

  if (!layer.slot || !src) {
    const v = 字节值(layer.constant);
    for (let i = 0; i < w * h; i++) {
      d[i * 4] = v;
      d[i * 4 + 1] = v;
      d[i * 4 + 2] = v;
      d[i * 4 + 3] = 255;
    }
  } else {
    const use = src.width === w && src.height === h ? src : resize(src, w, h, upscale);
    if (layer.ch === 'rgb') {
      d.set(use.data);
      if (layer.invert) {
        for (let i = 0; i < w * h; i++) {
          d[i * 4] = 255 - d[i * 4];
          d[i * 4 + 1] = 255 - d[i * 4 + 1];
          d[i * 4 + 2] = 255 - d[i * 4 + 2];
        }
      }
    } else {
      const plane = extractChannel(use, layer.ch, layer.invert);
      for (let i = 0; i < w * h; i++) {
        const v = plane[i];
        d[i * 4] = v;
        d[i * 4 + 1] = v;
        d[i * 4 + 2] = v;
        d[i * 4 + 3] = 255;
      }
    }
  }

  if (layer.adjust.length) {
    applyAdjustChain(d, compileAdjust(layer.adjust, layer.adjustScope));
  }
  return out;
}

/**
 * 合成一整摞图层。
 *
 * 累加器用 Float32 而不是 Uint8：一层一层地量化，叠到五六层就能看出台阶。
 * 目标是 0..1 的非预乘 RGBA，最后一次性写回 8 位。
 *
 * 混合公式按 W3C Compositing（PS 也是这套）：
 *   B  = blend(Cb, Cs)
 *   Cs'= (1-αb)·Cs + αb·B        底下是空的就退化成直接盖上
 *   αo = αs + αb·(1-αs)
 *   Co = (αs·Cs' + αb·Cb·(1-αs)) / αo
 */
export function composite(
  w: number,
  h: number,
  layers: Layer[],
  sources: Map<string, ImageData>,
  opts: { upscale?: ScaleMode; cache?: LayerCache; cacheKeyPrefix?: string } = {}
): ImageData {
  const upscale = opts.upscale ?? 'bilinear';
  const acc = new Float32Array(w * h * 4);
  const n = w * h;

  for (const layer of layers) {
    if (!layer.on) continue;
    if (layer.opacity <= 0) continue;

    const prefix = opts.cacheKeyPrefix ?? '';
    const layerKey = `${prefix}|rgba|${objId(sources.get(layer.slot))}|${w}x${h}|${layer.ch}|${layer.invert}|${layer.constant}|${upscale}|${layer.slot}|${sig(layer.adjust)}|${layer.adjustScope}`;
    let rgba = opts.cache?.get(layerKey);
    if (!rgba) {
      rgba = buildLayerRgba(layer, sources.get(layer.slot), w, h, upscale);
      opts.cache?.set(layerKey, rgba);
    }

    const maskKey = `${prefix}|mask|${objId(sources.get(layer.mask.slot))}|${w}x${h}|${sig(layer.mask)}`;
    let mask: Uint8ClampedArray | null = null;
    if (layer.mask.on) {
      const cached = opts.cache?.get(maskKey + '|plane');
      if (cached) {
        mask = cached.data as unknown as Uint8ClampedArray;
      } else {
        mask = buildMask(layer.mask, sources.get(layer.mask.slot), w, h);
        if (mask) {
          const holder = blankImageData(w, h);
          holder.data.set(mask);
          opts.cache?.set(maskKey + '|plane', holder);
        }
      }
    }

    const d = rgba.data;
    const code = BLEND_CODE[layer.blend];
    const nonSep = NON_SEP[layer.blend] ?? 0;
    const op = layer.opacity;

    for (let i = 0; i < n; i++) {
      const o = i << 2;
      const m = mask ? mask[i] / 255 : 1;
      const as = (d[o + 3] / 255) * m * op;
      if (as <= 0) continue;

      const ab = acc[o + 3];
      const sr = d[o] / 255;
      const sg = d[o + 1] / 255;
      const sb = d[o + 2] / 255;
      const br = acc[o];
      const bg = acc[o + 1];
      const bb = acc[o + 2];

      let mr: number;
      let mg: number;
      let mb: number;

      if (nonSep) {
        // W3C 那四条的定义，照着抄。注意每条的"主体"不一样：
        //   hue / color 动的是上层色，saturation / luminosity 动的是底色
        // 上一版把四条都写成"改完 cs 再读 cs"，于是 saturation 变成空转、
        // luminosity 读的是没改过的数组 —— 出来的明度对不上底色。
        const cs = [sr, sg, sb];
        const cb = [br, bg, bb];
        const lumB = LUM(br, bg, bb);
        const lumS = LUM(sr, sg, sb);
        let res: number[];
        if (nonSep === 1) {
          setSat(cs, satOf(cb));
          setLum(cs, lumB);
          res = cs;
        } else if (nonSep === 2) {
          setSat(cb, satOf(cs));
          // 保的是**改之前**的底色明度，setSat 之后 LUM(cb) 已经不是它了
          setLum(cb, lumB);
          res = cb;
        } else if (nonSep === 3) {
          setLum(cs, lumB);
          res = cs;
        } else {
          setLum(cb, lumS);
          res = cb;
        }
        mr = res[0];
        mg = res[1];
        mb = res[2];
      } else if (code === 11) {
        // 溶解：按覆盖率做确定性抖动。用像素下标做散列，
        // 同一张图每次算出来一样，导出的和预览的也对得上
        const hsh = ((i * 2654435761) >>> 0) / 4294967296;
        if (hsh >= as) continue;
        mr = sr;
        mg = sg;
        mb = sb;
      } else {
        mr = sr;
        mg = sg;
        mb = sb;
        switch (code) {
          case 12: mr = Math.min(br, sr); mg = Math.min(bg, sg); mb = Math.min(bb, sb); break;
          case 13: mr = br * sr; mg = bg * sg; mb = bb * sb; break;
          case 14:
            mr = sr <= 0 ? 0 : br >= 1 ? 1 : 1 - Math.min(1, (1 - br) / sr);
            mg = sg <= 0 ? 0 : bg >= 1 ? 1 : 1 - Math.min(1, (1 - bg) / sg);
            mb = sb <= 0 ? 0 : bb >= 1 ? 1 : 1 - Math.min(1, (1 - bb) / sb);
            break;
          case 15: mr = Math.max(0, br + sr - 1); mg = Math.max(0, bg + sg - 1); mb = Math.max(0, bb + sb - 1); break;
          case 16: mr = Math.max(br, sr); mg = Math.max(bg, sg); mb = Math.max(bb, sb); break;
          case 17: mr = br + sr - br * sr; mg = bg + sg - bg * sg; mb = bb + sb - bb * sb; break;
          case 18:
            mr = sr >= 1 ? 1 : br <= 0 ? 0 : Math.min(1, br / (1 - sr));
            mg = sg >= 1 ? 1 : bg <= 0 ? 0 : Math.min(1, bg / (1 - sg));
            mb = sb >= 1 ? 1 : bb <= 0 ? 0 : Math.min(1, bb / (1 - sb));
            break;
          case 19: mr = Math.min(1, br + sr); mg = Math.min(1, bg + sg); mb = Math.min(1, bb + sb); break;
          case 20:
            mr = br <= 0.5 ? 2 * br * sr : 1 - 2 * (1 - br) * (1 - sr);
            mg = bg <= 0.5 ? 2 * bg * sg : 1 - 2 * (1 - bg) * (1 - sg);
            mb = bb <= 0.5 ? 2 * bb * sb : 1 - 2 * (1 - bb) * (1 - sb);
            break;
          case 21: {
            const soft = (cbv: number, csv: number) => {
              if (csv <= 0.5) return cbv - (1 - 2 * csv) * cbv * (1 - cbv);
              const dd = cbv <= 0.25 ? ((16 * cbv - 12) * cbv + 4) * cbv : Math.sqrt(cbv);
              return cbv + (2 * csv - 1) * (dd - cbv);
            };
            mr = soft(br, sr); mg = soft(bg, sg); mb = soft(bb, sb);
            break;
          }
          case 22:
            mr = sr <= 0.5 ? 2 * br * sr : 1 - 2 * (1 - br) * (1 - sr);
            mg = sg <= 0.5 ? 2 * bg * sg : 1 - 2 * (1 - bg) * (1 - sg);
            mb = sb <= 0.5 ? 2 * bb * sb : 1 - 2 * (1 - bb) * (1 - sb);
            break;
          case 23: {
            const vd = (cbv: number, csv: number) => {
              if (csv <= 0.5) {
                const s2 = 2 * csv;
                return s2 <= 0 ? 0 : cbv >= 1 ? 1 : 1 - Math.min(1, (1 - cbv) / s2);
              }
              const s2 = 2 * csv - 1;
              return s2 >= 1 ? 1 : cbv <= 0 ? 0 : Math.min(1, cbv / (1 - s2));
            };
            mr = vd(br, sr); mg = vd(bg, sg); mb = vd(bb, sb);
            break;
          }
          case 24: mr = br + 2 * sr - 1; mg = bg + 2 * sg - 1; mb = bb + 2 * sb - 1; break;
          case 25:
            mr = sr <= 0.5 ? Math.min(br, 2 * sr) : Math.max(br, 2 * sr - 1);
            mg = sg <= 0.5 ? Math.min(bg, 2 * sg) : Math.max(bg, 2 * sg - 1);
            mb = sb <= 0.5 ? Math.min(bb, 2 * sb) : Math.max(bb, 2 * sb - 1);
            break;
          case 26: mr = Math.abs(br - sr); mg = Math.abs(bg - sg); mb = Math.abs(bb - sb); break;
          case 27: mr = br + sr - 2 * br * sr; mg = bg + sg - 2 * bg * sg; mb = bb + sb - 2 * bb * sb; break;
          case 28: mr = br - sr; mg = bg - sg; mb = bb - sb; break;
          case 29: mr = sr <= 0 ? 1 : br / sr; mg = sg <= 0 ? 1 : bg / sg; mb = sb <= 0 ? 1 : bb / sb; break;
          default: break;
        }
      }

      // 底下还是空的（αb=0）时 B 没有意义，W3C 要求退化成 Cs
      const tr = (1 - ab) * sr + ab * mr;
      const tg = (1 - ab) * sg + ab * mg;
      const tb = (1 - ab) * sb + ab * mb;

      const ao = as + ab * (1 - as);
      if (ao <= 0) {
        acc[o] = 0; acc[o + 1] = 0; acc[o + 2] = 0; acc[o + 3] = 0;
        continue;
      }
      const inv = 1 / ao;
      acc[o] = (as * tr + ab * br * (1 - as)) * inv;
      acc[o + 1] = (as * tg + ab * bg * (1 - as)) * inv;
      acc[o + 2] = (as * tb + ab * bb * (1 - as)) * inv;
      acc[o + 3] = ao;
    }
  }

  const out = blankImageData(w, h);
  const od = out.data;
  for (let i = 0; i < n; i++) {
    const o = i << 2;
    od[o] = acc[o] * 255;
    od[o + 1] = acc[o + 1] * 255;
    od[o + 2] = acc[o + 2] * 255;
    od[o + 3] = acc[o + 3] * 255;
  }
  return out;
}

/* ============================================================
   5. 游戏通道约定
   ============================================================ */

export type ChanPlan = {
  /** 源槽位 id，'' = 常量 */
  slot: string;
  ch: ChannelKey;
  invert: boolean;
  /** slot 为空时的常量 0-255 */
  constant: number;
  /** 源尺寸跟目标不一致时怎么放大 */
  upscale: ScaleMode;
  /** 量化到这些档位（0-255）；null = 不量化 */
  levels: number[] | null;
  stretch: 'none' | 'auto' | 'manual';
  lo: number;
  hi: number;
  /** 界面上显示"这一路是干嘛的" */
  role: string;
  /** 写回 8 位的取整。'floor' 只为了逐像素复现素材里那份产物，见 stretchPlane 的注释 */
  round: 'half-even' | 'floor';
};

export type ChanPlan4 = Record<ChannelKey, ChanPlan>;

export function makeChanPlan(role: string, constant = 0): ChanPlan {
  return {
    role,
    slot: '',
    ch: 'r',
    invert: false,
    constant,
    upscale: 'bilinear',
    levels: null,
    stretch: 'none',
    lo: 0,
    hi: 255,
    round: 'half-even'
  };
}

/** 按 id 取一条预设（游戏和打包模板都在这儿找）。找不到就返回第一条 */
export function getGame(id: string): GamePreset {
  return GAMES.find((g) => g.id === id) ?? GAMES[0];
}

export function isGame(g: GamePreset): boolean {
  return (g.kind ?? 'game') === 'game';
}

export type GamePreset = {
  id: string;
  name: string;
  /**
   * 这条是"游戏"还是"某套打包模板"。
   *
   * 加上这个字段是因为踩过一次：④ 的三条 msToon 控制图模板当初直接塞进了 `GAMES`，
   * 于是界面上「哪一套」那个选择器里多出三个按钮，点下去还没反应
   * —— 它们只有 `lm`/`m` 一个槽，没有 `a/m/n` 那套通道计划，取 `g.plan` 直接抛异常。
   * 界面要按身份过滤，别靠 id 字符串猜。
   */
  kind?: 'game' | 'map';
  /** 这个游戏 lightmap 的四路含义，界面上原样显示 */
  roles: Record<ChannelKey, string>;
  /** 需要哪几个槽 */
  slots: { id: string; label: string; hint: string }[];
  plan: ChanPlan4;
  /** 规格备忘，直接印在界面上 */
  specs: string[];
  /** 这个预设能不能精确复现，还是只能给个起点 */
  confidence: 'measured' | 'reference';
  note: string;
};

const zzzPlan = (): ChanPlan4 => ({
  r: {
    ...makeChanPlan('高光 / 自发光，取 _A 的 G'),
    slot: 'a', ch: 'g', upscale: 'bilinear'
  },
  g: {
    ...makeChanPlan('法线 B 通道，取 _N 的 B。_N 常是主贴图的 1/2 分辨率'),
    slot: 'n', ch: 'b', upscale: 'lanczos'
  },
  b: {
    ...makeChanPlan('金属度，取 _M 的 B'),
    slot: 'm', ch: 'b', upscale: 'bilinear'
  },
  a: makeChanPlan('固定 1', 255)
});

const hsrPlan = (): ChanPlan4 => ({
  r: { ...makeChanPlan('高光 / 反射'), constant: 255 },
  g: { ...makeChanPlan('阴影基调，中性 0.4'), constant: 102 },
  b: { ...makeChanPlan('金属度'), constant: 0 },
  a: { ...makeChanPlan('Ramp 层 / 材质区'), constant: 0 }
});

/**
 * 原神的通道计划。
 *
 * **不预设量化档位。** 早先这里给 G 写了 `levels: [0, 128]`、A 写了五档，
 * 依据是"量下来是离散的"。自己拿 tools/probe_maps.py 复量了一遍样本，
 * 发现这个说法站不住：
 *
 *   Odette  Body_Lightmap 1024²   G 有 142 个不同取值，63.5% 落在 0.50，其余跨满整范围
 *   木偶    Body_Lightmap 1024²   G 有 140 个不同取值，59.8% 落 0.00 / 32.1% 落 0.50
 *   Odette  A 有 256 个取值，25.0% 落 0.30、20.8% 落 1.00、15.7% 落 0.00
 *   木偶    A 有 256 个取值，73.2% 落 0.00、22.0% 落 1.00
 *
 * 也就是：**"0.50 是中性"这条成立，但"离散成固定几档"这条不成立** ——
 * 两张样本的分布完全不一样，而且都不是 {0,64,128,191,255}。
 * 硬套一个档位表会把用户自己的图改坏，所以默认不量化，档位留给用户在界面上按图定。
 */
const giPlan = (): ChanPlan4 => ({
  r: { ...makeChanPlan('高光 / 反射'), constant: 0 },
  g: { ...makeChanPlan('阴影基调，中性 0.50'), constant: 128 },
  b: { ...makeChanPlan('金属度'), constant: 0 },
  a: { ...makeChanPlan('Ramp 层 / 材质区'), constant: 0 }
});

/**
 * msToon 控制图（原神 / 星铁）：把 lightmap 打包成 msToon 要的形状。
 *
 * 三条映射是**本工程自己量的**：在同一目录里拿"输入 → 产物"的配对逐像素比出来的，
 * 全部数字见 `docs/产物配对实测.md`：
 *
 *   G ← 源 lightmap 的 **B**            逐像素相同
 *   B ← 源 lightmap 的 **G**，按 [0, hi] 归一化后反相，**截断**取整
 *   R ≡ 0、A ≡ 1
 *
 * `hi` 是那个产物里**手填的窗口**（不是自动找的 min/max）：
 * 原神 body 实测 128 能 100% 复现，星铁 ≈72.857。
 *
 * 为什么写 `lo = 255 − hi`、而不是直接给窗口：`applyPlan` 是**先 invert 再 stretch**，
 * 代进去 `(255 − G − lo) / (255 − lo) · 255`，要它等于 `255·(1 − G/hi)` 就得这么填。
 */
const mstoonLightmapPlan = (hi: number): ChanPlan4 => ({
  r: makeChanPlan('恒 0', 0),
  g: { ...makeChanPlan('阴影基调，取源 lightmap 的 B'), slot: 'lm', ch: 'b', upscale: 'bilinear' },
  b: {
    ...makeChanPlan('高光 / 分层，取源 lightmap 的 G 反相'),
    slot: 'lm',
    ch: 'g',
    invert: true,
    stretch: 'manual',
    lo: 255 - hi,
    hi: 255,
    round: 'floor'
  },
  a: makeChanPlan('恒 1', 255)
});

export const GAMES: GamePreset[] = [
  {
    id: 'zzz',
    name: '绝区零',
    confidence: 'measured',
    roles: {
      r: '_A 的 G',
      g: '_N 的 B（法线）',
      b: '_M 的 B',
      a: '固定 1'
    },
    slots: [
      { id: 'a', label: '_A', hint: '自发光 / 遮罩' },
      { id: 'm', label: '_M', hint: '材质' },
      { id: 'n', label: '_N', hint: '法线，通常是半分辨率' }
    ],
    plan: zzzPlan(),
    specs: [
      'LM.R = _A 的 G 通道，逐字节精确',
      'LM.G = _N 的 B 通道，放大核决定精度',
      'LM.B = _M 的 B 通道，逐字节精确',
      'LM.A = 1'
    ],
    note:
      '这套是从样本上逐通道量出来的：R 和 B 逐字节精确（MAE 0.000）。G 要放大，' +
      '拿真值 LM 的 G 当参照四个核各跑一遍（tools\\zzz-kernel.py，两套 Body 配对）：' +
      '最邻近 MAE 0.533 / 1.056、双线性 0.299 / 0.584、双三次 0.144 / 0.260、' +
      'lanczos 0.131 / 0.243。所以 _N 默认走 lanczos。' +
      '「完全相同比例」这个指标在这条通道上会骗人（最邻近 84% / 73%，看着不低），' +
      '因为它只奖励"没动常量区"，而残差的大头是放大前就丢掉的高频。看 MAE。'
  },
  {
    id: 'hsr',
    name: '崩坏：星穹铁道',
    confidence: 'reference',
    roles: {
      r: '高光 / 反射',
      g: '阴影基调',
      b: '金属度',
      a: 'Ramp 层 / 材质区'
    },
    slots: [
      { id: 'r', label: '高光遮罩', hint: '推 R 用' },
      { id: 'g', label: '阴影遮罩', hint: '推 G 用' },
      { id: 'b', label: '金属遮罩', hint: '推 B 用' },
      { id: 'a', label: 'Ramp 层遮罩', hint: '推 A 用' }
    ],
    plan: hsrPlan(),
    specs: [
      'R 高光 / 反射，中性值 1.0',
      'G 阴影基调，中性值 0.4',
      'B 金属度，中性值 0.0',
      'A Ramp 层 / 材质区',
      '尺寸跟随 diffuse，可为非正方形'
    ],
    note:
      '星铁这套是**手画的**，没有从 diffuse 自动推的算法。预设给的是中性值和通道含义，' +
      '四路各自默认走常量，你把遮罩接上去才有内容。中性值来自 爻光Body 的规格探测。'
  },
  {
    id: 'gi',
    name: '原神',
    confidence: 'reference',
    roles: {
      r: '高光 / 反射',
      g: '阴影基调',
      b: '金属度',
      a: 'Ramp 层 / 材质区'
    },
    slots: [
      { id: 'r', label: '高光遮罩', hint: '推 R 用' },
      { id: 'g', label: '阴影遮罩', hint: '推 G 用' },
      { id: 'b', label: '金属遮罩', hint: '推 B 用' },
      { id: 'a', label: 'Ramp 层遮罩', hint: '推 A 用' }
    ],
    plan: giPlan(),
    specs: [
      'R 高光 / 反射',
      'G 阴影基调，中性 0.50',
      'B 金属度',
      'A Ramp 层 / 材质区',
      '1024×1024'
    ],
    note:
      '原神这套是**手画的**，没有从 diffuse 自动推的算法，所以只给通道含义和中性值。' +
      '下面的数是 `tools/aggregate_maps.py` 扫 `贴图处理训练样本` 全量算出来的（81 张 Body lightmap、81 张 Hair、167 张 Shadow_Ramp）：\n' +
      '· G 的中性就是 **0.50** —— 81 张里有 75 张最常见的档位是 0.50，平均占 54.5% 的像素\n' +
      '· 但 G **不是离散的**：唯一值中位数 145，只是 83.9% 的像素吸附在 0.05 网格上。' +
      '硬套两档会把自己画的图改坏，所以这里**不预设量化**\n' +
      '· R 在 81 张里有 75 张最常见档位是 0.00；B 没有统一的共性\n' +
      '· Shadow_Ramp 那边 R 和 G 的亮端都是 1.00（143 / 167 张），这是唯一一条全样本一致的\n' +
      '· 同一批样本里不同角色分布仍然差别很大，所以档位留给你按自己那张图定'
  },

  /* ---------------- msToon 控制图（照着素材里真实产物的配对对出来的） ---------------- */

  /* 下面三条不是"游戏"，是 ④ 借用的打包模板。⑦ 的选择器按 `kind` 过滤掉它们 */
  {
    id: 'mstoon-gi',
    name: 'msToon 控制图 · 原神',
    kind: 'map',
    roles: {
      r: '恒 0',
      g: '阴影基调 ← 源 lightmap 的 B',
      b: '高光 / 分层 ← 源 lightmap 的 G 反相',
      a: '恒 1'
    },
    slots: [{ id: 'lm', label: 'Body / Hair Lightmap', hint: '原神那套 lightmap，取它的 B 和 G' }],
    plan: mstoonLightmapPlan(128),
    specs: [
      'G ← 源 lightmap 的 B（逐像素相同，验过）',
      'B ← 源 lightmap 的 G，按 [0, 128] 归一化后反相，截断取整',
      'R 恒 0，A 恒 1',
      '窗口 128 就是产物里填的那个值 —— 实测这张图 LUT 100% 对得上'
    ],
    confidence: 'measured',
    note:
      '这是**逐像素对出来的**，不是推的：拿同一目录里的源图和产物逐通道比，' +
      '`GI_Converted_*_Lightmap` 的 G 就等于源 lightmap 的 B（逐像素相同），' +
      'B 是源 G 的确定性映射 `floor(255·(1 − G/hi))`。\n' +
      '**窗口是产物里手填的参数**，不是自动找的 —— 这张那张不一样。' +
      '原神 body 实测 hi=128 能 100% 复现；换别的贴图自己调 lo/hi（plan 里写的是 `lo = 255 − hi`）。\n' +
      '依据与全部数字：`docs/产物配对实测.md`。'
  },
  {
    id: 'mstoon-hsr',
    name: 'msToon 控制图 · 星铁',
    kind: 'map',
    roles: {
      r: '恒 0',
      g: '阴影基调 ← 源 lightmap 的 B',
      b: '高光 / 分层 ← 源 lightmap 的 G 反相',
      a: '恒 1'
    },
    slots: [{ id: 'lm', label: 'Body / Hair LightMap', hint: '星铁那套 lightmap' }],
    plan: mstoonLightmapPlan(255 / 3.5),
    specs: [
      'G ← 源 lightmap 的 B（逐像素相同，验过）',
      'B ← 源 lightmap 的 G 反相，窗口 ≈72.857（斜率正好 3.5）',
      'R 恒 0，A 恒 1'
    ],
    confidence: 'reference',
    note:
      '跟原神同一条路，差别只在 B 那个窗口值 —— 正好是需求里说的"B 通道最小最大映射值的调整"。\n' +
      '**这个窗口每张贴图不一样，是那份产物里手填的参数**：两组样本量下来\n' +
      'body 是 255/3.5 = 72.857142…（约束正好收在这个值上），hair 是 85。\n' +
      '模板默认给 body 那个值，hair 自己把 lo 改成 255 − 85 = 170。\n' +
      '**四个星铁用例都只差 1 级**，那是浮点造成的：`255 − 6×3.5` 在 double 下是 233.999…，\n' +
      'floor 得 233（实测就是 233）；换个运算顺序就会落到 234 那一边。\n' +
      '要逐像素复现就得连它那一步的浮点算式一起复刻 —— 1/255 的差，不值当，所以标"参考"。'
  },
  {
    id: 'mstoon-zzz',
    name: 'msToon 控制图 · 绝区零',
    kind: 'map',
    roles: {
      r: '恒 0',
      g: '阴影基调 ← _M 的 G',
      b: '恒 0',
      a: '恒 1'
    },
    slots: [{ id: 'm', label: '_M（金属度 / 阴影图）', hint: '绝区零那套三件套里的 _M' }],
    plan: {
      r: makeChanPlan('恒 0', 0),
      g: { ...makeChanPlan('阴影基调，取 _M 的 G'), slot: 'm', ch: 'g', upscale: 'bilinear' },
      b: makeChanPlan('恒 0', 0),
      a: makeChanPlan('恒 1', 255)
    },
    specs: [
      'G ← _M 的 G（逐像素相同，验过）',
      'R 恒 0，B 恒 0，A 恒 1',
      '**B 不映射** —— 跟原神 / 星铁那两套不一样'
    ],
    confidence: 'measured',
    note:
      '逐像素对出来的：`ZZZ_Converted_Body` / `_Hair` 的 G 就是 `_M` 的 G，R 和 B 都恒 0、A 恒 1。' +
      '绝区零这组 **B 不做那个窗口映射**，别跟原神星铁混。\n' +
      '那组里 Body 和 Hair 用的是同一张 `_M`，所以两张产物字节完全相同 —— ' +
      '这里只给一条模板，Body / Hair 各跑一次即可。\n' +
      '依据：`docs/产物配对实测.md`。'
  }
];

/**
 * ⑦「哪一套」那个选择器只该列**游戏**。
 *
 * 三条 msToon 控制图模板（`kind: 'map'`）住在这个数组里是被 ④ 借用的，
 * 它们不是"游戏"，也没有 `a/m/n` 那套通道计划 —— 列进选择器点了必然没反应
 * （界面上表现为"点了不动、也不报错"）。
 */
export const GAME_PRESETS: GamePreset[] = GAMES.filter(isGame);

/** ④ 借用的那三条打包模板 */
export const MAP_PRESETS: GamePreset[] = GAMES.filter((g) => !isGame(g));

/* ============================================================
   6. 平面工具
   ============================================================ */

/** 量化到给定档位（0-255）。level 列表会被排序 */
export function quantize(plane: Uint8ClampedArray, levels: number[]): Uint8ClampedArray {
  if (!levels.length) return plane;
  const ls = [...levels].sort((a, b) => a - b);
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let best = ls[0];
    let bd = Infinity;
    for (const l of ls) {
      const d = Math.abs(i - l);
      if (d < bd) {
        bd = d;
        best = l;
      }
    }
    lut[i] = best;
  }
  for (let i = 0; i < plane.length; i++) plane[i] = lut[plane[i]];
  return plane;
}

/** 上下限拉伸 */
export function stretchPlane(
  plane: Uint8ClampedArray,
  mode: 'none' | 'auto' | 'manual',
  lo: number,
  hi: number,
  round: 'half-even' | 'floor' = 'half-even'
): Uint8ClampedArray {
  if (mode === 'none') return plane;
  let a = lo;
  let b = hi;
  if (mode === 'auto') {
    let mn = 255;
    let mx = 0;
    for (let i = 0; i < plane.length; i++) {
      const v = plane[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    a = mn;
    b = mx;
  }
  const span = b - a || 1;
  for (let i = 0; i < plane.length; i++) {
    const v = ((plane[i] - a) / span) * 255;
    // 直接赋浮点给 Uint8ClampedArray 是**半偶数取整**。
    // 那份产物用的是**截断**，只在恰好的 .5 上不一样，
    // 想逐像素复现就得走 'floor' —— 依据见 docs/产物配对实测.md 第 2 节。
    plane[i] = round === 'floor' ? Math.floor(v) : v;
  }
  return plane;
}

/**
 * 按一套通道方案把来源拼成一张图。
 *
 * 跟 img.ts 的 pack 的区别：这一版每路能单独选放大核、能量化到档位、能拉伸。
 * 游戏预设需要这些 —— 尤其"_N 是半分辨率，必须用最邻近放大"这一条，
 * 用双线性会插出一堆中间值，实测精度掉一大截。
 */
export function applyPlan(
  w: number,
  h: number,
  plan: ChanPlan4,
  sources: Map<string, ImageData>
): ImageData {
  const out = blankImageData(w, h);
  const d = out.data;
  const planes: Uint8ClampedArray[] = [];

  for (const k of CHANNEL_KEYS) {
    const p = plan[k];
    if (!p.slot) {
      const arr = new Uint8ClampedArray(w * h);
      arr.fill(字节值(p.constant));
      planes.push(p.levels ? quantize(arr, p.levels) : arr);
      continue;
    }
    const img = sources.get(p.slot);
    if (!img) {
      const arr = new Uint8ClampedArray(w * h);
      arr.fill(字节值(p.constant));
      planes.push(arr);
      continue;
    }
    const use = img.width === w && img.height === h ? img : resize(img, w, h, p.upscale);
    const arr = extractChannel(use, p.ch, p.invert);
    stretchPlane(arr, p.stretch, p.lo, p.hi, p.round);
    if (p.levels) quantize(arr, p.levels);
    planes.push(arr);
  }

  const [pr, pg, pb, pa] = planes;
  for (let i = 0; i < w * h; i++) {
    const o = i << 2;
    d[o] = pr[i];
    d[o + 1] = pg[i];
    d[o + 2] = pb[i];
    d[o + 3] = pa[i];
  }
  return out;
}

/** 某一路的源尺寸跟目标对不对得上，界面上要提示 */
export function sizeMismatch(
  plan: ChanPlan4,
  sources: Map<string, ImageData>,
  w: number,
  h: number
): { label: string; size: string; upscale: ScaleMode }[] {
  const out: { label: string; size: string; upscale: ScaleMode }[] = [];
  const seen = new Set<string>();
  for (const k of CHANNEL_KEYS) {
    const p = plan[k];
    if (!p.slot || seen.has(p.slot)) continue;
    seen.add(p.slot);
    const img = sources.get(p.slot);
    if (img && (img.width !== w || img.height !== h)) {
      out.push({ label: p.slot, size: `${img.width}×${img.height}`, upscale: p.upscale });
    }
  }
  return out;
}

/* `planeToGray` 删了：它就是 `img.grayToImageData` 的一层空壳（函数体只有一句 return），
   调用处直接用 `grayToImageData`。去重那一条清单里的第 ③ 项。 */

export { CHANNEL_KEYS, CHANNEL_LABEL };
export type { ChannelKey };
