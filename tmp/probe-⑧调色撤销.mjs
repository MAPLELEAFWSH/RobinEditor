/**
 * 探针：⑧ ② 调色「按步撤销」端到端 —— 无头浏览器里真改参数、真点按钮、真按 Ctrl+Z。
 *
 * 单测（`tmp\调色-撤销.test.mjs`）测的是纯逻辑；这里补三件只有浏览器能验的：
 *   ① **快照是深拷的**：改完参数撤销，滑杆的值要真的回到旧值（浅拷的话回不去）；
 *   ② **一次连续操作 = 一步**：连着改十下，读数只该多一格；
 *   ③ **撤销自己不会被记成一步**：撤销之后静置，格数不许长。
 *
 * 用法（先 `pnpm dev` 起 1420，再无头 Chrome 开 9400）：node tmp\probe-⑧调色撤销.mjs
 */
const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const app = 'http://127.0.0.1:1420';

const 桩 = `
(() => {
  const 量 = window.__量 = { 报错: [] };
  window.addEventListener('error', (e) => 量.报错.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => 量.报错.push('rejection ' + String(e.reason)));
  /* 假后端：读图（64×64 的小图，够用）+ 选文件对话框。用来验"载入参考图也是一步" */
  const W = 64, H = 64;
  const buf = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < buf.length; i += 4) { buf[i] = (i * 3) & 255; buf[i + 1] = (i * 5) & 255; buf[i + 2] = 128; buf[i + 3] = 255; }
  let b64 = '';
  for (let i = 0; i < buf.length; i += 0x8000) b64 += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  b64 = btoa(b64);
  window.__假 = { 调用: [] };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd) => {
      window.__假.调用.push(cmd);
      if (cmd === 'read_rgba') return { width: W, height: H, rgba: b64 };
      if (cmd === 'plugin:dialog|open') return 'E:\\\\假\\\\参考图\\\\小图.png';
      return null;
    },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window['_' + id] = cb; return id; },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } }
  };

  const 清 = (s) => (s ?? '').replace(/\\s+/g, ' ').trim();
  const 撤销钮 = (字) => [...document.querySelectorAll('.wb__acts button')].find((b) => b.textContent.includes(字));
  const 滑杆 = (名) => document.querySelector('input[type=range][aria-label="' + 名 + '"]') ?? document.querySelector('input[aria-label="' + 名 + '"]');

  window.__看 = () => ({
    读数: 清(document.querySelector('.undobtns__n')?.textContent),
    撤销: 撤销钮('撤销') ? { 禁用: 撤销钮('撤销').disabled } : '（没有撤销钮）',
    重做: 撤销钮('重做') ? { 禁用: 撤销钮('重做').disabled } : '（没有重做钮）',
    曝光: 滑杆('曝光') ? 滑杆('曝光').value : '（没有曝光滑杆）',
    对比度: 滑杆('对比度') ? 滑杆('对比度').value : '（没有对比度滑杆）',
    /* 参考图槽里有没有图 + 预览台上那张图现在多大（载入前后一起看） */
    槽有图: !!document.querySelector('.slots img, .slot--full img'),
    预览: [...document.querySelectorAll('.pv__read')].map((el) => 清(el.textContent)),
    槽元素: [...document.querySelectorAll('.slots [class*=slot]')].slice(0, 3).map((el) => el.tagName + '.' + 清(el.className)),
    报错: 量.报错.slice(-3)
  });

  /** 载入参考图：**先关掉「用程序生成的测试图」**（勾着的时候那个槽根本不渲染），
      再点空槽 → 假对话框给路径 → 假后端给像素 */
  window.__载入参考图 = async () => {
    const 勾 = [...document.querySelectorAll('label.chk')].find((l) => /用程序生成的测试图/.test(l.textContent || ''));
    const 框 = 勾?.querySelector('input');
    if (框 && 框.checked) { 框.click(); await new Promise((r) => setTimeout(r, 600)); }
    const 槽 = document.querySelector('button.slot__hit')
      ?? document.querySelector('.slots [class*=hit]')
      ?? document.querySelector('.slots button');
    if (!槽) {
      return { 错: '找不到参考图槽', 候选: [...document.querySelectorAll('.slots *')].slice(0, 6).map((el) => el.tagName + '.' + 清(el.className)) };
    }
    槽.click();
    await new Promise((r) => setTimeout(r, 2500));
    return { 装了: true, 点的元素: 槽.tagName + '.' + 清(槽.className), 后端被调: window.__假.调用.length };
  };

  /** 连改同一个滑杆 n 下（模拟拖动：值一直在变、间隔很短） */
  window.__连改 = async (名, 起点, 步长, 下数, 间隔) => {
    const el = 滑杆(名);
    if (!el) return { 错: '找不到 ' + 名 };
    const 定值 = (v) => {
      const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      d.set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    for (let i = 1; i <= 下数; i++) {
      定值(起点 + 步长 * i);
      await new Promise((r) => setTimeout(r, 间隔 ?? 30));
    }
    return { 改完: el.value };
  };

  window.__等 = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__点 = (字) => {
    const b = 撤销钮(字);
    if (!b) return { 错: '找不到 ' + 字 };
    if (b.disabled) return { 错: 字 + ' 是禁用的' };
    b.click();
    return { 点了: 字 };
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
    const 定时 = setTimeout(() => { ws.removeEventListener('message', on); rej(new Error('CDP 超时 ' + method)); }, 120000);
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
await rpc('Emulation.setDeviceMetricsOverride', { width: 1707, height: 1067, deviceScaleFactor: 1, mobile: false });
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: 桩 });
const 跑 = async (表达式) => {
  const r = await rpc('Runtime.evaluate', { expression: 表达式, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { 页面抛错: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  return r.result.value;
};
const 表 = (标签, v) => console.log(`\n---- ${标签} ----\n${JSON.stringify(v)}`);

console.log('==== ⑧ 调色按步撤销 ====');
await rpc('Page.navigate', { url: `${app}/tools/ikclut` });
await 等(8000);
表('① 刚进来（应该是"1 / 1"、两个钮都禁用）', await 跑('window.__看()'));

表('② 连改「曝光」10 下（模拟拖一条滑杆）', await 跑('window.__连改("曝光", 1, 0.03, 10, 30)'));
等待: {
  await 等(1000); /* 停手 250ms + 合并窗 600ms */
  表('   落定之后（该只多一格 → 2 / 2）', await 跑('window.__看()'));
}

表('③ 点「撤销」（曝光该回到 1）', await 跑('window.__点("撤销")'));
await 等(600);
表('   撤销之后', await 跑('window.__看()'));

表('④ 静置 1.2 秒（撤销自己不该被记成一步 → 仍是 2 / 2）', await 跑('window.__等(1200)'));
表('   静置之后', await 跑('window.__看()'));

表('⑤ 点「重做」（曝光该回到拖动那一步的值）', await 跑('window.__点("重做")'));
await 等(600);
表('   重做之后', await 跑('window.__看()'));

表('⑥ 换成改「对比度」10 下（不同字段 → 又多一格）', await 跑('window.__连改("对比度", 1, 0.02, 10, 30)'));
await 等(1000);
表('   落定之后', await 跑('window.__看()'));

/* 真按 Ctrl+Z（CDP 键盘事件，走 window 上的监听） */
await rpc('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
await rpc('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
await 等(700);
表('⑦ 真按 Ctrl+Z 之后（对比度该退回去）', await 跑('window.__看()'));

/* ================= 载入参考图也算一步（用户 2026-09-24 定的） ================= */
console.log('\n\n==== 载入参考图：该多一格，撤销该把图也退回去 ====');
表('① 载入之前', await 跑('window.__看()'));
表('② 载入参考图（假后端喂 64×64）', await 跑('window.__载入参考图()'));
await 等(1200);
表('   载入之后（读数该多一格、槽里有图、预览换成 64×64）', await 跑('window.__看()'));
表('③ 点「撤销」—— 图该退回去（槽空）', await 跑('window.__点("撤销")'));
await 等(800);
表('   撤销之后', await 跑('window.__看()'));
表('④ 点「重做」—— 图该回来', await 跑('window.__点("重做")'));
await 等(800);
表('   重做之后', await 跑('window.__看()'));
ws.close();
