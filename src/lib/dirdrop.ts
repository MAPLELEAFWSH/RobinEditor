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
 * <div class="wb__main" use:接目录={{ 收: (p) => 扫这个目录(p), label: '批量提取', href: '/tools/channels?panel=pipeline' }}>
 * ```
 * `dir: true` 那个开关是给 `drag-dom` 的原生那条路看的：**文件夹在拖放事件里只给一条路径、
 * 没有后缀**，不按后缀筛才轮得到它（见 `dropzones.svelte.ts` 里 `dir` 的说明）。
 *
 * **`label` / `href` 是"这一处收下的算不算打开工程"**（2026-09-26 加的，用户："拖拽选择时
 * 也需要触发这个变化"）：它跟同一个页面里 `pickFolder(label, href)` 传的是**同一套值**。
 * 两处都要传 —— 只传 `pickFolder` 的话，点「选目录」状态栏那条会变成那个目录名，
 * 拖同一个目录进来却不变，同一个动作两种结果。（当时判的是顶栏那颗胶囊，
 * 那颗 2026-10-07 删了；这条规矩不变。）
 */
import { registerZone, unregisterZone, type DropZone } from './dropzones.svelte';

/** 每个元素一个稳定 id。用序号而不是随机串，便于在探针里认人 */
let 序号 = 0;

/** 落点参数：只要"收到路径干什么"，再可选地报一句"这算打开了哪个工程" */
export type 目录落点 =
  | ((路径: string) => void)
  | { 收: (路径: string) => void; label?: string; href?: string };

export function 接目录(node: HTMLElement, 参数: 目录落点) {
  const id = `dir.${++序号}`;
  let 当前: (路径: string) => void = () => {};
  let 记: { label: string; href: string } | undefined;

  const 拆 = (p: 目录落点) => {
    if (typeof p === 'function') {
      当前 = p;
      记 = undefined;
    } else {
      当前 = p.收;
      记 = p.label ? { label: p.label, href: p.href ?? '' } : undefined;
    }
  };
  拆(参数);

  /* 留一份引用：`update` 里要改的是**这一个对象**，
     另造一个再登记会留下旧的落点（`rect` 也会指着老元素）。 */
  const zone: DropZone = {
    id,
    rect: node.getBoundingClientRect(),
    el: node,
    dir: true,
    记,
    onDrop: (ref) => 当前(ref.path)
  };
  registerZone(zone);

  return {
    update(下一个: 目录落点) {
      拆(下一个);
      zone.记 = 记;
    },
    destroy() {
      unregisterZone(id);
    }
  };
}
