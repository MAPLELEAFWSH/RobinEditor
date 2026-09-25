/**
 * ② 调色「按步撤销」的纯逻辑测试。
 *
 * 测两样东西：
 *   ① `src\lib\modules\ikclut\撤销.ts` 的两个判据：**哪个字段变了**（合并用的 key）、**两份快照一样吗**；
 *   ② 跟真的 `History`（`src\lib\history.ts`，⑦ 通道那边同一份）合起来的行为：
 *      同一条滑杆连着拖 = 一步、换字段 = 两步、撤销之后又改会砍掉重做分支、上限、撤销还原后不再记一步。
 *
 * **没测到的**（如实写）："快照是深拷的"这条在 Node 里测不了（`$state.snapshot` 是 Svelte 编译器能力），
 * 放到无头浏览器探针里验（改完参数点撤销，值要回到旧值 —— 浅拷的话回不去）。
 *
 * 用法：node --import ./tmp/register-loader.mjs tmp\调色-撤销.test.mjs
 */
import { History } from '../src/lib/history.ts';
import { 变了哪个字段, 一样吗, 提交一步 } from '../src/lib/modules/ikclut/撤销.ts';

let n = 0;
let bad = 0;
const ok = (c, m) => {
  n++;
  if (!c) {
    bad++;
    console.log(`  FAIL ${m}`);
  }
};
const eq = (a, b, m) => ok(Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b), `${m}（期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}）`);

/* ---------------- 一、变了哪个字段 ---------------- */

const 甲 = { 基本: { exposure: 1, contrast: 1 }, 链形: [{ kind: 'basic', on: true }, { kind: 'curves', on: true }] };
eq(变了哪个字段(甲, structuredClone(甲)), '', '一模一样 → 空串');
eq(变了哪个字段(甲, { ...structuredClone(甲), 基本: { exposure: 1.2, contrast: 1 } }), '基本.exposure', '普通字段 → 点路径');
eq(
  变了哪个字段(甲, { ...structuredClone(甲), 链形: [{ kind: 'basic', on: true }, { kind: 'curves', on: false }] }),
  '链形[1].on',
  '数组里的一项 → 带下标'
);
eq(变了哪个字段(甲, { ...structuredClone(甲), 链形: [甲.链形[0]] }), '链形', '数组变短 → 报数组本身（增删一步）');
eq(变了哪个字段({ a: 1 }, { a: 1, b: 2 }), 'b', '只有一边有的键也算变了');
eq(变了哪个字段({ 混合: { 表数: 2, x: 0.5, y: 0.5 } }, { 混合: { 表数: 2, x: 0.5, y: 0.6 } }), '混合.y', '嵌套两层');

/* 键的顺序不该影响判断（`$state.snapshot` 回来的对象顺序可能跟手写的不一样） */
ok(一样吗({ a: 1, b: 2 }, { b: 2, a: 1 }), '一样吗：不看键的顺序');
ok(!一样吗({ a: 1 }, { a: 1.0001 }), '一样吗：数值变了要认出来');
ok(一样吗({ 链形: [{ on: true }] }, { 链形: [{ on: true }] }), '一样吗：数组按内容比');

/* ---------------- 二、跟真的 History 合起来 ---------------- */

/** 造一份"调色状态"的样子 */
const 造状态 = (曝光) => ({ 基本: { exposure: 曝光, contrast: 1 }, 链形: [{ kind: 'basic', on: true }] });

{
  const 栈 = new History({ cap: 120, coalesceMs: 600 });
  /* 第一格：空栈时 push 会 reset，等于记下起点 */
  ok(提交一步(栈, 造状态(1), 1000), '空栈第一次提交 → 记下了（起点）');
  eq(栈.size, 1, '空栈第一次提交后 size=1');
  ok(!提交一步(栈, 造状态(1), 1100), '一模一样 → 不再记');
  eq(栈.size, 1, '一样的时候 size 不动');

  /* 同一条滑杆连着拖 20 下（同一个 key、时间挨着）→ 只该占一步 */
  for (let i = 1; i <= 20; i++) 提交一步(栈, 造状态(1 + i * 0.01), 1200 + i * 30);
  eq(栈.size, 2, '同一条滑杆连拖 20 下 → 共 2 格（起点 + 这一步）');

  /* 隔久了再改同一个字段 → 新的一步 */
  提交一步(栈, 造状态(2), 1200 + 20 * 30 + 5000);
  eq(栈.size, 3, '隔了 5 秒再改同一个字段 → 新的一步');

  /* 换字段 → 新的一步 */
  提交一步(栈, { 基本: { exposure: 2, contrast: 1.3 }, 链形: [{ kind: 'basic', on: true }] }, 1200 + 20 * 30 + 6000);
  eq(栈.size, 4, '换字段（对比度）→ 又是一步');
  ok(栈.canUndo, 'canUndo=true');

  /* 撤销：拿到的是上一格的状态 */
  const 回1 = 栈.undo();
  eq(回1.基本.contrast, 1, '撤销 → 对比度回到 1');
  const 回2 = 栈.undo();
  /* 拖动那 20 下**合并成一格**，格子里存的是最后一次推的值 = 1 + 20×0.01 */
  eq(回2.基本.exposure, 1.2, '再撤一次 → 回到"拖动那一步"结束时的值（20 下合并成一格，停在 1.2）');
  eq(栈.index, 1, '撤两次之后 index=1');
  ok(栈.canUndo, '还没到起点，还能再撤');
  栈.undo();
  eq(栈.index, 0, '第三次撤销 → 到起点 index=0');
  ok(!栈.canUndo, '到起点 → canUndo=false');

  /* 重做 */
  栈.redo();
  eq(栈.index, 1, '重做一次 → index 回到 1');
  ok(栈.canRedo, '后面还有格 → canRedo=true');

  /* 撤销之后又改 → 重做分支被砍掉 */
  栈.undo();
  提交一步(栈, { 基本: { exposure: 9, contrast: 1 }, 链形: [{ kind: 'basic', on: true }] }, 99999);
  ok(!栈.canRedo, '撤销之后又改 → canRedo=false（重做分支砍掉了）');
  eq(栈.size, 2, '撤销到起点之后又改 → 栈裁成 2 格（起点 + 这次）');
  eq(栈.current.基本.exposure, 9, '当前格就是刚改的那个值');
}

/* 上限：cap=120，连推 200 步只该留最后 120 格 */
{
  const 栈 = new History({ cap: 120, coalesceMs: 0 });
  提交一步(栈, 造状态(0), 0);
  for (let i = 1; i <= 200; i++) 提交一步(栈, 造状态(i), i * 1000);
  eq(栈.size, 120, 'cap=120：200 步之后只留 120 格');
  ok(栈.canUndo, '被砍掉头之后仍能撤');
  eq(栈.current.基本.exposure, 200, '当前格是最新那次');
}

console.log(`\n通过 ${n} 条，失败 ${bad} 条`);
process.exit(bad ? 1 : 0);
