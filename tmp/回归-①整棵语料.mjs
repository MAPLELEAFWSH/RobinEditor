/**
 * 回归：拿语料 `乱码翻译\` **整棵树**过一遍 ①「文件」栏（**试跑，一个字节都不写**）。
 *
 * 要验的就是用户 2026-09-24 定的那条口径：**真值由程序判，不许丢给操作者** ——
 * 于是必须同时成立两件事：
 *   · 该改的乱码名/乱码正文，全都认出来改对；
 *   · **用户自己起的中文名一个都不许动**（这条是把好名字改成乱码的那道闸）。
 *
 * 用法（先起打包版 + 调试端口）：
 *   node tmp\回归-①整棵语料.mjs 9227
 */
const PORT = process.env.CDP_PORT ?? process.argv[2] ?? '9227';
const 语料 = 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例\\乱码翻译';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = list.find((x) => x.type === 'page' && !x.url.startsWith('devtools://'));
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
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
await rpc('Page.enable');
await rpc('Runtime.enable');

const 文 = (el) => (el && el.textContent ? el.textContent : '').replace(/\s+/g, ' ').trim();

/* 从侧栏进 ①，再切到「文件」栏 */
console.log('切到 ① 文件栏：', await 跑(`(async () => {
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

/* 把整棵语料当文件夹拖进去（只扫，不写） */
console.log('拖整棵树进去：', await 跑(`(async () => {
  const w = document.querySelector('.wb__main');
  const r = w.getBoundingClientRect();
  const d = devicePixelRatio || 1;
  const 位 = { x: Math.round((r.left + r.width / 2) * d), y: Math.round((r.top + r.height / 2) * d) };
  const 发 = async (类型, 载荷) => {
    try { await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'tauri://drag-' + 类型, payload: 载荷 }); } catch (e) {}
  };
  await 发('enter', { paths: [${JSON.stringify(语料)}], position: 位 });
  await 发('drop', { paths: [${JSON.stringify(语料)}], position: 位 });
  await new Promise((r2) => setTimeout(r2, 9000));
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

/* 名字那一趟跑在**正文之后**，76 个文件一个个试跑要很久 —— 先把正文全取消勾选，
   这样正文那一趟是空跑，名字那趟立刻就到。（**试跑，本来也不写盘**） */
/* 点「试跑」—— 只出报告，不写盘。
   ⚠️ 别先把正文全部取消勾选：那颗按钮是 `disabled={!pickedCount || …}`，
   勾选清零它就是个死按钮，点了什么都不发生（第一版就这么量出个假的"一条都没改"）。
   正文那趟本来就只有 4 个文件，跑得动。 */
console.log('点试跑：', await 跑(`(async () => {
  const b = [...document.querySelectorAll('.wb__main button')].find((x) => (x.textContent || '').trim() === '试跑');
  if (!b) return '（没找到试跑按钮）';
  if (b.disabled) return '（试跑按钮是 disabled —— 一个都没勾）';
  b.click();
  await new Promise((r) => setTimeout(r, 40000));
  return '点了';
})()`));

const 果 = await 跑(`(() => {
  const 文 = (el) => (el && el.textContent ? el.textContent : '').replace(/\\s+/g, ' ').trim();
  const lis = [...document.querySelectorAll('.wb__main ul.list > li')].map(文);
  return { 条数: lis.length, 名字相关的: lis.filter((x) => /名字/.test(x)), 前几条: lis.slice(0, 4) };
})()`);
console.log(`\n试跑结果条数=${果.条数}，其中名字相关的 ${果.名字相关的.length} 条`);
for (const x of 果.名字相关的) console.log('  ' + x);

/* 断言 */
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) bad++; console.log(`${c ? '✅' : '❌'} ${m}`); };

const 全部 = 果.名字相关的.join(' | ');
充分: {
  const 该改 = ['夵曄尦readme', '傾僯儊晽Toon', '傾僯儊晽夋柺僗僋儕乕儞', 'readme(恓嬥P)', 'readme-巊偄曽'];
  const 真值 = ['改変元readme', 'アニメ風Toon', 'アニメ風画面スクリーン', 'readme(針金P)', 'readme-使い方'];
  for (let i = 0; i < 该改.length; i++) {
    ok(全部.includes(真值[i]), `该改的认出来了：${该改[i]} → ${真值[i]}`);
  }
  const 不许动 = ['修复结果_过目用', '改名后_用候选', '翻译后', '还原后', '测试效果', '乱码翻译'];
  for (const x of 不许动) {
    ok(!全部.includes('→ ' + x) && !全部.includes(x + ' →'), `用户自己起的中文名／已改好的名字没被动：${x}`);
  }
}
console.log(`\n==== 回归 ${n - bad}/${n} 条通过 ====`);
ws.close();
process.exitCode = bad ? 1 : 0;
