// 从参考项目里抽出设计变量与主题定义。
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
const showDefs = process.argv[3] === 'defs';

function walk(d, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.git', 'build', 'dist'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    e.isDirectory() ? walk(p, acc) : acc.push(p);
  }
  return acc;
}

const files = walk(root).filter((f) => /\.(css|js|html)$/.test(f));

// 只抓"--名字:"后面到分号/换行的**定义**，且值里不能再有 var(
const defRe = /--([a-zA-Z0-9-]+)\s*:\s*([^;\n]{1,120})/g;

for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  const defs = new Map();
  let m;
  while ((m = defRe.exec(txt))) {
    const name = m[1];
    const val = m[2].trim();
    if (!defs.has(name)) defs.set(name, val);
  }
  if (defs.size === 0) continue;
  const rel = path.relative(root, f);
  if (showDefs) {
    console.log(`\n===== ${rel}  (${defs.size} 个变量首定义) =====`);
    for (const [k, v] of defs) console.log(`  --${k}: ${v}`);
  } else {
    console.log(`${rel}: ${defs.size}`);
  }
}

// 顺便找主题色板（七个元素）
const palRe = /(hue|element|theme)[^\n]{0,140}/gi;
const jsFiles = files.filter((f) => f.endsWith('.js'));
for (const f of jsFiles) {
  const txt = fs.readFileSync(f, 'utf8');
  const hits = [...txt.matchAll(palRe)].filter((h) => /\d{2,3}/.test(h[0])).slice(0, 6);
  if (hits.length) {
    console.log(`\n--- ${path.relative(root, f)} 里和主题色板有关的片段 ---`);
    for (const h of hits) console.log('  ' + h[0].replace(/\s+/g, ' ').slice(0, 150));
  }
}
