<script lang="ts">
  import { onMount } from 'svelte';
  import { setChrome } from '$lib/ui.svelte';
  import { STEPS, getModule, moduleTitle } from '$lib/modules/registry';
  import Icon from '$lib/components/Icon.svelte';

  onMount(() => setChrome('工作区', '总览 · 最近工程 · 环境状态'));

  /** 渲染包和工具包一律由用户指路，工具里不打包也不分发 */
  const packs = [
    { k: 'Ray 渲染包', need: 'ray.conf' },
    { k: '养乐多渲染包', need: 'mat_body.fx' },
    { k: 'ikClut', need: 'ikClut.fx' },
    { k: 'msToon', need: 'ShadowRate.png 等控制图' }
  ];

  const quickIds = ['channels', 'ilm', 'glitch'];
  const quick = quickIds.map((id) => getModule(id)!).filter(Boolean);
</script>

<div class="page">
  <section class="hero card rise" style="--i:0">
    <div class="hero__lead">
      <span class="tag">v1 先做三个</span>
      <h2>选个模型文件夹就能开工</h2>
      <p>
        工具先扫一遍，认出哪些是漫反射底图、哪些已经有 lightmap 该跳过，再按目标游戏的规格批量出图，
        最后留给你逐张手修。渲染包的位置要自己填，这里不打包也不分发。
      </p>
      <div class="hero__cta">
        <button class="btn btn--primary" type="button">
          <Icon name="ui.folder" size={17} />选择文件夹
        </button>
        <a class="btn btn--ghost" href="/tools/channels">直接进通道处理</a>
      </div>
    </div>

    <ol class="steps">
      {#each STEPS as s, i (s.n)}
        <li class="steps__it" style="--i:{i + 1}">
          <span class="steps__n">{s.n}</span>
          <div>
            <b>{s.t}</b>
            <span>{s.d}</span>
          </div>
        </li>
      {/each}
    </ol>
  </section>

  <section class="cols">
    <div class="card pad rise" style="--i:1">
      <h3 class="h3">快捷动作</h3>
      <div class="quick">
        {#each quick as q, i (q.id)}
          <a class="quick__it card__inner" href="/tools/{q.id}" style="--i:{i + 2}">
            <Icon name={q.icon} size={20} cls="quick__ic" />
            <b>{moduleTitle(q)}</b>
            <span>{q.panels?.length ?? 0} 个分区</span>
          </a>
        {/each}
      </div>

      <h3 class="h3 mt">最近工程</h3>
      <div class="empty card__inner">
        <b>还没打开过工程</b>
        <span>找个带贴图的模型文件夹就行，扫完会记住路径</span>
      </div>
    </div>

    <div class="card pad rise" style="--i:2">
      <h3 class="h3">环境与路径</h3>
      <p class="mut">
        这几样要你手动指路。载入时会认一下特征文件，对不上就拦住，免得后面白跑。
      </p>
      <ul class="packs">
        {#each packs as p, i (p.k)}
          <li style="--i:{i + 3}">
            <span class="packs__k">{p.k}</span>
            <span class="packs__need">认 <code>{p.need}</code></span>
            <span class="packs__v">未载入</span>
            <a class="btn btn--ghost packs__btn" href="/settings">载入</a>
          </li>
        {/each}
      </ul>
    </div>
  </section>
</div>

<style>
  .page { display: flex; flex-direction: column; gap: 16px; }

  .hero {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    gap: 28px;
    padding: 28px;
  }
  .hero__lead h2 {
    font-size: var(--fs-2xl);
    line-height: var(--lh-2xl);
    letter-spacing: var(--tracking-tight);
    margin: 12px 0 10px;
  }
  .hero__lead p {
    margin: 0 0 18px;
    font-size: var(--fs-md);
    line-height: var(--lh-md);
    color: var(--content-meta);
  }
  .hero__cta { display: flex; flex-wrap: wrap; gap: 10px; }

  .steps {
    list-style: none; margin: 0; padding: 0;
    display: flex; flex-direction: column; gap: 10px; justify-content: center;
  }
  .steps__it {
    display: flex; gap: 12px; align-items: flex-start;
    padding: 12px 14px;
    background: var(--surface-2);
    border: 1px solid var(--line-divider);
    border-radius: var(--r-lg);
    transition: transform var(--t-micro) var(--ease-std), border-color var(--t-micro) var(--ease-std);
  }
  .steps__it:hover {
    transform: translateX(3px);
    border-color: color-mix(in oklab, var(--primary) 30%, var(--line-divider));
  }
  .steps__n {
    font-size: var(--fs-lg);
    color: var(--primary);
    font-weight: 700;
    line-height: 1.4;
    font-variant-numeric: tabular-nums;
  }
  .steps__it b { display: block; font-size: var(--fs-sm); color: var(--deep-text); }
  .steps__it span { font-size: var(--fs-xs); line-height: var(--lh-sm); color: var(--content-meta); }

  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  .pad { padding: 22px; }
  .h3 {
    font-size: var(--fs-lg);
    line-height: var(--lh-lg);
    margin: 0 0 12px;
  }
  .mt { margin-top: 26px; }
  .mut {
    margin: 0 0 14px;
    font-size: var(--fs-xs);
    line-height: var(--lh-md);
    color: var(--content-meta);
  }

  .quick { display: grid; grid-template-columns: repeat(auto-fill, minmax(158px, 1fr)); gap: 10px; }
  .quick__it {
    display: flex; flex-direction: column; gap: 4px;
    padding: 14px;
    text-decoration: none;
    animation: rise-in var(--t-card) var(--ease-std) both;
    animation-delay: calc(var(--i, 0) * var(--stagger));
    transition: transform var(--t-micro) var(--ease-std),
                background var(--t-micro) var(--ease-std),
                border-color var(--t-micro) var(--ease-std);
  }
  .quick__it:hover {
    transform: translateY(var(--lift-card));
    background: var(--btn-plain-bg-hover);
    text-decoration: none;
    border-color: color-mix(in oklab, var(--primary) 34%, var(--line-divider));
  }
  /* 按下只压深一档底色（原来缩到 0.95，卡片上的字会跟着抖） */
  .quick__it:active { background: var(--btn-plain-bg-active); }
  .quick__it :global(.quick__ic) { color: var(--primary); margin-bottom: 2px; }
  .quick__it b { font-size: var(--fs-sm); color: var(--deep-text); }
  .quick__it span { font-size: var(--fs-xs); color: var(--content-meta); }

  .packs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .packs li {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--line-divider);
    border-radius: var(--r-lg);
    transition: transform var(--t-micro) var(--ease-std), background var(--t-micro) var(--ease-std);
  }
  .packs li:hover { transform: translateX(3px); background: var(--surface-2); }
  .packs__k { font-size: var(--fs-sm); font-weight: 600; color: var(--deep-text); }
  .packs__need { font-size: var(--fs-2xs); color: var(--content-meta); }
  .packs__need code {
    background: var(--btn-regular-bg); padding: 1px 5px; border-radius: 4px;
    font-family: var(--font-mono); font-size: var(--fs-2xs);
  }
  .packs__v { margin-left: auto; font-size: var(--fs-xs); color: var(--content-meta); }
  .packs__btn { padding: 5px 14px; font-size: var(--fs-xs); }

  @media (max-width: 1080px) {
    .hero, .cols { grid-template-columns: 1fr; }
  }
</style>
