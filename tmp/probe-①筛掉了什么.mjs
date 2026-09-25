/**
 * 探针：①「文件」栏扫完目录之后，**"筛掉了什么"那行有没有出来、数字对不对**。
 *
 * 用户 2026-09-24："现在拖目录扫到 0 个文件时会说'这个文件夹里没有文本文件（只收 …）'，
 * 但没有说'筛掉了几个、都叫什么'" —— "没进来"和"进来了没处理"看起来一样。
 *
 * 拿**真语料副本**跑：137 个文件里有 .png/.pmx/.exe/.dds 这些不在后缀表里的，
 * 数出来的"筛掉"必须跟盘上数出来的一致（用 Node 自己数一遍当对照）。
 *
 * 用法（先起打包版 + 调试端口）：
 *   node tmp\probe-①筛掉了什么.mjs 9232
 */
import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const PORT = process.env.CDP_PORT ?? process.argv[2] ?? '9232';
const 副本 = 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例\\测试效果\\①写盘验收-副本';
const TEXT_EXTS = ['txt', 'fx', 'fxsub', 'fxconf', 'conf', 'ini', 'md', 'csv', 'log', 'json', 'x'];

/* 盘上自己数一遍当对照 */
async function 走(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await 走(p, out);
    else out.push(p);
  }
  return out;
}
const 全部 = await 走(副本);
const 文本 = 全部.filter((p) => TEXT_EXTS.includes(extname(p).slice(1).toLowerCase()));
const 掉 = 全部.filter((p) => !文本.includes(p));
const 计 = new Map();
for (const p of 掉) {
  const e = extname(p).slice(1).toLowerCase() || '（没后缀）';
  计.set(e, (计.get(e) ?? 0) + 1);
}
const 盘上 = {
  共: 全部.length,
  文本: 文本.length,
  掉: 掉.length,
  按后缀: [...计.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `.${k}×${v}`)
};
console.log('盘上自己数的：', JSON.stringify(盘上));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = list.find((x) => x.type === 'page' && !x.url.startsWith('devtools://'));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const rpc = (m, p = {}) =>
  new Promise((res, rej) => {
    const my = ++id;
    const 定时 = setTimeout(() => { ws.removeEventListener('message', on); rej(new Error('CDP 超时 ' + m)); }, 180000);
    const on = (e) => {
      const j = JSON.parse(e.data);
      if (j.id !== my) return;
      clearTimeout(定时);
      ws.removeEventListener('message', on);
      j.error ? rej(new Error(JSON.stringify(j.error))) : res(j.result);
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id: my, method: m, params: p }));
  });
const 跑 = async (e) => {
  const r = await rpc('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
await rpc('Page.enable');
await rpc('Runtime.enable');
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') {
    console.log('   ‼️ [页面抛错]', (m.params.exceptionDetails.exception?.description ?? '').split('\n')[0]);
  }
});

console.log('\n切到 ① 文件栏：', await 跑(`(async () => {
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

console.log('拖副本：', await 跑(`(async () => {
  const w = document.querySelector('.wb__main');
  const r = w.getBoundingClientRect();
  const d = devicePixelRatio || 1;
  const 位 = { x: Math.round((r.left + r.width / 2) * d), y: Math.round((r.top + r.height / 2) * d) };
  const 发 = async (ty, 载荷) => { try { await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'tauri://drag-' + ty, payload: 载荷 }); } catch (e) {} };
  await 发('enter', { paths: [${JSON.stringify(副本)}], position: 位 });
  await 发('drop', { paths: [${JSON.stringify(副本)}], position: 位 });
  await new Promise((r2) => setTimeout(r2, 45000));
  return 'ok';
})()`));

const 屏 = await 跑(`(() => {
  const 文 = (el) => (el && el.textContent ? el.textContent : '').replace(/\\s+/g, ' ').trim();
  return {
    读数: [...document.querySelectorAll('.wb__main .mini')].map(文).filter((x) => /扫了|筛掉|不在收的后缀|另有/.test(x)),
    名字行: [...document.querySelectorAll('.wb__main label.chk')].map(文).filter((x) => /名字也一起还原/.test(x))
  };
})()`);
console.log('\n屏幕上的读数：');
for (const x of 屏.读数) console.log('   ' + x);

let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) bad++; console.log(`${c ? '✅' : '❌'} ${m}`); };
const 那行 = 屏.读数.find((x) => /没进清单/.test(x)) ?? '';
console.log('\n那行：', 那行);
ok(那行 !== '', '扫完有"没进清单"那行');

/* 盘上按**后端那三条筛法**自己分一遍桶当对照。
   注意"全是 ASCII"那一桶在盘上数不出来（要读内容），改成用算术对：
   后缀在表里的文件数 − 界面说"扫了 N 个" = 该被 ASCII 那条筛掉的个数。
   （我在这儿踩过一次：正则里 `\\\\d` 写多了一层转义，匹配不到，报出个假的 -1。） */
const 表内 = new Set(TEXT_EXTS);
const 后缀不收 = 掉.filter((p) => !表内.has(extname(p).slice(1).toLowerCase()));
const 表内的数 = 全部.filter((p) => 表内.has(extname(p).slice(1).toLowerCase())).length;
const 扫了几个 = Number((屏.读数.find((x) => /扫了 \d+ 个/.test(x)) ?? '').match(/扫了 (\d+) 个/)?.[1] ?? -1);
const 该是纯ascii = 表内的数 - 扫了几个;
const 数 = (s) => Number((那行.match(new RegExp(s + ' (\\d+) 个')) ?? [])[1] ?? -1);
ok(数('后缀不在表里') === 后缀不收.length, `"后缀不在表里"的个数与盘上一致：界面 ${数('后缀不在表里')} / 盘上 ${后缀不收.length}`);
ok(数('整篇都是 ASCII') === 该是纯ascii, `"后缀在表里但全是 ASCII"对得上：界面 ${数('整篇都是 ASCII')} / 算出来 ${该是纯ascii}（表内 ${表内的数} − 扫了 ${扫了几个}）`);
ok(/共 141 个文件/.test(那行) || /共 \d+ 个文件/.test(那行), '报了目录里一共几个文件');
ok(!/后缀不在表里[^；]*\.fx×/.test(那行), '没把在表里的 .fx 说成"后缀不在表里"（上一版就是这么说的假话）');
ok(/\.fx×/.test(那行), '在表里的 .fx 归到了"全是 ASCII"那一桶');

console.log(`\n==== 筛掉了什么 ${n - bad}/${n} 条通过 ====`);
ws.close();
process.exitCode = bad ? 1 : 0;
