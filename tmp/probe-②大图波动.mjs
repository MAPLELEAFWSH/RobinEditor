/**
 * 探针：② 的**尺寸波动** —— 用一张 2048² 的源图才显形。
 *
 * 为什么默认图测不出来：② 打开时用的是"程序生成的测试图"（512×320），
 * 而两级预览是"拖动时 512、停手后 1024" —— 源图本身就 512，两级都一样，跳不起来。
 * 这里用假后端喂一张 2048×2048 的图，于是 粗=512 / 细=1024 真的会换，
 * 逐帧记 `<img>` 的 natural 与渲染尺寸，跳多少一眼看出来。
 *
 * 用法（先 `pnpm dev` 起 1420，再无头 Chrome 开 9400）：
 *   node tmp\probe-②大图波动.mjs [边长] [视口]
 */
const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const 边长 = Number(process.argv[2] ?? 2048);
const 视口 = process.argv[3] ?? '1707x1067';
const app = 'http://127.0.0.1:1420';

const 桩 = `
(() => {
  const 量 = window.__量 = { 报错: [] };
  window.addEventListener('error', (e) => 量.报错.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => 量.报错.push('rejection ' + String(e.reason)));

  const W = ${边长}, H = ${边长};
  const buf = new Uint8ClampedArray(W * H * 4);
  /* 画点有结构的：左右渐变 + 中间一条肤色带 —— 调色看得出差别就行 */
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const t = x / (W - 1);
      buf[i] = Math.round(t * 255);
      buf[i + 1] = Math.round(((y / (H - 1)) * 0.6 + t * 0.4) * 255);
      buf[i + 2] = Math.round((1 - t) * 180);
      buf[i + 3] = 255;
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
      if (cmd === 'plugin:dialog|open') return 'E:\\\\假\\\\参考图\\\\大图.png';
      if (cmd === 'plugin:dialog|save') return null;
      if (cmd === 'read_text_file') return { text: '' };
      if (cmd === 'probe_dir') return { exists: true, is_dir: false, entries: 0, names: [] };
      return null;
    },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window['_' + id] = cb; return id; },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } }
  };

  window.__台 = () => [...document.querySelectorAll('.pv')].map((pv, i) => {
    const 框 = pv.querySelector('.pv__box');
    const 图 = pv.querySelector('img.pv__img');
    const r = 框.getBoundingClientRect();
    const ri = 图 ? 图.getBoundingClientRect() : null;
    return {
      第几个: i + 1, 标签: 图?.getAttribute('alt') ?? '',
      读数: (pv.querySelector('.pv__read')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
      框: [框.clientWidth, 框.clientHeight],
      图: 图 ? { natural: 图.naturalWidth + 'x' + 图.naturalHeight, 渲染: Math.round(ri.width) + 'x' + Math.round(ri.height) } : null,
      能滚: 框.scrollWidth > 框.clientWidth || 框.scrollHeight > 框.clientHeight
    };
  });

  /* 载入一张真尺寸的图：先关掉"用程序生成的测试图"，再点那个空槽 */
  window.__装大图 = async () => {
    const 勾 = [...document.querySelectorAll('label.chk')].find((l) => /用程序生成的测试图/.test(l.textContent || ''));
    const 框 = 勾?.querySelector('input');
    if (框 && 框.checked) { 框.click(); await new Promise((r) => setTimeout(r, 400)); }
    const 槽 = document.querySelector('button.slot__hit');
    if (!槽) return { 错: '找不到空的参考图槽' };
    槽.click();
    await new Promise((r) => setTimeout(r, 2500));
    return { 装了: true, 台: window.__台(), 后端被调: window.__假.调用.length };
  };

  window.__敲并跟帧 = async (ariaLabel, 下数, 每下间隔ms) => {
    const el = document.querySelector('input[aria-label="' + ariaLabel + '"]');
    if (!el) return { 错: '找不到 ' + ariaLabel };
    const 定值 = (v) => {
      const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      d.set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const 轨 = [];
    let 停 = false;
    const 记 = () => {
      for (const pv of document.querySelectorAll('.pv')) {
        const 图 = pv.querySelector('img.pv__img');
        if (!图) continue;
        const r = 图.getBoundingClientRect();
        const 框 = pv.querySelector('.pv__box');
        轨.push({
          t: Math.round(performance.now()),
          alt: 图.getAttribute('alt') ?? '',
          natural: 图.naturalWidth + 'x' + 图.naturalHeight,
          渲染: Math.round(r.width) + 'x' + Math.round(r.height),
          可滚: (框.scrollWidth - 框.clientWidth) + '/' + (框.scrollHeight - 框.clientHeight)
        });
      }
      if (!停) requestAnimationFrame(记);
    };
    requestAnimationFrame(记);
    const v0 = Number(el.value) || 1;
    for (let i = 0; i < 下数; i++) {
      定值(v0 + (i % 2 === 0 ? 0.06 : -0.05) * (i + 1));
      await new Promise((r) => setTimeout(r, 每下间隔ms ?? 40));
    }
    await new Promise((r) => setTimeout(r, 1600)); // 停手补细图就在这段里
    停 = true;
    const 变化点 = [];
    for (const x of 轨) {
      const 上 = 变化点.at(-1);
      if (!上 || 上.natural !== x.natural || 上.渲染 !== x.渲染 || 上.alt !== x.alt) 变化点.push(x);
    }
    const 按图 = {};
    for (const x of 轨) {
      const k = x.alt || '(无 alt)';
      按图[k] ??= { 渲染: new Set(), natural: new Set() };
      按图[k].渲染.add(x.渲染);
      按图[k].natural.add(x.natural);
    }
    return {
      总帧数: 轨.length,
      变化点: 变化点.slice(0, 20),
      每种渲染尺寸: Object.fromEntries(Object.entries(按图).map(([k, v]) => [k, { 渲染: [...v.渲染], natural: [...v.natural] }])),
      报错: 量.报错.slice(-3)
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

console.log(`==== ② 大图（${边长}²）下的尺寸波动 · 视口 ${视口} ====`);
await rpc('Page.navigate', { url: `${app}/tools/ikclut` });
await 等(7000);
表('装大图', await 跑('window.__装大图()'));
console.log('\n==== 连敲「曝光」10 下，逐帧跟到细图补上 ====');
表('尺寸轨迹', await 跑('window.__敲并跟帧("曝光", 10, 40)', true));
ws.close();
