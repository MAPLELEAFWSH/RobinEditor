/**
 * 应用图标：给任务栏专门做一份"看得清的小图"。
 *
 * 为什么需要这个（量的，不是猜的）：
 *   · 屏幕是 **150% 缩放**（LogPixels=144）→ 任务栏要 36px、标题栏 24px、Alt-Tab 48px
 *   · exe 里嵌的运行时窗口图标是 `128x128@2x.png`（**256² 整张插画**，实测 exe 里有它的字节）
 *     → Windows 一步把它缩到 36px，图案细节（发饰、项链、棕榈叶）全糊成一片
 *   · 图标本身细节太密，"换个尺寸"救不了：16~48px 上必须**只留主体**
 *
 * 做法：
 *   1. 在 512² 原图上按**显著性**（局部反差 × 饱和度）找一块主体正方形
 *   2. 小尺寸（≤48）用这块裁切渲染，大尺寸（≥64）用整张原图
 *   3. 重采样用 **Lanczos3**（一次到位的降采样，不要分步缩放）
 *   4. `icon.ico` 补上 Windows 在 100/125/150/175/200% 下真正会要的档位
 *      （16/20/24/30/32/36/40/48/60/64/96/128/256），别只给 16/32/48/256
 *   5. 另外出一张 `icon-taskbar.png`（48²，裁切版）给窗口图标用 ——
 *      24/36/48 三个消费方全是**降采样**，不会再有放大糊边
 *
 * 用法：node tools/make-app-icon.mjs              # 只看报告，不动文件
 *      node tools/make-app-icon.mjs --write        # 真写文件
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { decodePng, sharpness } from './icon-report.mjs';

const SRC = 'src-tauri/icons/icon.png';
const WRITE = process.argv.includes('--write');
const SMALL_MAX = 48; // ≤ 这个尺寸用裁切版
const 全档位 = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 96, 128, 256];

/* ---------------- 重采样：Lanczos3（可分离） ---------------- */
function lanczos(x) {
  if (x === 0) return 1;
  const a = Math.abs(x);
  if (a >= 3) return 0;
  const px = Math.PI * a;
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
}

/** src(H,W) → size×size。整幅一次算，不做多步缩放。 */
function resample(src, size) {
  const { w, h, ch, px } = src;
  const out = Buffer.alloc(size * size * ch);
  const scale = size / w;
  const support = 3 / scale; // 缩放后核宽
  const tmp = new Float32Array(size * h * ch);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < size; x++) {
      const cx = (x + 0.5) / scale - 0.5;
      const i0 = Math.max(0, Math.ceil(cx - support));
      const i1 = Math.min(w - 1, Math.floor(cx + support));
      let sum = 0;
      const acc = [0, 0, 0, 0];
      for (let i = i0; i <= i1; i++) {
        const wt = lanczos((i - cx) * scale);
        if (wt === 0) continue;
        sum += wt;
        for (let c = 0; c < ch; c++) acc[c] += px[(y * w + i) * ch + c] * wt;
      }
      for (let c = 0; c < ch; c++) tmp[(y * size + x) * ch + c] = sum ? acc[c] / sum : 0;
    }
  }
  for (let y = 0; y < size; y++) {
    const cy = (y + 0.5) / scale - 0.5;
    const j0 = Math.max(0, Math.ceil(cy - support));
    const j1 = Math.min(h - 1, Math.floor(cy + support));
    for (let x = 0; x < size; x++) {
      let sum = 0;
      const acc = [0, 0, 0, 0];
      for (let j = j0; j <= j1; j++) {
        const wt = lanczos((j - cy) * scale);
        if (wt === 0) continue;
        sum += wt;
        for (let c = 0; c < ch; c++) acc[c] += tmp[(j * size + x) * ch + c] * wt;
      }
      for (let c = 0; c < ch; c++) {
        const v = sum ? acc[c] / sum : 0;
        out[(y * size + x) * ch + c] = Math.max(0, Math.min(255, Math.round(v)));
      }
    }
  }
  return { w: size, h: size, ch, px: out };
}

/* ---------------- 显著性：局部反差 × 饱和度 ---------------- */
function saliencyMap(img, block = 8) {
  const { w, h, ch, px } = img;
  const sat = new Float32Array(w * h);
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * ch;
    const r = px[o] / 255;
    const g = px[o + 1] / 255;
    const b = px[o + 2] / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    sat[i] = mx > 1e-6 ? (mx - mn) / mx : 0;
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  /* 块内亮度标准差（"这块有没有东西"）+ 平均饱和度（"这块是不是主体"） */
  const bw = Math.max(1, Math.floor(w / block));
  const out = new Float64Array(bw * bw);
  for (let by = 0; by < bw; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let n = 0;
      let s1 = 0;
      let s2 = 0;
      let st = 0;
      for (let y = by * block; y < Math.min((by + 1) * block, h); y++) {
        for (let x = bx * block; x < Math.min((bx + 1) * block, w); x++) {
          const i = y * w + x;
          s1 += lum[i];
          s2 += lum[i] * lum[i];
          st += sat[i];
          n++;
        }
      }
      const mean = n ? s1 / n : 0;
      const varr = n ? Math.max(s2 / n - mean * mean, 0) : 0;
      out[by * bw + bx] = Math.sqrt(varr) * (0.4 + (n ? st / n : 0));
    }
  }
  return { map: out, bw, block };
}

/** 找一块边长 size 的正方形，让里面的显著性之和最大 */
function bestCrop(img, size) {
  const { map, bw, block } = saliencyMap(img);
  const r = Math.max(1, Math.round(size / block));
  let best = { x: 0, y: 0, score: -1 };
  for (let by = 0; by + r <= bw; by++) {
    for (let bx = 0; bx + r <= bw; bx++) {
      let s = 0;
      for (let y = by; y < by + r; y++) for (let x = bx; x < bx + r; x++) s += map[y * bw + x];
      if (s > best.score) best = { x: bx * block, y: by * block, score: s };
    }
  }
  return best;
}

/** 裁一块正方形（越界夹边） */
function crop(img, x, y, size) {
  const out = Buffer.alloc(size * size * img.ch);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const sx = Math.min(img.w - 1, Math.max(0, x + i));
      const sy = Math.min(img.h - 1, Math.max(0, y + j));
      for (let c = 0; c < img.ch; c++) out[(j * size + i) * img.ch + c] = img.px[(sy * img.w + sx) * img.ch + c];
    }
  }
  return { w: size, h: size, ch: img.ch, px: out };
}

/* ---------------- 编码 ---------------- */
export function encodePng(img) {
  const { w, h, ch, px } = img;
  const raw = Buffer.alloc(h * (1 + w * ch));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * ch)] = 0; // 不做行过滤：图标小，压不压无所谓，简单可靠
    px.copy(raw, y * (1 + w * ch) + 1, y * w * ch, (y + 1) * w * ch);
  }
  const chunks = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = ch === 4 ? 6 : 2;
  chunks.push(chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/** 拼 .ico（各档都用 PNG 压） */
export function buildIco(entries) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const dir = [];
  const blobs = [];
  for (const e of entries) {
    const d = Buffer.alloc(16);
    d[0] = e.size >= 256 ? 0 : e.size;
    d[1] = e.size >= 256 ? 0 : e.size;
    d[2] = 0;
    d[3] = 0;
    d.writeUInt16LE(1, 4);
    d.writeUInt16LE(32, 6);
    d.writeUInt32LE(e.png.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += e.png.length;
    dir.push(d);
    blobs.push(e.png);
  }
  return Buffer.concat([head, ...dir, ...blobs]);
}

/* ---------------- 跑 ---------------- */
const art = decodePng(readFileSync(SRC));
if (!art) throw new Error(`${SRC} 解不了（要 8 位非隔行的 PNG）`);
console.log(`原图 ${art.w}x${art.h}，清晰度 ${sharpness(art).toFixed(5)}`);

const cropSize = Math.round(art.w * 0.62);
const box = bestCrop(art, cropSize);
const cut = crop(art, box.x, box.y, cropSize);
console.log(`裁切：${cropSize}² 取在 (${box.x}, ${box.y})`);
console.log(`裁切块清晰度 ${sharpness(cut).toFixed(5)}（原图 ${sharpness(art).toFixed(5)}）\n`);

console.log('档位   用哪张      清晰度      字节');
const entries = [];
for (const size of 全档位) {
  const src = size <= SMALL_MAX ? cut : art;
  const img = resample(src, size);
  const png = encodePng(img);
  entries.push({ size, png });
  console.log(`${String(size).padStart(4)}   ${size <= SMALL_MAX ? '裁切版' : '整张  '}   ${sharpness(img).toFixed(5)}   ${String(png.length).padStart(6)}`);
}

const ico = buildIco(entries);
console.log(`\nicon.ico 合计 ${(ico.length / 1024).toFixed(0)} KB，${entries.length} 档`);

/* 任务栏专用：48² 裁切版。24/36/48 三个消费方全是降采样 */
const taskbarImg = resample(cut, 48);
const taskbar = encodePng(taskbarImg);

/* 预览图：各档放大 6 倍用最近邻摆一排，方便肉眼看糊不糊 */
const preview = Buffer.alloc(6 * 64 * 6 * (全档位.length * 64 + 8 * (全档位.length - 1)) * 0 + 6 * 64 * (全档位.length * 64 + 8 * (全档位.length - 1)) * 4);
{
  const cell = 64 * 6;
  const gap = 8;
  const W = 全档位.length * cell + (全档位.length - 1) * gap;
  const H = cell;
  const buf = Buffer.alloc(W * H * 4, 255);
  全档位.forEach((size, k) => {
    const img = resample(size <= SMALL_MAX ? cut : art, size);
    const x0 = k * (cell + gap);
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const sx = Math.min(size - 1, Math.floor(x / 6));
        const sy = Math.min(size - 1, Math.floor(y / 6));
        const o = (sy * size + sx) * 4;
        const t = (y * W + x0 + x) * 4;
        buf[t] = img.px[o];
        buf[t + 1] = img.px[o + 1];
        buf[t + 2] = img.px[o + 2];
        buf[t + 3] = 255;
      }
    }
  });
  const png = encodePng({ w: W, h: H, ch: 4, px: buf });
  if (WRITE) writeFileSync('tmp/icon-preview.png', png);
  else writeFileSync('tmp/icon-preview.png', png);
  console.log(`预览（各档放大 6 倍，左小右大）：tmp/icon-preview.png  ${W}x${H}`);
}

if (WRITE) {
  writeFileSync('src-tauri/icons/icon.ico', ico);
  /* 窗口图标用它：48² 的裁切版。150% 缩放下任务栏要 36、标题栏 24、Alt-Tab 48，
     三个消费方全是**降采样**，不会再出现"256 一步缩到 36"那种糊 */
  writeFileSync('src-tauri/icons/icon-taskbar.png', taskbar);
  /* 裸 RGBA（48²×4）。Rust 那边用 `Image::new_owned` 直接吃它 ——
     比 `Image::from_bytes` 省事：那个要开 `image-png` feature，还会把解码器打进包里；
     48×48 的图，9 KB 裸数据比带个 PNG 解码器划算。 */
  writeFileSync('src-tauri/icons/icon-taskbar.rgba', Buffer.from(taskbarImg.px));
  /* 32² 也给裁切版：它被列进 bundle.icon，会进 exe 资源 */
  writeFileSync('src-tauri/icons/32x32.png', encodePng(resample(cut, 32)));
  console.log('\n已写入：icon.ico（13 档）、icon-taskbar.png / .rgba（48²）、32x32.png（32² 裁切版）');
} else {
  console.log('\n没加 --write，什么都没改。');
}
