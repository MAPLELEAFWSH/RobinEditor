/**
 * 探针：把底栏钉到"一屏底"这件事，改前 / 改后逐页对比几何。
 *
 * 为什么要这么量：`.panel-host` 现在是普通块，要改成 flex 列 + 一屏最小高度才能把底栏顶到底，
 * 而 flex 会**取消子元素外边距塌陷**；Ray 一个 `panel-host` 里塞了 8 个根节点、⑥ 的底栏还在
 * `.wb` 外面 —— 光看代码推不出每页会挪几像素，只能量。
 *
 * 每页记四样：页面有没有冒出滚动条、`.work` 的底内边距、`.panel-host` 的框、
 * 以及它每个直接子节点的 top/高（改前改后一比，谁挪了就知道）。
 *
 * 用法（先 `pnpm dev` 起 1420，再无头 Chrome 开 9400）：
 *   node tmp\probe-一屏底.mjs [视口] > tmp\一屏底-改前.json
 */
import { writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const 视口 = process.argv[2] ?? '1707x1067';
const 输出 = process.argv[3] ?? '';
const app = 'http://127.0.0.1:1420';

const 页表 = [
  ['/tools/migrate', '⑥ 修复区'],
  ['/tools/migrate?panel=pack', '⑥ 打包区'],
  ['/tools/glitch?panel=fix', '① 文本'],
  ['/tools/ikclut', '② 调色'],
  ['/tools/ray?panel=conf', '③ Ray 配置'],
  ['/tools/ray?panel=material', '③ Ray 材质'],
  ['/tools/mstoon', '④ msToon'],
  ['/tools/ilm?panel=pack', '⑤ ILM'],
  ['/tools/yaku?panel=apply', '养乐多写入'],
  ['/tools/channels?panel=split', '⑦ 分离'],
  ['/tools/recent', '最近工程'],
  ['/tools/quick', '快捷动作']
];

const 桩 = `
(() => {
  const 名 = (el) => (typeof el.className === 'string' && el.className ? el.className.split(' ').filter((c) => !c.startsWith('svelte-')).join('.') : el.tagName.toLowerCase());
  const 圆 = (n) => Math.round(n);
  window.__量 = () => {
    const 根 = document.documentElement;
    const 算 = getComputedStyle(根);
    const 尾 = parseFloat(算.getPropertyValue('--status-h')) || 30;
    const work = document.querySelector('.work');
    const host = document.querySelector('.panel-host');
    const 条 = [...document.querySelectorAll('.wb__acts, .foot, .wbar--foot')];
    return {
      地址: location.pathname + location.search,
      视口高: innerHeight,
      文档高: 根.scrollHeight,
      冒滚动条: 根.scrollHeight > innerHeight + 1,
      work: work ? { t: 圆(work.getBoundingClientRect().top), b: 圆(work.getBoundingClientRect().bottom), 底内边距: getComputedStyle(work).paddingBottom } : null,
      host: host ? {
        t: 圆(host.getBoundingClientRect().top),
        b: 圆(host.getBoundingClientRect().bottom),
        高: 圆(host.getBoundingClientRect().height),
        显示: getComputedStyle(host).display,
        最小高: getComputedStyle(host).minHeight,
        子: [...host.children].map((c) => ({ 谁: 名(c), t: 圆(c.getBoundingClientRect().top), b: 圆(c.getBoundingClientRect().bottom) }))
      } : '（没有 .panel-host）',
      一屏高: 算.getPropertyValue('--page-fill').trim() || '（没设）',
      底栏高: 算.getPropertyValue('--bbar-h').trim() || '（没设）',
      底栏: 条.map((b) => ({ 谁: 名(b), t: 圆(b.getBoundingClientRect().top), b: 圆(b.getBoundingClientRect().bottom), 贴底: 圆(b.getBoundingClientRect().bottom) >= innerHeight - 尾 - 40 }))
    };
  };
})();
`;

const list = await (await fetch(`${BASE}/json/list`)).json();
const t = list.find((x) => x.type === 'page' && !x.url.startsWith('devtools://'));
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
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Emulation.setDeviceMetricsOverride', {
  width: Number(视口.split('x')[0]), height: Number(视口.split('x')[1]), deviceScaleFactor: 1, mobile: false
});
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: 桩 });
const 跑 = async (表达式) => {
  const r = await rpc('Runtime.evaluate', { expression: 表达式, returnByValue: true });
  if (r.exceptionDetails) return { 页面抛错: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  return r.result.value;
};

const 结果 = {};
console.log(`==== 一屏底几何 · 视口 ${视口} ====`);
for (const [路由, 标签] of 页表) {
  await rpc('Page.navigate', { url: `${app}${路由}` });
  await 等(4200);
  const m = await 跑('window.__量()');
  结果[标签] = m;
  const h = m?.host;
  console.log(`\n---- ${标签}（${路由}）----`);
  console.log(`滚动条 ${m?.冒滚动条 ? '有 ❌' : '无'} · 文档高 ${m?.文档高} / 视口 ${m?.视口高} · work 底内边距 ${m?.work?.底内边距} · 一屏高 ${m?.一屏高} · 底栏高 ${m?.底栏高}`);
  console.log(`panel-host ${h === '（没有 .panel-host）' ? h : `t=${h?.t} b=${h?.b} 高=${h?.高} 显示=${h?.显示} 最小高=${h?.最小高}`}`);
  if (h && h !== '（没有 .panel-host）') {
    for (const c of h.子) console.log(`   ${c.t}→${c.b}  ${c.谁}`);
  }
  for (const b of m?.底栏 ?? []) console.log(`   底栏 ${b.谁} ${b.t}→${b.b}${b.贴底 ? '（贴底）' : '（悬空 ❌）'}`);
}
if (输出) { writeFileSync(输出, JSON.stringify(结果, null, 1), 'utf8'); console.log(`\n已写 ${输出}`); }
ws.close();
