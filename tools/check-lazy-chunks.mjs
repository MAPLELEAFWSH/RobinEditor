/**
 * 按需加载的 chunk 真能不能取到。
 *
 * 为什么需要这个：分区组件改成按需 `import()` 之后，"点进去白屏" 的唯一现实原因
 * 就是那些 chunk 没跟着发布出去、或者路径拼错了（打包器可能用引号、也可能用反引号）。
 * 光看打包报表只能知道"引用了几处"，这个才是**按 URL 取一遍**。
 *
 * 做法：起一个只读 build\ 的本地 http 服务（不联网、不开窗口），
 * 把每个被引用的 chunk 按浏览器会用的那个 URL 取一次，看状态码和字节数。
 *
 * 用法：node tools/check-lazy-chunks.mjs [目录]     默认 build
 */
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const root = process.argv[2] ?? 'build';
if (!existsSync(join(root, '_app'))) {
  console.error(`没找到 ${root}\\_app，先 pnpm build`);
  process.exit(1);
}

const TYPES = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json'
};

const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = join(root, path === '/' ? 'index.html' : path);
  if (!existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

/** 收集所有被 import() 引用的 chunk（相对各自所在目录） */
function walk(d, out = []) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

const targets = new Set();
for (const f of walk(join(root, '_app', 'immutable'))) {
  const rel = relative(join(root, '_app', 'immutable'), f).replace(/\\/g, '/');
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/import\(\s*["'`]([^"'`]+\.js)["'`]\s*\)/g)) {
    const dir = rel.replace(/[^/]+$/, '');
    /* 相对路径按"引用它的那个文件所在的目录"解，跟浏览器一致 */
    const parts = (dir + m[1]).split('/');
    const stack = [];
    for (const p of parts) {
      if (p === '.' || p === '') continue;
      else if (p === '..') stack.pop();
      else stack.push(p);
    }
    targets.add('/_app/immutable/' + stack.join('/'));
  }
}

const list = [...targets].sort();
let bad = 0;
for (const url of list) {
  const r = await fetch(base + url);
  const len = r.ok ? (await r.arrayBuffer()).byteLength : 0;
  if (!r.ok || len === 0) {
    bad++;
    console.log(`  取不到：${url}  → HTTP ${r.status}${len === 0 ? '（空文件）' : ''}`);
  }
}
console.log(`按需 chunk：${list.length} 个 URL，${bad} 个取不到`);
/* 等服务真的关掉再走：直接 process.exit() 会在 Windows 上撞 libuv 的
   "UV_HANDLE_CLOSING" 断言，明明跑对了却以非零退出，变成假红 */
await new Promise((r) => server.close(r));
process.exitCode = bad ? 1 : 0;
