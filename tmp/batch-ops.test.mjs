/**
 * 批量操作表 + 输出命名的自检。
 *
 * 输出文件名是用户唯一看得见的东西 —— 试跑日志里列的就是它。
 * 错一个字符就是几百个名字不对的产物，而且界面上显示"成功"
 * （`Channels.svelte` 那个文件里连一句报错都不会有）。
 *
 * 跑：node --import ./tmp/register-loader.mjs tmp/batch-ops.test.mjs
 */
import { BATCH_OPS, batchOpInfo, batchOutNames, batchTransform, 调换映射 } from '../src/lib/modules/channels/batch.ts';

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
function eqArr(a, b, label) {
  ok(JSON.stringify(a) === JSON.stringify(b), label, `实得 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}`);
}
function section(t) {
  console.log(`\n== ${t} ==`);
}

/* ============================================================ */

section('操作表本身');

{
  ok(BATCH_OPS.length >= 12, `操作数量够（实得 ${BATCH_OPS.length}）`);
  eq(new Set(BATCH_OPS.map((o) => o.id)).size, BATCH_OPS.length, 'id 不重复');

  for (const o of BATCH_OPS) {
    ok(!!o.name && !!o.hint, `${o.id} 有名字和说明`);
    ok(o.out === 1 || o.out === 4, `${o.id} 产出数是 1 或 4（实得 ${o.out}）`);
  }
  // 只有"拆成四张"是 4
  const four = BATCH_OPS.filter((o) => o.out === 4).map((o) => o.id);
  eqArr(four, ['split'], '只有 split 产出 4 个');
}

{
  eq(batchOpInfo('layers').name, '套一套图层', '查得到图层那条');
  eq(batchOpInfo('layers').out, 1, '图层一次出一个');
  // 传个不认识的别崩
  eq(batchOpInfo('不存在').id, BATCH_OPS[0].id, '认不出的 id 退回第一条');
}

section('输出命名：普通路径');

{
  eqArr(batchOutNames('a.png', 'split'), ['a_R.png', 'a_G.png', 'a_B.png', 'a_A.png'], '拆四张');
  eqArr(batchOutNames('a.png', 'extract-r'), ['a_R.png'], '取 R');
  eqArr(batchOutNames('a.png', 'extract-a'), ['a_A.png'], '取 A');
  eqArr(batchOutNames('a.png', 'gray-g'), ['a_gray-G.png'], 'G 铺满');
  eqArr(batchOutNames('a.png', 'alpha-from-r'), ['a_A-from-R.png'], 'R 提到 A');
  eqArr(batchOutNames('a.png', 'adjust'), ['a_adjust.png'], '只跑调整');
  eqArr(batchOutNames('a.png', 'layers'), ['a_图层.png'], '套图层用中文后缀');
}

section('输出命名：带子目录');

{
  // 子目录是用来拼输出路径的，不该跑到文件名里
  eqArr(batchOutNames('Materials/toon/a.png', 'extract-r'), ['a_R.png'], '正斜杠相对路径');
  eqArr(batchOutNames('Materials\\toon\\a.png', 'extract-r'), ['a_R.png'], '反斜杠相对路径');
  eqArr(batchOutNames('a.png', 'split')[3], 'a_A.png', '顺序：R G B A');
}

section('输出命名：后缀');

{
  eqArr(batchOutNames('a.png', 'extract-r', '_v2'), ['a_R_v2.png'], '后缀插在后缀前');
  eqArr(batchOutNames('a.png', 'layers', '_v2'), ['a_图层_v2.png'], '图层那条也一样');
  eqArr(batchOutNames('a.png', 'adjust', ''), ['a_adjust.png'], '空后缀不留痕');
}

section('输出命名：各种文件名');

{
  eqArr(batchOutNames('a.b.c.png', 'extract-r'), ['a.b.c_R.png'], '多点文件名按最后一个点切');
  eqArr(batchOutNames('T_Body_N.tga', 'gray-b'), ['T_Body_N_gray-B.png'], '换成 .png 不管源后缀');
  eqArr(batchOutNames('无后缀', 'extract-r'), ['无后缀_R.png'], '没后缀也能拼');
  eqArr(batchOutNames('Materials/toon/无后缀', 'layers'), ['无后缀_图层.png'], '没后缀 + 子目录');
}

section('产出名会不会撞');

{
  const all = BATCH_OPS.flatMap((o) => batchOutNames('same.png', o.id));
  const dup = [...new Set(all.filter((n, i) => all.indexOf(n) !== i))].sort();

  // **已知且故意的四处重名**：`split` 的 _R/_G/_B/_A 跟
  // `extract-r/g/b/a` 各自产出的是同一张图 —— 两边算的都是
  // `grayToImageData(extractChannel(src, ch))`，一个字都不差。
  // 所以名字相同是对的：它们本来就是同一件事（"把这一路拿出来"），
  // 换个名字反而会让人以为是两种不同的操作。
  // 两个都跑、都写到同一个目录时后一次覆盖前一次，内容一模一样，没有损失。
  eqArr(dup, ['same_A.png', 'same_B.png', 'same_G.png', 'same_R.png'], '重名的正好是 split 那四张');
  eq(dup.length, 4, '就这四处，没有别的');

  // 去掉 split 之后剩下十一种操作两两不重复
  const others = BATCH_OPS.filter((o) => o.id !== 'split').flatMap((o) =>
    batchOutNames('same.png', o.id)
  );
  eqArr(
    others.filter((n, i) => others.indexOf(n) !== i),
    [],
    '去掉 split 之后没有重名'
  );

  eq(all.length, BATCH_OPS.reduce((a, o) => a + o.out, 0), '命名条数跟 out 声明对得上');
}

section('上面那条结论的依据');

{
  // "重名没关系"靠的是"两边算出来同一张图"。像素那半没法在这儿跑（在组件里），
  // 所以退一步钉住名字关系：一旦有人给 `split` 或 `extract-*` 改了后缀，
  // 下面这几条会立刻炸，那时候就得回来重新判断是不是真的一样。
  const split = batchOutNames('x.png', 'split');
  eq(split[0], batchOutNames('x.png', 'extract-r')[0], 'split 的 R 仍等于 extract-r');
  eq(split[1], batchOutNames('x.png', 'extract-g')[0], 'split 的 G 仍等于 extract-g');
  eq(split[2], batchOutNames('x.png', 'extract-b')[0], 'split 的 B 仍等于 extract-b');
  eq(split[3], batchOutNames('x.png', 'extract-a')[0], 'split 的 A 仍等于 extract-a');
  // gray-* 走的是另一条路（铺满 RGB），名字必须分开
  ok(batchOutNames('x.png', 'gray-r')[0] !== split[0], 'gray-R 跟 split 的 R 名字不同');
}

section('批量页新补的三条通道映射（原来只有调换页有）');

{
  /* 一张四路互不相同的 2x2 图，好看出取的是哪一路 */
  const d = new Uint8ClampedArray(16);
  for (let i = 0; i < 4; i++) {
    d[i * 4] = 10 + i;
    d[i * 4 + 1] = 40 + i;
    d[i * 4 + 2] = 80 + i;
    d[i * 4 + 3] = 200 + i;
  }
  const src = new ImageData(d, 2, 2);
  const 替 = { 调整: (s) => s, 叠图层: (s) => s };
  const 第一 = (op) => batchTransform(src, op, 替)[0].data.data;

  ok(BATCH_OPS.some((o) => o.id === 'rotate'), '操作表里有 rotate');
  ok(BATCH_OPS.some((o) => o.id === 'bgra'), '操作表里有 bgra');
  ok(BATCH_OPS.some((o) => o.id === 'invert-r'), '操作表里有 invert-r');
  ok(!!调换映射('rotate') && !!调换映射('bgra') && !!调换映射('invert-r'), '三条映射都能从调换预设里取到（同一份表）');

  const rot = 第一('rotate');
  for (let i = 0; i < 4; i++) {
    eq(rot[i * 4], 40 + i, `循环位移：R←G（第 ${i} 像素）`);
    eq(rot[i * 4 + 1], 80 + i, `循环位移：G←B（第 ${i} 像素）`);
    eq(rot[i * 4 + 2], 200 + i, `循环位移：B←A（第 ${i} 像素）`);
    eq(rot[i * 4 + 3], 10 + i, `循环位移：A←R（第 ${i} 像素）`);
  }

  const bgr = 第一('bgra');
  for (let i = 0; i < 4; i++) {
    eq(bgr[i * 4], 80 + i, `法线 B↔R：R 取 B（第 ${i} 像素）`);
    eq(bgr[i * 4 + 1], 40 + i, `法线 B↔R：G 不动（第 ${i} 像素）`);
    eq(bgr[i * 4 + 2], 10 + i, `法线 B↔R：B 取 R（第 ${i} 像素）`);
    eq(bgr[i * 4 + 3], 200 + i, `法线 B↔R：A 不动（第 ${i} 像素）`);
  }

  const inv = 第一('invert-r');
  for (let i = 0; i < 4; i++) {
    eq(inv[i * 4], 255 - (10 + i), `R 反相（第 ${i} 像素）`);
    eq(inv[i * 4 + 1], 40 + i, `R 反相：G 不动（第 ${i} 像素）`);
    eq(inv[i * 4 + 2], 80 + i, `R 反相：B 不动（第 ${i} 像素）`);
    eq(inv[i * 4 + 3], 200 + i, `R 反相：A 不动（第 ${i} 像素）`);
  }

  /* 铺满那四条跟 split 的关系：R 铺满 = R 那一路写进三路、A 拉满 */
  const gr = 第一('gray-r');
  eq(gr[0], 10, 'R 铺满 RGB：R');
  eq(gr[1], 10, 'R 铺满 RGB：G 也取 R');
  eq(gr[2], 10, 'R 铺满 RGB：B 也取 R');
  eq(gr[3], 255, 'R 铺满 RGB：A 拉满');

  /* 名字：新三条各有自己的后缀，别互相撞、也别跟别的撞 */
  eqArr(batchOutNames('x.png', 'bgra'), ['x_BGR.png'], 'bgra 的名字');
  eqArr(batchOutNames('x.png', 'invert-r'), ['x_R-inv.png'], 'invert-r 的名字');
  eqArr(batchOutNames('x.png', 'rotate'), ['x_rotate.png'], 'rotate 的名字');
  /* 新三条的名字不能跟别的操作撞。
     注意**不能**整体查重：`split` 的四个名字本来就跟 `extract-*` 一样
     （上面那节专门解释了"重名没关系，两边算出来同一张图"），所以只查这三条。 */
  const 别人 = BATCH_OPS.filter((o) => !['rotate', 'bgra', 'invert-r'].includes(o.id))
    .flatMap((o) => batchOutNames('x.png', o.id));
  for (const id of ['rotate', 'bgra', 'invert-r']) {
    const 名 = batchOutNames('x.png', id)[0];
    ok(!别人.includes(名), `${id} 的名字 ${名} 跟别的操作不撞`);
  }
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
