/**
 * 通过 CDP 在真实的 Tauri WebView 里跑一段 JS。
 *
 * 为什么要这个：浏览器里的 dev server 没有 window.__TAURI_INTERNALS__，
 * 所以 invoke 那一条链（前端参数名 → Rust 命令 → 真实文件读写）在浏览器里
 * 根本走不到。Tauri dev 起来的时候带了
 *   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
 * 于是可以抓到这个 webview 的调试端点，直接在里面执行。
 *
 * 用法：
 *   node tmp/cdp.mjs <js 文件>            # 执行文件里的表达式，打印结果
 *   node tmp/cdp.mjs --list               # 列出可连的目标
 *   node tmp/cdp.mjs <js 文件> <目标id>   # 指定目标
 *
 * 脚本内容要是一个表达式，返回 JSON 可序列化的值。用 async IIFE 写异步逻辑。
 */
import fs from 'node:fs';

const PORT = process.env.CDP_PORT ?? '9222';

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

async function main() {
  const [file, targetId] = process.argv.slice(2);

  if (file === '--list' || !file) {
    const list = await listTargets();
    for (const t of list) {
      console.log(`${t.id}\t${t.type}\t${t.title}\t${t.url}`);
    }
    return;
  }

  const targets = await listTargets();
  const page = targets.find((t) => t.type === 'page' && (!targetId || t.id === targetId));
  if (!page) {
    console.error('没有可连的 page 目标');
    process.exit(1);
  }

  const expression = fs.readFileSync(file, 'utf8');
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP 超时（60s）')), 60000);
    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression,
            awaitPromise: true,
            returnByValue: true,
            allowUnsafeEvalBlockedByCSP: true
          }
        })
      );
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== 1) return;
      clearTimeout(timer);
      if (msg.result?.exceptionDetails) {
        const d = msg.result.exceptionDetails;
        reject(new Error(d.exception?.description ?? d.text ?? '页面里抛了异常'));
        return;
      }
      resolve(msg.result?.result?.value);
    });
    ws.addEventListener('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket 出错：${e.message ?? e.type}`));
    });
  });

  try {
    const value = await done;
    console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  } finally {
    ws.close();
  }
}

main().catch((e) => {
  console.error('失败：' + e.message);
  process.exit(1);
});
