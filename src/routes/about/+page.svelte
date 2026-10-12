<script lang="ts">
  import { onMount } from 'svelte';
  import { setChrome } from '$lib/ui.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { modulesByState, moduleTitle } from '$lib/modules/registry';
  import { SOCIAL } from '$lib/social';
  import { openExternal } from '$lib/open';
  import { 版本, 构建时间 } from '$lib/version';

  onMount(() => setChrome('关于', '版本 · 现状 · 边界 · 致谢'));

  const { done, todo } = modulesByState();

  /* 「能做什么、不做什么」= **现在这一版的能力与边界**，一条一句，正面写。
     这里不解释"以前有什么、后来删了" —— 那是 PROGRESS / 交接单的活，
     用户 2026-10-12 专门说过：「能力边界是现在这个项目能做到什么，而不是把删除的功能继续说明」。
     每条里的数都是自己量的；没量过的不写。 */
  const limits = [
    '⑦ 画通道：先挑一套约定（自定 / 原神 lightmap / 三渲二 / 本工程实测三游戏），每套四个通道的含义与默认档位都不一样；填多少就是多少 —— 工具不夹档位，要 0 就 0、要 1 就 1。',
    '⑤ 合成：把绝区零的 _A / _M / _N 拼成一张 LM，并用「配对检查」对着磁盘核一遍哪张贴图少放了。别的游戏的 lightmap 它不做，那两张得自己画。',
    '⑦ 分区：给它一张材质 ID 图，按 ID 拆遮罩、按 ID 合通道；颜色语义靠「通道提取」按四路统计认出来（不按文件名猜）。它不读 PMX 里的材质划分，也不替你判断哪块归哪一档。',
    '法线：三种打包形态都认（标准蓝 / B 不是 z 的打包法 / AG 粉色 / RG 双通道），判据是自己扫 567 张量出来的 —— 模型库 400 张里 399 张本来就是标准蓝，绝区零人物 167 张里 156 张的 B 不是 z、要重建 Z；AG 与 RG 这两种在本库里一张实例都没有，是按公开约定给的，界面上也这么标。',
    '重建 Z：√(1 − x² − y²)，在素材两对真配对上逐像素相同；写回取整给的是截断（换四舍五入，R/G 会有像素差 1 级）。只往标准蓝那一边转 —— 不做反向打包（标准蓝 → AG / RG），也没有法线预览。',
    '放大核：双线性 / 最邻近 / 双三次 / Lanczos 四档。数据贴图（法线、材质 ID、遮罩）该用最邻近 —— 双线性会把 4 种材质 ID 插成 13 种假编号。',
    '⑨ 工程迁移：只动 .pmm / .emm 里的路径与它引用的文件 —— 先出表、先备份，校验不过一个字节都不写，改错了能撤销上一次；缺文件只报告，不替你删条目。MMD 的其它设置它不碰。'
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
        贴图通道处理、工程迁移。
      </p>
      <p class="mut">
        版本 <b class="mono">v{版本}</b>{#if 构建时间} · 构建 <span class="mono">{构建时间}</span>{/if}
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

    <h3 class="mt">界面上有什么</h3>
    <ul class="limits">
      <li>
        左边一列：全部功能，按组分的。工作区那一组是<b>总览</b>一页（三步走 + 一条进各功能的路）。
      </li>
      <li>
        左下角只有这一条「关于」。要调外观（主题色、壁纸、各层不透明度、动效、翻译引擎）
        点<b>右下角那颗齿轮</b>。
      </li>
      <li>
        底下那条是状态栏：左边放应用名与版本、当前页，中间是时间，右边是帧率 / JS / 卡顿 / 堆 / 节点
        和那颗「重新开始统计」。
      </li>
      <li>
        每页的形状一样：<b>左边放素材、中间看结果、右边调参数</b>（参数默认收起，点「参数」滑出来）。
        报错显示在左边的导航栏底部，不弹窗。
      </li>
    </ul>
  </div>

  <div class="card pad">
    <h3>能做什么、不做什么</h3>
    <p class="mut">这一版的能力与边界，一条一句。里面的数都是自己量的 —— 没量过的不写。</p>
    <ul class="limits">
      {#each limits as l (l)}<li>{l}</li>{/each}
    </ul>
  </div>
</section>

<section class="card pad mt">
  <h3>致谢与说明</h3>
  <p class="mut">
    界面参考了几位博客作者的公开样式（Mizuki、witchcat、lin-xin、RyuChan）与 Gloss Mod Manager 的骨架，
    只借鉴了尺寸、配色和交互这类可量化的部分，没有搬代码 —— 谁学谁的哪一处、当时量的什么数，
    记在 <span class="mono">docs/借鉴-新增参考.md</span> 里（一行一处，能对着核）。
  </p>
  <p class="mut">
    Ray、养乐多、ikClut 这几个名字指的是渲染包本身（界面上只作为对应功能的名字出现），
    版权归各自作者。本工具不含也不分发它们，只在你指定的路径上读写文件；
    别的工具名（各种 Converter / Studio / Painter / Editor）在界面和代码里一个都没有。
  </p>
  <p class="mut">
    贴图那几条规格（通道排法、法线形态、法线重建的算式与取整、B 通道窗口、放大核精度）
    都是自己对着素材量的 —— 同一目录的「输入 → 产物」逐像素比。
    数字与量法记在 <span class="mono">docs/产物配对实测.md</span> 与
    <span class="mono">PROGRESS.md</span>；量具是
    <span class="mono">tools/probe_normal_pack.py</span>、
    <span class="mono">tmp/法线转换.test.mjs</span>（跑真配对）那几个，
    各自文件头写着用法。没有从别的贴图工具里搬代码、阈值、文案或操作方式。
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
