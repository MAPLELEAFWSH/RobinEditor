/**
 * 用**只有解码器**的办法把名字那条链子验死（不靠手抄的字节表）。
 *
 * 工具那条名字链的口径是「gbk -> shift_jis」：把盘上那个名字按 **gbk 编回字节**，
 * 再按 **shift_jis 解**一次。这里就用 `TextDecoder` 反查表把这条链子走通：
 *   1. 先扫出「哪个 gbk 字节对解出来是 夵 / 曄 / 尦」→ 拿到盘上名字的 gbk 字节；
 *   2. 把这串字节按 shift_jis 解 → 看是不是 `改変元`；
 *   3. 反过来：扫出「哪个 shift_jis 字节对解出来是 改 / 変 / 元」→ 按 gbk 解 → 看是不是 夵曄尦。
 */
const 单 = [];
for (let b = 0x80; b <= 0xff; b++) {
  const t = new TextDecoder('gbk').decode(Uint8Array.from([b]));
  if (t !== '\uFFFD') 单.push({ 字节: [b], 字: t });
}

const 双 = (dec) => {
  const m = new Map();
  for (let a = 0x81; a <= 0xfe; a++) {
    for (let b = 0x40; b <= 0xfe; b++) {
      if (b === 0x7f) continue;
      const t = dec.decode(Uint8Array.from([a, b]));
      if (t.length === 1 && t !== '\uFFFD') m.set(t, [a, b]);
    }
  }
  return m;
};

console.log('扫 gbk 双字节表…');
const gbk表 = 双(new TextDecoder('gbk'));
console.log(`  ${gbk表.size} 条`);
console.log('扫 shift_jis 双字节表…');
const sj表 = 双(new TextDecoder('shift_jis'));
console.log(`  ${sj表.size} 条`);

const 找 = (表, 字) => 表.get(字);
const hex = (a) => a.map((x) => x.toString(16).padStart(2, '0')).join(' ');

/* ① 盘上名字 → gbk 编字节 → shift_jis 解 */
console.log('\n---- ① 盘上名字按 gbk 编回字节，再按 shift_jis 解 ----');
const 盘名 = '夵曄尦';
const 字节1 = [];
let 缺 = false;
for (const ch of 盘名) {
  const c = 找(gbk表, ch);
  if (!c) {
    缺 = true;
    console.log(`  gbk 表里没有「${ch}」（U+${ch.codePointAt(0).toString(16).toUpperCase()}）`);
    break;
  }
  字节1.push(...c);
}
if (!缺) {
  const 解 = new TextDecoder('shift_jis', { fatal: true });
  let 原;
  try { 原 = 解.decode(Uint8Array.from(字节1)); } catch (e) { 原 = '（shift_jis 解不了）'; }
  console.log(`  「${盘名}」的 gbk 字节 = ${hex(字节1)}`);
  console.log(`  按 shift_jis 解 → 「${原}」   工具说的候选是「改変元」 → ${原 === '改変元' ? '对上了 ✓' : '对不上 ✗'}`);
}

/* ② 反过来：改変元 的 shift_jis 字节 → 按 gbk 解 */
console.log('\n---- ② 反过来：候选原文按 shift_jis 编字节，再按 gbk 解 ----');
const 原文 = '改変元';
const 字节2 = [];
for (const ch of 原文) {
  const c = 找(sj表, ch);
  if (!c) { console.log(`  shift_jis 表里没有「${ch}」`); break; }
  字节2.push(...c);
}
if (字节2.length === 6) {
  const 解 = new TextDecoder('gbk', { fatal: true });
  let 坏;
  try { 坏 = 解.decode(Uint8Array.from(字节2)); } catch { 坏 = '（gbk 解不了）'; }
  console.log(`  「${原文}」的 shift_jis 字节 = ${hex(字节2)}`);
  console.log(`  按 gbk 解 → 「${坏}」   盘上是「${盘名}」 → ${坏 === 盘名 ? '对上了 ✓' : '对不上 ✗'}`);
}

/* ③ 拿同目录真文件里的日文自检一遍这套反查表可不可信 */
console.log('\n---- ③ 反查表自检：用「エッジ」的真字节 ----');
const 真 = Uint8Array.from([0x83, 0x47, 0x83, 0x62, 0x83, 0x57]);
console.log(`  字节 ${hex([...真])} 按 shift_jis 解 → 「${new TextDecoder('shift_jis').decode(真)}」（读文件时量到的是 エッジ）`);
console.log(`  同一串按 gbk 解 → 「${new TextDecoder('gbk').decode(真)}」（读文件时量到的是 僄僢僕）`);
