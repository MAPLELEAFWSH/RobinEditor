/**
 * ⑦ 那条路的两组预设：**「游戏」和「打包模板」不许混**。
 *
 * 跑：node --import ./tmp/register-loader.mjs "tmp/⑦打包模板.test.mjs"
 *
 * 这套原来是 `tmp/mstoon-lm.test.mjs` 的第 7 节 —— ④ msToon 整个模块删了
 * （2026-09-26 用户："删除 MSToon 贴图绘制功能"），前面六节测的是 ④ 的
 * `buildFromLightmap` / `withWindow` / `MSTOON_PRESETS`，随模块一起没了。
 * **留在 ⑦ 里的是这一节**：`channels/ops.ts` 的 `GAMES` 里那三条
 * `mstoon-gi/hsr/zzz` 控制图模板（`kind: 'map'`）不走 ④，是"贴图通道处理"自己的模板。
 *
 * 这一节守的是一个**真机上量到过的 bug**：⑦「哪一套」那个选择器里多出三个
 * "msToon 控制图 · xxx" 按钮，点下去毫无反应 —— 它们只有 lm/m 一个槽，
 * 没有 a/m/n 那套通道计划，`pickGame` 里对 `g.plan` 取值直接抛异常，界面什么都不说。
 * 根因就是这三条被塞进 `GAMES` 而界面拿它当"游戏列表"用。
 */
import { GAMES, GAME_PRESETS, MAP_PRESETS } from '../src/lib/modules/channels/ops.ts';

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
const section = (t) => console.log(`\n== ${t} ==`);

section('1. 三条打包模板不许混进「游戏」选择器');
{
  eq(GAME_PRESETS.length, 3, 'GAME_PRESETS 只有三个游戏');
  eq(GAME_PRESETS.map((g) => g.id).join(','), 'zzz,hsr,gi', '就是绝区零 / 星铁 / 原神');
  ok(GAME_PRESETS.every((g) => g.kind !== 'map'), '游戏列表里没有 map');

  eq(MAP_PRESETS.length, 3, 'MAP_PRESETS 有三条');
  eq(MAP_PRESETS.map((g) => g.id).join(','), 'mstoon-gi,mstoon-hsr,mstoon-zzz', '就是那三条控制图模板');
  ok(MAP_PRESETS.every((g) => g.kind === 'map'), '三条都标了 kind=map');

  eq(GAME_PRESETS.length + MAP_PRESETS.length, GAMES.length, '两边加起来就是 GAMES，没漏没重');
}

section('2. 每个游戏都要有 a/m/n 那套槽和四路计划（这正是 map 那三条缺的东西）');
{
  for (const g of GAME_PRESETS) {
    ok(g.plan && g.plan.r && g.plan.g && g.plan.b && g.plan.a, `${g.name}：四路计划齐`);
    ok(g.slots.length > 0, `${g.name}：有槽位定义`);
  }
  /* 反面：三条 map 模板**不许**出现在游戏列表里。
     （注意别写成"它们没有 plan.a" —— `mstoonLightmapPlan` 返回的是完整的四路计划，
     它们缺的是 **a/m/n 那套槽**，不是 plan 的字段。第一版就是这么写错的。） */
  const 游戏id = new Set(GAME_PRESETS.map((g) => g.id));
  for (const g of MAP_PRESETS) {
    ok(!游戏id.has(g.id), `${g.name}：不在游戏列表里（所以选择器里不会多出这颗按钮）`);
  }
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
