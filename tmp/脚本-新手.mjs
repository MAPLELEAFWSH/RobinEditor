/**
 * 新手脚本走查（设计准则 §十一：不看文档、只按界面文字，3 分钟内做完三件事）。
 *
 * 无头 Chrome + 假后端（只桩数据，不桩界面）。用法：
 *   pnpm dev
 *   chrome --headless=new --remote-debugging-port=9400 --window-size=1707,1067 about:blank
 *   $env:CDP_PORT='9400'; node tmp\脚本-新手.mjs
 *
 * 脚本**只允许用"看得见的文字"找入口**（不按类名、不按第几个按钮）——
 * 这就是新手的处境：不认识任何内部名字。找不到就记 FAIL。
 * 每一步都量**从点下去到界面有可见变化**的毫秒数；>1000ms 记「超过 1 秒没反馈」。
 *
 * 三件事：
 *   ① 修好一份"文件被挪走"的工程；② 打包成一个自包含目录；③ 调一张 LUT 并导出。
 */
const PORT = process.env.CDP_PORT ?? '9400';
const BASE = `http://127.0.0.1:${PORT}`;

const 桩 = `
(() => {
  const P = 'E:\\\\C test\\\\新手脚本\\\\工程';
  const PMM = P + '\\\\演出工程.pmm';
  const EMM = P + '\\\\演出工程.emm';
  const 图像 = (() => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        g.fillStyle = 'rgb(' + (x * 4) + ',' + (y * 4) + ',128)';
        g.fillRect(x, y, 1, 1);
      }
    }
    return { c, g };
  })();
  const 扫描 = () => ({
    pmm: PMM, emm: EMM,
    objects: [
      { key: 'Pmd1', kind: 'model', index: 1, path: 'D:\\\\别人的盘\\\\UserFile\\\\a.pmx' },
      { key: 'Pmd2', kind: 'model', index: 2, path: 'D:\\\\别人的盘\\\\UserFile\\\\b.pmx' }
    ],
    effects: [],
    在盘上: [false, false],
    pmm_hits: [
      { key: 'Pmd1', offset: 0, path: 'D:\\\\别人的盘\\\\UserFile\\\\a.pmx', 怎么找到的: '完整路径', 名称: 'あ' },
      { key: 'Pmd2', offset: 0, path: 'D:\\\\别人的盘\\\\UserFile\\\\b.pmx', 怎么找到的: '完整路径', 名称: 'い' }
    ],
    /* 四个字段给全（少一个前端就会抛） */
    模型目录: [{ 目录: 'D:\\\\别人的盘\\\\UserFile', 条数: 2, 有: 0 }],
    附件目录: [],
    目标: ['', ''],
    问题: [], textures: []
  });
  /* 找根：**带推荐值**（工具从工程旁边找出来的那个），新手一个字都不用填 */
  const 根 = [{
    根: 'D:\\\\别人的盘\\\\UserFile', 条数: 2, 例: ['D:\\\\别人的盘\\\\UserFile\\\\a.pmx'],
    建议: P + '\\\\UserFile', 建议命中: 2, 在盘条数: 0
  }];
  const 拼 = (新根, 原名) => 新根 + '\\\\' + 原名;
  const 列 = (根表, 逐条) => {
    const 规则 = [].concat(根表 || [], 逐条 || []);
    const 解 = (原, 名) => {
       for (const r of 规则) { if (原.indexOf(r[0]) === 0) return 拼(r[1], 名); }
      return '';
    };
    return [1, 2].map((i) => {
      const 名 = i === 1 ? 'a.pmx' : 'b.pmx';
      const 原 = 'D:\\\\别人的盘\\\\UserFile\\\\' + 名;
      const 目标 = 解(原, 名);
      return { 段: 'Object', 键: 'Pmd' + i, 原路径: 原, 在盘上: false, 根: 'D:\\\\别人的盘\\\\UserFile', 目标, 状态: 目标 ? '已按根找到' : '需要指定' };
    });
  };
  const 搬根结果 = () => ({
    根表: [], emm改行: 4, pmm改字段: 2,
    旧根残留: [], 新根出现: [[P + '\\\\UserFile', 2]],
    pmm长度: 100, emm长度: 200, 原先pmm长度: 100, 原先emm长度: 200,
    输出: PMM, 干跑: false, 问题: [], 产物路径: []
  });
  window.__假 = { 调用: [], 写盘次数: 0 };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd, args) => {
      window.__假.调用.push(cmd);
      if (cmd === '扫') return 扫描();
      if (cmd === '找根') return 根;
      if (cmd === '列路径') return 列(args.根表, args.逐条);
      if (cmd === '待撤销') return window.__假.写盘次数 ? { 时间: 1700000000, 人话: '原地修复（就地改）' } : null;
      if (cmd === '搬根' || cmd === '搬根自带' || cmd === '搬运工程') { window.__假.写盘次数++; return 搬根结果(); }
      if (cmd === '查进度') return { 已看: 10, 毫秒: 20, 在哪: 'E:\\\\某处' };
      if (cmd === '取消扫描') return null;
      if (cmd === 'probe_dir') return { exists: true, is_dir: true, entries: 0, names: [] };
      if (cmd === 'read_image') {
        const url = 图像.c.toDataURL('image/png');
        return { width: 64, height: 64, png: url.split(',')[1], src_format: 'png', src_bytes: 2048 };
      }
      if (cmd === 'read_rgba') {
        const d = 图像.g.getImageData(0, 0, 64, 64).data;
        let s = '';
        for (let i = 0; i < d.length; i++) s += String.fromCharCode(d[i]);
        return { width: 64, height: 64, rgba: btoa(s), src_format: 'png', src_bytes: 2048 };
      }
      if (cmd === 'write_rgba_image') return { path: args.path, bytes_written: 4096, backup: null };
      if (cmd === 'write_bytes') return { path: args.path, bytes_written: 512, backup: null };
      if (cmd === 'plugin:dialog|open') {
        const o = (args && args.options) || {};
        if (o.directory) return P + '\\\\输出';
        const ext = ((o.filters && o.filters[0] && o.filters[0].extensions) || [])[0];
        if (ext === 'emm') return EMM;
        if (ext === 'png') return P + '\\\\参考.png';
        return PMM;
      }
      if (cmd === 'plugin:dialog|save') return P + '\\\\输出\\\\clut.png';
      if (cmd === 'scan_text_files') {
        return [1, 2, 3].map((i) => ({
          path: P + '\\\\文本\\\\说明' + i + '.txt',
          rel: '文本/说明' + i + '.txt',
          likely: i !== 2,
          via: 'shift-jis',
          sample_before: '僐儞僩儘乕儔乕',
          sample_after: 'コントローラー',
          uncertain: []
        }));
      }
      console.log('[假后端] 没桩的命令:', cmd);
      return null;
    },
    transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); window['_' + id] = cb; return id; },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } }
  };

  /* ---- 新手视角的助手：只认"看得见的文字" ---- */
  const 文 = (e) => (e && e.textContent ? e.textContent : '').replace(/\\s+/g, ' ').trim();
  const 藏了 = (e) => {
    if (!e) return true;
    let p = e;
    while (p && p !== document.documentElement) {
      const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return true;
      if (p.tagName === 'DETAILS' && !p.open) return true;
      /* 关着的参数抽屉停在右边视口外：那里面的一律算"够不着" */
      if (p.classList && p.classList.contains('wb__side') && !document.documentElement.classList.contains('side-open')) return true;
      p = p.parentElement;
    }
    return false;
  };
  const 在视口里 = (e) => {
    if (藏了(e)) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0;
  };
  window.__新手 = {
    文,
    可见: 在视口里,
    藏了,
    按钮们: () => [...document.querySelectorAll('button')].filter((b) => !藏了(b)),
    找按钮: (t) => window.__新手.按钮们().find((b) => 文(b).includes(t)) || null,
    签名: () => [
      document.body.innerText.length,
      document.querySelectorAll('.tbl tbody tr').length,
      document.querySelectorAll('.note').length,
      文(document.querySelector('.foot__msg')),
      文(document.querySelector('.foot__t'))
    ].join(' | '),
    等变化: async (上限) => {
      const 前 = window.__新手.签名();
      const t0 = performance.now();
      while (performance.now() - t0 < (上限 || 3000)) {
        await new Promise((r) => setTimeout(r, 80));
        if (window.__新手.签名() !== 前) return Math.round(performance.now() - t0);
      }
      return -1;
    },
    等条件: async (判, 上限) => {
      const t0 = performance.now();
      while (performance.now() - t0 < (上限 || 3000)) {
        if (判()) return Math.round(performance.now() - t0);
        await new Promise((r) => setTimeout(r, 80));
      }
      return -1;
    },
    /* 人也会滚屏找按钮 —— 找到之后滚到它那儿再点（同时量"滚完到界面变化"的毫秒数） */
    点文字: async (t, 上限) => {
      const 步 = { 找: t };
      const b = window.__新手.找按钮(t);
      if (!b) { 步.找不到 = true; return 步; }
      步.按到 = 文(b).slice(0, 24);
      b.scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 120));
      步.在视口里 = 在视口里(b);
      b.click();
      步.反馈ms = await window.__新手.等变化(上限 || 3000);
      return 步;
    },
    有句: (re) => [...document.querySelectorAll('p, li, div, span, summary')]
      .filter((e) => !藏了(e)).map(文).filter((t) => re.test(t)).sort((a, b) => a.length - b.length)[0] || '',
    行数: () => document.querySelectorAll('.tbl tbody tr').length
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

const 结果 = [];
const 记 = (脚本, 步骤, 成, 附 = '') => {
  结果.push(成);
  console.log(`  ${成 ? 'ok  ' : 'FAIL'} [${脚本}] ${步骤}${附 ? '  → ' + 附 : ''}`);
};
const 慢 = (步) => 步 && 步.反馈ms >= 0 && 步.反馈ms > 1000;

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
const 去 = async (路由) => {
  await rpc('Page.navigate', { url: `http://127.0.0.1:1420${路由}` });
  await 等(2600);
  /* 清掉折叠记忆：每次走查都从"第一次进这一页"的默认状态开始（那才是新手看到的） */
  await 跑(`(() => { try { localStorage.clear(); } catch {} return 1; })()`);
  await rpc('Page.reload', { ignoreCache: false });
  await 等(2600);
};

/* ==================== 脚本 ① 修好一份"文件被挪走"的工程 ==================== */
console.log('\n==== 脚本 ① 修好一份"文件被挪走"的工程（新手只看界面文字） ====');
await 去('/tools/migrate?panel=repair');
{
  const 顶部 = await 跑(`window.__新手.有句(/^这一页/)`);
  记('①', '1. 进页面就知道这一页干什么（顶部一句话，不用点说明）', /修工程的路径/.test(顶部), 顶部);

  const 步1 = await 跑(`window.__新手.点文字('选 .pmm 工程', 4000)`);
  记('①', '2. 点「选 .pmm 工程」放素材（同名的 .emm 自动接上、自动扫）', !步1.找不到 && 步1.反馈ms >= 0, JSON.stringify(步1));
  记('①', '3. 这一步没卡超过 1 秒', !慢(步1), `反馈 ${步1.反馈ms} ms`);

  const 扫后 = await 跑(`({
    表行: window.__新手.行数(),
    下一步: window.__新手.有句(/第一步|第二步|点「扫描|原地修好|找回挪走的文件/),
    走法: window.__新手.有句(/^这么走/),
    根推荐: [...document.querySelectorAll('input[aria-label^="给"]')].map((i) => i.value),
    有推荐标: [...document.querySelectorAll('summary, .chip')].some((e) => /工具推荐|路径指向了别的位置/.test(window.__新手.文(e))),
    主按钮: window.__新手.文([...document.querySelectorAll('button.btn--primary')].find(window.__新手.可见))
  })`);
  console.log('   ' + JSON.stringify(扫后));
  记('①', '4. 扫完立刻看得见结果（表里有行）', 扫后.表行 > 0, `${扫后.表行} 行`);
  记('①', '5. 新位置**已经替我填好**（不用从零填路径）', 扫后.根推荐.length > 0 && 扫后.根推荐.every((v) => v), JSON.stringify(扫后.根推荐));
  记('①', '6. 界面明说接下来点哪（走法句）', /原地修好/.test(扫后.走法), 扫后.走法);
  记('①', '7. 主按钮是"动词+对象"（原地修好）', /原地修好/.test(扫后.主按钮), 扫后.主按钮);

  const 步2 = await 跑(`window.__新手.点文字('原地修好', 4000)`);
  记('①', '8. 点主按钮 → 立刻出现"会动哪些文件"的确认（就地、不弹窗）', !步2.找不到 && 步2.反馈ms >= 0, JSON.stringify(步2));
  记('①', '9. 这一步没卡超过 1 秒', !慢(步2), `反馈 ${步2.反馈ms} ms`);
  const 确认句 = await 跑(`window.__新手.有句(/确定写盘/)`);
  记('①', '10. 确认句写清了改哪两份文件', /改的是这两份/.test(确认句), 确认句);

  const 步3 = await 跑(`window.__新手.点文字('确定修复', 5000)`);
  const 完成 = await 跑(`window.__新手.有句(/换好了|改的就是你拖进来的那份|已另存/)`);
  记('①', '11. 点「确定修复」→ 立刻看到结果（写盘完成那句话）', 步3.反馈ms >= 0 && /换好了|已另存/.test(完成), `${步3.反馈ms} ms｜${完成.slice(0, 60)}`);
  记('①', '12. 这一步没卡超过 1 秒', !慢(步3), `反馈 ${步3.反馈ms} ms`);
  const 撤销 = await 跑(`(() => { const b = window.__新手.找按钮('撤销上一次处理'); return b ? !b.disabled : null; })()`);
  记('①', '13. 写完一键可撤（撤销按钮亮了）', 撤销 === true, String(撤销));
}

/* ==================== 脚本 ② 打包成一个自包含目录 ==================== */
console.log('\n==== 脚本 ② 打包成一个自包含目录 ====');
await 去('/tools/migrate?panel=pack');
{
  const 顶部 = await 跑(`window.__新手.有句(/^这一页/)`);
  const 区里那句话 = await 跑(`window.__新手.有句(/打成一份包/)`);
  记('②', '1. 顶部/区里各有一句话：这一页干什么', /打包/.test(顶部) && /打成一份包/.test(区里那句话), 顶部 + ' ｜ ' + 区里那句话);

  const 步1 = await 跑(`window.__新手.点文字('选 .pmm 工程', 4000)`);
  const 目录 = await 跑(`({
    自包含目录: window.__新手.有句(/^E:.*_包$|_包$/),
    推荐标: [...document.querySelectorAll('.chip')].map(window.__新手.文).filter((x) => /自动推荐|你手动定的/.test(x)),
    主按钮: window.__新手.文([...document.querySelectorAll('button.btn--primary')].find(window.__新手.可见)),
    主按钮可点: (() => { const b = [...document.querySelectorAll('button.btn--primary')].find(window.__新手.可见); return b ? !b.disabled : null; })()
  })`);
  console.log('   ' + JSON.stringify(目录));
  记('②', '2. 放进工程后**自动填好**自包含目录（带"自动推荐"标记）', 目录.自包含目录 !== '' && 目录.推荐标.length > 0, 目录.自包含目录 + '｜' + JSON.stringify(目录.推荐标));
  记('②', '3. 主按钮可点、且是"动词+对象"', 目录.主按钮可点 === true && /打包到输出目录/.test(目录.主按钮), 目录.主按钮);
  记('②', '4. 没卡超过 1 秒', !慢(步1), `反馈 ${步1.反馈ms} ms`);

  const 步2 = await 跑(`window.__新手.点文字('打包到输出目录', 4000)`);
  记('②', '5. 点主按钮 → 立刻出现"往哪拷什么"的确认', 步2.反馈ms >= 0, JSON.stringify(步2));
  const 步3 = await 跑(`window.__新手.点文字('确定打包', 5000)`);
  const 完成 = await 跑(`window.__新手.有句(/打好了|去 MMD 拖这一个/)`);
  记('②', '6. 点「确定打包」→ 看到结果（打好了 + 要拖哪一个）', 步3.反馈ms >= 0 && /打好了/.test(完成), `${步3.反馈ms} ms｜${完成.slice(0, 60)}`);
  记('②', '7. 这一步没卡超过 1 秒', !慢(步3), `反馈 ${步3.反馈ms} ms`);
}

/* ==================== 脚本 ③ 调一张 LUT 并导出 ==================== */
console.log('\n==== 脚本 ③ 调一张 LUT 并导出 ====');
await 去('/tools/ikclut');
{
  const 首屏 = await 跑(`({
    顶部一句: window.__新手.有句(/^这一页/),
    基准图: window.__新手.有句(/基准图|测试图/),
    主按钮: window.__新手.文(window.__新手.按钮们().find((b) => b.classList.contains('btn--primary'))),
    主按钮可点: (() => { const b = window.__新手.按钮们().find((x) => x.classList.contains('btn--primary')); return b ? !b.disabled : null; })()
  })`);
  console.log('   ' + JSON.stringify(首屏));
  记('③', '1. 顶部一句话说清这一页干什么', /LUT|CLUT/.test(首屏.顶部一句), 首屏.顶部一句);
  记('③', '2. **打开就能用**：默认带一张基准图，不用先找素材（设计准则 §二）', /基准图|测试图/.test(首屏.基准图) && 首屏.主按钮可点 === true, 首屏.基准图.slice(0, 40) + '｜主按钮可点=' + 首屏.主按钮可点);
  记('③', '3. 主按钮是"动词+对象"（导出 CLUT）', /导出 CLUT/.test(首屏.主按钮), 首屏.主按钮);

  /* 调一下（新手的"调"就是从参数抽屉里拖一根滑杆） */
  const 调 = await 跑(`(async () => {
    const 参数 = window.__新手.找按钮('参数');
    if (!参数) return { 找不到: '参数' };
    参数.click();
    await new Promise((r) => setTimeout(r, 500));
    const 滑 = [...document.querySelectorAll('input[type=range]')].find((i) => i.getAttribute('aria-label') === '曝光');
    if (!滑) return { 找不到: '曝光滑杆' };
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    const 前 = window.__新手.签名();
    d.set.call(滑, '0.6');
    滑.dispatchEvent(new Event('input', { bubbles: true }));
    const 到 = await window.__新手.等条件(() => window.__新手.签名() !== 前, 3000);
    /* 收回去，免得挡住主按钮（新手也会这么干） */
    window.__新手.找按钮('收起')?.click();
    await new Promise((r) => setTimeout(r, 400));
    return { 反馈ms: 到, 值: 滑.value };
  })()`);
  记('③', '4. 拖「曝光」滑杆 → 界面上有变化（调色生效）', !调.找不到 && 调.反馈ms >= 0, JSON.stringify(调));
  记('③', '5. 这一步没卡超过 1 秒', !慢(调), `反馈 ${调.反馈ms} ms`);

  const 步2 = await 跑(`window.__新手.点文字('导出 CLUT', 6000)`);
  const 完成 = await 跑(`window.__新手.有句(/写了|参数清单|导出失败/)`);
  记('③', '6. 点「导出 CLUT」→ 立刻看到写盘结果', 步2.反馈ms >= 0 && /写了/.test(完成), `${步2.反馈ms} ms｜${完成.slice(0, 60)}`);
  记('③', '7. 这一步没卡超过 1 秒', !慢(步2), `反馈 ${步2.反馈ms} ms`);
}

/* ==================== 老手脚本（设计准则 §十.5） ==================== */
console.log('\n==== 老手脚本：自定新根 / 配布打包 / 批量处理 ====');
await 去('/tools/migrate?panel=repair');
{
  /* ① 自定新根：**不靠推荐值**，全程只用界面上看得见的文字 */
  const 步1 = await 跑(`(async () => {
    const 文 = window.__新手.文;
    window.__新手.找按钮('选 .pmm 工程')?.click();
    await new Promise((r) => setTimeout(r, 1600));
    const 更多 = document.querySelector('details.more');
    if (更多 && !更多.open) 更多.querySelector('summary').click();
    await new Promise((r) => setTimeout(r, 300));
    /* 按根那条的「用推荐值 / 我自己填」二选一（设计准则 §十.1）——
       存在性只要求"没被藏起来"，不要求此刻在视口里（人也会滚屏） */
    const 二选一 = [...document.querySelectorAll('.pick__b')].filter((b) => !window.__新手.藏了(b)).map(文)
      .filter((t) => /推荐值|我自己填/.test(t));
    const 自己填 = window.__新手.找按钮('我自己填');
    if (!自己填) return { 找不到: '我自己填', 二选一 };
    自己填.scrollIntoView({ block: 'center' });
    自己填.click();
    await new Promise((r) => setTimeout(r, 200));
    const 框 = document.activeElement;
    if (!框 || 框.tagName !== 'INPUT') return { 找不到: '点了我自己填没聚焦到输入框', 二选一 };
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(框, 'E:\\\\我自己定的\\\\UserFile');
    框.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    return {
      二选一,
      框的值: 框.value,
      手动标: [...document.querySelectorAll('.chip')].map(文).filter((x) => /你手动定的/.test(x)).length,
      主按钮: 文([...document.querySelectorAll('button.btn--primary')].find(window.__新手.可见))
    };
  })()`);
  console.log('   ' + JSON.stringify(步1));
  记('老手', '1. 新根是「用推荐值 / 我自己填」二选一，点「我自己填」光标直接落进框里', 步1.二选一.length === 2 && !步1.找不到, JSON.stringify(步1.二选一));
  记('老手', '2. 自定的值标成「你手动定的」（新手/老手分得清）', 步1.手动标 > 0 && /我自己定的/.test(步1.框的值 || ''), `${步1.手动标} 个标记`);

  const 被覆盖 = await 跑(`(async () => {
    window.__新手.找按钮('重新扫描工程')?.click();
    await new Promise((r) => setTimeout(r, 1600));
    const 框 = [...document.querySelectorAll('input[aria-label^="给"]')][0];
    return 框 ? 框.value : '';
  })()`);
  记('老手', '3. 重扫之后手填的值**还在**（自动规则不覆盖它）', /我自己定的/.test(被覆盖), 被覆盖);

  const 用推荐 = await 跑(`(async () => {
    window.__新手.找按钮('用推荐值')?.click();
    await new Promise((r) => setTimeout(r, 400));
    const 框 = [...document.querySelectorAll('input[aria-label^="给"]')][0];
    return { 值: 框 ? 框.value : '', 手动标: [...document.querySelectorAll('.chip')].map(window.__新手.文).filter((x) => /你手动定的/.test(x)).length };
  })()`);
  记('老手', '4. 点「用推荐值」能退回自动找的那份（手动层松掉）', !/我自己定的/.test(用推荐.值) && 用推荐.手动标 === 0, JSON.stringify(用推荐));

  /* 专家参数收在「更多设置（老手）」里（§十.2），且抽屉里不再有它 */
  const 专家 = await 跑(`(async () => {
    const 文 = window.__新手.文;
    const 设置 = [...document.querySelectorAll('details.fold')].find((d) => /更多设置/.test(文(d.querySelector('summary'))));
    const 抽屉里 = [...document.querySelectorAll('.wb__side input[type=checkbox]')].length;
    const 默认收起 = 设置 ? !设置.open : null;
    if (设置 && !设置.open) 设置.querySelector('summary').click();
    await new Promise((r) => setTimeout(r, 300));
    return {
      有更多设置: !!设置,
      默认收起,
      展开后有原地修复: 设置 ? /原地修复/.test(文(设置)) : false,
      抽屉里的复选框数: 抽屉里,
      有导出映射表: !!window.__新手.找按钮('导出映射表')
    };
  })()`);
  console.log('   ' + JSON.stringify(专家));
  记('老手', '5. 专家参数收在该卡的「更多设置」里（默认收起、抽屉里不再重复）', 专家.有更多设置 && 专家.默认收起 === true && 专家.展开后有原地修复 && 专家.抽屉里的复选框数 === 0, JSON.stringify(专家));

  const 快捷键 = await 跑(`(async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    return window.__新手.文(document.querySelector('.foot__t'));
  })()`);
  记('老手', '6. Ctrl+Enter 能唤起底栏主按钮那一步（快捷键不是隐藏功能，写在「更多设置」里）', /确定写盘/.test(快捷键), 快捷键.slice(0, 50));
  await 跑(`window.__新手.找按钮('取消')?.click()`);

  const 映射表 = await 跑(`(async () => {
    window.__新手.找按钮('导出映射表（.txt）')?.click();
    const 到 = await window.__新手.等条件(() => /映射表写了/.test(document.body.innerText), 4000);
    return { 反馈ms: 到, 句: window.__新手.有句(/映射表写了|还没有映射可导出|导出映射表失败/) };
  })()`);
  记('老手', '7. 「导出映射表」能把这次用的映射写成一份文本（可复现）', 映射表.反馈ms >= 0 && /映射表写了/.test(映射表.句), JSON.stringify(映射表));

  /* ② 配布打包：老手自己选 */
  const 步2 = await 跑(`(async () => {
    const 打包 = [...document.querySelectorAll('button')].find((b) => /打包迁移/.test(window.__新手.文(b)));
    if (!打包) return { 找不到: true };
    打包.click();
    await new Promise((r) => setTimeout(r, 2000));
    window.__新手.找按钮('选 .pmm 工程')?.click();
    await new Promise((r) => setTimeout(r, 1800));
    const 配布 = window.__新手.找按钮('配布打包');
    if (!配布) return { 找不到: '配布打包' };
    配布.click();
    await new Promise((r) => setTimeout(r, 300));
    return {
      按下的: window.__新手.文(配布),
      目标: window.__新手.有句(/^E:.*_包$/),
      主按钮: window.__新手.文([...document.querySelectorAll('button.btn--primary')].find(window.__新手.可见))
    };
  })()`);
  记('老手', '8. 打包区能显式切成「配布打包」（不用先关掉任何自动行为）', !步2.找不到 && /配布/.test(步2.按下的), JSON.stringify(步2));

  /* ③ 批量：对一整个目录跑同一种处理（① 日文页的「文件」分区） */
  await 去('/tools/glitch?panel=batch');
  const 步3 = await 跑(`(async () => {
    const 文 = window.__新手.文;
    const 选 = window.__新手.找按钮('选目录');
    if (!选) return { 找不到: '选目录' };
    选.click();
    const 到 = await window.__新手.等条件(() => document.querySelectorAll('.list li').length >= 3, 8000);
    const 勾 = [...document.querySelectorAll('.list input[type=checkbox]')].filter((c) => c.checked).length;
    const 跑 = window.__新手.找按钮('试跑') || window.__新手.找按钮('开跑');
    const 试跑 = [...document.querySelectorAll('.wb__side input[type=checkbox]')].some((c) => c.checked);
    return {
      反馈ms: 到,
      列表条数: document.querySelectorAll('.list li').length,
      默认勾了几条: 勾,
      跑按钮: 跑 ? 文(跑) : '（没找到）',
      有试跑开关: 试跑
    };
  })()`);
  console.log('   ' + JSON.stringify(步3));
  记('老手', '9. 批量：一个目录一次扫出来、默认勾好"像乱码的"', 步3.反馈ms >= 0 && 步3.默认勾了几条 > 0, JSON.stringify(步3));
  记('老手', '10. 批量：有能跑的按钮（动词+对象），不必先关自动行为', /试跑|开跑/.test(步3.跑按钮), 步3.跑按钮);
}

/* ==================== 容量：一屏主线控件 ≤ 8（设计准则 §八） ==================== */
console.log('\n==== 容量：一屏主线控件数 ====');
for (const [名, 路由] of [
  ['⑥ 修复工程', '/tools/migrate?panel=repair'],
  ['⑥ 打包迁移', '/tools/migrate?panel=pack'],
  ['② ikClut', '/tools/ikclut'],
  ['① 日文（文本）', '/tools/glitch?panel=fix']
]) {
  await 去(路由);
  const 数 = await 跑(`(() => {
    const 主 = document.querySelector('.wb__main');
    if (!主) return null;
    const 控件 = [...主.querySelectorAll('button, input, select')].filter((e) => !window.__新手.藏了(e) && window.__新手.可见(e));
    return {
      控件数: 控件.length,
      都是什么: 控件.map((e) => (window.__新手.文(e) || e.getAttribute('aria-label') || e.type || e.tagName).slice(0, 12)),
      底栏: [...document.querySelectorAll('.foot button, .wb__acts button')].filter((e) => window.__新手.可见(e)).length
    };
  })()`);
  console.log(`   ${名}: ${数.控件数} 个  →  ${JSON.stringify(数.都是什么)}`);
  记('容量', `${名}：一屏主线控件 ≤ 8（实测 ${数.控件数}）`, 数.控件数 <= 8, 数.都是什么.join('、'));
}

console.log(`\n---- 新手脚本走查：${结果.filter(Boolean).length} / ${结果.length} 条过 ----`);
ws.close();
process.exit(结果.every(Boolean) ? 0 : 1);
