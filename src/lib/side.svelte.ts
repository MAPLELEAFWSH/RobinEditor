/**
 * 工作区「参数」抽屉的状态（规范 §十一，**它否掉了 §八 的"收窄/可收起"**）。
 *
 * 用户原话：**"别死都护着右栏了，占空间还不承认"**。
 * → 答案不是"更窄的右栏"，也不是"可收起的右栏"，而是：
 *
 *   · **中区＝整幅**：除了侧边导航，**没有别的列在吃宽度**；
 *   · **参数＝浮层抽屉**：从右侧滑出、**盖在中区之上**、**默认收起**（收起＝完全不占地方），宽度 ≤ 18rem；
 *   · **想边看预览边调** → 用户自己点「钉住」才占宽（≤18rem），**默认不钉**。
 *
 * **收起状态按页记**（2026-09-23）：键是这一页的路由（`tools/migrate` 这种）。
 * 原来只存一个全局的 `open`，**任一页点「收起」会把别的页一起关掉**（用户实测就是这么撞上的：
 * ⑥ 一收起，⑦ 那一页的参数也跟着没了）。宽度与「钉住」仍是全局的 ——
 * 那是版面偏好，各页保持一致才不会一切页就跳。
 *
 * 存法跟 `mstoon/params.svelte.ts` 一样：**自己管一个 localStorage 键**（不塞进全局 `prefs`，
 * 免得"重置外观"顺手把版面改了）。localStorage 里读出来的东西不可信 → 一律 `clampW`。
 */
const KEY = 'robin.wb.side.v3';

/** 抽屉宽度：12rem–**18rem**（§十一 写死 ≤18rem，所以上限比 §八 的 28rem 小） */
export const SIDE_MIN = 192;
export const SIDE_MAX = 288;
export const SIDE_DEF = 288;

export function clampW(px: number) {
  if (!Number.isFinite(px)) return SIDE_DEF;
  return Math.min(SIDE_MAX, Math.max(SIDE_MIN, Math.round(px)));
}

type 存的样子 = { w: number; pin: boolean; open: Record<string, boolean> };

function 读(): 存的样子 {
  const 默认: 存的样子 = { w: SIDE_DEF, pin: false, open: {} };
  if (typeof localStorage === 'undefined') return 默认;
  try {
    const 生 = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<存的样子>;
    const open: Record<string, boolean> = {};
    if (生.open && typeof 生.open === 'object') {
      for (const [k, v] of Object.entries(生.open)) if (v === true) open[k] = true;
    }
    return { w: clampW(Number(生.w ?? SIDE_DEF)), pin: 生.pin === true, open };
  } catch {
    return 默认;
  }
}

const 存表 = 读();

/** 当前页的键（路由壳切页时设）。空 = 还没进任何一页，一律按"收起"算 */
let 当前键 = '';

/** `open` = 抽屉滑出来没有；`pin` = 占住宽度（默认不钉） */
export const side = $state({ w: 存表.w, open: false, pin: 存表.pin });

/**
 * 这一页画了参数抽屉没有（DOM 里有没有 `.wb__side`）。
 *
 * **路由壳探到就置真**（组件是懒加载的，挂上之后再探几次），离开这一页清掉。
 * 右下角那颗「参数」按它出不出 —— 用户 2026-09-23 定的：那颗按钮**挪到应用右下角**，
 * 跟「外观」那颗同槽同层，不再跟页面自己的头一行抢位置（原来在 `.head__acts` 里，
 * 跟分区条、标签那些挤在一层）。
 */
export const 抽屉 = $state({ 有: false });

function 存() {
  if (typeof localStorage === 'undefined') return;
  try {
    if (当前键) 存表.open[当前键] = side.open;
    localStorage.setItem(KEY, JSON.stringify({ w: side.w, pin: side.pin, open: 存表.open }));
  } catch {
    /* 存不下就算了：版面还能用，只是下次打开回默认 */
  }
}

/** 把状态落到 <html> 上：`--side-w` 给宽度，`.side-open` 给滑出，`.side-pin` 给"占住宽度" */
export function applySide() {
  if (typeof document === 'undefined') return;
  const r = document.documentElement;
  r.style.setProperty('--side-w', `${clampW(side.w)}px`);
  r.classList.toggle('side-open', side.open);
  r.classList.toggle('side-pin', side.pin);
}

/**
 * 切页：把**这一页自己**的收起状态读出来套上（路由壳一处调用，各页不必自己管）。
 * 换页本身不改记忆，所以这里不 `存()`。
 */
export function 设页键(k: string) {
  if (!k || k === 当前键) return;
  当前键 = k;
  /* 钉住 = 抽屉必须开着（不然"占宽"和"看不见"会打架） */
  side.open = side.pin || 存表.open[k] === true;
  applySide();
}

export function 开抽屉(开: boolean) {
  side.open = 开;
  if (!开) side.pin = false; /* 收起时不可能还钉着 */
  applySide();
  存();
}

export function 切钉() {
  side.pin = !side.pin;
  if (side.pin) side.open = true;
  applySide();
  存();
}

export function setSideW(px: number) {
  side.w = clampW(px);
  applySide();
  存();
}

/** 拖把手：往左拖 = 变宽（把手在抽屉左边缘） */
export function 拖把手(ev: PointerEvent) {
  ev.preventDefault();
  const 目标 = ev.currentTarget as HTMLElement | null;
  const 起点x = ev.clientX;
  const 起点w = side.w;
  目标?.classList.add('is-drag');
  const 动 = (e: PointerEvent) => setSideW(起点w - (e.clientX - 起点x));
  const 完 = () => {
    目标?.classList.remove('is-drag');
    window.removeEventListener('pointermove', 动);
    window.removeEventListener('pointerup', 完);
    存();
  };
  window.addEventListener('pointermove', 动);
  window.addEventListener('pointerup', 完);
}
