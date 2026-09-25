/**
 * 探针：**打包版真机**上，用户 2026-09-24 那三条要求现在成不成立。
 *
 *   ① 粘一整段 → 右边直接给出**整段结果**（不是只有一颗复制按钮），
 *      而且界面上**不许再出现**「就用这个」/ 增益 / 门槛 / 打分（"把算过的几条路删除"）；
 *   ② 文件/目录名跟正文一趟还原（「文件」栏扫完要认出名字里像乱码的那些）；
 *   ③ 警告框不能一直占着（有叉 + 9 秒那档到点自己走）。
 *
 * 喂进去的乱码是**真样本**：语料里那个 Shift-JIS readme 的字节按 GBK 解一遍 ——
 * 那正是 GBK 查看器里看到的字，也是用户复制到剪贴板里的东西；该还原成什么是有真值的。
 *
 * 前提：
 *   $env:WEBVIEW2_USER_DATA_FOLDER="$env:TEMP\robin-pkg-x"
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9226'
 *   .\dist\RobinEditor-免安装版.exe
 *   node tmp\probe-①三条要求-打包版.mjs 9226
 *
 * **只读**：只扫、只看，不点任何"开跑/改名"。
 */
import { readFile } from 'node:fs/promises';

const PORT = process.env.CDP_PORT ?? process.argv[2] ?? '9226';
const 语料 = 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例\\乱码翻译';
const 源文件 = `${语料}\\PostRimShilouhette\\夵曄尦readme\\EdgeControl - readme.txt`;
/** 有乱码名字的目录（`夵曄尦readme` → `改変元readme`） */
const 带乱码名的目录 = `${语料}\\PostRimShilouhette`;

const 字节 = await readFile(源文件);
const 乱码 = new TextDecoder('gbk').decode(字节).split(/\r?\n/).slice(0, 10).join('\n');
const 真值 = new TextDecoder('shift_jis').decode(字节).split(/\r?\n/).slice(0, 10).join('\n');

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = list.find((x) => x.type === 'page' && !x.url.startsWith('devtools://'));
if (!t) throw new Error(`CDP :${PORT} 上没有可连的 page`);
console.log('连上：', t.url);
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

let n = 0;
let bad = 0;
const ok = (c, m) => {
  n++;
  if (!c) bad++;
  console.log(`${c ? '✅' : '❌'} ${m}`);
};

/** 走侧栏进 ①，再点顶上分区条到指定那一栏 */
const 到栏 = (标签) => `(async () => {
  const 叶 = [...document.querySelectorAll('.leaf, .rail a, nav a, .side a')].find((e) => (e.textContent || '').includes('日文乱码修复'));
  if (叶) 叶.click();
  await new Promise((r) => setTimeout(r, 2300));
  const b = [...document.querySelectorAll('.seg__btn')].find((x) => {
    const l = x.querySelector('.seg__label');
    return ((l ? l.textContent : x.textContent) || '').trim() === ${JSON.stringify(标签)};
  });
  if (b) b.click();
  await new Promise((r) => setTimeout(r, 1600));
  return location.pathname + location.search;
})()`;

/* ================= 甲、粘一整段 → 右边整段 ================= */
console.log('\n==== 甲、粘贴那条路：整段进、整段出 ====');
console.log('切到：', await 跑(到栏('文本')));
console.log('喂进去（前 2 行）：\n' + 乱码.split('\n').slice(0, 2).join('\n'));

console.log(
  '粘 + 还原：',
  await 跑(`(async () => {
  const ta = document.querySelector('textarea.ta');
  if (!ta) return '（没有输入框）';
  ta.focus();
  ta.value = ${JSON.stringify(乱码)};
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '还原');
  if (!b) return '（没有「还原」按钮）';
  b.click();
  await new Promise((r) => setTimeout(r, 4500));
  return 'ok';
})()`)
);

const 甲 = await 跑(`(() => {
  const 文 = (el) => (el && el.textContent ? el.textContent : '');
  const out = document.querySelector('pre.pair__out');
  const 主区 = document.querySelector('.wb__main');
  return {
    右边那块在不在: !!out,
    右边的内容: out ? out.value ?? out.textContent : '',
    左边框里还是乱码吗: (document.querySelector('textarea.ta') || {}).value || '',
    主区上有没有这些字样: ['就用这个', '增益', '门槛', '假名上升', '打分', '候选']
      .filter((w) => 文(主区).includes(w)),
    状态那行: [...document.querySelectorAll('.wb__main .mini')].map(文).filter((x) => /认出来|没认出|粘进去/.test(x))
  };
})()`);

const 真值前 = 真值.replace(/\r\n/g, '\n');
const 得到 = (甲.右边的内容 || '').replace(/\r\n/g, '\n');
if (得到 !== 真值前) {
  const x = 乱码.replace(/\r\n/g, '\n').split('\n');
  const y = 得到.split('\n');
  const z = 真值前.split('\n');
  console.log('\n---- 逐行对照（粘进去的乱码 / 右边出来的 / 真值）----');
  for (let i = 0; i < Math.max(x.length, y.length, z.length); i++) {
    const a = x[i] ?? '', b = y[i] ?? '', c = z[i] ?? '';
    const ok = b === c;
    console.log(`${ok ? '  ' : '❌'} L${i + 1}`);
    if (!ok) {
      console.log(`     乱码：${a}`);
      console.log(`     出来：${b}`);
      console.log(`     真值：${c}`);
    }
  }
}
ok(甲.右边那块在不在, '右边有一块画结果的地方（`pre.pair__out`）');
ok(得到 === 真值前, `右边给出的**就是整段真值**（前 2 行）—— 得到：${JSON.stringify(得到.split('\n').slice(0, 2).join(' / '))}`);
ok(甲.左边框里还是乱码吗.includes('僄僢僕') || 甲.左边框里还是乱码吗.length > 0, '左边还是原来那串（两边对着看）');
ok(甲.主区上有没有这些字样.length === 0, `「文本」栏上找不到 ${JSON.stringify(['就用这个', '增益', '门槛', '假名上升', '打分', '候选'])} 任何一个 —— 实际命中：${JSON.stringify(甲.主区上有没有这些字样)}`);
ok(甲.状态那行.length > 0, `有一行状态说清认没认出来：${JSON.stringify(甲.状态那行)}`);

/* ================= 乙、名字跟正文一趟 ================= */
console.log('\n==== 乙、「文件」栏：名字按需还原 ====');
console.log('切到：', await 跑(到栏('文件')));
console.log(
  '拖一个有乱码名字的目录进去：',
  await 跑(`(async () => {
  const w = document.querySelector('.wb__main');
  const r = w.getBoundingClientRect();
  const d = devicePixelRatio || 1;
  const 位 = { x: Math.round((r.left + r.width / 2) * d), y: Math.round((r.top + r.height / 2) * d) };
  const 发 = async (类型, 载荷) => {
    try { await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'tauri://drag-' + 类型, payload: 载荷 }); return 'ok'; }
    catch (e) { return '（emit 失败：' + e + '）'; }
  };
  const a = await 发('enter', { paths: [${JSON.stringify(带乱码名的目录)}], position: 位 });
  const b = await 发('drop', { paths: [${JSON.stringify(带乱码名的目录)}], position: 位 });
  await new Promise((r2) => setTimeout(r2, 5000));
  return a + '/' + b;
})()`)
);

const 乙 = await 跑(`(() => {
  const 文 = (el) => (el && el.textContent ? el.textContent : '').replace(/\\s+/g, ' ').trim();
  const 主区 = document.querySelector('.wb__main');
  const chk = [...document.querySelectorAll('.wb__main label.chk')].find((l) => /名字也一起还原/.test(文(l)));
  return {
    扫到的读数: [...document.querySelectorAll('.wb__main .mini')].map(文).filter((x) => /扫了|像乱码/.test(x)),
    名字那一行: chk ? 文(chk) : '（没有这一行）',
    名字勾上了吗: chk ? (chk.querySelector('input') || {}).checked : null,
    地址: location.pathname + location.search
  };
})()`);
console.log(JSON.stringify(乙, null, 1));
ok(/名字也一起还原（\\d+ 个）/.test(乙.名字那一行) || /名字也一起还原（[0-9]+ 个）/.test(乙.名字那一行), `「文件」栏扫完认出了名字里像乱码的那些：${乙.名字那一行}`);
ok(乙.名字勾上了吗 === true, '默认勾上（按需还原 —— 用户不用再单开一栏去点）');

/* ================= 丙、警告框不能一直占着 ================= */
console.log('\n==== 丙、警告框：有叉 + 到点自己走 ====');
console.log('切回文本栏：', await 跑(到栏('文本')));
await 跑(`(async () => {
  const w = document.querySelector('.wb__main');
  const r = w.getBoundingClientRect();
  const d = devicePixelRatio || 1;
  const 位 = { x: Math.round((r.left + r.width / 2) * d), y: Math.round((r.top + r.height / 2) * d) };
  const 发 = async (类型, 载荷) => { try { await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'tauri://drag-' + 类型, payload: 载荷 }); } catch (e) {} };
  await 发('enter', { paths: ['D:\\\\别处\\\\一张图.png'], position: 位 });
  await 发('drop', { paths: ['D:\\\\别处\\\\一张图.png'], position: 位 });
  await new Promise((r2) => setTimeout(r2, 1500));
})()`);

const 丙1 = await 跑(`(() => { const x = document.querySelector('.note--warn'); return x ? { 话: x.textContent.replace(/\\s+/g,' ').trim().slice(0,34), 有叉: !!x.querySelector('.note__x') } : '（没冒出来）'; })()`);
ok(typeof 丙1 === 'object' && 丙1.有叉, `警告框冒出来了、而且有叉：${JSON.stringify(丙1)}`);
console.log('等着，不碰它…（到 11 秒再看）');
await 等(11000);
const 丙2 = await 跑(`document.querySelector('.note--warn') ? '还在' : '（走了）'`);
ok(丙2 === '（走了）', `不碰它也会自己走（改之前 12 秒后还在）：${丙2}`);

console.log(`\n==== 三条要求 ${n - bad}/${n} 条通过 ====`);
ws.close();
process.exitCode = bad ? 1 : 0;
