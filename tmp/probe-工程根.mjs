/**
 * 一次性探针：把一份 `.pmm`/`.emm` 里的绝对路径按"前两级根"统计一遍。
 *
 * 起因：`香港验收_撤销复跑_修复区与打包区` 在香港规模上红在
 * 「原地修复应当成功: 工程里的路径已经指在原位了（旧根和新根是同一处）」——
 * 得先看清这套工程里的路径到底指在哪。
 * 用法：node tmp\probe-工程根.mjs "<UserFile 目录>"
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const 目录 = process.argv[2];
const dec = new TextDecoder('gbk');

for (const f of process.argv.slice(3)) {
  const buf = readFileSync(join(目录, f));
  const 文本 = dec.decode(buf);
  const 根 = new Map();
  let 总 = 0;
  for (const m of 文本.matchAll(/[A-Za-z]:\\[^\u0000"'<>|\r\n]{0,240}/g)) {
    const v = m[0];
    总++;
    const mm = v.match(/^([A-Za-z]:\\[^\\]*\\?[^\\]*)/);
    const k = mm ? mm[1] : v;
    根.set(k, (根.get(k) ?? 0) + 1);
  }
  console.log(`--- ${f}：字节 ${buf.length}，绝对路径片段 ${总} 个`);
  for (const [k, n] of [...根.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(4)}  ${k}`);
  }
}
