<script lang="ts">
  /**
   * 图层栈编辑器。
   *
   * 顺序是从上到下摆的（跟 PS 一样，列表最上面那层盖在最上面），
   * 但内部数组是"先画的在前"，所以显示的时候倒过来遍历。
   *
   * 每层展开后是：源 / 混合模式 / 不透明度 / 蒙版 / 这一层自己的调整。
   * 蒙版是这块的重点 —— 用户那个金属材质的流程就落在这里。
   */
  import { CHANNEL_KEYS, CHANNEL_LABEL } from '$lib/img';
  import {
    BLEND_GROUPS,
    BLEND_LABEL,
    type BlendId,
    type Layer,
    makeLayer,
    nextLayerId as makeLayerId
  } from './ops';
  import {
    allPresets,
    isUserPreset,
    removePreset,
    savePreset
  } from '$lib/layers-preset.svelte';
  import { materializeSeeds, nextFreeSlot as pickFreeSlot, type LayerPreset } from '$lib/layers-preset';
  import SourcePick from './SourcePick.svelte';
  import MaskEditor from './MaskEditor.svelte';
  import AdjustEditor from './AdjustEditor.svelte';
  import Icon from '$lib/components/Icon.svelte';

  let {
    layers,
    slots,
    selected,
    maskPreview,
    reserved = [],
    onchange,
    onselect
  }: {
    layers: Layer[];
    slots: { id: string; label: string }[];
    selected: string | null;
    maskPreview: string | null;
    /**
     * 已经被栈以外的东西占着的槽位，加新层时跳过。
     *
     * 混合页就是这种情况：底层那格归底图用，它不在 `layers` 里，
     * 不告诉这边的话，连点"加图层"会做出一个源跟底图一模一样的层，
     * 界面上写着「图层 2 底层」—— 看着像加了层，其实叠的是同一张图。
     */
    reserved?: string[];
    onchange: (next: Layer[]) => void;
    onselect: (id: string | null) => void;
  } = $props();

  function patch(id: string, p: Partial<Layer>) {
    onchange(layers.map((l) => (l.id === id ? { ...l, ...p } : l)));
  }
  function move(id: string, d: number) {
    const i = layers.findIndex((l) => l.id === id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= layers.length) return;
    const next = [...layers];
    [next[i], next[j]] = [next[j], next[i]];
    onchange(next);
  }
  function del(id: string) {
    onchange(layers.filter((l) => l.id !== id));
    if (selected === id) onselect(null);
  }
  /* ---------------- 预设 ---------------- */

  const presets = $derived(allPresets());
  let presetOpen = $state(false);
  let naming = $state(false);
  let presetName = $state('');

  /**
   * 新层用哪个槽当源。挑第一个还没被占的，不是永远用第一个 ——
   * 写死第一个的话连点两次"加图层"会做出两层源相同的层，界面上看不出来。
   */
  function nextFreeSlot(): string {
    return pickFreeSlot(
      layers.map((x) => x.slot),
      slots.map((s) => s.id),
      reserved
    );
  }

  function add() {
    // 新层插到最上面：数组末尾 = 最后画 = 盖在最上层
    const l = makeLayer(`图层 ${layers.length + 1}`, nextFreeSlot());
    onchange([...layers, l]);
    onselect(l.id);
  }

  /**
   * 当前页面有没有这个槽位。
   *
   * 问的是"存不存在"，不是"里面有没有图" —— 用户的正常顺序是先套预设搭好架子、
   * 再往槽里放图；按"有没有图"判的话，套完就被降级成常量，放图进去也不会变回来。
   */
  function hasSlot(id: string): boolean {
    return slots.some((s) => s.id === id);
  }

  /** 套预设：默认替换，按住 Alt 点就是追加上去 */
  function applyPreset(p: LayerPreset, append = false) {
    const made = materializeSeeds(p.layers, hasSlot, makeLayerId);
    const next = append ? [...layers, ...made] : made;
    onchange(next);
    onselect(made[made.length - 1]?.id ?? null);
    presetOpen = false;
  }

  function doSave() {
    // 存的是配置不是图，所以存完什么都不用改，只把面板收起来
    savePreset(presetName || `预设 ${presets.length + 1}`, layers);
    naming = false;
    presetName = '';
    presetOpen = false;
  }

  /* 显示顺序：数组末尾在最上面 */
  const shown = $derived([...layers].reverse());

  function srcLabel(l: Layer): string {
    if (!l.slot) return `常量 ${l.constant}`;
    const s = slots.find((x) => x.id === l.slot);
    const base = s?.label ?? l.slot;
    return l.ch === 'rgb' ? `${base} 彩色` : `${base} 的 ${CHANNEL_LABEL[l.ch]}`;
  }
</script>

<div class="ls">
  <ul class="stack">
    {#each shown as l (l.id)}
      {@const open = selected === l.id}
      <li class="lay" class:is-open={open} class:is-off={!l.on}>
        <div class="lay__head">
          <button
            class="lay__eye"
            type="button"
            aria-pressed={l.on}
            title={l.on ? '藏起来' : '显出来'}
            onclick={() => patch(l.id, { on: !l.on })}
          >
            <Icon name={l.on ? 'ui.preview' : 'ui.close'} size={13} />
          </button>
          <button
            class="lay__t"
            type="button"
            aria-expanded={open}
            onclick={() => onselect(open ? null : l.id)}
          >
            <b>{l.name}</b>
            <span class="mini">{srcLabel(l)}</span>
          </button>
          <span class="lay__badges">
            {#if l.blend !== 'normal'}<i class="tag">{BLEND_LABEL[l.blend]}</i>{/if}
            {#if l.opacity < 1}<i class="tag">{Math.round(l.opacity * 100)}%</i>{/if}
            {#if l.mask.on}<i class="tag tag--ok">蒙版</i>{/if}
          </span>
        </div>

        {#if open}
          <div class="lay__body">
            <div class="row">
              <span class="row__k">名字</span>
              <input
                type="text"
                value={l.name}
                aria-label="图层名"
                oninput={(e) => patch(l.id, { name: e.currentTarget.value })}
              />
            </div>

            <div class="sec">
              <h4>源</h4>
              <SourcePick
                value={{ slot: l.slot, ch: l.ch, invert: l.invert, constant: l.constant }}
                {slots}
                allowRgb
                onpatch={(p) => patch(l.id, p as Partial<Layer>)}
              />
            </div>

            <div class="sec">
              <h4>混合</h4>
              <div class="row">
                <span class="row__k">模式</span>
                <select
                  value={l.blend}
                  aria-label="混合模式"
                  onchange={(e) => patch(l.id, { blend: e.currentTarget.value as BlendId })}
                >
                  {#each BLEND_GROUPS as g (g.name)}
                    <optgroup label={g.name}>
                      {#each g.ids as id (id)}
                        <option value={id}>{BLEND_LABEL[id]}</option>
                      {/each}
                    </optgroup>
                  {/each}
                </select>
              </div>
              <div class="row">
                <span class="row__k">不透明度</span>
                <input
                  class="range range--inline"
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(l.opacity * 100)}
                  aria-label="不透明度"
                  oninput={(e) => patch(l.id, { opacity: +e.currentTarget.value / 100 })}
                />
                <span class="row__v">{Math.round(l.opacity * 100)}%</span>
              </div>
            </div>

            <div class="sec">
              <h4>蒙版</h4>
              <MaskEditor
                mask={l.mask}
                {slots}
                preview={open ? maskPreview : null}
                onchange={(m) => patch(l.id, { mask: m })}
              />
            </div>

            <div class="sec">
              <h4>这一层的调整</h4>
              <AdjustEditor
                ops={l.adjust}
                scope={l.adjustScope}
                compact
                onchange={(next, sc) => patch(l.id, { adjust: next, adjustScope: sc })}
              />
            </div>

            <div class="acts" style="margin-top:10px">
              <button class="btn btn--ghost btn--sm" type="button" onclick={() => move(l.id, 1)}>
                <Icon name="ui.chevronUp" size={13} />上移
              </button>
              <button class="btn btn--ghost btn--sm" type="button" onclick={() => move(l.id, -1)}>
                <Icon name="ui.chevronDown" size={13} />下移
              </button>
              <button class="btn btn--ghost btn--sm" type="button" onclick={() => del(l.id)}>
                <Icon name="ui.delete" size={13} />删掉
              </button>
            </div>
          </div>
        {/if}
      </li>
    {/each}
  </ul>

  {#if !layers.length}
    <p class="mini" style="margin:8px 0 0">还没有图层。加一层，或者用下面的预设一键搭。</p>
  {/if}

  <!-- 预设 -->
  <div class="ps">
    <button class="btn btn--ghost btn--sm" type="button" aria-expanded={presetOpen} onclick={() => (presetOpen = !presetOpen)}>
      <Icon name="ui.cards" size={13} />套预设
      <Icon name={presetOpen ? 'ui.chevronUp' : 'ui.chevronDown'} size={12} />
    </button>
    <button class="btn btn--ghost btn--sm" type="button" disabled={!layers.length} onclick={() => (naming = !naming)}>
      <Icon name="ui.save" size={13} />存成预设
    </button>
    <button class="btn btn--ghost btn--sm" type="button" onclick={add}>
      <Icon name="ui.add" size={13} />加图层
    </button>
    {#if layers.length}
      <button class="btn btn--ghost btn--sm" type="button" onclick={() => { onchange([]); onselect(null); }}>
        <Icon name="ui.close" size={13} />全清
      </button>
    {/if}
  </div>

  {#if naming}
    <div class="pname">
      <input
        type="text"
        placeholder="给这套图层起个名字"
        maxlength="24"
        aria-label="预设名字"
        bind:value={presetName}
        onkeydown={(e) => {
          if (e.key === 'Enter') doSave();
          if (e.key === 'Escape') naming = false;
        }}
      />
      <button class="btn btn--primary btn--sm" type="button" onclick={doSave}>存</button>
      <button class="btn btn--ghost btn--sm" type="button" onclick={() => (naming = false)}>算了</button>
    </div>
    <p class="mini" style="margin:4px 0 0">存 {layers.length} 层的配置（源、混合、不透明度、蒙版、调整）。存的是设置不是图，换张图照样能用。</p>
  {/if}

  {#if presetOpen}
    <ul class="plist">
      {#each presets as p (p.id)}
        <li class="pit">
          <button class="pit__b" type="button" title="按住 Alt 点 = 追加到现有图层后面" onclick={(e) => applyPreset(p, e.altKey)}>
            <b>{p.name}</b>
            <em>{p.hint}</em>
            <span class="pit__n">{p.layers.length} 层{p.builtin ? ' · 内置' : ''}</span>
          </button>
          {#if isUserPreset(p.id)}
            <button class="pit__x" type="button" aria-label="删掉这个预设" onclick={() => removePreset(p.id)}>
              <Icon name="ui.delete" size={12} />
            </button>
          {/if}
        </li>
      {/each}
    </ul>
    <p class="mini" style="margin:6px 0 0">
      预设里指名的槽位如果当前页面没有，那一层会退成常量色，拿它当蒙版的也一起关掉 ——
      槽位只是还没放图不算，那种留着，放进去就生效。
    </p>
  {/if}
</div>

<style>
  .ls { display: block; }
  .stack { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .lay {
    border: 1px solid var(--line-divider);
    border-radius: var(--r-md);
    background: var(--surface-2);
    overflow: hidden;
  }
  .lay.is-open { border-color: color-mix(in oklab, var(--primary) 34%, var(--line-divider)); }
  .lay.is-off { opacity: 0.55; }
  .lay__head { display: flex; align-items: center; gap: 4px; padding: 3px; }
  .lay__eye {
    flex: none;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--content-meta);
    cursor: pointer;
  }
  .lay__eye:hover { background: var(--rail-hover); color: var(--deep-text); }
  .lay__t {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 4px;
    border: 0;
    background: none;
    color: var(--deep-text);
    font: inherit;
    font-size: var(--fs-xs);
    text-align: left;
    cursor: pointer;
    border-radius: var(--r-sm);
  }
  .lay__t:hover { background: var(--rail-hover); }
  .lay__t b { font-weight: 600; flex: none; }
  .lay__t .mini { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lay__badges { display: flex; gap: 3px; flex: none; padding-right: 3px; }
  .lay__badges .tag { font-size: 10px; padding: 1px 5px; }
  .lay__body { padding: 8px 10px 10px; border-top: 1px solid var(--line-divider); }

  .sec { margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--line-divider); }
  .sec h4 {
    margin: 0 0 6px;
    font-size: var(--fs-2xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--content-meta);
  }
  .btn--sm { padding: 4px 10px; font-size: var(--fs-2xs); }

  /* 预设 */
  .ps { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }
  .pname { display: flex; gap: 5px; margin-top: 6px; }
  .pname input {
    flex: 1;
    min-width: 0;
    padding: 4px 9px;
    border: 1px solid var(--line-divider);
    border-radius: var(--r-sm);
    background: var(--surface-2);
    font: inherit;
    font-size: var(--fs-2xs);
    color: var(--deep-text);
  }
  .plist {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 16rem;
    overflow-y: auto;
  }
  .pit {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: stretch;
    border: 1px solid var(--line-divider);
    border-radius: var(--r-md);
    background: var(--surface-2);
    overflow: hidden;
    transition: border-color var(--t-micro) var(--ease-std);
  }
  .pit:hover { border-color: var(--primary); }
  .pit__b {
    display: grid;
    gap: 1px;
    padding: 6px 9px;
    border: 0;
    background: none;
    font: inherit;
    text-align: left;
    color: inherit;
    cursor: pointer;
    min-width: 0;
  }
  .pit__b b {
    font-size: var(--fs-2xs);
    font-weight: 600;
    color: var(--deep-text);
  }
  .pit__b em {
    font-size: 10px;
    font-style: normal;
    line-height: 1.5;
    color: var(--content-meta);
  }
  .pit__n { font-size: 10px; color: var(--content-meta); }
  .pit__x {
    width: 26px;
    display: grid;
    place-items: center;
    border: 0;
    border-left: 1px solid var(--line-divider);
    background: var(--surface-3);
    color: var(--content-meta);
    cursor: pointer;
  }
  .pit__x:hover { color: var(--warn); }
</style>
