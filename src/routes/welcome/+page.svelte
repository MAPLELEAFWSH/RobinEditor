<script lang="ts">
  import { onMount } from 'svelte';
  import { prefs, apply } from '$lib/prefs.svelte';
  import { MODULES, moduleTitle } from '$lib/modules/registry';

  /** 七个功能。列表来自模块注册表，加模块时这里不用改。 */
  const features = MODULES.filter((m) => m.group !== 'work' && !m.hidden)
    .slice()
    .sort((a, b) => Number(a.no ?? 99) - Number(b.no ?? 99))
    .map((m, i) => ({
      id: m.id,
      n: String(i + 1).padStart(2, '0'),
      t: m.name,
      d: m.desc,
      ready: m.ready,
      tags: m.panels?.map((p) => p.label).slice(0, 3) ?? []
    }));

  const milestones = [
    { d: '格式研究', t: '把规格测准', b: '原神、星铁、绝区零的贴图尺寸和通道含义逐像素量过一遍，工具照这个来。' },
    { d: 'v1', t: '先做三个', b: '通道处理、ILM 打包、乱码修复。这三样规格最确定，做完就能用。' },
    { d: 'v2', t: '加绘制', b: 'ikClut 调色，要引入图层和曲线。' },
    { d: 'v3', t: '接渲染', b: 'Ray 编辑器和养乐多上材质，得先能解析和生成 PMX 与 .fxsub。' }
  ];

  let booted = $state(false);
  let curtain = $state(true);
  let hue = $state(230);
  let theme = $state<'light' | 'dark'>('light');
  let scrolled = $state(0);

  function liquidate(target: HTMLElement, ev: MouseEvent | PointerEvent) {
    const r = target.getBoundingClientRect();
    const el = document.createElement('span');
    const size = Math.max(r.width, r.height) * 1.1;
    el.className = 'ripple';
    el.style.width = el.style.height = size + 'px';
    el.style.left = ev.clientX - r.left - size / 2 + 'px';
    el.style.top = ev.clientY - r.top - size / 2 + 'px';
    target.appendChild(el);
    setTimeout(() => el.remove(), 620);
  }

  onMount(() => {
    // 和主界面用同一份参数，别各存各的
    hue = prefs.hue;
    theme = prefs.theme;
    apply();

    requestAnimationFrame(() => (booted = true));
    const t = setTimeout(() => (curtain = false), 1180);

    const onScroll = () => (scrolled = window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      clearTimeout(t);
      window.removeEventListener('scroll', onScroll);
    };
  });

  $effect(() => {
    prefs.hue = hue;
    prefs.theme = theme;
    apply();
  });

  let parallax = $derived(Math.min(scrolled * 0.18, 160));
  let heroFade = $derived(Math.max(1 - scrolled / 620, 0));
</script>

<!-- 开场遮罩 -->
<div class="curtain" class:gone={!curtain} aria-hidden={!curtain}>
  <div class="curtain__inner">
    <div class="curtain__mark">Robin<b>Editor</b></div>
    <div class="loader-bar curtain__bar">
      <div class="loader-bar__fill" style="width:{booted ? '100%' : '12%'}"></div>
    </div>
    <div class="curtain__hint">{booted ? '就绪' : '载入中'}</div>
  </div>
</div>

<!-- 顶栏（胶囊） -->
<header class="nav" class:nav--solid={scrolled > 40}>
  <div class="nav__pill">
    <a class="nav__logo" href="#top">
      <span class="nav__dot"></span>RobinEditor
    </a>
    <nav class="nav__links">
      <a href="#features">功能</a>
      <a href="#timeline">路线</a>
      <a href="#start">开始</a>
    </nav>
    <div class="nav__tools">
      <label class="hue" title="主题色相">
        <input type="range" min="0" max="360" bind:value={hue} aria-label="主题色相" />
        <span class="hue__chip" style="background: oklch(0.70 0.14 {hue})"></span>
      </label>
      <button class="btn btn--slide" type="button"
              onclick={(e) => { theme = theme === 'light' ? 'dark' : 'light'; liquidate(e.currentTarget as HTMLElement, e); }}>
        {theme === 'light' ? '深色' : '浅色'}
      </button>
    </div>
  </div>
</header>

<main id="top">
  <!-- Hero：视差 + 逐字推入 + 主副标题透明度差异 -->
  <section class="hero">
    <div class="hero__bg" style="transform: translateY({parallax}px) scale(1.06)">
      <span class="hero__blob a"></span>
      <span class="hero__blob b"></span>
      <span class="hero__blob c"></span>
      <span class="hero__grid"></span>
    </div>

    <div class="hero__content" style="opacity:{heroFade}">
      <div class="hero__badge"><span class="tag">Tauri 2 · 安装即用</span></div>

      <h1 class="hero__title">
        {#each '从 diffuse 做到 lightmap'.split('') as ch, i}
          <span class="hero__ch" style="animation-delay:{i * 42}ms">{ch}</span>
        {/each}
      </h1>

      <p class="hero__sub title-sub">
        通道处理 · ILM 打包 · 乱码修复，三样先做完。<br />
        贴图规格按游戏分（原神 / 星铁 / 绝区零）。渲染包要你自己填路径，这里不内置也不分发。
      </p>

      <div class="hero__cta">
        <button class="btn btn--slide btn--primary" type="button"
                onclick={(e) => liquidate(e.currentTarget as HTMLElement, e)}>进入工具</button>
        <a class="btn btn--ghost" href="#features">看看能做什么</a>
      </div>

      <div class="hero__stats">
        <div><b>8</b><span>功能</span></div>
        <div><b>3</b><span>游戏规格</span></div>
        <div><b>0</b><span>需装环境</span></div>
      </div>
    </div>

    <div class="hero__scroll" aria-hidden="true"><span></span></div>
  </section>

  <!-- 功能网格：折叠卡 -->
  <section id="features" class="sec">
    <div class="sec__head reveal">
      <h2 class="title-main">七个功能</h2>
      <p class="title-sub">v1 先做这三样，其他的按顺序来。</p>
    </div>

    <div class="grid">
      {#each features as f, i (f.id)}
        <article class="card card--lift feat reveal" style="transition-delay:{i * 70}ms">
          <div class="feat__top">
            <span class="feat__n">{f.n}</span>
            {#if f.ready}<span class="tag tag--ok">v1</span>{:else}<span class="tag">开发中</span>{/if}
          </div>
          <h3 class="feat__t">{f.t}</h3>
          <p class="feat__d">{f.d}</p>
          <div class="feat__tags">
            {#each f.tags as t}<span class="tag tag--mini">{t}</span>{/each}
          </div>
        </article>
      {/each}
    </div>
  </section>

  <!-- 时间线（归档页预览） -->
  <section id="timeline" class="sec">
    <div class="sec__head reveal">
      <h2 class="title-main">路线</h2>
      <p class="title-sub">按时间排下来，每步一张卡。</p>
    </div>

    <ol class="tl">
      {#each milestones as m, i (m.t)}
        <li class="tl__item reveal" style="transition-delay:{i * 70}ms">
          <span class="tl__dot"></span>
          <div class="card tl__card">
            <div class="tl__meta"><span class="tag">{m.d}</span></div>
            <h3 class="tl__t">{m.t}</h3>
            <div class="card__inner tl__body"><p>{m.b}</p></div>
          </div>
        </li>
      {/each}
    </ol>
  </section>

  <!-- 开始 -->
  <section id="start" class="sec sec--cta">
    <div class="card cta reveal">
      <h2 class="title-main">把文件夹丢进来</h2>
      <p class="title-sub">
        选一个模型文件夹，工具自动认出哪些是 diffuse、哪些跳过（已有 lightmap 的不覆盖），
        按游戏规格批量出图，再逐张手修。
      </p>
      <div class="cta__row">
        <button class="btn btn--slide btn--primary" type="button"
                onclick={(e) => liquidate(e.currentTarget as HTMLElement, e)}>选择文件夹</button>
        <span class="cta__note">安装包约 8 MB · 不联网也能用</span>
      </div>
    </div>
  </section>
</main>

<footer class="foot">
  <div class="foot__inner">
    <span>RobinEditor · 渲染包由用户手动载入，本工具不内置、不分发</span>
    <span class="foot__dim">v1.0 · 七项功能全部可用</span>
  </div>
</footer>

<style>
  /* ---------- 开场遮罩 ---------- */
  .curtain {
    position: fixed; inset: 0; z-index: 90;
    display: grid; place-items: center;
    background: var(--page-bg);
    transition: transform var(--t-transition) var(--ease-slow),
                opacity var(--t-transition) var(--ease-std);
  }
  .curtain.gone { transform: translateY(-101%); opacity: 0; pointer-events: none; }
  .curtain__inner { width: min(320px, 74vw); text-align: center; }
  .curtain__mark { font-size: 22px; font-weight: 700; color: var(--deep-text); margin-bottom: 18px; }
  .curtain__mark b { color: var(--primary); }
  .curtain__bar { margin-bottom: 10px; }
  .curtain__hint { font-size: 12px; color: var(--content-meta); letter-spacing: .18em; }

  /* ---------- 顶栏 ---------- */
  .nav {
    position: fixed; top: 0; left: 0; right: 0; z-index: 60;
    display: flex; justify-content: center;
    padding: 14px 20px;
    transition: background var(--t-micro) var(--ease-std), padding var(--t-micro) var(--ease-std);
  }
  .nav--solid {
    padding: 8px 20px;
    background: color-mix(in oklab, var(--page-bg) 82%, transparent);
    backdrop-filter: blur(10px);
  }
  .nav__pill {
    display: flex; align-items: center; gap: 18px;
    width: min(var(--page-measure), 100%);
    padding: 8px 8px 8px 18px;
    background: var(--card-bg-90);
    border: var(--card-border);
    border-radius: var(--r-full);
    box-shadow: var(--card-shadow), var(--card-inner-highlight);
  }
  .nav__logo { display: flex; align-items: center; gap: 8px; font-weight: 700; color: var(--deep-text); }
  .nav__logo:hover { text-decoration: none; }
  .nav__dot {
    width: 9px; height: 9px; border-radius: 50%; background: var(--primary);
    box-shadow: 0 0 0 4px color-mix(in oklab, var(--primary) 22%, transparent);
  }
  .nav__links { display: flex; gap: 4px; margin-left: auto; }
  .nav__links a {
    padding: 6px 12px; border-radius: var(--r-full); font-size: 13.5px;
    color: var(--body-text);
    transition: background var(--t-micro) var(--ease-std), color var(--t-micro) var(--ease-std);
  }
  .nav__links a:hover { background: var(--btn-plain-bg-hover); color: var(--deep-text); text-decoration: none; }
  .nav__tools { display: flex; align-items: center; gap: 10px; }
  .hue { position: relative; display: flex; align-items: center; }
  .hue input { width: 62px; accent-color: var(--primary); }
  .hue__chip {
    position: absolute; right: -2px; top: -4px; width: 10px; height: 10px;
    border-radius: 50%; border: 2px solid var(--card-bg);
  }

  /* ---------- Hero ---------- */
  .hero {
    position: relative; min-height: 100svh; display: grid; align-items: center;
    overflow: hidden; padding: 120px 20px 80px;
  }
  .hero__bg { position: absolute; inset: -10% 0; will-change: transform; }
  .hero__blob { position: absolute; border-radius: 50%; filter: blur(46px); opacity: .5; }
  .hero__blob.a { width: 46vw; height: 46vw; left: -8vw; top: 4vh; background: color-mix(in oklab, var(--primary) 46%, transparent); }
  .hero__blob.b { width: 38vw; height: 38vw; right: -6vw; top: -6vh; background: color-mix(in oklab, var(--primary) 30%, transparent); }
  .hero__blob.c { width: 30vw; height: 30vw; left: 34vw; bottom: -10vh; background: color-mix(in oklab, var(--primary) 28%, transparent); }
  .hero__grid {
    position: absolute; inset: 0;
    background-image: linear-gradient(var(--line-divider) 1px, transparent 1px),
                      linear-gradient(90deg, var(--line-divider) 1px, transparent 1px);
    background-size: 46px 46px;
    mask-image: radial-gradient(ellipse 70% 60% at 50% 40%, #000 20%, transparent 78%);
  }
  .hero__content { position: relative; width: min(var(--page-measure), 100%); margin: 0 auto; }
  .hero__badge { margin-bottom: 22px; animation: rise var(--t-enter) var(--ease-std) both; }
  .hero__title { font-size: clamp(30px, 5.4vw, 62px); line-height: 1.18; letter-spacing: -.02em; }
  .hero__ch { display: inline-block; animation: char-in 620ms var(--ease-std) both; }
  @keyframes char-in { from { opacity: 0; transform: translateY(28px) scale(1.14); } to { opacity: 1; transform: none; } }
  @keyframes rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
  .hero__sub {
    margin: 20px 0 30px; font-size: clamp(14px, 1.5vw, 17px); max-width: 46em;
    animation: rise var(--t-enter) var(--ease-std) 260ms both;
  }
  .hero__cta { display: flex; flex-wrap: wrap; gap: 12px; animation: rise var(--t-enter) var(--ease-std) 340ms both; }
  .hero__stats { display: flex; gap: 34px; margin-top: 46px; animation: rise var(--t-enter) var(--ease-std) 420ms both; }
  .hero__stats div { display: flex; flex-direction: column; }
  .hero__stats b { font-size: 26px; color: var(--deep-text); }
  .hero__stats span { font-size: 12.5px; color: var(--content-meta); }
  .hero__scroll { position: absolute; left: 50%; bottom: 26px; transform: translateX(-50%); }
  .hero__scroll span {
    display: block; width: 1px; height: 40px;
    background: linear-gradient(var(--primary), transparent);
    animation: sweep 1.6s var(--ease-std) infinite;
  }
  @keyframes sweep {
    0% { opacity: 0; transform: translateY(-16px); }
    40% { opacity: 1; }
    100% { opacity: 0; transform: translateY(16px); }
  }

  .btn--primary { background: var(--primary); color: #fff; }
  .btn--primary:hover { background: color-mix(in oklab, var(--primary) 88%, #000); }
  .btn--ghost { background: transparent; border: 1px solid var(--line-strong); color: var(--deep-text); }
  .btn--ghost:hover { background: var(--btn-plain-bg-hover); text-decoration: none; }

  /* ---------- 区块 ---------- */
  .sec { width: min(var(--page-measure), 100%); margin: 0 auto; padding: 96px 20px; }
  .sec__head { margin-bottom: 34px; }
  .sec__head h2 { font-size: clamp(22px, 2.6vw, 32px); margin-bottom: 8px; }
  .sec__head p { margin: 0; }

  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
  .feat { padding: 20px; }
  .feat__top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .feat__n { font-size: 12px; font-weight: 700; letter-spacing: .16em; color: var(--content-meta); }
  .feat__t { font-size: 17px; margin-bottom: 8px; }
  .feat__d { margin: 0 0 14px; font-size: 13.5px; color: var(--content-meta); }
  .feat__tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .tag--ok { background: color-mix(in oklab, var(--ok) 22%, transparent); color: color-mix(in oklab, var(--ok) 74%, #000); }
  .tag--mini { font-size: 11px; padding: 2px 8px; }

  /* ---------- 时间线 ---------- */
  .tl { list-style: none; margin: 0; padding: 0 0 0 26px; position: relative; }
  .tl::before {
    content: ''; position: absolute; left: 7px; top: 6px; bottom: 6px; width: 2px;
    border-radius: 2px;
    background: linear-gradient(var(--primary), color-mix(in oklab, var(--primary) 12%, transparent));
  }
  .tl__item { position: relative; padding-bottom: 18px; }
  .tl__dot {
    position: absolute; left: -26px; top: 22px; width: 14px; height: 14px;
    border-radius: 50%; background: var(--card-bg); border: 2.5px solid var(--primary);
  }
  .tl__card { padding: 18px 20px; }
  .tl__meta { margin-bottom: 10px; }
  .tl__t { font-size: 16px; margin-bottom: 12px; }
  .tl__body { padding: 12px 14px; }
  .tl__body p { margin: 0; font-size: 13.5px; color: var(--content-meta); }

  /* ---------- CTA ---------- */
  .sec--cta { padding-top: 20px; }
  .cta { padding: 40px; text-align: center; }
  .cta p { margin: 10px auto 26px; max-width: 52em; }
  .cta__row { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; justify-content: center; }
  .cta__note { font-size: 12.5px; color: var(--content-meta); }

  /* ---------- 页脚 ---------- */
  .foot { border-top: 1px solid var(--line-divider); }
  .foot__inner {
    width: min(var(--page-measure), 100%); margin: 0 auto; padding: 26px 20px 40px;
    display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between;
    font-size: 12.5px; color: var(--content-meta);
  }
  .foot__dim { opacity: .8; }

  /* ---------- 竖屏适配 ---------- */
  @media (max-width: 720px) {
    .nav__links { display: none; }
    .hero { padding-top: 104px; }
    .hero__stats { gap: 22px; }
    .cta { padding: 26px 18px; }
    .tl { padding-left: 20px; }
    .tl__dot { left: -20px; }
    .btn { padding: 9px 16px; }
  }
</style>
