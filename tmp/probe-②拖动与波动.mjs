/**
 * 探针：② 调色时**预览尺寸异常波动** + **拖不动**，到底怎么发生的。
 *
 * 两个疑点（读代码得到的），都用数字验或否掉：
 *   ① 波动：`Preview` 的 `适应倍 = min(1, 框宽/图宽, 框高/图高)`，而 ② 拖动时给的是 512 长的粗预览、
 *      停手后换成 1024 长的细预览 —— 图宽一变，适应倍就变，显示尺寸跟着跳。
 *   ② 拖不动：`Preview` 的 `下()` 里有一句"图没超出框就直接 return"，适应缩放时图正好装得下 →
 *      按下拖动静默无反应。
 *
 * 量法：
 *   · 连敲滑条，**逐帧**记两个 <img> 的渲染尺寸（`getBoundingClientRect`）与 natural 尺寸，
 *     一路记到"停手补细图"之后 —— 跳没跳、跳多少，一次看全；
 *   · 在适应倍下按 pointerdown+move+up，看 `scrollLeft/Top` 有没有动；
 *   · 再点「100%」重复一次拖 —— 分清"拖动整个坏了"还是"只在适应倍下不работает"。
 *
 * 用法（先 `pnpm dev` 起 1420，再无头 Chrome 开 9400）：
 *   node tmp\probe-②拖动与波动.mjs [视口]
 */
const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const 视口 = process.argv[2] ?? '1707x1067';
const app = 'http://127.0.0.1:1420';

const 桩 = `
(() => {
  const 量 = window.__量 = { 报错: [] };
  window.addEventListener('error', (e) => 量.报错.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => 量.报错.push('rejection ' + String(e.reason)));

  /** 两个预览台现在什么样 */
  window.__台 = () => [...document.querySelectorAll('.pv')].map((pv, i) => {
    const 框 = pv.querySelector('.pv__box');
    const 图 = pv.querySelector('img.pv__img');
    const r = 框.getBoundingClientRect();
    const ri = 图 ? 图.getBoundingClientRect() : null;
    return {
      第几个: i + 1,
      标签: pv.querySelector('img')?.getAttribute('alt') ?? '',
      视图百分比: pv.querySelector('.pv__zoom b')?.textContent ?? '',
      读数: (pv.querySelector('.pv__read')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
      框: { client: [框.clientWidth, 框.clientHeight], scroll: [框.scrollWidth, 框.scrollHeight], 矩形: [Math.round(r.width), Math.round(r.height)] },
      图: 图 ? { natural: [图.naturalWidth, 图.naturalHeight], 渲染: [Math.round(ri.width), Math.round(ri.height)] } : null,
      能滚吗: 框.scrollWidth > 框.clientWidth || 框.scrollHeight > 框.clientHeight,
      拖的时候会不会被挡: (() => { const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)); return el ? el.tagName + '.' + (typeof el.className === 'string' ? el.className : '') : null; })()
    };
  });

  /** 连敲一个数字框 N 下，逐帧记图的渲染/natural 尺寸 */
  window.__敲并跟帧 = async (ariaLabel, 下数, 每下间隔ms) => {
    const el = document.querySelector('input[aria-label="' + ariaLabel + '"]');
    if (!el) return { 错: '找不到 ' + ariaLabel };
    const 定值 = (v) => {
      const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      d.set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const 轨 = [];
    let 停 = false;
    const 记 = () => {
      for (const pv of document.querySelectorAll('.pv')) {
        const 图 = pv.querySelector('img.pv__img');
        if (!图) continue;
        const r = 图.getBoundingClientRect();
        const 框 = pv.querySelector('.pv__box');
        轨.push({
          t: Math.round(performance.now()),
          alt: 图.getAttribute('alt') ?? '',
          natural: 图.naturalWidth + 'x' + 图.naturalHeight,
          渲染: Math.round(r.width) + 'x' + Math.round(r.height),
          可滚: [框.scrollWidth - 框.clientWidth, 框.scrollHeight - 框.clientHeight].join('/')
        });
      }
      if (!停) requestAnimationFrame(记);
    };
    requestAnimationFrame(记);
    const v0 = Number(el.value) || 1;
    for (let i = 0; i < 下数; i++) {
      定值(v0 + (i % 2 === 0 ? 0.06 : -0.05) * (i + 1));
      await new Promise((r) => setTimeout(r, 每下间隔ms ?? 30));
    }
    /* 停手之后再跟 1.4 秒 —— 细图就是这时候补上来的 */
    await new Promise((r) => setTimeout(r, 1400));
    停 = true;
    /* 压成一串"变了才算一档"的变化点 */
    const 变化点 = [];
    for (const x of 轨) {
      const 上 = 变化点.at(-1);
      if (!上 || 上.natural !== x.natural || 上.渲染 !== x.渲染 || 上.alt !== x.alt) 变化点.push(x);
    }
    /* 逐图分开统计渲染尺寸出现过哪几种 */
    const 按图 = {};
    for (const x of 轨) {
      const k = x.alt || '(无 alt)';
      按图[k] ??= { 渲染尺寸: new Set(), natural尺寸: new Set(), 帧数: 0 };
      按图[k].渲染尺寸.add(x.渲染);
      按图[k].natural尺寸.add(x.natural);
      按图[k].帧数++;
    }
    const 汇总 = Object.fromEntries(
      Object.entries(按图).map(([k, v]) => [k, { 渲染尺寸: [...v.渲染尺寸], natural尺寸: [...v.natural尺寸], 帧数: v.帧数 }])
    );
    return { 总帧数: 轨.length, 变化点: 变化点.slice(0, 24), 汇总, 报错: 量.报错.slice(-3) };
  };

  /** 在某一个预览台上按一下拖一把，看图**位置**动不动。
      注意：平移在 2026-09-23 之后是 transform 位移，不是滚动条 —— 所以量的是图的位置，
      不是 scrollLeft（早先那版量 scrollLeft，改完就永远读成"没动"，是探针过时不是功能坏了）。 */
  window.__试拖 = async (第几个, dx, dy) => {
    const pv = [...document.querySelectorAll('.pv')][第几个 - 1];
    if (!pv) return { 错: '没有第 ' + 第几个 + ' 个预览台' };
    const 框 = pv.querySelector('.pv__box');
    const 图 = pv.querySelector('img.pv__img');
    if (!图) return { 错: '这一台没有图' };
    const 起点 = 框.getBoundingClientRect();
    const x = Math.round(起点.left + 起点.width / 2);
    const y = Math.round(起点.top + 起点.height / 2);
    const 前 = 图.getBoundingClientRect();
    const 前位 = { x: Math.round(前.left), y: Math.round(前.top) };
    const 目标 = document.elementFromPoint(x, y) ?? 框;
    const 派 = (类型, xx, yy, 按钮 = 0) =>
      目标.dispatchEvent(new PointerEvent(类型, {
        bubbles: true, cancelable: true, clientX: xx, clientY: yy, button: 按钮, buttons: 类型 === 'pointerup' ? 0 : 1,
        pointerId: 1, pointerType: 'mouse', isPrimary: true
      }));
    派('pointerdown', x, y);
    for (let i = 1; i <= 8; i++) 派('pointermove', x + (dx * i) / 8, y + (dy * i) / 8);
    派('pointerup', x + dx, y + dy);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const 后 = 图.getBoundingClientRect();
    const 后位 = { x: Math.round(后.left), y: Math.round(后.top) };
    /* 拖到框外面去了吗（夹住该拦住） */
    const 框后 = 框.getBoundingClientRect();
    return {
      第几个, 拖的量: [dx, dy],
      拖之前: 前位, 拖之后: 后位,
      动了: 后位.x - 前位.x !== 0 || 后位.y - 前位.y !== 0,
      位移: [后位.x - 前位.x, 后位.y - 前位.y],
      图的四边都还在框附近: 后.right > 框后.left - 1 && 后.left < 框后.right + 1 && 后.bottom > 框后.top - 1 && 后.top < 框后.bottom + 1,
      命中元素: 目标.tagName + '.' + (typeof 目标.className === 'string' ? 目标.className : '')
    };
  };

  /** 点「视图 N%」展开里的某个按钮（适应 / 100% / 像素 1:1） */
  window.__点视图 = async (字) => {
    const 摘要 = document.querySelector('.pv__zoom > summary');
    if (摘要 && !document.querySelector('.pv__zoom[open]')) 摘要.click();
    await new Promise((r) => requestAnimationFrame(r));
    const b = [...document.querySelectorAll('.pv__b')].find((x) => (x.textContent || '').trim() === 字);
    if (!b) return { 错: '找不到视图按钮「' + 字 + '」' };
    b.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { 点了: 字 };
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

const 跑 = async (表达式, 等待 = true) => {
  const r = await rpc('Runtime.evaluate', { expression: 表达式, returnByValue: true, awaitPromise: 等待 });
  if (r.exceptionDetails) return { 页面抛错: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  return r.result.value;
};
const 表 = (标签, v) => console.log(`\n---- ${标签} ----\n${JSON.stringify(v, null, 1)}`);

console.log(`==== ② 拖动与尺寸波动 · 视口 ${视口} ====`);
await rpc('Page.navigate', { url: `${app}/tools/ikclut` });
await 等(7000);

表('① 打开时两个预览台', await 跑('window.__台()', false));

console.log('\n==== ② 连敲「曝光」12 下（30ms 一下），逐帧跟到停手补细图之后 ====');
表('尺寸轨迹', await 跑('window.__敲并跟帧("曝光", 12, 30)'));

console.log('\n==== ③ 适应倍下试拖 ====');
表('拖第 1 个（原图）', await 跑('window.__试拖(1, 120, 60)'));
表('拖第 2 个（调色后）', await 跑('window.__试拖(2, 120, 60)'));

console.log('\n==== ④ 切到 100% 之后再试拖 ====');
表('点 100%', await 跑('window.__点视图("100%")'));
表('点完两个台', await 跑('window.__台()', false));
表('拖第 1 个（原图）', await 跑('window.__试拖(1, 120, 60)'));
表('拖第 2 个（调色后）', await 跑('window.__试拖(2, 120, 60)'));

console.log('\n==== ⑤ 拖到很远（看夹住有没有拦住、图会不会被甩出框） ====');
表('拖第 1 个（原图）往右下 3000px', await 跑('window.__试拖(1, 3000, 3000)'));

console.log('\n==== ⑥ 开「同步平移」再拖 ====');
表('开同步', await 跑(`(async () => {
  const 勾 = [...document.querySelectorAll('label.chk')].find((l) => /同步平移/.test(l.textContent || ''));
  const i = 勾?.querySelector('input');
  if (i && !i.checked) i.click();
  await new Promise((r) => requestAnimationFrame(r));
  return { 同步平移: !!i?.checked };
})()`));
表('拖第 1 个（原图）', await 跑('window.__试拖(1, 100, 40)'));
表('两个台现在的位置', await 跑(`[...document.querySelectorAll('.pv')].map((pv, i) => {
  const 图 = pv.querySelector('img.pv__img');
  const r = 图.getBoundingClientRect();
  return { 第几个: i + 1, alt: 图.getAttribute('alt'), 位置: [Math.round(r.left), Math.round(r.top)] };
})`, false));

console.log('\n==== ⑦ 点「重置」看回不回正中间 ====');
表('点重置', await 跑('window.__点视图("重置")'));
表('重置后', await 跑(`[...document.querySelectorAll('.pv')].map((pv) => {
  const 图 = pv.querySelector('img.pv__img');
  const 框 = pv.querySelector('.pv__box');
  const a = 图.getBoundingClientRect(), b = 框.getBoundingClientRect();
  return { alt: 图.getAttribute('alt'), 图中心减框中心: [Math.round((a.left + a.width / 2) - (b.left + b.width / 2)), Math.round((a.top + a.height / 2) - (b.top + b.height / 2))] };
})`, false));

console.log('\n==== ⑧ 页面报错 ====');
表('报错', await 跑('window.__量.报错', false));
ws.close();
