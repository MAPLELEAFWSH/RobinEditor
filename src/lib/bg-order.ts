/**
 * 背景列表的排序和隐藏。
 *
 * 单独一个文件是为了能在 Node 里单测 —— 这个模块不引任何东西，
 * 而 `bg.ts` 引 `bg-meta.json`（Node 里 JSON import 要 import attribute，
 * Vite 那套写法跑不了），所以纯逻辑得挪出来。
 */

export type BgItem = { id: string; name: string; custom?: boolean };

/**
 * 按用户排的顺序摆，隐藏的去掉。
 *
 * 顺序表里没有的排到最后、保持原来的相对顺序 —— 这样新导入一张不会
 * 插到中间去，而是接在末尾，符合"刚加的应该在最后"的直觉。
 * 顺序表里出现但已经不存在的 id 直接无视。
 */
export function arrangeBgs(items: BgItem[], order: string[], hidden: string[]): BgItem[] {
  const hide = new Set(hidden);
  const pos = new Map<string, number>();
  order.forEach((id, i) => pos.set(id, i));

  const visible = items.filter((it) => !hide.has(it.id));
  return visible
    .map((it, i) => ({ it, key: pos.has(it.id) ? pos.get(it.id)! : order.length + i }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.it);
}

/** 把 id 往前/往后挪一格。返回新的顺序表（基于当前可见列表算出来的完整顺序）。 */
export function moveInOrder(visibleIds: string[], id: string, delta: number): string[] {
  const i = visibleIds.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= visibleIds.length) return visibleIds;
  const out = [...visibleIds];
  const [x] = out.splice(i, 1);
  out.splice(j, 0, x);
  return out;
}

/**
 * 当前选中的那张不能用的时候，接下来该选哪张。
 *
 * 规则：排在它后面的第一张，没有就往前找；都没有就返回空串（列表空了）。
 * 之前这里写的是硬编码 `wp-01` —— 用户把内置全藏了、只用自己导入的图时，
 * 删掉当前那张会跳回一张他根本看不见的图，界面上就是"背景突然没了"。
 */
export function nextBgAfter(visibleIds: string[], gone: string): string {
  if (!visibleIds.length) return '';
  const i = visibleIds.indexOf(gone);
  if (i < 0) return visibleIds[0];
  return visibleIds[i + 1] ?? visibleIds[i - 1] ?? '';
}
