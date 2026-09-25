/**
 * 像素运算。所有贴图功能共用这一层，别再各写各的。
 *
 * 约定：
 *   · 内部一律用 ImageData（RGBA8、非预乘），跟 canvas 对齐
 *   · 大图先缩到预览尺寸再算，导出时按原尺寸重算一遍
 *   · 不管色彩空间。MMD 贴图是 sRGB 直存，中间插值就当线性使，
 *     要精确 gamma 的地方（ramp 的渐变）单独说
 */

export type RGBA = { r: number; g: number; b: number; a: number };

export const CHANNEL_KEYS = ['r', 'g', 'b', 'a'] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

export const CHANNEL_LABEL: Record<ChannelKey, string> = { r: 'R', g: 'G', b: 'B', a: 'A' };

/** 分量来源：某张图的某个通道，或者一个常量 */
export type ChannelSource = {
  /** 图片槽位 id；空串表示用常量 */
  slot: string;
  ch: ChannelKey;
  /** slot 为空时用的常量 0-255 */
  constant: number;
  /** 反相 */
  invert: boolean;
};

export function newCanvas(w: number, h: number) {
  return new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

export function ctx2d(cv: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const c = cv.getContext('2d', { willReadFrequently: true });
  if (!c) throw new Error('拿不到 2D 上下文');
  return c;
}

export function blankImageData(w: number, h: number): ImageData {
  return new ImageData(Math.max(1, w), Math.max(1, h));
}

export function bitmapToImageData(bmp: ImageBitmap | HTMLCanvasElement | HTMLImageElement): ImageData {
  const w = 'width' in bmp ? bmp.width : 0;
  const h = 'height' in bmp ? bmp.height : 0;
  const cv = newCanvas(w, h);
  const c = ctx2d(cv);
  c.drawImage(bmp as any, 0, 0);
  return c.getImageData(0, 0, cv.width, cv.height);
}

export function imageDataToBitmap(data: ImageData): ImageBitmap {
  const cv = newCanvas(data.width, data.height);
  ctx2d(cv).putImageData(data, 0, 0);
  // 从 OffscreenCanvas 直接转，省一次拷贝
  return cv.transferToImageBitmap();
}

/**
 * 转成能塞进 <img src> 的 data URL（预览用）。
 *
 * **只建一块画布，直接 `putImageData`。**
 * 原来先写进 OffscreenCanvas、再 `drawImage` 到一块普通 canvas 上（注释写着"OffscreenCanvas 没 toDataURL"），
 * 那是把上面 `imageDataToPng` 那条路的写法顺手抄过来的 —— 那边要 `convertToBlob`，只有 OffscreenCanvas 有。
 * 普通 canvas 的 2D 上下文本来就有 `putImageData`：省掉一块全尺寸画布和一次 `drawImage`。
 * ② 细档改成原分辨率之后，这一下在 4096×2048 上就是少一次 33.6MB 的分配；
 * 两条路的 PNG 字节完全相同（`tmp\量-②编码开销.mjs` 里比过），编码那 ~92ms 一点没变。
 */
export function imageDataToUrl(data: ImageData): string {
  const c = document.createElement('canvas');
  c.width = data.width;
  c.height = data.height;
  const g = c.getContext('2d')!;
  g.putImageData(data, 0, 0);
  return c.toDataURL('image/png');
}

/**
 * 跟 `imageDataToUrl` 一样，但**同一个 `ImageData` 对象只编一次，之后给同一个字符串**。
 *
 * 为什么要它：② 的细档改成原分辨率之后，`原图` 那张每停一次手都要重新编码一遍 ——
 * 而它跟调色参数根本无关，像素自始至终没变过（实测真 4096×2048 上纯编码 92ms，
 * 停手那一刻的卡顿 357ms 里有它一份）。
 *
 * 敢按对象身份记的前提跟 `previewOf` 那条一样：**源图在整个会话里是换引用、不改内容的**
 * （`Slots` 每次载入造新的）。所以**只给"源图那条链上的图"用**（② 的 `原图` 就是），
 * 别拿去缓链上算出来的中间结果 —— 那些有可能被就地改写。
 */
const urlCache = new WeakMap<ImageData, string>();

export function imageDataToUrl记住(data: ImageData): string {
  const 有 = urlCache.get(data);
  if (有 !== undefined) return 有;
  const u = imageDataToUrl(data);
  urlCache.set(data, u);
  return u;
}

export async function imageDataToPng(data: ImageData): Promise<Uint8Array> {
  const cv = newCanvas(data.width, data.height);
  ctx2d(cv).putImageData(data, 0, 0);
  const blob = await cv.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

/* ------------------------------------------------------------ 缩放 */

export type ScaleMode = 'nearest' | 'bilinear' | 'bicubic' | 'lanczos';

/** Catmull-Rom（a = -0.5）。t 的单位是源像素 */
function cubicKernel(t: number): number {
  const a = -0.5;
  const x = Math.abs(t);
  if (x < 1) return ((a + 2) * x - (a + 3)) * x * x + 1;
  if (x < 2) return (((x - 5) * x + 8) * x - 4) * a;
  return 0;
}

/** Lanczos，a = 3 */
function lanczosKernel(t: number): number {
  const a = 3;
  const x = Math.abs(t);
  if (x < 1e-8) return 1;
  if (x >= a) return 0;
  const p = Math.PI * x;
  return (a * Math.sin(p) * Math.sin(p / a)) / (p * p);
}

/**
 * 可分离重采样。先横再竖，中间落 Float32，免得两次取整叠起来。
 * 权重按和归一化，边缘用钳位取样。
 */
function separable(
  src: ImageData,
  w: number,
  h: number,
  kernel: (t: number) => number,
  support: number
): ImageData {
  const sw = src.width;
  const sh = src.height;
  const s = src.data;

  const mid = new Float32Array(w * sh * 4);
  const fx = sw / w;
  const kx = Math.max(1, fx);
  const supX = support * kx;
  for (let y = 0; y < sh; y++) {
    const rowOff = y * sw * 4;
    for (let x = 0; x < w; x++) {
      const cx = (x + 0.5) * fx - 0.5;
      const lo = Math.ceil(cx - supX);
      const hi = Math.floor(cx + supX);
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      let sum = 0;
      for (let i = lo; i <= hi; i++) {
        const wt = kernel((i - cx) / kx);
        if (wt === 0) continue;
        const cl = i < 0 ? 0 : i >= sw ? sw - 1 : i;
        const si = rowOff + cl * 4;
        sr += s[si] * wt;
        sg += s[si + 1] * wt;
        sb += s[si + 2] * wt;
        sa += s[si + 3] * wt;
        sum += wt;
      }
      const ti = (y * w + x) * 4;
      if (sum !== 0) {
        mid[ti] = sr / sum;
        mid[ti + 1] = sg / sum;
        mid[ti + 2] = sb / sum;
        mid[ti + 3] = sa / sum;
      }
    }
  }

  const out = blankImageData(w, h);
  const d = out.data;
  const fy = sh / h;
  const ky = Math.max(1, fy);
  const supY = support * ky;
  for (let y = 0; y < h; y++) {
    const cy = (y + 0.5) * fy - 0.5;
    const lo = Math.ceil(cy - supY);
    const hi = Math.floor(cy + supY);
    for (let x = 0; x < w; x++) {
      const colOff = x * 4;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      let sum = 0;
      for (let i = lo; i <= hi; i++) {
        const wt = kernel((i - cy) / ky);
        if (wt === 0) continue;
        const cl = i < 0 ? 0 : i >= sh ? sh - 1 : i;
        const si = cl * w * 4 + colOff;
        sr += mid[si] * wt;
        sg += mid[si + 1] * wt;
        sb += mid[si + 2] * wt;
        sa += mid[si + 3] * wt;
        sum += wt;
      }
      const di = (y * w + x) * 4;
      if (sum !== 0) {
        d[di] = sr / sum;
        d[di + 1] = sg / sum;
        d[di + 2] = sb / sum;
        d[di + 3] = sa / sum;
      }
    }
  }
  return out;
}

/**
 * 缩放。nearest 用于像素级控制图（ramp、面具），其余用于照片类。
 * 自己写是怕 drawImage 的双线性在不同 WebView 上滤波不同，
 * 导出结果要能复现。
 *
 * bicubic / lanczos 是给「源图比目标小」准备的：绝区零的 _N 常常只有 LM 的一半，
 * 放大核直接决定 LM 的 G 通道像不像，数字见 packLm 的头注释。
 */
export function resize(
  src: ImageData,
  w: number,
  h: number,
  mode: ScaleMode = 'bilinear'
): ImageData {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  if (w === src.width && h === src.height) return src;

  if (mode === 'bicubic') return separable(src, w, h, cubicKernel, 2);
  if (mode === 'lanczos') return separable(src, w, h, lanczosKernel, 3);

  const out = blankImageData(w, h);
  const s = src.data;
  const d = out.data;
  const sw = src.width;
  const sh = src.height;

  if (mode === 'nearest') {
    for (let y = 0; y < h; y++) {
      const sy = Math.min(sh - 1, Math.floor((y * sh) / h));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(sw - 1, Math.floor((x * sw) / w));
        const si = (sy * sw + sx) * 4;
        const di = (y * w + x) * 4;
        d[di] = s[si];
        d[di + 1] = s[si + 1];
        d[di + 2] = s[si + 2];
        d[di + 3] = s[si + 3];
      }
    }
    return out;
  }

  // 双线性。先把源坐标算好，避免内层重复乘除
  const fx = sw / w;
  const fy = sh / h;
  for (let y = 0; y < h; y++) {
    const sy = (y + 0.5) * fy - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = Math.min(1, Math.max(0, sy - y0));
    for (let x = 0; x < w; x++) {
      const sx = (x + 0.5) * fx - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = Math.min(1, Math.max(0, sx - x0));
      const i00 = (y0 * sw + x0) * 4;
      const i01 = (y0 * sw + x1) * 4;
      const i10 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const di = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) {
        const top = s[i00 + k] * (1 - wx) + s[i01 + k] * wx;
        const bot = s[i10 + k] * (1 - wx) + s[i11 + k] * wx;
        d[di + k] = top * (1 - wy) + bot * wy;
      }
    }
  }
  return out;
}

/**
 * 预览用：最长边压到 n 以内。
 *
 * **同一张源图 + 同一个边长只压一次，返回的是同一个对象。**
 * 图层缓存（`LayerCache`）按源图的**对象身份**建键（`ops.ts` 的 `objId`），
 * 每次新铸一个 `ImageData` 就等于每次都换号 —— 只要贴图比预览边长，
 * 缓存一次都命中不了，面板上那个命中计数会一直是 0。
 *
 * 源图在整个会话里是换引用、不改内容的（`Slots` 每次载入造新的），
 * 所以按身份记是安全的。WeakMap 不挡着源图被回收。
 */
const previewCache = new WeakMap<ImageData, Map<number, ImageData>>();

export function previewOf(src: ImageData, maxSide = 512): ImageData {
  const m = Math.max(src.width, src.height);
  if (m <= maxSide) return src;
  let bySide = previewCache.get(src);
  if (!bySide) {
    bySide = new Map();
    previewCache.set(src, bySide);
  }
  const hit = bySide.get(maxSide);
  if (hit) return hit;
  const k = maxSide / m;
  const out = resize(src, src.width * k, src.height * k, 'bilinear');
  bySide.set(maxSide, out);
  return out;
}

/**
 * 预览该按多长的边生成。
 *
 * 以前各页自己硬编码（320 / 384 / 512），而预览台在 150% 缩放的 1600 档屏上
 * 约 940 CSS px 宽 = **1410 设备像素** —— 512 被拉上去就是放大 1.8~2.9 倍，
 * 加上一直 `pixelated`，看着又小又糊（用户报的原话）。
 *
 * 这里按"预览台大约多宽 × 设备像素比"算，再按**实测代价**封顶。
 * 量具 `tmp/preview-cost.mjs` 量的（512 / 1024 / 1536，毫秒）：
 *
 *   applyClut（调色）        7.5 / 29.9 / 69.8   → 调色那条路封 1024（一帧预算按 33ms）
 *   buildControlMaps（msToon）2.9 /  9.0 / 19.7  → 封 1536
 *
 * （原来还有一行是 ⑦「分块定档」的铺块 + 预览代价 —— 那个分区 2026-09-24 由用户决定删了，
 * 量具 `tmp/preview-cost.mjs` 跟着删，这一行没有出处的数字就不留了。）
 *
 * 所以默认上限 1536，"跟着滑杆每一帧重算"且算得贵的那几页传 1024。
 */
export function 预览长边(上限 = 1536, 下限 = 512): number {
  if (typeof window === 'undefined') return 上限;
  const dpr = window.devicePixelRatio || 1;
  /* 侧栏 21rem + 卡片留白，大约占掉视口的四分之一 */
  const 台宽 = Math.min(window.innerWidth * 0.72, 1700) * dpr;
  return Math.max(下限, Math.min(上限, Math.round(台宽)));
}

/* ------------------------------------------------------------ 分量 */

export function extractChannel(src: ImageData, ch: ChannelKey, invert = false): Uint8ClampedArray {
  const n = src.width * src.height;
  const out = new Uint8ClampedArray(n);
  const d = src.data;
  const off = ch === 'r' ? 0 : ch === 'g' ? 1 : ch === 'b' ? 2 : 3;
  if (invert) {
    for (let i = 0; i < n; i++) out[i] = 255 - d[i * 4 + off];
  } else {
    for (let i = 0; i < n; i++) out[i] = d[i * 4 + off];
  }
  return out;
}

/** 单通道灰度 → RGBA 图（分离功能的输出，也是预览底图） */
export function grayToImageData(ch: Uint8ClampedArray, w: number, h: number): ImageData {
  const out = blankImageData(w, h);
  const d = out.data;
  for (let i = 0; i < w * h; i++) {
    const v = ch[i];
    d[i * 4] = v;
    d[i * 4 + 1] = v;
    d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  return out;
}

/** 把单通道塞进某个颜色显示出来（看 alpha 之类的通道时比灰度直观） */
export function tint(ch: Uint8ClampedArray, w: number, h: number, color: RGBA): ImageData {
  const out = blankImageData(w, h);
  const d = out.data;
  for (let i = 0; i < w * h; i++) {
    const t = ch[i] / 255;
    d[i * 4] = color.r * t;
    d[i * 4 + 1] = color.g * t;
    d[i * 4 + 2] = color.b * t;
    d[i * 4 + 3] = 255;
  }
  return out;
}

/* ------------------------------------------------------------ 打包 */

export type PackMap = Record<ChannelKey, ChannelSource>;

/**
 * 按 map 把来源拼成一张 RGBA。
 * sources 的键是槽位 id，值是该槽位当前尺寸的像素。
 * 尺寸不一致时以第一个槽位为准缩放。
 */
/**
 * 常量填充的**唯一写法**：夹到 0-255 再取整。
 *
 * 原来三处各写各的（`channels/ops.ts` 的 `applyPlan` 夹取 + 取整，这里与 `buildLayerRgba`
 * 直接赋值）：`Uint8ClampedArray` 的隐式兜底是**截断**（1.8 → 1），不是四舍五入，
 * 而 `applyPlan` 那两处是 `Math.round`。界面滑杆给的都是整数所以看不出来，
 * 工程文件导入那种入口就会分叉。
 */
export function 字节值(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function pack(
  w: number,
  h: number,
  map: PackMap,
  sources: Map<string, ImageData>
): ImageData {
  const out = blankImageData(w, h);
  const d = out.data;
  const off: Record<ChannelKey, number> = { r: 0, g: 1, b: 2, a: 3 };

  // 先把四个分量的完整数组算出来，再一次性写。直接在内层做分支会慢很多。
  const planes: Uint8ClampedArray[] = [];
  for (const k of CHANNEL_KEYS) {
    const s = map[k];
    if (!s || !s.slot) {
      const arr = new Uint8ClampedArray(w * h);
      arr.fill(字节值(s?.constant ?? 0));
      planes.push(arr);
      continue;
    }
    const img = sources.get(s.slot);
    if (!img) {
      const arr = new Uint8ClampedArray(w * h);
      arr.fill(字节值(s.constant ?? 0));
      planes.push(arr);
      continue;
    }
    const use = img.width === w && img.height === h ? img : resize(img, w, h, 'bilinear');
    planes.push(extractChannel(use, s.ch, s.invert));
  }

  const [pr, pg, pb, pa] = planes;
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = pr[i];
    d[i * 4 + 1] = pg[i];
    d[i * 4 + 2] = pb[i];
    d[i * 4 + 3] = pa[i];
  }
  void off;
  return out;
}

/* ------------------------------------------------------------ 明度 / 统计 */

/** Rec.709 相对明度，0-255 */
export function lumaOf(src: ImageData): Uint8ClampedArray {
  const n = src.width * src.height;
  const out = new Uint8ClampedArray(n);
  const d = src.data;
  for (let i = 0; i < n; i++) {
    out[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
  }
  return out;
}

export function histogram(ch: Uint8ClampedArray): Uint32Array {
  const h = new Uint32Array(256);
  for (let i = 0; i < ch.length; i++) h[ch[i]]++;
  return h;
}

/** 直方图里占 99% 的区间。自动拉伸黑点白点用 */
export function autoRange(ch: Uint8ClampedArray): { lo: number; hi: number } {
  const h = histogram(ch);
  const total = ch.length;
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let i = 0; i < 256; i++) {
    acc += h[i];
    if (acc > total * 0.005) {
      lo = i;
      break;
    }
  }
  acc = 0;
  for (let i = 255; i >= 0; i--) {
    acc += h[i];
    if (acc > total * 0.005) {
      hi = i;
      break;
    }
  }
  return { lo, hi: Math.max(hi, lo + 1) };
}

/* ------------------------------------------------------------ 曲线 */

/**
 * 插值方式。
 *
 * 前五种照着 **Blender 的 Color Ramp 节点**来（不是 RGB Curves 那个贝塞尔编辑器，
 * ramp 在 Blender 里对应的是 Color Ramp）：
 *
 *   constant   Constant   整段取左端点的值，硬切
 *   linear     Linear     直线连接
 *   ease       Ease       smoothstep，两端导数为 0
 *   bspline    B-Spline   均匀三次 B 样条，比 Ease 更松，段与段之间连续
 *   cardinal   Cardinal   Catmull-Rom，**穿过**控制点，张力 0.5
 *
 * 加 bspline / cardinal 是因为原来的四种里只有 constant / linear / ease
 * 能在 Blender 里找到对应，而实际拉 ramp 时"想要更顺但不想要 Ease 那种停顿感"
 * 是很常见的需求 —— 那就是 B-Spline / Cardinal 的差别。
 *
 * step 是这边额外留的（星铁那种硬阶梯），Blender 没有单独的档。
 *
 * B-Spline 和 Cardinal 都要看前后各一个邻居点，所以不能在只有两点的段上
 * 凭空造形状 —— 端点处退化成 linear，这点跟 Blender 一致。
 */
export type CurveKind = 'linear' | 'smooth' | 'ease' | 'step' | 'constant' | 'bspline' | 'cardinal';

/**
 * 每种插值在界面上的名字和一句说明。
 *
 * 用 `Record<CurveKind, …>` 而不是一张元组数组：**加一个成员忘了写说明就编译不过**。
 * 之前那是元组数组，`smooth` 就漏在表外 —— 三个内置预设写的是它，
 * 界面上却没有对应按钮，于是点了预设之后没有任何按钮是按下状态、说明栏也是空的。
 *
 * `smooth` 是 `ease` 的遗留别名（`evalCurve` 里跟 ease 一起落 default 分支，都是
 * smoothstep），留着只是因为那几个预设里写的就是它。
 */
export const KIND_LABEL: Record<CurveKind, { name: string; hint: string }> = {
  linear: { name: '线性', hint: '两点之间直线连。控制点就是曲线的形状本身。' },
  ease: {
    name: '缓动',
    hint: 'smoothstep，两端导数为 0。过渡最软，但两点之间会被拉成 S 形 —— 曲线不再恒等。'
  },
  smooth: { name: '平滑', hint: '跟缓动同一个算法（smoothstep）。几个内置预设里写的是这个名字。' },
  bspline: {
    name: 'B 样条',
    hint: '均匀三次 B 样条。比缓动更松，段与段之间接得顺，代价是曲线不穿过中间的控制点。'
  },
  cardinal: {
    name: '基数',
    hint: 'Catmull-Rom，张力 0.5。一样顺，但穿过控制点 —— 想把某个明度钉死在某个值上就用它。'
  },
  constant: { name: '常量', hint: '整段取左端点的值，硬切。' },
  step: { name: '阶梯', hint: '段内过半才跳，也是硬切，但跳点在中间。星铁那种档位用这个。' }
};

export type CurvePoint = { x: number; y: number };

/** Catmull-Rom / B-Spline 的 y 混合。t 是段内归一化位置 */
function cubicPick(p0: number, p1: number, p2: number, p3: number, t: number, kind: 'bspline' | 'cardinal') {
  if (kind === 'cardinal') {
    // Catmull-Rom，张力 0.5：曲线穿过 p1 和 p2
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      0.5 *
      (2 * p1 +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
    );
  }
  // 均匀三次 B 样条：不穿过中间点，只被它们拉过去，所以比 Catmull-Rom 更软
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    ((1 - t) ** 3 * p0 + (3 * t3 - 6 * t2 + 4) * p1 + (-3 * t3 + 3 * t2 + 3 * t + 1) * p2 + t3 * p3) / 6
  );
}

/**
 * 按控制点求值。x/y 都是 0-1。
 */
export function evalCurve(pts: CurvePoint[], x: number, kind: CurveKind = 'ease'): number {
  if (pts.length === 0) return x;
  const s = [...pts].sort((a, b) => a.x - b.x);
  if (s.length === 1) return s[0].y;
  if (x <= s[0].x) return s[0].y;
  if (x >= s[s.length - 1].x) return s[s.length - 1].y;

  // 段与段之间不能跨过同 x 的点，否则后面所有段的 t 都会算错
  for (let k = 1; k < s.length; k++) {
    if (s[k].x <= s[k - 1].x) s[k].x = s[k - 1].x + 1e-6;
  }

  let i = 0;
  while (i < s.length - 2 && x > s[i + 1].x) i++;
  const a = s[i];
  const b = s[i + 1];
  const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);

  switch (kind) {
    case 'step':
      return t >= 0.5 ? b.y : a.y;
    case 'constant':
      return a.y;
    case 'linear':
      return a.y + (b.y - a.y) * t;
    case 'bspline':
    case 'cardinal': {
      // 端点处没有前一个/后一个邻居时，**按边界钳制**（把首/末点当成重复的邻居）。
      // 一开始写成"没邻居就退回 linear"，结果只要点数少（3 个点时两段全没邻居）
      // 整条曲线就跟 linear 一模一样，等于这个插值方式不存在。
      // 钳制才有形状，Blender 在两端也是这么处理的。
      const p0 = s[i - 1] ?? a;
      const p3 = s[i + 2] ?? b;
      const v = cubicPick(p0.y, a.y, b.y, p3.y, t, kind);
      // 样条会过冲，夹回 0-1，不然 bathtub 形状会把颜色推爆
      return v < 0 ? 0 : v > 1 ? 1 : v;
    }
    default: {
      // smoothstep，两端导数为 0，就是 Blender 的 Ease
      const e = t * t * (3 - 2 * t);
      return a.y + (b.y - a.y) * e;
    }

  }
}

/** 把曲线烘成 256 项查表，逐像素应用时比每次求值快 */
export function bakeCurve(pts: CurvePoint[], kind: CurveKind): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = evalCurve(pts, i / 255, kind) * 255;
  return lut;
}

export function applyLut(src: ImageData, lut: Uint8ClampedArray, ch: ChannelKey | 'luma'): ImageData {
  const out = blankImageData(src.width, src.height);
  const d = out.data;
  const s = src.data;
  const n = src.width * src.height;
  for (let i = 0; i < n; i++) {
    const si = i * 4;
    d[si] = s[si];
    d[si + 1] = s[si + 1];
    d[si + 2] = s[si + 2];
    d[si + 3] = s[si + 3];
    if (ch === 'luma') {
      const l = 0.2126 * s[si] + 0.7152 * s[si + 1] + 0.0722 * s[si + 2];
      /*
       * 索引**四舍五入**，不是截断。
       *
       * 截断有固定 −0.5 的偏置：l = 127.7 取 lut[127]，恒等表下算出来的比例是
       * 127/127.7 = 0.9945，整张图被静默压暗 0.55% —— 跟这里 `clamp255` 那条注释
       * 说的是同一件事（那边就是踩过才写的四舍五入）。
       */
      const v = lut[clamp255(l)];
      const k = l > 1 ? v / l : v;
      d[si] = Math.min(255, s[si] * k);
      d[si + 1] = Math.min(255, s[si + 1] * k);
      d[si + 2] = Math.min(255, s[si + 2] * k);
    } else {
      const off = ch === 'r' ? 0 : ch === 'g' ? 1 : ch === 'b' ? 2 : 3;
      d[si + off] = lut[s[si + off]];
    }
  }
  return out;
}

/* ------------------------------------------------------------ 颜色调整（ikClut 用） */

/**
 * 一次调色的全部参数。
 *
 * **逐像素的算式只在这里一份**：`ikclut/grade/` 那套节点是"往这个函数里填不同的参数"
 * （基本节点填基本项、曲线节点填曲线），不是在别处再写一遍 —— 两套实现漂开之后
 * "预览和烘焙出来的 LUT 颜色不一样"这种问题就再也查不出来了。
 *
 * 第二批那几项是可选的：**不写 = 恒等 = 那一步整段不执行**。
 * 全恒等时输出必须与输入逐字节相同（见 `tmp/grade-chain.test.mjs` 第一条断言）——
 * 浮点绕一圈会掉 ±1，所以每一步都得带开关，不能"乘 1 也算一遍"。
 */
export type GradeParams = {
  /** 亮度增益，1 = 不变 */
  exposure: number;
  contrast: number;
  saturation: number;
  /** 色相旋转，度 */
  hue: number;
  /** 三条曲线的查表，长度 256 */
  curveR: Uint8ClampedArray;
  curveG: Uint8ClampedArray;
  curveB: Uint8ClampedArray;

  /* ---- 第二批：缺省即恒等 ---- */

  /** 色温。>0 偏暖（提红压蓝），−1~1，满量程约 ±25% 通道增益 */
  temperature?: number;
  /** 色调。>0 偏品红，−1~1 */
  tint?: number;
  /** 高光。−1 压、+1 提，按亮度加权，只动亮度不动色相 */
  highlights?: number;
  /** 阴影。−1 压、+1 提 */
  shadows?: number;
  /** 黑点（0~1）。输入里低于它的压到 0 */
  black?: number;
  /** 白点（0~1）。输入里高于它的提到 1 */
  white?: number;
};

/**
 * 绕灰轴转色度（YIQ 那套近似矩阵）。输入输出都是 0~1。
 *
 * **色相旋转的算式只在这里一份**：`applyGrade` 和 ② 那几个节点（色轮 / HSL / LOG / 变形）
 * 都调它。以前这段矩阵是内联在 `applyGrade` 里的，第二批节点要用**可变角度**的同类旋转，
 * 再抄一份 9 项矩阵就是两套实现 —— 那种漂开之后"预览和烘焙出来的颜色不一样"根本查不出来。
 *
 * 参数是算好的 `cosH` / `sinH`（热循环里每个像素算一次三角函数太贵）。
 * 结果写进 `out` 这个三元组，不在循环里造对象。只动色度、不动亮度。
 */
export function 绕灰轴(
  r: number,
  g: number,
  b: number,
  cosH: number,
  sinH: number,
  out: [number, number, number]
): void {
  out[0] =
    (0.299 + 0.701 * cosH + 0.168 * sinH) * r +
    (0.587 - 0.587 * cosH + 0.33 * sinH) * g +
    (0.114 - 0.114 * cosH - 0.497 * sinH) * b;
  out[1] =
    (0.299 - 0.299 * cosH - 0.328 * sinH) * r +
    (0.587 + 0.413 * cosH + 0.035 * sinH) * g +
    (0.114 - 0.114 * cosH + 0.292 * sinH) * b;
  out[2] =
    (0.299 - 0.3 * cosH + 1.25 * sinH) * r +
    (0.587 - 0.588 * cosH - 1.05 * sinH) * g +
    (0.114 + 0.886 * cosH - 0.203 * sinH) * b;
}

export function applyGrade(src: ImageData, p: GradeParams): ImageData {
  const out = blankImageData(src.width, src.height);
  const s = src.data;
  const d = out.data;
  const n = src.width * src.height;
  const hueRad = (p.hue * Math.PI) / 180;
  const cosH = Math.cos(hueRad);
  const sinH = Math.sin(hueRad);

  const 黑 = p.black ?? 0;
  const 白 = p.white ?? 1;
  const 用黑白 = (黑 > 0 || 白 < 1) && 白 > 黑;
  const 白黑差 = 白 - 黑 || 1;
  const 温 = p.temperature ?? 0;
  const 调 = p.tint ?? 0;
  const 用温调 = 温 !== 0 || 调 !== 0;
  /* 满量程 ±25%：再大就不是调白平衡，是直接上色了 */
  const 温k = 温 * 0.25;
  const 调k = 调 * 0.25;
  const 高 = p.highlights ?? 0;
  const 阴 = p.shadows ?? 0;
  const 用高阴 = 高 !== 0 || 阴 !== 0;
  /** `绕灰轴` 的复用三元组，免得每像素造一个数组 */
  const 转出: [number, number, number] = [0, 0, 0];

  for (let i = 0; i < n; i++) {
    const si = i * 4;
    let r = s[si] / 255;
    let g = s[si + 1] / 255;
    let b = s[si + 2] / 255;

    // 黑白点先收，后面的曝光对比都在收好的范围里做
    if (用黑白) {
      r = (r - 黑) / 白黑差;
      g = (g - 黑) / 白黑差;
      b = (b - 黑) / 白黑差;
      r = r < 0 ? 0 : r > 1 ? 1 : r;
      g = g < 0 ? 0 : g > 1 ? 1 : g;
      b = b < 0 ? 0 : b > 1 ? 1 : b;
    }

    if (p.exposure !== 1) {
      r *= p.exposure;
      g *= p.exposure;
      b *= p.exposure;
    }

    // 色温压红蓝、色调压绿（品红方向抬红蓝）
    if (用温调) {
      r *= 1 + 温k + 调k * 0.5;
      b *= 1 - 温k + 调k * 0.5;
      g *= 1 - 调k;
    }

    // 对比度绕 0.5 转
    if (p.contrast !== 1) {
      r = (r - 0.5) * p.contrast + 0.5;
      g = (g - 0.5) * p.contrast + 0.5;
      b = (b - 0.5) * p.contrast + 0.5;
    }

    /*
     * 高光 / 阴影：按**亮度**给权重，三条通道加同一个量 ——
     * 加同一个量等于只动亮度、不动色相，肤色被带跑那种事就不会发生。
     */
    if (用高阴) {
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (高 !== 0) {
        const t = (L - 0.5) * 2;
        const w = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
        const add = 高 * w * 0.5;
        r += add;
        g += add;
        b += add;
      }
      if (阴 !== 0) {
        const t = L * 2;
        const w = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
        const add = 阴 * (1 - w) * 0.5;
        r += add;
        g += add;
        b += add;
      }
    }

    // 饱和度：往灰度靠或者离开
    if (p.saturation !== 1) {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = l + (r - l) * p.saturation;
      g = l + (g - l) * p.saturation;
      b = l + (b - l) * p.saturation;
    }

    if (p.hue !== 0) {
      绕灰轴(r, g, b, cosH, sinH, 转出);
      r = 转出[0];
      g = 转出[1];
      b = 转出[2];
    }

    // 曲线最后上，前面都当线性处理
    d[si] = p.curveR[clamp255(r * 255)];
    d[si + 1] = p.curveG[clamp255(g * 255)];
    d[si + 2] = p.curveB[clamp255(b * 255)];
    d[si + 3] = s[si + 3];
  }
  return out;
}

/**
 * 浮点 → 0-255 整数索引。
 *
 * 必须四舍五入，不能截断。截断有固定 −0.5 LSB 偏置：`8/255*255` 浮点算出来是
 * 7.9999999，`| 0` 砍成 7，LUT 索引低一格，一路累积下来恒等烘焙的残差能到
 * 1.48/255（ikClut 那边的自检量出来的）。顺带：索引也必须是整数，
 * 类型化数组的 `arr[7.99]` 取到的是 undefined。
 */
function clamp255(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const r = Math.round(v);
  return r < 0 ? 0 : r > 255 ? 255 : r;
}

/* ------------------------------------------------------------ 边缘 / 距离场 */

/** Sobel 梯度幅值，0-255。msToon 的 EdgeRate 底子 */
export function sobel(ch: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -ch[i - w - 1] - 2 * ch[i - 1] - ch[i + w - 1] +
        ch[i - w + 1] + 2 * ch[i + 1] + ch[i + w + 1];
      const gy =
        -ch[i - w - 1] - 2 * ch[i - w] - ch[i - w + 1] +
        ch[i + w - 1] + 2 * ch[i + w] + ch[i + w + 1];
      const m = Math.sqrt(gx * gx + gy * gy);
      out[i] = m > 255 ? 255 : m;
    }
  }
  return out;
}

/**
 * 二值掩膜的距离场（chamfer 两遍扫描）。
 *
 * 方向：**掩膜上为 0，越远离掩膜值越大**，按 maxDist 归一化到 0-255。
 * 也就是拿一条过渡线当输入，出来的是"离这条线多远"。
 * 上一版写反了（前景取到背景的距离），那样出来的是边缘亮中间黑，正好不能用。
 *
 * 不是精确欧氏距离，但对 FaceSDF 这种用法够了，而且 O(n)，2048² 也跑得动。
 */
export function distanceField(
  mask: Uint8ClampedArray,
  w: number,
  h: number,
  maxDist: number
): Uint8ClampedArray {
  const INF = 1e9;
  const dist = new Float32Array(w * h);
  // 掩膜里是 0（距离零），外面等两遍扫描把最近掩膜的距离填进来
  for (let i = 0; i < w * h; i++) dist[i] = mask[i] > 127 ? 0 : INF;

  const d1 = 1;
  const d2 = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = dist[i];
      if (x > 0) v = Math.min(v, dist[i - 1] + d1);
      if (y > 0) v = Math.min(v, dist[i - w] + d1);
      if (x > 0 && y > 0) v = Math.min(v, dist[i - w - 1] + d2);
      if (x < w - 1 && y > 0) v = Math.min(v, dist[i - w + 1] + d2);
      dist[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = dist[i];
      if (x < w - 1) v = Math.min(v, dist[i + 1] + d1);
      if (y < h - 1) v = Math.min(v, dist[i + w] + d1);
      if (x < w - 1 && y < h - 1) v = Math.min(v, dist[i + w + 1] + d2);
      if (x > 0 && y < h - 1) v = Math.min(v, dist[i + w - 1] + d2);
      dist[i] = v;
    }
  }

  const out = new Uint8ClampedArray(w * h);
  const k = 255 / Math.max(0.0001, maxDist);
  for (let i = 0; i < w * h; i++) {
    const d = dist[i];
    out[i] = d >= INF / 2 ? 255 : Math.min(255, d * k);
  }
  return out;
}
/** 阈值化成掩膜 */
export function threshold(ch: Uint8ClampedArray, t: number, invert = false): Uint8ClampedArray {
  const out = new Uint8ClampedArray(ch.length);
  for (let i = 0; i < ch.length; i++) {
    const on = ch[i] > t;
    out[i] = (invert ? !on : on) ? 255 : 0;
  }
  return out;
}

/* ------------------------------------------------------------ CLUT */

/**
 * 按 ikClut 的排法把一张 1024×32 的 LUT 图展开成查表。
 *
 * 布局（和 ikClut / 常见 3D LUT 一样）：横向是 32 个 32×32 的切片，
 * 每个切片是一层蓝通道；切片内 x 是红、y 是绿。
 * 蓝要不要翻，各家不一样，这里给个参数。
 */
export type Clut = { size: number; data: Uint8ClampedArray };

export function clutFromImage(src: ImageData, size = 32, flipB = false): Clut {
  const data = new Uint8ClampedArray(size * size * size * 3);
  const s = src.data;
  const w = src.width;
  for (let b = 0; b < size; b++) {
    const slice = flipB ? size - 1 - b : b;
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const sx = slice * size + r;
        const sy = g;
        const si = (sy * w + sx) * 4;
        const di = ((b * size + g) * size + r) * 3;
        data[di] = s[si];
        data[di + 1] = s[si + 1];
        data[di + 2] = s[si + 2];
      }
    }
  }
  return { size, data };
}

export function clutToImage(clut: Clut, flipB = false): ImageData {
  const { size, data } = clut;
  const out = blankImageData(size * size, size);
  const d = out.data;
  for (let b = 0; b < size; b++) {
    const slice = flipB ? size - 1 - b : b;
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const di = ((b * size + g) * size + r) * 3;
        const si = (g * size * size + slice * size + r) * 4;
        d[si] = data[di];
        d[si + 1] = data[di + 1];
        d[si + 2] = data[di + 2];
        d[si + 3] = 255;
      }
    }
  }
  return out;
}

/** 三线性插值取色。逐像素算 LUT 时用这个 */
export function clutSample(c: Clut, r: number, g: number, b: number, out: RGBA): void {
  const n = c.size - 1;
  const fr = Math.min(n, Math.max(0, r * n));
  const fg = Math.min(n, Math.max(0, g * n));
  const fb = Math.min(n, Math.max(0, b * n));
  const r0 = fr | 0, g0 = fg | 0, b0 = fb | 0;
  const r1 = Math.min(n, r0 + 1), g1 = Math.min(n, g0 + 1), b1 = Math.min(n, b0 + 1);
  const dr = fr - r0, dg = fg - g0, db = fb - b0;
  const sz = c.size;
  const at = (ri: number, gi: number, bi: number, k: number) =>
    c.data[((bi * sz + gi) * sz + ri) * 3 + k];

  for (let k = 0; k < 3; k++) {
    const c000 = at(r0, g0, b0, k), c100 = at(r1, g0, b0, k);
    const c010 = at(r0, g1, b0, k), c110 = at(r1, g1, b0, k);
    const c001 = at(r0, g0, b1, k), c101 = at(r1, g0, b1, k);
    const c011 = at(r0, g1, b1, k), c111 = at(r1, g1, b1, k);
    const c00 = c000 + (c100 - c000) * dr;
    const c10 = c010 + (c110 - c010) * dr;
    const c01 = c001 + (c101 - c001) * dr;
    const c11 = c011 + (c111 - c011) * dr;
    const c0 = c00 + (c10 - c00) * dg;
    const c1 = c01 + (c11 - c01) * dg;
    const v = c0 + (c1 - c0) * db;
    if (k === 0) out.r = v;
    else if (k === 1) out.g = v;
    else out.b = v;
  }
}

export function applyClut(src: ImageData, c: Clut): ImageData {
  const out = blankImageData(src.width, src.height);
  const s = src.data;
  const d = out.data;
  const n = src.width * src.height;
  const px: RGBA = { r: 0, g: 0, b: 0, a: 255 };
  for (let i = 0; i < n; i++) {
    const si = i * 4;
    clutSample(c, s[si] / 255, s[si + 1] / 255, s[si + 2] / 255, px);
    d[si] = px.r;
    d[si + 1] = px.g;
    d[si + 2] = px.b;
    d[si + 3] = s[si + 3];
  }
  return out;
}
