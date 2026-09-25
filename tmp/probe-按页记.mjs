/**
 * 一次性探针：收起状态是不是**按页记**的（用户实测过"任一页点收起会把别的页一起关掉"）。
 * 用法：node tmp\probe-按页记.mjs
 * 步骤：打开 A 的抽屉 → 去 B 看是不是收起的 → 回 A 看是不是还开着 → 去 C 再确认一次。
 */
const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const 甲 = process.argv[2] ?? '/tools/ilm';
const 乙 = process.argv[3] ?? '/tools/ikclut';
const 丙 = process.argv[4] ?? '/tools/migrate';

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
const 去 = async (u) => {
  await rpc('Page.navigate', { url: `http://127.0.0.1:1420${u}` });
  await new Promise((r) => setTimeout(r, 2200));
};
const 状态 = () =>
  ev(`(() => {
    const 根 = document.documentElement;
    const 侧 = document.querySelector('.wb__side');
    const r = 侧 ? 侧.getBoundingClientRect() : null;
    return {
      页: location.pathname + location.search,
      'html类': 根.className || '(空)',
      抽屉: r ? 'left=' + Math.round(r.left) + ' 在视口内=' + (r.left < innerWidth - 2) : '没有 .wb__side',
      存下的: localStorage.getItem('robin.wb.side.v3')
    };
  })()`);
const 点参数 = () =>
  ev(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-pressed') !== null && /参数/.test(x.textContent || ''));
    if (b) b.click();
    return !!b;
  })()`);

/* 先把这一轮要用的三页清干净（免得读到上一轮的记忆） */
await 去(甲);
await ev(`localStorage.removeItem('robin.wb.side.v3')`);
await 去(甲);

console.log('① 刚进', 甲, ':', JSON.stringify(await 状态()));
console.log('   点「参数」=', await 点参数());
await new Promise((r) => setTimeout(r, 600));
console.log('   点完:', JSON.stringify(await 状态()));

await 去(乙);
console.log('② 去', 乙, '（应当还是收起的）:', JSON.stringify(await 状态()));

await 去(丙);
console.log('③ 去', 丙, '（应当还是收起的）:', JSON.stringify(await 状态()));

await 去(甲);
console.log('④ 回', 甲, '（应当还记得是开着的）:', JSON.stringify(await 状态()));

/* 收尾：把记忆清掉，别留给下一次体检 */
await ev(`localStorage.removeItem('robin.wb.side.v3')`);
ws.close();
