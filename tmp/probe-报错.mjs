/**
 * 一次性探针：把某一页的控制台报错 / 未捕获异常全收下来。
 *
 * 起因：`/tools/ikclut` 的启动幕布一直不撤（`bootwrap--hidden` 挂着不摘），
 * 主界面永远停在 `opacity: 0` —— 得先看是不是有东西抛了。
 * 用法：node tmp\probe-报错.mjs /tools/ikclut
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

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    console.log('[异常]', d.text, d.exception?.description ?? '');
    for (const f of d.stackTrace?.callFrames ?? []) {
      console.log(`   ${f.url}:${f.lineNumber + 1}:${f.columnNumber + 1}  ${f.functionName}`);
    }
  }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    console.log(`[${m.params.type}]`, m.params.args.map((a) => a.description ?? a.value).join(' ').slice(0, 400));
    for (const f of m.params.stackTrace?.callFrames ?? []) {
      console.log(`   ${f.url}:${f.lineNumber + 1}:${f.columnNumber + 1}  ${f.functionName}`);
    }
  }
});

await rpc('Runtime.enable');
await rpc('Page.navigate', { url: `http://127.0.0.1:1420${路由}` });
await new Promise((r) => setTimeout(r, 9000));

const r = await rpc('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    const w = document.querySelector('.bootwrap');
    return {
      幕布: w ? (w.classList.contains('bootwrap--hidden') ? 'hidden' : 'revealed') : 'none',
      开场还在: !!document.querySelector('.intro')
    };
  })()`
});
console.log('8s 后：', JSON.stringify(r.result.value));
ws.close();
