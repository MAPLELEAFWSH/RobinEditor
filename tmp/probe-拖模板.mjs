/**
 * 探针：⑥ 养乐多（Yaku）的 `.fx` 落点 —— 把模板拖进去到底会不会载入。
 *
 * 跟 `probe-拖材质.mjs` 同一套办法：假后端（桩 `__TAURI_INTERNALS__`）+ 真界面 +
 * **真的 drop 事件**（HTML5 的 DataTransfer 那条 + 桌面端 `tauri://drag-*` 那条）。
 * 落点注册表从页面里 `import(页面自己那份 url)` 拿，量的是真注册表。
 *
 * 用法（先 pnpm dev + 无头 Chrome）：
 *   $env:CDP_PORT='9500'; node tmp\probe-拖模板.mjs
 */
const PORT = process.env.CDP_PORT ?? '9500';
const BASE = `http://127.0.0.1:${PORT}`;
const APP = process.env.DEV_ORIGIN ?? 'http://127.0.0.1:1420';

const 流水 = [];
const 原console = console.log.bind(console);
console.log = (...a) => {
  流水.push(a.map((x) => (typeof x === 'string' ? x : String(x))).join(' '));
  原console(...a);
};
const 落盘 = async () => {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(new URL('./拖模板-验收.log', import.meta.url), 流水.join('\n') + '\n', 'utf8');
};

/* ---------------- 假后端：一份养乐多 fx 模板 ---------------- */

const 桩 = `
(() => {
  const 模板 = 'D:\\\\养乐多包\\\\mat_body.fx';
  const 文本 = [
    '// mat_body.fx',
    '#define MAT_TYPE 4',
    '#define OUTLINE 1',
    '#define SPHERE_MODE 2',
    'float4 DIFFUSE_MAP_FILE = "a.png";',
    'float4 TOON_MAP_FILE = "b.png";',
    'float4 SPHERE_MAP_FILE = "c.png";',
    'float4 NORMAL_MAP_FILE = "d.png";',
    'float4 EMISSIVE_MAP_FILE = "e.png";',
    'float4 MATCAP_MAP_FILE = "f.png";',
    'CONTROLOBJECT <string name = "Body";>',
    'float EdgeRate = 0.5;',
    'float ShadowRate = 0.8;',
    'float3 Diffuse = float3(1,1,1);',
    'float3 Ambient = float3(0.5,0.5,0.5);',
    'float Power = 30;',
    'float SpecularRate = 0.6;',
    'float NormalRate = 0.4;',
    'float SphereRate = 0.3;',
    'float MatCapRate = 0.2;',
    'float MsToonRate = 0.1;',
    'float RimRate = 0.0;',
    'float OutlineRate = 1.0;',
    '#define A_MAP_FILE "g.png"'
  ].join('\\n');
  const b64 = (s) => { const u = new TextEncoder().encode(s); let bin = ''; for (const b of u) bin += String.fromCharCode(b); return btoa(bin); };
  window.__假 = { 调用: [], 监听: {}, 报错记录: [], 桩文本: 文本 };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      window.__假.调用.push(cmd === 'read_text_file' || cmd === 'read_bytes' ? cmd + ' ' + args.path : cmd);
      if (cmd === 'plugin:event|listen') { window.__假.监听[args.event] = window['_' + args.handler]; return 1; }
      if (cmd === 'plugin:event|unlisten') return null;
      if (cmd === 'read_text_file') return { text: 文本, encoding: 'utf-8', lossy: false, bom: false };
      if (cmd === 'read_bytes') return b64(文本);
      if (cmd === 'find_file') return null;
      if (cmd === 'scan_dir') return [];
      if (cmd === 'probe_dir') return { exists: true, is_dir: true, entries: 1, names: ['模型'] };
      if (cmd === 'plugin:dialog|open') return 模板;
      console.log('[假后端] 没桩的命令:', cmd);
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
});

const 装工具 = `
window.__探 = {
  落点表: async () => {
    const 真 = performance.getEntriesByType('resource').map((e) => e.name)
      .find((n) => n.includes('/src/lib/dropzones.svelte.ts'));
    const m = await import(真 || '/src/lib/dropzones.svelte.ts');
    return { 实例: 真 ? '页面自己那份' : '裸路径', ids: m.zoneIds(), 落点: m.listZones().map((z) => ({
      id: z.id, 标记: z.el ? z.el.tagName : '（没有元素）', 收什么: z.accept ?? '（图片）',
      矩形: z.el ? (() => { const r = z.el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v)); })() : null
    })) };
  },
  模板格: () => [...document.querySelectorAll('[data-drop-target^="yaku:tmpl"]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { 落点: el.dataset.dropTarget, 值: (el.querySelector('.tmpl__v') || {}).textContent || (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 30), 矩形: [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v)) };
  }),
  侧栏错: () => window.__假.报错记录.slice(),
  页面提示: () => { const t = document.querySelector('.toast'); return t ? (t.textContent || '').replace(/\\s+/g, ' ').trim() : '（没有页面提示）'; },
  清账: () => { window.__假.报错记录 = []; window.__假.调用 = []; document.querySelector('.side__errx')?.click(); },
  调用: () => window.__假.调用.slice(),
  中心: (el) => { const r = el.getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; },
  落点元素: (id) => document.querySelector('[data-drop-target="' + id + '"]'),
  合成HTML5拖放: (el, 文件名) => {
    const dt = new DataTransfer();
    dt.items.add(new File(['// 拖进来的\\n#define X 1\\n'], 文件名, { type: 'text/plain' }));
    const r = el.getBoundingClientRect();
    const x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
    const 出 = [];
    for (const k of ['dragenter', 'dragover', 'drop']) {
      window.dispatchEvent(new DragEvent(k, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
      出.push(k);
    }
    return { x: Math.round(x), y: Math.round(y), 事件: 出 };
  },
  原生: (类型, 载荷) => { const cb = window.__假.监听['tauri://drag-' + 类型]; if (!cb) return '（没有监听）'; cb({ event: 'tauri://drag-' + 类型, id: 1, payload: 载荷 }); return 'ok'; },
  原生拖放: (x, y, 路径) => {
    const p = { x: x * (devicePixelRatio || 1), y: y * (devicePixelRatio || 1) };
    window.__探.原生('enter', { paths: [路径], position: p });
    window.__探.原生('over', { position: p });
    window.__探.原生('drop', { paths: [路径], position: p });
    return { x: Math.round(x), y: Math.round(y) };
  },
  原生拖放到: (el, 路径) => { const c = window.__探.中心(el); return window.__探.原生拖放(c.x, c.y, 路径); }
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

const 画 = (标题, 对象) => {
  console.log(`\n---- ${标题} ----`);
  console.log(typeof 对象 === 'string' ? 对象 : JSON.stringify(对象, null, 1));
};

await rpc('Page.navigate', { url: `${APP}/tools/yaku?panel=apply` });
await 等(3500);
await 跑(装观察器);
await 跑(装工具);

画('一、养乐多 · 落点注册表', await 跑('window.__探.落点表()'));
画('二、养乐多 · 模板那几格', await 跑('window.__探.模板格()'));

await 跑('window.__探.清账()');
画('三、桌面端：把 .fx 拖到「身体」那一行上', await 跑(`(async () => {
  const el = window.__探.落点元素('yaku:tmpl:body');
  if (!el) return '（没有 yaku:tmpl:body 落点元素）';
  const 前 = window.__探.模板格();
  window.__探.原生拖放到(el, 'D:\\\\养乐多包\\\\mat_body.fx');
  await new Promise((r) => setTimeout(r, 1000));
  return { 拖之前: 前.map((x) => x.落点 + '=' + x.值), 拖之后: window.__探.模板格().map((x) => x.落点 + '=' + x.值),
    侧栏报错: window.__探.侧栏错(), 页面提示: window.__探.页面提示(), 读文本: window.__探.调用().filter((k) => /read_text_file/.test(k)) };
})()`));

await 跑('window.__探.清账()');
画('四、桌面端：把 .fx 拖到「模板卡空白处」（该按文件名猜域）', await 跑(`(async () => {
  const 卡 = window.__探.落点元素('yaku:tmplcard');
  const r = 卡.getBoundingClientRect();
  window.__探.原生拖放(r.right - 8, r.bottom - 4, 'D:\\\\别处\\\\mat_hair.fx');
  await new Promise((r2) => setTimeout(r2, 1000));
  return { 模板格: window.__探.模板格().map((x) => x.落点 + '=' + x.值), 侧栏报错: window.__探.侧栏错(), 页面提示: window.__探.页面提示(),
    读文本: window.__探.调用().filter((k) => /read_text_file/.test(k)) };
})()`));

await 跑('window.__探.清账()');
画('五、桌面端：把 .fx 拖到这一页**别的空地方**（不指着那几行，该按文件名猜域）', await 跑(`(async () => {
  const 页 = document.querySelector('.wb');
  const r = 页.getBoundingClientRect();
  /* 主区底部靠左：在页面落点里，但不在模板三行 / 模板卡 / 文件行上
     （这一页 2026-09-23 改成标准骨架了，原来那个 `.ywrap` 类没了 —— 按 `.wb` 取） */
  const x = r.left + 80, y = r.bottom - 40;
  window.__探.原生拖放(x, y, 'D:\\\\别处\\\\mat_face.fx');
  await new Promise((r2) => setTimeout(r2, 1100));
  return { 落点: { x: Math.round(x), y: Math.round(y) }, 页矩形: [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v)),
    模板格: window.__探.模板格().map((x2) => x2.落点 + '=' + x2.值), 侧栏报错: window.__探.侧栏错(), 页面提示: window.__探.页面提示(),
    读文本: window.__探.调用().filter((k) => /read_text_file/.test(k)) };
})()`));

await 跑('window.__探.清账()');
画('五之二、桌面端：把 .fx 拖到窗口最边上（应用侧栏，谁都不接）', await 跑(`(async () => {
  window.__探.原生拖放(60, 900, 'D:\\\\别处\\\\没人接.fx');
  await new Promise((r) => setTimeout(r, 900));
  return { 侧栏报错: window.__探.侧栏错(), 页面提示: window.__探.页面提示() };
})()`));

await 跑('window.__探.清账()');
画('六、桌面端：把 .png 拖到模板行上（该说清只收 .fx / .fxsub）', await 跑(`(async () => {
  const el = window.__探.落点元素('yaku:tmpl:face');
  window.__探.原生拖放到(el, 'D:\\\\别处\\\\一张图.png');
  await new Promise((r) => setTimeout(r, 900));
  return { 模板格: window.__探.模板格().map((x) => x.落点 + '=' + x.值), 侧栏报错: window.__探.侧栏错(), 页面提示: window.__探.页面提示() };
})()`));

await 跑('window.__探.清账()');
画('七、HTML5：把 .fx 拖到模板行上（浏览器拿不到真路径，该明确报错）', await 跑(`(async () => {
  const el = window.__探.落点元素('yaku:tmpl:hair');
  const d = window.__探.合成HTML5拖放(el, '拖进来的模板.fx');
  await new Promise((r) => setTimeout(r, 900));
  return { 派发: d, 模板格: window.__探.模板格().map((x) => x.落点 + '=' + x.值), 侧栏报错: window.__探.侧栏错(), 页面提示: window.__探.页面提示() };
})()`));

/* ---------- 对照：Ray 那两页再量一遍，看拒收话是哪一句 ---------- */
await rpc('Page.navigate', { url: `${APP}/tools/ray?panel=conf` });
await 等(3200);
await 跑(装观察器);
await 跑(装工具);
await 跑(`(async () => {
  [...document.querySelectorAll('button')].find((b) => /选 Ray 包目录/.test(b.textContent || ''))?.click();
  await new Promise((r) => setTimeout(r, 1600));
})()`);
画('八、对照 · Ray 配置开关页：落点注册表', await 跑('window.__探.落点表()'));
await 跑('window.__探.清账()');
画('九、对照 · Ray：把 .fx 拖到材质卡空白处', await 跑(`(async () => {
  const 卡 = [...document.querySelectorAll('div.card.pad')].find((c) => /包里的材质文件/.test(c.textContent || ''));
  const r = 卡.getBoundingClientRect();
  window.__探.原生拖放(r.right - 10, r.bottom - 6, 'D:\\\\别处\\\\材质.fx');
  await new Promise((r2) => setTimeout(r2, 1000));
  return { 底栏: (document.querySelector('.wbar__r .mini.mono') || {}).textContent || '（空）', 侧栏报错: window.__探.侧栏错() };
})()`));

await 落盘();
ws.close();
