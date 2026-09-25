/**
 * 全库扫：带键 `{#each … (键)}` 的**键会不会撞**。
 *
 * 为什么专门扫这个：这一轮在 ① 上量到两处键重复（`(r.rel)` 拿文件名当键、
 * `(h.path + s.run)` 同一个乱码名字出现两次），现象是 Svelte 抛 `each_key_duplicate`
 * → **整块渲染被抛掉**，用户看到的是"跑完 0 条 / 点了没反应"，而盘上其实是对的。
 * 极难查，所以全库过一遍。
 *
 * 分三档：
 *   ⛔ 危险  —— 键里有 `+` 拼接，或者用了**天然会重**的字段（name/rel/label/text/cn/jp/run/title）
 *   ⚠️ 看着稳 —— 键是 id 类字段（id/key/path/uuid/文件名带目录的完整路径）
 *   ✅ 不会撞 —— 键是下标 / 常量 / 数学上唯一的东西
 *
 * 用法：node tmp\扫-带键each.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const 根 = 'E:\\deepseek-harness\\RobinEditor\\src';

async function 走(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await 走(p, out);
    else if (e.name.endsWith('.svelte')) out.push(p);
  }
  return out;
}

/** 险字段：这些在真实数据里**天然会重复** */
const 险字段 = /(?:\b|\.)(name|rel|label|text|cn|jp|run|title|原因|说明|名)\b/;

const 危险 = [];
const 看着稳 = [];
const 安全 = [];

for (const f of await 走(根)) {
  const s = await readFile(f, 'utf8');
  const 短 = relative('E:\\deepseek-harness\\RobinEditor', f);
  const 行s = s.split('\n');
  行s.forEach((行, i) => {
    const m = 行.match(/\{#each\s+(.+?)\s+as\s+(.+?)\s*\((.+?)\)\s*\}/);
    if (!m) return;
    const 键 = m[3].trim();
    const 条 = { 文件: 短, 行: i + 1, 集合: m[1].trim(), 键, 原文: 行.trim().slice(0, 100) };
    if (/^[a-z]$|^i$|^\d+$/.test(键) || /^(ch|k|g|m|o|p|s|t|e|n)$/i.test(键)) 安全.push(条);
    else if (键.includes('+')) 危险.push({ ...条, 为什么: '拼接的键' });
    else if (险字段.test(键)) 危险.push({ ...条, 为什么: `用了天然会重的字段：${键}` });
    else 看着稳.push(条);
  });
}

const 打印 = (名, 列, 带为什么 = false) => {
  console.log(`\n==== ${名}（${列.length}）====`);
  for (const x of 列) {
    console.log(`  ${x.文件}:${x.行}  键=${JSON.stringify(x.键)}${带为什么 ? '  ← ' + x.为什么 : ''}`);
    console.log(`      ${x.原文}`);
  }
};

console.log('扫带键 {#each}：危险 ' + 危险.length + ' / 看着稳 ' + 看着稳.length + ' / 安全 ' + 安全.length);
打印('⛔ 危险（键会撞）', 危险, true);
打印('⚠️ 看着稳（键是 id 类字段，仍可自己核一眼）', 看着稳);
console.log(`\n==== ✅ 不会撞（下标/常量），列文件数 ====`);
const 按文件 = {};
for (const x of 安全) 按文件[x.文件] = (按文件[x.文件] ?? 0) + 1;
for (const [k, v] of Object.entries(按文件).sort()) console.log(`  ${k}  ${v} 处`);
