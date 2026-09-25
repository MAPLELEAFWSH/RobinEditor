/** 配对比较：源文件（按 shift_jis 读）与 还原后 那份，文本一样吗、编码变了吗 */
import { readFile } from 'node:fs/promises';

const 源 = 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例\\乱码翻译\\PostRimShilouhette\\夵曄尦readme\\EdgeControl - readme.txt';
const 产物 = 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例\\乱码翻译\\修复结果_过目用\\PostRimShilouhette\\还原后\\EdgeControl - readme.txt';

const 解 = (b, enc) => {
  try {
    return { ok: true, t: new TextDecoder(enc, { fatal: true }).decode(b) };
  } catch {
    return { ok: false, t: '' };
  }
};

const a = await readFile(源);
const b = await readFile(产物);
const 甲 = 解(a, 'shift_jis');
const 乙 = 解(b, 'utf-8');
const 乙j = 解(b, 'shift_jis');

console.log(`源  ${a.length} 字节 → 按 shift_jis 解：${甲.ok ? '可以' : '不行'}`);
console.log(`产物 ${b.length} 字节 → 按 utf-8 解：${乙.ok ? '可以' : '不行'}；按 shift_jis 解：${乙j.ok ? '可以' : '不行'}`);

if (甲.ok && 乙.ok) {
  const 正 = (s) => s.replace(/\r\n/g, '\n');
  console.log(`\n换行归一之后，两份文本${正(甲.t) === 正(乙.t) ? '**完全相同**' : '**不同**'}`);
  if (正(甲.t) !== 正(乙.t)) {
    const x = 正(甲.t), y = 正(乙.t);
    let i = 0;
    while (i < x.length && i < y.length && x[i] === y[i]) i++;
    console.log(`第一个不同的位置：${i}`);
    console.log(`源   ：…${JSON.stringify(x.slice(Math.max(0, i - 40), i + 40))}`);
    console.log(`产物 ：…${JSON.stringify(y.slice(Math.max(0, i - 40), i + 40))}`);
  }
  console.log(`\n源 前 120 字：${甲.t.slice(0, 120).replace(/\r?\n/g, ' ⏎ ')}`);
  console.log(`产物 前 120 字：${乙.t.slice(0, 120).replace(/\r?\n/g, ' ⏎ ')}`);
}
