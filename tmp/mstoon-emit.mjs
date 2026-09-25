/**
 * ④ msToon 出效果图。
 *
 * 跑法：node tmp/mstoon-emit.mjs
 * 产出：实战测试用例_效果\④msToon\ 下的对比图 + 统计
 *
 * 走的是 src/lib/modules/mstoon/ops.ts 里的真函数（界面预览和导出走同一条路），
 * 不是另写的复现。
 *
 * 说清楚这里**没有**什么：官方 msToon 包里只有产物、没有源图，所以拿不到
 * 「源 → 控制图」的配对。下面这些图是"按界面参数算出来的"，跟官方那四张
 * 只有配比上的对照关系，不是映射成立。
 */
import fs from 'node:fs';

// ops.ts 里 import '$lib/img'，别名得先挂上
await import('./register-loader.mjs');

const ops = await import('../src/lib/modules/mstoon/ops.ts');
const { encodePng, decodePng } = await import('./png.mjs');

const CORPUS = String.raw`E:\deepseek-harness\mmd集成工具\实战测试用例\贴图\绝区零\薇薇安\vivian-banshee-fluttering-violet\Textures`;
const OUT = String.raw`E:\deepseek-harness\mmd集成工具\实战测试用例\测试效果\④msToon`;
const BODY = `${CORPUS}\\Vivian_Body_1_D.png`;
const FACE = `${CORPUS}\\Vivian_Face_D.png`;

fs.mkdirSync(OUT, { recursive: true });

/** 语料里的 PNG 解成 RGBA */
function load(p) {
  const { w, h, data } = decodePng(fs.readFileSync(p));
  if (typeof ImageData === 'function') return new ImageData(data, w, h);
  return { width: w, height: h, data };
}

/* ---------------- 统计：跟真控制图同一套口径 ---------------- */
function stat(plane) {
  const uniq = new Map();
  for (let i = 0; i < plane.length; i++) uniq.set(plane[i], (uniq.get(plane[i]) || 0) + 1);
  const n = plane.length;
  const top = [...uniq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  let onGrid = 0;
  for (let i = 0; i < n; i++) {
    const g = (plane[i] / 255) * 20;
    if (Math.abs(g - Math.round(g)) < 0.08) onGrid++;
  }
  const mean = [...uniq.entries()].reduce((s, [v, c]) => s + v * c, 0) / n / 255;
  return {
    uniq: uniq.size,
    const: uniq.size === 1,
    mean,
    grid: onGrid / n,
    top: top.map(([v, c]) => `${(v / 255).toFixed(2)}:${((c / n) * 100).toFixed(1)}%`).join(' ')
  };
}
const chans = (img) => ['r', 'g', 'b', 'a'].map((_, i) => {
  const arr = new Uint8ClampedArray(img.width * img.height);
  for (let p = 0; p < arr.length; p++) arr[p] = img.data[p * 4 + i];
  return arr;
});

/* ---------------- 拼版 ---------------- */
const CELL = 256;
const GAP = 6;
const BG = [18, 18, 20, 255];

function fit(img) {
  if (img.width === CELL && img.height === CELL) return img;
  const k = CELL / Math.max(img.width, img.height);
  const w = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const out = { width: CELL, height: CELL, data: new Uint8ClampedArray(CELL * CELL * 4) };
  for (let i = 0; i < CELL * CELL; i++) out.data.set(BG, i * 4);
  const ox = ((CELL - w) / 2) | 0;
  const oy = ((CELL - h) / 2) | 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x / k)));
      const sy = Math.min(img.height - 1, Math.floor((y / k)));
      const s = (sy * img.width + sx) * 4;
      const d = ((oy + y) * CELL + ox + x) * 4;
      for (let c = 0; c < 4; c++) out.data[d + c] = img.data[s + c];
    }
  }
  return out;
}

/** 一行：源图 + 若干产出，超出宽度就换行 */
function sheet(cols, rows) {
  const w = cols * CELL + (cols + 1) * GAP;
  const h = rows * CELL + (rows + 1) * GAP;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(BG, i * 4);
  return {
    w,
    h,
    data,
    put(img, col, row) {
      const t = fit(img);
      const ox = GAP + col * (CELL + GAP);
      const oy = GAP + row * (CELL + GAP);
      for (let y = 0; y < CELL; y++) {
        const s = y * CELL * 4;
        const d = ((oy + y) * w + ox) * 4;
        data.set(t.data.subarray(s, s + CELL * 4), d);
      }
    }
  };
}

/** 产出图拆成四个通道的灰度图，方便逐通道看 */
function tiles(img) {
  const arrs = chans(img);
  return arrs.map((a) => {
    const d = new Uint8ClampedArray(a.length * 4);
    for (let i = 0; i < a.length; i++) {
      d[i * 4] = a[i];
      d[i * 4 + 1] = a[i];
      d[i * 4 + 2] = a[i];
      d[i * 4 + 3] = 255;
    }
    return { width: img.width, height: img.height, data: d };
  });
}

/* ---------------- 四张图的参数 ---------------- */
const SRC_CH = (r, g, b) => ({
  r: { ...ops.blankChain(0), mode: 'source', ch: r },
  g: { ...ops.blankChain(0), mode: 'source', ch: g },
  b: { ...ops.blankChain(0), mode: 'source', ch: b },
  a: { ...ops.blankChain(1.0), mode: 'const' }
});

const preset = ops.LADDER_PRESETS[0];
const presetSpec = (which) => {
  const out = {};
  for (const k of ['r', 'g', 'b', 'a']) {
    const lad = preset.per[k.toUpperCase()];
    out[k] = { ...ops.blankChain(lad.def), mode: 'ladder', ladder: { def: lad.def, rungs: lad.rungs } };
  }
  return out;
};
void presetSpec;

const report = [];
function emit(panel, variant, src, out, extraTiles = []) {
  const row = [src, out, ...tiles(out)];
  report.push({ panel, variant, w: out.width, h: out.height, ch: chans(out).map(stat) });
  return row;
}

const body = load(BODY);
const face = load(FACE);
console.log(`源图：Body ${body.width}×${body.height}   Face ${face.width}×${face.height}`);

const rows = {
  shadowrate: [],
  sublight: [],
  edge: [],
  facesdf: []
};

// ShadowRate：默认（全是空 ladder，出来是平的）/ 取源通道 / 套预设
rows.shadowrate.push(emit('ShadowRate', '默认参数', body, ops.buildControlMaps(body, {
  r: ops.blankChain(0.6), g: ops.blankChain(1.0), b: ops.blankChain(0.3), a: ops.blankChain(1.0)
}, true)));
rows.shadowrate.push(emit('ShadowRate', '取源通道 RGB', body, ops.buildControlMaps(body, SRC_CH('r', 'g', 'b'), true)));
rows.shadowrate.push(emit('ShadowRate', '套星铁预设', body, ops.buildControlMaps(body, {
  r: { ...ops.blankChain(preset.per.R.def), mode: 'ladder', ladder: { def: preset.per.R.def, rungs: preset.per.R.rungs } },
  g: { ...ops.blankChain(preset.per.G.def), mode: 'ladder', ladder: { def: preset.per.G.def, rungs: preset.per.G.rungs } },
  b: { ...ops.blankChain(preset.per.B.def), mode: 'ladder', ladder: { def: preset.per.B.def, rungs: preset.per.B.rungs } },
  a: { ...ops.blankChain(preset.per.A.def), mode: 'ladder', ladder: { def: preset.per.A.def, rungs: preset.per.A.rungs } }
}, true)));

// SubLightRate：默认 / 取源通道
rows.sublight.push(emit('SubLightRate', '默认参数', body, ops.buildControlMaps(body, {
  r: ops.blankChain(0.5), g: ops.blankChain(0.5), b: ops.blankChain(0.0), a: ops.blankChain(1.0)
}, true)));
rows.sublight.push(emit('SubLightRate', '取源通道 RGB', body, ops.buildControlMaps(body, SRC_CH('g', 'r', 'b'), true)));

// EdgeRate：硬阈值 / 软过渡（各带一张叠在源图上的对照）
for (const [tag, soft] of [['硬阈值', false], ['软过渡', true]]) {
  const { out, strength } = ops.buildEdge(body, {
    threshold: 60, soft, softWidth: 40, denoise: true, normalize: false, toGB: false
  });
  const ov = new Uint8ClampedArray(body.data);
  let n = 0;
  for (let i = 0; i < strength.length; i++) {
    if (strength[i] > 127) {
      ov[i * 4] = 255;
      ov[i * 4 + 1] = 40;
      ov[i * 4 + 2] = 40;
      n++;
    }
  }
  const overlay = { width: body.width, height: body.height, data: ov };
  rows.edge.push(emit('EdgeRate', tag, body, out).concat([overlay]));
  report.at(-1).inkRatio = n / strength.length;
}

// FaceSDF：脸部贴图走阈值 → 距离场
{
  const { out, mask } = ops.buildSdf(face, { threshold: 110, maxDist: 24, invert: false, toA: true });
  const maskImg = {
    width: face.width,
    height: face.height,
    data: (() => {
      const d = new Uint8ClampedArray(mask.length * 4);
      for (let i = 0; i < mask.length; i++) {
        d[i * 4] = mask[i];
        d[i * 4 + 1] = mask[i];
        d[i * 4 + 2] = mask[i];
        d[i * 4 + 3] = 255;
      }
      return d;
    })()
  };
  rows.facesdf.push([face, maskImg, out, ...tiles(out)]);
  report.push({ panel: 'FaceSDF', variant: '阈值 110 / 距离 24', w: out.width, h: out.height, ch: chans(out).map(stat) });
}

/* ---------------- 落盘 ---------------- */
const COLS = 6;
for (const [panel, list] of Object.entries(rows)) {
  if (!list.length) continue;
  const s = sheet(COLS, list.length);
  list.forEach((row, r) => row.slice(0, COLS).forEach((img, c) => s.put(img, c, r)));
  const file = `${OUT}\\④msToon_${panel}.png`;
  fs.writeFileSync(file, encodePng(s.w, s.h, s.data));
  console.log(`写了 ${file}  ${s.w}×${s.h}`);
}

/* ---------------- 统计 ---------------- */
const lines = [];
for (const r of report) {
  lines.push(`[${r.panel} · ${r.variant}]  ${r.w}×${r.h}`);
  r.ch.forEach((s, i) => {
    lines.push(
      `  ${'RGBA'[i]}: 唯一值 ${String(s.uniq).padStart(4)}  恒定=${s.const ? '是' : '否'}` +
        `  均值 ${s.mean.toFixed(3)}  0.05 网格上 ${(s.grid * 100).toFixed(1)}%  主要档位 ${s.top}`
    );
  });
  if (r.inkRatio !== undefined) lines.push(`  描边占比 ${(r.inkRatio * 100).toFixed(2)}%`);
}
const text = lines.join('\n');
fs.writeFileSync(`${OUT}\\_stats.txt`, text, 'utf8');
console.log('\n' + text);
