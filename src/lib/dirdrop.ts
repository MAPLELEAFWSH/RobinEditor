/**
 * 「整目录活」那类分区的落点：把一个元素登记成**只收文件夹**的落点。
 *
 * 为什么要单独一个 helper（用户 2026-09-24 之后那一类问题）：⑦批量提取 / ⑦批量 / ⑤配对检查
 * 这三页**一个落点都没有** —— 它们整页的活就是"指一个目录"，页上只有一颗「选目录」，
 * 拖文件夹进去只会得到那句"没落在能接它的地方 —— 拖到有落点的位置"。跟 ① 那三个分栏
 * 是同一个病（2026-09-24 已修），这里用同一个办法：**拖文件夹 = 点那一页的「选目录」**。
 *
 * 为什么不各自写一遍：落点 id、`dir: true`、`rect` 要跟着重算、卸载要注销 ——
 * 这三件事每页抄一遍迟早抄岔（`dropzones.svelte.ts` 头部也提过"两处各写一套迟早走岔"）。
 *
 * 用法（Svelte action）：
 * ```svelte
 * <div class="wb__main" use:接目录={(p) => 扫这个目录(p)}>
 * ```
 * `dir: true` 那个开关是给 `drag-dom` 的原生那条路看的：**文件夹在拖放事件里只给一条路径、
 * 没有后缀**，不按后缀筛才轮得到它（见 `dropzones.svelte.ts` 里 `dir` 的说明）。
 */
import { registerZone, unregisterZone } from './dropzones.svelte';

/** 每个元素一个稳定 id。用序号而不是随机串，便于在探针里认人 */
let 序号 = 0;

export function 接目录(node: HTMLElement, 收: (路径: string) => void) {
  const id = `dir.${++序号}`;
  let 当前 = 收;
  registerZone({
    id,
    rect: node.getBoundingClientRect(),
    el: node,
    dir: true,
    onDrop: (ref) => 当前(ref.path)
  });
  return {
    update(下一个: (路径: string) => void) {
      当前 = 下一个;
    },
    destroy() {
      unregisterZone(id);
    }
  };
}
