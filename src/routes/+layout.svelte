<script lang="ts">
  import '../styles/tokens.css';
  import '../styles/wb.css';
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import { onNavigate } from '$app/navigation';
  import AppShell from '$lib/components/AppShell.svelte';
  import Backdrop from '$lib/components/Backdrop.svelte';
  import StatusBar from '$lib/components/StatusBar.svelte';
  import SettingsPanel from '$lib/components/SettingsPanel.svelte';
  import ProgressBar from '$lib/components/ProgressBar.svelte';
  import Intro from '$lib/components/Intro.svelte';
  import { chrome, panel, boot } from '$lib/ui.svelte';
  import { initFromSystem, apply, prefs } from '$lib/prefs.svelte';
  import { load as loadBgs } from '$lib/bg-store.svelte';
  import { drag } from '$lib/drag.svelte';
  import { bringIn } from '$lib/drag-dom';
  /* 引一下就为副作用：它会在求值时把「记最近工程」那个钩子挂到 io.ts 上。
     不引的话，直接用快捷动作跳进某个功能页时选目录不会记 —— 只有先进过
     最近工程那页才会挂上，那种"有时记有时不记"最难查。 */
  import '$lib/recent.svelte';

  let { children }: { children: Snippet } = $props();

  /** /welcome 是不带侧栏的独立页 */
  const bare = $derived((page.url?.pathname ?? '/') === '/welcome');

  /** 交叉淡入跑完了（把过渡摘掉，别一直挂着） */
  let bootDone = $state(false);

  /* 自己导入的壁纸存在 IndexedDB 里，进来先读一遍 */
  onMount(() => {
    loadBgs().catch((e) => console.warn('[bg] 读取失败', e));

    /* 从窗口外拖文件进来。挂在这一层是因为它跟当前在哪个模块无关，
       而且桌面端只有原生拖放那条能拿到真路径（见 drag-dom.ts）。
       原先挂在 tools/[id] 上的那对 window 监听一起撤了 —— 那不是它的活。 */
    const stopDrag = bringIn(drag);

    return () => {
      stopDrag();
    };
  });

  /* ---------- 入场动画的窗口 ----------
     `tokens.css` 里 `.rise` 平时**没有**动画，只有 `html[data-enter='true']`
     那一小段才挂上（rise-in / rise-soft）。所以这里管的是"什么时候开、什么时候关"。

     为什么是"开一小段"而不是"常挂 + 条件暂停"：后一种写法里那个标记一旦置上
     就永远是 true，闸门等于不存在 —— 每跳一次路由 `.rise` 就重播一遍
     （用户说的"工作区每次选中后都重新冒出来"就是它；真机量过，点侧栏换页
     `running` 又出现）。

     **什么时候开**：幕布开始撤的那一下（`boot.reveal`），不是挂载那一刻。
     以前是挂载就开 —— 幕布还盖着，内容在背后已经把动画跑完了，撤幕布时早定格，
     读起来就是硬切。现在幕布淡出和内容淡入＋错峰进场是同一段时间。
     关：这一批动画跑完，或者 1.6s 兜底（万一某个元素没触发 animationend）。 */
  $effect(() => {
    if (!boot.reveal) return;
    const root = document.documentElement;
    root.dataset.enter = 'true';
    const closeEnter = () => {
      if (root.dataset.enter !== undefined) delete root.dataset.enter;
    };
    const enterTimer = setTimeout(closeEnter, 1600);
    const onRiseEnd = (e: AnimationEvent) => {
      if (e.animationName !== 'rise-in' && e.animationName !== 'rise-soft') return;
      closeEnter();
    };
    root.addEventListener('animationend', onRiseEnd, true);
    return () => {
      clearTimeout(enterTimer);
      root.removeEventListener('animationend', onRiseEnd, true);
      closeEnter();
    };
  });

  /* 开场动画要等的东西：字体 + 第一张壁纸。
     不等的话会看到字体先渲染再跳一下，壁纸也是从空白淡进来。
     结果写进共享的 `boot.ready` —— 幕布拿它决定何时开始撤，主界面拿它决定何时进场。 */
  onMount(() => {
    const fontReady = document.fonts?.ready ?? Promise.resolve();
    const imgReady = new Promise<void>((r) => {
      const img = document.querySelector('.bg__im') as HTMLImageElement | null;
      if (!img || img.complete) return r();
      img.addEventListener('load', () => r(), { once: true });
      img.addEventListener('error', () => r(), { once: true });
    });
    Promise.all([fontReady, imgReady]).then(() => (boot.ready = true));
    /* 兜底：4 秒还没就绪就硬开。
       不兜的话，字体或那张壁纸卡住（老机器上真会）＝ 幕布永远不撤，
       而现在主界面还压在 opacity:0 里 —— 那就成了"整个应用白屏"。
       宁可早开一秒，也不能不开。 */
    const force = setTimeout(() => (boot.ready = true), 4000);
    return () => clearTimeout(force);
  });

  /* 换页转场：内容区进退场。
     名字只在导航期间挂上（html[data-nav]），否则切主题时内容区也会跟着滑一下。 */
  onNavigate((nav) => {
    if (typeof document === 'undefined' || !document.startViewTransition) return;
    if (prefs.motion === 'off') return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    document.documentElement.dataset.nav = '1';
    return new Promise<void>((resolve) => {
      const vt = document.startViewTransition(async () => {
        resolve();
        await nav.complete;
      });
      vt.finished.finally(() => {
        delete document.documentElement.dataset.nav;
      });
    });
  });

  onMount(() => {
    initFromSystem();
    apply();

    // 进入视口一次性触发
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.06 }
    );
    /**
     * 只盯**新加进来那几个节点**，不做全文档查询。
     *
     * 原来这里是 `new MutationObserver(() => document.querySelectorAll('.reveal:not(.is-in)'))` ——
     * 全站任何一次 DOM 增删都会触发一次**整篇文档**的选择器匹配：表格重画、
     * 点一下按钮加涟漪、列表刷新，全都算。页面越大扫得越久，低配机器上就是
     * 莫名其妙的一顿一顿。而 `.reveal` 全工程只有欢迎页在用。
     *
     * 现在按增量的子树找，代价跟"这次加了几个节点"成正比，跟文档多大无关。
     */
    const watch = (node: Node) => {
      if (node.nodeType !== 1) return;
      const el = node as Element;
      if (el.classList?.contains('reveal') && !el.classList.contains('is-in')) io.observe(el);
      el.querySelectorAll?.('.reveal:not(.is-in)').forEach((n) => io.observe(n));
    };
    /* 首屏那一批是已经挂在文档里的，先整体扫一次 */
    document.querySelectorAll('.reveal:not(.is-in)').forEach((el) => io.observe(el));
    const mo = new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) watch(n);
    });
    mo.observe(document.body, { childList: true, subtree: true });

    /* 指针跟随高光整段删了 —— 就是那圈跟着鼠标走的蓝色径向渐变，
       铺在卡片的圈角框里。CSS 那边也一起删了。 */

    /* ---------- 点击涟漪 ----------
       一个委托监听管全站：按钮、导航项、快捷动作卡、分段控件点下去都从指针处扩散一圈。

       图层：宿主加 .ripple-host（position:relative + overflow:hidden + isolation:isolate），
       涟漪自己 z-index: var(--z-content) —— **盖在图标和文字上面**（用户 2026-09-20 定的）。
       更早那版是 z-index:-1（画在内容之下），结果宿主里的定位元素会把它翻上来盖住，
       看着就是"有时有有时没有"。

       尺寸：按"点到最远那个角"算直径，贴边点就小、点中间就大，铺满宿主即可，
       所以关键帧从 scale(0) 到 scale(1)。原来固定 max(宽,高)×1.2 再放大 2.6 倍，
       跟点在哪儿无关，小按钮上还会漫出去。 */
    const RIPPLE_HOSTS =
      '.btn, .quick__it, .seg__b, .seg__btn, .leaf, .elem, .pick__b, .slot__hit, .fab, .sb__btn, .chip';
    const down = (e: PointerEvent) => {
      if (prefs.motion === 'off') return;
      if (e.button !== 0) return;
      const host = (e.target as HTMLElement)?.closest?.(RIPPLE_HOSTS) as HTMLElement | null;
      if (!host) return;
      // 清理上一次留下的：动画没跑完就被打断的（切页、元素被重建）会留在这儿，
      // 不清掉的话守卫会把后面所有点击都挡掉，等于涟漪"点一次就不动了"。
      // 实测踩过：孤儿节点停在第 0 帧，看着就是彻底坏了。
      for (const old of host.querySelectorAll(':scope > .ripple')) {
        const anims = old.getAnimations?.() ?? [];
        const running = anims.some((a) => a.playState === 'running');
        if (!running) old.remove();
      }
      if (host.querySelector(':scope > .ripple')) return;

      // overflow:hidden 会把宿主裁掉，所以记下原值，涟漪结束后还回去
      const hadClass = host.classList.contains('ripple-host');
      if (!hadClass) host.classList.add('ripple-host');

      const r = host.getBoundingClientRect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      // 到四个角里最远的那个的距离 ×2 = 直径
      const radius = Math.max(
        Math.hypot(cx, cy),
        Math.hypot(r.width - cx, cy),
        Math.hypot(cx, r.height - cy),
        Math.hypot(r.width - cx, r.height - cy)
      );
      const size = radius * 2;

      const s = document.createElement('span');
      s.className = 'ripple';
      s.style.width = s.style.height = `${size}px`;
      s.style.left = `${cx - radius}px`;
      s.style.top = `${cy - radius}px`;
      s.addEventListener('animationend', () => {
        s.remove();
        // 只还自己加的那个类，别把本来就有的删了
        if (!hadClass && !host.querySelector(':scope > .ripple')) {
          host.classList.remove('ripple-host');
        }
      });
      host.appendChild(s);
    };
    addEventListener('pointerdown', down, { passive: true });

    // Alt + 1…7 快速切元素配色
    const hues = [175, 75, 305, 125, 230, 40, 200];
    const keys = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 7) {
        e.preventDefault();
        prefs.hue = hues[n - 1];
        apply();
      }
    };
    addEventListener('keydown', keys);

    return () => {
      io.disconnect();
      mo.disconnect();
      removeEventListener('pointerdown', down);
      removeEventListener('keydown', keys);
    };
  });
</script>

<ProgressBar />

{#if bare}
  <!-- 欢迎页自己有一套开场，不再套一层 -->
  {@render children()}
{:else}
  <!-- 幕布盖着的时候主界面先不显：等幕布开始撤，这边同时淡入 —— 两边叠着完成交接。
      淡完把过渡也摘掉（`opacity: 1` 不留层叠上下文，留着 transition 也没意义）。 -->
  <div
    class="bootwrap"
    class:bootwrap--hidden={!boot.reveal}
    class:bootwrap--settled={bootDone}
    ontransitionend={(e) => {
      if (e.target === e.currentTarget && e.propertyName === 'opacity') bootDone = true;
    }}
  >
    <Backdrop />
    <AppShell title={chrome.title} subtitle={chrome.subtitle}>
      {@render children()}
    </AppShell>
    <StatusBar />
    <SettingsPanel bind:open={panel.open} />
  </div>

  <!-- 进入界面的加载动画。资源到位 + 最短时长走完就撤 -->
  <Intro label="RobinEditor" ready={boot.ready} />
{/if}

<style>
  /* 交叉淡入：幕布淡出的同一段时间里，主界面从 0 走到 1。
     时长跟幕布一致（都取 --t-boot），才会读成"一次交接"而不是两段动画。 */
  .bootwrap {
    transition: opacity var(--t-boot) var(--ease-std);
  }
  .bootwrap--hidden {
    opacity: 0;
  }
  .bootwrap--settled {
    transition: none;
  }
</style>
