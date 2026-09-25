/**
 * 探针：①「文本」栏那句警告 —— 现在有没有叉、会不会自己走。
 *
 * 改之前实测（打包版真机）：`有叉=false`、12 秒后**还在**、也没有叉可点。
 * 判据：
 *   · 出现之后 `.note__x` 存在（能手动关）；
 *   · 点一下叉，它立刻走；
 *   · 再来一次、不碰它，**9 秒那档到点自己走**（等到 11 秒仍然在就是没改对）。
 *
 * 不用打包版也能量：那条警告是模板层的东西，假后端给个 `probe_dir` 说"这不是目录"
 * 就走到了。
 *
 * 用法（先 `pnpm dev` 起 1420，再无头 Chrome 开 9500）：
 *   $env:CDP_PORT='9500'; node tmp\probe-①警告框-开发版.mjs
 */
const PORT = process.env.CDP_PORT ?? '9500';
const BASE = `http://127.0.0.1:${PORT}`;
const APP = process.env.DEV_ORIGIN ?? 'http://127.0.0.1:1420';

const 桩 = `
(() => {
  window.__假 = { 监听: {} };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      const a = args || {};
      if (cmd === 'plugin:event|listen') { window.__假.监听[a.event] = window['_' + a.handler]; return 1; }
      if (cmd === 'plugin:event|unlisten') return null;
      if (cmd === 'probe_dir') return { exists: true, is_dir: false, entries: 0, names: [] };
      if (cmd === 'read_text_fixed') return { text: 'a', original: 'a', encoding: 'shift_jis', bom: false, changed: false, segments: [] };
      if (cmd === 'repair_text') return { original: 'a', fixed: 'a', changed: false, via: 'shift_jis', score_after: 0, score_before: 0, attempts: [], segments: [] };
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

let bad = 0;
let n = 0;
const ok = (c, m) => {
  n++;
  if (!c) bad++;
  console.log(`${c ? '✅' : '❌'} ${m}`);
};

await rpc('Page.navigate', { url: `${APP}/tools/glitch?panel=fix` });
await 等(3600);

/** 派一次原生拖放：丢一个 .png 上去（「文本」栏收不了它 → 冒出一句警告） */
const 弄一条警告 = `(async () => {
  const w = document.querySelector('.wb__main');
  if (!w) return '（不在工作区版面上）';
  const r = w.getBoundingClientRect();
  const d = devicePixelRatio || 1;
  const 位 = { x: Math.round((r.left + r.width / 2) * d), y: Math.round((r.top + r.height / 2) * d) };
  const 发 = (类型, 载荷) => {
    const cb = window.__假.监听['tauri://drag-' + 类型];
    if (!cb) return '（没有监听）';
    cb({ event: 'tauri://drag-' + 类型, id: 1, payload: 载荷 });
    return 'ok';
  };
  发('enter', { paths: ['D:\\\\别处\\\\一张图.png'], position: 位 });
  发('drop', { paths: ['D:\\\\别处\\\\一张图.png'], position: 位 });
  await new Promise((x) => setTimeout(x, 1200));
  const note = document.querySelector('.note--warn');
  return note ? { 话: note.textContent.replace(/\\s+/g, ' ').trim().slice(0, 40), 有叉: !!note.querySelector('.note__x') } : '（没有警告冒出来）';
})()`;

const 看警告 = `(() => {
  const note = document.querySelector('.note--warn');
  if (!note) return '（没有警告条）';
  return { 话: note.textContent.replace(/\\s+/g, ' ').trim().slice(0, 40), 有叉: !!note.querySelector('.note__x') };
})()`;

console.log('==== 甲、有叉、点一下就走 ====');
console.log('弄出来：', JSON.stringify(await 跑(弄一条警告)));
const 甲1 = await 跑(看警告);
ok(typeof 甲1 === 'object' && 甲1.有叉, `警告条上有叉了（之前实测是没有的）—— ${JSON.stringify(甲1)}`);
console.log('点那个叉：', await 跑(`(() => { const x = document.querySelector('.note--warn .note__x'); if (!x) return '（没有叉）'; x.click(); return '点了'; })()`));
await 等(600);
const 甲2 = await 跑(看警告);
ok(甲2 === '（没有警告条）', `点完叉它立刻走了 —— ${JSON.stringify(甲2)}`);

console.log('\n==== 乙、不碰它，9 秒那档到点自己走 ====');
console.log('再弄一条：', JSON.stringify(await 跑(弄一条警告)));
const 乙1 = await 跑(看警告);
ok(typeof 乙1 === 'object', `警告条在 —— ${JSON.stringify(乙1)}`);
console.log('等着，不碰它…（到 11 秒再看）');
await 等(11000);
const 乙2 = await 跑(看警告);
ok(乙2 === '（没有警告条）', `自己走了（改之前 12 秒后还在）—— ${JSON.stringify(乙2)}`);

console.log(`\n==== ${n - bad}/${n} 条通过 ====`);
ws.close();
process.exitCode = bad ? 1 : 0;
