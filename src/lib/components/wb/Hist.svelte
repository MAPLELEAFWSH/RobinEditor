<script lang="ts">
  /**
   * 直方图。RGB 三条叠着画 + 亮度一条描边，下面一行数字和一句结论。
   *
   * 用 SVG 不用 canvas：这里画的是 256 根柱子折成的一条路径，SVG 一次成型，
   * 不用管 devicePixelRatio，也不用在参数每次变动时重画画布。
   */
  import { type Hist, histPath, histVerdict } from '$lib/hist';

  let {
    hist,
    width = 260,
    height = 84,
    label = '直方图'
  }: {
    hist: Hist | null;
    width?: number;
    height?: number;
    label?: string;
  } = $props();

  const v = $derived(hist ? histVerdict(hist) : null);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
</script>

{#if hist}
  <div class="hist">
    <div class="hist__head">
      <span class="hist__t">{label}</span>
      <span class="hist__mean" title="按感知亮度算的平均值，只算可见像素">平均 {pct(hist.mean)}</span>
      <span class="hist__n" title="可见像素 / 扫过的像素">
        {hist.visible.toLocaleString()}{#if hist.transparentShare > 0.001}<i> / {hist.sampled.toLocaleString()}</i>{/if} 像素
      </span>
    </div>

    <svg
      class="hist__svg"
      viewBox="0 0 {width} {height}"
      preserveAspectRatio="none"
      role="img"
      aria-label="{label}：平均亮度 {pct(hist.mean)}"
    >
      <!-- 网格：四分之一线，对齐读数用 -->
      {#each [0.25, 0.5, 0.75] as g (g)}
        <line class="hist__grid" x1={width * g} y1="0" x2={width * g} y2={height} />
      {/each}
      <path class="hist__a hist__a--r" d={histPath(hist.r, width, height)} />
      <path class="hist__a hist__a--g" d={histPath(hist.g, width, height)} />
      <path class="hist__a hist__a--b" d={histPath(hist.b, width, height)} />
      <path class="hist__a hist__a--l" d={histPath(hist.luma, width, height)} />
    </svg>

    <div class="hist__clip">
      {#if hist.transparentShare > 0.001}
        <span class="clip clip--alpha" title="全透明像素。它们的 RGB 没意义，不进下面的统计">
          透明 {pct(hist.transparentShare)}
        </span>
      {/if}
      <span class="clip" class:is-hot={hist.clipLow > 0.02}>
        黑 {pct(hist.clipLow)}
      </span>
      <span class="clip" class:is-hot={hist.clipHigh > 0.02}>
        白 {pct(hist.clipHigh)}
      </span>
      {#each ['r', 'g', 'b'] as const as ch (ch)}
        <span class="clip clip--{ch}" title="{ch.toUpperCase()} 路两端贴边比例">
          {ch.toUpperCase()} {pct(hist.byCh[ch].low)}/{pct(hist.byCh[ch].high)}
        </span>
      {/each}
    </div>

    {#if v}
      <p class="hist__v" class:is-warn={v.kind === 'warn'}>{v.text}</p>
    {/if}
  </div>
{/if}

<style>
  .hist { display: grid; gap: 5px; }
  .hist__head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: var(--fs-2xs);
    color: var(--content-meta);
  }
  .hist__t { color: var(--deep-text); font-weight: 600; }
  .hist__mean { font-variant-numeric: tabular-nums; }
  .hist__n { margin-left: auto; font-variant-numeric: tabular-nums; }

  .hist__svg {
    width: 100%;
    height: 84px;
    display: block;
    border: 1px solid var(--line-divider);
    border-radius: var(--r-sm);
    background: var(--surface-2);
    overflow: hidden;
  }
  .hist__grid { stroke: var(--line-divider); stroke-width: 0.5; opacity: 0.5; }
  /* 三条 RGB 用 mix-blend-mode 叠：这样重合的地方自动变亮，跟示波器一个观感。
     亮度那条只描边不填，压在底下当参考 */
  .hist__a { stroke: none; mix-blend-mode: screen; }
  .hist__a--r { fill: color-mix(in oklab, #e5484d 70%, transparent); }
  .hist__a--g { fill: color-mix(in oklab, #46a758 70%, transparent); }
  .hist__a--b { fill: color-mix(in oklab, #3e63dd 70%, transparent); }
  .hist__a--l { fill: none; stroke: var(--content-meta); stroke-width: 0.8; opacity: 0.55; }

  .hist__clip { display: flex; flex-wrap: wrap; gap: 4px; font-size: 10px; }
  .clip {
    padding: 1px 6px;
    border-radius: var(--r-full);
    background: var(--surface-3);
    color: var(--content-meta);
    font-variant-numeric: tabular-nums;
  }
  /* 用颜色标记只是一层提示，数字本身一直都在 —— 不靠颜色单独传达状态 */
  .clip.is-hot { background: color-mix(in oklab, var(--warn) 22%, var(--surface-3)); color: var(--deep-text); }
  .clip--alpha { border: 1px dashed var(--line-strong); background: none; }

  .hist__v {
    margin: 0;
    font-size: 10px;
    line-height: 1.6;
    color: var(--content-meta);
  }
  .hist__v.is-warn { color: var(--deep-text); }
</style>
