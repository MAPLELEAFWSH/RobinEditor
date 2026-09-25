/**
 * 贴图通道算子 —— 第二批做的那几件事。
 *
 * 这里的每个函数都对应一条**实测过**的通道约定，不是按印象写的。
 * 依据在 `channel-facts.ts`，数字来自 `tools/probe_channels.py` 扫 43,440 张真图。
 *
 * 放在单独文件而不塞进 img.ts：img.ts 是全站共用的基础像素层，
 * 这些是"认得游戏贴图约定"的上层算子，混在一起以后不好找。
 */

import { CHANNEL_KEYS, CHANNEL_LABEL, type ChannelKey, blankImageData, lumaOf } from './img';

/* ------------------------------------------------------------ 透明通道 */

export type AlphaVerdict = {
  /** 唯一值个数 */
  unique: number;
  /** 最常见值占多少 */
  topShare: number;
  /** 是不是恒定（占 99.9% 以上） */
  constant: boolean;
  /** 里面像不像藏了一张图 */
  rich: boolean;
  /** 一句话，界面直接显示 */
  verdict: string;
};

/**
 * 看一张图的透明通道里有没有东西。
 *
 * 判据跟 `tools/probe_channels.py` 里用的一致：**唯一值 ≥16 且最常见值占比 <98%**。
 * 这道门槛是为了排掉两类假阳性 —— 全透明的图（值恒为 1）和二值遮罩（只有 0 和 1 两个值，
 * 那种 alpha 是"抠图边缘"不是"数据"）。实测这判据能把 55% 的法线图挑出来，
 * 而门槛放低到"只要有变化"会挑出 79%，里面大部分是二值遮罩。
 */
export function analyzeChannel(src: ImageData, ch: ChannelKey): AlphaVerdict {
  const off = ch === 'r' ? 0 : ch === 'g' ? 1 : ch === 'b' ? 2 : 3;
  const hist = new Uint32Array(256);
  const n = src.width * src.height;
  const d = src.data;
  for (let i = 0; i < n; i++) hist[d[i * 4 + off]]++;
  let unique = 0;
  let top = 0;
  for (let v = 0; v < 256; v++) {
    if (hist[v]) unique++;
    if (hist[v] > top) top = hist[v];
  }
  const topShare = top / n;
  const constant = unique === 1 || topShare > 0.999;
  const rich = unique >= 16 && topShare < 0.98;
  const name = CHANNEL_LABEL[ch] ?? ch;
  const verdict = constant
    ? `${name} 路是常量，换一路看看。`
    : rich
      ? `${name} 路有 ${unique} 个取值，最常见占 ${(topShare * 100).toFixed(1)}%。`
      : `${name} 路只有 ${unique} 个取值、最常见占 ${(topShare * 100).toFixed(0)}% —— 像是遮罩不是数据。`;
  return { unique, topShare, constant, rich, verdict };
}

/**
 * 透明通道那一份 —— **只是 `analyzeChannel(src, 'a')` 加一句专门的说法**。
 *
 * 原来这里把直方图那一段又抄了一遍（判据逐字相同），两处一起改漏一个就会分叉。
 * 现在只保留"透明通道"这句话的不同措辞，数都从同一处来。
 */
export function analyzeAlpha(src: ImageData): AlphaVerdict {
  const s = analyzeChannel(src, 'a');
  if (s.constant) return { ...s, verdict: '透明通道是常量，里面没有藏东西。' };
  if (s.rich) {
    return {
      ...s,
      verdict: `透明通道里有 ${s.unique} 个不同取值，最常见那个占 ${(s.topShare * 100).toFixed(1)}% —— 像是一张图。`
    };
  }
  return {
    ...s,
    verdict: `透明通道只有 ${s.unique} 个取值、最常见占 ${(s.topShare * 100).toFixed(0)}% —— 像是抠图边缘之类的二值遮罩，不是数据。`
  };
}

/** 四路里哪一路最像"藏了图"。`_M` 这种打包图靠它认金属度在哪 */
export function richestChannel(src: ImageData): { ch: ChannelKey; stats: AlphaVerdict } {
  let best: { ch: ChannelKey; stats: AlphaVerdict } | null = null;
  for (const ch of CHANNEL_KEYS) {
    const stats = analyzeChannel(src, ch);
    if (!best || stats.unique > best.stats.unique) best = { ch, stats };
  }
  return best!;
}

/**
 * 把法线贴图的 alpha 提成一张灰度图。
 *
 * 为什么值得单开一个：实测 300 张 `_N` 里有 **55%** 的 alpha 藏了一张图，
 * 是全库里最强的一条。那个通常就是光泽度 / 平滑度贴图
 * —— 三渲二的"哪块亮、哪块糊"全靠它。
 *
 * invert：游戏里存的常常是**平滑度**（越大越光滑），而着色器要的可能是**粗糙度**
 * （越大越毛）。两者互为反相。默认不反相，界面上给开关 —— 到底哪个方向，
 * 看目标 shader 怎么写，工具不该替用户拍。
 */
export function glossFromAlpha(src: ImageData, invert = false): ImageData {
  const out = blankImageData(src.width, src.height);
  const d = out.data;
  const s = src.data;
  const n = src.width * src.height;
  for (let i = 0; i < n; i++) {
    const a = s[i * 4 + 3];
    const v = invert ? 255 - a : a;
    d[i * 4] = v;
    d[i * 4 + 1] = v;
    d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  return out;
}

/** 从任意通道提一张灰度图。绝区零那套的金属度就在 `_M` 的某个通道里 */
export function mapFromChannel(src: ImageData, ch: ChannelKey, invert = false): ImageData {
  const out = blankImageData(src.width, src.height);
  const d = out.data;
  const s = src.data;
  const off = ch === 'r' ? 0 : ch === 'g' ? 1 : ch === 'b' ? 2 : 3;
  const n = src.width * src.height;
  for (let i = 0; i < n; i++) {
    const raw = s[i * 4 + off];
    const v = invert ? 255 - raw : raw;
    d[i * 4] = v;
    d[i * 4 + 1] = v;
    d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * 把一张灰度图塞进某个通道，其余通道保持原值。
 * 拿来做"把粗糙度并回基础色的 alpha"这种反向操作。
 */
export function putChannel(dst: ImageData, gray: ImageData, ch: ChannelKey, keepAlpha = true): ImageData {
  const out = new ImageData(new Uint8ClampedArray(dst.data), dst.width, dst.height);
  const d = out.data;
  const g = gray.data;
  const off = ch === 'r' ? 0 : ch === 'g' ? 1 : ch === 'b' ? 2 : 3;
  const n = out.width * out.height;
  for (let i = 0; i < n; i++) {
    d[i * 4 + off] = g[i * 4];
  }
  if (keepAlpha && ch !== 'a') {
    // 不动 alpha
  }
  return out;
}

/* ------------------------------------------------------------ HSV */

export type HSV = { h: number; s: number; v: number };

/** RGB(0-255) → HSV。h 是 0-360，s/v 是 0-1 */
export function rgbToHsv(r: number, g: number, b: number): HSV {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hh = ((h % 360) + 360) % 360 / 60;
  const i = Math.floor(hh);
  const f = hh - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  let r = 0, g = 0, b = 0;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q;
  }
  return [r * 255, g * 255, b * 255];
}

export type HsvAdjust = {
  /** 色相偏移，度 */
  dh: number;
  /** 饱和度倍率，1 = 不变 */
  ds: number;
  /** 明度倍率，1 = 不变 */
  dv: number;
  /**
   * 只改某一路的色相偏移，度。填了就以它为准（RGB 自定义）。
   * 不填就四路统一走 dh。
   */
  perChannel?: Partial<Record<ChannelKey, number>>;
  /** 只在这些通道上动手，空集表示四路全动 */
  only?: ChannelKey[];
};

/**
 * 按 HSV 调整，也可以按通道各调各的（RGB 自定义）。
 *
 * 跟 `img.ts` 的 `applyGrade` 的区别：那个是曝光/对比度/色相旋转那套**整体**调色，
 * 数值在 RGB 空间算；这个是**逐像素转 HSV 再改**，
 * 好处是"只提饱和度不碰亮度"这种操作能做得干净，坏处是慢一倍
 * —— 所以预览用它，大批量导出前最好先确认效果。
 */
export function adjustHsv(src: ImageData, p: HsvAdjust): ImageData {
  const out = blankImageData(src.width, src.height);
  const s = src.data;
  const d = out.data;
  const n = src.width * src.height;
  const only = p.only && p.only.length ? new Set(p.only) : null;
  const per = p.perChannel ?? {};
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = s[o], g = s[o + 1], b = s[o + 2], a = s[o + 3];
    if (only && !(only.has('r') || only.has('g') || only.has('b'))) {
      // 只动 A 的话 RGB 原样
      d[o] = r; d[o + 1] = g; d[o + 2] = b;
      d[o + 3] = only.has('a') ? s[o + 3] : a;
      continue;
    }
    const hsv = rgbToHsv(r, g, b);
    let dh = p.dh;
    // 按通道给不同色相偏移：用主导通道决定用哪个值
    if (Object.keys(per).length) {
      const dom: ChannelKey = r >= g && r >= b ? 'r' : g >= b ? 'g' : 'b';
      dh = per[dom] ?? p.dh;
    }
    const rgb = hsvToRgb(
      hsv.h + dh,
      Math.min(1, Math.max(0, hsv.s * p.ds)),
      Math.min(1, Math.max(0, hsv.v * p.dv))
    );
    if (!only || only.has('r')) d[o] = rgb[0];
    else d[o] = r;
    if (!only || only.has('g')) d[o + 1] = rgb[1];
    else d[o + 1] = g;
    if (!only || only.has('b')) d[o + 2] = rgb[2];
    else d[o + 2] = b;
    d[o + 3] = a;
  }
  return out;
}

/* ------------------------------------------------------------ 灰度驱动 */

/**
 * 用一张灰度图当权重，在两路之间插值。
 *
 * 「灰度图扣材质」就是这件事：拿一张遮罩当权重，把材质 A 和材质 B 合成。
 * w=0 全取 a，w=1 全取 b。
 */
export function blendByGray(a: ImageData, b: ImageData, w: ImageData): ImageData {
  const out = blankImageData(a.width, a.height);
  const d = out.data;
  const da = a.data;
  const db = b.data;
  const dw = w.data;
  const n = a.width * a.height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const t = dw[o] / 255;
    d[o] = da[o] * (1 - t) + db[o] * t;
    d[o + 1] = da[o + 1] * (1 - t) + db[o + 1] * t;
    d[o + 2] = da[o + 2] * (1 - t) + db[o + 2] * t;
    d[o + 3] = da[o + 3] * (1 - t) + db[o + 3] * t;
  }
  return out;
}

/** 灰度图 → 二值遮罩。扣材质之前先切干净，免得半透明边缘在渲染里出白边 */
export function grayToMask(gray: ImageData, threshold = 128, invert = false): ImageData {
  const out = blankImageData(gray.width, gray.height);
  const d = out.data;
  const g = gray.data;
  const l = lumaOf(gray);
  const n = gray.width * gray.height;
  for (let i = 0; i < n; i++) {
    const on = l[i] > threshold;
    const v = (invert ? !on : on) ? 255 : 0;
    d[i * 4] = v;
    d[i * 4 + 1] = v;
    d[i * 4 + 2] = v;
    d[i * 4 + 3] = g[i * 4 + 3];
  }
  return out;
}

/* ------------------------------------------------------------ 材质 ID */

export type MaterialId = { channel: ChannelKey; id: number; share: number };

/**
 * 从一张 ID 图里数出用到哪几种材质。
 *
 * 材质 ID 图约定是"一个值 = 一种材质"，值本身没有亮暗含义 ——
 * 所以这里返回的是"有哪些 id、各占多少"，而不是平均值之类。
 * 之前 `tools/probe_maps.py` 把 ID 图当普通灰度图统计均值，
 * 出来的数没有意义（id 的平均值不代表任何东西）。
 */
export function readMaterialIds(src: ImageData, ch: ChannelKey = 'r'): MaterialId[] {
  const off = ch === 'r' ? 0 : ch === 'g' ? 1 : ch === 'b' ? 2 : 3;
  const hist = new Uint32Array(256);
  const n = src.width * src.height;
  const d = src.data;
  for (let i = 0; i < n; i++) hist[d[i * 4 + off]]++;
  const out: MaterialId[] = [];
  for (let v = 0; v < 256; v++) {
    if (hist[v]) out.push({ channel: ch, id: v, share: hist[v] / n });
  }
  return out.sort((a, b) => b.share - a.share);
}

/** 按材质 ID 拆成多张遮罩，一张一个材质。ID 图不能直接拿去调色，必须先拆 */
export function splitById(src: ImageData, ids: number[], ch: ChannelKey = 'r'): Map<number, ImageData> {
  const off = ch === 'r' ? 0 : ch === 'g' ? 1 : ch === 'b' ? 2 : 3;
  const n = src.width * src.height;
  const d = src.data;
  const out = new Map<number, ImageData>();
  for (const id of ids) {
    const img = blankImageData(src.width, src.height);
    const o = img.data;
    for (let i = 0; i < n; i++) {
      const on = d[i * 4 + off] === id;
      const v = on ? 255 : 0;
      o[i * 4] = v;
      o[i * 4 + 1] = v;
      o[i * 4 + 2] = v;
      o[i * 4 + 3] = 255;
    }
    out.set(id, img);
  }
  return out;
}

export { CHANNEL_KEYS };
export type { ChannelKey };
