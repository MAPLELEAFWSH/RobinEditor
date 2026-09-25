/**
 * ⑦ 通道处理的实战处理测试。
 *
 * 跑法：node tmp/channels-corpus.mjs
 *
 * 拿 实战测试用例\贴图\ 里的**真 PNG**跑一遍真代码（不是合成图）：
 *   · 分离 → 用四个通道各自的灰度图**再合并回来**，逐像素比 —— 验证"互转无损"
 *   · 自由 swizzle 走一个三循环置换，再用逆置换转回来 —— 同样比逐像素
 *   · 尺寸分布、耗时、读不出来的文件单独列
 *
 * 合并和 swizzle 都走 `ops.ts` 的 `applyPlan`，分离走 `img.ts` 的 `extractChannel`，
 * 中间那一步用 `planeToGray` 造灰度图 —— 就是界面上分离/合并两个面板的同一条路。
 *
 * 读图用的是 tmp/png.mjs 的最小解码器（只吃 8bit 非隔行的真彩/真彩+alpha/灰度）。
 * 读不出来的**不算工具的问题** —— 应用里读图走 Rust 的 image crate，能认的比这个多。
 * 所以这里读不出来的会单独列成"harness 读不了"，不混进结论。
 */
import fs from 'node:fs';
import path from 'node:path';

await import('./register-loader.mjs');

const { decodePng, encodePng } = await import('./png.mjs');
const { extractChannel, blankImageData } = await import('../src/lib/img.ts');
const { applyPlan, makeChanPlan, planeToGray } = await import(
  '../src/lib/modules/channels/ops.ts'
);

const ROOT = String.raw`E:\deepseek-harness\mmd集成工具\实战测试用例\贴图`;
const OUT = String.raw`E:\deepseek-harness\mmd集成工具\实战测试用例\测试效果\⑦通道处理`;
fs.mkdirSync(OUT, { recursive: true });

/* ---------------- 递归收 PNG ---------------- */
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.png$/i.test(e.name)) acc.push(p);
  }
  return acc;
}
const files = walk(ROOT).sort();
console.log(`语料：${files.length} 张 PNG  ${path.dirname(ROOT)}`);

/* ---------------- 计划：从同一张源图按给定通道顺序拼（swizzle 走的） ---------------- */
function planSwizzle(from) {
  return {
    r: { ...makeChanPlan('R'), slot: 'src', ch: from.r },
    g: { ...makeChanPlan('G'), slot: 'src', ch: from.g },
    b: { ...makeChanPlan('B'), slot: 'src', ch: from.b },
    a: { ...makeChanPlan('A'), slot: 'src', ch: from.a }
  };
}

const CH = ['r', 'g', 'b', 'a'];
/** 逐像素最大差 */
function maxDiff(a, b) {
  if (a.width !== b.width || a.height !== b.height) return -1;
  let m = 0;
  for (let i = 0; i < a.data.length; i++) {
    const d = Math.abs(a.data[i] - b.data[i]);
    if (d > m) m = d;
  }
  return m;
}

const rows = [];
const undecodable = [];
let okSplit = 0;
let okSwizzle = 0;
let totalPx = 0;
const t0 = Date.now();
let n = 0;

for (const f of files) {
  const rel = path.relative(ROOT, f);
  n++;
  let img;
  const tImg = Date.now();
  try {
    const d = decodePng(fs.readFileSync(f));
    img = { width: d.w, height: d.h, data: d.data };
  } catch (e) {
    undecodable.push({ rel, why: e.message });
    continue;
  }
  const msDecode = Date.now() - tImg;
  const w = img.width;
  const h = img.height;
  totalPx += w * h;

  // 1. 分离 → 合并回来
  const tA = Date.now();
  const planes = CH.map((c) => extractChannel(img, c));
  const pool = new Map([
    ['p_r', planeToGray(planes[0], w, h)],
    ['p_g', planeToGray(planes[1], w, h)],
    ['p_b', planeToGray(planes[2], w, h)],
    ['p_a', planeToGray(planes[3], w, h)]
  ]);
  const back = applyPlan(w, h, {
    r: { ...makeChanPlan('R'), slot: 'p_r', ch: 'r' },
    g: { ...makeChanPlan('G'), slot: 'p_g', ch: 'r' },
    b: { ...makeChanPlan('B'), slot: 'p_b', ch: 'r' },
    a: { ...makeChanPlan('A'), slot: 'p_a', ch: 'r' }
  }, pool);
  const dSplit = maxDiff(img, back);
  if (dSplit === 0) okSplit++;
  const msSplit = Date.now() - tA;

  // 2. swizzle 三循环 → 逆置换
  const tB = Date.now();
  const src = new Map([['src', img]]);
  const fwd = applyPlan(w, h, planSwizzle({ r: 'b', g: 'r', b: 'g', a: 'a' }), src);
  const fwdMap = new Map([['src', fwd]]);
  const backSw = applyPlan(w, h, planSwizzle({ r: 'g', g: 'b', b: 'r', a: 'a' }), fwdMap);
  const dSw = maxDiff(img, backSw);
  if (dSw === 0) okSwizzle++;
  const msSw = Date.now() - tB;

  rows.push({ rel, w, h, dSplit, dSw, msDecode, msSplit, msSw, f });
  if (n % 50 === 0) console.log(`  … 跑过 ${n}/${files.length}`);
}

const msTotal = Date.now() - t0;

/* ---------------- 汇总 ---------------- */
const biggest = rows.slice().sort((a, b) => b.w * b.h - a.w * a.h);
const sizes = new Map();
for (const r of rows) {
  const k = `${r.w}×${r.h}`;
  sizes.set(k, (sizes.get(k) || 0) + 1);
}
const sizeTop = [...sizes.entries()].sort((a, b) => b[1] - a[1]);

const lines = [];
lines.push(`读了 ${rows.length} 张，读不出来 ${undecodable.length} 张，共 ${(totalPx / 1e6).toFixed(1)} 兆像素`);
lines.push(`尺寸种类 ${sizes.size} 种，最多的是 ${sizeTop.slice(0, 6).map(([k, c]) => `${k}×${c}`).join('  ')}`);
if (biggest[0]) {
  lines.push(`最大一张 ${biggest[0].w}×${biggest[0].h}  ${biggest[0].rel}`);
}
lines.push('');
lines.push(`分离 → 合并回来：逐像素完全相同 ${okSplit}/${rows.length}`);
lines.push(`swizzle 置换 → 逆置换：逐像素完全相同 ${okSwizzle}/${rows.length}`);
const notSplit = rows.filter((r) => r.dSplit !== 0);
const notSw = rows.filter((r) => r.dSw !== 0);
if (notSplit.length) {
  lines.push(`  没对上的（分离）${notSplit.length} 张，最大差 ${Math.max(...notSplit.map((r) => r.dSplit))}`);
  for (const r of notSplit.slice(0, 10)) lines.push(`    ${r.rel}  maxDiff ${r.dSplit}`);
}
if (notSw.length) {
  lines.push(`  没对上的（swizzle）${notSw.length} 张，最大差 ${Math.max(...notSw.map((r) => r.dSw))}`);
  for (const r of notSw.slice(0, 10)) lines.push(`    ${r.rel}  maxDiff ${r.dSw}`);
}
lines.push('');
const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
lines.push(`耗时合计 ${(msTotal / 1000).toFixed(1)}s`);
lines.push(`  解码 ${(sum('msDecode') / 1000).toFixed(1)}s   分离+合并 ${(sum('msSplit') / 1000).toFixed(1)}s   两次 swizzle ${(sum('msSw') / 1000).toFixed(1)}s`);
lines.push(`  单张中位：解码 ${median(rows.map((r) => r.msDecode))}ms  分离+合并 ${median(rows.map((r) => r.msSplit))}ms`);
if (undecodable.length) {
  lines.push('');
  lines.push(`读不出来（harness 的 PNG 解码器只吃 8bit 非隔行真彩/灰度）：`);
  for (const u of undecodable.slice(0, 20)) lines.push(`  ${u.rel}  —— ${u.why}`);
}

function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
}

const report = lines.join('\n');
console.log('\n' + report);
fs.writeFileSync(`${OUT}\\_逐文件.txt`, ['rel\tw\th\t分离maxDiff\tswizzleMaxDiff\t解码ms\t分离ms\tswizzle_ms']
  .concat(rows.map((r) => [r.rel, r.w, r.h, r.dSplit, r.dSw, r.msDecode, r.msSplit, r.msSw].join('\t')))
  .join('\n'), 'utf8');
fs.writeFileSync(`${OUT}\\_汇总.txt`, report, 'utf8');

/* ---------------- 对比图：挑有代表性的几张 ---------------- */
const picks = [];
const seenSize = new Set();
for (const r of biggest.concat(rows)) {
  const k = `${r.w}×${r.h}`;
  if (seenSize.has(k)) continue;
  seenSize.add(k);
  picks.push(r);
  if (picks.length >= 6) break;
}

const CELL = 256;
const GAP = 6;
function fit(im) {
  const k = CELL / Math.max(im.width, im.height);
  const w = Math.max(1, Math.round(im.width * k));
  const h = Math.max(1, Math.round(im.height * k));
  const out = { width: CELL, height: CELL, data: new Uint8ClampedArray(CELL * CELL * 4).fill(24) };
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
  const ox = ((CELL - w) / 2) | 0;
  const oy = ((CELL - h) / 2) | 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (Math.min(im.height - 1, (y / k) | 0) * im.width + Math.min(im.width - 1, (x / k) | 0)) * 4;
      const d = ((oy + y) * CELL + ox + x) * 4;
      for (let c = 0; c < 4; c++) out.data[d + c] = im.data[s + c];
    }
  }
  return out;
}
function grayTile(plane, w, h) {
  const g = planeToGray(plane, w, h);
  return g;
}

const COLS = 7;
const W = COLS * CELL + (COLS + 1) * GAP;
const H = picks.length * CELL + (picks.length + 1) * GAP;
const sheet = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) {
  sheet[i * 4] = 24;
  sheet[i * 4 + 1] = 24;
  sheet[i * 4 + 2] = 26;
  sheet[i * 4 + 3] = 255;
}
function put(im, col, row) {
  const t = fit(im);
  const ox = GAP + col * (CELL + GAP);
  const oy = GAP + row * (CELL + GAP);
  for (let y = 0; y < CELL; y++) {
    sheet.set(t.data.subarray(y * CELL * 4, (y + 1) * CELL * 4), ((oy + y) * W + ox) * 4);
  }
}

picks.forEach((r, row) => {
  const img = { width: r.w, height: r.h, data: decodePng(fs.readFileSync(r.f)).data };
  const planes = CH.map((c) => extractChannel(img, c));
  const pool = new Map(CH.map((c, i) => [`p_${c}`, grayTile(planes[i], r.w, r.h)]));
  const back = applyPlan(r.w, r.h, {
    r: { ...makeChanPlan('R'), slot: 'p_r', ch: 'r' },
    g: { ...makeChanPlan('G'), slot: 'p_g', ch: 'r' },
    b: { ...makeChanPlan('B'), slot: 'p_b', ch: 'r' },
    a: { ...makeChanPlan('A'), slot: 'p_a', ch: 'r' }
  }, pool);
  // 差 ×20
  const diff = blankImageData(r.w, r.h);
  for (let i = 0; i < img.data.length; i++) {
    diff.data[i] = Math.min(255, Math.abs(img.data[i] - back.data[i]) * 20);
  }
  put(img, 0, row);
  put(back, 1, row);
  put(diff, 2, row);
  put(grayTile(planes[0], r.w, r.h), 3, row);
  put(grayTile(planes[1], r.w, r.h), 4, row);
  put(grayTile(planes[2], r.w, r.h), 5, row);
  put(grayTile(planes[3], r.w, r.h), 6, row);
  console.log(`对比图第 ${row} 行：${r.rel}  ${r.w}×${r.h}`);
});

fs.writeFileSync(`${OUT}\\⑦通道处理_对比.png`, encodePng(W, H, sheet));
console.log(`写了 ${OUT}\\⑦通道处理_对比.png  ${W}×${H}`);
console.log('列：源 | 合并回来 | 差×20 | R | G | B | A');
