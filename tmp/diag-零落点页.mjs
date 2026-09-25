/** 量一下"一个落点都没有"的那几页：屏幕上有什么按钮（决定拖进来该等于点哪个） */
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
const ev = async (e) => {
  const r = await rpc('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { 抛错: (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? '').split('\n')[0] };
  return r.result.value;
};
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
await rpc('Page.enable');
await rpc('Runtime.enable');

const 页 = [
  ['/tools/channels?panel=pipeline', '⑦批量提取'],
  ['/tools/channels?panel=batch', '⑦批量'],
  ['/tools/ilm?panel=pairing', '⑤配对检查'],
  ['/tools/ikclut?panel=clut', '②生成'],
  ['/tools/ikclut?panel=export', '②导出']
];

for (const [路由, 名] of 页) {
  await rpc('Page.navigate', { url: 'http://127.0.0.1:1420' + 路由 });
  await 等(4200);
  const 出 = await ev(`(() => {
    const 文 = (el) => (el && el.textContent ? el.textContent : '').replace(/\\s+/g, ' ').trim();
    const 主 = document.querySelector('.wb__main');
    const 钮 = [...document.querySelectorAll('.wb__main button')]
      .filter((b) => !b.disabled)
      .map(文).filter((x) => x && x.length <= 24);
    return {
      文字长度: (主 ? 主.textContent : document.body.textContent).length,
      按钮: [...new Set(钮)].slice(0, 14),
      有参数抽屉: !!document.querySelector('.wb__side'),
      空态提示: 主 ? 文(主).slice(0, 110) : '(没有工作区)'
    };
  })()`);
  console.log(`\n==== ${名}（${路由}）====`);
  console.log(JSON.stringify(出, null, 1));
}
ws.close();
