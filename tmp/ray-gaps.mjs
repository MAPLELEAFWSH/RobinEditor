import fs from 'node:fs';
import path from 'node:path';
import { parseRayText } from '../src/lib/modules/ray/ops.ts';
import { explain } from '../src/lib/modules/ray/docs.ts';

const ROOT = 'D:/9.26mmd/ray-mmd-1.5.2';
const sjis = (b) => new TextDecoder('shift_jis').decode(b);
function decode(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return sjis(buf); }
}
function walk(dir, out = []) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(fx|fxsub|conf)$/i.test(e.name)) out.push(p);
  }
  return out;
}
const freq = new Map();
for (const f of walk(ROOT)) {
  const parsed = parseRayText(decode(fs.readFileSync(f)), f);
  for (const e of parsed.entries) {
    if (e.kind !== 'define' && e.kind !== 'const') continue;
    if (explain(e.name, parsed.flavor)) continue;
    freq.set(e.name, (freq.get(e.name) ?? 0) + 1);
  }
}
const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60);
console.log(`没说明的不同参数名 ${freq.size} 个，总出现 ${[...freq.values()].reduce((a,b)=>a+b,0)} 次`);
console.log('出现次数最多的 60 个：');
for (const [n, c] of top) console.log(`  ${String(c).padStart(4)}  ${n}`);
