/**
 * 把 vivian 那套真实配对导成裸 RGBA，给 run.mjs 当验收基准用。
 *
 * 为什么走 PNG 解一次再落盘：Node 里没有 PNG 解码器，而 run.mjs 要跑的是
 * src/lib 的真代码，不能为了读图把 PIL 或 canvas 引进来。
 *
 * 跑法：node tmp/ilmcheck/dump-vivian.mjs
 * 产出：tmp/ilmcheck/data/*.raw + sizes.json
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DIR = String.raw`E:\deepseek-harness\mmd集成工具\实战测试用例\渲染联动\养乐多\MMDStarRail4Fun_v2.2.1\ZZZ\vivian`;
const OUT = 'tmp/ilmcheck/data';

/** 最小 PNG 解码：只吃 8bit 非隔行的真彩/真彩+alpha/灰度 */
function decodePng(buf) {
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

fs.mkdirSync(OUT, { recursive: true });
const sizes = {};
for (const stem of ['Vivian_Body_1', 'Vivian_Body_2']) {
  for (const k of ['A', 'M', 'N', 'LM']) {
    const src = path.join(DIR, `${stem}_${k}.png`);
    const got = decodePng(fs.readFileSync(src));
    const name = `${stem.replace('Vivian_', '').toLowerCase()}_${k.toLowerCase()}.raw`;
    fs.writeFileSync(path.join(OUT, name), got.data);
    sizes[`${stem.replace('Vivian_', '').toLowerCase()}_${k}`] = [got.w, got.h];
    console.log(`${name.padEnd(16)} ${got.w}x${got.h}  ${(got.data.length / 1048576).toFixed(1)}MB`);
  }
}
// SDF 那对。真图里 SDF 就是脸部 lightmap 的 G 通道，这条关系靠它钉住
const EXTRAS = {
  face_lm: 'Female_Face_Lightmap.png',
  face_sdf: 'GI_Converted_Face_SDF.png'
};
for (const [key, file] of Object.entries(EXTRAS)) {
  const got = decodePng(fs.readFileSync(path.join(DIR, file)));
  fs.writeFileSync(path.join(OUT, `${key}.raw`), got.data);
  sizes[key] = [got.w, got.h];
  console.log(
    `${(key + '.raw').padEnd(16)} ${got.w}x${got.h}  ← ${file}`
  );
}

fs.writeFileSync(path.join(OUT, 'sizes.json'), JSON.stringify(sizes, null, 2));
console.log('\nsizes.json 写好');
