<script module lang="ts">
  /* 组 key → 还活着的槽数。见下面 `$effect` 里为什么必须数。 */
  const 组内活着的槽 = new Map<string, number>();
</script>

<script lang="ts">
  /**
   * 图片槽。七个功能都要"放一张图进来"，各写一遍就会长歪。
   *
   * 支持：点选、拖进来、换一张、清掉。
   *
   * 拖拽这儿有两条路，别混：
   *   · 浏览器（`pnpm dev`）—— HTML5 的 ondragover/ondrop 在槽自己身上，
   *     拿 `dataTransfer.files`，交给 `ondropfile`。
   *   · 桌面端 —— Tauri 开了原生拖放，上面那两个**一个都不会触发**，
   *     文件在系统层就被接走了。所以桌面端走 `slot` 注册 + 窗口级监听
   *     （`drag-dom.ts`），拿的是真路径，像素从 Rust 拿。
   *     只走 HTML5 那条 = 真人拖不动，这个坑踩过。
   *
   * `slot` 给的组名+槽位 id 也决定了拖进来的高亮：`drag.over` 等于自己就亮。
   */
  import Icon from '$lib/components/Icon.svelte';
  import { drag } from '$lib/drag.svelte';
  import { registerDropGroup, slotKey, unregisterDropGroup, type DropGroup } from '$lib/drop';

  type Props = {
    label: string;
    /** 预览图（data URL）。空就是空槽 */
    url?: string | null;
    /** 文件名 */
    name?: string | null;
    /** 左下角信息：尺寸、格式这类 */
    meta?: string;
    /** 用来标 R/G/B/A 之类的来源 */
    tag?: string;
    tagKind?: 'r' | 'g' | 'b' | 'a' | '';
    /** 拖拽悬停中 */
    hot?: boolean;
    /** 必填项没填时标一下 */
    need?: boolean;
    disabled?: boolean;
    /**
     * 自己属于哪一组槽的哪一个格子。**组名要提成组件里的常量**，
     * 别就地写对象字面量 —— 每次渲染都是新对象，等于没注册。
     */
    slot?: { group: DropGroup; id: string };
    onpick: () => void;
    onclear?: () => void;
    ondropfile?: (f: File) => void;
    ondragover?: (e: DragEvent) => void;
    ondragleave?: () => void;
    ondrop?: (e: DragEvent) => void;
  };

  let {
    label,
    url = null,
    name = null,
    meta = '',
    tag = '',
    tagKind = '',
    hot = false,
    need = false,
    disabled = false,
    slot = undefined,
    onpick,
    onclear,
    ondropfile,
    ondragover,
    ondragleave,
    ondrop
  }: Props = $props();

  let localHot = $state(false);
  const key = $derived(slot ? slotKey(slot.group.key, slot.id) : '');
  /** 从窗口外拖东西进来，且落点就是自己 */
  const hotByDrag = $derived(drag.active && !!key && drag.over === key);
  const isHot = $derived(hot || localHot || hotByDrag);

  /* 挂上就注册：桌面端原生拖放要靠这张表才知道路径该交给谁。
     卸载就撤，免得切面板之后落点还指着已经不存在的槽。

     **要数着撤**：一个组可能挂好几个槽，`unregisterDropGroup` 撤的是**整组** ——
     原来每个槽卸载都直接撤，于是同一个组里**走掉一个槽，其余槽的落点全没了**。
     现在只有最后一个走的才撤那一组。 */
  $effect(() => {
    const g = slot?.group;
    if (!g) return;
    const k = g.key;
    registerDropGroup(g);
    组内活着的槽.set(k, (组内活着的槽.get(k) ?? 0) + 1);
    return () => {
      const 剩 = (组内活着的槽.get(k) ?? 1) - 1;
      if (剩 > 0) {
        组内活着的槽.set(k, 剩);
        return;
      }
      组内活着的槽.delete(k);
      unregisterDropGroup(k);
    };
  });

  /** 悬停报点。两条路（原生 / HTML5）都靠这个知道鼠标指着哪个槽 */
  function noteHover() {
    if (!key || !drag.active) return;
    if (drag.over !== key) drag.over = key;
  }

  function onLeave() {
    localHot = false;
    if (key && drag.over === key) drag.over = '';
  }
</script>

<div
  class="slot"
  class:slot--full={!!url}
  class:slot--hot={isHot}
  class:slot--need={need && !url}
  data-drop-key={key || undefined}
  role="group"
  aria-label={label}
  ondragover={(e) => {
    if (disabled) return;
    e.preventDefault();
    localHot = true;
    noteHover();
    ondragover?.(e);
  }}
  ondragleave={() => {
    onLeave();
    ondragleave?.();
  }}
  ondrop={(e) => {
    if (disabled) return;
    e.preventDefault();
    localHot = false;
    if (key && drag.over === key) drag.over = '';
    const f = e.dataTransfer?.files?.[0];
    if (f && ondropfile) ondropfile(f);
    else ondrop?.(e);
  }}
>
  {#if url}
    <img class="slot__img" src={url} alt="" />
    <div class="slot__name" title={name ?? ''}>{name ?? label}</div>
    <div class="slot__meta">
      <span class="nowrap">
        {#if tag}<i class="chip chip--{tagKind}">{tag}</i>{/if}
        {meta}
      </span>
      <span class="slot__ops">
        <button type="button" onclick={onpick} disabled={disabled} title="换一张">换</button>
        {#if onclear}
          <button type="button" onclick={onclear} disabled={disabled} title="清掉">清</button>
        {/if}
      </span>
    </div>
  {:else}
    <button class="slot__hit" type="button" onclick={onpick} disabled={disabled}>
      <Icon name="ui.image" size={22} />
      <b>{label}</b>
      <span>点这里选，或者把文件拖进来</span>
    </button>
  {/if}
</div>

<style>
  .slot--need { border-color: color-mix(in oklab, var(--warn) 55%, var(--line-strong)); }
</style>
