/**
 * 模块注册表 —— 加新功能只改这一个文件。
 *
 * 用法：往 MODULES 里加一条，导航、分区 Tab、功能页标题、关于页清单会自动出现。
 * 详细步骤见 `docs/加新模块.md`。
 *
 * 编号沿用你最初列需求时的顺序（①乱码 ②ikClut ③Ray ⑤ILM ⑥养乐多 ⑦通道 ⑨工程迁移）。
 * **④msToon 与 ⑧Ramp 都已删**（⑧ 2026-09-23、④ 2026-09-26），号留着不补 ——
 * 文档和用户还在按这些号指模块。
 */

import type { GroupDef, ModuleDef } from './types';

/* 各功能的实际界面。一个模块一个组件，组件内部按 panelId 切分区 ——
   分区 Tab 仍然由注册表驱动，组件只负责画内容。
 *
 * **这里不 import 组件本体，只写加载器。** 注册表被侧栏、首页、快捷动作一起读，
 * 顶层 import 会把七个功能的代码全并进首屏那个 chunk：实测首屏 642 KB / 全部 671 KB，
 * 所有模块一个不落。改成 `() => import(...)` 之后 Rollup 才拆得开，
 * 打开哪个功能才拉哪个。`load` 存的是函数，`[id]/+page.svelte` 负责 await 它。 */
const loadChannels = () => import('./channels/Channels.svelte');
const loadExtract = () => import('./channels/Extract.svelte');
const loadPipeline = () => import('./channels/Pipeline.svelte');
const loadGlitch = () => import('./glitch/Glitch.svelte');
const loadIkclut = () => import('./ikclut/Ikclut.svelte');
const loadIlm = () => import('./ilm/Ilm.svelte');
const loadRay = () => import('./ray/Ray.svelte');
const loadYaku = () => import('./yaku/Yaku.svelte');
const loadMigrate = () => import('./migrate/Migrate.svelte');
const loadRecent = () => import('./work/Recent.svelte');
const loadQuick = () => import('./work/Quick.svelte');

export const GROUPS: GroupDef[] = [
  { id: 'work', label: '工作区', icon: 'group.work', order: 0 },
  { id: 'texture', label: '贴图', icon: 'group.texture', order: 1 },
  { id: 'grade', label: '调色', icon: 'group.grade', order: 2 },
  { id: 'text', label: '文本', icon: 'group.text', order: 3 },
  { id: 'render', label: '渲染联动', icon: 'group.render', order: 4 },
  { id: 'proj', label: '工程', icon: 'group.proj', order: 5 }
];

export const MODULES: ModuleDef[] = [
  /* ---------------- 工作区 ---------------- */
  {
    id: 'overview',
    name: '总览',
    desc: '三步走、快捷动作、环境状态。',
    job: '这一页是入口：挑一个功能开工，或者接着上次的工程做。',
    group: 'work',
    icon: 'leaf.overview',
    ready: true,
    order: 0
  },
  {
    id: 'recent',
    name: '最近工程',
    desc: '打开过的模型文件夹会记在这里，点一下接着做。',
    job: '这一页记着你打开过的工程：点一下接着做。',
    group: 'work',
    icon: 'leaf.recent',
    ready: true,
    order: 1,
    panel: 'list',
    panels: [{ id: 'list', label: '记录', hint: '选过的目录 + 当时在干什么', load: loadRecent }]
  },
  {
    id: 'quick',
    name: '快捷动作',
    desc: '不走功能页，直接把常用操作拖出来当按钮用。',
    job: '这一页把你常用的动作钉成按钮：点一下就执行。',
    group: 'work',
    icon: 'leaf.quick',
    ready: true,
    order: 2,
    panel: 'pin',
    panels: [
      { id: 'pin', label: '固定', hint: '点一下就执行', load: loadQuick }
    ]
  },

  /* ---------------- 贴图（v1 主战场） ---------------- */
  {
    id: 'channels',
    no: '⑦',
    name: '贴图通道处理',
    desc: '拆通道、合通道、图层蒙版、按游戏套通道约定。调整那一套对着 PS 的「图像 > 调整」做。',
    job: '这一页处理贴图通道：拆 / 合 / 换分量，图层与蒙版，按游戏套通道约定。',
    group: 'texture',
    icon: 'leaf.channels',
    ready: true,
    panel: 'extract',
    order: 0,
    panels: [
      { id: 'extract', label: '通道提取', hint: '认语义 + 材质 ID 拆遮罩', load: loadExtract },
      { id: 'pipeline', label: '批量提取', hint: '整个目录三条一起跑', load: loadPipeline },
      { id: 'layers', label: '图层与蒙版', hint: '图层栈 + 蒙版取任意通道', load: loadChannels },
      { id: 'adjust', label: '调整', hint: '亮度对比色阶曲线那些', load: loadChannels },
      { id: 'blend', label: '混合', hint: '24 种混合模式', load: loadChannels },
      { id: 'split', label: '分离', hint: 'RGBA 拆成四张灰度', load: loadChannels },
      { id: 'merge', label: '合并', hint: '挑分量合成 RGBA', load: loadChannels },
      { id: 'swizzle', label: '调换', hint: '自己排 R/G/B/A', load: loadChannels },
      { id: 'batch', label: '批量', hint: '整个目录一起跑', load: loadChannels }
    ]
  },
  {
    id: 'ilm',
    no: '⑤',
    name: '绝区零贴图合成',
    desc: '把绝区零的 _A / _M / _N 三张拼成一张 LM：R 取 A 的 G，G 取 N 的 B，B 取 M 的 B，A 填 1。只管这一个游戏的这一种排法。',
    job: '这一页把绝区零的 _A / _M / _N 三张拼成一张 LM（只管这一个游戏的这一种排法）。',
    group: 'texture',
    icon: 'leaf.ilm',
    ready: true,
    panel: 'pack',
    order: 1,
    panels: [
      { id: 'pack', label: '绝区零打包', hint: '_A / _M / _N → LM', load: loadIlm },
      { id: 'pairing', label: '配对检查', hint: '对着材质文件核一遍', load: loadIlm }
    ]
  },
  /* ④ msToon 贴图**整个模块已删**（2026-09-26 用户："删除 MSToon 贴图绘制功能"）。
     号留着不补，跟 ⑧ 一样 —— 文档和用户还在按 ①②③… 指模块。
     删掉的是：Mstoon.svelte / mstoon/ops.ts / mstoon/params.svelte.ts，以及它在设置里
     那一行"msToon 控制图模板目录"。
     **⑦ 里那三条 msToon 控制图模板（`mstoon-gi/hsr/zzz`，住在 `channels/ops.ts` 的 GAMES）
     不跟着删** —— 那是"贴图通道处理"自己的打包模板，不走 ④ 这条路。 */

  /* ---------------- 调色 ---------------- */
  {
    id: 'ikclut',
    no: '②',
    name: 'ikClut 调色',
    desc: '一条能增删、能重排的处理链（基本 / 曲线 / 导入的 LUT），烘成 1024×32 的 CLUT 对齐 ikClut.fx 的排法。也能把 1 / 2 / 4 张现成 LUT 混成一张。',
    job: '这一页调一张 LUT：载入参考图、调色，烘成 1024×32 的 CLUT 再导出。',
    group: 'grade',
    icon: 'leaf.ikclut',
    ready: true,
    panel: 'clut',
    order: 0,
    panels: [
      { id: 'clut', label: '生成', hint: '1024×32', load: loadIkclut },
      { id: 'blend', label: '混合', hint: '1 / 2 / 4 张', load: loadIkclut },
      { id: 'export', label: '导出', hint: '对齐 ikClut.fx', load: loadIkclut }
    ]
  },

  /* ---------------- 文本 ---------------- */
  {
    id: 'glitch',
    no: '①',
    name: '日文乱码修复',
    desc: '日文被按 GBK 读出来变成的乱码，粘进来还原成 Shift-JIS 原文。也能整目录批处理，或者只动 .fx 里的注释不动代码。',
    job: '这一页把日文乱码还原成原文：粘进来、拖文件/文件夹进来，或整目录批量跑。',
    group: 'text',
    icon: 'leaf.glitch',
    ready: true,
    panel: 'fix',
    order: 0,
    panels: [
      { id: 'fix', label: '文本', hint: '粘乱码，出原文', load: loadGlitch },
      { id: 'batch', label: '文件', hint: '递归目录，自动猜编码', load: loadGlitch },
      { id: 'fx', label: '.fx 注释', hint: '只改注释', load: loadGlitch },
      { id: 'names', label: '名字还原', hint: '文件/目录名里的乱码', load: loadGlitch }
    ]
  },

  /* ---------------- 渲染联动 ---------------- */
  {
    id: 'ray',
    no: '③',
    name: 'Ray 编辑器',
    desc: '把 ray.conf 里的 #define 开关做成界面，改了先出 diff 再写盘。也能读 .fxsub 的控制器参数。非 UTF-8 的包按字节改，不动日文注释。',
    job: '这一页改 ray.conf 的开关与 .fxsub 的控制器参数：先出 diff 再写盘。',
    group: 'render',
    icon: 'leaf.ray',
    ready: true,
    panel: 'conf',
    order: 0,
    panels: [
      { id: 'conf', label: '配置开关', hint: 'ray.conf / ray_advanced.conf', load: loadRay },
      { id: 'material', label: '材质参数', hint: '.fxsub 控制器', load: loadRay }
    ]
  },
  {
    id: 'yaku',
    no: '⑥',
    name: '养乐多上材质',
    desc: '按 PMX 里的材质名分类，对着渲染包的 fx 模板填好贴图路径、通道对应和逐子材质参数，写出 .fx。',
    job: '这一页按 PMX 的材质名生成 .fx：对着渲染包模板填好路径与参数。',
    group: 'render',
    icon: 'leaf.yaku',
    ready: true,
    panel: 'match',
    order: 1,
    panels: [
      { id: 'match', label: '材质匹配', hint: 'PMX 材质名 → fx 模板', load: loadYaku },
      { id: 'apply', label: '写入', hint: '生成 .fx 并填参数', load: loadYaku }
    ]
  },

  /* ---------------- 工程 ---------------- */
  {
    id: 'migrate',
    no: '⑨',
    name: '工程迁移',
    desc: '拖进 .pmm 就开工（同名 .emm 自动接上）。两个区各管一件事：文件只是被挪走 → 「修复工程」只改路径；要发给别人或整体换地方 → 「打包迁移」把文件连同工程一起拷到指定位置。都先出表，确认了才写盘；改错了可以撤销上一次。',
    job: '这一页修工程的路径，或者把工程连同素材打包到一个位置。',
    group: 'proj',
    icon: 'leaf.migrate',
    ready: true,
    panel: 'repair',
    order: 0,
    panels: [
      { id: 'repair', label: '修复工程', hint: '文件被挪走了，指回来', load: loadMigrate },
      { id: 'pack', label: '打包迁移', hint: '连同文件打包到一个位置', load: loadMigrate }
    ]
  }
];

/* ============================================================
   下面是派生出来的东西。页面不要直接读 MODULES，读这些。
   ============================================================ */

export type NavLeaf = {
  id: string;
  label: string;
  icon: string;
  ready: boolean;
  /** 全名，用于 title */
  title: string;
};

export type NavGroup = GroupDef & { children: NavLeaf[] };

/** 导航树：分组 × 组内模块，按 order 排 */
export const NAV: NavGroup[] = [...GROUPS]
  .sort((a, b) => a.order - b.order)
  .map((g) => ({
    ...g,
    children: MODULES.filter((m) => m.group === g.id && !m.hidden)
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
      .map((m) => ({
        id: m.id,
        // 不带序号。`no` 是需求文档里的编号，留着做内部索引就行，
        // 摆到侧栏上用户看着就是一堆不知从哪来的圈码。
        label: m.name,
        icon: m.icon,
        ready: m.ready,
        title: m.desc
      }))
  }))
  .filter((g) => g.children.length > 0);

/** 按 id 取模块 */
export function getModule(id: string): ModuleDef | undefined {
  return MODULES.find((m) => m.id === id);
}

/** 按 id 找它在哪个分组，给面包屑用 */
export function findGroup(moduleId: string): NavGroup | undefined {
  return NAV.find((g) => g.children.some((c) => c.id === moduleId));
}

/**
 * 功能页顶部显示的完整标题。
 *
 * 不要带 `no`。那个圈码是需求文档里的编号，界面上出现就是"莫名其妙的序号"。
 * 顶栏、面包屑都走这里，所以只改这一处就够了。
 */
export function moduleTitle(m: ModuleDef): string {
  return m.name;
}

/** 关于页用：已做好 / 排在后面 */
export function modulesByState() {
  const done: ModuleDef[] = [];
  const todo: ModuleDef[] = [];
  for (const m of MODULES) {
    if (m.group === 'work' || m.hidden) continue;
    (m.ready ? done : todo).push(m);
  }
  return { done, todo };
}

/** 底部固定两项。形制和分组一样，但不参与折叠。 */
export const NAV_FOOT = [
  { id: 'settings', label: '设置', icon: 'nav.settings', href: '/settings' },
  { id: 'about', label: '关于', icon: 'nav.about', href: '/about' }
];

/** 三步走，所有功能共用这一条流程 */
export const STEPS = [
  { n: '①', t: '选进来', d: '拖文件或文件夹，扫完会告诉你哪些要处理、哪些跳过' },
  { n: '②', t: '调参数', d: '每一项都能先看预览，确认了再写盘' },
  { n: '③', t: '导出', d: '覆盖之前自动留一份备份' }
];
