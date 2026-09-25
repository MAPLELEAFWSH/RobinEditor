/**
 * 抽屉内容超宽的探针：找出 `.wb__side` 里到底是谁把抽屉撑宽的。
 *
 * 用法（先起无头/cdp 实例，再）：
 *   $env:CDP_PORT='9400'; node tmp/probe-drawer.mjs /tools/ilm
 */
const PORT = process.env.CDP_PORT ?? '9400';
const 路由 = process.argv[2] ?? '/tools/ilm';
const BASE = process.env.AUDIT_BASE ?? `http://127.0.0.1:${PORT}`;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const 页 = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
if (!页) {
  console.error('没有页面目标');
  process.exit(2);
}
const ws = new WebSocket(页.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const 等 = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && 等.has(m.id)) {
    等.get(m.id)(m);
    等.delete(m.id);
  }
});
const rpc = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    等.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

await rpc('Emulation.setDeviceMetricsOverride', { width: 1707, height: 1067, deviceScaleFactor: 1, mobile: false });
await rpc('Page.navigate', { url: new URL(路由, BASE).toString() });
await new Promise((r) => setTimeout(r, 1800));

const r = await rpc('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    const 抽屉 = document.querySelector('.wb__side');
    if (!抽屉) return { 说明: '这一页没有 .wb__side' };
    const 宽 = 抽屉.clientWidth;
    const 出 = [];
    for (const e of 抽屉.querySelectorAll('*')) {
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      const 超 = e.scrollWidth - e.clientWidth;
      const 右溢 = Math.round(e.getBoundingClientRect().right - 抽屉.getBoundingClientRect().right);
      if (超 > 1 || 右溢 > 2) {
        出.push({
          标签: e.tagName.toLowerCase(),
          类: (e.className || '').toString().slice(0, 50),
          文: (e.textContent || '').trim().slice(0, 40),
          自身宽: Math.round(e.getBoundingClientRect().width),
          超: 超,
          右溢: 右溢,
          minW: s.minWidth,
          ws: s.whiteSpace,
          ow: s.overflowWrap,
          pos: s.position
        });
      }
    }
    出.sort((a, b) => Math.max(b.右溢, b.超) - Math.max(a.右溢, a.超));
    return { 抽屉宽: 宽, 抽屉滚动宽: 抽屉.scrollWidth, 可疑: 出.slice(0, 12) };
  })()`
});
console.log(JSON.stringify(r.result?.value ?? r, null, 2));
ws.close();
