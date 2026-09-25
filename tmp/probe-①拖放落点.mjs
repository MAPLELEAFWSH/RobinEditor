/**
 * 探针：① 日文乱码修复 —— **拖进来的东西到底落没落在落点上**。
 *
 * 为什么要这套：用户 2026-09-24 报"拖不进去，显示没落在能接它的地方 ——
 * 拖到有落点的位置，或用那一处的「选…」按钮"。那句话说出口只有两种可能：
 *   ① 在那个点上**根本没有落点**（注册表里就没有，或者矩形没算对）；
 *   ② 有落点，但"落点解析"那一段没跑到（坐标没拿到、dpr 没除对、`over` 没来过）。
 * 这两件事在代码里看不出区别，只能派真事件问界面 —— 所以量的是：
 *   · 每个分栏的落点注册表里**有几个**落点、矩形在哪儿；
 *   · 桌面端原生那条路（`onDragDropEvent`）四种走法各自落到哪儿：
 *       甲 正确坐标 + enter→over→drop      （正常拖）
 *       乙 正确坐标 + 只来 drop（没有 over）（拖进来就撒手）
 *       丙 只来 enter→drop，且 drop **不带坐标**（载荷缺位置）
 *       丁 故意偏到没有落点的地方（该说"没落在能接它的地方"，不许静默）
 *   · 再加一遍 dpr=2：载荷按**设备像素**给，看除 dpr 那一步对不对。
 *
 * 假后端 + 真界面 + 真事件：`__TAURI_INTERNALS__` 是桩，但 `tauri://drag-*` 的
 * 监听、落点注册表、命中判定全是页面里那一份真的。
 *
 * 用法（先 `pnpm dev` 起 1420，再无头 Chrome 开 9500）：
 *   $env:CDP_PORT='9500'; node tmp\probe-①拖放落点.mjs
 */
const PORT = process.env.CDP_PORT ?? '9500';
const BASE = `http://127.0.0.1:${PORT}`;
const APP = process.env.DEV_ORIGIN ?? 'http://127.0.0.1:1420';

/* 全文落一份到 tmp 里，报告里要引用原文 */
const 流水 = [];
const 原console = console.log.bind(console);
console.log = (...a) => {
  流水.push(a.map((x) => (typeof x === 'string' ? x : String(x))).join(' '));
  原console(...a);
};

/* ---------------- 假后端 ----------------
   桩里**不许出现反引号**：它自己就是一层模板字符串，反引号会把桩截断
   （`tmp\probe-⑤点击抽搐.mjs` 踩过）。路径里的反斜杠用 String.fromCharCode(92) 拼，
   免得跟这层的转义打架。 */
const 桩 = `
(() => {
  const BS = String.fromCharCode(92);
  const 根 = 'D:' + BS + '乱码测试';
  const 文件表 = [
    { path: 根 + BS + 'a.fx', name: 'a.fx', rel: 'a.fx', ext: 'fx', size: 128 },
    { path: 根 + BS + 'b.txt', name: 'b.txt', rel: 'b.txt', ext: 'txt', size: 64 }
  ];
  const 底 = (p) => p.slice(Math.max(p.lastIndexOf(BS), p.lastIndexOf('/')) + 1);
  const 是目录 = (p) => !/\\.[a-z0-9]+$/i.test(底(p));
  window.__假 = { 调用: [], 监听: {}, 报错记录: [] };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      const a = args || {};
      window.__假.调用.push(cmd + (a.path ? ' ' + a.path : a.root ? ' ' + a.root : a.text ? ' <text>' : ''));
      if (cmd === 'plugin:event|listen') { window.__假.监听[a.event] = window['_' + a.handler]; return 1; }
      if (cmd === 'plugin:event|unlisten') return null;
      if (cmd === 'read_text_fixed') return { text: 'これはテスト', original: 'x', encoding: 'shift_jis', bom: false, changed: true, segments: [] };
      if (cmd === 'read_text_file') return { text: 'これはテスト', encoding: 'shift_jis', lossy: false, bom: false };
      if (cmd === 'repair_text') return { original: 'x', fixed: 'これはテスト', changed: true, via: 'shift_jis', score_after: 1, score_before: 0, attempts: [], segments: [] };
      if (cmd === 'scan_pieces') return [];
      if (cmd === 'probe_dir') return { exists: true, is_dir: 是目录(a.path || ''), entries: 文件表.length, names: 文件表.map((f) => f.name) };
      if (cmd === 'scan_text_files') return [{ path: 根 + BS + 'a.fx', rel: 'a.fx', likely: true, via: 'shift_jis', sample_before: 'x', sample_after: 'y', uncertain: [] }];
      if (cmd === 'scan_names') return [{ path: 根 + BS + 'a.fx', dir: 根, 原名: 'x', 修后名: 'y', 自动可改: true, 原因: '', 候选: [] }];
      if (cmd === 'scan_dir') return 文件表;
      if (cmd === 'fix_text_file') return { path: a.path, rel: 底(a.path || ''), encoding: 'shift_jis', changed: true, via: 'shift_jis', lines: [1], before_sample: 'x', after_sample: 'y', written: false, backup: null, error: null };
      if (cmd === 'load_prefs' || cmd === 'plugin:store|get' || cmd === 'prefs') return null;
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

/* 页面里那套量具：每次导航后都要重装 */
const 装工具 = `
(() => {
  const 文 = (el) => (el && el.textContent ? el.textContent : '').replace(/\\s+/g, ' ').trim();
  window.__探 = {
    /** 注册表必须是**页面正在用的那一份**：裸路径 import 在 HMR 之后会拿到另一个实例 */
    落点表: async () => {
      const 真 = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/lib/dropzones.svelte.ts'));
      const m = await import(真 || '/src/lib/dropzones.svelte.ts');
      return { 实例: 真 ? '页面自己那份' : '裸路径（可能不是同一个实例）', ids: m.zoneIds(), 落点: m.listZones().map((z) => ({
        id: z.id, 收: z.accept === undefined ? '（图片）' : (z.accept === 'any' ? '任何' : z.accept.join('/')), dir: !!z.dir,
        矩形: z.el ? (() => { const r = z.el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v)); })() : null
      })) };
    },
    /** 拖错时说的话：侧栏那条 + 界面里挂着的提示条 */
    坏话: () => {
      const 栏 = 文(document.querySelector('.side__err'));
      const 条 = [...document.querySelectorAll('.note')].map(文)
        .filter((t) => /是单个文件|没落在能接|不是图片|不是这个落点要的|只收|不是文件夹|没接/.test(t));
      return { 侧栏: 栏, 界面提示: 条 };
    },
    清: () => {
      document.querySelector('.side__errx') && document.querySelector('.side__errx').click();
      window.__假.调用 = [];
      return '清了';
    },
    调用: () => window.__假.调用.slice(),
    /** 派一个原生拖放事件（照 Tauri 那条 onDragDropEvent 的载荷形状）。
        **包一层 try**：@tauri-apps/api 的 onDragDropEvent 会对着载荷里的 position
        直接 new PhysicalPosition(...)（dpi.js），position 整个缺席时它自己就抛 —— 
        那种情况下我们的回调根本不会被执行。抛了要说出来，别让探针跟着死。 */
    原生: (类型, 载荷) => {
      const cb = window.__假.监听['tauri://drag-' + 类型];
      if (!cb) return '（没有 tauri://drag-' + 类型 + ' 监听）';
      try {
        cb({ event: 'tauri://drag-' + 类型, id: 1, payload: 载荷 });
        return 'ok';
      } catch (e) {
        return '（@tauri-apps/api 那一层抛了：' + (e && e.message) + '）';
      }
    },
    物理: (x, y) => ({ x: x * (devicePixelRatio || 1), y: y * (devicePixelRatio || 1) }),
    中: (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; },
    框: (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; },
    /** 浏览器那条路：合成 DataTransfer + File，派真 dragover / drop */
    合成HTML5: (x, y, 文件名) => {
      const dt = new DataTransfer();
      dt.items.add(new File(['// x'], 文件名, { type: 'text/plain' }));
      const 发 = (类型) => window.dispatchEvent(new DragEvent(类型, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
      发('dragenter'); 发('dragover'); 发('drop');
      return 'ok';
    }
  };
  return '工具装好了';
})();
`;

/**
 * 一次拖放。走法：
 *   `全`     = enter→over→drop（正常拖）
 *   `无over` = enter→drop（`over` 一次都没来，拖进来就撒手）
 *   `裸drop` = 只来 drop（连 enter 都不给，最狠的一种）
 *   `偏`     = 同 `全`，但坐标故意给在别处
 * `位置码` 说的是 `drop` 那一下的坐标：
 *   `'物'`     按设备像素带坐标（真桌面端就是这种）
 *   `'空对'`   带 position 但里面没有 x/y（序列化出岔子那种；enter/over 仍是好的）
 *   `'无'`     整个没有 position 这个键
 */
const 拖 = (走法, x, y, 路径, 位置码 = '物') => `
(async () => {
  const 物 = window.__探.物理(${x}, ${y});
  const 位 = 物;
  const drop位 = ${位置码 === '空对' ? '({})' : '位'};
  const 路 = ${JSON.stringify(路径)};
  const 出 = [];
  const 走法 = ${JSON.stringify(走法)};
  if (走法 === '全' || 走法 === '偏' || 走法 === '无over') {
    出.push(window.__探.原生('enter', { paths: 路, position: 位 }));
  }
  if (走法 === '全' || 走法 === '偏') {
    出.push(window.__探.原生('over', { position: 位 }));
  }
  if (${位置码 === '无'}) 出.push(window.__探.原生('drop', { paths: 路 }));
  else 出.push(window.__探.原生('drop', { paths: 路, position: drop位 }));
  await new Promise((r) => setTimeout(r, 1200));
  return { 派发: [Math.round(${x}), Math.round(${y})], dpr: devicePixelRatio, 物理坐标: 位, 事件返回: 出, 坏话: window.__探.坏话(), 调用: window.__探.调用() };
})()
`;

/* ---------------- 断言记账 ---------------- */
const 账 = [];
const 判 = (名, 过, 说明) => {
  账.push({ 名, 过: !!过, 说明 });
  console.log(`${过 ? '✅' : '❌'} ${名} —— ${说明}`);
};
const 有调用 = (调用, 片段) => 调用.some((c) => c.includes(片段));

async function 到页(路由) {
  await rpc('Page.navigate', { url: `${APP}${路由}` });
  await 等(3400);
  await 跑(装工具);
}

/* ==================================================================== */
console.log('==== 甲、① 文本（panel=fix）：桌面端原生那条路的四种走法 ====');
/* ==================================================================== */

await rpc('Emulation.setDeviceMetricsOverride', { width: 1707, height: 1067, deviceScaleFactor: 1, mobile: false });
await 到页('/tools/glitch?panel=fix');

const 甲表 = await 跑('window.__探.落点表()');
console.log('落点表:', JSON.stringify(甲表, null, 1));
判('甲-0 文本栏挂了落点', (甲表?.落点 ?? []).length >= 2, `注册表里 ${(甲表?.落点 ?? []).length} 个（要 ≥2：文件那个 + 文件夹那个）`);

const 甲中 = await 跑(`window.__探.中('.wb__main')`);
const 甲框 = await 跑(`window.__探.框('.wb__main')`);
console.log('工作区中心:', JSON.stringify(甲中), '矩形:', JSON.stringify(甲框));

await 跑('window.__探.清()');
const 甲全 = await 跑(拖('全', 甲中.x, 甲中.y, ['D:\\别处\\甲.fx']));
判('甲-1 正确坐标 enter→over→drop 落在了落点上', 有调用(甲全.调用, 'read_text_fixed') && !甲全.坏话.侧栏,
  `读文本=${有调用(甲全.调用, 'read_text_fixed')}，侧栏=${JSON.stringify(甲全.坏话.侧栏)}`);

await 跑('window.__探.清()');
const 甲裸 = await 跑(拖('无over', 甲中.x, 甲中.y, ['D:\\别处\\乙.fx']));
判('甲-2 只来 enter→drop（`over` 一次没来，拖进来就撒手）也落在了落点上', 有调用(甲裸.调用, 'read_text_fixed') && !甲裸.坏话.侧栏,
  `读文本=${有调用(甲裸.调用, 'read_text_fixed')}，侧栏=${JSON.stringify(甲裸.坏话.侧栏)}`);

/* 连 `enter` 都不给：只剩 `drop` 自己带的位置 —— 这条上一版就有，得保住 */
await 跑('window.__探.清()');
const 甲只drop = await 跑(拖('裸drop', 甲中.x, 甲中.y, ['D:\\别处\\庚.fx']));
判('甲-3 只来 drop（连 enter 都没有）也落在了落点上', 有调用(甲只drop.调用, 'read_text_fixed') && !甲只drop.坏话.侧栏,
  `读文本=${有调用(甲只drop.调用, 'read_text_fixed')}，侧栏=${JSON.stringify(甲只drop.坏话.侧栏)}`);

/* `drop` 带的位置是空的 → 退回 `enter` 那次算出来的候选（本轮新加的退路） */
await 跑('window.__探.清()');
const 甲空 = await 跑(拖('无over', 甲中.x, 甲中.y, ['D:\\别处\\丙.fx'], '空对'));
判('甲-4 enter 有坐标、drop 的位置是空的 → 退回 enter 算出的落点，照样落地',
  有调用(甲空.调用, 'read_text_fixed') && !甲空.坏话.侧栏,
  `读文本=${有调用(甲空.调用, 'read_text_fixed')}，侧栏=${JSON.stringify(甲空.坏话.侧栏)}`);

/* 载荷**整个没有** position：量的是事实，不是我们的行为 ——
   @tauri-apps/api 的 onDragDropEvent 会 new PhysicalPosition(undefined) 直接抛，
   我们的回调根本跑不到。这条改不了（在库里面），记下来。 */
await 跑('window.__探.清()');
const 甲真无 = await 跑(拖('裸drop', 甲中.x, 甲中.y, ['D:\\别处\\丁.fx'], '无'));
判('甲-5 载荷整个没有 position → @tauri-apps/api 那一层就抛（事实，不是我们能修的）',
  (甲真无.事件返回 ?? []).some((s) => /抛了/.test(s)) && !有调用(甲真无.调用, 'read_text_fixed'),
  `事件返回=${JSON.stringify(甲真无.事件返回)}，读文本=${有调用(甲真无.调用, 'read_text_fixed')}`);

/* 故意偏到没有落点的地方：左侧导航栏那块（谁都不接），必须出声且那句要是实话 */
await 跑('window.__探.清()');
const 甲偏 = await 跑(拖('偏', 60, 420, ['D:\\别处\\戊.fx']));
const 甲偏词 = 甲偏.坏话.侧栏;
判('甲-6 故意偏到没有落点的地方 → 明说"没落在能接它的地方"，且没读文件',
  /没落在能接它的地方/.test(甲偏词) && !有调用(甲偏.调用, 'read_text_fixed'),
  `侧栏=${JSON.stringify(甲偏词)}，读文本=${有调用(甲偏.调用, 'read_text_fixed')}`);

/* dpr=2：载荷按设备像素给，看除 dpr 那一步 */
await rpc('Emulation.setDeviceMetricsOverride', { width: 1707, height: 1067, deviceScaleFactor: 2, mobile: false });
await 到页('/tools/glitch?panel=fix');
const 甲2中 = await 跑(`window.__探.中('.wb__main')`);
await 跑('window.__探.清()');
const 甲2 = await 跑(拖('全', 甲2中.x, 甲2中.y, ['D:\\别处\\己.fx']));
判('甲-7 dpr=2（125%/200% 缩放那种屏）载荷按设备像素给，仍然命中', 有调用(甲2.调用, 'read_text_fixed') && !甲2.坏话.侧栏,
  `dpr=${甲2.dpr}，物理坐标=${JSON.stringify(甲2.物理坐标)}，读文本=${有调用(甲2.调用, 'read_text_fixed')}，侧栏=${JSON.stringify(甲2.坏话.侧栏)}`);
await rpc('Emulation.setDeviceMetricsOverride', { width: 1707, height: 1067, deviceScaleFactor: 1, mobile: false });

/* 浏览器那条路（合成 File 没有真路径）也要能命中落点 —— 命中之后该说的是
   "没有真实路径"，不是"没落在能接它的地方"。这条是防改坏：本轮动的是落点注册那一块。 */
await 跑('window.__探.清()');
const 甲网 = await 跑(`(async () => {
  window.__探.合成HTML5(${甲中.x}, ${甲中.y}, '网页上的.fx');
  await new Promise((r) => setTimeout(r, 900));
  return { 坏话: window.__探.坏话(), 调用: window.__探.调用() };
})()`);
const 甲网词 = 甲网.坏话.侧栏 + ' ' + 甲网.坏话.界面提示.join(' ');
判('甲-8 浏览器那条路（HTML5 drop）同样命中了落点，说的是"没有真实路径"',
  /没有真实路径/.test(甲网词) && !/没落在能接它的地方/.test(甲网词),
  `提示=${JSON.stringify(甲网词)}`);

/* ==================================================================== */
console.log('\n==== 乙、另外三个分栏：以前一个落点都没有 ====');
/* ==================================================================== */

/* 每一栏：拖一个文件夹（该走那一栏的"选目录"） + 拖一个单文件（该收到一句指路的实话） */
const 乙表 = [
  ['batch', '① 文件', 'D:\\乱码目录', 'scan_text_files', /「文件」这一栏按目录扫/],
  ['names', '① 名称', 'D:\\名字目录', 'scan_names', /这一栏扫的是名字/],
  ['fx', '① .fx 注释', 'D:\\效果目录', 'scan_dir', /这一栏按目录扫 \.fx/]
];

for (const [分栏, 名, 目录, 该调的, 该说的] of 乙表) {
  await 到页(`/tools/glitch?panel=${分栏}`);
  const 表 = await 跑('window.__探.落点表()');
  console.log(`\n---- ${名}（panel=${分栏}）落点表 ----`);
  console.log(JSON.stringify(表, null, 1));
  判(`乙-0 ${名} 现在有落点`, (表?.落点 ?? []).length >= 2, `注册表里 ${(表?.落点 ?? []).length} 个：${(表?.ids ?? []).join(', ')}`);

  const 中 = await 跑(`window.__探.中('.wb__main')`);

  /* 文件夹：原生那条路照样只给一条路径、没有后缀 —— 必须落到 `dir` 那个落点上 */
  await 跑('window.__探.清()');
  const 目 = await 跑(拖('全', 中.x, 中.y, [目录]));
  const 目坏 = 目.坏话.侧栏 + ' ' + 目.坏话.界面提示.join(' ');
  判(`乙-1 ${名} 拖一个文件夹进去 → 走了那一栏的目录扫描`, 有调用(目.调用, 该调的) && !/没落在能接它的地方/.test(目坏),
    `调用=${JSON.stringify(目.调用)}，坏话=${JSON.stringify(目坏)}`);

  /* 单文件：这一栏没有"处理单个文件"这件事，该给一句指路的实话（不是那句"没落在能接它的地方"） */
  await 跑('window.__探.清()');
  const 单 = await 跑(拖('全', 中.x, 中.y, ['D:\\别处\\单个.fx']));
  const 单词 = 单.坏话.界面提示.join(' ') + ' ' + 单.坏话.侧栏;
  判(`乙-2 ${名} 拖一个单文件 → 说清楚该往哪儿拖（不是"没落在能接它的地方"）`,
    !/没落在能接它的地方/.test(单词) && 该说的.test(单词),
    `提示=${JSON.stringify(单词)}`);
}

/* ==================================================================== */
console.log('\n==== 丙、没动过的页：原有的落点还在（防改坏） ====');
/* ==================================================================== */

const 丙表 = [
  ['/tools/ray?panel=conf', '③ 配置开关', 'ray'],
  ['/tools/yaku?panel=match', '⑥ 材质匹配', 'yaku'],
  ['/tools/migrate?panel=repair', '⑨ 修复工程', 'migrate']
];
for (const [路由, 名, 前缀] of 丙表) {
  await 到页(路由);
  const 表 = await 跑('window.__探.落点表()');
  const 有 = (表?.ids ?? []).filter((x) => x.startsWith(前缀));
  判(`丙 ${名} 的落点还在`, 有.length >= 1, `ids=${JSON.stringify(表?.ids ?? [])}`);
}

/* ==================================================================== */
console.log('\n==== 汇总 ====');
/* ==================================================================== */
const 过 = 账.filter((x) => x.过).length;
console.log(`${过}/${账.length} 条通过`);
for (const x of 账.filter((x) => !x.过)) console.log(`  ❌ ${x.名} —— ${x.说明}`);

await (async () => {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(new URL('./①拖放落点-验收.log', import.meta.url), 流水.join('\n') + '\n', 'utf8');
})();
ws.close();
process.exitCode = 过 === 账.length ? 0 : 1;
