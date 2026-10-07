<script lang="ts">
  import Sidebar from './Sidebar.svelte';
  import Icon from './Icon.svelte';
  import { rail, railMini, panel } from '$lib/ui.svelte';
  import { side, 抽屉, 开抽屉 } from '$lib/side.svelte';
  import { prefs, apply } from '$lib/prefs.svelte';
  import { toggleTheme, originOf } from '$lib/theme';
  import { ELEMENTS } from '$lib/elements';
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { page } from '$app/state';

  let {
    children,
    title = '',
    subtitle = ''
  }: { children: Snippet; title?: string; subtitle?: string } = $props();

  let ready = $state(false);

  /* 本页底栏有多高 → `--bbar-h`（挂 `<html>` 内联样式）。
     底栏 = `.wb__acts` / `.foot` / `.wbar--foot`，都是 `sticky; bottom: var(--status-h)`。
     要它的高度是因为两样东西得跟着让位：右下角那两颗球（不然压在写盘条上，
     ③ 养乐多写入 / ② 调色 实测压着），还有参数抽屉（不然抽屉最后一行被写盘条压住点不到）。
     只算**已经吸到屏幕底**的那一条；页面短、底栏还在半空时算 0 —— 那时它碰不到贴底的球。 */
  /* 一屏里还剩多少能装内容 → `--page-fill`（挂 `<html>` 内联样式）。
     工作区拿它当最小高度（见路由壳 `.panel-host`）：底栏是 `sticky; bottom: …`，
     内容比一屏短时它没东西可吸，就停在正文末尾悬在半空 —— 打开参数抽屉，那条不透明的
     写盘条正好横切在抽屉中间（2026-09-23 实测 ⑥/⑦/⑤/④：底栏停在 516/585/603/625，
     抽屉中线被切成"抽屉 / 底栏 / 抽屉"三段）。
     算式 = 尾栏顶边(视口底 − --status-h) − panel-host 的**文档坐标**上边。
     用文档坐标（加 scrollY）是为了"量的时候刚好滚了一半"也能算出同一个值。
     `.work` 的底内边距必须正好是 `--status-h`，多一个像素都会让短页面冒出滚动条。 */
  function 量一屏() {
    const 根 = document.documentElement;
    const 尾 = parseFloat(getComputedStyle(根).getPropertyValue('--status-h')) || 30;
    const 主区 = document.querySelector('.panel-host');
    if (!主区) {
      if (根.style.getPropertyValue('--page-fill')) 根.style.removeProperty('--page-fill');
      return;
    }
    const 上边 = 主区.getBoundingClientRect().top + window.scrollY;
    const 值 = `${Math.max(0, Math.round(window.innerHeight - 尾 - 上边))}px`;
    if (根.style.getPropertyValue('--page-fill') !== 值) 根.style.setProperty('--page-fill', 值);
  }

  function 量底栏() {
    const 根 = document.documentElement;
    const 尾 = parseFloat(getComputedStyle(根).getPropertyValue('--status-h')) || 30;
    const 底线 = window.innerHeight - 尾;
    let 高 = 0;
    for (const 条 of document.querySelectorAll('.wb__acts, .foot, .wbar--foot')) {
      const r = 条.getBoundingClientRect();
      if (r.height < 1) continue;
      if (r.bottom >= 底线 - 8) 高 = Math.max(高, Math.min(r.height, 底线));
    }
    const 值 = `${Math.round(高)}px`;
    if (根.style.getPropertyValue('--bbar-h') !== 值) 根.style.setProperty('--bbar-h', 值);
  }

  /* 把"侧栏收起来了"这件事挂到 <html> 上。
     之前只挂在 .shell 上，结果 CSS 里 `html[data-mini] .bg { left: ... }` 永远匹配不到 ——
     1040px 那种窄窗下侧栏已经收成 52px，背景层却还从 336px 起，左边空出 284px。
     挂到 html 上，任何组件都能用这个选择器。 */
  $effect(() => {
    const m = String(railMini());
    if (document.documentElement.dataset.mini !== m) {
      document.documentElement.dataset.mini = m;
    }
  });

  onMount(() => {
    apply();
    ready = true;

    // 窗口窄到放不下侧栏时自动收成图标带
    const mq = matchMedia('(max-width: 1180px)');
    const sync = () => (rail.narrow = mq.matches);
    sync();
    mq.addEventListener('change', sync);

    // 点别处收面板
    const away = (e: PointerEvent) => {
      if (!panel.open) return;
      const t = e.target as HTMLElement;
      if (t.closest('.sheet') || t.closest('[data-panel-toggle]')) return;
      panel.open = false;
    };
    document.addEventListener('pointerdown', away);

    // 底栏高度：进页面先量一次，之后内容一变（切分区、加载完）重量
    量一屏();
    量底栏();
    const ro = new ResizeObserver(() => { 量一屏(); 量底栏(); });
    ro.observe(document.body);
    window.addEventListener('resize', 量一屏);
    window.addEventListener('resize', 量底栏);

    return () => {
      mq.removeEventListener('change', sync);
      document.removeEventListener('pointerdown', away);
      ro.disconnect();
      window.removeEventListener('resize', 量一屏);
      window.removeEventListener('resize', 量底栏);
    };
  });

  // 换页要重量（各页底栏和正文高度都不一样）；面板收起时球从两列变一列，也顺手量一次
  $effect(() => {
    page.url.pathname;
    抽屉.有;
    if (ready) { 量一屏(); 量底栏(); }
  });

  $effect(() => {
    if (ready) {
      apply();
      rail.collapsed = prefs.collapsed;
    }
  });
</script>

<Sidebar />

<div class="shell" data-mini={railMini()}>
  <header class="bar glass">
    <div class="bar__crumb">
      <h1 class="bar__title">{title}</h1>
      {#if subtitle}<span class="bar__sub">{subtitle}</span>{/if}
    </div>

    <div class="bar__tools">
      <!-- 这里原来有一颗「当前工程」胶囊（2026-10-06 加的，接 `recent.svelte.ts` 的
           `当前工程`）。**2026-10-07 用户要求删掉**："右上角也不要显示当前的过程"。
           工程名现在只在**底部状态栏**那一条上显示（`StatusBar.svelte`，同一个来源），
           别再往这一行加回来。 -->

      <div class="elems" role="group" aria-label="元素配色">
        {#each ELEMENTS as el (el.id)}
          <button
            class="elem"
            class:on={prefs.hue === el.hue}
            type="button"
            title={el.name}
            aria-label={el.name}
            style="--sw: {el.c}"
            onclick={() => {
              prefs.hue = el.hue;
              apply();
            }}
          ></button>
        {/each}
      </div>

      <button
        class="switch"
        type="button"
        data-mode={prefs.theme}
        title={prefs.theme === 'light' ? '切到深色' : '切到浅色'}
        aria-label="切换深浅色"
        onclick={(e) => toggleTheme(originOf(e.currentTarget))}
      >
        <!-- 两个图标叠着，靠旋转 + 淡入淡出换位（实测那一套的做法，300ms） -->
        <span class="switch__slot" class:on={prefs.theme === 'light'}>
          <Icon name="ui.light" size={17} />
        </span>
        <span class="switch__slot" class:on={prefs.theme === 'dark'}>
          <Icon name="ui.dark" size={17} />
        </span>
      </button>
    </div>
  </header>

  <main class="work vt-page">{@render children()}</main>
</div>

<!-- 右下角悬浮球。要坐在状态栏上面，所以 bottom 按 --status-h 算。
     「参数」跟「外观」同槽同层（用户 2026-09-23：那颗按钮挪到应用右下角，别跟页面自己的头一行挤）。
     只有这一页真画了参数抽屉（`抽屉.有`，路由壳探的）才出来。 -->
<div class="fabs">
  {#if 抽屉.有}
    <button
      class="fab fab--pill"
      class:fab--on={side.open}
      type="button"
      aria-pressed={side.open}
      title="参数从右边滑出来，盖在工作区上面、不占宽度"
      onclick={() => 开抽屉(!side.open)}
    >参数</button>
  {/if}
  <button
    class="fab"
    class:fab--on={panel.open}
    type="button"
    data-panel-toggle
    aria-label="外观设置"
    aria-expanded={panel.open}
    title="外观设置"
    onclick={() => (panel.open = !panel.open)}
  >
    <Icon name="ui.tune" size={18} />
  </button>
</div>

<style>
  .shell {
    margin-left: var(--rail-width);
    min-height: 100svh;
    display: flex;
    flex-direction: column;
    /* **跟侧栏用同一个时长**。原来是 `--t-enter`(350ms)，而侧栏自己的 width 和
       背景那层用的是 `--t-side`(300ms) —— 时长差 50ms，收起/展开的过程中
       **轨道边缘和正文左缘不同步**，那 50ms 里两边差着一段，看着就是"衔接错位"
       （用户 2026-09-26："边栏伸缩你确定真的衔接错位感不明显了吗"）。
       三处（`.side` / `.bg[data-scope=work]` / 这里）现在都是 `--t-side` + `--ease-std`，
       动起来是一条边在走。 */
    transition: margin-left var(--t-side) var(--ease-std);
  }
  .shell[data-mini='true'] { margin-left: var(--rail-collapsed); }

  .bar {
    position: sticky;
    top: 0;
    z-index: var(--z-bar);
    display: flex;
    align-items: center;
    gap: 16px;
    height: var(--navbar-height);
    padding: 0 var(--edge);
    background: var(--bar-bg);
    border-bottom: 1px solid var(--line-divider);
  }
  .bar__crumb { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
  .bar__title { font-size: var(--fs-lg); line-height: var(--lh-lg); white-space: nowrap; }
  .bar__sub {
    font-size: var(--fs-xs); line-height: var(--lh-xs); color: var(--content-meta);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .bar__tools { margin-left: auto; display: flex; align-items: center; gap: 14px; }

  /* 主题切换按钮。本体只负责按下缩放，动画全在图标上 ——
     换色是 0ms 生效的（见 rules 里对 background-color 的处理），点下去立刻有反应。 */
  .switch {
    position: relative;
    display: grid;
    place-items: center;
    width: 34px; height: 34px;
    padding: 0;
    border: 0;
    border-radius: var(--r-md);
    background: transparent;
    color: var(--content-meta);
    cursor: pointer;
    transition: background var(--t-micro) var(--ease-std),
                color var(--t-micro) var(--ease-std),
                transform var(--t-press) var(--ease-std);
  }
  .switch:hover { background: var(--rail-item-hover); color: var(--deep-text); }
  .switch:active { transform: scale(var(--press-scale)); }
  .switch__slot {
    position: absolute;
    display: grid;
    place-items: center;
    opacity: 0;
    transform: rotate(-90deg);
    transition: opacity var(--t-side) var(--ease-std), transform var(--t-side) var(--ease-std);
  }
  .switch__slot.on { opacity: 1; transform: none; }
  /* 动效关掉时别转，直接换 */
  :global(:root[data-motion='off']) .switch__slot { transition-duration: 1ms; }

  /* 七个元素色点：点一下换主题色，比拖滑杆快 */
  .elems { display: flex; gap: 5px; }
  .elem {
    width: 17px; height: 17px; padding: 0;
    border: 2px solid transparent;
    border-radius: 50%;
    background: var(--sw);
    cursor: pointer;
    transition: transform var(--t-micro) var(--ease-std), border-color var(--t-micro) var(--ease-std);
  }
  .elem:hover { transform: translateY(-2px) scale(1.12); }
  .elem.on { border-color: var(--deep-text); }

  .work {
    flex: 1;
    /* 内容在可用宽度里居中，不是靠左顶死；底下留出状态栏高度，最后一行不会被盖。
       底内边距**只能是 `--status-h`**：工作区靠它算出"一屏还剩多少"（`--page-fill`），
       底栏要正好钉在尾栏顶边上。多留一点（原来多留 32px）短页面就会多出一条 32px 的滚动条。 */
    padding: 24px var(--edge) var(--status-h);
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .work > :global(*) {
    width: 100%;
    max-width: var(--page-measure);
  }

  /* 悬浮球列：按 --status-h + 本页底栏（--bbar-h，上面量的）让位 */
  .fabs {
    position: fixed;
    right: var(--edge);
    bottom: calc(var(--status-h) + var(--bbar-h, 0px) + var(--fab-gap));
    z-index: var(--z-fab);
    display: flex;
    flex-direction: column;
    gap: var(--fab-gap);
    transition: right var(--t-panel, 220ms) var(--ease-std);
  }
  /* **抽屉一露出来，这列就得让位。**
     不让位的话那颗「参数」正好压在它自己唤出来的抽屉右下角，把最后一行参数盖住
     （用户 2026-09-26 报的"参数按钮挡住参数唤出的边栏"）。
     算一下就明白为什么必中：抽屉 `right: 8px`、宽 `--side-w`（≥12rem），
     悬浮球 `right: var(--edge)`（16px）—— 水平方向一定落在抽屉里面；
     而 `--z-fab: 70` 比 `--z-drawer: 20` 高，所以是**盖在上面**。
     两种"露出来"都要让：滑出（`side-open`）和钉住（`side-pin`）。
     第二个值是兜底：视口很窄时别把球推出左边界。 */
  :global(html.side-open) .fabs,
  :global(html.side-pin) .fabs {
    right: min(
      calc(var(--edge) + var(--side-w, 18rem) + var(--fab-gap)),
      calc(100vw - var(--rail-collapsed) - var(--fab-size) - 12px)
    );
  }
  .fab {
    display: grid; place-items: center;
    width: var(--fab-size); height: var(--fab-size);
    border: var(--card-border);
    border-radius: 50%;
    background: var(--card-bg);
    color: var(--btn-content);
    box-shadow: var(--card-shadow);
    cursor: pointer;
    transition: transform var(--t-micro) var(--ease-std),
                background var(--t-micro) var(--ease-std),
                box-shadow var(--t-micro) var(--ease-std);
  }
  .fab:hover { transform: translateY(-2px) scale(1.06); box-shadow: var(--card-shadow-hover); }
  .fab:active { transform: scale(var(--press-scale)); }
  .fab--on { background: var(--primary); color: #fff; }
  /* 「参数」是胶囊不是圆球：光一个图标说不清它是"参数"，圆球里也塞不下两个字 */
  .fab--pill {
    width: auto;
    min-width: var(--fab-size);
    padding: 0 12px;
    border-radius: var(--r-full);
    font-size: var(--fs-2xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    font-family: inherit;
  }

  @media (max-width: 900px) {
    .bar { padding: 0 12px; }
  }
  @media (max-width: 720px) {
    .elems { display: none; }
  }
</style>
