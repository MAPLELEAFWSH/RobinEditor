<script lang="ts">
  /**
   * 背景层。两层图片交替做交叉淡入。
   *
   * 交叉淡入的坑在 visibility 的时机：它是离散属性，不参与过渡。
   * 只写 transition: opacity 的话，摘掉 .on 的当帧就变 hidden，旧图直接没了，
   * 看到的是"啪一下切掉"而不是两张叠着化过去。给它一个等于淡出时长的延迟，
   * 它才会在淡出结束之后才隐藏。
   *
   * 轮放计时器只在 carousel、页面可见、且用户没要求减少动效时跑。
   */
  import { onMount, tick } from 'svelte';
  import { prefs } from '$lib/prefs.svelte';
  import { bgSrc, bgScrim, bgLuma, allBgs } from '$lib/bg';

  /** 两层交替，避免整份列表都在 DOM 里 */
  let a = $state(prefs.bg);
  let b = $state('');
  let front = $state<'a' | 'b'>('a');

  /* 顺序表跟着「内置 + 导入」一起变，导入新图之后轮放也会带上它 */
  const order = $derived(allBgs().map((x) => x.id));
  const shown = () => (front === 'a' ? a : b);

  /**
   * 交叉淡到指定那张。
   *
   * 关键在**等解码完再开始淡**。原来换完 src 就立刻翻前台，
   * 于是旧图开始淡出的同时新图还是空的（2.4MB 的 JPEG 解一次要一两百毫秒），
   * 看到的是"背景先塌成底色、然后新图 pop 出来"—— 就是那个僵硬感。
   *
   * 顺序：先把图 decode 进缓存 → 换后台层的 src → 等一帧让它挂上 →
   * 再翻前台开始交叉。这样两帧之间新图一定已经画得出来。
   */
  const decoded = new Set<string>();
  let token = 0;

  async function preload(url: string): Promise<void> {
    if (decoded.has(url)) return;
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      decoded.add(url);
    } catch {
      // 解不出来（文件没了、格式不认）也照常往下走，别把切换卡死
    }
  }

  async function goTo(id: string, instant = false) {
    if (!id || id === shown()) return;
    const mine = ++token;
    if (!instant) {
      await preload(bgSrc(id));
      // 解码期间又切过就放弃这次，让后来那次做，免得两次交叉打架
      if (mine !== token) return;
    }
    if (front === 'a') b = id;
    else a = id;
    // 等一帧：让新 src 真的挂到 <img> 上，再翻前台
    await tick();
    if (mine !== token) return;
    front = front === 'a' ? 'b' : 'a';
    sync();
  }

  function step() {
    const cur = shown();
    const i = order.indexOf(cur);
    void goTo(order[(i + 1) % order.length] ?? order[0]);
  }

  let timer = 0;
  function sync() {
    clearInterval(timer);
    timer = 0;
    const wanted =
      prefs.bgMode === 'carousel' &&
      prefs.motion !== 'off' &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!wanted) return;
    timer = window.setInterval(() => {
      if (!document.hidden) step();
    }, Math.max(4, prefs.bgEvery) * 1000);
  }

  onMount(() => {
    sync();
    return () => clearInterval(timer);
  });

  // 参数或选中的壁纸一变就跟着调整
  let lastKey = '';
  $effect(() => {
    const key = `${prefs.bgMode}|${prefs.bgEvery}|${prefs.motion}|${prefs.bg}`;
    if (key === lastKey) return;
    const bgChanged = !lastKey.endsWith(`|${prefs.bg}`);
    lastKey = key;
    // 挂载时 a 已经是 prefs.bg，goTo 会在第一行直接返回，不会白淡一次
    if (bgChanged) void goTo(prefs.bg);
    else sync();
  });

  const withImage = $derived(prefs.bgMode === 'solid' || prefs.bgMode === 'carousel');
  const withNative = $derived(prefs.bgMode === 'native');
  /** 当前显出来的是哪张，遮罩按它的亮度算 */
  const shownId = $derived(front === 'a' ? a : b);
</script>

<div
  class="bg"
  data-mode={prefs.bgMode}
  data-scope={prefs.bgScope}
  data-fit={prefs.bgFit}
  data-soften={prefs.soften}
  data-imgs={withImage}
  style="--wp-scrim: {bgScrim(shownId)}; --wp-luma: {bgLuma(shownId)}; --wp-pos: {prefs.bgPos}"
  aria-hidden="true"
>
  <div class="bg__base"></div>

  <!-- 纯代码背景：三团极光 + 细网格，全部由 --hue 派生 -->
  <div class="bg__native" class:on={withNative}>
    <span class="aur aur--a"></span>
    <span class="aur aur--b"></span>
    <span class="aur aur--c"></span>
    <span class="grain"></span>
  </div>

  {#if withImage}
    <!-- 模糊补边：拿同一张铺满再糊掉，垫在完整显示的那张底下。
         只有这一层会挂 filter，所以整页只多一次光栅化。 -->
    {#if prefs.bgFit === 'blur'}
      <img class="bg__blur" class:on={front === 'a'} src={bgSrc(a)} alt="" decoding="async" />
    {/if}
    <img class="bg__im" class:on={front === 'a'} src={bgSrc(a)} alt="" decoding="async" />
    {#if b}
      <img class="bg__im" class:on={front === 'b'} src={bgSrc(b)} alt="" decoding="async" />
    {/if}
  {/if}

  <!-- 压在壁纸上的一层，强度按当前这张的亮度走（build 时量的，见 bg-meta.json） -->
  <div class="bg__scrim"></div>
</div>

<style>
  .bg {
    position: fixed;
    z-index: var(--z-backdrop);
    overflow: hidden;
    background: var(--page-bg);
    pointer-events: none;
  }

  /* ---------- 作用范围 ----------
     work：铺在顶栏下沿、侧栏右沿、尾栏上沿围出来的那块里。界面全是实色，
           挡不到东西，正文也永远压在实色卡片上。
     full：铺满整窗，界面改用毛玻璃浮在上面，另加一层按亮度算的遮罩保可读性。 */
  .bg[data-scope='work'] {
    top: var(--navbar-height);
    left: var(--rail-width);
    right: 0;
    bottom: var(--status-h);
    transition:
      left var(--t-side) var(--ease-std),
      top var(--t-page) var(--ease-std);
  }
  .bg[data-scope='full'] {
    inset: 0;
    transition: inset var(--t-page) var(--ease-std);
  }
  /* 侧栏收起时跟着挪，别留空档。
     data-mini 挂在 <html> 上（AppShell 里设的），不是 .shell。 */
  :global(html[data-mini='true']) .bg[data-scope='work'] {
    left: var(--rail-collapsed);
  }

  /* ---------- 遮罩：强度 = 当前壁纸的亮度（build 时量好的） ---------- */
  .bg__scrim {
    position: absolute;
    inset: 0;
    background: var(--scrim-color);
    opacity: var(--wp-scrim, 0.22);
    transition: opacity var(--t-reveal) var(--ease-std);
    pointer-events: none;
  }
  .bg[data-mode='none'] .bg__scrim,
  .bg[data-mode='native'] .bg__scrim { opacity: 0; }

  /* ---------- 底色 ---------- */
  .bg__base {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(
        120% 90% at 50% -10%,
        color-mix(in oklab, var(--primary) 10%, var(--page-bg)) 0%,
        transparent 60%
      ),
      linear-gradient(178deg, var(--page-bg) 0%, var(--page-bg-2) 62%, var(--page-bg) 100%);
  }
  .bg[data-mode='none'] .bg__base {
    background: var(--page-bg);
  }

  /* ---------- 纯代码极光 ---------- */
  .bg__native {
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity var(--t-transition) var(--ease-std);
  }
  .bg__native.on { opacity: 1; }

  .aur {
    position: absolute;
    border-radius: 50%;
    /* 高斯感靠多层径向渐变堆，不用 blur()：全屏 blur 会让这一层多走一遍光栅化 */
    background: radial-gradient(
      closest-side,
      color-mix(in oklab, var(--primary) 34%, transparent),
      transparent 72%
    );
    opacity: 0.5;
  }
  .aur--a {
    width: 68vw; height: 68vw;
    left: -14vw; top: -26vw;
    /* 色相往绿偏一点，和主色拉开层次又不打架 */
    background: radial-gradient(
      closest-side,
      oklch(0.78 0.12 calc(var(--hue) + 42) / 0.42),
      transparent 70%
    );
  }
  .aur--b {
    width: 54vw; height: 54vw;
    right: -12vw; top: -10vw;
    background: radial-gradient(
      closest-side,
      oklch(0.80 0.11 calc(var(--hue) - 38) / 0.36),
      transparent 70%
    );
  }
  .aur--c {
    width: 92vw; height: 46vw;
    left: 4vw; bottom: -26vw;
    background: radial-gradient(
      closest-side,
      color-mix(in oklab, var(--primary) 26%, transparent),
      transparent 74%
    );
    opacity: 0.4;
  }

  /* 慢速漂移：只动 transform，合成层上跑，不重绘 */
  :root[data-motion='full'] .aur--a { animation: drift-a 46s var(--ease-slow) infinite alternate; }
  :root[data-motion='full'] .aur--b { animation: drift-b 58s var(--ease-slow) infinite alternate; }
  :root[data-motion='full'] .aur--c { animation: drift-c 64s var(--ease-slow) infinite alternate; }
  @keyframes drift-a {
    from { transform: translate3d(0, 0, 0) scale(1); }
    to   { transform: translate3d(4vw, 3vh, 0) scale(1.08); }
  }
  @keyframes drift-b {
    from { transform: translate3d(0, 0, 0) scale(1.05); }
    to   { transform: translate3d(-5vw, 4vh, 0) scale(1); }
  }
  @keyframes drift-c {
    from { transform: translate3d(0, 0, 0) scale(1); }
    to   { transform: translate3d(-3vw, -2vh, 0) scale(1.06); }
  }

  /* 细网格：给"纸"的质感，28px 一格，低到几乎看不见但能压住大色块的空 */
  .grain {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(to right, var(--grid-line) 1px, transparent 1px),
      linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px);
    background-size: 28px 28px;
    mask-image: radial-gradient(120% 100% at 50% 0%, #000 0%, transparent 78%);
  }

  /* ---------- 壁纸图 ----------
     适应方式用 data-fit 分支；object-position 走 --wp-pos（面板里 3×3 选）。
     壁纸宽高比 1.41–2.35，容器 1.16–1.95，硬用 cover 最极端要裁掉一半宽度，
     所以给了四个方式。 */
  .bg__im {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-position: var(--wp-pos, center center);
    opacity: 0;
    visibility: hidden;
    /* 进来的那张从 1.03 缓缓沉到 1。用独立的 scale 属性而不是写进 transform，
       因为 data-soften 那条也会动 transform（scale(1.04)），
       两者分开写才叠得住，不会互相覆盖。 */
    scale: 1.03;
    transition:
      opacity var(--t-cross) var(--ease-std),
      scale calc(var(--t-cross) * 1.4) var(--ease-out-cubic),
      visibility 0s linear var(--t-cross);
  }
  .bg__im.on {
    opacity: var(--cover-veil, 0.9);
    visibility: visible;
    scale: 1;
    transition-delay: 0s;
  }

  .bg[data-fit='cover'] .bg__im { object-fit: cover; }
  .bg[data-fit='contain'] .bg__im { object-fit: contain; }
  .bg[data-fit='fill'] .bg__im { object-fit: fill; }
  .bg[data-fit='blur'] .bg__im { object-fit: contain; }

  /* 模糊补边的底：铺满 + 糊掉。整页只有这一层挂 filter，所以只多一次光栅化。
     这一层只在 fit=blur 时进 DOM。 */
  .bg__blur {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    filter: blur(28px) saturate(1.15);
    /* 糊完边缘会露，放大一点盖住 */
    transform: scale(1.12);
    opacity: 0;
    transition: opacity var(--t-cross) var(--ease-std);
  }
  .bg__blur.on { opacity: calc(var(--cover-veil, 0.9) * 0.85); }

  /* 柔化默认关。关的时候这里一条 filter 都不写 ——
     写 blur(0px) 也会让这一层多走一遍光栅化，全屏图上帧时间能翻倍。 */
  .bg[data-soften='true'] .bg__im.on {
    filter: blur(var(--cover-soften, 6px));
    transform: scale(1.04);
  }

  /* 顶上压一层渐隐，正文滚过去不会和背景打架 */
  .bg::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 180px;
    background: linear-gradient(
      to bottom,
      var(--veil-strong) 0%,
      var(--veil-mid) 45%,
      transparent 100%
    );
  }
</style>
