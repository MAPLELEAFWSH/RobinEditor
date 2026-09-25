/**
 * 撤销 / 重做的自检。
 *
 * 盯三件事，这三件坏了界面上都只是"感觉不对"：
 *   1. 同键合并 —— 拖滑杆十几下该只留一步，不然撤销要点十几次
 *   2. 撤销后新改动要砍掉重做分支 —— 不然 redo 会跳到一个跟当前毫无关系的旧状态
 *   3. 上限截断之后 pos 要跟着挪 —— 挪错了撤销会跳到错的一格
 *
 * 跑：node --import ./tmp/register-loader.mjs tmp/history.test.mjs
 */
import { History } from '../src/lib/history.ts';

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

/* ============================================================ */

section('基本推进');

{
  const h = new History({ coalesceMs: 0 });
  h.reset('s0', 1000);
  eq(h.size, 1, '起手一格');
  eq(h.current, 's0', '当前是 s0');
  eq(h.canUndo, false, '还不能撤销');
  eq(h.canRedo, false, '也不能重做');

  h.push('s1', 'a', 1100);
  eq(h.size, 2, '加了一格');
  eq(h.current, 's1', '当前是 s1');
  eq(h.canUndo, true, '能撤销了');
  eq(h.canRedo, false, '还没法重做');

  eq(h.undo(), 's0', '撤销回到 s0');
  eq(h.canUndo, false, '到头了');
  eq(h.canRedo, true, '能重做了');
  eq(h.redo(), 's1', '重做回到 s1');
  eq(h.current, 's1', '当前又是 s1');
  eq(h.canRedo, false, '重做到头');
}

section('同键合并：拖滑杆算一步');

{
  const h = new History({ coalesceMs: 500 });
  h.reset(0, 1000);
  // 模拟拖滑杆：同一个键连着来十几次，每次隔 30ms
  for (let i = 1; i <= 14; i++) h.push(i, 'opacity', 1000 + i * 30);
  eq(h.size, 2, '十四次改动只留两格（起点 + 一步）');
  eq(h.current, 14, '当前值是最新的');

  // 停手久一点再改，该算新的一步（注意：不能先 undo，
  // undo 会把 lastKey 清掉、还会砍掉后面那一格，那就测不到"停手"这件事了）
  h.push(20, 'opacity', 3000);
  eq(h.size, 3, '停手之后再改算新的一步');
  eq(h.undo(), 14, '撤销只退回拖动结束那一步');
  eq(h.undo(), 0, '再撤销才回到拖动前');
}

{
  // 不同键不合并
  const h = new History({ coalesceMs: 500 });
  h.reset('s0', 1000);
  h.push('s1', 'layers', 1010);
  h.push('s2', 'adjust', 1020);
  h.push('s3', 'opacity', 1030);
  eq(h.size, 4, '三个不同的键留三格');
}

{
  // 合并窗口设 0 就是不合并
  const h = new History({ coalesceMs: 0 });
  h.reset('s0', 1000);
  h.push('s1', 'same', 1000);
  h.push('s2', 'same', 1000);
  eq(h.size, 3, '窗 0 时同键也不合并');
}

{
  // 第一格不能被合并吃掉 —— 合并只能覆盖 pos>0 的格
  const h = new History({ coalesceMs: 9999 });
  h.reset('s0', 1000);
  h.push('s1', 'k', 1001);
  h.push('s2', 'k', 1002);
  eq(h.size, 2, '起点还在');
  eq(h.snapshot().stack[0], 's0', '第一格没被覆盖');
}

section('撤销之后再改，重做分支要砍掉');

{
  const h = new History({ coalesceMs: 0 });
  h.reset('s0', 0);
  h.push('s1', 'a', 10);
  h.push('s2', 'b', 20);
  h.push('s3', 'c', 30);
  eq(h.undo(), 's2', '退一步');
  eq(h.undo(), 's1', '再退一步');
  eq(h.canRedo, true, '这时候有重做可用');

  h.push('sX', 'd', 40);
  eq(h.size, 3, '新改动把 s2/s3 那条分支砍掉了');
  eq(h.current, 'sX', '当前是新状态');
  eq(h.canRedo, false, '没得重做了');
  // 关键：redo 不能跳回 s2 那种"跟当前毫无关系"的旧状态
  eq(h.redo(), null, 'redo 返回空，不会跳回去');
}

{
  // 撤销之后紧接着改，不该跟撤销前那次合并
  const h = new History({ coalesceMs: 9999 });
  h.reset('s0', 0);
  h.push('s1', 'k', 10);
  h.undo();
  h.push('sX', 'k', 20);
  eq(h.size, 2, '是同键也不合并（撤销过了）');
  eq(h.current, 'sX', '当前是新状态');
  eq(h.undo(), 's0', '撤销回到起点，不是回到 s1');
}

section('上限截断');

{
  const h = new History({ cap: 5, coalesceMs: 0 });
  h.reset(0, 0);
  for (let i = 1; i <= 12; i++) h.push(i, 'k' + i, i);
  eq(h.size, 5, '最多留 5 格');
  eq(h.current, 12, '当前还是最新的');
  // 从头丢，pos 要跟着挪到末尾
  eq(h.snapshot().pos, 4, 'pos 在末尾');
  eq(h.undo(), 11, '撤销拿到前一格');

  // 一路退到底，能退到的就是留下的那批里最早的一个
  let v = h.undo();
  v = h.undo();
  v = h.undo();
  eq(v, 8, '退到最早就停在 8（12-4）');
  eq(h.canUndo, false, '到底了');
  eq(h.undo(), null, '再退返回空');
}

{
  // cap 给太小要兜住
  const h = new History({ cap: 1, coalesceMs: 0 });
  h.reset(0, 0);
  h.push(1, 'a', 1);
  ok(h.size >= 2, `cap=1 也至少留得下当前状态（实得 ${h.size}）`);
}

section('从头用：还没 reset 就 push');

{
  const h = new History();
  h.push('第一格', 'k', 5);
  eq(h.size, 1, '自动当成起点');
  eq(h.current, '第一格', '当前是它');
  eq(h.canUndo, false, '一格时不能撤销');
}

section('reset 清干净');

{
  const h = new History({ coalesceMs: 0 });
  h.reset('a', 0);
  h.push('b', 'x', 1);
  h.push('c', 'y', 2);
  h.undo();
  h.reset('新起点', 3);
  eq(h.size, 1, '只剩一格');
  eq(h.canUndo, false, '不能撤销');
  eq(h.canRedo, false, '不能重做');
  eq(h.current, '新起点', '是新的起点');
}

section('对象状态也照样存（存的是引用，不是深拷贝）');

{
  // 这边故意不深拷贝：调用方每次都造**新对象**传进来。
  // 如果哪天有人就地改同一个对象再 push，历史里每一格都会变成同一个值 ——
  // 这条测试把这个前提钉住。
  const h = new History({ coalesceMs: 0 });
  const a = { n: 1 };
  h.reset(a, 0);
  const b = { n: 2 };
  h.push(b, 'x', 1);
  eq(h.current.n, 2, '当前是新对象');
  ok(h.undo() === a, '撤销拿回的是原来那个对象');
  eq(h.redo(), b, '重做拿回新对象');
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
