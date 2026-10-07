/**
 * 工作区排布体检（规范 §10.5，**口径按 §十一 改过**）。
 *
 * **不许再拿"我看着行"当通过** —— 这条脚本连到带 `--remote-debugging-port` 的实例上，
 * 自己把视口设成用户的 1707×1067，逐页（模块 × 分区）量下面这些，出逐页表格；
 * **任何一项不过就是不过**（退出码非 0）。
 *
 * 怎么跑（**开窗那一次由用户来**）：
 *   $env:WEBVIEW2_USER_DATA_FOLDER = 'E:\C test\⑥验收\ui\wv2data'
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9333'
 *   pnpm tauri dev                 # 然后另开一个终端：
 *   node tools/ui-audit.mjs --all
 *
 * 也可以对着**同一个前端**在无头浏览器里量（布局是一样的，且不用开应用窗口）：
 *   pnpm dev
 *   chrome --headless=new --remote-debugging-port=9400 --window-size=1707,1067 http://127.0.0.1:1420/
 *   $env:CDP_PORT=9400; $env:AUDIT_BASE=http://127.0.0.1:1420/; node tools/ui-audit.mjs --all
 *
 * 量什么（§十一 是"中区＝整幅、参数＝浮层抽屉"，§八 的"收窄/可收起"已被否掉）：
 *   ① 中区＝整幅：**中区右边不留空**（除了页面自己的左右留白，没有别的列在吃宽度）
 *   ② 横向滚动元素数 = 0                §十一 末尾「横向滚动一律不许有」
 *   ③ 非浮层的列在吃宽度 = 0             §十一「除了侧边导航，没有别的列在吃宽度」
 *   ④ 抽屉**默认是收起的**（没滑出来）    §十一
 *   ⑤ btn--primary 恰好 1 个（**只数"用户在页面上看得见"的那些**）  §10.3
 *      —— 2026-09-23 用户拍板：规范的意图是"**用户在页面上只看到一个主按钮**"，
 *      不是"DOM 里只有一个"。所以**收起状态下停在视口外的**（参数抽屉里的那些）、
 *      以及祖先 `display:none` / `visibility:hidden` / `<details>` 没打开的，**都不算**。
 *      确认"这一页/这一分区本来就没有主操作"的走 `零主按钮白名单`（理由写在表里，记 ok）。
 *   ⑥ 重叠 / 溢出 = 0                   §10.4（吸附元素压住内容是规范要求的，不算）
 *   ⑦ **有 `.wb__side` 就必须有能打开它的控件**（2026-09-23 加）
 *      —— 十个模块页的参数栏原来停在视口外、一个开关都没有，等于没有参数
 *   ⑧ **"停在视口外"不再算"收起"**：收起不收起看 `<html>` 上的 `.side-open`；
 *      开着却还停在视口外 = 够不着，算 FAIL（老判据拿几何位置当"收起"，会把⑧这类漏过去）
 *   ⑨ **启动幕布没撤 = FAIL**（2026-09-23 加）
 *      —— `.bootwrap--hidden` 挂着就是整个主界面 `opacity: 0`，这时候"可见主按钮"当然是 0。
 *      实测踩过：`/tools/ikclut` 有个 effect 自己写自己抛 `effect_update_depth_exceeded`，
 *      幕布再也不撤；老判据把这读成"§10.3 少了主按钮"，差一点去给它硬补一个按钮。
 *      **真因要单独报**：这一项红的时候先去控制台找抛错，别照着 primary 0 改界面。
 *   ⑩ **主按钮待的地方是 `.wb__acts`（主区最后一行，吸底）**，不许放进 `.wb__side` 参数抽屉 ——
 *      抽屉默认收起、停在视口外，主按钮跟着一起看不见（这一轮的 16 行 FAIL 全是这个）。
 *      可量：`可见主按钮 1 个` 且它在 `.wb__main` 里。
 * 另外顺手报：中区宽度、视口−导航宽、抽屉宽度、开抽屉后的中区宽（§十一 那条 ±16 的算式）。
 *
 * 分区怎么发现：认**分区条的 `<button class="seg__btn">`**（点一遍、读地址栏）。
 * 原来认 `a[href*=panel]` —— 分区条根本不是链接，所以每个模块只量到默认分区。
 * （工作区那两页 `recent` / `quick` 当年报的 `primary=0` 就是同一个误报：量的是首页那种卡片布局。
 *   两页 2026-10-08 已删。）
 */
const PORT = process.env.CDP_PORT ?? '9333';
const BASE = `http://127.0.0.1:${PORT}`;
const 视口宽 = Number(process.env.AUDIT_W ?? 1707);
const 视口高 = Number(process.env.AUDIT_H ?? 1067);
/** 每页最多量几个分区（模块多起来别把时间拖爆） */
/* 每个模块最多量几个分区。原来是 4，于是**⑦ 那 10 个分区只量到 4 个**、
   ④ msToon 的 FaceSDF 也没量过（它排第 5）—— 都是"表里看不出缺"的那种漏。
   现在按最长的那个模块给足（⑦ = 10），要缩短用 `AUDIT_PANELS=4`。 */
const 最多分区 = Number(process.env.AUDIT_PANELS ?? 12);
/** 每个模块最多量几个（排查时用 AUDIT_MAX 收窄） */
const 最多模块 = Number(process.env.AUDIT_MAX ?? 40);
/** 只量这一页：AUDIT_ONLY=/tools/migrate */
const 只要 = process.env.AUDIT_ONLY ?? '';

/**
 * **允许 0 个主按钮的白名单**（2026-09-23 用户拍板："没有主操作的页不要硬造按钮"）。
 *
 * 只在"**确认这一页/这一分区本来就没有那一个主操作**"时才写进来，理由必须能站住：
 *   · 纯信息 / 导航 / 启动器页 —— 动作是"一格一格/一行一行"的，整页没有唯一主操作；
 *   · 调参分区自己不写盘 —— 写盘是**同一个模块另一个分区**的事（那一条有主按钮）。
 * 具体某一次测量"恰好没有"（例如数据没载入、按钮被 `{#if}` 藏了）**不写进来** ——
 * 那是状态，不是这一页的属性。
 * 键 = 体检表里的标签**去掉 `+展开`**，精确匹配（不写通配，免得把同一模块别的分区也放过去）。
 */
const 零主按钮白名单 = new Map([
  /* 原来的两条（`/tools/recent` 最近工程、`/tools/quick` 快捷动作）随那两页 2026-10-08 一起删了。
     现在一张空表：**没有页面允许 0 个主按钮**。 */
]);

let idc = 0;
function rpc(ws, method, params = {}) {
  const id = ++idc;
  return new Promise((res, rej) => {
    const on = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener('message', on);
      if (m.error) rej(new Error(JSON.stringify(m.error)));
      else res(m.result);
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => rej(new Error('rpc 超时：' + method)), 20000);
  });
}

async function 目标() {
  let r;
  try {
    r = await fetch(`${BASE}/json/list`);
  } catch {
    console.error(
      `连不上 http://127.0.0.1:${PORT}/json/list —— 现在没有带调试端口的实例在跑。\n` +
        `应用窗口：$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=${PORT}'; pnpm tauri dev\n` +
        `无头浏览器（不用开应用窗口）：pnpm dev 之后\n` +
        `  chrome --headless=new --remote-debugging-port=${PORT} --window-size=${视口宽},${视口高} http://127.0.0.1:1420/`
    );
    process.exit(2);
  }
  const list = await r.json();
  const p = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
  if (!p) {
    console.error('调试端口通了，但没有页面目标 —— 窗口/页面可能还没加载完，等一下再跑。');
    process.exit(2);
  }
  return p;
}

const 表达式 = (展开) => `
(async () => {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  /* **量之前把动画推到终态**：页面有入场动画（enter-scale 0.95 + rise），抽屉也有 220ms 滑出。
     动画没走完就读矩形，量到的是中间值 —— 实测主区 clientWidth 1339 而矩形宽 1274
     （1274/1339 ≈ 0.95，正好是入场缩放），表现为同一页一会儿过一个不过。
     getAnimations().finish() 把它们直接跳到终点，最省事也最准。 */
  const 定住 = async () => {
    for (const a of document.getAnimations?.() ?? []) {
      try { a.finish(); } catch { /* 已经结束的动画 finish 会抛，忽略 */ }
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };
  const 根 = document.documentElement;
  await 定住();
  const 主 = document.querySelector('.wb__main') || document.querySelector('[class*=main]');
  const 抽屉 = document.querySelector('.wb__side');
  const 视口 = { w: innerWidth, h: innerHeight };

  /* 左边导航有多宽：壳里那条固定列（内容区用 margin-left 让开它） */
  let 导航宽 = 0;
  for (const e of document.querySelectorAll('[class*=side], nav, aside')) {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    if (r.left < 4 && r.height > 200 && (s.position === 'fixed' || s.position === 'absolute' || s.position === 'sticky')) {
      导航宽 = Math.max(导航宽, Math.round(r.width));
    }
  }
  if (!导航宽) {
    const 主左 = 主 ? 主.getBoundingClientRect().left : 0;
    导航宽 = Math.round(主左);
  }

  /* 展开全部 <details>（更多工具/说明那类），量"所有分区都摊开"的样子 */
  const 我开的 = [];
  if (${展开}) {
    for (const d of document.querySelectorAll('details')) {
      if (!d.open) { d.open = true; 我开的.push(d); }
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }

  /* ① 横向滚动：内容比容器宽 */
  const 横滚 = [];
  for (const e of document.querySelectorAll('*')) {
    if (e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1) {
      const s = getComputedStyle(e);
      if (s.overflowX === 'visible' || s.overflowX === 'hidden') continue; /* 不是"可滚动"，是别的问题，别重复报 */
      横滚.push({ 类: (e.className || e.tagName).toString().slice(0, 60), 超: e.scrollWidth - e.clientWidth });
    }
  }

  /* ② 重叠：同一父容器里的兄弟两两求交。
     规则：**吸附（sticky/fixed）元素压住内容是规范要求的行为**（§一 的底栏就是吸底的），
     所以只算"静态流里的兄弟互相压"。 */
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
        if (w > 1 && h > 1) {
          重叠.push(((子[i].className || 子[i].tagName) + ' ∩ ' + (子[j].className || 子[j].tagName)).toString().slice(0, 70));
        }
      }
    }
  }

  /* ③ 溢出：超出最近滚动祖先的可见区。
     **浮层不算**（§十一 的参数抽屉是 position:fixed 盖在上面的，它本来就落在内容框外面）。 */
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
        if (r.left < pr.left - 1 || r.right > pr.right + 1 || r.top < pr.top - 1) {
          溢出.push((e.className || e.tagName).toString().slice(0, 50));
        }
        break;
      }
      p = p.parentElement;
    }
  }

  const 主矩形 = 主 ? 主.getBoundingClientRect() : null;
  /* 中区右边还剩多少空：**除了页面自己的留白，不该再有东西**（§十一） */
  const 右空 = 主矩形 ? Math.round(innerWidth - 主矩形.right) : -1;
  /* 非浮层的列在吃宽度：静态流里、跟中区并排、还占着宽度的兄弟 */
  const 吃宽列 = [];
  if (主) {
    for (const e of document.querySelectorAll('.wb > *, .wb__main ~ *')) {
      if (e === 主 || !(e instanceof HTMLElement)) continue;
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      if (s.position === 'fixed' || s.position === 'absolute') continue; /* 浮层不算 */
      const r = e.getBoundingClientRect();
      const 并排 = r.left >= 主矩形.right - 2 && r.width > 8 && r.height > 40;
      if (并排) 吃宽列.push((e.className || e.tagName).toString().slice(0, 40));
    }
  }
  const 抽屉画 = 抽屉 ? 抽屉.getBoundingClientRect() : null;
  /* 抽屉收没收起**看 html 上的类**（.side-open 是产品自己写的状态），
     不看几何位置 —— 老判据是"左边 >= 视口宽就算收起"，那会把"停在视口外、根本够不着"
     也读成"收起 ✓"（十个模块页的参数栏就是这么漏过去的）。 */
  const 开着 = 根.classList.contains('side-open');
  /* 参数开关：路由壳统一出的那个（aria-pressed + 文字「参数」） */
  const 参数钮 = [...document.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-pressed') !== null && /参数/.test(b.textContent ?? '')
  );
  /* 抽屉停在视口外没有（收起来时就该在外面；**开着**还在外面 = 够不着） */
  const 抽屉在外 = !!抽屉画 && (抽屉画.width === 0 || 抽屉画.left >= innerWidth - 2);

  /* 主按钮**只数看得见的**（§10.3 的意图是"用户在页面上只看到一个主按钮"）：
     祖先 display:none / visibility:hidden / <details> 没打开的、停在外面的（收起时的参数抽屉）、
     以及矩形是 0 的，都不算。 */
  const 可见 = (e) => {
    let p = e;
    while (p && p !== document.documentElement) {
      const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
      if (p.tagName === 'DETAILS' && !p.open) return false;
      p = p.parentElement;
    }
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    /* 视口外不算（右边那条收起状态的参数抽屉正是这种情况；上下滚出视口也算看不见） */
    if (r.right <= 1 || r.bottom <= 1 || r.left >= innerWidth - 1 || r.top >= innerHeight - 1) return false;
    return true;
  };
  const 全部主按钮 = [...document.querySelectorAll('button.btn--primary')];
  const 可见主按钮 = 全部主按钮.filter(可见);

  /* ⑪ **主按钮点得到吗**（2026-09-23 B5）。
     用户报的是「打包到输出目录」被应用**真正的底栏**（footer.sb，fixed bottom:0）压住、
     点不到 —— 几何上看那个按钮在视口里、"可见"，但它的中心点命中的是底栏。
     判据用 elementFromPoint：**中心点命中的必须是按钮自己或它的后代**。
     钉的是"写盘条不许被任何底栏挡住"（bottom 让开 --status-h + 层级在状态栏之上）。 */
  const 命中谁 = (el) => {
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(x, y);
    if (!hit) return { 可点: false, 挡: '（视口外，命不中）' };
    const 是它 = hit === el || el.contains(hit);
    return { 可点: 是它, 挡: 是它 ? '' : (hit.className || hit.tagName).toString().slice(0, 48) };
  };
  const 点数 = 可见主按钮.map(命中谁);
  const 点不到 = 点数.filter((x) => !x.可点);

  /* 启动幕布撤没撤。盖着的时候 .bootwrap--hidden ＝ 整个主界面 opacity:0，
     这时候量什么都是"0 个可见"—— 那是**这一页没显出来**，不是排布问题。 */
  const 幕 = document.querySelector('.bootwrap');
  const 幕布没撤 = !!幕 && 幕.classList.contains('bootwrap--hidden');

  const 量 = {
    视口: 视口,
    有工作区: !!document.querySelector('.wb'),
    幕布没撤,
    导航宽,
    视口减导航: 视口.w - 导航宽,
    中区: 主矩形 ? Math.round(主矩形.width) : -1,
    右空,
    吃宽列: 吃宽列.length, 吃宽列例: 吃宽列.slice(0, 3),
    抽屉宽: 抽屉画 ? Math.round(抽屉画.width) : 0,
    有侧栏: !!抽屉,
    有开关: !!参数钮,
    抽屉开着: 开着,
    抽屉在外,
    主按钮: 可见主按钮.length,
    主按钮例: 可见主按钮.map((b) => (b.textContent || '').trim().slice(0, 14)),
    主按钮看不见的: 全部主按钮.length - 可见主按钮.length,
    主按钮点不到: 点不到.length,
    主按钮点不到例: 点不到.map((x, i) => (可见主按钮[点数.indexOf(x)]?.textContent?.trim().slice(0, 12) ?? '?') + ' ← ' + x.挡),
    横滚: 横滚.length, 横滚例: 横滚.slice(0, 3),
    重叠: 重叠.length, 重叠例: 重叠.slice(0, 3),
    溢出: 溢出.length, 溢出例: 溢出.slice(0, 3),
    页: location.pathname + location.search
  };

  /* 顺手量一次"抽屉滑出来盖在上面"时中区有没有被挤窄（§十一：盖住、不挤压）。
     **用页面自己的那个开关开、量完再点回来关** —— 原来直接往 html 上挂 side-open 类，
     关回去的时机跟过渡/动画搅在一起，实测第二次量就报"抽屉开着"：
     那是脚本自己留下的状态，不是产品的毛病（产品的口径以"刚进页面"那一次最准）。 */
  if (参数钮 && !开着) {
    /* **点完要把过渡推到终态再量**：抽屉滑出是 220ms 的 transform 过渡，
       两帧就量的话拿到的是"刚滑 3%"的位置（左边还在视口外），
       于是报出"点了参数还是够不着"这种假问题（实测就是这么假红过）。 */
    await 定住();
    参数钮.click();
    await 定住();
    量.抽屉开出后中区 = 主 ? Math.round(主.getBoundingClientRect().width) : -1;
    量.点开后抽屉在外 = !!document.querySelector('.wb__side') &&
      (() => { const r = document.querySelector('.wb__side').getBoundingClientRect();
        return r.width === 0 || r.left >= innerWidth - 2; })();
    参数钮.click();
  } else {
    量.抽屉开出后中区 = 量.中区;
    量.点开后抽屉在外 = false;
  }
  /* 收尾：等动画/过渡到终态，免得下一次量到中间态 */
  await 定住();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  for (const d of 我开的) d.open = false;
  return 量;
})()
`;

async function 量一页(ws, 展开) {
  const r = await rpc(ws, 'Runtime.evaluate', { expression: 表达式(展开), returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
}

async function 去(ws, url) {
  await rpc(ws, 'Page.navigate', { url });
  /* **等页面稳下来再量**：分区组件是懒加载的，固定等 1.6s 有时还没挂上，
     量出的主按钮数/中区宽度就跟着变（实测同一条命令两次跑同一页结果不一致）。
     这里连两次读到同一个"签名"（正文长度 + 主按钮数 + 有没有 .wb）才算稳。
     签名里**带上"启动幕布撤了没有"** —— 只说"两次读到一样"是不够的：
     幕布还盖着的时候（`bootwrap--hidden` ＝ 整块 `opacity: 0`）内容也是稳定不变的，
     于是量出来"可见主按钮 0 个"，看起来像 §10.3 的问题，其实是这一页根本没显出来。
     实测就是 `/tools/ikclut`：那里有个 effect 自己写自己，抛 `effect_update_depth_exceeded`，
     幕布再也不撤，主界面永远停在透明上 —— 旧签名读成"稳定"，报的是"primary 0"。 */
  let 上 = '';
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const r = await rpc(ws, 'Runtime.evaluate', {
      returnByValue: true,
      expression:
        "(() => { const b = document.body; const w = document.querySelector('.bootwrap');" +
        " const 幕 = !w ? 'none' : (w.classList.contains('bootwrap--hidden') ? 'hidden' : 'shown');" +
        " return [b ? b.innerText.length : -1, document.querySelectorAll('button.btn--primary').length," +
        " document.querySelector('.wb') ? 1 : 0, 幕].join('|'); })()"
    });
    const 今 = String(r.result?.result?.value ?? '');
    /* 幕布还在 → 还没到"可以量"的时候，就算连着两次一样也接着等 */
    if (今 && 今 === 上 && !今.endsWith('hidden')) return;
    上 = 今;
  }
}

async function 发现(ws) {
  /* 模块与分区**从页面里发现**（左导航的 href、分区条的 href），铺开时不用改这张表 */
  await 去(ws, new URL('/', 根址).toString());
  const r = await rpc(ws, 'Runtime.evaluate', {
    expression: `[...document.querySelectorAll('a[href^="/tools/"]')].map(a=>a.getAttribute('href')).filter((v,i,s)=>s.indexOf(v)===i)`,
    returnByValue: true
  });
  let 模块 = r.result.value ?? [];
  if (只要) 模块 = 模块.filter((x) => x.includes(只要));
  return 模块.slice(0, 最多模块);
}

const 页 = await 目标();
/* 应用根：页面停在 about:blank 时要靠 AUDIT_BASE（无头浏览器直接开 about:blank 很常见） */
const 根址 = (() => {
  if (process.env.AUDIT_BASE) return process.env.AUDIT_BASE;
  if (/^https?:/.test(页.url)) return 页.url;
  return 'http://127.0.0.1:1420/';
})();
const ws = new WebSocket(页.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = () => rej(new Error('连不上调试端口'));
});
ws.addEventListener('message', () => {});
await rpc(ws, 'Emulation.setDeviceMetricsOverride', {
  width: 视口宽,
  height: 视口高,
  deviceScaleFactor: 1,
  mobile: false
});

const 名单 = process.env.AUDIT_URL
  ? [process.env.AUDIT_URL]
  : process.argv.includes('--all')
    ? await 发现(ws)
    : [new URL(根址).pathname + new URL(根址).search];
if (!名单.length) {
  console.error('没发现任何模块路由 —— 页面是不是没加载完？');
  process.exit(2);
}

const 行 = [];
let 全过 = true;
for (const 路由 of 名单) {
  await 去(ws, new URL(路由, 根址).toString());
  const 分区 = process.env.AUDIT_URL
    ? { result: { value: [] } } /* 指定单页时不再去翻分区条 */
    : await rpc(ws, 'Runtime.evaluate', {
        /* 分区条是 `<button class="seg__btn">`（点它走 goto 改地址栏），**不是链接** ——
           原来认 `a[href*=panel]` 只量到默认分区，各模块其余分区一个都没量过。 */
        expression: `(async () => {
          const 出 = [];
          const 钮 = [...document.querySelectorAll('nav.seg .seg__btn')];
          for (const b of 钮) {
            b.click();
            await new Promise((r) => setTimeout(r, 150));
            const u = location.pathname + location.search;
            if (!出.includes(u)) 出.push(u);
          }
          return 出.slice(0, ${最多分区});
        })()`,
        returnByValue: true,
        awaitPromise: true
      });
  const 名单2 = [...new Set([路由, ...(分区.result.value ?? [])])];
  for (const u of 名单2) {
    /* **每一行都重新导航一遍**。发现分区那一步是在当前文档里点按钮的，
       点完文档停在"最后一个分区"上；原来第一行不导航，于是那一行标签写着 /tools/xxx、
       量的却是点完分区之后的那份文档（实测 primary 数就是被这条带偏的）。 */
    await 去(ws, new URL(u, 根址).toString());
    for (const 展开 of [false, true]) {
      const 起 = Date.now();
      const m = await 量一页(ws, 展开);
      /* 逐条打进度：整轮要跑几十条路由、最后才出表，中间卡住时看不出卡在哪一条
         （2026-09-23 实测一轮跑了 7 分钟没出结果，只能猜）。 */
      console.log(`  … ${u}${展开 ? ' +展开' : ''}（${Date.now() - 起}ms）`);
      /* **还没有工作区版面的页记 n/a，不算 FAIL**（⑥ 先做，其余照规范 §五 一页页铺开）——
         但只要页面已经有 `.wb`，判据一条都不放过。口径按 §十一：
         中区＝整幅（右边不留空、没有非浮层的列在吃宽度、抽屉默认收起），横向滚动一律不许有。
         另加两条（2026-09-23）：**有 `.wb__side` 就必须有能打开它的开关**；
         **"停在视口外"不算"收起"** —— 开着还停在外面（够不着）算 FAIL。
         `主按钮` 只数看得见的；确认为"本来就没有主操作"的页/分区走白名单（记 ok，理由打在旁边）。 */
      m.标签 = (u.startsWith('http') ? new URL(u).pathname + new URL(u).search : u) + (展开 ? ' +展开' : '');
      const 白名 = 零主按钮白名单.get(m.标签.replace(' +展开', '')) ?? '';
      m.白名单理由 = m.主按钮 === 0 ? 白名 : '';
      const 主按钮过 = m.主按钮 === 1 || (m.主按钮 === 0 && !!白名);
      const 过 = m.有工作区 && m.横滚 === 0 && m.重叠 === 0 && m.溢出 === 0 && 主按钮过 &&
        m.右空 <= 32 && m.吃宽列 === 0 && !m.幕布没撤 &&
        !m.抽屉开着 && (!m.有侧栏 || m.有开关) && !m.点开后抽屉在外 &&
        m.主按钮点不到 === 0;
      if (m.有工作区) 全过 &&= 过;
      m.过 = 过;
      行.push(m);
      if (展开) break; /* 展开态只在"有 details"时才额外量一次，够了 */
    }
  }
}

const 头 = ['页', '中区px', '视口-导航', '右空px', '吃宽列', '侧栏', '开关', '抽屉', '开抽屉后中区', 'primary', '点得到', '横滚', '重叠', '溢出', '过?'];
console.log(头.join('\t'));
for (const m of 行) {
  if (!m.有工作区) {
    console.log([m.标签, 'n/a', 'n/a', 'n/a', 'n/a', `${m.有侧栏 ? '有' : '无'}`, `${m.有开关 ? '有' : '无'}`, m.抽屉开着 ? '开着' : '收起', 'n/a', `${m.主按钮}`, 'n/a', `${m.横滚}`, `${m.重叠}`, `${m.溢出}`, 'n/a（还没工作区版面）'].join('\t'));
    continue;
  }
  const 抽屉列 = m.点开后抽屉在外
    ? '开着但够不着 ✗'
    : m.抽屉开着
      ? '开着'
      : '收起';
  const 开关列 = m.有侧栏 ? (m.有开关 ? '有' : '没有 ✗') : '无侧栏';
  console.log(
    [
      m.标签,
      m.中区,
      m.视口减导航,
      `${m.右空}${m.右空 <= 32 ? '' : ' ✗'}`,
      `${m.吃宽列}${m.吃宽列 ? ' ✗' : ''}`,
      m.有侧栏 ? '有' : '—',
      开关列,
      抽屉列,
      m.抽屉开出后中区,
      `${m.主按钮}${m.主按钮 === 1 ? '' : m.白名单理由 ? '（白名单）' : ' ✗'}`,
      `${m.主按钮点不到 ? '挡住 ✗' : 'ok'}`,
      `${m.横滚}${m.横滚 ? ' ✗' : ''}`,
      `${m.重叠}${m.重叠 ? ' ✗' : ''}`,
      `${m.溢出}${m.溢出 ? ' ✗' : ''}`,
      m.过 ? 'ok' : 'FAIL'
    ].join('\t')
  );
}
console.log('\n---- 不过的那些，附前三条例子 ----');
for (const m of 行.filter((x) => !x.过)) {
  if (!m.有工作区) continue;
  console.log(`\n${m.标签}  中区 ${m.中区}px（视口−导航 ${m.视口减导航}） / 右空 ${m.右空}px / 抽屉 ${m.抽屉宽}px / primary ${m.主按钮}${m.主按钮例?.length ? `（${m.主按钮例.join('、')}）` : ''}`);
  if (m.主按钮 === 0 && !m.白名单理由) console.log('  一个主按钮都没有 —— 要么给它一个（整页唯一那个"干这件事"的按钮），要么写进体检脚本的「零主按钮白名单」并写清理由');
  if (m.幕布没撤) console.log('  启动幕布没撤（`.bootwrap--hidden` 挂着 ＝ 整页 opacity:0）—— **这一页根本没显出来**，不是排布问题。先看控制台有没有抛错（`node tmp\\probe-报错.mjs <路由>`），别照着 primary 0 去补按钮');
  if (m.主按钮点不到) console.log(`  **主按钮点不到**（${m.主按钮点不到} 个，命中的是别的元素）：${m.主按钮点不到例.join('、')} —— 这就是 B5「写盘条被底栏挡住」。查 bottom 有没有让开 --status-h、层级有没有高过 --z-status（⑥ 的 .foot 与全局 .wb__acts）`);
  if (m.主按钮 > 1) console.log(`  主按钮多于一个（还有 ${m.主按钮看不见的} 个是看不见的，没算）—— 只留整页唯一那个，其余降成次级`);
  if (m.有侧栏 && !m.有开关) console.log('  参数抽屉有、开关没有 —— 这一页的参数**够不着**（排查：路由壳那个「参数」按钮在不在）');
  if (m.点开后抽屉在外) console.log('  点了「参数」抽屉仍停在视口外 —— 够不着（查 `.side-open` 那条 CSS 与抽屉宽度）');
  for (const k of ['吃宽列例', '横滚例', '重叠例', '溢出例']) {
    if (m[k]?.length) console.log(`  ${k}: ` + JSON.stringify(m[k]));
  }
}
const 白名单命中 = 行.filter((x) => x.有工作区 && x.白名单理由);
if (白名单命中.length) {
  console.log('\n---- 允许 0 个主按钮（白名单，理由）----');
  for (const m of 白名单命中) console.log(`  ${m.标签}：${m.白名单理由}`);
}
const 待铺 = 行.filter((x) => !x.有工作区).map((x) => x.标签);
if (待铺.length) {
  console.log(`\n---- 还没有工作区版面（n/a，规范 §五 的铺开清单）----\n  ${[...new Set(待铺)].join('  ')}`);
}
console.log(全过 ? '\n有工作区版面的页全部通过。' : '\n有不过的 —— 任何一项不过就是不过。');
ws.close();
process.exit(全过 ? 0 : 1);
