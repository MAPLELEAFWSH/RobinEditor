/**
 * 注入一段脚本、导航过去、然后**等页面上的结果变量**，最后把结果取回来。
 *
 * 跟邻居的分工：
 *   · `cdp.mjs`      在当前页跑一段表达式（不导航）
 *   · `cdp-nav.mjs`  只导航
 *   · `cdp-init.mjs` 注入 + 导航，但注入只在那个会话里有效、会话立刻关
 *   · 本文件          注入 + 导航 + **保持会话**，轮询 `window[全局名]` 直到它就绪
 *
 * 为什么需要它：有些过程要跨好几次导航（进 A 页点一遍、进 B 页再点一遍），
 * 只有会话活着，`Page.addScriptToEvaluateOnNewDocument` 才会在每次新文档里都生效；
 * 而结果要等过程跑完才能取。
 *
 * 用法：
 *   node tools/cdp-run.mjs <注入脚本.js> <起始URL> <结果全局名> [超时秒数]
 *
 * 约定：注入脚本把结果挂到 `window.<结果全局名>`，跑完把它自己的 `done` 置 true。
 */
import fs from 'node:fs';

const PORT = process.env.CDP_PORT ?? '9222';
const [initFile, url, globalName, timeoutSec] = process.argv.slice(2);
if (!initFile || !url || !globalName) {
  console.error('用法：node tools/cdp-run.mjs <注入脚本.js> <起始URL> <结果全局名> [超时秒数]');
  process.exit(1);
}
const source = fs.readFileSync(initFile, 'utf8');
const budgetMs = (Number(timeoutSec) || 60) * 1000;

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
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) => {
  const myId = ++id;
  return new Promise((resolve) => {
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
};

await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source });
await send('Page.navigate', { url });

const t0 = Date.now();
let last = null;
while (Date.now() - t0 < budgetMs) {
  await new Promise((r) => setTimeout(r, 700));
  const r = await send('Runtime.evaluate', {
    expression: `(() => { const v = window[${JSON.stringify(globalName)}]; return v ? JSON.parse(JSON.stringify(v)) : null; })()`,
    returnByValue: true,
    awaitPromise: false
  });
  last = r?.result?.result?.value ?? null;
  if (last && last.done) break;
}

ws.close();
console.log(JSON.stringify(last, null, 2));
if (!last) process.exit(2);
