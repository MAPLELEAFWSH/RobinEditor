/**
 * ② 那几个新节点共用的色彩数学。纯函数，不碰 DOM。
 *
 * 放在这儿而不是各自抄一份：色相、饱和、色度旋转这些东西一旦有两份实现，
 * 两边的取整/夹断方式迟早会差一点，然后"同一个色相在两个节点里算出不同结果"
 * 这种问题根本没法查。旋转的算式在 `img.ts` 的 `绕灰轴`（那边是唯一一份）。
 *
 * 口径统一：**输入输出都是 0~1 的浮点**，字节的换算在节点那一层做。
 */

/** Rec.709 亮度（跟 `img.ts` 里那几处同一个系数）。输入 0~1 */
export function 亮度(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 按亮度分三段的权重，写进 `out`（顺序：暗 / 中 / 高），**三者恒和 1**。
 *
 * 边界取 0.15~0.45 与 0.55~0.85，中间那段正好落在 0.45~0.55 之间不受影响：
 * 两段的范围不重叠，所以 `中 = 1 - 暗 - 高` 不会出负数，和也就是 1。
 */
export function 三段权重(L: number, out: [number, number, number]): void {
  const 暗 = 1 - 平滑(L, 0.15, 0.45);
  const 高 = 平滑(L, 0.55, 0.85);
  out[0] = 暗;
  out[1] = 1 - 暗 - 高;
  out[2] = 高;
}

/** smoothstep，边缘平滑那一段用 */
export function 平滑(x: number, a: number, b: number): number {
  if (b <= a) return x < a ? 0 : 1;
  const t = (x - a) / (b - a);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/**
 * 色相 + 饱和度一次算出来（写进 `out`：`out[0]` 色相、`out[1]` 饱和）。
 *
 * 热循环里要两个都得要的时候，分开算等于把 max/min 各算两遍。
 * 变形那个节点每个像素都要这一对，省下来的是真金白银（实测占它一成的开销）。
 *
 * 这里只有这一条：早先还导出过"只算色相""只算饱和"两个版本，全工程零调用方
 * （没有生产方、也没有测试拿它们当对照），按"不留死码"删了。
 */
export function 色相饱和(r: number, g: number, b: number, out: [number, number]): void {
  const max = r > g ? (r > b ? r : b) : g > b ? g : b;
  const min = r < g ? (r < b ? r : b) : g < b ? g : b;
  const d = max - min;
  out[1] = max <= 0 ? 0 : d / max;
  if (d <= 0) {
    out[0] = 0;
    return;
  }
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  out[0] = h < 0 ? h + 360 : h;
}

/**
 * 给定色相，取一个**单位化的色度方向**（三通道各减自己的亮度，再归一化）。
 *
 * 色轮用它："朝这个色相推"就是沿这个方向加色度 —— 灰的地方也会被推上色，
 * 这正是色轮该有的样子（纯旋转对灰色没有作用，灰永远是灰）。
 */
export function 色度方向(h: number, out: [number, number, number]): void {
  const t = (((h % 360) + 360) % 360) / 60;
  const i = Math.floor(t);
  const f = t - i;
  /* HSV(色相, 1, 1) 的六个顶点，按段插出中间值 */
  const 表: [number, number, number][] = [
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 1, 1],
    [0, 0, 1],
    [1, 0, 1]
  ];
  const a = 表[i % 6];
  const b = 表[(i + 1) % 6];
  const r = a[0] + (b[0] - a[0]) * f;
  const g = a[1] + (b[1] - a[1]) * f;
  const bl = a[2] + (b[2] - a[2]) * f;
  const L = 亮度(r, g, bl);
  let dr = r - L;
  let dg = g - L;
  let db = bl - L;
  const 长 = Math.hypot(dr, dg, db) || 1;
  dr /= 长;
  dg /= 长;
  db /= 长;
  out[0] = dr;
  out[1] = dg;
  out[2] = db;
}

/** 两个色相角之间的最短角距（0~180） */
export function 环距(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/**
 * 正余弦查表：**0.25° 一格**，覆盖一整圈。
 *
 * 角度在热循环里是逐像素变的，每个像素调两次三角函数太贵（变形那个节点
 * 一半的时间花在这上面）。表是模块级建一次的，跟参数无关，所以是零边际成本。
 * 0.125° 的量化肉眼看不出来（色相环一共 360°）。
 */
const 角度格 = 0.25;
const 正余弦 = (() => {
  const n = Math.round(360 / 角度格);
  const c = new Float64Array(n);
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i * 角度格 * Math.PI) / 180;
    c[i] = Math.cos(a);
    s[i] = Math.sin(a);
  }
  return { c, s, n };
})();

/** 查 `度`（可负、可超一圈）对应的 cos / sin，写进 `out` */
export function 查正余弦(度: number, out: [number, number]): void {
  let a = 度 % 360;
  if (a < 0) a += 360;
  const i = Math.round(a / 角度格) % 正余弦.n;
  out[0] = 正余弦.c[i];
  out[1] = 正余弦.s[i];
}

/**
 * 某一段（中心 `中心` 度、半宽 `半宽` 度）在这个色相上的权重，0~1。
 *
 * 用平滑的三角下降（不是硬边）：硬边会在段与段之间留下一道可见的接缝，
 * 色相从红走到橙的时候那条边会跳一下。
 */
export function 段权重(色相: number, 中心: number, 半宽: number): number {
  if (半宽 <= 0) return 0;
  const d = 环距(色相, 中心);
  if (d >= 半宽) return 0;
  return 1 - 平滑(d, 半宽 * 0.5, 半宽);
}

/**
 * 双线性取一格网格。`网格` 是 `边×边` 的行优先数组，`x`/`y` 是 0~1。
 *
 * 色彩变形那两张二维网格用它。边上按夹断处理（表外面没有数据）。
 */
export function 采格(网格: Float64Array, 边: number, x: number, y: number): number {
  const n = 边 - 1;
  const fx = x <= 0 ? 0 : x >= 1 ? n : x * n;
  const fy = y <= 0 ? 0 : y >= 1 ? n : y * n;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(n, x0 + 1);
  const y1 = Math.min(n, y0 + 1);
  const dx = fx - x0;
  const dy = fy - y0;
  const a = 网格[y0 * 边 + x0];
  const b = 网格[y0 * 边 + x1];
  const c = 网格[y1 * 边 + x0];
  const d = 网格[y1 * 边 + x1];
  return a + (b - a) * dx + (c - a) * dy + (a - b - c + d) * dx * dy;
}
