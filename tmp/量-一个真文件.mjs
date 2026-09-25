/** 量一个真语料文件：字节是什么、按几种编码各解出什么（只读，不写盘） */
import { readFile, readdir, stat } from 'node:fs/promises';

const 目录 = process.argv[2];
const 名 = process.argv[3];

const 试 = (b, enc) => {
  try {
    return { 成: true, 文: new TextDecoder(enc, { fatal: true }).decode(b) };
  } catch (e) {
    return { 成: false, 文: '（这种编码解不了：' + e.message + '）' };
  }
};

const b = await readFile(`${目录}\\${名}`);
console.log(`文件：${名}`);
console.log(`字节数：${b.length}`);
console.log(`前 4 字节：${[...b.slice(0, 4)].map((x) => x.toString(16).padStart(2, '0')).join(' ')}`);

for (const enc of ['shift_jis', 'gbk', 'euc-jp', 'utf-8']) {
  const r = 试(b, enc);
  console.log(`\n---- 按 ${enc} 读 ${r.成 ? '（整个文件都能解）' : '（解不了）'} ----`);
  console.log(r.文.slice(0, 260).replace(/\r?\n/g, ' ⏎ '));
}

/* 非 ASCII 字节的分布：全 ASCII 的话"乱码"这个说法本身就不成立 */
const 非ascii = [...b].filter((x) => x > 127).length;
console.log(`\n非 ASCII 字节：${非ascii} / ${b.length}`);
const 控制 = [...b].filter((x) => x < 9 || (x > 13 && x < 32)).length;
console.log(`控制字符：${控制}`);

/* 同目录还有些什么 */
const 列 = await readdir(目录);
console.log(`\n同目录：${列.join(' / ')}`);
