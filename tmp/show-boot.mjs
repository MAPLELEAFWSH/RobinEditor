/* 临时：跑一遍开场探针，把 opacity 曲线挑出来看（跑完删） */
import { execFileSync } from 'node:child_process';

const out = execFileSync(
  process.execPath,
  ['tools/cdp-run.mjs', `${process.env.TEMP}\\boot-timing.js`, 'http://localhost:1420/', '__bootProbe', '30'],
  { encoding: 'utf8' }
);
const j = JSON.parse(out);
const pick = (arr, lo, hi) => arr.filter(([t]) => t >= lo && t <= hi).map(([t, v]) => `${t}:${v}`).join(' ');

console.log('事件：', j.事件.map(([n, t]) => `${n}@${t}ms`).join('  →  '));
console.log('\n幕布 opacity  1600~2900ms：');
console.log('  ' + pick(j.幕布opacity, 1600, 2950));
console.log('\n主界面 opacity 1600~2900ms：');
console.log('  ' + pick(j.主界面opacity, 1600, 2950));
console.log('\n主界面 opacity 头 700ms：', pick(j.主界面opacity, 0, 700));
