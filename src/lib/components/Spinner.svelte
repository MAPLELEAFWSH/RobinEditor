<script lang="ts">
  /**
   * 转圈。纯 SVG + CSS，没有 JS 参与动画。
   *
   * 两条弧的 dasharray 来回变，配上整体旋转，看起来像在"追"。
   * 只动 stroke-dashoffset 和 rotate，都在合成层上。
   *
   * 动效关掉时不转，改成一段固定的弧，靠透明度呼吸提示"在忙"。
   */
  let {
    size = 20,
    width = 2.5,
    label = ''
  }: { size?: number; width?: number; label?: string } = $props();
</script>

<span class="sp" role={label ? 'status' : undefined} aria-label={label || undefined}>
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <circle class="sp__track" cx="12" cy="12" r="9" stroke-width={width} />
    <circle class="sp__arc" cx="12" cy="12" r="9" stroke-width={width} />
  </svg>
  {#if label}<span class="sp__txt">{label}</span>{/if}
</span>

<style>
  .sp { display: inline-flex; align-items: center; gap: 8px; }
  .sp svg { display: block; transform-origin: 50% 50%; animation: sp-turn 1.6s linear infinite; }

  .sp__track {
    fill: none;
    stroke: var(--line-color);
  }
  .sp__arc {
    fill: none;
    stroke: var(--accent-solid);
    stroke-linecap: round;
    /* 25% 的弧长，靠 dashoffset 跑起来 */
    stroke-dasharray: 14 100;
    animation: sp-dash 1.6s var(--ease-inout) infinite;
  }
  @keyframes sp-turn {
    to { transform: rotate(360deg); }
  }
  @keyframes sp-dash {
    0%   { stroke-dasharray: 6 100;  stroke-dashoffset: 0; }
    50%  { stroke-dasharray: 44 100; stroke-dashoffset: -18; }
    100% { stroke-dasharray: 6 100;  stroke-dashoffset: -72; }
  }

  .sp__txt { font-size: var(--fs-xs); color: var(--content-meta); }

  /* 动效关掉：不转，留一段弧靠透明度闪 */
  :global(:root[data-motion='off']) .sp svg { animation: none; }
  :global(:root[data-motion='off']) .sp__arc {
    stroke-dasharray: 30 100;
    animation: sp-pulse 1.4s var(--ease-inout) infinite;
  }
  @keyframes sp-pulse {
    0%, 100% { opacity: 0.35; }
    50%      { opacity: 1; }
  }

  @media (prefers-reduced-motion: reduce) {
    .sp svg { animation: none; }
    .sp__arc { stroke-dasharray: 30 100; animation: none; opacity: 0.8; }
  }
</style>
