/**
 * 打包版真机冒烟：这一轮动过的分区在真窗口里能不能画出来。
 *
 * 只看三件事：页面标题对不对、分区条在不在、有没有报到侧栏的错误。
 * 不看像素 —— 这里的目的是"打包产物不是一开就白屏"。
 *
 * 用法：先带 --remote-debugging-port=9222 起 dist 里的 exe，再
 *   node tmp/cdp-panels-smoke.mjs
 */
const 目标 = [
  // 注意：断言的字必须是**只有分区正文里才有**的。用分区条上那种按钮文案
  // 会假通过 —— 面板正文整块没渲染出来，按钮上的字还在。（这条工程吃过两次这个亏）
  { 名: '⑦ 通道提取', url: 'http://tauri.localhost/tools/channels?panel=extract', 要: '通道提取' }
  // ⑧ Ramp 取样那一条随模块删了（2026-09-23）
  // ⑦「分块定档」那一条随之删了（2026-09-24，用户决定去掉这个分区）
];

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('没找到页面，exe 起来了吗');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const 等 = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && 等.has(m.id)) {
    等.get(m.id)(m);
    等.delete(m.id);
  }
});
await new Promise((r) => ws.addEventListener('open', r));

function 发(method, params) {
  const n = ++id;
  return new Promise((r) => {
    等.set(n, r);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
}

async function 取(expr) {
  const r = await 发('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true
  });
  return r.result?.result?.value;
}

await 发('Page.enable');
await 发('Runtime.enable');

let 失败 = 0;
for (const t of 目标) {
  await 发('Page.navigate', { url: t.url });
  // 分区是懒加载的，等 DOM 里出现目标文案（最多 8 秒）
  let 到 = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const 文本 = await 取('document.body ? document.body.innerText : ""');
    if (typeof 文本 === 'string' && 文本.includes(t.要)) {
      到 = true;
      break;
    }
  }
  const 文本 = (await 取('document.body.innerText')) || '';
  // 反向断言：正文里不许出现这些 —— 它们正是"守卫拦下了 / 组件没载进来"的样子
  const 禁 = ['这个组件不认识', '没载进来', '找不到这个功能', '出错了'];
  const 撞上 = 禁.filter((s) => 文本.includes(s));
  const 错 = await 取(`(() => {
    const el = document.querySelector('.sb__err, [class*="err"]');
    return el ? el.innerText : '';
  })()`);
  const 有错 = typeof 错 === 'string' && 错.trim().length > 0;
  const 好 = 到 && !有错 && !撞上.length;
  if (!好) 失败++;
  console.log(
    `${好 ? 'ok  ' : 'FAIL'}  ${t.名}  文案「${t.要}」${到 ? '在' : '不在'}` +
      (撞上.length ? `  正文里有不该有的字：${撞上.join(' / ')}` : '') +
      (有错 ? `  侧栏报错：${错.slice(0, 80)}` : '')
  );
  if (!好) console.log('      页面开头：' + 文本.replace(/\s+/g, ' ').slice(0, 200));
}

ws.close();
console.log(失败 ? `\n${失败} 项没过` : '\n都画出来了');
process.exit(失败 ? 1 : 0);
