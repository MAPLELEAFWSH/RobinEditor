/* 一次性盘上回读探针（本轮不改产品代码，只用来数 .pmm/.emm 的字节）。
   用法：node tmp\verify-pmm-roots.mjs
   路径是 SJIS 存的，这里按 latin1 读字节数 ASCII 片段。 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'D:\\9.26mmd\\UserFile_by_胧月兔_9ec30a17441f2e6932eb8ef538057520';
const 旧根前缀 = 'D:\\MMD'; // 旧根 D:\MMD一键渲染工程项目… 的 ASCII 头
const 新根前缀 = 'D:\\9.26mmd';

function 数(a, s) {
  return s ? a.split(s).length - 1 : 0;
}

for (const 名 of ['白天沙滩 一键渲染.pmm', '白天沙滩 一键渲染.emm']) {
  const p = path.join(DIR, 名);
  if (!fs.existsSync(p)) {
    console.log(`${名}: 不存在`);
    continue;
  }
  const b = fs.readFileSync(p);
  const a = b.toString('latin1');
  console.log(`--- ${名}  字节数 ${b.length}`);
  console.log(`    旧根头 "D:\\MMD"       出现 ${数(a, 旧根前缀)} 次`);
  console.log(`    新根头 "D:\\9.26mmd"   出现 ${数(a, 新根前缀)} 次`);
  console.log(`    "UserFile"             出现 ${数(a, 'UserFile')} 次`);
  console.log(`    "ray-mmd-1.5.2"        出现 ${数(a, 'ray-mmd-1.5.2')} 次`);
  const 表 = new Set();
  for (const m of a.matchAll(/[A-Za-z]:\\[^\x00-\x1f]{2,220}?\.(?:pmx|fx|x|conf|emm|pmm|sph|spa|tga|png|jpg|dds)/g)) {
    if (!m[0].startsWith(旧根前缀)) continue;
    表.add(m[0]);
  }
  console.log(`    旧根下的路径（去重） ${表.size} 条：`);
  for (const s of [...表].sort()) console.log(`      ${s}`);
}
const bak = ['.pmm.bak', '.emm.bak'].map((s) => path.join(DIR, '白天沙滩 一键渲染' + s));
console.log('--- .bak 存在情况');
for (const p of bak) console.log(`    ${fs.existsSync(p) ? '有' : '没有'}  ${p}`);
