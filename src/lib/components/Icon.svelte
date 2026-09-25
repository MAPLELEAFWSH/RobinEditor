<script lang="ts">
  /**
   * 图标。name 用 src/lib/icons.ts 里的逻辑键（如 'ui.import'）。
   * 数据源是 Material Design Icons 的官方 path，24 栅格、填充式、currentColor。
   */
  import { ICONS, ICON_VIEWBOX } from '$lib/icons';

  let {
    name,
    size = 18,
    cls = ''
  }: { name: string; size?: number; cls?: string } = $props();

  const body = $derived(ICONS[name] ?? '');
</script>

{#if body}
  <svg
    class={cls}
    viewBox={ICON_VIEWBOX}
    width={size}
    height={size}
    fill="currentColor"
    aria-hidden="true"
    focusable="false">{@html body}</svg>
{/if}

<style>
  svg {
    display: block;
    flex: none;
  }
</style>
