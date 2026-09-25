/**
 * 探针：① 的**四个分栏各自都能选编码**，而且选了**真的传到后端**。
 *
 * 用户 2026-09-24："那几个文本的分栏都应该按日文的几个编码选择还原啊，
 * 名称，文本，文件，注释可选，这些已经是之前的要求你根本没做好"。
 *
 * 验三件事：
 *   1. 每一栏都画着那排按钮（自动认 / Shift-JIS / EUC-JP / UTF-8）；
 *   2. **在哪儿选就在哪儿生效**：在某一栏点 Shift-JIS，invoke 过去的 `目标编码` 就是 shift_jis；
 *   3. **切栏不丢**：在「文件」栏选 EUC-JP，切到「名称」栏那一颗还是按下的。
 *
 * 用法（先 `pnpm dev` 起 1420，再无头 Chrome 开 9500）：
 *   $env:CDP_PORT='9500'; node tmp\probe-①四栏编码.mjs
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
      /* 只记带 目标编码 的那几条命令的参数，这就是"选的那一档有没有传到后端" */
      window.__假.调用.push({ cmd, 目标编码: a.目标编码 ?? null, 根: a.root ?? a.path ?? null });
      if (cmd === 'plugin:event|listen') { window.__假.监听[a.event] = window['_' + a.handler]; return 1; }
      if (cmd === 'plugin:event|unlisten') return null;
      if (cmd === 'probe_dir') return { exists: true, is_dir: true, entries: 1, names: ['a.fx'] };
      if (cmd === 'scan_text_files') return [];
      if (cmd === 'scan_names') return [];
      if (cmd === 'scan_dir') return [{ path: 'D:\\\\别处\\\\a.fx', name: 'a.fx', rel: 'a.fx', ext: 'fx', size: 10 }];
      if (cmd === 'read_text_fixed') return { text: 'a', original: 'a', encoding: 'shift_jis', bom: false, changed: false, segments: [] };
      if (cmd === 'repair_text') return { original: 'a', fixed: 'a', changed: false, via: 'none', score_after: 0, score_before: 0, attempts: [], segments: [] };
      if (cmd === 'scan_pieces') return [];
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
    const 定时 = setTimeout(() => { ws.removeEventListener('message', on); rej(new Error('CDP 超时 ' + method)); }, 60000);
    const on = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== my) return;
      clearTimeout(定时);
      ws.removeEventListener('message', on);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id: my, method, params }));
  });
const 跑 = async (表达式) => {
  const r = await rpc('Runtime.evaluate', { expression: r2(表达式), returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};
function r2(e) { return e; }
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: 桩 });

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) bad++; console.log(`${c ? '✅' : '❌'} ${m}`); };

const 工具 = `
window.__探 = {
  编码按钮: () => [...document.querySelectorAll('.wb__main .pick__b, .card.pad .pick__b')]
    .map((b) => ({ 名: (b.textContent || '').trim(), 按下: b.getAttribute('aria-pressed') === 'true' }))
    .filter((b) => /自动认|Shift-JIS|EUC-JP|UTF-8/.test(b.名)),
  点编码: (名) => {
    const b = [...document.querySelectorAll('button.pick__b')].find((x) => (x.textContent || '').trim() === 名);
    if (!b) return '（没找到那一颗）';
    b.click();
    return 'ok';
  },
  调用: () => window.__假.调用.slice(),
  清: () => { window.__假.调用 = []; },
  /** 从 Tauri 那条通道丢一个文件夹进来（走那一栏自己的目录活） */
  丢目录: (路径) => {
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
    发('drop', { paths: [路径], position: 位 });
    return 'ok';
  }
};
'ok'
`;

/** 切到某一栏（用顶上分区条） */
const 到栏 = (标签) => `(async () => {
  const b = [...document.querySelectorAll('.seg__btn')].find((x) => {
    const l = x.querySelector('.seg__label');
    return ((l ? l.textContent : x.textContent) || '').trim() === ${JSON.stringify(标签)};
  });
  if (b) b.click();
  await new Promise((r) => setTimeout(r, 1300));
  return location.pathname + location.search;
})()`;

await rpc('Page.navigate', { url: `${APP}/tools/glitch?panel=fix` });
await 等(3600);
await 跑(工具);

const 四栏 = [
  ['文本', 'fix'],
  ['文件', 'batch'],
  ['名字还原', 'names'],
  ['.fx 注释', 'fx']
];

console.log('==== 甲、每一栏都画着那排按钮 ====');
for (const [标签, 面板] of 四栏) {
  const 址 = await 跑(到栏(标签));
  await 跑(工具);
  const 钮 = await 跑('window.__探.编码按钮()');
  ok(Array.isArray(钮) && 钮.length === 4 && 钮.some((b) => b.按下),
    `${标签}栏（${面板}）有 4 颗编码按钮、且有一颗是按下的 —— ${JSON.stringify(钮.map((b) => b.名))}`);
}

console.log('\n==== 乙、在哪儿选就在哪儿生效（选中要传到后端）====');
/* 在「文件」栏选 Shift-JIS，然后拖个目录进去 —— scan_text_files 该带 shift_jis */
await 跑(到栏('文件'));
await 跑(工具);
await 跑('window.__探.点编码("Shift-JIS")');
await 跑('window.__探.清()');
await 跑(`window.__探.丢目录('D:\\\\别处\\\\一个目录')`);
await 等(1200);
let 调 = await 跑('window.__探.调用()');
let 扫 = (调 || []).filter((x) => x.cmd === 'scan_text_files');
ok(扫.length > 0 && 扫.every((x) => x.目标编码 === 'shift_jis'),
  `「文件」栏选 Shift-JIS → scan_text_files 带的目标编码=${JSON.stringify(扫.map((x) => x.目标编码))}`);

/* 在「名称」栏选 EUC-JP，拖目录 —— scan_names 该带 euc-jp */
await 跑(到栏('名字还原'));
await 跑(工具);
await 跑('window.__探.点编码("EUC-JP")');
await 跑('window.__探.清()');
await 跑(`window.__探.丢目录('D:\\\\别处\\\\一个目录')`);
await 等(1200);
调 = await 跑('window.__探.调用()');
扫 = (调 || []).filter((x) => x.cmd === 'scan_names');
ok(扫.length > 0 && 扫.every((x) => x.目标编码 === 'euc-jp'),
  `「名称」栏选 EUC-JP → scan_names 带的目标编码=${JSON.stringify(扫.map((x) => x.目标编码))}`);

/* .fx 注释栏选 UTF-8，拖目录 —— fix_text_file 该带 utf-8 */
await 跑(到栏('.fx 注释'));
await 跑(工具);
await 跑('window.__探.点编码("UTF-8")');
await 跑('window.__探.清()');
await 跑(`window.__探.丢目录('D:\\\\别处\\\\一个目录')`);
await 等(1500);
调 = await 跑('window.__探.调用()');
扫 = (调 || []).filter((x) => x.cmd === 'fix_text_file');
ok(扫.length > 0 && 扫.every((x) => x.目标编码 === 'utf-8'),
  `「.fx 注释」栏选 UTF-8 → fix_text_file 带的目标编码=${JSON.stringify(扫.map((x) => x.目标编码))}`);

console.log('\n==== 丙、切栏不丢（四栏共用同一个选择）====');
const 切后 = [];
for (const [标签] of 四栏) {
  await 跑(到栏(标签));
  await 跑(工具);
  const 钮 = await 跑('window.__探.编码按钮()');
  const 按下 = (钮 || []).filter((b) => b.按下).map((b) => b.名);
  切后.push(`${标签}=${JSON.stringify(按下)}`);
}
ok(切后.every((x) => x.includes('UTF-8')), `刚才在 .fx 注释栏选的 UTF-8，四栏都还按着：${切后.join('  ')}`);

console.log(`\n==== 四栏编码 ${n - bad}/${n} 条通过 ====`);
ws.close();
process.exitCode = bad ? 1 : 0;
