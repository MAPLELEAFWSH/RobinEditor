/**
 * 探针：**打包版真机**里，① 那三个分栏还接不接得住拖进来的东西。
 *
 * 跟 `tmp\probe-①拖放落点.mjs` 的分工：那份是 `pnpm dev` 里量**代码逻辑**（假后端 + 真事件）。
 * 这份量的是**真发出去的那份 exe** —— 真 WebView2、真 Tauri 事件通道、真盘上的目录。
 * 用户在跑的就是这个，所以得单独过一遍。
 *
 * 做法：不去合成浏览器事件（`dragDropEnabled` 之后 webview 收不到 HTML5 drop），
 * 而是从**页面里**用 Tauri 自己的事件通道 `plugin:event|emit` 把 `tauri://drag-enter` /
 * `tauri://drag-drop` 发出去 —— 载荷形状跟 wry 送上来的一模一样（物理像素的 position +
 * 真路径数组），接它的还是 `drag-dom` 里那份真监听。
 *
 * 前提（起打包版，用独立用户目录 + 调试端口）：
 *   $env:WEBVIEW2_USER_DATA_FOLDER="$env:TEMP\robin-pkg-x"
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9224'
 *   .\dist\RobinEditor-免安装版.exe
 *   node tmp\probe-①拖放落点-打包版.mjs 9224
 *
 * 只用**只读**目录（`实战测试用例\`），而且「文件」栏默认就是试跑，不会写盘。
 */
const PORT = process.env.CDP_PORT ?? process.argv[2] ?? '9224';
/* 只读、体量小的一处真语料（7 个文件，里面有真乱码名的 .fx / .txt） */
const 只读目录 = process.env.语料 ?? 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例\\乱码翻译\\AnimeScreenTex_v1.0';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = list.find((x) => x.type === 'page' && !x.url.startsWith('devtools://'));
if (!t) throw new Error(`CDP :${PORT} 上没有可连的 page`);
console.log('连上：', t.url);
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const rpc = (method, params = {}) =>
  new Promise((res, rej) => {
    const my = ++id;
    const 定时 = setTimeout(() => { ws.removeEventListener('message', on); rej(new Error('CDP 超时 ' + method)); }, 60000);
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
await rpc('Page.enable');
await rpc('Runtime.enable');

/* 页面里那套工具：走真 Tauri 的事件通道发原生拖放 */
const 装工具 = `
window.__探 = {
  /** 用 Tauri 自己的通道把拖放事件发出去（载荷形状照 wry 送上来那份） */
  原生: async (类型, 载荷) => {
    try {
      await window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'tauri://drag-' + 类型, payload: 载荷 });
      return 'ok';
    } catch (e) {
      return '（emit 失败：' + (e && e.message ? e.message : e) + '）';
    }
  },
  中: (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; },
  文: (el) => (el && el.textContent ? el.textContent : '').replace(/\\s+/g, ' ').trim(),
  屏: () => ({
    地址: location.pathname + location.search,
    dpr: devicePixelRatio,
    工作区: window.__探.中('.wb__main'),
    /* 「文件」栏扫完会摆出这张卡 / 这行读数；「名称」栏会出「原名 → 修后名」 */
    扫到的读数: [...document.querySelectorAll('.wb__main .mini, .wb__main .row__v, .wb__main h3, .wb__main .tag')].map(window.__探.文).filter((x) => /扫了|个文本文件|原名|扫到|目录里共|注释有乱码|没检出/.test(x)),
    界面提示: [...document.querySelectorAll('.note')].map(window.__探.文).filter((x) => /是单个文件|没落在能接|只收|不是文件夹|没接/.test(x)),
    侧栏报错: window.__探.文(document.querySelector('.side__err'))
  })
};
'工具装好了'
`;

/** 点侧栏里那一项（打包版里深链接不一定兜得住，跟用户一样点侧栏） */
const 点侧栏 = (名) => `(() => {
  const 叶 = [...document.querySelectorAll('.leaf, .rail a, nav a, .side a')].find((e) => (e.textContent || '').includes(${JSON.stringify(名)}));
  if (!叶) return false;
  叶.click();
  return true;
})()`;

const 账 = [];
const 判 = (名, 过, 说明) => {
  账.push({ 名, 过: !!过 });
  console.log(`${过 ? '✅' : '❌'} ${名} —— ${说明}`);
};

await 跑(装工具);

/* ---- 甲、「文件」栏：拖一个真目录进去，该扫出文本文件 ---- */
await 跑(点侧栏('日文乱码修复'));
await 等(2000);
/* 切分区走**页面顶上那排分区条**（`.seg__btn`，任何分区都在）。
   注意别用「文本」栏里那排"要修哪一样"的按钮 —— 那排只在「文本」栏上，
   在别的栏上点等于点了个空气（第一版就踩过：四条全在 batch 上跑，白过）。 */
const 切到 = (标签) => `(() => {
  const b = [...document.querySelectorAll('.seg__btn')].find((x) => {
    const l = x.querySelector('.seg__label');
    return ((l ? l.textContent : x.textContent) || '').trim() === ${JSON.stringify(标签)};
  });
  if (!b) return false;
  b.click();
  return true;
})()`;

/* 「文件」栏（顶部条上叫「文件」） */
await 跑(切到('文件'));
await 等(1500);
console.log('\n---- 甲、①「文件」栏（panel=batch）----');
console.log('进去时：', JSON.stringify(await 跑('window.__探.屏()'), null, 1));

let 中 = await 跑('window.__探.中(".wb__main")');
let dpr = await 跑('devicePixelRatio');
const 物 = { x: Math.round(中.x * dpr), y: Math.round(中.y * dpr) };
console.log(`工作区中心 CSS=(${中.x},${中.y})，dpr=${dpr} → 物理=(${物.x},${物.y})`);
console.log('enter:', await 跑(`window.__探.原生('enter', ${JSON.stringify({ paths: [只读目录], position: 物 })})`));
console.log('drop :', await 跑(`window.__探.原生('drop', ${JSON.stringify({ paths: [只读目录], position: 物 })})`));
await 等(4000);
const 甲 = await 跑('window.__探.屏()');
console.log('拖目录之后：', JSON.stringify(甲, null, 1));
判('甲-1 打包版「文件」栏接住了文件夹，真去扫了', 甲.扫到的读数.length > 0 && !/没落在能接/.test(甲.界面提示.join(' ')),
  `扫到的读数=${JSON.stringify(甲.扫到的读数)}，提示=${JSON.stringify(甲.界面提示)}`);

/* ---- 乙、同一栏：拖一个**单文件**，该收到指路的实话 ---- */
中 = await 跑('window.__探.中(".wb__main")');
const 单路 = 只读目录 + '\\A-screen.fx';
console.log('\n---- 乙、①「文件」栏拖单文件 ----');
console.log('enter:', await 跑(`window.__探.原生('enter', ${JSON.stringify({ paths: [单路], position: 物 })})`));
console.log('drop :', await 跑(`window.__探.原生('drop', ${JSON.stringify({ paths: [单路], position: 物 })})`));
await 等(2000);
const 乙 = await 跑('window.__探.屏()');
console.log('结果：', JSON.stringify({ 界面提示: 乙.界面提示, 侧栏报错: 乙.侧栏报错 }, null, 1));
判('乙-1 打包版拖单文件 → 说清楚该往哪儿拖，不是那句"没落在能接它的地方"',
  /是单个文件/.test(乙.界面提示.join(' ')) && !/没落在能接/.test(乙.界面提示.join(' ') + 乙.侧栏报错),
  `提示=${JSON.stringify(乙.界面提示)}，侧栏=${JSON.stringify(乙.侧栏报错)}`);

/* ---- 丙、「名称」栏 / 「.fx 注释」栏：至少得接住（不许再是"没有落点"） ----
   每一条都**必须断言地址真换了** —— 点空了的测试会假过（第一版就踩过）。 */
for (const [标签, 名, 该到的] of [['名字还原', '①「名称」栏', 'panel=names'], ['.fx 注释', '①「.fx 注释」栏', 'panel=fx']]) {
  const 点到了 = await 跑(切到(标签));
  await 等(2000);
  const 址 = await 跑('location.pathname + location.search');
  if (!址.includes(该到的)) {
    判(`丙 ${名} 接住了文件夹（不再说"没落在能接它的地方"）`, false, `分区没切过去：点在=${点到了}，地址还是 ${址}（要 ${该到的}）`);
    continue;
  }
  const 中2 = await 跑('window.__探.中(".wb__main")');
  const 物2 = { x: Math.round(中2.x * dpr), y: Math.round(中2.y * dpr) };
  await 跑(`window.__探.原生('enter', ${JSON.stringify({ paths: [只读目录], position: 物2 })})`);
  await 跑(`window.__探.原生('drop', ${JSON.stringify({ paths: [只读目录], position: 物2 })})`);
  await 等(3500);
  const 丙 = await 跑('window.__探.屏()');
  console.log(`\n---- 丙、${名}（${丙.地址}）----`);
  console.log('结果：', JSON.stringify(丙, null, 1));
  const 坏 = /没落在能接/.test(丙.界面提示.join(' ') + 丙.侧栏报错);
  /* 不光"没报错"，还得有**真扫过**的读数 —— 否则点空了也能过 */
  const 有活 = 丙.扫到的读数.length > 0;
  判(`丙 ${名} 接住了文件夹并真扫了（不再说"没落在能接它的地方"）`, !坏 && 有活, `地址=${丙.地址}，读数=${JSON.stringify(丙.扫到的读数)}，提示=${JSON.stringify(丙.界面提示)}，侧栏=${JSON.stringify(丙.侧栏报错)}`);
}

const 过 = 账.filter((x) => x.过).length;
console.log(`\n==== 打包版 ${过}/${账.length} 条通过 ====`);
for (const x of 账.filter((x) => !x.过)) console.log(`  ❌ ${x.名}`);
ws.close();
process.exitCode = 过 === 账.length ? 0 : 1;
