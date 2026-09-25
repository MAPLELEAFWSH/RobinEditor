/**
 * 把 `Glitch.svelte` 头上那个 **UTF-8 BOM 摘掉**（我自己用 PowerShell `Set-Content` 写出来的）。
 *
 * 硬规矩写着"改文本文件只用 read/edit/write，别用 Set-Content/Out-File"（会加 BOM、转 CRLF、
 * 中文乱码）—— 这一轮我为了做守卫的破坏性试验违反了它，中文没坏、行尾也是 LF，
 * 但**头上多了 EF BB BF**。全库其它 .svelte 都没有 BOM，留着就是一个不一致。
 *
 * 按字节处理：读 Buffer、摘前 3 字节、原样写回。不经任何编码转换。
 */
import { readFile, writeFile } from 'node:fs/promises';

const f = 'E:\\deepseek-harness\\RobinEditor\\src\\lib\\modules\\glitch\\Glitch.svelte';
const b = await readFile(f);
const 有BOM = b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
console.log(`原来是：${b.length} 字节，BOM=${有BOM}`);
if (!有BOM) {
  console.log('没有 BOM，什么都不用做');
} else {
  await writeFile(f, b.subarray(3));
  const c = await readFile(f);
  console.log(`现在是：${c.length} 字节（少了 ${b.length - c.length}），BOM=${c[0] === 0xef && c[1] === 0xbb && c[2] === 0xbf}`);
  console.log(`摘掉 BOM 之后，前面 6 字节 = ${[...c.slice(0, 6)].map((x) => x.toString(16).padStart(2, '0')).join(' ')}（应当以 3c 73 63 72 69 70 开头 = "<scrip"）`);
  console.log(`中文字还在：${c.toString('utf8').includes('落盘话') && c.toString('utf8').includes('提示自动关毫秒')}`);
}
