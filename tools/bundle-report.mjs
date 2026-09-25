/**
 * 打包体积报表。给"低配能不能跑得动"这件事一个可重复的尺子。
 *
 * 用法：node tools/bundle-report.mjs [目录]      默认 build
 *      改之前先 `Copy-Item build tmp\build-A -Recurse` 留一份，
 *      改完再 `node tools/bundle-report.mjs tmp\build-A` 比一比前后
 *
 * 看三件事：
 *   1. 首屏那条链路上有多少 JS（entry + 它直接 import 的 chunks）
 *   2. 哪个 chunk 最大、里面装着谁的东西（按各模块独有的字符串认）
 *   3. JS / CSS 总量
 *
 * 为什么按字符串认：chunk 名字是哈希，没意义；模块里的中文界面文案
 * 是它自己独有的，出现在哪个 chunk 里就说明那个模块的代码在那个 chunk 里。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const dir = process.argv[2] ?? 'build';
const app = join(dir, '_app', 'immutable');

/** 每个模块独有的字样（挑的是它界面上的长句，压缩改不掉、注册表里也没有） */
const PROBE = {
  '①乱码': '编码转换要在桌面端跑',
  '②调色': '上段 32 级灰阶',
  '③Ray': '真正决定',
  '④msToon': '每张贴图不一样',
  '⑤ILM': '法线贴图半分辨率是常态',
  '⑤SDF': '真图里那张 SDF',
  '⑥养乐多': 'PMX 是二进制格式',
  '⑦通道': '拆之前先看一眼四路分布',
  '⑦提取': '是全库里最值得提的一路',
  '⑦批量': '这里做的是 Blender',
  工作区: '另外还有四个不走功能页的'
};

function walk(d, out = []) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(app);
const js = files.filter((f) => f.endsWith('.js'));
const css = files.filter((f) => f.endsWith('.css'));
const kb = (n) => (n / 1024).toFixed(1).padStart(8);

const total = (list) => list.reduce((s, f) => s + statSync(f).size, 0);

console.log(`目录：${dir}`);
console.log(`JS  ${kb(total(js))} KB / ${js.length} 个`);
console.log(`CSS ${kb(total(css))} KB / ${css.length} 个`);

/* 入口是谁：index.html 里引的 */
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const entry = [...html.matchAll(/(?:src|href)="\/_app\/immutable\/([^"]+)"/g)].map((m) => m[1]);
console.log(`\n首屏直接引的：${entry.join('  ') || '(没找到)'}`);

/* 入口那条链：从入口文件出发，顺着 import 追 */
const byName = new Map(js.map((f) => [relative(app, f).replace(/\\/g, '/'), f]));
const seen = new Set();
const queue = entry.map((e) => e.replace(/^_app\/immutable\//, ''));
while (queue.length) {
  const name = queue.shift();
  if (seen.has(name) || !byName.has(name)) continue;
  seen.add(name);
  const src = readFileSync(byName.get(name), 'utf8');
  for (const m of src.matchAll(/from\s*"\.\/([^"]+\.js)"/g)) {
    const dep = name.replace(/[^/]+$/, '') + m[1];
    if (!seen.has(dep)) queue.push(dep);
  }
}
let chainBytes = 0;
for (const n of seen) chainBytes += statSync(byName.get(n)).size;
console.log(`入口那条链上的 JS：${kb(chainBytes)} KB / ${seen.size} 个 chunk`);

/* 每个模块的代码落在哪 */
console.log('\n各模块代码在哪个 chunk：');
const texts = new Map(js.map((f) => [relative(app, f).replace(/\\/g, '/'), readFileSync(f, 'utf8')]));
const bigs = js
  .map((f) => ({ n: relative(app, f).replace(/\\/g, '/'), size: statSync(f).size }))
  .sort((a, b) => b.size - a.size);
console.log(`  最大的 6 个 chunk：`);
for (const b of bigs.slice(0, 6)) {
  const who = Object.entries(PROBE)
    .filter(([, s]) => texts.get(b.n).includes(s))
    .map(([k]) => k);
  console.log(`  ${kb(b.size)} KB  ${b.n}  ← ${who.join(' ') || '(公共代码)'}`);
}
const inChain = Object.entries(PROBE).filter(([, s]) =>
  [...seen].some((n) => texts.get(n)?.includes(s))
);
console.log(`\n首屏链上出现的模块：${inChain.map(([k]) => k).join(' ') || '(无)'}`);
console.log(`首屏链上总共 ${inChain.length} 个模块`);

/* 按需拉的 chunk 得真的在盘上 —— 少一个就是"点进去白屏"。
   注意压缩器有时用反引号包（`import(\`./X.js\`)`），只认引号会漏。 */
const missing = [];
let dyn = 0;
for (const [name, text] of texts) {
  for (const m of text.matchAll(/import\(\s*["'`]([^"'`]+\.js)["'`]\s*\)/g)) {
    dyn++;
    const target = new URL(m[1], 'file:///' + name).pathname.replace(/^\//, '');
    if (!byName.has(target)) missing.push(`${name} → ${m[1]}`);
  }
}
console.log(`\n按需 import 的 chunk：${dyn} 处引用，${missing.length} 处找不到文件`);
for (const m of missing.slice(0, 5)) console.log(`  ${m}`);
if (missing.length) process.exitCode = 1;
