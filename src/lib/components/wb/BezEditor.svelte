<script lang="ts">
  /**
   * 贝塞尔曲线编辑器 —— 对应 Blender 的 RGB Curves 节点。
   *
   * 跟别处那个"整条曲线选一种插值"的编辑器不是一个东西：
   * 这里每个控制点自带左右手柄，段与段靠手柄接。
   *
   * 操作照 Blender 来：
   *   · 拖圆点移动控制点
   *   · 拖小手柄改切线（手柄模式是"自动/矢量"时改不动，会提示先切成自由）
   *   · 双击圆点切换手柄模式：自动 → 矢量 → 自由 → 自动
   *   · 空白处双击加一点
   *   · 选中点后按 Delete 删掉（首末两点不能删）
   *   · 方向键微调，Shift 加大步长
   *
   * 手柄模式说明见 $lib/bezier.ts 的 HANDLE_HINT。
   */
  import {
    type BezPoint,
    type Clip,
    type HandleMode,
    HANDLE_CYCLE,
    HANDLE_HINT,
    HANDLE_LABEL,
    bezierPath,
    clipPoint,
    evalBezier,
    handleAnchor,
    sortPoints
  } from '$lib/bezier';
  import { 步长 } from '$lib/gradient';
  import Icon from '$lib/components/Icon.svelte';

  let {
    points = $bindable([] as BezPoint[]),
    clip = $bindable({ x: true, y: true } as Clip),
    color = 'var(--primary)',
    label = '曲线',
    height = 300
  }: {
    points?: BezPoint[];
    clip?: Clip;
    color?: string;
    label?: string;
    height?: number;
  } = $props();

  const VIEW = 100;
  let svgEl = $state<SVGSVGElement | null>(null);
  let sel = $state(0);
  /** 正在拖的是什么：null / 点下标 / `handle:下标:in|out` */
  let drag = $state<string | null>(null);

  const sorted = $derived(sortPoints(points));

  function toSvg(x: number, y: number) {
    return { sx: x * VIEW, sy: (1 - y) * VIEW };
  }

  function ptr(e: { clientX: number; clientY: number }) {
    const el = svgEl;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))
    };
  }

  function commit(next: BezPoint[]) {
    points = next.map((p) => clipPoint(p, clip));
  }

  /**
   * 捕获指针，失败就算了。
   *
   * 顺序有讲究：**先设状态再捕获**。原来是先 setPointerCapture 再赋值，
   * 而 pointerId 失效时会抛 NotFoundError，一抛后面几行全不执行 ——
   * 表现就是"按下去没反应"，而且报错被吃掉，很难查。
   */
  function grab(el: Element, e: PointerEvent) {
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch {
      /* 指针 id 无效（合成事件、已释放）时忽略，拖拽照样走 */
    }
  }

  function down(e: PointerEvent, idx: number) {
    e.preventDefault();
    sel = idx;
    drag = `p${idx}`;
    grab(e.currentTarget as Element, e);
  }

  function downHandle(e: PointerEvent, idx: number, side: 'in' | 'out') {
    e.preventDefault();
    e.stopPropagation();
    const p = sorted[idx];
    // 自动/矢量手柄是算出来的，拖它没意义 —— Blender 里也是先转成自由才拖得动
    if (p.mode !== 'free') return;
    drag = `h${idx}${side}`;
    grab(e.currentTarget as Element, e);
  }

  function move(e: PointerEvent) {
    if (!drag) return;
    e.preventDefault();
    const q = ptr(e);
    if (!q) return;
    const list = sorted.map((p) => ({ ...p }));
    if (drag.startsWith('p')) {
      const i = +drag.slice(1);
      const isFirst = i === 0;
      const isLast = i === list.length - 1;
      // 首末点的 x 钉死，中间点不能越过邻居
      const lo = isFirst ? list[i].x : list[i - 1].x + 0.004;
      const hi = isLast ? list[i].x : list[i + 1].x - 0.004;
      list[i].x = isFirst ? 0 : isLast ? 1 : Math.min(hi, Math.max(lo, q.x));
      list[i].y = q.y;
    } else {
      const i = +drag.slice(1, -2);
      const side = drag.endsWith('in') ? 'in' : 'out';
      const p = list[i];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      // 手柄不许翻到另一侧，翻过去段就反向了
      const clampedDx = side === 'in' ? Math.min(-0.004, dx) : Math.max(0.004, dx);
      if (side === 'in') {
        p.inDx = clampedDx;
        p.inDy = dy;
      } else {
        p.outDx = clampedDx;
        p.outDy = dy;
      }
    }
    commit(list);
  }

  function up(e: PointerEvent) {
    if (drag) {
      try {
        (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
      } catch {
        /* 没捕获成功过，释放失败正常 */
      }
    }
    drag = null;
  }

  function cycleMode(idx: number) {
    const list = sorted.map((p) => ({ ...p }));
    const cur = list[idx].mode;
    const next = HANDLE_CYCLE[(HANDLE_CYCLE.indexOf(cur) + 1) % HANDLE_CYCLE.length];
    list[idx].mode = next;
    // 从自动化切到自由时，把手柄的当前形状固化成起始值，免得一松手就跳
    if (next === 'free') {
      const o = handleAnchor(sorted, idx, 'out');
      const i2 = handleAnchor(sorted, idx, 'in');
      list[idx].outDx = o.x - list[idx].x;
      list[idx].outDy = o.y - list[idx].y;
      list[idx].inDx = i2.x - list[idx].x;
      list[idx].inDy = i2.y - list[idx].y;
    }
    commit(list);
  }

  function addPoint(e: MouseEvent) {
    if (e.detail < 2) return;
    const q = ptr(e);
    if (!q) return;
    const list = sorted.map((p) => ({ ...p }));
    list.push({
      x: q.x, y: q.y, mode: 'auto',
      inDx: -0.08, inDy: 0, outDx: 0.08, outDy: 0
    });
    const ns = sortPoints(list);
    commit(ns);
    sel = ns.findIndex((p) => p.x === q.x && p.y === q.y);
  }

  function removePoint(idx: number) {
    if (sorted.length <= 2 || idx === 0 || idx === sorted.length - 1) return;
    const list = sorted.filter((_, i) => i !== idx).map((p) => ({ ...p }));
    commit(list);
    sel = Math.max(0, idx - 1);
  }

  function nudge(idx: number, dx: number, dy: number) {
    const list = sorted.map((p) => ({ ...p }));
    list[idx].y = Math.min(1, Math.max(0, list[idx].y + dy));
    if (list[idx].x > 0 && list[idx].x < 1) {
      list[idx].x = Math.min(0.999, Math.max(0.001, list[idx].x + dx));
    }
    commit(list);
  }

  let path = $derived(bezierPath(sorted, VIEW));

  const selPoint = $derived(sorted[sel] ?? null);
</script>

<div class="bez">
  <div class="bez__bar">
    <span class="mini">{label}</span>
    <span class="mini mono">{sorted.length} 点</span>
    {#if selPoint}
      <span class="mini">选中点 {sel + 1}（{selPoint.x.toFixed(2)}, {selPoint.y.toFixed(2)}）</span>
      <button class="btn btn--ghost bez__sm" type="button" onclick={() => cycleMode(sel)}>
        手柄：{HANDLE_LABEL[selPoint.mode]}
      </button>
      {#if sel > 0 && sel < sorted.length - 1}
        <button class="btn btn--ghost bez__sm" type="button" onclick={() => removePoint(sel)}>
          <Icon name="ui.delete" size={12} />删点
        </button>
      {/if}
    {/if}
    <span class="acts__sp"></span>
    <label class="chk"><input type="checkbox" bind:checked={clip.x} /><span class="chk__box"></span>夹住 X</label>
    <label class="chk"><input type="checkbox" bind:checked={clip.y} /><span class="chk__box"></span>夹住 Y</label>
  </div>

  <svg
    bind:this={svgEl}
    class="plot"
    viewBox="0 0 {VIEW} {VIEW}"
    preserveAspectRatio="none"
    style="height:{height}px"
    role="application"
    aria-label="{label} 曲线编辑区"
    ondblclick={addPoint}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
  >
    <rect x="0" y="0" width={VIEW} height={VIEW} class="plot__bg" />
    {#each [0.25, 0.5, 0.75] as g (g)}
      <line x1={g * VIEW} y1="0" x2={g * VIEW} y2={VIEW} class="plot__grid" />
      <line x1="0" y1={g * VIEW} x2={VIEW} y2={g * VIEW} class="plot__grid" />
    {/each}
    <!-- 恒等参考线，方便看偏了多少 -->
    <line x1="0" y1={VIEW} x2={VIEW} y2="0" class="plot__diag" />

    <path d={path} class="plot__line" style="stroke:{color}" />

    {#each sorted as p, i (i)}
      {@const hIn = handleAnchor(sorted, i, 'in')}
      {@const hOut = handleAnchor(sorted, i, 'out')}
      {@const a = toSvg(p.x, p.y)}
      {@const bi = toSvg(hIn.x, hIn.y)}
      {@const bo = toSvg(hOut.x, hOut.y)}
      <!-- 手柄尾巴 -->
      <line x1={a.sx} y1={a.sy} x2={bi.sx} y2={bi.sy} class="plot__hl" class:is-free={p.mode === 'free'} />
      <line x1={a.sx} y1={a.sy} x2={bo.sx} y2={bo.sy} class="plot__hl" class:is-free={p.mode === 'free'} />
      <circle
        cx={bi.sx} cy={bi.sy} r="2"
        class="plot__h" class:is-free={p.mode === 'free'}
        role="button" tabindex="-1" aria-label="点 {i + 1} 左手柄"
        onpointerdown={(e) => downHandle(e, i, 'in')}
      />
      <circle
        cx={bo.sx} cy={bo.sy} r="2"
        class="plot__h" class:is-free={p.mode === 'free'}
        role="button" tabindex="-1" aria-label="点 {i + 1} 右手柄"
        onpointerdown={(e) => downHandle(e, i, 'out')}
      />
      <circle
        cx={a.sx} cy={a.sy} r={sel === i ? 3.6 : 2.8}
        class="plot__dot" class:is-sel={sel === i} class:is-vector={p.mode === 'vector'}
        role="slider"
        aria-label="控制点 {i + 1}，手柄 {HANDLE_LABEL[p.mode]}"
        aria-valuemin={0} aria-valuemax={1} aria-valuenow={Math.round(p.y * 100) / 100}
        tabindex="0"
        style="fill:{color}"
        onpointerdown={(e) => down(e, i)}
        ondblclick={(e) => { e.stopPropagation(); cycleMode(i); }}
        onkeydown={(e) => {
          /* 步长走 gradient.ts 那一处：三页原来各写各的（0.01 / 0.005 / 1/255），
             同一个手势差 2.5 倍。用户 2026-09-20 定：统一 1/255、Shift ×10 */
          const step = 步长(e);
          if (e.key === 'ArrowUp') { e.preventDefault(); nudge(i, 0, step); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(i, 0, -step); }
          else if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(i, -step, 0); }
          else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(i, step, 0); }
          else if ((e.key === 'Delete' || e.key === 'Backspace') && i > 0 && i < sorted.length - 1) {
            e.preventDefault();
            removePoint(i);
          }
        }}
      />
    {/each}
  </svg>

  <p class="mini bez__hint">双击圆点切手柄模式（自动 → 矢量 → 自由）；空白处双击加点；方向键微调，Shift 加大步长；选中中间点按 Delete 删掉。</p>
  {#if selPoint}<p class="mini">{HANDLE_HINT[selPoint.mode]}</p>{/if}
</div>

<style>
  .bez { display: flex; flex-direction: column; gap: 8px; }
  .bez__bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .bez__sm { padding: 3px 9px; font-size: var(--fs-2xs); }
  .bez__hint { margin: 0; }

  .plot {
    width: 100%;
    touch-action: none;
    cursor: crosshair;
    border-radius: var(--r-lg);
    overflow: visible;
  }
  .plot__bg { fill: var(--surface-2); }
  .plot__grid { stroke: var(--line-divider); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .plot__diag {
    stroke: var(--line-color);
    stroke-width: 1;
    stroke-dasharray: 3 3;
    vector-effect: non-scaling-stroke;
  }
  .plot__line {
    fill: none;
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
    stroke-linejoin: round;
  }
  .plot__hl {
    stroke: var(--content-meta);
    stroke-width: 1;
    opacity: 0.35;
    vector-effect: non-scaling-stroke;
  }
  .plot__hl.is-free { opacity: 0.7; stroke: var(--warn); }
  .plot__h {
    fill: var(--card-bg);
    stroke: var(--content-meta);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .plot__h.is-free { stroke: var(--warn); cursor: grab; }
  .plot__dot {
    stroke: var(--card-bg);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
    cursor: grab;
  }
  .plot__dot.is-sel { stroke: var(--deep-text); }
  .plot__dot.is-vector { stroke: var(--warn); stroke-width: 2; }
  .plot__dot:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
</style>
