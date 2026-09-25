/**
 * 验"数值既能填也能拖"：ikclut 里每个滑条旁边是不是都有可填的数字框。
 *   $env:CDP_PORT=9400; node tmp/probe-numbox.mjs /tools/ikclut
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
    const 滑条 = [...document.querySelectorAll('input[type=range]')];
    const 数字框 = [...document.querySelectorAll('input[type=number]')];
    const 可填 = [...document.querySelectorAll('input.nb__i')];
    /* 逐个滑条：它的最近 .row 祖先里有没有 nb__i */
    const 缺 = [];
    for (const s of 滑条) {
      const row = s.closest('.row') || s.parentElement;
      if (!row) continue;
      if (!row.querySelector('input.nb__i')) {
        缺.push({ 标签: (row.querySelector('.row__k')?.textContent || '').trim(), 类: (s.className||'').toString().slice(0,30) });
      }
    }
    /* 试一个：给第一个数字框写个值，看滑条跟不跟着动 */
    let 联动 = null;
    const 第一对 = 滑条.map(s => ({ s, n: (s.closest('.row')||s.parentElement)?.querySelector('input.nb__i') })).find(x => x.n);
    if (第一对) {
      const 旧 = 第一对.s.value;
      const 新值 = String(Math.round(Number(第一对.s.max) * 0.5 * 100) / 100);
      第一对.n.value = 新值;
      第一对.n.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 60));
      联动 = { 原滑条: 旧, 写入: 新值, 事后滑条: 第一对.s.value, 一致: Math.abs(Number(第一对.s.value) - Number(新值)) < 1e-6 };
    }
    return { 滑条数: 滑条.length, 数字框数: 数字框.length, 可填框数: 可填.length, 没有可填框的滑条: 缺.length, 缺例: 缺.slice(0, 5), 联动 };
  })()`
});
console.log(JSON.stringify(r.result?.result?.value ?? r, null, 2));
ws.close();
