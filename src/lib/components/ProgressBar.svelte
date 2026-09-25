<script lang="ts">
  /**
   * 顶部进度条。数值是实测记下来的（见 docs/借鉴-新增参考.md）：
   *   加载中   3px 的条渐近长到 95%（8s 的缓出），永远不自己走满
   *   完成     跳到 100%，200ms
   *   退出     淡出 300ms
   *
   * 渐近那条是关键：进度条不能自己走到头，不然页面还在加载但条已经满了，
   * 比不显示还难看。所以只长到 95% 等着。
   *
   * 另外加了个最短显示时长。本地换页经常 20ms 就完了，
   * 不兜一下就是闪一下白条，比没有还扎眼。
   */
  import { navigating } from '$app/state';

  const MIN_MS = 260;

  let phase = $state<'idle' | 'loading' | 'finishing' | 'done'>('idle');
  let shownAt = 0;
  let timers: number[] = [];

  function clearTimers() {
    timers.forEach((t) => clearTimeout(t));
    timers = [];
  }

  $effect(() => {
    /* 必须读属性，不能 `const n = navigating`。
       $app/state 导出的 navigating 是个 getter 对象，读变量本身拿到的是
       恒定不变的那个对象引用，依赖不会建立，effect 永远不会重跑 ——
       之前就是这么卡在"loading"上不下来的。 */
    const to = navigating.to;

    if (to) {
      clearTimers();
      if (phase === 'idle' || phase === 'done') {
        phase = 'loading';
        shownAt = performance.now();
      }
      return;
    }

    if (phase !== 'loading') return;
    const waited = performance.now() - shownAt;
    const left = Math.max(0, MIN_MS - waited);
    timers.push(
      window.setTimeout(() => {
        phase = 'finishing';
        timers.push(window.setTimeout(() => (phase = 'done'), 200));
        timers.push(window.setTimeout(() => (phase = 'idle'), 540));
      }, left)
    );
  });

  $effect(() => () => clearTimers());
</script>

<div
  class="pb"
  data-phase={phase}
  role="progressbar"
  aria-hidden={phase === 'idle' || phase === 'done'}
  aria-label="页面加载"
></div>

<style>
  .pb {
    position: fixed;
    top: 0;
    left: 0;
    height: var(--progress-h);
    z-index: var(--z-progress);
    pointer-events: none;
    /* 用低彩度的强调色，跟侧栏那条指示同一个语言，不用 --primary 那种高彩度蓝 */
    background: linear-gradient(90deg, var(--accent-solid), var(--accent-solid-2));
    border-radius: 0 var(--r-full) var(--r-full) 0;
    width: 0;
    opacity: 0;
  }

  .pb[data-phase='loading'] {
    opacity: 1;
    animation:
      pb-grow var(--progress-grow) cubic-bezier(0.1, 0.05, 0.1, 1) forwards,
      pb-in 100ms linear forwards;
  }
  @keyframes pb-grow {
    from { width: 0; }
    to   { width: 95%; }
  }
  @keyframes pb-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .pb[data-phase='finishing'] {
    animation: none;
    width: 100%;
    opacity: 1;
    transition: width 200ms var(--ease-std);
  }

  .pb[data-phase='done'] {
    animation: none;
    width: 100%;
    opacity: 0;
    transition: opacity 300ms var(--ease-std);
  }

  /* 动效关掉时不要那 8 秒的爬行，直接一条 */
  :global(:root[data-motion='off']) .pb[data-phase='loading'] {
    width: 60%;
    animation: none;
  }
</style>
