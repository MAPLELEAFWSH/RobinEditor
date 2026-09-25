/**
 * 渐变条的色标运算（Blender ColorRamp 那种：位置 0-1 + 明度）。
 *
 * 为什么单独一个文件：这几个函数是"点了加点 / 拖了挪位 / 删到只剩两个"的全部规则，
 * 错一个界面上都看不出来（就是"手感怪"），而它们全是纯函数 —— 放这儿能直接跑套件。
 *
 * 明度就是 `img.ts` 的曲线控制点 y，位置就是它的 x：**同一组点，换一种画法**。
 * 所以这里不另存一份状态，是拿 `CurvePoint[]` 进出的。
 *
 * 插值不在这儿实现：直接用 `img.ts` 的 `evalCurve(stops, x, kind)` ——
 * 七种插值（线性 / 缓动 / 样条 / 阶梯…）那边已经有一份，
 * 再写一份就会跟曲线页分叉，而那种分叉在界面上看不出来。
 */
import { evalCurve, type CurveKind, type CurvePoint } from '$lib/img';

/** 色标最少留几个。低于这个数就不是渐变了 */
export const MIN_STOPS = 2;
/** 两个色标之间至少留的间距。挤在一起时后面的段算不出来 */
export const MIN_GAP = 0.01;
/** 键盘一次微调多少（一次 1/255） */
export const NUDGE = 1 / 255;

/**
 * 键盘一步的步长。**四个编辑面板都走这一处**。
 *
 * 原来它们各写各的常量：贝塞尔手柄与曲线页是 `0.01`（Shift `0.05`）、
 * ikClut 那条曲线是 `0.005`、渐变条用的是这里的 `1/255` ——
 * 同一个手势在三页差 2.5 倍。2026-09-20 用户定：**统一到 1/255**
 * （推一格正好动一个色阶，只有它有物理意义），Shift 仍然 ×10 跨大步。
 */
export function 步长(e: { shiftKey: boolean }): number {
  return NUDGE * (e.shiftKey ? 10 : 1);
}

/**
 * 把控制点连成折线时采几个点。
 *
 * 原来三份：渐变条 128、曲线页 96、调整页 64 —— 同一套插值画出来疏密不一样。
 * 统一到 128（最密那份，七种插值都画得对）。
 */
export const 折线采样 = 128;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 按位置排好。界面上永远按排好的顺序画 */
export function sortStops(stops: CurvePoint[]): CurvePoint[] {
  return [...stops].map((s) => ({ x: clamp01(s.x), y: clamp01(s.y) })).sort((a, b) => a.x - b.x);
}

/**
 * 在 x 处加一个色标，明度按当前位置插值取。
 *
 * 位置撞上已有的色标就返回 null —— 不加，也不挪原来那个
 * （"点空白处加点"，点到色标上是选中它，不是加点）。
 */
export function addStopAt(
  stops: CurvePoint[],
  x: number,
  kind: CurveKind
): { stops: CurvePoint[]; index: number } | null {
  const at = clamp01(x);
  const list = sortStops(stops);
  if (list.some((s) => Math.abs(s.x - at) < MIN_GAP / 2)) return null;
  const y = clamp01(evalCurve(list, at, kind));
  const next = [...list, { x: at, y }].sort((a, b) => a.x - b.x);
  return { stops: next, index: next.findIndex((s) => s.x === at) };
}

/**
 * 挪一个色标的位置。
 *
 * 两端锁死在 0 / 1（跟曲线页一致），中间的夹在左右邻居之间、留 `MIN_GAP`。
 * `index` 是**排好序之后**的下标。
 */
export function moveStop(stops: CurvePoint[], index: number, x: number): CurvePoint[] {
  const list = sortStops(stops);
  if (index < 0 || index >= list.length) return list;
  const last = list.length - 1;
  if (index === 0) return list.map((s, i) => (i === 0 ? { ...s, x: 0 } : s));
  if (index === last) return list.map((s, i) => (i === last ? { ...s, x: 1 } : s));
  const lo = list[index - 1].x + MIN_GAP;
  const hi = list[index + 1].x - MIN_GAP;
  const at = Math.min(hi, Math.max(lo, clamp01(x)));
  return list.map((s, i) => (i === index ? { ...s, x: at } : s));
}

/** 改一个色标的明度。超范围就夹住 */
export function setStopValue(stops: CurvePoint[], index: number, y: number): CurvePoint[] {
  const list = sortStops(stops);
  if (index < 0 || index >= list.length) return list;
  return list.map((s, i) => (i === index ? { ...s, y: clamp01(y) } : s));
}

/**
 * 删一个色标。**剩两个时不许再删** —— 一个点画不出渐变。
 * 删不掉就原样返回，调用方拿 `length` 比一下就知道成没成。
 */
export function removeStop(stops: CurvePoint[], index: number): CurvePoint[] {
  const list = sortStops(stops);
  if (list.length <= MIN_STOPS) return list;
  if (index < 0 || index >= list.length) return list;
  return list.filter((_, i) => i !== index);
}

/**
 * 键盘微调。`dpos` / `dval` 各是一次要加的量。
 * 位置和明度各走各自的夹取规则 —— 位置还受邻居约束。
 */
export function nudgeStop(
  stops: CurvePoint[],
  index: number,
  dpos: number,
  dval: number
): CurvePoint[] {
  const list = sortStops(stops);
  if (index < 0 || index >= list.length) return list;
  const moved = dpos ? moveStop(list, index, list[index].x + dpos) : list;
  return dval ? setStopValue(moved, index, moved[index].y + dval) : moved;
}

/** 离 x 最近的那个色标。量上的"点到了哪个色标"用它，阈值由调用方判 */
export function nearestStop(stops: CurvePoint[], x: number): { index: number; dist: number } {
  const list = sortStops(stops);
  let index = 0;
  let dist = Infinity;
  for (let i = 0; i < list.length; i++) {
    const d = Math.abs(list[i].x - x);
    if (d < dist) {
      dist = d;
      index = i;
    }
  }
  return { index, dist };
}

/**
 * 画条子用的 CSS 渐变。
 *
 * 「常量」「阶梯」是硬切，插值器本身就不连续，所以这两档每段再加一个同色的停止点，
 * 让条子上看到的形状跟导出的一致 —— 不然条子是斜的、导出来是台阶。
 */
export function cssGradient(stops: CurvePoint[], kind: CurveKind): string {
  const list = sortStops(stops);
  if (!list.length) return 'linear-gradient(90deg, #000, #fff)';
  const hard = kind === 'constant' || kind === 'step';
  const parts: string[] = [];
  const gray = (y: number) => {
    const v = Math.round(clamp01(y) * 255);
    return `rgb(${v},${v},${v})`;
  };
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (hard && i > 0) {
      /* 硬切：上一段的颜色一直铺到这一格为止，再切到这一格的颜色。
         阶梯的跳点在段中点，常量的跳点在左端 —— 跟 evalCurve 里那两档一致 */
      const prev = list[i - 1];
      const cut = kind === 'step' ? (prev.x + s.x) / 2 : s.x;
      parts.push(`${gray(prev.y)} ${(cut * 100).toFixed(3)}%`);
      parts.push(`${gray(s.y)} ${(cut * 100).toFixed(3)}%`);
    } else {
      parts.push(`${gray(s.y)} ${(s.x * 100).toFixed(3)}%`);
    }
  }
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

/** 明度 → 给界面上看的那行字 */
export function fmtValue(y: number): string {
  return String(Math.round(clamp01(y) * 255));
}

/** 位置 → 给界面上看的那行字 */
export function fmtPos(x: number): string {
  return `${Math.round(clamp01(x) * 100)}%`;
}
