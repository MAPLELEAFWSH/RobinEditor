<script lang="ts">
  import { onMount } from 'svelte';
  import { setChrome } from '$lib/ui.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { modulesByState, moduleTitle } from '$lib/modules/registry';
  import { SOCIAL } from '$lib/social';
  import { openExternal } from '$lib/open';

  onMount(() => setChrome('关于', '版本 · 边界 · 致谢'));

  const { done, todo } = modulesByState();

  /* 「能力边界」= 本工程自己量出来的数，写在这里免得你以为它比实际更聪明。
     每条都能追到出处；没量过的不写。 */
  const limits = [
    '通道含义按用户画 ILM 的做法：R Gloss / G AO / B Specular / A Line。我们主动挑的档位夹在 0.05~0.95（0 = 永久阴影、1 = 永久光照），但照着样张量出来的档位照原样写 —— 他的样张里 R 有九成是 0。游戏那张 lightmap 是另一套约定，两套别混。',
    '跨模型套用学到的规律是负收益，所以不提供「照着别的模型猜」这种按钮。',
    'PMX 里材质级的 UV 边界反而不如按图自动分块准，所以默认不读材质划分。',
    '法线的三种打包形态是自己扫素材量出来的（567 张名字像法线的图）：模型库 400 张里 399 张本来就是标准蓝，绝区零人物 167 张里 156 张的 B 不是 z（要重建）。AG 打包（粉色，X 在 A）和 RG 双通道（B 空）在这个库里一张都没有 —— 那两条是按公开约定给的，不是量出来的覆盖率。',
    '重建 Z 的算式（√(1 − x² − y²)）在素材那两对真配对上逐像素相同；写回取整给的是截断，跟四舍五入差在 R/G 各 63/256 个取值上。',
    '⑦ 合并 / 调换那几页：源尺寸跟目标不一致时才谈放大核。数据贴图（法线、材质 ID、遮罩）用最邻近 —— 双线性会把 4 种材质 ID 插成 13 种，那是假编号。'
  ];
</script>

<section class="card pad">
  <div class="brand">
    <img class="brand__mark" src="/app-icon.png" alt="" width="46" height="46" />
    <div>
      <h2>RobinEditor</h2>
      <p class="mut">
        MMD 贴图与渲染包的整理工具。Tauri 2 + Svelte，装完就能用，不依赖本地开发环境。
        左边七项功能：日文乱码修复、ikClut 调色、Ray 编辑器、绝区零贴图合成、养乐多上材质、
        贴图通道处理、工程迁移。文档里那些圈码是需求单上的编号（①②③…），
        其中 msToon 与 Ramp 两个已经删了，号不补。
      </p>
    </div>

    <ul class="social">
      {#each SOCIAL as s (s.href)}
        <li>
          <a
            class="social__it"
            href={s.href}
            title={s.title}
            rel="noreferrer"
            onclick={(e) => {
              e.preventDefault();
              openExternal(s.href);
            }}
          >
            <Icon name={s.icon} size={20} cls="social__ic" />
            <span class="social__txt">
              <b>{s.label}</b>
              <span>{s.handle}</span>
            </span>
            <Icon name="ui.open" size={13} cls="social__out" />
          </a>
        </li>
      {/each}
    </ul>
  </div>
</section>

<section class="cols">
  <div class="card pad">
    <h3>已经做好的</h3>
    <ul class="tags">
      {#each done as m (m.id)}
        <li class="tag tag--ok"><Icon name="ui.check" size={13} />{moduleTitle(m)}</li>
      {/each}
    </ul>
    {#if todo.length}
      <h3 class="mt">排在后面</h3>
      <ul class="tags">
        {#each todo as m (m.id)}<li class="tag">{moduleTitle(m)}</li>{/each}
      </ul>
    {:else}
      <!-- 一个都没有的时候不再画一条空标题（原来那行"排在后面"底下是空的） -->
      <p class="mut mt">没有排在后面的了。</p>
    {/if}
  </div>

  <div class="card pad">
    <h3>能力边界</h3>
    <p class="mut">这些是实测出来的数，写在这里免得你以为它比实际更聪明。</p>
    <ul class="limits">
      {#each limits as l (l)}<li>{l}</li>{/each}
    </ul>
  </div>
</section>

<section class="card pad mt">
  <h3>致谢与说明</h3>
  <p class="mut">
    界面参考了几位博客作者的公开样式（Mizuki、witchcat、lin-xin、RyuChan）与 Gloss Mod Manager 的骨架，
    只借鉴了尺寸、配色和交互这类可量化的部分，没有搬代码。
  </p>
  <p class="mut">
    Ray、养乐多、ikClut 的版权归各自作者。本工具不含也不分发它们，只在你指定的路径上读写文件。
  </p>
  <p class="mut">
    贴图那几条规格（通道排法、法线形态、B 通道窗口、放大核精度）都是自己对着素材量的 ——
    同一目录的「输入 → 产物」逐像素比，数字与量法记在 <span class="mono">docs/产物配对实测.md</span>，
    量具是 <span class="mono">tools/probe_normal_pack.py</span> 那几个。
    没有从别的贴图工具里搬代码、阈值、文案或操作方式；别人的工具名在本工程里一个都没有。
  </p>
  <p class="mut">图标来自 Material Design Icons。</p>
</section>

<style>
  .pad { padding: 22px; }
  .mt { margin-top: 18px; }
  h2 { font-size: 20px; }
  h3 { font-size: 14.5px; margin-bottom: 10px; }
  .mut { font-size: 12.5px; line-height: 1.8; color: var(--content-meta); margin: 0 0 12px; }
  .brand { display: flex; align-items: center; gap: 16px; }
  .brand__mark {
    width: 46px; height: 46px; border-radius: var(--r-lg);
    object-fit: cover; display: block; flex: none;
  }

  /* 个人主页入口，靠右，跟标题同一行；窄了就换行到下面 */
  .social { list-style: none; margin: 0 0 0 auto; padding: 0; display: flex; gap: 8px; flex-wrap: wrap; }
  .social__it {
    display: flex; align-items: center; gap: 9px;
    padding: 7px 11px 7px 10px;
    border: 1px solid var(--line-divider);
    border-radius: var(--r-lg);
    background: var(--card-bg-nested);
    text-decoration: none;
    transition: transform var(--t-micro) var(--ease-std),
                border-color var(--t-micro) var(--ease-std),
                background var(--t-micro) var(--ease-std);
  }
  .social__it:hover {
    transform: translateY(var(--lift-btn));
    border-color: color-mix(in oklab, var(--primary) 34%, var(--line-divider));
  }
  .social__it:active { transform: scale(var(--press-scale-soft)); }
  .social__it :global(.social__ic) { color: var(--primary); }
  .social__txt { display: flex; flex-direction: column; line-height: 1.25; }
  .social__txt b { font-size: var(--fs-sm); color: var(--deep-text); }
  .social__txt span { font-size: var(--fs-2xs); color: var(--content-meta); }
  .social__it :global(.social__out) { color: var(--content-meta); opacity: 0.7; }
  .cols { display: grid; grid-template-columns: 1fr 1.15fr; gap: 16px; margin-top: 16px; }
  .tags { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
  .tag--ok { background: var(--rail-item-bg); color: var(--primary-ink); gap: 4px; }
  .limits { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 9px; }
  .limits li { font-size: 12.5px; line-height: 1.75; color: var(--content-meta); }

  @media (max-width: 1080px) {
    .cols { grid-template-columns: 1fr; }
  }
  @media (max-width: 760px) {
    .brand { flex-wrap: wrap; }
    .social { margin-left: 0; width: 100%; }
  }
</style>
