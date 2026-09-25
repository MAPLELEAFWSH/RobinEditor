/**
 * 通道约定表的测试。
 *
 * 守两件事：
 *   ① 表本身是完好的（四条约定、每套四个通道都有名字、默认值都在 0-1、都有出处标注）；
 *   ② **两套来源不能混**：口述那两套（原神 lightmap / 三渲二金属度）与本工程实测那套
 *      的通道含义本来就不同 —— 表里必须标清楚，界面上才分得出。这条是给人看的规矩，
 *      所以用断言钉住：每套的 `源` 不能是空的，而且两套口述流程的 R 含义必须不一样。
 */
import { 约定表, 找约定 } from '../src/lib/modules/channels/conventions.ts';

let n = 0;
let bad = 0;
const ok = (c, m) => {
  n++;
  if (!c) {
    bad++;
    console.log(`  FAIL ${m}`);
  }
};
const eq = (a, b, m) => ok(a === b, `${m}（期望 ${b}，实得 ${a}）`);

eq(约定表.length, 4, '四条约定：自定 / 原神 lightmap / 三渲二金属度 / 本工程实测');

for (const c of 约定表) {
  ok(!!c.id && !!c.name, `${c.id}：有 id 和名字`);
  ok(c.源.length >= 3, `${c.name}：标了来源（"${c.源}"）`);
  ok(c.note.length >= 8, `${c.name}：有一句整体说明`);
  for (const ch of ['R', 'G', 'B', 'A']) {
    const k = c[ch];
    ok(!!k && typeof k.name === 'string' && k.name.length > 0, `${c.name} 的 ${ch}：有含义名`);
    ok(typeof k.def === 'number' && k.def >= 0 && k.def <= 1, `${c.name} 的 ${ch}：默认值在 0-1（实得 ${k?.def}）`);
    ok(Math.abs(Math.round(k.def * 20) - k.def * 20) < 1e-9, `${c.name} 的 ${ch}：默认值落在 0.05 网格上`);
  }
  ok(Array.isArray(c.提示) && c.提示.length >= 1, `${c.name}：至少一条提示`);
}

/* 关键：两套来源的 R 含义不同，别混着用 */
const 口述原神 = 找约定('gi-lightmap');
const 口述三渲二 = 找约定('toon-metal');
const 实测 = 找约定('measured');
eq(口述原神.R.name, '金属度', '口述那套的 R 是金属度');
eq(口述三渲二.R.name, '金属/反光', '三渲二那套的 R 是金属/反光遮罩');
eq(实测.R.name, '高光/反射', '本工程实测那套的 R 是 高光/反射');
ok(口述原神.G.name === 'AO' && 实测.G.name === '阴影基调', '两套的 G 含义也不同（AO vs 阴影基调）');

/* 默认值按口述流程填：G 打底 0.5（"无脑 128"）、B 打底 0（无高光） */
eq(口述原神.G.def, 0.5, '口述原神那套：G 默认 0.5（就是 128）');
eq(口述原神.B.def, 0, '口述原神那套：B 默认 0（无高光）');
eq(口述三渲二.G.def, 0.5, '三渲二那套：G 默认 0.5');
eq(口述三渲二.A.def, 1, '三渲二那套：A 不用，拉满');

/* 找约定：给不认识的 id 要落回第一套，不能返回 undefined */
eq(找约定('不存在的').id, 约定表[0].id, '找不到就落回第一套（界面不会因为拼错 id 崩）');

console.log(`conventions：${n} 条断言，${bad} 条没过`);
process.exit(bad ? 1 : 0);
