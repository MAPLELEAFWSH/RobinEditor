/**
 * 探针（全包）：找出"真实取值域不止两档、界面却给不出多档"的参数。
 *
 * 用户反馈原话："ray 渲染部分材质选项除了开还可以选择 1\3 等开的方式"。
 * 判定方式（不猜）：
 *   ① 把整个渲染包里所有 .fx / .fxsub / .conf 扫一遍，按**参数名**收集出现过的取值；
 *   ② 对每个名字跑 `explain()` 拿我们自己的说明表；
 *   ③ 列出"实际取值 ≥3 种、而说明表给的档位 ≤2 或干脆没说明"的名字 ——
 *      这些就是界面上只能开关、或者只能干打数字的地方。
 *
 * 只读。用法：node --import ./tmp/register-loader.mjs tmp/ray-domain-probe.mjs [根目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseRayText } from '../src/lib/modules/ray/ops.ts';
import { explain } from '../src/lib/modules/ray/docs.ts';

const 根 = process.argv[2] ?? 'D:\\9.26mmd\\ray-mmd-1.5.2';
const 扩展 = new Set(['.fx', '.fxsub', '.conf']);

const 取值 = new Map(); // 名字 → Set(值)
const 出现 = new Map(); // 名字 → 文件数

function 走(dir) {
  let 子 = [];
  try {
    子 = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const d of 子) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) 走(p);
    else if (扩展.has(path.extname(d.name).toLowerCase())) 看(p);
  }
}

function 看(路) {
  let text = '';
  try {
    text = fs.readFileSync(路, 'latin1');
  } catch {
    return;
  }
  const p = parseRayText(text, 路);
  for (const e of p.entries) {
    if (e.kind !== 'define' && e.kind !== 'const') continue;
    const v = e.value.trim();
    if (!/^-?\d+(\.\d+)?$/.test(v)) continue;
    if (!取值.has(e.name)) {
      取值.set(e.name, new Set());
      出现.set(e.name, 0);
    }
    取值.get(e.name).add(v);
    出现.set(e.name, 出现.get(e.name) + 1);
  }
}

console.log(`扫：${根}`);
走(根);
console.log(`参数名 ${取值.size} 个\n`);

const 表 = [];
for (const [名, 集] of 取值) {
  if (集.size < 3) continue;
  const doc = explain(名, 'material') ?? explain(名, 'fxsub') ?? explain(名, '');
  const 档 = doc?.options?.length ?? 0;
  if (档 >= 集.size) continue; // 说明表已经覆盖了实际档位，不用管
  const 值序 = [...集].map(Number).sort((a, b) => a - b);
  表.push({ 名, 档位: 集.size, 值: 值序.slice(0, 12).join(','), 说明档: 档, 有说明: !!doc, 次数: 出现.get(名) });
}
表.sort((a, b) => b.次数 - a.次数);

console.log(`实际 ≥3 档、但说明表给不出这么多档的：${表.length} 个`);
console.log('次数  档数  参数名                          实际取值              说明档数');
for (const r of 表.slice(0, 45)) {
  console.log(
    `${String(r.次数).padStart(4)}  ${String(r.档位).padStart(3)}  ${r.名.padEnd(30)} ${r.值.padEnd(20)} ${r.有说明 ? r.说明档 : '无'}`
  );
}
