/**
 * 最近工程 / 快捷动作的自检。
 *
 * 只测纯逻辑那一半 —— 存放状态那半边用了 Svelte 的 rune，Node 里跑不了，
 * 那部分在真界面里验。这里盯的是最容易悄悄坏、界面上又看不出来的几件事：
 * 去重、保旧字段、截断上限、把指向已删动作的固定项丢掉。
 *
 * **下面第一行 import 的顺序是刻意的，别改。** 注册表和 quick.svelte.ts 互相引用，
 * 谁先求值决定了会不会踩到暂时性死区。应用里是注册表先（侧栏先引它），
 * 所以测试也照这个顺序引 —— 否则测试能过、应用白屏，那种 bug 就抓不住。
 *
 * 跑：node --import ./tmp/register-loader.mjs tmp/work-pages.test.mjs
 */
import { MODULES } from '../src/lib/modules/registry.ts';
import { upsert, sanitize, relTime } from '../src/lib/recent.svelte.ts';
import { allActions, ensurePinnedLoaded, pinned, sanitizePinned } from '../src/lib/quick.svelte.ts';

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

section('快捷动作：固定列表的清洗');

{
  const known = (id) => ['a', 'b', 'c'].includes(id);

  eq(sanitizePinned(null, known), null, '没存过 → null（调用方去用默认）');
  eq(sanitizePinned(undefined, known), null, 'undefined 同理');
  eq(sanitizePinned('不是数组', known), null, '坏了 → null 回退默认');
  eq(sanitizePinned([], known).length, 0, '存过空列表 → 就用空的（用户故意全取消）');

  const s = sanitizePinned(['a', 'a', 'zzz', 'b', 42, '', 'c'], known);
  eq(s.join(','), 'a,b,c', '去重 + 丢掉已不存在的动作 + 丢掉非字符串');
  eq(sanitizePinned(['zzz'], known).length, 0, '全是不存在的 → 空列表而不是 null');
}

section('快捷动作：默认固定项都得是真动作');

{
  // 默认列表里写错一个 id，第一次进页面就会少一个按钮，而且不报错
  const { allActions } = await import('../src/lib/quick.svelte.ts');
  const ids = new Set(allActions().map((a) => a.id));
  for (const want of ['channels/pipeline', 'channels/extract', 'ilm/pack', 'glitch/batch', 'app.theme']) {
    ok(ids.has(want), `默认固定项 ${want} 是真动作`);
  }
}

section('快捷动作：装初值这一步别写出循环引用');

{
  // 这一段就是刚才真出过的那个 bug：app 里是注册表先求值，
  // quick.svelte.ts 顶层就地读 localStorage 的话会撞上
  // "Cannot access 'MODULES' before initialization"，整页白屏。
  // 现在初值靠 ensurePinnedLoaded() 在组件实例化时补，这里手动走一遍那条路。
  eq(pinned.length, 0, '模块刚求值完时固定列表还是空的');
  ensurePinnedLoaded();
  ok(pinned.length > 0, `装完初值有内容（实得 ${pinned.length}）`);
  ok(pinned.every((id) => allActions().some((a) => a.id === id)), '装进来的都是真动作');

  // 再调一次不该翻倍
  const n = pinned.length;
  ensurePinnedLoaded();
  eq(pinned.length, n, '重复调用不会越装越多');
}

section('快捷动作：动作表从注册表派生');

{
  const list = allActions();
  const byId = new Map(list.map((a) => [a.id, a]));

  ok(list.length > 20, `动作数量够多（实得 ${list.length}）`);
  eq(new Set(list.map((a) => a.id)).size, list.length, 'id 不重复');

  // 每个「功能 · 分区」都该有一个动作
  let missing = [];
  for (const m of MODULES) {
    for (const p of m.panels ?? []) {
      if (!p.load) continue;
      if (!byId.has(`${m.id}/${p.id}`)) missing.push(`${m.id}/${p.id}`);
    }
  }
  ok(missing.length === 0, '所有带组件的分区都有对应动作', missing.join(', '));

  // 每个动作要么能跳转、要么能执行，不能两个都没有
  const dead = list.filter((a) => !a.href && !a.run).map((a) => a.id);
  ok(dead.length === 0, '没有点不动的动作', dead.join(', '));

  // 跳转类的 href 得是站内路径
  const badHref = list.filter((a) => a.href && !a.href.startsWith('/')).map((a) => a.id);
  ok(badHref.length === 0, 'href 都是站内路径', badHref.join(', '));

  // 带 ?panel= 的那些，panel 得真的是那个模块的分区
  const badPanel = [];
  for (const a of list) {
    const m = /^\/tools\/([^?]+)\?panel=(.+)$/.exec(a.href ?? '');
    if (!m) continue;
    const mod = MODULES.find((x) => x.id === m[1]);
    if (!mod || !(mod.panels ?? []).some((p) => p.id === m[2])) badPanel.push(a.id);
  }
  ok(badPanel.length === 0, '深链的 panel 参数都对得上', badPanel.join(', '));
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
