/**
 * ② 原分辨率：**出图那一步**（ImageData → 能塞进 `<img>` 的东西）在真尺寸下要多久。
 *
 * 像素运算那几步已经在 `tmp\量-②原分辨率开销.mjs` 里量过（Node）：
 * 4096×2048 上 `跑链` 21ms、`applyClut`（自检用）540ms —— 所以自检那两遍要挪走。
 * 剩下这条是**现有出图路径** `imageDataToUrl`（OffscreenCanvas.putImageData → 普通 canvas → toDataURL PNG）
 * 与「换成 Blob URL」各要多久，只有浏览器能量。
 *
 * 内容用**逐像素伪随机**（PNG 最难压的那种：1 像素 ≈ 4 字节都压不掉）。
 * 真贴图比它好压（语料里 4096×2048 的 png 是 2~4.8MB ≈ 0.3~0.6 字节/像素），
 * 所以这里量到的是**保守上界**。
 * **第一版量具本身是错的**：用 `i*7` 那种周期图案，PNG 压出来只有 0.2MB ——
 * 那不是上界是下界。量具也得当代码审一遍。
 *
 * 不用起应用：`about:blank` 上就能建 canvas。
 * 用法（先起无头 Chrome 挂 9400）：node tmp\量-②编码开销.mjs
 */
const PORT = process.env.CDP_PORT ?? '9400';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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

/* 两段脚本共用的一段：造真噪声 + 取最快一次 */
const 造噪声 = `
  const 造 = (w, h) => {
    const d = new Uint8ClampedArray(w * h * 4);
    let s = 88172645 >>> 0;
    for (let i = 0; i < d.length; i += 4) {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      d[i] = s & 255; d[i + 1] = (s >>> 8) & 255; d[i + 2] = (s >>> 16) & 255; d[i + 3] = 255;
    }
    return new ImageData(d, w, h);
  };
  const 尺寸表 = [[1024, 1024], [2048, 2048], [4096, 2048]];
`;

const 同步脚本 = `(() => {
${造噪声}
  const 出 = [];
  for (const [w, h] of 尺寸表) {
    const data = 造(w, h);
    const off = new OffscreenCanvas(w, h);
    const oc = off.getContext('2d');
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c2 = cv.getContext('2d');
    const 一圈 = () => {
      oc.putImageData(data, 0, 0);
      c2.drawImage(off, 0, 0);
      return cv.toDataURL('image/png');
    };
    let 最好 = Infinity;
    for (let i = 0; i < 3; i++) { const t0 = performance.now(); const u = 一圈(); 最好 = Math.min(最好, performance.now() - t0); var 末 = u; }
    出.push({ 尺寸: w + '×' + h, dataURL毫秒: +最好.toFixed(1), 字符串MB: +(末.length / 1048576).toFixed(1) });
  }
  return 出;
})()`;

const 异步脚本 = `(async () => {
${造噪声}
  const 出 = [];
  for (const [w, h] of 尺寸表) {
    const data = 造(w, h);
    const off = new OffscreenCanvas(w, h);
    off.getContext('2d').putImageData(data, 0, 0);
    let 最好 = Infinity;
    let 字节 = 0;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const blob = await off.convertToBlob({ type: 'image/png' });
      const u = URL.createObjectURL(blob);
      URL.revokeObjectURL(u);
      最好 = Math.min(最好, performance.now() - t0);
      字节 = blob.size;
    }
    出.push({ 尺寸: w + '×' + h, blob毫秒: +最好.toFixed(1), blobMB: +(字节 / 1048576).toFixed(1) });
  }
  return 出;
})()`;

const 同步 = await rpc('Runtime.evaluate', { expression: 同步脚本, returnByValue: true });
if (同步.exceptionDetails) {
  console.error('页面抛错：', 同步.exceptionDetails.exception?.description ?? 同步.exceptionDetails.text);
  process.exit(1);
}
console.log('ImageData → data URL（无头 Chrome，逐像素噪声＝保守上界）\n');
console.table(同步.result.value);

const 异步 = await rpc('Runtime.evaluate', { expression: 异步脚本, returnByValue: true, awaitPromise: true });
if (异步.exceptionDetails) {
  console.error('页面抛错：', 异步.exceptionDetails.exception?.description ?? 异步.exceptionDetails.text);
  process.exit(1);
}
console.log('\nImageData → Blob（convertToBlob + objectURL）\n');
console.table(异步.result.value);
ws.close();
