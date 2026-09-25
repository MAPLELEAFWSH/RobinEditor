/**
 * 定向诊断：⑦ 丢一张图进来，**卡在哪一步**。
 * 只看一页（分离，单槽），把每一步都摊开：
 *   · 监听挂上没有 · `st.over` 解出了什么键 · invoke 到底调了什么 · 槽自己的 error
 */
const PORT = process.env.CDP_PORT ?? '9500';
const BASE = `http://127.0.0.1:${PORT}`;
const APP = process.env.DEV_ORIGIN ?? 'http://127.0.0.1:1420';

const 桩 = `
(() => {
  const b64 = btoa(String.fromCharCode(255,0,0,255, 255,0,0,255, 255,0,0,255, 255,0,0,255));
  window.__假 = { 调用: [], 监听: {} };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      const a = args || {};
      window.__假.调用.push(cmd + (a.path ? ' ' + a.path : ''));
      if (cmd === 'plugin:event|listen') { window.__假.监听[a.event] = window['_' + a.handler]; return 1; }
      if (cmd === 'plugin:event|unlisten') return null;
      if (cmd === 'read_rgba') return { width: 2, height: 2, rgba: b64 };
      if (cmd === 'read_image') return { width: 2, height: 2, rgba: b64, src_format: 'PNG', src_bytes: 16 };
      return null;
    },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window['_' + id] = cb; return id; },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } }
  };
})();
`;

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
const 跑 = async (表达式) => {
  const r = await rpc('Runtime.evaluate', { expression: 表达式, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { 页面抛错: (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? '').split('\n')[0] };
  return r.result.value;
};
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: 桩 });
await rpc('Page.navigate', { url: `${APP}/tools/channels?panel=split` });
await 等(3600);

console.log('监听挂了哪些：', JSON.stringify(await 跑('Object.keys(window.__假.监听)')));
console.log('槽矩形：', JSON.stringify(await 跑(`[...document.querySelectorAll('[data-drop-key]')].map((el) => { const r = el.getBoundingClientRect(); return { 键: el.dataset.dropKey, 中心: { x: Math.round((r.left+r.right)/2), y: Math.round((r.top+r.bottom)/2) } }; })`)));

/* 一步一停：enter / over 之后先读 st.over，再 drop */
console.log(
  '\n一步一停：',
  JSON.stringify(
    await 跑(`(async () => {
  const 真 = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/lib/drag.svelte.ts'));
  const m = await import(真 || '/src/lib/drag.svelte.ts');
  const 槽 = document.querySelector('[data-drop-key]');
  const r = 槽.getBoundingClientRect();
  const d = devicePixelRatio || 1;
  const 位 = { x: Math.round((r.left + r.width / 2) * d), y: Math.round((r.top + r.height / 2) * d) };
  const 发 = (类型, 载荷) => window.__假.监听['tauri://drag-' + 类型]({ event: 'tauri://drag-' + 类型, id: 1, payload: 载荷 });
  const 出 = { 物理坐标: 位, dpr: d, 键: 槽.dataset.dropKey };
  window.__假.调用 = [];
  发('enter', { paths: ['D:\\\\别处\\\\a.png'], position: 位 });
  出.enter后_active = m.drag.active;
  出.enter后_over = m.drag.over;
  发('over', { position: 位 });
  出.over后_over = m.drag.over;
  出.over后_active = m.drag.active;
  发('drop', { paths: ['D:\\\\别处\\\\a.png'], position: 位 });
  await new Promise((x) => setTimeout(x, 1600));
  出.drop后调用 = window.__假.调用.slice();
  出.drop后_over = m.drag.over;
  出.drop后_active = m.drag.active;
  出.槽满了吗 = 槽.classList.contains('slot--full');
  出.槽文字 = (槽.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
  出.侧栏错 = (document.querySelector('.side__err')?.textContent || '').replace(/\\s+/g, ' ').trim();
  出.order = m.drag.order;
  return 出;
})()`),
    null,
    1
  )
);
ws.close();
