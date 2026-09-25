/** 诊断：全页落点量具报"全都没有落点"，先看页面本身渲染出来没有、模块导入成不成功 */
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
await rpc('Page.enable');
await rpc('Runtime.enable');
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    console.log('‼️ [页面抛错]', (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text ?? '').split('\n').slice(0, 3).join(' | '));
  }
});

for (const 路由 of ['/tools/glitch?panel=fix', '/tools/channels?panel=layers', '/tools/ray?panel=conf']) {
  await rpc('Page.navigate', { url: 'http://127.0.0.1:1420' + 路由 });
  await new Promise((r) => setTimeout(r, 4000));
  console.log(`\n=== ${路由} ===`);
  console.log('  body 文字长度:', await ev('document.body.textContent.length'));
  console.log('  有 .wb__main:', await ev('!!document.querySelector(".wb__main")'));
  console.log('  文字开头:', JSON.stringify(await ev('document.body.textContent.replace(/\\s+/g," ").trim().slice(0,90)')));
  console.log('  DOM 里 data-drop-key 个数:', await ev('document.querySelectorAll("[data-drop-key]").length'));
  console.log('  导入 dropzones:', JSON.stringify(await ev(`(async () => {
    const n = performance.getEntriesByType('resource').map((e) => e.name).filter((x) => x.includes('dropzones'));
    if (!n.length) return { 没有这个资源: true };
    try { const m = await import(n[0]); return { url: n[0].split('/').pop(), ids: m.zoneIds() }; }
    catch (e) { return { 导入失败: String(e).slice(0, 120) }; }
  })()`)));
}
ws.close();
