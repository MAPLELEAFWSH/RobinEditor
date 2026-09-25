/**
 * 探针：② ikClut 调色页「点了没反应、界面一直卡死」到底卡在哪。
 *
 * 量四样东西，全要数字：
 *   ① 主线程有没有被整段堵住 —— rAF 帧间隔 + PerformanceObserver 的 longtask；
 *   ② 一次真实 input / click 之后，从派发到**下一帧画完**多少 ms，其中事件处理里同步花了多少；
 *   ③ 整条链被重算了多少次 —— 拿 toDataURL（就是 `imageDataToUrl`）当计数器；
 *   ④ 有没有抛异常（`effect_update_depth_exceeded` 会走 `Runtime.exceptionThrown`）。
 *
 * 桩的是后端，不是界面：`__TAURI_INTERNALS__` 喂一份 1024×32 的假 CLUT 图，
 * 版式、控件、文案全是真的。
 *
 * 用法（先 pnpm dev 起在 1420，再无头 Chrome 开 9400）：
 *   node tmp\probe-②卡死.mjs [路由] [视口]
 */
const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const 路由 = process.argv[2] ?? '/tools/ikclut';
const 视口 = process.argv[3] ?? '1707x1067';

/* ---------------- 桩：假后端 + 计数器 + 页面侧量具 ---------------- */

const 桩 = `
(() => {
  const 量 = window.__量 = {
    toDataURL: 0, longtask: [], 最长帧间隔: 0, 帧数: 0, 报错: []
  };
  const 真toDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (...a) {
    量.toDataURL++;
    return 真toDataURL.apply(this, a);
  };
  window.addEventListener('error', (e) => 量.报错.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => 量.报错.push('rejection ' + String(e.reason)));
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) 量.longtask.push(Math.round(e.duration)); })
      .observe({ entryTypes: ['longtask'] });
  } catch (e) {}
  let 上次 = performance.now();
  const 跳 = (t) => {
    const g = t - 上次; 上次 = t; 量.帧数++;
    if (g > 量.最长帧间隔) 量.最长帧间隔 = Math.round(g);
    requestAnimationFrame(跳);
  };
  requestAnimationFrame(跳);

  /* 帧间隔采样：取一段时间窗里的最大值，比"全程最长"更能说明"现在卡不卡" */
  window.__帧窗 = (ms) => new Promise((res) => {
    const 样 = []; let 上次2 = performance.now(); const t0 = 上次2;
    const 跳2 = (t) => { 样.push(t - 上次2); 上次2 = t;
      if (t - t0 < ms) requestAnimationFrame(跳2); else res({ 帧数: 样.length, 最长: Math.round(Math.max(...样)), 中位: Math.round(样.sort((a,b)=>a-b)[Math.floor(样.length/2)]) }); };
    requestAnimationFrame(跳2);
  });

  const 定值 = (el, v) => {
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  window.__定值 = 定值;

  /* 一次真实 input：量事件处理里同步花的、到下一帧花的、以及重算了几次图 */
  window.__一次输入 = async (选择器, 值, 冷ms) => {
    const el = document.querySelector(选择器);
    if (!el) return { 错: '找不到 ' + 选择器 };
    el.scrollIntoView({ block: 'center' });
    if (冷ms) await new Promise((r) => setTimeout(r, 冷ms));
    const c0 = 量.toDataURL, lt0 = 量.longtask.length, t0 = performance.now();
    定值(el, 值);
    const 事件内同步ms = performance.now() - t0;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const 到下一帧ms = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 400));
    return {
      事件内同步ms: Math.round(事件内同步ms * 10) / 10,
      到下一帧ms: Math.round(到下一帧ms * 10) / 10,
      含停手补图ms: Math.round((performance.now() - t0) * 10) / 10,
      重算几次图: 量.toDataURL - c0,
      长任务: 量.longtask.slice(lt0)
    };
  };

  /* 连敲 N 下（不等中间帧，模拟"手快"）*/
  window.__连敲 = async (选择器, 数, 起点, 步) => {
    const el = document.querySelector(选择器);
    if (!el) return { 错: '找不到 ' + 选择器 };
    const c0 = 量.toDataURL, lt0 = 量.longtask.length;
    const 逐次 = [];
    const t0 = performance.now();
    for (let i = 0; i < 数; i++) {
      const t = performance.now();
      定值(el, 起点 + i * 步);
      逐次.push(Math.round((performance.now() - t) * 10) / 10);
    }
    const 同步共ms = performance.now() - t0;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const 到帧ms = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 800));
    return {
      逐次事件内同步ms: 逐次,
      连敲同步共ms: Math.round(同步共ms * 10) / 10,
      到下一帧ms: Math.round(到帧ms * 10) / 10,
      收尾共ms: Math.round((performance.now() - t0) * 10) / 10,
      重算几次图: 量.toDataURL - c0,
      长任务: 量.longtask.slice(lt0)
    };
  };

  /* 连点若干按钮 */
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
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const 到帧ms = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 800));
    return {
      每下点击同步ms: 逐次,
      到下一帧ms: Math.round(到帧ms * 10) / 10,
      收尾共ms: Math.round((performance.now() - t0) * 10) / 10,
      重算几次图: 量.toDataURL - c0,
      长任务: 量.longtask.slice(lt0)
    };
  };

  /* 拖动滑条：range 的 input 是逐帧来的，这里连派 20 下 */
  window.__拖滑条 = async (选择器, 数) => {
    const el = document.querySelector(选择器);
    if (!el) return { 错: '找不到 ' + 选择器 };
    const min = +el.min, max = +el.max;
    const c0 = 量.toDataURL, lt0 = 量.longtask.length;
    const t0 = performance.now(); const 逐次 = [];
    for (let i = 0; i < 数; i++) {
      const t = performance.now();
      定值(el, min + ((max - min) * (i + 1)) / (数 + 1));
      逐次.push(Math.round((performance.now() - t) * 10) / 10);
    }
    const 同步共ms = performance.now() - t0;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const 到帧ms = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 800));
    return {
      逐次事件内同步ms: 逐次,
      拖完同步共ms: Math.round(同步共ms * 10) / 10,
      到下一帧ms: Math.round(到帧ms * 10) / 10,
      收尾共ms: Math.round((performance.now() - t0) * 10) / 10,
      重算几次图: 量.toDataURL - c0,
      长任务: 量.longtask.slice(lt0)
    };
  };

  /* ---- 假后端 ---- */
  const W = 1024, H = 32;
  const buf = new Uint8ClampedArray(W * H * 4);
  for (let b = 0; b < 32; b++)
    for (let g = 0; g < 32; g++)
      for (let r = 0; r < 32; r++) {
        const i = ((g * 1024) + (b * 32 + r)) * 4;
        buf[i] = Math.round((r / 31) * 255);
        buf[i + 1] = Math.round((g / 31) * 255);
        buf[i + 2] = Math.round((b / 31) * 255);
        buf[i + 3] = 255;
      }
  let b64 = '';
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) b64 += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
  b64 = btoa(b64);

  window.__假 = { 调用: [] };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      window.__假.调用.push(cmd);
      if (cmd === 'read_rgba') return { width: W, height: H, rgba: b64 };
      if (cmd === 'plugin:dialog|open') return 'E:\\\\假\\\\clut_vivid.png';
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

/* ---------------- CDP ---------------- */

const list = await (await fetch(`${BASE}/json/list`)).json();
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

const 日志 = [];
/* 页面被重载 / 渲染进程崩掉，是"卡死"的两种不同成因，得分开记 */
const 事件 = [];
const 跑 = async (表达式, 等待 = false) => {
  const r = await rpc('Runtime.evaluate', {
    expression:表达式,
    returnByValue: true,
    awaitPromise: 等待
  });
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
const 当前路由 = () => 已到路由;
let 已到路由 = `/tools/ikclut`;
const 量 = async (标签, 表达式, 等待 = true, 可重试 = 1) => {
  for (let 次 = 0; ; 次++) {
    try {
      const v = await 跑(表达式, 等待);
      console.log(`\n---- ${标签} ----\n${JSON.stringify(v, null, 1)}`);
      return v;
    } catch (e) {
      const 消息 = e.message;
      const 像断开 = /navigated or closed|Cannot find context|Session with given id not found/i.test(消息);
      console.log(`\n---- ${标签} ----`);
      console.log(`  ！！量不成：${消息}`);
      console.log(`  这一段的页面事件：${事件.length ? 事件.join(' | ') : '（没有）'}`);
      console.log(`  已收到的异常：${日志.length ? 日志.join(' | ') : '（没有）'}`);
      if (!像断开 || 次 >= 可重试) return { 失败: 消息 };
      console.log('  页面被换掉了，重挂一次再来（不是代码抛的）');
      日志.push(`[注意] 「${标签}」这一段的量测被 ${事件.slice(-1)[0] ?? '一次页面变动'} 打断，已重试`);
      事件.length = 0;
      await 等(1500);
      await rpc('Page.navigate', { url: `http://127.0.0.1:1420${当前路由()}` });
      await 等(5000);
    }
  }
};

await rpc('Page.enable');
await rpc('Runtime.enable');
try {
  await rpc('Inspector.enable');
} catch (e) {
  /* 有的 Chrome 不给 Inspector.enable */
}
await rpc('Emulation.setDeviceMetricsOverride', {
  width: Number(视口.split('x')[0]),
  height: Number(视口.split('x')[1]),
  deviceScaleFactor: 1,
  mobile: false
});
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: 桩 });
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId)
    事件.push(`重载 @${Date.now() % 100000}`);
  if (m.method === 'Inspector.targetCrashed') 事件.push(`渲染进程崩了 @${Date.now() % 100000}`);
  if (m.method === 'Runtime.executionContextDestroyed') 事件.push(`执行上下文销毁 @${Date.now() % 100000}`);
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    const f = (d.stackTrace?.callFrames ?? [])
      .slice(0, 5)
      .map((c) => `${c.url.split('/').pop()}:${c.lineNumber + 1}`)
      .join(' < ');
    日志.push(`[异常] ${(d.exception?.description ?? d.text).split('\n').slice(0, 4).join(' | ')}  @ ${f}`);
  }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    日志.push(`[${m.params.type}] ${m.params.args.map((a) => a.description ?? a.value).join(' ').slice(0, 600)}`);
  }
});

const 去 = async (r) => {
  已到路由 = r;
  事件.length = 0;
  await rpc('Page.navigate', { url: `http://127.0.0.1:1420${r}` });
};

console.log('==== 视口', 视口, '路由', 路由, '====');
await 去(路由);
await 等(7000);

await 量(
  '开机 7 秒后',
  `(() => {
  const w = document.querySelector('.bootwrap');
  return {
    幕布: !!document.querySelector('.intro') ? '还在(没撤)' : '已撤',
    主界面可见: w ? !w.classList.contains('bootwrap--hidden') : null,
    控件数: document.querySelectorAll('button, input').length,
    帧数: window.__量.帧数,
    全程最长帧间隔ms: window.__量.最长帧间隔,
    长任务: window.__量.longtask,
    开机重算次数: window.__量.toDataURL,
    报错: window.__量.报错
  };
})()`,
  false
);

await 量('空闲 2 秒的帧窗（看有没有东西在空转）', `window.__帧窗(2000)`);

await 量('敲一下「曝光」NumBox', `window.__一次输入('input[aria-label="曝光"]', '1.5', 900)`);
await 量('连敲 8 下「曝光」', `window.__连敲('input[aria-label="曝光"]', 8, 1.0, 0.08)`);
await 量('连敲 8 下「对比度」', `window.__连敲('input[aria-label="对比度"]', 8, 1.0, 0.08)`);
await 量('连敲 8 下「色相」', `window.__连敲('input[aria-label="色相旋转"]', 8, 0, 10)`);
await 量('拖「曝光」滑条 20 下', `window.__拖滑条('input[aria-label="曝光"][type=range]', 20)`);
await 量('切换「调色前/前后对比/调色后」10 下', `window.__连点(['调色前','前后对比','调色后'], 4)`);

await 量(
  '开「同步缩放」+「同步平移」再空闲 2 秒',
  `(async () => {
  const 勾 = (t) => [...document.querySelectorAll('label.chk')].find((l) => l.textContent.includes(t))?.querySelector('input');
  勾('同步缩放').click(); 勾('同步平移').click();
  await new Promise((r) => setTimeout(r, 300));
  const c0 = window.__量.toDataURL, lt0 = window.__量.longtask.length, f0 = window.__量.帧数;
  const 帧 = await window.__帧窗(2000);
  return {
    '2秒内帧数': window.__量.帧数 - f0,
    '2秒内重算次数': window.__量.toDataURL - c0,
    '2秒内长任务': window.__量.longtask.slice(lt0),
    帧间隔: 帧,
    报错: window.__量.报错
  };
})()`
);

await 量(
  '同步开着时敲数字',
  `(async () => {
  const r = await window.__连敲('input[aria-label="曝光"]', 6, 1.0, 0.1);
  await new Promise((r2) => setTimeout(r2, 1200));
  return { ...r, 之后又重算: window.__量.toDataURL, 报错: window.__量.报错 };
})()`
);

await 量(
  '全页每个 NumBox 各敲一下',
  `(async () => {
  const 框 = [...document.querySelectorAll('input[type=number]')];
  const c0 = window.__量.toDataURL, lt0 = window.__量.longtask.length;
  const t0 = performance.now();
  let 最慢 = 0, 谁 = '';
  for (const el of 框) {
    const v = Number(el.value) || 0;
    const t = performance.now();
    window.__定值(el, v + 0.01);
    const 花 = performance.now() - t;
    if (花 > 最慢) { 最慢 = 花; 谁 = el.getAttribute('aria-label') || ''; }
  }
  await new Promise((r) => setTimeout(r, 1200));
  return { NumBox个数: 框.length, 扫完共ms: Math.round(performance.now() - t0),
    单次最慢ms: Math.round(最慢 * 10) / 10, 最慢那个: 谁,
    重算次数: window.__量.toDataURL - c0, 长任务: window.__量.longtask.slice(lt0),
    报错: window.__量.报错 };
})()`
);

await 量(
  '七个参数板标签各点两遍 + 处理链加节点',
  `(async () => {
  const c0 = window.__量.toDataURL, lt0 = window.__量.longtask.length;
  const t0 = performance.now(); const 逐次 = [];
  for (const t of ['基本','曲线','色轮','HSL','LOG/HDR','变形','LUT']) {
    const b = [...document.querySelectorAll('.tabs__b')].find((x) => x.textContent.trim() === t);
    const t1 = performance.now(); b?.click(); 逐次.push(t + '=' + (Math.round((performance.now() - t1) * 10) / 10));
  }
  for (const b of [...document.querySelectorAll('button')]) {
    if (/^＋/.test(b.textContent.trim()) && !b.disabled) { const t1 = performance.now(); b.click(); 逐次.push(b.textContent.trim() + '=' + (Math.round((performance.now() - t1) * 10) / 10)); }
  }
  await new Promise((r) => setTimeout(r, 1200));
  return { 逐次ms: 逐次, 共ms: Math.round(performance.now() - t0),
    重算次数: window.__量.toDataURL - c0, 长任务: window.__量.longtask.slice(lt0),
    链上节点: [...document.querySelectorAll('.chain li b')].map((b) => b.textContent), 报错: window.__量.报错 };
})()`
);

console.log('\n==== 切到「混合」分区 ====');
await 去('/tools/ikclut?panel=blend');
await 等(6000);
await 量(
  '混合区：载入两张假 CLUT 再拖混比',
  `(async () => {
  const 槽 = [...document.querySelectorAll('button.pick')];
  for (const s of 槽.slice(0, 2)) { s.click(); await new Promise((r) => setTimeout(r, 700)); }
  const c0 = window.__量.toDataURL, lt0 = window.__量.longtask.length;
  const r = await window.__拖滑条('input[aria-label="X 向混合"][type=range]', 15);
  await new Promise((r2) => setTimeout(r2, 800));
  return { 槽数: 槽.length, ...r, 报错: window.__量.报错 };
})()`
);

console.log('\n==== 切到「导出」分区（.txt 那块会渲染 paramReport）====');
await 去('/tools/ikclut?panel=export');
await 等(6000);
await 量(
  '导出区：切回来 + 敲数字',
  `(async () => {
  const r = await window.__连敲('input[aria-label="曝光"]', 6, 1.0, 0.1);
  return r;
})()`
);
await 量(
  '导出区：空闲 2 秒帧窗',
  `window.__帧窗(2000)`
);

console.log('\n==== 控制台 / 异常全量 ====');
console.log(日志.length ? 日志.join('\n') : '（没有 error / warning，也没有未捕获异常）');
ws.close();
