/**
 * 注入一段 init script，然后导航 —— 用来给"页面一加载就开始"的过程打点。
 *
 * `tools/cdp-nav.mjs` 只能导航，装不了"文档创建时就要跑"的脚本；
 * 而开屏、首帧这类东西，等页面起来再注入就已经晚了。
 * 这个走 CDP 的 Page.addScriptToEvaluateOnNewDocument。
 *
 * 前提：dev 带了远程调试端口（见 docs/工作交接.md 第 1 节）。
 *
 * 用法：
 *   node tools/cdp-init.mjs <init.js 文件> "<要导航到的 URL>"
 *
 * init 脚本里把结果挂到 window.__probe（Object 或 Array 都行），
 * 之后用 `node tmp/cdp.mjs <读结果.js>` 取出来。
 */
import fs from 'node:fs';

const PORT = process.env.CDP_PORT ?? '9222';
const [initFile, url] = process.argv.slice(2);
if (!initFile || !url) {
  console.error('用法：node tools/cdp-init.mjs <init.js> "<url>"');
  process.exit(1);
}
const source = fs.readFileSync(initFile, 'utf8');

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.error(`没有可连的 page 目标。确认带了 --remote-debugging-port=${PORT}`);
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', reject);
});

let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) => {
  const myId = ++id;
  return new Promise((resolve) => {
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
};

await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source });
await send('Page.navigate', { url });

/* 等打点跑一遍。开屏那条链总共 ~2s，留 4s 余量 */
await new Promise((r) => setTimeout(r, 4000));
ws.close();
console.log('已注入并导航 → ' + url);
