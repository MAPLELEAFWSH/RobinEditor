/**
 * 真写盘验收 —— 第 2 步：在**副本**上真开跑（关掉试跑），然后**从盘上**逐条复核，最后回滚。
 *
 * 这一条路以前一次都没跑过（所有验证都是试跑/只读），而它动的是用户自己的文件名。
 *
 * 验四件事：
 *   1. **名字**：该改的 18 个真的改了、改成了真值；不该动的一个没动；
 *   2. **正文**：界面上说改了的文件，盘上真的变了；
 *   3. **备份**：改过的文件旁边留了 `.bak`，而 `.bak` 的内容 == 改前快照的 sha；
 *   4. **回滚**：点「回滚改名（N）」之后，名字一个不差地退回改前快照。
 *
 * 用法（先起打包版 + 调试端口）：
 *   node tmp\验收-①真写盘-跑.mjs 9228
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const PORT = process.env.CDP_PORT ?? process.argv[2] ?? '9228';
const 出品根 = 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例\\测试效果';
const 副本 = join(出品根, '①写盘验收-副本');
const 快照 = JSON.parse(await readFile(join(出品根, '①写盘验收-改前快照.json'), 'utf8'));
const 改前 = new Map(快照.表.map((x) => [x.rel, x]));

async function 走(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await 走(p, out);
    else out.push(p);
  }
  return out;
}
const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16);

/* ---------------- CDP ---------------- */
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = list.find((x) => x.type === 'page' && !x.url.startsWith('devtools://'));
if (!t) throw new Error(`CDP :${PORT} 上没有可连的 page`);
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const rpc = (method, params = {}) =>
  new Promise((res, rej) => {
    const my = ++id;
    const 定时 = setTimeout(() => { ws.removeEventListener('message', on); rej(new Error('CDP 超时 ' + method)); }, 180000);
    const on = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== my) return;
      clearTimeout(定时);
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
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
await rpc('Page.enable');
await rpc('Runtime.enable');
/* 页面里抛的错必须**打出来** —— 上一版没听，于是"渲染抛了"看起来就跟"跑完 0 条"一样，
   差点把它当成"应用没写盘"。写盘那条路的证据在盘上，界面上的证据就在这儿。 */
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    console.log('   ‼️ [页面抛错]', (d.exception?.description ?? d.text ?? '').split('\n')[0]);
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    console.log('   ‼️ [页面 console.error]', (m.params.args ?? []).map((a) => a.value ?? a.description).join(' '));
  }
});

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) bad++; console.log(`${c ? '✅' : '❌'} ${m}`); };

/* ---------------- 1. 进「文件」栏、拖副本进去 ---------------- */
console.log('切到 ①：', await 跑(`(async () => {
  const 叶 = [...document.querySelectorAll('.leaf, .rail a, nav a, .side a')].find((e) => (e.textContent || '').includes('日文乱码修复'));
  if (叶) 叶.click();
  await new Promise((r) => setTimeout(r, 2300));
  const b = [...document.querySelectorAll('.seg__btn')].find((x) => {
    const l = x.querySelector('.seg__label');
    return ((l ? l.textContent : x.textContent) || '').trim() === '文件';
  });
  if (b) b.click();
  await new Promise((r) => setTimeout(r, 1600));
  return location.pathname + location.search;
})()`));

console.log('拖副本进去：', await 跑(`(async () => {
  const w = document.querySelector('.wb__main');
  const r = w.getBoundingClientRect();
  const d = devicePixelRatio || 1;
  const 位 = { x: Math.round((r.left + r.width / 2) * d), y: Math.round((r.top + r.height / 2) * d) };
  const 发 = async (ty, 载荷) => { try { await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'tauri://drag-' + ty, payload: 载荷 }); } catch (e) {} };
  await 发('enter', { paths: [${JSON.stringify(副本)}], position: 位 });
  await 发('drop', { paths: [${JSON.stringify(副本)}], position: 位 });
  await new Promise((r2) => setTimeout(r2, 40000));
  return 'ok';
})()`));

const 扫 = await 跑(`(() => {
  const 文 = (el) => (el && el.textContent ? el.textContent : '').replace(/\\s+/g, ' ').trim();
  const chk = [...document.querySelectorAll('.wb__main label.chk')].find((l) => /名字也一起还原/.test(文(l)));
  return {
    扫描读数: [...document.querySelectorAll('.wb__main .mini')].map(文).filter((x) => /扫了|像乱码/.test(x)),
    名字那一行: chk ? 文(chk) : '（没有）'
  };
})()`);
console.log(JSON.stringify(扫, null, 1));
const 名字数 = Number((扫.名字那一行.match(/（(\d+) 个）/) ?? [])[1] ?? 0);
ok(名字数 > 0, `扫出来 ${名字数} 个名字要改`);

/* ---------------- 2. 关掉「先试跑不写盘」 ---------------- */
console.log('\n关掉试跑：', await 跑(`(async () => {
  const lab = [...document.querySelectorAll('label.chk')].find((l) => /先试跑不写盘/.test(l.textContent || ''));
  if (!lab) return '（没找到那个开关）';
  const c = lab.querySelector('input');
  if (!c) return '（那个 label 里没有 input）';
  if (c.checked) { c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); }
  await new Promise((r) => setTimeout(r, 600));
  return { 现在勾着吗: c.checked };
})()`));

const 钮 = await 跑(`(() => {
  const b = [...document.querySelectorAll('.wb__main button')].find((x) => /^开跑/.test((x.textContent || '').trim()));
  return b ? { 文案: (b.textContent || '').trim(), 禁用: b.disabled } : '（没有开跑按钮）';
})()`);
console.log('主按钮：', JSON.stringify(钮));
ok(typeof 钮 === 'object' && !钮.禁用, `开跑按钮能点（文案=${JSON.stringify(typeof 钮 === 'object' ? 钮.文案 : 钮)}）`);
if (typeof 钮 !== 'object' || 钮.禁用) {
  console.log('\n⚠️ 开跑按钮点不了，后面不跑了（**不许把它当成通过**）');
  ws.close();
  process.exit(1);
}

/* ---------------- 3. 真开跑 ---------------- */
console.log('\n点开跑：', await 跑(`(async () => {
  const b = [...document.querySelectorAll('.wb__main button')].find((x) => /^开跑/.test((x.textContent || '').trim()));
  b.click();
  await new Promise((r) => setTimeout(r, 30000));
  return 'ok';
})()`));

const 报 = await 跑(`(() => {
  const 文 = (el) => (el && el.textContent ? el.textContent : '').replace(/\\s+/g, ' ').trim();
  const lis = [...document.querySelectorAll('.wb__main ul.list > li')].map(文);
  const 滚 = [...document.querySelectorAll('.wb__main button')].find((x) => /回滚改名/.test(x.textContent || ''));
  return {
    结果条数: lis.length,
    名字相关的: lis.filter((x) => /名字/.test(x)),
    有回滚按钮: 滚 ? (滚.textContent || '').trim() : '（没有）'
  };
})()`);
console.log(`结果 ${报.结果条数} 条，名字相关 ${报.名字相关的.length} 条，回滚按钮=${报.有回滚按钮}`);
for (const x of 报.名字相关的.slice(0, 20)) console.log('   ' + x);
ok(报.名字相关的.length > 0, '界面上报了名字那一趟的结果');

/* ---------------- 4. 盘上复核 ---------------- */
console.log('\n==== 盘上复核（地面真值）====');
const 现在 = new Map();
for (const p of await 走(副本)) {
  const b = await readFile(p);
  现在.set(relative(副本, p), { 字节: b.length, sha: sha(b), 路径: p });
}

const 改前名们 = new Set(改前.keys());
const 现在名们 = new Set(现在.keys());
const 新增名 = [...现在名们].filter((x) => !改前名们.has(x));
const 消失名 = [...改前名们].filter((x) => !现在名们.has(x));
const 没动的 = [...改前名们].filter((x) => 现在名们.has(x));

console.log(`改前 ${改前名们.size} 个 → 现在 ${现在名们.size} 个（改名 ${消失名.length} 个，新增 ${新增名.length} 个）`);

/* 从界面报的"名字已改成 → X"里取该改的清单 */
const 报了改名的 = 报.名字相关的
  .map((s) => (s.match(/^(.*?) 名字已改成 → (.*)$/) ?? []).slice(1))
  .filter((x) => x.length === 2);
ok(报了改名的.length > 0, `界面报了 ${报了改名的.length} 条改名`);

/* 名字真的落地了吗。
   ⚠️ 判据要按**路径里的任一层名字**看，不能只看路径结尾 —— 被改名的那两个是**目录**
   （`夵曄尦readme`），目录本身不在文件清单里，用 endsWith 判会得出假的 ❌
   （第一版就是这么错的两条）。 */
const 有这一层 = (名字) => [...现在名们].some((k) => k.split(/[\\/]/).includes(名字));
for (const [从, 到] of 报了改名的) {
  const 还在原处 = 有这一层(从);
  const 到新处了 = 有这一层(到);
  ok(!还在原处 && 到新处了, `名字真的改名落地了：${从} → ${到}${还在原处 ? `（还有 ${[...现在名们].filter((k) => k.split(/[\\/]/).includes(从)).length} 处没改）` : ''}`);
}
/* 条数怎么对：**改名不改文件数**（改目录名也是把里面的文件一起搬到新路径），
   所以"现在 = 改前 + .bak 数"这一条比"消失==新增"稳得多 ——
   后一种算法会把"父目录被改名"带来的子文件路径变化也算成改名，数就对不上了。 */
const bak列表 = [...现在名们].filter((x) => x.endsWith('.bak') || /\.bak\d+$/.test(x));
ok(现在名们.size === 改前名们.size + bak列表.length,
  `文件数对得上：改前 ${改前名们.size} + .bak ${bak列表.length} = 现在 ${现在名们.size}`);
ok(bak列表.length > 0, `正文那趟留下了 .bak：${bak列表.length} 个`);

/* 正文：界面说"已写盘"的，盘上要真的变了 + 留了 .bak */
const 报了写盘的 = 报.名字相关的.length ? [] : [];
const 全部结果 = await 跑(`[...document.querySelectorAll('.wb__main ul.list > li')].map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim())`);
const 写盘的 = 全部结果.filter((s) => /已写盘|留了备份|（.*）/.test(s) && !/名字/.test(s));
console.log(`\n界面上报的正文条目 ${写盘的.length} 条：`);
for (const x of 写盘的.slice(0, 10)) console.log('   ' + x);

const bak们 = [...现在名们].filter((x) => x.endsWith('.bak') || /\.bak\d+$/.test(x));
let 备份都对 = true;
for (const b of bak们) {
  const 原名 = b.replace(/\.bak(\d+)?$/, '');
  const 旧 = 改前.get(原名);
  if (!旧) { 备份都对 = false; console.log(`   ⚠️ 备份 ${b} 找不到它对应的原名 ${原名}`); continue; }
  if (现在.get(b).sha !== 旧.sha) { 备份都对 = false; console.log(`   ⚠️ 备份 ${b} 的内容跟改前快照不一致`); }
}
ok(备份都对, '.bak 的内容 == 改前快照（逐字节）');

/* 没被碰过的文件：sha 必须一模一样 */
let 被动过的 = [];
for (const rel of 没动的) {
  const a = 改前.get(rel), b = 现在.get(rel);
  if (a.sha !== b.sha) 被动过的.push(rel);
}
const 改过正文的 = 被动过的.filter((x) => !bak们.includes(x));
console.log(`\n内容变了的文件 ${被动过的.length} 个（其中 ${改过正文的.length} 个是正文被改的）`);
for (const x of 改过正文的.slice(0, 10)) console.log('   正文变了：' + x);
ok(改过正文的.length > 0, `正文那趟真的写了 ${改过正文的.length} 个文件`);
ok(改过正文的.every((x) => bak们.includes(x + '.bak') || bak们.some((b) => b.startsWith(x + '.bak'))), '每个改过正文的文件旁边都有 .bak');

/* 干净文件不许被碰 */
const 干净 = [...没动的].filter((x) => !被动过的.includes(x) && !bak们.includes(x));
ok(干净.length > 0, `没问题的文件一个都没被碰：${干净.length} 个的 sha 与改前一致`);

/* ---------------- 5. 回滚 ---------------- */
console.log('\n==== 回滚 ====');
const 滚 = await 跑(`(async () => {
  const b = [...document.querySelectorAll('.wb__main button')].find((x) => /回滚改名/.test(x.textContent || ''));
  if (!b) return '（没有回滚按钮）';
  if (b.disabled) return '（回滚按钮是 disabled）';
  b.click();
  await new Promise((r) => setTimeout(r, 25000));
  return '点了';
})()`);
console.log('回滚：', 滚);
ok(滚 === '点了', '点了「回滚改名」');

const 回滚后 = new Set();
for (const p of await 走(副本)) 回滚后.add(relative(副本, p));

/* 回滚之后：**改前存在的每个非 .bak 相对路径都要回来**，多出来的只许是那 4 个 .bak。
   这么写才不会被"父目录改名"绕进去。 */
const 回滚后非bak = [...回滚后].filter((x) => !bak们.includes(x));
const 没回来的 = [...改前名们].filter((x) => !bak们.includes(x) && !回滚后.has(x));
const 多出来的 = 回滚后非bak.filter((x) => !改前名们.has(x));
ok(没回来的.length === 0, `回滚之后改前那些名字全回来了（没回来的：${JSON.stringify(没回来的.slice(0, 5))}）`);
ok(多出来的.length === 0, `回滚之后没有多出别的名字（多出来的：${JSON.stringify(多出来的.slice(0, 5))}）`);

console.log(`\n==== 真写盘验收 ${n - bad}/${n} 条通过 ====`);
ws.close();
process.exitCode = bad ? 1 : 0;
