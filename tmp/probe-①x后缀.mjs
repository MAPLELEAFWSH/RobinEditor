/**
 * 真机验证：**`.x` 到底收不收得到**。
 *
 * 为什么要单独验：语料里那 13 个 `.x` 全是**纯 ASCII**，按扫描器"全 ASCII 不用看"的规矩
 * 本来就不会出现在结果里 —— 所以"扫出来 0 个 .x"**不能**说明后缀收进去了。
 * 这里的做法是造一份**带真乱码字节**的 `.x`：乱码字节从语料里那份真实乱码文件里**原样抠出来**，
 * 不是我编的字符串 —— 然后扫它所在的目录，看后端认不认 `.x` 这个后缀。
 *
 * 产物写在 `测试效果\①真乱码正文\`（只读素材一个字节都不动）。
 *
 * 用法（先带调试端口起 exe）：
 *   node tmp\probe-①x后缀.mjs [调试端口]
 */
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.CDP_PORT ?? process.argv[2] ?? '9223';
const 语料 = 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例\\乱码翻译';
const 产出 = 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例\\测试效果\\①真乱码正文';
/* 语料里那份真实乱码文件：正文里带着 `傾僯儊晽夋柺僗僋儕乕儞` 这种 GBK 误读出来的日文 */
const 乱码源 = path.join(语料, '修复结果_过目用', '改名对照.md');
const 干净x源 = path.join(语料, 'AlternativeFull', 'ExcellentShadow2', 'ES_ScreenShadowMapTest.x');

/* ① 从真文件里抠出那段乱码字节。
   注意**不能**只找"第一个非 ASCII 字节" —— 那份 .md 里第一段非 ASCII 是表头的**中文**
   （本来就是给人看的），拿它当样本只会得到"没自动改"。要的是那行 GBK 误读出来的日文，
   它的特征是行里带着 `.exa` 这种 ASCII 尾巴。 */
const 乱码原 = fs.readFileSync(乱码源);
const 锚 = 乱码原.indexOf(Buffer.from('.exa', 'latin1'));
if (锚 < 0) throw new Error(`那份文件里没找到乱码行（找 .exa）：${乱码源}`);
let 行首 = 乱码原.lastIndexOf(0x0a, 锚) + 1;
let 行尾 = 乱码原.indexOf(0x0a, 锚);
if (行尾 < 0) 行尾 = 乱码原.length;
const 乱码行 = 乱码原.subarray(行首, 行尾);
console.log(`从 ${path.basename(乱码源)} 抠出一行乱码字节：${乱码行.length} 字节`);

/* ② 往一份干净的 .x 后面接一行注释（`// ` + 那段乱码），造出"带乱码的 .x" */
const 干净 = fs.readFileSync(干净x源);
fs.mkdirSync(产出, { recursive: true });
const 目标 = path.join(产出, '带乱码的注释.x');
fs.writeFileSync(目标, Buffer.concat([干净, Buffer.from('\r\n// ', 'latin1'), 乱码行, Buffer.from('\r\n', 'latin1')]));
console.log(`造出：${目标}（${fs.statSync(目标).size} 字节；干净那半 ${干净.length} 字节 + 乱码那行）`);

/* ③ 让真后端去扫这个目录，看它认不认 .x */
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
if (!page) { console.error(`连不上 127.0.0.1:${PORT} —— exe 起了吗`); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const 跑 = (表达式) =>
  new Promise((res, rej) => {
    const my = ++id;
    const 定时 = setTimeout(() => { ws.removeEventListener('message', on); rej(new Error('CDP 超时')); }, 120000);
    const on = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== my) return;
      clearTimeout(定时);
      ws.removeEventListener('message', on);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression: 表达式, returnByValue: true, awaitPromise: true } }));
  });
const 调 = (cmd, args) =>
  跑(`(async () => await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)}))()`).then((r) => {
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  });

const 后缀 = ['txt', 'fx', 'fxsub', 'fxconf', 'conf', 'ini', 'md', 'csv', 'log', 'json', 'x'];
const 前 = await 调('scan_text_files', { root: 产出, exts: 后缀 });
console.log(`\n带上 x 扫这个目录：${前.length} 个文件`);
for (const h of 前) console.log(`  ${h.rel}  ${h.likely ? '自动能改' : '没自动改'}  [${h.via}]  ${(h.sample_before ?? '').slice(0, 60)}`);

const 后 = await 调('scan_text_files', { root: 产出, exts: 后缀.filter((e) => e !== 'x') });
console.log(`\n把 x 从表里去掉再扫：${后.length} 个文件${后.length === 0 ? '（说明那个 .x 是靠 x 这一项才进来的 ✓）' : ''}`);

/* ④ 真修一次那个 .x（写盘），核回读 */
const 命中 = 前.find((h) => h.path.endsWith('.x'));
if (命中) {
  const 尺 = fs.statSync(命中.path).size;
  const r = await 调('fix_text_file', { path: 命中.path, write: true, mode: 'whole', encoding: null, outPath: null });
  console.log(`\n真写盘：changed=${r.changed} written=${r.written} 字节 ${尺} → ${fs.statSync(命中.path).size}，备份 ${r.backup}`);
  console.log(`  改前：${(r.before_sample ?? '').replace(/\s+/g, ' ').slice(0, 70)}`);
  console.log(`  改后：${(r.after_sample ?? '').replace(/\s+/g, ' ').slice(0, 70)}`);
}
ws.close();
