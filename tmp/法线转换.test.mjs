/**
 * ⑦ 通道处理这三条改动的量具：
 *
 *   1. **法线重写**（`img.ts` 的 `重写法线` / `ChannelSource.推导`）对着素材里那两对真配对，
 *      逐像素比。截断取整下 R/G/B 三路要 **100% 相同**；四舍五入下允许差 1 级、但不许差 2 级。
 *   2. **放大核**：材质 ID 图那种数据图用双线性放大，会凭空造出中间编号 —— 量"数出来几种材质"。
 *   3. **认法线**：拿真 `_N` 跟合成的标准蓝 / AG 打包各认一遍。
 *
 * 跑：node --import ./tmp/register-loader.mjs tmp/法线转换.test.mjs
 */
import fs from 'node:fs';

await import('./register-loader.mjs');

const img = await import('../src/lib/img.ts');
const texops = await import('../src/lib/texops.ts');
const batch = await import('../src/lib/modules/channels/batch.ts');

const { blankImageData, pack, 重写法线, previewOf } = img;

let pass = 0;
let fail = 0;
function ok(cond, label, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${extra ? '  → ' + extra : ''}`);
  }
}
function eq(a, b, label) {
  ok(a === b, label, `实得 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}`);
}
function section(t) {
  console.log(`\n== ${t} ==`);
}
// 自检：条件为假必须记成失败
{
  const before = fail;
  const real = console.log;
  console.log = () => {};
  ok(false, '__selfcheck__');
  console.log = real;
  if (fail !== before + 1) {
    console.error('ok() 本身是坏的：条件为假没被记成失败');
    process.exit(1);
  }
  fail = before;
}

/* ---------------- 真配对 ---------------- */

/**
 * 基准数据**不进仓库**（那是第三方素材解出来的像素，跟 `tmp/ilmcheck/data` 同一条规矩）。
 * 不在的时候第 1 / 4 / 5 节里靠真图的那几条不跑，**并且退码 1** ——
 * 跟 `tmp/ilmcheck/run.mjs` 一个口径：缺基准就是没验过，不许当绿。
 */
const DATA = new URL('./normalcheck/data/', import.meta.url);
let missing = false;
let sizes = null;
try {
  sizes = JSON.parse(fs.readFileSync(new URL('sizes.json', DATA), 'utf8'));
} catch {
  sizes = null;
}

function loadRaw(name) {
  const [w, h] = sizes[name];
  const raw = fs.readFileSync(new URL(`${name}.raw`, DATA));
  return new ImageData(new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength), w, h);
}

/** 真图那几节的门：缺基准就打一句、记 missing */
function 有基准() {
  if (sizes) return true;
  if (!missing) console.log('  缺基准数据（tmp/normalcheck/data/sizes.json），这一节没跑');
  missing = true;
  return false;
}

/** 逐通道比，返回每一路 {差几级最大, 平均差, 完全相同比例} */
function 比(a, b) {
  const n = a.width * a.height;
  const out = [];
  for (let k = 0; k < 4; k++) {
    let max = 0;
    let same = 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(a.data[i * 4 + k] - b.data[i * 4 + k]);
      if (d > max) max = d;
      if (d === 0) same++;
      sum += d;
    }
    out.push({ max, mean: sum / n, same: same / n });
  }
  return out;
}

section('1. 法线重写：拿素材里两对真配对逐像素比');
if (有基准())
for (const [名字, 源, 产物] of [
  ['Vivian', 'vivian_n', 'vivian_out'],
  ['Pheony', 'pheony_n', 'pheony_out']
]) {
  const 输入 = loadRaw(源);
  const 真值 = loadRaw(产物);

  // 源图的 B 不是 z（这正是要重算的那一路）—— 先把这个事实钉住
  let bSum = 0;
  for (let i = 0; i < 输入.width * 输入.height; i++) bSum += 输入.data[i * 4 + 2];
  const bMean = bSum / (输入.width * 输入.height);
  ok(bMean < 200, `${名字}：源 _N 的 B 均值 ${bMean.toFixed(1)} —— 本来就不是 z（所以要重算）`);

  const 三路 = {
    r: { slot: 'src', ch: 'r', constant: 0, invert: false },
    g: { slot: 'src', ch: 'g', constant: 0, invert: false },
    b: { slot: 'src', ch: 'b', constant: 0, invert: false, 推导: 'z', round: 'floor' },
    a: { slot: '', ch: 'a', constant: 255, invert: false }
  };
  const 得 = pack(输入.width, 输入.height, 三路, new Map([['src', 输入]]));
  const 差 = 比(得, 真值);
  const 路名 = ['R', 'G', 'B', 'A'];
  差.forEach((d, i) => {
    ok(
      d.max === 0,
      `${名字}·截断：${路名[i]} 逐像素相同（最大差 ${d.max}，相同 ${(d.same * 100).toFixed(2)}%）`
    );
  });

  // 四舍五入：允许 ±1，不许更大 —— 这就是"那份产物用的是截断"的另一个说法
  const 半偶 = pack(
    输入.width,
    输入.height,
    { ...三路, b: { ...三路.b, round: 'half-even' } },
    new Map([['src', 输入]])
  );
  const 差2 = 比(半偶, 真值);
  差2.forEach((d, i) => {
    ok(d.max <= 1, `${名字}·四舍五入：${路名[i]} 最多差 1 级（实得 ${d.max}）`);
  });
}

section('2. 重写法线本身的性质');
{
  // 正中间（x=y=128 附近）应该几乎朝正前 —— z 接近 1，写回接近 255
  const 平 = 重写法线;
  const pr = new Uint8ClampedArray([128, 128]);
  const pg = new Uint8ClampedArray([128, 128]);
  const pb = new Uint8ClampedArray([0, 0]);
  平(pr, pg, pb, 'half-even');
  ok(pb[0] >= 254, `x=y=128 时 z 写回 ${pb[0]}（该接近 255）`);
  eq(pr[1], 128, 'x 走一遍浮点往返还是 128');

  // x² + y² > 1：不许出 NaN，z 夹到 0（写回 127 或 128）
  const xr = new Uint8ClampedArray([255, 0]);
  const yr = new Uint8ClampedArray([255, 0]);
  const br = new Uint8ClampedArray([0, 0]);
  平(xr, yr, br, 'half-even');
  ok(Number.isFinite(br[0]) && br[0] >= 120 && br[0] <= 130, `x²+y²>1 时 z 写回 ${br[0]}（夹到 0，不出 NaN）`);
  ok(br[0] === br[1], `两个极端像素算出同一个值（${br[0]} / ${br[1]}）`);

  // 只写在 B 上的推导才生效：写到 R 上不动任何东西
  const 表 = {
    r: { slot: 'src', ch: 'r', constant: 0, invert: false, 推导: 'z' },
    g: { slot: 'src', ch: 'g', constant: 0, invert: false },
    b: { slot: 'src', ch: 'b', constant: 0, invert: false },
    a: { slot: '', ch: 'a', constant: 255, invert: false }
  };
  const 小 = blankImageData(2, 1);
  小.data.set([10, 200, 30, 255, 40, 50, 60, 255]);
  const 出 = pack(2, 1, 表, new Map([['src', 小]]));
  eq(出.data[2], 30, '推导写在 R 上时 B 原样（30）');
}

section('3. 放大核：数据图用最邻近，不许造出中间编号');
{
  // 一张 4×4 的 ID 图：四块各一个编号
  const id = blankImageData(4, 4);
  const 编号 = [10, 20, 30, 40];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const v = 编号[(y < 2 ? 0 : 2) + (x < 2 ? 0 : 1)];
      const o = (y * 4 + x) * 4;
      id.data[o] = id.data[o + 1] = id.data[o + 2] = v;
      id.data[o + 3] = 255;
    }
  }
  const 表 = {
    r: { slot: 'src', ch: 'r', constant: 0, invert: false },
    g: { slot: 'src', ch: 'g', constant: 0, invert: false },
    b: { slot: 'src', ch: 'b', constant: 0, invert: false },
    a: { slot: '', ch: 'a', constant: 255, invert: false }
  };
  const src = new Map([['src', id]]);
  const 近 = pack(8, 8, 表, src, { upscale: 'nearest' });
  const 双 = pack(8, 8, 表, src, { upscale: 'bilinear' });
  const 无 = pack(8, 8, 表, src); // 不传 = 老行为

  const 数 = (im) => texops.readMaterialIds(im, 'r').length;
  eq(数(近), 4, '最邻近放大后还是 4 种材质（原样四个编号）');
  ok(数(双) > 4, `双线性放大冒出 ${数(双)} 种材质 —— 中间值被当成新编号（这就是要改的那件事）`);
  eq(数(无), 数(双), '不传这一档时的行为跟改之前一致（还是双线性）');
}

section('4. 认法线：真 _N 与合成的标准蓝 / AG 打包');
{
  if (有基准()) {
    const 真 = loadRaw('vivian_n');
    const v = texops.认法线(真);
    ok(!!v, '真的 _N 认出来了');
    eq(v?.形态, 'b-not-z', '判成"B 不是 z"（要重建）');
    eq(v?.重建, true, '要重建 Z');
    eq(v?.x, 'r', 'X 从 R 取');
    eq(v?.y, 'g', 'Y 从 G 取');
  }

  // 标准蓝：B 满、R/G 有层次、A 恒定
  const 蓝 = blankImageData(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const o = (y * 64 + x) * 4;
      蓝.data[o] = 64 + x * 2;
      蓝.data[o + 1] = 64 + y * 2;
      蓝.data[o + 2] = 252;
      蓝.data[o + 3] = 255;
    }
  }
  eq(texops.认法线(蓝)?.形态, 'blue', 'B 满的判成"已经是标准蓝"');

  // AG 打包（粉）：R 恒定 255、数据在 A
  const 粉 = blankImageData(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const o = (y * 64 + x) * 4;
      粉.data[o] = 255;
      粉.data[o + 1] = 64 + y * 2;
      粉.data[o + 2] = 64 + y * 2;
      粉.data[o + 3] = 64 + x * 2;
    }
  }
  const ag = texops.认法线(粉);
  eq(ag?.形态, 'ag', 'R 恒定高 + A 有数据 → AG 打包');
  eq(ag?.x, 'a', 'AG 打包的 X 从 A 取');

  // 一张基础色不该被认成法线
  const 色 = blankImageData(64, 64);
  for (let i = 0; i < 64 * 64; i++) {
    色.data[i * 4] = (i * 7) % 256;
    色.data[i * 4 + 1] = 30;
    色.data[i * 4 + 2] = 30;
    色.data[i * 4 + 3] = 255;
  }
  eq(texops.认法线(色), null, '一张基础色不会被认成法线');
}

section('5. 调换预设与批量走的是同一条路（一份实现）');
{
  const 预设 = batch.调换预设;
  for (const id of ['normal-z', 'normal-flipy', 'normal-ag']) {
    ok(!!预设.find((p) => p.id === id), `预设表里有 ${id}`);
  }
  for (const id of ['normal-z', 'normal-flipy', 'normal-ag']) {
    ok(!!batch.BATCH_OPS.find((o) => o.id === id), `批量页的操作用表里也有 ${id}`);
  }
  // 批量跑出来的跟 pack + 预设映射跑出来的必须逐像素相同（这一条要真图，缺基准就跳过）
  if (有基准()) {
  const 源 = loadRaw('pheony_n');
  const 直接 = pack(
    源.width,
    源.height,
    {
      r: { slot: 'src', ch: 'r', constant: 0, invert: false },
      g: { slot: 'src', ch: 'g', constant: 0, invert: false },
      b: { slot: 'src', ch: 'b', constant: 0, invert: false, 推导: 'z', round: 'floor' },
      a: { slot: '', ch: 'a', constant: 255, invert: false }
    },
    new Map([['src', 源]])
  );
  const 批量 = batch.batchTransform(源, 'normal-z', {
    调整: (s) => s,
    叠图层: (s) => s
  })[0].data;
  const 差 = 比(批量, 直接);
  ok(差.every((d) => d.max === 0 && d.same === 1), '批量「法线·重建 Z」跟 pack 逐像素相同');
  eq(batch.batchOutNames('a/b/N_x_N.png', 'normal-z')[0], 'N_x_N_NormalZ.png', '产物名带上 NormalZ');

  // 翻绿 = G 反相 + 重建；跟不翻的那张，G 必须处处不同（除非对折在 128 上）
  const 翻 = batch.batchTransform(源, 'normal-flipy', { 调整: (s) => s, 叠图层: (s) => s })[0].data;
  let 同 = 0;
  for (let i = 0; i < 源.width * 源.height; i++) if (翻.data[i * 4 + 1] === 直接.data[i * 4 + 1]) 同++;
  ok(同 / (源.width * 源.height) < 0.2, `翻绿之后 G 基本都变了（相同的只剩 ${((同 / (源.width * 源.height)) * 100).toFixed(1)}%）`);
  // 翻绿两次（同一条预设跑两遍）= G 反相回来
  const 回 = batch.按映射(翻, batch.调换映射('normal-flipy'));
  const 差回 = 比(回, 直接);
  ok(
    差回[0].max <= 1 && 差回[1].max <= 1,
    `翻绿两次：R/G 最多差 1 级（实得 R ${差回[0].max} / G ${差回[1].max}）`
  );
  /* B 不跟着"最多差 1"这条走：z 在 x²+y² 接近 1 的掠射区斜率极大（dz/dx = −x/z），
     R/G 差 1 级在那里会被放大成几十级。所以看平均差 —— 这才是"整体回去没有"的判据。 */
  ok(差回[2].mean < 1, `翻绿两次：B 的平均差 ${差回[2].mean.toFixed(3)} 级（掠射区个别像素会放大，不算错）`);
  // 四舍五入那档没有浮点台阶可攒，来回应该逐像素恒等
  const 绿半偶 = { ...batch.调换映射('normal-flipy'), b: { 推导: 'z', round: 'half-even' } };
  const 半 = batch.按映射(源, { ...batch.调换映射('normal-z'), b: { 推导: 'z', round: 'half-even' } });
  const 半回 = batch.按映射(batch.按映射(半, 绿半偶), 绿半偶);
  ok(比(半回, 半).every((d) => d.max === 0), '四舍五入下翻绿两次逐像素回到原样（这档没有浮点台阶可攒）');
  }
}

section('6. 预览缓存按放大核分开');
{
  const 大 = blankImageData(64, 64);
  for (let i = 0; i < 64 * 64; i++) 大.data[i * 4] = i % 256;
  const a1 = previewOf(大, 16, 'bilinear');
  const a2 = previewOf(大, 16, 'bilinear');
  const b1 = previewOf(大, 16, 'nearest');
  eq(a1, a2, '同一个核 + 同一个边长 → 同一个对象（缓存命中）');
  ok(a1 !== b1, '换一个核 → 另一个对象（没串）');
}

if (missing) {
  console.log('\n真实配对基准不在，第 1 节的逐像素比一条都没跑。先执行：node tmp/normalcheck/dump-normal.mjs');
}
console.log(`\n${pass} 通过 / ${fail} 失败`);
/* 缺基准就是"没验过"，不许当绿 —— 跟 tmp/ilmcheck/run.mjs 一个口径 */
process.exit(fail || missing ? 1 : 0);
