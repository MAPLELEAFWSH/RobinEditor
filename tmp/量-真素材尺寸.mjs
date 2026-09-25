/**
 * 真素材的像素尺寸分布（② 要定"原分辨率"到底意味着多大，得先知道真图有多大）。
 *
 * 只读文件头，不解码整张图（PNG 的 IHDR、BMP 的 BITMAPINFOHEADER、JPEG 的 SOF 段、DDS 的 DDS_HEADER）。
 * 目录只读，不写任何东西。
 *
 * 用法：node tmp\量-真素材尺寸.mjs "E:\deepseek-harness\mmd集成工具\实战测试用例\调色"
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const 根 = process.argv[2];
if (!根) {
  console.error('给个目录');
  process.exit(1);
}

function 尺寸(路径) {
  const b = readFileSync(路径);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) {
    return { 格式: 'png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  }
  if (b.length > 26 && b.toString('ascii', 0, 2) === 'BM') {
    /* BMP：DIB 头里宽高是有符号 32 位（高为负 = 自上而下） */
    return { 格式: 'bmp', w: Math.abs(b.readInt32LE(18)), h: Math.abs(b.readInt32LE(22)) };
  }
  if (b.length > 4 && b.toString('ascii', 0, 4) === 'DDS ') {
    return { 格式: 'dds', w: b.readUInt32LE(16), h: b.readUInt32LE(12) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const 标 = b[i + 1];
      const 段长 = b.readUInt16BE(i + 2);
      if (标 >= 0xc0 && 标 <= 0xcf && 标 !== 0xc4 && 标 !== 0xc8 && 标 !== 0xcc) {
        return { 格式: 'jpg', h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      }
      i += 2 + 段长;
    }
  }
  return null;
}

const 文件 = [];
function 走(目录) {
  for (const e of readdirSync(目录, { withFileTypes: true })) {
    const p = join(目录, e.name);
    if (e.isDirectory()) {
      if (e.name === '测试效果') continue; /* 产物不算素材 */
      走(p);
    } else if (/\.(png|bmp|jpg|jpeg|dds)$/i.test(e.name)) {
      文件.push(p);
    }
  }
}
走(根);

const 表 = [];
for (const p of 文件) {
  const s = 尺寸(p);
  if (!s) continue;
  表.push({ ...s, 字节: statSync(p).size, 名: p.slice(根.length + 1) });
}

const 长边桶 = new Map();
for (const r of 表) {
  const 长 = Math.max(r.w, r.h);
  const 档 = 长 <= 512 ? '≤512' : 长 <= 1024 ? '513~1024' : 长 <= 2048 ? '1025~2048' : 长 <= 4096 ? '2049~4096' : '>4096';
  长边桶.set(档, (长边桶.get(档) ?? 0) + 1);
}
console.log(`目录：${根}\n读懂了 ${表.length} 张（共扫到 ${文件.length} 个图文件）\n`);
console.log('长边分布：');
for (const 档 of ['≤512', '513~1024', '1025~2048', '2049~4096', '>4096']) {
  if (长边桶.has(档)) console.log(`  ${档.padEnd(12)}${长边桶.get(档)}`);
}
表.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));
console.log('\n最大的 12 张：');
for (const r of 表.slice(0, 12)) {
  console.log(`  ${String(r.w).padStart(5)}×${String(r.h).padEnd(5)} ${r.格式}  ${(r.字节 / 1048576).toFixed(1)}MB  ${r.名}`);
}
