/**
 * 量抽屉在"展开态"到底怎么了：打印它的矩形、计算的 transform、html 上的类、以及存下来的宽度。
 *   $env:CDP_PORT=9400; node tmp/probe-drawer2.mjs /tools/ilm
 */
const PORT = process.env.CDP_PORT ?? '9400';
const 路由 = process.argv[2] ?? '/tools/ilm';
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

await rpc('Emulation.setDeviceMetricsOverride', { width: 1707, height: 1067, deviceScaleFactor: 1, mobile: false });
await rpc('Page.navigate', { url: new URL(路由, BASE).toString() });
await new Promise((r) => setTimeout(r, 1800));

const 量 = `(() => {
  const d = document.querySelector('.wb__side');
  const r = d ? d.getBoundingClientRect() : null;
  const s = d ? getComputedStyle(d) : null;
  return {
    html类: document.documentElement.className,
    side存值: localStorage.getItem('robin.wb.side.v2'),
    sideW变量: getComputedStyle(document.documentElement).getPropertyValue('--side-w'),
    内宽: innerWidth,
    抽屉: r ? { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) } : null,
    transform: s ? s.transform : null,
    position: s ? s.position : null,
    wb列: document.querySelector('.wb') ? getComputedStyle(document.querySelector('.wb')).gridTemplateColumns : null,
    文档: { htmlScroll: document.documentElement.scrollWidth, htmlClient: document.documentElement.clientWidth, bodyScroll: document.body.scrollWidth, bodyClient: document.body.clientWidth },
    主区: (() => { const m = document.querySelector('.wb__main'); if (!m) return null; const r = m.getBoundingClientRect(); return { left: Math.round(r.left), width: Math.round(r.width), scrollW: m.scrollWidth, clientW: m.clientWidth }; })(),
    宽元素: [...document.querySelectorAll('*')].filter(e => e.scrollWidth > e.clientWidth + 1 && ['auto','scroll'].includes(getComputedStyle(e).overflowX)).map(e => ({ 类: (e.className||'').toString().slice(0,40), 超: e.scrollWidth - e.clientWidth })).slice(0, 6)
  };
})()`;

const 读 = async (标签) => {
  const r = await rpc('Runtime.evaluate', { returnByValue: true, expression: 量 });
  const v = r.result?.result?.value;
  if (v === undefined) console.log(标签, '拿不到值，原样：', JSON.stringify(r).slice(0, 400));
  else console.log(标签, JSON.stringify(v));
};

await 读('未展开  ');
await rpc('Runtime.evaluate', {
  returnByValue: true,
  expression: `[...document.querySelectorAll('details')].forEach(d => d.open = true)`
});
await new Promise((r) => setTimeout(r, 300));
await 读('展开后  ');
ws.close();
