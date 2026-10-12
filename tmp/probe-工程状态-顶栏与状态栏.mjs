/**
 * 探针：**工程名在界面上不许再出现**（2026-10-06 那两处显示的收口）。
 *
 * 来路：用户先问顶栏（"打开工程了上方还显示未打开工程"），接着补"状态栏的刷新重置需要考虑"。
 * 两处当时都有一份**写死的字**：顶栏 `AppShell.svelte` 的"未打开工程"、
 * 状态栏 `StatusBar.svelte` 中段的"就绪 · 工程未载入"。
 *
 * **两处显示先后都被删了**：
 *   · 2026-10-07 "右上角也不要显示当前的过程" → 顶栏那颗 `.bar__proj` 胶囊整段删掉
 *   · 2026-10-12 "底栏显示时间处的左边打开什么工程还没删除干净" → 状态栏 `.sb__proj` 那一条也删掉
 * 所以这一套现在的口径是**反面**的：**界面上一处都不许有它**，
 * 而记录本身要照旧（⑨ 报工程、拖放那条出口还在写 `recent.svelte.ts`）。
 *
 * 量的四段：
 *   甲 干净状态（先清 `robin.recent` + 真刷新）：两处都不在，页面上也搜不到"工程"那几个字
 *   乙 往 localStorage 塞一条最近工程再**真刷新**：两处照样都不在（记录归记录，显示归显示）
 *   丙 切到别的功能：还是都不在
 *   丁 「重新开始统计」要在 `perf.gen` 换代之后把那 20 根柱子清平
 *
 * **为什么用 localStorage 而不是真去选目录**：选目录要弹系统对话框，无头里点不了。
 * `recent[0]` 是那条真路的入口，所以"塞一条 + 刷新"量的是真代码路径，不是桩。
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

/** 一次读全：两处（顶栏那颗 / 底栏那一条）在不在，外加"整条底栏里有没有工程字样" */
const 读两处 = () =>
  跑(`(() => {
    const 文 = (el) => (el && el.textContent ? el.textContent.trim() : null);
    const 顶 = document.querySelector('.bar__proj');
    const 底 = document.querySelector('.sb__mid');
    const 底工程 = document.querySelector('.sb__proj');
    return {
      有没有顶栏那颗: !!顶,
      有没有底栏那条: !!底工程,
      底栏中段: 文(底),
      底栏全文: 文(document.querySelector('.sb')),
      有没有底栏: !!底
    };
  })()`);

console.log(`导航到 ${APP}/tools/channels …`);
await rpc('Page.navigate', { url: `${APP}/tools/channels` });
await 等(3200);

/* ---------------- 甲：干净状态（先清掉最近工程） ---------------- */
console.log('\n==== 甲、没开过工程时：两处都不该在 ====');
await 跑(`(() => { localStorage.removeItem('robin.recent'); return 'ok'; })()`);
await rpc('Page.reload');
await 等(3000);
const 甲 = await 读两处();
console.log(JSON.stringify(甲, null, 1));
断言('甲：顶栏那颗没有了', 甲.有没有顶栏那颗 === false, String(甲.有没有顶栏那颗));
断言('甲：底栏那一条也没有了', 甲.有没有底栏那条 === false, String(甲.有没有底栏那条));
断言('甲：底栏在（窄屏才隐藏，1707 宽不是窄屏）', 甲.有没有底栏 === true, String(甲.有没有底栏));
断言(
  '甲：整条底栏里搜不到"工程"两个字',
  !(甲.底栏全文 || '').includes('工程'),
  JSON.stringify(甲.底栏全文)
);

/* ---------------- 乙：塞一条最近工程，真刷新 ---------------- */
console.log('\n==== 乙、塞一条最近工程再**真刷新**：显示处照样都不在 ====');
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
断言('乙：有记录在 localStorage 里（这一节的前提）', (await 跑(`(localStorage.getItem('robin.recent') || '').includes('绝区零_测试工程')`)) === true, '');
断言('乙：刷完底栏那一条还是不在', 乙.有没有底栏那条 === false, String(乙.有没有底栏那条));
断言('乙：刷完顶栏那颗也不在（别在别处又冒出来）', 乙.有没有顶栏那颗 === false, String(乙.有没有顶栏那颗));
断言(
  '乙：底栏里没有工程名、也没有"未载入工程"这种字',
  !(乙.底栏全文 || '').includes('工程') && !(乙.底栏全文 || '').includes('绝区零_测试工程'),
  JSON.stringify(乙.底栏全文)
);

/* ---------------- 丙：切页 ---------------- */
console.log('\n==== 丙、切到别的功能：还是都不在 ====');
await 跑(`(() => {
  const 叶 = [...document.querySelectorAll('.side a, .side button')].find((x) => (x.textContent || '').includes('ikClut'));
  if (叶) 叶.click();
  return 'ok';
})()`);
await 等(1800);
const 丙 = await 读两处();
console.log(JSON.stringify(丙, null, 1));
断言('丙：切页之后两处依旧都不在', 丙.有没有底栏那条 === false && 丙.有没有顶栏那颗 === false, '');
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
