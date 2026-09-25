/**
 * ⑤ 的**设计样本**：① 那排「原文是什么日文编码」选中态，现状 vs 改后各截一张。
 *
 * 现状：`.pick__b[aria-pressed='true'] { font-weight: 600 }` → 选中那颗文字变宽 3.16px，
 * 整排连文字一起左移 3.15px（`tmp\probe-⑤点击抽搐.mjs` 量的）。点一次跳一下，点回来再跳一下。
 * 改后：选中态**不加粗**，靠已有的底色 + 文字色，再补一条 `inset` 描边（inset 不改布局）。
 *
 * 两张图都只框那一行，方便并排看。同时把两种状态下四颗按钮的文字左边/宽度打出来，
 * 证明"改后点哪颗都不挪"。
 *
 * 用法（先 `pnpm dev` 起 1420，再无头 Chrome 开 9400）：node tmp\peek-⑤选中态样本.mjs
 */
import { writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const app = 'http://127.0.0.1:1420';

const list = await (await fetch(`${BASE}/json/list`)).json();
const t = list.find((x) => x.type === 'page' && !x.url.startsWith('devtools://'));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const rpc = (method, params = {}) =>
  new Promise((res, rej) => {
    const my = ++id;
    const 定时 = setTimeout(() => { ws.removeEventListener('message', on); rej(new Error('CDP 超时 ' + method)); }, 120000);
    const on = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== my) return;
      clearTimeout(定时);
      ws.removeEventListener('message', on);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id: my, method, params }));
  });
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Emulation.setDeviceMetricsOverride', { width: 1707, height: 1067, deviceScaleFactor: 2, mobile: false });
const 跑 = async (表达式) => {
  const r = await rpc('Runtime.evaluate', { expression: 表达式, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { 页面抛错: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  return r.result.value;
};

await rpc('Page.navigate', { url: `${app}/tools/glitch?panel=fix` });
await 等(7000);

/* 把那一行滚到视口中间，量出它的框 */
const 框 = await 跑(`(() => {
  const 排 = [...document.querySelectorAll('.pick')].find((g) => /自动认|Shift-JIS/.test(g.textContent || ''));
  if (!排) return { 错: '找不到编码那排' };
  排.scrollIntoView({ block: 'center' });
  const 行 = 排.closest('.row') ?? 排;
  const r = 行.getBoundingClientRect();
  return { x: Math.round(r.left) - 8, y: Math.round(r.top) - 8, w: Math.round(r.width) + 16, h: Math.round(r.height) + 16 };
})()`);
await 等(600);

const 读数 = () => 跑(`(() => {
  const 排 = [...document.querySelectorAll('.pick')].find((g) => /自动认|Shift-JIS/.test(g.textContent || ''));
  return [...排.querySelectorAll('.pick__b')].map((b) => {
    const r = b.getBoundingClientRect();
    const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    const 节 = w.nextNode();
    const rr = document.createRange();
    rr.selectNodeContents(节);
    const 字 = rr.getBoundingClientRect();
    return { 标签: b.textContent.trim().slice(0, 10), 选中: b.getAttribute('aria-pressed') === 'true', 字重: getComputedStyle(b).fontWeight,
      钮左边: Math.round(r.left * 100) / 100, 钮宽: Math.round(r.width * 100) / 100, 文字左边: Math.round(字.left * 100) / 100, 文字宽: Math.round(字.width * 100) / 100 };
  });
})()`);

const 拍图 = async (名) => {
  const r = await rpc('Page.captureScreenshot', { format: 'png', clip: { x: 框.x, y: 框.y, width: 框.w, height: 框.h, scale: 2 }, captureBeyondViewport: false });
  writeFileSync(名, Buffer.from(r.data, 'base64'), 'utf8');
  return 名;
};

console.log('框：' + JSON.stringify(框));
console.log('\n==== 现状（选中态加粗）====');
console.log(JSON.stringify(await 读数(), null, 1));
/* 点一下 Shift-JIS，看整排挪多少 */
const 点 = await 跑(`(() => { const b = [...document.querySelectorAll('.pick__b')].find((x) => x.textContent.trim() === 'Shift-JIS'); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
await rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 点.x, y: 点.y, button: 'none', buttons: 0 });
await rpc('Input.dispatchMouseEvent', { type: 'mousePressed', x: 点.x, y: 点.y, button: 'left', buttons: 1, clickCount: 1 });
await rpc('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 点.x, y: 点.y, button: 'left', buttons: 0, clickCount: 1 });
await 等(800);
console.log('点 Shift-JIS 之后：');
console.log(JSON.stringify(await 读数(), null, 1));
console.log('截图：' + (await 拍图('tmp\\⑤选中态-现状.png')));

console.log('\n==== 改后（选中态不加粗 + inset 描边）====');
await 跑(`(() => {
  const s = document.createElement('style');
  s.id = '样本-改后';
  s.textContent = ".pick__b[aria-pressed='true'] { font-weight: 400; box-shadow: inset 0 0 0 1px var(--line-divider); }";
  document.head.appendChild(s);
  return true;
})()`);
await 等(500);
console.log('改后（Shift-JIS 仍是选中态）：');
console.log(JSON.stringify(await 读数(), null, 1));
console.log('截图：' + (await 拍图('tmp\\⑤选中态-改后.png')));

/* 再点回「自动认」，看改后还会不会挪 */
const 点2 = await 跑(`(() => { const b = [...document.querySelectorAll('.pick__b')].find((x) => /自动认/.test(x.textContent)); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
await rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 点2.x, y: 点2.y, button: 'none', buttons: 0 });
await rpc('Input.dispatchMouseEvent', { type: 'mousePressed', x: 点2.x, y: 点2.y, button: 'left', buttons: 1, clickCount: 1 });
await rpc('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 点2.x, y: 点2.y, button: 'left', buttons: 0, clickCount: 1 });
await 等(800);
console.log('改后点回「自动认」：');
console.log(JSON.stringify(await 读数(), null, 1));
ws.close();
