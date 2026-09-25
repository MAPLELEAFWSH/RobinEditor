/** 定位 `each_key_duplicate` 是哪张列表（开发版里报错带组件信息，打包版是压过的） */
const PORT = process.env.CDP_PORT ?? '9500';
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = list.find((x) => x.type === 'page' && !x.url.startsWith('devtools://'));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const rpc = (m, p = {}) =>
  new Promise((res, rej) => {
    const my = ++id;
    const on = (e) => {
      const j = JSON.parse(e.data);
      if (j.id !== my) return;
      ws.removeEventListener('message', on);
      j.error ? rej(new Error(JSON.stringify(j.error))) : res(j.result);
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id: my, method: m, params: p }));
  });
const 跑 = async (e) => {
  const r = await rpc('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  return r.exceptionDetails ? { 抛错: r.exceptionDetails.text } : r.result.value;
};
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
await rpc('Page.enable');
await rpc('Runtime.enable');
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method !== 'Runtime.exceptionThrown') return;
  const d = m.params.exceptionDetails;
  console.log('\n‼️ 抛错：', (d.exception?.description ?? d.text ?? '').split('\n').slice(0, 6).join('\n'));
  if (d.stackTrace?.callFrames) {
    for (const f of d.stackTrace.callFrames.slice(0, 8)) {
      console.log(`     at ${f.functionName || '(匿名)'} ${f.url.split('/').slice(-2).join('/')}:${f.lineNumber + 1}:${f.columnNumber + 1}`);
    }
  }
});
await rpc('Page.navigate', { url: 'http://127.0.0.1:1420/tools/glitch?panel=fix' });
await 等(4000);
console.log('—— 已到「文本」栏（上面若没有抛错，说明文本栏干净）——');
console.log('切到「文件」栏：', await 跑(`(async () => {
  const b = [...document.querySelectorAll('.seg__btn')].find((x) => {
    const l = x.querySelector('.seg__label');
    return ((l ? l.textContent : x.textContent) || '').trim() === '文件';
  });
  if (b) b.click();
  await new Promise((r) => setTimeout(r, 2500));
  return location.pathname + location.search;
})()`));
await 等(2500);
console.log('—— 文件栏也到了 ——');
ws.close();
