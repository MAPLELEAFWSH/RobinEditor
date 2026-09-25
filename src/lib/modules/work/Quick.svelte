<script lang="ts">
  /**
   * 快捷动作 —— 常去的地方固定成按钮，点一下就到。
   *
   * 动作表是从模块注册表派生的，所以新加的功能页会自动出现在右边待选清单里，
   * 不用回这个文件登记。
   *
   * 固定的那些点一下就执行；右边清单里的点一下就固定上去。
   */
  import { goto } from '$app/navigation';
  import {
    allActions,
    ensurePinnedLoaded,
    groupName,
    isPinned,
    move,
    pinnedActions,
    resetPinned,
    togglePin
  } from '$lib/quick.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Note from '$lib/components/wb/Note.svelte';
  /* 提示类提示条的统一下限：跟侧栏那条错误通道同一个 9 秒（`ui.svelte.ts`）。
     不传 `自动关` + `onclose` 的话 `Note` 既没有叉也不会自己走。 */
  import { 提示自动关毫秒 } from '$lib/ui.svelte';

  /* 固定列表的初值是空的，真值在这儿补 —— 只能在组件实例化时读，
     模块求值的时候注册表还没求值完（见 quick.svelte.ts 顶上的注释）。 */
  ensurePinnedLoaded();

  let pick = $state('');
  let msg = $state('');

  const pinnedList = $derived(pinnedActions());

  /** 待选清单按功能分组，组内保持注册表顺序 */
  const grouped = $derived.by(() => {
    const q = pick.trim().toLowerCase();
    const map = new Map<string, ReturnType<typeof allActions>>();
    for (const a of allActions()) {
      if (q && !(a.name + a.hint + a.id).toLowerCase().includes(q)) continue;
      if (!map.has(a.group)) map.set(a.group, []);
      map.get(a.group)!.push(a);
    }
    return [...map.entries()];
  });

  async function fire(a: { id: string; href?: string; run?: () => void | Promise<void> }) {
    msg = '';
    if (a.run) {
      try {
        await a.run();
        msg = '做完了。';
      } catch (e) {
        msg = `没做成：${(e as Error).message}`;
      }
      return;
    }
    if (a.href) goto(a.href);
  }
</script>

<div class="wb">
  <div class="wb__main">
    <div class="card pad">
      <div class="row" style="margin-bottom:12px">
        <span class="row__k">固定了 {pinnedList.length} 个</span>
        <div class="grow"></div>
        <button class="btn btn--ghost btn--sm" onclick={resetPinned}>
          <Icon name="ui.restore" size={14} />恢复默认
        </button>
      </div>

      {#if !pinnedList.length}
        <Note>
          还没固定任何一个。右边挑几个点一下加进来 ——
          最常用的是「贴图通道处理 · 批量提取」这种"直接跳到某个分区"的动作。
        </Note>
      {:else}
        <div class="qb">
          {#each pinnedList as a, i (a.id)}
            <div class="qb__cell">
              <button class="qb__b" type="button" onclick={() => fire(a)} title={a.hint}>
                <span class="qb__ic"><Icon name={a.id.startsWith('app.') ? 'ui.tune' : 'leaf.channels'} size={17} /></span>
                <span class="qb__t">
                  <b>{a.name}</b>
                  <em>{a.hint}</em>
                </span>
              </button>
              <div class="qb__ord">
                <button class="ib" type="button" title="往前挪" disabled={i === 0} onclick={() => move(a.id, -1)}>
                  <Icon name="ui.chevronUp" size={13} />
                </button>
                <button
                  class="ib"
                  type="button"
                  title="往后挪"
                  disabled={i === pinnedList.length - 1}
                  onclick={() => move(a.id, 1)}
                >
                  <Icon name="ui.chevronDown" size={13} />
                </button>
                <button class="ib" type="button" title="取消固定" onclick={() => togglePin(a.id)}>
                  <Icon name="ui.minusCircle" size={13} />
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="card pad">
      <div class="row" style="margin-bottom:10px">
        <span class="row__k">能固定什么</span>
        <div class="grow"></div>
        <label class="srch">
          <Icon name="ui.search" size={14} />
          <input type="search" placeholder="按名字找" bind:value={pick} />
        </label>
      </div>

      {#each grouped as [g, list] (g)}
        <div class="agrp">
          <h4 class="agrp__t">{groupName(g)}<span>{list.length}</span></h4>
          <div class="alist">
            {#each list as a (a.id)}
              <button
                class="alist__it"
                class:is-on={isPinned(a.id)}
                type="button"
                onclick={() => togglePin(a.id)}
                title={isPinned(a.id) ? '取消固定' : '固定到上面'}
              >
                <Icon name={isPinned(a.id) ? 'ui.check' : 'ui.plusCircle'} size={14} />
                <b>{a.name}</b>
              </button>
            {/each}
          </div>
        </div>
      {/each}

      {#if !grouped.length}
        <p class="mini">没找到叫「{pick}」的动作。</p>
      {/if}
    </div>
  </div>

  <aside class="card wb__side">
    <div class="grp">
      <h3 class="grp__t">动作是从哪来的</h3>
      <p class="mini">
        从模块注册表派生的 —— 每个「功能 · 分区」都是一个可固定的动作。
        以后加新功能，这里自动就多出来，不用另外登记。
      </p>
      <p class="mini" style="margin-top:6px">
        另外还有四个不走功能页的：深浅色、换主题色、收侧栏、开设置。
      </p>
    </div>

    <div class="grp">
      <h3 class="grp__t">固定在哪儿</h3>
      <p class="mini">
        存 localStorage（<span class="mono">robin.quick</span>），本机生效。
        固定过的动作如果以后被改名或删掉，下次打开会自动丢掉，不会留个点不动的空按钮。
      </p>
    </div>

    <div class="grp">
      <h3 class="grp__t">顺序</h3>
      <p class="mini">每个按钮右边有上下箭头，把最常用的挪到最前面。</p>
    </div>
  </aside>
</div>

{#if msg}
  <div class="msgwrap"><Note kind="ok" onclose={() => (msg = '')} 自动关={提示自动关毫秒}>{msg}</Note></div>
{/if}

<style>
  .pad { padding: 16px; }
  .grow { flex: 1; }
  .msgwrap { margin-top: 12px; }
  .btn--sm { padding: 4px 10px; font-size: var(--fs-2xs); }

  /* 固定区 */
  .qb {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: 10px;
  }
  .qb__cell {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: stretch;
    border: 1px solid var(--line-divider);
    border-radius: var(--r-lg);
    background: var(--surface-2);
    overflow: hidden;
    transition: border-color var(--t-micro) var(--ease-std), transform var(--t-micro) var(--ease-std);
  }
  .qb__cell:hover { border-color: var(--primary); transform: translateY(var(--lift-btn)); }
  .qb__b {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr);
    gap: 9px;
    align-items: center;
    padding: 10px 4px 10px 11px;
    border: 0;
    background: none;
    font: inherit;
    text-align: left;
    color: inherit;
    cursor: pointer;
    min-width: 0;
  }
  .qb__ic { color: var(--primary); display: grid; place-items: center; }
  .qb__t { min-width: 0; display: grid; gap: 2px; }
  .qb__t b {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--deep-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .qb__t em {
    font-size: 10px;
    font-style: normal;
    color: var(--content-meta);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .qb__ord {
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--line-divider);
    background: var(--surface-3);
  }
  .ib {
    width: 24px;
    flex: 1;
    min-height: 20px;
    display: grid;
    place-items: center;
    border: 0;
    background: none;
    color: var(--content-meta);
    cursor: pointer;
    transition: background var(--t-micro) var(--ease-std), color var(--t-micro) var(--ease-std);
  }
  .ib:hover:not(:disabled) { background: var(--rail-item-bg); color: var(--primary-ink); }
  .ib:disabled { opacity: 0.3; cursor: default; }

  /* 搜索框 */
  .srch {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 9px;
    border: 1px solid var(--line-divider);
    border-radius: var(--r-full);
    background: var(--surface-2);
    color: var(--content-meta);
  }
  .srch input {
    border: 0;
    background: none;
    font: inherit;
    font-size: var(--fs-2xs);
    color: var(--deep-text);
    outline: none;
    width: 12rem;
  }

  /* 待选清单 */
  .agrp { margin-top: 12px; }
  .agrp__t {
    margin: 0 0 6px;
    font-size: var(--fs-2xs);
    font-weight: 600;
    color: var(--content-meta);
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .agrp__t span { font-weight: 400; opacity: 0.7; }
  .alist { display: flex; flex-wrap: wrap; gap: 6px; }
  .alist__it {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border: 1px solid var(--line-divider);
    border-radius: var(--r-full);
    background: var(--surface-2);
    font: inherit;
    font-size: var(--fs-2xs);
    color: var(--body-text);
    cursor: pointer;
    transition: border-color var(--t-micro) var(--ease-std), background var(--t-micro) var(--ease-std);
  }
  .alist__it b { font-weight: 500; }
  .alist__it:hover { border-color: var(--primary); }
  .alist__it.is-on {
    background: var(--rail-item-bg);
    border-color: var(--primary);
    color: var(--primary-ink);
  }
  .mini { font-size: var(--fs-2xs); line-height: var(--lh-md); color: var(--content-meta); margin: 0; }
</style>
