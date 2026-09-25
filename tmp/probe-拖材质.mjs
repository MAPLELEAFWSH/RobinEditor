/**
 * 探针：③ Ray 的材质落点 —— 把一个 `.fx` 拖进去，到底会不会**载入**它。
 *
 * 做法：假后端（桩 `__TAURI_INTERNALS__`）+ 真界面 + **真的 drop 事件**：
 *   · HTML5 那条：构造 DataTransfer + File，派发 `dragover` / `drop`
 *   · 桌面端那条：把 `onDragDropEvent` 注册的四个监听抓出来，喂 `over` / `drop` 载荷
 * 落点注册表直接从页面里 `import('/src/lib/dropzones.svelte.ts')` 拿（同一个实例），
 * 所以"注册有没有生效、el 是不是真的挂在那一行上"是量出来的，不是看代码推的。
 *
 * 两个分区都过一遍：`panel=conf`（包目录 + 材质清单）与 `panel=material`（改参数那一页）。
 *
 * 用法（先 pnpm dev + 无头 Chrome）：
 *   $env:CDP_PORT='9500'; node tmp\probe-拖材质.mjs
 */
const PORT = process.env.CDP_PORT ?? '9500';
const BASE = `http://127.0.0.1:${PORT}`;
const APP = process.env.DEV_ORIGIN ?? 'http://127.0.0.1:1420';

/* 全文同时落一份到 tmp 里，报告里要引用原文 */
const 流水 = [];
const 原console = console.log.bind(console);
console.log = (...a) => { 流水.push(a.map((x) => (typeof x === 'string' ? x : String(x))).join(' ')); 原console(...a); };
const 落盘 = async () => {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(new URL('./拖材质-验收.log', import.meta.url), 流水.join('\n') + '\n', 'utf8');
};

/* ---------------- 假后端：一份假 Ray 包 ---------------- */

const 桩 = `
(() => {
  const 根 = 'D:\\\\Ray测试包';
  const 材质 = [
    根 + '\\\\Materials\\\\mat_body.fx',
    根 + '\\\\Materials\\\\mat_skin.fx',
    根 + '\\\\Materials\\\\toon\\\\mat_toon.fxsub'
  ];
  const 文本 = (p) => {
    if (/ray\\\\.conf$/i.test(p)) return '// ray.conf\\n#define RAY_QUALITY 2\\n#define SUN_LIGHT_ENABLE 1\\n';
    if (/ray_advanced\\\\.conf$/i.test(p)) return '// ray_advanced.conf\\n#define HDR_TONEMAP_OPERATOR 4\\n';
    return '// 材质文件\\n#define OUTLINE_SMOOTH 1\\n#define A_MAP_FILE "a.png"\\nconst float OUTLINE_WIDTH = 1.0;\\n';
  };
  /* 路径里有中文，btoa 直接吃字符串会抛 —— 按 UTF-8 编码再转 */
  const b64 = (s) => { const u = new TextEncoder().encode(s); let bin = ''; for (const b of u) bin += String.fromCharCode(b); return btoa(bin); };
  const 全表 = [
    { path: 根 + '\\\\ray.conf', rel: 'ray.conf', name: 'ray.conf', ext: 'conf', size: 64 },
    { path: 根 + '\\\\ray_advanced.conf', rel: 'ray_advanced.conf', name: 'ray_advanced.conf', ext: 'conf', size: 64 },
    { path: 根 + '\\\\ray.fx', rel: 'ray.fx', name: 'ray.fx', ext: 'fx', size: 64 },
    ...材质.map((p) => ({ path: p, rel: p.slice(根.length + 1), name: p.split(/[\\\\\\\\\\\\/]/).pop(), ext: p.split('.').pop(), size: 128 }))
  ];
  window.__假 = { 调用: [], 监听: {}, 报错记录: [] };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      window.__假.调用.push(cmd === 'read_text_file' || cmd === 'read_bytes' ? cmd + ' ' + args.path : cmd);
      if (cmd === 'plugin:event|listen') { window.__假.监听[args.event] = window['_' + args.handler]; return 1; }
      if (cmd === 'plugin:event|unlisten') return null;
      if (cmd === 'find_file') { const hit = 全表.find((f) => f.name === args.target); return hit ? hit.path : null; }
      if (cmd === 'scan_dir') return 全表;
      if (cmd === 'read_text_file') return { text: 文本(args.path), encoding: 'utf-8', lossy: false, bom: false };
      if (cmd === 'read_bytes') return b64(文本(args.path));
      if (cmd === 'probe_dir') return { exists: true, is_dir: true, entries: 全表.length, names: 全表.map((f) => f.name) };
      if (cmd === 'plugin:dialog|open') {
        const o = args && args.options || {};
        if (o.directory) return 根;
        return 材质[0];
      }
      console.log('[假后端] 没桩的命令:', cmd);
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
if (!t) throw new Error(`CDP :${PORT} 上没有可连的 page`);
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

const 跑 = async (表达式) => {
  const r = await rpc('Runtime.evaluate', { expression: 表达式, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));

await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: 桩 });
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') {
    console.log('[页面异常]', (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split('\n')[0]);
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    console.log('[页面 console.error]', (m.params.args ?? []).map((a) => a.value ?? a.description).join(' '));
  }
});

/** 页面里那套量具：每次导航后都要重装 */
const 装工具 = `
window.__探 = {
  落点表: async () => {
    /* 必须拿**页面正在用的那一个实例**：HMR 重新拉过的模块 URL 上带 ?t=，
       裸路径 import 会拿到另一份（表是空的），那读出来的就是假象。 */
    const 真 = performance.getEntriesByType('resource').map((e) => e.name)
      .find((n) => n.includes('/src/lib/dropzones.svelte.ts'));
    const m = await import(真 || '/src/lib/dropzones.svelte.ts');
    return { 实例: 真 ? '页面自己那份' : '裸路径（可能不是同一份）', ids: m.zoneIds(), 落点: m.listZones().map((z) => ({
      id: z.id,
      标记: z.el ? (z.el.tagName + '.' + (z.el.className || '')) : '（没有元素）',
      收什么: z.accept ?? '（图片）',
      矩形: z.el ? (() => { const r = z.el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v)); })() : null
    })) };
  },
  行表: () => {
    const 卡 = [...document.querySelectorAll('div.card.pad')].find((c) => /包里的材质文件/.test(c.textContent || ''));
    if (!卡) return '（没有材质卡）';
    return [...卡.querySelectorAll('ul.list > li')].map((li) => {
      const r = li.getBoundingClientRect();
      return { 行: (li.querySelector('button') || {}).title || '', 矩形: [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v)), 高亮: li.classList.contains('is-drop') };
    });
  },
  载入标签: () => (document.querySelector('.wbar__r .mini.mono') || {}).textContent || (document.querySelector('.wbar__l .mini.mono') || {}).textContent || '（没载入任何文件）',
  参数行数: () => document.querySelectorAll('.wb__main .rows > *').length,
  侧栏错: () => window.__假.报错记录.slice(),
  页码提示: () => { const t = document.querySelector('.toast'); return t ? (t.textContent || '').replace(/\\s+/g, ' ').trim() : '（没有页面提示）'; },
  清账: () => { window.__假.报错记录 = []; window.__假.调用 = []; document.querySelector('.side__errx')?.click(); },
  调用: () => window.__假.调用.slice(),
  中心: (el) => { const r = el.getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; },
  工作区: () => { const w = document.querySelector('.wb__main'); return w ? window.__探.中心(w) : null; },
  材质行: (i) => {
    const 卡 = [...document.querySelectorAll('div.card.pad')].find((c) => /包里的材质文件/.test(c.textContent || ''));
    return 卡 ? 卡.querySelectorAll('ul.list > li')[i] : null;
  },
  /** 贴图那一行（它自己有个只收图片的落点，面积比整页小） */
  贴图行: () => document.querySelector('.wb__main .tex'),
  合成HTML5拖放: (x, y, 文件名) => {
    const dt = new DataTransfer();
    dt.items.add(new File(['// 拖进来的\\n#define DROPPED 1\\n'], 文件名, { type: 'text/plain' }));
    const 发 = (type) => window.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    const 出 = [];
    for (const k of ['dragenter', 'dragover', 'drop']) { 发(k); 出.push(k + '→' + [...dt.types].join('+')); }
    return { x: Math.round(x), y: Math.round(y), 事件: 出 };
  },
  原生: (类型, 载荷) => {
    const cb = window.__假.监听['tauri://drag-' + 类型];
    if (!cb) return '（没有 tauri://drag-' + 类型 + ' 监听）';
    cb({ event: 'tauri://drag-' + 类型, id: 1, payload: 载荷 });
    return 'ok';
  },
  原生在: (x, y) => ({ x: x * (devicePixelRatio || 1), y: y * (devicePixelRatio || 1) }),
  /* 桌面端一次完整的"拖进来松手"：enter → over → drop */
  原生拖放: (x, y, 路径) => {
    const p = window.__探.原生在(x, y);
    window.__探.原生('enter', { paths: [], position: p });
    window.__探.原生('over', { position: p });
    window.__探.原生('drop', { paths: [路径], position: p });
    return { x: Math.round(x), y: Math.round(y) };
  }
};
'工具装好了';
`;

const 装观察器 = `(() => {
  const 记 = () => {
    const e = document.querySelector('.side__err');
    const t = e ? (e.textContent || '').replace(/\\s+/g, ' ').trim() : '';
    const L = window.__假.报错记录;
    if (t && L[L.length - 1] !== t) L.push(t);
  };
  new MutationObserver(记).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setInterval(记, 120);
  return '观察器挂好了';
})()`;

async function 到页(路由) {
  await rpc('Page.navigate', { url: `${APP}${路由}` });
  await 等(3200);
  await 跑(装观察器);
  await 跑(装工具);
}

const 画 = (标题, 对象) => {
  console.log(`\n---- ${标题} ----`);
  console.log(typeof 对象 === 'string' ? 对象 : JSON.stringify(对象, null, 1));
};

/* ==================================================================== */
/*  甲、conf 分区（包目录 + 材质清单）                                    */
/* ==================================================================== */

await 到页('/tools/ray?panel=conf');
await 跑(`(async () => {
  [...document.querySelectorAll('button')].find((b) => /选 Ray 包目录/.test(b.textContent || ''))?.click();
  await new Promise((r) => setTimeout(r, 1600));
})()`);
画('甲-1 载入包目录之后：底栏 / 行数', await 跑(`({
  底栏文件名: window.__探.载入标签(),
  行表: window.__探.行表()
})`));
画('甲-2 落点注册表（页面里的真注册表）', await 跑('window.__探.落点表()'));

await 跑('window.__探.清账()');
画('甲-3 HTML5 那条：把 .fx 拖到第一行上（浏览器拿不到真路径，该明确报错）', await 跑(`(async () => {
  const li = window.__探.材质行(0);
  const c = window.__探.中心(li);
  const 前 = window.__探.载入标签();
  const d = window.__探.合成HTML5拖放(c.x, c.y, '拖进来的材质.fx');
  await new Promise((r) => setTimeout(r, 900));
  return { 派发: d, 派发前: 前, 派发后: window.__探.载入标签(), 侧栏报错: window.__探.侧栏错(), 页面提示: window.__探.页码提示(), 读文本: window.__探.调用().filter((k) => /read_text_file/.test(k)) };
})()`));

await 跑('window.__探.清账()');
画('甲-4 桌面端那条：over 到第二行 → drop 一个盘上的 .fx', await 跑(`(async () => {
  const li = window.__探.材质行(1);
  const c = window.__探.中心(li);
  const p = window.__探.原生在(c.x, c.y);
  const 前 = window.__探.载入标签();
  window.__探.原生('enter', { paths: [], position: p });
  window.__探.原生('over', { position: p });
  const 高亮 = window.__探.行表().map((r) => r.高亮);
  window.__探.原生('drop', { paths: ['D:\\\\别处\\\\拖进来的材质.fx'], position: p });
  await new Promise((r) => setTimeout(r, 1000));
  return { 派发前: 前, over时各行高亮: 高亮, 派发后: window.__探.载入标签(), 侧栏报错: window.__探.侧栏错(), 页面提示: window.__探.页码提示(), 读文本: window.__探.调用().filter((k) => /read_text_file/.test(k)) };
})()`));

await 跑('window.__探.清账()');
画('甲-5 桌面端那条：拖到卡片空白处（该走默认动作）', await 跑(`(async () => {
  const 卡 = [...document.querySelectorAll('div.card.pad')].find((c) => /包里的材质文件/.test(c.textContent || ''));
  const r = 卡.getBoundingClientRect();
  const 前 = window.__探.载入标签();
  window.__探.原生拖放(r.right - 14, r.top + 10, 'D:\\\\别处\\\\卡片上的材质.fxsub');
  await new Promise((r2) => setTimeout(r2, 1000));
  return { 派发前: 前, 派发后: window.__探.载入标签(), 侧栏报错: window.__探.侧栏错(), 页面提示: window.__探.页码提示(), 读文本: window.__探.调用().filter((k) => /read_text_file/.test(k)) };
})()`));

await 跑('window.__探.清账()');
画('甲-6 桌面端那条：拖一个 .png 到材质行上（该明确拒收）', await 跑(`(async () => {
  const li = window.__探.材质行(0);
  const c = window.__探.中心(li);
  const 前 = window.__探.载入标签();
  window.__探.原生拖放(c.x, c.y, 'D:\\\\别处\\\\一张图.png');
  await new Promise((r) => setTimeout(r, 800));
  return { 派发前: 前, 派发后: window.__探.载入标签(), 侧栏报错: window.__探.侧栏错(), 页面提示: window.__探.页码提示() };
})()`));

/* ==================================================================== */
/*  乙、material 分区（真正改材质参数的那一页）                            */
/* ==================================================================== */

await 到页('/tools/ray?panel=material');
画('乙-1 没载入文件时：落点注册表', await 跑('window.__探.落点表()'));

await 跑('window.__探.清账()');
画('乙-2 没载入文件时：把 .fx 拖到工作区（界面文案说"把文件从窗口外拖进来"）', await 跑(`(async () => {
  const c = window.__探.工作区();
  const 前 = window.__探.载入标签();
  const HTML5 = window.__探.合成HTML5拖放(c.x, c.y, '拖进来的材质.fx');
  window.__探.原生拖放(c.x, c.y, 'D:\\\\别处\\\\拖进来的材质.fx');
  await new Promise((r) => setTimeout(r, 1200));
  return { 工作区中心: { x: Math.round(c.x), y: Math.round(c.y) }, HTML5, 派发前: 前, 派发后: window.__探.载入标签(),
    侧栏报错: window.__探.侧栏错(), 页面提示: window.__探.页码提示(), 读文本: window.__探.调用().filter((k) => /read_text_file/.test(k)) };
})()`));

/* 用「选 .fx / .fxsub」兜底载一个进来（假对话框直接给 mat_body.fx） */
await 跑('window.__探.清账()');
画('乙-3 用工具条上那颗按钮载入（兜底那条）', await 跑(`(async () => {
  [...document.querySelectorAll('button')].find((b) => /选 \\.fx \\/ \\.fxsub/.test(b.textContent || ''))?.click();
  await new Promise((r) => setTimeout(r, 1200));
  return { 载入的: window.__探.载入标签(), 参数行数: window.__探.参数行数(), 侧栏报错: window.__探.侧栏错(), 页面提示: window.__探.页码提示() };
})()`));

画('乙-4 载入之后：落点注册表', await 跑('window.__探.落点表()'));

await 跑('window.__探.清账()');
画('乙-5 载入之后：把**另一个**材质拖到参数区上（该换成它）', await 跑(`(async () => {
  const c = window.__探.工作区();
  const 前 = window.__探.载入标签();
  window.__探.原生拖放(c.x, c.y + 60, 'D:\\\\别处\\\\另一个材质.fxsub');
  await new Promise((r) => setTimeout(r, 1200));
  return { 派发前: 前, 派发后: window.__探.载入标签(), 侧栏报错: window.__探.侧栏错(), 页面提示: window.__探.页码提示(), 读文本: window.__探.调用().filter((k) => /read_text_file/.test(k)) };
})()`));

/* 对照：conf 分区里那条链是通的（甲-4），这里把同一段逻辑再点一遍 */
画('乙-6 对照：DOM 里到底挂了哪些 data-drop-key / 落点宿主', await 跑(`({
  材质卡在不在: !!document.querySelector('.card.pad h3.h3'),
  工作区在不在: !!document.querySelector('.wb__main'),
  工具条左在不在: !!document.querySelector('.wbar__l'),
  贴图行在不在: !!document.querySelector('.wb__main .tex')
})`));

await 跑('window.__探.清账()');
画('乙-7 把 .fx 正好丢在**贴图那一行**上（那一行只收图片，该往下让给整页落点）', await 跑(`(async () => {
  const tex = window.__探.贴图行();
  if (!tex) return '这一页没有贴图行';
  const c = window.__探.中心(tex);
  const 前 = window.__探.载入标签();
  window.__探.原生拖放(c.x, c.y, 'D:\\\\别处\\\\丢在贴图行上的.fx');
  await new Promise((r) => setTimeout(r, 1200));
  return { 派发前: 前, 派发后: window.__探.载入标签(), 侧栏报错: window.__探.侧栏错(), 页面提示: window.__探.页码提示(), 读文本: window.__探.调用().filter((k) => /read_text_file/.test(k)) };
})()`));

/* ==================================================================== */
/*  丙、点在图里的空白上：必须出声，不许静默                              */
/* ==================================================================== */

await 到页('/tools/ray?panel=material');
await 跑(`(async () => {
  [...document.querySelectorAll('button')].find((b) => /选 \\.fx \\/ \\.fxsub/.test(b.textContent || ''))?.click();
  await new Promise((r) => setTimeout(r, 1000));
})()`);
await 跑('window.__探.清账()');
画('丙-1 桌面端：把 .png 丢在材质参数页的参数区上（该明确说这一处只收 .fx / .fxsub）', await 跑(`(async () => {
  const c = window.__探.工作区();
  window.__探.原生拖放(c.x, c.y + 40, 'D:\\\\别处\\\\一张图.png');
  await new Promise((r) => setTimeout(r, 900));
  return { 侧栏报错: window.__探.侧栏错(), 页面提示: window.__探.页码提示() };
})()`));

await 到页('/tools/migrate?panel=repair');
await 跑('window.__探.清账()');
画('丙-2 桌面端：把文件丢在**没有落点的页**上（该说"没落在能接它的地方"，不是"不是图片"、也不是静默）', await 跑(`(async () => {
  window.__探.原生拖放(700, 500, 'D:\\\\别处\\\\一个材质.fx');
  await new Promise((r) => setTimeout(r, 900));
  const 桌面 = window.__探.侧栏错();
  window.__探.清账();
  const 文件 = new DataTransfer();
  文件.items.add(new File(['x'], '一个材质b.fx', { type: 'text/plain' }));
  window.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: 700, clientY: 500, dataTransfer: 文件 }));
  window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 700, clientY: 500, dataTransfer: 文件 }));
  await new Promise((r) => setTimeout(r, 900));
  return { 桌面端那条: 桌面, HTML5那条: window.__探.侧栏错() };
})()`));

await 落盘();
ws.close();
