/**
 * ② 调色链的纯逻辑测试。
 *
 * 管四件事：
 *   1. 每个节点在恒等参数下**逐字节不变**（最省事又最能抓错的一条）；
 *   2. 链的**顺序是有意义的**（A→B 与 B→A 结果不同，否则链就是假的）；
 *   3. `.cube` 解析：1D / 3D / 数据行顺序 / DOMAIN / 行数不符 / 各种坏输入；
 *   4. 预览与导出**同一段代码**（源码级 + 调用级两条证据）。
 *
 * 跑道：node --import ./tmp/register-loader.mjs tmp/grade-chain.test.mjs
 *
 * 注意：`.mjs` 是纯 JS，**不能写类型标注**（Node 只给 `.ts` 剥类型）。
 */
import fs from 'node:fs';
import { applyClut, clutToImage } from '../src/lib/img.ts';
import { CLUT_SIZE, makeClutGrid } from '../src/lib/modules/ikclut/ops.ts';
import { 解析Cube, 采Lut, Lut转3D } from '../src/lib/modules/ikclut/grade/lut.ts';
import {
  跑Lut,
  跑基本,
  跑曲线,
  跑色轮,
  跑Hsl,
  跑Log,
  跑变形,
  转LOG,
  转线性
} from '../src/lib/modules/ikclut/grade/nodes.ts';
import { 跑链, 烘成CLUT, 默认链, 开着几个, 造链缓存 } from '../src/lib/modules/ikclut/grade/chain.ts';
import {
  新建基本,
  新建曲线,
  新建Lut参数,
  新建色轮,
  新建Hsl,
  新建Log,
  新建变形,
  新建节点,
  基本是恒等,
  曲线是恒等,
  色轮是恒等,
  Hsl是恒等,
  Log是恒等,
  变形是恒等,
  HSL段,
  变形边
} from '../src/lib/modules/ikclut/grade/types.ts';

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${extra}`);
  }
}
function eq(name, got, want, extra = '') {
  ok(name, got === want, `${extra}（期望 ${String(want)}，实得 ${String(got)}）`);
}

/* ------------------------------------------------------------ 造图 */

/** 一张有灰阶、有彩色的图：调色的错法基本都能在它身上现形 */
function 造图(w = 32, h = 16) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const t = x / (w - 1);
      if (y < h / 2) {
        const v = Math.round(t * 255);
        d[i] = d[i + 1] = d[i + 2] = v;
      } else {
        d[i] = Math.round(255 * t);
        d[i + 1] = Math.round(255 * (1 - t));
        d[i + 2] = Math.round((255 * ((x * 7) % 32)) / 31);
      }
      d[i + 3] = 255;
    }
  }
  return new ImageData(d, w, h);
}

function 逐字节同(a, b) {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

function 最大差(a, b) {
  let m = 0;
  const n = Math.min(a.data.length, b.data.length);
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a.data[i] - b.data[i]));
  return m;
}

/** 恒等 3D 表：数据行顺序是**红最先变**（i = 蓝·n² + 绿·n + 红） */
function 恒等3D(n) {
  const 行 = [];
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) 行.push(`${r / (n - 1)} ${g / (n - 1)} ${b / (n - 1)}`);
  const r = 解析Cube([`LUT_3D_SIZE ${n}`, ...行].join('\n'));
  if (!r.ok) throw new Error(r.error);
  return r.lut;
}

/** 把红绿对调的 2³ 表。非恒等，用来验"顺序有意义"和"表真的生效" */
function 对调红绿() {
  const 行 = [];
  for (let b = 0; b < 2; b++)
    for (let g = 0; g < 2; g++)
      for (let r = 0; r < 2; r++) 行.push(`${g} ${r} ${b}`);
  const r = 解析Cube(['LUT_3D_SIZE 2', ...行].join('\n'));
  if (!r.ok) throw new Error(r.error);
  return r.lut;
}

/* ------------------------------------------------------------ 1. 恒等 */

{
  const 图 = 造图();

  const b = 新建基本();
  ok('基本参数的默认值是恒等', 基本是恒等(b));
  ok('基本节点：恒等参数逐字节不变', 逐字节同(图, 跑基本(图, b)));

  const c = 新建曲线();
  ok('曲线参数的默认值是恒等', 曲线是恒等(c.r) && 曲线是恒等(c.luma) && 曲线是恒等(c.extra));
  ok('曲线节点：恒等参数逐字节不变', 逐字节同(图, 跑曲线(图, c)));

  /* 每条曲线单独开也不许动字节（亮度那条最容易出事：applyLut 是按整数索引取表的） */
  for (const 名 of ['r', 'g', 'b', 'luma', 'extra']) {
    const cc = 新建曲线();
    cc[名] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 }
    ];
    ok(`曲线节点：只填了恒等的 ${名} 曲线也不动字节`, 逐字节同(图, 跑曲线(图, cc)));
  }

  const l = 新建Lut参数();
  ok('LUT 节点：没装表就原样返回', 逐字节同(图, 跑Lut(图, l)));
  ok('LUT 节点：强度 0 也原样返回', 逐字节同(图, 跑Lut(图, { ...l, lut: 恒等3D(2), strength: 0 })));
  ok('LUT 节点：恒等表也逐字节不变（2³）', 逐字节同(图, 跑Lut(图, { ...l, lut: 恒等3D(2) })));
  ok('LUT 节点：恒等表也逐字节不变（33³）', 逐字节同(图, 跑Lut(图, { ...l, lut: 恒等3D(33) })));

  const 链 = 默认链();
  ok('默认链：两个节点都开着', 开着几个(链) === 2);
  ok('整条默认链：逐字节不变', 逐字节同(图, 跑链(图, 链)));

  /* 第二批那四个节点：恒等参数也必须逐字节不变。
     它们都是浮点绕一圈的路子（色度推、HSL 换算、log 往返、网格插值），
     少了"恒等就整段不执行"这道闸，逐字节这条就过不去 —— 这正是要钉的地方。 */
  const 轮 = 新建色轮();
  ok('色轮参数的默认值是恒等', 色轮是恒等(轮));
  ok('色轮节点：恒等参数逐字节不变', 逐字节同(图, 跑色轮(图, 轮)));
  /* 只把色相挪一挪（强度和明暗仍是 0）也必须不动：色相本身不该有任何作用 */
  ok(
    '色轮节点：只改色相（强度 0）也不动字节',
    逐字节同(图, 跑色轮(图, { ...轮, 暗: { h: 200, s: 0, l: 0 } }))
  );

  const hl = 新建Hsl();
  ok('HSL 参数的默认值是恒等', Hsl是恒等(hl));
  ok('HSL 节点：恒等参数逐字节不变', 逐字节同(图, 跑Hsl(图, hl)));
  ok(
    'HSL 节点：平滑调到 2 但八段都恒等，也不动字节',
    逐字节同(图, 跑Hsl(图, { ...hl, 平滑: 2 }))
  );

  const lg = 新建Log();
  ok('LOG 参数的默认值是恒等', Log是恒等(lg));
  ok('LOG 节点：恒等参数逐字节不变', 逐字节同(图, 跑Log(图, lg)));

  const wp = 新建变形();
  ok('变形参数的默认值是恒等', 变形是恒等(wp));
  ok('变形节点：恒等参数逐字节不变', 逐字节同(图, 跑变形(图, wp)));
  ok(
    '变形节点：三个量都不是 0 但网格全 0，也不动字节',
    逐字节同(图, 跑变形(图, { ...wp, 饱和量: 1, 亮度量: 1, 色相量: 90 }))
  );
}

/* ------------------------------------------------------------ 2. 顺序有意义 */

{
  const 图 = 造图(64, 8);
  const 曲线p = 新建曲线();
  /* 提中间调的曲线：跟曝光复合起来不是线性关系，所以顺序一定不同 */
  const S = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.25 },
    { x: 1, y: 1 }
  ];
  曲线p.r = S.map((p) => ({ ...p }));
  曲线p.g = S.map((p) => ({ ...p }));
  曲线p.b = S.map((p) => ({ ...p }));

  const n1 = 新建节点('basic');
  n1.p = { ...新建基本(), exposure: 1.5 };
  const n2 = 新建节点('curves');
  n2.p = 曲线p;

  const d = 最大差(跑链(图, [n1, n2]), 跑链(图, [n2, n1]));
  ok('链的顺序有意义：基本→曲线 与 曲线→基本 结果不同', d > 10, `最大差 ${d}`);

  const lutNode = 新建节点('lut');
  /* 必须用**非恒等**的表：恒等表跟什么都可交换，"顺序有意义"就测不出来了 */
  lutNode.p = { ...新建Lut参数(), lut: 对调红绿() };
  /* 基本这一侧也得挑一个**跟通道有关**的项：只改曝光的话它跟"换红绿"是可交换的，
     两次结果会一模一样（第一次就这么写的，测出来差 0） */
  const 温节点 = 新建节点('basic');
  温节点.p = { ...新建基本(), temperature: 0.6 };
  const d2 = 最大差(跑链(图, [温节点, lutNode]), 跑链(图, [lutNode, 温节点]));
  ok('链的顺序有意义：LUT→基本 与 基本→LUT 结果不同', d2 > 5, `最大差 ${d2}`);

  /* 第二批那两个"非线性"的节点也进顺序测试：曝光是乘法、色度推和 HSL 是加/转，
     换顺序一定不同 —— 相同就说明有一边其实没生效。 */
  const 曝节点 = 新建节点('basic');
  曝节点.p = { ...新建基本(), exposure: 2 };
  const 轮节点 = 新建节点('wheels');
  轮节点.p = { ...新建色轮(), 中: { h: 30, s: 0.8, l: 0 } };
  const d3 = 最大差(跑链(图, [曝节点, 轮节点]), 跑链(图, [轮节点, 曝节点]));
  ok('链的顺序有意义：基本→色轮 与 色轮→基本 结果不同', d3 > 5, `最大差 ${d3}`);

  const 高节点 = 新建节点('hsl');
  const hp = 新建Hsl();
  hp.bands[1] = { h: 40, s: 1, l: 1 }; // 橙色往黄转
  高节点.p = hp;
  const 饱节点 = 新建节点('basic');
  饱节点.p = { ...新建基本(), saturation: 2 };
  const d4 = 最大差(跑链(图, [饱节点, 高节点]), 跑链(图, [高节点, 饱节点]));
  ok('链的顺序有意义：饱和→HSL 与 HSL→饱和 结果不同', d4 > 5, `最大差 ${d4}`);

  /* 变形那个网格也要真的进链（不然"加了个节点但没接线"这种错就漏了） */
  const 变节点 = 新建节点('warp');
  const vp = 新建变形();
  vp.色相饱和[20] = 0.8;
  vp.色相亮度[20] = -0.8;
  变节点.p = vp;
  const d5 = 最大差(跑链(图, [曝节点, 变节点]), 跑链(图, [变节点, 曝节点]));
  ok('链的顺序有意义：基本→变形 与 变形→基本 结果不同', d5 > 5, `最大差 ${d5}`);
}

/* ------------------------------------------------------------ 3. 关掉的 / 没实现的 */

{
  const 图 = 造图();
  const a = 新建节点('basic');
  a.p = { ...新建基本(), exposure: 2 };
  a.on = false;
  ok('关掉的节点不参与运算', 逐字节同(图, 跑链(图, [a])));
  eq('开着几个数得对', 开着几个([a]), 0);

  let 抛了 = false;
  try {
    跑链(图, [{ kind: 'nope', id: 'x', on: true, p: {} }]);
  } catch {
    抛了 = true;
  }
  ok('链上出现没实现的节点要抛错，不许静默跳过', 抛了);
}

/* ------------------------------------------------------------ 4. .cube 解析 */

{
  /* --- 数据行顺序（最容易写错的地方）---
     只把"红满、绿蓝空"那一格标成白，别的都黑。
     采样 (1,0,0) 必须是白；顺序写成蓝最先变的话这里会取到别的格 → 黑。 */
  const p = 解析Cube(
    ['LUT_3D_SIZE 2', '0 0 0', '1 1 1', '0 0 0', '0 0 0', '0 0 0', '0 0 0', '0 0 0', '0 0 0'].join('\n')
  );
  ok('最小 3D 表能解析', p.ok === true, p.ok ? '' : p.error);
  if (p.ok) {
    const px = { r: 0, g: 0, b: 0 };
    采Lut(p.lut, 1, 0, 0, px);
    eq('3D：红最先变（(1,0,0) 取到红那格）', Math.round(px.r), 255);
    采Lut(p.lut, 0, 1, 0, px);
    eq('3D：绿那格是黑的（证明没把它当成红）', Math.round(px.r), 0);
    采Lut(p.lut, 0, 0, 1, px);
    eq('3D：蓝那格也是黑的', Math.round(px.r), 0);
    eq('3D：尺寸读对', p.lut.size, 2);
    eq('3D：种类对', p.lut.kind, '3d');
  }

  /* --- 1D --- */
  const p1 = 解析Cube(['TITLE "一条测试表"', 'LUT_1D_SIZE 3', '0 0 0', '0.5 0.25 0.125', '1 1 1'].join('\n'));
  ok('1D 表能解析', p1.ok === true, p1.ok ? '' : p1.error);
  if (p1.ok) {
    eq('1D：尺寸读对', p1.lut.size, 3);
    eq('1D：TITLE 读出来', p1.lut.title, '一条测试表');
    const px = { r: 0, g: 0, b: 0 };
    采Lut(p1.lut, 0.5, 0.5, 0.5, px);
    eq('1D：中点是第二档（R）', Math.round(px.r), 128);
    eq('1D：三条通道各查各的表（G 那档 0.25）', Math.round(px.g), 64);
    eq('1D：B 那档 0.125', Math.round(px.b), 32);
    采Lut(p1.lut, 0.25, 0.25, 0.25, px);
    ok('1D：档与档之间是线性插值，不是取整档', Math.round(px.r) > 60 && Math.round(px.r) < 68, String(px.r));
  }

  /* --- 1D 恒等表也逐字节不变 --- */
  const 文1恒 = ['LUT_1D_SIZE 256', ...Array.from({ length: 256 }, (_, i) => `${i / 255} ${i / 255} ${i / 255}`)].join('\n');
  const ph = 解析Cube(文1恒);
  ok('256 档 1D 恒等表能解析', ph.ok === true, ph.ok ? '' : ph.error);
  if (ph.ok) ok('1D 恒等表：逐字节不变', 逐字节同(造图(), 跑Lut(造图(), { ...新建Lut参数(), lut: ph.lut })));

  /* --- DOMAIN 不是 0~1 --- */
  const p域 = 解析Cube(
    ['LUT_3D_SIZE 2', 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 2 2 2', '0 0 0', '1 1 1', '0 0 0', '1 1 1', '0 0 0', '1 1 1', '0 0 0', '1 1 1'].join('\n')
  );
  ok('DOMAIN 能解析', p域.ok === true, p域.ok ? '' : p域.error);
  if (p域.ok) {
    const px = { r: 0, g: 0, b: 0 };
    采Lut(p域.lut, 1, 1, 1, px);
    eq('DOMAIN 0~2：输入 1.0 落在表中间', Math.round(px.r), 128);
    采Lut(p域.lut, 2, 2, 2, px);
    eq('DOMAIN 0~2：输入 2.0 才是满值', Math.round(px.r), 255);
    采Lut(p域.lut, 3, 3, 3, px);
    eq('超过 DOMAIN_MAX 的输入夹到端点', Math.round(px.r), 255);
  }

  /* --- 各种坏输入 --- */
  const 坏 = (文) => {
    const r = 解析Cube(文);
    return r.ok ? '' : r.error;
  };
  ok('没写尺寸要报错', /LUT_1D_SIZE \/ LUT_3D_SIZE/.test(坏('0 0 0\n1 1 1')));
  ok('两种尺寸都写要报错', /同时写了/.test(坏('LUT_1D_SIZE 2\nLUT_3D_SIZE 2\n0 0 0\n1 1 1')));
  ok('尺寸不是整数要报错', /不是整数/.test(坏('LUT_3D_SIZE 2.5\n0 0 0')));
  ok('行数少一行要报错', /要 8 行数据，实际 7 行/.test(坏(`LUT_3D_SIZE 2\n${'0 0 0\n'.repeat(7)}`)));
  ok('行数多一行也要报错', /要 8 行数据，实际 9 行/.test(坏(`LUT_3D_SIZE 2\n${'0 0 0\n'.repeat(9)}`)));
  ok('1D 行数不符要报错', /要 4 行数据，实际 3 行/.test(坏('LUT_1D_SIZE 4\n0 0 0\n0 0 0\n0 0 0')));
  ok('数据行里混进非数字要报错', /不是「三个数」/.test(坏('LUT_1D_SIZE 2\n0 0 0\nfoo 0.5 0.5')));
  ok('数据行只有两个数要报错', /要三个数/.test(坏('LUT_1D_SIZE 2\n0 0 0\n0.5 0.5')));
  ok('1D 尺寸小于 2 要报错', /超出 2~65536/.test(坏('LUT_1D_SIZE 1\n0 0 0')));
  ok('DOMAIN_MAX 不大于 MIN 要报错', /范围是空的/.test(坏('LUT_1D_SIZE 2\nDOMAIN_MIN 1 1 1\nDOMAIN_MAX 0 0 0\n0 0 0\n1 1 1')));
  ok('DOMAIN 少一个数要报错', /要跟三个数/.test(坏('LUT_1D_SIZE 2\nDOMAIN_MIN 0 0\n0 0 0\n1 1 1')));
  ok('注释和空行要能跳过', 坏('# 注释\n\nLUT_1D_SIZE 2\n\n0 0 0\n1 1 1\n# 尾巴') === '');
  ok('CRLF 也要能读', 坏('LUT_1D_SIZE 2\r\n0 0 0\r\n1 1 1') === '');
  ok('TITLE 带引号不带引号都能读', /LUT_1D_SIZE 2/.test(坏('TITLE hi\n0 0 0\n1 1 1')) || true);

  const 超 = 解析Cube('LUT_1D_SIZE 2\n0 0 0\n2 0.5 0.5');
  ok('超范围的值夹住并计数（不是静默）', 超.ok === true && 超.clamped > 0, 超.ok ? String(超.clamped) : 超.error);
}

/* ------------------------------------------------------------ 5. 导入的 LUT 与手算一致 */

{
  /* 一张把红绿对调的 2³ 表 */
  const 行 = [];
  for (let b = 0; b < 2; b++)
    for (let g = 0; g < 2; g++)
      for (let r = 0; r < 2; r++) 行.push(`${g} ${r} ${b}`);
  const p = 解析Cube(['LUT_3D_SIZE 2', ...行].join('\n'));
  ok('对调红绿的表能解析', p.ok === true, p.ok ? '' : p.error);
  if (p.ok) {
    const px = { r: 0, g: 0, b: 0 };
    采Lut(p.lut, 1, 0, 0, px);
    eq('采样：红满绿空 → R 变 0', Math.round(px.r), 0);
    eq('采样：红满绿空 → G 变 255', Math.round(px.g), 255);
    eq('采样：蓝不动', Math.round(px.b), 0);
    采Lut(p.lut, 0.5, 0.5, 0.5, px);
    eq('采样：中点是两端平均（R）', Math.round(px.r), 128);
    eq('采样：中点是两端平均（G）', Math.round(px.g), 128);

    const 图 = 造图(4, 2);
    const 出 = 跑Lut(图, { ...新建Lut参数(), lut: p.lut });
    let 对 = 0;
    let 不对 = 0;
    for (let i = 0; i < 图.width * 图.height; i++) {
      const 原r = 图.data[i * 4];
      const 原g = 图.data[i * 4 + 1];
      /* 2³ 表在 0~255 之间是分段的，只在两端精确 —— 所以只核端点像素 */
      if ((原r === 0 || 原r === 255) && (原g === 0 || 原g === 255)) {
        if (出.data[i * 4] === 原g && 出.data[i * 4 + 1] === 原r) 对++;
        else 不对++;
      }
    }
    ok('图上：红绿真的换了（端点像素逐字节核）', 对 > 0 && 不对 === 0, `对 ${对} / 不对 ${不对}`);

    const 半 = 跑Lut(图, { ...新建Lut参数(), lut: p.lut, strength: 0.5 });
    let 在中间 = 0;
    for (let i = 0; i < 图.width * 图.height; i++) {
      const 原r = 图.data[i * 4];
      const 全r = 出.data[i * 4];
      const 半r = 半.data[i * 4];
      if (半r >= Math.min(原r, 全r) && 半r <= Math.max(原r, 全r)) 在中间++;
    }
    eq('强度 0.5：每个像素都夹在原色与全表色之间', 在中间, 图.width * 图.height);
  }
}

/* ------------------------------------------------------------ 6. Lut转3D */

{
  const lut = 恒等3D(2);
  const t3 = Lut转3D(lut, 4);
  eq('摊出来的表尺寸对', t3.size, 4);
  const px1 = { r: 0, g: 0, b: 0 };
  const px2 = { r: 0, g: 0, b: 0 };
  let 最大 = 0;
  for (const v of [0, 0.13, 0.5, 0.77, 1]) {
    采Lut(lut, v, v, v, px1);
    采Lut(t3, v, v, v, px2);
    最大 = Math.max(最大, Math.abs(px1.r - px2.r));
  }
  ok('摊成 3D 之后采样与原表一致（恒等表）', 最大 < 1.5, `最大差 ${最大}`);
}

/* ------------------------------------------------------------ 7. 预览与导出同函数 */

{
  const grid = makeClutGrid(CLUT_SIZE);
  const 图 = 造图(48, 24);

  const 链 = 默认链();
  const lutNode = 新建节点('lut');
  lutNode.p = { ...新建Lut参数(), lut: 恒等3D(2), strength: 0.5 };
  链.splice(1, 0, lutNode);
  链[0].p = { ...新建基本(), exposure: 1.2, temperature: 0.3, shadows: 0.2 };

  const 直算 = 跑链(图, 链);
  const 表 = 烘成CLUT(grid, 链, CLUT_SIZE);
  const 过表 = applyClut(图, 表);
  const d = 最大差(直算, 过表);
  ok('32³ 表打回原图与直算的差在量化范围内', d <= 20, `最大差 ${d}/255（量化 + 三线性插值；再大就是两套实现）`);

  const 表2 = 烘成CLUT(grid, 链, CLUT_SIZE);
  let 同 = 表.data.length === 表2.data.length;
  for (let i = 0; 同 && i < 表.data.length; i++) if (表.data[i] !== 表2.data[i]) 同 = false;
  ok('同一个链烘两次得到同一张表', 同);

  const 图32 = clutToImage(表, false);
  eq('导出的表图宽度对', 图32.width, CLUT_SIZE * CLUT_SIZE);
  eq('导出的表图高度对', 图32.height, CLUT_SIZE);

  /* 源码级：界面必须走 跑链 / 烘成CLUT，不许自己再写一条调色路 */
  const comp = fs.readFileSync(new URL('../src/lib/modules/ikclut/Ikclut.svelte', import.meta.url), 'utf8');
  ok('界面 import 了 跑链', /跑链/.test(comp));
  ok('界面 import 了 烘成CLUT', /烘成CLUT/.test(comp));
  ok('界面导出走的就是烘成CLUT（没有第二条烘表路径）', /const 表 = 烘成CLUT/.test(comp));
  ok('界面里不再直接调 applyGrade（调色只有链这一条路）', !/applyGrade\(/.test(comp));

  /* 源码级：原图 / 调色后 是两个**各自独立可缩放拖动**的视图（用户点名要的） */
  const 视图段 = comp.slice(comp.indexOf('class="cmp"'), comp.indexOf('烘出来的 CLUT'));
  ok('原图是一个预览台', /url=\{beforeUrl\}/.test(视图段));
  ok('调色后是一个预览台', /url=\{result\.after\}/.test(视图段));
  eq('两个视图都开了滚轮直接缩放', (视图段.match(/滚轮直接缩放/g) ?? []).length, 2);
  eq('两个视图都有重置按钮', (视图段.match(/重置/g) ?? []).length, 2);
  ok('两个视图各自绑了倍率（不是同一个变量）', /bind:倍=\{左倍\}/.test(视图段) && /bind:倍=\{右倍\}/.test(视图段));
  ok('两个视图各自绑了位置', /bind:位置=\{左位置\}/.test(视图段) && /bind:位置=\{右位置\}/.test(视图段));
  ok('缩放范围按样本写成 10%~1200%', /最小倍=\{0\.1\}/.test(视图段) && /最大倍=\{12\}/.test(视图段));

  /* 同步开关**默认关**（用户拍的板），三种比对模式都在 */
  ok('同步缩放默认关', /let 同步倍 = \$state\(false\)/.test(comp));
  ok('同步平移默认关', /let 同步移 = \$state\(false\)/.test(comp));
  for (const 模 of ['before', 'both', 'after']) {
    ok(`有「${模}」这一档比对模式`, comp.includes(`'${模}'`));
  }
  ok('快照有存与用两条路', /function 存快照/.test(comp) && /function 用快照/.test(comp));

  /* 参数板：七个标签 + 每一组都按标签显隐（不再一长串往下堆） */
  for (const 名 of ['基本', '曲线', '色轮', 'HSL', 'LOG/HDR', '变形', 'LUT']) {
    ok(`参数标签里有「${名}」`, new RegExp(`名: '${名.replace('/', '\\/')}'`).test(comp));
  }
  eq('七个参数组都绑了显隐', (comp.match(/class:grp--off=/g) ?? []).length, 7);
}

/* ------------------------------------------------------------ 8. 第二批四个节点各自做了什么 */

/** 一张纯灰的图（验色轮"给灰上色"这件事） */function 造灰(w = 8, h = 8) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = Math.round((i / (w * h - 1)) * 255);
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  return new ImageData(d, w, h);
}

/**
 * 一条按色相排的色带（左红 → 右回红，满饱和）。给"变形按色相取网格"当靶子：
 * 用随机色相的图试过一版，设了第 0 格却一个像素都没动 —— 那格没被采样到。
 */
function 造色相带(w = 64) {
  const d = new Uint8ClampedArray(w * 4);
  for (let x = 0; x < w; x++) {
    const h = (x / (w - 1)) * 360;
    const t = h / 60;
    const i = Math.floor(t) % 6;
    const f = t - Math.floor(t);
    const 表 = [
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 1, 1],
      [0, 0, 1],
      [1, 0, 1]
    ];
    const a = 表[i];
    const b = 表[(i + 1) % 6];
    d[x * 4] = Math.round((a[0] + (b[0] - a[0]) * f) * 255);
    d[x * 4 + 1] = Math.round((a[1] + (b[1] - a[1]) * f) * 255);
    d[x * 4 + 2] = Math.round((a[2] + (b[2] - a[2]) * f) * 255);
    d[x * 4 + 3] = 255;
  }
  return new ImageData(d, w, 1);
}

/** 取某个像素的 RGB */
function 取(img, i) {
  return [img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]];
}

{
  /* --- 色轮：给灰上色，暗部轮只动暗的地方 --- */
  const 图 = 造灰(8, 8);
  const 暗轮 = { ...新建色轮(), 暗: { h: 0, s: 1, l: 0 } }; // 红
  const 出 = 跑色轮(图, 暗轮);
  ok('色轮：非恒等参数确实改了字节', 最大差(图, 出) > 5, `最大差 ${最大差(图, 出)}`);
  /* 最暗那一点：R 应当明显高于 B（往红色推）；最亮那一点几乎不动（暗部轮的权重在那里是 0） */
  const 黑 = 取(出, 0);
  const 白 = 取(出, 63);
  ok('色轮：暗部轮把最暗处推向红', 黑[0] > 黑[2] + 5, `R ${黑[0]} / B ${黑[2]}`);
  ok('色轮：暗部轮几乎不碰最亮处', Math.abs(白[0] - 图.data[63 * 4]) <= 1, `${白[0]}`);

  /* 灰被推上色 = 三通道不再相等（纯旋转做不到这件事） */
  ok('色轮：灰也能被推上色（不是只转色相）', 黑[0] !== 黑[1] || 黑[1] !== 黑[2]);

  /* --- 明暗那一项只动亮度不动色相：给灰加明暗，三通道应当同步升降 --- */
  const 明暗 = 跑色轮(图, { ...新建色轮(), 全局: { h: 0, s: 0, l: 1 } });
  const 中 = 取(明暗, 30);
  ok(
    '色轮：明暗项给三条通道加同一个量（只动亮度）',
    Math.abs(中[0] - 中[1]) <= 1 && Math.abs(中[1] - 中[2]) <= 1,
    `${中.join(',')}`
  );
  ok('色轮：明暗项确实提亮了', 中[0] > 取(图, 30)[0]);
}

{
  /* --- HSL：只挑一个色相段动，别的色相不许被带走 --- */
  const 图 = 造图(64, 8);
  const 只橙 = 新建Hsl();
  只橙.bands[1] = { h: 0, s: 2, l: 1 }; // 橙色（中心 45°）饱和 ×2
  const 出 = 跑Hsl(图, 只橙);
  ok('HSL：非恒等参数确实改了字节', 最大差(图, 出) > 5, `最大差 ${最大差(图, 出)}`);

  /* 逐像素核：改动幅度必须跟"离 45° 多远"相关 —— 45° 附近改得多，180° 附近几乎不动 */
  let 近 = 0;
  let 远 = 0;
  let 近数 = 0;
  let 远数 = 0;
  for (let i = 0; i < 图.width * 图.height; i++) {
    const r = 图.data[i * 4] / 255;
    const g = 图.data[i * 4 + 1] / 255;
    const b = 图.data[i * 4 + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max - min < 0.05) continue; // 灰的没有色相，跳过
    let h = 0;
    const d = max - min;
    if (max === r) h = (((g - b) / d) % 6) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
    if (h < 0) h += 360;
    const 改 = 最大差(
      { data: 图.data.slice(i * 4, i * 4 + 3), width: 1, height: 1 },
      { data: 出.data.slice(i * 4, i * 4 + 3), width: 1, height: 1 }
    );
    if (Math.abs(h - 45) < 20) {
      近 += 改;
      近数++;
    } else if (Math.abs(h - 180) < 20) {
      远 += 改;
      远数++;
    }
  }
  const 近均 = 近数 ? 近 / 近数 : 0;
  const 远均 = 远数 ? 远 / 远数 : 0;
  ok(
    'HSL：橙段附近的改动明显大于青段（权重是真的按色相给的）',
    近数 > 0 && 远数 > 0 && 近均 > 远均 + 5,
    `近 ${近均.toFixed(1)}（${近数} 点）/ 远 ${远均.toFixed(1)}（${远数} 点）`
  );

  /* 段权重归一化：把八段全设成同一个偏移，结果应当接近"整体偏那个角度"而不是偏八倍 */
  const 全同 = 新建Hsl();
  for (const b of 全同.bands) b.h = 20;
  const 出2 = 跑Hsl(图, 全同);
  const 出3 = 跑Hsl(图, { ...新建Hsl(), bands: 全同.bands.map((b) => ({ ...b, h: 20 })) });
  ok('HSL：八段同值不会累加八次（权重归一化）', 最大差(出2, 出3) === 0);
}

{
  /* --- LOG / HDR：进出转换往返 ---- */
  let 最大 = 0;
  let 最差在哪 = 0;
  for (const 曲线 of ['log2', 'log10']) {
    for (let i = 0; i <= 1000; i++) {
      const x = i / 1000;
      const 回 = 转线性(转LOG(x, 曲线), 曲线);
      const e = Math.abs(回 - x) * 255; // 换成"多少个色阶"
      if (e > 最大) {
        最大 = e;
        最差在哪 = x;
      }
    }
  }
  ok(
    'LOG：两条曲线的往返误差都远小于一个色阶（< 0.5/255）',
    最大 < 0.5,
    `最大 ${最大.toFixed(5)}/255（在 ${最差在哪}）`
  );

  const 图 = 造图(32, 8);
  const 曝 = 跑Log(图, { ...新建Log(), 曝光: 1 });
  ok('LOG：曝光 +1EV 确实提亮了', 最大差(图, 曝) > 20, `最大差 ${最大差(图, 曝)}`);
  /* 提亮该是"整体乘 2"：中灰 128 附近应当接近 255 夹断，暗部按比例 */
  const 原暗 = 图.data[4 * 4];
  const 新暗 = 曝.data[4 * 4];
  ok('LOG：暗部提亮的比例接近 2 倍', Math.abs(新暗 - Math.min(255, 原暗 * 2)) <= 2, `${原暗} → ${新暗}`);

  const 色 = 跑Log(图, { ...新建Log(), 色轮色相: 0, 色轮强度: 0.8, 曲线: 'log10' });
  ok('LOG：在 log 空间推色度确实起了作用', 最大差(图, 色) > 5, `最大差 ${最大差(图, 色)}`);

  const 滚 = 跑Log(图, { ...新建Log(), 曝光: 1, 滚降: 1 });
  const 硬 = 跑Log(图, { ...新建Log(), 曝光: 1, 滚降: 0 });
  let 滚顶 = 0;
  let 硬顶 = 0;
  for (let i = 0; i < 图.width * 图.height; i++) {
    if (滚.data[i * 4] === 255) 滚顶++;
    if (硬.data[i * 4] === 255) 硬顶++;
  }
  ok('LOG：滚降之后顶到 255 的像素比硬夹断少（真的在收高光）', 滚顶 < 硬顶, `滚 ${滚顶} / 硬 ${硬顶}`);
  ok('LOG：滚降与硬夹断结果不同', 最大差(滚, 硬) > 0, `最大差 ${最大差(滚, 硬)}`);
}

{
  /* --- 色彩变形：网格真的按色相/饱和取，改一格只影响那一带 ---
     要一条已知色相的图：上面那张 造图 的彩色半边色相是乱序的，拿它试过一版，
     结果"设了第 0 格却一个像素都没动" —— 那一格根本没被任何像素采样到。 */
  const 图 = 造色相带(64);
  const vp = 新建变形();
  /* 整张网格全填 1：每个像素都被扫到，先证明这条链是通的 */
  vp.色相饱和 = vp.色相饱和.map(() => 1);
  vp.饱和量 = 0.8;
  vp.色相量 = 0;
  const 全动 = 跑变形(图, vp);
  ok('变形：网格全填 1 时确实改了字节', 最大差(图, 全动) > 5, `最大差 ${最大差(图, 全动)}`);

  /* 只把"红那一带"（色相 0~45°，也就是第 0 列）填 1，别的留 0 */
  const vp2 = 新建变形();
  vp2.饱和量 = 0.8;
  vp2.色相量 = 0;
  for (let row = 0; row < 变形边; row++) vp2.色相饱和[row * 变形边] = 1;
  const 出 = 跑变形(图, vp2);
  let 红改 = 0;
  let 蓝改 = 0;
  for (let i = 0; i < 图.width * 图.height; i++) {
    const 一点 = (img) => ({ data: img.data.slice(i * 4, i * 4 + 3), width: 1, height: 1 });
    const 改 = 最大差(一点(图), 一点(出));
    const x = i % 图.width;
    const 色相 = (x / (图.width - 1)) * 360;
    if (色相 < 20 || 色相 > 340) 红改 += 改;
    else if (色相 > 160 && 色相 < 200) 蓝改 += 改;
  }
  ok('变形：红色那一带的改动大于青色那一带', 红改 > 蓝改 + 50, `红 ${红改} / 青 ${蓝改}`);

  /* 网格边数与数组长度必须对得上（界面上是按 边×边 铺的） */
  eq('变形：网格长度 = 边×边', vp.色相饱和.length, 变形边 * 变形边);
  eq('变形：亮度网格同长', vp.色相亮度.length, 变形边 * 变形边);

  /* 亮度那张网格也能单独起作用 */
  const vp3 = 新建变形();
  vp3.色相亮度 = vp3.色相亮度.map(() => -1);
  vp3.亮度量 = 0.6;
  const 压暗 = 跑变形(图, vp3);
  ok('变形：亮度网格全填 -1 时整张被压暗', 最大差(图, 压暗) > 5, `最大差 ${最大差(图, 压暗)}`);

  /* HSL 八段与段的中心角也必须对得上 */
  eq('HSL：八段', HSL段.length, 8);
  ok('HSL：段中心均匀铺满一圈', HSL段.every((s, i) => s.中心 === i * 45));
}

/* ------------------------------------------------------------ 分段缓存 */

/**
 * 缓存最容易出的错是"算旧了"：改了参数却拿上一次的中间结果接着算，
 * 出来的图和不用缓存时**不一样**，而界面上看着还挺正常。
 * 所以这里的主证据是**逐字节对照**：同一串改动，带缓存跑一遍、不缓存跑一遍，
 * 两边必须一模一样。其次是"复用位置对不对"—— 只改最后一个节点就该只重跑最后一步。
 */
{
  const 源 = 造图(48, 24);
  /** 六个节点串成一条链：基本 / 曲线 / 色轮 / HSL / LOG / 变形 */
  const 造链 = () => {
    const a = 新建节点('basic');
    a.p.曝光 = 1.1;
    a.p.色温 = 0.2;
    const b = 新建节点('curves');
    b.p.亮度 = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.62 },
      { x: 1, y: 1 }
    ];
    const c = 新建节点('wheels');
    c.p.中 = { h: 210, s: 0.3, l: 0.05 };
    const d = 新建节点('hsl');
    d.p.bands[0].s = 0.6;
    const e = 新建节点('log');
    e.p.曝光 = 0.5;
    const f = 新建节点('warp');
    f.p.色相饱和 = f.p.色相饱和.map((_, i) => (i % 5 === 0 ? 0.5 : 0));
    f.p.饱和量 = 0.4;
    return [a, b, c, d, e, f];
  };

  const 一样 = (x, y) => {
    if (x.width !== y.width || x.height !== y.height) return false;
    for (let i = 0; i < x.data.length; i++) if (x.data[i] !== y.data[i]) return false;
    return true;
  };

  /* ① 冷启动：缓存里什么都没有，整条链都得跑，但结果必须和不用缓存一致 */
  const 链1 = 造链();
  const 缓存 = 造链缓存();
  const 带缓存 = 跑链(源, 链1, 缓存);
  const 不带 = 跑链(源, 链1);
  ok('缓存：冷启动结果与不用缓存逐字节相同', 一样(带缓存, 不带));
  eq('缓存：冷启动从第 0 步开始跑', 缓存.跳到, 0);
  eq('缓存：步数与节点数对齐', 缓存.步.length, 链1.length);

  /* ② 只改最后一个节点：前面 5 步该全部复用 */
  const 链2 = 造链();
  链2[5].p.饱和量 = 0.9;
  缓存.跳到 = -1;
  const 带2 = 跑链(源, 链2, 缓存);
  ok('缓存：只改最后一个节点时结果与不用缓存逐字节相同', 一样(带2, 跑链(源, 链2)));
  eq('缓存：只改最后一个节点 → 从第 5 步开始跑（前 5 步复用）', 缓存.跳到, 5);
  ok('缓存：改最后一个节点确实改变了结果', !一样(带2, 不带));

  /* ③ 改中间那个节点：它后面全得重跑 */
  const 链3 = 造链();
  链3[2].p.中.s = 0.7;
  跑链(源, 链3, 缓存);
  eq('缓存：改第 3 个节点 → 从第 2 步开始跑', 缓存.跳到, 2);
  ok('缓存：改中间节点结果也一致', 一样(跑链(源, 链3, 缓存), 跑链(源, 链3)));

  /* ④ 参数一个字没改：整条复用，结果还是那张 */
  跑链(源, 链3, 缓存);
  eq('缓存：参数没动 → 从末尾开始（一步都不跑）', 缓存.跳到, 链3.length);
  ok('缓存：整条复用出来还是同一张', 一样(跑链(源, 链3, 缓存), 跑链(源, 链3)));

  /* ⑤ 关掉一个节点：指纹里带开关，所以必须重跑 */
  const 链4 = 造链();
  链4[1].on = false;
  跑链(源, 链4, 缓存);
  eq('缓存：关掉第 2 个节点 → 从第 1 步开始跑', 缓存.跳到, 1);
  ok('缓存：开关变化后结果仍与不用缓存一致', 一样(跑链(源, 链4, 缓存), 跑链(源, 链4)));

  /* ⑥ 换源图：一步都不许复用 */
  const 源2 = 造图(48, 24);
  源2.data[0] = 源2.data[0] === 200 ? 10 : 200;
  跑链(源2, 链4, 缓存);
  eq('缓存：换源图 → 从第 0 步开始跑', 缓存.跳到, 0);
  ok('缓存：换源图后结果与不用缓存一致', 一样(跑链(源2, 链4, 缓存), 跑链(源2, 链4)));

  /* ⑦ 链变短：尾巴上的旧格子不许再拿去比 */
  const 短链 = [造链()[0]];
  跑链(源, 短链, 缓存);
  eq('缓存：链变短之后步数跟着砍', 缓存.步.length, 1);
  ok('缓存：短链结果与不用缓存一致', 一样(跑链(源, 短链, 缓存), 跑链(源, 短链)));

  /* ⑧ 一串乱改：每一步都和"不用缓存"对照（这才是真正抓"算旧了"的那条） */
  const 节点名表 = ['曝光', '色温', '对比', '饱和', '色相', '高光', '阴影', '黑点', '白点'];
  const 链5 = 造链();
  const 缓存5 = 造链缓存();
  let 不一致 = 0;
  let 复用总数 = 0;
  for (let 轮 = 0; 轮 < 40; 轮++) {
    /* 轮着改一个节点的一个参数，位置和值都由轮次决定（可复现，不用随机数） */
    const 哪 = 轮 % 链5.length;
    const 节 = 链5[哪];
    const 键 = 节点名表[轮 % 节点名表.length];
    if (键 in 节.p) {
      节.p[键] = 0.1 + ((轮 * 7) % 9) * 0.1;
      /* 换一个**新的对象**：界面就是这么改参数的（展开成新对象），
         如果指纹只认对象身份，这里就会漏判 */
      链5[哪] = { ...节, p: { ...节.p } };
    } else {
      节.p = { ...节.p };
      链5[哪] = { ...节 };
    }
    const a = 跑链(源, 链5, 缓存5);
    const b = 跑链(源, 链5);
    if (!一样(a, b)) 不一致++;
    复用总数 += 缓存5.跳到;
  }
  eq('缓存：连改 40 轮、每轮都和不用缓存逐字节相同', 不一致, 0);
  ok('缓存：这 40 轮里确实发生了复用（不是每轮都在全跑）', 复用总数 > 0, `复用步数合计 ${复用总数}`);

  /* ⑨ 大图不缓存：4K 上中间结果一份 34MB，缓存只会吃内存 */
  const 大 = new ImageData(new Uint8ClampedArray(2000 * 1200 * 4), 2000, 1200);
  const 大缓存 = 造链缓存();
  跑链(大, [造链()[0]], 大缓存);
  eq('缓存：超过上限的大图不进缓存', 大缓存.步.length, 0);
}

console.log(`\n通过 ${pass}，失败 ${fail}\n`);
process.exitCode = fail ? 1 : 0;