/**
 * 一次性探针：把某一页的 `btn--primary` 全列出来（含是否可见 / 在哪个祖先里藏着的）。
 * 用法：node tmp\probe-主按钮.mjs /tools/glitch
 */
const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const 路由 = process.argv[2] ?? '/tools/glitch';

const list = await (await fetch(`${BASE}/json/list`)).json();
const t = list.find((x) => x.type === 'page' && !x.url.startsWith('devtools://'));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const rpc = (method, params = {}) =>
  new Promise((res, rej) => {
    const my = ++id;
    const on = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== my) return;
      ws.removeEventListener('message', on);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id: my, method, params }));
  });

await rpc('Page.navigate', { url: `http://127.0.0.1:1420${路由}` });
await new Promise((r) => setTimeout(r, 2500));

const r = await rpc('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    const 藏没藏 = (e) => {
      let p = e;
      while (p && p !== document.documentElement) {
        const s = getComputedStyle(p);
        if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return (p.className || p.tagName).toString().slice(0, 50);
        if (p.tagName === 'DETAILS' && !p.open) return 'DETAILS(closed)';
        p = p.parentElement;
      }
      return '';
    };
    return [...document.querySelectorAll('button.btn--primary')].map((b) => {
      const rc = b.getBoundingClientRect();
      return {
        文字: (b.textContent || '').trim().slice(0, 20),
        类: (b.className || '').toString().slice(0, 50),
        矩形: [Math.round(rc.left), Math.round(rc.top), Math.round(rc.width), Math.round(rc.height)].join(','),
        藏在: 藏没藏(b),
        禁用: b.disabled
      };
    });
  })()`
});
console.log(路由, JSON.stringify(r.result.value, null, 1));
ws.close();
