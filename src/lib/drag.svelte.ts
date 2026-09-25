/**
 * 拖放的共享状态。
 *
 * 单独一个 `.svelte.ts`：`$state` 只能写在 .svelte / .svelte.ts 里，
 * 而 `drop.ts` 要能被套件直接跑到，不能引 svelte。
 * 所以拆成两边 —— 判断在 `drop.ts`，装着状态的是这里，接线在 `drag-dom.ts`。
 */
import { createDragState } from './drop';
import { setErr } from './ui.svelte';

export const drag = $state(createDragState(setErr));
