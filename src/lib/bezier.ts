/**
 * 贝塞尔曲线编辑器用的数学。对应 Blender 的 **RGB Curves 节点**。
 *
 * 跟 `img.ts` 里的 `evalCurve` 是两套东西，别混：
 *   evalCurve   整条曲线用一种插值方式（那是 Color Ramp 节点的做法）
 *   evalBezier  每个控制点带左右两个手柄，段与段之间靠手柄接（RGB Curves 的做法）
 *
 * 手柄的自动计算照 Blender 的 AUTO_CLAMPED 来 —— 这个是重点：
 * 它**不会过冲**。相邻两段斜率异号（曲线要走回头路）时手柄直接压平，
 * 同号时取绝对值小的那个。所以"自动"不会拉出鼓包，
 * 想鼓包必须手动把手柄设成自由。
 *
 * 为什么单开一份而不改 `CurvePoint`：那个类型被 ② ikClut 的曲线页、
 * channels 的调整面板都在用，加字段会把它们全带上。这里保持纯净，只给新编辑器用。
 */

export type HandleMode = 'auto' | 'vector' | 'free';

export type BezPoint = {
  x: number;
  y: number;
  mode: HandleMode;
  /** 左手柄相对本点的偏移。mode 不是 free 时由自动算法覆盖 */
  inDx: number;
  inDy: number;
  /** 右手柄相对本点的偏移 */
  outDx: number;
  outDy: number;
};

export function bezPoint(x: number, y: number): BezPoint {
  return { x, y, mode: 'auto', inDx: -0.08, inDy: 0, outDx: 0.08, outDy: 0 };
}

/** 按 x 排序，并且保证 x 严格递增（重合的 x 会让求解区间退化） */
export function sortPoints(pts: BezPoint[]): BezPoint[] {
  const s = [...pts].sort((a, b) => a.x - b.x);
  for (let i = 0; i < s.length; i++) {
    s[i] = { ...s[i] };
    if (i > 0 && s[i].x <= s[i - 1].x) s[i].x = s[i - 1].x + 1e-4;
    s[i].x = Math.min(1, Math.max(0, s[i].x));
  }
  return s;
}

/** 算出手柄的实际偏移。auto / vector 是算出来的，free 用存的值 */
export function handleOf(
  pts: BezPoint[],
  i: number,
  side: 'in' | 'out'
): { dx: number; dy: number } {
  const p = pts[i];
  if (p.mode === 'free') {
    return side === 'in' ? { dx: p.inDx, dy: p.inDy } : { dx: p.outDx, dy: p.outDy };
  }
  const prev = pts[i - 1];
  const next = pts[i + 1];

  // 端点或者邻居缺失：朝相邻点直着伸出去（相当于线性）
  if (side === 'in') {
    if (!prev) return { dx: -0.05, dy: 0 };
    const dx = (p.x - prev.x) / 3;
    return p.mode === 'vector'
      ? { dx: -dx, dy: (-(p.y - prev.y)) / 3 }
      : { dx: -dx, dy: -clampedSlope(pts, i) * dx };
  }
  if (!next) return { dx: 0.05, dy: 0 };
  const dx = (next.x - p.x) / 3;
  return p.mode === 'vector'
    ? { dx, dy: (next.y - p.y) / 3 }
    : { dx, dy: clampedSlope(pts, i) * dx };
}

/**
 * Blender 的 AUTO_CLAMPED 斜率。
 *
 * 左右两段的斜率如果异号（或者有一边是平的），说明这个点是个"拐点"或极值点，
 * 手柄压平 —— 不然曲线会先冲过头再回来，在 ramp 上就是亮部忽然变暗。
 * 同号就取绝对值小的那个，同样是为了不过冲。
 *
 * **端点上不能压平。** 一开始写成"两边缺一个就返回 0"，结果两点对角的直线
 * 被拉成了 S 形（实测偏 24.54/255）—— 因为首点右手柄被压成水平、末点左手柄
 * 也被压成水平，一条直线愣是给鼓起来了。Blender 在端点上是直指邻居的。
 * 所以缺哪边就退回"到那一侧邻居的直接斜率"。
 */
function clampedSlope(pts: BezPoint[], i: number): number {
  const p = pts[i];
  const prev = pts[i - 1];
  const next = pts[i + 1];
  if (!prev && !next) return 0;
  // 端点：直接朝唯一的那个邻居
  if (!prev) return (next.y - p.y) / Math.max(1e-6, next.x - p.x);
  if (!next) return (p.y - prev.y) / Math.max(1e-6, p.x - prev.x);

  const ls = (p.y - prev.y) / Math.max(1e-6, p.x - prev.x);
  const rs = (next.y - p.y) / Math.max(1e-6, next.x - p.x);
  if (ls === 0 || rs === 0) return 0;
  if (ls < 0 !== rs < 0) return 0;
  return Math.abs(ls) < Math.abs(rs) ? ls : rs;
}

/** 三次贝塞尔的单轴求值 */
function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

/**
 * 求 y(x)。
 *
 * 贝塞尔的 x 也是 t 的三次函数，不是线性的，所以不能直接拿 (x-x0)/(x1-x0) 当 t。
 * 这里在 [0,1] 上对 x(t) 做二分 —— 30 次相当于是精确解，
 * 而且比牛顿法稳（手柄被拖出负 x 偏移时牛顿会发散）。
 */
export function evalBezier(ptsRaw: BezPoint[], x: number): number {
  const pts = sortPoints(ptsRaw);
  if (pts.length === 0) return x;
  if (pts.length === 1) return pts[0].y;
  if (x <= pts[0].x) return pts[0].y;
  if (x >= pts[pts.length - 1].x) return pts[pts.length - 1].y;

  let i = 0;
  while (i < pts.length - 2 && x > pts[i + 1].x) i++;
  const a = pts[i];
  const b = pts[i + 1];
  const oa = handleOf(pts, i, 'out');
  const ib = handleOf(pts, i + 1, 'in');

  const x1 = a.x, x2 = a.x + oa.dx, x3 = b.x + ib.dx, x4 = b.x;
  const y1 = a.y, y2 = a.y + oa.dy, y3 = b.y + ib.dy, y4 = b.y;

  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (cubic(x1, x2, x3, x4, mid) < x) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  const v = cubic(y1, y2, y3, y4, t);
  // LUT 是 8 位的，值域必须夹在 0-1；手柄拖出界会让贝塞尔过冲
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 烘成 256 项查表，逐像素用 */
export function bakeBezier(pts: BezPoint[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = evalBezier(pts, i / 255) * 255;
  return lut;
}

/** 画曲线用的 SVG path。采样够密，手柄拉出来的形状都能还原 */
export function bezierPath(ptsRaw: BezPoint[], size = 100, samples = 128): string {
  const pts = sortPoints(ptsRaw);
  if (pts.length < 2) return '';
  let d = '';
  for (let i = 0; i <= samples; i++) {
    const x = i / samples;
    const y = evalBezier(pts, x);
    d += `${i === 0 ? 'M' : 'L'}${(x * size).toFixed(2)} ${((1 - y) * size).toFixed(2)} `;
  }
  return d.trim();
}

/** 手柄连线的落点，画那两条小尾巴用 */
export function handleAnchor(ptsRaw: BezPoint[], i: number, side: 'in' | 'out') {
  const pts = sortPoints(ptsRaw);
  const p = pts[i];
  const h = handleOf(pts, i, side);
  return { x: p.x + h.dx, y: p.y + h.dy };
}

/** 把一个点的手柄模式往下切一格，跟 Blender 点右键循环手柄类型是一个意思 */
export const HANDLE_CYCLE: HandleMode[] = ['auto', 'vector', 'free'];

export const HANDLE_LABEL: Record<HandleMode, string> = {
  auto: '自动',
  vector: '矢量',
  free: '自由'
};

export const HANDLE_HINT: Record<HandleMode, string> = {
  auto: '两端手柄按邻居算，且不过冲（Blender 的 AUTO_CLAMPED）。默认就是这个。端点上直指邻居，所以两点对角就是一条直线。',
  vector: '手柄直指相邻点，这一段变直线、拐点变尖。',
  free: '手柄各走各的，能自由控制出入的陡缓。注意输出仍然夹在 0-1 —— LUT 是 8 位的，越界的值存不进去，所以"过冲"只能体现成曲线在 0-1 之内的快慢变化。'
};

export type Clip = { x: boolean; y: boolean };

/**
 * 按 clip 设置夹住点的位置。
 * y 是永远夹的（LUT 不能越界），x 夹不夹由用户定 ——
 * 不夹的时候点可以拖到 0 左边，用来做"整段提前到达"。
 */
export function clipPoint(p: BezPoint, clip: Clip): BezPoint {
  const out = { ...p };
  out.y = Math.min(1, Math.max(0, out.y));
  if (clip.x) out.x = Math.min(1, Math.max(0, out.x));
  return out;
}
