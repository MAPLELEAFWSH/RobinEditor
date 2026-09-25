<script lang="ts">
  /**
   * 渐变条。一条色带，上面若干色标：点空白处加一个、拖动改位置、
   * 双击删掉、左右方向键微调。形制照 Blender 的 ColorRamp 节点。
   *
   * 三条规矩：
   *
   * 1. **组件不自己存状态。** 位置和明度都从 `stops` 来、改完通过 `onchange` 交回去。
   *    自己存一份就会跟导出那条路分叉 —— 预览一个样、导出一个样，这个坑踩过（B4）。
   * 2. **只认明度，不引颜色选择器。** 色标画成灰阶。真要调色是 ① 调色那边的活。
   * 3. **拖动只改位置。** 明度用键盘和数字框 —— 鼠标不拿第二个自由度，
   *    免得"只想挪个位置，顺手把明度也带跑了"。
   *
   * 插值方式由 `kind` 给，求值一律走 `img.ts` 的 `evalCurve`（跟曲线页同一份）。
   */
  import { evalCurve } from '$lib/img';
  import type { CurveKind, CurvePoint } from '$lib/img';
  import {
    MIN_GAP,
    MIN_STOPS,
    折线采样,
    步长,
    addStopAt,
    cssGradient,
    fmtPos,
    fmtValue,
    moveStop,
    nearestStop,
    removeStop,
    setStopValue,
    sortStops
  } from '$lib/gradient';

  type Props = {
    /** 色标。位置 0-1、明度 0-1。**只读**，改完用 onchange 交回去 */
    stops: CurvePoint[];
    /** 插值方式，跟曲线页共用同一档 */
    kind: CurveKind;
    /** 这个条子在改哪一路，标在标题上 */
    label: string;
    /** 改完交回来。reason 只是给调用方记日志用的 */
    onchange: (next: CurvePoint[], reason: 'add' | 'move' | 'value' | 'remove') => void;
  };

  let { stops, kind, label, onchange }: Props = $props();

  /** 条子里最多画多少个采样点。够密，七种插值都能画对（三页统一走 gradient.ts 的常量） */
  const SAMPLES = 折线采样;
  /** 点到离色标多近算"点的是色标"。按条子宽度归一化 */
  const HIT = 0.03;

  let track = $state<HTMLDivElement | null>(null);
  let sel = $state(0);
  let dragging = $state(false);

  const list = $derived(sortStops(stops));
  /* 选中的下标在排序后的坐标系里，越界就夹回来 */
  const selIdx = $derived(Math.min(Math.max(0, sel), Math.max(0, list.length - 1)));

  const barStyle = $derived(`background: ${cssGradient(list, kind)};`);

  /** 曲线形状：SVG 折线，横轴位置、纵轴明度。让条子和值一眼对上 */
  const shapePath = $derived.by(() => {
    let d = '';
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const v = evalCurve(list, t, kind);
      d += `${i === 0 ? 'M' : 'L'}${(t * 100).toFixed(2)} ${((1 - v) * 100).toFixed(2)} `;
    }
    return d.trim();
  });

  function posFromEvent(e: { clientX: number }): number | null {
    const el = track;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width) return null;
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  }

  /** 单击空白 = 加点；点在色标上 = 选中它，不加 */
  function onTrackDown(e: PointerEvent) {
    const at = posFromEvent(e);
    if (at === null) return;
    const near = nearestStop(list, at);
    if (near.dist <= HIT) {
      sel = near.index;
      return;
    }
    const added = addStopAt(list, at, kind);
    if (!added) return;
    sel = added.index;
    onchange(added.stops, 'add');
  }

  function onStopDown(e: PointerEvent, i: number) {
    e.preventDefault();
    e.stopPropagation();
    /* 选中要先落地，再谈指针捕获 —— 捕获失败不该把"点一下选中它"也一起废掉。
       实测：`setPointerCapture` 会抛 NotFoundError（那个 id 上没有活跃指针时），
       而它原来是写在 `sel = i` 前面的，一抛后面的赋值就执行不到，
       表现就是"点色标选不中，下面那两行永远停在第一个色标"。 */
    sel = i;
    dragging = true;
    try {
      (e.currentTarget as Element)?.setPointerCapture?.(e.pointerId);
    } catch {
      /* 捕获不到也能拖，只是指针移出条子时会丢事件 */
    }
  }

  function onStopMove(e: PointerEvent) {
    if (!dragging) return;
    e.preventDefault();
    const at = posFromEvent(e);
    if (at === null) return;
    onchange(moveStop(list, selIdx, at), 'move');
  }

  function onStopUp(e: PointerEvent) {
    if (!dragging) return;
    try {
      (e.currentTarget as Element)?.releasePointerCapture?.(e.pointerId);
    } catch {
      /* 没捕获成功过，也就没什么可放的 */
    }
    dragging = false;
  }

  /** 双击色标 = 删。剩两个时删不掉 */
  function onStopDbl(e: MouseEvent, i: number) {
    e.preventDefault();
    e.stopPropagation();
    const next = removeStop(list, i);
    if (next.length === list.length) return;
    sel = Math.min(i, next.length - 1);
    onchange(next, 'remove');
  }

  function onKey(e: KeyboardEvent) {
    const step = 步长(e);
    let dpos = 0;
    let dval = 0;
    switch (e.key) {
      case 'ArrowLeft':
        dpos = -step;
        break;
      case 'ArrowRight':
        dpos = step;
        break;
      case 'ArrowUp':
        dval = step;
        break;
      case 'ArrowDown':
        dval = -step;
        break;
      case 'Home':
        dpos = -1;
        break;
      case 'End':
        dpos = 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const cur = list[selIdx];
    if (!cur) return;
    const moved = dpos ? moveStop(list, selIdx, cur.x + dpos) : list;
    const next = dval ? setStopValue(moved, selIdx, cur.y + dval) : moved;
    onchange(next, dval ? 'value' : 'move');
  }

  /** 从数字框改明度。输入 0-255，跟界面上显示的口径一致 */
  function onValueInput(e: Event) {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    onchange(setStopValue(list, selIdx, v / 255), 'value');
  }

  const cur = $derived(list[selIdx]);
</script>

<div class="grad" class:is-drag={dragging}>
  <div class="grad__head">
    <span class="grad__label">{label}</span>
    <span class="grad__hint">点条子加点 · 拖色标挪位 · 双击删 · 方向键微调（Shift 十格）</span>
  </div>

  <div
    class="grad__shape"
    aria-hidden="true"
    style="--gap:{MIN_GAP}"
  >
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
      <path d={shapePath} />
    </svg>
  </div>

  <div
    class="grad__track"
    bind:this={track}
    style={barStyle}
    role="group"
    aria-label="{label} 渐变条，共 {list.length} 个色标"
    onpointerdown={onTrackDown}
  >
    <div class="grad__stops">
      {#each list as s, i (i)}
        <button
          class="grad__stop"
          class:is-on={i === selIdx}
          style="--x:{s.x}; --v:{s.y}"
          type="button"
          role="slider"
          tabindex={i === selIdx ? 0 : -1}
          aria-label="色标 {i + 1}"
          aria-valuemin={0}
          aria-valuemax={255}
          aria-valuenow={Math.round(s.y * 255)}
          aria-valuetext="位置 {fmtPos(s.x)}，明度 {fmtValue(s.y)}"
          title="位置 {fmtPos(s.x)} · 明度 {fmtValue(s.y)}"
          onpointerdown={(e) => onStopDown(e, i)}
          onpointermove={onStopMove}
          onpointerup={onStopUp}
          onpointercancel={onStopUp}
          ondblclick={(e) => onStopDbl(e, i)}
          onkeydown={onKey}
        >
          <i class="grad__knob"></i>
        </button>
      {/each}
    </div>
  </div>

  <div class="grad__foot">
    <span class="grad__pos">位置 <b>{cur ? fmtPos(cur.x) : '—'}</b></span>
    <label class="grad__num">
      明度
      <input
        type="number"
        min="0"
        max="255"
        step="1"
        aria-label="明度"
        value={cur ? fmtValue(cur.y) : ''}
        oninput={onValueInput}
      />
    </label>
    <span class="grad__count">{list.length} 个色标</span>
    {#if list.length <= MIN_STOPS}
      <span class="grad__note">已经是下限，不能少于 {MIN_STOPS} 个</span>
    {/if}
  </div>
</div>

<style>
  .grad {
    display: grid;
    gap: 8px;
  }

  .grad__head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .grad__label {
    font-size: var(--fs-sm);
    font-weight: 650;
    color: var(--deep-text);
  }
  .grad__hint {
    font-size: var(--fs-2xs);
    color: var(--content-meta);
  }

  /* 曲线形状。跟条子叠着看：条子给的是"出来的颜色"，这条给的是"值怎么走" */
  .grad__shape {
    height: 46px;
    border: 1px solid var(--line-divider);
    border-radius: var(--r-md);
    background: var(--surface-2);
    overflow: hidden;
  }
  .grad__shape svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .grad__shape path {
    fill: none;
    stroke: var(--primary);
    stroke-width: 0.6;
    vector-effect: non-scaling-stroke;
  }

  .grad__track {
    position: relative;
    height: 40px;
    border: 1px solid var(--line-divider);
    border-radius: var(--r-md);
    cursor: copy;
    /* 条子本身不动，动的是色标 */
    touch-action: none;
  }

  .grad__stops {
    position: absolute;
    inset: 0;
  }

  /* 色标：一个贴着条子的手柄。位置由 --x 定，明度只体现在颜色上 */
  .grad__stop {
    position: absolute;
    left: calc(var(--x) * 100%);
    top: -5px;
    bottom: -5px;
    width: 18px;
    margin-left: -9px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: grab;
    touch-action: none;
  }
  .grad__stop:active { cursor: grabbing; }

  .grad__knob {
    position: absolute;
    left: 50%;
    bottom: 0;
    width: 14px;
    height: 14px;
    margin-left: -7px;
    border-radius: 50%;
    /* 明度就是这个色标的值：黑底白格子里填它自己，加一圈描边保证深色也看得见 */
    background: rgb(
      calc(var(--v) * 255),
      calc(var(--v) * 255),
      calc(var(--v) * 255)
    );
    border: 2px solid var(--card-bg);
    box-shadow: 0 0 0 1px var(--line-strong);
    transition: transform var(--t-micro) var(--ease-std),
                box-shadow var(--t-micro) var(--ease-std);
  }
  .grad__stop:hover .grad__knob { transform: scale(1.12); }
  .grad__stop.is-on .grad__knob {
    box-shadow: 0 0 0 1px var(--line-strong),
                0 0 0 4px color-mix(in oklab, var(--primary) 30%, transparent);
  }
  .grad__stop:focus-visible .grad__knob {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }

  .grad__foot {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    font-size: var(--fs-2xs);
    color: var(--content-meta);
  }
  .grad__pos b { color: var(--deep-text); font-variant-numeric: tabular-nums; }
  .grad__num {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .grad__num input {
    width: 4.6rem;
    font: inherit;
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
    color: var(--deep-text);
    background: var(--surface-2);
    border: 1px solid var(--line-color);
    border-radius: var(--r-sm);
    padding: 3px 6px;
  }
  .grad__count { font-variant-numeric: tabular-nums; }
  .grad__note { color: var(--warn); }

  @media (prefers-reduced-motion: reduce) {
    .grad__knob { transition: none; }
  }
</style>
