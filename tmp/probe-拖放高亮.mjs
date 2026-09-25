/**
 * 探针：**通用落点的拖放高亮到底亮不亮**。
 *
 * 为什么要这套（`docs\整改清单.md` §J-10 那一条）：`dropzones.svelte.ts` 往元素上加的是
 * `.is-drop`，而 `src\styles\wb.css` 里那条规则原来写成 `[data-drop-target].is-drop` ——
 * 全库只有 ⑥ 和 ③ 的行写了 `data-drop-target`，其余落点（① 四个分栏、⑦ 批量 / 批量提取、
 * ⑤ 配对、⑨ 的 pmm/emm…）**一个都没写**。于是类加上了、样式一条都匹配不到，
 * **拖上去一点都不亮**，用户看不出会落到哪儿。
 *
 * 这个探针**不派拖放事件**，直接量"那条规则到底认不认 `.is-drop`"——
 * 因为出问题的不是事件链路（那条路 `probe-①拖放落点.mjs` 已经在量），
 * 而是**选择器匹配**这一件独立的事。量法是把真样式表加载进来，逐条问：
 *
 *   甲 只带 `is-drop` 的元素      → 原规则：不匹配（这就是 bug）；现规则：匹配
 *   乙 带 `data-drop-target` 的   → 两种规则都该匹配
 *   丙 真页面上真落点 `.wb__main` → 手动加 `is-drop`，读 computed outlineStyle
 *   丁 什么都不带的元素           → 两处都不许亮（别把所有东西都描边了）
 *
 * **破坏性试验**：把 `wb.css` 里那条选择器改回 `[data-drop-target].is-drop`，
 * 甲 与 丙 必须变红 —— 不然这个探针量不出原来那个 bug，等于白写。
 *
 * 用法（先 `pnpm dev` 起 1420，再无头 Chrome 开 9500）：
 *   chrome --headless=new --remote-debugging-port=9500 --window-size=1707,1067 `
 *          --user-data-dir=$env:TEMP\robin-hl http://127.0.0.1:1420/
 *   $env:CDP_PORT='9500'; node tmp\probe-拖放高亮.mjs
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
await rpc('Page.enable');
await rpc('Runtime.enable');

console.log('导航到工作区…');
await rpc('Page.navigate', { url: `${APP}/` });
await new Promise((r) => setTimeout(r, 3000));

/* ---- 甲 / 乙 / 丁：直接问样式表认不认 `.is-drop`（脱离页面结构，最干净） ---- */
console.log('\n==== 甲、只带 is-drop 的探针元素（原来那条规则就是在这里失手的）====');
const 甲乙丁 = await 跑(`(() => {
  const 造 = (类) => {
    const d = document.createElement('div');
    d.className = 类;
    /* 要挂在有布局的地方，getComputedStyle 才给得出实话 */
    d.style.cssText = 'position:fixed;left:-9999px;top:0;width:40px;height:40px';
    document.body.appendChild(d);
    return d;
  };
  const 读 = (d) => {
    const s = getComputedStyle(d);
    return { 描边: s.outlineStyle, 宽: s.outlineWidth, 色: s.outlineColor, 底: s.backgroundColor };
  };
  const 只is = 造('is-drop');
  const 都不带 = 造('');
  const 甲 = 读(只is);
  const 丁 = 读(都不带);

  /* 乙：做一次**真的 A/B**。光把旧选择器注进来是不够的 —— 现样式表里那条不带限定的
     .is-drop 规则还在，它会把元素先点亮，于是"旧规则认不认"根本看不出来（第一版就这么
     量出了个假的绿）。所以得先**把现规则摘掉**，再问：
       摘掉之后        只带 is-drop 的该熄（这就是当初的 bug）
       摘掉 + 旧选择器 只带 is-drop 的还熄、带 data-drop-target 的才亮
       装回去          只带 is-drop 的又亮 */
  /* （这条注释里不许出现反引号：整段是模板字符串，反引号会把桩截断 —— 踩过两次了） */
  const 找规则 = () => {
    for (const ss of document.styleSheets) {
      let 列;
      try { 列 = ss.cssRules; } catch { continue; }
      for (let i = 0; i < 列.length; i++) {
        const r = 列[i];
        if (r.selectorText && r.selectorText.trim() === '.is-drop') return { ss, i, 文: r.cssText };
      }
    }
    return null;
  };
  const 真 = 找规则();
  if (!真) return { 找不到规则: true };

  真.ss.deleteRule(真.i);
  const 摘掉_只is = 读(只is);

  const 旧 = document.createElement('style');
  旧.textContent = '[data-drop-target].is-drop{outline:2px solid red}';
  document.head.appendChild(旧);
  const 旧下面_只is = 读(只is);
  const 带属性 = 造('is-drop');
  带属性.setAttribute('data-drop-target', '1');
  const 旧下面_带属性 = 读(带属性);
  旧.remove();
  带属性.remove();

  真.ss.insertRule(真.文, Math.min(真.i, 真.ss.cssRules.length));
  const 装回_只is = 读(只is);

  const 现规则里有旧限定 = [...document.styleSheets].some((ss) => {
    try { return [...ss.cssRules].some((r) => r.selectorText && r.selectorText.includes('data-drop-target')); }
    catch { return false; }
  });

  只is.remove(); 都不带.remove();
  return { 甲, 丁, 摘掉_只is, 旧下面_只is, 旧下面_带属性, 装回_只is, 现规则里有旧限定 };
})()`);
console.log(JSON.stringify(甲乙丁, null, 1));

断言('甲：只带 is-drop 就亮（outlineStyle = solid）', 甲乙丁.甲.描边 === 'solid', `描边=${甲乙丁.甲.描边} 宽=${甲乙丁.甲.宽}`);
断言('甲：亮的时候还有底色（别只有一根线）', 甲乙丁.甲.底 !== 'rgba(0, 0, 0, 0)', `底=${甲乙丁.甲.底}`);
断言('乙：把现规则摘掉之后，只带 is-drop 的元素**确实**不亮（这就是当初的 bug）', 甲乙丁.摘掉_只is.描边 === 'none', `摘掉后=${甲乙丁.摘掉_只is.描边}`);
断言('乙：摘掉 + 旧选择器，只带 is-drop 仍不亮（旧写法认不出它）', 甲乙丁.旧下面_只is.描边 === 'none', `旧规则下=${甲乙丁.旧下面_只is.描边}`);
断言('乙：摘掉 + 旧选择器，带 data-drop-target 的才亮', 甲乙丁.旧下面_带属性.描边 === 'solid', `旧规则+属性=${甲乙丁.旧下面_带属性.描边}`);
断言('乙：现规则装回去，只带 is-drop 的又亮', 甲乙丁.装回_只is.描边 === 'solid', `装回后=${甲乙丁.装回_只is.描边}`);
断言('乙：现样式表里已经没有 data-drop-target 那个限定', !甲乙丁.现规则里有旧限定, 甲乙丁.现规则里有旧限定 ? '还在 —— 甲那条会失手' : '');
断言('丁：什么都不带的元素不许亮（别把所有东西都描边）', 甲乙丁.丁.描边 === 'none', `描边=${甲乙丁.丁.描边}`);

/* ---- 丙：真页面上真落点 ---- */
console.log('\n==== 丙、真页面上真落点（⑦ 批量提取那一页整页就是落点）====');
console.log('进 ⑦：', await 跑(`(async () => {
  const 叶 = [...document.querySelectorAll('.leaf, .rail a, nav a, .side a')].find((e) => (e.textContent || '').includes('贴图通道处理'));
  if (叶) 叶.click();
  await new Promise((r) => setTimeout(r, 2500));
  const b = [...document.querySelectorAll('.seg__btn')].find((x) => {
    const l = x.querySelector('.seg__label');
    return ((l ? l.textContent : x.textContent) || '').trim() === '批量提取';
  });
  if (b) b.click();
  await new Promise((r) => setTimeout(r, 2200));
  return location.pathname + location.search;
})()`));

const 丙 = await 跑(`(() => {
  const 主 = document.querySelector('.wb__main');
  if (!主) return { 在: false };
  const 原 = 主.className;
  const 没加 = getComputedStyle(主).outlineStyle;
  主.classList.add('is-drop');
  const 加了 = getComputedStyle(主).outlineStyle;
  const 底 = getComputedStyle(主).backgroundColor;
  主.className = 原;
  return { 在: true, 类名: 原, 没加, 加了, 底 };
})()`);
console.log(JSON.stringify(丙, null, 1));
if (!丙.在) {
  断言('丙：找得到真页面的落点容器 .wb__main', false, '这一页没渲染出来？');
} else {
  断言('丙：真落点加 is-drop 就亮', 丙.加了 === 'solid', `没加=${丙.没加} → 加了=${丙.加了}`);
  断言('丙：真落点不加就不亮', 丙.没加 === 'none', `没加=${丙.没加}`);
  断言('丙：亮的时候有底色', 丙.底 !== 'rgba(0, 0, 0, 0)', `底=${丙.底}`);
}

console.log(`\n==== ${绿} 过 / ${红} 红 ====`);
if (红) console.log('有红的就不是全绿 —— 别把这一条记成"验过了"。');
ws.close();
process.exit(红 ? 1 : 0);
