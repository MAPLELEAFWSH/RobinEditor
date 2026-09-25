/**
 * 一次性探针：把一份 `.pmm`/`.emm` 里的绝对路径逐条拿去问盘上在不在。
 * 用法：node tmp\probe-路径在盘.mjs "<文件>" [最多打印几条]
 */
import { readFileSync, existsSync } from 'node:fs';

const 文件 = process.argv[2];
const dec = new TextDecoder('gbk');
const 文本 = dec.decode(readFileSync(文件));
const ps = [...文本.matchAll(/[A-Za-z]:\\[^\u0000"'<>|\r\n]{0,240}/g)].map((m) => m[0]);
let 在 = 0;
for (const p of ps) if (existsSync(p)) 在++;
console.log(`${文件}\n  绝对路径 ${ps.length} 条，在盘上 ${在} 条，缺 ${ps.length - 在} 条`);
for (const p of ps.slice(0, Number(process.argv[3] ?? 4))) {
  console.log(`   ${existsSync(p) ? '在' : '缺'}  ${p}`);
}
