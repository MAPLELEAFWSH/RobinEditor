/**
 * 探针：Ray 的材质文件里，每一项会被渲染成什么控件。
 *
 * 用途（对着用户反馈"材质的开法除了开还可以选 1\3"）：
 *   把真材质文件解析出来 → 逐条跑 `classify`（界面就是靠它决定控件）→
 *   列出"值是 0/1 但真实取值域不止两档"和"值 >1 却给了开关/纯数字"的项。
 *
 * 只读真文件，不写任何东西。用法：
 *   node --import ./tmp/register-loader.mjs tmp/ray-material-probe.mjs
 */
import fs from 'node:fs';
import { parseRayText } from '../src/lib/modules/ray/ops.ts';
import { classify } from '../src/lib/modules/ray/value.ts';
import { explain } from '../src/lib/modules/ray/docs.ts';

const 文件 = [
  ['material', 'D:\\9.26mmd\\mme\\RAY\\material_2.0.fx'],
  ['fxsub', 'D:\\9.26mmd\\mme\\RAY\\material_common_2.0.fxsub']
];

for (const [flavor, 路] of 文件) {
  if (!fs.existsSync(路)) {
    console.log(`（没有 ${路}，跳过）`);
    continue;
  }
  const text = fs.readFileSync(路, 'latin1');
  const p = parseRayText(text, 路);
  console.log(`\n=== ${路} —— flavor=${p.flavor}，${p.entries.length} 项`);
  const 计数 = {};
  const 可疑 = [];
  for (const e of p.entries) {
    const doc = explain(e.name, p.flavor ?? '');
    const f = classify(e, doc);
    计数[f.kind] = (计数[f.kind] ?? 0) + 1;
    const 档 = doc?.options?.length ?? 0;
    /* 可疑：文档给了 3 档以上，界面却只给开关；或者值是 0/1 但文档说有别的档 */
    if ((f.kind === 'switch' && 档 > 2) || (f.kind === 'switch' && e.value.trim() === '1' && 档 === 0 && /_MODE|_TYPE|_FROM|SHADING|_ENABLE/.test(e.name))) {
      可疑.push(`${e.name} = ${e.value} → 开关（文档 ${档} 档）`);
    }
  }
  console.log('控件分布：', JSON.stringify(计数));
  if (可疑.length) {
    console.log(`可疑（本该能选多档却只有开关）：${可疑.length} 条`);
    for (const s of 可疑.slice(0, 25)) console.log('  ' + s);
  } else {
    console.log('没有"本该多档却只有开关"的项。');
  }

  /* 把"值 >1 的项"列出来，看它们各自拿到什么控件 */
  const 大值 = p.entries.filter((e) => /^\d+$/.test(e.value.trim()) && Number(e.value) > 1);
  console.log(`值为 >1 的整数项：${大值.length} 条`);
  for (const e of 大值.slice(0, 20)) {
    const doc = explain(e.name, p.flavor ?? '');
    const f = classify(e, doc);
    console.log(`  ${e.name} = ${e.value}  →  ${f.kind}${f.options ? `（${f.options.length} 档）` : ''}${doc ? '' : '  ← 没说明'}${f.kind === 'number' ? `${f.min !== undefined ? ` min=${f.min} max=${f.max}` : ''}` : ''}`);
  }
}
