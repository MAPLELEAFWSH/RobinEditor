<script module lang="ts">
  /* 宽预览是挂在 `<html>` 上的一个类，而**一页可能同时挂两个 `Preview`**
     （④ FaceSDF 就是）。每个实例卸载时都去摘类的话，谁先卸载谁就把类摘掉 ——
     另一个还在用，宽预览却静默失效了。所以数着用，最后一个走的才摘。 */
  let 宽预览用户数 = 0;
</script>

<script lang="ts">
  /**
   * 预览台：放大、缩放、看像素。
   *
   * 为什么要有它：用户报"预览图太小太模糊，实时调参效果很差"。量出来的原因是两层：
   *   ① 版面：他的屏幕是 2560×1600 @150%，CSS 视口只有 1707×1067。
   *      工作区按 `1fr + 21rem` 分完，预览台只剩约 940px。
   *   ② 像素：不少页面把预览**缩到 512 长边**再交给 `<img>`，CSS 又把它拉到 940px 显示，
   *      等于放大 2.7 倍；再叠上 `image-rendering: pixelated`，看到的就是一堆方块。
   *
   * 这个组件管三件事（像素那一半要面板配合：`pw`/`ph` 要按显示尺寸算出来，别硬编码 512）：
   *   · **缩放**：适应 / 100% / 像素 1:1 / ± / Ctrl+滚轮；放大了拖得动。
   *   · **锐度策略**：只有真的在**放大**时才用最近邻（那时你要看清像素点），
   *     缩小时一律用平滑 —— 一直 pixelated 是"糊"和"锯齿"的来源。
   *   · **宽预览**：把侧栏那一列收掉，主区吃满窗口宽度。
   *
   * `pw`/`ph` 是**这张 url 自己的像素**（面板产出的预览尺寸），不是源图尺寸；
   * 源图尺寸只用于读数显示。
   */
  import { preview } from '$lib/ui.svelte';
  import Icon from '$lib/components/Icon.svelte';

  type Props = {
    url: string | null;
    /** 这张 url 的像素尺寸。不传就从 `<img>` 的自然尺寸读（接一页只要一行） */
    pw?: number;
    ph?: number;
    /**
     * **算"适应倍"时按这个尺寸算**（不传就按 `pw`/`ph`，也就是当前这张图的像素）。
     *
     * 给两级预览用：拖动中给的是 512 的粗图、停手后换成 1024 的细图 ——
     * 按各自像素算适应倍的话，粗图"装得下"就按 1:1 显示、细图按框宽缩着显示，
     * 显示尺寸在两级之间来回跳（用户报的"调色时图片大小异常波动"，实测 643→512→643）。
     * 传细预览的尺寸当基准，两级显示同一大小，停手只是变清楚。
     */
    基准?: { w: number; h: number };
    /** 源图真实尺寸，只在读数里显示 */
    srcW?: number;
    srcH?: number;
    alt?: string;
    /** 图下面那行说明 */
    note?: string;
    /** 缩放控件里要不要带"宽预览"。一页只放在**主预览**上，免得出现一排一样的开关 */
    wide?: boolean;
    /** 画布型用法（比如 ⑦ 的画笔）：指针事件交回调用方，组件自己不再平移 */
    交互?: (e: PointerEvent, 类型: 'down' | 'move' | 'up') => void;
    cursor?: string;
    /** 缩放范围（倍率）。默认 5%~800% */
    最小倍?: number;
    最大倍?: number;
    /** 当前倍率（0 = 适应）。传出来是为了**两边同步缩放**那种用法 */
    倍?: number;
    /** 平移位移（px，相对居中位置）。传出来是为了**两边同步平移** */
    位置?: { x: number; y: number };
    /** 滚轮直接缩放（不按 Ctrl）。② 调色那边左右两个视图就是这么用的 */
    滚轮直接缩放?: boolean;
    /** 缩放控件里要不要「重置」 */
    重置?: boolean;
    /**
     * **用户自己**在这个视图上改了缩放时往外报一声。
     *
     * 给"两边同步"那种用法：面板在回调里把另一边拉过去。
     * 为什么要有这个口子：同步写成 `$effect` 里"读一个写另一个"，
     * 一旦那个被读的值本身也是 `$state`，effect 就会自己叫自己 ——
     * ② 那一页为此整页白屏过一次。回调是**单向**的，不存在这件事。
     * 只报用户动作，外部改 `倍` 不会回灌。
     */
    缩放报?: (v: number) => void;
    /** 同上，用户在这个视图上拖了，往外报一声 */
    平移报?: (p: { x: number; y: number }) => void;
  };

  let {
    url,
    pw = 0,
    ph = 0,
    基准,
    srcW = 0,
    srcH = 0,
    alt = '',
    note = '',
    wide = false,
    交互,
    cursor = '',
    最小倍 = 0.05,
    最大倍 = 8,
    倍 = $bindable(0),
    位置 = $bindable({ x: 0, y: 0 }),
    滚轮直接缩放 = false,
    重置 = false,
    缩放报,
    平移报
  }: Props = $props();

  let box = $state({ w: 0, h: 0 });
  let 框 = $state<HTMLDivElement | null>(null);
  let dpr = $state(1);
  let 拖 = $state<{ x: number; y: number; ox: number; oy: number } | null>(null);
  /** 没传 pw/ph 时，从 <img> 的自然尺寸补上 */
  let 图 = $state({ w: 0, h: 0 });

  const 宽 = $derived(pw > 0 ? pw : 图.w > 0 ? 图.w : 512);
  const 高 = $derived(ph > 0 ? ph : 图.h > 0 ? 图.h : 512);
  /** 适应倍按它算：两级预览传了 `基准` 就按基准（细图）算，显示大小才不跳 */
  const 基准宽 = $derived(基准?.w && 基准.w > 0 ? 基准.w : 宽);
  const 基准高 = $derived(基准?.h && 基准.h > 0 ? 基准.h : 高);

  const 适应倍 = $derived(基准宽 > 0 && box.w > 0 ? Math.min(1, box.w / 基准宽, box.h / 基准高) : 1);
  const 实际倍 = $derived(倍 === 0 ? 适应倍 : 倍);
  /* **显示尺寸按基准算，不按当前这一档**：粗图 512 也要显示成细图该有的那么大
     （否则一级图换过来，尺寸又跟着那一档的像素缩一次 —— 那就等于没修）。
     代价是拖动中那张粗图被放大着看，稍微软一点，停手就清楚了。 */
  const 显示w = $derived(Math.max(1, Math.round(基准宽 * 实际倍)));
  const 显示h = $derived(Math.max(1, Math.round(基准高 * 实际倍)));
  /* 设备像素比在图源像素还大的时候，才是在"放大" —— 这时用最近邻看像素点。
     两级预览里只有当前这一档**不小于基准**时才谈得上"看像素点"；
     拖动中那张粗图本来就被拉大着看，再上最近邻只会变成一块块。 */
  const 放大中 = $derived(实际倍 * dpr > 1 && 宽 >= 基准宽 - 0.5);
  const 百分比 = $derived(Math.round(实际倍 * 100));

  $effect(() => {
    dpr = window.devicePixelRatio || 1;
    const el = 框;
    if (!el) return;
    /* 量到同一对尺寸就别往里写：写进去是一次重画，而重画会让图变大/变小、
       滚动条跟着出现或消失，框的 clientWidth/clientHeight 又变 —— 浏览器那边
       会报 "ResizeObserver loop completed with undelivered notifications"。
       那条是浏览器的告警、不进本应用的出错通道，但白跑的重画能省就省。 */
    const 记 = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (box.w === w && box.h === h) return;
      box = { w, h };
    };
    const ro = new ResizeObserver(记);
    ro.observe(el);
    记();
    return () => ro.disconnect();
  });

  /* 宽预览用一个类挂在 html 上：布局是 .wb 那一层的事，一个组件管不了别的容器 */
  $effect(() => {
    const 要 = preview.wide;
    document.documentElement.classList.toggle('pv-wide', 要);
    if (!要) return;
    宽预览用户数++;
    return () => {
      宽预览用户数--;
      if (宽预览用户数 <= 0) {
        宽预览用户数 = 0;
        document.documentElement.classList.remove('pv-wide');
      }
    };
  });

  /** 用户自己改缩放都从这里走 —— 报口子只在这一处调，免得漏掉某条路 */
  function 设倍(v: number) {
    倍 = v === 0 ? 0 : Math.min(最大倍, Math.max(最小倍, v));
    缩放报?.(倍);
  }
  function 缩放(方向: number, e: Event) {
    e.preventDefault();
    设倍((倍 === 0 ? 适应倍 : 倍) * (方向 > 0 ? 1.25 : 0.8));
  }
  /** 重置：回"适应"并回正中间 */
  function 重置视图() {
    设倍(0);
    位置 = { x: 0, y: 0 };
    平移报?.({ x: 0, y: 0 });
  }

  function 滚(e: WheelEvent) {
    /* 默认只在按住 Ctrl/⌘ 时缩放，不然会把页面滚动吃掉；
       `滚轮直接缩放` 是给"左右两个视图各自缩放"那种用法开的 */
    if (!滚轮直接缩放 && !e.ctrlKey && !e.metaKey) return;
    缩放(e.deltaY < 0 ? 1 : -1, e);
  }

  /**
   * 把位移夹在"图不至于被甩出视野"的范围里。
   *
   * 留 24px 边：拖到头时图上还能看见一条边，不会变成空白框（PR / PS 也是这么收的）。
   * 图比框小的时候这个范围反而更大（半框 + 半图），所以**小图照样拖得动** ——
   * 这正是这次要修的那条：原来用滚动条做平移，图没超出框就没得滚，拖动直接静默失效。
   */
  function 夹住(p: { x: number; y: number }): { x: number; y: number } {
    const 限x = Math.max(0, (显示w + box.w) / 2 - 24);
    const 限y = Math.max(0, (显示h + box.h) / 2 - 24);
    return {
      x: Math.min(限x, Math.max(-限x, Math.round(p.x))),
      y: Math.min(限y, Math.max(-限y, Math.round(p.y)))
    };
  }

  /* 缩放变了（比如从放大缩回适应）就把位移重新夹一次 —— 不然图会停在框外面 */
  $effect(() => {
    void 显示w;
    void 显示h;
    void box.w;
    void box.h;
    const c = 夹住(位置);
    if (c.x !== 位置.x || c.y !== 位置.y) 位置 = c;
  });

  function 下(e: PointerEvent) {
    if (交互) return;
    /* 左键与中键都能拖；右键留给菜单 */
    if (e.button !== 0 && e.button !== 1) return;
    /* 中键不拦的话会触发浏览器的自动滚屏 */
    if (e.button === 1) e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    拖 = { x: e.clientX, y: e.clientY, ox: 位置.x, oy: 位置.y };
    e.preventDefault();
  }
  function 动(e: PointerEvent) {
    if (交互 || !拖) return;
    const p = 夹住({ x: 拖.ox + (e.clientX - 拖.x), y: 拖.oy + (e.clientY - 拖.y) });
    位置 = p;
    平移报?.(p);
  }
  function 上(e: PointerEvent) {
    if (交互) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* 指针已经被系统收走了 */
    }
    拖 = null;
  }

  /** 画布型用法：指针事件原样转给调用方，`currentTarget` 还是那张 <img> */
  function 交(kind: 'down' | 'move' | 'up') {
    return (e: PointerEvent) => 交互?.(e, kind);
  }
</script>

<div class="pv">
  <div class="pv__bar">
    <!-- 缩放那几个按钮是**视图工具**：一屏里两个预览就是 12 个控件，
         按设计准则 §八（一屏主线控件 ≤8）收进这个展开区，默认收起。
         读数（倍率/尺寸）留在这一行上，收起也知道现在是多少。 -->
    <details class="pv__zoom">
      <summary title="缩放与视图"><Icon name="ui.search" size={12} />视图 <b>{百分比}%</b></summary>
      <div class="pv__zoombody">
        <button class="pv__b" type="button" aria-pressed={倍 === 0} onclick={() => 设倍(0)}>适应</button>
        <button class="pv__b" type="button" aria-pressed={倍 === 1} onclick={() => 设倍(1)}>100%</button>
        <button class="pv__b" type="button" aria-pressed={倍 === 1 / dpr} onclick={() => 设倍(1 / dpr)}>
          像素 1:1
        </button>
        <button class="pv__b" type="button" onclick={(e) => 缩放(-1, e)} aria-label="缩小">−</button>
        <button class="pv__b" type="button" onclick={(e) => 缩放(1, e)} aria-label="放大">＋</button>
        {#if 重置}
          <button class="pv__b" type="button" onclick={重置视图} title="回适应、滚回左上角">重置</button>
        {/if}
      </div>
    </details>
        <span class="pv__read">
      {#if srcW && srcH}源 <b>{srcW}×{srcH}</b> · {/if}
      预览 {基准宽}×{基准高} · <b>{百分比}%</b>
      {#if 放大中}<span class="mut"> · 最近邻</span>{/if}
    </span>
    {#if wide}
      <span class="pv__sp"></span>
      <button class="pv__b" type="button" aria-pressed={preview.wide}
        title="把侧栏那一列收掉，预览占满窗口宽度"
        onclick={() => (preview.wide = !preview.wide)}>
        <Icon name="ui.image" size={13} />宽预览
      </button>
    {/if}
  </div>

  <div class="pv__box" bind:this={框} onwheel={滚}
    onpointerdown={下} onpointermove={动} onpointerup={上} onpointercancel={上}
    role="application" aria-label="预览：按住拖动平移，滚轮缩放"
    class:pv__box--grab={!!url && !交互}>
    {#if url}
      <img class="pv__img" class:pv__img--pixel={放大中} src={url} {alt}
        style="width:{显示w}px; height:{显示h}px; transform:translate({位置.x}px, {位置.y}px); {cursor ? `cursor:${cursor}` : ''}" draggable="false"
        onload={(e) => {
          const el = e.currentTarget as HTMLImageElement;
          图 = { w: el.naturalWidth, h: el.naturalHeight };
        }}
        onpointerdown={交('down')} onpointermove={交('move')}
        onpointerup={交('up')} onpointercancel={交('up')}
        oncontextmenu={(e) => 交互 && e.preventDefault()} />
    {:else}
      <span class="pv__empty">还没有图</span>
    {/if}
  </div>

  {#if note}<p class="mini" style="margin-top:8px">{note}</p>{/if}
</div>

<style>
  .pv { display: grid; gap: 8px; }
  .pv__bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .pv__sp { flex: 1; }
  /* 视图那一格：收起时只占一行小字（带倍率读数），点开才是完整缩放条 */
  .pv__zoom { position: relative; }
  .pv__zoom > summary {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--surface-2);
    color: var(--content-meta);
    font-size: var(--fs-2xs);
    cursor: pointer;
    list-style: none;
  }
  .pv__zoom > summary::-webkit-details-marker { display: none; }
  .pv__zoom > summary b { color: var(--deep-text); font-variant-numeric: tabular-nums; }
  .pv__zoom[open] > summary { color: var(--deep-text); }
  .pv__zoombody {
    position: absolute;
    z-index: var(--z-content, 1);
    margin-top: 4px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px;
    border: 1px solid var(--line-divider);
    border-radius: var(--r-md);
    background: var(--card-bg);
    box-shadow: var(--shadow-sm);
  }
  .pv__b {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--body-text);
    font: inherit;
    font-size: var(--fs-2xs);
    padding: 3px 8px;
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: background var(--t-micro) var(--ease-std), color var(--t-micro) var(--ease-std);
  }
  .pv__b:hover { background: var(--btn-plain-bg-hover); color: var(--deep-text); }
  .pv__b[aria-pressed='true'] {
    background: color-mix(in oklab, var(--primary) 18%, var(--surface-2));
    border-color: color-mix(in oklab, var(--primary) 45%, var(--line));
    color: var(--primary-ink);
  }
  .pv__read {
    font-size: var(--fs-2xs);
    color: var(--content-meta);
    font-variant-numeric: tabular-nums;
    margin-left: 4px;
  }
  .pv__read b { color: var(--deep-text); font-weight: 650; }

  .pv__box {
    position: relative;
    display: grid;
    /* 图永远在正中，平移靠 `transform` 位移（见 `<img>` 上的 style）—— 
       所以这里 `place-items: center` 就够，不再需要 `safe`（那是滚动条时代的补丁） */
    place-items: center;
    min-height: min(52vh, 560px);
    max-height: 74vh;
    padding: 10px;
    border-radius: var(--r-lg);
    /* `hidden`：平移改成位移之后不该再出现滚动条（拖动才是平移的那条路） */
    overflow: hidden;
    background-color: var(--surface-2);
    background-image:
      linear-gradient(45deg, rgba(0, 0, 0, 0.05) 25%, transparent 25%),
      linear-gradient(-45deg, rgba(0, 0, 0, 0.05) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, rgba(0, 0, 0, 0.05) 75%),
      linear-gradient(-45deg, transparent 75%, rgba(0, 0, 0, 0.05) 75%);
    background-size: 16px 16px;
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  }
  .pv__box--grab { cursor: grab; }
  .pv__box--grab:active { cursor: grabbing; }
  /* 缩小时平滑（默认），放大时才用最近邻 —— 见文件头那段 */
  .pv__img {
    display: block;
    image-rendering: auto;
    border-radius: var(--r-sm);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
    user-select: none;
  }
  .pv__img--pixel { image-rendering: pixelated; }
  .pv__empty { font-size: var(--fs-sm); color: var(--content-meta); }
</style>
