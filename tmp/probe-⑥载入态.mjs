/**
 * 一次性探针：⑥ 在**载入了工程**的样子下，量「一个动作几处入口」并点一遍「重置工程」。
 *
 * 为什么要桩后端：无头 Chrome 里 `isTauri()` 是 false，而工程迁移整条链
 * （扫 / 找根 / 列路径）全在 Rust 那边，页面上「② 工程里有什么」这一块根本不出来，
 * 体检脚本量到的永远是"没载入"那一层。这里把 `window.__TAURI_INTERNALS__.invoke`
 * 桩进去喂一份假工程，界面才进到有数据的那一层。
 *
 * **桩的是数据，不是界面** —— 版式、按钮、文案全是真的。
 *
 * 用法（先 pnpm dev + 无头 Chrome 9400）：
 *   $env:CDP_PORT='9400'; node tmp\probe-⑥载入态.mjs
 */
const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const 路由 = process.argv[2] ?? '/tools/migrate?panel=repair';

/* ---------------- 假工程：14 个模型（9 个在死根上）+ 6 个附件（全在死根上） ---------------- */

const 桩 = `
(() => {
  const P = 'E:\\\\C test\\\\⑥验收\\\\假工程';
  const PMM = P + '\\\\香港观塘 夜间 2.1.pmm';
  const EMM = P + '\\\\香港观塘 夜间 2.1.emm';
  const 死根 = 'D:\\\\MMD一键渲染工程项目';
  const 好根 = 'E:\\\\C test\\\\达到';
  const 对象 = [], 命中 = [], 在盘 = [], 目标 = [];
  for (let i = 0; i < 14; i++) {
    const 死 = i < 9;
    const p = (死 ? 死根 : 好根) + '\\\\UserFile\\\\ray-mmd-1.5.2\\\\Lighting\\\\光' + i + '.pmx';
    对象.push({ key: 'model' + i, kind: 'model', index: i, path: p });
    在盘.push(!死);
    目标.push('UserFile\\\\ray-mmd-1.5.2\\\\Lighting\\\\光' + i + '.pmx');
    命中.push({ key: 'model' + i, offset: 1000 + i * 40, 全部: [1000 + i * 40], path: p, 怎么找到的: '完整路径', 名称: '光' + i + '.pmx' });
  }
  for (let i = 0; i < 6; i++) {
    const p = 死根 + '\\\\UserFile\\\\附件\\\\附件' + i + '.x';
    对象.push({ key: 'acc' + i, kind: 'accessory', index: i, path: p });
    在盘.push(false);
    目标.push('UserFile\\\\附件\\\\附件' + i + '.x');
    命中.push({ key: 'acc' + i, offset: 2000 + i * 40, 全部: [2000 + i * 40], path: p, 怎么找到的: '完整路径', 名称: '附件' + i + '.x' });
  }
  const 扫描 = {
    pmm: PMM, emm: EMM, objects: 对象,
    effects: [{ key: 'e0', material: 0, field: 'FogMap', path: 死根 + '\\\\UserFile\\\\ikBokeh_v019\\\\ikBokeh.fx' }],
    在盘上: 在盘, 目标, pmm_hits: 命中,
    问题: ['缺文件：15 条对象不在盘上'],
    textures: [{ pmx: '光0.pmx', index: 0, path: 'toon.png', exists: true }],
    模型目录: [
      { 目录: 死根 + '\\\\UserFile\\\\ray-mmd-1.5.2\\\\Lighting', 条数: 9, 有: 0 },
      { 目录: 好根 + '\\\\UserFile\\\\ray-mmd-1.5.2\\\\Lighting', 条数: 5, 有: 5 }
    ],
    附件目录: [{ 目录: 死根 + '\\\\UserFile\\\\附件', 条数: 6, 有: 0 }],
    能摘: false, 摘拦: ''
  };
  const 根 = [
    { 根: 死根, 条数: 15, 例: [], 建议: '', 建议命中: 0, 在盘条数: 0 },
    { 根: 好根, 条数: 5, 例: [], 建议: '', 建议命中: 5, 在盘条数: 5 }
  ];
  const 基础表 = 对象.map((o, i) => ({
    段: i < 14 ? 'Object' : 'Accessory',
    键: o.key, 原路径: o.path, 在盘上: 在盘[i],
    根: (i < 9 || i >= 14) ? 死根 : 好根,
    目标: 在盘[i] ? o.path : '',
    状态: 在盘[i] ? '原位在' : '需要指定'
  }));
  const 算表 = (根表, 逐条) => 基础表.map((r) => {
    /* 打包区用：假装这台机器上路径都指对了（真实工程健康时就是这一层），
       不然打包区那条主按钮永远是禁用的、量不到它的确认句 */
    if (window.__假.假装都落定) return Object.assign({}, r, { 目标: r.原路径, 状态: '原位在' });
    const 条 = (逐条 ?? []).find((x) => x[0] === r.原路径);
    if (条) return Object.assign({}, r, { 目标: 条[1], 状态: '已逐条指定' });
    for (const [旧, 新] of (根表 ?? [])) {
      if (r.原路径.startsWith(旧)) return Object.assign({}, r, { 目标: 新 + r.原路径.slice(旧.length), 状态: '已按根找到' });
    }
    return r;
  });
  window.__假 = { 缺失: false, 假装都落定: false, 调用: [] };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      window.__假.调用.push(cmd);
      if (cmd === '扫') return 扫描;
      if (cmd === '找根') return 根;
      if (cmd === '列路径') return 算表(args.根表, args.逐条);
      if (cmd === '待撤销') return null;
      if (cmd === 'probe_dir') return { exists: !window.__假.缺失, is_dir: false, entries: 0, names: [] };
      if (cmd === 'plugin:dialog|open') {
        const o = (args && args.options) || {};
        if (o.directory) return 'E:\\\\C test\\\\⑥验收\\\\假工程\\\\打包输出';
        const ext = ((o.filters && o.filters[0] && o.filters[0].extensions) || [])[0];
        return ext === 'emm' ? EMM : PMM;
      }
      console.log('[假后端] 没桩的命令:', cmd);
      return null;
    },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window['_' + id] = cb; return id; },
    /* 壳里的拖拽接线（drag-dom）会问当前窗口/当前 webview 是谁，不给就整页抛错 */
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { label: 'main', windowLabel: 'main' }
    }
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

const 跑 = async (表达式) => {
  const r = await rpc('Runtime.evaluate', { expression: 表达式, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));

await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: 桩 });
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') {
    console.log('[页面异常]', (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split('\n')[0]);
  }
});
await rpc('Page.navigate', { url: `http://127.0.0.1:1420${路由}` });
await 等(3000);

/* 点第一个槽位 → 假后端给一份 .pmm → 同名 .emm 自动接上 → 自己扫一遍 */
const 载入 = await 跑(`(async () => {
  const 槽 = [...document.querySelectorAll('button.pick')];
  if (!槽.length) return '没有槽位按钮';
  槽[0].click();
  await new Promise((r) => setTimeout(r, 1200));
  return document.querySelectorAll('details.more').length ? '有更多工具' : '还没有更多工具';
})()`);
console.log('载入：', 载入);
await 等(800);

/* 页面上的按钮清点：可见的（不在收起的 details 里）单独列 */
const 量 = `
(() => {
  const 藏了 = (e) => {
    let p = e;
    while (p && p !== document.documentElement) {
      const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return true;
      if (p.tagName === 'DETAILS' && !p.open) return true;
      p = p.parentElement;
    }
    const r = e.getBoundingClientRect();
    return r.width <= 0 || r.height <= 0;
  };
  const 按钮 = [...document.querySelectorAll('button')].map((b) => ({
    文字: (b.textContent || '').replace(/\\s+/g, ' ').trim(),
    可见: !藏了(b),
    在抽屉: !!b.closest('.wb__side'),
    在主区: !!b.closest('.wb__main'),
    在更多工具: !!b.closest('details.more'),
    主按钮: b.classList.contains('btn--primary')
  })).filter((x) => x.文字);
  const 数 = (re) => 按钮.filter((x) => re.test(x.文字));
  const 行 = (re) => 数(re).map((x) => x.文字 + (x.可见 ? '' : '（收起中）')).join(' | ') || '（没有）';
  return {
    载入: !!document.querySelector('.wb__main .tbl, .wb__main .card'),
    一二三卡的按钮: 数(/试算|原地修好|另存并写盘|保存（|打包到输出目录/).length,
    可见的试算: 数(/^试算/).filter((x) => x.可见).map((x) => x.文字),
    全部试算: 行(/^试算/),
    全部写盘: 行(/原地修好|另存并写盘|保存（|打包到输出目录/),
    主按钮: 按钮.filter((x) => x.主按钮).map((x) => x.文字 + '｜可见=' + x.可见 + '｜在主区=' + x.在主区 + '｜在抽屉=' + x.在抽屉),
    底栏: [...document.querySelectorAll('.foot button')].map((b) => (b.textContent || '').replace(/\\s+/g, ' ').trim()),
    抽屉: [...document.querySelectorAll('.wb__side button')].map((b) => (b.textContent || '').replace(/\\s+/g, ' ').trim()),
    更多工具标题: (document.querySelector('details.more > summary') || {}).textContent?.replace(/\\s+/g, ' ').trim() ?? '（没有）',
    重置按钮: [...document.querySelectorAll('details.more button')].map((b) => (b.textContent || '').replace(/\\s+/g, ' ').trim()).filter((t) => /重置/.test(t)),
    死根行: document.querySelectorAll('input[aria-label^="给"]').length,
    落点: [...document.querySelectorAll('.wb__main p.mini')]
      .map((p) => (p.textContent || '').replace(/\\s+/g, ' ').trim())
      .find((t) => /改动落在|就打在上面|还没选输出目录/.test(t)) ?? '（没有落点句）',
    没落定: [...document.querySelectorAll('.wb__main .tag')]
      .map((t) => (t.textContent || '').trim())
      .find((t) => /没落定|全部落定/.test(t)) ?? '（没有）',
    底栏提示: (document.querySelector('.foot__msg') || {}).textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  };
})()
`;
console.log('\n---- 载入态：入口清点 ----');
console.log(JSON.stringify(await 跑(量), null, 1));

/* ---- 重置：先造出"界面被改过"的样子，再复位 ---- */
const 造状态 = await 跑(`(async () => {
  const 定值 = (el, v) => {
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const 根框 = document.querySelector('input[aria-label^="给"]');
  定值(根框, 'E:\\\\C test\\\\达到\\\\UserFile');
  document.querySelector('.wb__main .row button.btn--ghost')?.click();  /* ③ 的「选目录」 */
  await new Promise((r) => setTimeout(r, 400));
  const 重算 = [...document.querySelectorAll('.wb__main button')].find((b) => /重算/.test(b.textContent || ''));
  重算?.click();
  await new Promise((r) => setTimeout(r, 600));
  return {
    新根框: 根框.value,
    输出行: (document.querySelector('.wb__main .row__v') || {}).textContent?.trim(),
    没落定: [...document.querySelectorAll('.wb__main .tag')]
      .map((t) => (t.textContent || '').trim())
      .find((t) => /没落定|全部落定/.test(t)) ?? '（没有）',
    主按钮: [...document.querySelectorAll('button.btn--primary')]
      .map((b) => (b.textContent || '').trim() + '｜禁用=' + b.disabled).join(' , ')
  };
})()`);
console.log('\n---- 重置前：先把界面改脏 ----');
console.log(JSON.stringify(造状态, null, 1));

const 点重置 = `
(async () => {
  const 更多 = document.querySelector('details.more');
  if (更多) 更多.open = true;
  await new Promise((r) => setTimeout(r, 200));
  const 找 = (re) => [...document.querySelectorAll('details.more button')].find((b) => re.test(b.textContent || ''));
  const 一 = 找(/重置工程/);
  if (!一 || 一.disabled) return { 错: '重置按钮没找到或被禁用', 禁用: !!一?.disabled };
  window.__假.调用 = [];
  一.click();
  await new Promise((r) => setTimeout(r, 200));
  const 确认 = [...document.querySelectorAll('details.more button')].map((b) => (b.textContent || '').trim());
  const 二 = 找(/确定重置/);
  if (!二) return { 错: '点了没有二次确认', 确认 };
  二.click();
  await new Promise((r) => setTimeout(r, 1500));
  const 根框 = document.querySelector('input[aria-label^="给"]');
  return {
    二次确认时看到的: 确认.filter((t) => /确定重置|取消|复位/.test(t)),
    重置这一下问过后端的命令: [...new Set(window.__假.调用)],
    复位后新根框: 根框 ? 根框.value : '（没有死根行）',
    复位后输出行: (document.querySelector('.wb__main .row__v') || {}).textContent?.trim(),
    复位后没落定: [...document.querySelectorAll('.wb__main .tag')]
      .map((t) => (t.textContent || '').trim())
      .find((t) => /没落定|全部落定/.test(t)) ?? '（没有）',
    复位后底栏: (document.querySelector('.foot__msg') || {}).textContent?.replace(/\s+/g, ' ').trim() ?? '',
    复位后还有表: !!document.querySelector('.tblwrap'),
    复位后主按钮: [...document.querySelectorAll('button.btn--primary')]
      .map((b) => (b.textContent || '').trim() + '｜禁用=' + b.disabled).join(' , ')
  };
})()
`;
console.log('\n---- 重置：二次确认 + 复位结果 ----');
console.log(JSON.stringify(await 跑(点重置), null, 1));

/* ---- 写入动作的内联确认（写完要说清"会动哪些文件"） ---- */
const 写入确认 = await 跑(`(async () => {
  const 定值 = (el, v) => {
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const 根框 = document.querySelector('input[aria-label^="给"]');
  if (根框) 定值(根框, 'E:\\\\C test\\\\达到\\\\UserFile');
  const 重算 = [...document.querySelectorAll('.wb__main button')].find((b) => /重算/.test(b.textContent || ''));
  重算?.click();
  await new Promise((r) => setTimeout(r, 700));
  const 主 = [...document.querySelectorAll('.foot button.btn--primary')][0];
  const 前 = { 字样: 主 ? 主.textContent.trim() : '（没有主按钮）', 禁用: 主 ? 主.disabled : null };
  主?.click();
  await new Promise((r) => setTimeout(r, 300));
  const 确认时的底栏句 = (document.querySelector('.foot__t') || {}).textContent?.replace(/\\s+/g, ' ').trim() ?? '';
  const 按钮 = [...document.querySelectorAll('.foot button')].map((b) => b.textContent.trim() + (b.disabled ? '(禁用)' : ''));
  const 主按钮数 = document.querySelectorAll('.foot button.btn--primary').length;
  const 取消 = [...document.querySelectorAll('.foot button')].find((b) => /^取消$/.test(b.textContent.trim()));
  取消?.click();
  await new Promise((r) => setTimeout(r, 300));
  return {
    点之前: 前,
    确认时底栏那句: 确认时的底栏句,
    确认时底栏按钮: 按钮,
    确认时主按钮数: 主按钮数,
    取消后主按钮: ([...document.querySelectorAll('.foot button.btn--primary')][0] || {}).textContent?.trim() ?? '（没有）',
    取消后底栏句: (document.querySelector('.foot__t') || {}).textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  };
})()`);
console.log('\n---- 写入动作的内联确认（底栏主按钮） ----');
console.log(JSON.stringify(写入确认, null, 1));

/* ---- 源文件被挪走：重置必须明确报错，不许静默空表 ---- */
const 丢文件 = await 跑(`(async () => {
  window.__假.缺失 = true;
  const 更多 = document.querySelector('details.more');
  if (更多) 更多.open = true;
  const 找 = (re) => [...document.querySelectorAll('details.more button')].find((b) => re.test(b.textContent || ''));
  找(/重置工程/)?.click();
  await new Promise((r) => setTimeout(r, 200));
  找(/确定重置/)?.click();
  await new Promise((r) => setTimeout(r, 900));
  return {
    底栏: (document.querySelector('.foot__msg') || {}).textContent?.replace(/\\s+/g, ' ').trim() ?? '',
    还留着表吗: !!document.querySelector('.tblwrap')
  };
})()`);
console.log('\n---- 源文件不在了再点重置 ----');
console.log(JSON.stringify(丢文件, null, 1));

/* ---- 打包迁移区（情形 C）也看一遍：可见的按钮与更多工具标题 ---- */
await rpc('Page.navigate', { url: 'http://127.0.0.1:1420/tools/migrate?panel=pack' });
await 等(3000);
await 跑(`(async () => {
  window.__假.假装都落定 = true;
  document.querySelector('button.pick')?.click();
  await new Promise((r) => setTimeout(r, 1400));
})()`);
const 打包区 = await 跑(`(async () => {
  const 选目录 = [...document.querySelectorAll('.wb__main .row button')].find((b) => /选目录/.test(b.textContent || ''));
  选目录?.click();
  await new Promise((r) => setTimeout(r, 700));
  const 藏了 = (e) => {
    let p = e;
    while (p && p !== document.documentElement) {
      const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return true;
      if (p.tagName === 'DETAILS' && !p.open) return true;
      p = p.parentElement;
    }
    const r = e.getBoundingClientRect();
    return r.width <= 0 || r.height <= 0;
  };
  const 按钮 = [...document.querySelectorAll('button')]
    .map((b) => ({ 文字: (b.textContent || '').replace(/\\s+/g, ' ').trim(), 可见: !藏了(b), 主按钮: b.classList.contains('btn--primary') }))
    .filter((x) => x.文字);
  const 主 = document.querySelector('.foot button.btn--primary');
  const 前 = 主 ? 主.textContent.trim() : '（没有主按钮）';
  主?.click();
  await new Promise((r) => setTimeout(r, 300));
  const 确认句 = (document.querySelector('.foot__t') || {}).textContent?.replace(/\\s+/g, ' ').trim() ?? '';
  [...document.querySelectorAll('.foot button')].find((b) => /^取消$/.test(b.textContent.trim()))?.click();
  return {
    可见的试算: 按钮.filter((x) => /^试算/.test(x.文字) && x.可见).map((x) => x.文字),
    可见的写盘类: 按钮.filter((x) => /打包到输出目录|原地修好|另存并写盘|保存（|确定打包/.test(x.文字) && x.可见).map((x) => x.文字),
    主按钮: 按钮.filter((x) => x.主按钮).map((x) => x.文字 + '｜可见=' + x.可见),
    点主按钮之前: 前,
    确认时底栏那句: 确认句,
    更多工具标题: (document.querySelector('details.more > summary') || {}).textContent?.replace(/\\s+/g, ' ').trim() ?? '（没有）',
    抽屉里有几个控件: [...document.querySelectorAll('.wb__side .grp')].length,
    抽屉文字: (document.querySelector('.wb__side') || {}).textContent?.replace(/\\s+/g, ' ').trim() ?? '',
    落点: [...document.querySelectorAll('.wb__main p.mini')]
      .map((p) => (p.textContent || '').replace(/\\s+/g, ' ').trim())
      .find((t) => /就打在上面|改动落在|还没选输出目录/.test(t)) ?? '（没有落点句）'
  };
})()`);
console.log('\n---- 打包迁移区（情形 C） ----');
console.log(JSON.stringify(打包区, null, 1));

ws.close();
