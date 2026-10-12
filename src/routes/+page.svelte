<script lang="ts">
  import { onMount } from 'svelte';
  import { setChrome } from '$lib/ui.svelte';
  import { STEPS, getModule, moduleTitle } from '$lib/modules/registry';
  import Icon from '$lib/components/Icon.svelte';

  onMount(() => setChrome('工作区', '总览'));

  /* 用户 2026-09-26：「简化工作区模块内容」——
     这一页原来有两块**写死的假数据**：
       · 「最近工程」永远显示"还没打开过工程"（`recent.svelte.ts` 里明明有真数据）；
       · 「环境与路径」四条永远显示"未载入"（真的载没载在 `prefs` 里，这一页根本没读）。
     跟顶栏那个写死的"未打开工程"是同一类毛病，一起删了。
     也删了 hero 里那两颗按钮：「选择文件夹」**连 onclick 都没有**（点了什么都不发生），
     「直接进通道处理」跟左边侧栏的 ⑦ 是同一个去处。
     2026-10-07：工作区那两页（最近工程 / 快捷动作）也删了，这一页成了工作区里唯一的一页。 */
  const quickIds = ['channels', 'ilm', 'glitch'];
  const quick = quickIds.map((id) => getModule(id)!).filter(Boolean);
</script>

<div class="page">
  <section class="hero card rise" style="--i:0">
    <div class="hero__lead">
      <h2>选个模型文件夹就能开工</h2>
      <p>
        工具先扫一遍，认出哪些是漫反射底图、哪些已经有 lightmap 该跳过，再按目标游戏的规格批量出图，
        最后留给你逐张手修。渲染包的位置要自己填，这里不打包也不分发。
      </p>
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

  <section class="card pad rise" style="--i:1">
    <h3 class="h3">从哪一页开工</h3>
    <div class="quick">
      {#each quick as q, i (q.id)}
        <a class="quick__it card__inner" href="/tools/{q.id}" style="--i:{i + 2}">
          <Icon name={q.icon} size={20} cls="quick__ic" />
          <b>{moduleTitle(q)}</b>
          <span>{q.panels?.length ?? 0} 个分区</span>
        </a>
      {/each}
    </div>
    <p class="mut" style="margin-top:12px">
      左边导航里是全部功能；外观那些（主题色、壁纸、动效）在右下角那颗齿轮里。
    </p>
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
    margin: 0;
    font-size: var(--fs-md);
    line-height: var(--lh-md);
    color: var(--content-meta);
  }

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

  .pad { padding: 22px; }
  .h3 {
    font-size: var(--fs-lg);
    line-height: var(--lh-lg);
    margin: 0 0 12px;
  }
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

  @media (max-width: 1080px) {
    .hero { grid-template-columns: 1fr; }
  }
</style>
