/**
 * 自动保存 —— 防"改了半天没存，一关就没了"。
 *
 * 两条规矩：**难撤的操作要留一个撤销点**，以及**别让用户白干**。
 * 这两条是同类工具的共同做法，本工程是照公开使用方式定的，没抄任何实现的代码或说明。
 *
 * 三条设计上的取舍：
 *
 * 1. **存 localStorage，不存文件。** 存文件得先有路径，而路径是原生对话框给的；
 *    自动保存不能每次都弹框问。localStorage 不用问路。代价是它只在同一台机器的同一个
 *    WebView 里有效 —— 足够覆盖"手滑关掉窗口"这个场景，覆盖不了"换台电脑"。
 * 2. **不静默恢复。** 一进来就把上次的东西铺上去，用户会懵（"这些图层我没建过啊"）。
 *    给一张提示条，写了是什么时候、有几层，让他自己点。
 * 3. **空状态不覆盖有内容的快照。** 否则"打开程序 → 什么都没干 → 关掉"会把上一份能救的东西冲掉。
 */

import type { ProjectDoc } from './project';
import { parseProject, serializeProject } from './project';
import type { Layer } from './modules/channels/ops';

export const AUTOSAVE_KEY = 'robin.autosave';
/** 上次写下去的签名，用来判断"跟这次是不是同一份" */
const SIG_KEY = `${AUTOSAVE_KEY}.sig`;
/** 两次写之间至少隔这么久。改一下就存会把 localStorage 写爆，也没意义 */
export const AUTOSAVE_MIN_GAP_MS = 4000;

/** 这份文档值不值得留。空的（没图层、没调整、没混合层）不值得 */
export function worthKeeping(doc: ProjectDoc): boolean {
  return doc.layers.length > 0 || doc.blendLayers.length > 0 || doc.adjustOps.length > 0;
}

/**
 * 键排序后序列化。这样签名的相等就是内容的相等，不依赖对象是怎么拼出来的
 * —— 界面上现拼的对象和从 `.redproj` 解析回来的对象，键序不一定一样。
 */
function canon(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const o = val as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
    }
    return val;
  });
}

/**
 * 图层除了 id 都算内容。
 *
 * id 是每次会话重发的把手 —— 恢复工程时 `reassignIds` 会整批换掉，
 * 算进签名里就会把"内容没变"读成"变了"。用展开而不是逐字段列，
 * 图省得以后 `Layer` 加字段时这里漏一个（那就又是"参数变了签名不变"）。
 */
function layerContent(l: Layer) {
  const { id: _id, ...rest } = l;
  return rest;
}

/**
 * 这份文档的内容签名。
 *
 * 原来只数图层数、调整数、混合层数，加槽位路径。于是拖不透明度、
 * 换混合模式、改蒙版曲线、改调整参数**都不改计数** —— 签名不变，
 * `shouldWrite` 说不写，自动保存恰好对它存在的意义不生效。
 *
 * 现在按内容比。刻意不算进来的四项：
 *
 * - `savedAt`：每次写都变，算进去就永远"有变化"，等于没有这道闸
 * - `panel`：那是"当前在看哪个分区"，切个标签页不算改了东西
 * - `magic` / `version`：常量
 * - 图层 id：见 `layerContent`
 */
export function signature(doc: ProjectDoc): string {
  return canon({
    slots: doc.slots,
    layers: doc.layers.map(layerContent),
    adjustOps: doc.adjustOps,
    adjustScope: doc.adjustScope,
    blendBase: doc.blendBase ? layerContent(doc.blendBase) : null,
    blendLayers: doc.blendLayers.map(layerContent)
  });
}

/**
 * 该不该把这份状态写下去。
 *
 * `lastAt` 是上次写的时间；`lastSig` 是上次写的签名。
 * 三条都过了才写：够久了、有内容、跟上次不一样。
 */
export function shouldWrite(
  doc: ProjectDoc,
  lastAt: number,
  lastSig: string,
  now: number,
  minGap = AUTOSAVE_MIN_GAP_MS
): boolean {
  if (!worthKeeping(doc)) return false;
  if (now - lastAt < minGap) return false;
  return signature(doc) !== lastSig;
}

/**
 * 写一份快照。
 *
 * 时间戳直接用 `doc.savedAt`（`buildProject` 会填），不另存一个键 ——
 * 两处存时间就一定会出现"两处不一致"的那天。
 * 只额外记一个签名，用来判断"跟上次是不是同一份"。
 */
export function writeSnapshot(doc: ProjectDoc, now = Date.now()): boolean {
  if (typeof localStorage === 'undefined') return false;
  if (!worthKeeping(doc)) return false;
  try {
    localStorage.setItem(AUTOSAVE_KEY, serializeProject({ ...doc, savedAt: now }));
    localStorage.setItem(SIG_KEY, signature(doc));
    return true;
  } catch {
    // 存不下就算了（隐私模式、配额满）。自动保存失败不该打断手上的活
    return false;
  }
}

export type Restorable =
  | { ok: true; doc: ProjectDoc; savedAt: number }
  | { ok: false; reason: string };

/**
 * 读回上次的快照。
 *
 * 走的是跟工程文件**同一套解析**（`parseProject`）—— 多一条解析路径就多一处会走偏的地方，
 * 而且这样老版本写下的快照也按同一套规则处理。
 */
export function readSnapshot(): Restorable {
  if (typeof localStorage === 'undefined') return { ok: false, reason: '这里没有 localStorage。' };
  const raw = localStorage.getItem(AUTOSAVE_KEY);
  if (!raw) return { ok: false, reason: '没有存过。' };
  const r = parseProject(raw);
  if (!r.ok) return { ok: false, reason: r.error };
  if (!worthKeeping(r.doc)) return { ok: false, reason: '上次那份是空的。' };
  return { ok: true, doc: r.doc, savedAt: r.doc.savedAt };
}

/** 用户自己存过工程之后调这个：不用再提"要不要恢复"了 */
export function markSaved(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
    localStorage.removeItem(SIG_KEY);
  } catch {
    /* 清不掉也没关系 */
  }
}

export function lastSavedSig(): string {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(SIG_KEY) ?? '';
}

/** 提示条上那句话：什么时候存的、里面有什么 */
export function describeSnapshot(doc: ProjectDoc, savedAt: number, now = Date.now()): string {
  const ago = (() => {
    if (!savedAt) return '';
    const d = Math.max(0, now - savedAt);
    if (d < 60_000) return '刚刚';
    if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`;
    if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`;
    return `${Math.floor(d / 86_400_000)} 天前`;
  })();
  const bits: string[] = [];
  if (doc.layers.length) bits.push(`${doc.layers.length} 层图层`);
  if (doc.blendLayers.length) bits.push(`混合页 ${doc.blendLayers.length} 层`);
  if (doc.adjustOps.length) bits.push(`${doc.adjustOps.length} 步调整`);
  const filled = doc.slots.filter((s) => !!s.path).length;
  return `${ago ? ago + ' ' : ''}自动存过一份：${bits.join('、') || '没改什么'}，${filled} 个槽位有图。`;
}
