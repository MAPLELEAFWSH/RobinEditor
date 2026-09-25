/**
 * 直方图 / 贴边统计的自检。
 *
 * 换算成纯函数之后正好全可测。盯的是：分箱边界、跳采样、贴边到底算"三路同时"还是"单路"、
 * 那句结论什么时候该报警。
 *
 * 跑：node --import ./tmp/register-loader.mjs tmp/hist.test.mjs
 */
import { histogram, histPath, histVerdict, peak } from '../src/lib/hist.ts';

let pass = 0;
let fail = 0;
function ok(cond, label, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${extra ? '  → ' + extra : ''}`);
  }
}
function eq(a, b, label) {
  ok(a === b, label, `实得 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}`);
}
function near(a, b, tol, label) {
  ok(Math.abs(a - b) <= tol, label, `实得 ${a}，期望 ${b}（容差 ${tol}）`);
}
function section(t) {
  console.log(`\n== ${t} ==`);
}

/** 造一张常量图 */
function solid(w, h, r, g, b, a = 255) {
  const im = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    im.data[i * 4] = r;
    im.data[i * 4 + 1] = g;
    im.data[i * 4 + 2] = b;
    im.data[i * 4 + 3] = a;
  }
  return im;
}

/* ============================================================ */

section('分箱边界');

{
  const h = histogram(solid(4, 4, 0, 0, 0), 1);
  eq(h.r[0], 16, '全 0 落在第 0 格');
  eq(h.r[255], 0, '第 255 格是空的');
  eq(h.sampled, 16, '数了 16 个');
  eq(h.mean, 0, '平均亮度 0');

  const h2 = histogram(solid(4, 4, 255, 255, 255), 1);
  eq(h2.r[255], 16, '全 255 落在第 255 格，不能溢出到 256');
  eq(h2.r[0], 0, '第 0 格是空的');
  near(h2.mean, 1, 1e-9, '平均亮度 1');
}

{
  // 每个值各一个像素：256 个像素应该填满 256 格，一格一个
  const im = new ImageData(256, 1);
  for (let i = 0; i < 256; i++) {
    im.data[i * 4] = i;
    im.data[i * 4 + 1] = i;
    im.data[i * 4 + 2] = i;
    im.data[i * 4 + 3] = 255;
  }
  const h = histogram(im, 1);
  let allOne = true;
  for (let v = 0; v < 256; v++) if (h.r[v] !== 1) allOne = false;
  ok(allOne, '0–255 每个值各一格，分箱没串位');
  eq(peak(h.r), 1, '峰值是 1');
}

section('跳采样');

{
  const im = new ImageData(100, 1);
  for (let i = 0; i < 100; i++) {
    im.data[i * 4] = 128;
    im.data[i * 4 + 1] = 128;
    im.data[i * 4 + 2] = 128;
    im.data[i * 4 + 3] = 255;
  }
  eq(histogram(im, 1).sampled, 100, '步长 1 全数');
  eq(histogram(im, 10).sampled, 10, '步长 10 数 10 个');
  eq(histogram(im, 10).r[128], 10, '跳采样之后那一格也跟着少');
  // 步长传 0 或者负数不该死循环，也不该一个都不数
  eq(histogram(im, 0).sampled, 100, '步长 0 当 1 处理');
  eq(histogram(im, -5).sampled, 100, '负数也当 1');
}

section('贴边：三路同时才算整体丢细节');

{
  // 一半纯黑一半纯白
  const im = new ImageData(8, 1);
  for (let i = 0; i < 8; i++) {
    const v = i < 4 ? 0 : 255;
    im.data[i * 4] = v;
    im.data[i * 4 + 1] = v;
    im.data[i * 4 + 2] = v;
    im.data[i * 4 + 3] = 255;
  }
  const h = histogram(im, 1);
  near(h.clipLow, 0.5, 1e-9, '一半压黑');
  near(h.clipHigh, 0.5, 1e-9, '一半截白');
}

{
  // 只有 R 路贴边（G/B 都是 128）—— 整体不该算贴边，但单路要算
  const im = new ImageData(4, 1);
  for (let i = 0; i < 4; i++) {
    const v = i < 2 ? 0 : 255;
    im.data[i * 4] = v;
    im.data[i * 4 + 1] = 128;
    im.data[i * 4 + 2] = 128;
    im.data[i * 4 + 3] = 255;
  }
  const h = histogram(im, 1);
  eq(h.clipLow, 0, 'R 贴边不算整体压黑');
  eq(h.clipHigh, 0, 'R 截白也不算整体截白');
  near(h.byCh.r.low, 0.5, 1e-9, 'R 路自己算');
  near(h.byCh.r.high, 0.5, 1e-9, 'R 路截白自己算');
  eq(h.byCh.g.low, 0, 'G 路没贴边');
  eq(h.byCh.b.high, 0, 'B 路没截白');
}

section('哪一路是空的');

{
  // R/G 各有变化，只有 B 是常量 —— 只有 B 该被认成"空的"
  const im = new ImageData(16, 1);
  for (let i = 0; i < 16; i++) {
    im.data[i * 4] = i * 8; // R 有 16 个值
    im.data[i * 4 + 1] = 255 - i * 8; // G 也有 16 个值
    im.data[i * 4 + 2] = 0; // B 恒定
    im.data[i * 4 + 3] = 255;
  }
  const h = histogram(im, 1);
  eq(h.flat.join(','), 'b', 'B 路整条一个值 → 认出它是空的');
  eq(h.flat.length, 1, '只报 B 一个');
}

{
  const h = histogram(solid(2, 2, 10, 20, 30), 1);
  eq(h.flat.length, 3, '纯色图三路都是空的');
}

{
  const im = new ImageData(2, 1);
  im.data.set([0, 0, 0, 255, 255, 255, 255, 255]);
  const h = histogram(im, 1);
  eq(h.flat.length, 0, '两个值的图不算空');
}

section('那句结论什么时候报警');

{
  const h = histogram(solid(10, 10, 0, 0, 0), 1);
  const v = histVerdict(h);
  eq(v.kind, 'warn', '整张全黑要报警');
  ok(/暗部.*压成/.test(v.text), '说清是暗部压黑');
  ok(/往回退/.test(v.text), '要给恢复方向，不只是说错了');
}

{
  const h = histogram(solid(10, 10, 255, 255, 255), 1);
  const v = histVerdict(h);
  eq(v.kind, 'warn', '整张全白要报警');
  ok(/截到纯白/.test(v.text), '说清是高光截白');
}

{
  // 一张分布正常的图不该报
  const im = new ImageData(256, 1);
  for (let i = 0; i < 256; i++) {
    im.data[i * 4] = i;
    im.data[i * 4 + 1] = i;
    im.data[i * 4 + 2] = i;
    im.data[i * 4 + 3] = 255;
  }
  const v = histVerdict(histogram(im, 1));
  eq(v.kind, 'ok', '渐变图不报警');
}

{
  // 少量贴边不该触发（阈值 2%）
  const im = new ImageData(100, 1);
  for (let i = 0; i < 100; i++) {
    const v = i === 0 ? 0 : 128;
    im.data[i * 4] = v;
    im.data[i * 4 + 1] = v;
    im.data[i * 4 + 2] = v;
    im.data[i * 4 + 3] = 255;
  }
  const v = histVerdict(histogram(im, 1));
  eq(v.kind, 'ok', '1% 贴边不报警');
}

{
  // 单路基本全占住一端：不是错，但要提一句
  const im = new ImageData(100, 1);
  for (let i = 0; i < 100; i++) {
    const v = i < 95 ? 0 : 200;
    im.data[i * 4] = v;
    im.data[i * 4 + 1] = 128;
    im.data[i * 4 + 2] = 128;
    im.data[i * 4 + 3] = 255;
  }
  const v = histVerdict(histogram(im, 1));
  eq(v.kind, 'info', '单路 95% 贴一端只提示不报警');
  ok(/R 路/.test(v.text), '点出是哪一路');
  ok(/95\.0% 是 0/.test(v.text), '说清占比和是哪一端');
  ok(/遮罩/.test(v.text), '说明当遮罩用时这是正常的');
}

{
  // **这条是实测抓到的假警报**：一张普通的暗部渐变图，R 路有 20% 落在 0，
  // 一开始门槛按 8% 写，结果被判成"像遮罩"。单路 20% 贴 0 在贴图里太常见了。
  const im = new ImageData(256, 1);
  for (let i = 0; i < 256; i++) {
    const o = i * 4;
    im.data[o] = i < 50 ? 0 : Math.round(((i - 50) / 205) * 255);
    im.data[o + 1] = Math.max(0, im.data[o] - 20);
    im.data[o + 2] = Math.min(255, im.data[o] + 20);
    im.data[o + 3] = 255;
  }
  const h = histogram(im, 1);
  ok(h.byCh.r.low > 0.15, `R 路确实有 ${(h.byCh.r.low * 100).toFixed(1)}% 落在 0`);
  const v = histVerdict(h);
  eq(v.kind, 'ok', '普通渐变图不该报警，也不该说它像遮罩');
}

{
  // 门槛正好卡在 90%：89% 不报，90% 报。
  // G/B 故意给成渐变 —— 给成常量的话会先被"这一路没内容"那条接住，测不到单路贴边这条。
  const mk = (zeroCount) => {
    const im = new ImageData(100, 1);
    for (let i = 0; i < 100; i++) {
      im.data[i * 4] = i < zeroCount ? 0 : 200;
      im.data[i * 4 + 1] = Math.round((i / 99) * 255);
      im.data[i * 4 + 2] = Math.round(((99 - i) / 99) * 255);
      im.data[i * 4 + 3] = 255;
    }
    return histVerdict(histogram(im, 1)).kind;
  };
  eq(mk(89), 'ok', '89% 不报');
  eq(mk(90), 'info', '90% 报到（含等号）');
  eq(mk(91), 'info', '91% 报');
}

section('全透明像素不进 RGB 统计');

{
  // **这条是实战测试抓到的误报。** ⑦ 图层页用「diffuse + LM.B 蒙版」合成一张
  // 原神贴图，结果 71,740 个纯黑像素里 71,688 个是全透明的（alpha=0），
  // 不透明的一个都没有 —— 而直方图当时报"暗部有 69.9% 的像素压成了纯黑"。
  // 全透明像素的 RGB 是合成产物，不是图的内容，不能算。
  const im = new ImageData(100, 1);
  for (let i = 0; i < 100; i++) {
    const o = i * 4;
    if (i < 70) {
      // 70 个全透明像素，RGB 一律是 0（合成之后就是这个样）
      im.data[o] = 0; im.data[o+1] = 0; im.data[o+2] = 0; im.data[o+3] = 0;
    } else {
      // 30 个可见像素，亮度铺在 8–250 之间 —— 两端都不碰，
      // 这样才测得到"透明那批没被算成压黑"。碰了 0/255 的话
      // 1/30 = 3.3% 本来就超过 2% 的阈值，报警是对的，测不出想测的东西。
      const v = Math.round(8 + ((i - 70) / 29) * 242);
      im.data[o] = v; im.data[o+1] = v; im.data[o+2] = v; im.data[o+3] = 255;
    }
  }
  const h = histogram(im, 1);
  eq(h.sampled, 100, '扫了 100 个');
  eq(h.visible, 30, '只算 30 个可见的');
  near(h.transparentShare, 0.7, 1e-9, '透明占 70%');
  eq(h.clipLow, 0, '那 70 个全透明的不算"暗部压黑"');
  eq(h.clipHigh, 0, '也不算"高光截白"');
  eq(h.r[0], 0, 'R 直方图里那个 0 是透明像素带进来的，不该出现');
  const v = histVerdict(h);
  ok(v.kind !== 'warn', `不该报警（实得 ${v.kind}：${v.text}）`);
  ok(/全透明/.test(v.text), '要说清透明占大头');
}

{
  // 整张全透明：不能除零，也不能瞎报
  const im = new ImageData(16, 16);
  const h = histogram(im, 1);
  eq(h.visible, 0, '一个可见像素都没有');
  eq(h.mean, 0, '平均亮度给 0');
  eq(h.clipLow, 0, '贴边 0');
  eq(h.flat.length, 0, '没有可见像素就不谈哪一路是空的');
  const v = histVerdict(h);
  eq(v.kind, 'info', '只提示');
  ok(/全透明/.test(v.text), '说清整张都是透明的');
}

{
  // alpha=1 也算可见 —— 半透明贴图的 RGB 是有内容的（这正是修预乘那件事的意义）
  const im = new ImageData(2, 1);
  im.data.set([200, 100, 50, 1, 10, 20, 30, 255]);
  const h = histogram(im, 1);
  eq(h.visible, 2, 'alpha=1 的也算可见');
  eq(h.r[200], 1, '它的 R 进了直方图');
}

section('空图不能崩');

{
  const h = histogram(new ImageData(1, 1), 1);
  eq(h.sampled, 1, '一个像素也能数');
  const v = histVerdict(h, 0.02);
  ok(v.text.length > 0, '有话说');
}

section('SVG 路径');

{
  const h = new Uint32Array(256);
  h[0] = 100;
  const d = histPath(h, 100, 50);
  ok(d.startsWith('M 0 50'), '从底边左侧起笔');
  ok(d.trimEnd().endsWith('Z'), '闭合成面');
  ok(!/NaN|Infinity/.test(d), '没有 NaN');
  // 第 0 格是峰值 → y 应该是 0（顶到上边）
  ok(/L 0\.00 0\.00/.test(d), '峰值那根顶到上边');

  const flat = new Uint32Array(256);
  const d2 = histPath(flat, 100, 50);
  ok(!/NaN/.test(d2), '全 0 的直方图不产生 NaN');
}

section('大图跳采样要快');

{
  // 4096² 按步长 4 —— 大致等于一次交互预览的规模，跑得完就行
  const im = solid(2048, 2048, 90, 120, 150);
  const t0 = Date.now();
  const h = histogram(im, 4);
  const ms = Date.now() - t0;
  ok(h.sampled === 2048 * 2048 / 4, `按步长 4 数了 ${h.sampled} 个`);
  ok(ms < 500, `2048² 跳采样 ${ms}ms，不该卡住交互`);
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
