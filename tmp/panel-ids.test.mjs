/**
 * 分区 id 的两边对齐：**注册表**里列的分区，跟**组件**里认的分区，必须一一对上。
 *
 * 为什么专门有这个测试：组件的分区链最后本来是裸 `{:else}` ——
 * 注册表里加/改一个 id、忘了改组件，那一页会**静默渲染最后一个分区**：
 * 界面上看起来完全正常，内容却是别的页的。这种错很难发现（用户只会觉得"这页怎么长这样"）。
 *
 * 2026-09-20 给七个组件都加了"不认识的 id 就明说"的护栏，这个测试把两边钉在一起：
 * 注册表里每个分区，都要在它那个组件里找得到对应（护栏数组里、或 `panelId === '<id>'` 分支里）。
 *
 * 跑：node --import ./tmp/register-loader.mjs tmp/panel-ids.test.mjs
 */
import { readFileSync } from 'node:fs';

let n = 0;
let bad = 0;
const ok = (c, m) => {
  n++;
  if (!c) {
    bad++;
    console.log(`  FAIL ${m}`);
  }
};

const 注册表 = readFileSync('src/lib/modules/registry.ts', 'utf8');

/* ① 加载器名 → 组件文件：`const loadIkclut = () => import('./ikclut/Ikclut.svelte');` */
const 加载器 = new Map();
for (const m of 注册表.matchAll(/const\s+(load\w+)\s*=\s*\(\)\s*=>\s*import\('\.\/([^']+)'\)/g)) {
  加载器.set(m[1], `src/lib/modules/${m[2]}`);
}
/* 下界卡的是"有没有人把按需加载改回静态 import"。
   2026-09-26 ④ msToon 整个模块删掉，加载器从 12 降到 11、分区从 31 降到 26 —— 跟着落。
   2026-10-07 工作区的「最近工程」「快捷动作」两页删掉，加载器 11 → 9、分区 26 → 24。 */
ok(加载器.size >= 9, `注册表里认出 ${加载器.size} 个加载器`);

/* ② 每个模块的 panels：从 `id: '<模块>'` 起，取它后面第一个 `panels: [ ... ]` */
const 全部 = [];
for (const m of 注册表.matchAll(/\n\s{2}\{\n\s{4}id: '(\w+)',[\s\S]*?\n\s{4}panels: \[([\s\S]*?)\n\s{4}\]/g)) {
  const 模块 = m[1];
  for (const p of m[2].matchAll(/\{\s*id: '([\w-]+)'[\s\S]*?load:\s*(\w+)/g)) {
    全部.push({ 模块, 分区: p[1], 加载器: p[2] });
  }
}
ok(全部.length >= 24, `注册表里认出 ${全部.length} 个分区`);

/* ③ 逐个分区：它那个组件里必须认这个 id */
const 缓存 = new Map();
const 读 = (文件) => {
  if (!缓存.has(文件)) 缓存.set(文件, readFileSync(文件, 'utf8'));
  return 缓存.get(文件);
};

let 查过 = 0;
for (const p of 全部) {
  const 文件 = 加载器.get(p.加载器);
  ok(!!文件, `${p.模块}/${p.分区} 的加载器 ${p.加载器} 有对应文件`);
  if (!文件) continue;
  const 源 = 读(文件);
  /* 三种情况都算"认这个 id"：
     · 护栏数组里列了它（`!['a','b'].includes(panelId)`）
     · 有 `panelId === '<id>'` 分支
     · 组件只服务这一个分区（源里根本没有 panelId 分支）—— 那种靠注册表只有一个分区保证 */
  const 有分支 = 源.includes(`panelId === '${p.分区}'`);
  const 在护栏里 = new RegExp(`\\[[^\\]]*'${p.分区}'[^\\]]*\\][\\s\\n]*\\.includes\\(panelId\\)`).test(源);
  const 单分区组件 = !/panelId === '/.test(源);
  ok(有分支 || 在护栏里 || 单分区组件, `${p.模块}/${p.分区} → ${文件.split('/').pop()} 里认得这个 id`);
  查过++;
}

/* ④ 反过来：组件里写死的 id 也要在注册表里找得到（否则就是"有这个页面但点不到"） */
const 注册表里的id = new Set(全部.map((p) => p.分区));
for (const [名, 文件] of 加载器) {
  const 源 = 读(文件);
  for (const m of 源.matchAll(/panelId === '([\w-]+)'/g)) {
    const id = m[1];
    const 所属模块 = 全部.find((p) => p.加载器 === 名);
    if (!所属模块) continue;
    ok(注册表里的id.has(id), `${文件.split('/').pop()} 里的 '${id}' 在注册表里存在`);
  }
}

console.log(`\npanel-ids：${n} 条断言，${bad} 条没过（查了 ${查过} 个分区）`);
process.exit(bad ? 1 : 0);
