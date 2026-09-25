/**
 * 探针：⑦ 贴图通道处理 —— **拖一张图进来，到底落进哪个槽**。
 *
 * 用户 2026-09-24 报"该模块拖拽判定有问题"，只说有问题没说哪儿。
 * 所以这里不猜，直接把三件事量出来：
 *   1. 每一页**注册了哪些落点组**（`data-drop-key` 的键）+ 每个槽在屏幕上的矩形；
 *   2. 往**某一个槽的正中心**丢一张图 → 那一格填上了吗？还是填到别格去了？
 *   3. 往**版面上不属于任何槽的地方**丢 → 有没有兜底、兜到哪一格？
 *
 * 假后端给一个 2×2 的 RGBA（`read_rgba`），让真的落槽那条路跑得通。
 *
 * 用法（先 `pnpm dev` 起 1420，再无头 Chrome 开 9500）：
 *   $env:CDP_PORT='9500'; node tmp\probe-⑦拖拽判定.mjs
 */
const PORT = process.env.CDP_PORT ?? '9500';
const BASE = `http://127.0.0.1:${PORT}`;
const APP = process.env.DEV_ORIGIN ?? 'http://127.0.0.1:1420';

const 桩 = `
(() => {
  /* 2×2 全红 RGBA，base64 */
  const b64 = btoa(String.fromCharCode(255,0,0,255, 255,0,0,255, 255,0,0,255, 255,0,0,255));
  window.__假 = { 调用: [], 监听: {} };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      const a = args || {};
      window.__假.调用.push(cmd + (a.path ? ' ' + a.path : ''));
      if (cmd === 'plugin:event|listen') { window.__假.监听[a.event] = window['_' + a.handler]; return 1; }
      if (cmd === 'plugin:event|unlisten') return null;
      if (cmd === 'read_rgba') return { width: 2, height: 2, rgba: b64 };
      if (cmd === 'read_image') return { width: 2, height: 2, rgba: b64, src_format: 'PNG', src_bytes: 16 };
      if (cmd === 'load_prefs' || cmd === 'prefs') return null;
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
const 跑 = async (表达式) => {
  const r = await rpc('Runtime.evaluate', { expression: 表达式, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { 页面抛错: (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? '').split('\n')[0] };
  return r.result.value;
};
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: 桩 });

const 工具 = `
window.__探 = {
  槽表: () => [...document.querySelectorAll('[data-drop-key]')].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      键: el.dataset.dropKey,
      标签: (el.getAttribute('aria-label') || '').slice(0, 12),
      矩形: [r.left, r.top, r.right, r.bottom].map(Math.round),
      填了吗: el.classList.contains('slot--full'),
      中心: { x: Math.round((r.left + r.right) / 2), y: Math.round((r.top + r.bottom) / 2) }
    };
  }),
  满了的: () => [...document.querySelectorAll('[data-drop-key].slot--full')].map((el) => el.dataset.dropKey),
  /** 走原生那条路丢一张图（载荷按设备像素给） */
  丢: (x, y, 路径) => {
    const d = devicePixelRatio || 1;
    const 位 = { x: Math.round(x * d), y: Math.round(y * d) };
    const 发 = (类型, 载荷) => {
      const cb = window.__假.监听['tauri://drag-' + 类型];
      if (!cb) return '（没有监听）';
      cb({ event: 'tauri://drag-' + 类型, id: 1, payload: 载荷 });
      return 'ok';
    };
    发('enter', { paths: [路径], position: 位 });
    发('over', { position: 位 });
    发('drop', { paths: [路径], position: 位 });
    return 'ok';
  },
  侧栏错: () => (document.querySelector('.side__err')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
  清错: () => { window.__假.调用 = []; document.querySelector('.side__errx')?.click(); },
  /** 只发 enter+over，不发 drop —— 看**高亮**落在哪一格（判定过程本身） */
  只悬停: (x, y, 路径) => {
    const d = devicePixelRatio || 1;
    const 位 = { x: Math.round(x * d), y: Math.round(y * d) };
    const 发 = (类型, 载荷) => window.__假.监听['tauri://drag-' + 类型]({ event: 'tauri://drag-' + 类型, id: 1, payload: 载荷 });
    发('enter', { paths: [路径], position: 位 });
    发('over', { position: 位 });
    return 'ok';
  },
  高亮的: () => [...document.querySelectorAll('[data-drop-key].is-drop, [data-drop-key].slot--hot')].map((el) => el.dataset.dropKey)
};
'ok'
`;

const 页表 = [
  ['extract', '通道提取'],
  ['layers', '图层与蒙版'],
  ['blend', '混合'],
  ['merge', '合并'],
  ['split', '分离'],
  ['adjust', '调整'],
  ['swizzle', '调换'],
  ['pipeline', '批量提取']
];

const 汇报 = [];
for (const [面板, 名] of 页表) {
  await rpc('Page.navigate', { url: `${APP}/tools/channels?panel=${面板}` });
  await 等(3400);
  await 跑(工具);
  const 表 = await 跑('window.__探.槽表()');
  console.log(`\n==== ⑦ ${名}（panel=${面板}）：${Array.isArray(表) ? 表.length : '?'} 个落点 ====`);
  if (Array.isArray(表)) {
    for (const s of 表) console.log(`  ${s.键}  ${JSON.stringify(s.矩形)}  ${s.标签}`);
  } else {
    console.log('  ', JSON.stringify(表));
  }

  if (!Array.isArray(表) || !表.length) {
    汇报.push({ 页: 名, 落点数: 0, 结论: '这一页一个可落的槽都没有' });
    continue;
  }

  /* 甲：丢到**第 2 个**槽的正中心（有第 2 个就丢它，验"指哪落哪"） */
  const 目标 = 表[1] ?? 表[0];
  await 跑('window.__探.清错()');
  await 跑(`window.__探.丢(${目标.中心.x}, ${目标.中心.y}, 'D:\\\\别处\\\\一张图.png')`);
  await 等(1400);
  const 甲 = await 跑('window.__探.满了的()');
  const 甲对 = Array.isArray(甲) && 甲.includes(目标.键);
  console.log(`  甲、丢在「${目标.键}」中心 → 满了的是 ${JSON.stringify(甲)}  ${甲对 ? '✅ 指哪落哪' : '❌ 没落在指的那一格'}`);

  /* 乙：丢在**版面上不属于任何槽**的地方（工作区左上角，避开槽） */
  await rpc('Page.navigate', { url: `${APP}/tools/channels?panel=${面板}` });
  await 等(3200);
  await 跑(工具);
  await 跑('window.__探.清错()');
  const 空 = await 跑(`(() => {
    const w = document.querySelector('.wb__main');
    if (!w) return null;
    const r = w.getBoundingClientRect();
    /* 沿着几条竖线找第一个"不在任何槽里"的点 */
    for (const y of [r.top + 12, r.top + 30, r.top + 60]) {
      for (const x of [r.left + 12, r.left + 30, r.right - 12]) {
        if (!document.elementFromPoint(x, y)?.closest('[data-drop-key]')) return { x: Math.round(x), y: Math.round(y) };
      }
    }
    return null;
  })()`);
  let 乙说 = '（工作区里找不到不在槽上的点）';
  if (空) {
    await 跑(`window.__探.丢(${空.x}, ${空.y}, 'D:\\\\别处\\\\另一张图.png')`);
    await 等(1400);
    const 乙 = await 跑('window.__探.满了的()');
    const 错 = await 跑('window.__探.侧栏错()');
    乙说 = `丢在 (${空.x},${空.y})（不在任何槽上）→ 满了的是 ${JSON.stringify(乙)}；侧栏=${JSON.stringify(错)}`;
  }
  console.log(`  乙、丢在版面上不属于任何槽的地方 → ${乙说}`);

  /* 丙：丢在**两个槽之间的缝里** —— 这一条才是"判定"本身：
     `slotAt` 在缝里返回空串，`drop.ts` 的兜底会**挑第一格**；用户看着自己丢在中间，
     图却进了最左边那一格，而且全程没有任何高亮提示它要去哪。 */
  let 丙说 = '（这一页只有一个槽，没有缝可试）';
  if (表.length >= 2) {
    await rpc('Page.navigate', { url: `${APP}/tools/channels?panel=${面板}` });
    await 等(3200);
    await 跑(工具);
    const A = 表[0], B = 表[1];
    const 缝x = Math.round(((A.矩形[2] ?? 0) + (B.矩形[0] ?? 0)) / 2);
    const 缝y = Math.round((A.矩形[1] + A.矩形[3]) / 2);
    await 跑('window.__探.清错()');
    await 跑(`window.__探.只悬停(${缝x}, ${缝y}, 'D:\\\\别处\\\\缝里.png')`);
    await 等(500);
    const 高 = await 跑('window.__探.高亮的()');
    await 跑(`window.__探.丢(${缝x}, ${缝y}, 'D:\\\\别处\\\\缝里.png')`);
    await 等(1500);
    const 丙 = await 跑('window.__探.满了的()');
    const 该是 = [A.键, B.键];
    丙说 = `缝在 (${缝x},${缝y})（左边 ${A.键} / 右边 ${B.键}）→ 悬停时高亮=${JSON.stringify(高)}；落了之后满了的是 ${JSON.stringify(丙)}`;
    if (!Array.isArray(高) || !高.length) 丙说 += '　← **悬停时一格都没高亮**（用户看不出会落到哪）';
    if (Array.isArray(丙) && 丙.length && !该是.includes(丙[0])) 丙说 += `　← **落到了 ${丙[0]}（两边都不是）**`;
  }
  console.log(`  丙、丢在两个槽中间那条缝里 → ${丙说}`);

  汇报.push({ 页: 名, 落点数: 表.length, 甲_丢第2槽: 甲对 ? 'ok' : '✗ ' + JSON.stringify(甲), 乙_丢空处: 乙说, 丙_丢缝里: 丙说 });
}

console.log('\n\n==== 汇总 ====');
for (const r of 汇报) console.log(JSON.stringify(r));
ws.close();
