/**
 * 链本身：跑链、烘成 CLUT、默认链。
 *
 * **预览、自检、导出都走这两个函数** —— 预览是 `跑链(缩略图)`，
 * 导出是 `烘成CLUT(网格, 链)` 再解成 1024×32 的图。两边不会各有一套实现：
 * 烘表就是"拿链跑一遍 32³ 的采样网格图"，跟预览跑的是同一段代码。
 * 这也是"自检"那个差值还有意义的前提 —— 它只反映量化与插值，不掺实现分歧。
 *
 * 预览那条路可以带**分段缓存**（拖滑杆时只重跑改动之后的那几步），导出不带。
 */
import { clutFromImage, type Clut } from '$lib/img';
import { CLUT_SIZE } from '../ops';
import { 跑Lut, 跑基本, 跑曲线, 跑色轮, 跑Hsl, 跑Log, 跑变形 } from './nodes';
import { 新建节点, type GradeNode, type NodeKind } from './types';

type 实现 = (src: ImageData, p: never) => ImageData;

/**
 * 实现表。加一种节点 = 这里加一项（加上 `types.ts` 里的类型和界面上一块参数区）。
 *
 * 没登记的 kind 直接抛错，**不许静默跳过** —— 静默跳过等于"这个节点没生效"，
 * 而用户看到的是一张"看着差不多但颜色不对"的图，查起来要命。
 */
const 实现表: Record<NodeKind, 实现> = {
  basic: 跑基本 as unknown as 实现,
  curves: 跑曲线 as unknown as 实现,
  lut: 跑Lut as unknown as 实现,
  wheels: 跑色轮 as unknown as 实现,
  hsl: 跑Hsl as unknown as 实现,
  log: 跑Log as unknown as 实现,
  warp: 跑变形 as unknown as 实现
};

/**
 * 分段缓存：拖滑杆时**只重跑被改动那个节点之后的几步**。
 *
 * 为什么要它：整条链在 1024 上量出来 60ms 左右，超一帧预算。
 * 但用户拖一次滑杆通常只动**一个**节点，前面几步的输入和参数都没变 ——
 * 把它们重跑一遍是纯浪费。有缓存之后"只改最后一个节点"就只剩那一步的代价。
 *
 * 三条规矩：
 *   · 源图换了（对象不是同一个）→ 一步都不复用；
 *   · 节点的**指纹**（种类 + 开关 + 参数）对不上 → 从那一格开始重跑，后面全重跑；
 *   · 大图不缓存（见 `缓存上限像素`）。
 *
 * 复用只可能发生在"前面每一步的指纹都一样"的前提下，所以复用的那张中间结果
 * 一定等于重跑出来的那张 —— `tmp/grade-chain.test.mjs` 里有逐字节对照钉着，
 * 缓存最容易出的错就是"算旧了"，那条测试就是冲它去的。
 */
export type 链缓存 = {
  /** 上一次用的源图。不是同一个对象就整条作废 */
  源: ImageData | null;
  /** 与 `nodes` 下标对齐：每一步的指纹和它跑出来的图（关着的节点记的是没变的那张） */
  步: { 指纹: string; 出: ImageData }[];
  /** 上一次从第几格开始真跑。给测试和量具看的 */
  跳到: number;
};

/**
 * 超过这么多像素就不缓存。
 *
 * 4K 一张中间结果 34 MB，一条链几步就是几百 MB —— 而导出（4K，`烘成CLUT`）本身就是
 * 一次性动作，缓存也省不下第二次。预览那张（512 / 1024）才是要省的地方。
 */
const 缓存上限像素 = 2_000_000;

export function 造链缓存(): 链缓存 {
  return { 源: null, 步: [], 跳到: 0 };
}

/** 表对象的身份号。LUT 的表是几万个数字，不能塞进指纹字符串里比 */
const 表号 = new WeakMap<object, number>();
let 表号下一个 = 1;
function 取表号(t: object): number {
  let n = 表号.get(t);
  if (n === undefined) {
    n = 表号下一个++;
    表号.set(t, n);
  }
  return n;
}

/**
 * 一个节点的指纹。**参数一变指纹就得变**，否则缓存会把旧结果当新的用。
 *
 * `lut` 单独处理：它的 `lut` 字段是解析出来的表（33³ 就是 3 万多个数），
 * 整个 `JSON.stringify` 一遍太贵，用对象身份号代替 —— 表是导入时造一次、
 * 之后不再改的对象，身份能代表内容。
 */
function 指纹(n: GradeNode): string {
  if (n.kind === 'lut') {
    const p = n.p;
    return `lut|${n.on ? 1 : 0}|${p.lut ? 取表号(p.lut) : 0}|${p.strength}|${p.name}|${p.clamped}`;
  }
  return `${n.kind}|${n.on ? 1 : 0}|${JSON.stringify(n.p)}`;
}

export function 跑链(src: ImageData, nodes: GradeNode[], 缓存?: 链缓存): ImageData {
  const 能缓存 = !!缓存 && src.width * src.height <= 缓存上限像素;
  let 出 = src;
  /** 从第几个节点开始必须真跑 */
  let 从哪 = 0;

  if (能缓存) {
    const c = 缓存 as 链缓存;
    /* 换源图就一步都不能复用：第 0 步的输入已经不是一个东西了 */
    if (c.源 === src) {
      while (从哪 < nodes.length && 从哪 < c.步.length && c.步[从哪].指纹 === 指纹(nodes[从哪])) {
        出 = c.步[从哪].出;
        从哪++;
      }
    }
    if (从哪 === 0) c.源 = src;
  }

  for (let i = 从哪; i < nodes.length; i++) {
    const n = nodes[i];
    let 新 = 出;
    if (n.on) {
      const f = 实现表[n.kind];
      if (!f) throw new Error(`链上有没实现的节点：${n.kind}`);
      新 = (f as (s: ImageData, p: unknown) => ImageData)(出, n.p);
    }
    /* 关着的节点也记一格：下标要跟 nodes 对齐，不然挪动/开关会让复用错位 */
    if (能缓存) (缓存 as 链缓存).步[i] = { 指纹: 指纹(n), 出: 新 };
    出 = 新;
  }

  if (能缓存) {
    const c = 缓存 as 链缓存;
    /* 链变短了就把尾巴砍掉，下一次不会拿旧下标去比 */
    c.步.length = nodes.length;
    c.跳到 = 从哪;
  }
  return 出;
}

/** 拿链跑一遍采样网格图，解成 32³ 的表。导出与自检都走这里（一次性，不带缓存） */
export function 烘成CLUT(grid: ImageData, nodes: GradeNode[], size = CLUT_SIZE): Clut {
  return clutFromImage(跑链(grid, nodes), size, false);
}

/** 新开一条链：基本 + 曲线。导入的 LUT 由用户自己加 */
export function 默认链(): GradeNode[] {
  return [新建节点('basic'), 新建节点('curves')];
}

/** 链上一共几个节点是开着的 */
export function 开着几个(nodes: GradeNode[]): number {
  return nodes.filter((n) => n.on).length;
}
