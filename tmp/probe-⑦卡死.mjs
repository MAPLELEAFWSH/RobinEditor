/**
 * 探针：⑦「贴图通道处理」**载入图片之后就点不动、卡死在这个界面**，卡在哪一步。
 *
 * 用户 2026-09-23 报的原话："载入图片就无法进行任何有效操作然后卡死在这个界面"。
 * 所以这里**每个分区都走同一条路**：导航进去 → 空转量一遍 → 点空槽载入图片 → 再量一遍，
 * 前后各留一份数字，差就是"载入"这一步干的。
 *
 * 量六样，全要数字：
 *   ① 空转 —— 2 秒里有多少帧、最长帧间隔多少（没人操作还在狂算 = 有东西在自转）；
 *   ② 长任务 —— PerformanceObserver 的 longtask（>50ms）；
 *   ③ 重算几次图 —— 拿 toDataURL（就是 `imageDataToUrl`）当计数器；
 *   ④ **点得到** —— 视口中心 elementFromPoint 命中谁、有没有整屏覆盖层（"点不动"的直接证据）；
 *   ⑤ **真点一下生不生效** —— 派 pointerdown/up + click，看 aria-pressed 有没有变；
 *   ⑥ 异常 / 重载 / 渲染进程崩没崩（`effect_update_depth_exceeded` 会走 Runtime.exceptionThrown）。
 *
 * **每次量都有超时**：页面真卡住时 Runtime.evaluate 是永远不返回的，
 * 没有超时的话这个探针自己也挂在那儿，什么也报不出来。
 *
 * 桩的是后端，不是界面：`__TAURI_INTERNALS__` 喂一张自己造的假贴图，版式/控件/文案全是真的。
 * 图默认 1024×1024（4 MB 原始，5.6 MB base64）—— 再大光桩自己的 atob 就要吃掉几十毫秒，量不准。
 *
 * 用法（先 `pnpm dev` 起在 1420，再无头 Chrome 开 9400）：
 *   node tmp\probe-⑦卡死.mjs [边长] [视口]
 */
const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const 边长 = Number(process.argv[2] ?? 1024);
const 视口 = process.argv[3] ?? '1707x1067';
const app = 'http://127.0.0.1:1420';

/* ---------------- 桩：假后端 + 计数器 + 页面侧量具 ---------------- */

const 桩 = `
(() => {
  const 量 = window.__量 = {
    toDataURL: 0, longtask: [], 最长帧间隔: 0, 帧数: 0, 报错: []
  };
  const 真toDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (...a) {
    量.toDataURL++;
    return 真toDataURL.apply(this, a);
  };
  window.addEventListener('error', (e) => 量.报错.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => 量.报错.push('rejection ' + String(e.reason)));
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) 量.longtask.push(Math.round(e.duration)); })
      .observe({ entryTypes: ['longtask'] });
  } catch (e) {}
  let 上次 = performance.now();
  const 跳 = (t) => {
    const g = t - 上次; 上次 = t; 量.帧数++;
    if (g > 量.最长帧间隔) 量.最长帧间隔 = Math.round(g);
    requestAnimationFrame(跳);
  };
  requestAnimationFrame(跳);

  window.__帧窗 = (ms) => new Promise((res) => {
    const 样 = []; let 上次2 = performance.now(); const t0 = 上次2;
    const 跳2 = (t) => { 样.push(t - 上次2); 上次2 = t;
      if (t - t0 < ms) requestAnimationFrame(跳2);
      else res({ 帧数: 样.length, 最长: Math.round(Math.max(...样)),
                 中位: Math.round(样.sort((a, b) => a - b)[Math.floor(样.length / 2)]) }); };
    requestAnimationFrame(跳2);
  });

  /* 整屏覆盖层 = "点不动"的直接证据。固定/绝对定位、盖住九成视口、还接鼠标的才算 */
  window.__挡路的 = () => {
    const vw = innerWidth, vh = innerHeight;
    const 出 = [];
    for (const el of document.querySelectorAll('body *')) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') continue;
      if (s.pointerEvents === 'none') continue;
      if (s.position !== 'fixed' && s.position !== 'absolute') continue;
      const r = el.getBoundingClientRect();
      if (r.width < vw * 0.9 || r.height < vh * 0.9) continue;
      const 命中 = document.elementFromPoint(vw >> 1, vh >> 1);
      出.push({
        标签: el.tagName + '.' + (typeof el.className === 'string' ? el.className : ''),
        z: s.zIndex, 在中心命中: !!(命中 && (命中 === el || el.contains(命中)))
      });
    }
    const 命中 = document.elementFromPoint(vw >> 1, vh >> 1);
    return {
      整屏覆盖层: 出,
      视口中心命中: 命中 ? 命中.tagName + '.' + (typeof 命中.className === 'string' ? 命中.className : '') : null,
      幕布还在: !!document.querySelector('.intro'),
      主界面隐藏: (() => { const w = document.querySelector('.bootwrap'); return w ? w.classList.contains('bootwrap--hidden') : null; })(),
      控件数: document.querySelectorAll('button, input, select').length,
      禁用控件数: document.querySelectorAll('button[disabled], input[disabled]').length
    };
  };

  /* 真点一下：派 pointerdown/pointerup + click，看 aria-pressed 变没变 */
  window.__真点 = async (选择器) => {
    const el = document.querySelector(选择器);
    if (!el) return { 错: '找不到 ' + 选择器 };
    el.scrollIntoView({ block: 'center' });
    await new Promise((r) => requestAnimationFrame(r));
    const r0 = el.getBoundingClientRect();
    const x = Math.round(r0.left + r0.width / 2), y = Math.round(r0.top + r0.height / 2);
    const 命中 = document.elementFromPoint(x, y);
    const 前 = el.getAttribute('aria-pressed');
    const 点谁 = 命中 ?? el;
    点谁.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
    点谁.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y }));
    点谁.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return {
      选择器,
      命中元素: 命中 ? 命中.tagName + '.' + (typeof 命中.className === 'string' ? 命中.className : '') : null,
      点到的是它自己: !!(命中 && (命中 === el || el.contains(命中))),
      aria点前: 前, aria点后: el.getAttribute('aria-pressed'),
      生效: 前 !== el.getAttribute('aria-pressed')
    };
  };

  /* 点每一个空槽载入图片 —— 前后各记一份计数，差就是"载入"这一步干的 */
  window.__载入 = async (最多, 间隔ms) => {
    const 槽 = [...document.querySelectorAll('button.slot__hit')].slice(0, 最多 ?? 99);
    if (!槽.length) return { 错: '这一页没有空的载入格（button.slot__hit）' };
    const c0 = 量.toDataURL, lt0 = 量.longtask.length;
    量.最长帧间隔 = 0;
    const 逐格 = [];
    for (const s of 槽) {
      const t = performance.now();
      s.click();
      await new Promise((r) => setTimeout(r, 间隔ms ?? 700));
      逐格.push(Math.round(performance.now() - t));
    }
    await new Promise((r) => setTimeout(r, 500));
    return {
      槽数: 槽.length, 逐格共ms: 逐格,
      载入期间最长帧间隔ms: 量.最长帧间隔,
      重算几次图: 量.toDataURL - c0,
      长任务: 量.longtask.slice(lt0),
      报错: 量.报错
    };
  };

  /* ---- 假后端：一张 1024×1024 的假贴图，四块平色 + 一片渐变 + A 通道有层次 ---- */
  const W = ${边长}, H = ${边长};
  const buf = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const 左上 = x < W / 2 && y < H / 2, 右上 = x >= W / 2 && y < H / 2;
      const 左下 = x < W / 2 && y >= H / 2;
      if (左上) { buf[i] = 220; buf[i + 1] = 90; buf[i + 2] = 40; buf[i + 3] = 255; }
      else if (右上) { buf[i] = 30; buf[i + 1] = 200; buf[i + 2] = 120; buf[i + 3] = 255; }
      else if (左下) { buf[i] = 40; buf[i + 1] = 60; buf[i + 2] = 230; buf[i + 3] = 128; }
      else {
        const t = Math.round((x - W / 2) / (W / 2) * 255);
        buf[i] = t; buf[i + 1] = 255 - t; buf[i + 2] = 128; buf[i + 3] = 255;
      }
    }
  }
  let b64 = '';
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) b64 += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
  b64 = btoa(b64);

  window.__假 = { 调用: [], 尺寸: W + 'x' + H };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      window.__假.调用.push(cmd);
      if (cmd === 'read_rgba') return { width: W, height: H, rgba: b64 };
      if (cmd === 'plugin:dialog|open') return 'E:\\\\假\\\\贴图\\\\body_d.png';
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

/* ---------------- CDP ---------------- */

const list = await (await fetch(`${BASE}/json/list`)).json();
const t = list.find((x) => x.type === 'page' && !x.url.startsWith('devtools://'));
if (!t) {
  console.error(`没有可连的 page 目标。确认无头 Chrome 带了 --remote-debugging-port=${PORT}`);
  process.exit(1);
}
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

/** 跑一段表达式，**带超时** —— 页面卡住时 Runtime.evaluate 是不返回的 */
const 跑 = async (表达式, 等待 = false, 超时ms = 12000) => {
  const 任务 = rpc('Runtime.evaluate', { expression: 表达式, returnByValue: true, awaitPromise: 等待 });
  const 判 = await Promise.race([任务.then((r) => ({ r })).catch((e) => ({ e })), 等(超时ms).then(() => ({ 超时: true }))]);
  if (判.超时) return { 卡住: `页面 ${超时ms}ms 没响应（Runtime.evaluate 不返回）` };
  if (判.e) return { 卡住: '量不成：' + 判.e.message };
  const r = 判.r;
  if (r.exceptionDetails) return { 卡住: '页面抛错：' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text) };
  return r.result.value;
};

const 量 = async (标签, 表达式, 等待 = true, 超时ms = 12000) => {
  const v = await 跑(表达式, 等待, 超时ms);
  console.log(`\n---- ${标签} ----`);
  if (v && v.卡住) {
    console.log(`  ！！${v.卡住}`);
    console.log(`  这一段的页面事件：${事件.length ? 事件.join(' | ') : '（没有）'}`);
    console.log(`  已收到的异常：${日志.length ? 日志.join(' | ') : '（没有）'}`);
  } else {
    console.log(JSON.stringify(v, null, 1));
  }
  return v;
};

await rpc('Page.enable');
await rpc('Runtime.enable');
try { await rpc('Inspector.enable'); } catch (e) { /* 有的 Chrome 不给 */ }
await rpc('Emulation.setDeviceMetricsOverride', {
  width: Number(视口.split('x')[0]),
  height: Number(视口.split('x')[1]),
  deviceScaleFactor: 1,
  mobile: false
});
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: 桩 });
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) 事件.push(`重载 @${Date.now() % 100000}`);
  if (m.method === 'Inspector.targetCrashed') 事件.push(`渲染进程崩了 @${Date.now() % 100000}`);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    const f = (d.stackTrace?.callFrames ?? []).slice(0, 5)
      .map((c) => `${c.url.split('/').pop()}:${c.lineNumber + 1}`).join(' < ');
    日志.push(`[异常] ${(d.exception?.description ?? d.text).split('\n').slice(0, 4).join(' | ')}  @ ${f}`);
  }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    日志.push(`[${m.params.type}] ${m.params.args.map((a) => a.description ?? a.value).join(' ').slice(0, 400)}`);
  }
});

/* ---------------- 逐分区跑 ---------------- */

const 分区表 = [
  ['extract', '通道提取'],
  ['split', '分离'],
  ['merge', '合并'],
  ['swizzle', '调换'],
  ['adjust', '调整'],
  ['blend', '混合'],
  ['layers', '图层与蒙版'],
  ['batch', '批量'],
  ['pipeline', '批量提取']
];

console.log(`==== ⑦ 卡死探针 · 假贴图 ${边长}×${边长} · 视口 ${视口} ====`);
const 判定 = [];

for (const [panel, 名] of 分区表) {
  事件.length = 0;
  const 标记前 = 日志.length;
  await rpc('Page.navigate', { url: `${app}/tools/channels?panel=${panel}` });
  await 等(6000);

  const 载入前 = await 量(`${名}：载入前（幕布 / 覆盖层 / 控件）`, `window.__挡路的()`, false);
  const 空转前 = await 量(`${名}：载入前空转 1.5 秒`, `window.__帧窗(1500)`);
  const 载入 = await 量(`${名}：点空槽载入假贴图`, `window.__载入(4, 700)`);
  const 空转后 = await 量(`${名}：载入后空转 2 秒（有没有在自转）`, `window.__帧窗(2000)`);
  const 覆盖后 = await 量(`${名}：载入后（幕布 / 覆盖层 / 点得到）`, `window.__挡路的()`, false);
  const 真点 = await 量(
    `${名}：载入后真点一下主区里没按下的那个分段按钮`,
    /* 只点 aria-pressed="false" 的。原来写了个 `, .wb__main button.pick__b` 兜底，
       于是查到的常常是**已经按下**的那个按钮 —— 再点一次它当然还是按下，
       判出来是"点了不生效"，那不是应用的问题，是探针挑错了靶子。 */
    `window.__真点('.wb__main .pick__b[aria-pressed="false"]')`
  );
  const 计数 = await 量(
    `${名}：计数总账`,
    `({ 重算总数: window.__量.toDataURL, 帧数: window.__量.帧数, 全程最长帧间隔ms: window.__量.最长帧间隔,
        长任务条数: window.__量.longtask.length, 最长长任务ms: window.__量.longtask.length ? Math.max(...window.__量.longtask) : 0,
        报错: window.__量.报错, 后端被调的次数: window.__假.调用.length })`,
    false
  );

  const 这一段的异常 = 日志.slice(标记前);
  /* `生效 === false` 只在"本来没按下"时才算问题：按钮挑的是 aria-pressed="false" 的，
     但如果这一页压根没有没按下的分段按钮，`__真点` 会回 `找不到` —— 那是"没得点"，不是故障 */
  const 该生效 = typeof 真点?.生效 === 'boolean';
  const 卡不卡 =
    载入?.卡住 || 空转后?.卡住 || 覆盖后?.卡住
      ? '卡死（界面不响应）'
      : 空转后 && 空转后.最长 > 300 && 空转后.帧数 < 20
        ? '自转（没人操作还在狂算）'
        : 覆盖后 && 覆盖后.整屏覆盖层?.length
          ? '被盖住（点不到）'
          : 该生效 && 真点.生效 === false
            ? '点了不生效'
            : 载入?.错
              ? '这一页没有载入格'
              : 'ok';
  判定.push({ 分区: 名, panel, 判定: 卡不卡, 载入后帧: 空转后?.帧数 ?? null, 载入后最长帧ms: 空转后?.最长 ?? null, 载入期间最长帧ms: 载入?.载入期间最长帧间隔ms ?? null, 覆盖层: 覆盖后?.整屏覆盖层?.length ?? null, 真点: 该生效 ? 真点.生效 : '没得点', 异常: 这一段的异常.length });
  console.log(`\n>>> ${名}：${卡不卡}`);
}

console.log('\n\n==== 汇总 ====');
console.log(JSON.stringify(判定, null, 1));

/* 已删的「游戏分区」：地址里还带着 `?panel=games` 时不许白屏、也不许悄悄落到别的模块 */
console.log('\n\n==== 已删分区 ?panel=games 的落点 ====');
事件.length = 0;
await rpc('Page.navigate', { url: `${app}/tools/channels?panel=games` });
await 等(6000);
const 落点 = await 量(
  '① 地址还带着已删的 panel=games',
  `({ 地址: location.pathname + location.search,
      生效分区: [...document.querySelectorAll('.seg__btn')]
        .filter((b) => b.getAttribute('aria-current') === 'page' || b.classList.contains('is-on'))
        .map((b) => b.textContent.trim()),
      主区字数: (document.querySelector('.wb__main')?.innerText ?? '').replace(/\\s+/g, ' ').length,
      主区开头: (document.querySelector('.wb__main')?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 80),
      幕布还在: !!document.querySelector('.intro'),
      主界面隐藏: (() => { const w = document.querySelector('.bootwrap'); return w ? w.classList.contains('bootwrap--hidden') : null; })() })`,
  false
);

console.log('\n==== 控制台 / 异常全量 ====');
console.log(日志.length ? 日志.join('\n') : '（没有 error / warning，也没有未捕获异常）');
ws.close();
