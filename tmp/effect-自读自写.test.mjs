/**
 * 守卫：`$effect` 里**读自己写的那份 state** —— 就是「界面卡死」的真因那一类。
 *
 * 为什么钉这条：这个病已经咬过两次，而且症状都是用户先撞上的。
 *   · ② ikClut：`同步痕` 在自己那个 effect 里整份换掉 → 开场幕布再也不撤，整页点不动；
 *   · ⑦ 通道提取 / 批量提取（2026-09-23 实测量到）：
 *     `verdict = analyzeAlpha(img)` 写完下一行读 `verdict.rich`、
 *     `releaseRowUrls(rows)` 读完下一行 `rows = buildPlan(...)`。
 *     前者载入一张贴图冻 **3970 ms**、后者点「选目录」冻 **31 秒**，然后抛
 *     `effect_update_depth_exceeded`，之后这一页点哪都不生效。
 *
 * **这种写法在源码里长得完全正常**（写一下、下一行读回来），人工看不住，
 * 所以拿**编译产物**当判据：Svelte 编译后读写都带标记 ——
 * `$.set(X, …)` 是它写的、`$.get(X)` 是它读的，一个 `$.user_effect(...)` 块里
 * 两边都有同一个 X 就是命中。模板里读同一份 state 不算（那不在 effect 块里）。
 *
 * 命中**不一定**是死循环：写进去的是恒定值、或者有等值守卫，跑一轮就停。
 * 那种进 `白名单`，并写清理由 —— 白名单里那几条要是被删了，这条断言会提醒你清掉。
 *
 * 顺带钉第二条：`$derived` 是纯函数，里面 `$.set(...)` 一律算错。
 */
import fs from 'node:fs';
import path from 'node:path';
import { compile } from 'svelte/compiler';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * 允许留着的命中：`文件::变量` → 为什么它不是死循环。
 * 这几处写进去的是**恒定值**或者**有等值守卫**，多跑一轮就停；
 * 真要动它们可以，但得把这里的理由一起改掉，不许默默加新条目。
 */
const 白名单 = new Map([
  ['src/lib/components/Intro.svelte::gone', '只在 setTimeout 里 false→true 一次，`gone` 为真后开头就 return'],
  ['src/lib/components/ProgressBar.svelte::phase', '四个固定档位来回切，每次写进去的值都不一样、且必然收敛'],
  ['src/lib/components/wb/Preview.svelte::box', '写之前先比 w/h，相等就 return（新对象只在尺寸真变了时才写）'],
  ['src/routes/tools/[id]/+page.svelte::cur', '写之前先比 `next !== cur`，值不同才写']
]);

let n = 0;
let bad = 0;
const ok = (c, m) => {
  n++;
  if (!c) {
    bad++;
    console.log(`  FAIL ${m}`);
  }
};

/** 找 src 下所有 .svelte */
function 找文件(dir, 出 = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) 找文件(p, 出);
    else if (e.name.endsWith('.svelte')) 出.push(p);
  }
  return 出;
}

/** 从 i（指向 '('）开始配平括号，返回里面的整段 */
function 配对(src, i) {
  let 深 = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '(') 深++;
    else if (c === ')') {
      深--;
      if (深 === 0) return { 体: src.slice(i + 1, j), 到: j };
    }
  }
  return null;
}

/** 去掉字符串和注释，免得把 `'$.set('` 这种文本当成代码 */
function 去噪(t) {
  let 出 = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '/' && t[i + 1] === '/') { while (i < t.length && t[i] !== '\n') i++; 出 += '\n'; continue; }
    if (c === '/' && t[i + 1] === '*') { i += 2; while (i < t.length && !(t[i] === '*' && t[i + 1] === '/')) i++; i++; 出 += ' '; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < t.length && t[i] !== q) { if (t[i] === '\\') i++; i++; }
      出 += ' ';
      continue;
    }
    出 += c;
  }
  return 出;
}

/** 扫一个编译产物里所有 `$.xxx_effect(...)` / `$.derived(...)` 块 */
function 扫块(净, 头正则) {
  const 出 = [];
  for (const m of 净.matchAll(头正则)) {
    const i = m.index + m[0].length - 1;
    const p = 配对(净, i);
    if (p) 出.push(p.体);
  }
  return 出;
}

const 文件 = 找文件(path.join(ROOT, 'src')).sort();
const 命中 = [];
const 脏derived = [];
let effect块数 = 0;

for (const f of 文件) {
  const 相对 = path.relative(ROOT, f).split(path.sep).join('/');
  const 源 = fs.readFileSync(f, 'utf8');
  let 码;
  try {
    码 = compile(源, { generate: 'client', filename: 相对 }).js.code;
  } catch (e) {
    ok(false, `${相对} 编译不过：${e.message}`);
    continue;
  }
  const 净 = 去噪(码);

  /* ① effect 读自己写的 state。
     只认 `$.user_effect` / `$.user_pre_effect`（就是源码里的 `$effect` / `$effect.pre`）——
     编译产物里还有几百个 `$.template_effect`，那是 Svelte 自己给模板刷 DOM 用的，
     不算用户写的 effect，混进来会让计数和判据都失准。

     **按"根变量"比，不是按整条路径比。** 2026-09-23 漏过一次：路由壳里
     `抽屉.有 = 看(); if (抽屉.有) return;` —— 写的是**属性**（编译成 `$.set(抽屉.有, …)`），
     只认裸标识符的正则看不见这次写，于是守卫放行、应用开机幕布再也不撤。
     现在两边都取根（`抽屉.有` → `抽屉`）：宁可多报几条人工过一遍，也不能放过。 */
  for (const 体 of 扫块(净, /\$\.user_(pre_)?effect\(/g)) {
    effect块数++;
    const 根 = (s) => s.split('.')[0];
    const 写的 = new Set();
    const 读的 = new Set();
    for (const m of 体.matchAll(/\$\.set\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*,/g)) 写的.add(根(m[1]));
    for (const m of 体.matchAll(/\$\.get\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\)/g)) 读的.add(根(m[1]));
    for (const 名 of 写的) if (读的.has(名)) 命中.push(`${相对}::${名}`);
  }

  /* ② $derived 里写 state */
  for (const 体 of 扫块(净, /\$\.derived(\s*\(|\s*\.by\()/g)) {
    for (const m of 体.matchAll(/\$\.set\(\s*([A-Za-z_$][\w$]*)\s*,/g)) 脏derived.push(`${相对}::${m[1]}`);
  }
}

ok(文件.length >= 35, `扫到的组件数够多（实得 ${文件.length} 个；少了说明 glob 坏了）`);
ok(effect块数 >= 40, `扫到的 effect 块数够多（实得 ${effect块数} 个）`);

/**
 * 标识符长什么样。**必须带 `u` 并且用 `\p{L}`** —— `\w` 不匹配中文，
 * 而本工程的变量名大量是中文（`抽屉`、`模式段`、`当前域`…）。
 * 这一条也是 2026-09-23 那次漏报的原因之一：`[A-Za-z_$][\w$]*` 根本看不见 `抽屉`。
 */
const 标识 = '[\\p{L}\\p{N}_$][\\p{L}\\p{N}_$]*';
const 路径源 = `${标识}(?:\\.${标识})*`;

/**
 * 源码级：`$state` **对象属性**的自读自写。
 *
 * 为什么还要这一层：Svelte 编译 `抽屉.有 = x` 时**不套 `$.set`**，直接写成 `抽屉.有 = x`
 * （响应式靠代理的 set 陷阱），读也是直接 `抽屉.有`。所以"认编译产物里的 `$.set`/`$.get`"
 * 这条**永远看不见属性级的自环** —— 2026-09-23 路由壳那行就是这么漏过去的，
 * 症状是开机幕布再也不撤（整页 opacity:0）。
 *
 * 判据：同一个 effect 块里，某条点号路径既有赋值（`x.y =` / `x.y +=` / `x.y++`），
 * 又在别处被读过（同一条路径在该块里出现 ≥2 次）。
 */
function 源码点号自环(源) {
  const 出 = [];
  const 净 = 去噪(源);
  for (const m of 净.matchAll(/\$effect(\.pre)?\s*\(/g)) {
    const p = 配对(净, m.index + m[0].length - 1);
    if (!p) continue;
    const 体 = p.体;
    const 写 = new Set();
    /* 只认**带点的**赋值目标：`const 有 = …` 那种普通局部变量归编译级那条管，
       混进来会把"先用局部算、再写回去"的正确写法误报（实测：好样本被判成 `有`）。 */
    const 赋值 = new RegExp(`(?:^|[^.\\p{L}\\p{N}_$])(${标识}(?:\\.${标识})+)\\s*(?:=(?!=)|\\+=|-=|\\*=|/=|\\+\\+|--)`, 'gu');
    for (const a of 体.matchAll(赋值)) 写.add(a[1]);
    for (const 路径 of 写) {
      const 次数 = (体.match(new RegExp(路径.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gu')) ?? []).length;
      if (次数 >= 2) 出.push(路径);
    }
  }
  return 出;
}

/** 编译级 + 源码级，两把尺子合起来 */
function 扫组件源码(源, 文件名) {
  const 码 = compile(源, { generate: 'client', filename: 文件名 }).js.code;
  const 净2 = 去噪(码);
  const 出 = [];
  const 读集 = new RegExp(`\\$\\.get\\(\\s*(${路径源})\\s*\\)`, 'gu');
  const 写集 = new RegExp(`\\$\\.set\\(\\s*(${路径源})\\s*,`, 'gu');
  for (const 体 of 扫块(净2, /\$\.user_(pre_)?effect\(/g)) {
    const 根 = (s) => s.split('.')[0];
    const 写的 = new Set();
    const 读的 = new Set();
    for (const m of 体.matchAll(写集)) 写的.add(根(m[1]));
    for (const m of 体.matchAll(读集)) 读的.add(根(m[1]));
    for (const 名 of 写的) if (读的.has(名)) 出.push(名);
  }
  return [...出, ...源码点号自环(源)];
}

ok(文件.length >= 35, `扫到的组件数够多（实得 ${文件.length} 个；少了说明 glob 坏了）`);
ok(effect块数 >= 40, `扫到的 effect 块数够多（实得 ${effect块数} 个）`);

/**
 * 自检：探测器抓不抓得住。
 *
 * 为什么必须有这一段：这条守卫**漏过一次**（2026-09-23，路由壳那行 `抽屉.有`），
 * 当时它照样报绿。一个"永远绿"的守卫比没有更坏 —— 所以拿一段**故意写坏**的组件
 * 现编一遍，命中了才算这把尺子还管用。
 */
const 坏样本 = `<script lang="ts">
  let 抽屉 = $state({ 有: false });
  $effect(() => {
    抽屉.有 = !!document.querySelector('.wb__side');
    if (抽屉.有) return;
  });
<\/script>
<p>坏样本</p>`;
const 自检命中 = 扫组件源码(坏样本, '坏样本.svelte');
ok(自检命中.includes('抽屉.有'), `探测器要抓得住"写完同一个属性又读回来"（实得：${JSON.stringify(自检命中)}）`);

const 好样本 = `<script lang="ts">
  let 抽屉 = $state({ 有: false });
  $effect(() => {
    const 有 = !!document.querySelector('.wb__side');
    抽屉.有 = 有;
    if (有) return;
  });
<\/script>
<p>好样本</p>`;
const 自检空 = 扫组件源码(好样本, '好样本.svelte');
ok(自检空.length === 0, `改对写法之后不该再命中（实得：${JSON.stringify(自检空)}）`);

console.log(`  扫了 ${文件.length} 个 .svelte、${effect块数} 个 effect 块`);
console.log(`  命中（含白名单）：${命中.length ? 命中.join('、') : '（无）'}`);

/* 命中里凡是不在白名单的就是新病，报出来 */
const 新命中 = 命中.filter((h) => !白名单.has(h));
ok(
  新命中.length === 0,
  `effect 不该读自己写的那份 state。新命中：${新命中.length ? 新命中.join('、') : '（无）'}\n` +
    '       改法：在同一个 effect 里用**局部变量**算完再用（`const v = 算(img); 存 = v; 用 v.字段`），\n' +
    '       或者把"要回收的上一份"放进普通变量（不参与响应式）；不要把写完的 state 又读回来。'
);

/* 白名单里过期的条目要清掉，别让它烂在那儿 */
const 过期 = [...白名单.keys()].filter((k) => !命中.includes(k));
ok(
  过期.length === 0,
  `白名单里有已经不命中的条目，说明代码变了 —— 删掉它们（${过期.join('、')}）`
);

/* $derived 必须纯 */
ok(脏derived.length === 0, `$derived 里不许写 state（改 status：${脏derived.join('、')}）`);

console.log(`effect-自读自写：${n} 条断言，${bad} 条没过`);
process.exit(bad ? 1 : 0);
