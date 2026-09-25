/**
 * 全库扫「effect 读自己写的那份 state」—— 就是 `effect_update_depth_exceeded` 的真因那一类。
 *
 * 为什么要扫：② ikClut 和 ⑦ 通道提取都栽在同一个坑上（用户报的"卡死"）。
 * 手工读代码看不住 —— Svelte 5 里这种写法**长得完全正常**：
 *   `verdict = analyzeAlpha(img); ... verdict.rich ? ... : ...`
 * 写一下、下一行又读回来，于是这个 effect 就依赖了自己的产物，
 * 而每次都返回**新对象**，身份一直在变 → 无限重跑 → 抛错 → 界面点不动。
 *
 * 认法：拿 Vite 编译后的模块（**编译产物里读写都带标记**，比读源码靠得住）：
 *   `$.set(X, ...)` 是这个 effect 写的，`$.get(X)` 是它读的。
 * 一个 `$.user_effect(...)` 块里 X 同时出现在两边 → 命中。
 * （模板里读同一份 state 不算 —— 那不在 effect 块里。）
 *
 * 用法（先 pnpm dev 起在 1420）：
 *   node tmp\sweep-自读自写.mjs [根目录]
 */
import fs from 'node:fs';
import path from 'node:path';

const 根 = process.argv[2] ?? 'src';
const app = 'http://127.0.0.1:1420';

function 找文件(dir, 出 = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) 找文件(p, 出);
    else if (e.name.endsWith('.svelte')) 出.push(p);
  }
  return 出;
}

/** 从 i（指向 '('）开始，配平括号，返回里面的整段 */
function 配对(src, i) {
  let 深 = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '(') 深++;
    else if (c === ')') {
      深--;
      if (深 === 0) return { 体: src.slice(i + 1, j), 到: j };
    }
  }
  return null;
}

/** 跳过字符串/注释/正则，避免把 `'$.set('` 当成代码 */
function 去噪(t) {
  let 出 = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '/' && t[i + 1] === '/') { while (i < t.length && t[i] !== '\n') i++; 出 += '\n'; continue; }
    if (c === '/' && t[i + 1] === '*') { i += 2; while (i < t.length && !(t[i] === '*' && t[i + 1] === '/')) i++; i++; 出 += ' '; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < t.length && t[i] !== q) { if (t[i] === '\\') i++; i++; }
      continue;
    }
    出 += c;
  }
  return 出;
}

const 文件 = 找文件(根).sort();
const 命中 = [];
const 扫不动 = [];
let effect块数 = 0;

for (const f of 文件) {
  const url = `${app}/${f.split(path.sep).join('/')}`;
  let src;
  try {
    const r = await fetch(url);
    if (!r.ok) { 扫不动.push(`${f} → HTTP ${r.status}`); continue; }
    src = await r.text();
  } catch (e) {
    扫不动.push(`${f} → ${e.message}`);
    continue;
  }
  const 净 = 去噪(src);
  const 行号 = (位) => 净.slice(0, 位).split('\n').length;

  let i = 0;
  while ((i = 净.indexOf('$.user_effect(', i)) !== -1) {
    const p = 配对(净, i + '$.user_effect'.length);
    if (!p) break;
    effect块数++;
    const 写的 = new Map();
    const 读的 = new Set();
    for (const m of p.体.matchAll(/\$\.set\(\s*([A-Za-z_$][\w$]*)\s*,/g)) {
      if (!写的.has(m[1])) 写的.set(m[1], 行号(i + m.index));
    }
    for (const m of p.体.matchAll(/\$\.get\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) 读的.add(m[1]);
    for (const [名, 行] of 写的) {
      if (读的.has(名)) 命中.push({ 文件: f, 变量: 名, 编译产物行: 行 });
    }
    i = p.到;
  }
}

console.log(`扫了 ${文件.length} 个 .svelte，${effect块数} 个 effect 块`);
console.log(`\n==== 命中：effect 读自己写的那份 state ====`);
if (!命中.length) console.log('（没有）');
for (const h of 命中) console.log(`  ${h.文件}  变量 ${h.变量}（编译产物第 ${h.编译产物行} 行的赋值）`);
if (扫不动.length) {
  console.log(`\n==== 没扫成的 ====`);
  for (const s of 扫不动) console.log('  ' + s);
}
