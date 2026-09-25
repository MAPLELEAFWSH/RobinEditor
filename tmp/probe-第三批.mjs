/**
 * 第三批（2026-09-23）界面实证：B3 / B4 / B5 / B6 / C8 / C9 / D11。
 *
 * 无头 Chrome + **假后端**（只桩数据，不桩界面）。用法：
 *   pnpm dev
 *   chrome --headless=new --remote-debugging-port=9400 --window-size=1707,1067 http://127.0.0.1:1420/
 *   $env:CDP_PORT='9400'; node tmp\probe-第三批.mjs
 *
 * 量什么：
 *   · B3 「找回挪走的文件」在**修复区与打包区**都在「更多工具」里、名字一致；
 *   · B4 拖/选第二个工程时出三选（换成 / 都留 / 取消），同一时刻只有一个写盘对象；
 *   · B5 底栏那颗主按钮 `elementFromPoint` 命中的是不是它自己（原来被应用状态栏压住）；
 *   · B6 打包两模式显式选 + 文案跟着切；
 *   · C8 ① 日文页注册了「文件」与「文件夹」两个落点（合成 drop 事件，看它接不接）；
 *   · C9 提示条到点自己消失（9 秒那条），**确认类不许自己消失**；
 *   · D11 修复区的「你属于哪种」两选 + 走法句跟着切。
 */
const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;

const 桩 = `
(() => {
  const P = 'E:\\\\C test\\\\⑥验收\\\\假工程';
  const PMM1 = P + '\\\\工程甲.pmm';
  const PMM2 = P + '\\\\工程乙.pmm';
  const PMM3 = P + '\\\\工程丙.pmm';
  const EMM1 = P + '\\\\工程甲.emm';
  const EMM2 = P + '\\\\工程乙.emm';
  let 选文件第几次 = 0;
  const 扫描 = () => ({
    pmm: PMM1, emm: EMM1,
    objects: [
      { key: 'Pmd1', kind: 'model', index: 1, path: 'D:\\\\旧根\\\\UserFile\\\\a.pmx' },
      { key: 'Pmd2', kind: 'model', index: 2, path: 'E:\\\\本机\\\\b.pmx' }
    ],
    effects: [],
    在盘上: [true, false],
    pmm_hits: [
      { key: 'Pmd1', offset: 0, path: 'D:\\\\旧根\\\\UserFile\\\\a.pmx', 怎么找到的: '完整路径', 名称: 'あ' },
      { key: 'Pmd2', offset: 0, path: 'E:\\\\本机\\\\b.pmx', 怎么找到的: '完整路径', 名称: 'い' }
    ],
    /* 这四个按 Rust 扫描结果的形状给全（少一个前端就会在 模型目录[0] 上抛） */
    模型目录: [{ 目录: 'D:\\\\旧根\\\\UserFile', 条数: 1, 有: 0 }],
    附件目录: [{ 目录: 'E:\\\\本机', 条数: 1, 有: 1 }],
    目标: ['E:\\\\本机\\\\b.pmx', ''],
    问题: [], textures: []
  });
  const 根 = [{ 根: 'D:\\\\旧根', 条数: 1, 例: ['D:\\\\旧根\\\\UserFile\\\\a.pmx'], 建议: '', 建议命中: 0, 在盘条数: 0 }];
  const 列 = (根表, 逐条) => [{
    段: 'Object', 键: 'Pmd1', 原路径: 'D:\\\\旧根\\\\UserFile\\\\a.pmx', 在盘上: false, 根: 'D:\\\\旧根',
    目标: (逐条 && 逐条[0] && 逐条[0][1]) || (根表 && 根表[0] && rootJoin(根表[0][1])) || (window.__假.假装都落定 ? 'D:\\\\旧根\\\\UserFile\\\\a.pmx' : ''),
    状态: (逐条 && 逐条.length) || (根表 && 根表.length) || window.__假.假装都落定 ? '原位在' : '需要指定'
  }];
  const rootJoin = (新根) => 新根 + '\\\\UserFile\\\\a.pmx';
  window.__假 = { 检索太大: false, 调用: [], 选文件第几次: 0 };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      window.__假.调用.push(cmd);
      if (cmd === '扫') return 扫描();
      if (cmd === '找根') return 根;
      if (cmd === '列路径') return 列(args.根表, args.逐条);
      if (cmd === '待撤销') return null;
      if (cmd === '查进度') return { 已看: 1234, 毫秒: 800, 在哪: 'D:\\\\某个大目录' };
      if (cmd === '取消扫描') { window.__假.调用取消 = true; return null; }
      if (cmd === '检索') {
        if (window.__假.检索太大) {
          throw '范围太大，请给更具体的起点：D:\\\\ 是**整个盘** —— 递归扫它要把盘里每一个目录都走一遍。换成更靠里的一个目录，或者把起点分成几个分别加。';
        }
        return [{ 原路径: 'D:\\\\旧根\\\\UserFile\\\\a.pmx', 文件名: 'a.pmx', 候选: [], 建议: 'E:\\\\找回的\\\\a.pmx', 状态: '已唯一找到', 备注: '' }];
      }
      if (cmd === 'probe_dir') return { exists: true, is_dir: true, entries: 0, names: [] };
      if (cmd === 'plugin:dialog|open') {
        const o = (args && args.options) || {};
        if (o.directory) return 'E:\\\\C test\\\\⑥验收\\\\假工程\\\\打包输出';
        const ext = ((o.filters && o.filters[0] && o.filters[0].extensions) || [])[0];
        if (ext === 'emm') return window.__假.选文件第几次 > 1 ? EMM2 : EMM1;
        window.__假.选文件第几次++;
        return window.__假.选文件第几次 >= 3 ? PMM3 : (window.__假.选文件第几次 > 1 ? PMM2 : PMM1);
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

/* ---------------- CDP 脚手架 ---------------- */
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

const 过 = [];
const 判 = (名, 成, 附 = '') => {
  过.push(成);
  console.log(`  ${成 ? 'ok  ' : 'FAIL'} ${名}${附 ? '  → ' + 附 : ''}`);
};

await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Emulation.setDeviceMetricsOverride', { width: 1707, height: 1067, deviceScaleFactor: 1, mobile: false });
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: 桩 });
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') {
    console.log('[页面异常]', (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split('\n')[0]);
  }
});

const 载入 = async (路由) => {
  await rpc('Page.navigate', { url: `http://127.0.0.1:1420${路由}` });
  await 等(2600);
  /* 点第一个槽位 → 假后端给一份 .pmm → 同名 .emm 自动接上 → 自己扫一遍 */
  await 跑(`(async () => {
    document.querySelector('button.pick')?.click();
    await new Promise((r) => setTimeout(r, 1500));
  })()`);
  await 等(700);
};

/* ================= 修复区：B3 / D11 / B5 ================= */
console.log('\n==== /tools/migrate?panel=repair ====');
await 载入('/tools/migrate?panel=repair');

const 修复区 = await 跑(`(async () => {
  const 文 = (e) => (e?.textContent || '').replace(/\\s+/g, ' ').trim();
  const 更多 = document.querySelector('details.more');
  const 卡 = (t) => [...document.querySelectorAll('details.more .card h3')].map(文).find((x) => x === t) ?? '';
  const 主 = document.querySelector('.foot button.btn--primary');
  const r = 主 ? 主.getBoundingClientRect() : null;
  const 命中 = r ? document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)) : null;
  return {
    更多工具开着: !!更多?.open,
    更多工具标题: 文(document.querySelector('details.more > summary')),
    更多工具里的卡: [...document.querySelectorAll('details.more .card h3')].map(文),
    找回卡在更多工具里: 卡('找回挪走的文件') !== '',
    起点按钮: !!document.querySelector('details.more button') && [...document.querySelectorAll('details.more button')].some((b) => /加搜索起点/.test(文(b))),
    来路两选: (() => {
      const 行 = [...document.querySelectorAll('.wb__main .row')].find((r) => /^你属于哪种/.test((r.textContent || '').replace(/\\s+/g, ' ').trim()));
      return 行 ? [...行.querySelectorAll('.pick__b')].map(文) : [];
    })(),
    走法句: [...document.querySelectorAll('.wb__main p.mini')].map(文).find((x) => /^(走法|这么走)：/.test(x)) ?? '（没有）',
    旧根卡: [...document.querySelectorAll('.wb__main details.fold > summary')].map(文).filter((x) => /路径指向了别的位置/.test(x)),
    死根行数: document.querySelectorAll('input[aria-label^="给"]').length,
    第二卡在不在: !!document.querySelector('.wb__main details.fold'),
    主按钮文字: 文(主),
    主按钮命中:
      命中 === 主 ? '按钮自己' : (命中 ? (命中.className || 命中.tagName).toString().slice(0, 40) : '（命不中）'),
    主按钮矩形: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) } : null,
    视口高: innerHeight,
    状态栏矩形: (() => { const s = document.querySelector('footer.sb'); if (!s) return null; const b = s.getBoundingClientRect(); return { top: Math.round(b.top), h: Math.round(b.height), z: getComputedStyle(s).zIndex }; })(),
    底栏z: getComputedStyle(document.querySelector('.foot')).zIndex,
    底栏bottom: getComputedStyle(document.querySelector('.foot')).bottom,
    假后端调用: window.__假.调用.slice(-8),
    找根返回: await window.__TAURI_INTERNALS__.invoke('找根', { pmm: 'x', emm: 'y' })
  };
})()`);
console.log(JSON.stringify(修复区, null, 1));
判('B3 更多工具标题里有「找回挪走的文件」', /找回挪走的文件/.test(修复区.更多工具标题), 修复区.更多工具标题);
判('B3 「找回挪走的文件」那张卡在更多工具里', 修复区.找回卡在更多工具里);
判('B3 有「加搜索起点…」入口', 修复区.起点按钮);
判('B5 主按钮 elementFromPoint 命中它自己', 修复区.主按钮命中 === '按钮自己', 修复区.主按钮命中);
判('B5 底栏让开了状态栏（bottom = 30px）', 修复区.底栏bottom === '30px', 修复区.底栏bottom);
判('D11 有「你属于哪种」两选', 修复区.来路两选.length === 2, JSON.stringify(修复区.来路两选));
判(
  'D11 默认按事实猜成「别人打包的工程」（扫出死根就走换根那条）',
  /别人打/.test(修复区.来路两选.join('|')) && /旧根/.test(修复区.走法句),
  修复区.走法句
);
判('D11 死根卡跟着出来（有死根=真）', 修复区.旧根卡.length === 1 && 修复区.死根行数 === 1, JSON.stringify(修复区.旧根卡));

/* ---- D11：切成"本机挪走"，走法句要跟着换 ---- */
const 切来路 = await 跑(`(async () => {
  const 文 = (e) => (e?.textContent || '').replace(/\\s+/g, ' ').trim();
  const 行 = [...document.querySelectorAll('.wb__main .row')].find((r) => /^你属于哪种/.test(文(r)));
  const b = 行 ? [...行.querySelectorAll('.pick__b')].find((x) => /本机的文件被挪了/.test(文(x))) : null;
  b?.click();
  await new Promise((r) => setTimeout(r, 200));
  return {
    按下的: 文(b),
    走法句: [...document.querySelectorAll('.wb__main p.mini')].map(文).find((x) => /^(走法|这么走)：/.test(x)) ?? '（没有）'
  };
})()`);
判('D11 切到「本机的文件被挪了」后走法句变指「找回挪走的文件」', /找回挪走的文件/.test(切来路.走法句), 切来路.走法句);

/* ---- A1：范围太大时界面原样显示那句话 + 不卡死 ---- */
const 检索太大 = await 跑(`(async () => {
  const 文 = (e) => (e?.textContent || '').replace(/\\s+/g, ' ').trim();
  const 更多 = document.querySelector('details.more');
  if (更多) 更多.open = true;
  await new Promise((r) => setTimeout(r, 200));
  const 按 = (re) => [...document.querySelectorAll('details.more button')].find((b) => re.test(文(b)));
  按(/加搜索起点/)?.click();
  await new Promise((r) => setTimeout(r, 400));
  window.__假.检索太大 = true;
  const 起点数 = document.querySelectorAll('details.more .list li').length;
  const t0 = performance.now();
  按(/^开始找$/)?.click();
  await new Promise((r) => setTimeout(r, 1200));
  const 界面还活着 = !!document.querySelector('.wb__main');
  const 底栏句 = 文(document.querySelector('.foot__msg'));
  window.__假.检索太大 = false;
  return { 起点数, 耗时: Math.round(performance.now() - t0), 界面还活着, 底栏句 };
})()`);
console.log(JSON.stringify(检索太大, null, 1));
判(
  'A1「范围太大」原样显示、界面还活着',
  检索太大.界面还活着 && /^范围太大，请给更具体的起点/.test(检索太大.底栏句),
  检索太大.底栏句.slice(0, 60)
);

/* ---- A1/B3：正常检索一次（进度 + 结果） ---- */
const 检索正常 = await 跑(`(async () => {
  const 文 = (e) => (e?.textContent || '').replace(/\\s+/g, ' ').trim();
  const 按 = (re) => [...document.querySelectorAll('details.more button')].find((b) => re.test(文(b)));
  按(/^开始找$/)?.click();
  await new Promise((r) => setTimeout(r, 1200));
  return {
    底栏句: 文(document.querySelector('.foot__msg')),
    结果行: [...document.querySelectorAll('details.more .card li')].map(文).filter((x) => /已唯一找到/.test(x)),
    采用按钮: [...document.querySelectorAll('details.more button')].some((b) => /采用/.test(文(b)))
  };
})()`);
console.log(JSON.stringify(检索正常, null, 1));
判('B3 检索在更多工具里能跑出结果', 检索正常.结果行.length > 0 && 检索正常.采用按钮, JSON.stringify(检索正常.结果行));

/* ---- B7：② 那一堆路径可一键收起 ---- */
const 折叠 = await 跑(`(async () => {
  const 文 = (e) => (e?.textContent || '').replace(/\\s+/g, ' ').trim();
  const d = [...document.querySelectorAll('.wb__main details.fold')].find((x) => /② 工程里有什么/.test(文(x.querySelector('summary'))));
  if (!d) return { 错: '② 没有做成可折叠的卡' };
  const 读数 = 文(d.querySelector('summary'));
  /* details 收起时子节点还在 DOM 里（浏览器用 UA 样式藏起来），所以量**画没画出来** */
  const 表在 = () => {
    const t = d.querySelector('.tblwrap');
    return !!t && t.getBoundingClientRect().height > 0;
  };
  const 开时表在 = 表在();
  const 点前open = d.open;
  d.querySelector('summary').click();
  await new Promise((r) => setTimeout(r, 400));
  const 点后open = d.open;
  const 收起后表在 = 表在();
  const 收起后高 = Math.round(d.getBoundingClientRect().height);
  const 表display = (() => { const t = d.querySelector('.tblwrap'); return t ? getComputedStyle(t).display : '（没有 .tblwrap）'; })();
  const 表矩 = (() => { const t = d.querySelector('.tblwrap'); if (!t) return null; const b = t.getBoundingClientRect(); return { h: Math.round(b.height), w: Math.round(b.width) }; })();
  const 表在谁里面 = (() => { const t = d.querySelector('.tblwrap'); return t ? (t.closest('details') === d ? '就是这张卡' : (t.closest('details')?.className ?? '（不在 details 里）')) : '（没有）'; })();
  const 文档里几张表 = document.querySelectorAll('.tblwrap').length;
  const 记忆1 = localStorage.getItem('robin.migrate.fold.v1');
  d.querySelector('summary').click();
  await new Promise((r) => setTimeout(r, 400));
  return { 读数, 点前open, 点后open, 收起后高, 表display, 表矩, 表在谁里面, 文档里几张表, 记忆1, 开时表在, 收起后表在, 再开open: d.open, 再开表在: 表在() };
})()`);
console.log(JSON.stringify(折叠, null, 1));
判('B7 ② 的路径表可一键收起（收起后表不在页面上）', 折叠.开时表在 && !折叠.收起后表在 && 折叠.再开表在, 折叠.读数);

/* ---- C9：提示条 9 秒自动消失（这里用底栏那条 msg） ---- */
const 提示消失 = await 跑(`(async () => {
  const 有 = () => !!document.querySelector('.foot__msg .note');
  const 一开始 = 有();
  await new Promise((r) => setTimeout(r, 9800));
  return { 一开始, 秒后还在: 有() };
})()`);
判('C9 底栏提示到点自己消失', 提示消失.一开始 && !提示消失.秒后还在, JSON.stringify(提示消失));

/* ================= B4：第二个工程要问 ================= */
console.log('\n==== B4 中途载入第二个工程 ====');
const 冲突 = await 跑(`(async () => {
  const 文 = (e) => (e?.textContent || '').replace(/\\s+/g, ' ').trim();
  document.querySelector('button.pick')?.click();   /* 假后端这时给的是"工程乙" */
  await new Promise((r) => setTimeout(r, 500));
  const 问 = [...document.querySelectorAll('.note')].map(文).find((x) => /已经载着一份工程/.test(x)) ?? '';
  const 三选 = [...document.querySelectorAll('.note button')].map(文);
  /* **要用户决定的确认不许自己消失**（C9）：等过 9 秒那档再看一眼 */
  await new Promise((r) => setTimeout(r, 9800));
  const 过了9秒还在 = [...document.querySelectorAll('.note button')].map(文);
  return { 问句: 问.slice(0, 80), 三选, 过了9秒还在 };
})()`);
console.log(JSON.stringify(冲突, null, 1));
判('B4 出三选：换成 / 都留 / 取消', 冲突.三选.length === 3 && /换成这一个/.test(冲突.三选.join('|')), JSON.stringify(冲突.三选));
判('C9 要用户决定的确认**不**自动消失', 冲突.过了9秒还在.length === 3, JSON.stringify(冲突.过了9秒还在));

const 都留 = await 跑(`(async () => {
  const 文 = (e) => (e?.textContent || '').replace(/\\s+/g, ' ').trim();
  [...document.querySelectorAll('.note button')].find((b) => /两份都留/.test(文(b)))?.click();
  await new Promise((r) => setTimeout(r, 1500));
  const 行 = [...document.querySelectorAll('.wb__main .row')].find((r) => /^当前处理/.test(文(r)));
  return {
    当前处理条: 行 ? 文(行) : '（没有）',
    工程按钮: 行 ? [...行.querySelectorAll('button')].map(文) : [],
    主按钮: 文(document.querySelector('.foot button.btn--primary')),
    主按钮数: document.querySelectorAll('button.btn--primary').length
  };
})()`);
console.log(JSON.stringify(都留, null, 1));
判('B4「都留」之后出现「当前处理」切换条（两份）', /当前处理/.test(都留.当前处理条) && 都留.工程按钮.length === 2, 都留.当前处理条);
判('B4 同一时刻只有一个主按钮（=一个写盘对象）', 都留.主按钮数 === 1, String(都留.主按钮数));

const 换成 = await 跑(`(async () => {
  const 文 = (e) => (e?.textContent || '').replace(/\\s+/g, ' ').trim();
  window.__假.选文件第几次 = 2;             /* 再选一次 → 假后端给"工程丙" */
  document.querySelector('button.pick')?.click();
  await new Promise((r) => setTimeout(r, 500));
  三选 = [...document.querySelectorAll('.note button')].map(文);
  [...document.querySelectorAll('.note button')].find((b) => /换成这一个/.test(文(b)))?.click();
  await new Promise((r) => setTimeout(r, 1500));
  const 行 = [...document.querySelectorAll('.wb__main .row')].find((r) => /^当前处理/.test(文(r)));
  return {
    三选,
    当前处理条: 行 ? 文(行) : '（没有，只剩一份）',
    主按钮数: document.querySelectorAll('button.btn--primary').length
  };
})()`);
console.log(JSON.stringify(换成, null, 1));
判('B4「换成这一个」之后只剩一份（切换条没了）', !/当前处理/.test(换成.当前处理条) && 换成.主按钮数 === 1, 换成.当前处理条);

/* ================= 打包区：B3 / B5 / B6 ================= */
console.log('\n==== /tools/migrate?panel=pack ====');
await 载入('/tools/migrate?panel=pack');
const 打包区 = await 跑(`(async () => {
  const 文 = (e) => (e?.textContent || '').replace(/\\s+/g, ' ').trim();
  window.__假.假装都落定 = true;   /* 假"列路径"这一步：让主按钮可点，才测得到确认句 */
  /* 重扫一遍，新的"列路径"结果才会进来（界面上的路径表是扫出来的那一份） */
  [...document.querySelectorAll('.wb__main button')].find((b) => /^(扫描|重新扫描)/.test(文(b)))?.click();
  await new Promise((r) => setTimeout(r, 1400));
  document.querySelector('.wb__main .row button.btn--ghost')?.click();   /* ③ 卡的「选目录」 */
  await new Promise((r) => setTimeout(r, 900));
  const 更多 = document.querySelector('details.more');
  if (更多) 更多.open = true;
  await new Promise((r) => setTimeout(r, 300));
  const 模式两选 = [...document.querySelectorAll('.wb__main .pick__b')].map(文).filter((t) => /打包/.test(t));
  const 说明句 = () => [...document.querySelectorAll('.wb__main p.mini')].map(文).find((x) => /^配布打包：|^本机内打包：/.test(x)) ?? '（没有）';
  const 本机句 = 说明句();
  [...document.querySelectorAll('.wb__main .pick__b')].find((x) => /配布打包/.test(文(x)))?.click();
  await new Promise((r) => setTimeout(r, 200));
  const 配布句 = 说明句();
  const 主 = document.querySelector('.foot button.btn--primary');
  const r = 主.getBoundingClientRect();
  const 命中 = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
  /* 「主按钮点得到吗」这个判据本身要能红：临时把底栏拉回 bottom:0（B5 之前的写法）再量一次 */
  const st = document.createElement('style');
  st.textContent = '.foot { bottom: 0 !important; z-index: 3 !important; }';
  document.head.appendChild(st);
  await new Promise((r2) => requestAnimationFrame(() => requestAnimationFrame(r2)));
  const r2box = 主.getBoundingClientRect();
  const 命中坏 = (() => {
    const h = document.elementFromPoint(Math.round(r2box.left + r2box.width / 2), Math.round(r2box.top + r2box.height / 2));
    return h === 主 || 主.contains(h) ? '按钮自己' : (h ? (h.className || h.tagName).toString().slice(0, 40) : '（命不中）');
  })();
  st.remove();
  await new Promise((r3) => requestAnimationFrame(() => requestAnimationFrame(r3)));
  /* 主按钮点下去 → 确认句要写清是哪一种 */
  主.click();
  await new Promise((r4) => setTimeout(r4, 400));
  const 确认句 = 文(document.querySelector('.foot__t'));
  [...document.querySelectorAll('.foot button')].find((b) => /^取消$/.test(文(b)))?.click();
  return {
    模式两选, 本机句: 本机句.slice(0, 40), 配布句: 配布句.slice(0, 40),
    更多工具标题: 文(document.querySelector('details.more > summary')),
    找回卡在更多工具里: [...document.querySelectorAll('details.more .card h3')].map(文).includes('找回挪走的文件'),
    主按钮文字: 文(主),
    主按钮命中: 命中 === 主 ? '按钮自己' : (命中 ? (命中.className || 命中.tagName).toString().slice(0, 40) : '（命不中）'),
    破坏性试验_拉回bottom0命中: 命中坏,
    确认句: 确认句.slice(0, 80),
    主按钮矩形: { top: Math.round(r.top), bottom: Math.round(r.bottom) }
  };
})()`);
console.log(JSON.stringify(打包区, null, 1));
判('B6 打包区有「打包成哪种」两选', 打包区.模式两选.length === 2 && /本机内打包/.test(打包区.模式两选.join('|')) && /配布打包/.test(打包区.模式两选.join('|')), JSON.stringify(打包区.模式两选));
判('B6 切模式后区别文案跟着换', /本机/.test(打包区.本机句) && /相对/.test(打包区.配布句), 打包区.配布句);
判('B6 写盘确认句写清是哪一种', /相对|本机绝对路径/.test(打包区.确认句), 打包区.确认句);
判('B3 打包区也有「找回挪走的文件」', 打包区.找回卡在更多工具里 && /找回挪走的文件/.test(打包区.更多工具标题));
判('B5 打包区「打包到输出目录」点得到', 打包区.主按钮命中 === '按钮自己', 打包区.主按钮命中 + '｜' + JSON.stringify(打包区.主按钮矩形));
/* **破坏性试验**：把底栏按 B5 之前的写法拉回 bottom:0，同一颗按钮应当立刻"点不到"。
   这条不过就说明上面那个判据是空的（永远 ok）。 */
判(
  'B5 判据本身管用（拉回 bottom:0 就报被挡）',
  打包区.破坏性试验_拉回bottom0命中 !== '按钮自己',
  打包区.破坏性试验_拉回bottom0命中
);

/* ================= C8：① 日文页的落点 ================= */
console.log('\n==== /tools/glitch?panel=fix（拖文件 / 拖文件夹）====');
await rpc('Page.navigate', { url: 'http://127.0.0.1:1420/tools/glitch?panel=fix' });
await 等(2600);
const 落点 = await 跑(`(async () => {
  const 主 = document.querySelector('.wb__main');
  if (!主) return { 错: '没有主区' };
  const r = 主.getBoundingClientRect();
  const 落 = (名) => {
    const dt = new DataTransfer();
    dt.items.add(new File(['abc'], 名, { type: 'text/plain' }));
    const ev = new DragEvent('drop', {
      bubbles: true, cancelable: true,
      clientX: Math.round(r.left + r.width / 2),
      clientY: Math.round(r.top + 80),
      dataTransfer: dt
    });
    (document.elementFromPoint(ev.clientX, ev.clientY) || 主).dispatchEvent(ev);
  };
  const 话 = () => (document.querySelector('.side__err') || {}).textContent?.replace(/\\s+/g, ' ').trim() ?? '（没有提示）';
  const 清 = () => document.querySelector('.side__errx')?.click();
  落('aaa.txt');
  await new Promise((r2) => setTimeout(r2, 400));
  const 拖文件 = 话();
  清();
  await new Promise((r2) => setTimeout(r2, 200));
  落('一个没有后缀的名字');
  await new Promise((r2) => setTimeout(r2, 400));
  const 拖文件夹 = 话();
  return { 拖文件, 拖文件夹 };
})()`);
console.log(JSON.stringify(落点, null, 1));
判(
  'C8 拖文本文件落在「文件」落点上（不是"没人接"）',
  /没有真实路径|桌面端/.test(落点.拖文件) && !/没落在能接它的地方/.test(落点.拖文件),
  落点.拖文件
);
判(
  'C8 拖文件夹落在「文件夹」落点上（不是"没人接"）',
  /没拿到路径|拖文件夹拿不到真路径/.test(落点.拖文件夹) && !/没落在能接它的地方/.test(落点.拖文件夹),
  落点.拖文件夹
);

console.log(`\n---- 第三批探针：${过.filter(Boolean).length} / ${过.length} 条过 ----`);
ws.close();
process.exit(过.every(Boolean) ? 0 : 1);
