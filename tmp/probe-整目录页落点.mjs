/**
 * 探针：那三页"整目录活"的落点 —— 拖文件夹进去要真的等于点了「选目录」。
 *
 * 改之前（`tmp\recon-全页落点.mjs` 量的）：⑦批量提取 / ⑦批量 / ⑤配对检查 **一个落点都没有**，
 * 拖进去只会得到那句"没落在能接它的地方 —— 拖到有落点的位置"。
 *
 * 判据三条：
 *   1. 这三页的注册表里有 `dir` 落点；
 *   2. 拖文件夹进去 → 真去扫了（`scan_dir` 调到、带的是拖进去的那个路径）；
 *   3. 拖**文件**进去 → 不落（`dir` 落点只收文件夹），也别静默。
 *
 * 用法（先 `pnpm dev` 起 1420，再无头 Chrome 开 9500）：
 *   $env:CDP_PORT='9500'; node tmp\probe-整目录页落点.mjs
 */
const PORT = process.env.CDP_PORT ?? '9500';
const BASE = `http://127.0.0.1:${PORT}`;
const APP = process.env.DEV_ORIGIN ?? 'http://127.0.0.1:1420';

const 桩 = `
(() => {
  window.__假 = { 调用: [], 监听: {} };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      const a = args || {};
      window.__假.调用.push(cmd + (a.root ? ' ' + a.root : a.path ? ' ' + a.path : ''));
      if (cmd === 'plugin:event|listen') { window.__假.监听[a.event] = window['_' + a.handler]; return 1; }
      if (cmd === 'plugin:event|unlisten') return null;
      if (cmd === 'scan_dir') return [{ path: 'D:\\\\别处\\\\目录里\\\\a.png', name: 'a.png', rel: 'a.png', ext: 'png', size: 10 }];
      /* 按路径答：没有后缀的当目录，有后缀的当文件 —— 好把"拖文件进来"那条也量到 */
      if (cmd === 'probe_dir') {
        const p = a.path || '';
        const 底 = p.split(/[\\/]/).pop() || '';
        return { exists: true, is_dir: !/\.[a-z0-9]+$/i.test(底), entries: 1, names: ['a.png'] };
      }
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
const rpc = (m, p = {}) =>
  new Promise((res, rej) => {
    const my = ++id;
    const 定时 = setTimeout(() => { ws.removeEventListener('message', on); rej(new Error('CDP 超时 ' + m)); }, 60000);
    const on = (e) => {
      const j = JSON.parse(e.data);
      if (j.id !== my) return;
      clearTimeout(定时);
      ws.removeEventListener('message', on);
      j.error ? rej(new Error(JSON.stringify(j.error))) : res(j.result);
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id: my, method: m, params: p }));
  });
const 跑 = async (e) => {
  const r = await rpc('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
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
    return m.listZones().map((z) => ({ id: z.id, dir: !!z.dir }));
  },
  调用: () => window.__假.调用.slice(),
  清: () => { window.__假.调用 = []; },
  丢: async (路径) => {
    const w = document.querySelector('.wb__main');
    if (!w) return '（没有工作区）';
    const r = w.getBoundingClientRect();
    const d = devicePixelRatio || 1;
    const 位 = { x: Math.round((r.left + r.width / 2) * d), y: Math.round((r.top + r.height / 2) * d) };
    const 发 = (ty, 载荷) => {
      const cb = window.__假.监听['tauri://drag-' + ty];
      if (!cb) return '（没有监听）';
      cb({ event: 'tauri://drag-' + ty, id: 1, payload: 载荷 });
      return 'ok';
    };
    发('enter', { paths: [路径], position: 位 });
    发('over', { position: 位 });
    /* **让一拍再 drop**：enter 那一下是"点火即走"地问盘（是不是目录），
       真机上拖拽过程有几百毫秒足够它回来；这里同一 tick 里连着发就永远读不到。
       （这条也说明那个修法**依赖 enter 先到 + 中间有时间** —— 真机满足，合成事件不满足。） */
    await new Promise((r2) => setTimeout(r2, 150));
    发('drop', { paths: [路径], position: 位 });
    return 'ok';
  },
  坏话: () => (document.querySelector('.side__err')?.textContent ?? '').replace(/\\s+/g, ' ').trim()
};
'ok'
`;

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) bad++; console.log(`${c ? '✅' : '❌'} ${m}`); };

const 页 = [
  ['/tools/channels?panel=pipeline', '⑦批量提取'],
  ['/tools/channels?panel=batch', '⑦批量'],
  ['/tools/ilm?panel=pairing', '⑤配对检查']
];

const 拖的目录 = 'D:\\别处\\一个模型目录';

for (const [路由, 名] of 页) {
  await rpc('Page.navigate', { url: APP + 路由 });
  await 等(3600);
  await 跑(工具);
  const 表 = await 跑('window.__探.落点表()');
  ok(Array.isArray(表) && 表.some((z) => z.dir), `${名} 注册了 dir 落点 —— ${JSON.stringify(表)}`);

  await 跑('window.__探.清()');
  await 跑(`window.__探.丢(${JSON.stringify(拖的目录)})`);
  await 等(1500);
  const 调 = await 跑('window.__探.调用()');
  const 扫了 = (调 || []).filter((x) => x.startsWith('scan_dir'));
  ok(扫了.some((x) => x.includes(拖的目录)), `${名} 拖文件夹进去真去扫了那个路径 —— ${JSON.stringify(扫了)}`);
  const 坏 = await 跑('window.__探.坏话()');
  ok(!/没落在能接/.test(坏), `${名} 不再说"没落在能接它的地方" —— ${JSON.stringify(坏)}`);

  /* 乙：拖一个**文件**进来 —— `dir` 落点只收文件夹，别被当目录交下去。
     （这条是 2026-09-25 三个只读审查各自独立报的：`收得下()` 原来对 dir 落点恒真。） */
  await 跑('window.__探.清()');
  await 跑(`window.__探.丢('D:\\\\别处\\\\一张图.png')`);
  await 等(1500);
  const 调2 = await 跑('window.__探.调用()');
  const 坏2 = await 跑('window.__探.坏话()');
  ok(!(调2 || []).some((x) => x.startsWith('scan_dir')), `${名} 拖**文件**进来没被当目录扫 —— ${JSON.stringify(调2)}`);
  ok(/是文件/.test(坏2), `${名} 拖文件进来说清了"这一处收的是文件夹" —— ${JSON.stringify(坏2)}`);
}

console.log(`\n==== 整目录页落点 ${n - bad}/${n} 条通过 ====`);
ws.close();
process.exitCode = bad ? 1 : 0;
