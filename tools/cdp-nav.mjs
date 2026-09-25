/**
 * 让真 Tauri webview 导航到某个 URL（CDP 的 Page.navigate）。
 *
 * `tmp/cdp.mjs` 只做 Runtime.evaluate，不能导航 —— 想验某一个功能页就得先站到那一页上。
 * 它要自己开一个进程，所以放 tools/ 而不是 tmp/。
 *
 * 前提：`pnpm tauri dev` 带了远程调试端口
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
 *
 * 用法：node tools/cdp-nav.mjs "http://localhost:1420/tools/mstoon?panel=pack"
 */
const PORT = process.env.CDP_PORT ?? '9222';
const url = process.argv[2];
if (!url) {
  console.error('给个 URL。用法：node tools/cdp-nav.mjs "http://localhost:1420/tools/xxx"');
  process.exit(1);
}

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.error(`没有可连的 page 目标。确认 dev 起来时带了 --remote-debugging-port=${PORT}`);
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', reject);
});
ws.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url } }));
await new Promise((resolve) => {
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id === 1) resolve();
  });
  setTimeout(resolve, 8000);
});
// 给前端留出渲染时间
await new Promise((r) => setTimeout(r, 2500));
ws.close();
console.log('navigated → ' + url);
