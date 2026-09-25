/**
 * 逐行核对"滑条 ↔ 数字框"是不是同一个值。
 *   $env:CDP_PORT=9400; node tmp/probe-pairs.mjs /tools/ikclut
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

await rpc('Emulation.setDeviceMetricsOverride', { width: 1707, height: 1067, deviceScaleFactor: 1, mobile: false });
await rpc('Page.navigate', { url: new URL(路由, BASE).toString() });
await new Promise((r) => setTimeout(r, 2500));

const r = await rpc('Runtime.evaluate', {
  returnByValue: true,
  awaitPromise: true,
  expression: `(async () => {
    for (const a of document.getAnimations?.() ?? []) { try { a.finish(); } catch {} }
    const 面板 = (el) => { const p = el.closest('section,.panel,.card,.wb__side,aside'); return (p?.id || p?.className || '?').toString().slice(0, 40); };
    const 行 = [];
    for (const s of document.querySelectorAll('input[type=range]')) {
      const row = s.closest('.row');
      const nb = row?.querySelector('input.nb__i');
      if (!row) continue;
      const k = (row.querySelector('.row__k')?.textContent || '').trim();
      if (!nb) { 行.push({ 标签: k, 面板: 面板(s), 有框: false }); continue; }
      行.push({ 标签: k, 面板: 面板(s), 有框: true, 滑条: Number(s.value), 框: Number(nb.value), 比值: Number(s.value) ? Number((Number(nb.value) / Number(s.value)).toFixed(4)) : null, step: s.step });
    }
    /* 只对第一对做写入试验 */
    let 试验 = null;
    const 对 = [...document.querySelectorAll('input[type=range]')].map(s => ({ s, nb: s.closest('.row')?.querySelector('input.nb__i') })).filter(x => x.nb && x.s.closest('.row'));
    if (对.length) {
      const { s, nb } = 对[0];
      const 标签 = (s.closest('.row').querySelector('.row__k')?.textContent || '').trim();
      const 旧框 = nb.value, 旧滑 = s.value;
      /* 走原生 setter，跟用户键入的路径一致 */
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(nb, '1.25');
      nb.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 120));
      试验 = { 标签, 旧框, 旧滑, 事后框: nb.value, 事后滑: s.value, 联动: Math.abs(Number(s.value) - 1.25) < 1e-9 };
    }
    return { 总数: 行.length, 没有框: 行.filter(x => !x.有框), 有框: 行.filter(x => x.有框), 试验 };
  })()`
});
console.log(JSON.stringify(r.result?.result?.value ?? r, null, 2));
ws.close();
