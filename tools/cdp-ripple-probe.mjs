/*
 * 量「点击涟漪」到底画在哪一层：真机截图前后对比。
 *
 * 为什么要这么做：涟漪是 z-index:-1 + 宿主 isolation:isolate 那套，
 * 光看代码说不清"它在某个宿主上是不是被背景盖住了"。所以点一下、截一张，
 * 跟点之前那张按宿主矩形裁开做像素差 —— 有变化就是看得见，0 就是被盖住了。
 *
 * 前提前：`pnpm tauri dev` 带了 --remote-debugging-port=9222
 * 用法：node tools/cdp-ripple-probe.mjs [页面路径]
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const PORT = process.env.CDP_PORT ?? '9222';
const 页面 = process.argv[2] ?? '';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.error(`没有可连的 page 目标（确认 dev 带了 --remote-debugging-port=${PORT}）`);
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res);
  ws.addEventListener('error', rej);
});

let id = 0;
const 待 = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  const r = 待.get(m.id);
  if (r) {
    待.delete(m.id);
    m.error ? r.rej(new Error(JSON.stringify(m.error))) : r.res(m.result);
  }
});
const 调 = (method, params = {}) =>
  new Promise((res, rej) => {
    const my = ++id;
    待.set(my, { res, rej });
    ws.send(JSON.stringify({ id: my, method, params }));
  });

const 求值 = async (表达式) => {
  const r = await 调('Runtime.evaluate', { expression: 表达式, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? '页面里抛了异常');
  return r.result.value;
};

const 截图 = async (路径) => {
  const r = await 调('Page.captureScreenshot', { format: 'png' });
  writeFileSync(路径, Buffer.from(r.data, 'base64'));
};

await 调('Page.enable');
if (页面) {
  await 调('Page.navigate', { url: 页面 });
  await new Promise((r) => setTimeout(r, 3000));
} else {
  await 调('Page.navigate', { url: 'http://localhost:1420/' });
  await new Promise((r) => setTimeout(r, 3000));
}

/* 页面上能点到的宿主：每类取第一个 */
const 目标 = await 求值(`(() => {
  const 选择器 = ['.btn', '.quick__it', '.leaf', '.elem', '.pick__b', '.slot__hit', '.chip', '.seg__b', '.fab', '.sb__btn'];
  const out = [];
  for (const s of 选择器) {
    const el = document.querySelector(s);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    out.push({ sel: s, text: (el.textContent || '').trim().slice(0, 14), x: r.left, y: r.top, w: r.width, h: r.height,
      背景: getComputedStyle(el).backgroundColor, 位置: getComputedStyle(el).position });
  }
  return out;
})()`);

mkdirSync('tmp/ripple', { recursive: true });
const dpr = await 求值('devicePixelRatio');
writeFileSync('tmp/ripple/dpr.txt', String(dpr));
await 截图('tmp/ripple/blank.png');
console.log(`页面：${await 求值('location.href')}  设备像素比 ${dpr}`);
console.log('');
console.log('宿主            文字           矩形                   背景                点击后变化像素（宿主框内）');
const 记录 = [];
for (const t of 目标) {
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  await 求值(`(() => {
    const el = document.querySelector(${JSON.stringify(t.sel)});
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: ${cx}, clientY: ${cy} }));
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 130));
  const 文件 = `tmp/ripple/${t.sel.replace(/[^a-z_]/gi, '')}.png`;
  await 截图(文件);
  记录.push({ ...t, 文件 });
  console.log(
    `${t.sel.padEnd(14)} ${t.text.padEnd(14)} ${`${t.x.toFixed(0)},${t.y.toFixed(0)} ${t.w.toFixed(0)}x${t.h.toFixed(0)}`.padEnd(22)} ${(t.背景 || '').padEnd(20)} → 见 tmp/ripple/`
  );
  await new Promise((r) => setTimeout(r, 700));
}
writeFileSync('tmp/ripple/rects.json', JSON.stringify(记录, null, 1));
console.log('\n矩形写到 tmp/ripple/rects.json；用 tools/cdp-ripple-diff.py 做像素差');
ws.close();
