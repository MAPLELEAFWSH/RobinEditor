/**
 * 量具：真实的养乐多 fx 模板里，参数都是些什么类型、值都落在什么范围。
 *
 * 为什么先量：要给「参数」加滑条，就得知道滑条的**范围该按什么推**。
 * ③ Ray 那套规矩是"说明里给了就用给的，没给就按**原值**推一个量级"——
 * 但养乐多的 fx 没有范围表，所以全走"按原值推"。这里就是去看真实模板里
 * `int` 到底是不是槽位下标（0..7）、`float` 是不是 0~1 的权重，
 * 免得推出来的滑条够不着真值。
 *
 * 用法：node --import ./tmp/register-loader.mjs tmp\量-养乐多参数.mjs [目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseFx, componentCount } from '../src/lib/modules/yaku/ops.ts';

const 目录 = process.argv[2] ?? 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例\\渲染联动\\养乐多';

function 找(dir, 出 = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) 找(p, 出);
    else if (e.name.toLowerCase().endsWith('.fx')) 出.push(p);
  }
  return 出;
}

const 文件 = 找(目录);
const 按类型 = new Map();
const 数值表 = [];   // {类型, 名, 值}
let 参数总数 = 0;

for (const f of 文件) {
  const text = fs.readFileSync(f, 'latin1'); // fx 多为 Shift-JIS/GBK，这里只认结构，编码不影响数字
  let parsed;
  try {
    parsed = parseFx(text);
  } catch (e) {
    console.log(`跳过（解析不了）：${path.basename(f)} → ${e.message}`);
    continue;
  }
  for (const p of parsed.params) {
    参数总数++;
    按类型.set(p.kind, (按类型.get(p.kind) ?? 0) + 1);
    if (p.kind === 'int' || p.kind === 'float' || p.kind.startsWith('vec')) {
      for (const v of p.value.split(',').map((x) => Number(x.trim()))) {
        if (Number.isFinite(v)) 数值表.push({ kind: p.kind, name: p.name, v, slot: p.slot });
      }
    }
  }
}

console.log(`扫了 ${文件.length} 个真 fx，参数 ${参数总数} 条\n`);
console.log('按类型：');
for (const [k, n] of [...按类型.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(8)} ${String(n).padStart(4)}  ${componentCount(k) > 1 ? `（${componentCount(k)} 个分量）` : ''}`);
}

const 分 = (k) => 数值表.filter((x) => x.kind === k || (k === 'vec' && x.kind.startsWith('vec')));
function 概况(名, 列) {
  if (!列.length) return console.log(`\n${名}：没有`);
  const vs = 列.map((x) => x.v).sort((a, b) => a - b);
  const 非零 = vs.filter((v) => v !== 0);
  console.log(
    `\n${名}：${列.length} 个值\n` +
      `  取值区间 ${vs[0]} ~ ${vs[vs.length - 1]}\n` +
      `  绝对值最大的 ${Math.max(...vs.map(Math.abs))}\n` +
      `  非零的 ${非零.length} 个，区间 ${非零.length ? `${非零[0]} ~ ${非零[非零.length - 1]}` : '—'}\n` +
      `  出现最多的值：${[...new Map(vs.map((v) => [v, vs.filter((x) => x === v).length])).entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([v, n]) => `${v}×${n}`).join('、')}`
  );
}
概况('int', 分('int'));
概况('float', 分('float'));
概况('vec2/3/4 的分量', 分('vec'));

console.log('\nint 那几个到底是什么（看名字与槽位）：');
const 名表 = new Map();
for (const x of 分('int')) 名表.set(x.name, x);
for (const [n, x] of [...名表.entries()].slice(0, 20)) console.log(`  ${n} = ${x.v}${x.slot !== undefined ? `（槽位 ${x.slot}）` : ''}`);
