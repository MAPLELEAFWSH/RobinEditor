/**
 * 探针：⑤ 「工作区的按钮，点击会有按钮之间文字的冲突抽搐」（用户 2026-09-23 澄清的口径）。
 *
 * 为什么不能靠看代码下结论：按下这一下同时发生三件事 ——
 *   ① `.ripple-host` 给宿主加 `position:relative + overflow:hidden`；
 *   ② 插一个**盖在文字之上**的环（`.ripple`，z-index = --z-content，700ms）；
 *   ③ 宿主自己 `transform: scale(--press-scale-soft)`（0.95）。
 * 到底哪一件让"文字抽搐"，只有逐帧量得出来。
 *
 * 做法：CDP 派**真鼠标事件**（合成的 PointerEvent 不触发 `:active`），
 * **按下之后不松手、把指针移开再松** —— 这样宿主拿到 :active 和涟漪，
 * 但**不会触发任何点击动作**（不会切分区、不会开对话框），量的是纯粹"按下"这一下。
 * 逐帧记：宿主几何 / 文字的精确矩形（Range 量文本节点）/ transform / 宿主与邻居的文字是否被
 * 别的东西盖住（elementsFromPoint 最上层是谁）。
 *
 * 用法（先 `pnpm dev` 起 1420，再无头 Chrome 开 9400）：
 *   node tmp\probe-⑤点击抽搐.mjs [视口]
 */
const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const 视口 = process.argv[2] ?? '1707x1067';
const app = 'http://127.0.0.1:1420';

/** 跟 `+layout.svelte` 里那份 RIPPLE_HOSTS 保持一致；没有它就量不到涟漪 */
const 宿主选择器 = '.btn, .quick__it, .seg__b, .seg__btn, .leaf, .elem, .pick__b, .slot__hit, .fab, .sb__btn, .chip';
/** **只看工作区里的**（用户说的就是"工作区的按钮"）——侧边导航那些 `.leaf` 不算，
    上一版没限定范围，量出来的全是侧边栏（DOM 里排在最前面），白跑一轮 */
const 范围 = '.work';

const 页表 = [
  ['/tools/glitch?panel=fix', '① 文本（编码预设那排按钮）'],
  ['/tools/channels?panel=blend', '⑦ 混合（分区条 + 卡片按钮）'],
  ['/tools/ikclut', '② 调色（预览视图那排小按钮）'],
  ['/tools/migrate', '⑥ 迁移（底栏 + 卡片按钮）']
];

const 桩 = `
(() => {
  const 量 = window.__量 = { 报错: [] };
  window.addEventListener('error', (e) => 量.报错.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => 量.报错.push('rejection ' + String(e.reason)));

  const 清 = (s) => (s ?? '').replace(/\\s+/g, ' ').trim();
  const 圆 = (n) => Math.round(n * 100) / 100;

  /* **必须逐个加前缀**：写 '.work' + ' ' + '.btn, .leaf' 只会把 .work 加到第一个选择器上，
     后面几个照样是全局的 —— 上一版就是这么把侧边栏导航项当成工作区按钮量了两轮。 */
  const 选择器 = ${JSON.stringify(宿主选择器)}
    .split(', ')
    .map((s) => ${JSON.stringify(范围)} + ' ' + s)
    .join(', ');

  /** 文本节点的精确矩形（element 的 rect 是整块，看不出"字"动没动） */
  const 字矩形 = (el) => {
    if (!el) return null;
    const 走 = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)
    });
    const 节 = 走.nextNode();
    if (!节) return null;
    const r = document.createRange();
    r.selectNodeContents(节);
    const b = r.getBoundingClientRect();
    return { x: 圆(b.left), y: 圆(b.top), w: 圆(b.width), h: 圆(b.height) };
  };

  /** 量一个宿主（按钮）现在的样子 */
  const 拍 = (宿主) => {
    const r = 宿主.getBoundingClientRect();
    const cs = getComputedStyle(宿主);
    const 字 = 字矩形(宿主);
    /* **环压在字上没有，只能按几何判**：涟漪是 pointer-events:none，
       elementFromPoint 永远返回不到它（第一版就是这么瞎的，量出"盖住 0 帧"）。
       这里取每个 .ripple 的当前矩形（动画中的真实矩形）跟文字矩形求交。
       注意：.ripple-host 带 overflow:hidden，所以环**只可能压在宿主内部的字上** ——
       "按钮之间的文字冲突"只会发生在"一个宿主里装着好几个按钮/好几段字"的地方，
       所以内层每一段字都要单独判。 */
    const 环们 = [...宿主.querySelectorAll(':scope > .ripple')].map((r2) => {
      const b = r2.getBoundingClientRect();
      const c = getComputedStyle(r2);
      return {
        矩形: { x: 圆(b.left), y: 圆(b.top), w: 圆(b.width), h: 圆(b.height) },
        进度: 圆(r2.getAnimations?.()[0]?.currentTime ?? 0),
        /* 环的粗细 + "有没有内圆"（删掉 ::after 之后 content 是 none）——
           这两条才是"字会不会被糊住"的判据，光看几何重叠看不出 */
        环粗: c.borderTopWidth,
        不透明度: c.opacity,
        内圆: getComputedStyle(r2, '::after').content
      };
    });
    const 压到 = (b) => 环们.some((h) => h.矩形.x < b.x + b.w && h.矩形.x + h.矩形.w > b.x && h.矩形.y < b.y + b.h && h.矩形.y + h.矩形.h > b.y);
    const 内字 = [];
    const 走 = document.createTreeWalker(宿主, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)
    });
    for (let n = 走.nextNode(); n && 内字.length < 12; n = 走.nextNode()) {
      const rr = document.createRange();
      rr.selectNodeContents(n);
      const b = rr.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) continue;
      const o = { 文: 清(n.nodeValue).slice(0, 10), x: 圆(b.left), y: 圆(b.top), w: 圆(b.width), h: 圆(b.height) };
      o.环压 = 压到(o);
      内字.push(o);
    }
    return {
      宿主: { x: 圆(r.left), y: 圆(r.top), w: 圆(r.width), h: 圆(r.height) },
      字,
      环们,
      内字数: 内字.length,
      内字,
      内字被环压: 内字.filter((z) => z.环压).map((z) => z.文),
      transform: cs.transform,
      fontWeight: cs.fontWeight,
      fontSize: cs.fontSize,
      letterSpacing: cs.letterSpacing,
      padding: cs.padding,
      位置: cs.position,
      溢出: cs.overflow,
      涟漪数: 宿主.querySelectorAll(':scope > .ripple').length,
      类: 宿主.className
    };
  };

  /** 页面上所有"会被涟漪选中"的**工作区里**的可见元素，带标签 */
  window.__候选 = (最多) => {
    const 出 = [];
    for (const el of document.querySelectorAll(选择器)) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (r.bottom < 0 || r.top > innerHeight) continue;
      const t = 清(el.textContent);
      if (!t) continue;
      出.push({
        标签: t.slice(0, 12),
        元素类: (typeof el.className === 'string' ? 清(el.className) : '').split(' ').slice(0, 3).join('.'),
        有字: !!字矩形(el),
        矩: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
      });
      if (出.length >= (最多 ?? 40)) break;
    }
    return 出;
  };

  /** 找第 n 个候选元素（跟 __候选 同一套筛选，保证下标对得上） */
  window.__第几个 = (n) => {
    const 全 = [];
    for (const el of document.querySelectorAll(选择器)) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (r.bottom < 0 || r.top > innerHeight) continue;
      if (!清(el.textContent)) continue;
      全.push(el);
    }
    return 全[n] ?? null;
  };

  window.__滚到 = async (n) => {
    const el = window.__第几个(n);
    if (!el) return { 错: '没有第 ' + n + ' 个' };
    el.scrollIntoView({ block: 'center' });
    await new Promise((r) => setTimeout(r, 400));
    const r = el.getBoundingClientRect();
    return { 中心: [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)], 矩: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } };
  };

  /**
   * 按下并逐帧跟（**不松手**，由外面把指针移开再松）
   * 邻居 = 同一父节点下的其它同类宿主，用来判断"按钮之间的文字"有没有动。
   */
  window.__开始跟帧 = (n) => {
    const el = window.__第几个(n);
    if (!el) return { 错: '没有第 ' + n + ' 个' };
    const 邻居 = [...(el.parentElement?.children ?? [])].filter((c) => c !== el && c.matches?.(${JSON.stringify(宿主选择器)}));
    量.轨 = [];
    量.停 = false;
    const 记 = () => {
      量.轨.push({
        t: Math.round(performance.now()),
        本: 拍(el),
        邻居: 邻居.map((c) => ({ 标签: 清(c.textContent).slice(0, 10), 字: 字矩形(c), 矩: (() => { const r = c.getBoundingClientRect(); return { x: 圆(r.left), y: 圆(r.top), w: 圆(r.width), h: 圆(r.height) }; })() }))
      });
      if (!量.停) requestAnimationFrame(记);
    };
    requestAnimationFrame(记);
    return { 开始: true, 宿主类: 清(el.className), 邻居数: 邻居.length };
  };

  window.__收帧 = async (等毫秒) => {
    await new Promise((r) => setTimeout(r, 等毫秒 ?? 1200));
    量.停 = true;
    await new Promise((r) => requestAnimationFrame(r));
    const 轨 = 量.轨 ?? [];
    return { 轨, 报错: 量.报错.slice(-3) };
  };
  /**
   * **换选中**那一刻：真点一下另一个选项，量整排按钮的文字有没有跟着挪。
   *
   * 这条才是用户说的"点击会有按钮之间文字的冲突抽搐"的嫌疑犯：
   * 全局样式里那条"选中态加粗"（见 src/styles/wb.css 的 .pick__b[aria-pressed='true']）——
   * 而 .pick__b 是 flex:1 + white-space: nowrap：加粗让那一颗的文字变宽，
   * 整排重新分配宽度，邻座的字跟着挪。
   */
  window.__量换选中 = async (组选择器) => {
    const 组 = [...document.querySelectorAll(组选择器)].find((g) => g.querySelectorAll(':scope > .pick__b, :scope > .btn, :scope > button').length >= 2);
    if (!组) return { 错: '找不到 ' + 组选择器 };
    const 钮们 = [...组.querySelectorAll(':scope > .pick__b, :scope > .btn, :scope > button')];
    组.scrollIntoView({ block: 'center' });
    await new Promise((r) => setTimeout(r, 400));
    const 拍 = () => 钮们.map((b) => {
      const r = b.getBoundingClientRect();
      const 字 = 字矩形(b);
      return {
        标签: 清(b.textContent).slice(0, 10),
        选中: b.getAttribute('aria-pressed') === 'true' || b.classList.contains('is-on'),
        字重: getComputedStyle(b).fontWeight,
        钮: { x: 圆(r.left), w: 圆(r.width) },
        字: 字 ? { x: 字.x, w: 字.w } : null
      };
    });
    const 前 = 拍();
    /* 点一个**当前没选中**的、而且真的是开关（带 aria-pressed）的：
       点一个纯动作按钮（比如「清空」）不会改任何状态，量出来永远是"没挪"，
       上一版就在 ⑤ ILM 上这么白测了一轮。 */
    const 目标 =
      钮们.find((b) => b.hasAttribute('aria-pressed') && b.getAttribute('aria-pressed') !== 'true') ??
      钮们.find((b) => b.getAttribute('aria-pressed') !== 'true' && !b.classList.contains('is-on')) ??
      钮们[1];
    const t = 目标.getBoundingClientRect();
    return { 组: 清(组.className), 前, 目标中心: [Math.round(t.left + t.width / 2), Math.round(t.top + t.height / 2)], 目标标签: 清(目标.textContent).slice(0, 10) };
  };

  window.__收换选中 = async () => {
    const 组 = window.__待量组;
    return null;
  };

  /** 点完之后再拍一次（外面发完点击事件调） */
  window.__量换选中后 = (组选择器) => {
    const 组 = [...document.querySelectorAll(组选择器)].find((g) => g.querySelectorAll(':scope > .pick__b, :scope > .btn, :scope > button').length >= 2);
    if (!组) return { 错: '找不到组' };
    const 钮们 = [...组.querySelectorAll(':scope > .pick__b, :scope > .btn, :scope > button')];
    return 钮们.map((b) => {
      const r = b.getBoundingClientRect();
      const 字 = 字矩形(b);
      return {
        标签: 清(b.textContent).slice(0, 10),
        选中: b.getAttribute('aria-pressed') === 'true' || b.classList.contains('is-on'),
        字重: getComputedStyle(b).fontWeight,
        钮: { x: 圆(r.left), w: 圆(r.width) },
        字: 字 ? { x: 字.x, w: 字.w } : null
      };
    });
  };

  /** ILM 那排 on/off 开关：.btn--ghost.is-on 也改字重 */
  window.__量开关组 = () => {
    const 组 = [...document.querySelectorAll('.btn--ghost.is-on')].map((b) => b.parentElement).filter(Boolean);
    return 组.slice(0, 3).map((g) => ({ 组: 清(g.className).slice(0, 40), 钮数: g.querySelectorAll(':scope > .btn').length }));
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
    const 定时 = setTimeout(() => { ws.removeEventListener('message', on); rej(new Error('CDP 超时 ' + method)); }, 120000);
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
const 鼠标 = (type, x, y, extra = {}) =>
  rpc('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
const 移 = (x, y) => rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });

/** 一项：把第 n 个候选按下、跟帧、移开松手，返回逐帧数据的摘要 */
async function 量一下(n) {
  const 位置 = await 跑(`window.__滚到(${n})`);
  if (位置?.错) return { 第几个: n, ...位置 };
  const 候选 = await 跑(`window.__候选(60)[${n}]`);
  const [x, y] = 位置.中心;
  await 移(x, y);
  await 等(160);
  const 悬停 = await 跑(`(() => { const el = window.__第几个(${n}); const r = el.getBoundingClientRect(); return { 矩: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, transform: getComputedStyle(el).transform, 字: (() => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const 节 = w.nextNode(); if (!节) return null; const rr = document.createRange(); rr.selectNodeContents(节); const b = rr.getBoundingClientRect(); return { x: Math.round(b.left * 100) / 100, y: Math.round(b.top * 100) / 100, w: Math.round(b.width * 100) / 100 }; })() }; })()`);
  await 跑(`window.__开始跟帧(${n})`, false);
  await 鼠标('mousePressed', x, y, { buttons: 1 });
  /* 按住 900ms：涟漪 700ms，加上按压过渡 */
  const r = await 跑(`window.__收帧(900)`);
  /* **移开再松手**：这样不触发这个按钮的 click（不会切分区/开对话框） */
  await 移(x + 200, y + 160);
  await 鼠标('mouseReleased', x + 200, y + 160, { buttons: 0 });
  await 等(500);

  const 轨 = r?.轨 ?? [];
  if (!轨.length) return { 第几个: n, 候选, 悬停, 错: '没收到帧', 报错: r?.报错 };
  const 首 = 轨[0];
  const 字动 = 轨.map((f) => f.本.字).filter(Boolean);
  const 字x = 字动.map((z) => z.x);
  const 字w = 字动.map((z) => z.w);
  const 宿主w = 轨.map((f) => f.本.宿主.w);
  const 邻居动 = 轨.map((f) => (f.邻居[0]?.字 ? { x: f.邻居[0].字.x, y: f.邻居[0].字.y } : null)).filter(Boolean);
  const transform集合 = [...new Set(轨.map((f) => f.本.transform))];
  /* 环压到宿主内部任何一段字的帧数（除被点的那段之外也要算） */
  const 环压帧 = 轨.filter((f) => (f.本.内字被环压 ?? []).length > 0);
  const 被压过的字 = [...new Set(环压帧.flatMap((f) => f.本.内字被环压))];
  const 溢出者 = [...new Set(轨.map((f) => f.本.溢出))];
  const 位置者 = [...new Set(轨.map((f) => f.本.位置))];
  const 涟漪帧 = 轨.filter((f) => f.本.涟漪数 > 0).length;
  const 环最大 = Math.max(0, ...轨.flatMap((f) => f.本.环们.map((h) => h.矩形.w)));
  const 环粗们 = [...new Set(轨.flatMap((f) => f.本.环们.map((h) => h.环粗)))];
  const 内圆们 = [...new Set(轨.flatMap((f) => f.本.环们.map((h) => h.内圆)))];
  return {
    第几个: n,
    候选,
    悬停时: { transform: 悬停?.transform, 字: 悬停?.字, 矩: 悬停?.矩 },
    帧数: 轨.length,
    宿主内文字数: 首.本.内字数,
    文字横向漂移: 字x.length ? { 最小: Math.min(...字x), 最大: Math.max(...字x), 极差: 圆(Math.max(...字x) - Math.min(...字x)) } : null,
    文字宽度: 字w.length ? { 最小: Math.min(...字w), 最大: Math.max(...字w), 极差: 圆(Math.max(...字w) - Math.min(...字w)) } : null,
    宿主宽度: { 最小: Math.min(...宿主w), 最大: Math.max(...宿主w), 极差: 圆(Math.max(...宿主w) - Math.min(...宿主w)) },
    邻居文字位移: 邻居动.length > 1 ? { x极差: 圆(Math.max(...邻居动.map((v) => v.x)) - Math.min(...邻居动.map((v) => v.x))), y极差: 圆(Math.max(...邻居动.map((v) => v.y)) - Math.min(...邻居动.map((v) => v.y))) } : '（没邻居）',
    transform们: { 个数: transform集合.length, 首: transform集合[0], 末: transform集合.at(-1) },
    涟漪在场帧数: 涟漪帧,
    '环压到字的帧数': 环压帧.length,
    被环压过的字: 被压过的字,
    环最大宽: 环最大,
    环粗们,
    内圆们,
    溢出们: 溢出者,
    位置们: 位置者,
    类们: [...new Set(轨.map((f) => f.本.类))].map((c) => (c.includes('ripple-host') ? '有 ripple-host' : '没 ripple-host')).slice(0, 2),
    首帧: { 字: 首.本.字, 宿主: 首.本.宿主, transform: 首.本.transform },
    报错: r?.报错
  };
}

const 圆 = (n) => Math.round(n * 100) / 100;

console.log(`==== ⑤ 按钮按下这一下 · 视口 ${视口} ====`);
const 汇总 = [];
for (const [路由, 名] of 页表) {
  await rpc('Page.navigate', { url: `${app}${路由}` });
  await 等(6500);
  const 候选 = await 跑('window.__候选(60)');
  console.log(`\n---- ${名}（${路由}）----`);
  console.log(`候选按钮 ${候选.length} 个：` + 候选.slice(0, 12).map((c) => `「${c.标签}」`).join(' '));
  /* 每种页面量前 6 个有文字的候选 */
  const 要量的 = 候选.slice(0, 6).map((_, i) => i);
  for (const n of 要量的) {
    const m = await 量一下(n);
    console.log(`\n  [${n}] 「${m.候选?.标签 ?? '?'}」  ${m.候选?.元素类 ?? ''}`);
    console.log(
      '    ' +
        JSON.stringify({
          宿主内文字数: m.宿主内文字数,
          文字横向极差: m.文字横向漂移?.极差,
          宿主宽极差: m.宿主宽度?.极差,
          邻居文字位移: m.邻居文字位移,
          transform: m.transform们,
          涟漪在场帧: m.涟漪在场帧数,
          环压到字的帧数: m['环压到字的帧数'],
          被环压过的字: m.被环压过的字,
          环最大宽: m.环最大宽,
          环粗: m.环粗们,
          内圆: m.内圆们,
          位置们: m.位置们,
          溢出们: m.溢出们,
          类们: m.类们,
          帧数: m.帧数,
          报错: m.报错
        })
    );
    汇总.push({
      页: 名,
      按钮: m.候选?.标签,
      宿主内字数: m.宿主内文字数,
      文字横向极差: m.文字横向漂移?.极差,
      环在场帧: m.涟漪在场帧数,
      环压字帧: m['环压到字的帧数'],
      被压的字: (m.被环压过的字 ?? []).join(','),
      环最大宽: m.环最大宽,
      transform末: (m.transform们?.末 ?? '').slice(0, 24)
    });
  }
}
console.log('\n\n==== 汇总 ====');
console.table(汇总);

/* ================= 换选中那一刻：整排文字会不会挪 ================= */
console.log('\n\n==== 换选中：点一下另一个选项，整排按钮的文字挪多少 ====');
const 换选中汇总 = [];
for (const [路由, 名, 组选择器, 要开抽屉] of [
  ['/tools/glitch?panel=fix', '① 文本（编码预设那排）', '.pick', false],
  ['/tools/migrate', '⑥ 迁移（说明卡里那排）', '.pick', false],
  /* ILM 的预设排在**参数抽屉里面**：`.actions` 那个选择器会先匹配到抽屉外的动作行
     （DOM 里排在前面），所以这里必须写 `.wb__side .acts`。 */
  ['/tools/ilm?panel=pack', '⑤ ILM（目标规格预设那排，在参数抽屉里）', '.wb__side .acts', true]
]) {
  await rpc('Page.navigate', { url: `${app}${路由}` });
  await 等(6500);
  if (要开抽屉) {
    /* 预设那排住在参数抽屉里，抽屉默认收起 → 元素在视口外，候选筛选会把它滤掉 */
    const 开了 = await 跑(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-pressed') !== null && /参数/.test(x.textContent || ''));
      if (!b) return { 没有参数开关: true };
      if (b.getAttribute('aria-pressed') !== 'true') b.click();
      return { 按下后: b.getAttribute('aria-pressed') };
    })()`);
    console.log(`\n（${名}）开抽屉：${JSON.stringify(开了)}`);
    await 等(900);
  }
  const 前 = await 跑(`window.__量换选中(${JSON.stringify(组选择器)})`);
  if (前?.错) {
    console.log(`\n---- ${名}：${前.错}`);
    continue;
  }
  console.log(`\n---- ${名} · 组 ${前.组} ----`);
  console.log('  点之前：' + JSON.stringify(前.前));
  const [x, y] = 前.目标中心;
  await 移(x, y);
  await 等(120);
  await 鼠标('mousePressed', x, y, { buttons: 1 });
  await 鼠标('mouseReleased', x, y, { buttons: 0 });
  await 等(700);
  const 后 = await 跑(`window.__量换选中后(${JSON.stringify(组选择器)})`);
  console.log('  点之后：' + JSON.stringify(后));
  if (Array.isArray(前.前) && Array.isArray(后)) {
    const 行 = 前.前.map((v, i) => ({
      标签: v.标签,
      被点: v.标签 === 前.目标标签,
      字重: `${v.字重}→${后[i]?.字重}`,
      钮宽: `${v.钮.w}→${后[i]?.钮.w}`,
      钮左边挪: 后[i] ? 圆(后[i].钮.x - v.钮.x) : null,
      文字左边挪: 后[i]?.字 && v.字 ? 圆(后[i].字.x - v.字.x) : null,
      文字宽变: 后[i]?.字 && v.字 ? 圆(后[i].字.w - v.字.w) : null,
      选中变: `${v.选中 ? '选中' : '没选'}→${后[i]?.选中 ? '选中' : '没选'}`
    }));
    console.table(行);
    换选中汇总.push(...行.map((r) => ({ 页: 名, ...r })));
  }
}
console.log('\n\n==== 换选中汇总 ====');
console.table(换选中汇总);
ws.close();
