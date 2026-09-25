/**
 * 量一问：**机器自己判真值**，哪条判据分得开。
 *
 * 背景：① 现在卡在"纯汉字乱码"上 —— 自动判据要"假名占比上升"，而
 * `丒巊梡曽朄 → ・使用方法`、`夵曄尦 → 改変元` 两边都没假名，判据看不见上升。
 * 用户定的口径是：**不能把这个活丢给操作者去挑**，得程序判对。
 *
 * 所以先拿语料里的真样本，把两条候选判据各自量一遍（不猜）：
 *   判据一 **双向无损**：gbk编 → sjis解 → sjis编 → gbk解 走一圈是否原样回来。
 *   判据二 **字常见度**：候选解出来的汉字，落在 Shift-JIS（JIS X 0208）**第 1 级**
 *          （常用汉字那 2965 个，Shift-JIS 前导字节 0x88–0x98）里的比例。
 *
 * 样本分两组：
 *   ✅ 真乱码（**应该**被认出来并还原）
 *   ⛔ 不该动（用户自己起的名字 / 本来就好的日文 —— 认错了就是"把好名字改成乱码"）
 */
const dec = (enc) => new TextDecoder(enc);
const gbk = dec('gbk');
const sjis = dec('shift_jis');

/* 反查表：只有解码器也能"编码" —— 扫出哪个字节对解出来是某个字 */
function 建表(decoder) {
  const m = new Map();
  for (let a = 0x81; a <= 0xfe; a++) {
    for (let b = 0x40; b <= 0xfe; b++) {
      if (b === 0x7f) continue;
      const t = decoder.decode(Uint8Array.from([a, b]));
      if (t.length === 1 && t !== '\uFFFD' && !m.has(t)) m.set(t, [a, b]);
    }
  }
  return m;
}
console.log('建反查表…');
const 表gbk = 建表(gbk);
const 表sjis = 建表(sjis);

const 编 = (表, s) => {
  const out = [];
  for (const ch of s) {
    /* ASCII 是单字节，两张表里都没有它 —— 直接按码位放 */
    if (ch.codePointAt(0) < 0x80) {
      out.push(ch.codePointAt(0));
      continue;
    }
    const c = 表.get(ch);
    if (!c) return null;
    out.push(...c);
  }
  return Uint8Array.from(out);
};

/** 盘上的名字按 gbk 编回字节、再按 shift_jis 解 —— 这就是工具那条「gbk -> shift_jis」 */
function 候选(坏) {
  const b = 编(表gbk, 坏);
  if (!b) return null;
  try {
    return sjis.decode(b);
  } catch {
    return null;
  }
}

/** 判据一：双向无损（gbk -> sjis -> sjis -> gbk 一圈回来是不是原样） */
function 双向无损(坏) {
  const 一 = 候选(坏);
  if (!一) return false;
  const 二 = 编(表sjis, 一);
  if (!二) return false;
  try {
    return gbk.decode(二) === 坏;
  } catch {
    return false;
  }
}

/** 判据二：候选里每个汉字落在 Shift-JIS 第 1 级的比例（只看汉字，假名/符号/ASCII 不算） */
function 一级比例(候选文) {
  const 汉字 = [...候选文].filter((c) => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(c));
  if (!汉字.length) return { 比例: null, 数: 0, 生僻: [] };
  const 生僻 = [];
  let 好 = 0;
  for (const c of 汉字) {
    const b = 编(表sjis, c);
    if (b && b.length === 2 && b[0] >= 0x88 && b[0] <= 0x98) 好++;
    else 生僻.push(c);
  }
  return { 比例: 好 / 汉字.length, 数: 汉字.length, 生僻 };
}

const 样本 = [
  ['✅', '夵曄尦readme', '改変元readme'],
  ['✅', '丒巊梡曽朄', '・使用方法'],
  ['✅', '僄僢僕昤夋', 'エッジ描画'],
  ['✅', '傾僯儊晽夋柺僗僋儕乕儞', 'アニメ風画面スクリーン'],
  ['✅', 'readme(恓嬥P)', 'readme(針金P)'],
  ['✅', 'readme-巊偄曽', 'readme-使い方'],
  ['⛔', '乱码翻译', null],
  ['⛔', '修复结果_过目用', null],
  ['⛔', '改名后', null],
  ['⛔', '翻译后', null],
  ['⛔', '还原后', null],
  ['⛔', '测试效果', null],
  ['⛔', 'PostRimShilouhette', null],
  ['⛔', 'AnimeScreenTex_v1.0', null]
];

console.log('\n样本'.padEnd(34) + '候选（gbk->sjis）'.padEnd(30) + '双向无损  一级比例');
for (const [谁, 坏, 真值] of 样本) {
  const c = 候选(坏);
  const 无损 = 双向无损(坏);
  const 比 = c ? 一级比例(c) : null;
  const 比s = 比 && 比.比例 !== null ? `${(比.比例 * 100).toFixed(0)}%（${比.数} 字${比.生僻.length ? '，生僻：' + 比.生僻.join('') : ''}）` : '（没汉字）';
  console.log(
    `${谁} ${坏.padEnd(30)} ${(c ?? '（编不进 gbk）').padEnd(26)} ${(无损 ? '无损 ✓' : '不是无损').padEnd(9)} ${比s}` +
      (真值 ? `   真值=${真值}` : '')
  );
}
