/**
 * ② ikClut 调色页的**回归守卫**：跑在无头 Chrome + 假后端上，出现下面任何一条就非零退出。
 *
 * 守的是三件出过事、而且不报错的东西：
 *   1. **整页卡死**：`$effect` 读一个自己（或自己写的那个）`$state`，跑满深度上限抛
 *      `effect_update_depth_exceeded`，抛完启动幕布再也不撤、主界面永远停在 `opacity:0`
 *      —— 看着就是"点了没反应、界面卡死"。改之前实测能复现，见 `tmp\坏掉对照-②.log`。
 *   2. **量不对帧**：1920×1080 的参考图，改一个参数主线程被堵 96~124ms（一帧预算 33ms）
 *      —— 两级预览（拖动 512 / 停手 1024）没生效，每一下都走了全量。
 *   3. **同步开关自己跟自己打架**：同步缩放 / 同步平移开着时空转重算。
 *
 * 为什么要有假后端：无头 Chrome 里 `isTauri()` 是 false，`read_rgba` 那条路走不通，
 * 页面上「参考图」这一格永远填不上，量到的永远是"用程序生成的小测试图"那一层。
 * 这里桩的是**数据**（一张 1920×1080 的图），版式、控件、文案全是真的。
 *
 * 跑法（要两个东西先起着）：
 *   pnpm exec vite dev --config tmp\vite.体检.config.js     # 关 HMR 的那个，1422
 *   chrome --headless=new --remote-debugging-port=9400 --user-data-dir=<临时目录> about:blank
 *   node tools\regress-ikclut.mjs
 *
 * 环境变量：`CDP_PORT`（默认 9400）、`PROBE_SITE`（默认 http://127.0.0.1:1422）。
 */
const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const 站点 = process.env.PROBE_SITE ?? 'http://127.0.0.1:1422';

/* ---------------- 页面里那一层：计数 + 假后端 ---------------- */

const 桩 = `
(() => {
  const 量 = window.__量 = { toDataURL: 0, longtask: [], 最长帧间隔: 0, 帧数: 0, 报错: [] };
  const 真toDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (...a) { 量.toDataURL++; return 真toDataURL.apply(this, a); };
  window.addEventListener('error', (e) => 量.报错.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => 量.报错.push('rejection ' + String(e.reason)));
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) 量.longtask.push(Math.round(e.duration)); })
      .observe({ entryTypes: ['longtask'] });
  } catch (e) {}
  let 上次 = performance.now();
  const 跳 = (t) => { const g = t - 上次; 上次 = t; 量.帧数++; if (g > 量.最长帧间隔) 量.最长帧间隔 = Math.round(g); requestAnimationFrame(跳); };
  requestAnimationFrame(跳);

  window.__帧窗 = (ms) => new Promise((res) => {
    const 样 = []; let 上次2 = performance.now(); const t0 = 上次2;
    const 跳2 = (t) => { 样.push(t - 上次2); 上次2 = t;
      if (t - t0 < ms) requestAnimationFrame(跳2);
      else { const s = [...样].sort((a, b) => a - b); res({ 帧数: 样.length, 最长: Math.round(s[s.length - 1]), 中位: Math.round(s[Math.floor(s.length / 2)]) }); } };
    requestAnimationFrame(跳2);
  });

  window.__定值 = (el, v) => {
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  /* 连敲 N 下，量事件内同步花的时间、到下一帧的时间、以及重算了几次图 */
  window.__连敲 = async (选择器, 数, 起点, 步) => {
    const el = document.querySelector(选择器);
    if (!el) return { 错: '找不到 ' + 选择器 };
    await new Promise((r) => setTimeout(r, 900));
    const c0 = 量.toDataURL, lt0 = 量.longtask.length;
    const 逐次 = []; const t0 = performance.now();
    for (let i = 0; i < 数; i++) {
      const t = performance.now();
      window.__定值(el, 起点 + i * 步);
      逐次.push(Math.round((performance.now() - t) * 10) / 10);
    }
    const 同步共ms = performance.now() - t0;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const 到帧ms = performance.now() - t0;
    /* 到下一帧那一刻先把长任务切一刀：前面这一段是"跟着手走"的，
       后面的属于"停手之后补细图"，两者的门槛不一样 */
    const 切 = 量.longtask.length;
    const 重算到帧 = 量.toDataURL - c0;
    await new Promise((r) => setTimeout(r, 900));
    return {
      逐次事件内同步ms: 逐次,
      事件内同步最大ms: Math.max(...逐次),
      连敲同步共ms: Math.round(同步共ms * 10) / 10,
      到下一帧ms: Math.round(到帧ms * 10) / 10,
      到帧前长任务: 量.longtask.slice(lt0, 切),
      重算到帧: 重算到帧,
      停手补图那一下: 量.longtask.slice(切)
    };
  };

  /* 连点一堆按钮 */
  window.__连点 = async (文字表, 轮数) => {
    const 找 = (t) => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === t);
    const 缺 = 文字表.filter((t) => !找(t));
    if (缺.length) return { 错: '找不到按钮：' + 缺.join(' / ') };
    const c0 = 量.toDataURL, lt0 = 量.longtask.length;
    const 逐次 = []; const t0 = performance.now();
    for (let i = 0; i < 轮数 * 文字表.length; i++) {
      const t = performance.now();
      找(文字表[i % 文字表.length]).click();
      逐次.push(Math.round((performance.now() - t) * 10) / 10);
    }
    const 同步共ms = performance.now() - t0;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const 到帧ms = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 800));
    return {
      每下点击同步ms: 逐次,
      事件内同步最大ms: Math.max(...逐次),
      连点同步共ms: Math.round(同步共ms * 10) / 10,
      到下一帧ms: Math.round(到帧ms * 10) / 10,
      重算几次图: 量.toDataURL - c0,
      长任务: 量.longtask.slice(lt0)
    };
  };

  /* 一眼看清现在按哪一档算：那一行说明就是两级预览的读数 */
  window.__哪一档 = () => {
    for (const p of document.querySelectorAll('.wb__main p.mini')) {
      const t = (p.textContent || '').replace(/\s+/g, ' ').trim();
      if (/拖动时预览按|预览缩到/.test(t)) return t;
    }
    return '（没找到那一行说明）';
  };

  /* 一次改动：量"这一下到下一帧"以及"停手补细图那一下"有多长 */
  window.__一次改动 = async (选择器, 值) => {    const el = document.querySelector(选择器);
    if (!el) return { 错: '找不到 ' + 选择器 };
    await new Promise((r) => setTimeout(r, 900));
    const lt0 = 量.longtask.length;
    const t0 = performance.now();
    window.__定值(el, 值);
    const 事件内同步ms = performance.now() - t0;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const 到下一帧ms = performance.now() - t0;
    const 切 = 量.longtask.length;
    await new Promise((r) => setTimeout(r, 900));
    return {
      事件内同步ms: Math.round(事件内同步ms * 10) / 10,
      到下一帧ms: Math.round(到下一帧ms * 10) / 10,
      到帧前长任务: 量.longtask.slice(lt0, 切),
      停手补图那一下ms: 量.longtask.slice(切)
    };
  };

  /* ---- 假后端：一张 1920×1080 的"参考图" + 一张 1024×32 的 CLUT ---- */
  const 做图 = (W, H, 画) => {
    const buf = new Uint8ClampedArray(W * H * 4);
    画(buf, W, H);
    let s = ''; const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
    return btoa(s);
  };
  const 小 = 做图(1024, 32, (b, W) => {
    for (let y = 0; y < 32; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      b[i] = ((x % 32) / 31) * 255; b[i + 1] = (y / 31) * 255; b[i + 2] = (Math.floor(x / 32) / 31) * 255; b[i + 3] = 255;
    }
  });
  const 大 = 做图(1920, 1080, (b, W, H) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4; const t = x / W;
      b[i] = Math.round(t * 255 * (0.7 + 0.3 * Math.sin(y * 0.11))) & 255;
      b[i + 1] = Math.round((1 - t) * 255 * (0.7 + 0.3 * Math.cos(x * 0.07))) & 255;
      b[i + 2] = (x ^ y) & 255; b[i + 3] = 255;
    }
  });
  window.__假 = { 要哪张: '大' };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd) => {
      if (cmd === 'read_rgba') return window.__假.要哪张 === '大'
        ? { width: 1920, height: 1080, rgba: 大 }
        : { width: 1024, height: 32, rgba: 小 };
      if (cmd === 'plugin:dialog|open') return 'E:\\\\假\\\\截图_1920x1080.png';
      if (cmd === 'plugin:dialog|save') return null;
      if (cmd === 'read_text_file') return { text: '' };
      if (cmd === 'probe_dir') return { exists: true, is_dir: false, entries: 0, names: [] };
      return null;
    },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window['_' + id] = cb; return id; },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } }
  };
})();
`;

try {
  new Function(桩);
} catch (e) {
  console.error('桩自己编不过（改桩的时候把话写坏了）：' + e.message);
  process.exit(2);
}

/* ---------------- CDP ---------------- */

let list;
try {
  list = await (await fetch(`${BASE}/json/list`)).json();
} catch (e) {
  console.error(`连不上 CDP（${BASE}）。先把无头 Chrome 起起来：\n` +
    `  chrome --headless=new --remote-debugging-port=${PORT} --user-data-dir=<临时目录> about:blank`);
  process.exit(2);
}
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

const 异常 = [];
const 页面事件 = [];
/** 我自己导航了几次 —— page.frameNavigated 分不清"我点的"和"别人存盘触发的重载"，
    所以记账：多出来的才算被打断 */
const 我导航 = { 次: 0 };
const 去 = async (url) => {
  我导航.次++;
  异常.length = 0;
  await rpc('Page.navigate', { url });
};
const 跑 = async (表达式, 等待 = true) => {
  const r = await rpc('Runtime.evaluate', { expression: 表达式, returnByValue: true, awaitPromise: 等待 });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).split('\n')[0]);
  return r.result.value;
};
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 判定 ---------------- */

let 条 = 0;
let 红 = 0;
function ok(名, 条件, 实测 = '') {
  条++;
  if (条件) console.log(`  ok   ${名}${实测 ? '   ' + 实测 : ''}`);
  else {
    红++;
    console.log(`  FAIL ${名}${实测 ? '   ' + 实测 : ''}`);
  }
}

await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Emulation.setDeviceMetricsOverride', { width: 1707, height: 1067, deviceScaleFactor: 1, mobile: false });
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: 桩 });
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) 页面事件.push('重载');
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    异常.push((d.exception?.description ?? d.text).split('\n')[0]);
  }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    异常.push('[' + m.params.type + '] ' + m.params.args.map((a) => a.description ?? a.value).join(' ').slice(0, 300));
  }
});

console.log(`\n② ikClut 回归守卫　站点 ${站点}　视口 1707×1067\n`);
await 去(`${站点}/tools/ikclut`);
for (let i = 0; i < 60; i++) {
  const 好了 = await 跑(`!!document.querySelector('input[aria-label="曝光"]')`, false).catch(() => false);
  if (好了) break;
  await 等(1000);
}
if (!(await 跑(`!!document.querySelector('input[aria-label="曝光"]')`, false).catch(() => false))) {
  console.error('60 秒这一页也没长出来 —— dev server 那边还在编，重跑一次');
  ws.close();
  process.exit(3);
}
await 等(2500);
异常.length = 0;

/* ---------------- 1. 开机：幕布要撤、页面要能用 ---------------- */

console.log('== 1. 开机 ==');
const 开机 = await 跑(
  `(() => {
  const w = document.querySelector('.bootwrap');
  return {
    幕布还在: !!document.querySelector('.intro'),
    主界面可见: w ? !w.classList.contains('bootwrap--hidden') : null,
    getComputedStyle_opacity: w ? getComputedStyle(w).opacity : '',
    控件数: document.querySelectorAll('button, input').length
  };
})()`,
  false
);
console.log('  ' + JSON.stringify(开机));
ok('启动幕布撤了（没撤就是整页卡在 opacity:0，用户看到的"点了没反应"）', 开机.幕布还在 === false);
ok('主界面不是 opacity:0', 开机.getComputedStyle_opacity !== '0', `opacity=${开机.getComputedStyle_opacity}`);
ok('控件都渲染出来了', 开机.控件数 > 200, `控件 ${开机.控件数}`);

/* ---------------- 2. 换成真尺寸参考图（量数字都在这一层才有意义） ---------------- */

console.log('\n== 2. 换成 1920×1080 的参考图 ==');
const 换图 = await 跑(
  `(async () => {
  const chk = [...document.querySelectorAll('label.chk')].find((l) => l.textContent.includes('用程序生成的测试图'))?.querySelector('input');
  chk.click();
  await new Promise((r) => setTimeout(r, 300));
  document.querySelector('button.slot__hit')?.click();
  await new Promise((r) => setTimeout(r, 2500));
  return {
    槽里显示: (document.querySelector('.slot__meta') || {}).textContent?.trim() ?? '（没填上）',
    报错: window.__量.报错
  };
})()`
);
console.log('  ' + JSON.stringify(换图));
ok('参考图填进去了', /1920×1080/.test(换图.槽里显示), 换图.槽里显示);

/* ---------------- 3. 敲数字 / 拖滑条：一帧多少钱 ---------------- */

console.log('\n== 3. 改参数：到下一帧多少 ms ==');
/* 门槛怎么定的：粗图那一档（512 长边）实测 31~53ms，细图那一档（1024 长边）实测 95~160ms。
   **两级预览要是没生效，量到的就是细图那一档的数** —— 所以门槛卡在 80ms（细图的下沿），
   两边都有余量，不会因为机器抖就误报。一帧预算 33ms 那条**够不着**：
   粗図那一档的 PNG 编码本身就要几十毫秒，这一轮没动它（见报告里的「没做到」）。 */
const 长任务门槛 = 80;
const 敲一下 = await 跑(`window.__一次改动('input[aria-label="曝光"]', '1.42')`);
console.log('  ' + JSON.stringify(敲一下));
ok('事件处理里没有同步跑重活（≤5ms）', 敲一下.事件内同步ms <= 5, `${敲一下.事件内同步ms}ms`);
ok('改一下到下一帧 ≤ 70ms', 敲一下.到下一帧ms <= 70, `${敲一下.到下一帧ms}ms`);
ok(`到下一帧之前的长任务都不超过 ${长任务门槛}ms（超了说明走了"停手"那一档全量）`,
  Math.max(0, ...(敲一下.到帧前长任务 ?? [0])) <= 长任务门槛,
  JSON.stringify(敲一下.到帧前长任务));
ok('停手后补细图那一下 ≤ 250ms',
  Math.max(0, ...(敲一下.停手补图那一下ms?.length ? 敲一下.停手补图那一下ms : [0])) <= 250,
  JSON.stringify(敲一下.停手补图那一下ms));

/* 两级预览要能一眼看出来：改完参数先报"按 512 算"，停手之后报"缩到 1024 算"。
   这是这个 bug 最直接的读数 —— 修之前那一行永远停在 1024 那一档。 */
const 两级 = await 跑(
  `(async () => {
  const el = document.querySelector('input[aria-label="色相旋转"]');
  await new Promise((r) => setTimeout(r, 900));
  window.__定值(el, 12);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const 刚改完 = window.__哪一档();
  await new Promise((r) => setTimeout(r, 800));
  return { 刚改完, 停手后: window.__哪一档() };
})()`
);
console.log('  ' + JSON.stringify(两级));
ok('刚改完走粗图那一档（这一行原来永远停在 1024）', /拖动时预览按 512px 算/.test(两级.刚改完), 两级.刚改完);
ok('停手 250ms 后补细图那一档', /预览缩到 1024px 算/.test(两级.停手后), 两级.停手后);

const 连敲 = await 跑(`window.__连敲('input[aria-label="饱和度"]', 12, 0.8, 0.03)`);
console.log('  ' + JSON.stringify(连敲));
ok('连敲 12 下，事件内同步最大 ≤ 5ms', 连敲.事件内同步最大ms <= 5, `${连敲.事件内同步最大ms}ms`);
ok('连敲 12 下，到下一帧 ≤ 90ms', 连敲.到下一帧ms <= 90, `${连敲.到下一帧ms}ms`);
ok(`连敲 12 下，到下一帧之前的长任务都不超过 ${长任务门槛}ms`,
  Math.max(0, ...(连敲.到帧前长任务 ?? [0])) <= 长任务门槛,
  JSON.stringify(连敲.到帧前长任务));
ok('连敲 12 下没被拆成"每敲一下算一遍"（重算出图 ≤ 8 次）', 连敲.重算到帧 <= 8, `重算 ${连敲.重算到帧} 次`);

const 拖 = await 跑(`window.__连敲('input[aria-label="对比度"][type=range]', 20, 0.5, 0.05)`);
console.log('  ' + JSON.stringify(拖));
ok('拖 20 帧，事件内同步最大 ≤ 5ms', 拖.事件内同步最大ms <= 5, `${拖.事件内同步最大ms}ms`);
ok('拖 20 帧，到下一帧 ≤ 90ms（拖动那一档走的是 512）', 拖.到下一帧ms <= 90, `${拖.到下一帧ms}ms`);
ok(`拖 20 帧，到下一帧之前的长任务都不超过 ${长任务门槛}ms`,
  Math.max(0, ...(拖.到帧前长任务 ?? [0])) <= 长任务门槛,
  JSON.stringify(拖.到帧前长任务));

/* ---------------- 4. 连点 ---------------- */

console.log('\n== 4. 连点 ==');
const 连点视图 = await 跑(`window.__连点(['调色前', '前后对比', '调色后'], 4)`);
console.log('  ' + JSON.stringify(连点视图));
ok('连点 12 下视图切换，事件内同步最大 ≤ 5ms', 连点视图.事件内同步最大ms <= 5, `${连点视图.事件内同步最大ms}ms`);
ok('连点 12 下，到下一帧 ≤ 80ms', 连点视图.到下一帧ms <= 80, `${连点视图.到下一帧ms}ms`);

const 连点标签 = await 跑(`window.__连点(['基本', '曲线', '色轮', 'HSL', 'LOG/HDR', '变形', 'LUT'], 3)`);
console.log('  ' + JSON.stringify({ 到下一帧ms: 连点标签.到下一帧ms, 重算: 连点标签.重算几次图, 错: 连点标签.错 }));
if (连点标签.错) ok('七个参数板标签都点得到', false, 连点标签.错);
else {
  ok('连点 21 下参数板标签，到下一帧 ≤ 80ms', 连点标签.到下一帧ms <= 80, `${连点标签.到下一帧ms}ms`);
  ok('切参数板不该重算出图（≤2 次）', 连点标签.重算几次图 <= 2, `重算 ${连点标签.重算几次图} 次`);
}

/* ---------------- 5. 同步缩放 / 同步平移：单向、不自转 ---------------- */

console.log('\n== 5. 同步缩放 / 同步平移 ==');

/* 先把比对模式恢复到"前后对比" —— 上一个分区把它点成了单视图，只有一个预览台 */
await 跑(
  `(async () => {
  [...document.querySelectorAll('.pick__b')].find((b) => b.textContent.trim() === '前后对比').click();
  await new Promise((r) => setTimeout(r, 500));
})()`
);

/** 读每个预览台当前显示的百分比（读数那一行里最后一个 <b> 才是百分比） */
const 读倍 = `[...document.querySelectorAll('.pv')].map((p) => {
  const bs = p.querySelectorAll('.pv__read b');
  return bs.length ? bs[bs.length - 1].textContent.trim() : '（没有读数）';
})`;
const 勾同步 = `(async () => {
  const 勾 = (t) => [...document.querySelectorAll('label.chk')].find((l) => l.textContent.includes(t))?.querySelector('input');
  勾('同步缩放').click(); 勾('同步平移').click();
  await new Promise((r) => setTimeout(r, 400));
})()`;

await 跑(勾同步);
const 同步前 = await 跑(读倍, false);
console.log('  开同步前两边的百分比：' + JSON.stringify(同步前));
ok('两个预览台都在（前后对比模式）', 同步前.length === 2, JSON.stringify(同步前));

/* 空闲 2 秒：不该有任何重算（同步 effect 自转会在这里露出来） */
const 空闲 = await 跑(
  `(async () => {
  const c0 = window.__量.toDataURL, lt0 = window.__量.longtask.length, f0 = window.__量.帧数;
  const 帧 = await window.__帧窗(2000);
  return { '2秒内帧数': window.__量.帧数 - f0, '2秒内重算': window.__量.toDataURL - c0,
    '2秒内长任务': window.__量.longtask.slice(lt0), 帧间隔: 帧 };
})()`
);
console.log('  ' + JSON.stringify(空闲));
ok('同步开着空闲 2 秒：一次都不重算（自转会在这里露出来）', 空闲['2秒内重算'] === 0, `重算 ${空闲['2秒内重算']} 次`);
ok('同步开着空闲 2 秒：没有长任务', 空闲['2秒内长任务'].length === 0, JSON.stringify(空闲['2秒内长任务']));

/* 点左边的「＋」→ 右边要跟着变 */
const 缩放同步 = await 跑(
  `(async () => {
  const 台 = document.querySelectorAll('.pv');
  const 加 = 台[0].querySelector('button[aria-label="放大"]');
  const 读数 = () => [...document.querySelectorAll('.pv')].map((p) => {
    const bs = p.querySelectorAll('.pv__read b');
    return bs.length ? bs[bs.length - 1].textContent.trim() : '（没有读数）';
  });
  const 前 = 读数();
  加.click(); 加.click();
  await new Promise((r) => setTimeout(r, 300));
  return { 前, 后: 读数() };
})()`
);
console.log('  ' + JSON.stringify(缩放同步));
ok('点左边放大，左边变了', 缩放同步.前[0] !== 缩放同步.后[0], `${缩放同步.前[0]} → ${缩放同步.后[0]}`);
ok('同步缩放开着：右边跟着变到同一个倍率',
  缩放同步.前[1] !== 缩放同步.后[1] && 缩放同步.后[0] === 缩放同步.后[1],
  `右 ${缩放同步.前[1]} → ${缩放同步.后[1]}`);

/* 关掉同步 → 点左边，右边不许动 */
const 不同步 = await 跑(
  `(async () => {
  const 勾 = [...document.querySelectorAll('label.chk')].find((l) => l.textContent.includes('同步缩放'))?.querySelector('input');
  const 读数 = () => [...document.querySelectorAll('.pv')].map((p) => {
    const bs = p.querySelectorAll('.pv__read b');
    return bs.length ? bs[bs.length - 1].textContent.trim() : '（没有读数）';
  });
  勾.click();
  await new Promise((r) => setTimeout(r, 300));
  const 加 = document.querySelectorAll('.pv')[0].querySelector('button[aria-label="放大"]');
  const 前 = 读数();
  加.click();
  await new Promise((r) => setTimeout(r, 300));
  const 后 = 读数();
  勾.click();  /* 勾回去，后面还要用 */
  await new Promise((r) => setTimeout(r, 200));
  return { 前, 后 };
})()`
);
console.log('  ' + JSON.stringify(不同步));
ok('同步缩放关着：只有左边动', 不同步.前[0] !== 不同步.后[0] && 不同步.前[1] === 不同步.后[1],
  `右 ${不同步.前[1]} → ${不同步.后[1]}`);

/* 滚左边的预览 → 右边跟着滚（要放大到能滚才有可滚的量） */
const 平移同步 = await 跑(
  `(async () => {
  const 台 = document.querySelectorAll('.pv');
  for (let i = 0; i < 3; i++) 台[0].querySelector('button[aria-label="放大"]').click();
  await new Promise((r) => setTimeout(r, 400));
  const 左 = 台[0].querySelector('.pv__box'), 右 = 台[1].querySelector('.pv__box');
  const 可滚 = 左.scrollWidth > 左.clientWidth;
  左.scrollLeft = 60; 左.scrollTop = 20;
  await new Promise((r) => setTimeout(r, 700));
  const r = { 可滚, 左: [左.scrollLeft, 左.scrollTop], 右: [右.scrollLeft, 右.scrollTop] };
  const c0 = window.__量.toDataURL;
  await new Promise((r2) => setTimeout(r2, 1200));
  return { ...r, 安静下来之后又重算: window.__量.toDataURL - c0 };
})()`
);
console.log('  ' + JSON.stringify(平移同步));
ok('预览放大之后真的能滚（不然这条没法验）', 平移同步.可滚 === true);
ok('滚左边：右边跟着滚到同一处', 平移同步.右[0] === 平移同步.左[0] && 平移同步.右[1] === 平移同步.左[1],
  `左 ${JSON.stringify(平移同步.左)} 右 ${JSON.stringify(平移同步.右)}`);
ok('同步平移不会自己跟自己推（安静下来后不重算）', 平移同步.安静下来之后又重算 === 0,
  `重算 ${平移同步.安静下来之后又重算} 次`);

/* ---------------- 6. 收口：没有异常、没有深度超限 ---------------- */

console.log('\n== 6. 收口 ==');
const 深度超限 = 异常.filter((s) => /effect_update_depth_exceeded|Maximum update depth/.test(s));
/* Chrome 自己在"ResizeObserver 回调里改了尺寸"时派的那条告警。它走的是 window 的 error 事件，
   所以会被记成"报错"，但它不是本应用抛的、也不进侧栏那条出错通道。
   （预览台放大到出滚动条时必然出现，⑦/④ 那几页一样有，不是这一轮引入的。） */
const 浏览器告警 = 异常.filter((s) => /ResizeObserver loop/.test(s));
const 真异常 = 异常.filter((s) => !/ResizeObserver loop/.test(s));
const 页面报错 = (await 跑(`window.__量.报错`, false)).filter((s) => !/ResizeObserver loop/.test(s));
const RO告警条数 = 异常.length - 真异常.length;
ok('全程没有 effect_update_depth_exceeded', 深度超限.length === 0, JSON.stringify(深度超限));
ok('全程没有本应用抛的未捕获异常 / 控制台错误', 真异常.length === 0, JSON.stringify(真异常.slice(0, 5)));
ok('页面自己记的错也是空的（ResizeObserver 那条浏览器告警不算）', 页面报错.length === 0, JSON.stringify(页面报错));
ok('量测期间页面没有被外部改动打断（重载次数 == 我自己导航的次数）',
  页面事件.length === 我导航.次, `重载 ${页面事件.length} 次 / 我导航 ${我导航.次} 次`);
if (RO告警条数) console.log(`  （另计：浏览器自己的 "ResizeObserver loop" 告警 ${RO告警条数} 条，不是本应用抛的）`);

/* ---------------- 7. 另外两个分区进得去、不报错 ---------------- */

console.log('\n== 7. 混合 / 导出分区 ==');
for (const [分区, 标记] of [
  ['blend', '.wb__main'],
  ['export', '.wb__main']
]) {
  异常.length = 0;
  await 去(`${站点}/tools/ikclut?panel=${分区}`);
  for (let i = 0; i < 40; i++) {
    const 好了 = await 跑(`!!document.querySelector('${标记}')`, false).catch(() => false);
    if (好了) break;
    await 等(1000);
  }
  /* 等幕布撤完（最短 1600ms + 交叉淡入 + 兜底），别拿固定睡眠赌 */
  for (let i = 0; i < 30; i++) {
    const 撤了 = await 跑(`!document.querySelector('.intro')`, false).catch(() => false);
    if (撤了) break;
    await 等(400);
  }
  await 等(600);
  const 状态 = await 跑(
    `(() => {
    const w = document.querySelector('.bootwrap');
    return {
      有内容: !!document.querySelector('.wb__main'),
      幕布还在: !!document.querySelector('.intro'),
      主界面可见: w ? !w.classList.contains('bootwrap--hidden') : null,
      控件数: document.querySelectorAll('button, input').length,
      正经错: window.__量.报错.filter((s) => !/ResizeObserver loop/.test(s))
    };
  })()`,
    false
  );
  const 本区异常 = 异常.filter((s) => !/ResizeObserver loop/.test(s));
  console.log(`  ${分区}: ` + JSON.stringify(状态));
  ok(`${分区} 分区进得去（不是空白）`, 状态.有内容 === true && 状态.控件数 > 10, `控件 ${状态.控件数}`);
  ok(`${分区} 分区幕布撤了`, 状态.幕布还在 === false && 状态.主界面可见 === true);
  ok(`${分区} 分区没有异常`, 本区异常.length === 0 && 状态.正经错.length === 0,
    JSON.stringify([...本区异常, ...状态.正经错].slice(0, 3)));
  ok(`${分区} 分区没有被外部改动打断`, 页面事件.length === 我导航.次,
    `重载 ${页面事件.length} 次 / 我导航 ${我导航.次} 次`);
}

console.log(`\n通过 ${条} 条，失败 ${红} 条`);
ws.close();
process.exit(红 ? 1 : 0);
