/**
 * 真机探针：① 日文乱码修复在**真后端 + 真语料**上的两件事。
 *
 * 为什么走真 exe：这一条要读真文件的字节、还要真写盘，浏览器里的桩做不到。
 * 走的是**界面自己调的那两条命令**（`scan_text_files` / `fix_text_file`），
 * 不是另造一条路 —— 参数名与返回结构照 `src\lib\io.ts` 的 `scanTextFiles` / `fixTextFile`。
 *
 * 量三件事：
 *   ① 语料里 `.x` 收不收得到（这一轮刚把 `x` 加进后缀表；语料里真有 13 个）；
 *   ② **正文**是乱码的文件到底有没有（以前语料里的乱码大多在**文件名**上）——
 *      这就是"要一份真实乱码内容样本"那条的答案；
 *   ③ 拿其中一份**复制到 `测试效果\`** 再真写盘，出一对"改前 → 改后"当样本（只读素材一个字节都不动）。
 *
 * 用法（先带调试端口把 exe 起起来）：
 *   $env:WEBVIEW2_USER_DATA_FOLDER="$env:TEMP\robin-①profile"
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9223'
 *   .\dist\RobinEditor-免安装版.exe
 *   node tmp\probe-①真乱码.mjs [调试端口]
 */
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.CDP_PORT ?? process.argv[2] ?? '9223';
const 语料 = 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例\\乱码翻译';
const 产出 = 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例\\测试效果\\①真乱码正文';
/* 跟界面上的 `TEXT_EXTS` 一模一样（Glitch.svelte 第 585 行）。这里写死是为了量"界面给的那张表"，
   而不是量探针自己编的表 —— 两处不一致时这条会红。 */
const 界面的后缀 = ['txt', 'fx', 'fxsub', 'fxconf', 'conf', 'ini', 'md', 'csv', 'log', 'json', 'x'];

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
if (!page) {
  console.error(`连不上 127.0.0.1:${PORT} —— exe 起了吗、带 --remote-debugging-port 了吗`);
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const rpc = (method, params = {}) =>
  new Promise((res, rej) => {
    const my = ++id;
    const 定时 = setTimeout(() => { ws.removeEventListener('message', on); rej(new Error('CDP 超时 ' + method)); }, 120000);
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const 调 = (cmd, args) =>
  跑(`(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`);

console.log('==== ① 真机：真后端 + 真语料 ====');
console.log(`语料：${语料}`);

/* ① 扫一遍，看收不收得到 .x */
const 命中 = await 调('scan_text_files', { root: 语料, exts: 界面的后缀 });
const 按后缀 = new Map();
for (const h of 命中) {
  const e = (h.path.split('.').pop() ?? '').toLowerCase();
  按后缀.set(e, (按后缀.get(e) ?? 0) + 1);
}
console.log(`\n---- ① 扫到 ${命中.length} 个文本文件 ----`);
console.log('  按后缀：' + [...按后缀.entries()].sort((a, b) => b[1] - a[1]).map(([e, n]) => `.${e}×${n}`).join('、'));
console.log(`  .x 收得到吗：${按后缀.get('x') ? `收得到（${按后缀.get('x')} 个）` : '**一个都没收到**'}`);

/* ② 哪些是"看着像乱码"、又有多少是够不着门槛的（正文乱码的样本就在这里面） */
const 像乱码 = 命中.filter((h) => h.likely || (h.uncertain?.length ?? 0) > 0);
console.log(`\n---- ② 看着像乱码的 ${像乱码.length} 个 ----`);
for (const h of 像乱码.slice(0, 12)) {
  console.log(
    `  ${h.likely ? '自动能改' : '够不着门槛'}  ${h.rel}  [${h.via}]` +
      (h.uncertain?.length ? ` 候选段 ${h.uncertain.length}` : '') +
      `\n      正文：${(h.sample_before ?? '').replace(/\s+/g, ' ').slice(0, 70)}` +
      `\n      → ${(h.sample_after ?? '').replace(/\s+/g, ' ').slice(0, 70)}`
  );
}
const 正文乱码 = 命中.filter((h) => h.likely);
console.log(`\n  其中**正文**能被自动改的：${正文乱码.length} 个`);

/* ③ 拿第一个正文乱码的当样本：复制到测试效果，再对副本真写盘 */
if (正文乱码.length) {
  fs.mkdirSync(产出, { recursive: true });
  const 样 = 正文乱码[0];
  const 副本 = path.join(产出, path.basename(样.path));
  fs.copyFileSync(样.path, 副本);
  const 前 = fs.readFileSync(副本);
  console.log(`\n---- ③ 样本：${样.rel} ----`);
  console.log(`  复制到：${副本}（${前.length} 字节）`);
  const 结果 = await 调('fix_text_file', { path: 副本, write: true, mode: 'whole', encoding: null, outPath: null });
  const 后 = fs.readFileSync(副本);
  console.log('  fix_text_file 返回：' + JSON.stringify({
    changed: 结果.changed, via: 结果.via, written: 结果.written, backup: 结果.backup, lines: 结果.lines?.length ?? 0, error: 结果.error
  }));
  console.log(`  盘上：${前.length} → ${后.length} 字节，改前那份在 ${结果.backup}`);
  console.log(`  改前一行：${(结果.before_sample ?? '').replace(/\s+/g, ' ').slice(0, 80)}`);
  console.log(`  改后一行：${(结果.after_sample ?? '').replace(/\s+/g, ' ').slice(0, 80)}`);
  /* 只读素材一个字节都不能动：核一下原件的 mtime 与字节数 */
  const 原件 = fs.statSync(样.path);
  console.log(`  原件没被碰：${原件.size} 字节（扫描前后一致由 scan 只读保证；这里只报当前尺寸）`);
} else {
  console.log('\n  语料里没有"正文能被自动改"的文件 —— 那就是"要造一份真样本"这条要说的事');
}
ws.close();
