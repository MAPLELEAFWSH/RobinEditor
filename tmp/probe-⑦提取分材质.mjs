/**
 * 探针：⑦「通道提取」载入之后**剩下的那截** —— 不抛错了，但主线程还堵着谁。
 *
 * 背景：载入图片曾经冻 3970 ms 并抛 `effect_update_depth_exceeded`（effect 读自己写的 state），
 * 那个自环已经修掉（异常 0 条）。修完量到**载入这一段还剩 896 ms**（1024² 的图）——
 * 不是死循环，是主线程上真在算。这一支就是把那 896 ms 按"点哪个槽"拆开，并按图的大小看它怎么涨：
 * 4K 的图要是按面积线性涨，就是 14 秒，用户照样会叫"卡死"。
 *
 * 用法（先 `pnpm dev` 起在 1420，再无头 Chrome 开 9400）：
 *   node tmp\probe-⑦提取分材质.mjs [边长] [视口]
 */
const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const 边长 = Number(process.argv[2] ?? 1024);
const 视口 = process.argv[3] ?? '1707x1067';
const app = 'http://127.0.0.1:1420';

const 桩 = `
(() => {
  const 量 = window.__量 = { toDataURL: 0, longtask: [], 最长帧间隔: 0, 帧数: 0, 报错: [] };
  const 真toDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (...a) { 量.toDataURL++; return 真toDataURL.apply(this, a); };
  window.addEventListener('error', (e) => 量.报错.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => 量.报错.push('rejection ' + String(e.reason)));
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) 量.longtask.push(Math.round(e.duration)); })
      .observe({ entryTypes: ['longtask'] });
  } catch (e) {}
  let 上次 = performance.now();
  const 跳 = (t) => { const g = t - 上次; 上次 = t; 量.帧数++; if (g > 量.最长帧间隔) 量.最长帧间隔 = Math.round(g); requestAnimationFrame(跳); };
  requestAnimationFrame(跳);

  /* 点某个空槽（按格子上的字找，别按下标 —— 填了一格之后下标会挪），量"这一下"堵了多久 */
  window.__载一格 = async (标签) => {
    const s = [...document.querySelectorAll('button.slot__hit')]
      .find((x) => (x.querySelector('b')?.textContent ?? '').trim() === 标签);
    if (!s) return { 错: '没有空的「' + 标签 + '」格了' };
    const c0 = 量.toDataURL, lt0 = 量.longtask.length, n0 = 量.longtask.length;
    量.最长帧间隔 = 0;
    const t0 = performance.now();
    s.click();
    /* 一路等它回到流畅：连着 30 帧没有**新**长任务才算完
       —— 早先写成"长任务总数大于起点就清零"，只要出过一条就永远回不到 30，一路等到超时 */
    let 稳 = 0;
    let 上次条数 = n0;
    while (稳 < 30 && performance.now() - t0 < 60000) {
      await new Promise((r) => requestAnimationFrame(r));
      if (量.longtask.length !== 上次条数) { 上次条数 = 量.longtask.length; 稳 = 0; } else 稳++;
    }
    return {
      槽: 标签,
      从点下到回到流畅共ms: Math.round(performance.now() - t0),
      这一段最长帧间隔ms: 量.最长帧间隔,
      这一段长任务: 量.longtask.slice(lt0),
      这一段重算几次图: 量.toDataURL - c0
    };
  };

  /* 点一个按字找的按钮，一路记界面上的提示（看"全部导出"的进度是不是真在动） */
  window.__点导出 = async (标签) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 标签);
    if (!b) return { 错: '找不到按钮 ' + 标签 };
    if (b.disabled) return { 错: 标签 + ' 是禁用的' };
    const lt0 = 量.longtask.length;
    量.最长帧间隔 = 0;
    const t0 = performance.now();
    const 见到的提示 = [];
    b.click();
    while (performance.now() - t0 < 30000) {
      await new Promise((r) => requestAnimationFrame(r));
      /* 取**最后**一条 note 元素：页面上还挂着"透明通道检测"那条常驻提示，
         写盘结果那条渲染在 DOM 最后。原来取第一条，拿到的是常驻那条，
         于是永远等不到"写了"，一路等到 30 秒超时 —— 白等。 */
      const n = ([...document.querySelectorAll('.note')].at(-1)?.innerText ?? '').replace(/\s+/g, ' ').trim();
      if (n && 见到的提示.at(-1) !== n) 见到的提示.push(n.slice(0, 70));
      if (见到的提示.length && /写了|失败/.test(见到的提示.at(-1))) break;
    }
    return {
      点的: 标签,
      从点下到出结果共ms: Math.round(performance.now() - t0),
      这一段最长帧间隔ms: 量.最长帧间隔,
      这一段长任务: 量.longtask.slice(lt0),
      见到的提示: 见到的提示.slice(0, 6),
      报错: 量.报错.slice(-3)
    };
  };

  /* 假贴图：R 只有 4 个不同值（= 4 种"材质"，好让按需抠遮罩这条链真的跑起来）、
     G 一片渐变、A 两档 —— 跟"真有东西"的贴图一个形状 */
  const W = ${边长}, H = ${边长};
  const buf = new Uint8ClampedArray(W * H * 4);
  const 四档 = [10, 60, 120, 200];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const 上 = y < H / 2, 左 = x < W / 2;
      const 档 = (上 ? 0 : 2) + (左 ? 0 : 1);
      buf[i] = 四档[档];
      buf[i + 1] = Math.round((x / (W - 1)) * 255);
      buf[i + 2] = 上 ? 128 : 200;
      buf[i + 3] = 左 ? 255 : 128;
    }
  }
  let b64 = ''; const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) b64 += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
  b64 = btoa(b64);

  window.__假 = { 调用: [] };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd) => {
      window.__假.调用.push(cmd);
      if (cmd === 'read_rgba') return { width: W, height: H, rgba: b64 };
      if (cmd === 'write_rgba_image') return { path: 'E:\\\\假\\\\贴图\\\\out.png', bytes_written: 1024, backup: null };
      if (cmd === 'write_bytes') return { path: 'E:\\\\假\\\\贴图\\\\out.png', bytes_written: 1024, backup: null };
      if (cmd === 'plugin:dialog|open') return 'E:\\\\假\\\\贴图\\\\body_d.png';
      if (cmd === 'plugin:dialog|save') return 'E:\\\\假\\\\贴图\\\\out.png';
      if (cmd === 'read_text_file') return { text: '' };
      if (cmd === 'probe_dir') return { exists: true, is_dir: false, entries: 0, names: [] };
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
    const 定时 = setTimeout(() => { ws.removeEventListener('message', on); rej(new Error('CDP 超时 ' + method)); }, 90000);
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

const 日志 = [];
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Emulation.setDeviceMetricsOverride', {
  width: Number(视口.split('x')[0]), height: Number(视口.split('x')[1]), deviceScaleFactor: 1, mobile: false
});
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: 桩 });
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    日志.push(`[异常] ${(d.exception?.description ?? d.text).split('\n').slice(0, 3).join(' | ')}`);
  }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    日志.push(`[${m.params.type}] ${m.params.args.map((a) => a.description ?? a.value).join(' ').slice(0, 300)}`);
  }
});

const 跑 = async (表达式, 等待 = true) => {
  const r = await rpc('Runtime.evaluate', { expression: 表达式, returnByValue: true, awaitPromise: 等待 });
  if (r.exceptionDetails) return { 页面抛错: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  return r.result.value;
};

console.log(`==== ⑦ 通道提取 · 假贴图 ${边长}×${边长} · 视口 ${视口} ====`);
await rpc('Page.navigate', { url: `${app}/tools/channels?panel=extract` });
await 等(6000);

const 槽表 = await 跑(`[...document.querySelectorAll('button.slot__hit')].map((s) => (s.querySelector('b')?.textContent ?? '').trim())`, false);
console.log('\n---- 这一页有哪几个槽 ----\n' + JSON.stringify(槽表, null, 1));

for (const 名 of 槽表 ?? []) {
  const r = await 跑(`window.__载一格(${JSON.stringify(名)})`);
  console.log(`\n---- 点「${名}」那一格 ----\n` + JSON.stringify(r, null, 1));
}

const 编 = await 跑(
  `({ 几种材质: document.querySelectorAll('.candy__it').length,
      编号与占比: [...document.querySelectorAll('.candy__it')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim()),
      选中那张有预览: !!document.querySelector('.stage img'),
      预览图长边: (() => { const im = document.querySelector('.stage img'); return im ? im.naturalWidth + 'x' + im.naturalHeight : null; })() })`,
  false
);
console.log('\n---- 数出来的材质 ----\n' + JSON.stringify(编, null, 1));

const 导一张 = await 跑(`window.__点导出('只导这一张')`);
console.log('\n---- 点「只导这一张」（全尺寸抠一张）----\n' + JSON.stringify(导一张, null, 1));

const 导全部 = await 跑(`window.__点导出('全部导出')`);
console.log('\n---- 点「全部导出」----\n' + JSON.stringify(导全部, null, 1));

const 总 = await 跑(`({ 重算总数: window.__量.toDataURL, 报错: window.__量.报错, 帧数: window.__量.帧数, 写盘被调: window.__假.调用.filter((c) => c === 'write_rgba_image').length })`, false);
console.log('\n---- 总账 ----\n' + JSON.stringify(总, null, 1));
console.log('\n==== 控制台 / 异常 ====');
console.log(日志.length ? 日志.join('\n') : '（没有 error / warning，也没有未捕获异常）');
ws.close();
