/**
 * 一次性探针（只读）：那次「打包」留下的包里，每条路径是不是真的都在盘上（"包能直接打开"的判据）。
 * 用法：node tmp\probe-包内命中.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const 包 = String.raw`E:\C test\⑥验收\打包\包里`;
const 名 = '香港观塘 一键启动 夜间 2.1';
const GBK = new TextDecoder('gbk');

const b = fs.readFileSync(path.join(包, `${名}.emm`));
const 行 = GBK.decode(b).split('\r\n');
let 总 = 0;
let 在 = 0;
const 不在的 = [];
for (const l of 行) {
  const i = l.indexOf('=');
  if (i < 0) continue;
  const v = l.slice(i + 1).trim();
  if (!/^[A-Za-z]:[\\/]/.test(v)) continue;
  总++;
  if (fs.existsSync(v)) 在++;
  else if (不在的.length < 5) 不在的.push(v);
}
console.log(`包里 .emm 绝对路径 ${总} 条，在盘上 ${在} 条`);
for (const s of 不在的) console.log('  不在：', s);
