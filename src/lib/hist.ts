/**
 * 直方图和贴边统计。
 *
 * 贴图工具尤其需要这个 —— 调完一张图，肉眼看着"差不多"，
 * 但暗部已经整片压成 0、或者高光整片截到 255，那种损失是不可逆的，
 * 得有个数摆在那儿：RGB/亮度分布，外加"严重裁切、异常范围"这种结论。
 *
 * 纯函数，单独一个文件好在 Node 里测：分箱错一格、贴边算成比例而不是百分比，
 * 这类事界面上完全看不出来。
 */

export type ChannelKey3 = 'r' | 'g' | 'b';

export type Hist = {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  /** 感知亮度那一份 */
  luma: Uint32Array;
  /** 扫了多少个像素 */
  sampled: number;
  /**
   * 其中**不透明的那部分**（alpha > 0）。
   *
   * RGB 分布和贴边统计全部只按这批算 —— 全透明像素的 RGB 是**没有意义**的：
   * 合成之后它一律是 0，拿它去统计就会得出一张"99% 暗部压塌"的假报告。
   * 实测过：⑦ 图层页用「diffuse + LM.B 蒙版」合成一张原神贴图，
   * 71,740 个纯黑像素里 71,688 个是全透明的，不透明的一个都没有，
   * 而直方图当时报的是"暗部有 69.9% 的像素压成了纯黑，往回退一点"。
   */
  visible: number;
  /** 全透明像素占比，0–1。占比高的时候界面上要说一句 */
  transparentShare: number;
  /** 平均亮度 0–1，按可见像素算 */
  mean: number;
  /** 三路都贴到 0 / 255 的像素占多少，0–1（分母是可见像素） */
  clipLow: number;
  clipHigh: number;
  /** 每路各自的贴边比例（分母是可见像素） */
  byCh: Record<ChannelKey3, { low: number; high: number }>;
  /** 有没有哪一路整条都贴边（说明这张图在那一路上全是 0 或全是 255） */
  flat: ChannelKey3[];
};

/** 相对亮度权重，跟 bg-store 里量壁纸用的是同一套 */
const LR = 0.2126;
const LG = 0.7152;
const LB = 0.0722;

/**
 * 数一遍。`step` 是跳采样步长 —— 4096² 的图按 4 跳就是 100 万像素，够准也够快。
 *
 * 直方图按**未预乘**的字节算（`readRgba` 那条路给的就是这个）。
 * 走画布那条路的话半透明像素的 RGB 已经被反预乘弄脏了，直方图会跟着错。
 *
 * **全透明像素（alpha=0）不进 RGB 统计。** 它们的 RGB 在合成之后一律是 0，
 * 算进去会得出一张"暗部全压塌"的假报告（这个坑实测踩过，见 `Hist.visible` 的注释）。
 */
export function histogram(img: ImageData, step = 1): Hist {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const luma = new Uint32Array(256);
  const n = img.width * img.height;
  const s = Math.max(1, Math.floor(step));
  const d = img.data;

  let sampled = 0;
  let visible = 0;
  let sum = 0;
  let low = 0;
  let high = 0;
  const chLow: Record<ChannelKey3, number> = { r: 0, g: 0, b: 0 };
  const chHigh: Record<ChannelKey3, number> = { r: 0, g: 0, b: 0 };

  for (let i = 0; i < n; i += s) {
    sampled++;
    if (d[i * 4 + 3] === 0) continue; // 全透明的跳过，RGB 没意义
    visible++;
    const rv = d[i * 4];
    const gv = d[i * 4 + 1];
    const bv = d[i * 4 + 2];
    r[rv]++;
    g[gv]++;
    b[bv]++;
    const lv = Math.round(LR * rv + LG * gv + LB * bv);
    luma[lv]++;
    sum += lv / 255;
    if (rv === 0) chLow.r++;
    if (gv === 0) chLow.g++;
    if (bv === 0) chLow.b++;
    if (rv === 255) chHigh.r++;
    if (gv === 255) chHigh.g++;
    if (bv === 255) chHigh.b++;
    // 三路**同时**贴边才算整体丢细节；单路贴边可能只是这一路本来就没内容
    if (rv === 0 && gv === 0 && bv === 0) low++;
    if (rv === 255 && gv === 255 && bv === 255) high++;
  }

  const denom = visible || 1;
  const byCh = {
    r: { low: chLow.r / denom, high: chHigh.r / denom },
    g: { low: chLow.g / denom, high: chHigh.g / denom },
    b: { low: chLow.b / denom, high: chHigh.b / denom }
  };

  // 整条都在一个值上 = 这一路没内容（全白遮罩、全黑遮罩那种）
  const flat: ChannelKey3[] = [];
  if (visible > 0) {
    for (const ch of ['r', 'g', 'b'] as ChannelKey3[]) {
      const arr = ch === 'r' ? r : ch === 'g' ? g : b;
      let nonzero = 0;
      for (let v = 0; v < 256; v++) if (arr[v]) nonzero++;
      if (nonzero <= 1) flat.push(ch);
    }
  }

  return {
    r,
    g,
    b,
    luma,
    sampled,
    visible,
    transparentShare: sampled ? (sampled - visible) / sampled : 0,
    mean: visible ? sum / denom : 0,
    clipLow: low / denom,
    clipHigh: high / denom,
    byCh,
    flat
  };
}

/** 直方图里最大值，画图的时候拿它当纵轴 */
export function peak(h: Uint32Array): number {
  let m = 0;
  for (let v = 0; v < 256; v++) if (h[v] > m) m = h[v];
  return m || 1;
}

/**
 * 把一条直方图折成 SVG 的 path。
 *
 * 用 sqrt 压一下再画：绝大多数图的直方图是尖峰，线性画出来峰以外的部分全贴着底，
 * 看不见。开方之后小块的变化也看得见了。这是示波器的常规做法，不是美化。
 */
export function histPath(h: Uint32Array, w: number, hgt: number, yScale = 1): string {
  const p = peak(h) * yScale;
  const stepX = w / 255;
  let d = `M 0 ${hgt}`;
  for (let v = 0; v < 256; v++) {
    const y = hgt - Math.sqrt(h[v] / p) * hgt;
    d += ` L ${(v * stepX).toFixed(2)} ${y.toFixed(2)}`;
  }
  d += ` L ${w} ${hgt} Z`;
  return d;
}

/**
 * 一句话总结，直接显示在界面上。
 *
 * 三档，按"这件事到底要不要紧"分：
 *
 * 1. **整体贴边**（三路同时压到 0 或 255）—— 这是真损失，超过 `warnAt` 就报。
 * 2. **单路几乎只有一个值** —— 说明这一路没装渐变信息，通常是遮罩类贴图。只提一句。
 * 3. 其余不吭声。
 *
 * 单路贴边的门槛给到 **90%** 是有原因的：一开始按 8% 写，结果一张普通的
 * 暗部渐变图（R 路 20% 落在 0）被判成"像遮罩"，那是假警报。
 * 单路某个值占 20% 在贴图里再正常不过 —— 任何一片暗区都这样。
 * 只有一路基本全占住某一端，才真的是"这一路没内容"。
 */
export function histVerdict(
  h: Hist,
  warnAt = 0.02,
  channelFlatAt = 0.9
): { kind: 'ok' | 'warn' | 'info'; text: string } {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  if (h.sampled === 0) return { kind: 'info', text: '没有像素可数。' };
  if (h.visible === 0) {
    return { kind: 'info', text: '整张都是全透明的，没有可见像素可数。' };
  }

  const bad: string[] = [];
  if (h.clipLow > warnAt) bad.push(`暗部有 ${pct(h.clipLow)} 的可见像素压成了纯黑`);
  if (h.clipHigh > warnAt) bad.push(`高光有 ${pct(h.clipHigh)} 的可见像素截到纯白`);
  if (bad.length) {
    return {
      kind: 'warn',
      text: `${bad.join('，')}。这部分细节已经没了，往回退一点。`
    };
  }

  // 单路基本全占住一端 —— 那一路没内容，通常本来就是遮罩
  const oneSided: string[] = [];
  for (const ch of ['r', 'g', 'b'] as ChannelKey3[]) {
    const c = h.byCh[ch];
    const name = ch.toUpperCase();
    if (c.low >= channelFlatAt) oneSided.push(`${name} 路 ${pct(c.low)} 是 0`);
    else if (c.high >= channelFlatAt) oneSided.push(`${name} 路 ${pct(c.high)} 是 255`);
  }

  // 透明占大头的时候先说这件 —— 它比"哪一路没内容"重要得多
  if (h.transparentShare >= 0.5) {
    const tail = oneSided.length ? `另外 ${oneSided.join('，')}。` : '';
    return {
      kind: 'info',
      text: `${pct(h.transparentShare)} 的像素是全透明的，下面的分布只按剩下 ${h.visible.toLocaleString()} 个可见像素算。${tail}`
    };
  }

  if (oneSided.length) {
    return {
      kind: 'info',
      text: `${oneSided.join('，')} —— 这一路基本没有渐变信息。当遮罩用的图这样是正常的。`
    };
  }

  if (h.flat.length) {
    return {
      kind: 'info',
      text: `${h.flat.map((c) => c.toUpperCase()).join('/')} 路整条都是同一个值 —— 这一路没内容。`
    };
  }
  return { kind: 'ok', text: '分布正常，两端都没有明显堆积。' };
}
