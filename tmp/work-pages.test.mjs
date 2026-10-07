/**
 * 「最近工程」那套记录逻辑的自检（`src/lib/recent.svelte.ts`）。
 *
 * 只测纯逻辑那一半 —— 存放状态那半边用了 Svelte 的 rune，Node 里跑不了，
 * 那部分在真界面里验。这里盯的是最容易悄悄坏、界面上又看不出来的几件事：
 * 去重、保旧字段、截断上限、手改过 localStorage 也扛得住。
 *
 * **那一页（`/tools/recent`）2026-10-07 删了，这套逻辑留着** ——
 * 状态栏那条「当前工程」、⑨ 的报工程都读它。文件名叫 work-pages 是历史，
 * 别照着名字去找"工作区那两页"。
 *
 * 跑：node --import ./tmp/register-loader.mjs tmp/work-pages.test.mjs
 */
import { upsert, sanitize, relTime } from '../src/lib/recent.svelte.ts';

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

const entry = (path, label = '', at = 1, used = 1) => ({
  path,
  name: path.replace(/[\\/]+$/, '').split(/[\\/]/).pop(),
  label,
  href: '',
  at,
  used
});

/* ============================================================ */

section('最近工程：同目录只留一条');

{
  let list = [];
  list = upsert(list, 'D:\\a\\Models', '批量提取', '/x', 100);
  list = upsert(list, 'D:\\b\\Other', '配对检查', '/y', 200);
  eq(list.length, 2, '两个目录两条');
  eq(list[0].path, 'D:\\b\\Other', '最新的排前面');

  list = upsert(list, 'D:\\a\\Models', 'ILM 打包', '/z', 300);
  eq(list.length, 2, '同一个目录再来一次不新增');
  eq(list[0].path, 'D:\\a\\Models', '挪到最前面');
  eq(list[0].used, 2, '次数累加');
  eq(list[0].label, 'ILM 打包', 'label 用最新的（接着做该回的地方变了）');
  eq(list[0].href, '/z', 'href 也跟着换');
  eq(list[1].path, 'D:\\b\\Other', '另一条还在');
  eq(list[1].used, 1, '另一条次数没被带偏');
}

section('最近工程：label 留空不抹掉旧的');

{
  // 有的调用点不传 label（比如只选目录不干活），不该把上次记的抹了
  let list = upsert([], 'D:\\a', '批量提取', '/x', 100);
  list = upsert(list, 'D:\\a', '', '', 200);
  eq(list[0].label, '批量提取', '空 label 不覆盖');
  eq(list[0].href, '/x', '空 href 不覆盖');
  eq(list[0].used, 2, '次数照样累加');
  eq(list[0].at, 200, '时间是新的');
}

section('最近工程：上限');

{
  let list = [];
  for (let i = 0; i < 40; i++) list = upsert(list, `D:\\m\\${i}`, 'x', '/h', i);
  eq(list.length, 24, '最多 24 条');
  eq(list[0].path, 'D:\\m\\39', '最新的在最前');
  ok(!list.some((e) => e.path === 'D:\\m\\0'), '最早的被挤掉了');
  eq(list[list.length - 1].path, 'D:\\m\\16', '最老的留下的是第 16 条');
}

section('最近工程：空路径不进列表');

{
  const list = upsert([], '', 'x', '/h', 1);
  eq(list.length, 0, '空路径丢掉');
}

section('最近工程：名字从路径末段取');

{
  const list = upsert([], 'D:\\MMD\\千夏_午后茶歇\\Textures\\', 'x', '/h', 1);
  eq(list[0].name, 'Textures', '去掉尾部分隔符再取末段');
}

section('最近工程：手改过 localStorage 也扛得住');

{
  eq(sanitize(null).length, 0, 'null → 空');
  eq(sanitize('字符串').length, 0, '不是数组 → 空');
  eq(sanitize([null, 1, {}, { path: '' }]).length, 0, '缺 path 的丢掉');

  const s = sanitize([
    { path: 'D:\\a', name: 'a', label: 'L', href: '/h', at: 5, used: 3 },
    { path: 'D:\\b' }, // 只给了路径
    { path: 'D:\\c', used: 0 } // used 是 0，得补成 1
  ]);
  eq(s.length, 3, '三条都留下');
  eq(s[1].name, 'b', '缺 name 就从路径补');
  eq(s[1].used, 1, '缺 used 补 1');
  eq(s[1].label, '', '缺 label 补空串');
  eq(s[2].used, 1, 'used=0 补成 1（0 次用过说不通）');
  eq(s[0].used, 3, '正常的不动');
}

section('最近工程：相对时间');

{
  const now = Date.now();
  eq(relTime(now - 5_000), '刚刚', '5 秒前');
  eq(relTime(now - 5 * 60_000), '5 分钟前', '5 分钟前');
  eq(relTime(now - 5 * 3_600_000), '5 小时前', '5 小时前');
  eq(relTime(now - 5 * 86_400_000), '5 天前', '5 天前');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(relTime(now - 60 * 86_400_000)), '超过 30 天给日期');
  eq(relTime(0), '', '没时间戳就不显示');
}

/* 快捷动作那四节（固定列表清洗、默认项、装初值、动作表派生）2026-10-07 随页面一起删了 ——
   `src/lib/quick.svelte.ts` 不存在了。动作表那节守的"每个带组件的分区都能深链"
   现在由 `tmp/panel-ids.test.mjs` 从注册表那一侧钉着。 */

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
