<script lang="ts">
  /**
   * 侧栏。
   *
   * 条目的三个状态照 lin-xin 的导航来（.nav-link + .nav-indicator + .lx-popover-item）：
   *   悬浮  中性灰底 + translateX(2px)
   *   按下  translateX(1px) scale(0.985) + opacity .85
   *   选中  **不铺底色**，只有左侧 4px 圆角渐变条 + 字变深变粗
   *
   * 条子的颜色是低彩度石板蓝（--accent-solid），不是 --primary 那种高彩度蓝。
   * 之前拿主色当指示色、再叠一层淡蓝底，两样加起来就是那圈蓝色光晕。
   */
  import { NAV, NAV_FOOT, type NavGroup, type NavLeaf } from '$lib/modules/registry';
  import Icon from './Icon.svelte';
  import { rail, railMini, err, clearErr } from '$lib/ui.svelte';
  import { prefs, save } from '$lib/prefs.svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';

  /* 换页/换模块时把手边那条窗口级报错收掉 —— 用户已经走开了，再挂着就成了噪音 */
  $effect(() => {
    void page.url.pathname;
    clearErr();
  });

  /** 展开的一级分组 */
  let open = $state<Set<string>>(new Set(['work', 'texture']));

  const path = $derived(page.url?.pathname ?? '/');
  const mini = $derived(railMini());

  function toggle(g: NavGroup) {
    const s = new Set(open);
    if (s.has(g.id)) s.delete(g.id);
    else s.add(g.id);
    open = s;
  }

  /** 收起状态（手动或窗口太窄）下点一级 */
  function headClick(g: NavGroup) {
    if (!mini) {
      toggle(g);
      return;
    }
    // 窄屏是被迫收起的，展开不了 —— 只能去它第一项
    if (rail.narrow) {
      const first = g.children?.[0];
      if (first) goto(leafHref(first));
      return;
    }
    // 手动收起时点分组图标：展开侧栏并把这一组打开。
    // 原来这里是直接跳第一项，结果收起之后每组里只有第一个功能进得去，
    // ILM / msToon 那几个根本点不到。
    rail.collapsed = false;
    prefs.collapsed = false;
    save();
    open = new Set([...open, g.id]);
  }

  function expandRail() {
    rail.collapsed = false;
    prefs.collapsed = false;
    save();
  }

  /** 总览就是首页，其余走 /tools/<id> */
  function leafHref(l: NavLeaf) {
    return l.id === 'overview' ? '/' : `/tools/${l.id}`;
  }
  function isCurrent(l: NavLeaf) {
    return l.id === 'overview' ? path === '/' : path.startsWith(`/tools/${l.id}`);
  }
</script>

<aside class="side glass" class:side--mini={mini}>
  <div class="side__brand">
    <img class="side__mark" src="/app-icon.png" alt="" width="22" height="22" />
    {#if !mini}<span class="side__name">RobinEditor</span>{/if}
    {#if !rail.narrow && !mini}
      <button
        class="side__fold"
        type="button"
        title="收起侧栏"
        aria-label="收起侧栏"
        onclick={() => {
          rail.collapsed = true;
          prefs.collapsed = true;
          save();
        }}
      >
        <Icon name="ui.collapse" size={16} />
      </button>
    {/if}
  </div>

  <nav class="side__nav" aria-label="主导航">
    {#each NAV as g (g.id)}
      {@const isOpen = open.has(g.id)}
      <div class="grp" class:grp--open={isOpen}>
        <button
          class="grp__head"
          type="button"
          aria-expanded={mini ? undefined : isOpen}
          title={mini ? g.label : undefined}
          onclick={() => headClick(g)}
        >
          <Icon name={g.icon} size={18} />
          {#if !mini}
            <span class="grp__label">{g.label}</span>
            <Icon name="ui.caret" size={14} cls="grp__caret" />
          {/if}
        </button>

        {#if !mini && g.children}
          <div class="grp__body" style="grid-template-rows:{isOpen ? 1 : 0}fr">
            <div class="grp__clip">
              <ul class="leafs">
                {#each g.children as l (l.id)}
                  <li>
                    <a
                      class="leaf"
                      class:leaf--cur={isCurrent(l)}
                      href={leafHref(l)}
                      title={l.ready === false ? `${l.title}（还没做）` : l.title}
                    >
                      <Icon name={l.icon} size={16} cls="leaf__ic" />
                      <span class="leaf__txt">{l.label}</span>
                      {#if l.ready === false}<span class="leaf__soon">待做</span>{/if}
                    </a>
                  </li>
                {/each}
              </ul>
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </nav>

  <div class="side__foot">
    {#if err.text && !mini}
      <p class="side__err" role="status">
        <Icon name="ui.warn" size={14} />
        <span>{err.text}</span>
        <button class="side__errx" type="button" title="知道了" aria-label="知道了" onclick={clearErr}>
          <Icon name="ui.close" size={12} />
        </button>
      </p>
    {/if}
    {#if mini && !rail.narrow}
      <button class="grp__head grp__head--link" type="button" title="展开侧栏" aria-label="展开侧栏" onclick={expandRail}>
        <Icon name="ui.expand" size={18} />
      </button>
    {/if}
    {#each NAV_FOOT as g (g.id)}
      <a class="grp__head grp__head--link" href={g.href} title={g.label}>
        <Icon name={g.icon} size={18} />
        {#if !mini}<span class="grp__label">{g.label}</span>{/if}
      </a>
    {/each}
  </div>
</aside>

<style>
  .side {
    position: fixed;
    top: 0;
    left: 0;
    /* 停在状态栏上沿：状态栏整条贯通全宽，z 在侧栏之上 */
    bottom: var(--status-h);
    z-index: var(--z-side);
    width: var(--rail-width);
    display: flex; flex-direction: column;
    /* 底色走 --side-bg（含 a-side 那层 alpha），悬浮模糊由 .glass 单独管 */
    background: var(--side-bg);
    border-right: var(--card-border);
    transition: width var(--t-side) var(--ease-std);
    /* 进场：translateX(-2rem) + 淡入，300ms（数值来自实测记录） */
    animation: side-in var(--t-side) var(--ease-in-quad) both;
  }
  @keyframes side-in {
    from { opacity: 0; transform: translateX(-2rem); }
    to   { opacity: 1; transform: none; }
  }
  .side--mini { width: var(--rail-collapsed); }

  .side__brand {
    display: flex; align-items: center; gap: 9px;
    height: var(--navbar-height); padding: 0 12px 0 16px;
    border-bottom: 1px solid var(--line-divider);
    flex: none;
  }
  .side__mark {
    width: 22px; height: 22px;
    border-radius: var(--r-md);
    object-fit: cover;
    flex: none;
    display: block;
  }
  .side__name {
    font-weight: 700; font-size: var(--fs-lg); letter-spacing: var(--tracking-tight);
    color: var(--deep-text); white-space: nowrap;
  }
  .side__fold {
    margin-left: auto; display: grid; place-items: center;
    width: 28px; height: 28px; border: 0; border-radius: var(--r-md);
    background: transparent; color: var(--content-meta); cursor: pointer;
    transition: background var(--t-micro) var(--ease-std),
                color var(--t-micro) var(--ease-std),
                transform var(--t-press) var(--ease-std);
  }
  .side__fold:hover { background: var(--rail-item-hover); color: var(--deep-text); }
  .side__fold:active { transform: scale(var(--press-scale)); }

  .side__nav { flex: 1; overflow-y: auto; padding: 10px 8px 6px; }

  /* 兜底：侧栏的分组容器是 .grp，而工作台也用了同名类（wb.css）。
     上一轮就是 `wb.css` 的 `.grp { padding: 12px 16px }` 漏进来，
     52px 收窄栏里内容宽只剩 3.33px，`.grp__head` 的 width:100% 跟着塌到 3.33px，
     再被自己的 overflow:hidden 一裁 —— 图标就变成一条竖线。
     现在 wb.css 那边加了 .wb 前缀，这里再显式清一次零，双保险。 */
  .side__nav .grp { padding: 0; margin-bottom: 2px; }

  .grp { margin-bottom: 2px; }
  .grp__head {
    position: relative; overflow: hidden; isolation: isolate;
    display: flex; align-items: center; gap: 10px; width: 100%;
    padding: 9px 10px; border: 0; border-radius: var(--r-md);
    background: transparent; color: var(--body-text); cursor: pointer;
    font: inherit; font-size: var(--fs-sm); font-weight: 600; text-align: left;
    transition: background-color var(--t-micro) var(--ease-std),
                color var(--t-micro) var(--ease-std);
  }
  .grp__head:hover { background: var(--rail-hover); color: var(--deep-text); }
  .grp__head:active { background: var(--rail-item-active); }
  .grp--open > .grp__head { color: var(--deep-text); }
  .grp__label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .grp__head :global(.grp__caret) {
    opacity: 0.5;
    transition: transform var(--t-micro) var(--ease-std);
  }
  .grp--open :global(.grp__caret) { transform: rotate(90deg); }

  /* 二级展开：grid-template-rows 0fr → 1fr，300ms */
  .grp__body { display: grid; transition: grid-template-rows var(--t-side) var(--ease-std); }
  .grp__clip { overflow: hidden; min-height: 0; }

  .leafs { list-style: none; margin: 0; padding: 2px 0 8px; }

  .leaf {
    position: relative;
    display: flex; align-items: center; gap: 8px;
    padding: 7px 10px 7px 12px;
    border-radius: var(--r-md);
    font-size: var(--fs-sm);
    color: var(--content-meta);
    background-color: transparent;
    transition: background-color var(--t-micro) var(--ease-std),
                color var(--t-micro) var(--ease-std),
                transform var(--t-micro) var(--ease-std);
  }
  .leaf :global(.leaf__ic) {
    opacity: 0.7;
    transition: opacity var(--t-micro) var(--ease-std), color var(--t-micro) var(--ease-std);
  }

  /* 悬浮：中性灰底 + 右移 2px。位移取自 lin-xin .lx-popover-item:hover 的 translate(2px) */
  .leaf:hover {
    background-color: var(--rail-hover);
    color: var(--deep-text);
    transform: translateX(2px);
    text-decoration: none;
  }
  .leaf:hover :global(.leaf__ic) { opacity: 1; }

  /* 按下：位移收回 1px 并轻微缩一下，也是 lin-xin 的值 */
  .leaf:active {
    background-color: var(--rail-press);
    transform: translateX(1px) scale(0.985);
    opacity: 0.85;
  }

  /* 选中：**没有底色**。只有左侧那条和字从暗变亮。
     条子照 lin-xin .nav-indicator 的做法，4px 圆角渐变加 18% 的辉光，转 90°。
     重点在彩度：--accent-solid 是低彩度的石板蓝（lin-xin 用的 #6f8fb4），
     不是 --primary 那种高彩度蓝。以前拿主色当指示色，再加一层淡蓝底，
     两样叠起来才是那圈蓝色光晕。 */
  .leaf--cur {
    color: var(--deep-text);
    font-weight: 600;
    text-decoration: none;
  }
  .leaf--cur :global(.leaf__ic) { opacity: 1; color: var(--accent-solid); }
  .leaf--cur::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: var(--rail-mark-w);
    height: var(--rail-mark-h);
    border-radius: var(--r-full);
    background: var(--accent-solid);
    transition: height var(--t-micro) var(--ease-std);
  }

  .leaf__txt { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .leaf__soon {
    flex: none; font-size: 10px; padding: 1px 6px; border-radius: var(--r-full);
    background: var(--surface-3); color: var(--content-meta); font-weight: 600;
  }

  .side__foot {
    flex: none; padding: 8px; border-top: 1px solid var(--line-divider);
    display: flex; flex-direction: column; gap: 2px;
  }

  /* 窗口层出的错挂在这儿。字号跟导航条目一致，别再大一号把侧栏顶开 */
  .side__err {
    display: flex; align-items: flex-start; gap: 7px;
    margin: 0 0 4px; padding: 8px 9px;
    border: 1px solid color-mix(in oklab, var(--warn) 45%, var(--line));
    border-radius: var(--r-md);
    background: color-mix(in oklab, var(--warn) 10%, transparent);
    color: var(--body-text);
    font-size: var(--fs-2xs); line-height: var(--lh-sm);
    overflow-wrap: anywhere;
  }
  .side__err :global(svg) { flex: none; color: var(--warn); margin-top: 1px; }
  /* 叉：自己没有颜色、不抢视觉，鼠标上去才显出来 */
  .side__errx {
    flex: none; margin: -2px -3px -2px 0; padding: 2px 3px;
    border: 0; border-radius: var(--r-sm); background: none; cursor: pointer;
    color: var(--content-meta); opacity: 0.7;
    transition: opacity var(--t-micro) var(--ease-std), background-color var(--t-micro) var(--ease-std);
  }
  .side__errx:hover { opacity: 1; background: color-mix(in oklab, var(--warn) 18%, transparent); }
  .side__errx :global(svg) { margin: 0; }
  .grp__head--link { text-decoration: none; }
  .grp__head--link:hover { text-decoration: none; }

  /* 图标的最小可见宽度。`.grp__head` 有 overflow:hidden（为了裁掉子项展开动画的溢出），
     一旦按钮被压窄，图标就会被裁成细条而不是缩小 —— 所以卡住下限，
     宁可让按钮溢出父容器，也不让它窄到把图标切掉。 */
  .side__nav .grp__head { min-width: calc(18px + 16px); }

  .side--mini .side__brand { padding: 0; justify-content: center; }
  .side--mini .grp__head { min-width: 2.5rem; justify-content: center; padding: 10px 0; }
</style>
