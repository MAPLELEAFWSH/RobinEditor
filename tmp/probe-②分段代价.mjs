/**
 * ② 调色页「改一个参数到画面更新」这一步里，每一小步各占多少毫秒。
 *
 * 起因：无头 Chrome 里拿 1920×1080 的真尺寸参考图量，**每敲一个数字主线程被堵 96~124ms**
 * （一帧预算 33ms，等于掉三帧）。光看总数不知道砍哪儿，所以拆开量：
 * 拖动那一档（512 长边）/ 停手那一档（1024 长边）/ 烘表的采样网格（1024×32），
 * 默认那两个节点（basic + curves）的链。
 *
 * 亮不出来的是 `imageDataToUrl`（PNG 编码）—— 它要 canvas，只能在浏览器里量，
 * 数字在 `tmp\probe-②大图代价.log` 那份的说明里。
 *
 * 用法：node --import ./tmp/register-loader.mjs tmp\probe-②分段代价.mjs
 */
import { applyClut } from '../src/lib/img.ts';
import { CLUT_SIZE, makeClutGrid, channelDiff } from '../src/lib/modules/ikclut/ops.ts';
import { clutToImage } from '../src/lib/img.ts';
import { 跑链, 烘成CLUT } from '../src/lib/modules/ikclut/grade/chain.ts';
import { 新建基本, 新建曲线, 新建节点 } from '../src/lib/modules/ikclut/grade/types.ts';

function 造源(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] = (x * 7 + y * 3) & 255;
      d[i + 1] = (x * 3 + y * 11) & 255;
      d[i + 2] = (x ^ y) & 255;
      d[i + 3] = 255;
    }
  }
  return new ImageData(d, w, h);
}

function 计时(次, fn) {
  fn();
  let 最好 = Infinity;
  for (let i = 0; i < 次; i++) {
    const t = performance.now();
    fn();
    最好 = Math.min(最好, performance.now() - t);
  }
  return 最好;
}

/* 界面上一进这个页面就是这条：basic + curves，都是恒等参数 */
const b = 新建节点('basic');
b.p = { ...新建基本(), exposure: 1.2, contrast: 1.1 };
const c = 新建节点('curves');
const 链 = [b, c];

const grid = makeClutGrid(CLUT_SIZE); /* 1024×32 */
/* 1920×1080 的截图按 512 / 1024 长边重采样之后的样子 */
const 拖 = 造源(512, 288);
const 停 = 造源(1024, 576);
const 原 = 造源(1920, 1080);

const 表 = 烘成CLUT(grid, 链, CLUT_SIZE);

const 行 = [
  ['跑链（拖动档 512×288，2 节点）', 计时(8, () => 跑链(拖, 链))],
  ['烘成CLUT（采样网格 1024×32，2 节点）', 计时(8, () => 烘成CLUT(grid, 链, CLUT_SIZE))],
  ['clutToImage（排成 1024×32 的图）', 计时(8, () => clutToImage(表, false))],
  ['applyClut（自检：把表打回 1024×576）', 计时(8, () => applyClut(停, 表))],
  ['channelDiff（自检：逐像素比 1024×576）', 计时(8, () => channelDiff(停, 停))],
  ['跑链（停手档 1024×576，2 节点）', 计时(8, () => 跑链(停, 链))],
  ['applyClut（拖动档 512×288）', 计时(8, () => applyClut(拖, 表))]
];

console.log('\n② 「改一个参数 → 画面更新」拆开量（毫秒，取最热几次里最快的一次）\n');
console.log('一条链只有 basic + curves（界面默认），源图是 1920×1080：');
console.log('拖动档 = 512 长边；停手档 = 1024 长边\n');
let 合拖 = 0;
let 合停 = 0;
for (const [名, ms] of 行) {
  const 拖档 = /512×288|1024×32/.test(名);
  if (拖档) 合拖 += ms;
  else 合停 += ms;
  console.log('  ' + 名.padEnd(40) + (ms.toFixed(1) + ' ms').padStart(11));
}
console.log('\n  —— 拖动档里要跑的几步合计（不含 PNG 编码）: ' + 合拖.toFixed(1) + ' ms');
console.log('  —— 停手档里多出来的那几步合计（不含 PNG 编码）: ' + 合停.toFixed(1) + ' ms');
console.log('\n（另外 `imageDataToUrl` 走 canvas.toDataURL，Node 里没有，数字见浏览器那份）');
console.log('原始 1920×1080 的源图本身：' + (原.width + '×' + 原.height));
