/**
 * 真写盘验收 —— 第 1 步：把语料**复制一份**到 `测试效果\`，并记下**改之前**的落地状态。
 *
 * 为什么非要在副本上：硬规矩是 `实战测试用例\` 的原始素材**一个字节都不许改**，
 * 而这一步要跑的恰恰是"改文件名 + 改文件内容"。
 *
 * 快照记三样：相对路径（改名要靠它比）、字节数、内容 sha256。
 * 改完之后拿它当"地面真值"逐条比。
 *
 * 用法：node tmp\验收-①真写盘-准备.mjs
 */
import { readdir, readFile, mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const 源 = 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例\\乱码翻译';
const 出品根 = 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例\\测试效果';
const 副本 = join(出品根, '①写盘验收-副本');
const 快照 = join(出品根, '①写盘验收-改前快照.json');

/* 每次都从干净副本开始：上一次跑剩的 .bak / 改过的名字会把这一趟的结果带偏 */
await rm(副本, { recursive: true, force: true }).catch(() => {});
await mkdir(dirname(副本), { recursive: true });
await cp(源, 副本, { recursive: true });
console.log(`副本：${副本}`);

async function 走(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await 走(p, out);
    else out.push(p);
  }
  return out;
}

const 表 = [];
for (const p of await 走(副本)) {
  const b = await readFile(p);
  表.push({
    rel: relative(副本, p),
    字节: b.length,
    sha: createHash('sha256').update(b).digest('hex').slice(0, 16)
  });
}
表.sort((a, b) => (a.rel < b.rel ? -1 : 1));
await writeFile(快照, JSON.stringify({ 副本, 文件数: 表.length, 表 }, null, 1), 'utf8');

console.log(`文件数=${表.length}`);
console.log(`快照：${快照}`);
const 乱码名 = 表.filter((x) => /[^\x00-\x7F\u3040-\u30ff\u4e00-\u9fff]/.test(x.rel));
console.log(`名字里带非日文非 ASCII 字符的（就是那些乱码名）：${乱码名.length} 条`);
for (const x of 乱码名.slice(0, 8)) console.log('   ' + x.rel);
