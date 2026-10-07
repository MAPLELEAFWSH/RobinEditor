/**
 * 把所有路由跑一遍，抓运行时错误 —— 收尾查 bug 用。
 *
 * 前提：dev 带了远程调试端口。
 * 用法：node tools/cdp-audit.mjs [起始URL]
 *
 * 每个路由：导航 → 等挂载 → 点掉非文件类按钮 → 记控制台 error / 未捕获异常 / 侧栏报错。
 */
const PORT = process.env.CDP_PORT ?? '9222';

/** 要过的路由。`?panel=` 带上，才能把每个分区都渲染一遍 */
const ROUTES = [
  '/',
  '/tools/channels?panel=extract',
  '/tools/channels?panel=pipeline',
  '/tools/channels?panel=layers',
  '/tools/channels?panel=adjust',
  '/tools/channels?panel=blend',
  '/tools/channels?panel=split',
  '/tools/channels?panel=merge',
  '/tools/channels?panel=swizzle',
  '/tools/channels?panel=batch',
  '/tools/ilm?panel=pack',
  '/tools/ilm?panel=repack',
  '/tools/ilm?panel=sdf',
  '/tools/ilm?panel=pairing',
  '/tools/ikclut?panel=clut',
  '/tools/ikclut?panel=blend',
  '/tools/ikclut?panel=export',
  '/tools/glitch?panel=fix',
  '/tools/glitch?panel=batch',
  '/tools/glitch?panel=fx',
  '/tools/ray?panel=conf',
  '/tools/ray?panel=material',
  '/tools/yaku?panel=match',
  '/tools/yaku?panel=apply',
  '/about',
  '/welcome'
];

const base = process.argv[2] ?? 'http://localhost:1420';
/** 每个路由等多久。40 个路由 × 这个数就是总时长 */
const settleMs = Number(process.env.AUDIT_SETTLE ?? 1500);

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.error(`没有可连的 page 目标。确认带了 --remote-debugging-port=${PORT}`);
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', reject);
});

let id = 0;
const pending = new Map();
let collected = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    collected.push('未捕获：' + String(d?.exception?.description ?? d?.text ?? '').split('\n')[0].slice(0, 160));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    collected.push('console.error：' + (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 160));
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    collected.push('日志：' + m.params.entry.text.slice(0, 160));
  }
});

const send = (method, params = {}) => {
  const myId = ++id;
  return new Promise((resolve) => {
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
};

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');

const rows = [];
for (const route of ROUTES) {
  collected = [];
  await send('Page.navigate', { url: base + route });
  await new Promise((r) => setTimeout(r, settleMs));
  /* 点掉非文件类按钮，看会不会点出错误 */
  const clickRes = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const skip = /选|导入|保存|导出|写|扫描|载入|打开|重置|清空|删除/;
      const txt = (e) => (e.textContent || '').trim().replace(/\\s+/g, ' ');
      const btns = [...document.querySelectorAll('.btn:not([disabled]), .pick__b, .seg__btn')]
        .filter((b) => !skip.test(txt(b))).slice(0, 3);
      for (const b of btns) b.click();
      return btns.length;
    })()`
  });
  await new Promise((r) => setTimeout(r, 900));
  const state = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => ({
      h1: (document.querySelector('h1')?.textContent ?? '').trim(),
      面板: document.querySelectorAll('.wb, .card').length,
      侧栏报错: (document.querySelector('.side__err span')?.textContent ?? '').trim() || null,
      面板里的告警: [...document.querySelectorAll('.note--warn')].map((n) => (n.textContent||'').trim().slice(0,80)),
      /* Markdown 残留：Svelte 不渲染 Markdown，模板里写 ** 用户就看到星号 */
      星号: ((document.body.innerText || '').match(/\\*\\*/g) || []).length,
      星号行: [...new Set((document.body.innerText || '').split('\\n').filter((l) => l.includes('**')))]
        .map((l) => l.trim().slice(0, 80)).slice(0, 4),
      /* 漏到界面上的占位/未定义文案 */
      脏字: ((document.body.innerText || '').match(/undefined|NaN|\\[object Object\\]|TODO|FIXME|占位符/g) || []).slice(0, 4)
    }))()`
  });
  rows.push({
    路由: route,
    点了几个按钮: clickRes?.result?.result?.value ?? 0,
    ...(state?.result?.result?.value ?? {}),
    错误: [...new Set(collected)]
  });
}

ws.close();

let badCount = 0;
for (const r of rows) {
  const bad = r.错误.length > 0 || r.侧栏报错 || r.星号 > 0 || r.脏字.length > 0;
  if (bad) badCount++;
  console.log(
    `${bad ? 'FAIL' : 'ok  '}  ${r.路由.padEnd(34)} h1=${r.h1 || '(空)'}` +
      (r.侧栏报错 ? `  侧栏报错=${r.侧栏报错}` : '') +
      (r.星号 ? `  星号×${r.星号}：${r.星号行.join(' | ')}` : '') +
      (r.脏字.length ? `  脏字=${r.脏字.join(',')}` : '') +
      (r.错误.length ? `\n        ${r.错误.join('\n        ')}` : '')
  );
}
console.log(`\n${rows.length} 个路由，${badCount} 个有问题`);
process.exit(badCount ? 1 : 0);
