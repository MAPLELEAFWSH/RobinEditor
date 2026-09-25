/** 直接问后端：`scan_text_files` 返回的清单里有没有重复路径（那就是 each 键重复的来源） */
const PORT = process.env.CDP_PORT ?? process.argv[2] ?? '9229';
const 副本 = 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例\\测试效果\\①写盘验收-副本';

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
  if (r.exceptionDetails) return { 抛错: (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? '').split('\n')[0] };
  return r.result.value;
};
await rpc('Runtime.enable');

const EXT = ['txt', 'fx', 'fxsub', 'fxconf', 'conf', 'ini', 'md', 'csv', 'log', 'json', 'x'];
const 出 = await 跑(`(async () => {
  const hits = await window.__TAURI_INTERNALS__.invoke('scan_text_files', { root: ${JSON.stringify(副本)}, exts: ${JSON.stringify(EXT)}, 目标编码: null });
  const 计 = {};
  const 计rel = {};
  for (const h of hits) { 计[h.path] = (计[h.path] || 0) + 1; 计rel[h.rel] = (计rel[h.rel] || 0) + 1; }
  return {
    条数: hits.length,
    唯一path: Object.keys(计).length,
    唯一rel: Object.keys(计rel).length,
    重复path: Object.entries(计).filter((x) => x[1] > 1).slice(0, 12),
    重复rel: Object.entries(计rel).filter((x) => x[1] > 1).slice(0, 12)
  };
})()`);
console.log(JSON.stringify(出, null, 1));
ws.close();
