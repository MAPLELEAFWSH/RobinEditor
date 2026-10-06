<script lang="ts">
  /**
   * 批量提取 —— 一个目录一次跑完。
   *
   * 流程分两步，界面上也是分两步的：先「组计划」（只看文件名，瞬间出表），
   * 再「量一遍」（真读像素），量完把没东西可提的行自动撤掉，最后「开始提取」。
   *
   * 中间那步省不掉 —— `channel-facts.ts` 实测 `_D` 只有 14% 的 alpha 有数据，
   * 要是直接跑，用户拿到的是几十张全白图加一张"成功"的提示。
   */
  import {
    DEFAULT_OPTS,
    ROLE_LABEL,
    type PlanOpts,
    type PlanRow,
    buildPlan,
    measureRow,
    releaseRowUrls,
    runPool,
    runRow,
    summarize
  } from '$lib/pipeline';
  import { type FileRef, dirName, scanDir, pickFolder } from '$lib/io';
  import { 接目录 } from '$lib/dirdrop';
  import { CHANNEL_KEYS, CHANNEL_LABEL } from '$lib/img';
  import Note from '$lib/components/wb/Note.svelte';
  import { 提示自动关毫秒 } from '$lib/ui.svelte';
  import Icon from '$lib/components/Icon.svelte';

  /** 并发上限。后端解码本来就在排队，开太多只是互相抢 IPC */
  const LANES = 4;
  /** 表里一次最多显示多少行，多的靠筛选 */
  const PAGE = 120;

  let root = $state<string | null>(null);
  let refs = $state<FileRef[]>([]);
  let rows = $state<PlanRow[]>([]);
  let opts = $state<PlanOpts>({ ...DEFAULT_OPTS });

  let scanning = $state(false);
  let measuring = $state(false);
  let running = $state(false);
  let done = $state(0);
  let total = $state(0);

  let filter = $state<'all' | 'todo' | 'ok' | 'skip' | 'done'>('all');
  let msg = $state<{ kind: 'ok' | 'warn' | 'info'; text: string } | null>(null);

  const stats = $derived(summarize(rows));
  const picked = $derived(rows.filter((r) => r.on && r.job));
  const measured = $derived(rows.filter((r) => r.state !== 'wait'));
  const skipped = $derived(rows.filter((r) => r.state === 'skip' || r.state === 'err'));

  const shown = $derived.by(() => {
    const f = filter;
    const list =
      f === 'all'
        ? rows
        : f === 'todo'
          ? rows.filter((r) => r.job === 'alpha' || r.job === 'chan')
          : f === 'ok'
            ? rows.filter((r) => r.state === 'ok')
            : f === 'skip'
              ? skipped
              : rows.filter((r) => r.state === 'done');
    return list.slice(0, PAGE);
  });

  /**
   * 换开关就重组计划。重建会把量过的结果丢掉 —— 通道换了，量出来的结论也就不作数了。
   *
   * **要回收的那一份放进 `上一批`（普通变量，不参与响应式）。** 原来是
   * `releaseRowUrls(rows)` 读、下一行 `rows = buildPlan(...)` 写，`buildPlan` 每次给新数组 ——
   * effect 依赖自己的产物，无限重跑，点「选目录」冻 31 秒然后抛
   * `effect_update_depth_exceeded`（2026-09-23 量出来的）。读普通变量就没这条自环。
   */
  let 上一批: PlanRow[] = [];

  $effect(() => {
    const o = opts;
    const list = refs;
    // 触发依赖
    void o.alphaIsGloss;
    void o.metalChannel;
    void o.skipUnknown;
    if (!list.length) {
      releaseRowUrls(上一批);
      上一批 = [];
      rows = [];
      return;
    }
    releaseRowUrls(上一批);
    const 新 = buildPlan(list, o);
    上一批 = 新;
    rows = 新;
  });

  async function choose() {
    try {
      const dir = await pickFolder('批量提取', '/tools/channels?panel=pipeline');
      if (!dir) return;
      await 扫这个目录(dir);
    } catch (e) {
      msg = { kind: 'warn', text: `扫目录失败：${(e as Error).message}` };
      scanning = false;
    }
  }

  /**
   * 扫一个目录 —— 点「选目录」和**拖文件夹进来**走的是同一条
   * （用户 2026-09-24 之后要的：这一页原来一个落点都没有，拖进来只会得到
   * "没落在能接它的地方"）。拖文件夹 = 点这一页的「选目录」。
   */
  async function 扫这个目录(dir: string) {
    scanning = true;
    msg = null;
    try {
      root = dir;
      refs = await scanDir(dir);
      msg = refs.length
        ? { kind: 'info', text: `${dir} 里扫到 ${refs.length} 张图。先量一遍再决定跑哪些。` }
        : { kind: 'warn', text: `${dir} 里没扫到图片。` };
    } catch (e) {
      msg = { kind: 'warn', text: `扫目录失败：${(e as Error).message}` };
    }
    scanning = false;
  }

  /** 量一遍：真读像素。慢的一步，所以有进度 */
  async function measureAll() {
    const list = rows.filter((r) => r.state === 'wait' && r.job && r.job !== 'asis');
    if (!list.length) {
      msg = { kind: 'info', text: '没有要量的了。' };
      return;
    }
    measuring = true;
    msg = null;
    done = 0;
    total = list.length;
    try {
      await runPool(
        list,
        LANES,
        (r) => measureRow(r),
        (d) => (done = d)
      );
      const n = list.filter((r) => r.state === 'skip').length;
      msg =
        n > 0
          ? { kind: 'info', text: `量完 ${list.length} 张，其中 ${n} 张没有东西可提，已经撤掉了。` }
          : { kind: 'ok', text: `量完 ${list.length} 张，都有东西可提。` };
    } catch (e) {
      msg = { kind: 'warn', text: `量的时候断了：${(e as Error).message}` };
    }
    measuring = false;
    total = 0;
  }

  /** 跑：只跑勾上且量过或明确要跑的 */
  async function runAll() {
    const list = picked.filter((r) => r.state !== 'skip' && r.state !== 'done' && r.state !== 'err');
    if (!list.length) {
      msg = { kind: 'info', text: '没有勾上的行。' };
      return;
    }
    running = true;
    msg = null;
    done = 0;
    total = list.length;
    let bad = 0;
    try {
      await runPool(
        list,
        LANES,
        async (r) => {
          await runRow(r);
          if (r.state === 'err') bad++;
        },
        (d) => (done = d)
      );
      const n = list.length - bad;
      msg =
        bad > 0
          ? { kind: 'warn', text: `写了 ${n} 张，${bad} 张没写成功，看表里的原因。` }
          : { kind: 'ok', text: `写了 ${n} 张，都在各自的源图旁边。` };
    } catch (e) {
      msg = { kind: 'warn', text: `跑到一半断了：${(e as Error).message}` };
    }
    running = false;
    total = 0;
  }

  function toggleAll(on: boolean) {
    for (const r of shown) if (r.job && r.state !== 'skip') r.on = on;
  }

  const busy = $derived(scanning || measuring || running);
  const pct = $derived(total > 0 ? Math.round((done / total) * 100) : 0);

  function stateLabel(r: PlanRow): string {
    switch (r.state) {
      case 'ok':
        return '有东西';
      case 'skip':
        return '跳过';
      case 'err':
        return '失败';
      case 'done':
        return '已写';
      default:
        return r.job ? '待量' : '不动';
    }
  }
</script>

<div class="wb">
  <!-- 拖文件夹进来 = 点下面那颗「选目录」（这一页整页的活就是"指一个目录"） -->
  <div class="wb__main" use:接目录={{ 收: (p) => void 扫这个目录(p), label: '批量提取', href: '/tools/channels?panel=pipeline' }}>
    <div class="card pad">
      <div class="row">
        <span class="row__k">要处理的目录</span>
        <div class="grow">
          <button class="btn btn--primary" type="button" disabled={busy} onclick={choose}>
            <Icon name="ui.folder" size={15} />选目录
          </button>
        </div>
      </div>
      {#if root}
        <p class="mono path" title={root}>{root}</p>
      {/if}

      {#if rows.length}
        <div class="steps">
          <div class="step" class:is-done={measured.length === rows.length}>
            <b>1</b>
            <span>组计划</span>
            <em>{rows.length} 行</em>
          </div>
          <div class="step" class:is-done={measured.length > 0}>
            <b>2</b>
            <span>量一遍</span>
            <em>{measured.length} 行量过</em>
          </div>
          <div class="step" class:is-done={rows.some((r) => r.state === 'done')}>
            <b>3</b>
            <span>开始提取</span>
            <em>{rows.filter((r) => r.state === 'done').length} 张写出</em>
          </div>
        </div>

        <div class="acts" style="margin-top:12px">
          <button class="btn btn--ghost" type="button" disabled={busy} onclick={measureAll}>
            <Icon name="ui.search" size={15} />量一遍
          </button>
          <button class="btn btn--primary" type="button" disabled={busy || !picked.length} onclick={runAll}>
            <Icon name="ui.export" size={15} />提取勾上的 {picked.length} 张
          </button>
        </div>

        {#if total > 0}
          <div class="bar" style="margin-top:10px">
            <i style="width:{pct}%"></i>
            <span>{done} / {total}</span>
          </div>
        {/if}
      {/if}
    </div>

    {#if rows.length}
      <div class="card pad">
        <div class="row" style="margin-bottom:10px">
          <span class="row__k">表里看哪些</span>
          <div class="pick grow">
            <button class="pick__b" type="button" aria-pressed={filter === 'all'} onclick={() => (filter = 'all')}>
              全部 {rows.length}
            </button>
            <button class="pick__b" type="button" aria-pressed={filter === 'todo'} onclick={() => (filter = 'todo')}>
              要提的 {stats.todo}
            </button>
            <button class="pick__b" type="button" aria-pressed={filter === 'ok'} onclick={() => (filter = 'ok')}>
              量出有东西 {rows.filter((r) => r.state === 'ok').length}
            </button>
            <button class="pick__b" type="button" aria-pressed={filter === 'skip'} onclick={() => (filter = 'skip')}>
              跳过 / 失败 {skipped.length}
            </button>
            <button class="pick__b" type="button" aria-pressed={filter === 'done'} onclick={() => (filter = 'done')}>
              已写 {rows.filter((r) => r.state === 'done').length}
            </button>
          </div>
        </div>

        <div class="tree">
          <div class="tree__head">
            <label class="chk"><input type="checkbox" onchange={(e) => toggleAll((e.currentTarget as HTMLInputElement).checked)} /><span class="chk__box"></span></label>
            <span>文件</span>
            <span>认成</span>
            <span>怎么处理</span>
            <span>结果</span>
            <span class="c">预览</span>
          </div>
          {#each shown as r (r.key)}
            <div class="tree__row" class:is-off={!r.job}>
              <label class="chk">
                <input type="checkbox" bind:checked={r.on} disabled={!r.job || r.state === 'skip'} />
                <span class="chk__box"></span>
              </label>
              <span class="f" title={r.ref.path}>
                <b>{r.ref.name}</b>
                <em>{dirName(r.ref.rel || r.ref.name) || '.'}</em>
              </span>
              <span class="tag">{ROLE_LABEL[r.role]}</span>
              <span class="plan">
                {#if r.job === 'alpha'}
                  提 alpha → {r.outName}
                {:else if r.job === 'chan'}
                  提 {CHANNEL_LABEL[r.channel]} 路 → {r.outName}
                {:else}
                  <i class="muted">不动</i>
                {/if}
                <em>{r.detail || r.why}</em>
              </span>
              <span class="st st--{r.state}">{stateLabel(r)}</span>
              <span class="c">
                {#if r.url}
                  <img class="pv" src={r.url} alt="" />
                {:else}
                  <i class="muted">—</i>
                {/if}
              </span>
            </div>
          {/each}
        </div>
        {#if shown.length < rows.length && filter === 'all'}
          <p class="mini" style="margin-top:8px">表里只画前 {PAGE} 行，全部 {rows.length} 行照样会跑。</p>
        {/if}
      </div>
    {:else}
      <Note>
        选一个模型贴图目录。这里做的是 Blender 那套三条提取，一次性跑完：
        <b>法线 alpha → 光泽/粗糙</b>、<b>基础色 alpha → 粗糙</b>、
        <b>附属数据 _M 的某一路 → 金属度</b>。
      </Note>
    {/if}
  </div>

  <aside class="card wb__side">
    <div class="grp">
      <h3 class="grp__t">提取口径</h3>
      <div class="row">
        <span class="row__k">alpha 里装的是</span>
        <div class="pick grow">
          <button
            class="pick__b"
            type="button"
            aria-pressed={opts.alphaIsGloss}
            onclick={() => (opts.alphaIsGloss = true)}
          >
            光泽
          </button>
          <button
            class="pick__b"
            type="button"
            aria-pressed={!opts.alphaIsGloss}
            onclick={() => (opts.alphaIsGloss = false)}
          >
            粗糙
          </button>
        </div>
      </div>
      <p class="mini" style="margin-top:6px">
        一个开关同时管法线和基础色，输出的后缀也跟着变（<span class="mono">_Gloss</span> / <span class="mono">_Roughness</span>）。
        方向取决于目标 shader 怎么写，工具不替你拍。
      </p>

      <div class="row" style="margin-top:10px">
        <span class="row__k">金属度在 _M 的哪一路</span>
        <div class="pick grow">
          {#each CHANNEL_KEYS as k (k)}
            <button
              class="pick__b"
              type="button"
              aria-pressed={opts.metalChannel === k}
              onclick={() => (opts.metalChannel = k)}
            >
              {CHANNEL_LABEL[k]}
            </button>
          {/each}
        </div>
      </div>
      <p class="mini" style="margin-top:6px">
        `_M`（Unity 槽名 <span class="mono">_OtherDataTex</span>）是四路塞满的打包图。
        选错也只是提出一张全白 —— 量完会把「有东西的是哪一路」写在结果栏里。
      </p>

      <label class="chk" style="margin-top:10px">
        <input type="checkbox" bind:checked={opts.skipUnknown} />
        <span class="chk__box"></span>认不出的不动
      </label>
      <p class="mini" style="margin-top:6px">
        勾上时只处理认得出后缀的（<span class="mono">_N</span>
        <span class="mono">_D</span> <span class="mono">_M</span> …）。取消勾选会把认不出的都当基础色试一遍。
      </p>
    </div>

    <div class="grp">
      <h3 class="grp__t">扫到了什么</h3>
      <ul class="list">
        <li><b>要提的</b><span class="list__sp">{stats.todo}</span></li>
        <li><b>已就位</b><span class="list__sp">{stats.asis}</span></li>
        <li><b>不动</b><span class="list__sp">{stats.idle}</span></li>
        <li><b>认不出</b><span class="list__sp">{stats.unknown}</span></li>
      </ul>
      {#if stats.unknown > 0 && opts.skipUnknown}
        <p class="mini" style="margin-top:8px">
          有 {stats.unknown} 个认不出。取消「认不出的不动」可以把它们当基础色试一遍。
        </p>
      {/if}
    </div>

    <div class="grp">
      <h3 class="grp__t">为什么先量再跑</h3>
      <ul class="mini ul">
        <li>法线 `_N` 的 alpha：<b>55%</b> 有数据</li>
        <li>基础色 `_D`：<b>14%</b>；`_D1` 11%；`_D2` 12%</li>
        <li>`_M` 的 alpha：7%；信息在 RGB 里</li>
        <li>Ramp：<b>0%</b></li>
      </ul>
      <p class="mini" style="margin-top:8px">
        三个基础色变体比例差不多 —— 光看文件名判断不出哪张带数据，所以量这一步省不掉。
      </p>
    </div>

    <div class="grp">
      <h3 class="grp__t">写到哪</h3>
      <p class="mini">
        每张输出都跟源图<b>同目录同名</b>，只在后面加后缀（<span class="mono">T_Body_N.png</span>
        → <span class="mono">T_Body_N_Gloss.png</span>）。
        目标文件已存在时先备份成 <span class="mono">.bak</span>，不覆盖你原来的东西。
      </p>
    </div>
  </aside>
</div>

{#if msg}
  <div class="msgwrap"><Note kind={msg.kind} onclose={() => (msg = null)} 自动关={提示自动关毫秒}>{msg.text}</Note></div>
{/if}

<style>
  .pad { padding: 16px; }
  .grow { flex: 1; min-width: 0; }
  .ul { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 5px; }
  .msgwrap { margin-top: 12px; }
  .muted { color: var(--content-meta); font-style: normal; }
  .path {
    margin: 8px 0 0;
    font-size: var(--fs-2xs);
    color: var(--content-meta);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 三步条 */
  .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 12px; }
  .step {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid var(--line-divider);
    border-radius: var(--r-md);
    background: var(--surface-2);
    transition: border-color var(--t-micro) var(--ease-std);
  }
  .step.is-done { border-color: var(--primary); }
  .step b {
    width: 18px; height: 18px;
    display: grid; place-items: center;
    border-radius: 50%;
    background: var(--surface-3);
    font-size: 10px;
    color: var(--content-meta);
  }
  .step.is-done b { background: var(--primary); color: #fff; }
  .step span { font-size: var(--fs-2xs); color: var(--deep-text); }
  .step em { margin-left: auto; font-size: 10px; color: var(--content-meta); font-style: normal; }

  /* 进度 */
  .bar {
    position: relative;
    height: 18px;
    border-radius: var(--r-full);
    background: var(--surface-3);
    overflow: hidden;
  }
  .bar i {
    display: block; height: 100%;
    background: var(--primary);
    transition: width var(--t-micro) linear;
  }
  .bar span {
    position: absolute; inset: 0;
    display: grid; place-items: center;
    font-size: 10px;
    color: var(--deep-text);
  }

  /* 计划表 */
  .tree { display: flex; flex-direction: column; }
  .tree__head,
  .tree__row {
    display: grid;
    grid-template-columns: 28px minmax(9rem, 1.2fr) 5.5rem minmax(12rem, 2fr) 3.5rem 88px;
    gap: 8px;
    align-items: center;
    padding: 6px 4px;
    border-bottom: 1px solid var(--line-divider);
  }
  .tree__head {
    font-size: 10px;
    color: var(--content-meta);
    position: sticky;
    top: 0;
    background: var(--card-bg);
    z-index: 1;
  }
  .tree__row { transition: background var(--t-micro) var(--ease-std); }
  .tree__row:hover { background: var(--surface-2); }
  .tree__row.is-off { opacity: 0.55; }

  .tree__row .f { min-width: 0; display: grid; gap: 1px; }
  .tree__row .f b {
    font-size: var(--fs-2xs);
    font-weight: 500;
    color: var(--deep-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tree__row .f em {
    font-size: 10px;
    color: var(--content-meta);
    font-style: normal;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tree__row .plan { min-width: 0; display: grid; gap: 1px; font-size: var(--fs-2xs); }
  .tree__row .plan em {
    font-size: 10px;
    color: var(--content-meta);
    font-style: normal;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag {
    justify-self: start;
    padding: 1px 7px;
    border-radius: var(--r-full);
    background: var(--surface-3);
    font-size: 10px;
    color: var(--deep-text);
    white-space: nowrap;
  }
  .st {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: var(--r-sm);
    text-align: center;
    background: var(--surface-3);
    color: var(--content-meta);
  }
  .st--ok { color: var(--deep-text); }
  .st--done { background: var(--selection-bg); color: var(--deep-text); }
  .st--skip { color: var(--content-meta); }

  .c { display: grid; place-items: center; }
  .pv {
    width: 72px; height: 44px;
    object-fit: contain;
    border-radius: var(--r-sm);
    background: #fff;
    image-rendering: pixelated;
  }

  @media (max-width: 1100px) {
    .tree__head, .tree__row { grid-template-columns: 28px minmax(7rem, 1fr) 4.5rem minmax(8rem, 1.4fr) 3rem; }
    .tree__head .c, .tree__row .c { display: none; }
  }
</style>
