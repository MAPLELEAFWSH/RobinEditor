/**
 * 主题切换。
 *
 * 走过三段弯路，记在这儿免得再来一遍：
 *
 * 1. 最早用 View Transitions 的圆擦除，点下去有**肉眼可见的延迟** ——
 *    `startViewTransition` 要先把整页栅格化（1707×876、dpr 1.5 ≈ 2560×1314 一张位图），
 *    再等 `ready` 里新主题渲染完，然后才开始 450ms 的圆。点下去到画面动隔着两段等待，
 *    手感就是"卡了一下"。
 * 2. 于是改成"立即切"，动画只留在图标上。但那留下另一个毛病：一次换主题里
 *    一半元件的 background 是瞬间变、另一半还挂着 0.2s 过渡，看着"部件速度不一样"。
 * 3. 又改成整页交叉淡入。能用，但手感是"整片一起化过去"。
 *
 * 现在按参考项目（`元素手账\网页版`）那种做法回到**圆擦除**，只是接在已经渲染好的
 * 那一层上：`apply()` 仍然同步改完属性（不拖），圆只负责把新主题"擦出来"。
 * 圆心取**按下去那个按钮自己的位置**（调用方把坐标传进来），跟参考那套一致；
 * 拿不到坐标就退回整页中心。
 *
 * 动效关掉 / 系统要求减少动效：直接切，不假装有动画。
 */
import { prefs, apply } from './prefs.svelte';

/** 转场期间挂在 <html> 上的标记。伪元素那两条规则只认它 */
const VT_ATTR = 'data-theme-vt';

export type Origin = { x: number; y: number };

function motionOff(): boolean {
  if (prefs.motion === 'off') return true;
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return true;
  }
  return false;
}

/** 从某点扩到能盖住整个视口要多大半径（取到最远那个角） */
function radiusFor(o: Origin): number {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return Math.hypot(Math.max(o.x, w - o.x), Math.max(o.y, h - o.y));
}

/** 从元素中心取一个圆心 */
export function originOf(el: Element | null | undefined): Origin | undefined {
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return undefined;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * 换主题。
 *
 * 颜色在 `update()` 里同步改完，新的那层用 `clip-path` 的圆擦出来。
 * 不支持 View Transitions（或动效关了）就退回立即切。
 */
function switchTo(next: 'light' | 'dark', origin?: Origin) {
  if (prefs.theme === next) return;
  const run = () => {
    prefs.theme = next;
    apply();
  };

  const doc = document as Document & { startViewTransition?: (cb: () => unknown) => unknown };
  if (motionOff() || typeof doc.startViewTransition !== 'function') {
    run();
    return;
  }

  const root = document.documentElement;
  const o = origin && typeof root.animate === 'function' ? origin : undefined;
  /* 属性值分两种玩法（见 tokens.css 那段）：
     有圆心走 "wipe"（只擦，不叠淡），没圆心走 ""（整页交叉淡入）。 */
  root.setAttribute(VT_ATTR, o ? 'wipe' : '');
  const vt = doc.startViewTransition(async () => {
    run();
    /* `apply()` 是同步的，值当场就落下去了，这里只需要让回调在下一个微任务结算。
       **别在这里 await 双 requestAnimationFrame** —— 实测那样会把整个转场挂死
       （`finished` 永远 pending，`data-theme-vt` 也就永远删不掉，页面一直挂着那一层）。
       三种写法在真机上量过：同步回调 resolved；只等一个微任务 resolved；
       双 rAF pending。 */
    await Promise.resolve();
  }) as { finished?: Promise<void>; ready?: Promise<void> };

  const done = () => root.removeAttribute(VT_ATTR);

  /* 圆擦除：只动 `::view-transition-new(root)` 那一层的 clip-path。
     它在合成器上跑，比"给上百个元件各加 transition"便宜一个量级。
     圆心没有就先不擦（宁可不擦，也别从角落里莫名其妙地扩）。 */
  if (o && vt?.ready) {
    const r = radiusFor(o);
    const ms = Number(getComputedStyle(root).getPropertyValue('--t-theme').replace('ms', '').trim()) || 460;
    vt.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${o.x}px ${o.y}px)`, `circle(${r}px at ${o.x}px ${o.y}px)`] },
          {
            duration: ms,
            /* 两端缓：圆从中心扩出去先慢后快再收住，比线性像"擦" */
            easing: 'cubic-bezier(0.33, 0, 0.67, 1)',
            pseudoElement: '::view-transition-new(root)'
          }
        );
      })
      .catch(() => {});
  }

  if (vt?.finished) vt.finished.finally(done);
  else done();
}

export function toggleTheme(origin?: Origin) {
  switchTo(prefs.theme === 'light' ? 'dark' : 'light', origin);
}

export function setTheme(next: 'light' | 'dark', origin?: Origin) {
  switchTo(next, origin);
}
