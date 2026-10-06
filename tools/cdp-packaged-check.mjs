/**
 * 打包出来的那个 exe，真机点一遍：首屏拉了多少 JS、点进功能页又是多少。
 *
 * 跟 `tools/cdp-lazy-check.mjs` 的分工：那个跑 dev（Vite 一个文件一个 URL，能直接认出模块名），
 * 这个跑**生产包**（chunk 名是哈希，只能按**字节数**看）。两者合起来才是完整的一条：
 * dev 证明"打开哪个只拉哪个模块"，生产包证明"真发出去的那份也是这么拉的"。
 *
 * 前提：拿独立用户目录 + 调试端口把它起起来（用户自己开着绿色版时，端口会被那边占掉）：
 *   $env:WEBVIEW2_USER_DATA_FOLDER="$env:TEMP\robin-pkg-profile"
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9223'
 *   .\dist\RobinEditor-免安装版.exe
 *
 * 用法：node tools/cdp-packaged-check.mjs [调试端口]
 *
 * 为什么点侧栏而不是 Page.navigate：生产包里深链接要落到 index.html 兜底，
 * 而 Tauri 的资源协议不一定兜——真机上用户也不会手打 URL，都是点侧栏。
 * 点侧栏走的还是客户端路由，跟真人一样。
 */
const PORT = process.env.CDP_PORT ?? process.argv[2] ?? '9223';

/** 侧栏里要点的模块（按显示名找，名字要跟 registry.ts 的 `name` 一模一样）。先进总览当基线，再逐个点 */
const 要点的 = ['日文乱码修复', 'ikClut 调色', 'Ray 编辑器', '绝区零贴图合成', '养乐多上材质', '贴图通道处理', '工程迁移'];

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
if (!page) {
  console.error(`没有可连的 page。确认打包版带 --remote-debugging-port=${PORT}`);
  process.exit(1);
}
console.log(`连上：${page.url}`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res);
  ws.addEventListener('error', rej);
});

let id = 0;
const pending = new Map();
let errors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push('未捕获：' + String(m.params.exceptionDetails?.exception?.description ?? '').split('\n')[0].slice(0, 140));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push('console.error：' + (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 140));
  }
});

const send = (method, params = {}) => {
  const myId = ++id;
  return new Promise((resolve) => {
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
};

const evalIn = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r?.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text ?? '页面里抛了异常');
  return r?.result?.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');

/** 这一页一共拉了多少 JS 字节（按资源表算，含解压后大小） */
const JS_BYTES = `(() => {
  const js = performance.getEntriesByType('resource').filter((e) => /\\/_app\\/immutable\\/.*\\.js$/.test(e.name));
  return {
    文件数: js.length,
    字节: js.reduce((s, e) => s + (e.decodedBodySize || e.transferSize || 0), 0)
  };
})()`;

const 面板状态 = `(() => {
  const txt = document.body.innerText || '';
  const host = document.querySelector('.panel-host');
  return {
    路由: location.pathname + location.search,
    停在载入中: txt.includes('正在载入这个分区'),
    载入失败: txt.includes('这个分区的界面没载进来'),
    侧栏报错: (document.querySelector('.side__err span')?.textContent ?? '').trim() || null,
    面板文字长度: (host?.innerText ?? '').trim().length
  };
})()`;

const 等 = (ms) => new Promise((r) => setTimeout(r, ms));

/* 基线：先进总览。
   注意只能回**根**，不能"把最后一段路径去掉" —— 试过 `http://tauri.localhost/tools/`，
   生产包的资源协议对找不到的路径直接 404（不像 dev server 有 index.html 兜底），
   于是基线那一步自己就踩出了一个 404，看着像应用的错。 */
await send('Page.navigate', { url: new URL(page.url).origin + '/' });
await 等(2500);
/* 导航完再清一次错误：Runtime.enable 会把页面里**已有的**控制台消息回放过来，
   上一次运行留下的东西会被算到这一行头上（这次就吃了这个假红） */
errors = [];
await evalIn(`location.hash = ''; void 0`);
const 基线 = await evalIn(JS_BYTES);
const 基线状态 = await evalIn(面板状态);
console.log(`\n首屏（总览）：${(基线.字节 / 1024).toFixed(1)} KB / ${基线.文件数} 个 JS`);
console.log(`  面板「${(await evalIn(`(document.querySelector('.wb,main,.shell')?.innerText ?? '').slice(0,40)`)) ?? ''}」`);

const rows = [{ 名字: '总览', ...基线, ...基线状态, 累计字节: 基线.字节, 错误: [...new Set(errors)] }];

for (const 名 of 要点的) {
  errors = [];
  const before = await evalIn(JS_BYTES);
  const 点了 = await evalIn(`(() => {
    const 叶 = [...document.querySelectorAll('.leaf, .rail a, nav a, .side a')]
      .find((e) => (e.textContent || '').includes(${JSON.stringify(名)}));
    if (!叶) return false;
    叶.click();
    return true;
  })()`);
  await 等(1800);
  const now = await evalIn(JS_BYTES);
  const st = await evalIn(面板状态);
  rows.push({
    名字: 名,
    点到了: 点了,
    这一下新拉: now.字节 - before.字节,
    文件数: now.文件数,
    累计字节: now.字节,
    ...st,
    错误: [...new Set(errors)]
  });
}

ws.close();

let bad = 0;
for (const r of rows) {
  const 问题 = [];
  if (r.点到了 === false) 问题.push('侧栏里没找到这一项');
  if (r.停在载入中) 问题.push('停在载入中');
  if (r.载入失败) 问题.push('载入失败');
  if (r.侧栏报错) 问题.push('侧栏报错：' + r.侧栏报错);
  if (r.错误.length) 问题.push(r.错误.join(' / '));
  if (问题.length) bad++;
  console.log(
    `${问题.length ? 'FAIL' : 'ok  '}  ${r.名字.padEnd(20)} 累计 ${(r.累计字节 / 1024).toFixed(1).padStart(7)} KB` +
      (r.这一下新拉 !== undefined ? `（这一下 +${(r.这一下新拉 / 1024).toFixed(1)} KB）` : '') +
      (问题.length ? `\n        ${问题.join('\n        ')}` : '')
  );
}

const 累计最大 = Math.max(...rows.map((r) => r.累计字节));
console.log(`\n${rows.length} 个页面，${bad} 个有问题`);
console.log(`首屏 ${(基线.字节 / 1024).toFixed(1)} KB；走完全部 ${要点的.length} 个模块后累计 ${(累计最大 / 1024).toFixed(1)} KB`);
process.exit(bad ? 1 : 0);
