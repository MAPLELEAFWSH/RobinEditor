/**
 * 一次性迁移：把动效 token 换成四份参考（Mizuki / witchcat / lin-xin / RyuChan）的口径。
 *
 * 起因：之前按 notitle PV 推了一套 180/420ms + cubic-bezier(.16,1,.3,1)，
 * 还自己加了三个过冲曲线（back / pop / spring）。但四份参考里**没有任何过冲**：
 *   · Mizuki  全站只用 cubic-bezier(0.4,0,0.2,1)，离场换 cubic-bezier(0.4,0,0.6,1)
 *   · witchcat / lin-xin / RyuChan 都是 Tailwind 默认的 (0.4,0,0.2,1)
 * 它们的"力量感"来自按下缩放（scale 0.9 / 0.95）和短时长，不是过冲缓动。
 * 所以这里把过冲曲线全部并回标准曲线。
 *
 * 用法：node tools/migrate-motion.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const REPL = [
  // 先长后短，避免 --ease-in 吃掉 --ease-inout 的前缀
  ['var(--ease-inout)', 'var(--ease-slow)'],
  ['var(--ease-out)', 'var(--ease-std)'],
  ['var(--ease-in)', 'var(--ease-exit)'],
  ['var(--ease-back)', 'var(--ease-std)'],
  ['var(--ease-pop)', 'var(--ease-std)'],
  ['var(--ease-spring)', 'var(--ease-std)']
];

function walk(d, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.svelte-kit', '.git', 'build', 'dist'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    e.isDirectory() ? walk(p, acc) : acc.push(p);
  }
  return acc;
}

const files = walk('src').filter((f) => /\.(svelte|css|ts)$/.test(f));
let total = 0;
const per = [];

for (const f of files) {
  let t = fs.readFileSync(f, 'utf8');
  const before = t;
  let n = 0;
  for (const [a, b] of REPL) {
    const c = t.split(a).length - 1;
    if (c) {
      t = t.split(a).join(b);
      n += c;
    }
  }
  if (t !== before) {
    fs.writeFileSync(f, t, 'utf8');
    per.push(`${String(n).padStart(3)}  ${path.relative('.', f)}`);
    total += n;
  }
}

console.log(per.join('\n'));
console.log(`\n共替换 ${total} 处，涉及 ${per.length} 个文件`);
