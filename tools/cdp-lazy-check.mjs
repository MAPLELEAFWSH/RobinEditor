/**
 * 真机验按需加载 —— 打开某个功能页，看它到底把哪个模块的代码拉下来了。
 *
 * 前提：dev 带了远程调试端口（见 tools/cdp-nav.mjs 文件头）。**而且这个实例要独占
 * 一份 WebView2 用户目录** —— 用户自己开着绿色版时，调试端口会被那边占住：
 *   $env:WEBVIEW2_USER_DATA_FOLDER="$env:TEMP\robin-cdp-profile"
 *
 * 用法：node tools/cdp-lazy-check.mjs [基地址]
 *
 * 每个路由做三件事：
 *   1. 界面有没有出来：不是停在"正在载入这个分区…"，也不是"没载进来"那一栏
 *   2. **拉了哪些模块源码**：dev 下 Vite 一个文件一个 URL，
 *      `performance.getEntriesByType('resource')` 里 `/src/lib/modules/**\/*.svelte`
 *      就是"这一趟真加载了哪些模块"。**只该有这一页要的那个。**
 *   3. 控制台 / 侧栏有没有报错
 *
 * 为什么用资源表而不是网络事件：dev 下没有 `_app/immutable/`（那是生产构建的目录名），
 * 按那个前缀过滤会得到 0 —— 一开始就是这么写错的，报了 8 个假 FAIL。
 */
const PORT = process.env.CDP_PORT ?? '9222';
const base = process.argv[2] ?? 'http://localhost:1420';

/** 每个路由：该拉到哪几个界面文件。空数组 = 这页不该拉任何模块。
 *  **同一个模块自己的子组件算在内**（⑦ 的图层/调整/蒙版、② 的曲线、③ 的参数行
 *  都是被各自模块顶层 import 的，跟着一起下来才对）；别的模块的顶层组件不该出现。 */
const ROUTES = [
  { url: '/', 名字: '总览', 该拉: [] },
  { url: '/tools/quick?panel=pin', 名字: '快捷动作', 该拉: ['work/Quick.svelte'] },
  { url: '/tools/recent?panel=list', 名字: '最近工程', 该拉: ['work/Recent.svelte'] },
  {
    url: '/tools/channels?panel=layers',
    名字: '⑦ 图层与蒙版',
    该拉: ['channels/Channels.svelte']
  },
  { url: '/tools/channels?panel=pipeline', 名字: '⑦ 批量提取', 该拉: ['channels/Pipeline.svelte'] },
  { url: '/tools/channels?panel=extract', 名字: '⑦ 通道提取', 该拉: ['channels/Extract.svelte'] },
  { url: '/tools/ilm?panel=pack', 名字: '⑤ ILM 打包', 该拉: ['ilm/Ilm.svelte'] },
  { url: '/tools/ilm?panel=sdf', 名字: '⑤ SDF', 该拉: ['ilm/Sdf.svelte'] },
  { url: '/tools/migrate?panel=repair', 名字: '⑨ 工程迁移', 该拉: ['migrate/Migrate.svelte'] },
  { url: '/tools/ikclut?panel=clut', 名字: '② ikClut', 该拉: ['ikclut/Ikclut.svelte', 'ikclut/Curve.svelte'] },
  { url: '/tools/glitch?panel=fix', 名字: '① 乱码', 该拉: ['glitch/Glitch.svelte'] },
  { url: '/tools/ray?panel=conf', 名字: '③ Ray', 该拉: ['ray/Ray.svelte', 'ray/Row.svelte'] },
  { url: '/tools/yaku?panel=match', 名字: '⑥ 养乐多', 该拉: ['yaku/Yaku.svelte'] },
  { url: '/settings', 名字: '设置', 该拉: [] },
  { url: '/about', 名字: '关于', 该拉: [] },
  { url: '/welcome', 名字: '欢迎页', 该拉: [] }
];

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) {
  console.error(`没有可连的 page。确认 tauri dev 带了 --remote-debugging-port=${PORT}`);
  process.exit(1);
}

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
    errors.push('未捕获：' + String(m.params.exceptionDetails?.exception?.description ?? '').split('\n')[0].slice(0, 120));
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push('console.error：' + (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 120));
  }
});

const send = (method, params = {}) => {
  const myId = ++id;
  return new Promise((resolve) => {
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
};

await send('Runtime.enable');
await send('Page.enable');

const settle = Number(process.env.SETTLE ?? 1400);
const rows = [];
for (const r of ROUTES) {
  errors = [];
  await send('Page.navigate', { url: base + r.url });
  await new Promise((res) => setTimeout(res, settle));
  const state = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const txt = document.body.innerText || '';
      const host = document.querySelector('.panel-host');
      const res = performance.getEntriesByType('resource').map((e) => e.name);
      const mods = [...new Set(
        res.filter((u) => u.includes('/src/lib/modules/'))
           .map((u) => u.split('/src/lib/modules/')[1].split('?')[0])
           .filter((p) => p.endsWith('.svelte'))
      )].sort();
      return {
        停在载入中: txt.includes('正在载入这个分区'),
        载入失败: txt.includes('这个分区的界面没载进来'),
        侧栏报错: (document.querySelector('.side__err span')?.textContent ?? '').trim() || null,
        面板文字长度: (host?.innerText ?? '').trim().length,
        拉了: mods
      };
    })()`
  });
  rows.push({ ...r, ...(state?.result?.result?.value ?? {}), 错误: [...new Set(errors)] });
}

ws.close();

let bad = 0;
for (const r of rows) {
  const 问题 = [];
  if (r.停在载入中) 问题.push('停在载入中');
  if (r.载入失败) 问题.push('载入失败');
  if (r.侧栏报错) 问题.push('侧栏报错：' + r.侧栏报错);
  if (r.错误.length) 问题.push(r.错误.join(' / '));
  const 多了 = r.拉了.filter((m) => !r.该拉.includes(m));
  const 少了 = r.该拉.filter((m) => !r.拉了.includes(m));
  if (多了.length) 问题.push('多拉了：' + 多了.join(','));
  if (少了.length) 问题.push('少拉了：' + 少了.join(','));
  if (r.该拉.length && r.面板文字长度 < 40) 问题.push(`面板几乎是空的（${r.面板文字长度} 字）`);
  if (问题.length) bad++;
  console.log(
    `${问题.length ? 'FAIL' : 'ok  '}  ${r.名字.padEnd(12)} 拉了 ${r.拉了.length ? r.拉了.join(' + ') : '(没有模块代码)'}` +
      (问题.length ? `\n        ${问题.join('\n        ')}` : '')
  );
}
console.log(`\n${rows.length} 个路由，${bad} 个有问题`);
process.exit(bad ? 1 : 0);
