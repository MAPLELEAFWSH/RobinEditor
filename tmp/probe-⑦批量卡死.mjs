/**
 * 探针：⑦ 里**要选目录才动**的那两页（批量提取 / 批量）会不会自转卡死。
 *
 * 为什么单独一支：大探针（`probe-⑦卡死.mjs`）只点空槽载入图片，
 * 而这两页的入口是「选个目录 → 扫出文件表 → 组建计划」，一条路径都不经过槽位。
 * 桩里给 `scan_dir` 一份假文件表，就能把"扫到文件之后"的那段照着跑一遍。
 *
 * 认的是同一类病：**effect 读了自己刚写的那份 state**，而写进去的每次都是新数组/新对象
 * （`releaseRowUrls(rows); rows = buildPlan(...)` 就是这个形状）→ 无限重跑 → 抛
 * `effect_update_depth_exceeded` → 界面点不动。跟 ② ikClut、⑦ 通道提取同一个病根。
 *
 * 用法（先 `pnpm dev` 起在 1420，再无头 Chrome 开 9400）：
 *   node tmp\probe-⑦批量卡死.mjs [分区] [视口]
 */
const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const 分区 = process.argv[2] ?? 'pipeline';
const 视口 = process.argv[3] ?? '1707x1067';
const app = 'http://127.0.0.1:1420';

const 假文件表 = [];
for (let i = 1; i <= 12; i++) {
  假文件表.push({
    path: `E:\\假\\贴图\\Body_${i}.png`,
    name: `Body_${i}.png`,
    rel: `Body_${i}.png`,
    ext: 'png',
    size: 262144
  });
}

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
  window.__帧窗 = (ms) => new Promise((res) => {
    const 样 = []; let 上次2 = performance.now(); const t0 = 上次2;
    const 跳2 = (t) => { 样.push(t - 上次2); 上次2 = t;
      if (t - t0 < ms) requestAnimationFrame(跳2);
      else res({ 帧数: 样.length, 最长: Math.round(Math.max(...样)), 中位: Math.round(样.sort((a, b) => a - b)[Math.floor(样.length / 2)]) }); };
    requestAnimationFrame(跳2);
  });
  /* 点一个按钮，把"点下去到下一帧"期间的帧间隔/长任务/重算都记下来 */
  window.__点按钮 = async (找法, 说明) => {
    const el = 找法();
    if (!el) return { 错: '找不到按钮：' + 说明 };
    el.scrollIntoView({ block: 'center' });
    await new Promise((r) => requestAnimationFrame(r));
    const c0 = 量.toDataURL, lt0 = 量.longtask.length;
    量.最长帧间隔 = 0;
    const t0 = performance.now();
    el.click();
    const 点击同步ms = Math.round(performance.now() - t0);
    await new Promise((r) => setTimeout(r, 1200));
    return {
      按钮: (el.textContent || '').trim().slice(0, 24),
      点击同步ms,
      点后1200ms内最长帧间隔ms: 量.最长帧间隔,
      重算几次图: 量.toDataURL - c0,
      长任务: 量.longtask.slice(lt0),
      报错: 量.报错
    };
  };
  /* 假贴图 512×512 —— 这两页量的是"文件一多就自转"，图小一点免得像素本身挡住判断 */
  const W = 512, H = 512;
  const buf = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { buf[i * 4] = i % 255; buf[i * 4 + 1] = 90; buf[i * 4 + 2] = 200; buf[i * 4 + 3] = 255; }
  let b64 = ''; const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) b64 += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
  b64 = btoa(b64);

  window.__假 = { 调用: [] };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      window.__假.调用.push(cmd);
      if (cmd === 'read_rgba') return { width: W, height: H, rgba: b64 };
      if (cmd === 'scan_dir') return ${JSON.stringify(假文件表)};
      if (cmd === 'plugin:dialog|open') return 'E:\\\\假\\\\贴图';
      if (cmd === 'plugin:dialog|save') return null;
      if (cmd === 'read_text_file') return { text: '' };
      if (cmd === 'probe_dir') return { exists: true, is_dir: true, entries: 12, names: [] };
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
    const 定时 = setTimeout(() => { ws.removeEventListener('message', on); rej(new Error('CDP 超时 ' + method)); }, 20000);
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
const 事件 = [];
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Emulation.setDeviceMetricsOverride', {
  width: Number(视口.split('x')[0]), height: Number(视口.split('x')[1]), deviceScaleFactor: 1, mobile: false
});
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: 桩 });
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) 事件.push(`重载 @${Date.now() % 100000}`);
  if (m.method === 'Inspector.targetCrashed') 事件.push('渲染进程崩了');
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    const f = (d.stackTrace?.callFrames ?? []).slice(0, 5)
      .map((c) => `${c.url.split('/').pop()}:${c.lineNumber + 1}`).join(' < ');
    日志.push(`[异常] ${(d.exception?.description ?? d.text).split('\n').slice(0, 3).join(' | ')}  @ ${f}`);
  }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    日志.push(`[${m.params.type}] ${m.params.args.map((a) => a.description ?? a.value).join(' ').slice(0, 400)}`);
  }
});

const 跑 = async (表达式, 等待 = true, 超时ms = 12000) => {
  const 判 = await Promise.race([
    rpc('Runtime.evaluate', { expression: 表达式, returnByValue: true, awaitPromise: 等待 }).then((r) => ({ r })).catch((e) => ({ e })),
    等(超时ms).then(() => ({ 超时: true }))
  ]);
  if (判.超时) return { 卡住: `页面 ${超时ms}ms 没响应` };
  if (判.e) return { 卡住: '量不成：' + 判.e.message };
  if (判.r.exceptionDetails) return { 卡住: '页面抛错：' + (判.r.exceptionDetails.exception?.description ?? '') };
  return 判.r.result.value;
};

console.log(`==== ⑦ ${分区} 选目录那条路 · 视口 ${视口} ====`);
await rpc('Page.navigate', { url: `${app}/tools/channels?panel=${分区}` });
await 等(6000);

const 起点 = await 跑(`({
  主按钮: [...document.querySelectorAll('.btn--primary')].map((b) => ({ 字: (b.textContent || '').trim().slice(0, 20), 禁用: b.disabled })),
  可见主按钮: [...document.querySelectorAll('.btn--primary')].filter((b) => !b.disabled && b.offsetParent).length
})`, false);
console.log('\n---- 进去时的主按钮 ----\n' + JSON.stringify(起点, null, 1));

const 选目录 = await 跑(
  `window.__点按钮(() => [...document.querySelectorAll('.btn--primary')].find((b) => !b.disabled && b.offsetParent), '主按钮')`
);
console.log('\n---- 点「选目录」 ----\n' + JSON.stringify(选目录, null, 1));

const 表 = await 跑(
  `({ 表里行数: document.querySelectorAll('table tbody tr').length, 屏幕上有几行字: document.body.innerText.length,
      提示: [...document.querySelectorAll('.note')].map((n) => n.innerText.slice(0, 80)) })`,
  false
);
console.log('\n---- 扫完之后表里有什么 ----\n' + JSON.stringify(表, null, 1));

const 空转 = await 跑(`window.__帧窗(2000)`);
console.log('\n---- 扫完空闲 2 秒（有没有在自转） ----\n' + JSON.stringify(空转, null, 1));

const 再点 = await 跑(
  `window.__点按钮(() => [...document.querySelectorAll('button')].find((b) => /量一遍/.test(b.textContent || '') && !b.disabled), '量一遍')`
);
console.log('\n---- 点「量一遍」 ----\n' + JSON.stringify(再点, null, 1));

const 空转2 = await 跑(`window.__帧窗(2000)`);
console.log('\n---- 量完空闲 2 秒 ----\n' + JSON.stringify(空转2, null, 1));

const 总账 = await 跑(`({ 重算总数: window.__量.toDataURL, 长任务条数: window.__量.longtask.length,
  最长长任务ms: window.__量.longtask.length ? Math.max(...window.__量.longtask) : 0,
  全程最长帧间隔ms: window.__量.最长帧间隔, 后端被调: window.__假.调用.length, 报错: window.__量.报错 })`, false);
console.log('\n---- 总账 ----\n' + JSON.stringify(总账, null, 1));

console.log('\n==== 控制台 / 异常 ====');
console.log(日志.length ? 日志.join('\n') : '（没有 error / warning，也没有未捕获异常）');
ws.close();
