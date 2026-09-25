/** 侦察：① 页四个分栏各自的落点注册表（临时脚本，跑完可删） */
const PORT = process.env.CDP_PORT ?? '9500';
const BASE = `http://127.0.0.1:${PORT}`;
const APP = process.env.DEV_ORIGIN ?? 'http://127.0.0.1:1420';

const 桩 = `
(() => {
  const 根 = 'D:\\\\乱码测试';
  window.__假 = { 调用: [], 监听: {}, 报错记录: [] };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      window.__假.调用.push(cmd);
      if (cmd === 'plugin:event|listen') { window.__假.监听[args.event] = window['_' + args.handler]; return 1; }
      if (cmd === 'plugin:event|unlisten') return null;
      if (cmd === 'read_text_fixed') return { text: 'これはテスト', original: '\\u0082\\u00b1\\u0082\\u00ea\\u0082\\u00cd', encoding: 'shift_jis', changed: true, lossy: false, bom: false, segments: [] };
      if (cmd === 'read_text_file') return { text: 'これはテスト', encoding: 'shift_jis', lossy: false, bom: false };
      if (cmd === 'repair_text') return { original: 'x', fixed: 'これはテスト', changed: true, via: 'shift_jis', score_after: 1, score_before: 0, attempts: [], segments: [] };
      if (cmd === 'scan_pieces') return [];
      if (cmd === 'probe_dir') return { exists: true, is_dir: true, entries: 2, names: ['a.fx'] };
      if (cmd === 'scan_text_files') return [];
      if (cmd === 'scan_names') return [];
      console.log('[假后端] 没桩的命令:', cmd);
      return null;
    },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window['_' + id] = cb; return id; },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } }
  };
})();
`;

const list = await (await fetch(`${BASE}/json/list`)).json();
const t = list.find((x) => x.type === 'page' && !x.url.startsWith('devtools://'));
if (!t) throw new Error(`CDP :${PORT} 上没有可连的 page`);
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));

await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: 桩 });

const 工具 = `
window.__探 = {
  落点表: async () => {
    const 真 = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/lib/dropzones.svelte.ts'));
    const m = await import(真 || '/src/lib/dropzones.svelte.ts');
    return { 实例: 真 ? '页面自己那份' : '裸路径', ids: m.zoneIds(), 落点: m.listZones().map((z) => ({
      id: z.id, 收: z.accept ?? '（图片）', dir: !!z.dir,
      矩形: z.el ? (() => { const r = z.el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); })() : null
    })) };
  },
  错: () => (document.querySelector('.side__err')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
  清错: () => { window.__假.报错记录 = []; document.querySelector('.side__errx')?.click(); },
  原生: (类型, 载荷) => {
    const cb = window.__假.监听['tauri://drag-' + 类型];
    if (!cb) return '（没有监听）';
    cb({ event: 'tauri://drag-' + 类型, id: 1, payload: 载荷 });
    return 'ok';
  },
  原生拖放: (x, y, 路径) => {
    const d = devicePixelRatio || 1;
    const p = { x: x * d, y: y * d };
    window.__探.原生('enter', { paths: [], position: p });
    window.__探.原生('over', { position: p });
    const 错1 = window.__探.错();
    window.__探.原生('drop', { paths: [路径], position: p });
    return { 派发: [Math.round(x), Math.round(y)], over后错: 错1 };
  },
  /** 只来 drop、不来 over：用户"拖进来就撒手" */
  裸drop: (x, y, 路径) => {
    const d = devicePixelRatio || 1;
    window.__探.原生('drop', { paths: [路径], position: { x: x * d, y: y * d } });
    return { 派发: [Math.round(x), Math.round(y)] };
  },
  中: (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }; }
};
'ok'
`;

const 页表 = [['fix', '① 文本'], ['batch', '① 文件'], ['names', '① 名称'], ['fx', '① .fx 注释']];
for (const [p, 名] of 页表) {
  await rpc('Page.navigate', { url: `${APP}/tools/glitch?panel=${p}` });
  await 等(3200);
  await 跑(工具);
  await 跑('window.__探.清错()');
  const 表 = await 跑('window.__探.落点表()');
  const 位 = await 跑(`window.__探.中('.wb__main')`);
  console.log(`\n==== ${名}（panel=${p}） 工作区=${JSON.stringify(位)} ====`);
  console.log('落点:', JSON.stringify(表));
  if (!位) { console.log('（没有 .wb__main）'); continue; }
  await 跑(`window.__探.原生拖放(${位.x}, ${位.y}, 'D:\\\\别处\\\\一个材质.fx')`);
  await 等(1100);
  console.log('原生 enter→over→drop 之后侧栏:', JSON.stringify(await 跑('window.__探.错()')));
  await 跑('window.__探.清错()');
  await 跑(`window.__探.裸drop(${位.x}, ${位.y}, 'D:\\\\别处\\\\两个材质.fx')`);
  await 等(1100);
  console.log('原生 裸drop（无 over）之后侧栏:', JSON.stringify(await 跑('window.__探.错()')));
}
ws.close();
