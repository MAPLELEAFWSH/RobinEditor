/**
 * 回归：拿语料 `乱码翻译\` **整棵树**，把判据对着**每一个目录名/文件名**跑一遍。
 *
 * 为什么不在界面上量：`试跑` 那条路连着两次没出结果（结果卡不在我选的那个容器里），
 * 与其继续跟 UI 选择器较劲，不如直接把**同一套判据**在 Node 里对着真名字跑 ——
 * 判据那两条在 Rust 侧有 cargo 测试钉着（`纯汉字乱码_现在认了` /
 * `中文名与英文名_一个字都不许动`），这里量的是"对着整棵树跑，有没有漏改或误改"。
 *
 * 只读盘，不写任何东西。
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const 根 = 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例\\乱码翻译';

const gbk = new TextDecoder('gbk');
/* 建表要用**不抛**的解码器（扫全表一定会碰到非法字节对）；
   判"无损"那一步才用 fatal 的那个。 */
const sjis = new TextDecoder('shift_jis');
const sjisFatal = new TextDecoder('shift_jis', { fatal: true });
function 建表(d) {
  const m = new Map();
  for (let a = 0x81; a <= 0xfe; a++)
    for (let b = 0x40; b <= 0xfe; b++) {
      if (b === 0x7f) continue;
      const t = d.decode(Uint8Array.from([a, b]));
      if (t.length === 1 && t !== '\uFFFD' && !m.has(t)) m.set(t, [a, b]);
    }
  return m;
}
const 表gbk = 建表(gbk);
const 表sjis = 建表(sjis);

const 编 = (表, s) => {
  const out = [];
  for (const ch of s) {
    if (ch.codePointAt(0) < 0x80) { out.push(ch.codePointAt(0)); continue; }
    const c = 表.get(ch);
    if (!c) return null;
    out.push(...c);
  }
  return Uint8Array.from(out);
};

/** 判据一：无损回环（gbk -> shift_jis 一路） */
function 无损(坏) {
  const 去 = 编(表gbk, 坏);
  if (!去) return false;
  let 解;
  try { 解 = sjisFatal.decode(去); } catch { return false; }
  if (解 === 坏) return false;
  const 回 = 编(表sjis, 解);
  if (!回) return false;
  try { return gbk.decode(回) === 坏; } catch { return false; }
}

/** 判据二：候选里的汉字是不是全在 Shift-JIS 前导字节 0x88–0x98（JIS 第 1 级） */
function 汉字都常用(文) {
  for (const ch of 文) {
    if (!/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(ch)) continue;
    const b = 编(表sjis, ch);
    if (!b || b.length !== 2 || b[0] < 0x88 || b[0] > 0x98) return false;
  }
  return true;
}

function 判(名) {
  const 去 = 编(表gbk, 名);
  if (!去) return { 改: false, 因为: '编不进 gbk' };
  let 候;
  try { 候 = sjis.decode(去); } catch { return { 改: false, 因为: '不是合法 Shift-JIS' }; }
  if (候 === 名) return { 改: false, 因为: '解出来还是它自己' };
  if (!无损(名)) return { 改: false, 因为: '回环对不上' };
  if (!汉字都常用(候)) return { 改: false, 因为: '候选里有生僻字' };
  const 回 = 编(表sjis, 候);
  return { 改: !!回 && gbk.decode(回) === 名, 候 };
}

/* 走整棵树，每个目录名和文件名都判一遍 */
const 该改 = [];
const 不动 = [];
async function 走(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const r = 判(e.name);
    (r.改 ? 该改 : 不动).push({ 名: e.name, 到: r.候, 因为: r.因为 });
    if (e.isDirectory()) await 走(join(dir, e.name));
  }
}
await 走(根);

console.log(`\n==== 判据说「该改」的（${该改.length} 个）====`);
for (const x of 该改) console.log(`  ${x.名}  →  ${x.到}`);

console.log(`\n==== 判据说「不动」的（${不动.length} 个，按原因分组）====`);
const 组 = {};
for (const x of 不动) (组[x.因为] ??= []).push(x.名);
for (const [k, v] of Object.entries(组)) console.log(`  [${k}] ${v.join(' / ')}`);

/* 断言：该改的必须都在，且**中文名一个都不许在"该改"里** */
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) bad++; console.log(`${c ? '✅' : '❌'} ${m}`); };
const 该改的 = new Set(该改.map((x) => x.名 + '→' + x.到));
console.log('\n==== 断言 ====');
for (const [坏, 好] of [
  ['夵曄尦readme', '改変元readme'],
  ['傾僯儊晽Toon.exa', 'アニメ風Toon.exa'],
  ['傾僯儊晽夋柺僗僋儕乕儞.exa', 'アニメ風画面スクリーン.exa'],
  ['readme(恓嬥P).txt', 'readme(針金P).txt'],
  ['readme-巊偄曽.txt', 'readme-使い方.txt']
]) {
  ok(该改的.has(坏 + '→' + 好), `该改的认出来了：${坏} → ${好}`);
}
const 不该 = ['修复结果_过目用', '改名后', '改名后_用候选', '翻译后', '还原后', '测试效果', '乱码翻译', 'AlternativeFull', 'PostRimShilouhette', 'AnimeScreenTex_v1.0'];
for (const x of 不该) {
  ok(!该改.some((y) => y.名 === x), `用户自己起的中文名／英文名没被判成该改：${x}`);
}
console.log(`\n==== 回归 ${n - bad}/${n} 条通过 ====`);
process.exitCode = bad ? 1 : 0;
