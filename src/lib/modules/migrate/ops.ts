/**
 * ⑥ 工程迁移打包的纯逻辑（不碰 DOM、不调 Rust，测得了）。
 *
 * 这里只做**界面要显示的账**：有多少对象、命中几条、缺几个文件、问题分几类。
 * 目标相对路径**不在这里算** —— 那条规则只有 Rust 里一份（`project.rs` 的 `目标相对`），
 * 界面拿"干跑"的结果直接显示。两处各写一份规则是这工程吃过亏的老毛病。
 */
import type { 工程扫描, 工程命中 } from '$lib/io';

export type 汇总 = {
  对象数: number;
  命中数: number;
  精确命中: number;
  结构命中: number;
  缺文件数: number;
  特效数: number;
  贴图数: number;
  贴图缺: number;
  /** 命中率，整数百分比（只按对象条目算） */
  命中率: number;
  /** 问题按类分好，多的在前 */
  问题类: { 类: string; 数: number }[];
  /** 能不能进"打包"这一步 */
  可打包: boolean;
  /** 为什么不能（空串 = 能） */
  拦: string;
};

/** 问题串的分类：`分类名：详细…` 里的分类名 */
export function 分类问题(问题: string[]): { 类: string; 数: number }[] {
  const 表 = new Map<string, number>();
  for (const p of 问题) {
    const i = p.indexOf('：');
    const 类 = i > 0 ? p.slice(0, i) : '别的';
    表.set(类, (表.get(类) ?? 0) + 1);
  }
  return [...表].map(([类, 数]) => ({ 类, 数 })).sort((a, b) => b.数 - a.数);
}

export function 汇总扫描(s: 工程扫描): 汇总 {
  const 对象数 = s.objects.length;
  const 命中数 = s.pmm_hits.length;
  /* 分级名就是 Rust 里 `找字段` 的那四级；"完整路径"是唯一的强证据那一级。
     （早先按 `startsWith('精确')` 分类，而四级里没有叫"精确"的 → 界面上永远是"精确 0"。） */
  const 精确命中 = s.pmm_hits.filter((h: 工程命中) => h.怎么找到的 === '完整路径').length;
  const 结构命中 = 命中数 - 精确命中;
  const 缺文件数 = s.在盘上.filter((x) => !x).length;
  const 问题类 = 分类问题(s.问题);
  const 命中率 = 对象数 ? Math.round((命中数 * 100) / 对象数) : 0;

  /* 拦不拦：这两种情况写盘就是在赌 —— 拦下来比改错好。
     · 有对象一条都没命中（不知道它路径在哪，改了也改不全）
     · 命中率不到 90%（说明这批工程的路径存法跟我们对不上，先别动） */
  const 没命中 = 对象数 - 命中数;
  let 拦 = '';
  if (!对象数) 拦 = '这个工程里没有对象（.emm 的 [Object] 段是空的？）';
  else if (没命中 > 0) 拦 = `有 ${没命中} 个对象的路径字段没定位到，写盘会改不全`;
  else if (命中率 < 90) 拦 = `命中率只有 ${命中率}%，先别动盘`;

  return {
    对象数,
    命中数,
    精确命中,
    结构命中,
    缺文件数,
    特效数: s.effects.length,
    贴图数: s.textures.length,
    贴图缺: s.textures.filter((t) => !t.exists).length,
    命中率,
    问题类,
    可打包: 拦 === '',
    拦
  };
}
