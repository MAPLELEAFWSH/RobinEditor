/**
 * ikClut 的纯运算部分。从组件里拆出来是为了能在 Node 里直接跑测试 ——
 * 网格排法、测试图、混表公式这三样错一个，出来的 LUT 就是错的，
 * 而它们在界面上肉眼看不出来（颜色就是"有点不对"）。
 *
 * CLUT 的排法按 ikClut 包自己那套格式（本工具就是要把烘出来的表喂给它）：
 *   ClutPixelSize = 32；一张 1024×32 的图横向排 32 个 32×32 切片；
 *   切片号 = 蓝，切片内横轴 = 红、纵轴 = 绿。
 *   换算成图片坐标就是 x = 蓝*32 + 红、y = 绿 —— 和 img.ts 的
 *   clutFromImage(flipB = false) 完全一致。
 */
import {
  applyGrade,
  blankImageData,
  clutFromImage,
  type Clut,
  type GradeParams
} from '$lib/img';

export const CLUT_SIZE = 32;
export const CLUT_W = CLUT_SIZE * CLUT_SIZE;
export const CLUT_H = CLUT_SIZE;

/* ------------------------------------------------------------ 色相 */

export function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  ];
}

/* ------------------------------------------------------------ 测试图 */

/** 下段那 12 个色块。肤色占多数，因为调色最常栽在肤色上 */
export const SWATCHES: [number, number, number][] = [
  [246, 216, 198],
  [232, 191, 168],
  [201, 158, 133],
  [160, 116, 92],
  [120, 82, 64],
  [236, 236, 236],
  [176, 176, 176],
  [96, 96, 96],
  [40, 40, 40],
  [222, 84, 78],
  [92, 168, 108],
  [84, 122, 208]
];

/**
 * 程序生成的基准图。三段，各有各的用处：
 *   上 30% 32 级灰阶 —— 判断曲线把哪一段拉起来了
 *   中 30% 满饱和色相扫 —— 判断整体偏色
 *   下 40% 12 个常用色调 —— 判断肤色是不是被带跑了
 */
export function makeTestImage(w = 512, h = 320): ImageData {
  const d = blankImageData(w, h);
  const px = d.data;
  const bandA = Math.round(h * 0.3);
  const bandB = Math.round(h * 0.3);

  for (let y = 0; y < bandA; y++) {
    for (let x = 0; x < w; x++) {
      const step = Math.min(31, Math.floor((x / w) * 32));
      const v = Math.round((step / 31) * 255);
      const i = (y * w + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = v;
      px[i + 3] = 255;
    }
  }

  for (let y = bandA; y < bandA + bandB; y++) {
    const t = (y - bandA) / Math.max(1, bandB - 1);
    const val = 1 - t * 0.72;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = hsv2rgb((x / w) * 360, 1, val);
      const i = (y * w + x) * 4;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }

  const sw = w / SWATCHES.length;
  for (let y = bandA + bandB; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = Math.min(SWATCHES.length - 1, Math.floor(x / sw));
      const [r, g, b] = SWATCHES[k];
      const i = (y * w + x) * 4;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }
  return d;
}

/* ------------------------------------------------------------ 网格与烘焙 */

/**
 * 32³ 的采样网格，布局按 ikClut 的读法排：
 *   x = 蓝 * 32 + 红，y = 绿
 * 每格填 (r/31, g/31, b/31)，这样 clutFromImage 取出来的表项下标正好对上。
 */
export function makeClutGrid(size = CLUT_SIZE): ImageData {
  const g = blankImageData(size * size, size);
  const d = g.data;
  for (let b = 0; b < size; b++) {
    for (let gg = 0; gg < size; gg++) {
      for (let r = 0; r < size; r++) {
        const x = b * size + r;
        const i = (gg * size * size + x) * 4;
        d[i] = Math.round((r / (size - 1)) * 255);
        d[i + 1] = Math.round((gg / (size - 1)) * 255);
        d[i + 2] = Math.round((b / (size - 1)) * 255);
        d[i + 3] = 255;
      }
    }
  }
  return g;
}

/**
 * 把调色参数烘成 CLUT。
 *
 * 做法是拿网格图**跑一遍 applyGrade**，而不是另写一套采样循环。
 * 好处：LUT 和预览用的是同一段代码，"打回去颜色不一样"就只可能来自
 * 量化 + 三线性插值，不可能来自两套实现的分歧 —— 自检那个差值才有意义。
 */
export function bakeClut(grid: ImageData, params: GradeParams, size = CLUT_SIZE): Clut {
  return clutFromImage(applyGrade(grid, params), size, false);
}

/* ------------------------------------------------------------ 混表 */

/**
 * 混多张 CLUT。
 *
 * 混的是**表**不是像素。三线性采样对表值是线性的，所以
 * 「先各自采样再 lerp」和「先把表 lerp 再采样」数学上完全等价，
 * 但后者只算 32³ 次，前者每个像素都要算四遍。
 *
 * 权重公式跟 ikClut.fx 的约定一致：X 混 (1,2) 和 (3,4)，Y 再混这两组。
 * 官方注释给的 X=0.3 / Y=0.7 → 21% / 9% / 49% / 21%，和这个公式对得上。
 */
export function clutWeights(n: number, x: number, y: number): number[] {
  if (n <= 1) return [1];
  if (n === 2) return [1 - x, x];
  return [(1 - y) * (1 - x), (1 - y) * x, y * (1 - x), y * x];
}

export function mixClutTables(list: Clut[], x: number, y: number): Clut | null {
  const use = list.filter(Boolean);
  if (!use.length) return null;
  const size = use[0].size;
  const out: Clut = { size, data: new Uint8ClampedArray(size ** 3 * 3) };

  if (use.length === 1) {
    out.data.set(use[0].data);
    return out;
  }
  if (use.length === 2) {
    const [a, b] = use;
    for (let i = 0; i < out.data.length; i++) {
      out.data[i] = a.data[i] + (b.data[i] - a.data[i]) * x;
    }
    return out;
  }
  const [a, b, c, d] = use;
  for (let i = 0; i < out.data.length; i++) {
    const ab = a.data[i] + (b.data[i] - a.data[i]) * x;
    const cd = c.data[i] + (d.data[i] - c.data[i]) * x;
    out.data[i] = ab + (cd - ab) * y;
  }
  return out;
}

/* ------------------------------------------------------------ 自检 */

/** 两张同尺寸图的最大 / 平均通道差 */
export function channelDiff(a: ImageData, b: ImageData): { max: number; mean: number } {
  const n = Math.min(a.width * a.height, b.width * b.height);
  let max = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const d = Math.abs(a.data[i * 4 + k] - b.data[i * 4 + k]);
      if (d > max) max = d;
      sum += d;
    }
  }
  return { max, mean: n ? sum / (n * 3) : 0 };
}
