<script lang="ts">
  /**
   * 最近工程 —— 选过的目录都记在这儿，点一下接着做。
   *
   * 记的是"目录 + 当时在干什么"，所以「接着做」能直接回到原来那个分区，
   * 不用重新从侧栏找一遍。
   */
  import { goto } from '$app/navigation';
  import { clearAll, exists, forget, recent, relTime } from '$lib/recent.svelte';
  import { dirName, isTauri } from '$lib/io';
  import Icon from '$lib/components/Icon.svelte';
  import Note from '$lib/components/wb/Note.svelte';

  /** 目录还在不在，异步查一次；查之前不显示"没了" */
  let gone = $state<Set<string>>(new Set());
  let checked = $state(false);

  $effect(() => {
    const list = recent.map((e) => e.path);
    if (!list.length) {
      gone = new Set();
      checked = true;
      return;
    }
    let stale = false;
    void (async () => {
      const dead = new Set<string>();
      for (const p of list) if (!(await exists(p))) dead.add(p);
      if (stale) return;
      gone = dead;
      checked = true;
    })();
    return () => {
      stale = true;
    };
  });

  function resume(path: string, href: string) {
    if (href) goto(href);
  }

  async function reveal(path: string) {
    if (!isTauri()) return;
    try {
      const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
      await revealItemInDir(path);
    } catch {
      /* 打不开就算了，不是关键路径 */
    }
  }
</script>

<div class="wb">
  <div class="wb__main">
    {#if !recent.length}
      <div class="card pad">
        <Note>
          还没记下任何目录。选过一次目录之后（批量提取、ILM 打包、乱码批处理…… 都会记），
          这里就会出现一条。记录只存在本机，删掉就等于清空。
        </Note>
      </div>
    {:else}
      <div class="card pad">
        <div class="row" style="margin-bottom:10px">
          <span class="row__k">{recent.length} 个目录，按最近用的排</span>
          <div class="grow"></div>
          <button class="btn btn--ghost btn--sm" onclick={clearAll}>
            <Icon name="ui.delete" size={14} />全部清掉
          </button>
        </div>

        <ul class="rl">
          {#each recent as e (e.path)}
            <li class="rl__it" class:is-gone={gone.has(e.path)}>
              <button
                class="rl__main"
                type="button"
                disabled={!e.href}
                title={e.href ? '回到「' + e.label + '」' : '这条是直接选的文件，没有可回的分区'}
                onclick={() => resume(e.path, e.href)}
              >
                <span class="rl__ic"><Icon name="ui.folder" size={16} /></span>
                <span class="rl__txt">
                  <b>{e.name}</b>
                  <em>{dirName(e.path) || e.path}</em>
                </span>
                {#if e.label}
                  <span class="rl__tag">{e.label}</span>
                {/if}
                <span class="rl__meta">
                  {relTime(e.at)}{#if e.used > 1}<i>· 用过 {e.used} 次</i>{/if}
                  {#if gone.has(e.path)}<i class="rl__gone">· 目录不在了</i>{/if}
                </span>
              </button>
              <div class="rl__act">
                <button class="ib" type="button" title="在资源管理器里显示" onclick={() => reveal(e.path)}>
                  <Icon name="ui.folder" size={14} />
                </button>
                <button class="ib" type="button" title="从列表里去掉" onclick={() => forget(e.path)}>
                  <Icon name="ui.close" size={14} />
                </button>
              </div>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>

  <aside class="card wb__side">
    <div class="grp">
      <h3 class="grp__t">记什么</h3>
      <ul class="mini ul">
        <li>你<b>主动选的目录</b>，不是扫出来的所有文件</li>
        <li>同一个目录只留一条，重复用就把次数加上去</li>
        <li>「当时在干什么」也记，所以点回去能落回原来那个分区</li>
        <li>最多留 24 条，再往前的自动挤掉</li>
      </ul>
    </div>

    <div class="grp">
      <h3 class="grp__t">不记什么</h3>
      <p class="mini">
        导出目录不记 —— 那是"往哪儿写"，不是"在做哪个工程"。
        选单个文件也不记，只记目录。
      </p>
    </div>

    <div class="grp">
      <h3 class="grp__t">存在哪</h3>
      <p class="mini">
        界面偏好的 localStorage，路径在 <span class="mono">%LOCALAPPDATA%\com.robineditor.app\</span> 下。
        不联网、不上传。
      </p>
    </div>
  </aside>
</div>

<style>
  .pad { padding: 16px; }
  .grow { flex: 1; }
  .ul { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 5px; }
  .btn--sm { padding: 4px 10px; font-size: var(--fs-2xs); }

  .rl { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .rl__it {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 6px;
    align-items: center;
    border-bottom: 1px solid var(--line-divider);
    transition: background var(--t-micro) var(--ease-std);
  }
  .rl__it:hover { background: var(--surface-2); }
  .rl__it.is-gone { opacity: 0.5; }

  .rl__main {
    display: grid;
    grid-template-columns: 26px minmax(0, 1fr) auto;
    grid-template-areas: 'ic txt tag' 'ic meta tag';
    gap: 2px 10px;
    align-items: center;
    padding: 9px 6px;
    border: 0;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
    color: inherit;
    min-width: 0;
  }
  .rl__main:disabled { cursor: default; }
  .rl__main:disabled .rl__txt b { color: var(--body-text); }

  .rl__ic { grid-area: ic; display: grid; place-items: center; color: var(--content-meta); }
  .rl__txt { grid-area: txt; min-width: 0; display: grid; gap: 1px; }
  .rl__txt b {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--deep-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rl__txt em {
    font-size: 10px;
    font-style: normal;
    color: var(--content-meta);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rl__tag {
    grid-area: tag;
    padding: 2px 8px;
    border-radius: var(--r-full);
    background: var(--rail-item-bg);
    color: var(--primary-ink);
    font-size: 10px;
    white-space: nowrap;
  }
  .rl__meta {
    grid-area: meta;
    font-size: 10px;
    color: var(--content-meta);
    display: flex;
    gap: 5px;
  }
  .rl__meta i { font-style: normal; }
  .rl__gone { color: var(--warn); }

  .rl__act { display: flex; gap: 2px; padding-right: 4px; }
  .ib {
    width: 26px; height: 26px;
    display: grid; place-items: center;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--content-meta);
    cursor: pointer;
    transition: background var(--t-micro) var(--ease-std), color var(--t-micro) var(--ease-std);
  }
  .ib:hover { background: var(--surface-3); color: var(--deep-text); }
</style>
