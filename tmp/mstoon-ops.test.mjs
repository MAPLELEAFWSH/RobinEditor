/**
 * ④ msToon 的组装函数自检。
 *
 * 跑：node --import ./tmp/register-loader.mjs tmp/mstoon-ops.test.mjs
 *
 * 这一套是补的：`buildControlMaps` / `buildEdge` / `buildSdf` 原来在
 * Mstoon.svelte 里（预览和导出各手抄一份映射），零断言，也加载不了。
 * 搬进 ops.ts 之后能测了 —— 钉住的是"搬的时候没搬错"这几条。
 *
 * 通道**语义**（R 基础 / G 高光 / B 阴影这些）不在这里验：那条的依据是
 * 作者的 shader，不是本工程的代码，见 ops.ts 里 MSTOON_CONVENTION 的注释。
 */
import { blankImageData } from '../src/lib/img.ts';
import {
  blankChain,
  buildControlMaps,
  buildEdge,
  buildSdfEncoded,
  buildSdfFromChannel,
  channelGray
} from '../src/lib/modules/mstoon/ops.ts';

let pass = 0;
let fail = 0;
function ok(cond, label, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${extra ? '  → ' + extra : ''}`);
  }
}
function eq(a, b, label) {
  ok(a === b, label, `实得 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}`);
}
function section(t) {
  console.log(`\n== ${t} ==`);
}

// 自检 ok()：参数顺序是 (条件, 标签)，写反了非空字符串恒为真，整套会假装全过
{
  const before = fail;
  const realLog = console.log;
  console.log = () => {};
  ok(false, '__selfcheck__');
  console.log = realLog;
  if (fail !== before + 1) {
    console.error('ok() 本身是坏的：条件为假没被记成失败');
    process.exit(1);
  }
  fail = before;
}

/** 造图：fn 给每个像素的 [r,g,b,a] */
function mk(w, h, fn) {
  const img = blankImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const p = fn(x, y);
      img.data[i] = p[0];
      img.data[i + 1] = p[1];
      img.data[i + 2] = p[2];
      img.data[i + 3] = p[3] ?? 255;
    }
  }
  return img;
}
/** 取某一路的全部值 */
function plane(img, ch) {
  const off = { r: 0, g: 1, b: 2, a: 3 }[ch];
  const out = new Uint8ClampedArray(img.width * img.height);
  for (let i = 0; i < out.length; i++) out[i] = img.data[i * 4 + off];
  return out;
}
const uniq = (a) => new Set(a).size;
const onGrid = (a) => {
  let n = 0;
  for (const v of a) {
    const g = (v / 255) * 20;
    if (Math.abs(g - Math.round(g)) < 0.08) n++;
  }
  return n / a.length;
};

/* ============================================================ */
section('1. 通道规格：源 / 常量 / ladder');

{
  const chain = blankChain(0.6);
  eq(chain.mode, 'ladder', 'blankChain 默认是 ladder');
  eq(chain.ladder.def, 0.6, 'def 留着');
  eq(chain.ladder.rungs.length, 0, 'rungs 是空的');
  eq(chain.stretchMode, 'none', '默认不拉伸');

  // 常量模式：整张铺成 def
  const constSpec = {
    r: { ...blankChain(0.4), mode: 'const' },
    g: { ...blankChain(1.0), mode: 'const' },
    b: { ...blankChain(0.0), mode: 'const' },
    a: { ...blankChain(1.0), mode: 'const' }
  };
  const c = buildControlMaps(mk(8, 8, () => [0, 0, 0, 255]), constSpec, false);
  eq(uniq(plane(c, 'r')), 1, '常量 R 只有一个值');
  eq(plane(c, 'r')[0], Math.round(0.4 * 255), '常量 R = def × 255');
  eq(plane(c, 'g')[0], 255, '常量 G = 1.0');
  eq(plane(c, 'b')[0], 0, '常量 B = 0.0');
  eq(plane(c, 'a')[0], 255, '常量 A = 1.0');

  // 空 ladder + 非常量模式 = 也是铺平（官方包那几张不是平的，所以默认值要自己调）
  const flat = buildControlMaps(mk(8, 8, (x) => [x * 30, 0, 0, 255]), {
    r: blankChain(0.2), g: blankChain(0.2), b: blankChain(0.2), a: blankChain(1.0)
  }, false);
  eq(uniq(plane(flat, 'r')), 1, '空 ladder 铺平（这是默认参数的样子）');
  eq(plane(flat, 'r')[0], Math.round(0.2 * 255), '铺成 def');

  // 取源通道：R 拿源图的哪一路
  const src = mk(6, 6, () => [10, 20, 30, 255]);
  const picked = buildControlMaps(src, {
    r: { ...blankChain(0), mode: 'source', ch: 'b' },
    g: { ...blankChain(0), mode: 'source', ch: 'g' },
    b: { ...blankChain(0), mode: 'source', ch: 'r' },
    a: { ...blankChain(1.0), mode: 'const' }
  }, false);
  eq(plane(picked, 'r')[0], 30, 'R 取源图的 B');
  eq(plane(picked, 'g')[0], 20, 'G 取源图的 G');
  eq(plane(picked, 'b')[0], 10, 'B 取源图的 R');

  // 反相
  const inv = buildControlMaps(src, {
    r: { ...blankChain(0), mode: 'source', ch: 'r', invert: true },
    g: { ...blankChain(0), mode: 'source', ch: 'g' },
    b: { ...blankChain(0), mode: 'source', ch: 'b' },
    a: { ...blankChain(1.0), mode: 'const' }
  }, false);
  eq(plane(inv, 'r')[0], 245, '反相 = 255 - 10');
  eq(plane(inv, 'g')[0], 20, '没反的那路不动');
}

/* ============================================================ */
section('2. 尺寸跟着源图走');

{
  for (const [w, h] of [[7, 11], [64, 64], [1, 3]]) {
    const spec = {
      r: { ...blankChain(0), mode: 'source', ch: 'r' },
      g: { ...blankChain(0), mode: 'source', ch: 'g' },
      b: { ...blankChain(0), mode: 'source', ch: 'b' },
      a: { ...blankChain(1.0), mode: 'const' }
    };
    const out = buildControlMaps(mk(w, h, () => [1, 2, 3, 255]), spec, false);
    ok(out.width === w && out.height === h, `${w}×${h} 尺寸照抄`, `实得 ${out.width}×${out.height}`);
  }
}

/* ============================================================ */
section('3. 吸附 0.05 网格');

{
  // 源值故意乱：吸附前一堆值不在网格上，吸附后全在
  const src = mk(40, 40, (x, y) => [
    Math.round((x * 255) / 39),
    Math.round((y * 255) / 39),
    (x * y) % 256,
    255
  ]);
  const spec = {
    r: { ...blankChain(0), mode: 'source', ch: 'r' },
    g: { ...blankChain(0), mode: 'source', ch: 'g' },
    b: { ...blankChain(0), mode: 'source', ch: 'b' },
    a: { ...blankChain(1.0), mode: 'const' }
  };
  const raw = buildControlMaps(src, spec, false);
  const snapped = buildControlMaps(src, spec, true);

  ok(onGrid(plane(raw, 'r')) < 0.6, '不吸附时大部分值不在网格上',
    `实得 ${(onGrid(plane(raw, 'r')) * 100).toFixed(1)}%`);
  eq(onGrid(plane(snapped, 'r')), 1, '吸附后 100% 在 0.05 网格上');
  eq(onGrid(plane(snapped, 'g')), 1, 'G 也是');
  ok(uniq(plane(snapped, 'r')) < uniq(plane(raw, 'r')), '吸附会把值收敛到少数几档');
  // 端点要保住
  const s = plane(snapped, 'r');
  eq(Math.min(...s), 0, '0 还是 0');
  eq(Math.max(...s), 255, '255 还是 255');
}

/* ============================================================ */
section('4. EdgeRate');

{
  // 左半边黑、右半边白 → 交界处一条竖线
  const src = mk(64, 64, (x) => (x < 32 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  const o = { threshold: 60, soft: false, softWidth: 40, denoise: false, normalize: false, toGB: false };
  const hard = buildEdge(src, o);
  eq(hard.out.width, 64, '尺寸照抄');
  eq(uniq(plane(hard.out, 'g')), 1, 'G 恒定（作者说 G 没用，默认只写 R）');
  eq(plane(hard.out, 'g')[0], 0, 'G 是 0');
  eq(uniq(plane(hard.out, 'b')), 1, 'B 恒定');
  eq(uniq(plane(hard.out, 'r')), 2, '硬阈值只有两个值');

  // 强度大的地方 R 必须是高的
  let hot = 0;
  let hotR = 0;
  const rp = plane(hard.out, 'r');
  for (let i = 0; i < hard.strength.length; i++) {
    if (hard.strength[i] > 127) {
      hot++;
      if (rp[i] > 127) hotR++;
    }
  }
  ok(hot > 0, '有描边像素', `数 ${hot}`);
  eq(hotR, hot, '强度 >127 的像素，R 也 >127');

  // 软过渡：档位变多。得用梯度**有大小之分**的图 —— 理想阶跃的梯度是单值，
  // 软硬都一样（这一条是我先写错、被它打回来的）
  const blob = mk(64, 64, (x, y) => {
    const v = Math.round(255 * Math.exp(-(((x - 32) ** 2 + (y - 32) ** 2) / 200)));
    return [v, v, v, 255];
  });
  const softHard = buildEdge(blob, o);
  const soft = buildEdge(blob, { ...o, soft: true });
  ok(uniq(plane(soft.out, 'r')) > uniq(plane(softHard.out, 'r')), '软过渡比硬阈值档位多',
    `${uniq(plane(soft.out, 'r'))} > ${uniq(plane(softHard.out, 'r'))}`);

  // toGB 打开：G/B 跟 R 一样
  const gb = buildEdge(src, { ...o, toGB: true });
  eq(uniq(plane(gb.out, 'g')), uniq(plane(gb.out, 'r')), 'toGB 时 G 的值集合跟 R 一样');
  const r2 = plane(gb.out, 'r');
  const g2 = plane(gb.out, 'g');
  let same = true;
  for (let i = 0; i < r2.length; i++) if (r2[i] !== g2[i]) same = false;
  ok(same, 'toGB 时 G 逐像素等于 R');

  // 强度平面单独返回（界面拿它叠对照图）
  eq(hard.strength.length, 64 * 64, '强度平面尺寸对');
}

/* ============================================================ */
section('5. FaceSDF');

{
  const src = mk(64, 64, (x) => (x < 32 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  /* 距离场那条路现在按游戏码通道，三套排法都是量出来的（见 $lib/sdf.ts）。
     这里守住"结构"：哪个通道放场、哪个放遮罩、哪个恒常量。 */
  const 跑 = (game, mark = null) =>
    buildSdfEncoded(src, { threshold: 110, maxDist: 24, invert: false, toA: true, game, mark });

  const gi = 跑('genshin');
  eq(gi.out.width, 64, '尺寸照抄');
  eq(gi.mask.length, 64 * 64, '掩膜尺寸对');
  eq(gi.field.length, 64 * 64, '距离场尺寸对');
  eq(uniq(gi.mask), 2, '掩膜是二值的');
  ok(uniq(gi.field) > 2, '距离场是渐变的，不是二值', `唯一值 ${uniq(gi.field)}`);
  ok(Math.min(...gi.field) < 128 && Math.max(...gi.field) > 128, '距离场跨过中值',
    `min ${Math.min(...gi.field)} max ${Math.max(...gi.field)}`);
  {
    const p = (ch) => plane(gi.out, ch);
    let 四路同 = true;
    for (let i = 0; i < p('r').length; i++) {
      if (p('r')[i] !== p('g')[i] || p('r')[i] !== p('b')[i] || p('r')[i] !== p('a')[i]) 四路同 = false;
    }
    ok(四路同, '原神式：四个通道放同一个灰度场（实测 5 张都这样）');
  }

  /* 星铁式：R 三档（0/0.5/1）、G 两档、B 空、A 放场 */
  const 标 = mk(64, 64, (x, y) => (x > 32 && y < 16 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  const hsr = 跑('hsr', 标);
  {
    const R = plane(hsr.out, 'r');
    const G = plane(hsr.out, 'g');
    const B = plane(hsr.out, 'b');
    eq(uniq(R), 3, '星铁式：R 是三档');
    eq(uniq(G), 2, '星铁式：G 是两档');
    eq(uniq(B), 1, '星铁式：B 恒定');
    eq(B[0], 0, '星铁式：B = 0');
    ok(R.includes(128), '星铁式：标过的地方出现 0.5');
    eq(plane(hsr.out, 'a')[0], hsr.field[0], '星铁式：A 放的是场');
    const hsr无标 = 跑('hsr');
    eq(uniq(plane(hsr无标.out, 'r')), 2, '不给标记图时 R 只有 0/1（不瞎猜 0.5）');
  }

  /* 绝区零式：R 场、G 恒 0.5、B 空、A 满 */
  const zzz = 跑('zzz');
  {
    eq(uniq(plane(zzz.out, 'g')), 1, '绝区零式：G 恒定');
    eq(plane(zzz.out, 'g')[0], 128, '绝区零式：G = 0.5');
    eq(plane(zzz.out, 'b')[0], 0, '绝区零式：B = 0');
    eq(uniq(plane(zzz.out, 'a')), 1, '绝区零式：A 恒定');
    eq(plane(zzz.out, 'a')[0], 255, '绝区零式：A 拉满');
    let R同场 = true;
    const R = plane(zzz.out, 'r');
    for (let i = 0; i < R.length; i++) if (R[i] !== zzz.field[i]) R同场 = false;
    ok(R同场, '绝区零式：R 放的是场');
  }

  /* 反相：掩膜翻过来 */
  const 反 = buildSdfEncoded(src, { threshold: 110, maxDist: 24, invert: true, toA: true, game: 'genshin' });
  let flipped = 0;
  for (let i = 0; i < 反.mask.length; i++) if (反.mask[i] !== gi.mask[i]) flipped++;
  eq(flipped, 反.mask.length, '反相把掩膜整个翻过来');
}

/* ============================================================ */
section('6. FaceSDF 的另一条路：直接取通道');

{
  // 源图故意让四路各不相同，好看出取的是哪一路
  const src = mk(16, 16, (x, y) => [10 + (x % 5), 40 + (y % 7), 200, 130]);

  // 原神那条：取脸部 lightmap 的 G，直接铺
  const gi = buildSdfFromChannel(src, { ch: 'g', invert: false });
  const g = plane(src, 'g');
  const gor = plane(gi, 'r');
  let same = true;
  for (let i = 0; i < g.length; i++) if (gor[i] !== g[i]) same = false;
  ok(same, '取 G：产出的 R 就是源的 G');
  eq(uniq(plane(gi, 'r')), uniq(g), 'R 的唯一值个数跟源那一路一样');

  // 形状是量出来的：R 放数据、G/B 恒 0、A 恒 1（素材里那两张 SDF 产物都这样）
  eq(uniq(plane(gi, 'g')), 1, 'G 恒定');
  eq(plane(gi, 'g')[0], 0, 'G = 0');
  eq(uniq(plane(gi, 'b')), 1, 'B 恒定');
  eq(plane(gi, 'b')[0], 0, 'B = 0');
  eq(uniq(plane(gi, 'a')), 1, 'A 恒定');
  eq(plane(gi, 'a')[0], 255, 'A = 1');
  ok(uniq(plane(gi, 'r')) > 1, 'R 才是数据');

  // 星铁那条：取 A，反相
  const hsr = buildSdfFromChannel(src, { ch: 'a', invert: true });
  eq(plane(hsr, 'r')[0], 255 - 130, '取 A 反相：255 − 130 = 125');
  ok(uniq(plane(hsr, 'r')) === 1, '源 A 是常量时产出也常量（这张源图 A 就是常量）');
  eq(plane(hsr, 'a')[0], 255, '取通道那条路的 A 恒定 255（不跟着反相）');

  // 尺寸照抄，不缩不裁
  eq(gi.width, 16, '尺寸照抄（宽）');
  eq(gi.height, 16, '尺寸照抄（高）');

  // 跟距离场那条路要**不同**：别把两者搞成一回事
  const dist = buildSdfEncoded(src, { threshold: 110, maxDist: 8, invert: false, toA: true, game: 'genshin' });
  ok(uniq(plane(gi, 'r')) !== uniq(plane(dist.out, 'r')) || plane(gi, 'r')[0] !== plane(dist.out, 'r')[0],
    '取通道 ≠ 距离场（两条路确实不是一个东西）');

  // 灰度导出：三路同值，且等于那一路
  const gray = channelGray(src, 'b');
  const b = plane(src, 'b');
  eq(uniq(plane(gray, 'r')), uniq(b), '灰度图唯一值个数跟源那一路一样');
  eq(plane(gray, 'r')[0], b[0], '灰度图 R = 源那一路');
  let tri = true;
  for (let i = 0; i < b.length; i++) {
    if (plane(gray, 'r')[i] !== plane(gray, 'g')[i] || plane(gray, 'r')[i] !== plane(gray, 'b')[i]) tri = false;
  }
  ok(tri, '灰度图三路同值');
  const grayInv = channelGray(src, 'b', true);
  eq(plane(grayInv, 'r')[0], 255 - b[0], '灰度图也能反相');
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);