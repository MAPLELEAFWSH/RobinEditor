/**
 * 最小 PNG 解码（8bit、非隔行、真彩/真彩+alpha/灰度）。
 *
 * Node 里没有 PNG 解码器，而这些核对要跑 `src/lib` 的真代码 —— 不能为了读图
 * 把 PIL 或 canvas 引进来。原来这段住在 `tmp/ilmcheck/dump-vivian.mjs` 里，
 * 法线那对也要用，所以挪出来当一份。
 */
import zlib from 'node:zlib';

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let off = 8;
  let w = 0;
  let h = 0;
  let depth = 0;
  let color = 0;
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
      if (depth !== 8) throw new Error(`位深 ${depth} 不支持`);
      if (data[12] !== 0) throw new Error('隔行 PNG 不支持');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = color === 6 ? 4 : color === 2 ? 3 : color === 0 ? 1 : 0;
  if (!ch) throw new Error(`颜色类型 ${color} 不支持`);
  const stride = w * ch;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 255;
      else if (filter === 2) line[i] = (line[i] + b) & 255;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (ch === 4) {
        out[o] = line[x * 4];
        out[o + 1] = line[x * 4 + 1];
        out[o + 2] = line[x * 4 + 2];
        out[o + 3] = line[x * 4 + 3];
      } else if (ch === 3) {
        out[o] = line[x * 3];
        out[o + 1] = line[x * 3 + 1];
        out[o + 2] = line[x * 3 + 2];
        out[o + 3] = 255;
      } else {
        const v = line[x];
        out[o] = out[o + 1] = out[o + 2] = v;
        out[o + 3] = 255;
      }
    }
    prev = line;
  }
  return { w, h, data: out };
}

/** 取左上 size×size 的一块（大图别整张落盘 —— 这几个文件是进仓库的） */
export function crop(img, size) {
  const s = Math.min(size, img.w, img.h);
  const out = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) {
    img.data.copy(out, y * s * 4, y * img.w * 4, y * img.w * 4 + s * 4);
  }
  return { w: s, h: s, data: out };
}
