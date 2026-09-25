/**
 * 验收：⑥ 底栏的观感是不是真的跟全站那条一样了。
 *
 * 不比"我看着像" —— 把 ⑥ 的底栏与 ⑦ 的 `.wb__acts` **算出来的样式逐条对**：
 * 位置 / 让开状态栏的偏移 / 层级 / 描边 / 圆角 / 背景 / 阴影 / 毛玻璃 / 内边距 / 主按钮靠右。
 * 顺带截一张 ⑥ 底栏那块，存成 png 给人看。
 *
 * 用法（先 pnpm dev 起在 1420，再无头 Chrome 开 9400）：
 *   node tmp\验收-⑥底栏.mjs [视口] [截图存哪]
 */
import fs from 'node:fs';

const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const 视口 = process.argv[2] ?? '1707x1067';
const 截图 = process.argv[3] ?? 'tmp\\⑥底栏-统一后.png';
const app = 'http://127.0.0.1:1420';

const list = await (await fetch(`${BASE}/json/list`)).json();
const t = list.find((x) => x.type === 'page' && !x.url.startsWith('devtools://'));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const rpc = (method, params = {}) =>
  new Promise((res, rej) => {
    const my = ++id;
    const 定时 = setTimeout(() => { ws.removeEventListener('message', on); rej(new Error('CDP 超时 ' + method)); }, 30000);
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
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));

await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Emulation.setDeviceMetricsOverride', {
  width: Number(视口.split('x')[0]), height: Number(视口.split('x')[1]), deviceScaleFactor: 1, mobile: false
});

const 跑 = async (表达式) => {
  const r = await rpc('Runtime.evaluate', { expression: 表达式, returnByValue: true, awaitPromise: false });
  if (r.exceptionDetails) return { 页面抛错: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  return r.result.value;
};

/** 把一个元素的"观感"逐条取出来（跟视口无关的那些） */
const 取观感 = `(选择器) => {
  const el = document.querySelector(选择器);
  if (!el) return { 错: '找不到 ' + 选择器 };
  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const 主 = el.querySelector('.btn--primary');
  let 主按钮靠右 = null;
  if (主) {
    const 底边 = el.getBoundingClientRect();
    主按钮靠右 = Math.round(底边.right - 主.getBoundingClientRect().right);
  }
  return {
    选择器,
    定位: s.position, 距底: s.bottom, 层级: s.zIndex,
    显示: s.display, 折行: s.flexWrap, 对齐: s.alignItems, 间距: s.gap,
    内边距: s.padding,
    描边: s.borderTopWidth + ' ' + s.borderTopStyle + ' ' + s.borderTopColor,
    四边都描了吗: s.borderTopWidth === s.borderBottomWidth && s.borderLeftWidth === s.borderRightWidth,
    圆角: s.borderRadius,
    背景: s.backgroundColor,
    阴影: s.boxShadow === 'none' ? 'none' : s.boxShadow.slice(0, 40) + '…',
    毛玻璃: s.backdropFilter,
    宽度: Math.round(r.width), 左: Math.round(r.left),
    主按钮离右边缘px: 主按钮靠右
  };
}`;

const 一条 = async (标签, url, 选择器) => {
  await rpc('Page.navigate', { url: `${app}${url}` });
  await 等(5500);
  const v = await 跑(`(${取观感})(${JSON.stringify(选择器)})`);
  console.log(`\n---- ${标签}（${选择器}）----\n` + JSON.stringify(v, null, 1));
  return v;
};

console.log(`==== ⑥ 底栏观感验收 · 视口 ${视口} ====`);
/* 变量名不能用 ①②③ 那种圈码（不是合法的 JS 标识符），所以叫甲/乙 */
const 甲 = await 一条('⑥ 工程迁移', '/tools/migrate', '.foot');
const 乙 = await 一条('⑦ 通道（全站那条 .wb__acts 做参照）', '/tools/channels?panel=split', '.wb__acts');

/* 逐条对：位置/描边/圆角/背景/阴影/毛玻璃/主按钮靠右 —— 这些是"观感"的判据 */
const 比 = ['定位', '距底', '层级', '显示', '折行', '对齐', '间距', '内边距', '描边', '四边都描了吗', '圆角', '背景', '毛玻璃', '主按钮离右边缘px'];
console.log('\n---- 逐条对 ----');
let 同 = 0;
for (const k of 比) {
  const a = 甲?.[k], b = 乙?.[k];
  const 一致 = a === b;
  if (一致) 同++;
  console.log(`  ${一致 ? '一样' : '**不一样**'}  ${k}：⑥=${JSON.stringify(a)}  ⑦=${JSON.stringify(b)}`);
}
console.log(`  （${同}/${比.length} 条一样。阴影按裁剪值看：⑥=${甲?.阴影} ⑦=${乙?.阴影}）`);

/* 截 ⑥ 底栏那块 */
await rpc('Page.navigate', { url: `${app}/tools/migrate` });
await 等(5500);
const 框 = await 跑(`(() => { const el = document.querySelector('.foot'); const r = el.getBoundingClientRect();
  return { x: 0, y: Math.max(0, Math.round(r.top - 12)), width: innerWidth, height: Math.min(innerHeight - Math.max(0, Math.round(r.top - 12)), Math.round(r.height) + 24) }; })()`);
const shot = await rpc('Page.captureScreenshot', { format: 'png', clip: { ...框, scale: 1 } });
fs.writeFileSync(截图, Buffer.from(shot.data, 'base64'));
console.log(`\n底栏那块截图：${截图}（${框.width}×${框.height}）`);
ws.close();
