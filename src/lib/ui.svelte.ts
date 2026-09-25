/**
 * 跨组件共享的界面状态（Svelte 5 runes 写在 .svelte.ts 里）。
 */
export const chrome = $state({
  title: '',
  subtitle: ''
});

export function setChrome(title: string, subtitle = '') {
  chrome.title = title;
  chrome.subtitle = subtitle;
}

/** 侧栏状态。Sidebar 读它决定长什么样，AppShell 读它让内容区平移。 */
export const rail = $state({
  /** 用户手动收起 */
  collapsed: false,
  /** 窗口太窄，自动收成图标带 */
  narrow: false
});

/** 要不要按"只剩图标"的样子显示 */
export function railMini() {
  return rail.collapsed || rail.narrow;
}

/** 外观设置面板开着没有。悬浮球和面板一个在壳里一个在布局里，所以放共享状态。 */
export const panel = $state({ open: false });

/**
 * 预览台的状态。
 *
 * `wide` 是"宽预览"：关掉侧栏那一列，让主区吃满窗口宽度。
 * 起因是用户的屏幕是 2560×1600 @150%，CSS 视口只有 1707×1067 ——
 * 按 `1fr + 21rem` 分完，预览台只剩约 940px，调色/调参时看不清效果。
 */
export const preview = $state({ wide: false });

/**
 * 从别处"丢到 ① 文本页去挑"的那一段。
 *
 * 批量那页扫出"看着像乱码但没自动改"的段时，没法在那一页里挑（挑候选要按段号来，
 * 而那一页只是一张只读列表）—— 所以给它一个入口：把段带过去、切到文本页、粘好。
 */
export const 待挑段 = $state({ text: '' });

/**
 * 全局出错通道。侧栏底部挂一条。
 *
 * 面板内部自己的失败还是走面板里的 `Note` —— 这条管的是"没有归属面板"的那种：
 * 从窗口外拖东西进来、拖到了不认识的文件、解码失败。那些发生在窗口层，
 * 没有一个模块能认领，不挂到这里就等于没发生（硬规矩：错误显示在侧边导航栏，不弹窗）。
 */
export const err = $state({ text: '' });

/**
 * 挂多久自己消失。
 *
 * 原来是**只设不清** —— `clearErr()` 定义了但全工程零调用，界面上也没有关闭按钮，
 * 于是拖错一个文件之后那条警告就一直挂在侧栏底部，把导航挤掉一块（用户报的就是这个）。
 * 现在三条路都能让它走：自己到点、点右边的叉、换页/换模块。
 */
const ERR_MS = 9000;

/**
 * 提示类（`Note`）的统一时限：**跟侧栏那条错误通道同一个 9 秒**（用户 2026-09-23 C9）。
 *
 * 只有"看一眼就知道"的提示才挂它；**需要用户拍板的确认一律不挂** ——
 * 那种自己消失等于替用户做了决定。
 */
export const 提示自动关毫秒 = ERR_MS;
let errTimer: ReturnType<typeof setTimeout> | null = null;

function 停表() {
  if (errTimer !== null) {
    clearTimeout(errTimer);
    errTimer = null;
  }
}

export function setErr(text: string) {
  err.text = text;
  停表();
  /* 空字符串是"清掉"，不用再排一次 */
  if (text) errTimer = setTimeout(() => setErr(''), ERR_MS);
}

export function clearErr() {
  停表();
  err.text = '';
}

/**
 * 开场这条线：幕布和主界面要**交接**，不能各演各的。
 *
 * 之前是各演各的 —— 幕布一上来就盖着，而主界面在它背后**已经把入场动画跑完了**，
 * 幕布撤掉的那一刻内容早定格了，看到的就是"啪一下换了个画面"。
 *
 * 现在内容等 `reveal`：幕布开始撤的那一下才进场，两边叠着完成交叉淡入。
 * `Intro.svelte` 负责置位（它知道自己的时间轴），`+layout.svelte` 负责消费。
 */
export const boot = $state({
  /** 首帧资源（字体 + 第一张壁纸）就绪了没有 */
  ready: false,
  /** 幕布开始撤了没有 */
  reveal: false
});
