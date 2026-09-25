/**
 * 工程文件 —— 把一个模型的贴图工作状态存成一个 `.redproj`。
 *
 * 存什么、不存什么，是按"重开一次还想不想要"定的：
 *
 * | 存 | 不存 |
 * | --- | --- |
 * | 各槽位指向哪张图（路径） | 像素本身（几百 MB，而且图在盘上就有） |
 * | 图层栈（源 / 混合 / 不透明度 / 蒙版 / 每层的调整） | 批量面板扫出来的文件清单（下次重扫） |
 * | 调整链和作用范围 | 预览 URL、缓存、性能计数 |
 * | 混合页的底层和上层 | 当前选中的是哪一层（无关紧要） |
 *
 * **路径失效要如实报出来。** 工程文件里存的是路径，外部图或 LUT 一挪位置就对不上了；
 * 所以载入时不静默跳过读不到的那几张，而是把它们列出来让用户自己重指。
 */

import type { Layer } from './modules/channels/ops';

export const PROJECT_EXT = 'redproj';
const MAGIC = 'robineditor-project';
/** 格式版本。以后改结构就 +1，老文件读到不认的版本要明说 */
export const PROJECT_VERSION = 1;

export type ProjectSlot = {
  id: string;
  /** 图片路径。空 = 这个槽当时就没放图 */
  path: string;
};

export type ProjectDoc = {
  magic: string;
  version: number;
  /** 存的时候是哪个分区，载入后跳回去 */
  panel: string;
  savedAt: number;
  slots: ProjectSlot[];
  /** 图层页的图层栈 */
  layers: Layer[];
  /** 调整页的调整链 */
  adjustOps: unknown[];
  adjustScope: string;
  /** 混合页：底层 + 上层栈 */
  blendBase: Layer | null;
  blendLayers: Layer[];
};

export type ProjectBuild = {
  panel: string;
  slots: ProjectSlot[];
  layers: Layer[];
  adjustOps: unknown[];
  adjustScope: string;
  blendBase: Layer | null;
  blendLayers: Layer[];
};

export function buildProject(b: ProjectBuild, now = Date.now()): ProjectDoc {
  return {
    magic: MAGIC,
    version: PROJECT_VERSION,
    panel: b.panel,
    savedAt: now,
    slots: b.slots,
    layers: b.layers,
    adjustOps: b.adjustOps,
    adjustScope: b.adjustScope,
    blendBase: b.blendBase,
    blendLayers: b.blendLayers
  };
}

export function serializeProject(doc: ProjectDoc): string {
  // 缩进两格：工程文件是给人看得懂的，将来出问题要能自己打开瞧
  return JSON.stringify(doc, null, 2);
}

export type LoadedProject =
  | { ok: true; doc: ProjectDoc }
  | { ok: false; error: string };

/**
 * 解析一个工程文件。
 *
 * 认不出来的时候**要说清是哪儿不对**（不是工程文件 / 版本太新 / 结构坏了），
 * 而不是笼统地"打开失败" —— 用户手里可能是一个改了名的别的文件，
 * 也可能是自己手改坏了，这两种要给的下一步不一样。
 */
export function parseProject(text: string): LoadedProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `不是合法的 JSON：${(e as Error).message}` };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '文件内容不是一个对象，看着不像本工具的工程文件。' };
  }
  const o = raw as Record<string, unknown>;
  if (o.magic !== MAGIC) {
    return { ok: false, error: '这不是本工具的工程文件（少了标识）。' };
  }
  const v = typeof o.version === 'number' ? o.version : 0;
  if (v > PROJECT_VERSION) {
    return {
      ok: false,
      error: `这个工程是更新版本（v${v}）存的，当前程序只认到 v${PROJECT_VERSION}。升级一下再打开。`
    };
  }
  if (v < 1) return { ok: false, error: '工程文件缺版本号，可能是坏的。' };

  const slots: ProjectSlot[] = [];
  if (Array.isArray(o.slots)) {
    for (const s of o.slots) {
      if (!s || typeof s !== 'object') continue;
      const it = s as Record<string, unknown>;
      if (typeof it.id !== 'string' || !it.id) continue;
      slots.push({ id: it.id, path: typeof it.path === 'string' ? it.path : '' });
    }
  }

  const layers = Array.isArray(o.layers) ? (o.layers as Layer[]) : [];
  const blendLayers = Array.isArray(o.blendLayers) ? (o.blendLayers as Layer[]) : [];

  return {
    ok: true,
    doc: {
      magic: MAGIC,
      version: v,
      panel: typeof o.panel === 'string' ? o.panel : '',
      savedAt: typeof o.savedAt === 'number' ? o.savedAt : 0,
      slots,
      layers,
      adjustOps: Array.isArray(o.adjustOps) ? o.adjustOps : [],
      adjustScope: typeof o.adjustScope === 'string' ? o.adjustScope : 'all',
      blendBase: (o.blendBase && typeof o.blendBase === 'object' ? o.blendBase : null) as Layer | null,
      blendLayers
    }
  };
}

/** 工程里记了路径的槽位有几个、其中几个是空的 */
export function slotSummary(doc: ProjectDoc): { total: number; filled: number } {
  return {
    total: doc.slots.length,
    filled: doc.slots.filter((s) => !!s.path).length
  };
}

export type SlotFail = { id: string; path: string; error: string };

/**
 * 把工程里的槽位还原到界面上。
 *
 * 拆成这样一个函数（收 load/clear 两个回调）是为了**能单独测** ——
 * 真正载入走的是原生选文件对话框，自动化不了，但"哪个槽位读不到、报什么"
 * 这段逻辑是这次改动里最要紧的一条（路径失效必须如实报，不能静默丢），
 * 所以拿假 loader 把它钉住。
 *
 * 三种情况分开处理：
 *   - 工程里这格是空的 → 把界面上那格也清掉（当时就是空的，别留着旧图）
 *   - 读得到 → 正常装进去
 *   - 读不到 → **记下来**，由调用方报给用户；不抛异常，一格坏不该让整个工程打不开
 *
 * 工程里有、但当前界面不认识的槽位 id 直接跳过（比如以后加了新槽位，
 * 老工程的 slots 里没有它，那不是错误）。
 */
export async function restoreSlots(
  doc: ProjectDoc,
  knownIds: readonly string[],
  load: (id: string, path: string) => Promise<string | null>,
  clear: (id: string) => void
): Promise<SlotFail[]> {
  const fails: SlotFail[] = [];
  for (const s of doc.slots) {
    if (!knownIds.includes(s.id)) continue;
    if (!s.path) {
      clear(s.id);
      continue;
    }
    let err: string | null = null;
    try {
      err = await load(s.id, s.path);
    } catch (e) {
      err = (e as Error).message;
    }
    if (err) fails.push({ id: s.id, path: s.path, error: err });
  }
  return fails;
}

/** 把读不到的槽位拼成一句人话，直接显示 */
export function describeFails(fails: SlotFail[]): string {
  if (!fails.length) return '';
  const items = fails.map((f) => `${f.id}（${baseName(f.path)}：${f.error}）`);
  return `这几张图没读到，在槽里重选一下：${items.join('、')}`;
}

/** 从路径里取文件名，只为了报错信息好看 */
function baseName(p: string): string {
  const s = p.replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
  return i >= 0 ? s.slice(i + 1) : s;
}

/**
 * 载入之后给图层发新 id。
 *
 * **不能直接沿用文件里存的 id**：同一个会话里先后载入两个工程，
 * 或者载入之后再从预设套一套，id 撞了的话点一层会同时展开两层。
 */
export function reassignIds(layers: Layer[], next: () => string): Layer[] {
  return layers.map((l) => ({ ...l, id: next() }));
}

/** 顶部一行摘要，界面上显示"这个工程是什么时候存的、存了几张图" */
export function describeProject(doc: ProjectDoc): string {
  const { filled, total } = slotSummary(doc);
  const when = doc.savedAt
    ? new Date(doc.savedAt).toLocaleString('zh-CN', { hour12: false })
    : '未知时间';
  const parts = [`${when} 存的`, `${filled} / ${total} 个槽位有图`];
  if (doc.layers.length) parts.push(`${doc.layers.length} 层图层`);
  if (doc.blendLayers.length) parts.push(`混合页 ${doc.blendLayers.length} 层`);
  if (doc.adjustOps.length) parts.push(`${doc.adjustOps.length} 步调整`);
  return parts.join(' · ');
}
