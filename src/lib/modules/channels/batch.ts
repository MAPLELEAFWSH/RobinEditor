/**
 * 批量面板的操作用表和输出命名。
 *
 * 从 `Channels.svelte` 里拆出来的 —— 那个文件已经一千五百行，而这两块是纯数据 + 纯字符串，
 * 拆出来有两个好处：**能在 Node 里测**（输出文件名是用户唯一看得见的东西，
 * 试跑日志里列的就是它，错一个字符就是几百个名字不对的产物），
 * 以及加一种批量操作不用再动那个大文件。
 */

import { stemOf } from '$lib/io';
import { CHANNEL_KEYS, extractChannel, grayToImageData, 字节值, type ChannelKey } from '$lib/img';

export type BatchOp =
  | 'split'
  | 'extract-r'
  | 'extract-g'
  | 'extract-b'
  | 'extract-a'
  | 'gray-r'
  | 'gray-g'
  | 'gray-b'
  | 'gray-a'
  | 'alpha-from-r'
  | 'rotate'
  | 'bgra'
  | 'invert-r'
  | 'adjust'
  | 'layers';

export type BatchOpInfo = {
  id: BatchOp;
  name: string;
  hint: string;
  /** 一张源图产出几个文件 */
  out: number;
};

export const BATCH_OPS: BatchOpInfo[] = [
  { id: 'split', name: '拆成 RGBA 四张', hint: '每张图出 _R _G _B _A', out: 4 },
  { id: 'extract-r', name: '取 R 当灰度', hint: '出 _R', out: 1 },
  { id: 'extract-g', name: '取 G 当灰度', hint: '出 _G', out: 1 },
  { id: 'extract-b', name: '取 B 当灰度', hint: '出 _B', out: 1 },
  { id: 'extract-a', name: '取 A 当灰度', hint: '出 _A', out: 1 },
  { id: 'gray-r', name: 'R 铺满 RGB', hint: '出灰度图', out: 1 },
  { id: 'gray-g', name: 'G 铺满 RGB', hint: '出灰度图', out: 1 },
  { id: 'gray-b', name: 'B 铺满 RGB', hint: '出灰度图', out: 1 },
  { id: 'gray-a', name: 'A 铺满 RGB', hint: '出灰度图', out: 1 },
  { id: 'alpha-from-r', name: 'R 提到 A', hint: 'RGB 不动，A 换成 R', out: 1 },
  /* 下面三条原来只在「调换」那一页有，批量页调不到 —— 同一张预设表两边各实现一遍的后果，
     用户在调换页能用的"法线 B↔R 对调"到了批量页就找不到。现在两边同一份。 */
  { id: 'rotate', name: '循环位移', hint: 'R←G G←B B←A A←R', out: 1 },
  { id: 'bgra', name: '法线 B↔R', hint: '法线贴图常见的对调', out: 1 },
  { id: 'invert-r', name: 'R 反相', hint: '只动 R', out: 1 },
  { id: 'adjust', name: '只跑调整', hint: '原样出图，只改像素', out: 1 },
  { id: 'layers', name: '套一套图层', hint: '每个文件当一格，按图层栈叠一遍再出图', out: 1 }
];

export function batchOpInfo(op: BatchOp): BatchOpInfo {
  return BATCH_OPS.find((o) => o.id === op) ?? BATCH_OPS[0];
}

/** 拆通道那四个的固定后缀，顺序跟 CHANNEL_KEYS 一致 */
const SPLIT_TAGS = ['R', 'G', 'B', 'A'];

/** 取某一格 / 铺满 RGB 这类，靠 id 拼后缀 */
function tagOf(op: BatchOp): string {
  if (op.startsWith('extract-')) return op.slice('extract-'.length).toUpperCase();
  if (op.startsWith('gray-')) return `gray-${op.slice('gray-'.length).toUpperCase()}`;
  if (op === 'alpha-from-r') return 'A-from-R';
  if (op === 'bgra') return 'BGR';
  if (op === 'invert-r') return 'R-inv';
  if (op === 'adjust') return 'adjust';
  return op;
}

/**
 * 每个产出叫什么。`rel` 是相对路径，带子目录也没关系 —— 只取文件名那截。
 *
 * 写出来的名字一律 `原名_后缀.png`，跟源图同目录同名只加后缀是一个思路：
 * 用户一眼能看出这张是从哪来的。
 */
export function batchOutNames(rel: string, op: BatchOp, suffix = ''): string[] {
  const stem = stemOf(rel.split(/[\\/]/).pop() ?? rel);
  if (op === 'split') return SPLIT_TAGS.map((c) => `${stem}_${c}.png`);
  // 图层那边用中文后缀：它跟"取某一路"不是一类操作，混在一起看不出来
  if (op === 'layers') return [`${stem}_图层${suffix}.png`];
  return [`${stem}_${tagOf(op)}${suffix}.png`];
}

/* ============================================================
   像素：批量那几种变换
   ============================================================ */

/** 通道映射的一种：从源取哪一路、要不要反相、或者干脆写常量 */
export type 通道来源 = { ch?: ChannelKey; invert?: boolean; const?: number };

/**
 * 「调换」那一页预设表里的通道映射 —— **一份**，两个界面共用。
 *
 * 原来「调换」有 9 条、「批量」自己实现了 5 条：用户在调换页能用的
 * `rotate` / `bgra` / `invert-r` 到批量页就找不到。现在预设表在这儿，
 * 两边的下拉都从它取（`channels/ops.ts` 的 `applyPlan` 吃的就是 `通道来源`）。
 */
export const 调换预设: { id: string; name: string; hint: string; map: Record<ChannelKey, 通道来源> }[] = [
  { id: 'identity', name: '原样', hint: '不动', map: { r: { ch: 'r' }, g: { ch: 'g' }, b: { ch: 'b' }, a: { ch: 'a' } } },
  { id: 'gray-r', name: 'R 铺满 RGB', hint: '出灰度底图', map: { r: { ch: 'r' }, g: { ch: 'r' }, b: { ch: 'r' }, a: { const: 255 } } },
  { id: 'gray-g', name: 'G 铺满 RGB', hint: '常见于金属度图', map: { r: { ch: 'g' }, g: { ch: 'g' }, b: { ch: 'g' }, a: { const: 255 } } },
  { id: 'gray-b', name: 'B 铺满 RGB', hint: '常见于法线 B', map: { r: { ch: 'b' }, g: { ch: 'b' }, b: { ch: 'b' }, a: { const: 255 } } },
  { id: 'gray-a', name: 'A 铺满 RGB', hint: '拿透明通道当底图', map: { r: { ch: 'a' }, g: { ch: 'a' }, b: { ch: 'a' }, a: { const: 255 } } },
  { id: 'rgb-to-alpha', name: 'R 提到 A', hint: 'RGB 不动，A 换成 R', map: { r: { ch: 'r' }, g: { ch: 'g' }, b: { ch: 'b' }, a: { ch: 'r' } } },
  { id: 'rotate', name: '循环位移', hint: 'R←G G←B B←A A←R', map: { r: { ch: 'g' }, g: { ch: 'b' }, b: { ch: 'a' }, a: { ch: 'r' } } },
  { id: 'bgra', name: '法线 B↔R', hint: '法线贴图常见的对调', map: { r: { ch: 'b' }, g: { ch: 'g' }, b: { ch: 'r' }, a: { ch: 'a' } } },
  { id: 'invert-r', name: 'R 反相', hint: '只动 R', map: { r: { ch: 'r', invert: true }, g: { ch: 'g' }, b: { ch: 'b' }, a: { ch: 'a' } } }
];

/** 批量页里"铺满 / 轮换 / 反相"这三类走的都是预设表那一份 */
export function 调换映射(id: string): Record<ChannelKey, 通道来源> | null {
  return 调换预设.find((p) => p.id === id)?.map ?? null;
}

/**
 * 批量对一张图做的变换。**原来住在 `Channels.svelte` 里**（那个文件一千九百行、
 * 而且这段没有被任何测试盯过，却在决定写盘的字节）。搬过来之后：
 * 纯像素变换留在这一份里，只有"跑调整链"和"叠图层"要组件把函数传进来 ——
 * 那两件依赖组件里的状态（调整链、图层栈），没法也不需要搬。
 */
export function batchTransform(
  src: ImageData,
  op: BatchOp,
  o: {
    /** 跑一遍当前调整链（组件传 `(s) => applyAdjust(s, batchOps, batchScope)`） */
    调整: (s: ImageData) => ImageData;
    /** 把这张当一格，按图层栈叠一遍（组件传自己的 batchRunLayers） */
    叠图层: (s: ImageData) => ImageData;
  }
): { name: string; data: ImageData }[] {
  const w = src.width;
  const h = src.height;
  const 铺满 = (ch: ChannelKey) => {
    /* 三路都取同一路、A 拉满 —— 跟调换页的 `gray-*` 是同一条预设 */
    const m: Record<ChannelKey, 通道来源> = { r: { ch }, g: { ch }, b: { ch }, a: { const: 255 } };
    return [{ name: '', data: 按映射(src, m) }];
  };

  switch (op) {
    case 'split':
      return CHANNEL_KEYS.map((ch) => ({ name: '', data: grayToImageData(extractChannel(src, ch), w, h) }));
    case 'extract-r':
    case 'extract-g':
    case 'extract-b':
    case 'extract-a':
      return [{ name: '', data: grayToImageData(extractChannel(src, op.slice(-1) as ChannelKey), w, h) }];
    case 'gray-r':
    case 'gray-g':
    case 'gray-b':
    case 'gray-a':
      return 铺满(op.slice(-1) as ChannelKey);
    case 'alpha-from-r': {
      const m: Record<ChannelKey, 通道来源> = { r: { ch: 'r' }, g: { ch: 'g' }, b: { ch: 'b' }, a: { ch: 'r' } };
      return [{ name: '', data: 按映射(src, m) }];
    }
    case 'rotate':
    case 'bgra':
    case 'invert-r':
      return [{ name: '', data: 按映射(src, 调换映射(op)!) }];
    case 'layers':
      return [{ name: '', data: o.叠图层(src) }];
    default:
      return [{ name: '', data: o.调整(src) }];
  }
}

/**
 * 按通道映射拼一张图。跟 `channels/ops.ts` 的 `applyPlan` 是同一件事，
 * 但那个吃的是"计划 + 槽位表"，这里吃的是"一张源图 + 映射表"（批量每张图独立）。
 */
export function 按映射(src: ImageData, map: Record<ChannelKey, 通道来源>): ImageData {
  const w = src.width;
  const h = src.height;
  const out = new ImageData(w, h);
  const d = out.data;
  const 偏移: Record<ChannelKey, number> = { r: 0, g: 1, b: 2, a: 3 };
  for (const k of CHANNEL_KEYS) {
    const s = map[k];
    const off = 偏移[k];
    if (!s.ch) {
      const v = 字节值(s.const ?? 0);
      for (let i = 0; i < w * h; i++) d[i * 4 + off] = v;
      continue;
    }
    const plane = extractChannel(src, s.ch, s.invert ?? false);
    for (let i = 0; i < w * h; i++) d[i * 4 + off] = plane[i];
  }
  return out;
}
