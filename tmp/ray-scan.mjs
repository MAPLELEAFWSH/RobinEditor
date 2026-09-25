/**
 * 拿真包扫一遍，看分类器在真实语料上的分布。
 *
 * 目的有两个：
 *   · 确认取色器 / 贴图导入这两个控件在真文件里真的用得上（不是写了个没东西用的分支）
 *   · 看有没有分类明显不对的情况，比如把表达式当成了颜色
 *
 * 用法：node --import ./tmp/register-loader.mjs tmp/ray-scan.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

import { parseRayText } from '../src/lib/modules/ray/ops.ts';
import { classify } from '../src/lib/modules/ray/value.ts';
import { explain, sectionOf, coverage } from '../src/lib/modules/ray/docs.ts';

const ROOT = process.argv[2] ?? 'D:/9.26mmd/ray-mmd-1.5.2';
const utf8 = (b) => new TextDecoder('utf-8').decode(b);
const sjis = (b) => new TextDecoder('shift_jis').decode(b);

function decode(buf) {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), enc: 'utf-8' };
  } catch {
    return { text: sjis(buf), enc: 'shift-jis' };
  }
}

function walk(dir, exts, limit, out = []) {
  if (out.length >= limit) return out;
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    if (out.length >= limit) break;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, limit, out);
    else if (exts.some((x) => e.name.toLowerCase().endsWith(x))) out.push(p);
  }
  return out;
}

const files = walk(ROOT, ['.fx', '.fxsub', '.conf'], 700);
console.log(`扫 ${ROOT}`);
console.log(`命中 ${files.length} 个文件\n`);

const kinds = {};
const encs = {};
const flavors = {};
const colorSamples = [];
const textureSamples = [];
const exprSamples = [];
const missByFlavor = {};
let total = 0;

for (const f of files) {
  const buf = fs.readFileSync(f);
  const { text, enc } = decode(buf);
  encs[enc] = (encs[enc] ?? 0) + 1;
  const parsed = parseRayText(text, f);
  flavors[parsed.flavor] = (flavors[parsed.flavor] ?? 0) + 1;

  for (const e of parsed.entries) {
    total++;
    const doc = explain(e.name, parsed.flavor);
    const field = classify(e, doc);
    kinds[field.kind] = (kinds[field.kind] ?? 0) + 1;
    if (!doc) {
      const k = `${parsed.flavor}`;
      missByFlavor[k] = missByFlavor[k] ?? new Set();
      if (missByFlavor[k].size < 40) missByFlavor[k].add(e.name);
    }
    if (field.kind === 'color' && colorSamples.length < 6) {
      colorSamples.push({ f: path.basename(f), name: e.name, value: e.value, type: e.type });
    }
    if (field.kind === 'texture' && textureSamples.length < 6) {
      textureSamples.push({ f: path.basename(f), name: e.name, value: e.value });
    }
    if (field.kind === 'expr' && exprSamples.length < 6) {
      exprSamples.push({ f: path.basename(f), name: e.name, value: e.value, why: field.why });
    }
    void sectionOf(e.name, parsed.flavor);
  }
}

console.log('解析出的可改项／声明总数：', total);
console.log('\n控件分布：');
for (const [k, v] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(9)} ${String(v).padStart(6)}  ${((v / total) * 100).toFixed(1)}%`);
}
console.log('\n文件编码：', encs);
console.log('文件类型：', flavors);

console.log('\n颜色样本（取色器用得上这些）：');
for (const s of colorSamples) console.log(`  ${s.f}  ${s.name} = ${s.value}   [${s.type}]`);
console.log('\n贴图样本（"选贴图"用得上这些）：');
for (const s of textureSamples) console.log(`  ${s.f}  ${s.name} = ${s.value}`);
console.log('\n表达式样本（只读，说明为什么）：');
for (const s of exprSamples) console.log(`  ${s.f}  ${s.name} = ${String(s.value).slice(0, 44)}`);

console.log('\n没说明的参数（每类前 40 个）：');
for (const [fl, set] of Object.entries(missByFlavor)) {
  console.log(`  [${fl}] ${set.size} 个：${[...set].slice(0, 20).join('、')}`);
}

// 说明表的总覆盖
for (const fl of ['ray-conf', 'ray-advanced', 'material', 'fxsub', 'unknown']) {
  const names = [];
  for (const f of files) {
    const { text } = decode(fs.readFileSync(f));
    const p = parseRayText(text, f);
    if (p.flavor !== fl) continue;
    for (const e of p.entries) {
      if (e.kind === 'define' || e.kind === 'const') names.push(e.name);
    }
  }
  if (!names.length) continue;
  const c = coverage(fl, names);
  console.log(`\n[${fl}] 说明覆盖 ${c.hit} / ${c.total} = ${((c.hit / c.total) * 100).toFixed(0)}%`);
}
