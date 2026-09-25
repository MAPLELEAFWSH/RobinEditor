/**
 * 一次性探针：看某一页的「启动幕布」什么时候撤，以及撤之前/之后主按钮算不算可见。
 *
 * 起因：体检在 `ikclut` 上量到 `primary 0`，而按钮其实在 DOM 里、矩形也在视口内 ——
 * 它被 `<div class="bootwrap bootwrap--hidden">`（`opacity: 0`，开场交叉淡入还没走完）盖着。
 * 用法：node tmp\probe-启动幕布.mjs /tools/ikclut
 */
const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const 路由 = process.argv[2] ?? '/tools/ikclut';

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

const 读 = async () => {
  const r = await rpc('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const w = document.querySelector('.bootwrap');
      const 幕布 = w ? (w.classList.contains('bootwrap--hidden') ? 'hidden' : 'revealed') : 'none';
      const bs = [...document.querySelectorAll('button.btn--primary')];
      const vis = bs.filter((b) => {
        let p = b;
        while (p && p !== document.documentElement) {
          const s = getComputedStyle(p);
          if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
          p = p.parentElement;
        }
        const rc = b.getBoundingClientRect();
        if (rc.width <= 0 || rc.height <= 0) return false;
        if (rc.right <= 1 || rc.bottom <= 1 || rc.left >= innerWidth - 1 || rc.top >= innerHeight - 1) return false;
        return true;
      });
      return { 幕布, 总主按钮: bs.length, 可见主按钮: vis.length, 正文长: document.body.innerText.length };
    })()`
  });
  return r.result.value;
};

for (let i = 0; i <= 40; i++) {
  const v = await 读();
  if (v.正文长 > 0) console.log(`${(i * 250).toString().padStart(5)}ms  ` + JSON.stringify(v));
  if (v.正文长 > 0 && (v.幕布 === 'none' || (v.幕布 === 'revealed' && v.可见主按钮 > 0))) break;
  await new Promise((r) => setTimeout(r, 250));
}
ws.close();
