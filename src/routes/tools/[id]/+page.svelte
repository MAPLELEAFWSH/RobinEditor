<script lang="ts">
  /**
   * 功能页。所有内容从模块注册表派生 —— 加新功能不用改这个文件。
   *
   * 分区面板有两条路：
   *   · 模块给了 component → 渲染它（以后各功能的真正界面）
   *   · 没给 → 落到通用三步工作区骨架
   */
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { Component } from 'svelte';
  import { getModule, moduleTitle, STEPS } from '$lib/modules/registry';
  import { setChrome, setErr } from '$lib/ui.svelte';
  import { 抽屉, 设页键 } from '$lib/side.svelte';
  import Icon from '$lib/components/Icon.svelte';

  const id = $derived(page.params.id ?? '');
  const mod = $derived(getModule(id));

  let cur = $state('');
  let step = $state(0);
  let dropping = $state(false);
  let files = $state<string[]>([]);

  /**
   * 「参数」开关**只在这里探、在右下角那颗按钮上出现**（2026-09-23 挪的）。
   *
   * 参数抽屉（`.wb__side`）是各模块自己画的，但"怎么把它打开"不该每页各写一套 ——
   * 实测：31 处 `aside.card.wb__side` 里只有 Ray / Migrate 两个模块自己放了开关，
   * 其余十个页面的参数栏**停在视口外、一个能打开它的控件都没有**（等于没有参数）。
   * 所以：页里真画了 `.wb__side` 就把 `抽屉.有` 置真，右下角那颗按钮跟着出来，谁都不用再管。
   *
   * **按钮本身画在 `AppShell` 的右下角悬浮球列里**（跟「外观」同槽同层）——
   * 原来挂在页面标题行右边，跟分区条/标签挤在同一层，用户报过图层冲突。
   *
   * 组件是懒加载的，得等它挂上才知道有没有，所以挂载后探几次（本地文件，一两帧就到）。
   */

  /* 收起状态**按页记**：换页时把这一页自己的那份读出来（各页互不影响） */
  $effect(() => {
    设页键(id ? `tools/${id}` : 'home');
  });

  $effect(() => {
    // 总览就是首页，别让 /tools/overview 变成第二个入口
    if (id === 'overview') goto('/', { replaceState: true });
  });

  /**
   * 分区跟着地址栏走。
   *
   * 之前 `cur` 只是组件内状态，`?panel=` 传进来完全没用 ——
   * 快捷动作和最近工程都是拿 URL 回跳的，不认参数就落回第一个分区。
   * 两边同步之后，那些链接才真的指得准。
   */
  $effect(() => {
    if (!mod) return;
    const ids = mod.panels?.map((p) => p.id) ?? [];
    if (!ids.length) return;
    const want = page.url.searchParams.get('panel') ?? '';
    const next = ids.includes(want) ? want : (cur && ids.includes(cur) ? cur : (mod.panel ?? ids[0]));
    if (next !== cur) cur = next;
  });

  /**
   * 点了分区条就跳。
   *
   * 这里必须走 goto，不能直接 history.replaceState：那样 SvelteKit 不知道地址变了，
   * page.url 还是旧值，上面那个同步 effect 会拿着旧值把 cur 拽回去 ——
   * 现象是「地址栏换了、面板没换」，点了等于没点。
   * replaceState 保持「不往历史里堆」，noScroll 免得切分区把页面滚到顶上。
   */
  function pickPanel(pid: string) {
    if (pid === cur) return;
    cur = pid;
    const u = new URL(location.href);
    u.searchParams.set('panel', pid);
    void goto(`${u.pathname}${u.search}`, { replaceState: true, noScroll: true, keepFocus: true });
  }

  $effect(() => {
    if (!mod) return;
    setChrome(moduleTitle(mod), mod.desc);
  });

  const panel = $derived(mod?.panels?.find((p) => p.id === cur));

  /**
   * 分区组件**按需拉**。
   *
   * 注册表里存的是加载器不是组件：顶层把七个功能都 import 进去的话，
   * 打开首页就得先解析执行全部功能的代码（实测首屏 642 KB）。
   * 这里 await 一下，打包器才拆得成"打开哪个拉哪个"。
   *
   * `alive` 是防串台：快速连着切两个功能时，先到的那个回来别把后到的覆盖掉。
   *
   * 另外记着"这份组件是给哪个加载器拉来的"（`loadedFor`）。只有对得上才渲染它 ——
   * 同一个模块内部换分区（⑦ 十个分区共用一个组件）时加载器没变，组件原地留着、
   * 只是换个 `panelId` 重画，**不会闪一下**；跨模块换的时候才对不上，先占位。
   */
  let PanelComp = $state<Component | null>(null);
  let loadedFor = $state<(() => Promise<{ default: Component }>) | null>(null);
  let loadErr = $state('');
  /** 改一下就重新拉一次（"再试一次"按钮用） */
  let retry = $state(0);
  $effect(() => {
    const load = panel?.load;
    void retry;
    if (!load) {
      PanelComp = null;
      loadedFor = null;
      loadErr = '';
      return;
    }
    let alive = true;
    loadErr = '';
    load()
      .then((m) => {
        if (!alive) return;
        PanelComp = m.default;
        loadedFor = load;
      })
      .catch((e: Error) => {
        if (!alive) return;
        /* 两边都报：侧栏那条是硬规矩，面板里这条是"不然这里就是一格空白" */
        loadErr = e.message;
        setErr(`这个分区没载进来：${e.message}`);
      });
    return () => {
      alive = false;
    };
  });
  /** 这个分区该画的组件到手了没有 */
  const ready = $derived(!!PanelComp && !!panel?.load && loadedFor === panel.load);

  /* 组件挂上之后再探"这一页画了参数抽屉没有"（懒加载，探几次就够）。
     离开这一页 / 换分区时**先清掉**，免得右下角那颗按钮留在没抽屉的页上。

     **探到的结果先放局部变量，别在同一个 effect 里读回 `抽屉.有`** ——
     写完再读就是"effect 依赖自己的产物"，Svelte 会一路重跑到
     `effect_update_depth_exceeded`，表现是**开机幕布再也不撤、整页 opacity:0**
     （2026-09-23 实测，就是这一行写出来的）。`抽屉.有` 只写不读。 */
  $effect(() => {
    void ready;
    void cur;
    const 看 = () => !!document.querySelector('.wb__side');
    const 有 = 看();
    抽屉.有 = 有;
    if (有) return;
    let alive = true;
    let n = 0;
    const 探 = () => {
      if (!alive) return;
      if (看()) {
        抽屉.有 = true;
        return;
      }
      if (++n < 20) setTimeout(探, 60);
    };
    setTimeout(探, 60);
    return () => {
      alive = false;
      抽屉.有 = false;
    };
  });

  function pick() {
    (document.getElementById('pick') as HTMLInputElement | null)?.click();
  }
  function onInput(e: Event) {
    const input = e.target as HTMLInputElement;
    files = Array.from(input.files ?? []).map((f) => f.name);
    if (files.length) step = 1;
  }
  function clear() {
    files = [];
    step = 0;
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dropping = false;
    const items = Array.from(e.dataTransfer?.files ?? []).map((f) => f.name);
    if (items.length) {
      files = items;
      step = 1;
    }
  }
</script>

{#if !mod}
  <div class="card pad rise">
    <h2>找不到这个功能</h2>
    <p class="mut">链接可能过期了。<a href="/">回工作区</a> 重新挑一个。</p>
  </div>
{:else}
  <div class="fn">
    <header class="head rise" style="--i:0">
      <div class="head__txt">
        <h1>{mod.name}</h1>
        <!-- 顶部一句话（设计准则 §一）：进页面就知道这一页干什么。
             全站**同一个位置**（标题正下方），文案来自注册表的 `job`。 -->
        <p class="head__job">
          <Icon name="ui.info" size={13} />
          <span>{mod.job ?? mod.desc}</span>
        </p>
        {#if mod.job}<p class="head__desc">{mod.desc}</p>{/if}
      </div>
      <div class="head__acts">
        {#if mod.ready}
          <span class="tag tag--ok"><Icon name="ui.check" size={13} />可用</span>
        {:else}
          <span class="tag tag--soon">排期中</span>
        {/if}
      </div>
    </header>

    {#if mod.panels?.length}
      <nav class="seg rise" style="--i:1" aria-label="分区">
        {#each mod.panels as p (p.id)}
          <button
            class="seg__btn"
            class:is-on={p.id === cur}
            onclick={() => pickPanel(p.id)}
            aria-current={p.id === cur ? 'page' : undefined}
          >
            <span class="seg__label">{p.label}</span>
            {#if p.hint}<span class="seg__hint">{p.hint}</span>{/if}
          </button>
        {/each}
      </nav>
    {/if}

    {#if ready}
      <div class="panel-host rise" style="--i:2"><PanelComp panelId={cur} /></div>
    {:else if loadErr}
      <!-- 拉不到就说清楚是哪一步、错在哪，并给一条重试。别停在一句"正在载入"上 -->
      <div class="card pad panel-host">
        <b>这个分区的界面没载进来</b>
        <p class="mut">出错信息：{loadErr}</p>
        <p class="mut">文件都在安装目录里，重试一次通常就好；一直不行就说一声。</p>
        <button class="btn btn--ghost" onclick={() => (retry += 1)}>
          <Icon name="ui.refresh" size={15} />再试一次
        </button>
      </div>
    {:else if panel?.load}
      <!-- 分区组件正在拉。本地文件，一般一两帧就到，所以只放一行字，不做转圈 -->
      <div class="panel-host"><p class="mut">正在载入这个分区…</p></div>
    {:else}
      <ol class="flow rise" style="--i:2">
        {#each STEPS as s, i (s.n)}
          <li class="flow__it" class:is-on={i === step} class:is-done={i < step}>
            <span class="flow__n">{i < step ? '✓' : s.n}</span>
            <span class="flow__t">{s.t}</span>
            <span class="flow__d">{s.d}</span>
          </li>
        {/each}
      </ol>

      <section class="work rise" style="--i:3">
        <div class="card work__main">
          {#if files.length === 0}
            <div
              class="drop"
              class:drop--hot={dropping}
              role="button"
              tabindex="0"
              onclick={pick}
              onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && pick()}
              ondragover={(e) => {
                e.preventDefault();
                dropping = true;
              }}
              ondragleave={() => (dropping = false)}
              ondrop={onDrop}
            >
              <Icon name="ui.import" size={34} cls="drop__ic" />
              <b>把文件或文件夹拖进来</b>
              <span>
                也可以点这里选。当前分区：{panel?.label ?? ''}{panel?.hint ? `（${panel.hint}）` : ''}
              </span>
              <input id="pick" type="file" multiple hidden onchange={onInput} />
            </div>
          {:else}
            <div class="picked">
              <div class="picked__top">
                <b>已选 {files.length} 个</b>
                <button class="btn btn--ghost" onclick={clear}>
                  <Icon name="ui.refresh" size={15} />重选
                </button>
              </div>
              <ul>
                {#each files.slice(0, 8) as f (f)}<li>{f}</li>{/each}
              </ul>
              {#if files.length > 8}<span class="mut">另外还有 {files.length - 8} 个</span>{/if}
            </div>
          {/if}
        </div>

        <aside class="card work__side">
          <h3>参数</h3>
          {#if step < 1}
            <p class="mut">选完文件，这里才会按「{panel?.label ?? ''}」长出来。</p>
          {:else}
            <p class="mut">参数面板还没接。接上之后每一项都带预览，确认了才写盘。</p>
          {/if}
          <div class="side__foot">
            <button class="btn btn--primary" disabled={step < 1}>
              <Icon name="ui.export" size={16} />导出
            </button>
            <span class="mut">覆盖前自动备份</span>
          </div>
        </aside>
      </section>
    {/if}
  </div>
{/if}

<style>
  /* 功能页自己竖排，不依赖父级的 flex 方向 */
  .fn {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .head {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 10px 14px;
    align-items: start;
  }
  .head__acts { display: flex; align-items: center; gap: 8px; }
  .head__txt h1 { margin: 0; font-size: var(--fs-xl); line-height: var(--lh-xl); letter-spacing: var(--tracking-tight); }
  .head__txt > p {
    margin: 7px 0 0;
    max-width: 68ch;
    font-size: var(--fs-sm);
    line-height: var(--lh-md);
    color: var(--content-meta);
  }
  /* 顶部那一句话：比下面那段说明更显眼（新手先看这一句就够了） */
  .head__job {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-top: 6px !important;
    font-size: var(--fs-md) !important;
    color: var(--body-text) !important;
    min-width: 0;
  }
  .head__job :global(svg) { flex: none; color: var(--primary); position: relative; top: 2px; }
  .head__job span { min-width: 0; overflow-wrap: anywhere; }
  .head__desc { margin-top: 4px !important; font-size: var(--fs-xs) !important; opacity: 0.9; }
  .tag--ok { background: var(--rail-item-bg); color: var(--primary-ink); gap: 4px; }
  .tag--soon { background: var(--surface-3); }

  .seg { margin: 0; }
  .seg__label { font-size: var(--fs-sm); font-weight: 600; color: var(--deep-text); }
  .seg__hint { font-size: var(--fs-2xs); color: var(--content-meta); }
  .seg__btn.is-on .seg__label { color: var(--primary-ink); }

  /* 分区宿主。撑到"一屏还剩多少"（`--page-fill`，AppShell 量的），好让工作区把底栏
     顶到屏幕底 —— 内容比一屏短时底栏本来会停在正文末尾悬在半空，打开参数抽屉就被
     那条写盘条横切。单分区也照撑：`.wb` 吃掉多出来的高度，底栏自然落到最下面。
     `240px` 是没量到 `--page-fill` 时（首帧、非工作区）的退路。 */
  .panel-host {
    display: flex;
    flex-direction: column;
    min-height: var(--page-fill, 240px);
  }
  /* 工作区主体吃掉空出来的高度（`flex-shrink: 0`：内容比一屏高时不许把它压扁） */
  .panel-host > :global(.wb) { flex: 1 0 auto; }

  .flow {
    list-style: none; margin: 0; padding: 0;
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
  }
  .flow__it {
    padding: 12px 14px;
    border: 1px solid var(--line-divider);
    border-radius: var(--r-lg);
    background: var(--card-bg);
    opacity: 0.6;
    transition: opacity var(--t-micro) var(--ease-std),
                border-color var(--t-micro) var(--ease-std),
                transform var(--t-micro) var(--ease-std);
  }
  .flow__it.is-on, .flow__it.is-done { opacity: 1; }
  .flow__it.is-on {
    border-color: color-mix(in oklab, var(--primary) 45%, var(--line));
    transform: translateY(-1px);
  }
  .flow__n {
    display: inline-grid; place-items: center;
    width: 21px; height: 21px; margin-right: 7px;
    border-radius: 50%;
    background: var(--surface-3); color: var(--content-meta);
    font-size: var(--fs-2xs); font-weight: 700;
    transition: background var(--t-micro) var(--ease-std), color var(--t-micro) var(--ease-std);
  }
  .flow__it.is-on .flow__n { background: var(--primary); color: #fff; }
  .flow__it.is-done .flow__n { background: var(--rail-item-bg); color: var(--primary-ink); }
  .flow__t { font-size: var(--fs-sm); font-weight: 650; }
  .flow__d {
    display: block; margin: 6px 0 0;
    font-size: var(--fs-2xs); line-height: var(--lh-sm); color: var(--content-meta);
  }

  .work {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 19rem;
    gap: 12px;
    align-items: start;
  }
  .work__main { min-height: 250px; display: grid; padding: 14px; }
  .work__side { padding: 16px; display: grid; gap: 10px; align-content: start; }
  .work__side h3 { margin: 0; font-size: var(--fs-md); }
  .mut { margin: 0; font-size: var(--fs-xs); line-height: var(--lh-md); color: var(--content-meta); }
  .pad { padding: 22px; }

  .drop {
    display: grid; justify-items: center; align-content: center; gap: 8px;
    padding: 44px 16px;
    border: 1.5px dashed color-mix(in oklab, var(--primary) 34%, var(--line));
    border-radius: var(--r-lg);
    background: var(--surface-2);
    color: var(--content-meta);
    cursor: pointer; text-align: center;
    transition: border-color var(--t-micro) var(--ease-std),
                background var(--t-micro) var(--ease-std),
                transform var(--t-micro) var(--ease-std);
  }
  .drop--hot, .drop:hover {
    border-color: var(--primary);
    background: color-mix(in oklab, var(--primary) 6%, var(--surface-2));
  }

  /* 拖东西进来悬在这儿 —— 跟 .slot--hot 同一套语言（wb.css），
     两个"放这儿"的落点长得不一样的话，用户会以为其中一个是坏的。 */
  .drop--hot {
    transform: scale(1.01);
    background: color-mix(in oklab, var(--primary) 9%, var(--surface-2));
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--primary) 26%, transparent);
  }
  .drop--hot::before {
    content: '';
    position: absolute;
    inset: -1px -1px auto;
    height: 2px;
    border-radius: var(--r-full);
    background: var(--primary);
    animation: drop-beam var(--t-micro) var(--ease-std) both;
  }
  @keyframes drop-beam {
    from { transform: scaleX(0.2); opacity: 0; }
    to   { transform: none; opacity: 1; }
  }
  .drop--hot b, .drop--hot :global(.drop__ic) { color: var(--primary-ink); }
  .drop b { color: var(--deep-text); font-size: var(--fs-lg); }
  .drop span { font-size: var(--fs-xs); }
  .drop :global(.drop__ic) { color: var(--primary); opacity: 0.85; }

  .picked { padding: 4px; }
  .picked__top { display: flex; align-items: center; justify-content: space-between; }
  .picked ul {
    margin: 10px 0;
    padding-left: 18px;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    line-height: 1.9;
    color: var(--content-meta);
  }

  .side__foot {
    margin-top: 4px;
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  }

  @media (max-width: 1100px) {
    .work { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 720px) {
    .flow { grid-template-columns: 1fr; }
  }
</style>
