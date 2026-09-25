/**
 * 批量提取流水线的自检。
 *
 * 只验纯逻辑那一半（认角色、组计划、有界并发）—— 读像素那半要真文件，
 * 那部分在真目录上跑过。
 *
 * 跑：node --import ./tmp/register-loader.mjs tmp/pipeline.test.mjs
 */
import {
  DEFAULT_OPTS,
  ROLE_LABEL,
  buildPlan,
  classify,
  extractRow,
  judgeRow,
  measureRow,
  runPool,
  summarize
} from '../src/lib/pipeline.ts';

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
const ref = (path) => {
  const name = path.split(/[\\/]/).pop();
  return { path, name, rel: name, ext: name.split('.').pop().toLowerCase(), size: 1 };
};
const opts = (o = {}) => ({ ...DEFAULT_OPTS, ...o });

/* ============================================================ */

section('认角色 —— 用户手上真实的后缀');

const CASES = [
  ['T_Body_D.png', 'basecolor'],
  ['T_Body_D1.png', 'basecolor'],
  ['T_Body_D2.png', 'basecolor'],
  ['T_Body_N.png', 'normal'],
  ['T_Body_Normal.png', 'normal'],
  ['T_Body_LM.png', 'lightmap'],
  ['T_Body_Lightmap.png', 'lightmap'],
  ['T_Body_M.png', 'otherdata'],
  ['T_Body_A.png', 'otherdata2'],
  ['T_Body_Ramp.png', 'ramp'],
  ['T_Face_SDF.png', 'sdf'],
  ['T_Body_MatCapTex1.png', 'matcap'],
  ['Metal_Body.png', 'metal'],
  ['T_Body_Metal.png', 'metal'],
  ['T_Body_Gloss.png', 'glossmap'],
  ['T_Body_Roughness.png', 'roughmap'],
  ['T_Body_MatID3.png', 'idmap'],
  ['readme.txt', 'unknown'],
  ['T_Body_Hair.png', 'partcolor'],

  // 下面这些是 `tools/probe_roles.py` 在真库 13,977 张图上量出来认不出的那几堆。
  // 只认 `_N` `_D` `_M` 那套后缀时认不出 71%，补上这些以后降到 25%。
  ['coarse-loose-fabric_normal-ogl.png', 'normal'],
  ['soft-blanket_bump.png', 'normal'],
  ['Avatar_Girl_Bow_Collei_Tex_Body_Normalmap.png', 'normal'],
  ['coarse-loose-fabric_ao.png', 'ao'],
  ['FaceShadow2.png', 'faceshadow'],
  ['Avatar_Yunli_00_Body_Color_L.png', 'basecolor'],
  ['W_140_Girl_FaceMap_00.png', 'basecolor'],
  ['Avatar_Yunli_00_Body_LightMap_L.png', 'lightmap'],
  ['CTR.bmp', 'mmefx'],
  ['black.png', 'mmefx'],
  ['mc1.png', 'mmefx'],
  ['toon3.png', 'mmefx'],
  ['toon_defo.bmp', 'mmefx'],
  ['DiffuseMulc3.png', 'mmefx'],
  ['DiffuseMulBySat.png', 'mmefx'],
  ['AddSphereRepl.png', 'mmefx'],
  ['DiffuseShadowMask.png', 'mmefx'],
  ['颜.png', 'partcolor'],
  ['肌.png', 'partcolor'],
  ['髪.png', 'partcolor'],
  ['头发.png', 'partcolor'],
  ['衣服.png', 'partcolor'],
  ['hair.bmp', 'partcolor'],
  ['skin.bmp', 'partcolor'],
  ['face.png', 'partcolor'],
  ['stockings.png', 'partcolor'],
  ['Avatar_BlackSwan_00_Body_Stockings.png', 'partcolor'],
  ['cloth1.png', 'partcolor'],

  // 实战测试用例（1122 张）里那几堆，认不出的从 48.6% 降到 43.2%
  ['NM-Fabric01.png', 'normal'],
  ['NM-Skin03.png', 'normal'],
  ['Avatar_Girl_Catalyst_Vodyanitska_Tex_Body01_Diffuse_Alpha.png', 'basecolor'],
  ['Avatar_Girl_Catalyst_Vodyanitska_Tex_Body01_Diffuse_RGBAA.png', 'basecolor'],
  ['Avatar_Girl_Catalyst_Vodyanitska_Tex_Pupil01_Diffuse_RGBCR.png', 'basecolor'],
  ['Avatar_RobinS_00_Body_Color_A_L.png', 'basecolor'],
  ['Avatar_RobinS_00_Body_Color_A_LB.png', 'basecolor'],
  ['Avatar_Sparxie_01_Body_Color_A_L.png', 'basecolor'],
  ['albedo.png', 'basecolor'],
  ['Avatar_RobinS_00_Hair_LightMapR.png', 'lightmap'],
  ['Avatar_RobinS_00_Hair_LightMapR+.png', 'lightmap'],
  ['Avatar_Tex_Face01_Shadow.png', 'faceshadow'],
  ['Avatar_Tex_Face02_Shadow.png', 'faceshadow'],
  ['Avatar_Girl_Catalyst_Vodyanitska_Tex_Tail_Mask.png', 'auxmap'],
  ['Avatar_RobinS_00_Body_Mask_01.png', 'auxmap'],
  ['Avatar_RobinS_00_Star01_Mask.png', 'auxmap'],
  ['Avatar_RobinS_00_Weapon_ParallaxMap.png', 'auxmap'],
  ['Avatar_Tex_Leather_Reflectmap.png', 'auxmap'],
  ['W_140_Girl_Face_ExpressionMap_00.png', 'auxmap'],
  ['Avatar_Girl_Pole_Escoffier_Tex_Stockings_Detailmap.png', 'auxmap'],
  ['OutlineMap.jpg', 'auxmap'],
  ['MaterialMap.jpg', 'auxmap'],
  ['Dirtmap.png', 'auxmap'],
  ['curvatureLUT.bmp', 'auxmap'],
  ['shadowLUT.bmp', 'auxmap'],

  // `_Detail` / `_Dirt` 这种光秃秃的必须被辅助图拦住 ——
  // 基础色那条的后缀放宽到 5 个字符了，不然 `_D` + `etail` 会被认成基础色
  ['X_Tex_Detail.png', 'auxmap'],
  ['X_Tex_Dirt.png', 'auxmap'],
  // 但真的要小心这条：`_D` 系列本身不能被挡住
  ['T_Body_D.png', 'basecolor'],
  ['T_Body_D1.png', 'basecolor'],
  ['T_Body_Dark.png', 'basecolor'],

  // 剩这堆是真认不出的：作者自己编的名字，光看名字没有依据
  ['body00_s.bmp', 'unknown'],
  ['bq.png', 'unknown'],
  ['a4.bmp', 'unknown'],
  ['SP0d_20190820_005614.bmp', 'unknown'],
  ['Eff_Noise_699_02.png', 'unknown'],
  ['tex_bdy_COM_16_01_H.png', 'unknown'],
  ['noise.png', 'unknown'],
  ['Preview.png', 'unknown']
];
for (const [name, want] of CASES) eq(classify(name), want, `${name} → ${ROLE_LABEL[want]}`);

section('自己产出的不会自我循环');

// `T_Body_Normal_D` 是"角色名里带 Normal"，本体是基础色，不能当成法线
eq(classify('T_Normal_D.png'), 'basecolor', 'name 里带 Normal 但后缀是 _D → 基础色');

// 不特意标"这是我写的"：产出名撞上的都是「已就位」那一类，天然不会再提一遍
eq(classify('T_Body_N_Gloss.png'), 'glossmap', '上次提的 _Gloss → 已就位，不会重提');
eq(classify('T_Body_N_Roughness.png'), 'roughmap', '上次提的 _Roughness → 已就位');
eq(classify('T_Body_M_Metal.png'), 'metal', '上次提的 _Metal → 已就位');
eq(classify('T_Body_D_MatID3.png'), 'idmap', '上次拆的 MatID → 归材质 ID，不处理');

{
  // 真正的重点：产出绝不能被认成 _N / _D，否则第二次跑会拿产出当输入
  const outs = ['T_Body_N_Gloss.png', 'T_Body_N_Roughness.png', 'T_Body_M_Metal.png', 'T_Body_D_MatID3.png'];
  const bad = outs.filter((n) => ['normal', 'basecolor', 'otherdata'].includes(classify(n)));
  ok(bad.length === 0, '产出不会落回 _N / _D / _M 那几类', bad.join(', '));
}

section('组计划 —— 后缀跟着口径走');

{
  const rows = buildPlan([ref('M\\T_Body_N.png'), ref('M\\T_Body_D.png')], opts({ alphaIsGloss: true }));
  const n = rows.find((r) => r.role === 'normal');
  eq(n.outName, 'T_Body_N_Gloss.png', '当光泽时法线输出 _Gloss');
  ok(n.invert === false, '当光泽时不反相');
  eq(n.job, 'alpha', '法线走 alpha 提取');
}

{
  const rows = buildPlan([ref('M\\T_Body_N.png')], opts({ alphaIsGloss: false }));
  const n = rows[0];
  eq(n.outName, 'T_Body_N_Roughness.png', '当粗糙时改后后缀');
  ok(n.invert === true, '当粗糙时反相');
}

{
  const rows = buildPlan([ref('M\\T_Body_M.png')], opts({ metalChannel: 'g' }));
  const m = rows[0];
  eq(m.job, 'chan', '_M 走单通道提取');
  eq(m.channel, 'g', '金属度取 G 路');
  eq(m.outName, 'T_Body_M_Metal.png', '输出 _Metal');
  ok(m.out.startsWith('M\\'), '输出跟源图同目录');
}

section('跨行判断 —— 同目录已有金属度图就不从 _M 提');

{
  // 这是批量才看得出来的一条：单张看不出同目录还有别的文件
  const rows = buildPlan(
    [ref('M\\T_Body_M.png'), ref('M\\Metal_Body.png')],
    opts()
  );
  const m = rows.find((r) => r.role === 'otherdata');
  const mt = rows.find((r) => r.role === 'metal');
  eq(m.job, null, '同目录有 Metal 图 → _M 不提');
  ok(m.on === false, '也不勾上');
  ok(/金属度/.test(m.why), '原因写在表里');
  eq(mt.job, 'asis', 'Metal 图本身不动');
}

{
  // 放在别的目录就不影响
  const rows = buildPlan([ref('M\\T_Body_M.png'), ref('N\\Metal_Body.png')], opts());
  const m = rows.find((r) => r.ref.path.startsWith('M\\'));
  eq(m.job, 'chan', '金属度图在别的目录 → _M 照样提');
}

section('认不出的处理');

{
  // `body00_s.bmp` 这种是真认不出的：作者自己编的名字，名字里没有任何依据
  const rows = buildPlan([ref('M\\body00_s.png')], opts({ skipUnknown: true }));
  eq(rows[0].job, null, '勾上「不动」时不处理');
  eq(rows[0].role, 'unknown', '角色还是 unknown');
}

{
  const rows = buildPlan([ref('M\\body00_s.png')], opts({ skipUnknown: false }));
  eq(rows[0].job, 'alpha', '取消勾选 → 当基础色试一遍');
  eq(rows[0].role, 'basecolor', '角色改成 basecolor');
}

section('已就位 / 不动的行不会被跑');

{
  const rows = buildPlan(
    [ref('M\\T_Body_N.png'), ref('M\\T_Body_Gloss.png'), ref('M\\T_Body_MatCapTex1.png'), ref('M\\T_Body_D_Gloss.png')],
    opts()
  );
  const gl = rows.find((r) => r.ref.name === 'T_Body_Gloss.png');
  const mc = rows.find((r) => r.ref.name === 'T_Body_MatCapTex1.png');
  const out = rows.find((r) => r.ref.name === 'T_Body_D_Gloss.png');
  eq(gl.job, 'asis', '已经是光泽图 → 不动');
  eq(mc.job, null, 'MatCap → 这批不动');
  eq(out.job, 'asis', '上次的产出也是光泽图 → 不动，不会循环');
  ok([gl, mc, out].every((r) => !r.on), '这三行都不勾');
}

section('统计');

{
  const rows = buildPlan(
    [
      ref('M\\T_Body_N.png'), // 要提
      ref('M\\T_Body_D.png'), // 要提
      ref('M\\T_Body_Gloss.png'), // 已就位
      ref('M\\T_Body_MatCapTex1.png'), // 不动
      ref('M\\body00_s.png') // 认不出
    ],
    opts()
  );
  const s = summarize(rows);
  eq(s.total, 5, '总数');
  eq(s.todo, 2, '要提的');
  eq(s.asis, 1, '已就位');
  // 认不出的也算"不动" —— 两个数会重叠，侧栏是分两栏列的，不冲突
  eq(s.idle, 2, '不动（MatCap + 认不出的）');
  eq(s.unknown, 1, '认不出');
}

section('有界并发');

{
  let live = 0;
  let peak = 0;
  const order = [];
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const steps = [];
  const out = await runPool(
    items,
    3,
    async (x) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 4));
      order.push(x);
      live--;
      return x * 2;
    },
    (d) => steps.push(d)
  );
  ok(peak <= 3, `并发峰值不超过 3（实得 ${peak}）`);
  eq(out.length, 10, '结果条数对得上');
  eq(out[7], 16, '结果按输入顺序摆回去');
  eq(new Set(order).size, 10, '每项都跑到了');
  eq(steps.join(','), '1,2,3,4,5,6,7,8,9,10', '进度是单调递增的');
}

{
  const out = await runPool([], 4, async () => 1);
  eq(out.length, 0, '空输入不卡住');
}

{
  // 抛异常要冒出来，不能静默吞掉
  let threw = false;
  try {
    await runPool([1, 2], 2, async (x) => {
      if (x === 2) throw new Error('boom');
    });
  } catch {
    threw = true;
  }
  ok(threw, '单项抛错会冒出来（调用方去 catch）');
}

section('判一行 —— 量出没东西就自己撤掉');

{
  // 法线：alpha 里塞了渐变 → 有东西可提
  const rich = new ImageData(64, 64);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const o = (y * 64 + x) * 4;
      rich.data[o] = 128;
      rich.data[o + 1] = 128;
      rich.data[o + 2] = 255;
      rich.data[o + 3] = (x * 4) % 256; // 64 个不同取值
    }
  const row = buildPlan([ref('M\\T_Body_N.png')], opts())[0];
  eq(judgeRow(row, rich), true, 'alpha 有渐变 → 有得提');
  eq(row.state, 'ok', '状态是 ok');
  eq(row.job, 'alpha', 'job 留着');
}

{
  // 法线：alpha 一律 255（实测 44% 的法线是这样）→ 提出来是全白，撤掉
  const flat = new ImageData(64, 64);
  flat.data.fill(255);
  const row = buildPlan([ref('M\\T_Body_N.png')], opts())[0];
  eq(judgeRow(row, flat), false, 'alpha 是常量 → 不提');
  eq(row.state, 'skip', '状态是 skip');
  eq(row.job, null, 'job 被撤掉');
  eq(row.on, false, '也不会勾上');
  ok(/常量/.test(row.detail), '原因写在结果栏里');
}

{
  // 二值遮罩（只有 0 和 255）不是数据，也得撤
  const bin = new ImageData(64, 64);
  for (let i = 0; i < 64 * 64; i++) bin.data[i * 4 + 3] = i % 2 ? 0 : 255;
  const row = buildPlan([ref('M\\T_Body_D.png')], opts())[0];
  eq(judgeRow(row, bin), false, '二值遮罩 → 不当作数据');
  ok(/二值遮罩|取值/.test(row.detail), '讲清楚是二值遮罩');
}

{
  // _M 的 B 路是常量、G 路有东西 → 不能自己改通道，但要把答案摆出来
  const m = new ImageData(64, 64);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const o = (y * 64 + x) * 4;
      m.data[o] = 10; // R 常量
      m.data[o + 1] = (x * 4) % 256; // G 有东西
      m.data[o + 2] = 200; // B 常量
      m.data[o + 3] = 255;
    }
  const row = buildPlan([ref('M\\T_Body_M.png')], opts({ metalChannel: 'b' }))[0];
  eq(judgeRow(row, m), true, '选的 B 是常量但 G 有东西 → 仍然可提');
  eq(row.channel, 'b', '不会偷偷把通道改掉');
  ok(/G/.test(row.detail), '结果栏里点出是 G 路有东西');
}

{
  // 四路全常量 → 真没什么可提
  const flat = new ImageData(32, 32);
  flat.data.fill(255);
  const row = buildPlan([ref('M\\T_Body_M.png')], opts())[0];
  eq(judgeRow(row, flat), false, '四路都空 → 撤掉');
  ok(/都没什么可提/.test(row.detail), '写明四路都没东西');
}

section('提出来的是什么');

{
  const src = new ImageData(2, 1);
  // 像素 0：alpha 0；像素 1：alpha 200
  src.data.set([10, 20, 30, 0, 10, 20, 30, 200]);
  const row = buildPlan([ref('M\\T_Body_N.png')], opts({ alphaIsGloss: true }))[0];
  const out = extractRow(row, src);
  eq(out.data[0], 0, '当光泽：alpha 0 → 灰度 0');
  eq(out.data[4], 200, '当光泽：alpha 200 → 灰度 200');
  eq(out.data[3], 255, '输出不透明');
  ok(out.data[1] === out.data[0] && out.data[2] === out.data[0], '三路一样（灰度）');
  ok(out.data[0] !== 10, '取的是 alpha，不是 R 路');

  const inv = buildPlan([ref('M\\T_Body_N.png')], opts({ alphaIsGloss: false }))[0];
  const out2 = extractRow(inv, src);
  eq(out2.data[0], 255, '当粗糙：反相，alpha 0 → 255');
  eq(out2.data[4], 55, '当粗糙：alpha 200 → 55');
}

{
  const src = new ImageData(1, 1);
  src.data.set([11, 22, 33, 44]);
  const row = buildPlan([ref('M\\T_Body_M.png')], opts({ metalChannel: 'g' }))[0];
  const out = extractRow(row, src);
  eq(out.data[0], 22, '取 G 路的值');
}

{
  const row = buildPlan([ref('M\\T_Body_Gloss.png')], opts())[0];
  eq(extractRow(row, new ImageData(1, 1)), null, '早就就位的行提不出东西');
}

section('读一次图就够判也够提');

{
  // 「量一遍」和「出预览」用的是同一份像素。这里验的是契约本身：
  // 一张 ImageData 既够判定，也够算输出，两条路不会给出矛盾的结论。
  const src = new ImageData(16, 16);
  for (let i = 0; i < 16 * 16; i++) {
    src.data[i * 4] = 128;
    src.data[i * 4 + 1] = (i * 7) % 256;
    src.data[i * 4 + 2] = 200;
    src.data[i * 4 + 3] = (i * 5) % 256; // 16 个取值，够"有东西"
  }

  const a = buildPlan([ref('M\\T_Body_N.png')], opts())[0]; // 判一次
  eq(judgeRow(a, src), true, '同一份像素判定为有东西');
  const aOut = extractRow(a, src); // 同一份像素出预览

  const b = buildPlan([ref('M\\T_Body_N.png')], opts())[0]; // 另一行，出正式输出
  const bOut = extractRow(b, src);

  ok(aOut && bOut, '判定说能提，确实提得出东西');
  eq(aOut.data[4], bOut.data[4], '预览那次的算法跟正式输出一致');
  eq(aOut.width, 16, '同一份像素的尺寸直接可用');
}

{
  // 读失败要落到 err，不能静默当成"跳过" —— 跳过会被读成"这行没数据"
  const row = buildPlan([ref('M\\T_Body_N.png')], opts())[0];
  const bogus = { ...row, ref: { ...row.ref, path: 'Z:\\不存在\\x.png' } };
  const okRead = await measureRow(bogus);
  eq(okRead, false, '读不了 → 返回 false');
  eq(bogus.state, 'err', '状态是 err，不是 skip');
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
