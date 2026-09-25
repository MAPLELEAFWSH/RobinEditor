/**
 * 一次性探针：体检里那条新判据**真的能抓到原来那个 P0 形状**吗 ——
 * "有 `.wb__side` 却没有任何能打开它的控件"。
 * 做法：进一页（有抽屉、有开关），把「参数」按钮从 DOM 里拿掉，再跑一遍体检用的那三行判据。
 * 用法：node tmp\probe-判据.mjs /tools/ikclut
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
const ev = async (expression) => {
  const r = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

await rpc('Page.navigate', { url: `http://127.0.0.1:1420${路由}` });
await new Promise((r) => setTimeout(r, 2500));

const 判据 = `(() => {
  const 有侧栏 = !!document.querySelector('.wb__side');
  const 有开关 = [...document.querySelectorAll('button')].some(
    (b) => b.getAttribute('aria-pressed') !== null && /参数/.test(b.textContent || '')
  );
  return { 有侧栏, 有开关, 判据结果: (有侧栏 && !有开关) ? 'FAIL（有侧栏没开关）' : 'pass', 过: !(有侧栏 && !有开关) };
})()`;

console.log(路由, '原样      :', JSON.stringify(await ev(判据)));
await ev(`(() => {
  for (const b of [...document.querySelectorAll('button')]) {
    if (b.getAttribute('aria-pressed') !== null && /参数/.test(b.textContent || '')) b.remove();
  }
})()`);
console.log(路由, '把开关拿掉:', JSON.stringify(await ev(判据)));
ws.close();
