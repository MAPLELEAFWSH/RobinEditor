/**
 * 一次会话里注入一段脚本，再依次导航一串 URL，中间不停会话。
 *
 * 为什么不能拿 `tools/cdp-init.mjs` 连着跑几次：
 * `Page.addScriptToEvaluateOnNewDocument` 是**会话级**的，会话一断注入就没了；
 * 而"进一个页面点一遍、再进下一个页面"这种事需要注入在每次导航后都还在。
 *
 * 用法：
 *   node tools/cdp-tour.mjs <注入脚本.js> <url1> [url2 ...]
 *
 * 注入脚本里把结果挂到 window 上（例如 window.__tour），跑完用
 * `node tmp/cdp.mjs <读结果.js>` 取 —— 取的时候会话是新的，但页面还在，
 * 挂在 window 上的东西还在。
 */
import fs from 'node:fs';

const PORT = process.env.CDP_PORT ?? '9222';
const [initFile, ...urls] = process.argv.slice(2);
if (!initFile || !urls.length) {
  console.error('用法：node tools/cdp-tour.mjs <注入脚本.js> <url1> [url2 ...]');
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
/* 会话期间每开一个新文档都注一次，所以导航多少次都在 */
await send('Page.addScriptToEvaluateOnNewDocument', { source });

for (const url of urls) {
  await send('Page.navigate', { url });
  /* 给页面起来 + 注入的采集器干活留时间 */
  await new Promise((r) => setTimeout(r, 9000));
  console.log('走过 → ' + url);
}

ws.close();
console.log('会话结束（注入到此为止；结果还挂在页面的 window 上）');
