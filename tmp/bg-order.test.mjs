/**
 * 背景列表排序 / 隐藏 / 删完选哪张 的自检。
 *
 * 跑：node --import ./tmp/register-loader.mjs tmp/bg-order.test.mjs
 */
import { arrangeBgs, moveInOrder, nextBgAfter } from '../src/lib/bg-order.ts';

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
function eqArr(a, b, label) {
  ok(JSON.stringify(a) === JSON.stringify(b), label, `实得 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}`);
}
function section(t) {
  console.log(`\n== ${t} ==`);
}

const B = (...ids) => ids.map((id) => ({ id, name: id }));
const ids = (list) => list.map((x) => x.id);

/* ============================================================ */

section('没排过顺序就按原样');

{
  const items = B('wp-01', 'wp-02', 'wp-03');
  eqArr(ids(arrangeBgs(items, [], [])), ['wp-01', 'wp-02', 'wp-03'], '空顺序表 = 原顺序');
}

section('隐藏内置');

{
  const items = B('wp-01', 'wp-02', 'wp-03');
  eqArr(ids(arrangeBgs(items, [], ['wp-02'])), ['wp-01', 'wp-03'], '藏掉中间一张');
  eqArr(ids(arrangeBgs(items, [], ['wp-01', 'wp-03'])), ['wp-02'], '藏掉多张');
  eqArr(ids(arrangeBgs(items, [], [])).length === 3, true, '不藏就都在');
  eqArr(ids(arrangeBgs(items, [], ['不存在'])), ['wp-01', 'wp-02', 'wp-03'], '隐藏表里有无效 id 不影响');
}

section('自定义顺序');

{
  const items = B('wp-01', 'wp-02', 'wp-03');
  eqArr(ids(arrangeBgs(items, ['wp-03', 'wp-01', 'wp-02'], [])), ['wp-03', 'wp-01', 'wp-02'], '整表重排');
  eqArr(
    ids(arrangeBgs(items, ['wp-03', 'wp-02'], [])),
    ['wp-03', 'wp-02', 'wp-01'],
    '顺序表不全的排后面，保持原相对顺序'
  );
}

section('新导入的接在末尾');

{
  // 顺序表是 ['wp-01'] 的时候导入 cu-a，它不该插到 wp-02 前面
  const items = B('wp-01', 'wp-02', 'wp-03', 'cu-a');
  eqArr(
    ids(arrangeBgs(items, ['wp-01', 'wp-03'], [])),
    ['wp-01', 'wp-03', 'wp-02', 'cu-a'],
    '排过的在前，没排过的按原顺序跟在后面'
  );
}

section('隐藏 + 排序一起');

{
  const items = B('wp-01', 'wp-02', 'wp-03', 'cu-a');
  eqArr(
    ids(arrangeBgs(items, ['cu-a', 'wp-01'], ['wp-02'])),
    ['cu-a', 'wp-01', 'wp-03'],
    '先按顺序摆再滤掉隐藏的'
  );
}

section('挪顺序');

{
  eqArr(moveInOrder(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c'], '往前挪一格');
  eqArr(moveInOrder(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b'], '往后挪一格');
  eqArr(moveInOrder(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c'], '第一张再往前没变化');
  eqArr(moveInOrder(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c'], '最后一张再往后没变化');
  eqArr(moveInOrder(['a', 'b', 'c'], '不存在', 1), ['a', 'b', 'c'], '不认识 id 不动');
  eqArr(moveInOrder([], 'a', 1), [], '空列表');
}

section('挪完再摆回去要一致');

{
  // 挪了之后写进 prefs 的就是完整顺序表，用 arrangeBgs 摆回来必须跟挪的结果一样
  const items = B('a', 'b', 'c', 'd');
  const after = moveInOrder(ids(items), 'c', -1);
  eqArr(after, ['a', 'c', 'b', 'd'], '挪完的顺序');
  eqArr(ids(arrangeBgs(items, after, [])), after, '摆回来跟挪的结果一致');
}

section('删掉当前这张之后选谁');

{
  eqArr(nextBgAfter(['a', 'b', 'c'], 'b'), 'c', '有后面那张就选后面的');
  eqArr(nextBgAfter(['a', 'b', 'c'], 'c'), 'b', '最后一张就往前找');
  eqArr(nextBgAfter(['a'], 'a'), '', '只剩它一个，删完就空了');
  eqArr(nextBgAfter([], 'a'), '', '列表本来就空');
  eqArr(nextBgAfter(['a', 'b'], '不在列表里'), 'a', 'id 认不出就回第一张');
}

{
  // 这条是原先那个 bug：硬编码 wp-01，内置全藏了就跳回一张看不见的图
  const onlyCustom = ['cu-a', 'cu-b'];
  const next = nextBgAfter(onlyCustom, 'cu-a');
  ok(next !== 'wp-01', '只用自己的图时不会跳回内置的 wp-01');
  eqArr(next, 'cu-b', '选的是列表里的下一张');
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
