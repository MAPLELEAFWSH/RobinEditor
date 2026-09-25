/**
 * 一次性探针：为什么某些页点了「参数」抽屉还停在视口外。
 * 用法（无头 Chrome 已经在 9400 上跑着）：node tmp\probe-抽屉.mjs /tools/channels
 */
const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const 路由 = process.argv[2] ?? '/tools/channels';

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

const ev = async (expression) => {
  const r = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

await rpc('Page.navigate', { url: `http://127.0.0.1:1420${路由}` });
await new Promise((r) => setTimeout(r, 2500));

const 快照 = () => `(() => {
  const 根 = document.documentElement;
  const 侧 = [...document.querySelectorAll('.wb__side')];
  const 钮 = [...document.querySelectorAll('button')].map((b, i) => ({
    i, t: (b.textContent || '').trim().slice(0, 12),
    ap: b.getAttribute('aria-pressed'), cls: (b.className || '').toString().slice(0, 40)
  })).filter((x) => x.ap !== null);
  return {
    html类: 根.className,
    侧栏数: 侧.length,
    侧栏: 侧.map((e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      const 链 = [];
      let p = e.parentElement;
      while (p && p !== document.documentElement) {
        const ps = getComputedStyle(p);
        if (ps.transform !== 'none' || ps.filter !== 'none' || ps.willChange !== 'auto' || ps.contain !== 'none') {
          链.push({ 类: (p.className || p.tagName).toString().slice(0, 40), tf: ps.transform, wc: ps.willChange, cd: ps.contain });
        }
        p = p.parentElement;
      }
      return { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), pos: s.position, tf: s.transform, 定位祖先: 链 };
    }),
    带aria的钮: 钮,
    视口: { w: innerWidth, h: innerHeight }
  };
})()`;

console.log('路由', 路由);
console.log('--- 刚进页面 ---');
console.log(JSON.stringify(await ev(快照()), null, 1));

await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-pressed') !== null && /参数/.test(x.textContent || ''));
  if (b) b.click();
  return !!b;
})()`);
await new Promise((r) => setTimeout(r, 600));
console.log('--- 点了「参数」之后 ---');
console.log(JSON.stringify(await ev(快照()), null, 1));

/* 关回去，别把状态留在 localStorage 里 */
await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-pressed') !== null && /参数/.test(x.textContent || ''));
  if (b) b.click();
})()`);
await new Promise((r) => setTimeout(r, 400));
ws.close();
