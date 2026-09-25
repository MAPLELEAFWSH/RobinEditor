/**
 * 探针：警告框到底能不能消失。
 *
 * 量两件事：
 *   1. **源码里**：全库所有 `<Note>` 扫一遍，按"有没有 onclose / 有没有 自动关"分类。
 *      工程自己的规矩写在 `ui.svelte.ts`：提示类 Note 跟侧栏那条错误通道同一个 9 秒。
 *   2. **屏幕上**：在 ①「文本」栏点出一个警告，看它有没有叉、等够 12 秒看它自己走不走。
 *
 * 踩过的坑：第一版拿 `/<Note\b[^>]*>/` 切标签 —— `onclose={() => …}` 里那个 `>` 会把
 * 标签**截断**，于是"有 onclose 的"被算成"缺自动关"。这次按括号/引号配对往前扫。
 *
 * 用法（先起打包版真机 + 调试端口）：
 *   node tmp\probe-①警告框.mjs 9225
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const PORT = process.env.CDP_PORT ?? process.argv[2] ?? '9225';

/* ---------------- ① 源码普查 ---------------- */
const 根 = 'E:\\deepseek-harness\\RobinEditor\\src\\lib';

async function 走(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await 走(p)));
    else if (e.name.endsWith('.svelte')) out.push(p);
  }
  return out;
}

/** 从 `<Note` 开始，按引号/花括号配对往后扫，返回完整的开标签 */
function 完整标签(s, 起) {
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
    else if (c === '>' && 深 === 0) return s.slice(起, i + 1);
  }
  return s.slice(起, i);
}

const 全 = [];
for (const f of await 走(根)) {
  const s = await readFile(f, 'utf8');
  for (let i = s.indexOf('<Note'); i >= 0; i = s.indexOf('<Note', i + 1)) {
    const 标签 = 完整标签(s, i);
    全.push({
      文件: f.replace('E:\\deepseek-harness\\RobinEditor\\src\\lib\\', ''),
      行: s.slice(0, i).split('\n').length,
      有叉: /onclose=/.test(标签),
      有自动关: /自动关=/.test(标签),
      动态kind: /kind=\{(msg|名话|落盘话|projMsg|packMsg|试)\b/.test(标签),
      写死warn: /kind="warn"/.test(标签),
      标签: 标签.replace(/\s+/g, ' ')
    });
  }
}

/* 只管"会跟着动作冒出来/消失"的那些（kind 绑定在状态上的），以及写死 warn 的 */
const 反应式 = 全.filter((x) => x.动态kind);
const 写死警告 = 全.filter((x) => x.写死warn);

const 分类 = (列) =>
  列.reduce(
    (a, x) => {
      const k = x.有叉 && x.有自动关 ? '有叉 + 会自己走' : x.有叉 && !x.有自动关 ? '有叉、但不会自己走' : !x.有叉 && x.有自动关 ? '没叉、会自己走' : '**没叉、也不会自己走（关不掉）**';
      (a[k] ??= []).push(`${x.文件}:${x.行}`);
      return a;
    },
    {}
  );

console.log(`全库 <Note> ${全.length} 处\n`);
console.log('==== 甲、跟着动作冒出来的（kind 绑在状态上）====');
console.log(JSON.stringify(分类(反应式), null, 1));
console.log('\n==== 乙、写死 kind="warn" 的（多数是常驻说明，不是"弹出来的提示"）====');
console.log(JSON.stringify(分类(写死警告), null, 1));

/* ---------------- ② 屏幕上量 ---------------- */
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = list.find((x) => x.type === 'page' && !x.url.startsWith('devtools://'));
if (!t) {
  console.log(`\n（CDP :${PORT} 上没有 page —— 屏幕上那半段没量）`);
  process.exit(0);
}
console.log('\n连上：', t.url);
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const rpc = (method, params = {}) =>
  new Promise((res, rej) => {
    const my = ++id;
    const on = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== my) return;
      ws.removeEventListener('message', on);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id: my, method, params }));
  });
const 跑 = async (表达式) => {
  const r = await rpc('Runtime.evaluate', { expression: 表达式, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};
await rpc('Page.enable');
await rpc('Runtime.enable');

/* 先点侧栏进 ①（首页上没有分区条），再点分区条上的「文本」 */
console.log('\n从侧栏进 ①：', await 跑(`(async () => {
  const 叶 = [...document.querySelectorAll('.leaf, .rail a, nav a, .side a')].find((e) => (e.textContent || '').includes('日文乱码修复'));
  if (叶) 叶.click();
  await new Promise((r) => setTimeout(r, 2200));
  const b = [...document.querySelectorAll('.seg__btn')].find((x) => {
    const l = x.querySelector('.seg__label');
    return ((l ? l.textContent : x.textContent) || '').trim() === '文本';
  });
  if (b) b.click();
  await new Promise((r) => setTimeout(r, 1500));
  return location.pathname + location.search;
})()`));

/* 弄一个警告出来。**不能靠点空「还原」** —— 那一颗在空输入时是 disabled，点了等于没点
   （第一版就这么量出了个假的"没有警告"）。改成走真发生的那条：从 Tauri 自己的事件通道
   发一次原生拖放，丢一个 `.png` 上去 —— 「文本」栏的文件落点不收它，落到 `dir` 那个上，
   于是走出来一句"…不是文件夹 —— 这一处收的是文件夹（…）"。 */
console.log('弄一个警告出来：', await 跑(`(async () => {
  const w = document.querySelector('.wb__main');
  if (!w) return '（不在工作区版面上）';
  const r = w.getBoundingClientRect();
  const d = devicePixelRatio || 1;
  const 位 = { x: Math.round((r.left + r.width / 2) * d), y: Math.round((r.top + r.height / 2) * d) };
  const 路 = ['D:\\\\别处\\\\一张图.png'];
  const 发 = async (类型, 载荷) => {
    try { await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'tauri://drag-' + 类型, payload: 载荷 }); return 'ok'; }
    catch (e) { return '（emit 失败：' + e + '）'; }
  };
  const a = await 发('enter', { paths: 路, position: 位 });
  const b = await 发('drop', { paths: 路, position: 位 });
  await new Promise((r2) => setTimeout(r2, 1500));
  return a + '/' + b;
})()`));

const 看 = `(() => {
  const 文 = (el) => (el && el.textContent ? el.textContent : '').replace(/\\s+/g, ' ').trim();
  const 警告 = [...document.querySelectorAll('.note--warn')].map((n) => ({
    话: 文(n).slice(0, 46),
    有叉: !!n.querySelector('.note__x'),
    还在: n.isConnected
  }));
  return {
    警告,
    面板里警告框上的叉: document.querySelectorAll('.wb__main .note--warn .note__x').length,
    侧栏那条: 文(document.querySelector('.side__err')) || '(没有)'
  };
})()`;

console.log('\n---- 刚点完（0 秒）----');
console.log(JSON.stringify(await 跑(看), null, 1));
console.log('\n等 12 秒（工程自己的规矩是 9 秒自己走）…');
await new Promise((r) => setTimeout(r, 12000));
console.log('---- 12 秒之后 ----');
console.log(JSON.stringify(await 跑(看), null, 1));

console.log('\n试着点那个警告框上的叉：', await 跑(`(() => {
  const x = document.querySelector('.wb__main .note--warn .note__x');
  if (!x) return '（面板里那一块根本没有叉可点）';
  x.click();
  return '点了';
})()`));
await new Promise((r) => setTimeout(r, 700));
console.log('点完之后：', JSON.stringify(await 跑(看), null, 1));

ws.close();
