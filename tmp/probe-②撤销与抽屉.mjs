/**
 * 探针：② 调色那两条用户反馈（2026-09-26）。
 *
 * 用户原话：
 *   甲「参数按钮挡住参数唤出的边栏怎么办」
 *   乙「调色点错了可以撤销操作吗」
 *
 * 两条都在代码里能看出个大概，但**"大概"不算数** —— 所以派真事件问界面：
 *
 *   甲 开抽屉之后，右下角那列悬浮球和抽屉**还相交吗**；
 *      抽屉右下角那一点 `elementFromPoint` 命中的是抽屉还是悬浮球。
 *      相交判定是纯几何，不靠眼睛。
 *   乙 三个"点错了"分别试一遍，每次看**步数涨没涨**、撤销之后**值回没回去**：
 *      · 混合页的「4 张」（原来不在历史指纹里 → 一步都不记）
 *      · 抽屉里的「抄参考图」（同上）
 *      · 「全部复位」（原来只回 基本 / 曲线 / 链，色轮·HSL·LOG·变形·LUT·切片反序 全留着）
 *
 * **破坏性试验**（不做这个就等于没量）：
 *   · 把 `AppShell.svelte` 里 `html.side-open .fabs` 那条改回 `right: var(--edge)`，
 *     甲 必须变红；
 *   · 把 `历史指纹` 里的 `fromRef` / `numClut` 去掉，乙前两条必须变红；
 *   · 把 `resetParams` 改回只回三样，乙第三条必须变红。
 *
 * 用法（先 `pnpm dev` 起 1420，再无头 Chrome 开 9500）：
 *   chrome --headless=new --remote-debugging-port=9500 --window-size=1707,1067 `
 *          --user-data-dir=$env:TEMP\robin-ik http://127.0.0.1:1420/
 *   $env:CDP_PORT='9500'; node tmp\probe-②撤销与抽屉.mjs
 *
 * ② 是纯前端页（碰不到 Rust），所以**不用假后端**，浏览器里就是它本来的样子。
 */
const PORT = process.env.CDP_PORT ?? '9500';
const APP = process.env.DEV_ORIGIN ?? 'http://127.0.0.1:1420';

const 停手 = 250; // 组件里那个 停手毫秒
const 合并 = 600; // History 的 coalesceMs
const 落定 = 停手 + 合并 + 350; // 等"改动落定 + 记一步"的余量

let 红 = 0;
let 绿 = 0;
const 断言 = (名, 过, 说明 = '') => {
  if (过) {
    绿++;
    console.log(`  ✅ ${名}${说明 ? ' —— ' + 说明 : ''}`);
  } else {
    红++;
    console.log(`  ❌ ${名}${说明 ? ' —— ' + 说明 : ''}`);
  }
};
const 没量到 = (名, 为什么) => console.log(`  ⚠️  ${名}：没量到 —— ${为什么}`);

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = list.find((x) => x.type === 'page' && !x.url.startsWith('devtools://'));
if (!t) {
  console.log(`连不上 http://127.0.0.1:${PORT}/json/list —— 先起无头 Chrome（见文件头）`);
  process.exit(2);
}
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

/** 界面上那行撤销读数（`i / n`），拿来当"记了几步"的尺子 */
const 读步数 = () =>
  跑(`(() => {
    const n = document.querySelector('.undobtns__n');
    if (!n) return { 有: false, 文: '', 步数: -1 };
    const 文 = (n.textContent || '').trim();
    const m = 文.match(/(\\d+)\\s*\\/\\s*(\\d+)/);
    return { 有: true, 文, 步数: m ? Number(m[2]) : -1 };
  })()`);

const 打键 = (key, ctrl, shift) =>
  跑(`(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', ctrlKey: ${!!ctrl}, shiftKey: ${!!shift}, bubbles: true, cancelable: true }));
    return 'ok';
  })()`);

/** 进某一路由并等它渲染完 */
async function 去(url, 毫秒 = 3200) {
  await rpc('Page.navigate', { url });
  await 等(毫秒);
  return 跑(`(() => ({
    路径: location.pathname + location.search,
    抽屉: !!document.querySelector('.wb__side'),
    撤销钮: !!document.querySelector('.undobtns'),
    悬浮球: !!document.querySelector('.fabs')
  }))()`);
}

console.log(`导航到 ${APP}/tools/ikclut …\n`);
const 起 = await 去(`${APP}/tools/ikclut`);
console.log('页面起来了吗：', JSON.stringify(起));
if (!起.撤销钮) {
  console.log('\n这一页没渲染出来（连撤销钮都没有）—— 后面不用量了。');
  ws.close();
  process.exit(2);
}

/* ==================================================================== 甲 */
console.log('\n==== 甲、抽屉一露出来，右下角那列悬浮球让不让位 ====');
console.log('点「参数」开抽屉：', await 跑(`(() => {
  const b = [...document.querySelectorAll('.fabs .fab')].find((x) => (x.textContent || '').trim() === '参数');
  if (!b) return '（没找到「参数」那颗钮）';
  b.click();
  return '点了';
})()`));
await 等(700);

const 几何 = await 跑(`(() => {
  const f = document.querySelector('.fabs');
  const s = document.querySelector('.wb__side');
  if (!f || !s) return { 在: false };
  const rf = f.getBoundingClientRect();
  const rs = s.getBoundingClientRect();
  const 相交 = !(rf.right <= rs.left || rf.left >= rs.right || rf.bottom <= rs.top || rf.top >= rs.bottom);
  const px = rs.right - 14;
  const py = rs.bottom - 14;
  const 命中 = document.elementFromPoint(px, py);
  const 谁 = !命中
    ? '（null）'
    : 命中.closest('.fabs')
      ? '悬浮球列'
      : 命中.closest('.wb__side')
        ? '抽屉'
        : 命中.tagName.toLowerCase() + (命中.className ? '.' + String(命中.className).split(' ')[0] : '');
  return {
    在: true,
    html类: document.documentElement.className,
    悬浮球: { 左: Math.round(rf.left), 右: Math.round(rf.right), 上: Math.round(rf.top), 下: Math.round(rf.bottom) },
    抽屉: { 左: Math.round(rs.left), 右: Math.round(rs.right), 上: Math.round(rs.top), 下: Math.round(rs.bottom) },
    相交,
    抽屉右下角命中: 谁,
    抽屉宽: Math.round(rs.width),
    悬浮球窄: Math.round(rf.width)
  };
})()`);
console.log(JSON.stringify(几何, null, 1));

if (!几何.在) {
  没量到('甲', '这一页没画出 .wb__side 或 .fabs');
} else {
  断言('抽屉真的滑出来了（html.side-open）', 几何.html类.includes('side-open'), 几何.html类);
  断言('悬浮球列和抽屉**不相交**', 几何.相交 === false, 几何.相交 ? `还在压着（球 ${几何.悬浮球.左}~${几何.悬浮球.右}，抽屉 ${几何.抽屉.左}~${几何.抽屉.右}）` : `球右缘 ${几何.悬浮球.右} < 抽屉左缘 ${几何.抽屉.左}`);
  断言('抽屉右下角那一点命中的是抽屉本身', 几何.抽屉右下角命中 === '抽屉', `命中：${几何.抽屉右下角命中}`);
  断言('悬浮球还在视口里（没被推出左边界）', 几何.悬浮球.左 > 0, `左缘 ${几何.悬浮球.左}`);
}

/* ==================================================================== 乙 */
console.log('\n==== 乙、点错了撤不撤得回来 ====');
console.log('\n-- 乙① 混合页的「4 张」 --');
const 混 = await 去(`${APP}/tools/ikclut?panel=blend`);
if (!混.撤销钮) {
  没量到('乙①', '混合分区没渲染出来');
} else {
  const 前 = await 读步数();
  console.log('改动之前：', JSON.stringify(前));
  console.log('点「4 张」：', await 跑(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '4 张');
    if (!b) return '（没找到「4 张」）';
    if (b.getAttribute('aria-pressed') === 'true') return '（本来就是 4 张）';
    b.click();
    return '点了';
  })()`));
  await 等(落定);
  const 后 = await 读步数();
  console.log('改动之后：', JSON.stringify(后));
  断言(
    '乙①：点「4 张」记了一步（步数 +1）',
    后.步数 >= 0 && 前.步数 >= 0 && 后.步数 === 前.步数 + 1,
    `${前.文 || '（没有读数）'} → ${后.文 || '（没有读数）'}`
  );

  await 打键('z', true, false);
  await 等(900);
  const 回去 = await 跑(`(() => {
    const b2 = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '2 张');
    const b4 = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '4 张');
    return { 二张: b2 ? b2.getAttribute('aria-pressed') : null, 四张: b4 ? b4.getAttribute('aria-pressed') : null };
  })()`);
  console.log('Ctrl+Z 之后：', JSON.stringify(回去));
  断言('乙①：Ctrl+Z 把张数退回 2 张', 回去.二张 === 'true' && 回去.四张 === 'false', JSON.stringify(回去));
}

console.log('\n-- 乙② 抽屉里的「抄参考图」 --');
const cl = await 去(`${APP}/tools/ikclut`);
if (!cl.抽屉) {
  没量到('乙②', '这一页没画出抽屉');
} else {
  /* 「抄参考图」要真有参考图才能点。先把「用程序生成的测试图」取消勾选，让参考图槽出现，
     再往槽上派一次**真的 HTML5 drop**（合成 File → DataTransfer → DragEvent）。
     这一步顺带量了 `drag-dom` 那条"别把同一次落放处理两遍"的改动。 */
  console.log('取消「用程序生成的测试图」：', await 跑(`(() => {
    const c = [...document.querySelectorAll('label.chk')].find((x) => (x.textContent || '').includes('用程序生成的测试图'));
    const i = c && c.querySelector('input[type=checkbox]');
    if (!i) return '（没找到那个勾）';
    if (i.checked) i.click();
    return i.checked ? '还是勾着的' : '取消了';
  })()`));
  await 等(900);

  const 丢 = await 跑(`(async () => {
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const g = cv.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 64, 64);
    gr.addColorStop(0, '#102030'); gr.addColorStop(1, '#e0d0c0');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    if (!blob) return '（toBlob 没给东西）';
    const f = new File([blob], '参考图.png', { type: 'image/png' });
    const 槽 = document.querySelector('[data-drop-key]') || document.querySelector('.slots .slot');
    if (!槽) return '（没找到参考图槽）';
    const dt = new DataTransfer();
    dt.items.add(f);
    const 派 = (类型) => 槽.dispatchEvent(new DragEvent(类型, { dataTransfer: dt, bubbles: true, cancelable: true }));
    派('dragenter'); 派('dragover'); 派('drop');
    return '丢了 ' + f.name;
  })()`);
  console.log('往参考图槽丢一张合成图：', 丢);
  await 等(1800);

  const 钮 = await 跑(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '抄参考图');
    return { 有: !!b, 禁用: b ? b.disabled : null, 按下: b ? b.getAttribute('aria-pressed') : null };
  })()`);
  console.log('「抄参考图」那颗钮：', JSON.stringify(钮));

  if (!钮.有 || 钮.禁用) {
    没量到('乙②', '参考图没进去，「抄参考图」还是禁用的（合成的那次 drop 没被收下）');
  } else {
    const 前 = await 读步数();
    console.log('改动之前：', JSON.stringify(前));
    await 跑(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '抄参考图'); b.click(); return 'ok'; })()`);
    await 等(落定);
    const 后 = await 读步数();
    console.log('改动之后：', JSON.stringify(后));
    断言(
      '乙②：切「抄参考图」记了一步（步数 +1）',
      后.步数 >= 0 && 前.步数 >= 0 && 后.步数 === 前.步数 + 1,
      `${前.文 || '（没有读数）'} → ${后.文 || '（没有读数）'}`
    );

    await 打键('z', true, false);
    await 等(900);
    const 回去 = await 跑(`(() => {
      const a = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '自己调');
      const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '抄参考图');
      return { 自己调: a ? a.getAttribute('aria-pressed') : null, 抄参考图: b ? b.getAttribute('aria-pressed') : null };
    })()`);
    console.log('Ctrl+Z 之后：', JSON.stringify(回去));
    断言('乙②：Ctrl+Z 退回「自己调」', 回去.自己调 === 'true' && 回去.抄参考图 === 'false', JSON.stringify(回去));
  }
}

console.log('\n-- 乙③ 「全部复位」是不是真的全部 --');
if (!cl.抽屉) {
  没量到('乙③', '这一页没画出抽屉');
} else {
  /* 拿抽屉里那个「蓝切片反序」当尺子：它属于旧 `resetParams` **不管**的那一批
     （旧版只回 基本 / 曲线 / 链形）。开了它再按「全部复位」，看它回不回去。 */
  console.log('勾上「蓝切片反序」：', await 跑(`(() => {
    const l = [...document.querySelectorAll('label.chk')].find((x) => (x.textContent || '').includes('蓝切片反序'));
    const i = l && l.querySelector('input[type=checkbox]');
    if (!i) return '（没找到那个勾）';
    if (!i.checked) i.click();
    return i.checked ? '勾上了' : '没勾上';
  })()`));
  await 等(落定);

  console.log('切到「基本」标签再按「全部复位」：', await 跑(`(() => {
    const t = [...document.querySelectorAll('.tabs__b')].find((x) => (x.textContent || '').trim() === '基本');
    if (t) t.click();
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '全部复位');
    if (!b) return '（没找到「全部复位」）';
    b.click();
    return '按了';
  })()`));
  await 等(落定);

  const 复位后 = await 跑(`(() => {
    const l = [...document.querySelectorAll('label.chk')].find((x) => (x.textContent || '').includes('蓝切片反序'));
    const i = l && l.querySelector('input[type=checkbox]');
    const 张 = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '2 张');
    return {
      切片反序还勾着: i ? i.checked : null,
      张数回到2: 张 ? 张.getAttribute('aria-pressed') : null,
      曲线线性: (() => { const b = [...document.querySelectorAll('.tabs__b')].find((x) => (x.textContent || '').trim() === '基本'); return !!b; })()
    };
  })()`);
  console.log('复位之后：', JSON.stringify(复位后));
  断言('乙③：「全部复位」把「蓝切片反序」也回掉了（旧版只回三样）', 复位后.切片反序还勾着 === false, `还勾着=${复位后.切片反序还勾着}`);
}

console.log(`\n==== ${绿} 过 / ${红} 红 ====`);
if (红) console.log('有红的就不是全绿 —— 别把这一条记成"验过了"。');

/* **收尾：把自己开的抽屉关掉。**
   抽屉的开合是**按路由记在 localStorage 里**的（`side.svelte.ts` 的 `robin.wb.side.v3`），
   这个探针开了 `tools/ikclut` 那一页的抽屉就走人了 —— 下一次跑 `tools/ui-audit.mjs --all`
   会带着"抽屉开着"进那几页，于是 `/tools/ikclut` 那一页的体检会判 FAIL。
   那次假红就是这么来的（量过：清掉那个键之后审计立刻回到 0）。
   探针自己弄脏的状态，探针自己收拾。 */
const 清 = await 跑(`(() => {
  const 前 = localStorage.getItem('robin.wb.side.v3');
  localStorage.removeItem('robin.wb.side.v3');
  return 前;
})()`);
console.log('清掉自己留下的抽屉状态：', 清);

ws.close();
process.exit(红 ? 1 : 0);
