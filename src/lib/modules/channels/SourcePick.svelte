<script lang="ts">
  /**
   * 「取哪个槽的哪一路」——合并、调换、图层、蒙版都要用同一套。
   *
   * 只报变化，不改传进来的对象：调用方拿 patch 去 set，保持单一数据源。
   *
   * `allowDerive` 打开之后，这一路多一个「推 Z」：不是从哪一路取，
   * 而是由输出的 R、G 算 `√(1 − x² − y²)`（法线的 Z）。三路要来自同一套 x/y，
   * 所以它是整张图一起重写的，见 `img.ts` 的 `重写法线`。
   */
  import { CHANNEL_KEYS, CHANNEL_LABEL, type ChannelKey, type ScaleMode } from '$lib/img';

  type SlotOpt = { id: string; label: string };

  let {
    value,
    slots,
    allowConstant = true,
    allowRgb = false,
    allowDerive = false,
    onpatch
  }: {
    value: {
      slot: string;
      ch: ChannelKey | 'rgb';
      invert: boolean;
      constant: number;
      推导?: 'z';
      round?: 'half-even' | 'floor';
      upscale?: ScaleMode;
    };
    slots: SlotOpt[];
    allowConstant?: boolean;
    allowRgb?: boolean;
    allowDerive?: boolean;
    onpatch: (
      p: Partial<{
        slot: string;
        ch: ChannelKey | 'rgb';
        invert: boolean;
        constant: number;
        推导?: 'z' | undefined;
        round?: 'half-even' | 'floor';
        upscale?: ScaleMode;
      }>
    ) => void;
  } = $props();

  const 推 = $derived(value.推导 === 'z');
</script>

<div class="sp">
  {#if 推}
    <div class="row">
      <span class="row__k">这一路</span>
      <b class="dv">由 R、G 推出来</b>
    </div>
    <div class="row" style="margin-top:8px">
      <span class="row__k">写回取整</span>
      <div class="pick">
        <button
          class="pick__b"
          type="button"
          aria-pressed={value.round !== 'floor'}
          title="标准的四舍五入"
          onclick={() => onpatch({ round: 'half-even' })}
        >四舍五入</button>
        <button
          class="pick__b"
          type="button"
          aria-pressed={value.round === 'floor'}
          title="跟素材里那份产物一样：float32 算完直接截断，R/G 会各差 1 级"
          onclick={() => onpatch({ round: 'floor' })}
        >截断</button>
      </div>
    </div>
    <p class="mini">
      X 取上面那一行的 R，Y 取 G，B 换成 <span class="mono">√(1 − x² − y²)</span>。
      要改 X/Y 从哪来就去调 R、G 两行。
    </p>
    <button class="btn btn--ghost btn--sm" type="button" onclick={() => onpatch({ 推导: undefined })}>
      改回取某一路
    </button>
  {:else}
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

    {#if allowDerive}
      <button
        class="btn btn--ghost btn--sm"
        type="button"
        style="margin-top:8px"
        title="法线的 Z：由输出的 R、G 算出来，不占任何一路"
        onclick={() => onpatch({ 推导: 'z' })}
      >由 R、G 推 Z</button>
    {/if}
  {/if}
</div>

<style>
  .dv { font-size: var(--fs-2xs); color: var(--primary-ink); font-weight: 600; }
  .mini { font-size: var(--fs-2xs); line-height: var(--lh-md); color: var(--content-meta); margin: 8px 0; }
  .btn--sm { padding: 4px 10px; font-size: var(--fs-2xs); }
</style>
