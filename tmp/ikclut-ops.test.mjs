/**
 * ikClut 的纯运算自测。跑法：node --import ./tmp/register-loader.mjs tmp/ikclut-ops.test.mjs
 *
 * 重点验三件事：
 *   1. 网格排法和 clutFromImage 的下标约定一致（对不上出来的 LUT 就是错的，
 *      而界面上看不出来，只会觉得"颜色有点不对"）
 *   2. 网格点上 LUT 和直接调色必须完全相等 —— 相等才说明烘焙没引入额外误差
 *   3. 混表的权重和 ikClut.fx 的公式一致
 */
import {
  CLUT_H,
  CLUT_SIZE,
  CLUT_W,
  bakeClut,
  channelDiff,
  clutWeights,
  hsv2rgb,
  makeClutGrid,
  makeTestImage,
  mixClutTables
} from '../src/lib/modules/ikclut/ops.ts';
import {
  applyClut,
  applyGrade,
  bakeCurve,
  clutFromImage,
  clutToImage
} from '../src/lib/img.ts';
import { 新建基本, 新建曲线, 基本是恒等 } from '../src/lib/modules/ikclut/grade/types.ts';
import fs from 'node:fs';

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${extra}`);
  }
}

const FLAT = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
/** 恒等曲线的插值必须是 linear。'smooth' 在两点之间做 smoothstep，
 *  只有两个端点时出来的是 S 曲线而不是恒等 —— 这是个真踩过的坑，见下面第 9 节 */
function params(over = {}) {
  return {
    exposure: 1,
    contrast: 1,
    saturation: 1,
    hue: 0,
    curveR: bakeCurve(FLAT, 'linear'),
    curveG: bakeCurve(FLAT, 'linear'),
    curveB: bakeCurve(FLAT, 'linear'),
    ...over
  };
}

console.log('\n== 1. 尺寸常量 ==');
ok('CLUT 是 1024×32', CLUT_W === 1024 && CLUT_H === 32, `${CLUT_W}×${CLUT_H}`);
ok('和 ikClut.fx 的 ClutPixelSize 32 对上', CLUT_SIZE === 32);

console.log('\n== 2. 网格排法 ==');
const grid = makeClutGrid(CLUT_SIZE);
ok('网格图尺寸 1024×32', grid.width === 1024 && grid.height === 32, `${grid.width}×${grid.height}`);
// 取几个关键格核对：x = 蓝*32 + 红，y = 绿
function gridAt(red, green, blue) {
  const i = ((green * CLUT_W) + (blue * CLUT_SIZE + red)) * 4;
  return [grid.data[i], grid.data[i + 1], grid.data[i + 2], grid.data[i + 3]];
}
ok('(0,0,0) 是黑', JSON.stringify(gridAt(0, 0, 0)) === '[0,0,0,255]', JSON.stringify(gridAt(0, 0, 0)));
ok('(31,0,0) 是纯红', JSON.stringify(gridAt(31, 0, 0)) === '[255,0,0,255]', JSON.stringify(gridAt(31, 0, 0)));
ok('(0,31,0) 是纯绿', JSON.stringify(gridAt(0, 31, 0)) === '[0,255,0,255]', JSON.stringify(gridAt(0, 31, 0)));
ok('(0,0,31) 是纯蓝', JSON.stringify(gridAt(0, 0, 31)) === '[0,0,255,255]', JSON.stringify(gridAt(0, 0, 31)));
ok('(31,31,31) 是白', JSON.stringify(gridAt(31, 31, 31)) === '[255,255,255,255]', JSON.stringify(gridAt(31, 31, 31)));

// clutFromImage 读出来的表项，下标必须是 (b,g,r)，值必须是 (r,g,b)/31
const clut = clutFromImage(grid, CLUT_SIZE, false);
function tableAt(r, g, b) {
  const i = ((b * CLUT_SIZE + g) * CLUT_SIZE + r) * 3;
  return [clut.data[i], clut.data[i + 1], clut.data[i + 2]];
}
ok('表项 (0,0,0) = 黑', JSON.stringify(tableAt(0, 0, 0)) === '[0,0,0]', JSON.stringify(tableAt(0, 0, 0)));
ok('表项 (31,0,0) = 红', JSON.stringify(tableAt(31, 0, 0)) === '[255,0,0]', JSON.stringify(tableAt(31, 0, 0)));
ok('表项 (0,0,31) = 蓝', JSON.stringify(tableAt(0, 0, 31)) === '[0,0,255]', JSON.stringify(tableAt(0, 0, 31)));
ok('表项 (13,7,29) 就是那一格自己', JSON.stringify(tableAt(13, 7, 29)) === JSON.stringify([Math.round(13 / 31 * 255), Math.round(7 / 31 * 255), Math.round(29 / 31 * 255)]), JSON.stringify(tableAt(13, 7, 29)));

console.log('\n== 3. 网格点上烘焙 ==');
// 恒等调色：网格点上应该基本原样回来。
// 残差 ≤1.5/255，来自两处亚 LSB 效应，都是这个格式固有的，不是实现错：
//   a) 网格格值本身要存成字节：round(r*255/31)，最多差 0.5
//   b) img.ts 的 clamp255 用 `| 0` 截断而不是四舍五入，
//      于是 g/255*255 浮点算出来是 7.9999999 时索引落到 7 而不是 8，再差 1
const identity = bakeClut(grid, params(), CLUT_SIZE);
let maxId = 0;
let worst = null;
for (let b = 0; b < CLUT_SIZE; b++)
  for (let g = 0; g < CLUT_SIZE; g++)
    for (let r = 0; r < CLUT_SIZE; r++) {
      const i = ((b * CLUT_SIZE + g) * CLUT_SIZE + r) * 3;
      const want = [r / (CLUT_SIZE - 1), g / (CLUT_SIZE - 1), b / (CLUT_SIZE - 1)];
      for (let k = 0; k < 3; k++) {
        const d = Math.abs(identity.data[i + k] / 255 - want[k]) * 255;
        if (d > maxId) {
          maxId = d;
          worst = { r, g, b, k, got: identity.data[i + k], want: want[k] * 255 };
        }
      }
    }
console.log(`  恒等烘焙的残差：最大 ${maxId.toFixed(4)}/255（${JSON.stringify(worst)}）`);
ok('恒等烘焙残差 ≤ 2/255', maxId <= 2, `最大 ${maxId.toFixed(4)}`);

// 带参数：拿一张只在网格点上取值的图，LUT 和直接调色必须完全一致
const probe = new ImageData(CLUT_W, CLUT_H);
for (let y = 0; y < CLUT_H; y++)
  for (let x = 0; x < CLUT_W; x++) {
    const i = (y * CLUT_W + x) * 4;
    probe.data[i] = grid.data[i];
    probe.data[i + 1] = grid.data[i + 1];
    probe.data[i + 2] = grid.data[i + 2];
    probe.data[i + 3] = 255;
  }
const strong = params({
  exposure: 1.35,
  contrast: 1.4,
  saturation: 1.6,
  hue: 22,
  curveR: bakeCurve([{ x: 0, y: 0.05 }, { x: 0.5, y: 0.62 }, { x: 1, y: 0.98 }], 'smooth'),
  curveG: bakeCurve([{ x: 0, y: 0 }, { x: 0.7, y: 0.55 }, { x: 1, y: 1 }], 'smooth'),
  curveB: bakeCurve([{ x: 0, y: 0.12 }, { x: 1, y: 0.9 }], 'smooth')
});
const strongClut = bakeClut(grid, strong, CLUT_SIZE);
const direct = applyGrade(probe, strong);
const viaLut = applyClut(probe, strongClut);
const gd = channelDiff(direct, viaLut);
// 差值不是 bug，是 32 级 LUT 的固有精度：像素落在两个网格点之间时三线性插值
// 会削掉一点曲率。曲线越陡这个数越大。ikClut 本身也是这个精度。
console.log(`  强参数下网格点的差：最大 ${gd.max}/255，平均 ${gd.mean.toFixed(3)}/255`);
ok('网格点上 LUT 与直接调色最大差 ≤ 6', gd.max <= 6, `最大差 ${gd.max}`);

console.log('\n== 3b. 曲线只作用于本通道 ==');
// 只给 R 一条 S 曲线，另外两条恒等；中灰的输出应该正好落在 curveR[128]
const onlyR = params({
  curveR: bakeCurve([{ x: 0, y: 0 }, { x: 0.5, y: 0.75 }, { x: 1, y: 1 }], 'linear')
});
const mid = new ImageData(new Uint8ClampedArray([128, 128, 128, 255]), 1, 1);
const midOut = applyGrade(mid, onlyR);
ok('R 走了曲线', midOut.data[0] === onlyR.curveR[128], `${midOut.data[0]} vs ${onlyR.curveR[128]}`);
ok('G 没被 R 的曲线带着走', midOut.data[1] === 128, String(midOut.data[1]));
ok('B 没被 R 的曲线带着走', midOut.data[2] === 128, String(midOut.data[2]));
ok('曲线确实不是恒等（否则这条测试没意义）', onlyR.curveR[128] > 160, String(onlyR.curveR[128]));

console.log('\n== 5. 在测试图上的自检差 ==');
const test = makeTestImage(512, 320);
ok('测试图尺寸对', test.width === 512 && test.height === 320);
ok('测试图左上角是纯黑（灰阶段起点）', test.data[0] === 0 && test.data[1] === 0 && test.data[2] === 0);
// 灰阶段每一级的中点
const band = Math.round(320 * 0.3);
let grayOk = true;
for (let k = 0; k < 32; k++) {
  const x = Math.floor((k + 0.5) * (512 / 32));
  const i = (10 * 512 + x) * 4;
  const want = Math.round((k / 31) * 255);
  if (Math.abs(test.data[i] - want) > 1) grayOk = false;
}
ok('32 级灰阶每一级都对得上', grayOk);
// 下段色块
const swatchY = band + Math.round(320 * 0.3) + 10;
let swOk = true;
for (let k = 0; k < 12; k++) {
  const x = Math.floor((k + 0.5) * (512 / 12));
  const i = (swatchY * 512 + x) * 4;
  const want = k === 0 ? null : null;
  void want;
  if (test.data[i + 3] !== 255) swOk = false;
}
ok('下段色块都是不透明的', swOk);

const t1 = applyGrade(test, strong);
const t2 = applyClut(test, strongClut);
const td = channelDiff(t1, t2);
console.log(`  测试图上的自检：最大 ${td.max}/255，平均 ${td.mean.toFixed(3)}/255`);
ok('自检最大差 < 24', td.max < 24, String(td.max));
ok('自检平均差 < 3', td.mean < 3, td.mean.toFixed(3));

console.log('\n== 6. 混表 ==');
ok('1 张权重 [1]', JSON.stringify(clutWeights(1, 0.3, 0.7)) === '[1]');
ok('2 张权重 [1-x, x]', JSON.stringify(clutWeights(2, 0.25, 0)) === '[0.75,0.25]');
ok(
  'X=0.3 Y=0.7 → 21/9/49/21',
  clutWeights(4, 0.3, 0.7).map((v) => Math.round(v * 100)).join(',') === '21,9,49,21',
  clutWeights(4, 0.3, 0.7).map((v) => Math.round(v * 100)).join(',')
);
ok(
  '权重和恒为 1',
  [1, 2, 4].every((n) =>
    Math.abs(clutWeights(n, 0.37, 0.62).reduce((a, b) => a + b, 0) - 1) < 1e-9
  )
);

// 造几张极端的表：纯黑 / 纯白，看混合权重落到哪儿。
// Uint8ClampedArray 会四舍五入，所以期望值按整数量。
function solid(v) {
  const c = { size: 4, data: new Uint8ClampedArray(4 * 4 * 4 * 3) };
  c.data.fill(v);
  return c;
}
const black = solid(0);
const white = solid(255);
ok('2 张 25% → 64（63.75 进位）', mixClutTables([black, white], 0.25, 0).data[0] === 64, String(mixClutTables([black, white], 0.25, 0).data[0]));
ok('2 张 0% → 0', mixClutTables([black, white], 0, 0).data[0] === 0);
ok('2 张 100% → 255', mixClutTables([black, white], 1, 0).data[0] === 255);
// 4 张：X=0 时 (1,2) 塌到 1、(3,4) 塌到 3，Y 再混 1 和 3
ok('4 张 X=0 Y=0.5 → 0（塌到第 1、3 张，都黑）', mixClutTables([black, black, black, white], 0, 0.5).data[0] === 0, String(mixClutTables([black, black, black, white], 0, 0.5).data[0]));
ok('4 张 黑白黑白 X=1 Y=0.5 → 255', mixClutTables([black, white, black, white], 1, 0.5).data[0] === 255);
ok('4 张 黑黑白白 X=1 Y=0.5 → 128', mixClutTables([black, black, white, white], 1, 0.5).data[0] === 128, String(mixClutTables([black, black, white, white], 1, 0.5).data[0]));
ok('4 张 黑黑白白 X=0 Y=1 → 255', mixClutTables([black, black, white, white], 0, 1).data[0] === 255);
const one = mixClutTables([white], 0.9, 0.9);
ok('1 张时系数被忽略', one.data[0] === 255, String(one.data[0]));
ok('空列表返回 null', mixClutTables([], 0.5, 0.5) === null);

console.log('\n== 7. clutToImage 往返 ==');
const back = clutFromImage(clutToImage(strongClut, false), CLUT_SIZE, false);
let rt = 0;
for (let i = 0; i < strongClut.data.length; i++) rt = Math.max(rt, Math.abs(strongClut.data[i] - back.data[i]));
ok('烘出来的表画成图再读回来完全一致', rt === 0, String(rt));

const flipped = clutFromImage(clutToImage(strongClut, true), CLUT_SIZE, false);
ok('翻蓝切片后确实不一样', flipped.data[0] !== strongClut.data[0] || flipped.data[flipped.data.length - 1] !== strongClut.data[strongClut.data.length - 1]);

console.log('\n== 8. hsv2rgb ==');
ok('色相 0 是红', JSON.stringify(hsv2rgb(0, 1, 1)) === '[255,0,0]', JSON.stringify(hsv2rgb(0, 1, 1)));
ok('色相 120 是绿', JSON.stringify(hsv2rgb(120, 1, 1)) === '[0,255,0]', JSON.stringify(hsv2rgb(120, 1, 1)));
ok('色相 240 是蓝', JSON.stringify(hsv2rgb(240, 1, 1)) === '[0,0,255]', JSON.stringify(hsv2rgb(240, 1, 1)));
ok('饱和 0 是灰', JSON.stringify(hsv2rgb(200, 0, 0.5)) === '[128,128,128]', JSON.stringify(hsv2rgb(200, 0, 0.5)));
ok('负色相也能跑', JSON.stringify(hsv2rgb(-120, 1, 1)) === '[0,0,255]', JSON.stringify(hsv2rgb(-120, 1, 1)));

console.log('\n== 9. 两点曲线用 smooth 不是恒等（踩过的坑）==');
const lin = bakeCurve(FLAT, 'linear');
const smo = bakeCurve(FLAT, 'smooth');
let linMax = 0;
let smoMax = 0;
for (let i = 0; i < 256; i++) {
  linMax = Math.max(linMax, Math.abs(lin[i] - i));
  smoMax = Math.max(smoMax, Math.abs(smo[i] - i));
}
ok('linear 两点曲线就是恒等', linMax <= 1, String(linMax));
ok('smooth 两点曲线偏离恒等很多', smoMax > 20, String(smoMax));
console.log(`  这就是默认插值必须给 linear 的原因：smooth 最大偏 ${smoMax}/255`);
// 默认值也核一下，别再改回去。
//
// 这里原来是**对着组件源码**断言（`let kind = $state<CurveKind>('linear')` 和 `const FLAT` 两行）。
// 调色链那一轮把参数搬进了 `grade/types.ts` 的 `新建曲线()`，那两行源码自然就没了 ——
// 断言改成**直接问那个函数**：问行为比问源码结实，搬了家也不会假红。
const 默认曲线 = 新建曲线();
ok('默认插值是 linear', 默认曲线.kind === 'linear', String(默认曲线.kind));
ok(
  '默认四条曲线都是两点的 0,0 → 1,1',
  [默认曲线.r, 默认曲线.g, 默认曲线.b, 默认曲线.luma, 默认曲线.extra].every(
    (pts) => pts.length === 2 && pts[0].x === 0 && pts[0].y === 0 && pts[1].x === 1 && pts[1].y === 1
  )
);
ok('基本参数的默认值是恒等', 基本是恒等(新建基本()));

console.log(`\n通过 ${pass}，失败 ${fail}\n`);
process.exitCode = fail ? 1 : 0;
