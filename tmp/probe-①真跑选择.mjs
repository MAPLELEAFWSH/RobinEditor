/**
 * 探针：①「文件」栏 /「.fx 注释」栏的**试跑 / 真跑选择在主区上够得着**。
 *
 * 用户 2026-09-25："文本的文件处理只有试跑没有真正处理选择"。
 * 真因：那颗「先试跑不写盘」的开关画在**参数抽屉**里，而抽屉默认收起 ——
 * 页面上只看得到一颗写着「试跑」的按钮，压根没地方选真跑。
 *
 * 判据：
 *   1. 抽屉**关着**的时候，主区上就有那排「先试跑 / 真跑（写盘）」；
 *   2. 点「真跑（写盘）」→ 主按钮文案变成「开跑（原地改）」；
 *   3. 再点回「先试跑」→ 主按钮变回「试跑」；
 *   4. 那不是"另一份状态"：抽屉里那行读数跟着变（同一个属主）。
 *
 * 用法（先 `pnpm dev` 起 1420，再无头 Chrome 开 9500）：
 *   $env:CDP_PORT='9500'; node tmp\probe-①真跑选择.mjs
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
      if (cmd === 'probe_dir') return { exists: true, is_dir: true, entries: 1, names: ['a.fx'] };
      if (cmd === 'scan_text_files') return [{ path: 'D:\\\\别处\\\\一个目录\\\\a.fx', rel: 'a.fx', likely: true, via: 'shift_jis', sample_before: 'x', sample_after: 'y', uncertain: [] }];
      if (cmd === 'scan_names') return [];
      if (cmd === 'scan_dir') return [{ path: 'D:\\\\别处\\\\一个目录\\\\a.fx', name: 'a.fx', rel: 'a.fx', ext: 'fx', size: 10 }];
      if (cmd === 'fix_text_file') return { path: a.path, rel: 'a.fx', encoding: 'shift_jis', changed: true, via: 'shift_jis', lines: [1], before_sample: 'x', after_sample: 'y', written: !!a.write, backup: null, error: null };
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

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) bad++; console.log(`${c ? '✅' : '❌'} ${m}`); };

/** 抽屉是不是收着的（`.wb__side` 被 translateX 推到视口外就是收起） */
const 瞅 = `(() => {
  const 文 = (el) => (el && el.textContent ? el.textContent : '').replace(/\\s+/g, ' ').trim();
  const 条 = document.querySelector('.wb__main .wb__acts');
  const 抽 = document.querySelector('.wb__side');
  const 抽左边 = 抽 ? Math.round(抽.getBoundingClientRect().left) : null;
  return {
    抽屉在视口里: 抽左边 !== null && 抽左边 < innerWidth,
    条上有这些: 条 ? [...条.querySelectorAll('button')].map(文) : [],
    主按钮: 条 ? 文([...条.querySelectorAll('button')].find((b) => b.classList.contains('btn--primary'))) : '(没有条)',
    抽屉读数: [...document.querySelectorAll('.wb__side .mini')].map(文).filter((x) => /试跑|真跑/.test(x))
  };
})()`;

const 点 = (文案) => `(() => {
  const b = [...document.querySelectorAll('.wb__main .wb__acts button')].find((x) => (x.textContent || '').trim() === ${JSON.stringify('')} || (x.textContent || '').trim().startsWith(${JSON.stringify(文案)}));
  if (!b) return '（主区那条上没有这一颗）';
  b.click();
  return 'ok';
})()`;

const 页 = [
  ['文件', '/tools/glitch?panel=batch', '选目录'],
  ['.fx 注释', '/tools/glitch?panel=fx', '选 Ray / MME 目录']
];

for (const [栏, 路由, 入口] of 页) {
  console.log(`\n==== ${栏}栏（${路由}）====`);
  await rpc('Page.navigate', { url: APP + 路由 });
  await 等(3800);

  const 甲 = await 跑(瞅);
  ok(甲.抽屉在视口里 === false, `抽屉默认是收着的（${JSON.stringify(甲.抽屉在视口里)}）`);
  ok(甲.条上有这些.some((x) => x.startsWith('先试跑')), `条上有「先试跑」—— ${JSON.stringify(甲.条上有这些)}`);
  ok(甲.条上有这些.some((x) => x.startsWith('真跑')), `条上有「真跑（写盘）」—— 这就是原来缺的那个选择`);
  ok(甲.主按钮 === '试跑', `默认主按钮是「试跑」（${JSON.stringify(甲.主按钮)}）`);

  await 跑(点('真跑'));
  await 等(500);
  const 乙 = await 跑(瞅);
  ok(乙.主按钮.startsWith('开跑'), `点了「真跑」之后主按钮变成开跑 —— ${JSON.stringify(乙.主按钮)}`);
  ok(乙.抽屉读数.some((x) => x.includes('真跑')), `抽屉那行读数跟着变（同一个属主，不是两份状态）—— ${JSON.stringify(乙.抽屉读数)}`);

  await 跑(点('先试跑'));
  await 等(500);
  const 丙 = await 跑(瞅);
  ok(丙.主按钮 === '试跑', `点回「先试跑」主按钮回到试跑 —— ${JSON.stringify(丙.主按钮)}`);
}

console.log(`\n==== 真跑选择 ${n - bad}/${n} 条通过 ====`);
ws.close();
process.exitCode = bad ? 1 : 0;
