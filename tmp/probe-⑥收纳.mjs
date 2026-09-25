/**
 * 一次性探针：⑥ 的**收纳**（规范 §十八）—— 区块卡的默认开合、标题读数、按页按区块记忆。
 *
 * 为什么还要桩后端：无头 Chrome 里 `isTauri()` 是 false，工程迁移整条链在 Rust 那边，
 * 页面上「② 工程里有什么」以后整块不出来，量到的永远是"没载入"那一层。
 * 这里把 `window.__TAURI_INTERNALS__.invoke` 桩进去喂一份假工程（含一个死根、15 条没落定），
 * 界面才进到有数据的那一层。**桩的是数据，不是界面**。
 *
 * 量四件事：
 *   ① 每张卡的**名字 / 标题读数 / 默认开合**；
 *   ② 一屏**主线控件**几个（看得见的操作件；折叠卡标题与 `?` 帮助不算）；
 *   ③ 点一下标题 → 收起 → localStorage 里记了什么；**重新导航**回来还是那个状态；
 *   ④ localStorage 里塞垃圾 → 读出要容错，回默认、页面照常。
 *
 * 用法（先 pnpm dev + 无头 Chrome 9400）：
 *   $env:CDP_PORT='9400'; node tmp\probe-⑥收纳.mjs
 */
const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;
const 根址 = 'http://127.0.0.1:1420';

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
      if (cmd === '检索工程文件') return [];
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
  /* CDP 的已知抖动：导航还没落定时发求值，会被回一句
     `Inspected target navigated or closed`（`docs\⑥工程迁移-模块行为.md` 里记过这条）。
     这里是量界面，重试一次就好，不是产品的问题。 */
  for (let i = 0; ; i++) {
    try {
      const r = await rpc('Runtime.evaluate', { expression: 表达式, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
      return r.result.value;
    } catch (e) {
      const 话 = String(e?.message ?? e);
      if (i >= 2 || !/navigated or closed|Cannot find context|Execution context/.test(话)) throw e;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
};
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));

await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: 桩 });
const 页面异常 = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') {
    页面异常.push((m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split('\n')[0]);
  }
});

/** 等区块卡真的出来了（懒加载 + 假后端两跳，固定 sleep 会偶发量到"还没出来"那一层） */
async function 等卡() {
  for (let i = 0; i < 20; i++) {
    const n = await 跑(`document.querySelectorAll('.wb__main details.fold').length`);
    if (n > 0) return n;
    await 等(400);
  }
  console.log('[警告] 等不到区块卡 —— 这一层没载入');
  return 0;
}

/** 载入 + 等界面进到"有数据"那一层 */
async function 去(路由, 落定 = false) {
  await rpc('Page.navigate', { url: `${根址}${路由}` });
  await 等(2600);
  await 跑(`(async () => {
    window.__假.假装都落定 = ${落定};
    document.querySelectorAll('button.pick')[0]?.click();
    await new Promise((r) => setTimeout(r, 1500));
    return 1;
  })()`);
  await 等(500);
  await 等卡();
}

/* 先把记忆清干净：不然上一次探针留下的开合状态会当成"默认"量进来 */
await rpc('Page.navigate', { url: `${根址}/tools/migrate?panel=repair` });
await 等(2600);
await 跑(`(() => { localStorage.removeItem('robin.migrate.fold.v1'); return 1; })()`);

/**
 * 量版式。`藏了` 把"祖先 display:none / visibility:hidden / opacity:0 / `<details>` 没打开"都算看不见 ——
 * 跟体检脚本一个口径，免得"收起中的东西"被数进主线控件。
 */
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
  const 主区 = document.querySelector('.wb__main');
  const 底栏 = document.querySelector('.foot');
  const 卡 = [...document.querySelectorAll('.wb__main details.fold, .wb__main details.more, .wb__main details.notes')].map((d) => {
    const s = d.querySelector(':scope > summary');
    const 名 = (s?.querySelector('.fold__t') || s)?.textContent?.replace(/\\s+/g, ' ').trim() ?? '';
    const 读 = s?.querySelector('.fold__n, .tag')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '';
    return { 卡: 名.slice(0, 24), 读数: 读, 开: d.open, 类: d.className };
  });
  /* 主线控件 = 看得见的操作件（button / input / select / textarea / 画出来的勾选框），中区 + 底栏，
     **不算抽屉**、也不算折叠卡标题（那是收纳件）与顶栏那个 ? 帮助开关。
     注：勾选框的原生 input 是 opacity:0 / width:0，按矩形读不到，所以按它外面那个 label 数。 */
  const 件 = [
    ...document.querySelectorAll('.wb__main button, .wb__main input, .wb__main select, .wb__main textarea, .wb__main label.chk, .foot button')
  ]
    .filter((e) => !e.closest('.wb__side'))
    .filter((e) => !(e.tagName === 'INPUT' && e.closest('label.chk')))
    .filter((e) => !藏了(e))
    .map((e) => ({
      文: ((e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.textContent || e.value || '').replace(/\\s+/g, ' ').trim()).slice(0, 18),
      标签: e.tagName.toLowerCase() === 'label' ? 'label:chk' : e.tagName.toLowerCase() + (e.type ? ':' + e.type : ''),
      帮助: !!(e.getAttribute('aria-expanded') !== null && /说明/.test(e.textContent || '')),
      层: e.closest('details.fold') ? '区块卡' : e.closest('details.more') ? '更多工具' : e.closest('.foot') ? '底栏' : '卡里'
    }));
  const 标题 = [...document.querySelectorAll('.wb__main summary')].map((s) => (s.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40));
  /* 明细太长（逐条卡每行两个按钮），按"层"归一下再出前几条 */
  const 分层 = {};
  for (const x of 件) 分层[x.层] = (分层[x.层] ?? 0) + 1;
  return {
    卡,
    标题,
    主线操作件: 件.filter((x) => !x.帮助).length,
    按层: 分层,
    明细前12: 件.slice(0, 12).map((x) => x.层 + '｜' + x.标签 + '｜' + x.文 + (x.帮助 ? '（? 帮助）' : '')),
    存: localStorage.getItem('robin.migrate.fold.v1'),
    横滚: [...document.querySelectorAll('.wb__main *')].filter((e) => {
      const s = getComputedStyle(e);
      return /(auto|scroll)/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 1;
    }).length,
    页: location.pathname + location.search
  };
})()
`;

/**
 * 版式那一层：横滚 / 重叠 / 溢出 —— **口径跟 `tools\ui-audit.mjs` 一模一样**
 * （吸附元素压住内容不算重叠；浮层不算溢出）。
 * 为什么要另量一遍：体检脚本跑的是"没载入工程"那一层，那时候 ② 以后整块不出来，
 * **⑥ 新做的折叠卡在体检里根本不存在** —— 收起/展开两种样子都得在这个探针里量。
 */
const 量版式 = `
(async () => {
  const 定住 = async () => {
    for (const a of document.getAnimations?.() ?? []) { try { a.finish(); } catch {} }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };
  await 定住();
  const 横滚 = [];
  for (const e of document.querySelectorAll('*')) {
    if (e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1) {
      const s = getComputedStyle(e);
      if (s.overflowX === 'visible' || s.overflowX === 'hidden') continue;
      横滚.push((e.className || e.tagName).toString().slice(0, 50) + ' +' + (e.scrollWidth - e.clientWidth));
    }
  }
  const 吸附 = (e) => {
    let p = e;
    while (p && p !== document.documentElement) {
      const s = getComputedStyle(p);
      if (s.position === 'sticky' || s.position === 'fixed') return true;
      p = p.parentElement;
    }
    return false;
  };
  const 重叠 = [];
  for (const c of document.querySelectorAll('*')) {
    const 子 = [...c.children].filter((x) => {
      if (!(x instanceof HTMLElement)) return false;
      const s = getComputedStyle(x);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      if (s.position === 'absolute' || s.position === 'fixed') return false;
      if (吸附(x)) return false;
      const r = x.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (子.length < 2 || 子.length > 30) continue;
    for (let i = 0; i < 子.length; i++) {
      for (let j = i + 1; j < 子.length; j++) {
        const a = 子[i].getBoundingClientRect(), b = 子[j].getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 1 && h > 1) 重叠.push(((子[i].className || 子[i].tagName) + ' ∩ ' + (子[j].className || 子[j].tagName)).toString().slice(0, 60));
      }
    }
  }
  const 浮层 = (e) => {
    let p = e;
    while (p && p !== document.documentElement) {
      const s = getComputedStyle(p);
      if (s.position === 'fixed' || s.position === 'absolute' || s.position === 'sticky') return true;
      p = p.parentElement;
    }
    return false;
  };
  const 溢出 = [];
  for (const e of document.querySelectorAll('.card, .row, .list li, .note, .foot, .tag, .chip, td, th')) {
    if (浮层(e)) continue;
    const r = e.getBoundingClientRect();
    let p = e.parentElement;
    while (p && p !== document.documentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll|hidden)/.test(s.overflowX) || /(auto|scroll|hidden)/.test(s.overflowY)) {
        const pr = p.getBoundingClientRect();
        if (r.left < pr.left - 1 || r.right > pr.right + 1 || r.top < pr.top - 1) 溢出.push((e.className || e.tagName).toString().slice(0, 50));
        break;
      }
      p = p.parentElement;
    }
  }
  await 定住();
  return { 横滚: 横滚.length, 横滚例: 横滚.slice(0, 3), 重叠: 重叠.length, 重叠例: 重叠.slice(0, 3), 溢出: 溢出.length, 溢出例: 溢出.slice(0, 3) };
})()
`;

console.log('==== ① 修复工程：默认（没载入任何工程）====');
await rpc('Page.navigate', { url: `${根址}/tools/migrate?panel=repair` });
await 等(2600);
console.log(JSON.stringify(await 跑(量), null, 1));

console.log('\n==== ② 修复工程：载入一份工程（15 条没落定 + 1 个死根）====');
await 去('/tools/migrate?panel=repair');
const 载入态 = await 跑(量);
console.log(JSON.stringify(载入态, null, 1));

console.log('\n==== ③ 点一下「逐条指定」的标题 → 收起来（看记了什么）====');
console.log(
  JSON.stringify(
    await 跑(`(async () => {
      const 卡 = [...document.querySelectorAll('.wb__main details.fold')].find((d) =>
        (d.querySelector(':scope > summary')?.textContent || '').includes('逐条指定'));
      const 前 = 卡.open;
      卡.querySelector(':scope > summary').click();
      await new Promise((r) => setTimeout(r, 300));
      return { 点前开: 前, 点后开: 卡.open, 存: localStorage.getItem('robin.migrate.fold.v1') };
    })()`),
    null,
    1
  )
);

console.log('\n==== ④ 重新导航回同一页 → 记忆还在吗 ====');
await 去('/tools/migrate?panel=repair');
console.log(
  JSON.stringify(
    await 跑(`[...document.querySelectorAll('.wb__main details.fold')].map((d) => ({
      卡: (d.querySelector('.fold__t') || {}).textContent?.trim(),
      开: d.open
    }))`),
    null,
    1
  )
);

console.log('\n==== ⑤ 另一区各记各的（?panel=pack 不该读到 repair 的记忆）====');
await 去('/tools/migrate?panel=pack');
console.log(JSON.stringify(await 跑(量), null, 1));

console.log('\n==== ⑥ localStorage 塞垃圾 → 读出要容错、回默认 ====');
await 跑(`(() => {
  localStorage.setItem('robin.migrate.fold.v1', '{"repair":"不是对象","pack":{"逐条":"不是布尔"},"x":');
  return 1;
})()`);
await 去('/tools/migrate?panel=repair');
console.log(JSON.stringify(await 跑(量), null, 1));

console.log('\n==== ⑦ 工程本来就健康（0 条没落定）→ 逐条指定应当**收起** ====');
await 去('/tools/migrate?panel=repair', true);
console.log(
  JSON.stringify(
    await 跑(`({
      卡: [...document.querySelectorAll('.wb__main details.fold')].map((d) => ({
        卡: (d.querySelector('.fold__t') || {}).textContent?.trim(),
        读数: (d.querySelector('.fold__n, .tag') || {}).textContent?.replace(/\\s+/g, ' ').trim(),
        开: d.open
      })),
      主线操作件: [...document.querySelectorAll('.wb__main button, .wb__main input, .wb__main select, .wb__main textarea, .foot button')]
        .filter((e) => !e.closest('.wb__side'))
        .filter((e) => {
          let p = e;
          while (p && p !== document.documentElement) {
            const s = getComputedStyle(p);
            if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
            if (p.tagName === 'DETAILS' && !p.open) return false;
            p = p.parentElement;
          }
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .filter((e) => !(e.getAttribute('aria-expanded') !== null && /说明/.test(e.textContent || ''))).length,
      存: localStorage.getItem('robin.migrate.fold.v1')
    })`),
    null,
    1
  )
);

if (页面异常.length) console.log('\n[页面异常]', [...new Set(页面异常)].slice(0, 6));
else console.log('\n[页面异常] 无');

/* ---------------- 版式：载入态 × 收起 / 全展开 ---------------- */

for (const [路由, 名] of [
  ['/tools/migrate?panel=repair', '修复工程'],
  ['/tools/migrate?panel=pack', '打包迁移']
]) {
  await 去(路由);
  const 收起 = await 跑(量版式);
  const 收起卡 = await 跑(`[...document.querySelectorAll('.wb__main details')].map((d) => (d.open ? '开' : '收')).join('')`);
  const 展开 = await 跑(`(async () => {
    for (const d of document.querySelectorAll('details')) d.open = true;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return 1;
  })()`);
  await 等(300);
  const 全开 = await 跑(量版式);
  console.log(`\n==== 版式（载入态）· ${名} ====`);
  console.log('  默认（卡：' + 收起卡 + '）：' + JSON.stringify({ ...收起, 展开: 展开 }));
  console.log('  全部摊开：' + JSON.stringify(全开));
}
ws.close();
