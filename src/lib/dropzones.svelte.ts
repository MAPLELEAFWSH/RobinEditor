/**
 * 通用落点：**不只是图片槽**的地方也能接拖进来的文件。
 *
 * 为什么要这个：③ Ray 的贴图参数是"选贴图"按钮 + 一行文本，⑥ 养乐多的贴图是输入框
 * —— 都不是图片槽，但有真实路径就该能拖进去（拖进去比走对话框快）。
 *
 * 跟 `Slots` 那套的关系：两者互不干扰，`drag-dom` 解析落点时**先问这里**，
 * 没人认领再交给图片槽。
 *
 * 纯模块：不碰 DOM（除了加个类名）、不引 svelte、没有 rune，所以套件能直接跑。
 * 文件名带 `.svelte` 是历史原因（本来打算放 `$state`），内容不需要。
 */
import type { FileRef } from './io';

export type DropZone = {
  /** 稳定 id，注册表用它认人 */
  id: string;
  /** 落点在屏幕上的范围，用来判"鼠标在谁头上" */
  rect: { left: number; top: number; right: number; bottom: number };
  /** 悬停时要加标记的元素（加 `.is-drop`）。不给就不给视觉反馈 */
  el?: HTMLElement | null;
  /** 落下来时收到这个文件的真路径 */
  onDrop: (ref: FileRef) => void;
  /**
   * 这个落点收的是**文件夹**（渲染包目录那几处），不是图片。
   *
   * 为什么要单独一个开关：文件夹在拖放事件里只给一条路径、没有后缀，
   * 走图片那套筛法会被当成"不是图片，没接"挡掉。桌面端那条路按它跳过筛法。
   */
  dir?: boolean;
  /**
   * 这个落点收什么后缀的文件。
   *
   * 不写 = **只收图片**（跟图片槽一致的老行为）；`'any'` = 什么文件都收；
   * 给数组 = 只收这几种后缀。
   *
   * 为什么要它：`.fx` / `.fxsub` / `.pmm` / `.emm` 都不是图片，
   * 原来一律被"不是图片，没接"挡在门口 —— 用户拖工程文件进来就报这个
   * （2026-09-21 实测）。筛法得跟着落点走，不能全窗口一刀切。
   */
  accept?: 'any' | string[];
  /**
   * 「这个落点收下的东西算不算一次**打开工程**」。给了就记进最近工程 + `当前工程`。
   *
   * 为什么要它（用户 2026-09-26："拖拽选择时也需要触发这个变化"）：
   * 选目录那条路会记，因为页面调的是 `pickFolder('批量提取', '/tools/channels?panel=pipeline')`
   * —— **记录挂在那个标签参数上**。而拖文件夹进来走的是落点，压根不经过 `pickFolder`，
   * 于是同一个目录，点按钮选它会变、拖进来不变（当时看的是顶栏那颗胶囊 + 底栏那一条；
   * 两处 2026-10-07 / 10-12 先后删了 —— 现在界面上不显示工程名，但底账要一致）。
   *
   * `label` / `href` 的写法跟 `pickFolder(label, href)` 一模一样，一处一个来源。
   */
  记?: { label: string; href: string };
};

/** 悬停标记的类名。CSS 那边按它画高亮 */
export const DROP_HOT_CLASS = 'is-drop';

const zones = new Map<string, DropZone>();

/** 注册/撤销的通知，只给界面用；注册表自己不需要它 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onZonesChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announce(): void {
  for (const fn of listeners) fn();
}

export function registerZone(z: DropZone): void {
  if (!z.id) return;
  zones.set(z.id, z);
  announce();
}

export function unregisterZone(id: string): void {
  const z = zones.get(id);
  z?.el?.classList?.remove(DROP_HOT_CLASS);
  if (zones.delete(id)) announce();
}

/**
 * 重算一个落点的矩形。
 * 滚动、窗口缩放、面板展开之后必须重来一遍 —— 否则高亮和命中会停在旧位置。
 */
export function updateRect(id: string, el: HTMLElement): void {
  const z = zones.get(id);
  if (!z || !el) return;
  const r = el.getBoundingClientRect();
  z.rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

export function zoneIds(): string[] {
  return [...zones.keys()].sort();
}

/** 全部落点。`drag-dom` 要拿它逐个重算矩形 */
export function listZones(): DropZone[] {
  return [...zones.values()];
}

export function resetZones(): void {
  for (const z of zones.values()) z.el?.classList?.remove(DROP_HOT_CLASS);
  zones.clear();
}

const inside = (z: DropZone, x: number, y: number): boolean =>
  x >= z.rect.left && x <= z.rect.right && y >= z.rect.top && y <= z.rect.bottom;

/**
 * 鼠标底下的**所有**落点，面积从小到大。
 *
 * 为什么要一串而不只给最小的那个：压在一行贴图上的 `.fx` 会被那一行拒收
 * （贴图行只收图片），只问"最小的"就等于整页那个落点根本不存在 ——
 * 拖材质进来正好卡在这一条上（用户 2026-09-23 报的）。
 * 要谁去接由调用方按"这批文件它收不收"挑，`zoneAt` 只是它的第一个。
 */
export function zonesAt(x: number, y: number): DropZone[] {
  const 命中: { z: DropZone; a: number }[] = [];
  for (const z of zones.values()) {
    if (!inside(z, x, y)) continue;
    const a = Math.max(0, z.rect.right - z.rect.left) * Math.max(0, z.rect.bottom - z.rect.top);
    命中.push({ z, a });
  }
  /* 同面积的按注册顺序（Map 的插入序）—— 跟以前"先注册的赢"一致 */
  命中.sort((p, q) => p.a - q.a);
  return 命中.map((h) => h.z);
}

/**
 * 鼠标底下那个落点。
 *
 * 多个重叠（比如一行的落点套在面板的大落点里）时取**面积最小**的那个
 * —— 越具体的赢，用户指着一行就该落那一行，不是落整个面板。
 * 它拒收手上的文件时用 `zonesAt` 往下找，见 `drag-dom`。
 */
export function zoneAt(x: number, y: number): DropZone | null {
  return zonesAt(x, y)[0] ?? null;
}

/**
 * 高亮换人：把 `keep` 之外的都摘掉标记。
 * 每帧都调也安全 —— 类名没变就不动 DOM。
 */
export function noticeForward(keep: DropZone | null): void {
  for (const z of zones.values()) {
    const cl = z.el?.classList;
    if (!cl) continue;
    const want = z === keep;
    if (want && !cl.contains(DROP_HOT_CLASS)) cl.add(DROP_HOT_CLASS);
    else if (!want && cl.contains(DROP_HOT_CLASS)) cl.remove(DROP_HOT_CLASS);
  }
}
