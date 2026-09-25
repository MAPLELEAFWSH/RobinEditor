/**
 * 一次性探针：`+展开` 那一态中区比默认态窄 10px（1339 → 1329），这 10px 是哪来的？
 * 只量、不改任何东西。跑法：node tmp\probe-中区10px.mjs（要先有 CDP 端口与 pnpm dev）
 */
const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const 址 = process.env.AUDIT_URL ?? 'http://127.0.0.1:1420/tools/migrate?panel=repair';

let idc = 0;
function rpc(ws, method, params = {}) {
  const id = ++idc;
  return new Promise((res, rej) => {
    const on = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener('message', on);
      if (m.error) rej(new Error(JSON.stringify(m.error)));
      else res(m.result);
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => rej(new Error('rpc 超时：' + method)), 20000);
  });
}

const 列表 = await (await fetch(`${BASE}/json/list`)).json();
const 页 = 列表.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
if (!页) {
  console.error('没有页面目标');
  process.exit(2);
}
const ws = new WebSocket(页.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = () => rej(new Error('连不上调试端口'));
});
await rpc(ws, 'Emulation.setDeviceMetricsOverride', { width: 1707, height: 1067, deviceScaleFactor: 1, mobile: false });

const 表达式 = (展开) => `
(async () => {
  const 定住 = async () => {
    for (const a of document.getAnimations?.() ?? []) { try { a.finish(); } catch {} }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };
  await 定住();
  if (${展开}) {
    for (const d of document.querySelectorAll('details')) d.open = true;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await 定住();
  }
  const 主 = document.querySelector('.wb__main');
  const 垫 = (e) => { const s = getComputedStyle(e); return [s.paddingLeft, s.paddingRight].join('/'); };
  const 主rect = 主?.getBoundingClientRect();
  return {
    展开: ${展开},
    innerWidth,
    htmlclientWidth: document.documentElement.clientWidth,
    滚条宽: innerWidth - document.documentElement.clientWidth,
    文档高: document.documentElement.scrollHeight,
    主区rect宽: Math.round(主rect?.width ?? -1),
    主区clientWidth: 主?.clientWidth ?? -1,
    主区右边: Math.round(主rect?.right ?? -1),
    主区留白: 主 ? 垫(主) : '',
    wb宽: Math.round(document.querySelector('.wb')?.getBoundingClientRect().width ?? -1),
    body滚动高: document.body.scrollHeight,
    页面可滚: document.documentElement.scrollHeight > innerHeight,
  };
})()
`;

async function 量(展开) {
  await rpc(ws, 'Page.navigate', { url: 址 });
  await new Promise((r) => setTimeout(r, 2600));
  const r = await rpc(ws, 'Runtime.evaluate', { expression: 表达式(展开), returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}

console.log(JSON.stringify(await 量(false), null, 1));
console.log(JSON.stringify(await 量(true), null, 1));
ws.close();
