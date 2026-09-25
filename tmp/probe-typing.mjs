/**
 * 用真实按键路径测"填数字 → 滑条是否跟着动"，以及反方向。
 *   $env:CDP_PORT=9400; node tmp/probe-typing.mjs /tools/ikclut
 */
const PORT = process.env.CDP_PORT ?? '9400';
const 路由 = process.argv[2] ?? '/tools/ikclut';
const BASE = process.env.AUDIT_BASE ?? `http://127.0.0.1:${PORT}`;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const 页 = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
const ws = new WebSocket(页.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const 等 = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && 等.has(m.id)) {
    等.get(m.id)(m);
    等.delete(m.id);
  }
});
const rpc = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    等.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const 求值 = async (expression) => {
  const r = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};

await rpc('Emulation.setDeviceMetricsOverride', { width: 1707, height: 1067, deviceScaleFactor: 1, mobile: false });
await rpc('Page.navigate', { url: new URL(路由, BASE).toString() });
await new Promise((r) => setTimeout(r, 2500));

/** 打开参数抽屉（收起状态下框不可点） */
await 求值(`(() => {
  for (const a of document.getAnimations?.() ?? []) { try { a.finish(); } catch {} }
  const t = [...document.querySelectorAll('button')].find(b => /参数/.test(b.textContent || ''));
  if (t && !document.documentElement.classList.contains('side-open')) t.click();
  return document.documentElement.className;
})()`);
await new Promise((r) => setTimeout(r, 700));

/** 定位"曝光"那一行的框和滑条，返回中心坐标 */
const 位 = await 求值(`(() => {
  const nb = document.querySelector('input.nb__i[aria-label="曝光"]');
  const rg = document.querySelector('input[type=range][aria-label="曝光"]');
  if (!nb || !rg) return null;
  const a = nb.getBoundingClientRect(), b = rg.getBoundingClientRect();
  return { 框: { x: Math.round(a.x + a.width / 2), y: Math.round(a.y + a.height / 2) }, 滑条: { x: Math.round(b.x + 2), y: Math.round(b.y + b.height / 2) }, 滑条宽: Math.round(b.width), 滑条盒: { x: Math.round(b.x), w: Math.round(b.width) } };
})()`);
if (!位) {
  console.log('找不到曝光行');
  ws.close();
  process.exit(1);
}
console.log('坐标', JSON.stringify(位));

const 读 = () =>
  求值(`(() => {
    const nb = document.querySelector('input.nb__i[aria-label="曝光"]');
    const rg = document.querySelector('input[type=range][aria-label="曝光"]');
    return { 框: nb?.value, 滑条: rg?.value };
  })()`);

console.log('起点   ', JSON.stringify(await 读()));

/* ① 真实键入：点进框 → 全选 → 敲 0.5 */
await rpc('Input.dispatchMouseEvent', { type: 'mousePressed', x: 位.框.x, y: 位.框.y, button: 'left', clickCount: 1 });
await rpc('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 位.框.x, y: 位.框.y, button: 'left', clickCount: 1 });
await rpc('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
await rpc('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
for (const ch of '1.7') {
  await rpc('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
  await rpc('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
}
await new Promise((r) => setTimeout(r, 250));
console.log('敲完 1.7', JSON.stringify(await 读()));
console.log('  焦点在', await 求值(`document.activeElement?.getAttribute('aria-label')`));

/* ② 点空白处失焦，看最终提交 */
await 求值(`document.activeElement?.blur()`);
await new Promise((r) => setTimeout(r, 250));
console.log('失焦后 ', JSON.stringify(await 读()));

/* ③ 反方向：拖滑条（点在最左侧），看框跟不跟 */
await rpc('Input.dispatchMouseEvent', { type: 'mousePressed', x: 位.滑条.x + 4, y: 位.滑条.y, button: 'left', clickCount: 1 });
await rpc('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 位.滑条.x + 4, y: 位.滑条.y, button: 'left', clickCount: 1 });
await new Promise((r) => setTimeout(r, 250));
console.log('滑条点左端', JSON.stringify(await 读()));

/* ④ 键盘微调：焦点回框，按 ArrowUp */
await rpc('Input.dispatchMouseEvent', { type: 'mousePressed', x: 位.框.x, y: 位.框.y, button: 'left', clickCount: 1 });
await rpc('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 位.框.x, y: 位.框.y, button: 'left', clickCount: 1 });
await rpc('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
await rpc('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
await new Promise((r) => setTimeout(r, 250));
console.log('ArrowUp 后', JSON.stringify(await 读()));

ws.close();
