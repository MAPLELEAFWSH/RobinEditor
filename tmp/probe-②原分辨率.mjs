/**
 * 探针：② 细档 = **原分辨率**（这一轮改的），拿**真 4096×2048 贴图**验。
 *
 * 为什么必须用真图：默认那张是程序生成的 512×320，两级一样大，什么都验不出来；
 * 而"原分辨率"这条只有在源比 1024 大、且**比 512 大很多**的时候才看得出区别。
 * 真图从 `tmp\素材-②真图.png` 来（从语料**复制**的，语料原目录只读），
 * 脚本自己起小 http 服务递进页面 → 页面解码成 RGBA → 按 `read_rgba` 的契约喂给应用
 * —— 走的是应用自己那条载入路，不是往 DOM 里塞图。
 *
 * 量这些：
 *   ① 停手后 `<img>` 的 natural 是不是 **4096×2048**（= 原图，不是 1024 缩图）；
 *   ② 拖动中是不是 512×256（粗档照旧）；
 *   ③ 两档之间**显示尺寸（CSS px）不变** —— 否则又回到"尺寸波动"那条老病；
 *   ④ 停手那一刻主线程堵了多久（逐帧记 rAF 间隔，取最大缺口）；
 *   ⑤ 「像素 1:1」下 图源像素 : 设备像素 是不是 1:1（原分辨率的意义就在这一条）；
 *   ⑥ 说明文案说的是不是实话（"原分辨率 / 按 512 粗图算"）；
 *   ⑦ `imageDataToUrl` 改成单画布之后，PNG 输出字节跟老写法是否**完全相同**。
 *
 * 用法（先 `pnpm dev` 起 1420，再无头 Chrome 开 9400）：
 *   node tmp\probe-②原分辨率.mjs [视口]
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const PORT_HTTP = 9412;
const 视口 = process.argv[2] ?? '1707x1067';
const app = 'http://127.0.0.1:1420';

const 图路径 = decodeURIComponent(new URL('./素材-②真图.png', import.meta.url).pathname.replace(/^\//, ''));
const 图字节 = readFileSync(图路径);
const 服务 = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'image/png');
  res.end(图字节);
}).listen(PORT_HTTP);

const 桩 = `
(() => {
  const 量 = window.__量 = { 报错: [] };
  window.addEventListener('error', (e) => 量.报错.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => 量.报错.push('rejection ' + String(e.reason)));

  /* 真图：页面里解码一次，之后按 read_rgba 的契约（宽高 + RGBA 的 base64）给出去 */
  let 真 = null;
  /* 安全阀那一档要一张"长边超上限但像素不多"的图：4200×100。
     长边 4200 > 4096 上限 → 该退回 1024 档；像素只有 42 万，喂得进页面。 */
  let 极端 = null;
  /* 用**查询参数**告诉桩这一次喂哪张图：?probe=extreme → 4200×100。
     为什么不用 hash：中文 hash 重新加载之后 href 里就没了（路由把它吃掉了，实测
     location.hash === ''），白跑两轮。查询参数用纯 ASCII，SvelteKit 会原样留着。 */
  let 模式 = location.search.includes('probe=extreme') ? '极端' : '真图';
  window.__桩状态 = () => ({ href: location.href, 模式 });

  function 造极端() {
    if (极端) return 极端;
    const W = 4200, H = 100;
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        d[o] = Math.round((x / (W - 1)) * 255);
        d[o + 1] = Math.round((y / (H - 1)) * 255);
        d[o + 2] = 128;
        d[o + 3] = 255;
      }
    }
    let s = ''; const CH = 0x8000;
    for (let i = 0; i < d.length; i += CH) s += String.fromCharCode.apply(null, d.subarray(i, i + CH));
    极端 = { width: W, height: H, rgba: btoa(s) };
    return 极端;
  }

  async function 取真图() {
    if (真) return 真;
    const 复 = await fetch('http://127.0.0.1:${PORT_HTTP}/真图.png');
    const bmp = await createImageBitmap(await 复.blob());
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    const g = cv.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    let s = ''; const CH = 0x8000;
    for (let i = 0; i < d.length; i += CH) s += String.fromCharCode.apply(null, d.subarray(i, i + CH));
    真 = { width: bmp.width, height: bmp.height, rgba: btoa(s) };
    return 真;
  }

  window.__假 = { 调用: [] };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      window.__假.调用.push(cmd);
      if (cmd === 'read_rgba') return 模式 === '极端' ? 造极端() : await 取真图();
      if (cmd === 'plugin:dialog|open') return 'E:\\\\假\\\\参考图\\\\真图.png';
      if (cmd === 'plugin:dialog|save') return null;
      if (cmd === 'read_text_file') return { text: '' };
      if (cmd === 'probe_dir') return { exists: true, is_dir: false, entries: 0, names: [] };
      if (cmd === 'pick_file') return null;
      return null;
    },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window['_' + id] = cb; return id; },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } }
  };

  const 清 = (s) => (s ?? '').replace(/\\s+/g, ' ').trim();
  window.__台 = () => [...document.querySelectorAll('.pv')].map((pv, i) => {
    const 框 = pv.querySelector('.pv__box');
    const 图 = pv.querySelector('img.pv__img');
    const r = 框.getBoundingClientRect();
    const ri = 图 ? 图.getBoundingClientRect() : null;
    return {
      第几个: i + 1, 标签: 图?.getAttribute('alt') ?? '',
      读数: 清(pv.querySelector('.pv__read')?.textContent),
      最近邻: !!图?.classList.contains('pv__img--pixel'),
      框: [框.clientWidth, 框.clientHeight],
      图: 图 ? {
        natural: 图.naturalWidth + '×' + 图.naturalHeight,
        渲染: Math.round(ri.width) + '×' + Math.round(ri.height)
      } : null
    };
  });
  window.__文案 = () => [...document.querySelectorAll('p.mini')].map((el) => 清(el.textContent)).filter((t) => /原分辨率|粗图|细图|停手|超过上限/.test(t));

  window.__装大图 = async () => {
    const 勾 = [...document.querySelectorAll('label.chk')].find((l) => /用程序生成的测试图/.test(l.textContent || ''));
    const 框 = 勾?.querySelector('input');
    if (框 && 框.checked) { 框.click(); await new Promise((r) => setTimeout(r, 500)); }
    const 槽 = document.querySelector('button.slot__hit');
    if (!槽) return { 错: '找不到空的参考图槽' };
    槽.click();
    await new Promise((r) => setTimeout(r, 6000));
    return { 装了: true, 台: window.__台(), 真图: 真 ? 真.width + '×' + 真.height : '没取到' };
  };

  /** 换一张图：**重新导航**（hash 决定桩喂哪张），再点一次空槽 —— 走应用自己的载入路 */
  window.__换图重载 = async () => {
    location.href = location.pathname + '?panel=' + (new URLSearchParams(location.search).get('panel') ?? '') + '#极端';
    return { 正在重载: true };
  };

  /* 连敲曝光：拖动中记逐帧尺寸，停手后记补图那一刻的帧间隔缺口 */
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
    let 上次 = performance.now();
    const 记 = () => {
      const now = performance.now();
      const 缺口 = Math.round(now - 上次);
      上次 = now;
      for (const pv of document.querySelectorAll('.pv')) {
        const 图 = pv.querySelector('img.pv__img');
        if (!图) continue;
        const r = 图.getBoundingClientRect();
        轨.push({
          t: Math.round(now), 缺口,
          alt: 图.getAttribute('alt') ?? '',
          natural: 图.naturalWidth + '×' + 图.naturalHeight,
          渲染: Math.round(r.width) + '×' + Math.round(r.height)
        });
      }
      if (!停) requestAnimationFrame(记);
    };
    requestAnimationFrame(记);
    const v0 = Number(el.value) || 1;
    for (let i = 0; i < 下数; i++) {
      定值(v0 + (i % 2 === 0 ? 0.06 : -0.05) * (i + 1));
      await new Promise((r) => setTimeout(r, 每下间隔ms ?? 60));
    }
    await new Promise((r) => setTimeout(r, 5000)); // 停手补原图就在这段里
    停 = true;
    const 按图 = {};
    for (const x of 轨) {
      const k = x.alt || '(无 alt)';
      按图[k] ??= { natural: new Set(), 渲染: new Set() };
      按图[k].natural.add(x.natural);
      按图[k].渲染.add(x.渲染);
    }
    const 最大缺口 = 轨.reduce((m, x) => Math.max(m, x.缺口), 0);
    const 缺口点 = 轨.filter((x) => x.缺口 >= 40).map((x) => ({ t: x.t, 缺口: x.缺口, natural: x.natural }));
    return {
      总帧数: 轨.length,
      最大帧间隔: 最大缺口,
      '≥40ms 的卡顿点': 缺口点.slice(0, 10),
      每种渲染尺寸: Object.fromEntries(Object.entries(按图).map(([k, v]) => [k, { natural: [...v.natural], 渲染: [...v.渲染] }])),
      台: window.__台(),
      报错: 量.报错.slice(-3)
    };
  };

  /* 「像素 1:1」：图源像素 ↔ 设备像素是不是 1:1 */
  window.__量像素一比一 = async () => {
    const pv = document.querySelector('.pv');
    if (!pv) return { 错: '没有预览台' };
    const 详情 = pv.querySelector('details.pv__zoom');
    if (详情 && !详情.open) 详情.open = true;
    await new Promise((r) => setTimeout(r, 200));
    const 钮 = [...pv.querySelectorAll('button.pv__b')].find((b) => /像素 1:1/.test(b.textContent || ''));
    if (!钮) return { 错: '找不到「像素 1:1」' };
    钮.click();
    await new Promise((r) => setTimeout(r, 600));
    const 图 = pv.querySelector('img.pv__img');
    const r = 图.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return {
      读数: 清(pv.querySelector('.pv__read')?.textContent),
      natural: 图.naturalWidth + '×' + 图.naturalHeight,
      渲染CSS: Math.round(r.width) + '×' + Math.round(r.height),
      dpr,
      '渲染设备像素': Math.round(r.width * dpr) + '×' + Math.round(r.height * dpr),
      '图源:设备 = 1:1': Math.abs(r.width * dpr - 图.naturalWidth) <= 1,
      最近邻: 图.classList.contains('pv__img--pixel')
    };
  };

  /* imageDataToUrl 改成单画布之后，PNG 字节跟老写法一样不一样 */
  window.__比编码 = () => {
    const w = 300, h = 200;
    const d = new ImageData(w, h);
    let s = 123456789 >>> 0;
    for (let i = 0; i < d.data.length; i += 4) {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      d.data[i] = s & 255; d.data[i + 1] = (s >>> 8) & 255; d.data[i + 2] = (s >>> 16) & 255; d.data[i + 3] = 255;
    }
    /* 新写法：一块普通画布 + putImageData */
    const c1 = document.createElement('canvas');
    c1.width = w; c1.height = h;
    c1.getContext('2d').putImageData(d, 0, 0);
    const 新 = c1.toDataURL('image/png');
    /* 老写法：OffscreenCanvas 写一遍，再 drawImage 到普通画布 */
    const off = new OffscreenCanvas(w, h);
    off.getContext('2d').putImageData(d, 0, 0);
    const c2 = document.createElement('canvas');
    c2.width = w; c2.height = h;
    c2.getContext('2d').drawImage(off, 0, 0);
    const 旧 = c2.toDataURL('image/png');
    return { 一样: 新 === 旧, 长度: [新.length, 旧.length] };
  };

  /**
   * **直接量**应用自己那两个函数（动态 import Vite 编译的那份 img.ts），
   * 在**真 4096×2048 像素**上：不带记忆 / 带记忆第一次 / 带记忆第二次。
   *
   * 为什么不用"帧间隔"来推：无头环境里帧间隔抖得太大（三次跑出 357 / 300 / 255ms），
   * 92ms 的差别全被噪声吃掉。**承重结论要用能重复出来的量。**
   */
  window.__比记忆 = async () => {
    const m = await import('/src/lib/img.ts');
    const 真图 = await 取真图();
    const 二进制 = Uint8Array.from(atob(真图.rgba), (ch) => ch.charCodeAt(0));
    const d = new ImageData(new Uint8ClampedArray(二进制.buffer), 真图.width, 真图.height);
    const 时 = (fn) => { const t0 = performance.now(); fn(); return +(performance.now() - t0).toFixed(1); };
    /* 各来两次：第一次都是冷的，第二次才看得到"记忆"到底省没省 */
    const 不带记忆1 = 时(() => m.imageDataToUrl(d));
    const 不带记忆2 = 时(() => m.imageDataToUrl(d));
    const 带记忆1 = 时(() => m.imageDataToUrl记住(d));
    const 带记忆2 = 时(() => m.imageDataToUrl记住(d));
    const 带记忆3 = 时(() => m.imageDataToUrl记住(d));
    return {
      尺寸: d.width + '×' + d.height,
      '不带记忆（两次）': [不带记忆1, 不带记忆2],
      '带记忆（三次）': [带记忆1, 带记忆2, 带记忆3],
      省下毫秒: +(不带记忆2 - 带记忆3).toFixed(1)
    };
  };
  /**
   * 同步平移复核（细档换尺寸会改"夹住"的范围，得确认同步拖动没被带坏）。
   *
   * **先重置再拖**：上一步探针在 100% 下已经拖到边界顶住了，不重置的话这一次拖动
   * 会被"夹住"拦住、量出来是"没动" —— 那是探针顺序的锅，不是功能坏了
   * （tmp\probe-②拖动与波动.mjs 的 ⑥ 段就是这么误报的：**桩里不许用反引号**，
   * 这个文件里的桩是模板字符串，多一个反引号就整段断掉，报的还是 SyntaxError）。
   */
  window.__同步平移复核 = async () => {
    const 台们 = () => [...document.querySelectorAll('.pv')];
    const 同步 = [...document.querySelectorAll('label.chk')].find((l) => /同步平移/.test(l.textContent || ''));
    const 勾 = 同步?.querySelector('input');
    if (勾 && !勾.checked) { 勾.click(); await new Promise((r) => setTimeout(r, 300)); }
    for (const pv of 台们()) {
      const 详情 = pv.querySelector('details.pv__zoom');
      if (详情 && !详情.open) 详情.open = true;
      await new Promise((r) => setTimeout(r, 80));
      [...pv.querySelectorAll('button.pv__b')].find((b) => /重置/.test(b.textContent || ''))?.click();
    }
    await new Promise((r) => setTimeout(r, 500));
    const 位 = () => 台们().map((pv) => {
      const r = pv.querySelector('img.pv__img').getBoundingClientRect();
      return { alt: pv.querySelector('img.pv__img').getAttribute('alt'), x: Math.round(r.left), y: Math.round(r.top) };
    });
    const 前 = 位();
    const pv = 台们()[0];
    const 框 = pv.querySelector('.pv__box');
    const 图 = pv.querySelector('img.pv__img');

    /* **别拿"框中心"当落点**：预览台高 555px，页面滚到底时框中心正好落在
       贴底的写盘条（.wb__acts，视口 975~1037）底下 —— 命中的是底栏不是图，
       拖动自然"没动"。这里在"图 ∩ 视口、且躲开底部 40px"的范围里试 25 个点，
       挑第一个真的命中 img 的，并把命中元素一起报出来。
       教训：**桩是模板字符串，里面一个反引号都不许有** —— 多一个就整段断掉，
       而且报出来的常常是莫名其妙的其他错（这次报成 "PORT_HTTP.wb__acts is not a function"）。
       写完探针先跑一遍 node --check 再跑真的。 */
    const 选点 = () => {
      const r = 图.getBoundingClientRect();
      const 顶 = Math.max(r.top, 0);
      const 底 = Math.min(r.bottom, innerHeight - 40);
      const 左 = Math.max(r.left, 0);
      const 右 = Math.min(r.right, innerWidth);
      if (底 - 顶 < 8 || 右 - 左 < 8) return null;
      for (let i = 1; i <= 5; i++) {
        for (let j = 1; j <= 5; j++) {
          const x = Math.round(左 + ((右 - 左) * i) / 6);
          const y = Math.round(顶 + ((底 - 顶) * j) / 6);
          const el = document.elementFromPoint(x, y);
          if (el === 图) return { x, y, el };
        }
      }
      return null;
    };
    const 点 = 选点();
    if (!点) return { 错: '在图身上找不到一个能命中的点（框中心被写盘条压着？）', 图: 图.getBoundingClientRect(), 视口高: innerHeight };
    const { x, y, el: 目标 } = 点;
    const 派 = (类型, xx, yy) =>
      目标.dispatchEvent(new PointerEvent(类型, {
        bubbles: true, cancelable: true, clientX: xx, clientY: yy, button: 0,
        buttons: 类型 === 'pointerup' ? 0 : 1, pointerId: 1, pointerType: 'mouse', isPrimary: true
      }));
    派('pointerdown', x, y);
    for (let i = 1; i <= 8; i++) 派('pointermove', x + (90 * i) / 8, y + (40 * i) / 8);
    派('pointerup', x + 90, y + 40);
    await new Promise((r) => setTimeout(r, 400));
    const 后 = 位();
    const 位移 = 后.map((v, i) => [v.x - 前[i].x, v.y - 前[i].y]);
    return {
      落点: [x, y],
      命中元素: 目标.tagName + '.' + (typeof 目标.className === 'string' ? 目标.className : ''),
      前, 后, 位移,
      两个台位移一样: 位移.length === 2 && 位移[0][0] === 位移[1][0] && 位移[0][1] === 位移[1][1],
      真的动了: 位移.some((d) => d[0] !== 0 || d[1] !== 0)
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
await rpc('Emulation.setDeviceMetricsOverride', {
  width: Number(视口.split('x')[0]), height: Number(视口.split('x')[1]), deviceScaleFactor: 1, mobile: false
});
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: 桩 });
const 跑 = async (表达式) => {
  const r = await rpc('Runtime.evaluate', { expression: 表达式, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { 页面抛错: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  return r.result.value;
};
const 表 = (标签, v) => console.log(`\n---- ${标签} ----\n${JSON.stringify(v, null, 1)}`);

console.log(`==== ② 细档原分辨率（真图 ${图字节.length} 字节）· 视口 ${视口} ====`);
await rpc('Page.navigate', { url: `${app}/tools/ikclut` });
await 等(8000);
表('装大图', await 跑('window.__装大图()'));
表('第一轮：连敲「曝光」12 下 → 停手补原图', await 跑('window.__敲并跟帧("曝光", 12, 60)'));
/* 第二轮：原图那张已经编过一次了（带记忆的那版），这一次停手应该明显更轻 —— 
   两轮的"最大帧间隔"之差就是那句记忆省下来的量 */
表('第二轮：再敲 12 下 → 停手补原图（原图编码已记忆）', await 跑('window.__敲并跟帧("对比度", 12, 60)'));
表('说明文案', await 跑('window.__文案()'));
表('像素 1:1', await 跑('window.__量像素一比一()'));
表('出图编码：新写法 vs 老写法', await 跑('window.__比编码()'));
表('直接量：真 4096×2048 上带记忆 / 不带记忆', await 跑('window.__比记忆()'));
表('同步平移复核（先重置再拖 90,40）', await 跑('window.__同步平移复核()'));
/* 安全阀：换一张 4200×100（长边超 4096 上限、像素很少）→ 细档该退回 1024，文案要写明。
   注意：只改 hash 是**同文档导航**，SvelteKit 不会重挂组件（槽位还是满的、点不动），
   所以这里必须显式 reload 一次，拿到一个干净的文档。 */
console.log('\n==== 安全阀：重新加载到 ?probe=extreme（桩改喂 4200×100）====');
/* 要先回 about:blank 再进应用：直接导航到"同路径 + 不同查询"是**客户端路由**，
   文档不换、桩里的 模式 还是老的（`Page.reload` 紧跟 `Page.navigate` 会报
   "Not attached to an active page"）。走 about:blank 就一定是一次完整的文档加载。 */
await rpc('Page.navigate', { url: 'about:blank' });
await 等(1000);
await rpc('Page.navigate', { url: `${app}/tools/ikclut?probe=extreme` });
await 等(9000);
表('桩状态（该看到 模式=极端）', await 跑('window.__桩状态()'));
表('安全阀：装 4200×100（长边超上限）', await 跑('window.__装大图()'));
表('安全阀下的文案', await 跑('window.__文案()'));
ws.close();
服务.close();
