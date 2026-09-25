/**
 * `.cube` 的解析与采样。纯逻辑，不碰 DOM。
 *
 * 格式是公开的（Adobe 那套 `.cube`），这里只按它的文本结构读，没搬任何实现：
 *   注释以 `#` 开头；`TITLE "..."`；`DOMAIN_MIN r g b` / `DOMAIN_MAX r g b`；
 *   `LUT_1D_SIZE n` 或 `LUT_3D_SIZE n`；然后是数据行，每行三个数。
 *
 * 1D 与 3D 的**数据行顺序不一样**，这是最容易写错的地方：
 *   · 3D：**红最先变**，然后绿，最后蓝（i = 蓝·n² + 绿·n + 红）
 *   · 1D：一行一个输入档，行里的 r g b 分别是三条通道在这一档的**输出**
 *
 * DOMAIN 是**输入**范围：不是 0~1 的话，采样前要先把输入映进去（格式规定）。
 */
import type { Lut, Lut1D, Lut3D } from './types';

export type CubeOk = { ok: true; lut: Lut; clamped: number };
export type CubeErr = { ok: false; error: string };
export type CubeResult = CubeOk | CubeErr;

/** 上限是防手滑：3D 64³ 已经是 78 万个字节，再大就不是给 ikClut 用的了 */
const 最大3D = 128;
const 最大1D = 65536;

function 数(s: string): number | null {
  /* 只认十进制小数，不认 1e-3（.cube 里没见过，认了反而把 "1e3" 这种错行吃进来） */
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

export function 解析Cube(text: string): CubeResult {
  let title = '';
  let size1d = 0;
  let size3d = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const 数据: number[][] = [];
  let 行号 = 0;

  for (const 原行 of text.split(/\r\n|\r|\n/)) {
    行号++;
    const 行 = 原行.trim();
    if (!行 || 行.startsWith('#')) continue;

    const 头 = 行.split(/\s+/);
    const 键 = 头[0].toUpperCase();

    if (键 === 'TITLE') {
      title = 行.slice(5).trim().replace(/^"|"$/g, '');
      continue;
    }
    if (键 === 'LUT_1D_SIZE' || 键 === 'LUT_3D_SIZE') {
      const n = 头.length === 2 ? 数(头[1]) : null;
      if (n === null || !Number.isInteger(n)) return { ok: false, error: `第 ${行号} 行：${头[0]} 后面不是整数` };
      if (键 === 'LUT_1D_SIZE') size1d = n;
      else size3d = n;
      continue;
    }
    if (键 === 'DOMAIN_MIN' || 键 === 'DOMAIN_MAX') {
      if (头.length !== 4) return { ok: false, error: `第 ${行号} 行：${头[0]} 要跟三个数` };
      const v = 头.slice(1).map(数);
      if (v.some((x) => x === null)) return { ok: false, error: `第 ${行号} 行：${头[0]} 后面有不是数的东西` };
      const 三 = v as [number, number, number];
      if (键 === 'DOMAIN_MIN') domainMin = 三;
      else domainMax = 三;
      continue;
    }

    /* 剩下的都应当是数据行 */
    if (头.length < 3) return { ok: false, error: `第 ${行号} 行：数据行要三个数，这里是 ${头.length} 个` };
    const r = 数(头[0]);
    const g = 数(头[1]);
    const b = 数(头[2]);
    if (r === null || g === null || b === null) {
      return { ok: false, error: `第 ${行号} 行：不是「三个数」的数据行（读到了 "${头.slice(0, 3).join(' ')}"）` };
    }
    数据.push([r, g, b]);
  }

  if (size1d && size3d) return { ok: false, error: '同时写了 LUT_1D_SIZE 和 LUT_3D_SIZE，认不出是哪一种' };
  if (!size1d && !size3d) return { ok: false, error: '没找到 LUT_1D_SIZE / LUT_3D_SIZE' };
  for (const k of [0, 1, 2] as const) {
    if (domainMax[k] <= domainMin[k]) return { ok: false, error: 'DOMAIN_MAX 不大于 DOMAIN_MIN，范围是空的' };
  }

  if (size3d) {
    if (size3d < 2 || size3d > 最大3D) return { ok: false, error: `LUT_3D_SIZE ${size3d} 超出 2~${最大3D}` };
    const 要 = size3d ** 3;
    if (数据.length !== 要) {
      return {
        ok: false,
        error: `LUT_3D_SIZE ${size3d} 要 ${要} 行数据，实际 ${数据.length} 行`
      };
    }
    const data = new Uint8ClampedArray(要 * 3);
    let clamped = 0;
    for (let i = 0; i < 要; i++) {
      for (let k = 0; k < 3; k++) {
        const v = 数据[i][k];
        if (v < 0 || v > 1) clamped++;
        data[i * 3 + k] = v * 255;
      }
    }
    const lut: Lut3D = { kind: '3d', size: size3d, data, domainMin, domainMax, title };
    return { ok: true, lut, clamped };
  }

  if (size1d < 2 || size1d > 最大1D) return { ok: false, error: `LUT_1D_SIZE ${size1d} 超出 2~${最大1D}` };
  if (数据.length !== size1d) {
    return { ok: false, error: `LUT_1D_SIZE ${size1d} 要 ${size1d} 行数据，实际 ${数据.length} 行` };
  }
  const r = new Uint8ClampedArray(size1d);
  const g = new Uint8ClampedArray(size1d);
  const b = new Uint8ClampedArray(size1d);
  let clamped = 0;
  for (let i = 0; i < size1d; i++) {
    const 行 = 数据[i];
    for (const v of 行) if (v < 0 || v > 1) clamped++;
    r[i] = 行[0] * 255;
    g[i] = 行[1] * 255;
    b[i] = 行[2] * 255;
  }
  const lut: Lut1D = { kind: '1d', size: size1d, r, g, b, domainMin, domainMax, title };
  return { ok: true, lut, clamped };
}

/** 把输入按 DOMAIN 映到 0~1（越界夹住 —— 表外面没有数据，只能取端点） */
function 映(v: number, min: number, max: number): number {
  const t = (v - min) / (max - min);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** 一维表的线性采样 */
function 采1D(表: Uint8ClampedArray, t: number): number {
  const n = 表.length - 1;
  const f = t * n;
  const i = Math.floor(f);
  if (i >= n) return 表[n];
  const d = f - i;
  return 表[i] + (表[i + 1] - 表[i]) * d;
}

/**
 * 采样。`r/g/b` 是 0~1 的**输入**值，结果写进 `out`（0~255）。
 *
 * 3D 走三线性、1D 走三条表各自线性 —— 都是这两类表的常规读法（照着表的结构就能推出来）。
 */
export function 采Lut(lut: Lut, r: number, g: number, b: number, out: { r: number; g: number; b: number }): void {
  const tr = 映(r, lut.domainMin[0], lut.domainMax[0]);
  const tg = 映(g, lut.domainMin[1], lut.domainMax[1]);
  const tb = 映(b, lut.domainMin[2], lut.domainMax[2]);

  if (lut.kind === '1d') {
    out.r = 采1D(lut.r, tr);
    out.g = 采1D(lut.g, tg);
    out.b = 采1D(lut.b, tb);
    return;
  }

  const n = lut.size - 1;
  const fr = tr * n;
  const fg = tg * n;
  const fb = tb * n;
  const r0 = Math.min(n, Math.floor(fr));
  const g0 = Math.min(n, Math.floor(fg));
  const b0 = Math.min(n, Math.floor(fb));
  const r1 = Math.min(n, r0 + 1);
  const g1 = Math.min(n, g0 + 1);
  const b1 = Math.min(n, b0 + 1);
  const dr = fr - r0;
  const dg = fg - g0;
  const db = fb - b0;
  const sz = lut.size;
  const at = (ri: number, gi: number, bi: number, k: number) =>
    lut.data[((bi * sz + gi) * sz + ri) * 3 + k];

  const 出: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const c000 = at(r0, g0, b0, k);
    const c100 = at(r1, g0, b0, k);
    const c010 = at(r0, g1, b0, k);
    const c110 = at(r1, g1, b0, k);
    const c001 = at(r0, g0, b1, k);
    const c101 = at(r1, g0, b1, k);
    const c011 = at(r0, g1, b1, k);
    const c111 = at(r1, g1, b1, k);
    const c00 = c000 + (c100 - c000) * dr;
    const c10 = c010 + (c110 - c010) * dr;
    const c01 = c001 + (c101 - c001) * dr;
    const c11 = c011 + (c111 - c011) * dr;
    const c0 = c00 + (c10 - c00) * dg;
    const c1 = c01 + (c11 - c01) * dg;
    出[k] = c0 + (c1 - c0) * db;
  }
  out.r = 出[0];
  out.g = 出[1];
  out.b = 出[2];
}

/**
 * 把任意 LUT 摊成 `size³` 的 3D 表 —— 给"混合"那一页用（那边只认 32³ 的表）。
 *
 * 链上的节点**不用**这个：链是按原表精度算的，摊一次就白丢精度。
 */
export function Lut转3D(lut: Lut, size: number): Lut3D {
  const data = new Uint8ClampedArray(size ** 3 * 3);
  const px = { r: 0, g: 0, b: 0 };
  const n = size - 1;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        采Lut(lut, r / n, g / n, b / n, px);
        const i = ((b * size + g) * size + r) * 3;
        data[i] = px.r;
        data[i + 1] = px.g;
        data[i + 2] = px.b;
      }
    }
  }
  return {
    kind: '3d',
    size,
    data,
    /* 摊完的输出直接当 0~1 用，域已经吃进表里了 */
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    title: lut.title
  };
}
