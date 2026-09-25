<script lang="ts">
  /**
   * 调整栈编辑器。调整页和每个图层都用它。
   *
   * 一串 op 按顺序叠，跟 PS 的"调整图层"一个意思。顺序可上下挪，可单条停用。
   * 曲线上手写 SVG，拖点 / 双击加点删点 / 方向键微调。
   */
  import {
    type ChannelKey,
    type CurveKind,
    type CurvePoint,
    CHANNEL_KEYS,
    CHANNEL_LABEL,
    evalCurve
  } from '$lib/img';
  import { ADJUST_LABEL, type AdjustOp, type AdjustScope, makeAdjust } from './ops';
  import { 折线采样, MIN_GAP } from '$lib/gradient';
  import Icon from '$lib/components/Icon.svelte';

  let {
    ops,
    scope = 'all',
    showScope = true,
    compact = false,
    onchange
  }: {
    ops: AdjustOp[];
    scope?: AdjustScope;
    showScope?: boolean;
    compact?: boolean;
    onchange: (next: AdjustOp[], scope: AdjustScope) => void;
  } = $props();

  const KINDS: AdjustOp['k'][] = [
    'brightness-contrast',
    'levels',
    'curves',
    'hsl',
    'color-balance',
    'threshold',
    'posterize',
    'invert',
    'desaturate'
  ];

  let open = $state<number | null>(null);
  let picker = $state(false);

  function patch(i: number, p: Record<string, unknown>) {
    const next = ops.map((o, j) => (j === i ? ({ ...o, ...p } as AdjustOp) : o));
    onchange(next, scope);
  }
  function move(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= ops.length) return;
    const next = [...ops];
    [next[i], next[j]] = [next[j], next[i]];
    open = j;
    onchange(next, scope);
  }
  function del(i: number) {
    onchange(
      ops.filter((_, j) => j !== i),
      scope
    );
    open = null;
  }
  function add(k: AdjustOp['k']) {
    // 新下标要从**本地算出来的那个数组**取。
    // 写成 `open = ops.length` 是错的：Svelte 5 的 props 是 getter，
    // 上面那行 onchange 一执行 ops 就已经是新数组了，ops.length 直接超出一格，
    // 于是新加的那步展开不了 —— 实测点"加一步"后是空面板。
    const next = [...ops, makeAdjust(k)];
    onchange(next, scope);
    open = next.length - 1;
    picker = false;
  }

  /* ---------------- 曲线 ---------------- */

  const VIEW = 100;
  let svgEl = $state<SVGSVGElement | null>(null);
  let drag = $state<{ op: number; idx: number } | null>(null);

  function pathOf(pts: CurvePoint[], mode: CurveKind): string {
    if (!pts.length) return '';
    /* 采样数跟另外两页统一（原来这里是 64，渐变条 128、曲线页 96 —— 同一套插值疏密不一样） */
    const n = 折线采样;
    let d = '';
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const v = evalCurve(pts, t, mode);
      d += `${i === 0 ? 'M' : 'L'}${(t * VIEW).toFixed(2)} ${((1 - v) * VIEW).toFixed(2)} `;
    }
    return d.trim();
  }

  function norm(e: PointerEvent) {
    const el = svgEl;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))
    };
  }

  function down(i: number, idx: number, e: PointerEvent) {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag = { op: i, idx };
    movePt(e);
  }
  function movePt(e: PointerEvent) {
    if (!drag) return;
    const pos = norm(e);
    if (!pos) return;
    const op = ops[drag.op];
    if (op.k !== 'curves') return;
    const list = [...op.pts].sort((a, b) => a.x - b.x);
    const i = drag.idx;
    const first = i === 0;
    const last = i === list.length - 1;
    /* 邻居间距走 gradient.ts 的 MIN_GAP（原来这里硬编码 0.01，跟渐变条那份漂不漂不知道） */
    const lo = first ? 0 : list[i - 1].x + MIN_GAP;
    const hi = last ? 1 : list[i + 1].x - MIN_GAP;
    list[i] = {
      x: first ? 0 : last ? 1 : Math.min(hi, Math.max(lo, pos.x)),
      y: pos.y
    };
    patch(drag.op, { pts: list });
  }
  function up(e: PointerEvent) {
    if (drag) (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    drag = null;
  }
  function addPt(i: number, e: MouseEvent) {
    const op = ops[i];
    if (op.k !== 'curves' || e.detail < 2) return;
    const el = svgEl;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const p = {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))
    };
    const list = [...op.pts, p].sort((a, b) => a.x - b.x);
    patch(i, { pts: list });
  }
  function delPt(i: number, idx: number, e: MouseEvent) {
    e.stopPropagation();
    const op = ops[i];
    if (op.k !== 'curves' || op.pts.length <= 2) return;
    patch(i, { pts: op.pts.filter((_, j) => j !== idx) });
  }

  function summary(op: AdjustOp): string {
    switch (op.k) {
      case 'brightness-contrast':
        return `${op.brightness >= 0 ? '+' : ''}${op.brightness} / ${op.contrast >= 0 ? '+' : ''}${op.contrast}`;
      case 'levels':
        return `${op.inBlack}–${op.inWhite} γ${op.gamma.toFixed(2)}`;
      case 'curves':
        return `${op.pts.length} 点 · ${op.mode}`;
      case 'hsl':
        return `H${op.hue}° S${op.sat} L${op.light}`;
      case 'color-balance':
        return `${op.sh.join('/')} · ${op.mi.join('/')} · ${op.hi.join('/')}`;
      case 'threshold':
        return `≥ ${op.level}`;
      case 'posterize':
        return `${op.levels} 档`;
      case 'invert':
        return '取反';
      case 'desaturate':
        return `${op.amount}%`;
    }
  }
</script>

<div class="adj">
  {#if showScope}
    <div class="row">
      <span class="row__k">作用范围</span>
      <div class="pick">
        <button class="pick__b" type="button" aria-pressed={scope === 'all'} onclick={() => onchange(ops, 'all')}>
          RGB
        </button>
        {#each CHANNEL_KEYS as c (c)}
          <button class="pick__b" type="button" aria-pressed={scope === c} onclick={() => onchange(ops, c)}>
            {CHANNEL_LABEL[c]}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <ul class="stack" class:compact>
    {#each ops as op, i (i)}
      <li class="op" class:is-open={open === i}>
        <div class="op__head">
          <button
            class="op__t"
            type="button"
            aria-expanded={open === i}
            onclick={() => (open = open === i ? null : i)}
          >
            <Icon name={open === i ? 'ui.chevronDown' : 'ui.caret'} size={12} />
            <b>{ADJUST_LABEL[op.k]}</b>
            <span class="mini mono">{summary(op)}</span>
          </button>
          <span class="op__ops">
            <button type="button" title="上移" onclick={() => move(i, -1)} disabled={i === 0}>↑</button>
            <button type="button" title="下移" onclick={() => move(i, 1)} disabled={i === ops.length - 1}>↓</button>
            <button type="button" title="删掉" onclick={() => del(i)}>×</button>
          </span>
        </div>

        {#if open === i}
          <div class="op__body">
            {#if op.k === 'brightness-contrast'}
              <div class="row">
                <span class="row__k">亮度</span>
                <input class="range range--inline" type="range" min="-150" max="150" value={op.brightness}
                  aria-label="亮度" oninput={(e) => patch(i, { brightness: +e.currentTarget.value })} />
                <span class="row__v">{op.brightness}</span>
              </div>
              <div class="row">
                <span class="row__k">对比度</span>
                <input class="range range--inline" type="range" min="-100" max="200" value={op.contrast}
                  aria-label="对比度" oninput={(e) => patch(i, { contrast: +e.currentTarget.value })} />
                <span class="row__v">{op.contrast}</span>
              </div>
            {:else if op.k === 'levels'}
              <div class="row">
                <span class="row__k">输入黑点</span>
                <input class="range range--inline" type="range" min="0" max="254" value={op.inBlack}
                  aria-label="输入黑点" oninput={(e) => patch(i, { inBlack: +e.currentTarget.value })} />
                <span class="row__v">{op.inBlack}</span>
              </div>
              <div class="row">
                <span class="row__k">输入白点</span>
                <input class="range range--inline" type="range" min="1" max="255" value={op.inWhite}
                  aria-label="输入白点" oninput={(e) => patch(i, { inWhite: +e.currentTarget.value })} />
                <span class="row__v">{op.inWhite}</span>
              </div>
              <div class="row">
                <span class="row__k">灰度系数</span>
                <input class="range range--inline" type="range" min="0.1" max="3" step="0.01" value={op.gamma}
                  aria-label="灰度系数" oninput={(e) => patch(i, { gamma: +e.currentTarget.value })} />
                <span class="row__v">{op.gamma.toFixed(2)}</span>
              </div>
              <div class="row">
                <span class="row__k">输出黑点</span>
                <input class="range range--inline" type="range" min="0" max="254" value={op.outBlack}
                  aria-label="输出黑点" oninput={(e) => patch(i, { outBlack: +e.currentTarget.value })} />
                <span class="row__v">{op.outBlack}</span>
              </div>
              <div class="row">
                <span class="row__k">输出白点</span>
                <input class="range range--inline" type="range" min="1" max="255" value={op.outWhite}
                  aria-label="输出白点" oninput={(e) => patch(i, { outWhite: +e.currentTarget.value })} />
                <span class="row__v">{op.outWhite}</span>
              </div>
              <p class="mini" style="margin-top:8px">
                读数是 0-255。白点小于黑点就是把整段反过来。
              </p>
            {:else if op.k === 'curves'}
              <div class="curvewrap">
                <svg
                  bind:this={svgEl}
                  class="plot"
                  viewBox="0 0 {VIEW} {VIEW}"
                  preserveAspectRatio="none"
                  role="application"
                  aria-label="曲线编辑区"
                  ondblclick={(e) => addPt(i, e)}
                  onpointermove={movePt}
                  onpointerup={up}
                  onpointercancel={up}
                >
                  <rect x="0" y="0" width={VIEW} height={VIEW} class="plot__bg" />
                  {#each [0.25, 0.5, 0.75] as g (g)}
                    <line x1={g * VIEW} y1="0" x2={g * VIEW} y2={VIEW} class="plot__grid" />
                    <line x1="0" y1={g * VIEW} x2={VIEW} y2={g * VIEW} class="plot__grid" />
                  {/each}
                  <path d={pathOf([...op.pts].sort((a, b) => a.x - b.x), op.mode)} class="plot__line" />
                  {#each [...op.pts].sort((a, b) => a.x - b.x) as p, k (k)}
                    <circle
                      cx={p.x * VIEW}
                      cy={(1 - p.y) * VIEW}
                      r={drag && drag.op === i && drag.idx === k ? 3.6 : 2.8}
                      class="plot__dot"
                      role="slider"
                      aria-label="控制点 {k + 1}"
                      aria-valuemin={0}
                      aria-valuemax={1}
                      aria-valuenow={Math.round(p.y * 100) / 100}
                      tabindex="0"
                      onpointerdown={(e) => down(i, k, e)}
                      onpointerup={up}
                      ondblclick={(e) => delPt(i, k, e)}
                    />
                  {/each}
                </svg>
                <div class="pick">
                  {#each [['linear', '线性'], ['smooth', '平滑'], ['step', '阶梯']] as m (m[0])}
                    <button class="pick__b" type="button" aria-pressed={op.mode === m[0]}
                      onclick={() => patch(i, { mode: m[0] as CurveKind })}>{m[1]}</button>
                  {/each}
                </div>
              </div>
              <p class="mini">横轴输入、纵轴输出。双击空白加点，双击点删点。</p>
            {:else if op.k === 'hsl'}
              <div class="row">
                <span class="row__k">色相</span>
                <input class="range range--inline" type="range" min="-180" max="180" value={op.hue}
                  aria-label="色相" oninput={(e) => patch(i, { hue: +e.currentTarget.value })} />
                <span class="row__v">{op.hue}°</span>
              </div>
              <div class="row">
                <span class="row__k">饱和度</span>
                <input class="range range--inline" type="range" min="-100" max="100" value={op.sat}
                  aria-label="饱和度" oninput={(e) => patch(i, { sat: +e.currentTarget.value })} />
                <span class="row__v">{op.sat}</span>
              </div>
              <div class="row">
                <span class="row__k">明度</span>
                <input class="range range--inline" type="range" min="-100" max="100" value={op.light}
                  aria-label="明度" oninput={(e) => patch(i, { light: +e.currentTarget.value })} />
                <span class="row__v">{op.light}</span>
              </div>
            {:else if op.k === 'color-balance'}
              {#each [['sh', '阴影'], ['mi', '中间调'], ['hi', '高光']] as band (band[0])}
                <div class="band">
                  <span class="mini">{band[1]}</span>
                  {#each ['红', '绿', '蓝'] as label, ci (label)}
                    <div class="row">
                      <span class="row__k">{label}</span>
                      <input class="range range--inline" type="range" min="-100" max="100"
                        value={op[band[0] as 'sh'][ci]}
                        aria-label="{band[1]}{label}"
                        oninput={(e) => {
                          const arr = [...op[band[0] as 'sh']] as [number, number, number];
                          arr[ci] = +e.currentTarget.value;
                          patch(i, { [band[0]]: arr });
                        }} />
                      <span class="row__v">{op[band[0] as 'sh'][ci]}</span>
                    </div>
                  {/each}
                </div>
              {/each}
              <label class="chk" style="margin-top:8px">
                <input type="checkbox" checked={op.preserve} onchange={(e) => patch(i, { preserve: e.currentTarget.checked })} />
                <span class="chk__box"></span>保持明度
              </label>
            {:else if op.k === 'threshold'}
              <div class="row">
                <span class="row__k">阈值</span>
                <input class="range range--inline" type="range" min="0" max="255" value={op.level}
                  aria-label="阈值" oninput={(e) => patch(i, { level: +e.currentTarget.value })} />
                <span class="row__v">{op.level}</span>
              </div>
              <p class="mini" style="margin-top:8px">比这个值亮的变全白，暗的变全黑。</p>
            {:else if op.k === 'posterize'}
              <div class="row">
                <span class="row__k">档数</span>
                <input class="range range--inline" type="range" min="2" max="32" value={op.levels}
                  aria-label="档数" oninput={(e) => patch(i, { levels: +e.currentTarget.value })} />
                <span class="row__v">{op.levels}</span>
              </div>
            {:else if op.k === 'desaturate'}
              <div class="row">
                <span class="row__k">去多少</span>
                <input class="range range--inline" type="range" min="0" max="100" value={op.amount}
                  aria-label="去色比例" oninput={(e) => patch(i, { amount: +e.currentTarget.value })} />
                <span class="row__v">{op.amount}%</span>
              </div>
            {:else}
              <p class="mini">这一步没有参数。</p>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>

  {#if !ops.length}
    <p class="mini" style="margin:8px 0 0">还没加调整。下面挑一个加上去。</p>
  {/if}

  <div class="acts" style="margin-top:10px">
    <button class="btn btn--ghost btn--sm" type="button" onclick={() => (picker = !picker)}>
      <Icon name="ui.add" size={13} />加一步
    </button>
    {#if ops.length}
      <button class="btn btn--ghost btn--sm" type="button" onclick={() => onchange([], scope)}>
        <Icon name="ui.close" size={13} />全清
      </button>
    {/if}
  </div>

  {#if picker}
    <div class="kinds">
      {#each KINDS as k (k)}
        <button class="btn btn--ghost btn--sm" type="button" onclick={() => add(k)}>{ADJUST_LABEL[k]}</button>
      {/each}
    </div>
  {/if}
  {#if compact}
    <p class="mini" style="margin:8px 0 0">这一步跟着图层走，只作用在图层自己的像素上。</p>
  {/if}
</div>

<style>
  .adj { display: block; }
  .stack { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .op {
    border: 1px solid var(--line-divider);
    border-radius: var(--r-md);
    background: var(--surface-2);
    overflow: hidden;
  }
  .op.is-open { border-color: color-mix(in oklab, var(--primary) 34%, var(--line-divider)); }
  .op__head { display: flex; align-items: center; gap: 6px; padding: 2px 4px 2px 2px; }
  .op__t {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 6px;
    border: 0;
    background: none;
    color: var(--deep-text);
    font: inherit;
    font-size: var(--fs-xs);
    text-align: left;
    cursor: pointer;
    border-radius: var(--r-sm);
  }
  .op__t:hover { background: var(--rail-hover); }
  .op__t b { font-weight: 600; }
  .op__t .mini { margin-left: auto; }
  .op__ops { display: flex; gap: 2px; flex: none; }
  .op__ops button {
    width: 20px;
    height: 20px;
    border: 0;
    border-radius: var(--r-sm);
    background: var(--btn-regular-bg);
    color: var(--btn-content);
    font: inherit;
    font-size: var(--fs-2xs);
    line-height: 1;
    cursor: pointer;
  }
  .op__ops button:hover:not(:disabled) { background: var(--btn-regular-bg-hover); }
  .op__ops button:disabled { opacity: 0.4; cursor: default; }
  .op__body { padding: 8px 10px 10px; border-top: 1px solid var(--line-divider); }

  .band { margin-top: 8px; }
  .band > .mini { display: block; margin-bottom: 4px; }

  .curvewrap { display: grid; gap: 8px; }
  /* viewBox 是方的，显示区也得是方的，不然 45° 的直线会被拉斜 */
  .plot {
    width: 100%;
    max-width: 16rem;
    aspect-ratio: 1 / 1;
    justify-self: center;
    touch-action: none;
    cursor: crosshair;
    border-radius: var(--r-md);
    overflow: visible;
  }
  .plot__bg { fill: var(--card-bg); }
  .plot__grid { stroke: var(--line-divider); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .plot__line {
    fill: none;
    stroke: var(--primary);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
    stroke-linejoin: round;
  }
  .plot__dot {
    fill: var(--primary);
    stroke: var(--card-bg);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
    cursor: grab;
  }
  .plot__dot:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

  .kinds {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--line-divider);
  }
  .btn--sm { padding: 4px 10px; font-size: var(--fs-2xs); }
</style>
