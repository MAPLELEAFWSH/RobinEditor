<script lang="ts">
  /**
   * 图层蒙版编辑器。
   *
   * 蒙版就是个 0-255 的灰度平面：白的地方图层全显，黑的地方全不显。
   * 来源可以是任何一张图的任何一路 —— 用户要的那个用法就是
   * "把 lightmap 的 B 通道丢进蒙版"，所以这里通道选择必须是最显眼的控件。
   *
   * 顺手给一条小的灰度预览：调黑白点时能直接看见遮罩形状怎么变。
   */
  import { type ChannelKey, CHANNEL_KEYS, CHANNEL_LABEL } from '$lib/img';
  import { type MaskSpec } from './ops';
  import Icon from '$lib/components/Icon.svelte';

  let {
    mask,
    slots,
    preview,
    onchange
  }: {
    mask: MaskSpec;
    slots: { id: string; label: string }[];
    /** 蒙版缩略图（data URL）。没有就不显示 */
    preview?: string | null;
    onchange: (m: MaskSpec) => void;
  } = $props();

  function p(patch: Partial<MaskSpec>) {
    onchange({ ...mask, ...patch });
  }
</script>

<div class="mk">
  <label class="chk">
    <input type="checkbox" checked={mask.on} onchange={(e) => p({ on: e.currentTarget.checked })} />
    <span class="chk__box"></span>用蒙版
  </label>

  {#if mask.on}
    <div class="body">
      <div class="row">
        <span class="row__k">蒙版取自</span>
        <select value={mask.slot} aria-label="蒙版来源" onchange={(e) => p({ slot: e.currentTarget.value })}>
          <option value="">（没选）</option>
          {#each slots as s (s.id)}
            <option value={s.id}>{s.label}</option>
          {/each}
        </select>
      </div>

      {#if mask.slot}
        <div class="row" style="margin-top:8px">
          <span class="row__k">哪一路</span>
          <div class="pick">
            {#each CHANNEL_KEYS as c (c)}
              <button class="pick__b" type="button" aria-pressed={mask.ch === c} onclick={() => p({ ch: c as ChannelKey })}>
                {CHANNEL_LABEL[c]}
              </button>
            {/each}
          </div>
        </div>
      {:else}
        <p class="mini" style="margin-top:8px">没选来源时蒙版是全白，等于没遮。</p>
      {/if}

      <div class="row" style="margin-top:10px">
        <span class="row__k">黑点</span>
        <input class="range range--inline" type="range" min="0" max="255" value={mask.black}
          aria-label="黑点" oninput={(e) => p({ black: +e.currentTarget.value })} />
        <span class="row__v">{mask.black}</span>
      </div>
      <div class="row">
        <span class="row__k">白点</span>
        <input class="range range--inline" type="range" min="0" max="255" value={mask.white}
          aria-label="白点" oninput={(e) => p({ white: +e.currentTarget.value })} />
        <span class="row__v">{mask.white}</span>
      </div>
      <div class="row">
        <span class="row__k">灰度系数</span>
        <input class="range range--inline" type="range" min="0.1" max="3" step="0.01" value={mask.gamma}
          aria-label="灰度系数" oninput={(e) => p({ gamma: +e.currentTarget.value })} />
        <span class="row__v">{mask.gamma.toFixed(2)}</span>
      </div>
      <div class="row">
        <span class="row__k">模糊</span>
        <input class="range range--inline" type="range" min="0" max="48" value={mask.blur}
          aria-label="模糊半径" oninput={(e) => p({ blur: +e.currentTarget.value })} />
        <span class="row__v">{mask.blur}px</span>
      </div>

      <label class="chk" style="margin-top:8px">
        <input type="checkbox" checked={mask.invert} onchange={(e) => p({ invert: e.currentTarget.checked })} />
        <span class="chk__box"></span>反相（黑白对调）
      </label>

      {#if preview}
        <figure class="prev">
          <img src={preview} alt="" />
          <figcaption class="mini">蒙版长这样 · 白的地方这层显，黑的地方不显</figcaption>
        </figure>
      {/if}

      <div class="acts" style="margin-top:8px">
        <button class="btn btn--ghost btn--sm" type="button" onclick={() => p({ black: 0, white: 255, gamma: 1, blur: 0, invert: false })}>
          <Icon name="ui.restore" size={13} />复位
        </button>
        <button class="btn btn--ghost btn--sm" type="button" onclick={() => p({ black: 90, white: 200, blur: 2 })}>
          收紧一点
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .mk { display: block; }
  .body { margin-top: 8px; padding-left: 22px; border-left: 1px solid var(--line-divider); }
  .prev { margin: 10px 0 0; display: grid; gap: 5px; }
  .prev img {
    width: 100%;
    max-height: 9rem;
    object-fit: contain;
    image-rendering: pixelated;
    border-radius: var(--r-md);
    background: #fff;
  }
  .btn--sm { padding: 4px 10px; font-size: var(--fs-2xs); }
</style>
