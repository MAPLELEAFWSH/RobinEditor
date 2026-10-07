/**
 * ③ 「把材质拖进来就载入它」这条链的自检。
 *
 * 为什么要单独一套：这条链上一轮断在**落点没人登记**上 —— 「材质参数」那一页
 * 一个落点都没有，拖进去落点解析找不到人接，最后只说一句"不是图片，没接"
 * （用户 2026-09-23 原话："改材质参数时没有按照要求可以拖拽载入材质"）。
 * 所以这里钉四件事：
 *
 *   1. `落点.ts` 那张表：**每一页都要有一个收 .fx 的落点**（上一轮就少这一条）
 *   2. 桌面端那条（原生 over + drop）：真把路径交给落点，而且**按后缀挑落点** ——
 *      丢在贴图行上的 `.fx` 会被那一行拒收（它只收图片），得往下让给整页那一个
 *   3. 浏览器那条（HTML5 drop）：合成 File 没有真路径，必须**明确报错**，不静默
 *   4. 落在没人接的地方也要出声，而且不许说成"不是图片，没接"（那是句假话）
 *
 * 跑的是 `drag-dom` + `dropzones` + `drop` 三个**真模块**，配一份手搭的假 DOM
 * （Node 里没有 DOM，`document` 被 register-loader 置成了 undefined，这里自己装）。
 * 界面那一层（真元素、真高亮、真载入）在 `tmp/probe-拖材质.mjs` 里用
 * 无头 Chrome + 假后端量，那个要 dev server 和浏览器，进不了 `pnpm test`。
 *
 * 跑：node --import ./tmp/register-loader.mjs tmp/拖材质链.test.mjs
 */
import { registerZone, resetZones, zoneIds } from '../src/lib/dropzones.svelte.ts';
import { createDragState, resetDropRegistry } from '../src/lib/drop.ts';
import { bringIn } from '../src/lib/drag-dom.ts';
import { 材质落点表, 材质后缀 } from '../src/lib/modules/ray/落点.ts';
import { 接目录 } from '../src/lib/dirdrop.ts';
import { setFolderRecorder } from '../src/lib/io.ts';

let pass = 0;
let fail = 0;
function ok(cond, label, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${extra ? '  → ' + extra : ''}`);
  }
}
const eq = (a, b, label) => ok(a === b, label, `实得 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}`);
const 含 = (s, 片, label) => ok(typeof s === 'string' && s.includes(片), label, `实得 ${JSON.stringify(s)}`);
// 自检 ok() 本身：条件为假必须记成失败
{
  const before = fail;
  const real = console.log;
  console.log = () => {};
  ok(false, '__selfcheck__');
  console.log = real;
  if (fail !== before + 1) {
    console.error('ok() 本身是坏的：条件为假没被记成失败');
    process.exit(1);
  }
  fail = before;
}

/* ================================================================ */
/*  假 DOM / 假后端                                                  */
/* ================================================================ */

/** 窗口级事件（HTML5 那条走这个） */
const 监听表 = new Map();
/** 假后端收到的 tauri://drag-* 回调（桌面端那条走这个） */
const 原生监听 = {};
/** 落点回调收到的路径，用来判"到底交给谁了" */
const 收到的 = {};
let 回调号 = 0;

globalThis.addEventListener = (t, fn) => {
  监听表.set(t, fn);
};
globalThis.removeEventListener = (t) => {
  监听表.delete(t);
};
globalThis.devicePixelRatio = 1;
globalThis.window = {
  __TAURI_INTERNALS__: {
    invoke: async (cmd, args) => {
      if (cmd === 'plugin:event|listen') {
        原生监听[args.event] = globalThis['_' + args.handler];
        return 1;
      }
      return null;
    },
    transformCallback: (cb) => {
      const id = ++回调号;
      globalThis['_' + id] = cb;
      return id;
    },
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { label: 'main', windowLabel: 'main' }
    }
  }
};
/** 底下没有图片槽：`elementFromPoint` 一律 null，量的就是"通用落点"那一条 */
globalThis.document = {
  elementFromPoint: () => null,
  querySelectorAll: () => [],
  documentElement: { contains: () => false }
};

const 盒 = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b });

/** 假元素：`noticeForward` 只用 classList，重算矩形只用 getBoundingClientRect */
function 假元素(rect) {
  const 类 = new Set();
  return {
    getBoundingClientRect: () => rect,
    classList: {
      add: (c) => 类.add(c),
      remove: (c) => 类.delete(c),
      contains: (c) => 类.has(c)
    },
    亮着: () => 类.has('is-drop')
  };
}

const 报错 = [];
const drag = createDragState((m) => 报错.push(m));

/** 挂一个落点，收到什么就记什么 */
function 挂落点(id, rect, accept, dir) {
  const el = 假元素(rect);
  收到的[id] = [];
  registerZone({
    id,
    rect,
    el,
    accept,
    dir,
    onDrop: (ref) => 收到的[id].push(ref.path)
  });
  return el;
}

/** 桌面端那条：enter 带路径 → over 报位置 → drop 报路径 */
function 原生拖放(x, y, 路径) {
  原生监听['tauri://drag-enter']({ payload: { paths: [路径], position: { x, y } } });
  原生监听['tauri://drag-over']({ payload: { position: { x, y } } });
  原生监听['tauri://drag-drop']({ payload: { paths: [路径], position: { x, y } } });
}

/** 浏览器那条：合成一个 DataTransfer 派发窗口事件 */
function HTML5事件(类型, x, y, 名字们 = [], relatedTarget = null) {
  const fn = 监听表.get(类型);
  if (!fn) throw new Error(`窗口上没有 ${类型} 监听`);
  fn({
    dataTransfer: { types: ['Files'], files: 名字们.map((n) => ({ name: n })), dropEffect: '' },
    clientX: x,
    clientY: y,
    preventDefault() {},
    relatedTarget
  });
}
const 静一静 = () => new Promise((r) => setTimeout(r, 20));

/* ================================================================ */

console.log('\n== 1. 每一页该有哪些落点（上一轮就断在这里） ==');
{
  const 材质页 = 材质落点表('material');
  ok(材质页.length > 0, '「材质参数」那一页不是空的（上一轮这里是 0 个落点）');
  const 收后缀 = (d) => (Array.isArray(d.accept) ? d.accept : []);
  ok(
    材质页.some((d) => 收后缀(d).includes('fx')),
    '「材质参数」那一页有一个收 .fx 的落点'
  );
  ok(
    材质页.some((d) => (d.槽 === 'page' || d.槽 === 'bar') && 收后缀(d).includes('fxsub')),
    '…而且它挂在页面本身（工具条 / 整页），不是只挂在清单某一行上'
  );

  const 配置页 = 材质落点表('conf');
  ok(配置页.some((d) => d.dir === true), '「配置开关」那一页有收文件夹的落点');
  ok(配置页.some((d) => d.槽 === 'card'), '「配置开关」那一页有材质卡那个落点');
  ok(配置页.some((d) => d.槽 === 'row'), '「配置开关」那一页有逐行的落点');
  ok(配置页.some((d) => d.槽 === 'page' && 收后缀(d).includes('fx')), '「配置开关」那一页也有一整页的落点');
  eq(材质落点表('没这一页').length, 0, '不认识的页一个落点都不注册');
  eq(材质后缀.join(','), 'fx,fxsub', '能拖进来打开的后缀就是 fx / fxsub');
}

resetDropRegistry();
resetZones();
const 停 = bringIn(drag);
await 静一静();

console.log('\n== 2. 两条路的监听都挂上了 ==');
{
  eq(
    Object.keys(原生监听).sort().join(','),
    'tauri://drag-drop,tauri://drag-enter,tauri://drag-leave,tauri://drag-over',
    'onDragDropEvent 那四个监听都注册了（桌面端那条）'
  );
  eq(
    [...监听表.keys()].sort().join(','),
    'dragenter,dragleave,dragover,drop',
    '窗口级四个 HTML5 监听也都在（浏览器那条）'
  );
}

console.log('\n== 3. 桌面端那条：叠着的落点里挑"收得下"的那个 ==');
{
  resetZones();
  /* 整页那一个收 .fx / .fxsub；贴图那一行只收图片，面积更小（更具体） */
  const 整页 = 挂落点('ray.mat:page', 盒(0, 0, 400, 400), 材质后缀);
  const 贴图行 = 挂落点('ray:define:0', 盒(100, 100, 200, 150));
  eq(zoneIds().join(','), 'ray.mat:page,ray:define:0', '两个落点都注册上了');

  /* 指着一行贴图丢 .fx：那一行不收，得让给整页那一个 */
  报错.length = 0;
  原生监听['tauri://drag-enter']({ payload: { paths: ['D:/别处/材质.fx'], position: { x: 150, y: 120 } } });
  原生监听['tauri://drag-over']({ payload: { position: { x: 150, y: 120 } } });
  eq(贴图行.亮着(), false, '指着贴图行丢 .fx 时，高亮不落在只收图片的那一行上');
  eq(整页.亮着(), true, '高亮落在整页那一个上（它才是收得下的）');
  原生监听['tauri://drag-drop']({ payload: { paths: ['D:/别处/材质.fx'], position: { x: 150, y: 120 } } });
  eq(收到的['ray.mat:page'].join(','), 'D:/别处/材质.fx', '整页那个落点拿到了真路径');
  eq(收到的['ray:define:0'].length, 0, '贴图行没被塞一个 .fx 进去');
  eq(报错.length, 0, '这一下不该有任何报错');

  /* 同一处丢一张图：这回归贴图行（它更具体，而且收得下） */
  报错.length = 0;
  原生监听['tauri://drag-enter']({ payload: { paths: ['D:/别处/a.png'], position: { x: 150, y: 120 } } });
  原生监听['tauri://drag-over']({ payload: { position: { x: 150, y: 120 } } });
  eq(贴图行.亮着(), true, '丢 .png 时高亮归贴图行');
  eq(整页.亮着(), false, '整页那一个这时不亮（只有最具体的那一个亮）');
  原生监听['tauri://drag-drop']({ payload: { paths: ['D:/别处/a.png'], position: { x: 150, y: 120 } } });
  eq(收到的['ray:define:0'].join(','), 'D:/别处/a.png', '贴图行拿到的是那张图');
  eq(收到的['ray.mat:page'].length, 1, '整页那个没被再塞一次（还是刚才那一条）');
  eq(报错.length, 0, '这一下也没有报错');
}

console.log('\n== 4. 桌面端那条：落点不收 / 没人接，都要说清楚 ==');
{
  resetZones();
  挂落点('ray.mat:page', 盒(0, 0, 400, 400), 材质后缀);
  报错.length = 0;

  /* 落在收得下的落点上，但后缀不对 */
  原生拖放(200, 200, 'D:/别处/一张图.png');
  await 静一静();
  eq(收到的['ray.mat:page'].length, 0, '不合后缀的文件不会被塞进去');
  含(报错.join(' / '), '只收 .fx / .fxsub', '拒收时说清了这一处收什么后缀');
  ok(!报错.join(' / ').includes('不是图片'), '拒收那句里没有"不是图片"（.png 本来就是图片）');

  /* 落在一片没人接的空地上 */
  报错.length = 0;
  原生拖放(900, 900, 'D:/别处/材质.fx');
  await 静一静();
  含(报错.join(' / '), '没落在能接它的地方', '落在空地上会出声');
  ok(!报错.join(' / ').includes('不是图片'), '也不许说"不是图片，没接"（拖的是 .fx）');
}

console.log('\n== 5. 浏览器那条：没有真路径就必须明确报错 ==');
{
  resetZones();
  挂落点('ray.mat:page', 盒(0, 0, 400, 400), 材质后缀);
  报错.length = 0;

  HTML5事件('drop', 200, 200, ['材质.fx']);
  await 静一静();
  eq(收到的['ray.mat:page'].length, 0, '合成 File 没有真路径，落点不该被调用');
  含(报错.join(' / '), '没有真实路径', '浏览器那条明确报错，不静默');

  /* HTML5 也一样：落在没人接的地方要出声 */
  报错.length = 0;
  HTML5事件('drop', 900, 900, ['材质.fx']);
  await 静一静();
  含(报错.join(' / '), '没落在能接它的地方', 'HTML5 那条落在空地上也出声（以前这里一声不响）');
}

console.log('\n== 6. 高亮：拖走要灭，落下要灭 ==');
{
  resetZones();
  const 整页 = 挂落点('ray.mat:page', 盒(0, 0, 400, 400), 材质后缀);
  HTML5事件('dragover', 200, 200);
  eq(整页.亮着(), true, '拖到落点上就亮');
  HTML5事件('dragleave', 200, 200, [], { nodeType: 1 });
  eq(整页.亮着(), false, '拖出窗口高亮灭');
  HTML5事件('dragover', 200, 200);
  HTML5事件('drop', 200, 200, ['材质.fx']);
  await 静一静();
  eq(整页.亮着(), false, '落下之后高亮跟着灭（不许"拖完了还亮着"）');
}

console.log('\n== 7. 文件夹落点（配置开关那一页那条） ==');
{
  resetZones();
  const 工具条 = 挂落点('ray:root', 盒(0, 0, 600, 40), undefined, true);
  报错.length = 0;

  原生监听['tauri://drag-enter']({ payload: { paths: ['D:/Ray测试包'], position: { x: 300, y: 20 } } });
  原生监听['tauri://drag-over']({ payload: { position: { x: 300, y: 20 } } });
  eq(工具条.亮着(), true, '拖文件夹过来，文件夹落点亮');
  原生监听['tauri://drag-drop']({ payload: { paths: ['D:/Ray测试包'], position: { x: 300, y: 20 } } });
  eq(收到的['ray:root'].join(','), 'D:/Ray测试包', '文件夹落点拿到的就是那条路径（不过后缀那道筛）');
  eq(报错.length, 0, '文件夹那条不报错');
}

console.log('\n== 8. `over` 一次都没来过（拖进来就撒手）也得认得落点 ==');
{
  /* 起由：落点明明声明了 accept，却因为**没找到落点**而没轮到它说话 ——
     落点解析落空 → 后缀筛法退回"只收图片" → 拖 .fx 进来得到"不是图片，没接"。
     wry 的 webview2 那条 `Drop` 是带位置的，所以撒手那一下能自己补找一遍。 */
  resetZones();
  const 整页 = 挂落点('yaku:page', 盒(0, 0, 400, 400), 材质后缀);
  报错.length = 0;

  /* 只来 enter + drop，中间一次 over 都没有 */
  原生监听['tauri://drag-enter']({ payload: { paths: ['D:/养乐多包/mat_body.fx'], position: { x: 200, y: 200 } } });
  原生监听['tauri://drag-drop']({ payload: { paths: ['D:/养乐多包/mat_body.fx'], position: { x: 200, y: 200 } } });
  eq(收到的['yaku:page'].join(','), 'D:/养乐多包/mat_body.fx', '没有 over 也落到了收 .fx 的那个落点上');
  eq(报错.length, 0, '没有 over 时也不许说"不是图片，没接"');

  /* 同一个漏洞在没有落点的页上：要说"没落在能接它的地方"，不是那句假话 */
  resetZones();
  报错.length = 0;
  原生监听['tauri://drag-enter']({ payload: { paths: ['D:/别处/材质.fx'], position: { x: 700, y: 700 } } });
  原生监听['tauri://drag-drop']({ payload: { paths: ['D:/别处/材质.fx'], position: { x: 700, y: 700 } } });
  await 静一静();
  含(报错.join(' / '), '没落在能接它的地方', '没落点时说的是实话');
  ok(!报错.join(' / ').includes('不是图片'), '还不许说"不是图片"');

  /* 连 enter 都没有（只剩 drop）也要认得出来 */
  resetZones();
  挂落点('yaku:page', 盒(0, 0, 400, 400), 材质后缀);
  报错.length = 0;
  原生监听['tauri://drag-drop']({ payload: { paths: ['D:/养乐多包/mat_hair.fx'], position: { x: 200, y: 200 } } });
  eq(收到的['yaku:page'].join(','), 'D:/养乐多包/mat_hair.fx', '连 enter 都没来也落得进去');
}

console.log('\n== 9. 整页落点与贴图格叠着：`.fx` 往下让，`.png` 留在贴图格 ==');
{
  /* 养乐多那一页就是这个形状：整页收 .fx，参数格里那些贴图格只收图片 */
  resetZones();
  const 整页 = 挂落点('yaku:page', 盒(0, 0, 400, 400), 材质后缀);
  const 贴图格 = 挂落点('yaku:0:BODY_MAP_FILE', 盒(100, 100, 200, 150), undefined);
  报错.length = 0;

  原生监听['tauri://drag-enter']({ payload: { paths: ['D:/别处/mat_body.fx'], position: { x: 150, y: 120 } } });
  原生监听['tauri://drag-over']({ payload: { position: { x: 150, y: 120 } } });
  eq(贴图格.亮着(), false, '在贴图格上丢 .fx：高亮不落在那一格上（它只收图片）');
  eq(整页.亮着(), true, '高亮归整页那一个');
  原生监听['tauri://drag-drop']({ payload: { paths: ['D:/别处/mat_body.fx'], position: { x: 150, y: 120 } } });
  eq(收到的['yaku:page'].join(','), 'D:/别处/mat_body.fx', '.fx 落到整页那个落点上（没被贴图格挡掉）');
  eq(收到的['yaku:0:BODY_MAP_FILE'].length, 0, '贴图格没被塞进一个 .fx');
  eq(报错.length, 0, '这一下不该报错');

  报错.length = 0;
  原生监听['tauri://drag-enter']({ payload: { paths: ['D:/别处/a.png'], position: { x: 150, y: 120 } } });
  原生监听['tauri://drag-over']({ payload: { position: { x: 150, y: 120 } } });
  eq(贴图格.亮着(), true, '同一处丢 .png：归贴图格');
  原生监听['tauri://drag-drop']({ payload: { paths: ['D:/别处/a.png'], position: { x: 150, y: 120 } } });
  eq(收到的['yaku:0:BODY_MAP_FILE'].join(','), 'D:/别处/a.png', '贴图格拿到的是那张图');
  eq(收到的['yaku:page'].length, 1, '整页那个没被再塞一次（还是刚才那条 .fx）');
}

console.log('\n== 10. 拖目录进来要算"打开工程"（用户 2026-09-26） ==');
{
  /* 为什么单独立这一节：选目录那条路会记最近工程 + 状态栏那条 `当前工程`，
     因为页面调的是 `pickFolder(label, href)` —— **记录挂在那个标签参数上**。
     而拖文件夹进来走的是落点，压根不经过 `pickFolder`，于是同一个目录：
     点按钮选它会变、拖进来不变（当时看的是顶栏那颗胶囊；那颗 2026-10-07 删了）。
     `dirdrop.ts` 的 `接目录` 现在能带一句
     `{label, href}`，`drag-dom.ts` 落下来时把它报给同一个出口（`io.ts` 的 `folderRecorder`）。
     这一节量的就是**那条出口真的通了**，而且**没写 `记` 的落点不许乱记**。 */
  const 记 = [];
  setFolderRecorder((path, label, href) => 记.push({ path, label, href }));

  resetZones();
  /* ① 带了 `记` 的目录落点：拖进去应当报一次 */
  const 带记 = 假元素(盒(600, 200, 900, 500));
  const a = 接目录(带记, {
    收: (p) => 收到的['测.带记'] = [p],
    label: '批量提取',
    href: '/tools/channels?panel=pipeline'
  });

  /* ② 没带 `记` 的目录落点（＝导出目标那类）：什么都不许报 */
  const 不带记 = 假元素(盒(0, 0, 200, 200));
  const b = 接目录(不带记, (p) => 收到的['测.不带记'] = [p]);

  eq(zoneIds().includes('dir.1') && zoneIds().includes('dir.2'), true, '两个落点都登记上了');

  记.length = 0;
  原生拖放(700, 300, 'D:\\工程A');
  await 静一静();
  eq(收到的['测.带记']?.join(','), 'D:\\工程A', '拖进去的目录交给了页面自己的收法');
  eq(记.length, 1, '并且报了"打开工程"一次');
  eq(记[0]?.path, 'D:\\工程A', '报的路径就是拖进来的那个');
  eq(记[0]?.label, '批量提取', '标签跟着落点声明走');
  eq(记[0]?.href, '/tools/channels?panel=pipeline', 'href 也跟着走（最近工程"接着做"要用它）');

  记.length = 0;
  收到的['测.不带记'] = [];
  原生拖放(100, 100, 'D:\\导出目标');
  await 静一静();
  eq(收到的['测.不带记']?.join(','), 'D:\\导出目标', '没带 `记` 的落点照样收下目录');
  eq(记.length, 0, '**但它不许记进最近工程**（导出目录不是工程）');

  /* 收尾：钩子还给别人，别让后面的小节跟着记 */
  setFolderRecorder(null);
  a.destroy();
  b.destroy();
  resetZones();
}

console.log('\n== 11. 收尾：停掉之后监听不该留 ==');
{
  停();
  eq(监听表.size, 0, '窗口级监听全撤了');
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
