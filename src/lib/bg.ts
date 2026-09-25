/**
 * 背景。三层，从"零文件"到"有图"：
 *
 *   native   纯代码：底色渐变 + 三团极光 + 细网格，跟着 --hue 走
 *   none     只有主题底色
 *   solid    固定一张壁纸
 *   carousel 轮放（默认）—— 交叉淡入换图
 *
 * 壁纸来自 `E:\deepseek-harness\mmd集成工具` 的元气壁纸，共 9 张。
 * 源图 37.6 MB，已由 tools/import_wallpapers.py 压到 3.0 MB（8.1%），
 * 统一宽 1920，另出 320 宽的缩略图给设置面板。
 *
 * 每张的**平均亮度和建议遮罩强度**也在同一步量好了（bg-meta.json）。
 * 壁纸有亮有暗，正文压上去需要的遮罩不一样；与其拍一个折中值，
 * 不如按当前是哪张取。亮度实测 0.195–0.680，遮罩 0.055–0.118。
 *
 * 自己导入的图存在 IndexedDB 里（见 bg-store.svelte.ts），
 * 导入时也用 canvas 量一遍亮度，所以和内置那批吃同一套自适应逻辑。
 */

import META_JSON from './bg-meta.json';
import { customBgs, urlOf, customMeta } from './bg-store.svelte';
import { arrangeBgs } from './bg-order';
import { prefs } from './prefs.svelte';

export type BgMode = 'carousel' | 'native' | 'solid' | 'none';

/**
 * 背景作用范围。
 *   work  只铺在内容区（侧栏、顶栏、尾栏保持实色）—— 不遮挡任何界面元素
 *   full  铺满整窗，界面元素改用毛玻璃浮在上面
 */
export type BgScope = 'work' | 'full';

export type BgItem = { id: string; name: string; custom?: boolean };

type Meta = { id: string; luma: number; scrim: number };
const META = META_JSON as Meta[];

/** 内置壁纸 */
export const BG_BUILTIN: BgItem[] = META.map((m, i) => ({
  id: m.id,
  name: `${i + 1}`.padStart(2, '0')
}));

/** 全部壁纸，没排序没过滤 —— 排过的是 `allBgs()` */
export function rawBgs(): BgItem[] {
  return [
    ...BG_BUILTIN,
    ...customBgs.map((c) => ({ id: c.id, name: c.name, custom: true as const }))
  ];
}

/**
 * 内置 + 自己导入的，按用户排的顺序摆，去掉藏起来的。
 *
 * 藏起来而不是删掉：内置那批是打包进程序里的静态文件，删不掉，
 * 而且用户多半只是想把自己不用的从列表里清出去，不是真不要了。
 * 所以「隐藏」可逆，「删除」只对导入的图有意义（那是真的从数据库里去掉）。
 */
export function allBgs(): BgItem[] {
  return arrangeBgs(rawBgs(), prefs.bgOrder, prefs.hiddenBgs);
}

/** 现在列表里有几张、藏了几张 */
export function bgUsage() {
  const raw = rawBgs();
  const shown = allBgs();
  return {
    total: raw.length,
    shown: shown.length,
    hidden: raw.length - shown.length,
    builtin: BG_BUILTIN.length,
    custom: customBgs.length
  };
}

/** 藏一张（内置导入的都行） */
export function hideBg(id: string) {
  if (prefs.hiddenBgs.includes(id)) return;
  prefs.hiddenBgs = [...prefs.hiddenBgs, id];
  // 藏起来的就从顺序表里去掉，不然放回来的时候位置很怪
  prefs.bgOrder = prefs.bgOrder.filter((x) => x !== id);
}

/** 全放回来 */
export function showAllBgs() {
  prefs.hiddenBgs = [];
}

/** 是不是导入的 */
export function isCustom(id: string) {
  return id.startsWith('cu-');
}

/** 主图。内置走静态文件，导入的走 objectURL */
export function bgSrc(id: string) {
  return isCustom(id) ? urlOf(id) : `/bg/${id}.jpg`;
}

/** 缩略图。导入的没有单独的缩略图，直接用主图（本来就压到 1920 了） */
export function thumbSrc(id: string) {
  return isCustom(id) ? urlOf(id) : `/bg/thumb/${id}.jpg`;
}

/** 这张的平均亮度 0–1 */
export function bgLuma(id: string) {
  return customMeta(id)?.luma ?? META.find((m) => m.id === id)?.luma ?? 0.4;
}

/**
 * 这张该压多厚的遮罩 0–1。
 * 亮图厚一点、暗图薄一点，都是量出来的（内置在 build 时量，导入的在 canvas 里量）。
 */
export function bgScrim(id: string) {
  return customMeta(id)?.scrim ?? META.find((m) => m.id === id)?.scrim ?? 0.09;
}

export const BG_MODES: { id: BgMode; label: string; hint: string }[] = [
  { id: 'carousel', label: '轮放', hint: '隔一会儿换一张，交叉淡入' },
  { id: 'solid', label: '单张', hint: '固定一张' },
  { id: 'native', label: '纯代码', hint: '跟着主题色画的，不需要图片' },
  { id: 'none', label: '纯色', hint: '只有主题底色' }
];

export const BG_SCOPES: { id: BgScope; label: string; hint: string }[] = [
  { id: 'work', label: '仅工作区', hint: '壁纸只在内容区，侧栏和顶栏是实色' },
  { id: 'full', label: '全屏', hint: '壁纸铺满整窗，界面用毛玻璃浮在上面' }
];

/**
 * 适应方式。壁纸宽高比 1.41–2.35，容器 1.16–1.95，差得不少，
 * 用 cover 硬裁最极端的一张要裁掉一半宽度，所以得给选项。
 */
export type BgFit = 'cover' | 'contain' | 'blur' | 'fill';

export const BG_FITS: { id: BgFit; label: string; hint: string }[] = [
  { id: 'cover', label: '裁切填满', hint: '铺满，超出的裁掉。最干净，但会切掉两侧或上下' },
  { id: 'blur', label: '模糊补边', hint: '整张完整显示，空白处用同一张的模糊放大版补上' },
  { id: 'contain', label: '完整显示', hint: '整张完整显示，空白处留底色。不裁但会有边框' },
  { id: 'fill', label: '拉伸', hint: '不裁也不留白，但会变形' }
];

/** 裁切时保住哪一块。3×3 */
export const BG_POS = [
  { id: 'left top', label: '左上' },
  { id: 'center top', label: '中上' },
  { id: 'right top', label: '右上' },
  { id: 'left center', label: '左中' },
  { id: 'center center', label: '居中' },
  { id: 'right center', label: '右中' },
  { id: 'left bottom', label: '左下' },
  { id: 'center bottom', label: '中下' },
  { id: 'right bottom', label: '右下' }
];
