/**
 * 应用图标体检：任务栏上为什么糊。
 *
 * 直接量三件事：
 *   1. `icon.ico` 里每一档的**真实像素尺寸**（目录头写 256，里面塞的可能只是放大的 128）
 *   2. 每一档的**清晰度**（拉普拉斯方差，按像素数归一化后才有可比性）
 *   3. 大档 vs 小档的细节比：如果 256 那档的细节跟 128 放大两倍差不多，
 *      说明它是"假分辨率"，Windows 拿到 256 也没用
 *
 * 用法：node tools/icon-report.mjs [icons 目录]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** 最小 PNG 解码：8 位、非隔行、RGB/RGBA。够看图标。 */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8;
  let w = 0;
  let h = 0;
  let depth = 0;
  let color = 0;
  let interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      color = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) return null;
  const ch = color === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = px.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      const v = line[x];
      cur[x] = filter === 0 ? v : filter === 1 ? (v + a) & 255 : filter === 2 ? (v + b) & 255 : filter === 3 ? (v + ((a + b) >> 1)) & 255 : (v + paeth(a, b, c)) & 255;
    }
  }
  return { w, h, ch, px };
}
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** 拉普拉斯方差：边缘能量，越高越锐。 */
export function sharpness(img) {
  const { w, h, ch, px } = img;
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * ch;
    g[i] = (0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) / 255;
  }
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      sum += v;
      sum2 += v * v;
      n++;
    }
  }
  const mean = n ? sum / n : 0;
  return n ? sum2 / n - mean * mean : 0;
}

/** 双线性缩放到指定边长（用来做"放大两倍还清不清晰"的对照）。 */
export function resize(img, size) {
  const { w, h, ch, px } = img;
  const out = Buffer.alloc(size * size * ch);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = (x * (w - 1)) / (size - 1);
      const sy = (y * (h - 1)) / (size - 1);
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, w - 1);
      const y1 = Math.min(y0 + 1, h - 1);
      const fx = sx - x0;
      const fy = sy - y0;
      for (let c = 0; c < ch; c++) {
        const v00 = px[(y0 * w + x0) * ch + c];
        const v10 = px[(y0 * w + x1) * ch + c];
        const v01 = px[(y1 * w + x0) * ch + c];
        const v11 = px[(y1 * w + x1) * ch + c];
        const top = v00 * (1 - fx) + v10 * fx;
        const bot = v01 * (1 - fx) + v11 * fx;
        out[(y * size + x) * ch + c] = Math.round(top * (1 - fy) + bot * fy);
      }
    }
  }
  return { w: size, h: size, ch, px: out };
}

/** 从 .ico 里把每一档抠出来（只认 PNG 压缩那种）。 */
export function icoEntries(buf) {
  const n = buf.readUInt16LE(4);
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = 6 + i * 16;
    const w = buf[o] === 0 ? 256 : buf[o];
    const h = buf[o + 1] === 0 ? 256 : buf[o + 1];
    const size = buf.readUInt32LE(o + 8);
    const off = buf.readUInt32LE(o + 12);
    const data = buf.subarray(off, off + size);
    out.push({ 头里写的: `${w}x${h}`, png: data.readUInt32BE(0) === 0x89504e47, data });
  }
  return out;
}

/* 被别的工具 import 时不要跑这段 —— make-app-icon.mjs 要复用上面的解码/清晰度函数。
   这是踩过的坑：那边 `--write` 被这边当成目录名，直接 scandir 报 ENOENT。 */
const 是被直接运行 = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/icon-report.mjs');
if (是被直接运行) {
  const dir = process.argv[2] ?? 'src-tauri/icons';
  console.log(`== ${dir} ==\n`);

  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.png')) continue;
    const img = decodePng(readFileSync(`${dir}/${f}`));
    if (!img) {
      console.log(`${f.padEnd(22)} 解不了（可能是 16 位或隔行）`);
      continue;
    }
    console.log(`${f.padEnd(22)} ${String(img.w).padStart(4)}x${String(img.h).padEnd(4)} 清晰度 ${sharpness(img).toFixed(5)}`);
  }

  const ico = readFileSync(`${dir}/icon.ico`);
  const entries = icoEntries(ico);
  console.log(`\n== icon.ico（${entries.length} 档）==`);
  const imgs = [];
  for (const e of entries) {
    if (!e.png) {
      console.log(`  ${e.头里写的.padEnd(8)} 不是 PNG 压缩（BMP 那种），跳过`);
      continue;
    }
    const img = decodePng(e.data);
    if (!img) {
      console.log(`  ${e.头里写的.padEnd(8)} 解不了`);
      continue;
    }
    imgs.push(img);
    console.log(`  ${e.头里写的.padEnd(8)} 实际 ${String(img.w).padStart(4)}x${String(img.h).padEnd(4)} 清晰度 ${sharpness(img).toFixed(5)}`);
  }

  /* 关键那条：256 那档到底是真细节，还是 128 放大的 */
  const big = imgs.reduce((a, b) => (b.w > a.w ? b : a));
  const half = imgs.filter((i) => i.w === big.w / 2)[0];
  if (half) {
    const up = resize(half, big.w);
    console.log(`\n把 ${half.w}x${half.h} 双线性放大到 ${big.w}x${big.h} 后的清晰度：${sharpness(up).toFixed(5)}`);
    console.log(`而 ${big.w} 那档自己的清晰度：${sharpness(big).toFixed(5)}`);
    const ratio = sharpness(big) / Math.max(sharpness(up), 1e-9);
    console.log(
      ratio < 1.15
        ? '→ 比值 ' + ratio.toFixed(2) + '：**这两档的细节几乎一样**，大档没有真信息（是放大的）'
        : '→ 比值 ' + ratio.toFixed(2) + '：大档确实带更多细节'
    );
  }
}
