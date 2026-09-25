/**
 * ② 原分辨率：**拿真图**量出图那一步（`tmp\量-②编码开销.mjs` 量的是纯噪声＝上界）。
 *
 * 为什么要单独来一遍：噪声那张 4096×2048 压出来 27MB，而真贴图同尺寸只有 2~4.8MB ——
 * PNG 编码的耗时跟要产出的数据量直接相关，差一个量级。**承重数字必须来自真素材。**
 *
 * 做法：脚本自己起一个小 http 服务（带 CORS）把 `tmp\素材-②真图.png` 递给页面，
 * 页面 `createImageBitmap` → canvas → `getImageData`（拿到原分辨率像素）→ 计时两条编码路。
 * 不用起应用，也不碰语料原目录（真图是**复制**过来的）。
 *
 * 用法（先起无头 Chrome 挂 9400）：node tmp\量-②真图编码.mjs
 */
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';

const PORT_CDP = process.env.CDP_PORT ?? '9400';
const PORT_HTTP = 9411;
const 图 = new URL('./素材-②真图.png', import.meta.url).pathname.replace(/^\//, '');

const 字节 = readFileSync(decodeURIComponent(图));
const 服务 = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'image/png');
  res.end(字节);
}).listen(PORT_HTTP);

const list = await (await fetch(`http://127.0.0.1:${PORT_CDP}/json/list`)).json();
const t = list.find((x) => x.type === 'page' && !x.url.startsWith('devtools://'));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const rpc = (method, params = {}) =>
  new Promise((res, rej) => {
    const my = ++id;
    const 定时 = setTimeout(() => { ws.removeEventListener('message', on); rej(new Error('CDP 超时 ' + method)); }, 180000);
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
await rpc('Runtime.enable');

const 脚本 = `(async () => {
  const 复 = await fetch('http://127.0.0.1:${PORT_HTTP}/x.png');
  const 块 = await 复.blob();
  const bmp = await createImageBitmap(块);
  const w = bmp.width, h = bmp.height;
  const off = new OffscreenCanvas(w, h);
  const oc = off.getContext('2d');
  oc.drawImage(bmp, 0, 0);
  const data = oc.getImageData(0, 0, w, h);

  /* 出图那两步：putImageData 到离屏、drawImage 到普通 canvas、再编码 */
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c2 = cv.getContext('2d');

  let dataURL最好 = Infinity, 末 = '';
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    oc.putImageData(data, 0, 0);
    c2.drawImage(off, 0, 0);
    末 = cv.toDataURL('image/png');
    dataURL最好 = Math.min(dataURL最好, performance.now() - t0);
  }

  let blob最好 = Infinity, blob字节 = 0;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    oc.putImageData(data, 0, 0);
    const b = await off.convertToBlob({ type: 'image/png' });
    const u = URL.createObjectURL(b);
    URL.revokeObjectURL(u);
    blob最好 = Math.min(blob最好, performance.now() - t0);
    blob字节 = b.size;
  }

  /* 只算编码本身（不含 putImageData/drawImage） */
  c2.drawImage(off, 0, 0);
  let 纯编码 = Infinity;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    cv.toDataURL('image/png');
    纯编码 = Math.min(纯编码, performance.now() - t0);
  }

  return {
    图片尺寸: w + '×' + h,
    像素数: ((w * h) / 1e6).toFixed(1) + 'M',
    文件MB: +(块.size / 1048576).toFixed(2),
    每像素字节: +(块.size / (w * h)).toFixed(3),
    '现在这条路 毫秒': +dataURL最好.toFixed(1),
    '其中纯编码 毫秒': +纯编码.toFixed(1),
    'dataURL字符串MB': +(末.length / 1048576).toFixed(1),
    'Blob路 毫秒': +blob最好.toFixed(1),
    'Blob MB': +(blob字节 / 1048576).toFixed(1)
  };
})()`;

const r = await rpc('Runtime.evaluate', { expression: 脚本, returnByValue: true, awaitPromise: true });
ws.close();
服务.close();
if (r.exceptionDetails) {
  console.error('页面抛错：', r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  process.exit(1);
}
console.log(`真图：${decodeURIComponent(图)}（${(statSync(decodeURIComponent(图)).size / 1048576).toFixed(2)}MB）\n`);
console.table([r.result.value]);
