/** 独立复核：`夵曄尦` 到底是不是 `改変元` 被按 GBK 读坏的；顺便把同目录三个 readme 全量一遍 */
import { readFile } from 'node:fs/promises';

const 目录 = 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例\\乱码翻译\\PostRimShilouhette\\夵曄尦readme';

/* ① 名字那条：把「猜的原文」编成 shift_jis，再按 gbk 读 —— 能不能还原出盘上那个名字 */
const 编码 = {
  shiftJis: (s) => {
    /* Node 没有 Shift-JIS 编码器，用查表法反推：这里只处理这几个字，手写字节表 */
    const 表 = { 改: [0x89, 0x5c], 変: [0x95, 0xcf], 元: [0x8c, 0xb3] };
    const out = [];
    for (const ch of s) {
      const c = 表[ch];
      out.push(c[0], c[1]);
    }
    return Uint8Array.from(out);
  }
};
const 字节 = 编码.shiftJis('改変元');
const 按gbk读 = new TextDecoder('gbk').decode(字节);
console.log(`「改変元」的 shift_jis 字节 = ${[...字节].map((x) => x.toString(16).padStart(2, '0')).join(' ')}`);
console.log(`  这串字节按 GBK 读 → 「${按gbk读}」`);
console.log(`  盘上的目录名是不是它：${按gbk读 === '夵曄尦' ? '是 ✓' : '不是 ✗'}`);
/* 反向再走一遍：盘上那个名字按 gbk 编回字节、再按 shift_jis 读 */
const 盘名 = '夵曄尦';
const 盘字节 = new TextEncoder('gbk' in globalThis ? 'gbk' : 'utf-8'); // 占位，下面用 decode 反查
console.log(`盘上名字「${盘名}」的 UTF-16 码位：${[...盘名].map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase()).join(' ')}`);

/* ② 三个 readme 全量：各自按哪种编码读得出通顺日文 */
console.log('\n---- 同目录三个 readme ----');
const { readdir } = await import('node:fs/promises');
for (const f of await readdir(目录)) {
  const b = await readFile(`${目录}\\${f}`);
  const 解 = (enc) => {
    try { return new TextDecoder(enc, { fatal: true }).decode(b); } catch { return null; }
  };
  const sj = 解('shift_jis');
  const gb = 解('gbk');
  const u8 = 解('utf-8');
  const 非ascii = [...b].filter((x) => x > 127).length;
  console.log(`\n【${f}】${b.length} 字节，非 ASCII ${非ascii}`);
  console.log(`  shift_jis：${sj ? '整篇可解 → ' + sj.slice(0, 60).replace(/\r?\n/g, ' ⏎ ') : '解不了'}`);
  console.log(`  gbk      ：${gb ? '整篇可解 → ' + gb.slice(0, 60).replace(/\r?\n/g, ' ⏎ ') : '解不了'}`);
  console.log(`  utf-8    ：${u8 ? '可解' : '解不了'}`);
}
