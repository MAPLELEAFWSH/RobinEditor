/**
 * ② 自检差值挪到 512 粗图上算 —— **这一步的正当性要自己证**。
 *
 * 改法把"LUT 打回图 vs 直接跑链"的差值改成在 512 粗图上量（省下每停一次手 0.6 秒）。
 * 这不成立的风险很具体：万一这个统计量**跟着图的大小走**（比如图越大越容易撞到极端像素、
 * max 差就越大），那读数就变了个意思，用户看到的是"缩过图的自检"。
 *
 * 所以这里量同一张内容、同一条**真的在动的链**（基本+曲线，曝光/对比度/饱和度都拧开）
 * 在 512 / 1024 / 2048 / 4096×2048 四档下的 max/mean 差。同量级 → 挪得成立。
 *
 * 注意：内容用**有梯度的合成图**（不是纯噪声），跟真贴图那种连续色调更像；
 * 差值来自 32³ 的量化与三线性插值，本来就是"局部"的东西。
 *
 * 用法：node --import ./tmp/register-loader.mjs tmp\量-②自检档位差.mjs
 */
import { applyClut, previewOf } from '../src/lib/img.ts';
import { channelDiff, makeClutGrid, CLUT_SIZE } from '../src/lib/modules/ikclut/ops.ts';
import { 跑链, 烘成CLUT, 默认链 } from '../src/lib/modules/ikclut/grade/chain.ts';

const 网格 = makeClutGrid(CLUT_SIZE);

/** 一条**真的在动**的链：曝光 1.35 / 对比度 1.2 / 饱和度 1.15，再加一条压暗曲线 */
function 造链() {
  const 链 = 默认链();
  const 基本 = 链.find((n) => n.kind === 'basic');
  if (基本) 基本.p = { ...基本.p, exposure: 1.35, contrast: 1.2, saturation: 1.15 };
  const 曲线 = 链.find((n) => n.kind === 'curves');
  if (曲线) 曲线.p = { ...曲线.p, r: [{ x: 0, y: 0 }, { x: 0.5, y: 0.42 }, { x: 1, y: 1 }] };
  return 链;
}

/** 有梯度的图（跟真贴图的连续色调更像，别用周期图案 —— 那种会被压成一两个值） */
function 造源(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const u = x / (w - 1);
      const v = y / (h - 1);
      d[o] = Math.round(255 * (0.15 + 0.7 * u + 0.1 * Math.sin(u * 9)));
      d[o + 1] = Math.round(255 * (0.2 + 0.6 * v + 0.15 * Math.cos(v * 7)));
      d[o + 2] = Math.round(255 * (0.5 + 0.35 * (1 - u) * (1 - v)));
      d[o + 3] = 255;
    }
  }
  return new ImageData(d, w, h);
}

const 链 = 造链();
const 表 = 烘成CLUT(网格, 链, CLUT_SIZE);

const 尺寸 = [
  [512, 512],
  [1024, 1024],
  [2048, 2048],
  [4096, 2048]
];

console.log('同一张内容、同一条链（曝光 1.35 / 对比度 1.2 / 饱和度 1.15 + 一条压暗曲线）\n');
console.log('源尺寸'.padEnd(14) + '最大差'.padStart(8) + '平均差'.padStart(12));

const 大图 = 造源(4096, 2048);
let 基准 = null;
for (const [w, h] of 尺寸) {
  /* 四档都用**同一张 4096×2048 的内容**缩下来 —— 换内容就没有可比性了 */
  const 源 = w === 4096 ? 大图 : previewOf(大图, w);
  const 直算 = 跑链(源, 链);
  const diff = channelDiff(直算, applyClut(源, 表));
  if (!基准) 基准 = diff;
  console.log(
    `${源.width}×${源.height}`.padEnd(14) +
      String(diff.max).padStart(8) +
      diff.mean.toFixed(4).padStart(12)
  );
}

console.log('\n判读：四档的 max 差只要同一量级（差一两级灰度以内）就算"跟图的大小无关"，');
console.log('      挪到 512 粗图算就是诚实的；要是 4096 明显更大，那读数就变了意思，不能挪。');
