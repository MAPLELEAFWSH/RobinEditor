<script lang="ts">
  /**
   * 一条曲线的编辑框。ikClut 的三个颜色通道各用一个。
   *
   * 横轴输入明度 0→1，纵轴输出 0→1。
   * 两端点的 x 锁死（0 和 1），中间的点只能在相邻两点之间挪 —— 不锁的话
   * 拖动会让控制点互相越过，曲线自交，求值时按排序取段就会跳。
   *
   * 拖动用 pointercapture，不用 window 监听：多个实例同时挂在页面上时，
   * window 监听分不清是谁在拖。
   */
  import { evalCurve, type CurvePoint, type CurveKind } from '$lib/img';
  import { 步长 } from '$lib/gradient';

  type Props = {
    points: CurvePoint[];
    kind?: CurveKind;
    /** 曲线颜色，直接用 CSS 色值 */
    color?: string;
    height?: number;
    label?: string;
    onchange: (pts: CurvePoint[]) => void;
  };

  let {
    points,
    kind = 'smooth',
    color = 'var(--primary)',
    height = 132,
    label = '',
    onchange
  }: Props = $props();

  /** SVG 内部坐标：0..100 见方 */
  const V = 100;
  const PAD = 6;

  let host: SVGSVGElement | null = $state(null);
  let dragIndex = $state<number | null>(null);

  const sorted = $derived([...points].sort((a, b) => a.x - b.x));

  /** 折线：按插值方式采样，step 那种才能画出台阶 */
  const path = $derived.by(() => {
    const N = 72;
    const parts: string[] = [];
    for (let i = 0; i <= N; i++) {
      const x = i / N;
      const y = evalCurve(sorted, x, kind);
      const px = PAD + x * (V - PAD * 2);
      const py = V - PAD - y * (V - PAD * 2);
      parts.push(`${i === 0 ? 'M' : 'L'}${px.toFixed(2)} ${py.toFixed(2)}`);
    }
    return parts.join(' ');
  });

  function toSvg(e: PointerEvent): { x: number; y: number } {
    const r = host!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * V;
    const y = ((e.clientY - r.top) / r.height) * V;
    return {
      x: Math.min(1, Math.max(0, (x - PAD) / (V - PAD * 2))),
      y: Math.min(1, Math.max(0, 1 - (y - PAD) / (V - PAD * 2)))
    };
  }

  function onDown(e: PointerEvent, i: number) {
    e.preventDefault();
    e.stopPropagation();
    dragIndex = i;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function onMove(e: PointerEvent) {
    if (dragIndex === null) return;
    e.preventDefault();
    const p = toSvg(e);
    const next = sorted.map((q) => ({ ...q }));
    const i = dragIndex;
    const isFirst = i === 0;
    const isLast = i === next.length - 1;
    next[i].y = p.y;
    if (!isFirst && !isLast) {
      // 夹在左右邻居之间，留一点余量免得两个点重合后拖不开
      const lo = next[i - 1].x + 0.004;
      const hi = next[i + 1].x - 0.004;
      next[i].x = Math.min(hi, Math.max(lo, p.x));
    }
    onchange(next);
  }

  function onUp(e: PointerEvent) {
    if (dragIndex === null) return;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    dragIndex = null;
  }

  /** 空白处双击加点 */
  function onBackdropDbl(e: MouseEvent) {
    const p = toSvg(e as unknown as PointerEvent);
    onchange([...sorted, { x: p.x, y: p.y }].sort((a, b) => a.x - b.x));
  }

  /** 点上双击删点。两端不给删，曲线至少要有两个点 */
  function removeAt(i: number) {
    if (sorted.length <= 2) return;
    if (i === 0 || i === sorted.length - 1) return;
    onchange(sorted.filter((_, k) => k !== i));
  }

  /**
   * 键盘也能调。方向上下改输出值，左右挪横坐标（端点锁死），
   * Delete / Backspace 删点。不光是给读屏用的 —— 鼠标精确定位到一个色阶很难。
   */
  function onKey(e: KeyboardEvent, i: number) {
    /* 步长统一 1/255、Shift ×10（原来这里是 0.005 / 0.05，跟另外两页不一样） */
    const step = 步长(e);
    const next = sorted.map((q) => ({ ...q }));
    const n = next.length;
    let handled = true;
    switch (e.key) {
      case 'ArrowUp':
        next[i].y = Math.min(1, next[i].y + step);
        break;
      case 'ArrowDown':
        next[i].y = Math.max(0, next[i].y - step);
        break;
      case 'ArrowLeft':
        if (i === 0 || i === n - 1) handled = false;
        else next[i].x = Math.max(next[i - 1].x + 0.004, next[i].x - step);
        break;
      case 'ArrowRight':
        if (i === 0 || i === n - 1) handled = false;
        else next[i].x = Math.min(next[i + 1].x - 0.004, next[i].x + step);
        break;
      case 'Delete':
      case 'Backspace':
        if (i === 0 || i === n - 1 || n <= 2) handled = false;
        else removeAt(i);
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      if (e.key !== 'Delete' && e.key !== 'Backspace') onchange(next);
    }
  }
</script>

<div class="cw">
  {#if label}
    <div class="cw__head">
      <span class="cw__dot" style="background:{color}"></span>
      <span class="cw__label">{label}</span>
      <span class="cw__n">{sorted.length} 点</span>
    </div>
  {/if}
  <svg
    bind:this={host}
    class="cw__svg"
    style="height:{height}px; --cw-color:{color}"
    viewBox="0 0 {V} {V}"
    preserveAspectRatio="none"
    role="img"
    aria-label="{label || '曲线'}编辑器"
    ondblclick={onBackdropDbl}
  >
    <!-- 底格 -->
    {#each [0.25, 0.5, 0.75] as g (g)}
      <line x1={PAD + g * (V - PAD * 2)} y1={PAD} x2={PAD + g * (V - PAD * 2)} y2={V - PAD}
        class="cw__grid" />
      <line x1={PAD} y1={PAD + g * (V - PAD * 2)} x2={V - PAD} y2={PAD + g * (V - PAD * 2)}
        class="cw__grid" />
    {/each}
    <line x1={PAD} y1={V - PAD} x2={V - PAD} y2={PAD} class="cw__diag" />

    <path d={path} class="cw__line" />

    {#each sorted as p, i (i)}
      <circle
        class="cw__pt"
        class:cw__pt--drag={dragIndex === i}
        cx={PAD + p.x * (V - PAD * 2)}
        cy={V - PAD - p.y * (V - PAD * 2)}
        r="3.4"
        role="slider"
        tabindex="0"
        aria-label="{label || '曲线'}第 {i + 1} 个控制点"
        aria-valuemin="0"
        aria-valuemax="1"
        aria-valuenow={+p.y.toFixed(3)}
        aria-valuetext="输入 {p.x.toFixed(2)} → 输出 {p.y.toFixed(2)}"
        onpointerdown={(e) => onDown(e, i)}
        onpointermove={onMove}
        onpointerup={onUp}
        onpointercancel={onUp}
        onkeydown={(e) => onKey(e, i)}
        ondblclick={(e) => {
          e.stopPropagation();
          removeAt(i);
        }}
      />
    {/each}
  </svg>
  <div class="cw__foot">
    <span>拖动改形 · 空白双击加点 · 点上双击删点 · 选中后方向键微调</span>
  </div>
</div>

<style>
  .cw { display: grid; gap: 5px; }
  .cw__head { display: flex; align-items: center; gap: 6px; font-size: var(--fs-2xs); }
  .cw__dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .cw__label { color: var(--deep-text); font-weight: 600; }
  .cw__n { margin-left: auto; color: var(--content-meta); }
  .cw__svg {
    width: 100%;
    display: block;
    background: var(--surface-2);
    border: 1px solid var(--line-divider);
    border-radius: var(--r-md);
    touch-action: none;
    cursor: crosshair;
  }
  .cw__grid { stroke: var(--line-divider); stroke-width: 0.6; }
  .cw__diag { stroke: var(--line-divider); stroke-width: 0.6; stroke-dasharray: 3 3; }
  .cw__line {
    fill: none;
    stroke: var(--cw-color);
    stroke-width: 2;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .cw__pt {
    fill: var(--card-bg);
    stroke: var(--cw-color);
    stroke-width: 2;
    cursor: grab;
    vector-effect: non-scaling-stroke;
  }
  .cw__pt--drag { cursor: grabbing; fill: var(--cw-color); }
  .cw__foot { font-size: 10px; color: var(--content-meta); }
  .cw__pt:focus-visible { outline: 2px solid var(--cw-color); outline-offset: 2px; }
</style>
