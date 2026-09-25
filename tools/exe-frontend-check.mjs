/**
 * 打包出来的 exe 里，前端到底是不是刚构建的那一份。
 *
 * 为什么这么查：Tauri release 会把前端资源**压进去**，所以正文里搜不到界面文案
 * （试过：`这个模式只改注释` 在 exe 里搜不到）。但资源表里的**文件名**是留着的，
 * 而 chunk 名是内容哈希 —— 新构建的 chunk 名只可能出现在新包里。
 * 于是"拿 build\ 里那几个新 chunk 名去 exe 里找"就能证明前端是新的一份，
 * 不用开窗口。找不到不代表坏（压缩方式可能变），**找到就是实锤**。
 *
 * 用法：node tools/exe-frontend-check.mjs [exe] [build目录]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const exe = process.argv[2] ?? 'dist/RobinEditor-免安装版.exe';
const dir = process.argv[3] ?? 'build';

const exeBuf = readFileSync(exe);
const imm = join(dir, '_app', 'immutable');

function walk(d, out = []) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/* chunk 名就是内容哈希，取几个够独特的（名字长度 > 8，避免撞上别的字符串） */
const names = walk(imm)
  .map((f) => relative(imm, f).replace(/\\/g, '/').split('/').pop())
  .filter((n) => /^[A-Za-z0-9_-]{8,}\.(js|css)$/.test(n));

let hit = 0;
const found = [];
for (const n of names) {
  if (exeBuf.includes(Buffer.from(n, 'utf8'))) {
    hit++;
    if (found.length < 6) found.push(n);
  }
}
console.log(`${exe}  ${(exeBuf.length / 1048576).toFixed(2)} MB`);
console.log(`拿 build\\ 里 ${names.length} 个 chunk 名去里头找：命中 ${hit} 个`);
if (found.length) console.log(`  例如 ${found.join('、')}`);

/* **判据是"全中"，不是"中一个"。**
   原来写的是 `hit > 0` → "就是刚构建那一份"，这是**假的绿**：
   chunk 名是内容哈希，**没改过的文件名字不变** —— 一个旧包照样能中一大半。
   2026-09-26 实测到过：`dist\RobinEditor-免安装版.exe` 是 0:22 打的旧包，
   `build\` 是 1:19 的，42 个名字里中了 25 个，那句结论照样报"就是刚构建那一份"。
   所以：全中才算过；中了一部分 = **这是个旧包**，退出码 1；一个不中 = 办法在这台机器上不成立。 */
if (hit === names.length) {
  console.log(`结论：包里嵌的前端就是刚构建那一份（${hit}/${names.length} 全中）`);
  process.exit(0);
}
if (hit > 0) {
  console.log(
    `结论：**这是个旧包** —— 只中了 ${hit}/${names.length}，` +
      `还差 ${names.length - hit} 个。` +
      `多半是"改了源码没重打包"，也可能是打完包之后又改了源码。重打一次再核。`
  );
  process.exit(1);
}
console.log('结论：一个都没找到 —— 资源名也被压掉了，这个办法在这台机器上不成立（不代表包坏）');
process.exit(0);
