/**
 * 从窗口外拖文件进来 —— 落点怎么定。
 *
 * 为什么单独一个文件：Tauri 开了原生拖放（`dragDropEnabled` 默认 true），
 * webview 里的 HTML5 `drop` 在桌面端收不到任何东西，文件在系统层就被接走了。
 * 所以真路径只有 `onDragDropEvent` 给，而浏览器（`pnpm dev`）那条只有 HTML5 给。
 * 两条路汇到本文件的 `applyDrop`，判断只写一份。
 *
 * 落点规则：
 *   1. 刚 hover 过的槽优先 —— 桌面上就是"我指着哪儿放哪儿"
 *   2. 没 hover 过就找当前面板里第一个空槽
 *   3. 全是满的就填第一个
 * 多文件按这个顺序往下铺，铺满一轮再从头上。
 *
 * 本文件不引 svelte、不碰 DOM，好让套件直接跑真代码。
 */
import type { FileRef } from './io';

/**
 * 一组槽位。功能组件填这一份，`Slot` 照着注册。
 *
 * `defs` / `loaded` 独立于 `loaded` 那个回调：`Slot` 只问"本组有哪几格、
 * 哪些格已经有图"，不去碰槽里的图。
 */
export type DropGroup = {
  /** 稳定的组名。提成组件里的常量，别就地写对象字面量 */
  key: string;
  /** 本组有哪几格，按界面上的摆放顺序 */
  defs: { id: string; label: string }[];
  /** 这一格有图没有。决定多文件先铺空槽还是从头盖 */
  loaded(id: string): boolean;
  /** 真路径 → 填进槽（桌面端走这条，像素从 Rust 拿） */
  loadRef(id: string, ref: FileRef): Promise<void>;
  /** 浏览器没有真路径，只能给 File 对象 */
  loadFile(id: string, file: File): Promise<void>;
  /** 失败往哪儿报 */
  fail(msg: string): void;
};

/** 从窗口外拖进来的那个文件。`path` 是真实路径，浏览器下拿不到 */
export type Incoming = {
  path: string;
  name: string;
  ext: string;
  file: File | null;
};

/* ------------------------------------------------------------ 注册表 */

const groups = new Map<string, DropGroup>();
let fallback: DropGroup | null = null;
/** 一个槽位只能有一个主人。重复认领会把落点串到别的槽上，且不会报错 */
const owners = new Map<string, string>();

/**
 * 一组槽位声明自己"能被拖进来"。
 *
 * `key` 每次渲染都要一样，别用对象字面量当参数 —— 那样每次都是新键，
 * 会重复注册。在组件里提成常量。
 */
export function registerDropGroup(group: DropGroup): void {
  if (!group.key) return;
  for (const d of group.defs) {
    const k = slotKey(group.key, d.id);
    if (owners.has(k)) continue;
    owners.set(k, group.key);
  }
  groups.set(group.key, group);
  refreshFallback();
}

/** 一个槽位注册表项。键是 `组名::槽位id`，好按 DOM 上的属性直接拼 */
export function slotKey(groupKey: string, id: string): string {
  return `${groupKey}::${id}`;
}

export function unregisterDropGroup(key: string): void {
  groups.delete(key);
  for (const [k, v] of [...owners]) if (v === key) owners.delete(k);
  refreshFallback();
}

/** 只剩一个组时，它自动当全局兜底 —— 单槽的模块拖到卡片外沿也算数 */
function refreshFallback(): void {
  fallback = groups.size === 1 ? [...groups.values()][0] : null;
}

export function registeredKeys(): string[] {
  return [...groups.keys()].sort();
}

/** 套件用：清空注册表 */
export function resetDropRegistry(): void {
  groups.clear();
  owners.clear();
  fallback = null;
}

/* ------------------------------------------------------------ 落点解析 */

/** 某个键能不能落 */
export function isDroppable(key: string): boolean {
  if (!groups.size) return false;
  if (!key) return true;
  return groups.has(key.split('::')[0]);
}

/**
 * 这一下该落到哪组槽的哪个格子上。
 *
 * 找不到指定的组时不要直接放弃 —— 松手位置常常在槽的缝里，
 * 界面上明明有槽却什么都不发生，比落错一格更难懂。
 * 兜底顺序：单组就直接用它，多组用展示顺序最靠前的那个组。
 */
function targetFor(key: string, order?: string[]): { group: DropGroup; pick: string | null } | null {
  if (!groups.size) return null;

  const own = key ? groups.get(key.split('::')[0]) : undefined;
  if (own) return { group: own, pick: key.split('::')[1] || null };

  const id = key.includes('::') ? key.split('::')[1] : key;
  if (fallback) return { group: fallback, pick: id || null };

  const firstKey = (order ?? []).find((k) => groups.has(k.split('::')[0]));
  const g = firstKey ? groups.get(firstKey.split('::')[0]) : [...groups.values()][0];
  return g ? { group: g, pick: null } : null;
}

/**
 * 要落的那一串槽位，按先空后满排。
 *
 * `order` 是整页所有槽的展示顺序（DOM 顺序），先滤出本组那几格 ——
 * 不能直接信 `target.ids`，那是声明顺序，界面上未必这么摆。
 */
export function dropOrder(target: DropGroup, order?: string[]): string[] {
  const mine = new Set(target.defs.map((d) => d.id));
  const shown = (order ?? [])
    .filter((k) => mine.has(k.split('::')[1] ?? ''))
    .map((k) => k.split('::')[1]);
  const pool = shown.length ? shown : target.defs.map((d) => d.id);
  const empty = pool.filter((id) => !target.loaded(id));
  const full = pool.filter((id) => target.loaded(id));
  return [...empty, ...full];
}

/**
 * 这一批文件要落到的那串槽位。
 *
 * 顺序**只算一次**。原来每落一张就重算，而填过之后那一格就"不空了"，
 * 空槽队列跟着往前挪 —— 结果是三张图全挤进同一格。
 * 所以先定好路线，再按路线往下走。
 */
export function dropPlan(
  target: DropGroup,
  count: number,
  pick: string | null,
  order?: string[]
): string[] {
  const seq = dropOrder(target, order);
  if (!seq.length) return [];
  if (pick && target.defs.some((d) => d.id === pick)) {
    const at = seq.indexOf(pick);
    // 指的那格排在队尾就提到前面 —— 它是第一张的落点
    if (at > 0) {
      seq.splice(at, 1);
      seq.unshift(pick);
    }
  }
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(seq[i % seq.length]);
  return out;
}

/* ------------------------------------------------------------ 进来的文件 */

/** 认得的图片扩展名。跟 `io.ts` 的 `IMAGE_EXTS` 同源，这里只做落点判断 */
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'tga', 'bmp', 'gif', 'webp', 'tif', 'tiff', 'dds', 'ico'];

/**
 * 允许的后缀。
 *   `undefined` —— 图片（老行为，图片槽用这个）
 *   `null`      —— 任何文件（落点标了 `accept: 'any'`）
 *   `string[]`  —— 只认这几种（比如材质的 fx / fxsub、工程的 pmm / emm）
 */
export type ExtFilter = string[] | null | undefined;

/**
 * 落点收不收这个后缀。
 *
 * 导出是给 `drag-dom` 用的：一批文件落下来时可能压在好几个落点上，
 * 得按"谁收"挑一个，判据必须跟这里同一份 —— 两处各写一套迟早走岔。
 */
export function 收吗(ext: string, 允许: ExtFilter): boolean {
  if (允许 === null) return true;
  if (允许 === undefined) return IMAGE_EXTS.includes(ext);
  return 允许.includes(ext);
}

export function extOfName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function baseOfPath(p: string): string {
  const s = p.replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
  return i >= 0 ? s.slice(i + 1) : s;
}

/** 真实路径 → 进来的文件。后缀不合这个落点的要求就返回 null（目录也在这被挡掉） */
export function parseFileRef(path: string, 允许: ExtFilter = undefined): Incoming | null {
  const name = baseOfPath(path);
  if (!name) return null;
  const ext = extOfName(name);
  if (!收吗(ext, 允许)) return null;
  return { path, name, ext, file: null };
}

/** 浏览器那条：`dataTransfer.files` 里的 File 对象 */
export function parseFileObj(f: File, 允许: ExtFilter = undefined): Incoming | null {
  const ext = extOfName(f.name);
  if (!收吗(ext, 允许)) return null;
  return { path: '', name: f.name, ext, file: f };
}

/* ------------------------------------------------------------ 当前状态 */

/**
 * 悬浮与落点。`Slot` 直接读它决定高亮 —— 所以这里必须是 `$state`，
 * 由组件那侧创出来传进来（本文件不引 svelte）。
 *
 * 鼠标离开窗口、开始拖内部元素（排序、拖图层）都会把它清掉，
 * 不然会留一个假的落点。
 */
export type DragState = {
  /** 正被拖东西进来 */
  active: boolean;
  /** 当前落点，`slotKey()` 拼出来的 */
  over: string;
  /** 各槽的展示顺序，落点解析要用 */
  order: string[];
  /** 出错往这儿扔。硬规矩：错误显示在侧边导航栏，不弹窗 */
  fail(msg: string): void;
};

export function createDragState(fail: (msg: string) => void): DragState {
  return { active: false, over: '', order: [], fail };
}

/**
 * 槽位在界面上的排列顺序。落点解析要拿它排"先空后满"。
 *
 * 由挂监听的那一侧扫 DOM 得出来（`data-drop-key` 的出现顺序就是展示顺序），
 * 本文件只存不算。
 */
export function setSlotOrder(st: DragState, keys: string[]): void {
  st.order = keys;
}

export function resetDrag(st: DragState): void {
  st.active = false;
  st.over = '';
}

/* ------------------------------------------------------------ 落下去 */

/**
 * 真的把文件铺进槽里。两条路（原生 / HTML5）都走这儿。
 *
 * `key` 是鼠标底下那个槽，空字符串表示"没指哪儿"。
 */
export async function applyDrop(
  st: DragState,
  incoming: Incoming[],
  key: string
): Promise<{ filled: number; skipped: string[] }> {
  const skipped: string[] = [];
  const files = incoming.filter((it) => {
    if (it.path || it.file) return true;
    skipped.push(it.name);
    return false;
  });

  const at = targetFor(key, st.order);
  if (!at || !files.length) {
    st.active = false;
    st.over = '';
    return { filled: 0, skipped };
  }

  const target = at.group;
  const slots = dropPlan(target, files.length, at.pick, st.order);

  for (let i = 0; i < files.length; i++) {
    const id = slots[i];
    if (!id) continue;
    const it = files[i];
    try {
      if (it.path) {
        await target.loadRef(id, { path: it.path, name: it.name, rel: it.name, ext: it.ext, size: 0 });
      } else if (it.file) {
        await target.loadFile(id, it.file);
      }
    } catch (e) {
      target.fail(`${it.name}：${(e as Error).message}`);
    }
  }

  st.active = false;
  st.over = '';
  return { filled: files.length, skipped };
}
