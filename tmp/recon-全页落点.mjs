/** 侦察：全部功能页 × 分区，各有多少「通用落点」和图片槽（临时脚本，跑完可删） */
const PORT = process.env.CDP_PORT ?? '9500';
const BASE = `http://127.0.0.1:${PORT}`;
const APP = process.env.DEV_ORIGIN ?? 'http://127.0.0.1:1420';

const 桩 = `
(() => {
  window.__假 = { 调用: [], 监听: {} };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      window.__假.调用.push(cmd);
      if (cmd === 'plugin:event|listen') { window.__假.监听[args.event] = window['_' + args.handler]; return 1; }
      if (cmd === 'plugin:event|unlisten') return null;
      if (cmd === 'read_text_fixed') return { text: 'a', original: 'a', encoding: 'shift_jis', changed: false, lossy: false, bom: false, segments: [] };
      if (cmd === 'read_text_file') return { text: 'a', encoding: 'shift_jis', lossy: false, bom: false };
      if (cmd === 'repair_text') return { original: 'a', fixed: 'a', changed: false, via: 'shift_jis', score_after: 0, score_before: 0, attempts: [], segments: [] };
      if (cmd === 'scan_pieces') return [];
      if (cmd === 'probe_dir') return { exists: true, is_dir: true, entries: 0, names: [] };
      if (cmd === 'scan_text_files') return [];
      if (cmd === 'scan_names') return [];
      if (cmd === 'scan_dir') return [];
      if (cmd === 'load_prefs' || cmd === 'prefs') return {};
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
  if (r.exceptionDetails) return { 抛错: r.exceptionDetails.text };
  return r.result.value;
};
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: 桩 });

const 查 = `(async () => {
  const 真 = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/lib/dropzones.svelte.ts'));
  const m = await import(真 || '/src/lib/dropzones.svelte.ts');
  const 槽 = [...document.querySelectorAll('[data-drop-key]')].map((el) => el.dataset.dropKey);
  const 主 = document.querySelector('.wb__main');
  return { 通用落点: m.zoneIds(), 图片槽: 槽, 有工作区: !!主 };
})()`;

const 页表 = [
  ['/tools/recent?panel=list', '最近工程'],
  ['/tools/quick?panel=pin', '快捷动作'],
  ['/tools/channels?panel=extract', '⑦通道提取'],
  ['/tools/channels?panel=pipeline', '⑦批量提取'],
  ['/tools/channels?panel=layers', '⑦图层与蒙版'],
  ['/tools/channels?panel=adjust', '⑦调整'],
  ['/tools/channels?panel=blend', '⑦混合'],
  ['/tools/channels?panel=split', '⑦分离'],
  ['/tools/channels?panel=merge', '⑦合并'],
  ['/tools/channels?panel=swizzle', '⑦调换'],
  ['/tools/channels?panel=batch', '⑦批量'],
  ['/tools/ilm?panel=pack', '⑤打包'],
  ['/tools/ilm?panel=pairing', '⑤配对检查'],
  ['/tools/mstoon?panel=pack', '④lightmap'],
  ['/tools/mstoon?panel=shadowrate', '④ShadowRate'],
  ['/tools/mstoon?panel=sublight', '④SubLight'],
  ['/tools/mstoon?panel=edge', '④EdgeRate'],
  ['/tools/mstoon?panel=facesdf', '④FaceSDF'],
  ['/tools/ikclut?panel=clut', '②生成'],
  ['/tools/ikclut?panel=blend', '②混合'],
  ['/tools/ikclut?panel=export', '②导出'],
  ['/tools/glitch?panel=fix', '①文本'],
  ['/tools/glitch?panel=batch', '①文件'],
  ['/tools/glitch?panel=fx', '①.fx注释'],
  ['/tools/glitch?panel=names', '①名称'],
  ['/tools/ray?panel=conf', '③配置开关'],
  ['/tools/ray?panel=material', '③材质参数'],
  ['/tools/yaku?panel=match', '⑥材质匹配'],
  ['/tools/yaku?panel=apply', '⑥写入'],
  ['/tools/migrate?panel=repair', '⑨修复工程'],
  ['/tools/migrate?panel=pack', '⑨打包迁移']
];

const 行 = [];
for (const [路由, 名] of 页表) {
  await rpc('Page.navigate', { url: `${APP}${路由}` });
  await 等(2600);
  const r = await 跑(查);
  行.push({ 页: 名, 路由: 路由.replace('/tools/', ''), 通用落点: (r?.通用落点 ?? []).join(',') || '—— 没有', 图片槽数: (r?.图片槽 ?? []).length });
  console.log(`${名.padEnd(12)} ${路由.padEnd(38)} 通用落点=${(r?.通用落点 ?? []).join(',') || '（没有）'}  图片槽=${(r?.图片槽 ?? []).length}`);
}
console.log('\n没有通用落点的分区:', 行.filter((x) => x.通用落点 === '—— 没有').map((x) => x.页).join(' 、 '));
ws.close();
