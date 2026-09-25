<script lang="ts">
  /**
   * 提示条。kind 只影响颜色，文案里别写"注意""请务必"这种口气。
   *
   * `自动关`（毫秒）= **到点自己消失**（用户 2026-09-23 C9：提示/弹窗除手动关，
   * 还要"一定时间后自动消失"，沿用侧栏错误通道那 9 秒的做法）。
   * **"要用户决定的确认"不许挂它** —— 那种挂着等人回话，自己消失等于替用户做了决定。
   * 鼠标停在上头时暂停计时（正在读的时候被抽走最恼人），移开再接着算。
   */
  import { onDestroy } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';

  let {
    kind = 'info',
    /** 给了就在右边出一个叉。报错那种"挂着不走"的提示用它清掉 */
    onclose = null,
    /** 多久自己消失（毫秒）。不写 = 一直挂着，只能手动关 */
    自动关 = null,
    /**
     * 这条是**版面的一部分**，不是"跟着动作冒出来的提示"。
     *
     * 为什么要这个开关：`onclose` / `自动关` 两个都不传的话，这条提示既没叉又不会走 ——
     * 对"提示"来说那是 bug（用户 2026-09-24 报的"警告框不可以消失"），
     * 但对**当次结果的说明**（比如"这次扫描为什么被拦"）自己走掉就是把理由藏了。
     * 两种形状在模板里长得一样（子节点都是一个 `{表达式}`），静态分不出来，
     * 所以在这儿**明说**：`常驻` 就是"别自动关，也别拿守卫来烦我"。
     * 守卫 `tmp/note-提示条.test.mjs` 认这个标记。
     */
    常驻 = false,
    children
  }: {
    kind?: 'info' | 'warn' | 'ok';
    onclose?: (() => void) | null;
    自动关?: number | null;
    常驻?: boolean;
    children?: any;
  } = $props();

  const icon = $derived(
    kind === 'warn' ? 'ui.warn' : kind === 'ok' ? 'ui.check' : 'ui.info'
  );

  let 表: ReturnType<typeof setTimeout> | null = null;
  /** 停一下之后还剩多少毫秒（读的时候暂停用） */
  let 剩 = $state(0);

  function 停表() {
    if (表 !== null) {
      clearTimeout(表);
      表 = null;
    }
  }

  function 起表(毫秒: number) {
    停表();
    剩 = 毫秒;
    if (!毫秒 || 毫秒 <= 0) return;
    表 = setTimeout(() => {
      表 = null;
      if (onclose) onclose();
    }, 毫秒);
  }

  /* `自动关` 变了就重新排一次（同一个提示条换文案时会重新计时） */
  $effect(() => {
    const 毫秒 = 自动关;
    if (!毫秒 || 毫秒 <= 0) {
      停表();
      return;
    }
    起表(毫秒);
    return 停表;
  });

  function 悬停(开: boolean) {
    if (!自动关 || 自动关 <= 0 || !onclose) return;
    if (开) {
      /* 已经跑掉多少不好算（没记起点），这里按"停住不再走"处理：
         鼠标离开时重新给一整段 —— 宁可贵一点，也不许正在读的时候被抽走。 */
      停表();
    } else if (表 === null) {
      起表(自动关);
    }
  }

  onDestroy(停表);
</script>

<div
  class="note"
  class:note--warn={kind === 'warn'}
  class:note--ok={kind === 'ok'}
  role="status"
  onmouseenter={() => 悬停(true)}
  onmouseleave={() => 悬停(false)}
>
  <Icon name={icon} size={15} />
  <div>{@render children?.()}</div>
  {#if onclose}
    <button class="note__x" type="button" title="知道了" aria-label="知道了" onclick={onclose}>
      <Icon name="ui.close" size={12} />
    </button>
  {/if}
</div>

<style>
  .note__x {
    flex: none; margin: -2px -4px -2px 0; padding: 2px 3px;
    border: 0; border-radius: var(--r-sm); background: none; cursor: pointer;
    color: var(--content-meta); opacity: 0.65;
    transition: opacity var(--t-micro) var(--ease-std);
  }
  .note__x:hover { opacity: 1; }
</style>
