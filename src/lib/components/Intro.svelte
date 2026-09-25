<script lang="ts">
  /**
   * 进入界面的加载动画。
   *
   * 三个动作按顺序走，不是一起上：
   *   1. 标记（那张方图）先淡入并轻微缩放上来
   *   2. 名字逐字推入，每个差 35ms
   *   3. 进度条开始跑，跑满 → 通知外面「要撤了」→ 幕布淡出 **同时**主界面淡入
   *
   * **这里不放涟漪**（用户明确要求开屏不要涟漪）：就标记 + 名字 + 进度条，
   * 安静地把人领进去。
   *
   * 时长不是死的：外层给 ready，收到就加速跑完剩下的。
   * 最短 1600ms：本地热缓存下 30ms 就绪，短了等于没放（用户反馈"加载动画过短"）。
   * 上限 3000ms：别为了过场把人卡在门口。
   *
   * 第 3 步的"同时"是这一轮加的：以前幕布自己淡出，而主界面在背后早就入场完毕，
   * 看起来就是硬切。现在 `boot.reveal` 一置位，`+layout` 那边才开始淡入 + 跑 `.rise`。
   *
   * 动效关掉时不做逐字，直接显示 + 短暂停。
   */
  import { onMount } from 'svelte';
  import { boot } from '$lib/ui.svelte';

  let { label = 'RobinEditor', ready = false }: { label?: string; ready?: boolean } = $props();

  const MIN_MS = 1600;
  const MAX_MS = 3000;
  const STAGGER = 35;
  /**
   * 幕布撤完（opacity 过渡走完）到卸载之间的余量。
   * 真实时长由 `--t-boot` 给（见 tokens.css），这里只兜一点。
   */
  const GONE_SLACK_MS = 120;
  /** transitionend 不来的兜底。比 --t-boot 宽裕得多 */
  const GONE_FALLBACK_MS = 2000;
  /** 进度条两个刻度之间至少隔这么久 —— 30fps，别为了一根条跑满 60fps */
  const TICK_GATE_MS = 33;

  let born = $state(0);
  let pct = $state(0);
  let leaving = $state(false);
  let gone = $state(false);
  let curtain: HTMLDivElement | null = $state(null);

  const chars = $derived([...label]);

  onMount(() => {
    born = performance.now();
    // 进度条：爬到 85% 等 ready，ready 来了再冲到 100%
    const start = performance.now();
    let raf = 0;
    let last = 0;

    /* 进度条：
       没就绪时按 MAX_MS 缓出爬到 85%，到那儿停住等着；
       就绪之后按 MIN_MS 铺满 —— 不能直接跳到 100%。
       本地热缓存下 ready 几乎瞬间就到，直接跳满的话这根条等于没动过。
       按 30fps 走：这根条一帧动不到一个像素，60fps 纯属白烧 CPU（低配机器上还在开机阶段）。 */
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < TICK_GATE_MS) return;
      last = now;
      const el = now - start;
      const slow = 0.85 * (1 - Math.pow(1 - Math.min(1, el / MAX_MS), 2));
      pct = ready ? Math.min(1, Math.max(pct, el / MIN_MS)) : Math.max(pct, slow);
      if (pct >= 1) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  $effect(() => {
    if (!ready || gone) return;
    const elapsed = performance.now() - born;
    const wait = Math.max(0, MIN_MS - elapsed);
    const t = setTimeout(() => (leaving = true), wait);
    return () => clearTimeout(t);
  });

  /* 开始撤 = 通知主界面进场。**在这个 effect 里置位**，不要写进上面的 setTimeout 里：
     那样在动效关掉 / 直接卸载的路径上会漏掉，主界面就一直停在透明上。 */
  $effect(() => {
    if (leaving) boot.reveal = true;
  });

  /**
   * 卸载时机跟幕布**真的撤完**绑一起，不写死一个毫秒数。
   * 写死的话过渡时长一改就错，而且是两处各自维护的数字。
   */
  $effect(() => {
    if (!leaving || gone) return;
    const fallback = setTimeout(() => (gone = true), GONE_FALLBACK_MS);
    return () => clearTimeout(fallback);
  });

  function onCurtainEnd(e: TransitionEvent) {
    if (e.propertyName !== 'opacity') return;
    if (!leaving) return;
    setTimeout(() => (gone = true), GONE_SLACK_MS);
  }

  /**
   * 进场动画的窗口由 `+layout` 管（它挂 `data-enter`、跑完就摘掉）。
   * 幕布这边不用管 —— 以前这里置过一个标记，后来因为"标记一旦置上就永远是 true"
   * 反而让每次换页都重播，那段删了。
   */
</script>

{#if !gone}
  <div
    class="intro"
    class:intro--out={leaving}
    aria-hidden={leaving}
    bind:this={curtain}
    ontransitionend={onCurtainEnd}
  >
    <div class="intro__inner">
      <div class="intro__markwrap">
        <!-- 这里**不放涟漪**（用户明确要求开屏不要涟漪）：
             就一个标记自己淡入缩放上来，安安静静的。 -->
        <img class="intro__mark" src="/app-icon.png" alt="" />
      </div>

      <h1 class="intro__name">
        {#each chars as ch, i (i)}
          <span class="intro__ch" style="--d:{i * STAGGER}ms">{ch}</span>
        {/each}
      </h1>

      <div class="intro__track">
        <div class="intro__fill" style="transform: scaleX({pct.toFixed(3)})"></div>
      </div>

      <span class="intro__pct">{Math.round(pct * 100)}%</span>
    </div>
  </div>
{/if}

<style>
  .intro {
    position: fixed;
    inset: 0;
    z-index: var(--z-curtain);
    display: grid;
    place-items: center;
    background: var(--page-bg);
    /* 缓动用 --ease-exit（项目里离场专用那条，"加速收走"），不是开场的 --ease-std。
       量出来的原因：幕布从 0.78 掉到 0 只花 300ms，而人眼在 0.08 以下就看不见白纱 ——
       最后那一下只占两帧，所以"露出来"读起来是啪地一下。
       离场曲线尾部更快，赶紧跨过 0.08 那道感知线；前面慢，内容成形那段还盖得住。 */
    transition: opacity var(--t-boot) var(--ease-exit), visibility 0s linear var(--t-boot);
  }
  .intro--out {
    opacity: 0;
    visibility: hidden;
    transition-delay: 0s;
    pointer-events: none;
  }

  .intro__inner {
    display: grid;
    justify-items: center;
    gap: clamp(24px, 3.4vmin, 40px);
  }

  /* 涟漪删了（用户要求：开屏不加涟漪）。
     只留一个方框把标记居中 —— `position: relative` 留着，以后要往里放装饰时
     同心定位靠它，别再用"视口居中"去凑。 */
  .intro__markwrap {
    position: relative;
    display: grid;
    place-items: center;
  }

  /* 标记块先上来。
     尺寸跟着窗口走：小窗口别糊脸，大窗口别小得像贴纸。 */
  .intro__mark {
    width: clamp(96px, 13vmin, 152px);
    height: clamp(96px, 13vmin, 152px);
    border-radius: 24%;
    object-fit: cover;
    display: block;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.28);
    animation: intro-mark var(--t-card) var(--ease-std) both;
  }
  @keyframes intro-mark {
    from { opacity: 0; transform: translateY(18px) scale(0.86); }
    to   { opacity: 1; transform: none; }
  }

  /* 名字逐字推入。间隔由 --d 给 */
  .intro__name {
    display: flex;
    margin: 0;
    font-size: clamp(30px, 4.4vmin, 52px);
    font-weight: 650;
    line-height: 1;
    letter-spacing: 0.01em;
    color: var(--deep-text);
  }
  .intro__ch {
    display: inline-block;
    animation: intro-ch var(--t-enter) var(--ease-std) both;
    animation-delay: calc(200ms + var(--d));
  }
  @keyframes intro-ch {
    from { opacity: 0; transform: translateY(14px); }
    to   { opacity: 1; transform: none; }
  }

  /* 进度条：填满用 scaleX 不动宽度（合成层上跑） */
  .intro__track {
    width: clamp(240px, 28vmin, 380px);
    height: 4px;
    border-radius: var(--r-full);
    background: var(--line-color);
    overflow: hidden;
    animation: intro-fade var(--t-enter) var(--ease-std) both;
    animation-delay: 460ms;
  }
  .intro__fill {
    height: 100%;
    width: 100%;
    transform-origin: left center;
    transform: scaleX(0);
    border-radius: var(--r-full);
    background: linear-gradient(90deg, var(--accent-solid), var(--primary));
  }
  @keyframes intro-fade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .intro__pct {
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
    color: var(--content-meta);
    animation: intro-fade var(--t-enter) var(--ease-std) both;
    animation-delay: 460ms;
  }

  /* 动效关掉：不逐字、不位移，只留一个短暂的静态画面 */
  :global(:root[data-motion='off']) .intro__ch,
  :global(:root[data-motion='off']) .intro__mark {
    animation-duration: 1ms;
    animation-delay: 0ms;
  }

  @media (prefers-reduced-motion: reduce) {
    .intro__ch, .intro__mark { animation-duration: 1ms; animation-delay: 0ms; }
  }
</style>
