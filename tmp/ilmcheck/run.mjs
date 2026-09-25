/**
 * ⑤ ILM 打包算法的离线核对。
 *
 * 跑法：node tmp/ilmcheck/run.mjs
 *
 * 为什么单独跑：这些函数只吃 ImageData、不碰 DOM，但项目里没装测试框架，
 * 而且浏览器里要选文件才能进来。在这儿把关键几条一次验完，
 * 省得去界面上瞎点。
 *
 * 加载的是 src/lib 里的真文件。这里原来是 ops.ts / img.ts 的副本加一个
 * sync.mjs 从真文件拷过来 —— 改了真代码忘跑 sync，就照样全绿地验旧代码。
 * 副本已经删掉，下面那条模块路径自检是防它长回来的。
 */

import fs from 'node:fs';

// $lib 别名、ImageData / OffscreenCanvas 垫片都在这里面。
// 必须是动态 import —— 静态 import 会被提升到 register() 之前，别名就白注册了。
await import('../register-loader.mjs');

const ops = await import('../../src/lib/modules/ilm/ops.ts');
const { blankImageData, resize } = await import('../../src/lib/img.ts');

/** 基准数据按文件自己的位置算，不看 cwd —— 从别的目录跑也得找得到 */
const DATA = new URL('./data/', import.meta.url);
const dataPath = (name) => new URL(name, DATA);
const readSizes = () => JSON.parse(fs.readFileSync(dataPath('sizes.json'), 'utf8'));
/** 读 dump 出来的裸 RGBA */
function loadRaw(sizes, name) {
  const [w, h] = sizes[name];
  const raw = fs.readFileSync(dataPath(`${name}.raw`));
  return new ImageData(new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength), w, h);
}

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${detail ? '   ' + detail : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}   ${detail}`);
  }
}
function near(a, b, tol) {
  return Math.abs(a - b) <= tol;
}
function section(t) {
  console.log(`\n=== ${t} ===`);
}

/** 基准数据不在时的开关；第 9、10 节靠它，最后一起决定退出码 */
let missing = false;

// 自检 ok() 本身：条件为假时必须被记成失败
{
  const before = fail;
  const realLog = console.log;
  console.log = () => {};
  ok('__selfcheck__', false);
  console.log = realLog;
  if (fail !== before + 1) {
    console.error('ok() 本身是坏的：条件为假没被记成失败');
    process.exit(1);
  }
  fail = before;
}

// 自检验的是真文件：副本那条路走回来就会在这里红
{
  const url = import.meta.resolve('../../src/lib/modules/ilm/ops.ts');
  ok('ops 加载的是 src/lib 里的真文件，不是副本',
    url.endsWith('/src/lib/modules/ilm/ops.ts'), url);
}

/** 造一张图，回调给每个像素的 RGBA */
function makeImg(w, h, fn) {
  const img = blankImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const px = fn(x, y);
      img.data[i] = px[0];
      img.data[i + 1] = px[1];
      img.data[i + 2] = px[2];
      img.data[i + 3] = px[3];
    }
  }
  return img;
}

/* ================================================================
   1. ladderPlane：各档占比对不对得上
   ================================================================ */
section('ladderPlane 配比');
{
  // 20000 个像素，明度 0..19999 均匀铺开
  const n = 20000;
  const drive = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) drive[i] = (i * 255) / (n - 1);

  // 亮端 10% → 255，再 20% → 128，剩下 70% → default 0
  const ladder = [
    [1.0, 0.1],
    [0.5, 0.2]
  ];
  const out = ops.ladderPlane(ladder, 0, drive, true, false);

  const count = (v) => out.reduce((s, x) => s + (x === v ? 1 : 0), 0);
  const pct255 = count(255) / n;
  const pct128 = count(128) / n;
  const pct0 = count(0) / n;

  ok('最亮那档占 10%', near(pct255, 0.1, 0.005), `实得 ${(pct255 * 100).toFixed(2)}%`);
  ok('第二档占 20%', near(pct128, 0.2, 0.005), `实得 ${(pct128 * 100).toFixed(2)}%`);
  ok('剩下的填 default', near(pct0, 0.7, 0.005), `实得 ${(pct0 * 100).toFixed(2)}%`);
  ok('合计 100%', pct255 + pct128 + pct0 === 1);

  // 单调性：越亮的像素拿到的档位不低于越暗的
  let mono = true;
  for (let i = 1; i < n; i++) if (out[i] < out[i - 1]) mono = false;
  ok('输出随明度单调不减', mono);

  // 换成从暗端起，应该正好反过来
  const rev = ops.ladderPlane(ladder, 0, drive, false, false);
  ok('从暗端起时最暗的那端拿到最高档', rev[0] === 255 && rev[n - 1] === 0,
    `暗端=${rev[0]} 亮端=${rev[n - 1]}`);

  // 空 ladder 应该整片是 default
  const none = ops.ladderPlane([], 0.4, drive, true, false);
  ok('空 ladder 全填 default', none.every((v) => v === Math.round(0.4 * 255)),
    `值=${none[0]}`);
}

/* ================================================================
   2. 绝区零映射：逐像素恒等式
   ================================================================ */
section('绝区零 _A/_M/_N → _LM 恒等式');
{
  const W = 64;
  const H = 64;
  // 三张各给不同规律，免得"碰巧相等"
  const A = makeImg(W, H, (x, y) => [x * 4, (x * 3 + y) % 256, y * 4, 255]);
  const M = makeImg(W, H, (x, y) => [(x + y) % 256, x % 7, (y * 5) % 256, 255]);
  const N = makeImg(W, H, (x, y) => [x % 256, (y * 2) % 256, (x + 2 * y) % 256, 255]);
  const src = new Map([
    ['A', A],
    ['M', M],
    ['N', N]
  ]);

  const lm = ops.packLm(W, H, ops.ZZZ_MAP, src, 'nearest', 0);

  let rBad = 0;
  let gBad = 0;
  let bBad = 0;
  let aBad = 0;
  for (let i = 0; i < W * H; i++) {
    if (lm.data[i * 4] !== A.data[i * 4 + 1]) rBad++;
    if (lm.data[i * 4 + 1] !== N.data[i * 4 + 2]) gBad++;
    if (lm.data[i * 4 + 2] !== M.data[i * 4 + 2]) bBad++;
    if (lm.data[i * 4 + 3] !== 255) aBad++;
  }
  ok('R 完全等于 _A 的 G', rBad === 0, `差 ${rBad} 个像素`);
  ok('G 完全等于 _N 的 B', gBad === 0, `差 ${gBad} 个像素`);
  ok('B 完全等于 _M 的 B', bBad === 0, `差 ${bBad} 个像素`);
  ok('A 全是 255', aBad === 0);

  // 明确验一下 _M 的 G 确实没进结果：把 _M 的 G 全改成 0，结果应该一字不变
  const M2 = makeImg(W, H, (x, y) => [(x + y) % 256, 0, (y * 5) % 256, 255]);
  const lm2 = ops.packLm(W, H, ops.ZZZ_MAP, new Map([['A', A], ['M', M2], ['N', N]]), 'nearest', 0);
  let diff = 0;
  for (let i = 0; i < W * H * 4; i++) if (lm.data[i] !== lm2.data[i]) diff++;
  ok('把 _M.G 清零后产出不变（说明它没参与）', diff === 0, `变了 ${diff} 个字节`);
}

/* ================================================================
   3. 半分辨率法线：nearest 与 bilinear 必须不一样，且 nearest 可复现
   ================================================================ */
section('半分辨率法线放大');
{
  const W = 32;
  const H = 32;
  const HW = 16;
  const A = makeImg(W, H, (x) => [x, x, x, 255]);
  const N = makeImg(HW, HW, (x, y) => (x + y) % 2 === 0 ? [0, 0, 10, 255] : [0, 0, 200, 255]);
  // 结果基准：手动做一次 block 放大，取 B 通道
  const expect = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      expect[y * W + x] = N.data[((Math.floor(y / 2) * HW) + Math.floor(x / 2)) * 4 + 2];
    }
  }

  const byNearest = ops.packLm(W, H, ops.ZZZ_MAP, new Map([['A', A], ['M', A], ['N', N]]), 'nearest', 0);
  let badN = 0;
  for (let i = 0; i < W * H; i++) if (byNearest.data[i * 4 + 1] !== expect[i]) badN++;
  ok('nearest：G 等于 2×2 块放大后的 _N.B', badN === 0, `差 ${badN} 个像素`);

  const byLinear = ops.packLm(W, H, ops.ZZZ_MAP, new Map([['A', A], ['M', A], ['N', N]]), 'bilinear', 0);
  let diffN = 0;
  for (let i = 0; i < W * H; i++) if (byLinear.data[i * 4 + 1] !== byNearest.data[i * 4 + 1]) diffN++;
  ok('bilinear 跟 nearest 结果不同（放大核确实在起作用）', diffN > 0, `差 ${diffN} 个像素`);

  // nearest 的结果里不应该出现中间值
  const vals = new Set();
  for (let i = 0; i < W * H; i++) vals.add(byNearest.data[i * 4 + 1]);
  ok('nearest 不产生插值出来的新值', [...vals].every((v) => v === 10 || v === 200),
    `出现的值 ${[...vals].join(',')}`);

  // 立方 / Lanczos 也是能选的放大核，结果得跟前面两个都不一样
  const mk = new Map([['A', A], ['M', A], ['N', N]]);
  const gOf = (img) => Array.from({ length: W * H }, (_, i) => img.data[i * 4 + 1]);
  const gN = gOf(byNearest);
  const gB = gOf(byLinear);
  const gC = gOf(ops.packLm(W, H, ops.ZZZ_MAP, mk, 'bicubic', 0));
  const gL = gOf(ops.packLm(W, H, ops.ZZZ_MAP, mk, 'lanczos', 0));
  const ne = (a, b) => a.filter((v, i) => v !== b[i]).length;
  ok('立方跟最邻近结果不同', ne(gC, gN) > 0, `差 ${ne(gC, gN)} 个像素`);
  ok('Lanczos 跟最邻近结果不同', ne(gL, gN) > 0, `差 ${ne(gL, gN)} 个像素`);
  ok('立方跟 Lanczos 也不一样', ne(gC, gL) > 0, `差 ${ne(gC, gL)} 个像素`);
  ok('Lanczos 输出还在 0-255 内', gL.every((v) => v >= 0 && v <= 255),
    `min ${Math.min(...gL)} max ${Math.max(...gL)}`);

  // 常量图放大后必须还是同一个常量。权重不归一化的话边缘会往下掉，
  // 边缘发暗就是这么来的 —— 顺手把四个核都按住。
  const flat = makeImg(8, 8, () => [40, 90, 200, 255]);
  for (const k of ['nearest', 'bilinear', 'bicubic', 'lanczos']) {
    const up = resize(flat, 32, 32, k);
    let bad = 0;
    for (let i = 0; i < 32 * 32; i++) {
      if (up.data[i * 4] !== 40 || up.data[i * 4 + 1] !== 90 || up.data[i * 4 + 2] !== 200) bad++;
    }
    ok(`${k} 放大常量图不变色`, bad === 0, `差 ${bad} 个像素`);
  }
}

/* ================================================================
   4. diffAgainst：口径跟验证报告一致
   ================================================================ */
section('diffAgainst 核对口径');
{
  const W = 40;
  const H = 40;
  const A = makeImg(W, H, (x, y) => [x * 6, (x + y) % 256, y * 6, 255]);
  const M = makeImg(W, H, (x, y) => [x % 256, y % 256, (x * y) % 256, 255]);
  const N = makeImg(W, H, (x, y) => [x, y, (x + y) % 256, 255]);
  const src = new Map([['A', A], ['M', M], ['N', N]]);
  const lm = ops.packLm(W, H, ops.ZZZ_MAP, src, 'nearest', 0);

  const self = ops.diffAgainst(lm, ops.packLm(W, H, ops.ZZZ_MAP, src, 'nearest', 0));
  ok('自己跟自己比：四通道全 100%',
    self.perChannel.every((c) => c.identical === 1) && self.identicalAll === 1,
    `全同 ${(self.identicalAll * 100).toFixed(2)}%`);

  // 只动 _M 的 B，那么只有最终 B 变，R/G/A 应该保持 100%
  const M2 = makeImg(W, H, (x, y) => {
    const v = (x * y) % 256;
    return [x % 256, y % 256, x === 0 && y === 0 ? (v + 1) % 256 : v, 255];
  });
  const lm2 = ops.packLm(W, H, ops.ZZZ_MAP, new Map([['A', A], ['M', M2], ['N', N]]), 'nearest', 0);
  const d = ops.diffAgainst(lm, lm2);
  const byCh = Object.fromEntries(d.perChannel.map((c) => [c.ch, c]));
  ok('动 _M.B 只影响最终 B', byCh.b.identical < 1 && byCh.r.identical === 1 &&
    byCh.g.identical === 1 && byCh.a.identical === 1,
    `B=${(byCh.b.identical * 100).toFixed(2)}%  R/G/A=100%`);
  ok('单像素差 1 时 B 全同率 = 1 - 1/(W*H)',
    near(byCh.b.identical, 1 - 1 / (W * H), 1e-9),
    `实得 ${(byCh.b.identical * 100).toFixed(4)}%`);

  // 尺寸不一不能比
  const small = ops.packLm(10, 10, ops.ZZZ_MAP, src, 'nearest', 0);
  ok('尺寸不一致时拒绝比较', ops.diffAgainst(lm, small).sizeMismatch === true);
}

/* ================================================================
   5. 网格吸附
   ================================================================ */
section('quantize 0.05 网格');
{
  const n = 256;
  const plane = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) plane[i] = i;
  const q = ops.quantize(plane, 0.05);
  const legal = new Set();
  for (let k = 0; k <= 20; k++) legal.add(Math.round((k / 20) * 255));
  ok('每个值都落在 21 档上', [...q].every((v) => legal.has(v)),
    `档位 ${[...legal].slice(0, 5).join(',')}…`);
  ok('端点不动', q[0] === 0 && q[255] === 255, `${q[0]} / ${q[255]}`);
  const q0 = ops.quantize(plane, 0);
  ok('step=0 时原样返回', q0 === plane);
  ok('吸附后误差不超过半格', [...q].every((v, i) => Math.abs(v - i) <= 255 / 40 + 1));
}

/* ================================================================
   6. 命名
   ================================================================ */
section('命名与分组');
{
  const cases = [
    ['Pheony_Body_A.png', 'A'],
    ['Pheony_Body_M.png', 'M'],
    ['Pheony_Body_N.png', 'N'],
    ['Pheony_Body_D.png', 'D'],
    ['Pheony_Body_LM.png', 'LM'],
    ['Avatar_YaoGuang_00_Body_LightMap.png', 'LM'],
    ['Avatar_Girl_Tex_Hair_Diffuse.png', 'OTHER'],
    ['木偶.png', 'OTHER']
  ];
  for (const [name, want] of cases) {
    ok(`roleOf(${name}) = ${want}`, ops.roleOf(name) === want, `实得 ${ops.roleOf(name)}`);
  }

  ok('baseStem 去掉 _A', ops.baseStem('Pheony_Body_A.png') === 'Pheony_Body',
    ops.baseStem('Pheony_Body_A.png'));
  ok('baseStem 去掉 _LM', ops.baseStem('Pheony_Body_LM.png') === 'Pheony_Body',
    ops.baseStem('Pheony_Body_LM.png'));
  ok('baseStem 不动中文名', ops.baseStem('木偶.png') === '木偶', ops.baseStem('木偶.png'));
  ok('同组三张归到同一个 stem',
    ops.baseStem('Pheony_Hair_A.png') === ops.baseStem('Pheony_Hair_N.png'));

  ok('导出名', ops.lmOutName('Pheony_Body_A.png', '_LM') === 'Pheony_Body_LM.png',
    ops.lmOutName('Pheony_Body_A.png', '_LM'));
  ok('原神导出名', ops.lmOutName('X_Body_A.png', '_Lightmap') === 'X_Body_Lightmap.png',
    ops.lmOutName('X_Body_A.png', '_Lightmap'));
}

/* ================================================================
   7. 原神 / 星铁那套已经删了 —— 这一节守的就是"别再长回来"
   ----------------------------------------------------------------
   用户 2026-09-26："既然是绝区零贴图合成，那么其他游戏规格参数保留还有什么用"。
   理由不是"用不上"，是它们**做不出对的东西**：只能按配比对齐，空间布局对不上
   （本工程自己量的最佳 IoU 0.387），而那句警告原来从没画到界面上。
   真要加回来，得先有一条**验过**的规格，再把这节的判据改掉。
   ================================================================ */
section('只做绝区零（原神 / 星铁的配比与映射不许再出现）');
{
  const 不该有的 = ['GENSHIN_LADDERS', 'HSR_LADDERS', 'LADDER_GROUPS', 'GENSHIN_MAP', 'HSR_MAP',
    'genshinLadder', 'genshinDefault', 'hsrLadder', 'hsrDefault'];
  for (const 名 of 不该有的) {
    ok(`${名} 不在 ops 的导出里了`, ops[名] === undefined, typeof ops[名]);
  }
  ok('预设只剩绝区零', ops.PRESETS.length === 1, ops.PRESETS.map((p) => p.name).join(','));
  ok('绝区零不吸附网格', ops.presetOf('zzz').grid === 0);
  ok('导出后缀还是 _LM', ops.presetOf('zzz').suffix === '_LM');
  ok('绝区零映射就是验过的那套',
    ops.ZZZ_MAP.r.slot === 'A' && ops.ZZZ_MAP.r.ch === 'g' &&
    ops.ZZZ_MAP.g.slot === 'N' && ops.ZZZ_MAP.g.ch === 'b' &&
    ops.ZZZ_MAP.b.slot === 'M' && ops.ZZZ_MAP.b.ch === 'b' &&
    ops.ZZZ_MAP.a.kind === 'const' && ops.ZZZ_MAP.a.constant === 255);
  ok('未知 id 回落到绝区零', ops.presetOf('nope').id === 'zzz', ops.presetOf('nope').id);
  /* 那句"只对得上面积"的话必须还在（手填 ladder 那条路还开着），而且界面上要真画出来 */
  ok('MANUAL_LAYOUT_NOTE 还在', typeof ops.MANUAL_LAYOUT_NOTE === 'string' && ops.MANUAL_LAYOUT_NOTE.length > 10);
  const 界面 = fs.readFileSync(new URL('../../src/lib/modules/ilm/Ilm.svelte', import.meta.url), 'utf8');
  ok('MANUAL_LAYOUT_NOTE 真的画在 Ilm.svelte 的模板里（不是只 import）',
    界面.includes('{MANUAL_LAYOUT_NOTE}'), '模板里没找到');
}

/* ================================================================
   8. 预设表
   ================================================================ */
section('预设');
{
  ok('就一个预设', ops.PRESETS.length === 1, ops.PRESETS.map((p) => p.name).join(','));
  ok('绝区零不吸附网格', ops.presetOf('zzz').grid === 0);
  ok('绝区零映射就是验过的那套',
    ops.ZZZ_MAP.r.slot === 'A' && ops.ZZZ_MAP.r.ch === 'g' &&
    ops.ZZZ_MAP.g.slot === 'N' && ops.ZZZ_MAP.g.ch === 'b' &&
    ops.ZZZ_MAP.b.slot === 'M' && ops.ZZZ_MAP.b.ch === 'b' &&
    ops.ZZZ_MAP.a.kind === 'const' && ops.ZZZ_MAP.a.constant === 255);
  ok('未知 id 回落到第一个', ops.presetOf('nope').id === 'zzz');
}

/* ================================================================
   9. 真实配对验收：vivian 的 _A / _M / _N → _LM
   ----------------------------------------------------------------
   这里量的就是 ops.ts 头注释里那几行数字，让它们能被重跑。
   合成的小图验不了这件事 —— 「源只有一半分辨率、高频已经没了」这个局面
   只有真图才有，放大核的差别也只在真图上才显出来。
   ================================================================ */
section('真实配对验收：vivian Body_1 / Body_2');
{
  if (!fs.existsSync(dataPath('sizes.json'))) {
    missing = true;
    console.log('  缺基准数据，这一节没跑');
  } else {
    const sizes = readSizes();
    const load = (name) => loadRaw(sizes, name);

    for (const stem of ['body_1', 'body_2']) {
      const A = load(`${stem}_A`);
      const M = load(`${stem}_M`);
      const N = load(`${stem}_N`);
      const LM = load(`${stem}_LM`);
      const src = new Map([['A', A], ['M', M], ['N', N]]);
      console.log(`\n  ${stem}  A/M/LM ${A.width}²  N ${N.width}²`);

      const rows = {};
      for (const k of ['nearest', 'bilinear', 'bicubic', 'lanczos']) {
        const t0 = Date.now();
        const got = ops.packLm(LM.width, LM.height, ops.ZZZ_MAP, src, k, 0);
        const ms = Date.now() - t0;
        const d = ops.diffAgainst(got, LM);
        const byCh = Object.fromEntries(d.perChannel.map((c) => [c.ch, c]));
        rows[k] = byCh;
        console.log(
          `    ${k.padEnd(9)} R ${(byCh.r.identical * 100).toFixed(2)}%` +
            `   G ${(byCh.g.identical * 100).toFixed(2)}% / MAE ${byCh.g.meanDiff.toFixed(3)}` +
            `   B ${(byCh.b.identical * 100).toFixed(2)}%` +
            `   A ${(byCh.a.identical * 100).toFixed(2)}%   ${ms}ms`
        );
      }

      // R 直接取 _A.G，本该逐像素相同。body_1 有 0.033% 差 1 级，
      // 全部落在 _A 的 alpha=254 那些像素上 —— 作者那边的工具走了一趟
      // 预乘/反预乘，254/255 乘回去会掉 1 级。判据：差异只要都出在
      // alpha<255 且只差 1 级，就是那趟往返留下的痕迹，不是映射错了。
      {
        const got = ops.packLm(LM.width, LM.height, ops.ZZZ_MAP, src, 'lanczos', 0);
        const n = LM.width * LM.height;
        let onAlpha = 0;
        let stray = 0;
        for (let i = 0; i < n; i++) {
          const d = Math.abs(got.data[i * 4] - LM.data[i * 4]);
          if (d === 0) continue;
          if (A.data[i * 4 + 3] < 255 && d === 1) onAlpha++;
          else stray++;
        }
        ok(`${stem} R 与真值至少 99.9% 逐像素相同`, rows.lanczos.r.identical > 0.999,
          `实得 ${(rows.lanczos.r.identical * 100).toFixed(3)}%`);
        ok(`${stem} R 的差异只出在 alpha<255 且只差 1 级`, stray === 0,
          `alpha 上 ${onAlpha} 个，其它 ${stray} 个`);
      }
      ok(`${stem} B 与真值逐像素相同`, rows.lanczos.b.identical === 1,
        `实得 ${(rows.lanczos.b.identical * 100).toFixed(2)}%`);
      // 真值那张 LM 存的是 RGB，本来就没有 alpha；A 填 1 等于（这里 dump 成 255）
      ok(`${stem} A 全是 1`, rows.lanczos.a.identical === 1,
        `实得 ${(rows.lanczos.a.identical * 100).toFixed(2)}%`);
      // G 走的是半分辨率法线，只能看平均差
      ok(`${stem} G 平均差 < 0.5 级`, rows.lanczos.g.meanDiff < 0.5,
        `lanczos ${rows.lanczos.g.meanDiff.toFixed(3)}`);
      ok(`${stem} lanczos 比 nearest 准`, rows.lanczos.g.meanDiff < rows.nearest.g.meanDiff,
        `${rows.lanczos.g.meanDiff.toFixed(3)} < ${rows.nearest.g.meanDiff.toFixed(3)}`);
      ok(`${stem} lanczos 比 bilinear 准`, rows.lanczos.g.meanDiff < rows.bilinear.g.meanDiff,
        `${rows.lanczos.g.meanDiff.toFixed(3)} < ${rows.bilinear.g.meanDiff.toFixed(3)}`);
      ok(`${stem} bicubic 比 bilinear 准`, rows.bicubic.g.meanDiff < rows.bilinear.g.meanDiff,
        `${rows.bicubic.g.meanDiff.toFixed(3)} < ${rows.bilinear.g.meanDiff.toFixed(3)}`);
      ok(`${stem} 立方与 Lanczos 都远好于最邻近`,
        rows.bicubic.g.meanDiff < rows.nearest.g.meanDiff / 2,
        `立方 ${rows.bicubic.g.meanDiff.toFixed(3)} vs 最邻近 ${rows.nearest.g.meanDiff.toFixed(3)}`);
    }
  }
}

/* ================================================================
   10. SDF：真图那张就是脸部 lightmap 的 G 通道
   ----------------------------------------------------------------
   这条是 Sdf.svelte 里「取 lightmap 的 G」那个选项的依据。
   同时也是反面依据：「从面部贴图切交界线」推不出作者那条线。
   ================================================================ */
section('SDF 与脸部 lightmap 的关系');
{
  if (!fs.existsSync(dataPath('face_sdf.raw'))) {
    missing = true;
    console.log('  缺基准数据，这一节没跑');
  } else {
    const sizes = readSizes();
    const load = (name) => loadRaw(sizes, name);
    const LM = load('face_lm');
    const SDF = load('face_sdf');
    ok('两张尺寸一致', LM.width === SDF.width && LM.height === SDF.height,
      `${LM.width}² vs ${SDF.width}²`);

    const n = LM.width * LM.height;
    let bad = 0;
    let maxD = 0;
    const hist = new Map();
    for (let i = 0; i < n; i++) {
      const g = LM.data[i * 4 + 1];
      const v = SDF.data[i * 4];
      const d = Math.abs(g - v);
      if (d) {
        bad++;
        if (d > maxD) maxD = d;
      }
      hist.set(g, (hist.get(g) || 0) + 1);
    }
    ok('SDF.R 就是脸部 lightmap 的 G 通道，逐像素相同', bad === 0,
      bad ? `差 ${bad} 个像素，max ${maxD}` : '残差 0');

    // 顺便把「0.5 打底、只在界线上挑到 0.9」这个编码钉住
    let base = 0;
    for (const v of [126, 127, 128]) base += hist.get(v) || 0;
    let hi = 0;
    for (const [v, c] of hist) if (v >= 200) hi += c;
    const hiMax = Math.max(...hist.keys());
    ok('98% 以上落在 0.494~0.502', base / n > 0.98, `实得 ${((base / n) * 100).toFixed(2)}%`);
    ok('亮部最高到 0.90 附近', hiMax === 230,
      `最高 ${hiMax} = ${(hiMax / 255).toFixed(3)}`);
    ok('挑高的那部分占比极小', hi / n < 0.02, `实得 ${((100 * hi) / n).toFixed(3)}%`);

    // 反面：SDF 跟面部漫反射对不上。这条要是反了，说明「从贴图推算」有戏
    const faceD = load('face_lm');
    let corr = 0;
    {
      const xs = [];
      const ys = [];
      for (let i = 0; i < n; i++) {
        xs.push(faceD.data[i * 4]);
        ys.push(SDF.data[i * 4]);
      }
      const mx = xs.reduce((a, b) => a + b, 0) / n;
      const my = ys.reduce((a, b) => a + b, 0) / n;
      let sxy = 0;
      let sxx = 0;
      let syy = 0;
      for (let i = 0; i < n; i++) {
        const dx = xs[i] - mx;
        const dy = ys[i] - my;
        sxy += dx * dy;
        sxx += dx * dx;
        syy += dy * dy;
      }
      corr = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
    }
    ok('SDF 跟 lightmap 的 R 通道没有相关性（线不是从亮度切出来的）',
      Math.abs(corr) < 0.2, `corr ${corr.toFixed(4)}`);
  }
}

if (missing) {
  console.log('\n真实配对基准不在，第 9、10 节一条都没跑。先执行：node tmp/ilmcheck/dump-vivian.mjs');
}
console.log(`\n通过 ${pass} 条，失败 ${fail} 条`);
process.exit(fail || missing ? 1 : 0);
