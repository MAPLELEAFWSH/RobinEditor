<script lang="ts">
  /**
   * 底栏。
   *
   * 左边是身份和当前页，中间是**工程状态**，右边是帧率与性能。
   *
   * 帧率采样只在这一栏可见、且开关打开时才跑；关掉之后这条链路完全静默，
   * 页面才能真的空闲下来（采样链路不停着，页面永远进不了空闲态）。
   */
  import { onMount } from 'svelte';
  import { chrome, railMini } from '$lib/ui.svelte';
  import Icon from './Icon.svelte';
  import { prefs } from '$lib/prefs.svelte';
  import { perf, startMeter, resetPerf, FRAME_BUDGET_MS } from '$lib/perf.svelte';
  import { 当前工程 } from '$lib/recent.svelte';

  $effect(() => {
    if (!prefs.fpsLive) return;
    startMeter();
  });

  /** 帧时间柱状条：0 → 16.7ms 铺满 */
  const BARS = 20;
  /** hist 是普通数组（非响应式），读它不会建立依赖，避免自触发循环 */
  let hist: number[] = Array(BARS).fill(0);
  let bars = $state<number[]>(Array(BARS).fill(0));

  /** 上一次见到的「重置代数」，见下面那个 effect */
  let 上次代数 = perf.gen;

  $effect(() => {
    const v = perf.frameMs || 0;
    /* **按下「重新开始统计」要连柱子一起清。**
       这排柱子是本组件的本地数组，`resetPerf()` 碰不到它 —— 原来只清数字，
       柱子还留着刚才那个尖峰，而 20 根柱子是这一栏最显眼的东西，等于没重置。
       靠 `perf.gen` 换代来通知（`resetPerf` 里 +1）。 */
    if (perf.gen !== 上次代数) {
      上次代数 = perf.gen;
      hist = Array(BARS).fill(0);
      bars = hist;
      return;
    }
    hist = [...hist.slice(1), Math.min(1, v / FRAME_BUDGET_MS)];
    bars = hist;
  });

  /** 每秒走一次的钟。用 $derived 会被算一次就缓存住，所以得自己 tick。 */
  let now = $state(Date.now());
  onMount(() => {
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });
  const stamp = $derived(
    new Date(now).toLocaleTimeString('zh-CN', { hour12: false })
  );

  const level = $derived(
    perf.frameMs === 0 ? 'good' : perf.frameMs < 12 ? 'good' : perf.frameMs < 20 ? 'ok' : 'bad'
  );
</script>

<footer class="sb glass" data-mini={railMini()}>
  <div class="sb__left">
    <span class="sb__app"><i class="sb__dot"></i>RobinEditor</span>
    <span class="sb__pill">v1.0</span>
    <span class="sb__sep"></span>
    <span class="sb__view">{chrome.title || '工作区'}</span>
  </div>

  <div class="sb__mid">
    <!-- 中段原来是**写死的两个字**（"就绪 · 工程未载入"）—— 跟顶栏那个
         "未打开工程"一模一样的毛病，只是位置在底部：选了工程它也不会变。
         现在接 `当前工程`（`recent.svelte.ts`），刷新之后由 `recent[0]` 兜底，
         跟顶栏那颗点是同一个来源。全路径在 title 里。
         窄屏（<1180px）这一整段本来就会隐藏，那时只有顶栏显示。 -->
    <span
      class="sb__proj"
      class:sb__proj--on={!!当前工程.path}
      title={当前工程.path ? `当前工程：${当前工程.path}` : '当前工程：还没选过目录'}
    >
      <i class="sb__pdot"></i>{当前工程.path ? 当前工程.name : '未载入工程'}
    </span>
    <span class="sb__sep"></span>
    <span class="sb__dim">{stamp}</span>
  </div>

  <div class="sb__right">
    <span class="sb__meter" title="每帧耗时，预算 16.7ms">
      <span class="sb__bars" data-level={level}>
        {#each bars as h, i (i)}
          <i style="height:{Math.max(8, h * 100)}%"></i>
        {/each}
      </span>
      <span class="sb__kv">
        <b>{perf.frameMs ? perf.frameMs.toFixed(1) : '–'}</b><span>ms</span>
      </span>
    </span>
    <span class="sb__sep"></span>
    <!-- 没挂逐帧任务时这个数没有意义，显示成 — 比显示 0.0 诚实 -->
    <span class="sb__kv" title="本项目逐帧任务的耗时（当前订阅数 {perf.subs}）">
      JS <b>{perf.subs ? perf.jsAvg.toFixed(1) : '–'}</b>
    </span>
    <span class="sb__sep"></span>
    <span class="sb__kv" title="长任务次数（单帧超过 50ms）">
      卡顿 <b>{perf.longTasks}</b>
    </span>
    {#if perf.heapMB > 0}
      <span class="sb__sep"></span>
      <span class="sb__kv" title="JS 堆占用">堆 <b>{perf.heapMB}</b><span>MB</span></span>
    {/if}
    <span class="sb__sep"></span>
    <span class="sb__kv" title="DOM 节点数">节点 <b>{perf.nodes}</b></span>
    <span class="sb__sep"></span>
    <span class="sb__fps" data-level={level} title="每秒帧数">
      <Icon name="ui.speed" size={12} />
      <b>{perf.fps || '–'}</b><span>fps</span>
    </span>
    <button class="sb__btn" type="button" title="重新开始统计" onclick={resetPerf}>
      <Icon name="ui.refresh" size={12} />
    </button>
  </div>
</footer>

<style>
  .sb {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    /* 在侧栏之上：整条状态栏贯通全宽，左侧那段就是应用名，不会被侧栏吃掉 */
    z-index: var(--z-status);
    display: flex;
    align-items: center;
    gap: 0.75rem;
    height: var(--status-h);
    padding: 0 0.75rem;
    background: var(--sb-bg);
    border-top: 1px solid var(--line-divider);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    line-height: 1;
    color: var(--content-meta);
    user-select: none;
  }

  .sb__left,
  .sb__right { display: flex; align-items: center; gap: 0.5rem; flex: none; }
  .sb__mid {
    display: flex; align-items: center; gap: 0.9rem;
    flex: 1 1 auto; justify-content: center; min-width: 0;
    overflow: hidden; white-space: nowrap;
  }
  .sb__app {
    display: inline-flex; align-items: center; gap: 0.35rem;
    color: var(--deep-text); font-weight: 600;
  }
  .sb__dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--primary);
  }
  .sb__pill {
    padding: 1px 6px; border-radius: var(--r-full);
    background: var(--surface-3);
  }
  .sb__view { color: var(--btn-content); font-weight: 600; }
  /* 工程状态：没工程时是灰的（别拿主色骗人），有工程才亮 */
  .sb__proj {
    display: inline-flex; align-items: center; gap: 0.3rem;
    color: var(--content-meta);
    max-width: 18rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .sb__proj--on { color: var(--deep-text); font-weight: 600; }
  .sb__pdot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--line-color); flex: none;
  }
  .sb__proj--on .sb__pdot { background: var(--primary); }
  .sb__dim { opacity: 0.7; }
  .sb__sep { width: 1px; height: 12px; background: var(--line-color); flex: none; }
  /* 数字要等宽，不然帧率一跳整行就抖。以前靠等宽字体，现在统一雅黑，
     用 tabular-nums 让数字自己等宽。 */
  .sb__kv { display: inline-flex; align-items: baseline; gap: 2px; font-variant-numeric: tabular-nums; }
  .sb__kv b { color: var(--deep-text); font-weight: 600; }
  .sb__kv span { opacity: 0.7; }

  .sb__meter { display: inline-flex; align-items: center; gap: 5px; }
  .sb__bars { display: inline-flex; align-items: flex-end; gap: 1px; height: 12px; width: 42px; }
  .sb__bars i {
    flex: 1 1 0;
    min-width: 2px;
    border-radius: 1px;
    background: var(--ok);
    transition: height 260ms var(--ease-std);
  }
  .sb__bars[data-level='ok'] i { background: var(--warn); }
  .sb__bars[data-level='bad'] i { background: var(--accent); }

  .sb__fps {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 7px; border-radius: var(--r-full);
    background: var(--surface-2); color: var(--deep-text);
  }
  .sb__fps b { font-size: 12px; font-weight: 700; }
  .sb__fps span { opacity: 0.7; }
  .sb__fps[data-level='ok'] { color: var(--btn-content); }
  .sb__fps[data-level='bad'] { color: var(--accent); }

  .sb__btn {
    display: grid; place-items: center;
    width: 20px; height: 18px;
    border: 0; border-radius: var(--r-sm);
    background: transparent; color: inherit; cursor: pointer;
    transition: background var(--t-micro) var(--ease-std), color var(--t-micro) var(--ease-std);
  }
  .sb__btn:hover { background: var(--rail-item-hover); color: var(--deep-text); }

  @media (max-width: 1180px) {
    .sb__mid { display: none; }
  }
</style>
