/**
 * 探针：**工程状态在顶栏和状态栏上，刷新之后还在不在**（用户 2026-10-06）。
 *
 * 用户先问的是顶栏（"打开工程了上方还显示未打开工程"），接着补了一句
 * "而且状态栏的刷新重置需要考虑"。两处都有一份**写死的字**：
 *   · 顶栏 `AppShell.svelte` —— 原来写死"未打开工程"
 *   · 状态栏 `StatusBar.svelte` 中段 —— 原来写死"就绪 · 工程未载入"
 * 上一轮只修了顶栏，没顺手看底部，所以这一套把**两处一起量**。
 *
 * 量的三件事：
 *   甲 一个新用户（localStorage 里没有最近工程）进来，两处都该说"没有工程"
 *   乙 往 localStorage 塞一条最近工程再**真刷新**（`Page.reload`），
 *      两处都该显示那个工程名 —— 这就是"刷新"那半：刷新之后不该假装什么都没开
 *   丙 再刷新一次，还是那个名字（不是只有第一次运气好）
 *
 * **为什么用 localStorage 而不是真去选目录**：选目录要弹系统对话框，无头里点不了。
 * 而顶栏与状态栏的初值本来就取自 `recent[0]`（`recent.svelte.ts` 里写着），
 * 所以"塞一条最近工程 + 刷新"走的正是刷新那条真路 —— 量的是真代码路径，不是桩。
 *
 * **顺带量"重置"**：`resetPerf()` 换代（`perf.gen`）之后那排柱子要清平。
 * 这个在页面里点那颗「重新开始统计」按钮量。
 *
 * 用法（先 `pnpm dev` 起 1420，再无头 Chrome 开 9500）：
 *   chrome --headless=new --remote-debugging-port=9500 --window-size=1707,1067 `
 *          --user-data-dir=$env:TEMP\robin-proj http://127.0.0.1:1420/
 *   $env:CDP_PORT='9500'; node tmp\probe-工程状态-顶栏与状态栏.mjs
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

/** 一次把两处读出来。**两处分开读**，因为它们可能各写各的（这一轮之前就是） */
const 读两处 = () =>
  跑(`(() => {
    const 文 = (el) => (el && el.textContent ? el.textContent.trim() : null);
    const 顶 = document.querySelector('.bar__proj');
    const 底 = document.querySelector('.sb__mid');
    const 底工程 = document.querySelector('.sb__proj');
    return {
      顶栏: 文(顶),
      顶栏亮: 顶 ? 顶.classList.contains('bar__proj--on') : null,
      顶栏title: 顶 ? 顶.getAttribute('title') : null,
      状态栏: 文(底),
      状态栏工程: 文(底工程),
      状态栏亮: 底工程 ? 底工程.classList.contains('sb__proj--on') : null,
      状态栏title: 底工程 ? 底工程.getAttribute('title') : null,
      有没有状态栏: !!底,
      有没有顶栏: !!顶
    };
  })()`);

console.log(`导航到 ${APP}/tools/channels …`);
await rpc('Page.navigate', { url: `${APP}/tools/channels` });
await 等(3200);

/* ---------------- 甲：干净状态（先清掉最近工程） ---------------- */
console.log('\n==== 甲、没开过工程时，两处都该说"没有" ====');
await 跑(`(() => { localStorage.removeItem('robin.recent'); return 'ok'; })()`);
await rpc('Page.reload');
await 等(3000);
const 甲 = await 读两处();
console.log(JSON.stringify(甲, null, 1));
断言('甲：顶栏在', 甲.有没有顶栏 === true, String(甲.有没有顶栏));
断言('甲：状态栏在（窄屏才隐藏，1707 宽不是窄屏）', 甲.有没有状态栏 === true, String(甲.有没有状态栏));
断言('甲：顶栏说"未打开工程"', 甲.顶栏 === '未打开工程', String(甲.顶栏));
断言('甲：顶栏那颗点**不亮**', 甲.顶栏亮 === false, String(甲.顶栏亮));
断言(
  '甲：状态栏中段说的是"未载入工程"，不是写死的"工程未载入"',
  甲.状态栏工程 === '未载入工程',
  `实得 ${JSON.stringify(甲.状态栏工程)}（整段：${JSON.stringify(甲.状态栏)}）`
);
断言('甲：状态栏那颗点也不亮', 甲.状态栏亮 === false, String(甲.状态栏亮));

/* ---------------- 乙：塞一条最近工程，真刷新 ---------------- */
console.log('\n==== 乙、塞一条最近工程再**真刷新**，两处都该显示它 ====');
const 假工程 = 'D:\\探针用的工程\\绝区零_测试工程';
await 跑(`(() => {
  localStorage.setItem('robin.recent', JSON.stringify([{
    path: ${JSON.stringify(假工程)},
    name: '绝区零_测试工程',
    label: '批量提取',
    href: '/tools/channels?panel=pipeline',
    at: Date.now(),
    used: 1
  }]));
  return 'ok';
})()`);
await rpc('Page.reload');
await 等(3000);
const 乙 = await 读两处();
console.log(JSON.stringify(乙, null, 1));
断言('乙：刷完顶栏显示工程名', 乙.顶栏 === '绝区零_测试工程', String(乙.顶栏));
断言('乙：顶栏那颗点亮了', 乙.顶栏亮 === true, String(乙.顶栏亮));
断言('乙：顶栏 title 里是全路径', (乙.顶栏title || '').includes(假工程), String(乙.顶栏title));
断言('乙：刷完**状态栏**也显示工程名', 乙.状态栏工程 === '绝区零_测试工程', String(乙.状态栏工程));
断言('乙：状态栏那颗点也亮了', 乙.状态栏亮 === true, String(乙.状态栏亮));
断言('乙：状态栏 title 里也是全路径', (乙.状态栏title || '').includes(假工程), String(乙.状态栏title));
断言(
  '乙：状态栏里**没有**写死的"工程未载入"了',
  !(乙.状态栏 || '').includes('工程未载入'),
  String(乙.状态栏)
);

/* ---------------- 丙：切页 + 再刷一次 ---------------- */
console.log('\n==== 丙、切到别的功能：两处都不该变 ====');
await 跑(`(() => {
  const 叶 = [...document.querySelectorAll('.side a, .side button')].find((x) => (x.textContent || '').includes('ikClut'));
  if (叶) 叶.click();
  return 'ok';
})()`);
await 等(1800);
const 丙 = await 读两处();
console.log(JSON.stringify(丙, null, 1));
断言('丙：切页之后顶栏还是那个工程', 丙.顶栏 === '绝区零_测试工程', String(丙.顶栏));
断言('丙：切页之后状态栏还是那个工程', 丙.状态栏工程 === '绝区零_测试工程', String(丙.状态栏工程));
断言('丙：落地路径真的换了（不然这一节没意义）', (await 跑('location.pathname + location.search')).includes('ikclut'), await 跑('location.pathname + location.search'));

/* ---------------- 丁：「重新开始统计」要连柱子一起清 ---------------- */
console.log('\n==== 丁、按「重新开始统计」，那排柱子要清平 ====');
const 柱 = await 跑(`(async () => {
  const 读 = () => {
    const bs = [...document.querySelectorAll('.sb__bars i')];
    return { 根数: bs.length, 高度: bs.map((b) => Math.round(parseFloat(b.style.height) || 0)) };
  };
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  /* 先让柱子走一段（不制造负载，就是让采样跑几秒填上历史） */
  await 等(2500);
  const 前 = 读();
  const 钮 = document.querySelector('.sb__btn');
  if (!钮) return { 没按钮: true, 前 };
  钮.click();
  await 等(300);
  const 后 = 读();
  return { 前, 后 };
})()`);
console.log(JSON.stringify(柱, null, 1));
if (柱.没按钮) {
  断言('丁：找得到那颗「重新开始统计」', false, '没找到 .sb__btn');
} else {
  断言('丁：柱子有 20 根', 柱.前.根数 === 20, String(柱.前.根数));
  断言(
    '丁：按完之后柱子全清平（都回到 8% 的底线）',
    柱.后.高度.every((h) => h <= 9),
    `按后 ${JSON.stringify(柱.后.高度)}`
  );
}

console.log(`\n==== ${绿} 过 / ${红} 红 ====`);
if (红) console.log('有红的就不是全绿 —— 别把这一条记成"验过了"。');

/* 收尾：把探针塞进去的最近工程清掉（不然下一次 ui-audit / 别的探针会带着它跑） */
await 跑(`(() => { localStorage.removeItem('robin.recent'); return 'ok'; })()`);
console.log('清掉了探针塞的 recent（探针要收拾自己弄脏的状态）');
ws.close();
process.exit(红 ? 1 : 0);
