/**
 * 一次性探针（只读）：看那次「打包」到底把什么拷进了包里、包里那两份工程写的是什么路径。
 * 用法：node tmp\probe-包里.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const 包 = String.raw`E:\C test\⑥验收\打包\包里`;
const 名 = '香港观塘 一键启动 夜间 2.1';

/* 只读地列出前几层目录 */
const 树 = (根, 深 = 0, 上限 = 3) => {
  if (深 >= 上限) return;
  for (const e of fs.readdirSync(根, { withFileTypes: true }).slice(0, 8)) {
    console.log('  '.repeat(深 + 1) + e.name + (e.isDirectory() ? '\\' : ''));
    if (e.isDirectory()) 树(path.join(根, e.name), 深 + 1, 上限);
  }
};
console.log('包里的目录结构（前几层）：');
树(包);

const GBK = new TextDecoder('gbk');
for (const ext of ['pmm', 'emm']) {
  const p = path.join(包, `${名}.${ext}`);
  const b = fs.readFileSync(p);
  const 数 = (s) => {
    const 针 = Buffer.from(s, 'latin1');
    let n = 0;
    let i = 0;
    while ((i = b.indexOf(针, i)) >= 0) {
      n++;
      i++;
    }
    return n;
  };
  console.log(`\n包里 ${名}.${ext}  ${b.length} 字节：`);
  for (const s of [String.raw`E:\C test`, String.raw`E:\deepseek-harness`, String.raw`包里`]) {
    console.log(`    ${s} × ${数(s)}`);
  }
  if (ext === 'emm') {
    const 行 = GBK.decode(b)
      .split('\r\n')
      .filter((l) => l.includes('E:\\'));
    console.log(`    绝对路径行 ${行.length} 条，前 3 条：`);
    for (const l of 行.slice(0, 3)) console.log('      ', l.slice(0, 120));
  }
}
