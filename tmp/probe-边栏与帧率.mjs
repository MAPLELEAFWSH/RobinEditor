/**
 * 探针：**边栏伸缩的衔接错位** + **动画掉不掉帧**（用户 2026-09-26）。
 *
 * 用户原话：
 *   甲「边栏伸缩你确定真的衔接错位感不明显了吗」
 *   乙「当前性能开销呢能不能保证稳定60fps以上，动画发生是否能保证帧数不忽然下降」
 *
 * 两条都不靠眼睛，靠**逐帧记数**：
 *
 *   甲 收起/展开的过程中，每一帧同时记三个值 ——
 *        · 侧栏右缘（`.side` 的 rect.right）
 *        · 正文左缘（`.shell` 的 rect.left）
 *        · 背景那层左缘（`.bg[data-scope=work]` 的 rect.left）
 *      三者本该**始终贴着**（正文和背景的左缘 = 侧栏右缘 + 侧栏那 1px 描边）。
 *      差多少、差多久，就是"错位感"的量化。
 *      **真因**（改之前）：`.side` 的 width 走 `--t-side`(300ms)、
 *      背景那层也走 `--t-side`，而 `.shell` 的 margin-left 走的是 `--t-enter`(350ms) ——
 *      时长差 50ms，于是整个过程里正文一直落后于轨道，最后 50ms 才追上。
 *
 *   乙 同一批 rAF 采样里记**帧间隔**，分四段：
 *        · 空闲（什么都不动）
 *        · 边栏收起 + 展开
 *        · 翻页（客户端路由切页那次过渡）
 *        · 开参数抽屉（② 调色）
 *      报 p50 / p95 / 最大间隔，以及 >16.7ms（掉到 60 以下）和 >33.3ms（掉到 30 以下）的帧数。
 *
 * **这份数只能当"下限"看**：无头 Chrome 而且带 `--disable-gpu`，是**软件光栅**，
 * 比真机上带 GPU 的窗口**更慢**。所以"无头里没掉"能推出"真机更不会掉"，
 * 反过来推不出来。真机要另跑（开 `--remote-debugging-port` 的 `pnpm tauri dev`）。
 *
 * 用法（先 `pnpm dev` 起 1420，再无头 Chrome 开 9500）：
 *   chrome --headless=new --remote-debugging-port=9500 --window-size=1707,1067 `
 *          --user-data-dir=$env:TEMP\robin-side http://127.0.0.1:1420/
 *   $env:CDP_PORT='9500'; node tmp\probe-边栏与帧率.mjs
 */
const PORT = process.env.CDP_PORT ?? '9500';
const APP = process.env.DEV_ORIGIN ?? 'http://127.0.0.1:1420';

let 红 = 0;
let 绿 = 0;
const 断言 = (名, 过, 说明 = '') => {
  if (过) {
    绿++;
    console.log(`  ✅ ${名}${说明 ? ' —— ' + 说明 : ''}`);
  } else {
    红++;
    console.log(`  ❌ ${名}${说明 ? ' —— ' + 说明 : ''}`);
  }
};

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = list.find((x) => x.type === 'page' && !x.url.startsWith('devtools://'));
if (!t) {
  console.log(`连不上 http://127.0.0.1:${PORT}/json/list —— 先起无头 Chrome（见文件头）`);
  process.exit(2);
}
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

/** 逐帧采样器：装一次，之后 start/stop 取一段 */
const 装采样器 = () => 跑(`(() => {
  if (window.__帧采样) return '已经在';
  const S = { 在跑: false, 记: [], 名: '' };
  window.__帧采样 = S;
  let 上 = 0;
  const 每帧 = (ts) => {
    const 侧 = document.querySelector('.side');
    const 壳 = document.querySelector('.shell');
    const 背 = document.querySelector('.bg[data-scope="work"]');
    if (S.在跑) {
      S.记.push({
        t: ts,
        dt: 上 ? ts - 上 : 0,
        侧右: 侧 ? 侧.getBoundingClientRect().right : -1,
        壳左: 壳 ? 壳.getBoundingClientRect().left : -1,
        背左: 背 ? 背.getBoundingClientRect().left : -1
      });
    }
    上 = ts;
    requestAnimationFrame(每帧);
  };
  requestAnimationFrame(每帧);
  return '装好了';
})()`);

const 开记 = (名) => 跑(`(() => { const S = window.__帧采样; S.记 = []; S.名 = ${JSON.stringify(名)}; S.在跑 = true; return 'ok'; })()`);
const 收记 = () => 跑(`(() => { const S = window.__帧采样; S.在跑 = false; return S.记; })()`);

/** 把一段采样算成读数 */
function 算(记, 期望偏移) {
  if (!记.length) return { 帧数: 0 };
  const dt = 记.map((f) => f.dt).filter((d) => d > 0).sort((a, b) => a - b);
  const 分位 = (p) => (dt.length ? dt[Math.min(dt.length - 1, Math.floor(dt.length * p))] : 0);
  const 错 = 记
    .map((f) => ({ t: f.t, 差: f.壳左 - f.侧右 - 期望偏移, 背差: f.背左 - f.侧右 - 期望偏移 }))
    .filter((f) => Math.abs(f.差) > 0.6 || Math.abs(f.背差) > 0.6);
  const 最大差 = 记.reduce((m, f) => Math.max(m, Math.abs(f.壳左 - f.侧右 - 期望偏移)), 0);
  const 最大背差 = 记.reduce((m, f) => Math.max(m, Math.abs(f.背左 - f.侧右 - 期望偏移)), 0);
  const 错多久 = 错.length ? 错[错.length - 1].t - 错[0].t : 0;
  /* **证明仪器真的复现了这个场景**：轨道要是压根没动，错位必然是 0，
     那种 0 是假的（探针在量一片静止的东西）。所以把轨道右缘的行程也报出来。 */
  const 右们 = 记.map((f) => f.侧右);
  return {
    帧数: 记.length,
    时长: Math.round(记[记.length - 1].t - 记[0].t),
    轨道右缘_起: +Math.min(...右们).toFixed(1),
    轨道右缘_止: +Math.max(...右们).toFixed(1),
    轨道走了: +(Math.max(...右们) - Math.min(...右们)).toFixed(1),
    帧间隔_p50: +分位(0.5).toFixed(1),
    帧间隔_p95: +分位(0.95).toFixed(1),
    帧间隔_最大: +(dt[dt.length - 1] ?? 0).toFixed(1),
    超16_7的帧: dt.filter((d) => d > 16.7 + 1).length,
    超33_3的帧: dt.filter((d) => d > 33.3 + 1).length,
    最大错位px: +最大差.toFixed(2),
    背景最大错位px: +最大背差.toFixed(2),
    错位持续的毫秒: Math.round(错多久),
    错位的帧数: 错.length
  };
}

console.log(`导航到 ${APP}/tools/channels …\n`);
await rpc('Page.navigate', { url: `${APP}/tools/channels` });
await 等(3500);
console.log('装采样器：', await 装采样器());
await 等(300);

/* 侧栏那 1px 描边：正文左缘 = 侧栏右缘 + border。先量一次静止时的偏移当基准 */
const 基准 = await 跑(`(() => {
  const 侧 = document.querySelector('.side');
  const 壳 = document.querySelector('.shell');
  const 背 = document.querySelector('.bg[data-scope="work"]');
  return {
    侧右: 侧 ? +侧.getBoundingClientRect().right.toFixed(2) : -1,
    壳左: 壳 ? +壳.getBoundingClientRect().left.toFixed(2) : -1,
    背左: 背 ? +背.getBoundingClientRect().left.toFixed(2) : -1,
    迷你: document.documentElement.dataset.mini,
    窄屏: window.innerWidth
  };
})()`);
console.log('静止时：', JSON.stringify(基准));
const 期望偏移 = +(基准.壳左 - 基准.侧右).toFixed(2);
console.log(`正文左缘 - 侧栏右缘 的基准偏移 = ${期望偏移}px（描边那点宽度，全程都该是这个数）\n`);

/* ================================================================ 甲+乙 */
/* **先把侧栏归到"展开"**：收起状态是存在 localStorage 里的，跑第二遍时它可能已经是收起的，
   那样「点收起」什么都不会发生、轨道走了 0px，量出来的 0 是假的。 */
console.log('把侧栏归到展开状态：', await 跑(`(async () => {
  if (document.documentElement.dataset.mini !== 'true') return '本来就是展开的';
  const b = [...document.querySelectorAll('.side button')].find((x) => (x.getAttribute('aria-label') || '') === '展开侧栏');
  if (b) b.click();
  await new Promise((r) => setTimeout(r, 700));
  return document.documentElement.dataset.mini === 'true' ? '（没展开成）' : '展开了';
})()`));
await 等(400);

console.log('\n==== 甲、边栏收起：逐帧看正文跟没跟上轨道 ====');
await 开记('收起');
await 跑(`(() => {
  const b = document.querySelector('.side__fold');
  if (b) { b.click(); return 'ok'; }
  return '（折叠按钮不在，可能本来就是收起的）';
})()`);
await 等(700);
const 收起 = 算(await 收记(), 期望偏移);
console.log(JSON.stringify(收起, null, 1));

console.log('\n==== 甲、边栏展开：再来一遍 ====');
await 跑(`(() => {
  const b = [...document.querySelectorAll('.side button')].find((x) => (x.getAttribute('aria-label') || '') === '展开侧栏');
  if (b) { b.click(); return 'ok'; }
  return '（没找到展开按钮）';
})()`);
await 等(120);
await 开记('展开');
await 等(700);
const 展开 = 算(await 收记(), 期望偏移);
console.log(JSON.stringify(展开, null, 1));

/* 收起 / 展开各来一次，取最差的那次当结论 —— 一次可能撞上别的事 */
const 最差错位 = Math.max(收起.最大错位px ?? 0, 展开.最大错位px ?? 0);
const 最差背错 = Math.max(收起.背景最大错位px ?? 0, 展开.背景最大错位px ?? 0);
const 最久错位 = Math.max(收起.错位持续的毫秒 ?? 0, 展开.错位持续的毫秒 ?? 0);
断言('甲：侧栏真的动了（不是量了一片静止的）', Math.max(收起.轨道走了 ?? 0, 展开.轨道走了 ?? 0) > 100,
  `收起走了 ${收起.轨道走了}px、展开走了 ${展开.轨道走了}px`);断言('甲：侧栏动的时候，正文左缘跟着走（错位 ≤ 1px）', 最差错位 <= 1, `最大错位 ${最差错位}px，持续 ${最久错位}ms`);
断言('甲：背景那层也跟着走（错位 ≤ 1px）', 最差背错 <= 1, `最大错位 ${最差背错}px`);

/* ================================================================ 乙 */
console.log('\n==== 乙、帧率：空闲 ====');
await 开记('空闲');
await 等(2000);
const 空 = 算(await 收记(), 期望偏移);
console.log(JSON.stringify(空, null, 1));
断言('乙：空闲时不掉帧（没有间隔 > 33.3ms 的帧）', (空.超33_3的帧 ?? 99) === 0, `超33.3ms 的帧 ${空.超33_3的帧} 个，p95 ${空.帧间隔_p95}ms`);

console.log('\n==== 乙、帧率：边栏收起 + 展开 ====');
await 开记('边栏');
await 跑(`(() => { const b = document.querySelector('.side__fold'); if (b) b.click(); return 'ok'; })()`);
await 等(420);
await 跑(`(() => {
  const b = [...document.querySelectorAll('.side button')].find((x) => (x.getAttribute('aria-label') || '') === '展开侧栏');
  if (b) b.click();
  return 'ok';
})()`);
await 等(520);
const 边 = 算(await 收记(), 期望偏移);
console.log(JSON.stringify(边, null, 1));
断言('乙：边栏伸缩时不掉帧（没有间隔 > 33.3ms 的帧）', (边.超33_3的帧 ?? 99) === 0, `超33.3ms 的帧 ${边.超33_3的帧} 个，最大 ${边.帧间隔_最大}ms`);

console.log('\n==== 乙、帧率：翻页（客户端路由过渡）====');
/* **照真用户的样子来**：鼠标先挪到那一项上（预取就挂在 `pointerenter` 上），
   过一会儿才按下去。直接 `.click()` 不 hover 的话，量的是"冷点击"那种更坏的情况。 */
await 跑(`(() => {
  const 叶 = [...document.querySelectorAll('.side a, .side button')].find((x) => (x.textContent || '').includes('ikClut'));
  if (!叶) return '（没找到那一项）';
  叶.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
  return '悬上去了';
})()`);
await 等(260);
await 开记('翻页');
await 跑(`(() => {
  const 叶 = [...document.querySelectorAll('.side a, .side button')].find((x) => (x.textContent || '').includes('ikClut'));
  if (叶) 叶.click();
  return 'ok';
})()`);
await 等(1500);
const 翻 = 算(await 收记(), 期望偏移);
console.log(JSON.stringify(翻, null, 1));
断言('乙：翻页时不掉帧（没有间隔 > 33.3ms 的帧）', (翻.超33_3的帧 ?? 99) === 0, `超33.3ms 的帧 ${翻.超33_3的帧} 个，最大 ${翻.帧间隔_最大}ms`);

/* 对照组：翻到**轻**的一页（最近工程 = 一个列表）。用来分清那一下的代价
   到底是"路由 + 取包"还是"② 调色这一页自己挂载时干的活"。
   ② 一进来就要生成测试图、跑一遍调色链、编一张 PNG，本来就是重页。 */
console.log('\n==== 乙、对照：翻到轻页（最近工程）====');
await 跑(`(() => {
  const 叶 = [...document.querySelectorAll('.side a, .side button')].find((x) => (x.textContent || '').includes('最近工程'));
  if (叶) 叶.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
  return '悬上去了';
})()`);
await 等(260);
await 开记('轻页');
await 跑(`(() => {
  const 叶 = [...document.querySelectorAll('.side a, .side button')].find((x) => (x.textContent || '').includes('最近工程'));
  if (叶) 叶.click();
  return 'ok';
})()`);
await 等(1500);
const 轻 = 算(await 收记(), 期望偏移);
console.log(JSON.stringify(轻, null, 1));

console.log('\n==== 乙、帧率：开参数抽屉（② 调色）====');
await 开记('抽屉');
await 跑(`(() => {
  const b = [...document.querySelectorAll('.fabs .fab')].find((x) => (x.textContent || '').trim() === '参数');
  if (b) { b.click(); return 'ok'; }
  return '（这颗钮不在，可能不是工作区页）';
})()`);
await 等(1200);
const 抽 = 算(await 收记(), 期望偏移);
console.log(JSON.stringify(抽, null, 1));
断言('乙：开抽屉时不掉帧（没有间隔 > 33.3ms 的帧）', (抽.超33_3的帧 ?? 99) === 0, `超33.3ms 的帧 ${抽.超33_3的帧} 个，最大 ${抽.帧间隔_最大}ms`);

const 全部 = [空, 边, 翻, 轻, 抽].filter((x) => x.帧数);
const 总最大 = Math.max(...全部.map((x) => x.帧间隔_最大));
const 超33 = 全部.reduce((n, x) => n + x.超33_3的帧, 0);
console.log(`\n四段合起来：最大帧间隔 ${总最大}ms，超过 33.3ms 的帧一共 ${超33} 个`);
console.log(`最差那段 p95 = ${Math.max(...全部.map((x) => x.帧间隔_p95))}ms`);

/* 收尾：把侧栏放回展开 —— 收起状态存在 localStorage 里，留着会让后面
   `tools/ui-audit.mjs --all` 带着"浏览器最小宽度 / 侧栏收起"那套判断跑，白报一堆。 */
console.log('把侧栏放回展开：', await 跑(`(async () => {
  if (document.documentElement.dataset.mini !== 'true') return '本来就是展开的';
  const b = [...document.querySelectorAll('.side button')].find((x) => (x.getAttribute('aria-label') || '') === '展开侧栏');
  if (b) b.click();
  await new Promise((r) => setTimeout(r, 600));
  return '放回去了';
})()`));

console.log(`\n==== ${绿} 过 / ${红} 红 ====`);
console.log('注意：这是**无头 + --disable-gpu（软件光栅）**，比真机带 GPU 的窗口更慢，');
console.log('      所以"这里没掉"能推出"真机更不会掉"，反过来推不出来。');
ws.close();
process.exit(红 ? 1 : 0);
