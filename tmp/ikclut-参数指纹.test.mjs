/**
 * ② 「参数指纹」的守卫。
 *
 * **它守的是什么**：`Ikclut.svelte` 里那个「参数一变就把补细图的计时器推倒重来」的
 * effect，靠的是 `参数指纹` 这一行字符串建立依赖。指纹**漏掉任何一个参数**，
 * 那个参数改了就不会重跑 —— 而现象是"预览还在按旧的分辨率档算"，
 * 不报错、界面上也看不出来。原来那个版本用的是 `void 基本;` 这种写法，
 * 一个字段都没挂上，等于整个漏掉，实测每敲一个数字堵主线程 99.5ms。
 *
 * 所以这里**逐个字段**改一遍，改完指纹必须变。加参数忘了进指纹 = 这里红。
 * 最后一条是破坏性试验：故意用一份"漏掉基本参数"的指纹，它必须**不掉红**才对
 * —— 要是它也变了，说明这个探测器根本抓不住漏项，前面那些绿的都不算数。
 *
 * 跑法：node --import ./tmp/register-loader.mjs tmp/ikclut-参数指纹.test.mjs
 */
import { 算指纹 } from '../src/lib/modules/ikclut/参数指纹.ts';
import {
  新建基本,
  新建曲线,
  新建色轮,
  新建Hsl,
  新建Log,
  新建变形,
  变形边,
  HSL段
} from '../src/lib/modules/ikclut/grade/types.ts';
import { DEFAULT_REF } from '../src/lib/modules/ikclut/refsample.ts';

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}   ${extra}`);
  }
}
// 自检 ok() 本身：条件为假时必须记成失败
{
  const before = fail;
  const real = console.log;
  console.log = () => {};
  ok('__selfcheck__', false);
  console.log = real;
  if (fail !== before + 1) {
    console.error('ok() 本身是坏的：条件为假没被记成失败');
    process.exit(1);
  }
  fail = before;
}
function section(t) {
  console.log(`\n=== ${t} ===`);
}

/* ---------------- 夹具：一份完整的指纹输入 ---------------- */

function 造输入() {
  const 链形 = [
    { id: 'n1', kind: 'basic', on: true },
    { id: 'n2', kind: 'curves', on: true }
  ];
  return {
    链形,
    基本: { ...新建基本() },
    曲线: JSON.parse(JSON.stringify(新建曲线())),
    色轮: JSON.parse(JSON.stringify(新建色轮())),
    hsl: JSON.parse(JSON.stringify(新建Hsl())),
    log: { ...新建Log() },
    变形: JSON.parse(JSON.stringify(新建变形())),
    lut: { name: '', strength: 1, clamped: 0, size: 0, 有表: false },
    切片反序: false,
    抄参考图: { ...DEFAULT_REF },
    用测试图: true,
    有参考图: false
  };
}

const 基 = 算指纹(造输入());
ok('指纹是字符串且不长', typeof 基 === 'string' && 基.length > 20 && 基.length < 4000, 基.length);

/**
 * 改一个地方，指纹必须跟着变。
 * `改` 收到一份新建的输入，就地动它要动的那一处。
 */
function 试(名, 改) {
  const 入 = 造输入();
  const 前 = 算指纹(入);
  改(入);
  const 后 = 算指纹(入);
  ok(名, 前 !== 后, '这个字段改了指纹没变 —— 它没进指纹');
}

/* ---------------- 链的形状 ---------------- */

section('链的形状');
试('链上节点的开关注指纹', (i) => (i.链形[0].on = false));
试('链上节点的种类进指纹', (i) => (i.链形[1].kind = 'wheels'));
试('链上节点的 id 进指纹（挪位置会换顺序）', (i) => (i.链形[0].id = 'n9'));
试('链上节点换顺序进指纹', (i) => i.链形.reverse());

/* ---------------- 基本 ---------------- */

section('基本（十个字段逐个试）');
for (const k of Object.keys(新建基本())) {
  试(`基本.${k}`, (i) => (i.基本[k] = i.基本[k] + 1));
}

/* ---------------- 曲线 ---------------- */

section('曲线');
for (const k of ['r', 'g', 'b', 'luma', 'extra']) {
  试(`曲线.${k} 的控制点进指纹`, (i) => (i.曲线[k] = [...i.曲线[k], { x: 0.4, y: 0.9 }]));
  试(`曲线.${k} 的坐标改了进指纹`, (i) => (i.曲线[k][0].y = 0.37));
}
试('曲线.kind 进指纹', (i) => (i.曲线.kind = 'smooth'));
试('曲线.extraCh 进指纹', (i) => (i.曲线.extraCh = 'g'));

/* ---------------- 色轮 ---------------- */

section('色轮');
for (const 名 of ['暗', '中', '高', '全局']) {
  for (const k of ['h', 's', 'l']) {
    试(`色轮.${名}.${k}`, (i) => (i.色轮[名][k] = i.色轮[名][k] + 1));
  }
}
for (const k of [0, 1, 2]) {
  试(`色轮.偏移[${k}]`, (i) => (i.色轮.偏移[k] = i.色轮.偏移[k] + 1));
}

/* ---------------- HSL ---------------- */

section('HSL');
试('HSL.平滑', (i) => (i.hsl.平滑 = i.hsl.平滑 + 1));
for (let i = 0; i < HSL段.length; i++) {
  for (const k of ['h', 's', 'l']) {
    试(`HSL.${HSL段[i].name}.${k}`, (v) => (v.hsl.bands[i][k] = v.hsl.bands[i][k] + 1));
  }
}

/* ---------------- LOG ---------------- */

section('LOG/HDR');
for (const k of Object.keys(新建Log())) {
  试(`log.${k}`, (i) => (i.log[k] = typeof i.log[k] === 'number' ? i.log[k] + 1 : 'log2'));
}

/* ---------------- 变形 ---------------- */

section('变形');
for (const 键 of ['色相饱和', '色相亮度']) {
  for (const idx of [0, 1, 变形边 * 变形边 - 1]) {
    试(`变形.${键}[${idx}]`, (i) => (i.变形[键][idx] = i.变形[键][idx] + 1));
  }
}
for (const k of ['饱和量', '亮度量', '色相量']) {
  试(`变形.${k}`, (i) => (i.变形[k] = i.变形[k] + 1));
}

/* ---------------- 导入的 LUT ---------------- */

section('导入的 LUT');
试('lut.name', (i) => (i.lut.name = '别的.cube'));
试('lut.strength', (i) => (i.lut.strength = 0.5));
试('lut.clamped', (i) => (i.lut.clamped = 3));
试('lut.size', (i) => (i.lut.size = 33));
试('lut.有表（装了/卸掉）', (i) => (i.lut.有表 = true));

/* ---------------- 其余开关 ---------------- */

section('其余开关');
试('切片反序', (i) => (i.切片反序 = true));
试('抄参考图.bands', (i) => (i.抄参考图.bands = 16));
试('抄参考图.strength', (i) => (i.抄参考图.strength = 0.5));
试('抄参考图.trim', (i) => (i.抄参考图.trim = 0.1));
试('抄参考图.saturation', (i) => (i.抄参考图.saturation = 1.5));
试('用测试图（换基准图）', (i) => (i.用测试图 = false));
试('有没有参考图', (i) => (i.有参考图 = true));

/* ---------------- 破坏性试验：探测器抓不抓得住"漏项" ---------------- */

section('破坏性试验：漏掉一整块参数，指纹必须不变（说明这些断言真的在抓东西）');
{
  const 漏 = (i) =>
    JSON.stringify([
      i.链形.map((n) => [n.id, n.kind, n.on]),
      /* 故意不带上 i.基本 */
      i.曲线,
      i.色轮,
      i.hsl,
      i.log,
      i.变形,
      i.lut,
      i.切片反序,
      i.抄参考图,
      i.用测试图,
      i.有参考图
    ]);
  const 入 = 造输入();
  const 前 = 漏(入);
  入.基本.exposure = 1.9;
  ok('漏掉基本参数时，改曝光指纹**不变**（照抄上面那条断言就会红）', 漏(入) === 前);
}

/* ---------------- 同一份输入必须给同一行指纹 ---------------- */

section('稳定性');
{
  const 一 = 算指纹(造输入());
  const 二 = 算指纹(造输入());
  ok('同样的参数两次算出来一样', 一 === 二);
  /* 指纹是"参数的函数"，同一份参数重复算必须一样 —— 不然计时器会被无谓地重置 */
  const 入 = 造输入();
  ok('同一份输入算两遍一样', 算指纹(入) === 算指纹(入));
  /* 直接改原对象也算得出来（界面里就是原地改 $state 的字段） */
  const 前 = 算指纹(入);
  入.基本.exposure = 1.77;
  ok('原地改字段之后算，拿到的是新的一行', 算指纹(入) !== 前);
}

console.log(`\n通过 ${pass} 条，失败 ${fail} 条`);
process.exitCode = fail ? 1 : 0;
