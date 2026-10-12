/**
 * 低配性能的两条底线。都是"改回去就悄悄变慢"那种，必须有东西拦着。
 *
 * 一、注册表里**不许静态 import 分区组件**。
 *     注册表被侧栏、首页、快捷动作一起读，静态 import 会让八个功能的代码
 *     全并进首屏那个 chunk（实测：首屏 642 KB / 总共 671 KB，十一个模块一个不落）。
 *     谁都可能顺手加回一行 `import X from './x/X.svelte'`，然后首屏悄悄胖 400 KB。
 *
 * 二、进场观察那条 MutationObserver **不许在回调里全文档查询**。
 *     原来回调里是 `document.querySelectorAll('.reveal:not(.is-in)')`，
 *     全站任何一次 DOM 增删都触发一次整篇文档的选择器匹配。
 *
 * 三、版本号三处一致（package.json / tauri.conf.json / Cargo.toml）——
 *     界面上显示的版本取自 tauri.conf.json（构建时注入），对不上就没意义了。
 */
import { readFileSync } from 'node:fs';

let n = 0;
let bad = 0;
const ok = (c, m) => {
  n++;
  if (!c) {
    bad++;
    console.error(`FAIL ${m}`);
    process.exitCode = 1;
  }
};

/* ============================================================
   一、注册表：组件只能按需拉
   ============================================================ */

/**
 * 把注释抹掉（换行留着，行号才对得上）。
 *
 * **必须抹**：这两条断言都是"找源码里有没有某种写法"，而注释里正好会
 * 引用那种写法（`+layout.svelte` 那段注释就写着老代码长什么样）。
 * 实测踩过：不抹注释，探测器抓到的是自己写的说明文字。
 */
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/(^|\s)\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ''));
}

/** 注册表里除 `import type` 之外，任何 `from '…svelte'` 的静态导入都算违规 */
export function staticComponentImports(src) {
  return stripComments(src)
    .split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => /^import\s/.test(line) && /from\s*['"][^'"]+\.svelte['"]/.test(line) && !/^import\s+type\b/.test(line));
}

/** 每个带分区的模块，分区上得是 load，不能是 component */
export function badPanelFields(modules) {
  const bad = [];
  for (const m of modules) {
    for (const p of m.panels ?? []) {
      if ('component' in p) bad.push(`${m.id}/${p.id} 还在用 component`);
      if (!p.load) bad.push(`${m.id}/${p.id} 没有 load`);
      else if (typeof p.load !== 'function') bad.push(`${m.id}/${p.id} 的 load 不是函数`);
    }
  }
  return bad;
}

/* 先证伪：探测器要抓得住 */
const fakeBad = "import X from './x/X.svelte';\nimport type { Y } from './y';\nimport { z } from 'z';";
ok(staticComponentImports(fakeBad).length === 1, `探测器漏了静态组件导入（实得 ${staticComponentImports(fakeBad).length}）`);
ok(staticComponentImports("const f = () => import('./x/X.svelte');").length === 0, '把动态导入误报成静态');
ok(
  badPanelFields([{ id: 'm', panels: [{ id: 'p', component: () => 1 }] }]).length > 0,
  '探测器放过了还在用 component 的分区'
);
ok(
  badPanelFields([{ id: 'm', panels: [{ id: 'p', load: () => Promise.resolve({}) }] }]).length === 0,
  '正常写法被误报'
);

const regSrc = readFileSync('src/lib/modules/registry.ts', 'utf8');
const staticHits = staticComponentImports(regSrc);
ok(
  staticHits.length === 0,
  `注册表里有 ${staticHits.length} 条静态组件导入，首屏会被它们撑大：\n` +
    staticHits.map((h) => `    registry.ts:${h.n}  ${h.line}`).join('\n')
);
ok(
  (regSrc.match(/=>\s*import\('\.\/[^']+\.svelte'\)/g) ?? []).length >= 9,
  /* 下界卡的是"有没有人把按需加载改回静态 import"。
     2026-09-26 ④ msToon 整个模块删掉，这一项从 12 降到 11；
     2026-10-07 工作区的「最近工程」「快捷动作」两页删掉，11 → 9 —— 跟着落。 */
  '注册表里的按需加载器少于 9 个，看看是不是被谁改回静态导入了'
);

const { MODULES } = await import('../src/lib/modules/registry.ts');
const badFields = badPanelFields(MODULES);
ok(badFields.length === 0, `分区的加载字段不对：${badFields.join('；')}`);

/* 功能页得真的 await 那个加载器 */
const pageSrc = readFileSync('src/routes/tools/[id]/+page.svelte', 'utf8');
ok(/panel\?\.load/.test(pageSrc), '功能页没读 panel.load');
ok(!/panel\?\.component/.test(pageSrc), '功能页还在读 panel.component');

/* ============================================================
   一·补：版本号三处一致

   `vite.config.js` 把 `src-tauri/tauri.conf.json` 的 version 注进前端
   （`src/lib/version.ts`），底栏那颗 pill 与「关于」页都从那里取。
   安装包文件名用 tauri.conf 的，Windows 属性看到的版本来自 Cargo.toml ——
   三处漂开的话，界面上那个号就跟 exe 对不上了，所以在这儿钉住。
   ============================================================ */
const 版本 = (文件, 正则) => {
  const m = readFileSync(文件, 'utf8').match(正则);
  return m ? m[1] : null;
};
const 三处版本 = {
  'package.json': 版本('package.json', /"version"\s*:\s*"([^"]+)"/),
  'src-tauri/tauri.conf.json': 版本('src-tauri/tauri.conf.json', /"version"\s*:\s*"([^"]+)"/),
  'src-tauri/Cargo.toml': 版本('src-tauri/Cargo.toml', /^version\s*=\s*"([^"]+)"/m)
};
const 第一处 = 三处版本['src-tauri/tauri.conf.json'];
ok(
  !!第一处 && Object.values(三处版本).every((v) => v === 第一处),
  `三处版本号对不上：${JSON.stringify(三处版本)}`
);

/* ============================================================
   二、进场观察：只盯新增节点
   ============================================================ */

/**
 * 从源码里切出 MutationObserver 的回调体。不是块状回调（比如直接传个函数名）
 * 就返回 null —— 下面那条断言据此报"写法变了"。
 * 括号配对切，不靠正则猜结尾；注释先抹掉（注释里会引用老写法）。
 */
export function mutationCallback(srcRaw) {
  const src = stripComments(srcRaw);
  const at = src.indexOf('new MutationObserver(');
  if (at < 0) return null;
  const open = src.indexOf('{', src.indexOf('(', at));
  if (open < 0) return null;
  /* 第一个 `{` 之前要是已经有语句结束符，说明这个 `{` 不是回调体
     （`new MutationObserver(scan);` 后面那句 observe 里也有 `{`）。 */
  if (src.slice(src.indexOf('(', at), open).includes(';')) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

/* 证伪：老写法必须被抓出来 */
const fakeOld = "const mo = new MutationObserver(scan);\nmo.observe(document.body, { childList: true, subtree: true });";
ok(mutationCallback(fakeOld) === null, '老写法（回调是个标识符）应该返回 null，好让下面那条断言报错');
const fakeNew = "const mo = new MutationObserver((records) => { for (const r of records) for (const n of r.addedNodes) watch(n); });";
const cb = mutationCallback(fakeNew);
ok(cb !== null && cb.includes('addedNodes'), '探测器认不出"只看新增节点"的写法');

const layoutSrc = readFileSync('src/routes/+layout.svelte', 'utf8');
const moCb = mutationCallback(layoutSrc);
ok(moCb !== null, '+layout.svelte 里那个 MutationObserver 不是带花括号的回调了，这条断言得跟着改');
if (moCb) {
  ok(moCb.includes('addedNodes'), 'MutationObserver 回调不看 addedNodes，八成又回到"全文档扫一遍"了');
  ok(
    !/querySelectorAll/.test(moCb),
    'MutationObserver 回调里出现了 querySelectorAll —— 每次 DOM 变动都整篇文档匹配一遍，低配机器顶不住'
  );
}

console.log(`perf-guard：${n} 条断言，${bad} 条没过`);
