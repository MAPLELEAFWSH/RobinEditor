/**
 * 清掉探针浏览器里那条"参数抽屉开着"的记忆（`robin.wb.side.v3`）。
 *
 * 为什么需要：`side.open` 是**按路由存 localStorage** 的（见 `src/lib/side.svelte.ts`）。
 * `tmp\probe-底栏图层.mjs` 为了量覆盖，逐页把抽屉点开了 —— 同一个浏览器配置里接着跑
 * `tools\ui-audit.mjs`，它量到的是"抽屉默认就开着"，于是每一行都 FAIL。
 * 那是探针留下的状态，不是代码坏了；跑审计之前先清一下。
 *
 * 用法：node tmp\清抽屉记忆.mjs
 */
const PORT = process.env.CDP_PORT ?? '9400';
const 地址 = process.argv[2] ?? 'http://127.0.0.1:1420/tools/migrate';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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
const 跑 = async (表达式) => (await rpc('Runtime.evaluate', { expression: 表达式, returnByValue: true })).result.value;

await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Page.navigate', { url: 地址 });
await new Promise((r) => setTimeout(r, 4000));
console.log('清之前的键：', await 跑('JSON.stringify(Object.keys(localStorage))'));
await 跑(`localStorage.removeItem('robin.wb.side.v3'); document.documentElement.classList.contains('side-open')`);
console.log('清完还在键表里吗：', await 跑(`JSON.stringify(Object.keys(localStorage).filter((k) => k.includes('side')))`));
ws.close();
