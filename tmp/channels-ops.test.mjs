/**
 * ⑦ 通道处理的运算自检。纯函数，跑在 Node 里。
 *
 * 重点验三块：混合模式公式、调整链、图层合成（含蒙版）。
 * 这几块一旦错，界面上看着"差不多"，但导出的图会悄悄不对。
 *
 * 跑：node --import ./tmp/register-loader.mjs tmp/channels-ops.test.mjs
 */
import {
  BLEND_CODE,
  BLEND_LABEL,
  BLEND_GROUPS,
  GAMES,
  LayerCache,
  applyAdjust,
  applyPlan,
  boxBlur,
  buildMask,
  composite,
  makeLayer,
  makeMask,
  quantize,
  remapLevels,
  sizeMismatch,
  stretchPlane,
  applyAdjustChain,
  compileAdjust
} from '../src/lib/modules/channels/ops.ts';
import { previewOf } from '../src/lib/img.ts';

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
function eq(a, b, label, tol = 0) {
  const d = Math.abs(a - b);
  ok(d <= tol, label, `实得 ${a}，期望 ${b}（差 ${d.toFixed(3)}）`);
}
function section(t) {
  console.log(`\n== ${t} ==`);
}

/* ---------------- 造图工具 ---------------- */

function solid(w, h, r, g, b, a = 255) {
  const im = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    im.data[i * 4] = r;
    im.data[i * 4 + 1] = g;
    im.data[i * 4 + 2] = b;
    im.data[i * 4 + 3] = a;
  }
  return im;
}
/** 四路各给不同常量的图，用来验通道映射 */
function chanImage(w, h, r, g, b, a) {
  return solid(w, h, r, g, b, a);
}
const px = (im, x = 0, y = 0) => {
  const o = (y * im.width + x) * 4;
  return [im.data[o], im.data[o + 1], im.data[o + 2], im.data[o + 3]];
};

/* ============================================================ */
section('1. 混合模式的表是全的');
{
  const ids = Object.values(BLEND_LABEL);
  ok(ids.length === 24, '24 种模式都有中文名', `实得 ${ids.length}`);
  const missing = Object.keys(BLEND_LABEL).filter((k) => BLEND_CODE[k] === undefined);
  ok(missing.length === 0, '每个模式都有运算编号', missing.join(','));
  const grouped = BLEND_GROUPS.flatMap((g) => g.ids);
  ok(grouped.length === 24 && new Set(grouped).size === 24, '分组里不重不漏', `实得 ${grouped.length}`);
}

/* ============================================================ */
section('2. 混合公式（不透明、不遮罩，直接对着算）');
{
  const base = solid(4, 4, 128, 128, 128);
  const top = solid(4, 4, 128, 128, 128);
  const run = (blend) => {
    const l = makeLayer('t', 'top', 'rgb');
    l.blend = blend;
    return composite(4, 4, [makeLayer('b', 'base', 'rgb'), l], new Map([['base', base], ['top', top]]));
  };
  eq(px(run('multiply'))[0], Math.round((128 / 255) * (128 / 255) * 255), '正片叠底 128×128');
  eq(px(run('screen'))[0], Math.round((1 - (1 - 128 / 255) ** 2) * 255), '滤色');
  eq(px(run('normal'))[0], 128, '正常：上层直接盖住');
  eq(px(run('difference'))[0], 0, '同色差值 = 0');
  eq(px(run('darken'))[0], 128, '变暗取小');
  eq(px(run('lighten'))[0], 128, '变亮取大');
  eq(px(run('exclusion'))[0], Math.round((128 / 255 + 128 / 255 - 2 * (128 / 255) ** 2) * 255), '排除');
  eq(px(run('subtract'))[0], 0, '减去同色 = 0');
  eq(px(run('divide'))[0], 255, '划分同色 = 1（拉满）');

  const diff = composite(
    4, 4,
    [makeLayer('b', 'base', 'rgb'), Object.assign(makeLayer('t', 'top', 'rgb'), { blend: 'difference' })],
    new Map([['base', solid(4, 4, 128, 128, 128)], ['top', solid(4, 4, 200, 200, 200)]])
  );
  eq(px(diff)[0], 72, '差值 |128-200|');
}

/* ============================================================ */
section('3. 不透明度与蒙版');
{
  const base = solid(4, 4, 0, 0, 0);
  const top = solid(4, 4, 200, 200, 200);
  const l = makeLayer('t', 'top', 'rgb');
  l.opacity = 0.5;
  const out = composite(4, 4, [makeLayer('b', 'base', 'rgb'), l], new Map([['base', base], ['top', top]]));
  eq(px(out)[0], 100, '不透明度 50%：黑底 + 200', 1);

  // 蒙版全黑 —— 上层一点不该显
  const l2 = makeLayer('t', 'top', 'rgb');
  l2.mask = { ...makeMask(), on: true, slot: 'maskblack', ch: 'r' };
  const out2 = composite(
    4, 4,
    [makeLayer('b', 'base', 'rgb'), l2],
    new Map([['base', solid(4, 4, 30, 30, 30)], ['top', top], ['maskblack', solid(4, 4, 0, 0, 0)]])
  );
  eq(px(out2)[0], 30, '蒙版全黑：只留底色');

  // 蒙版全白 —— 上层全显
  const l3 = makeLayer('t', 'top', 'rgb');
  l3.mask = { ...makeMask(), on: true, slot: 'maskwhite', ch: 'r' };
  const out3 = composite(
    4, 4,
    [makeLayer('b', 'base', 'rgb'), l3],
    new Map([['base', solid(4, 4, 30, 30, 30)], ['top', top], ['maskwhite', solid(4, 4, 255, 255, 255)]])
  );
  eq(px(out3)[0], 200, '蒙版全白：上层全显');

  // 半灰蒙版 = 半透明
  const l4 = makeLayer('t', 'top', 'rgb');
  l4.mask = { ...makeMask(), on: true, slot: 'mgray', ch: 'r' };
  const out4 = composite(
    4, 4,
    [makeLayer('b', 'base', 'rgb'), l4],
    new Map([['base', solid(4, 4, 0, 0, 0)], ['top', top], ['mgray', solid(4, 4, 128, 128, 128)]])
  );
  eq(px(out4)[0], 100, '蒙版半灰：相当于 50%', 2);

  // 蒙版反相
  const l5 = makeLayer('t', 'top', 'rgb');
  l5.mask = { ...makeMask(), on: true, slot: 'maskblack', ch: 'r', invert: true };
  const out5 = composite(
    4, 4,
    [makeLayer('b', 'base', 'rgb'), l5],
    new Map([['base', solid(4, 4, 30, 30, 30)], ['top', top], ['maskblack', solid(4, 4, 0, 0, 0)]])
  );
  eq(px(out5)[0], 200, '蒙版反相后全显');

  // 隐藏的图层不参与
  const l6 = Object.assign(makeLayer('t', 'top', 'rgb'), { on: false });
  const out6 = composite(4, 4, [makeLayer('b', 'base', 'rgb'), l6], new Map([['base', base], ['top', top]]));
  eq(px(out6)[0], 0, '隐藏图层被跳过');
}

/* ============================================================ */
section('4. 非分离混合（色相 / 饱和度 / 颜色 / 明度）');
{
  const base = solid(2, 2, 200, 100, 50);
  const top = solid(2, 2, 20, 220, 90);
  const run = (blend) => {
    const l = makeLayer('t', 'top', 'rgb');
    l.blend = blend;
    return px(composite(2, 2, [makeLayer('b', 'base', 'rgb'), l], new Map([['base', base], ['top', top]])));
  };
  const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const baseLum = lum([200, 100, 50]);
  const topLum = lum([20, 220, 90]);
  // 明度模式：取上层的明度、底色的色相饱和度 —— 所以结果明度 = 上层的
  eq(lum(run('luminosity')), topLum, '明度模式：结果的明度跟着上层', 2);
  // 颜色模式：取上层的色相饱和度、底色的明度
  eq(lum(run('color')), baseLum, '颜色模式：结果的明度跟着底色', 3);
  // 色相 / 饱和度模式也保底色的明度
  eq(lum(run('hue')), baseLum, '色相模式：明度取底色', 3);
  eq(lum(run('saturation')), baseLum, '饱和度模式：明度取底色', 3);
  for (const m of ['hue', 'saturation', 'color', 'luminosity']) {
    const c = run(m);
    ok(c.slice(0, 3).every((v) => v >= 0 && v <= 255), `${m} 结果没跑出 0-255`, c.join(','));
  }
}

/* ============================================================ */
section('5. 调整：逐条对着算');
{
  const one = solid(2, 2, 100, 100, 100);
  const run = (op, scope = 'all', src = one) => px(applyAdjust(src, [op], scope))[0];

  eq(run({ k: 'invert' }), 155, '反相 100 → 155');
  eq(run({ k: 'threshold', level: 128 }), 0, '阈值 128：100 变黑');
  eq(run({ k: 'threshold', level: 80 }), 255, '阈值 80：100 变白');
  eq(run({ k: 'posterize', levels: 4 }), 85, '色调分离 4 档：100 → 85');
  eq(run({ k: 'brightness-contrast', brightness: 0, contrast: 0 }), 100, '亮度对比度都是 0 = 恒等');
  eq(run({ k: 'levels', inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 }), 100, '色阶默认 = 恒等');
  eq(
    run({ k: 'curves', pts: [{ x: 0, y: 0 }, { x: 1, y: 1 }], mode: 'linear' }),
    100,
    '曲线两点线性 = 恒等'
  );

  // 色阶：输入黑点抬到 100，100 处应该出 0
  eq(
    run({ k: 'levels', inBlack: 100, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 }),
    0,
    '色阶黑点 100：100 压到 0'
  );

  // 去色：红色应该变成它的明度
  const red = solid(2, 2, 255, 0, 0);
  const g = px(applyAdjust(red, [{ k: 'desaturate', amount: 100 }], 'all'));
  eq(g[0], 54, '去色：纯红的 R 变成 Rec.709 明度 54');
  eq(g[1], 54, '去色：G 也变 54');
  ok(g[0] === g[1] && g[1] === g[2], '去色后三路相等');

  // 作用范围：只动 R
  const c = solid(2, 2, 100, 100, 100);
  const rOnly = px(applyAdjust(c, [{ k: 'invert' }], 'r'));
  ok(rOnly[0] === 155 && rOnly[1] === 100 && rOnly[2] === 100, '范围选 R 时只动 R', rOnly.join(','));

  // 调整链按顺序生效：这两个顺序的结果必须不同
  const a = px(applyAdjust(c, [{ k: 'invert' }, { k: 'threshold', level: 160 }], 'all'))[0];
  const b = px(applyAdjust(c, [{ k: 'threshold', level: 160 }, { k: 'invert' }], 'all'))[0];
  ok(a !== b, '调换顺序结果不同（说明真的是按顺序跑的）', `${a} vs ${b}`);

  // 空链不动像素，但**要返回副本**：
  //   原来是 `return src`（把原对象原样还回去），而 `buildLayerRgba` 走的是"永远复制" ——
  //   同一条链两个入口语义不一致，而图层缓存的键是对象身份，还回原对象会让
  //   "改了参数却命中同一张缓存"这种错很难查。2026-09-20 统一成**永远复制**。
  const orig = solid(2, 2, 77, 88, 99);
  const same = applyAdjust(orig, [], 'all');
  ok(same !== orig, '空调整链返回的是副本，不是原对象（别留别名陷阱）');
  let 一样 = true;
  for (let i = 0; i < orig.data.length; i++) if (same.data[i] !== orig.data[i]) 一样 = false;
  ok(一样, '空链不动像素（值跟原来一模一样）');

  // HSL 饱和度 -100 应该变灰
  const sat0 = px(applyAdjust(solid(2, 2, 200, 60, 30), [{ k: 'hsl', hue: 0, sat: -100, light: 0 }], 'all'));
  ok(sat0[0] === sat0[1] && sat0[1] === sat0[2], '饱和度 -100 → 灰', sat0.join(','));
}

/* ============================================================ */
section('6. 蒙版构造');
{
  const w = 4;
  const h = 1;
  const src = solid(w, h, 100, 100, 100);
  const p = new Uint8ClampedArray([0, 50, 100, 200]);
  // 手工走一遍 remapLevels
  const q = remapLevels(new Uint8ClampedArray(p), 0, 255, 1, false);
  eq(q[0], 0, 'remap 黑点保持 0');
  eq(q[3], 200, 'remap 白点保持 200');

  const q2 = remapLevels(new Uint8ClampedArray(p), 100, 200, 1, false);
  eq(q2[2], 0, '黑点 100：100 压到 0');
  eq(q2[3], 255, '白点 200：200 拉到 255');

  const q3 = remapLevels(new Uint8ClampedArray(p), 0, 255, 1, true);
  eq(q3[0], 255, '反相：0 → 255');

  // buildMask：没开 / 没选源都返回 null（调用方当"不遮"处理）
  ok(buildMask({ ...makeMask(), on: false }, src, w, h) === null, '蒙版没开 → null');
  ok(buildMask({ ...makeMask(), on: true, slot: '' }, src, w, h) === null, '开了但没选源 → null');
  const m = buildMask({ ...makeMask(), on: true, slot: 's', ch: 'r' }, src, w, h);
  ok(m && m.length === w * h && m[0] === 100, '取 R 通道当蒙版', m ? String(m[0]) : 'null');

  // 模糊不改均值太多
  const grad = new Uint8ClampedArray(64 * 64);
  for (let i = 0; i < grad.length; i++) grad[i] = (i % 64) * 4;
  const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const blurred = boxBlur(grad, 64, 64, 3);
  ok(Math.abs(mean(blurred) - mean(grad)) < 6, '模糊前后均值基本不变', `${mean(grad).toFixed(2)} → ${mean(blurred).toFixed(2)}`);
  // 模糊后相邻差应该变小
  const rough = (arr) => {
    let s = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 63; x++) s += Math.abs(arr[y * 64 + x + 1] - arr[y * 64 + x]);
    return s / (64 * 63);
  };
  ok(rough(blurred) < rough(grad), '模糊后横向起伏变小', `${rough(grad).toFixed(2)} → ${rough(blurred).toFixed(2)}`);
}

/* ============================================================ */
section('7. 量化 / 拉伸');
{
  const p = new Uint8ClampedArray([0, 40, 100, 127, 128, 200, 255]);
  quantize(p, [0, 128]);
  // 只有 0 和 128 两档，所以 200、255 都该吸到 128（比到 0 近）
  ok(
    p[0] === 0 && p[1] === 0 && p[2] === 128 && p[4] === 128 && p[5] === 128 && p[6] === 128,
    '两档量化吸附正确（255 也吸到 128，因为没有 255 这一档）',
    [...p].join(',')
  );
  const p2 = new Uint8ClampedArray([0, 10, 20, 30, 100, 200]);
  quantize(p2, [0, 64, 128, 191, 255]);
  ok(
    p2[0] === 0 && p2[1] === 0 && p2[2] === 0 && p2[3] === 0 && p2[4] === 128 && p2[5] === 191,
    '五档量化吸附正确（30 离 0 比离 64 近，所以归 0）',
    [...p2].join(',')
  );

  const p3 = new Uint8ClampedArray([50, 60, 70, 80]);
  stretchPlane(p3, 'auto', 0, 255);
  ok(p3[0] === 0 && p3[3] === 255, '自动拉伸拉到满量程', [...p3].join(','));
  const p4 = new Uint8ClampedArray([0, 128, 255]);
  const before = [...p4];
  stretchPlane(p4, 'none', 0, 255);
  ok(p4.every((v, i) => v === before[i]), 'none 模式不动');
}

/* ============================================================ */
section('8. 游戏预设的通道映射');
{
  // 绝区零：_A.G → R，_N.B → G，_M.B → B，A = 255
  const A = chanImage(4, 4, 10, 20, 30, 40);
  const M = chanImage(4, 4, 50, 60, 70, 80);
  const N = chanImage(2, 2, 90, 100, 110, 120); // 半分辨率
  const zzz = GAMES.find((g) => g.id === 'zzz');
  const out = applyPlan(4, 4, zzz.plan, new Map([['a', A], ['m', M], ['n', N]]));
  const got = px(out);
  ok(got[0] === 20, 'LM.R = _A 的 G（20）', String(got[0]));
  ok(got[1] === 110, 'LM.G = _N 的 B（110）', String(got[1]));
  ok(got[2] === 70, 'LM.B = _M 的 B（70）', String(got[2]));
  ok(got[3] === 255, 'LM.A = 255', String(got[3]));

  // _M 的 G 不该参与 —— 把它改掉，结果必须一模一样
  const M2 = chanImage(4, 4, 50, 200, 70, 80);
  const out2 = applyPlan(4, 4, zzz.plan, new Map([['a', A], ['m', M2], ['n', N]]));
  ok(
    [0, 1, 2, 3].every((i) => px(out2)[i] === got[i]),
    '_M 的 G 被改掉后结果不变（证明确实没用到它）'
  );

  // 半分辨率放大：_N 默认核是 lanczos。
  //
  // 这里锁的是**默认值本身**，不是"哪种核更好"。四个核的裁决在 tools/zzz-kernel.py
  // 里对着真值 LM 的 G 通道量过（两套 Body 配对，同时算 MAE 和相同比例）：
  //   最邻近 0.533/1.056、双线性 0.299/0.584、双三次 0.144/0.260、lanczos 0.131/0.243
  // 早先这里断言的是 nearest，依据是"相同比例 85.28% 更高"——那个数不是对着真值量的。
  ok(zzz.plan.g.upscale === 'lanczos', '绝区零 _N 默认放大核是 lanczos，实得 ' + zzz.plan.g.upscale);
  // 这一路的 B 是全平的，所以任何核出来都该是 110（尺寸对了就够）
  const okFlat = [0, 1].every((y) => [0, 1].every((x) => px(out, x, y)[1] === 110));
  ok(okFlat, '半分辨率 _N 放大后铺满，值不变');

  // 原神的 G 量化到 {0, 128}
  const gi = GAMES.find((g) => g.id === 'gi');
  const plan = structuredClone(gi.plan);
  plan.g.slot = 'g';
  plan.g.ch = 'r';
  // 原神预设**不预设量化档位**。
  //
  // 早先这里断言的是「100 吸附到 128、40 吸附到 0」，依据是"原神 G 是离散两档"。
  // 拿 tools/probe_maps.py 复量样本之后发现那个说法不成立：
  //   Odette Body lightmap  G 有 142 个取值、63.5% 落 0.50，其余跨满全范围
  //   木偶   Body lightmap  G 有 140 个取值、59.8% 落 0.00 / 32.1% 落 0.50
  // 两张分布不一样，也都不是 {0, 64, 128, 191, 255}。硬套档位表会改坏用户自己的图。
  // 所以现在断言：原神预设走**直通**，档位要用户自己在界面上定。
  const giOut = applyPlan(2, 2, plan, new Map([['g', solid(2, 2, 100, 100, 100)]]));
  eq(px(giOut)[1], 100, '原神预设不量化：100 原样过');
  const giOut2 = applyPlan(2, 2, plan, new Map([['g', solid(2, 2, 40, 40, 40)]]));
  eq(px(giOut2)[1], 40, '原神预设不量化：40 原样过');

  // 用户手动给了档位就得照做。这条单测 quantize 本身，跟预设无关
  const q = quantize(new Uint8ClampedArray([100, 40, 128, 200]), [0, 128]);
  eq(q[0], 128, 'quantize 手填两档：100 → 128');
  eq(q[1], 0, 'quantize 手填两档：40 → 0');
  eq(q[2], 128, 'quantize 手填两档：128 → 128');
  eq(q[3], 128, 'quantize 手填两档：200 → 128');

  // 尺寸不一致能被报出来
  const mm = sizeMismatch(zzz.plan, new Map([['a', A], ['m', M], ['n', N]]), 4, 4);
  ok(mm.length === 1 && mm[0].upscale === 'lanczos', '半分辨率的 _N 被报为尺寸不一致且用 lanczos', JSON.stringify(mm));
}

/* ============================================================ */
section('9. 图层缓存');
{
  const base = solid(8, 8, 10, 10, 10);
  const top = solid(8, 8, 200, 200, 200);
  const layers = [makeLayer('b', 'base', 'rgb'), makeLayer('t', 'top', 'rgb')];
  const map = new Map([['base', base], ['top', top]]);
  const cache = new LayerCache(16);

  const r1 = composite(8, 8, layers, map, { cache });
  const after1 = { hits: cache.hits, miss: cache.miss };
  const r2 = composite(8, 8, layers, map, { cache });
  ok(cache.hits > after1.hits, '第二次跑命中缓存', `hits ${after1.hits} → ${cache.hits}`);
  ok(px(r1)[0] === px(r2)[0] && px(r1)[0] === 200, '缓存命中时结果一致', `${px(r1)[0]} / ${px(r2)[0]}`);

  // 改"源 + 调整"才该走未命中；不改就不该重算 —— 混和模式和不透明度是在
  // 合成阶段用的，不进这一层的中间结果，所以它们变了也不该让缓存失效
  const topAdj = Object.assign(makeLayer('t', 'top', 'rgb'), {
    adjust: [{ k: 'invert' }],
    adjustScope: 'all'
  });
  const before2 = cache.miss;
  const r3 = composite(8, 8, [layers[0], topAdj], map, { cache });
  ok(cache.miss > before2, '改了调整参数就走未命中');
  eq(px(r3)[0], 55, '调整生效（200 反相成 55）');

  const b3 = cache.miss;
  const topOpacity = { ...topAdj, opacity: 0.5 };
  composite(8, 8, [layers[0], topOpacity], map, { cache });
  ok(cache.miss === b3, '只改不透明度不重算这一层的像素（缓存复用）');
}

/* ============================================================ */
section('9c. msToon 控制图的模板（照素材里真实产物的配对对出来的）');
{
  const gi = GAMES.find((g) => g.id === 'mstoon-gi');
  const hsr = GAMES.find((g) => g.id === 'mstoon-hsr');
  const zzz = GAMES.find((g) => g.id === 'mstoon-zzz');
  ok(!!gi && !!hsr && !!zzz, '三条模板都在');

  // G 是逐像素搬运：源 lightmap 的 B
  for (const [name, p] of [['原神', gi], ['星铁', hsr]]) {
    ok(p.plan.g.slot === 'lm', `${name}：G 取 lm 槽`);
    ok(p.plan.g.ch === 'b', `${name}：G 取源图的 B`);
    eq(p.plan.r.constant, 0, `${name}：R 恒 0`);
    eq(p.plan.a.constant, 255, `${name}：A 恒 1`);
    ok(p.plan.b.invert === true, `${name}：B 是反相`);
    ok(p.plan.b.round === 'floor', `${name}：B 用截断取整（产物就是截断）`);
    // applyPlan 是先 invert 再 stretch，所以窗口上端必须是 255、下端是 255 − hi
    ok(p.plan.b.hi === 255, `${name}：B 的窗口上端是 255`);
  }
  eq(gi.plan.b.lo, 127, '原神：lo = 255 − 128 = 127');
  ok(Math.abs(hsr.plan.b.lo - (255 - 255 / 3.5)) < 1e-9, '星铁：lo = 255 − 255/3.5');

  // 绝区零那条不一样：B 不映射
  ok(zzz.plan.g.slot === 'm', '绝区零：G 取 _M');
  ok(zzz.plan.g.ch === 'g', '绝区零：G 取 _M 的 G');
  ok(zzz.plan.g.invert === false, '绝区零：G 不反相');
  eq(zzz.plan.b.constant, 0, '绝区零：B 恒 0（不做窗口映射）');
  ok(zzz.plan.b.slot === '', '绝区零：B 没有源');
  eq(zzz.plan.r.constant, 0, '绝区零：R 恒 0');
  eq(zzz.plan.a.constant, 255, '绝区零：A 恒 1');
}

/* ============================================================ */
section('9d. stretchPlane 的两种取整');
{
  // 造一个正好落在 .5 上的输入：窗口 [0,2] 上的值 1 → 1/2*255 = 127.5
  const a = new Uint8ClampedArray([1]);
  stretchPlane(a, 'manual', 0, 2);
  const b = new Uint8ClampedArray([1]);
  stretchPlane(b, 'manual', 0, 2, 'floor');
  eq(a[0], 128, '默认是半偶数取整：127.5 → 128');
  eq(b[0], 127, 'floor 是截断：127.5 → 127');
  eq(a[0] !== b[0], true, '两种取整在 .5 上确实不一样（这就是要 floor 的原因）');

  // 不在 .5 上的值两种取整一样
  const c = new Uint8ClampedArray([3]);
  stretchPlane(c, 'manual', 0, 4, 'floor');
  eq(c[0], 191, 'floor：3/4*255 = 191.25 → 191');
  const d = new Uint8ClampedArray([1]);
  stretchPlane(d, 'manual', 0, 3, 'floor');
  eq(d[0], 85, 'floor：1/3*255 = 85 → 85');

  // 超出窗口两端要夹住：上端 → 255，下端 → 0
  const e = new Uint8ClampedArray([10]);
  stretchPlane(e, 'manual', 0, 5, 'floor');
  eq(e[0], 255, '源值超出窗口上端 → 夹到 255');
  const f = new Uint8ClampedArray([0]);
  stretchPlane(f, 'manual', 100, 200, 'floor');
  eq(f[0], 0, '源值低于窗口下端 → 夹到 0');
}

/* ============================================================ */
section('9b. 预览缩小后的缓存（照真实调用方的形状）');
{
  // 上面那一节用的是**一个复用的 Map**，源图也都比预览边长小 ——
  // 比真实用法窄。真实调用方（`lySources` / `blSources` / `gameSources`）
  // 是在 raf 回调里现建 Map 的，源图还都比 320 大。
  // 这两件事凑一起，key 里的 objId 每次都换号，缓存一次都命中不了。
  const PREVIEW = 320;
  const big = solid(640, 640, 30, 60, 90);
  // 两层，参数得真的不一样 —— 键里不带图层名，同槽位同通道的两层会共用一个键
  const layers = [makeLayer('b', 'base', 'rgb'), makeLayer('t', 'base', 'r')];
  /** 跟调用方一样：每次重算都新造一个 Map，源图先过 previewOf */
  const sources = () => new Map([['base', previewOf(big, PREVIEW)]]);
  const cache = new LayerCache(16);
  const side = previewOf(big, PREVIEW).width;

  composite(side, side, layers, sources(), { cache });
  const hits1 = cache.hits;
  composite(side, side, layers, sources(), { cache });
  ok(cache.hits - hits1 === 2, '两层第二次各命中一次（旧实现这里是 0）', `命中 ${cache.hits - hits1} 次`);

  ok(previewOf(big, PREVIEW) === previewOf(big, PREVIEW), '同一张源 + 同一个边长给的是同一个对象');
  eq(previewOf(big, PREVIEW).width, PREVIEW, '还是压到 320');
  ok(previewOf(big, 640) === big, '本来就够小就原样返回');
  ok(previewOf(big, 160) === previewOf(big, 160), '换一个边长也是同一个对象');
  ok(previewOf(big, 160) !== previewOf(big, PREVIEW), '边长不同就是两份，别串');
  ok(previewOf(solid(640, 640, 1, 2, 3), PREVIEW) !== previewOf(big, PREVIEW), '换张源图就换一份');
}

/* ============================================================ */
section('10. 调整链编译');
{
  const c = compileAdjust(
    [
      { k: 'invert' },
      { k: 'desaturate', amount: 100 },
      { k: 'hsl', hue: 30, sat: 0, light: 0 }
    ],
    'all'
  );
  ok(c.length === 3, '三步各编译成一条', String(c.length));
  ok(c[0].t === 0 && c[1].t === 1 && c[2].t === 2, '类型顺序对（LUT / 去色 / HSL）');

  const onlyR = compileAdjust([{ k: 'invert' }], 'r');
  const luts = onlyR[0].luts;
  ok(luts[0] instanceof Uint8ClampedArray && luts[1] === null && luts[2] === null, '范围选 R 时只有 R 有 LUT');

  // 就地应用跟 applyAdjust 结果一致
  const img = solid(2, 2, 30, 160, 90);
  const a = applyAdjust(img, [{ k: 'invert' }], 'all');
  const b = new ImageData(2, 2);
  b.data.set(img.data);
  applyAdjustChain(b.data, compileAdjust([{ k: 'invert' }], 'all'));
  ok(
    a.data.every((v, i) => v === b.data[i]),
    'applyAdjust 和 applyAdjustChain 结果一致'
  );
}

/* ============================================================ */
console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
