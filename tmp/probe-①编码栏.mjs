/**
 * 探针：①「文本」栏的"先选编码 → 再选修什么"这一套，接得对不对。
 *
 * 量三件事（都无头）：
 *   ① 两个控件组在不在：**原文是什么日文编码**（自动认 / Shift-JIS / EUC-JP / UTF-8）
 *      与**要修哪一样**（文本 / 文件 / 名称 / .fx 注释）；
 *   ② 选一档编码再点「还原」，**传到后端的是不是那一档** ——
 *      桩把 `repair_text` 的参数原样记下来，这是"接上了"唯一的硬证据；
 *   ③ 点「要修哪一样」里的别的目标，**分区真的切过去**（地址栏 + 那一页的读数）。
 *
 * 用法（先 `pnpm dev` 起 1420，再无头 Chrome 开 9400）：
 *   node tmp\probe-①编码栏.mjs [视口]
 */
const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const 视口 = process.argv[2] ?? '1707x1067';
const app = 'http://127.0.0.1:1420';

const 桩 = `
(() => {
  const 量 = window.__量 = { 报错: [], 调用: [] };
  window.addEventListener('error', (e) => 量.报错.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => 量.报错.push('rejection ' + String(e.reason)));

  /* 假后端：把命令名与参数原样记下来，再回一个"没认出乱码"的空结果 */
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      量.调用.push({ cmd, args });
      if (cmd === 'repair_text' || cmd === 'repair_text_forced') {
        return {
          score_before: 0, score_after: 0,
          original: args?.text ?? '', fixed: args?.text ?? '',
          changed: false, via: 'none', attempts: [], segments: []
        };
      }
      if (cmd === 'plugin:dialog|open') return 'E:\\\\假\\\\一个.fx';
      if (cmd === 'plugin:dialog|save') return null;
      if (cmd === 'read_text_file') return { text: '', encoding: 'utf-8', lossy: false, bom: false };
      if (cmd === 'read_text_fixed') return { path: 'x', text: '', encoding: 'utf-8', bom: false, segments: [] };
      if (cmd === 'probe_dir') return { exists: true, is_dir: false, entries: 0, names: [] };
      if (cmd === 'scan_text_files' || cmd === 'scan_names') return [];
      return null;
    },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window['_' + id] = cb; return id; },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } }
  };

  const 文 = (el) => (el?.textContent ?? '').replace(/\\s+/g, ' ').trim();

  /** 页面上有哪几组按钮（按 .pick 分组报出来） */
  window.__控件 = () => {
    const 组 = [];
    for (const p of document.querySelectorAll('.wb__main .pick')) {
      const 行 = p.closest('.row');
      组.push({
        标签: 文(行?.querySelector('.row__k')) || '(没有行标签)',
        按钮: [...p.querySelectorAll('.pick__b')].map((b) => ({
          字: 文(b),
          按下: b.getAttribute('aria-pressed') === 'true'
        }))
      });
    }
    return {
      组,
      说明行: [...document.querySelectorAll('.wb__main .mini')].slice(0, 4).map(文),
      地址: location.pathname + location.search
    };
  };

  window.__点 = (选择器, 字) => {
    const el = [...document.querySelectorAll(选择器)].find((x) => 文(x) === 字 || 文(x).includes(字));
    if (!el) return { 错: '找不到 ' + 选择器 + ' 里含「' + 字 + '」的' };
    el.click();
    return { 点了: 文(el) };
  };

  /** 往文本框里塞一段乱码，再点「还原」 */
  window.__跑一段 = async (文本) => {
    const ta = document.querySelector('textarea');
    if (!ta) return { 错: '这一页没有 textarea' };
    const d = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    d.set.call(ta, 文本);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(r));
    const b = [...document.querySelectorAll('button')].find((x) => 文(x) === '还原');
    if (!b) return { 错: '找不到「还原」' };
    b.click();
    await new Promise((r) => setTimeout(r, 900));
    const 这次 = 量.调用.filter((c) => c.cmd === 'repair_text' || c.cmd === 'repair_text_forced');
    return {
      发了几个修复请求: 这次.length,
      最后一次: 这次.at(-1) ? { cmd: 这次.at(-1).cmd, 目标编码: 这次.at(-1).args?.目标编码 ?? null } : null,
      全部请求: 这次.map((c) => ({ cmd: c.cmd, 目标编码: c.args?.目标编码 ?? null }))
    };
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
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Emulation.setDeviceMetricsOverride', {
  width: Number(视口.split('x')[0]), height: Number(视口.split('x')[1]), deviceScaleFactor: 1, mobile: false
});
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: 桩 });
const 跑 = async (表达式, 等待 = true) => {
  const r = await rpc('Runtime.evaluate', { expression: 表达式, returnByValue: true, awaitPromise: 等待 });
  if (r.exceptionDetails) return { 页面抛错: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  return r.result.value;
};
const 表 = (标签, v) => console.log(`\n---- ${标签} ----\n${JSON.stringify(v, null, 1)}`);

console.log(`==== ① 编码栏 · 视口 ${视口} ====`);
await rpc('Page.navigate', { url: `${app}/tools/glitch?panel=fix` });
await 等(6000);
表('① 文本栏的控件组', await 跑('window.__控件()', false));

console.log('\n==== ② 选「Shift-JIS」再跑一段，看传到后端的是什么 ====');
表('点 Shift-JIS', await 跑(`window.__点('.pick__b', 'Shift-JIS')`, false));
表('跑一段真乱码', await 跑(`window.__跑一段('傾僯儊晽夋柺僗僋儕乕ン')`));

console.log('\n==== ③ 换回「自动认」再跑一段 ====');
表('点 自动认', await 跑(`window.__点('.pick__b', '自动认')`, false));
表('跑一段', await 跑(`window.__跑一段('僐儞僩儘乕儔乕')`));

console.log('\n==== ④ 点「要修哪一样」里的别的目标，看切不切页 ====');
for (const 目标 of ['文件', '名称', '.fx 注释']) {
  表(`点「${目标}」`, await 跑(`window.__点('.pick__b', ${JSON.stringify(目标)})`, false));
  await 等(3000);
  表(`切过去之后（${目标}）`, await 跑(`({
    地址: location.pathname + location.search,
    有工作区: !!document.querySelector('.wb__main'),
    编码读数: (document.querySelector('.wb__main .mini')?.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 60),
    主按钮文字: [...document.querySelectorAll('.btn--primary')].map((b) => (b.textContent || '').trim()).slice(0, 3)
  })`, false));
  /* 切回文本栏继续下一轮 */
  await rpc('Page.navigate', { url: `${app}/tools/glitch?panel=fix` });
  await 等(4000);
}

console.log('\n==== ⑤ 页面报错 ====');
表('报错', await 跑('window.__量.报错', false));
ws.close();
