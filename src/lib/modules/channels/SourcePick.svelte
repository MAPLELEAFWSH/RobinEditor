<script lang="ts">
  /**
   * 「取哪个槽的哪一路」——合并、调换、图层、蒙版都要用同一套。
   *
   * 只报变化，不改传进来的对象：调用方拿 patch 去 set，保持单一数据源。
   */
  import { CHANNEL_KEYS, CHANNEL_LABEL, type ChannelKey } from '$lib/img';

  type SlotOpt = { id: string; label: string };

  let {
    value,
    slots,
    allowConstant = true,
    allowRgb = false,
    onpatch
  }: {
    value: { slot: string; ch: ChannelKey | 'rgb'; invert: boolean; constant: number };
    slots: SlotOpt[];
    allowConstant?: boolean;
    allowRgb?: boolean;
    onpatch: (
      p: Partial<{ slot: string; ch: ChannelKey | 'rgb'; invert: boolean; constant: number }>
    ) => void;
  } = $props();
</script>

<div class="sp">
  <div class="row">
    <span class="row__k">来源</span>
    <select
      value={value.slot}
      aria-label="来源槽位"
      onchange={(e) => onpatch({ slot: e.currentTarget.value })}
    >
      {#if allowConstant}<option value="">常量</option>{/if}
      {#each slots as s (s.id)}
        <option value={s.id}>{s.label}</option>
      {/each}
    </select>
  </div>

  {#if value.slot === ''}
    <div class="row" style="margin-top:8px">
      <span class="row__k">常量值</span>
      <input
        class="range range--inline"
        type="range"
        min="0"
        max="255"
        value={value.constant}
        aria-label="常量值"
        oninput={(e) => onpatch({ constant: +e.currentTarget.value })}
      />
      <span class="row__v">{value.constant}</span>
    </div>
  {:else}
    <div class="row" style="margin-top:8px">
      <span class="row__k">取哪一路</span>
      <div class="pick">
        {#each CHANNEL_KEYS as c (c)}
          <button
            class="pick__b"
            type="button"
            aria-pressed={value.ch === c}
            onclick={() => onpatch({ ch: c })}
          >{CHANNEL_LABEL[c]}</button>
        {/each}
        {#if allowRgb}
          <button
            class="pick__b"
            type="button"
            aria-pressed={value.ch === 'rgb'}
            title="原样用这张图的 RGB，不拆通道"
            onclick={() => onpatch({ ch: 'rgb' })}
          >彩色</button>
        {/if}
      </div>
    </div>
  {/if}

  <label class="chk" style="margin-top:8px">
    <input
      type="checkbox"
      checked={value.invert}
      onchange={(e) => onpatch({ invert: e.currentTarget.checked })}
    />
    <span class="chk__box"></span>反相
  </label>
</div>
