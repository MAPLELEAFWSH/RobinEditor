/**
 * ikclut：把页面上所有可点元素列出来（含 aria-label/title），确认究竟有没有抽屉开关；
 * 并说明那 28 个"视口内可填框"到底挂在谁身上。
 *   $env:CDP_PORT=9400; node tmp/probe-buttons.mjs /tools/ikclut
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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result?.result?.value;
};

await rpc('Emulation.setDeviceMetricsOverride', { width: 1707, height: 1067, deviceScaleFactor: 1, mobile: false });
await rpc('Page.navigate', { url: BASE });
await new Promise((r) => setTimeout(r, 1500));
await 求值(`localStorage.setItem('robin.wb.side.v2', JSON.stringify({ w: 288, open: false, pin: false }))`);
await rpc('Page.navigate', { url: new URL(路由, BASE).toString() });
await new Promise((r) => setTimeout(r, 2200));

const r = await 求值(`(() => {
  const vw = innerWidth;
  const 链 = (el) => { const a = []; let p = el; while (p && p !== document.body) { a.unshift(p.tagName.toLowerCase() + (p.className ? '.' + String(p.className).trim().split(/\\s+/).slice(0,3).join('.') : '')); p = p.parentElement; } return a.join(' > '); };
  const 钮 = [...document.querySelectorAll('button,[role=button],a[href]')].map(b => ({
    文: (b.textContent || '').trim().slice(0, 18),
    aria: b.getAttribute('aria-label'), title: b.getAttribute('title'), cls: String(b.className).slice(0, 40),
    在视口: b.getBoundingClientRect().x < vw - 2
  })).filter(x => x.在视口);
  const 可填 = [...document.querySelectorAll('input.nb__i')].filter(el => { const r = el.getBoundingClientRect(); return r.x >= 0 && r.x < vw - 4; });
  return {
    可点元素在视口内: 钮.length,
    抽屉相关: 钮.filter(x => /参数|收起|钉住|抽屉|side|drawer/i.test((x.文||'') + (x.aria||'') + (x.title||'') + x.cls)),
    前二十个: 钮.slice(0, 20),
    视口内可填框数: 可填.length,
    头一个可填框的祖先链: 可填[0] ? 链(可填[0]) : null,
    头一个可填框的aria: 可填[0]?.getAttribute('aria-label'),
    所有wb__side: [...document.querySelectorAll('.wb__side')].map(el => { const b = el.getBoundingClientRect(); return { 左: Math.round(b.x), 链: 链(el) }; })
  };
})()`);
console.log(JSON.stringify(r, null, 2));
ws.close();
