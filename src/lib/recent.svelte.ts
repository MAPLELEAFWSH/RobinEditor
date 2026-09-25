/**
 * 最近工程。
 *
 * 记的是"你选过的目录 + 当时在干什么"，不是"打开过的文件"。
 * 为什么带上"当时在干什么"：同一个模型目录会被反复用在不同功能上
 * （先跑批量提取，再去做 ILM 打包），只记路径的话点回去还得自己找分区。
 * 所以每条记一个 `label` + `href`，「接着做」就能回到原来那个分区。
 *
 * 存 localStorage。工程路径是本地信息，不上传任何地方。
 */

import { isTauri, probeDir, setFolderRecorder } from './io';

const KEY = 'robin.recent';
/** 留多少条。再多就没人翻了，也省得 localStorage 越写越大 */
const CAP = 24;

export type RecentEntry = {
  /** 目录全路径 */
  path: string;
  /** 末段名字，列表上显示这个 */
  name: string;
  /** 当时在干什么，比如「批量提取」 */
  label: string;
  /** 点「接着做」回到哪，比如 /tools/channels?panel=pipeline */
  href: string;
  /** 最后一次用的时间戳 */
  at: number;
  /** 用过几次 */
  used: number;
};

function nameOf(path: string): string {
  const s = path.replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
  return i >= 0 ? s.slice(i + 1) : s;
}

/**
 * 往列表里插一条。**纯函数**，好让它在 Node 里单测 —— 去重、保旧字段、
 * 截断这几件事一旦错了界面上看不出来（重复的条目看着也像正常的）。
 *
 * 同目录只留一条，最新的放最前面；`used` 累加。
 * `label` / `href` 用新值覆盖旧值：最近一次在干什么才是"接着做"该回的地方。
 */
export function upsert(list: RecentEntry[], path: string, label: string, href: string, now: number): RecentEntry[] {
  if (!path) return list;
  const i = list.findIndex((e) => e.path === path);
  const rest = i >= 0 ? [...list.slice(0, i), ...list.slice(i + 1)] : [...list];
  const old = i >= 0 ? list[i] : null;
  const head: RecentEntry = {
    path,
    name: nameOf(path) || old?.name || path,
    label: label || old?.label || '',
    href: href || old?.href || '',
    at: now,
    used: (old?.used ?? 0) + 1
  };
  const out = [head, ...rest];
  if (out.length > CAP) out.length = CAP;
  return out;
}

/** localStorage 里读出来的东西不可信，过一遍保证每条都能用 */
export function sanitize(raw: unknown): RecentEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => e && typeof e.path === 'string' && e.path)
    .map((e) => ({
      path: e.path,
      name: typeof e.name === 'string' && e.name ? e.name : nameOf(e.path),
      label: typeof e.label === 'string' ? e.label : '',
      href: typeof e.href === 'string' ? e.href : '',
      at: typeof e.at === 'number' ? e.at : 0,
      used: typeof e.used === 'number' && e.used > 0 ? e.used : 1
    }))
    .slice(0, CAP);
}

function load(): RecentEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) || '[]'));
  } catch {
    return [];
  }
}

export const recent = $state<RecentEntry[]>(load());

/**
 * **当前工程**。顶栏那颗点按它显示。
 *
 * 用户 2026-09-26 报的："打开工程了上方还显示未打开工程" —— 顶栏那段原来是写死的
 * 四个字（`AppShell.svelte` 里直接 `<span class="bar__dot"></span>未打开工程`），
 * 没有任何一处状态接上去，所以选了目录它也不会变。
 *
 * 什么时候算"打开了工程"：**`remember()` 只在"选工程目录"那条路上被调**
 * （导出目录走的是 `pickFolder()`，它不记，见 `io.ts` 里 `setFolderRecorder` 的注释）。
 * 所以 `remember` 就是"刚开过谁"，在这里顺手把当前工程也设上。
 *
 * 起头从 `recent[0]` 取：刷新页面之后顶栏不该假装"什么都没开"——
 * 最近开过的那个目录就是手上这个工程的来路。
 */
export const 当前工程 = $state<{ path: string; name: string }>(
  recent[0] ? { path: recent[0].path, name: recent[0].name } : { path: '', name: '' }
);

/** 有没有工程在手（顶栏那颗点看它）。`$state` 用 `const` 声明不能再整个赋值，所以改字段 */
export function 设当前工程(path: string, name?: string): void {
  if (!path) {
    当前工程.path = '';
    当前工程.name = '';
    return;
  }
  当前工程.path = path;
  当前工程.name = name || nameOf(path) || path;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(recent));
  } catch {
    /* 隐私模式写不了就算了 */
  }
}

/** 记一次。同目录只留一条，更新到最前面。**顺手把「当前工程」也设上**（顶栏那颗点看它） */
export function remember(path: string, label = '', href = ''): void {
  const next = upsert(recent, path, label, href, Date.now());
  recent.length = 0;
  recent.push(...next);
  设当前工程(path);
  save();
}

/** 工程不是目录那种（⑨ 是选 `.pmm` / `.emm` 两个文件）：模块自己报一下名字 */
export function 报当前工程(path: string, name?: string): void {
  设当前工程(path, name);
}

/** 手动改一下这条在干什么（模块没传 label 时补上） */
export function retag(path: string, label: string, href: string): void {
  const e = recent.find((x) => x.path === path);
  if (!e) return;
  e.label = label;
  e.href = href;
  e.at = Date.now();
  save();
}

export function forget(path: string): void {
  const i = recent.findIndex((e) => e.path === path);
  if (i >= 0) {
    recent.splice(i, 1);
    if (当前工程.path === path) 设当前工程(recent[0] ? recent[0].path : '', recent[0] ? recent[0].name : '');
    save();
  }
}

export function clearAll(): void {
  recent.length = 0;
  设当前工程('');
  save();
}

/**
 * 目录还在不在。不存在的可以标灰，免得点进去才发现盘拔了。
 *
 * 只在桌面端查 —— 浏览器里 `probe_dir` 一律报 exists:false，
 * 拿它判断会把每条都标成"没了"，那是假的。
 */
export async function exists(path: string): Promise<boolean> {
  try {
    if (!isTauri()) return true;
    const r = await probeDir(path);
    return r.exists;
  } catch {
    return true; // 查不了就当它在，别误报
  }
}

/* ------------------------------------------------------------ 挂上钩子 */

// 选目录的地方只认 `io.ts` 里那个回调，不认识这个模块（见 io.ts 里
// setFolderRecorder 的注释）。谁想记最近工程，谁在这里把自己挂上去。
setFolderRecorder((path, label, href) => remember(path, label, href));

export function relTime(at: number): string {
  if (!at) return '';
  const d = Date.now() - at;
  if (d < 60_000) return '刚刚';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`;
  if (d < 30 * 86_400_000) return `${Math.floor(d / 86_400_000)} 天前`;
  const dt = new Date(at);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
