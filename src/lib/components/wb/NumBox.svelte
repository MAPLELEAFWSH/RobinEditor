<script lang="ts">
  /**
   * 数值框：滑条旁边那个**能直接填**的小框。
   *
   * 规范：数值既要能填、也要能拖 —— 填数字立即生效，拖滑条把数字回填进来，
   * 键盘上下键按 step 微调（原生 `number` 就有）。两者绑的是**同一个值**，
   * 所以不会出现"框里的数和滑条对不上"。
   *
   * 显示与内部值可以差一个倍数：`倍={100}` 时 0.35 显示成 35（配合 `后缀="%"`）。
   */
  type Props = {
    value?: number;
    min?: number;
    max?: number;
    step?: number;
    /** 显示倍数：内部 0~1 想按百分比显示就传 100 */
    倍?: number;
    /** 小数位；不传按 step 推 */
    位?: number;
    后缀?: string;
    标题?: string;
    /** 目标不能 `bind:` 时（比如"这一格/那一个量"随开关切）用这个回调接手 */
    改变?: (v: number) => void;
  };

  let { value = $bindable(0), min, max, step = 0.01, 倍 = 1, 位, 后缀 = '', 标题 = '数值', 改变 }: Props = $props();

  const 位实际 = $derived(位 ?? (step >= 1 ? 0 : Math.min(6, String(step).split('.')[1]?.length ?? 2)));
  /** 正在输入的这一串：聚焦时以它为准，免得每敲一下就按固定位数格式化（光标会跳） */
  let 字 = $state('');
  let 聚 = $state(false);

  $effect(() => {
    const 应 = (value * 倍).toFixed(位实际);
    if (!聚 && 字 !== 应) 字 = 应;
  });

  function 输入(e: Event) {
    字 = (e.currentTarget as HTMLInputElement).value;
    const v = Number(字);
    if (字 === '' || 字 === '-' || !Number.isFinite(v)) return;
    let r = v / 倍;
    if (min !== undefined) r = Math.max(min, r);
    if (max !== undefined) r = Math.min(max, r);
    if (改变) 改变(r);
    else value = r;
  }
</script>

<span class="nb">
  <input
    class="nb__i"
    type="number"
    bind:value={字}
    step={step * 倍}
    aria-label={标题}
    oninput={输入}
    onfocus={() => (聚 = true)}
    onblur={() => (聚 = false)}
  />
  {#if 后缀}<i class="nb__s">{后缀}</i>{/if}
</span>

<style>
  .nb {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    justify-content: flex-end;
    min-width: 0;
  }
  .nb__i {
    width: 5.2rem;
    padding: 2px 5px;
    text-align: right;
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--surface-2);
    color: var(--deep-text);
  }
  .nb__i:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 1px;
  }
  .nb__s {
    font-size: var(--fs-2xs);
    color: var(--content-meta);
    font-style: normal;
  }
</style>
