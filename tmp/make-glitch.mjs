/**
 * 造一个真·乱码文件，跑一遍 ① 的整条链路（读编码 → 识别 → 只改注释 → 写回）。
 *
 * 怎么造的乱码：日文原文是 Shift-JIS 的字节，被当成 GBK 读出来。
 * 所以这里反过来做 —— 先把日文按 Shift-JIS 编码拿字节，
 * 再按 GBK 解码成字符串，存成 UTF-8 文件。这就是用户手上那种文件的成因。
 *
 * 只改注释模式要能保住代码段一个字符不动，这是这个模式存在的理由。
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = String.raw`E:\deepseek-harness\RobinEditor\tmp\glitch-test`;
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });

/**
 * Shift-JIS 编码表：Node 的 TextEncoder 只有 UTF-8，所以借 iconv 做不到。
 * 但 Windows 上有个现成的办法 —— 用 TextDecoder('shift_jis') 反查：
 * 枚举所有双字节组合，找出哪个字节对解出目标假名。慢但够用，只跑一次。
 */
const decoder = new TextDecoder('shift_jis');
const encodeMap = new Map(); // 字符 -> 字节数组
for (let hi = 0x81; hi <= 0xef; hi++) {
  for (let lo = 0x40; lo <= 0xfc; lo++) {
    const bytes = new Uint8Array([hi, lo]);
    const s = decoder.decode(bytes);
    if (s.length === 1 && s !== '\uFFFD' && !encodeMap.has(s)) {
      encodeMap.set(s, [hi, lo]);
    }
  }
}
// 单字节部分（ASCII 和半角片假名）
for (let b = 0xa1; b <= 0xdf; b++) {
  const s = decoder.decode(new Uint8Array([b]));
  if (s.length === 1 && s !== '\uFFFD' && !encodeMap.has(s)) encodeMap.set(s, [b]);
}
for (let b = 0x20; b <= 0x7e; b++) {
  const s = String.fromCharCode(b);
  if (!encodeMap.has(s)) encodeMap.set(s, [b]);
}

function toShiftJis(text) {
  const out = [];
  for (const ch of text) {
    const b = encodeMap.get(ch);
    if (!b) throw new Error(`Shift-JIS 里找不到这个字：${ch}`);
    out.push(...b);
  }
  return new Uint8Array(out);
}

const gbk = new TextDecoder('gbk');

/** 日文原文 → Shift-JIS 字节 → 当 GBK 读 → 乱码字符串 */
function garble(jp) {
  return gbk.decode(toShiftJis(jp));
}

const FX_JP = [
  '// テクスチャの設定',
  '// コントローラーから受け取る',
  '#define TEXTURE_SWIZZLE 3',
  'float4 main(float2 uv : TEXCOORD0) : COLOR0 {',
  '  // シェーダーの本体',
  '  float4 c = tex2D(TextureSampler, uv);',
  '  /* メタリック成分を足す */',
  '  return c; // ここで返す',
  '}',
  ''
];

const garbled = FX_JP.map((l) => garble(l));
const mojibakeFile = FX_JP.map((l, i) => (l.startsWith('//') || l.includes('//') || l.startsWith('/*') || l.includes('/*') ? garbled[i] : l)).join('\n');
fs.writeFileSync(path.join(SRC, 'broken.fx'), mojibakeFile, 'utf8');

// 纯乱码的整文件（模拟整个文件被转坏）
fs.writeFileSync(path.join(SRC, 'all-broken.fx'), garbled.join('\n'), 'utf8');

// 正常文件：不许被动
const clean = FX_JP.join('\n');
fs.writeFileSync(path.join(SRC, 'clean.fx'), clean, 'utf8');

// CRLF 版：写回时换行符必须原样保留，不然改一行整个文件都进 diff
fs.writeFileSync(path.join(SRC, 'crlf.fx'), mojibakeFile.replace(/\n/g, '\r\n'), 'utf8');

// 日文原文版：验证「已经是正常的就不许动」
fs.writeFileSync(path.join(SRC, 'japanese.fx'), clean, 'utf8');

console.log('=== 造出来的乱码长这样 ===');
console.log(garbled[0], '|', garbled[1], '|', garbled[5]);

export { SRC, FX_JP, garbled, clean };
