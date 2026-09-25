/**
 * ② 「调色栏展示的图片要原分辨率不压缩」—— 先把代价量出来，再定怎么改。
 *
 * 现状（`Ikclut.svelte`）：拖动中按 512 长边算（粗），停手后按 1024 长边算（细），
 * 细图直接 `toDataURL('image/png')` 塞进 `<img>`。所以任何比 1024 大的图都被压过，
 * 放大到 100% 看到的不是原像素。
 *
 * 改成"停手后按原分辨率"要花多少？**像素运算这几步在 Node 里量**（跟主线程同一份代码）：
 *   跑链（默认链 基本+曲线） / 烘成CLUT（32³，固定开销） / applyClut（自检用） / channelDiff（自检）
 * PNG 编码那一步要 canvas，Node 里量不了 —— 留到实现那一步在无头 Chrome 里量。
 *
 * 尺寸按**真素材**取（`实战测试用例\贴图` 254 张的长边分布实测）：
 *   ≤512 105 张 / 513~1024 57 张 / 1025~2048 75 张 / 2049~4096 17 张（那 17 张都是 4096×2048）。
 *
 * 用法：node --import ./tmp/register-loader.mjs tmp\量-②原分辨率开销.mjs
 */
import { applyClut, previewOf } from '../src/lib/img.ts';
import { channelDiff, makeClutGrid, CLUT_SIZE } from '../src/lib/modules/ikclut/ops.ts';
import { 跑链, 烘成CLUT, 默认链 as 造默认链 } from '../src/lib/modules/ikclut/grade/chain.ts';

/** 真素材里出现的那几档（宽×高）：从 512×512 一路到 4096×2048 */
const 尺寸 = [
  [512, 512],
  [1024, 1024],
  [2048, 2048],
  [4096, 2048]
];

function 造源(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      d[o] = (x * 7 + y * 3) & 255;
      d[o + 1] = (x * 3 + y * 11) & 255;
      d[o + 2] = (x ^ y) & 255;
      d[o + 3] = 255;
    }
  }
  return new ImageData(d, w, h);
}

function 计时(次, fn, 实参) {
  /* 热身那一下**必须带实参**：不带就成了 `fn(undefined)`，报出来的是"链跑不了"而不是太慢 */
  fn(实参);
  let 最好 = Infinity;
  for (let i = 0; i < 次; i++) {
    const t = performance.now();
    fn(实参);
    最好 = Math.min(最好, performance.now() - t);
  }
  return 最好;
}

const 网格 = makeClutGrid(CLUT_SIZE);
const 链 = 造默认链();
const 表 = 烘成CLUT(网格, 链, CLUT_SIZE);

console.log('② 原分辨率：各档要多久（取最快的一次，毫秒）\n');
const 头 = '步骤'.padEnd(22) + 尺寸.map(([w, h]) => `${w}×${h}`.padStart(12)).join('');
console.log(头);
console.log('-'.repeat(头.length));

const 各行 = [];
for (const [名, 步] of [
  ['跑链（默认链）', (src) => 跑链(src, 链)],
  ['烘成CLUT 32³', () => 烘成CLUT(网格, 链, CLUT_SIZE)],
  ['applyClut（自检）', (src) => applyClut(src, 表)],
  ['channelDiff（自检）', (src) => channelDiff(src, src)],
  ['previewOf 缩到 512', (src) => previewOf(src, 512)],
  ['previewOf 缩到 1024', (src) => previewOf(src, 1024)]
]) {
  const 列 = [];
  for (const [w, h] of 尺寸) {
    const src = 造源(w, h);
    /* 源就是这么多像素时，"按原分辨率"= 不缩；`previewOf` 那两行是现状的成本 */
    const 毫秒 = 计时(3, 步, src);
    列.push(毫秒.toFixed(1).padStart(12));
    各行.push({ 名, 尺寸: `${w}×${h}`, 毫秒 });
  }
  console.log(名.padEnd(22) + 列.join(''));
}

/* 停手那一刻现在要付的总账 vs 改完之后 */
const 合计 = (选) => (尺寸.map(([w, h]) => {
  const 源 = `${w}×${h}`;
  return 选.reduce((s, 名) => s + (各行.find((r) => r.名 === 名 && r.尺寸 === 源)?.毫秒 ?? 0), 0);
}));
const 现在 = 合计(['跑链（默认链）', '烘成CLUT 32³', 'applyClut（自检）', 'channelDiff（自检）']);
const 精简 = 合计(['跑链（默认链）', '烘成CLUT 32³']);
console.log('\n停手那一刻的像素运算合计（不含 PNG 编码）：');
console.log('  现在这条（跑链+烘表+自检两遍）'.padEnd(34) + 现在.map((v) => v.toFixed(0).padStart(12)).join(''));
console.log('  自检挪到粗图上之后'.padEnd(34) + 精简.map((v) => v.toFixed(0).padStart(12)).join(''));

console.log('\n判读：一帧预算 33ms 是"跟手拖动"的账，停手后补一张是**一次性**的账；');
console.log('      但主线程被占住的这段时间界面是冻的，所以 4096 那一档必须靠减步数+省编码压下来。');
