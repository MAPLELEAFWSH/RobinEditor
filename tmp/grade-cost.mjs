/**
 * ② 调色链的代价：每个节点各要多久、整条链多长，预览尺寸和 4K 各量一遍。
 *
 * 为什么要量：预览是**跟着滑杆每一帧重算**的。链一长，滑杆就会开始拖不动 ——
 * 而"颜色对不对"是主观的，"一帧几毫秒"是客观的，能用数字卡住。
 *
 * 判读口径（跟 `tmp/preview-cost.mjs` 同一套）：一帧预算按 33ms（30fps）算，
 * 超过的节点要在这里点名。
 *
 * 用法：node --import ./tmp/register-loader.mjs tmp/grade-cost.mjs
 */
import { applyClut } from '../src/lib/img.ts';
import { CLUT_SIZE, makeClutGrid } from '../src/lib/modules/ikclut/ops.ts';
import { 解析Cube } from '../src/lib/modules/ikclut/grade/lut.ts';
import { 跑链, 烘成CLUT, 造链缓存 } from '../src/lib/modules/ikclut/grade/chain.ts';
import {
  新建基本,
  新建曲线,
  新建Lut参数,
  新建色轮,
  新建Hsl,
  新建Log,
  新建变形,
  新建节点,
  变形边
} from '../src/lib/modules/ikclut/grade/types.ts';

function 造源(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] = (x * 7 + y * 3) & 255;
      d[i + 1] = (x * 3 + y * 11) & 255;
      d[i + 2] = (x ^ y) & 255;
      d[i + 3] = 255;
    }
  }
  return new ImageData(d, w, h);
}

/** 一张 33³ 的 3D 表（非恒等：把红绿对调再压一点），最接近用户会导入的那种 */
function 造表(n = 33) {
  const 行 = [];
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) 行.push(`${(g / (n - 1)) * 0.9} ${(r / (n - 1)) * 0.9} ${b / (n - 1)}`);
  const r = 解析Cube([`LUT_3D_SIZE ${n}`, ...行].join('\n'));
  if (!r.ok) throw new Error(r.error);
  return r.lut;
}

function 计时(次, fn) {
  fn();
  let 最好 = Infinity;
  for (let i = 0; i < 次; i++) {
    const t = performance.now();
    fn();
    最好 = Math.min(最好, performance.now() - t);
  }
  return 最好;
}

const S = [
  { x: 0, y: 0 },
  { x: 0.35, y: 0.28 },
  { x: 0.7, y: 0.78 },
  { x: 1, y: 1 }
];

function 造链() {
  const b = 新建节点('basic');
  b.p = { ...新建基本(), exposure: 1.1, contrast: 1.05, temperature: 0.2, highlights: -0.15, shadows: 0.2 };
  const c = 新建节点('curves');
  const cp = 新建曲线();
  cp.r = S.map((p) => ({ ...p }));
  cp.g = S.map((p) => ({ ...p }));
  cp.b = S.map((p) => ({ ...p }));
  cp.luma = S.map((p) => ({ ...p }));
  c.p = cp;
  const l = 新建节点('lut');
  l.p = { ...新建Lut参数(), lut: 造表(33), strength: 0.8, name: '测试.cube' };

  /* 第二批那四个也进链：它们才是"拖动时最贵的那几个"的候选 */
  const w = 新建节点('wheels');
  w.p = { ...新建色轮(), 暗: { h: 20, s: 0.6, l: -0.1 }, 高: { h: 200, s: 0.4, l: 0.1 }, 全局: { h: 0, s: 0.2, l: 0 } };

  const h = 新建节点('hsl');
  const hp = 新建Hsl();
  hp.bands[0] = { h: 12, s: 1.2, l: 1 };
  hp.bands[2] = { h: -10, s: 0.9, l: 1.1 };
  h.p = hp;

  const g = 新建节点('log');
  g.p = { ...新建Log(), 曝光: 0.3, 色轮色相: 30, 色轮强度: 0.3, 滚降: 0.4 };

  const v = 新建节点('warp');
  const vp = 新建变形();
  for (let i = 0; i < 变形边 * 变形边; i++) {
    vp.色相饱和[i] = Math.sin(i) * 0.6;
    vp.色相亮度[i] = Math.cos(i) * 0.6;
  }
  v.p = vp;

  return [b, c, l, w, h, g, v];
}

const grid = makeClutGrid(CLUT_SIZE);
const 链 = 造链();
const 大 = 造源(4096, 2048);
const 中 = 造源(1024, 614);
const 小 = 造源(768, 460);

const 行 = [];
function 记(名, 大毫秒, 中毫秒) {
  行.push({ 名, 大毫秒, 中毫秒 });
}

/* 每个节点单独 */
for (const n of 链) {
  const 单 = [n];
  记(
    `${n.kind} 单个`,
    计时(2, () => 跑链(大, 单)),
    计时(4, () => 跑链(中, 单))
  );
}
记('整条链', 计时(2, () => 跑链(大, 链)), 计时(4, () => 跑链(中, 链)));
/* 烘表是最便宜的一步（跑 32³ 的网格图），但自检还要把表打回预览图 */
记(
  '整条链 + 烘表',
  计时(2, () => {
    跑链(大, 链);
    烘成CLUT(grid, 链, CLUT_SIZE);
  }),
  计时(4, () => {
    跑链(中, 链);
    烘成CLUT(grid, 链, CLUT_SIZE);
  })
);
const 表 = 烘成CLUT(grid, 链, CLUT_SIZE);
记('自检：把表打回图（applyClut）', 计时(2, () => applyClut(大, 表)), 计时(4, () => applyClut(中, 表)));

const 头 = '步骤'.padEnd(34) + '4096×2048'.padStart(12) + '1024×614'.padStart(12) + '  一帧预算';
console.log(`\n② 调色链的代价（毫秒，取最热的几次里最快的一次）\n`);
console.log(头);
console.log('-'.repeat(头.length + 12));
let 点名 = [];
for (const r of 行) {
  const 超 = r.中毫秒 > 33;
  if (超) 点名.push(r.名);
  console.log(
    r.名.padEnd(34) +
      (r.大毫秒.toFixed(1) + 'ms').padStart(12) +
      (r.中毫秒.toFixed(1) + 'ms').padStart(12) +
      (超 ? '  超了（33ms）' : '')
  );
}

/* 拖动时用的那一档也量一下：链一长，这是唯一能压住一帧预算的旋钮 */
const 更小 = 造源(512, 307);
console.log(
  `\n整条链在较小预览下：768 长边 ${计时(4, () => 跑链(小, 链)).toFixed(1)}ms / ` +
    `512 长边 ${计时(4, () => 跑链(更小, 链)).toFixed(1)}ms`
);

/* ---------------- 分段缓存：拖滑杆那一档（512）到底还花多少 ----------------

   用户否了"降分辨率换帧率"（预览刚被抱怨过又小又糊），所以省的是**重复计算**：
   拖一次滑杆通常只动一个节点，前面几步的输入和参数都没变，不该重跑。
   量两件事：整条链（冷，缓存里什么都没有）和"只改最后一个节点"（热，前六步复用）。 */
const 拖链 = 造链();
/* 整条链（这一档**没有缓存**）：这就是"没有分段缓存时拖一次滑杆"的代价 */
const 无缓存 = 计时(6, () => 跑链(更小, 拖链));
/* 只改最后一个节点：前 6 步复用。注意 `计时` 会先热身跑一次，那一次就把缓存填满了，
   所以这里不能用 `计时` 量"冷"——冷的那个数就是上面那个无缓存的数 */
const 缓存1 = 造链缓存();
跑链(更小, 拖链, 缓存1);
const 尾 = 拖链[拖链.length - 1];
const 改尾 = 计时(20, () => {
  尾.p = { ...尾.p, 饱和量: 0.3 + Math.random() * 0.1 };
  跑链(更小, 拖链, 缓存1);
});
const 复用尾 = 缓存1.跳到;
/* 只改第一个节点：它后面 6 步全得重跑 —— 这是缓存**最不划算**的那种拖法，必须一起报 */
const 缓存2 = 造链缓存();
跑链(更小, 拖链, 缓存2);
const 首个 = 拖链[0];
const 改头 = 计时(20, () => {
  首个.p = { ...首个.p, exposure: 1.05 + Math.random() * 0.05 };
  跑链(更小, 拖链, 缓存2);
});
const 复用头 = 缓存2.跳到;

console.log(`\n分段缓存（512 长边，7 个节点）：`);
console.log(`  · 拖动那一档整条链（无缓存）：        ${无缓存.toFixed(1)}ms`);
console.log(`  · 只改最后一个节点（热，复用前 ${复用尾} 步）：${改尾.toFixed(1)}ms`);
console.log(`  · 只改第一个节点（热，复用前 ${复用头} 步）：  ${改头.toFixed(1)}ms   ← 最不划算的那种拖法`);
console.log('\n判读：');
console.log('  · 超一帧预算的步骤：' + (点名.length ? 点名.join('、') : '没有'));
console.log('  · 所以预览分两级：拖动时按 512 长边（跟上手），停手后补 1024 长边的细图');
console.log('  · 4K 那一列是**导出**的成本，一次性，不按帧算');
console.log('  · 拖动那一档的分辨率**没降**（还是 512）；省下来的是重复计算，不是清晰度');
console.log('  · 省多少取决于拖的是哪个节点：拖最后一个最省，拖第一个几乎不省（后面全得重跑）');
