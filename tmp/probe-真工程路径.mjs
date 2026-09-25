/**
 * 一次性探针（只读）：看真工程那两份文件里**路径指向哪儿**。
 * 为什么要有它：`香港验收_打包_自包含目录` 报了「旧根「E:\C test」在产物里还剩 179 次」——
 * 要分清是"产品改了坏事"还是"素材本身已经被上一轮量具指到 E:\C test 里了"。
 * 用法：node tmp\probe-真工程路径.mjs
 */
import fs from 'node:fs';

const 根 = String.raw`E:\deepseek-harness\mmd集成工具\香港_by_胧月兔_20c4805607dd8ed4e6434b5379da3c59\UserFile`;
const 名 = ['香港观塘 一键启动 夜间 2.1', '香港观塘 一键启动 日间 2.1'];
const 针 = [String.raw`E:\C test`, String.raw`D:\MMD一键渲染工程项目`, String.raw`H:\UserFile`, String.raw`E:\deepseek-harness`];

const 数 = (buf, s) => {
  const p = Buffer.from(s, 'latin1');
  let n = 0;
  let i = 0;
  while ((i = buf.indexOf(p, i)) >= 0) {
    n++;
    i++;
  }
  return n;
};

for (const n of 名) {
  for (const ext of ['pmm', 'emm']) {
    const p = `${根}\\${n}.${ext}`;
    const b = fs.readFileSync(p);
    console.log(`${n}.${ext}  ${b.length} 字节`);
    for (const s of 针) console.log(`    ${s} × ${数(b, s)}`);
    console.log(`    有 .bak = ${fs.existsSync(`${根}\\${n}.${ext}.bak`)}`);
  }
}

/* 副本里那两份（量具刚拷过去的）也看一眼：确认这次量的是同一批路径 */
const 副 = String.raw`E:\C test\⑥验收\打包\UserFile`;
for (const ext of ['pmm', 'emm']) {
  const p = `${副}\\${名[0]}.${ext}`;
  if (!fs.existsSync(p)) continue;
  const b = fs.readFileSync(p);
  console.log(`副本 ${名[0]}.${ext}  ${b.length} 字节`);
  for (const s of 针) console.log(`    ${s} × ${数(b, s)}`);
}

/* 夜间那套的 .emm 里那 172 条到底指向哪儿、还在不在 */
{
  const p = `${根}\\${名[0]}.emm`;
  const b = fs.readFileSync(p);
  const ASCII = (buf) => {
    let s = '';
    for (const c of buf) s += c >= 32 && c < 127 ? String.fromCharCode(c) : (c === 0x5c ? '\\' : '·');
    return s;
  };
  const 行们 = b.toString('latin1').split('\r\n').filter((l) => l.includes('E:\\C test'));
  console.log(`\n夜间 .emm 里含 E:\\C test 的行：${行们.length} 条，前 5 条：`);
  for (const l of 行们.slice(0, 5)) {
    const 全 = l.includes('=') ? l.slice(l.indexOf('=') + 1).trim() : l.trim();
    /* 路径按字节取（中文是 GBK 双字节，这里只做结构展示） */
    console.log('   ', 全.slice(0, 90), '　存在=', fs.existsSync(全));
  }
  /* 结构：第 3 段之后是什么 */
  const 段 = new Set();
  for (const l of 行们) {
    const 全 = l.includes('=') ? l.slice(l.indexOf('=') + 1).trim() : '';
    const a = 全.split('\\');
    if (a.length > 3) 段.add(a.slice(0, 4).join('\\'));
  }
  console.log('    前 4 段的不同写法：');
  for (const s of 段) console.log('      ', s);
  void ASCII;
}
