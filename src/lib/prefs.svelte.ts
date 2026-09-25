/**
 * 可调参数。面板只往 :root 写 CSS 变量，长什么样由 tokens.css 决定，
 * 别在 JS 里拼样式。
 */

import type { BgFit, BgMode, BgScope } from './bg';
import type { 引擎种类 } from './translate';

const KEY = 'robin.prefs';

export type MotionLevel = 'off' | 'lite' | 'full';

/** 毛玻璃档位。full 是真 backdrop-filter，lite 只用半透明底，不吃光栅化 */
export type GlassLevel = 'full' | 'lite' | 'off';

export type Prefs = {
  hue: number;
  theme: 'light' | 'dark';
  bgMode: BgMode;
  /** work 只铺内容区，full 铺满整窗 */
  bgScope: BgScope;
  /** 适应方式 */
  bgFit: BgFit;
  /** 裁切时保住哪一块，'center center' 这种写法 */
  bgPos: string;
  bg: string;
  /** 轮放间隔，秒 */
  bgEvery: number;
  bgOpacity: number;
  /** 各层不透明度 0–100。卡片、侧栏、顶栏、尾栏、设置面板 */
  cardOpacity: number;
  sideOpacity: number;
  barOpacity: number;
  sbOpacity: number;
  panelOpacity: number;
  cardBorder: boolean;
  /** 全屏图上的 blur 会让这层多走一遍光栅化，默认关 */
  soften: boolean;
  motion: MotionLevel;
  glass: GlassLevel;
  fpsLive: boolean;
  collapsed: boolean;
  /** 从壁纸列表里藏起来的 id。内置的删不掉文件，只能藏，随时能放回来 */
  hiddenBgs: string[];
  /** 壁纸的显示顺序。表里没有的接在末尾 */
  bgOrder: string[];
  /**
   * ① 的翻译引擎。
   *
   * 三种：`mymemory`（**默认**，免费公开、无需 Key，有每日额度）、
   * `custom`（OpenAI 兼容，要地址+模型名）、`off`（离线，只做术语替换、一次请求都不发）。
   * 旧记录里没有 `kind` 字段，一律按 `off` 处理（不替用户偷偷联网）。
   * Key 只存在本机这份偏好里，不上传、不写进任何产出。
   */
  engine: { kind: 引擎种类; baseUrl: string; model: string; apiKey: string; timeoutMs: number };
};

export const DEFAULTS: Prefs = {
  hue: 230,
  theme: 'light',
  bgMode: 'carousel',
  bgScope: 'work',
  bgFit: 'cover',
  bgPos: 'center center',
  bg: 'wp-01',
  bgEvery: 15,
  /* 0.9 配 bg-meta 里那层薄遮罩，壁纸实际可见度落在 0.79–0.85。
     之前 0.8 配厚遮罩只剩 0.53，壁纸基本被洗白了。 */
  bgOpacity: 90,
  /* 卡片默认 92；四周的框架默认实色，想要通透再自己拉 */
  cardOpacity: 92,
  sideOpacity: 100,
  barOpacity: 100,
  sbOpacity: 100,
  panelOpacity: 98,
  cardBorder: true,
  soften: false,
  motion: 'full',
  glass: 'lite',
  fpsLive: true,
  collapsed: false,
  hiddenBgs: [],
  bgOrder: [],
  engine: { kind: 'mymemory', baseUrl: '', model: '', apiKey: '', timeoutMs: 30000 }
};

function load(): Prefs {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const 存 = JSON.parse(localStorage.getItem(KEY) || '{}');
    /* engine 是嵌套的：浅合并会把缺字段的旧记录整块盖掉，所以单独合一层 */
    const 存引擎 = 存?.engine as Partial<Prefs['engine']> | undefined;
    const engine = { ...DEFAULTS.engine, ...(存引擎 ?? {}) };
    /* 旧记录没有 kind：填过自定义引擎的接着用自定义，没填过的按"离线" ——
       升级之后不许替用户偷偷联网 */
    if (存引擎 && !存引擎.kind) {
      engine.kind =
        engine.baseUrl.trim().length > 0 && engine.model.trim().length > 0 ? 'custom' : 'off';
    }
    return { ...DEFAULTS, ...存, engine };
  } catch {
    return { ...DEFAULTS };
  }
}

export const prefs = $state<Prefs>(load());

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...prefs }));
  } catch {
    /* 隐私模式写不了就算了 */
  }
}

export function reset() {
  /* engine 要拷一份：直接 Object.assign 会让 prefs.engine 和 DEFAULTS.engine 变成同一个对象，
     之后改引擎配置等于改默认值 */
  Object.assign(prefs, DEFAULTS, { engine: { ...DEFAULTS.engine } });
  apply();
}

export function apply() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  root.setAttribute('data-theme', prefs.theme);
  root.setAttribute('data-motion', prefs.motion);
  /* 背景范围和毛玻璃挂成属性，让 CSS 自己分支 */
  root.setAttribute('data-bg-scope', prefs.bgScope);
  root.setAttribute('data-glass', prefs.glass);

  root.style.setProperty('--hue', String(prefs.hue));
  root.style.setProperty('--cover-veil', String(prefs.bgOpacity / 100));
  root.style.setProperty('--wp-pos', prefs.bgPos);

  /* 各层 alpha。颜色本身在 tokens.css 里，这里只给不透明度，
     所有用 --card-bg / --side-bg / --bar-bg / --sb-bg / --sheet-bg 的面
     都会跟着动 —— 一个滑杆能调整个界面。 */
  root.style.setProperty('--a-card', String(prefs.cardOpacity / 100));
  root.style.setProperty('--a-side', String(prefs.sideOpacity / 100));
  root.style.setProperty('--a-bar', String(prefs.barOpacity / 100));
  root.style.setProperty('--a-sb', String(prefs.sbOpacity / 100));
  root.style.setProperty('--a-panel', String(prefs.panelOpacity / 100));

  root.style.setProperty('--card-border-width', prefs.cardBorder ? '0.67px' : '0px');
  root.style.setProperty('--cover-soften', prefs.soften ? '6px' : '0px');

  save();
}

/**
 * 本机**存过偏好没有**。这个事实必须在**模块求值那一刻**就定下来。
 *
 * 为什么不能等到 `initFromSystem()` 里去问 localStorage：
 * 子组件的 `$effect` 排在 `+layout` 的 `onMount` 之前跑，`AppShell` 里那条
 * `apply()` 一跑就把偏好写盘了 —— 等在 onMount 里再问，答案永远是"存过"，
 * 于是整个"头一次进来跟着系统走"的逻辑等于不存在。
 * 真机上就是这么验出来的：用 2 核 + 清空偏好跑，低配档没生效（dev 下顺带发现
 * 首次跟随系统主题那条也一直没生效过）。
 */
const FRESH = typeof localStorage !== 'undefined' && !localStorage.getItem(KEY);
let inited = false;

/** 头一次进来，没存过就跟着系统走 */
export function initFromSystem() {
  if (typeof localStorage === 'undefined' || inited) return;
  inited = true;
  if (!FRESH) return;
  if (matchMedia('(prefers-color-scheme: dark)').matches) prefs.theme = 'dark';
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) prefs.motion = 'lite';
  /* 机器看着不大就先按低配起 —— 装完第一眼就是顺的，比先卡给人看再让他自己找开关强 */
  if (looksSmall()) {
    Object.assign(prefs, LOW_SPEC);
    autoLowSpec.used = true;
  }
  apply();
}

/* ============================================================
   低配档
   ============================================================ */

/**
 * 低配档要拨的几项。都是**能再单独调回来**的普通参数，不是锁死的模式：
 *   动效轻   —— 少跑几段动画
 *   毛玻璃关 —— 不挂 backdrop-filter（核显上这是最大的一笔）
 *   背景纯代码 —— 不加载不解码整屏壁纸，也没有 15 秒一次的交叉淡入
 *   壁纸柔化关 —— 全屏 filter 会让那一层多走一遍光栅化
 *   尾栏帧率关 —— 关掉那条常驻的逐帧采样
 */
export const LOW_SPEC: Partial<Prefs> = {
  motion: 'lite',
  glass: 'off',
  bgMode: 'native',
  soften: false,
  fpsLive: false
};

/** 这次是自动按低配起的吗（面板里据此说一句话，别让用户猜为什么没壁纸）。
    用 $state：它是在 onMount 里写的，而面板比它先挂载 —— 普通对象的话那一句永远不显示 */
export const autoLowSpec = $state({ used: false });

/** 一键低配 */
export function lowSpec() {
  Object.assign(prefs, LOW_SPEC);
  apply();
}

/** 机器看着怎么样。拿得到就报出来，拿不到（老 webview）就给 0 */
export function machineHint() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    cores: navigator.hardwareConcurrency || 0,
    /** GB，只有 Chromium 有 */
    mem: nav.deviceMemory ?? 0
  };
}

/** 核少或者内存档位小 —— 就按低配起。两个都拿不到时不猜，走默认档 */
export function looksSmall() {
  const { cores, mem } = machineHint();
  return (cores > 0 && cores <= 4) || (mem > 0 && mem <= 4);
}
