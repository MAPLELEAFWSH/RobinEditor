/**
 * 各游戏 SDF 排法的测试（`src/lib/sdf.ts` 的 `encodeSdf`）。
 *
 * 三套排法是**量出来的**，不是设计的：`tools/sdf-spec.py` 量了规格目录 17 张
 * （`…\参考工具制作的效果\MSToon\原神\SDF规格\<游戏>\`）：
 *   原神   四通道逐像素 100% 相同
 *   星铁   R 三档（0/0.5/1，0.5 那片占 9%）、G 两档、B 全 0、A 放场
 *   绝区零 R 放场、G 恒 0.5（99%）、B 全 0、A 满（86%）
 * 这里守住"排法结构"，不比对具体数值 —— 场怎么算由 signedDistanceField 那套保证。
 */
import { encodeSdf, ENCODINGS } from '../src/lib/sdf.ts';

let n = 0;
let bad = 0;
const ok = (c, m) => {
  n++;
  if (!c) {
    bad++;
    console.log(`  FAIL ${m}`);
  }
};
const eq = (a, b, m) => ok(a === b, `${m}（期望 ${b}，实得 ${a}）`);

const W = 32;
const H = 32;
const N = W * H;
/* 做一份像样的输入：左半边"里面"、右半边"外面"，中间一条软边 */
const signed = new Uint8ClampedArray(N);
const mask = new Uint8ClampedArray(N);
const boundary = new Uint8ClampedArray(N);
const mark = new Uint8ClampedArray(N);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const 内 = x < W / 2;
    mask[i] = 内 ? 255 : 0;
    signed[i] = 内 ? 200 : 60;
    boundary[i] = x === W / 2 ? 255 : 0;
    /* 里面靠上的一小片当"手标成 0.5"的地方 */
    mark[i] = 内 && y < H / 4 ? 255 : 0;
  }
}

const 跑 = (enc, m = null) => encodeSdf(W, H, signed, mask, boundary, enc, { lineValue: 0.9, baseValue: 0.5, mark: m });

const 取 = (img, i, c) => img.data[i * 4 + c];
const 全同 = (img, a, b) => {
  for (let i = 0; i < N; i++) if (取(img, i, a) !== 取(img, i, b)) return false;
  return true;
};

/* ---------- 原神：四通道同一个场 ---------- */
{
  const 出 = 跑('genshin');
  ok(全同(出, 0, 1) && 全同(出, 0, 2) && 全同(出, 0, 3), '原神式：四个通道逐像素相同（实测 5 张都这样）');
  eq(取(出, 0, 0), 200, '里面那半边写的是场值');
  /* 破坏性对照：随便改一个通道就不再"四通道一致"了 */
  const 坏 = new ImageData(new Uint8ClampedArray(出.data), W, H);
  坏.data[3] = 7;
  ok(!全同(坏, 0, 3), '对照：动一个通道之后这条就红了（判据真的在看东西）');
}

/* ---------- 星铁：R 三档 / G 两档 / B 空 / A 场 ---------- */
{
  const 出 = 跑('hsr', mark);
  const R值 = new Set();
  const G值 = new Set();
  for (let i = 0; i < N; i++) {
    R值.add(取(出, i, 0));
    G值.add(取(出, i, 1));
  }
  eq([...R值].sort((a, b) => a - b).join(','), '0,128,255', '星铁式：R 只有 0/128/255 三档');
  eq([...G值].sort((a, b) => a - b).join(','), '0,255', '星铁式：G 是二值');
  let B非零 = 0;
  for (let i = 0; i < N; i++) if (取(出, i, 2) !== 0) B非零++;
  eq(B非零, 0, '星铁式：B 全 0');
  ok(全同(出, 3, 3) && 取(出, 0, 3) === 200, '星铁式：A 放的是场');
  /* 标过的地方是 128，没标的里面是 255 */
  const 标点 = 0 * W + 4; // 里面、上半 → 标过
  const 未标点 = 20 * W + 4; // 里面、下半 → 没标
  eq(取(出, 标点, 0), 128, '标过的地方 R = 0.5');
  eq(取(出, 未标点, 0), 255, '没标但属于掩膜的地方 R = 1');
  eq(取(出, 20 * W + 20, 0), 0, '掩膜外 R = 0');
  /* 不给标记图时不该炸，也不该凭空造出 0.5 */
  const 无标 = 跑('hsr', null);
  const R值2 = new Set();
  for (let i = 0; i < N; i++) R值2.add(取(无标, i, 0));
  eq([...R值2].sort((a, b) => a - b).join(','), '0,255', '不给标记图时 R 只有 0/255（不瞎猜 0.5）');
}

/* ---------- 绝区零：R 场 / G 恒 0.5 / B 空 / A 满 ---------- */
{
  const 出 = 跑('zzz');
  let G不齐 = 0;
  let B非零 = 0;
  let A不满 = 0;
  for (let i = 0; i < N; i++) {
    if (取(出, i, 1) !== 128) G不齐++;
    if (取(出, i, 2) !== 0) B非零++;
    if (取(出, i, 3) !== 255) A不满++;
  }
  eq(G不齐, 0, '绝区零式：G 恒 0.5');
  eq(B非零, 0, '绝区零式：B 全 0');
  eq(A不满, 0, '绝区零式：A 拉满');
  eq(取(出, 0, 0), 200, '绝区零式：R 放场');
}

/* ---------- msToon 式与纯距离场 ---------- */
{
  const 出 = 跑('mstoon');
  eq(取(出, 0, 0), 128, 'msToon 式：非交界线处是中性 0.5');
  eq(取(出, W / 2, 0), 230, 'msToon 式：交界线挑到 0.9');
  let G非零 = 0;
  for (let i = 0; i < N; i++) if (取(出, i, 1) !== 0) G非零++;
  eq(G非零, 0, 'msToon 式：G 空');

  const 平 = 跑('plain');
  ok(全同(平, 0, 1) && 全同(平, 0, 2), '纯距离场：R/G/B 同一份');
  eq(取(平, 0, 3), 255, '纯距离场：A 拉满');
}

/* ---------- 编码表本身：三套游戏都要在，而且每套都有说明 ---------- */
{
  const id集 = ENCODINGS.map((e) => e.id);
  for (const 要 of ['genshin', 'hsr', 'zzz']) {
    ok(id集.includes(要), `编码表里有 ${要}`);
    ok((ENCODINGS.find((e) => e.id === 要)?.hint ?? '').length > 10, `${要} 那条要有说明（界面上直接显示）`);
  }
}

console.log(`sdf-encode：${n} 条断言，${bad} 条没过`);
process.exit(bad ? 1 : 0);
