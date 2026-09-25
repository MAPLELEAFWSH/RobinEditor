const PORT = 9222;
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
ws.send(JSON.stringify({ id: 1, method: 'Page.reload', params: { ignoreCache: true } }));
await new Promise((r) => setTimeout(r, 6000));
ws.close();
console.log('硬刷新完成');
