/**
 * 探针：② ikClut 调色页在**真尺寸参考图**下每一帧的代价。
 *
 * 上一支探针用的是程序生成的 512×320 测试图，量出来一帧 26~37ms。
 * 真实用法是丢一张截图进来（1920×1080 那一档），预览按 512（拖动中）/ 1024（停手后）
 * 重采样 —— 那才是要卡的地方。这里把假后端的 `read_rgba` 换成一张 1920×1080 的图。
 *
 * 用法（先 pnpm dev 起在 1420，再无头 Chrome 开 9400）：
 *   node tmp\probe-②大图代价.mjs
 */
const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
/* 体检走 1422（关掉 HMR 那个，见 tmp\vite.体检.config.js）—— 1420 上别人一存盘我这页就重挂 */
const 站点 = process.env.PROBE_SITE ?? 'http://127.0.0.1:1422';

const 桩 = `
(() => {
  const 量 = window.__量 = { toDataURL: 0, longtask: [], 最长帧间隔: 0, 帧数: 0, 报错: [], 重载: 0 };
  const 真toDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (...a) { 量.toDataURL++; return 真toDataURL.apply(this, a); };
  window.addEventListener('error', (e) => 量.报错.push(String(e.message)));
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) 量.longtask.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
  let 上次 = performance.now();
  const 跳 = (t) => { const g = t - 上次; 上次 = t; 量.帧数++; if (g > 量.最长帧间隔) 量.最长帧间隔 = Math.round(g); requestAnimationFrame(跳); };
  requestAnimationFrame(跳);

  window.__帧窗 = (ms) => new Promise((res) => {
    const 样 = []; let 上次2 = performance.now(); const t0 = 上次2;
    const 跳2 = (t) => { 样.push(t - 上次2); 上次2 = t;
      if (t - t0 < ms) requestAnimationFrame(跳2);
      else { const s = [...样].sort((a, b) => a - b); res({ 帧数: 样.length, 最长: Math.round(s[s.length - 1]), 中位: Math.round(s[Math.floor(s.length / 2)]) }); } };
    requestAnimationFrame(跳2);
  });

  const 定值 = (el, v, 类型) => {
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(el, String(v));
    el.dispatchEvent(new Event(类型 || 'input', { bubbles: true }));
  };
  window.__定值 = 定值;

  /* 拖滑条：range 的 input 是逐帧来的，这里连派 N 下（中间不等帧，最坏情况） */
  window.__拖 = async (选择器, 数) => {
    const el = document.querySelector(选择器);
    if (!el) return { 错: '找不到 ' + 选择器 };
    const min = +el.min, max = +el.max;
    const c0 = 量.toDataURL, lt0 = 量.longtask.length, t0 = performance.now();
    const 逐次 = [];
    for (let i = 0; i < 数; i++) {
      const t = performance.now();
      定值(el, min + ((max - min) * (i + 1)) / (数 + 1));
      逐次.push(Math.round((performance.now() - t) * 10) / 10);
    }
    const 同步共ms = performance.now() - t0;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const 到帧ms = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 1200));
    return {
      逐次事件内同步ms: 逐次,
      拖完同步共ms: Math.round(同步共ms * 10) / 10,
      到下一帧ms: Math.round(到帧ms * 10) / 10,
      收尾共ms: Math.round((performance.now() - t0) * 10) / 10,
      重算几次图: 量.toDataURL - c0,
      长任务: 量.longtask.slice(lt0)
    };
  };

  /* 敲一下数字，然后把"停手后补细图"那一步单独量出来（靠 longtask 抓） */
  window.__敲一下就停 = async (选择器, 值) => {
    const el = document.querySelector(选择器);
    if (!el) return { 错: '找不到 ' + 选择器 };
    await new Promise((r) => setTimeout(r, 900));
    const c0 = 量.toDataURL, lt0 = 量.longtask.length, t0 = performance.now();
    定值(el, 值);
    const 事件内同步ms = performance.now() - t0;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const 到下一帧ms = performance.now() - t0;
    const 长任务前 = 量.longtask.length;
    await new Promise((r) => setTimeout(r, 1500));
    return {
      事件内同步ms: Math.round(事件内同步ms * 10) / 10,
      到下一帧ms: Math.round(到下一帧ms * 10) / 10,
      总重算次数: 量.toDataURL - c0,
      '停手那一下的长任务': 量.longtask.slice(长任务前),
      这1_5秒里的长任务: 量.longtask.slice(lt0),
      报错: 量.报错
    };
  };

  /* ---- 假后端：两个尺寸的图 ---- */
  const 做图 = (W, H, 画) => {
    const buf = new Uint8ClampedArray(W * H * 4);
    画(buf, W, H);
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
    return btoa(s);
  };
  const 小 = 做图(1024, 32, (b, W) => {
    for (let y = 0; y < 32; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      b[i] = ((x % 32) / 31) * 255; b[i + 1] = (y / 31) * 255; b[i + 2] = (Math.floor(x / 32) / 31) * 255; b[i + 3] = 255;
    }
  });
  /* 截图那一档：有灰阶、有色相扫、有高频细节（真实截图的样子），不是纯色块 */
  const 大 = 做图(1920, 1080, (b, W, H) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const t = x / W;
      b[i] = Math.round(t * 255 * (0.7 + 0.3 * Math.sin(y * 0.11))) & 255;
      b[i + 1] = Math.round((1 - t) * 255 * (0.7 + 0.3 * Math.cos(x * 0.07))) & 255;
      b[i + 2] = Math.round(((x ^ y) & 255));
      b[i + 3] = 255;
    }
  });

  window.__假 = { 调用: [], 要哪张: '大' };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd) => {
      window.__假.调用.push(cmd);
      if (cmd === 'read_rgba') return window.__假.要哪张 === '大'
        ? { width: 1920, height: 1080, rgba: 大 }
        : { width: 1024, height: 32, rgba: 小 };
      if (cmd === 'plugin:dialog|open') return 'E:\\\\假\\\\截图_1920x1080.png';
      if (cmd === 'plugin:dialog|save') return null;
      if (cmd === 'read_text_file') return { text: '' };
      if (cmd === 'probe_dir') return { exists: true, is_dir: false, entries: 0, names: [] };
      return null;
    },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window['_' + id] = cb; return id; },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } }
  };
})();
`;

/* 桩先自己在 Node 里编一遍：页面上报 SyntaxError 的话栈里看不到行号，白折腾 */
try {
  new Function(桩);
} catch (e) {
  console.log('桩编不过：' + e.message);
  process.exit(2);
}

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
const 日志 = [];
const 事件 = [];
const 跑 = async (表达式, 等待 = false) => {
  const r = await rpc('Runtime.evaluate', { expression: 表达式, returnByValue: true, awaitPromise: 等待 });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
const 量 = async (标签, 表达式, 等待 = true) => {
  try {
    const v = await 跑(表达式, 等待);
    console.log(`\n---- ${标签} ----\n${JSON.stringify(v, null, 1)}`);
    return v;
  } catch (e) {
    console.log(`\n---- ${标签} ----\n  ！！量不成：${e.message}`);
    console.log(`  页面事件：${事件.join(' | ') || '（没有）'}；异常：${日志.join(' | ') || '（没有）'}`);
    return { 失败: e.message };
  }
};

await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Emulation.setDeviceMetricsOverride', { width: 1707, height: 1067, deviceScaleFactor: 1, mobile: false });
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: 桩 });
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) 事件.push('重载');
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    日志.push(`[异常] ${(d.exception?.description ?? d.text).split('\n')[0]}`);
  }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
    日志.push(`[${m.params.type}] ${m.params.args.map((a) => a.description ?? a.value).join(' ').slice(0, 300)}`);
});

await rpc('Page.navigate', { url: `${站点}/tools/ikclut` });
/* dev server 要现编路由 chunk，别人也在同一个 server 上戳，别用固定睡眠 —— 等控件出来 */
for (let i = 0; i < 60; i++) {
  const 好了 = await 跑(`!!document.querySelector('input[aria-label="曝光"]')`, false).catch(() => false);
  if (好了) break;
  await 等(1000);
}
const 等到了 = await 跑(`!!document.querySelector('input[aria-label="曝光"]')`, false).catch(() => false);
if (!等到了) {
  console.log('等了 60 秒这页也没长出来，dev server 那边还在编 —— 重跑一次');
  process.exit(3);
}
await 等(1500);
/* 自己那次导航也算"重载"，从这里开始记 */
事件.length = 0;

await 量(
  '开机（测试图 512×320）',
  `({ 幕布: !!document.querySelector('.intro') ? '还在' : '已撤', 重算: window.__量.toDataURL, 长任务: window.__量.longtask })`,
  false
);

await 量(
  '换成 1920×1080 真尺寸参考图',
  `(async () => {
  const chk = [...document.querySelectorAll('label.chk')].find((l) => l.textContent.includes('用程序生成的测试图'))?.querySelector('input');
  const t0 = performance.now();
  chk.click();
  await new Promise((r) => setTimeout(r, 300));
  document.querySelector('button.slot__hit')?.click();
  await new Promise((r) => setTimeout(r, 2500));
  return {
    从点选到稳定共ms: Math.round(performance.now() - t0),
    槽里显示: (document.querySelector('.slot__meta') || {}).textContent?.trim() ?? '（没填上）',
    重算次数: window.__量.toDataURL,
    长任务: window.__量.longtask,
    报错: window.__量.报错
  };
})()`
);

await 量('空闲 2 秒帧窗', `window.__帧窗(2000)`);
await 量(
  '敲一下数字，把这一下触发的每一次重算都列出来',
  `(async () => {
  const el = document.querySelector('input[aria-label="曝光"][type=range]');
  const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await new Promise((r) => setTimeout(r, 900));
  window.__分表 = [];
  const t0 = performance.now();
  d.set.call(el, '1.3');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  const 事件内同步ms = +(performance.now() - t0).toFixed(1);
  await new Promise((r) => setTimeout(r, 1500));
  return { 事件内同步ms, 这一下重算了几次: window.__分表.length, 逐次: window.__分表.map((x) => ({ ...x, 何时: +(x.何时 - t0).toFixed(0) })) };
})()`
);
await 量('拖「曝光」滑条 20 下', `window.__拖('input[aria-label="曝光"][type=range]', 20)`);
await 量('再拖 20 下（第二轮，缓存应该更热）', `window.__拖('input[aria-label="对比度"][type=range]', 20)`);
await 量('敲一下「曝光」然后停手，把补细图那一下单独量出来', `window.__敲一下就停('input[aria-label="曝光"]', '1.42')`);
await 量('敲一下「饱和度」', `window.__敲一下就停('input[aria-label="饱和度"]', '1.11')`);
await 量('空闲 2 秒帧窗（停手后）', `window.__帧窗(2000)`);
await 量('开「同步缩放」+「同步平移」再空闲 2 秒', `(async () => {
  const 勾 = (t) => [...document.querySelectorAll('label.chk')].find((l) => l.textContent.includes(t))?.querySelector('input');
  勾('同步缩放').click(); 勾('同步平移').click();
  await new Promise((r) => setTimeout(r, 300));
  const c0 = window.__量.toDataURL, lt0 = window.__量.longtask.length, f0 = window.__量.帧数;
  const 帧 = await window.__帧窗(2000);
  return { '2秒内帧数': window.__量.帧数 - f0, '2秒内重算': window.__量.toDataURL - c0,
    '2秒内长任务': window.__量.longtask.slice(lt0), 帧间隔: 帧, 报错: window.__量.报错 };
})()`);

console.log('\n==== 控制台 / 异常 ====');
console.log(日志.length ? 日志.join('\n') : '（没有）');
console.log('页面事件：' + (事件.join(' | ') || '（全程没有被外部改动打断）'));
ws.close();
/* 被打断过就非零退出，外面可以重跑直到拿到一段干净的量 */
process.exit(事件.length ? 3 : 0);
