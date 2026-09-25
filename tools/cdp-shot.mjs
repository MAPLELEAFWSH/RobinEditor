/**
 * 抓一张真机截图 —— 动效这种东西光看数字不够，得看一眼。
 *
 * 用法：node tools/cdp-shot.mjs <输出.png> [等多久毫秒] [URL]
 *   等多久：给导航之后留的时间，用来抓"开场动画某一刻"（比如 800ms 时的幕布）
 *   URL 不给就用当前页
 */
import { writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT ?? '9222';
const [out = 'tmp/shot.png', waitMs = '0', url] = process.argv.slice(2);

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
if (!page) {
  console.error(`没有可连的 page。确认带了 --remote-debugging-port=${PORT}`);
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res);
  ws.addEventListener('error', rej);
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
if (url) await send('Page.navigate', { url });
if (Number(waitMs) > 0) await new Promise((r) => setTimeout(r, Number(waitMs)));
const shot = await send('Page.captureScreenshot', { format: 'png' });
const data = shot?.result?.data;
ws.close();
if (!data) {
  console.error('截图失败：', JSON.stringify(shot).slice(0, 200));
  process.exit(1);
}
writeFileSync(out, Buffer.from(data, 'base64'));
console.log(`写到 ${out}`);
