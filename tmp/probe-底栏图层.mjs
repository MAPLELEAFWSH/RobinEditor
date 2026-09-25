/**
 * 探针：底栏 / 参数抽屉 / 右下角悬浮球三者的**覆盖与点击**（用户报的"图层错误、按钮点不动"）。
 *
 * 为什么要专门量：`tools\ui-audit.mjs` 的重叠判据**把浮层排除在外**（参数抽屉是 fixed 盖在上面的，
 * 规范里本来就允许它压住内容），所以"写盘条被抽屉/悬浮球盖住"这种它一条都报不出来。
 * 这里直接问浏览器：**在那个按钮的中心点上，最上层是谁** —— 谁被 elementFromPoint 命中，
 * 谁就吃掉了这次点击。
 *
 * 用法（先 `pnpm dev` 起 1420，再无头 Chrome 开 9400）：
 *   node tmp\probe-底栏图层.mjs [视口]
 */
const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const 视口 = process.argv[2] ?? '1707x1067';
const app = 'http://127.0.0.1:1420';

const 页表 = [
  ['/tools/migrate', '⑥ 修复区（有写盘条）'],
  ['/tools/migrate?panel=pack', '⑥ 打包区'],
  ['/tools/yaku?panel=apply', '③ 养乐多写入'],
  ['/tools/channels?panel=split', '⑦ 分离'],
  ['/tools/ikclut', '② 调色'],
  ['/tools/glitch?panel=fix', '① 文本'],
  ['/tools/ilm?panel=pack', '⑤ ILM']
];

const 桩 = `
(() => {
  const 文 = (el) => (el?.textContent ?? '').replace(/\\s+/g, ' ').trim();
  const 矩 = (el) => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
  const 叠了吗 = (a, b) => a && b && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  /* 交叠那一块的正中心，浏览器判给谁 —— 几何上叠着不算错，**判给了抽屉**才是错 */
  const 叠处归属 = (a, b) => {
    if (!叠了吗(a, b)) return '（没叠）';
    const x = Math.round((Math.max(a.l, b.l) + Math.min(a.r, b.r)) / 2);
    const y = Math.round((Math.max(a.t, b.t) + Math.min(a.b, b.b)) / 2);
    const el = document.elementFromPoint(x, y);
    if (!el) return '（点外）';
    const 条 = el.closest('.wb__acts, .foot, .wbar--foot');
    const 抽 = el.closest('.wb__side');
    return 条 ? '底栏 ✅' : 抽 ? '抽屉 ❌' : '第三方 ' + el.tagName;
  };

  window.__查 = () => {
    const 球 = [...document.querySelectorAll('.fabs .fab')].map((b) => ({ 名: 文(b) || '（外观）', 矩: 矩(b), z: getComputedStyle(b.parentElement).zIndex }));
    /* 底栏：三种形态都算（标准 .wb__acts / ⑥ 的 .foot / Ray 的 .wbar--foot） */
    const 底 = [...document.querySelectorAll('.wb__acts, .foot, .wbar--foot')].map((b) => ({ 类: b.className, 矩: 矩(b), z: getComputedStyle(b).zIndex, 贴底: Math.round(b.getBoundingClientRect().bottom) >= innerHeight - 40, 父链: (() => { let p = b.parentElement, out = []; while (p && out.length < 4) { const c = (typeof p.className === 'string' ? p.className : '').split(' ')[0]; out.push(c || p.tagName.toLowerCase()); p = p.parentElement; } return out.join(' < '); })(), 主按钮: [...b.querySelectorAll('.btn--primary')].map(文) }));
    /* 参数抽屉：**先点开**，收起状态量不出覆盖 */
    const 抽 = [...document.querySelectorAll('.wb__side')].map((s) => ({ 矩: 矩(s), z: getComputedStyle(s).zIndex, 位置: getComputedStyle(s).position, 在视口里: s.getBoundingClientRect().left < innerWidth }));
    /* 主按钮：中心点最上层是谁 */
    const 主 = [...document.querySelectorAll('.btn--primary')].filter((b) => !b.disabled && b.offsetParent).map((b) => {
      const r = b.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
      const 上 = document.elementFromPoint(x, y);
      return {
        字: 文(b).slice(0, 18),
        矩: 矩(b),
        在视口外: r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth,
        点得到: !!上 && (上 === b || b.contains(上)),
        命中的是: 上 ? 上.tagName + '.' + (typeof 上.className === 'string' ? 上.className.split(' ').slice(0, 2).join(' ') : '') : null
      };
    });
    /* 「选 / 选择」这类按钮也扫一遍 —— 用户报"选择按钮有点击 bug"。
       **在视口外的直接标出来**，不然 elementFromPoint 返回 null 会被当成"点不到"，
       2026-09-23 就吃过一次：⑤ ILM 那个「选」滚在屏幕外，报成 0/1。 */
    const 选钮 = [...document.querySelectorAll('button')]
      .filter((b) => /^(选|选择|选一个文件|选目录|选…)$/.test(文(b)) || /选目录|选一个文件|选模板/.test(文(b)))
      .filter((b) => b.offsetParent && !b.disabled)
      .map((b) => {
        const r = b.getBoundingClientRect();
        const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
        const 外 = r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth;
        const 上 = 外 ? null : document.elementFromPoint(x, y);
        return { 字: 文(b).slice(0, 14), 在视口外: 外, 点得到: !!上 && (上 === b || b.contains(上)), 命中的是: 上 ? 上.tagName + '.' + (typeof 上.className === 'string' ? 上.className.split(' ').slice(0, 2).join(' ') : '') : null };
      });
    const 选钮在场 = 选钮.filter((x) => !x.在视口外);

    /* 抽屉中线上从上到下**谁在画**。抽屉是浮层，本该整条是它；中间冒出一条别的东西
       就是用户说的"底栏和参数栏图层错误"。（2026-09-23：⑥/⑦/⑤ 内容比视口短，
       底栏就停在正文末尾、不贴底，于是那条不透明的写盘条正好横切抽屉。） */
    const 中线 = (() => {
      const s = document.querySelector('.wb__side');
      if (!s) return '（这一页没有参数抽屉）';
      const r = s.getBoundingClientRect();
      if (r.left >= innerWidth || r.right <= 0) return '（抽屉收着，不在视口里）';
      const x = Math.round(r.left + r.width / 2);
      const 条 = [];
      let 段 = null;
      for (let y = Math.round(r.top) + 4; y < Math.round(r.bottom) - 4; y += 6) {
        const el = document.elementFromPoint(x, y);
        const 名 = !el ? '空'
          : el.closest('.wb__side') ? '抽屉'
          : el.closest('.wb__acts, .foot, .wbar--foot') ? '底栏'
          : el.closest('.fabs') ? '球'
          : (typeof el.className === 'string' && el.className ? el.className.split(' ')[0] : el.tagName);
        if (!段 || 段.谁 !== 名) { 段 = { 谁: 名, 从: y }; 条.push(段); }
        段.到 = y;
      }
      return 条.map((v) => v.谁 + ' ' + v.从 + '→' + v.到).join(' , ');
    })();

    return {
      地址: location.pathname + location.search,
      底栏高: getComputedStyle(document.documentElement).getPropertyValue('--bbar-h').trim() || '（没设）',
      悬浮球: 球,
      底栏: 底,
      抽屉: 抽,
      底栏与球叠了吗: 底.some((d) => 球.some((q) => 叠了吗(d.矩, q.矩))),
      底栏与抽屉叠了吗: 底.some((d) => 抽.some((c) => 叠了吗(d.矩, c.矩))),
      叠处归属: 底.flatMap((d) => 抽.map((c) => 叠处归属(d.矩, c.矩))),
      抽屉中线: 中线,
      主按钮: 主,
      选钮点得到的比例: 选钮在场.length ? 选钮在场.filter((x) => x.点得到).length + '/' + 选钮在场.length + (选钮.length > 选钮在场.length ? '（另有 ' + (选钮.length - 选钮在场.length) + ' 个滚在视口外）' : '') : '（这一页没有这类按钮）',
      选钮点不到的: 选钮.filter((x) => !x.在视口外 && !x.点得到)
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
const 跑 = async (表达式, 等待 = false) => {
  const r = await rpc('Runtime.evaluate', { expression: 表达式, returnByValue: true, awaitPromise: 等待 });
  if (r.exceptionDetails) return { 页面抛错: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  return r.result.value;
};

console.log(`==== 底栏 / 抽屉 / 悬浮球 · 视口 ${视口} ====`);
const 汇总 = [];
for (const [路由, 名] of 页表) {
  await rpc('Page.navigate', { url: `${app}${路由}` });
  await 等(5500);
  /* 先点开参数抽屉（如果这一页有开关），不然量不出覆盖 */
  const 开了 = await 跑(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-pressed') !== null && /参数/.test(x.textContent || ''));
    if (!b) return { 没有参数开关: true };
    if (b.getAttribute('aria-pressed') !== 'true') b.click();
    return { 有开关: true, 按下后: b.getAttribute('aria-pressed') };
  })()`);
  await 等(900);
  const m = await 跑('window.__查()');
  console.log(`\n---- ${名}（${路由}）----`);
  console.log(JSON.stringify({ 开抽屉: 开了, ...m }, null, 1));
  汇总.push({
    页: 名,
    底栏高: m?.底栏高,
    底栏位置: (m?.底栏 ?? []).map((d) => `${d.类.split(' ').filter((c) => /wb__acts|foot|wbar/.test(c)).join('.')} t=${d.矩.t} b=${d.矩.b} h=${d.矩.h} z=${d.z}`).join(' , ') || '（没有底栏）',
    底栏与球叠: m?.底栏与球叠了吗,
    底栏与抽屉叠: m?.底栏与抽屉叠了吗,
    叠处归属: (m?.叠处归属 ?? []).join(','),
    抽屉中线: m?.抽屉中线,
    主按钮点得到: (m?.主按钮 ?? []).map((x) => `${x.字}:${x.点得到 ? 'ok' : '✗ 命中' + x.命中的是}`).join(' | ') || '（没有主按钮）',
    选钮: m?.选钮点得到的比例
  });
}
console.log('\n\n==== 汇总 ====');
console.table(汇总);
ws.close();
