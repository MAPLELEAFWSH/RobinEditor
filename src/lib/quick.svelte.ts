/**
 * 快捷动作。
 *
 * 两条来源：
 *
 * 1. **功能页 + 分区** —— 直接从模块注册表派生。每个「模块 · 分区」就是一个动作，
 *    加新模块不用回这个文件登记。这是大头：常用的是"直接跳到 ⑦ 的批量提取"，
 *    而不是"打开 ⑦ 再点第二个标签"。
 * 2. **应用级** —— 切深浅色、换主题色、折侧栏、开设置。这几件不走功能页。
 *
 * 固定哪些存 localStorage。没固定过就给一组默认，免得第一次进来是一片空白。
 */

import { GROUPS, MODULES, moduleTitle } from './modules/registry';

const KEY = 'robin.quick';

export type Action = {
  id: string;
  name: string;
  /** 小字，说明这个是干什么的 */
  hint: string;
  /** 归在哪一栏，列表里分组用 */
  group: string;
  /** 跳功能页 */
  href?: string;
  /** 不走路由、直接执行 */
  run?: () => void | Promise<void>;
};

/** 没固定过时先摆这几个。挑的都是七项功能里最常单独用的 */
const DEFAULT_PINNED = [
  'channels/pipeline',
  'channels/extract',
  'ilm/pack',
  'glitch/batch',
  'app.theme'
];

/* ------------------------------------------------------------ 动作表 */

function fromModules(): Action[] {
  const out: Action[] = [];
  for (const m of MODULES) {
    const panels = m.panels?.filter((p) => p.load) ?? [];
    if (!panels.length) {
      // 没有分区的（总览、最近工程）就直接跳过去
      out.push({
        id: m.id,
        name: moduleTitle(m),
        hint: m.desc,
        group: m.group,
        href: `/tools/${m.id}`
      });
      continue;
    }
    for (const p of panels) {
      out.push({
        id: `${m.id}/${p.id}`,
        name: `${moduleTitle(m)} · ${p.label}`,
        hint: p.hint ?? m.desc,
        group: m.group,
        href: `/tools/${m.id}?panel=${p.id}`
      });
    }
  }
  return out;
}

/**
 * 应用级那几个。
 *
 * 用动态 import 而不是顶层 import：这里会连带把 prefs 拉进来，
 * 顶上就地引会让环更绕。反正它们是点了才用的。
 */
const APP_ACTIONS: Action[] = [
  {
    id: 'app.theme',
    name: '深浅色切换',
    hint: '在浅色和深色之间切一下',
    group: 'app',
    run: async () => {
      const { prefs, apply } = await import('./prefs.svelte');
      prefs.theme = prefs.theme === 'light' ? 'dark' : 'light';
      apply();
    }
  },
  {
    id: 'app.hue',
    name: '换主题色',
    hint: '整站颜色跟着一个色相走，换一个',
    group: 'app',
    run: async () => {
      const { prefs, apply } = await import('./prefs.svelte');
      prefs.hue = (prefs.hue + 43) % 360;
      apply();
    }
  },
  {
    id: 'app.rail',
    name: '收起 / 展开侧栏',
    hint: '给内容区腾地方',
    group: 'app',
    run: async () => {
      const { prefs, apply } = await import('./prefs.svelte');
      prefs.collapsed = !prefs.collapsed;
      apply();
    }
  },
  {
    id: 'app.settings',
    name: '打开设置',
    hint: '主题色、壁纸、各层不透明度、动效档位',
    group: 'app',
    href: '/settings'
  }
];

/**
 * 动作表。**惰性算的，不能写成顶层常量。**
 *
 * 这里引注册表拿分组和模块名，而注册表又引 `Quick.svelte`，那玩意儿引本文件 ——
 * 三条连成一个环。ES 模块遇环会在"还没求值完"的状态下把绑定交出去，
 * 顶层就 `fromModules()` 的话读到的是 undefined。放到第一次调用时再算就没事。
 */
let cache: Action[] | null = null;

export function allActions(): Action[] {
  if (!cache) cache = [...fromModules(), ...APP_ACTIONS];
  return cache;
}

export function actionById(id: string): Action | undefined {
  return allActions().find((a) => a.id === id);
}

export function groupName(g: string): string {
  return GROUPS.find((x) => x.id === g)?.label ?? '其它';
}

/* ------------------------------------------------------------ 固定 */

/**
 * 存过的固定列表过一遍。**纯函数**，Node 里可测。
 *
 * 两件事：不是字符串的丢掉，指向已经不存在的动作的也丢掉 ——
 * 模块改名或删掉之后，留个点不动的空按钮比少一个按钮更糟。
 */
export function sanitizePinned(raw: unknown, known: (id: string) => boolean): string[] | null {
  if (raw === null || raw === undefined) return null; // 区分"没存过"和"存了个空列表"
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of raw) {
    if (typeof id !== 'string' || !id) continue;
    if (seen.has(id)) continue;
    if (!known(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function load(): string[] {
  const known = (id: string) => !!actionById(id);
  const fallback = () => DEFAULT_PINNED.filter(known);
  if (typeof localStorage === 'undefined') return fallback();
  try {
    const raw = localStorage.getItem(KEY);
    const s = sanitizePinned(raw === null ? null : JSON.parse(raw), known);
    return s ?? fallback();
  } catch {
    return fallback();
  }
}

/**
 * 固定列表。
 *
 * **初值故意是空的，真值靠 `ensurePinnedLoaded()` 补。**
 *
 * 为什么要这么绕：读 localStorage 之前要先把存过的 id 拿动作表核一遍，
 * 而动作表来自注册表（`GROUPS` / `MODULES`），注册表又引 `Quick.svelte`、
 * `Quick.svelte` 引本文件 —— 三条连成一个环。顶层就地 `load()` 的话，
 * 轮到本文件求值时注册表还没求值完，`MODULES` 在暂时性死区里，直接
 * `Cannot access 'MODULES' before initialization`。
 *
 * `Quick.svelte` 在**实例化时**（不是模块求值时）调一次这个函数，
 * 那时候所有模块都求值完了。顺序上不会出岔子。
 */
export const pinned = $state<string[]>([]);

let loaded = false;

export function ensurePinnedLoaded(): void {
  if (loaded) return;
  loaded = true;
  pinned.push(...load());
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(pinned));
  } catch {
    /* 隐私模式写不了就算了 */
  }
}

/**
 * 读的函数**不**顺手补初值 —— Svelte 5 里在 `$derived` 求值过程中改状态会报
 * `state_unsafe_mutation`。`Quick.svelte` 在实例化时就调过 `ensurePinnedLoaded()`，
 * 所以读的时候一定已经装好了。写的函数留着守卫，图个自愈。
 */
export function isPinned(id: string): boolean {
  return pinned.includes(id);
}

export function pin(id: string): void {
  ensurePinnedLoaded();
  if (!actionById(id) || pinned.includes(id)) return;
  pinned.push(id);
  save();
}

export function unpin(id: string): void {
  ensurePinnedLoaded();
  const i = pinned.indexOf(id);
  if (i >= 0) {
    pinned.splice(i, 1);
    save();
  }
}

export function togglePin(id: string): void {
  ensurePinnedLoaded();
  isPinned(id) ? unpin(id) : pin(id);
}

/** 往后挪一格 / 往前挪一格，把常用的排到前面 */
export function move(id: string, delta: number): void {
  ensurePinnedLoaded();
  const i = pinned.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= pinned.length) return;
  const [x] = pinned.splice(i, 1);
  pinned.splice(j, 0, x);
  save();
}

export function resetPinned(): void {
  ensurePinnedLoaded();
  pinned.length = 0;
  pinned.push(...DEFAULT_PINNED.filter((id) => actionById(id)));
  save();
}

/** 固定列表按固定顺序映射成动作对象 */
export function pinnedActions(): Action[] {
  return pinned.map((id) => actionById(id)).filter((a): a is Action => !!a);
}
