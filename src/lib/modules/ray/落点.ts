/**
 * ③ 两页各自该有哪几个"能接文件"的落点。
 *
 * 为什么单列一份：上一轮只给「配置开关」那一页挂了材质落点，**「材质参数」那一页
 * 一个落点都没有** —— 界面写着"把文件从窗口外拖进来"，真拖进去只得到一句
 * "不是图片，没接"（用户 2026-09-23 报的）。这种事照着页面看不出来，
 * 所以声明抽成能单测的一份表，组件照着它注册，套件照着它查。
 *
 * `槽` 是元素在界面上的位置，组件那边按槽找元素（`Ray.svelte` 的落点 effect 里那句
 * `d.槽 === 'bar' ? rootBar : …`）：表里没有的槽不会注册；组件没渲染的槽，表里也别写。
 */
import type { DropZone } from '$lib/dropzones.svelte';

export type 落点槽 = 'bar' | 'card' | 'page' | 'row';

export type 落点声明 = {
  /** 稳定的落点 id。`槽 = 'row'` 时后面还要拼上材质的完整路径 */
  id: string;
  /**
   * 收什么后缀。跟 `DropZone.accept` 同一个口径：
   * 不写 = 只收图片；`'any'` = 什么都收；数组 = 只收这几种。
   */
  accept?: DropZone['accept'];
  /** 这个落点收的是**文件夹**（渲染包目录）而不是文件 */
  dir?: boolean;
  /** 这个 id 的元素在哪儿 */
  槽: 落点槽;
};

/** 能拖进来打开的材质后缀。界面那句提示、`accept`、这条链的测试都用它 */
export const 材质后缀 = ['fx', 'fxsub'];

/**
 * 这一页要注册哪些落点。
 *
 * 两页都有**整页**那一个：③ 这一整个模块干的就是"打开一个 .fx / 渲染包"，
 * 拖到页面上哪儿都应该把它打开 —— 只在材质清单那一小块上能落，
 * 落点外的地方就成了一句"不是图片，没接"（用户 2026-09-23 报的）。
 * 贴图行自己的落点面积更小，指在它上面时仍然归它，不会串。
 *
 * `conf`（配置开关）—— 工具条那一条接**渲染包文件夹**，材质清单那张卡和每一行接 `.fx`；
 * `material`（材质参数）—— 工具条与整页都接 `.fx`。
 */
export function 材质落点表(panelId: string): 落点声明[] {
  if (panelId === 'conf') {
    return [
      { id: 'ray:root', dir: true, 槽: 'bar' },
      { id: 'ray.mat:card', accept: 材质后缀, 槽: 'card' },
      { id: 'ray.mat:', accept: 材质后缀, 槽: 'row' },
      { id: 'ray.mat:page', accept: 材质后缀, 槽: 'page' }
    ];
  }
  if (panelId === 'material') {
    return [
      { id: 'ray.mat:bar', accept: 材质后缀, 槽: 'bar' },
      { id: 'ray.mat:page', accept: 材质后缀, 槽: 'page' }
    ];
  }
  return [];
}
