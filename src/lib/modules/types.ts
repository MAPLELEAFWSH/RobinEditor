/**
 * 模块注册表的类型定义。
 *
 * 设计目标：**加一个新功能只改一个文件**。
 * 以前加一个功能要同时改 `nav.ts`（导航树）、`panels.ts`（分区与文案）、
 * 功能页（如果需要特殊 UI）三处，漏一处就出现"导航里有、页面打不开"这种半成品。
 * 现在导航、分区 Tab、功能页标题、关于页清单全部从注册表派生。
 */

import type { Component } from 'svelte';

/** 一个分区（功能页里的一个 Tab） */
export type PanelDef = {
  id: string;
  label: string;
  /** 显示在标签下面的半句话说明 */
  hint?: string;
  /**
   * 这个分区的实际界面。不写就落到通用的三步工作区骨架。
   *
   * 存的是**加载器**，不是组件本身。注册表被侧栏、首页、快捷动作一起读，
   * 这里直连组件的话，七个功能的代码会在首屏全部求值一遍
   * （实测首屏 JS 642 KB / 总共 671 KB，十一个模块全在上面）。
   * 写成 `() => import('./x/X.svelte')` 之后打包器才拆得开。
   */
  load?: () => Promise<{ default: Component }>;
};

/** 一个功能模块 */
export type ModuleDef = {
  /** 路由 id，对应 /tools/<id> */
  id: string;
  /** 需求里的原始编号（①–⑧）；工作区类的模块不写 */
  no?: string;
  name: string;
  /** 一句话说明，功能页标题下面和导航 title 都用它 */
  desc: string;
  /**
   * **顶部那一句话**（设计准则 §一：进页面一眼就知道这一页干什么）。
   * 一句、说清"这一页做什么"，不写术语；显示在标题正下方（`desc` 之上、更显眼）。
   */
  job?: string;
  /** 所属分组 id */
  group: string;
  /** icons.ts 里的图标键 */
  icon: string;
  /** 是否已可用；false 会在导航里标"待做" */
  ready: boolean;
  /** 默认打开哪个分区 */
  panel?: string;
  /** 没有分区时就不渲染 Tab 条 */
  panels?: PanelDef[];
  /** 排在分组内的第几位，数字小的在前 */
  order?: number;
  /** 不在导航里出现（比如只从别处跳进来的页） */
  hidden?: boolean;
};

/** 导航分组 */
export type GroupDef = {
  id: string;
  label: string;
  icon: string;
  /** 组内排序 */
  order: number;
};
