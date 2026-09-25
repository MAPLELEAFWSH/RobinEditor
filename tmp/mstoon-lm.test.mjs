/**
 * ④「lightmap 打包」这条路的自检。
 *
 * 跑：node --import ./tmp/register-loader.mjs tmp/mstoon-lm.test.mjs
 *
 * 这一套盯的是**接线**，不是映射本身：
 *   1. 界面默认落在哪一面板、那一面在注册表里
 *   2. 选游戏 → 丢一张图 → 出来的东西**就是 ⑦ GAMES 那条模板出来的东西**（逐字节）
 *      —— 只要有人在 ④ 里另抄一份映射，这条立刻红
 *   3. 星铁那个窗口的两个实测值换上去真能改到 B 那一路，且换的是窗口不是别的
 *   4. 绝区零那一档吃的是 _M 的 G，不是 lightmap
 *
 * 映射**对不对**不在这儿验：那一条的判据是素材里的真实配对，在 ⑦ 那套里。
 */
import fs from 'node:fs';
import { blankImageData } from '../src/lib/img.ts';
import { getGame, applyPlan, GAMES, GAME_PRESETS, MAP_PRESETS } from '../src/lib/modules/channels/ops.ts';
import {
  MSTOON_PRESETS,
  HSR_WINDOWS,
  buildFromLightmap,
  findPreset,
  withWindow
} from '../src/lib/modules/mstoon/ops.ts';

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
// 自检 ok() 本身：条件为假必须记成失败
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
function eq(a, b, label) {
  ok(a === b, label, `实得 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}`);
}
function section(t) {
  console.log(`\n== ${t} ==`);
}

/** 造一张源图：每个像素四路各不相同，好看出产物取的是哪一路 */
function mk(w, h, fn) {
  const img = blankImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fn(x, y);
      const i = (y * w + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = a;
    }
  }
  return img;
}

function plane(img, k) {
  const at = 'rgba'.indexOf(k);
  const out = new Uint8ClampedArray(img.width * img.height);
  for (let i = 0; i < out.length; i++) out[i] = img.data[i * 4 + at];
  return out;
}

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/* 源图：R 大、G 中、B 随 x 变、A 恒定非 255 —— 四路都不一样，取错立刻看得出来 */
const SRC = mk(32, 8, (x, y) => [200, 40 + y * 5, 8 + x * 7, 180]);

/* ================================================================ */
section('1. 三条预设都在，且指向 ⑦ 的模板');
{
  eq(MSTOON_PRESETS.length, 3, '三个游戏');
  eq(MSTOON_PRESETS.map((p) => p.id).join(','), 'gi,hsr,zzz', 'id 顺序：原神 / 星铁 / 绝区零');

  for (const p of MSTOON_PRESETS) {
    const g = GAMES.find((x) => x.id === p.gameId);
    ok(!!g, `${p.name}：⑦ 里有 ${p.gameId} 这条模板`);
    ok(!!p.srcLabel && !!p.srcHint, `${p.name}：源说清楚了（标签 + 提示）`);
  }

  // 绝区零那一档的源不是 lightmap，是 _M 的 G —— 这条容易写错
  eq(findPreset('zzz').gFrom, 'g', '绝区零取的是源的 G 那一路');
  eq(findPreset('gi').gFrom, 'b', '原神取的是源的 B 那一路');
  eq(findPreset('hsr').gFrom, 'b', '星铁取的是源的 B 那一路');
  ok(findPreset('nope').id === 'gi', '认不出的 id 退回第一条，不返回 undefined');
}

section('2. 产物 = ⑦ 模板的产物（逐字节，防止在 ④ 里另抄一份映射）');
{
  for (const p of MSTOON_PRESETS) {
    const got = buildFromLightmap(SRC, p.id).out;

    // 拿 ⑦ 的模板自己跑一遍当基准。映射要是被抄成第二份，这里就会分叉
    const g = getGame(p.gameId);
    const sources = new Map(g.slots.map((s) => [s.id, SRC]));
    const want = applyPlan(SRC.width, SRC.height, g.plan, sources);

    ok(
      got.width === want.width && got.height === want.height,
      `${p.name}：尺寸一致`,
      `${got.width}×${got.height} vs ${want.width}×${want.height}`
    );
    ok(same(new Uint8ClampedArray(got.data), new Uint8ClampedArray(want.data)), `${p.name}：四路逐字节相同`);
  }
}

section('3. 产物形状：R 恒 0、A 恒 1，尺寸跟着源走');
{
  for (const p of MSTOON_PRESETS) {
    const out = buildFromLightmap(SRC, p.id).out;
    eq(out.width, SRC.width, `${p.name}：宽跟源一样`);
    eq(out.height, SRC.height, `${p.name}：高跟源一样`);

    const R = plane(out, 'r');
    const A = plane(out, 'a');
    ok(R.every((v) => v === 0), `${p.name}：R 恒 0`);
    ok(A.every((v) => v === 255), `${p.name}：A 恒 1`);
  }

  // G 是逐像素搬运：等于源的那一路（这条在 ⑦ 里也是逐像素验过的）
  for (const p of MSTOON_PRESETS) {
    const out = buildFromLightmap(SRC, p.id).out;
    ok(same(plane(out, 'g'), plane(SRC, p.gFrom)), `${p.name}：G 就是源的 ${p.gFrom.toUpperCase()}，逐像素`);
  }

  // 绝区零 B 恒 0；原神 / 星铁的 B 不是恒 0（有条反相窗口）
  eq(plane(buildFromLightmap(SRC, 'zzz').out, 'b').every((v) => v === 0), true, '绝区零：B 恒 0');
  ok(!plane(buildFromLightmap(SRC, 'gi').out, 'b').every((v) => v === 0), '原神：B 有数据');
  ok(!plane(buildFromLightmap(SRC, 'hsr').out, 'b').every((v) => v === 0), '星铁：B 有数据');

  // 换一张尺寸不同的源，产物尺寸跟着换
  const big = mk(64, 16, (x) => [1, 2, 3, 4]);
  eq(buildFromLightmap(big, 'gi').out.width, 64, '换源图尺寸，产物尺寸跟着走');
}

section('4. 星铁那个窗口：身体 / 头发两个实测值');
{
  const body = HSR_WINDOWS.find((w) => w.id === 'body');
  const hair = HSR_WINDOWS.find((w) => w.id === 'hair');
  ok(!!body && !!hair, '两个预设都在');
  ok(Math.abs(body.hi - 255 / 3.5) < 1e-9, '身体那个是 255 / 3.5');
  eq(hair.hi, 85, '头发那个是 85');

  // 预设值必须等于模板里原来的窗口 —— 否则"默认"和"点一下"出来的不是同一个东西
  const g = getGame('mstoon-hsr');
  ok(Math.abs(255 - g.plan.b.lo - body.hi) < 1e-9, '模板里默认那个就是身体的值');

  const def = buildFromLightmap(SRC, 'hsr').out;
  const asBody = buildFromLightmap(SRC, 'hsr', { windowHi: body.hi }).out;
  ok(same(new Uint8ClampedArray(def.data), new Uint8ClampedArray(asBody.data)), '不传窗口 = 传身体的窗口');

  const asHair = buildFromLightmap(SRC, 'hsr', { windowHi: hair.hi }).out;
  ok(!same(plane(def, 'b'), plane(asHair, 'b')), '换头发的窗口，B 那一路真的变了');

  // 只动 B，其余三路不许跟着变
  ok(same(plane(def, 'r'), plane(asHair, 'r')), '换窗口不影响 R');
  ok(same(plane(def, 'g'), plane(asHair, 'g')), '换窗口不影响 G');
  ok(same(plane(def, 'a'), plane(asHair, 'a')), '换窗口不影响 A');

  // 窗口越窄，反相后的值越大（这是"窗口"这条映射的定义）
  const meanOf = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  ok(meanOf(plane(asHair, 'b')) > meanOf(plane(asBody, 'b')), '头发窗口更窄 → B 整体更亮');
}

section('5. withWindow 只改该改的那一路');
{
  const g = getGame('mstoon-hsr');
  const p2 = withWindow(g.plan, 85);
  eq(p2.b.stretch, 'manual', 'B 还是手填窗口那条形状');
  eq(p2.b.invert, true, 'B 还是反相');
  eq(p2.b.round, 'floor', 'B 还是截断取整（这条丢了就不是逐像素复现了）');
  ok(Math.abs(p2.b.lo - 170) < 1e-9, 'lo = 255 − 85 = 170');
  eq(p2.b.hi, 255, 'hi 是 255');
  ok(p2.r === g.plan.r && p2.g === g.plan.g && p2.a === g.plan.a, '其余三路原对象没动');

  // 同样的值再传一次，应当原样返回（省得每次都造新对象）
  ok(withWindow(g.plan, 255 / 3.5) === g.plan, '值没变时原样返回');

  // 绝区零那条 B 恒 0，不是"反相 + 窗口"的形状，不许被改
  const z = getGame('mstoon-zzz');
  ok(withWindow(z.plan, 85) === z.plan, '绝区零那条没有窗口，不动它');
}

section('6. 界面接线：默认面板与那几个分区');
{
  const reg = fs.readFileSync('src/lib/modules/registry.ts', 'utf8');
  const mstoon = reg.slice(reg.indexOf("id: 'mstoon'"), reg.indexOf("id: 'mstoon'") + 900);

  ok(/\bpanel:\s*'pack'/.test(mstoon), "④ 的默认面板是 'pack'");
  ok(mstoon.indexOf("{ id: 'pack'") > -1, "'pack' 这一面在注册表里");
  ok(
    mstoon.indexOf("{ id: 'pack'") < mstoon.indexOf("{ id: 'shadowrate'"),
    'pack 排在 ShadowRate 前面（默认那面摆在最前）'
  );
  // 老的四个分区都还在（清单说降级保留，不是删掉）
  for (const id of ['shadowrate', 'sublight', 'edge', 'facesdf']) {
    ok(mstoon.indexOf(`{ id: '${id}'`) > -1, `老分区 ${id} 还在`);
  }

  const comp = fs.readFileSync('src/lib/modules/mstoon/Mstoon.svelte', 'utf8');
  ok(comp.indexOf("panelId === 'pack'") > -1, '组件里有 pack 这一面的渲染分支');
  ok(comp.indexOf('buildFromLightmap') > -1, '那一面走的是 buildFromLightmap');
  ok(comp.indexOf('exportPack') > -1, '有导出');
}

section('7. 三条打包模板不许混进"游戏"选择器（真机上点过没反应的 bug）');
{
  /* 真机上量到过：⑦「哪一套」那个选择器里多出三个 "msToon 控制图 · xxx" 按钮，
     点下去毫无反应 —— 它们只有 lm/m 一个槽，没有 a/m/n 那套通道计划，
     `pickGame` 里对 `g.plan` 取值直接抛异常，界面什么都不说。
     根因是这三条被塞进了 `GAMES` 而界面拿它当"游戏列表"用。 */
  eq(GAME_PRESETS.length, 3, 'GAME_PRESETS 只有三个游戏');
  eq(GAME_PRESETS.map((g) => g.id).join(','), 'zzz,hsr,gi', '就是绝区零 / 星铁 / 原神');
  ok(GAME_PRESETS.every((g) => g.kind !== 'map'), '游戏列表里没有 map');

  eq(MAP_PRESETS.length, 3, 'MAP_PRESETS 有三条');
  eq(MAP_PRESETS.map((g) => g.id).join(','), 'mstoon-gi,mstoon-hsr,mstoon-zzz', '就是那三条控制图模板');
  ok(MAP_PRESETS.every((g) => g.kind === 'map'), '三条都标了 kind=map');

  eq(GAME_PRESETS.length + MAP_PRESETS.length, GAMES.length, '两边加起来就是 GAMES，没漏没重');

  /* 每个游戏都要有 a/m/n 那套槽和四路计划 —— 这正是 map 那三条缺的东西 */
  for (const g of GAME_PRESETS) {
    ok(g.plan && g.plan.r && g.plan.g && g.plan.b && g.plan.a, `${g.name}：四路计划齐`);
    ok(g.slots.length > 0, `${g.name}：有槽位定义`);
  }
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
