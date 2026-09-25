/**
 * 提示条（`Note`）的时限守卫。
 *
 * 为什么要有这套：用户 2026-09-24 报「警告框不可以消失」。真因不在文案，在 `Note` 的
 * 两个可选 prop —— **`onclose` 不传就不画那颗叉，`自动关` 不传就不起定时器**
 * （`Note.svelte` 的 `{#if onclose}` 和那个 `$effect`）。少传一个，那条提示就永久挂在页面上，
 * 只能被下一次操作覆盖；少传两个就是彻底关不掉。实测：①「文本」栏丢一个 `.png` 进去，
 * 那句"不是文件夹"12 秒后还在、也没有叉可点。
 *
 * 工程自己的口径写在 `ui.svelte.ts`：**提示类提示条跟侧栏那条错误通道同一个 9 秒**
 * （用户 2026-09-23 C9）。所以这里只钉"跟着动作冒出来的"那一种：
 *
 *   判据 = **子节点就是一个 `{表达式}`**（整条提示的内容全来自状态）。
 *   写死的说明（`<Note kind="warn">这个模式只改注释…</Note>`）内容里有文字，不算 ——
 *   那种是常驻版面，本来就该一直在，不该自己走。
 *
 * 这么定是因为"需不需要时限"看的是**它会不会自己冒出来**，不是 `kind` 是不是 warn：
 * `kind` 只有颜色作用，跟时限没关系。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

let n = 0;
let bad = 0;
const ok = (c, m) => {
  n++;
  if (!c) {
    bad++;
    console.log(`  FAIL ${m}`);
  }
};

/** 所有 .svelte */
function 走(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) 走(p, out);
    else if (e.name.endsWith('.svelte')) out.push(p);
  }
  return out;
}

/**
 * 从 `<Note` 起，按引号/花括号配对往前扫，切出完整的开标签 + 子节点。
 *
 * **不能拿 `[^>]*>` 切** —— `onclose={() => (x = null)}` 里那个 `>` 会把标签截断，
 * 于是"有 onclose"的被算成"没有"（这个坑第一版就踩了，普查结果因此是错的）。
 */
function 切(s, 起) {
  let i = 起 + 5;
  let 深 = 0;
  let 引 = null;
  for (; i < s.length; i++) {
    const c = s[i];
    if (引) {
      if (c === 引) 引 = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { 引 = c; continue; }
    if (c === '{') 深++;
    else if (c === '}') 深--;
    else if (c === '>' && 深 === 0) break;
  }
  const 开标签 = s.slice(起, i + 1);
  const 收 = s.indexOf('</Note>', i);
  const 子 = 收 < 0 ? '' : s.slice(i + 1, 收);
  return { 开标签, 子: 子.replace(/\s+/g, ' ').trim() };
}

let 提示条 = 0;
let 写死说明 = 0;
const 常驻的 = [];

for (const f of 走(SRC)) {
  const s = fs.readFileSync(f, 'utf8');
  const 相对 = path.relative(ROOT, f);
  for (let i = s.indexOf('<Note'); i >= 0; i = s.indexOf('<Note', i + 1)) {
    const { 开标签, 子 } = 切(s, i);
    const 行 = s.slice(0, i).split('\n').length;
    /* 子节点整条就是一个表达式 = 内容全来自状态 = 只可能是"提示"或"结果的说明" */
    const 是提示条 = /^\{[^{}]*\}$/.test(子);
    if (!是提示条) {
      写死说明++;
      continue;
    }
    /* `常驻` = 明说"这是版面的一部分，不是弹出来的提示"（比如"这次扫描为什么被拦"）。
       两种形状在模板里一模一样，静态分不出来，所以要求**显式标记**。 */
    if (/\s常驻[\s>]/.test(开标签) || /常驻\s*$/.test(开标签.replace(/>$/, ''))) {
      常驻的.push(`${相对}:${行}`);
      continue;
    }
    提示条++;
    ok(/onclose=/.test(开标签), `${相对}:${行} 提示条要传 onclose（不传的话 Note 不画那颗叉，用户关不掉）`);
    ok(/自动关=/.test(开标签), `${相对}:${行} 提示条要传 自动关（不传就永久挂着，工程口径是 9 秒）`);
  }
}

/* 自检：判据本身得能分得开两种。找不到提示条 = 这个判据已经失效了 */
ok(提示条 >= 10, `全库应当能认出足够多的提示条（实得 ${提示条}）—— 太少说明判据被改坏了`);
ok(写死说明 >= 10, `全库的常驻说明也该认出足够多（实得 ${写死说明}）—— 判据不许把说明也算成提示条`);

console.log(
  `note-提示条：${n} 条断言，${bad} 条没过（提示条 ${提示条} 处 / 标了「常驻」的 ${常驻的.length} 处 / 常驻说明 ${写死说明} 处）`
);
if (常驻的.length) console.log(`  标了常驻的：${常驻的.join('、')}`);
process.exit(bad ? 1 : 0);
