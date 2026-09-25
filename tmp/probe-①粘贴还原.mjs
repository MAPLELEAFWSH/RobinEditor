/**
 * 探针：①「文本」栏 —— 粘一整段乱码、点「还原」之后，**屏幕上到底给出什么**。
 *
 * 量的是用户那句"为什么我粘贴要还原的文本你不能给我还原成一整段"：
 * 还原后的整段日文，究竟有没有画在界面上（还是只能靠「复制日文」进剪贴板）。
 *
 * 喂进去的乱码是**真样本**：把语料里那个 Shift-JIS 的 readme 的字节按 GBK 解一遍 ——
 * 那正是 GBK 查看器里看到的那串字，也就是用户复制到剪贴板里的东西。
 *
 * 前提（起打包版真机；还原走的是 Rust，桩不出来）：
 *   $env:WEBVIEW2_USER_DATA_FOLDER="$env:TEMP\robin-pkg-x"
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9225'
 *   .\dist\RobinEditor-免安装版.exe
 *   node tmp\probe-①粘贴还原.mjs 9225
 */
import { readFile } from 'node:fs/promises';

const PORT = process.env.CDP_PORT ?? process.argv[2] ?? '9225';
const 源 = 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例\\乱码翻译\\PostRimShilouhette\\夵曄尦readme\\EdgeControl - readme.txt';

/* 真乱码样本：Shift-JIS 的字节按 GBK 读出来那一串 */
const 字节 = await readFile(源);
const 乱码全 = new TextDecoder('gbk').decode(字节);
const 乱码 = 乱码全.split(/\r?\n/).slice(0, 8).join('\n');
const 该还原成 = new TextDecoder('shift_jis').decode(字节).split(/\r?\n/).slice(0, 8).join('\n');
console.log('喂进去的乱码（前 3 行）：');
console.log(乱码.split('\n').slice(0, 3).join('\n'));
console.log('\n它该被还原成（前 3 行）：');
console.log(该还原成.split('\n').slice(0, 3).join('\n'));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = list.find((x) => x.type === 'page' && !x.url.startsWith('devtools://'));
if (!t) throw new Error(`CDP :${PORT} 上没有可连的 page`);
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
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
await rpc('Page.enable');
await rpc('Runtime.enable');

/* 保证在「文本」栏上 */
const 到文本栏 = `(async () => {
  const b = [...document.querySelectorAll('.seg__btn')].find((x) => {
    const l = x.querySelector('.seg__label');
    return ((l ? l.textContent : x.textContent) || '').trim() === '文本';
  });
  if (b) b.click();
  await new Promise((r) => setTimeout(r, 1200));
  return location.pathname + location.search;
})()`;
console.log('切到：', await 跑(到文本栏));

/* 粘进去 + 点还原 */
const 粘 = `(async () => {
  const ta = document.querySelector('textarea.ta');
  if (!ta) return '（没有那个输入框）';
  ta.focus();
  ta.value = ${JSON.stringify(乱码)};
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '还原');
  if (!btn) return '（没有「还原」按钮）';
  btn.click();
  await new Promise((r) => setTimeout(r, 4000));
  return 'ok';
})()`;
console.log('粘+还原：', await 跑(粘));

/* 屏幕上现在有什么 */
const 屏 = await 跑(`(() => {
  const 文 = (el) => (el && el.textContent ? el.textContent : '').replace(/\\s+/g, ' ').trim();
  const 卡 = [...document.querySelectorAll('.wb__main .card')].map((c) => {
    const h = c.querySelector('h3, summary');
    return { 标题: 文(h) || '(无标题)', 前80字: 文(c).slice(0, 80) };
  });
  return {
    地址: location.pathname + location.search,
    输入框里现在是什么: (document.querySelector('textarea.ta') || {}).value || '',
    按钮: [...document.querySelectorAll('.wb__main button')].map(文).filter(Boolean),
    卡片: 卡,
    预格式块: [...document.querySelectorAll('.wb__main pre')].map(文),
    日文有没有出现在某个输入框或预格式块里: (() => {
      const 目标 = ${JSON.stringify(该还原成.split('\n')[0])};
      const 处 = [];
      for (const el of document.querySelectorAll('.wb__main textarea, .wb__main pre, .wb__main .mono')) {
        const v = el.value !== undefined ? el.value : el.textContent;
        if (v && v.includes(目标)) 处.push(el.tagName + '.' + (typeof el.className === 'string' ? el.className.split(' ')[0] : ''));
      }
      return 处;
    })()
  };
})()`);
console.log('\n==== 点完「还原」之后屏幕上有什么 ====');
console.log(JSON.stringify(屏, null, 1));

/* 顺手看看剪贴板那条路是不是唯一出口 */
console.log('\n「复制日文」在不在：', (屏.按钮 || []).includes('复制日文'));
WS_END: {
  ws.close();
}
