/**
 * 复现：默认（open=false）下，哪些页面的参数栏停在视口外、页面上有没有开关。
 *   $env:CDP_PORT=9400; node tmp/probe-reach.mjs
 */
const PORT = process.env.CDP_PORT ?? '9400';
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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result?.result?.value;
};

await rpc('Emulation.setDeviceMetricsOverride', { width: 1707, height: 1067, deviceScaleFactor: 1, mobile: false });

/** 把状态清回默认（未钉、未展开） */
await rpc('Page.navigate', { url: BASE });
await new Promise((r) => setTimeout(r, 1500));
await 求值(`localStorage.setItem('robin.wb.side.v2', JSON.stringify({ w: 288, open: false, pin: false }))`);

const 量 = `(() => {
  for (const a of document.getAnimations?.() ?? []) { try { a.finish(); } catch {} }
  const vw = innerWidth, vh = innerHeight;
  const 侧 = [...document.querySelectorAll('.wb__side')].map(el => {
    const r = el.getBoundingClientRect();
    return { 左: Math.round(r.x), 右: Math.round(r.right), 宽: Math.round(r.width), 在视口: r.x < vw - 4 && r.right > 0 && r.width > 0, 可见: r.x >= 0 && r.x < vw - 4 };
  });
  const 钮 = [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim()).filter(t => /参数|收起|钉住|抽屉/.test(t));
  const 框 = [...document.querySelectorAll('input.nb__i')].filter(el => { const r = el.getBoundingClientRect(); return r.x >= 0 && r.x < vw - 4; }).length;
  return { vw, html类: document.documentElement.className, 侧栏: 侧, 开关: 钮, 视口内可填框: 框 };
})()`;

const 路由表 = process.argv.slice(2);
const 路由 = 路由表.length ? 路由表 : ['/tools/ikclut', '/tools/ray', '/tools/ilm', '/tools/mstoon'];
for (const 路 of 路由) {
  await rpc('Page.navigate', { url: new URL(路, BASE).toString() });
  await new Promise((r) => setTimeout(r, 2200));
  const m = await 求值(量);
  const 停在外面 = m.侧栏.filter((s) => !s.可见).length;
  console.log(
    `${路.padEnd(20)} html="${m.html类}"  侧栏${m.侧栏.length}个 停视口外${停在外面}个  开关=[${m.开关.join('|')}]  视口内可填框=${m.视口内可填框}  ${JSON.stringify(m.侧栏)}`
  );
}
ws.close();
