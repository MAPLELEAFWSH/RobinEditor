/**
 * 探针：③ 养乐多「参数」加滑条 / 对标 Ray —— 拿**真模板**量。
 *
 * 配对是唯一能出事实的东西，所以这里两边各算一遍再比：
 *   · Node 侧：读真 `mat_body.fx`，用本工程自己的 `parseFx` 算出每条 float / vec 分量的**原值**，
 *     按定下来的规矩推出滑条范围（原值×2）；
 *   · 浏览器侧：把同一份模板载进 ③，读**真正渲染出来**的那些滑条的 min/max/step。
 * 两边不一致就报出来 —— 只量"有没有滑条"是不够的，范围推错等于滑条没用。
 *
 * 另外量三件事：
 *   ① 拖到端点时**范围不许跟着变**（这就是"按原值推而不是按当前值推"那个决定要守的东西）；
 *   ② `int` 不许有滑条（实测那些 int 是枚举：2 从贴图取 / 3 常量 / SWIZZLE / PI）；
 *   ③ 整页不许横向滚动、参数行不许溢出（版面没被撑坏）。
 *
 * 用法（先 `pnpm dev` 起在 1420，再无头 Chrome 开 9400）：
 *   node --import ./tmp/register-loader.mjs tmp\probe-③养乐多滑条.mjs [fx路径] [视口]
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseFx, componentCount } from '../src/lib/modules/yaku/ops.ts';

const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const fx路径 =
  process.argv[2] ??
  'E:\\deepseek-harness\\mmd集成工具\\实战测试用例\\渲染联动\\养乐多\\MMDStarRail4Fun_v2.2.1\\mat_body.fx';
const 视口 = process.argv[3] ?? '1707x1067';
const app = 'http://127.0.0.1:1420';

/* ---------------- Node 侧：算期望值 ---------------- */

const fx文本 = fs.readFileSync(fx路径, 'latin1');
const 解析 = parseFx(fx文本);

/** 界面上的规矩（跟 Yaku.svelte 的 `范围()` 必须一模一样） */
function 期望范围(原) {
  const 基准 = Math.abs(Number(原));
  const 幅 = Number.isFinite(基准) && 基准 > 0 ? Math.ceil(基准 * 2 * 100) / 100 : 1;
  const 负 = Number(原) < 0;
  return { min: 负 ? -幅 : 0, max: 幅, step: 幅 / 200 };
}

const 期望 = new Map(); // 键 = 滑条的 aria-label
let int条数 = 0;
for (const p of 解析.params) {
  if (p.kind === 'float') 期望.set(p.name, 期望范围(p.value));
  else if (componentCount(p.kind) > 1) {
    const 分量 = p.value.split(',').map((v) => v.trim());
    for (let i = 0; i < componentCount(p.kind); i++) 期望.set(`${p.name} 第 ${i + 1} 位滑条`, 期望范围(分量[i] ?? '0'));
  } else if (p.kind === 'int') int条数++;
}
console.log(`模板 ${path.basename(fx路径)}：参数 ${解析.params.length} 条，其中 float ${[...解析.params].filter((p) => p.kind === 'float').length}、` +
  `vec ${[...解析.params].filter((p) => componentCount(p.kind) > 1).length}、int ${int条数}`);
console.log(`期望的滑条条数（float 1 条 + vec 每分量 1 条）：${期望.size}`);

/* ---------------- 桩：假后端，模板正文直接嵌进去 ---------------- */

const 桩 = `
(() => {
  const 量 = window.__量 = { longtask: [], 报错: [] };
  window.addEventListener('error', (e) => 量.报错.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => 量.报错.push('rejection ' + String(e.reason)));
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) 量.longtask.push(Math.round(e.duration)); })
      .observe({ entryTypes: ['longtask'] });
  } catch (e) {}

  const FX = ${JSON.stringify(fx文本)};
  window.__假 = { 调用: [] };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      window.__假.调用.push(cmd);
      if (cmd === 'plugin:dialog|open') return ${JSON.stringify(fx路径)};
      if (cmd === 'plugin:dialog|save') return null;
      if (cmd === 'read_text_file') return { text: FX, encoding: 'shift_jis', lossy: false, bom: false };
      if (cmd === 'probe_dir') return { exists: true, is_dir: false, entries: 0, names: [] };
      if (cmd === 'read_pmx') return { name: '假模型', materials: [], textures: [] };
      return null;
    },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window['_' + id] = cb; return id; },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } }
  };

  /** 点一个按字找的按钮 */
  window.__点 = (字) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 字);
    if (!b) return { 错: '找不到按钮「' + 字 + '」' };
    b.click();
    return { 点了: 字 };
  };

  /** 把当前「参数」面板里渲染出来的滑条逐条读出来 */
  window.__滑条 = () => {
    const 出 = [];
    for (const el of document.querySelectorAll('.prow input[type=range], .vrow input[type=range]')) {
      出.push({
        名: el.getAttribute('aria-label'),
        min: Number(el.min), max: Number(el.max), step: Number(el.step), 值: Number(el.value)
      });
    }
    return 出;
  };

  /** 拖一条滑条到端点，看范围会不会跟着变（按原值推的话不会） */
  window.__拖端点 = async (名, 次数) => {
    const el = [...document.querySelectorAll('input[type=range]')].find((x) => x.getAttribute('aria-label') === 名);
    if (!el) return { 错: '找不到滑条 ' + 名 };
    const 定值 = (v) => {
      const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      d.set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const 首 = { min: Number(el.min), max: Number(el.max) };
    const 逐次 = [];
    for (let i = 0; i < (次数 ?? 6); i++) {
      定值(Number(el.max));
      await new Promise((r) => requestAnimationFrame(r));
      逐次.push({ min: Number(el.min), max: Number(el.max) });
    }
    const 框 = document.querySelector('.prow:has(input[aria-label="' + CSS.escape(名) + '"]) input[type=number]');
    return {
      滑条: 名,
      拖之前: 首,
      每拖一次的范围: 逐次,
      范围变了吗: 逐次.some((x) => x.min !== 首.min || x.max !== 首.max),
      数字框里现在是多少: 框 ? 框.value : null,
      滑条现在在: Number(el.value)
    };
  };

  /** 文本框里敲一个数，看滑条跟不跟（反过来也要能填） */
  window.__敲数字 = async (滑条名, 值) => {
    const 行 = document.querySelector('.prow:has(input[aria-label="' + CSS.escape(滑条名) + '"])')
      ?? document.querySelector('.vrow:has(input[aria-label="' + CSS.escape(滑条名) + '"])');
    if (!行) return { 错: '找不到那一行：' + 滑条名 };
    const 框 = 行.querySelector('input[type=number]');
    const 条 = 行.querySelector('input[type=range]');
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(框, String(值));
    框.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { 敲进去: 值, 框里: 框.value, 滑条变成: 条 ? Number(条.value) : null };
  };
})();
`;

/* ---------------- CDP ---------------- */

const list = await (await fetch(`${BASE}/json/list`)).json();
const t = list.find((x) => x.type === 'page' && !x.url.startsWith('devtools://'));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const rpc = (method, params = {}) =>
  new Promise((res, rej) => {
    const my = ++id;
    const 定时 = setTimeout(() => { ws.removeEventListener('message', on); rej(new Error('CDP 超时 ' + method)); }, 30000);
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
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));

await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Emulation.setDeviceMetricsOverride', {
  width: Number(视口.split('x')[0]), height: Number(视口.split('x')[1]), deviceScaleFactor: 1, mobile: false
});
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: 桩 });

const 跑 = async (表达式, 等待 = true) => {
  const r = await rpc('Runtime.evaluate', { expression: 表达式, returnByValue: true, awaitPromise: 等待 });
  if (r.exceptionDetails) return { 页面抛错: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  return r.result.value;
};

console.log(`\n==== ③ 养乐多滑条验收 · 视口 ${视口} ====`);
/* 模板卡与「参数」面板都在**写入**那个分区上（材质匹配那页没有它们），
   第一次跑就是漏了这一点，量出来一片 0。 */
await rpc('Page.navigate', { url: `${app}/tools/yaku?panel=apply` });
await 等(6000);

console.log('\n---- 载入真模板（点身体那一行的「选」）----');
console.log(JSON.stringify(await 跑(`(() => {
  const 行 = [...document.querySelectorAll('.tmpl__it')].find((x) => x.textContent.includes('身体'));
  const b = 行 ? [...行.querySelectorAll('button')].find((x) => x.textContent.trim() === '选') : null;
  if (!b) return { 错: '模板卡上找不到「身体」那一行的「选」' };
  b.click();
  return { 点了: '身体 选' };
})()`, false), null, 1));
await 等(2500);

/* 参数默认只摆**常用项**（用户 2026-09-22 拍的口径），所以要比全量就得先点「全部参数」。
   第一版漏了这一步，量出来 32 行、还误报了一大串"该有却没有的滑条"。 */
console.log('\n---- 切到「全部参数」----');
console.log(JSON.stringify(await 跑(`window.__点('全部参数')`, false), null, 1));
await 等(1500);

const 摘要 = await 跑(`({
  模板名: [...document.querySelectorAll('.tmpl__v')].map((x) => x.textContent.trim()),
  参数行数: document.querySelectorAll('.prow').length,
  滑条数: document.querySelectorAll('.prow input[type=range], .vrow input[type=range]').length,
  数字框数: document.querySelectorAll('.prow input[type=number]').length,
  vec行数: document.querySelectorAll('.vrow').length,
  段数: document.querySelectorAll('.sec').length
})`, false);
console.log('\n---- 载入之后界面上有什么 ----\n' + JSON.stringify(摘要, null, 1));

/* 逐条比范围：浏览器里渲染出来的 vs Node 侧按规矩算的 */
const 实得 = await 跑(`window.__滑条()`, false);
let 同 = 0;
const 不一样 = [];
const 多的 = [];
for (const s of 实得 ?? []) {
  const e = 期望.get(s.名);
  if (!e) { 多的.push(s.名); continue; }
  const 一致 = Math.abs(e.min - s.min) < 1e-9 && Math.abs(e.max - s.max) < 1e-9;
  if (一致) 同++;
  else 不一样.push({ 名: s.名, 实得: `${s.min}~${s.max}`, 期望: `${e.min}~${e.max}` });
}
console.log(`\n---- 范围逐条比（实得 ${实得?.length ?? 0} 条 / 期望 ${期望.size} 条）----`);
console.log(`  一致 ${同} 条`);
if (不一样.length) console.log('  **不一致**：\n' + 不一样.slice(0, 12).map((x) => `    ${x.名}：实得 ${x.实得}，期望 ${x.期望}`).join('\n'));
if (多的.length) console.log(`  **模板里没有的滑条**：${多的.slice(0, 8).join('、')}`);
const 缺的 = [...期望.keys()].filter((k) => !(实得 ?? []).some((s) => s.名 === k));
if (缺的.length) console.log(`  **该有却没有的滑条**：${缺的.slice(0, 8).join('、')}`);

/* 端点稳定性 */
const 头一条 = (实得 ?? [])[0];
if (头一条) {
  console.log(`\n---- 拖「${头一条.名}」到端点 6 次，看范围会不会跟着变 ----`);
  console.log(JSON.stringify(await 跑(`window.__拖端点(${JSON.stringify(头一条.名)}, 6)`), null, 1));
  console.log(`\n---- 在那个框里敲一个数，看滑条跟不跟 ----`);
  const 目标 = 头一条.名.includes('第') ? 头一条.名 : 头一条.名;
  console.log(JSON.stringify(await 跑(`window.__敲数字(${JSON.stringify(目标)}, ${(头一条.max / 2).toFixed(3)})`), null, 1));
}

/* int 那一支：模板里的 int 名字，界面上不该出现同名滑条 */
const int名 = 解析.params.filter((p) => p.kind === 'int').map((p) => p.name).slice(0, 6);
console.log(`\n---- int 不许有滑条（抽查 ${int名.length} 个）----`);
console.log(JSON.stringify(await 跑(`(() => {
  const 名表 = ${JSON.stringify(int名)};
  const 出 = [];
  for (const n of 名表) {
    const 行 = [...document.querySelectorAll('.prow')].find((r) => r.querySelector('.pname')?.textContent.trim() === n);
    出.push({ 参数: n, 有滑条: !!(行 && 行.querySelector('input[type=range]')), 有数字框: !!(行 && 行.querySelector('input[type=number]')) });
  }
  return 出;
})()`, false), null, 1));

/* 版面：横向滚动 / 溢出 */
console.log('\n---- 版面（规范：横向滚动一律不许有）----');
console.log(JSON.stringify(await 跑(`({
  横向滚动的元素: [...document.querySelectorAll('.wb *, body *')].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
  视口宽: innerWidth, 文档宽: document.documentElement.scrollWidth,
  参数面板高: Math.round((document.querySelector('.pane')?.getBoundingClientRect().height ?? 0)),
  报错: window.__量.报错
})`, false), null, 1));
ws.close();
