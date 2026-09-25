/*
 * 放大拍涟漪：在宿主矩形上裁一小块、放大 4 倍拍几张，看那圈到底出没出来。
 *
 * 为什么要放大：整屏截图里涟漪只有几个像素、又只有 0.3 左右的不透明度，
 * 全图做差会被墙纸和动画淹掉（实测框内 0 变化、全图几千变化）。
 * 放大 4 倍以后差异量级就够了。
 *
 * 用法：node tools/cdp-ripple-zoom.mjs [选择器]
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const PORT = process.env.CDP_PORT ?? '9222';
const 选 = process.argv[2] ?? '.leaf';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.addEventListener('open', r);
  ws.addEventListener('error', j);
});
let id = 0;
const 待 = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  const r = 待.get(m.id);
  if (r) {
    待.delete(m.id);
    m.error ? r.rej(new Error(JSON.stringify(m.error))) : r.res(m.result);
  }
});
const 调 = (method, params = {}) =>
  new Promise((res, rej) => {
    const my = ++id;
    待.set(my, { res, rej });
    ws.send(JSON.stringify({ id: my, method, params }));
  });
const 求值 = async (e) => (await 调('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;
await 调('Page.enable');

const r = await 求值(`(() => { const el = document.querySelector(${JSON.stringify(选)}); const b = el.getBoundingClientRect();
  return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
const 边 = 6;
const clip = { x: Math.max(0, r.x - 边), y: Math.max(0, r.y - 边), width: r.w + 边 * 2, height: r.h + 边 * 2, scale: 4 };

mkdirSync('tmp/ripple', { recursive: true });
writeFileSync('tmp/ripple/zoom-rect.json', JSON.stringify({ 选, ...r, 边, scale: clip.scale }, null, 1));
const 拍 = async (名) => {
  const s = await 调('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false });
  writeFileSync(`tmp/ripple/zoom-${名}.png`, Buffer.from(s.data, 'base64'));
};

await 拍('0-未点');
await 求值(`(() => { const el = document.querySelector(${JSON.stringify(选)});
  const b = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 }));
  return true; })()`);
for (const ms of [120, 300]) {
  await new Promise((t) => setTimeout(t, ms === 120 ? 120 : 180));
  await 拍(`${ms}ms`);
}
console.log(`${选} 宿主 ${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.w.toFixed(0)}x${r.h.toFixed(0)}；裁 ${clip.width.toFixed(0)}x${clip.height.toFixed(0)} 放大 4 倍`);
console.log('写到 tmp/ripple/zoom-*.png —— 用 python tools/cdp-ripple-diff.py --zoom 看差');
ws.close();
