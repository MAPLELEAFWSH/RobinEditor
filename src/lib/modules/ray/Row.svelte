<script lang="ts">
  /**
   * 一个参数一行。
   *
   * 控件按值的类型给：
   *   开关   复选框
   *   枚举   下拉（选项来自原文件注释里的 `0 : xxx` 表）
   *   数值   有范围就滑杆 + 数字框，没范围就纯数字框
   *   颜色   取色器 + RGB(A) 数字框
   *   贴图   "选贴图"按钮，选完填相对路径
   *   表达式 只读，说明为什么不能改
   *
   * 说明默认收起，点名字展开。这样一屏能看十几行参数，不用一直滚。
   */
  import Icon from '$lib/components/Icon.svelte';
  import type { Entry } from './ops';
  import type { Doc } from './docs';
  import { classify, formatColor, fromHex, parseColor, pathNeedsCaution, toHex, type Field } from './value';
  import { registerZone, unregisterZone } from '$lib/dropzones.svelte';
  import type { FileRef } from '$lib/io';

  type Props = {
    entry: Entry;
    doc: Doc | null;
    value: string;
    active?: boolean;
    /** 相对文件原值有没有改过 */
    changed?: boolean;
    readOnly?: boolean;
    onValue: (v: string) => void;
    onActive?: (v: boolean) => void;
    onPickTexture?: (e: Entry) => void;
    /** 把文件直接拖到这一行上。走的是"相对路径 + 同组 FROM 拨到 1"那同一套 */
    onDropTexture?: (e: Entry, ref: FileRef) => void;
  };

  let {
    entry,
    doc,
    value,
    active = false,
    changed = false,
    readOnly = false,
    onValue,
    onActive,
    onPickTexture,
    onDropTexture
  }: Props = $props();

  const field = $derived<Field>(classify(entry, doc));
  let open = $state(false);
  /** 贴图那行的落点元素。拖进来的文件落到它上面就算落这一行 */
  let texEl = $state<HTMLElement | null>(null);

  /**
   * 把贴图那行登记成拖放落点。
   *
   * 为什么不用 `drop` 事件挂在元素上：桌面端 Tauri 把文件在系统层就接走了，
   * HTML5 的 drop 一个字节都收不到 —— 只有窗口级那条 `onDragDropEvent` 有真路径。
   * 所以这里只登记"我这一段是谁"，落点解析在 `drag-dom` 那边统一做。
   */
  $effect(() => {
    if (field.kind !== 'texture' || !texEl) return;
    const id = `ray:${entry.id}`;
    const el = texEl;
    registerZone({
      id,
      rect: el.getBoundingClientRect(),
      el,
      onDrop: (ref) => onDropTexture?.(entry, ref)
    });
    return () => unregisterZone(id);
  });

  const color = $derived(field.kind === 'color' ? parseColor(value) : null);
  const hdr = $derived(
    !!color && (color.r > 1.0001 || color.g > 1.0001 || color.b > 1.0001 || color.a > 1.0001)
  );
  const texCaution = $derived(field.kind === 'texture' ? pathNeedsCaution(value) : null);

  function setColor(patch: Partial<{ r: number; g: number; b: number; a: number }>) {
    const c = parseColor(value);
    if (!c) return;
    const next = { ...c, ...patch };
    // 按声明的宽度写回：float4 的不能只写三个分量
    onValue(formatColor(next, value, field.colorArity === 4 ? 4 : 3));
  }

  /**
   * 数值滑条的范围。
   *
   * 用户的规矩是"**数值既能填也能拖**"：说明表给了 min/max 就用给的；
   * 没给的（引擎里有大量没写范围的参数）**也要有滑条**，否则那些参数只有数字框、拖不了。
   * 没给范围时按**原值**推一个能用的量级 —— 用原值而不是正在编辑的值，免得拖到端点时范围跟着变、手感一跳一跳。
   */
  const 范围 = $derived.by(() => {
    const f = field;
    if (f.kind !== 'number') return { min: 0, max: 1, step: 0.01 };
    if (f.min !== undefined && f.max !== undefined) {
      return { min: f.min, max: f.max, step: f.int ? 1 : (f.max - f.min) / 500 };
    }
    const 基准 = Math.abs(Number(entry.value));
    const 幅 = Number.isFinite(基准) && 基准 > 0 ? Math.ceil(基准 * 2 * 100) / 100 : 1;
    const 负 = Number(entry.value) < 0;
    return { min: 负 ? -幅 : 0, max: 幅, step: f.int ? 1 : 幅 / 200 };
  });

  /** 颜色四个分量的滑条范围：正常 0~1；有分量超过 1（HDR）就把上限抬到装得下 */
  const 色范 = $derived.by(() => {
    const 列 = color ? [color.r, color.g, color.b, color.a] : [1];
    const 最大 = Math.max(1, ...列.map((x) => (Number.isFinite(x) ? x : 1)));
    const 上限 = 最大 <= 1 ? 1 : Math.ceil(最大 * 2) / 2;
    return { min: 0, max: 上限, step: 上限 / 200 };
  });
  const 通道表 = $derived(
    color?.hasAlpha
      ? [
          { k: 'r' as const, t: 'R' },
          { k: 'g' as const, t: 'G' },
          { k: 'b' as const, t: 'B' },
          { k: 'a' as const, t: 'A' }
        ]
      : [
          { k: 'r' as const, t: 'R' },
          { k: 'g' as const, t: 'G' },
          { k: 'b' as const, t: 'B' }
        ]
  );
  function 设通道(k: 'r' | 'g' | 'b' | 'a', v: number) {
    if (k === 'r') setColor({ r: v });
    else if (k === 'g') setColor({ g: v });
    else if (k === 'b') setColor({ b: v });
    else setColor({ a: v });
  }

  function onHex(e: Event) {
    const hex = (e.currentTarget as HTMLInputElement).value;
    const { r, g, b } = fromHex(hex);
    setColor({ r, g, b });
  }

  const srcTag = $derived(doc?.src ?? '');
</script>

<div class="it" class:it--changed={changed} class:it--off={entry.kind === 'commented'}>
  <div class="it__k">
    <button class="it__namebtn" type="button" onclick={() => (open = !open)} aria-expanded={open}>
      <Icon name={open ? 'ui.chevronDown' : 'ui.caret'} size={11} />
      <span class="mono it__name">{entry.name}</span>
      {#if entry.kind === 'commented'}<span class="it__flag">已注释</span>{/if}
      {#if changed}<span class="it__flag it__flag--chg">待写入</span>{/if}
      {#if !doc}<span class="it__flag it__flag--none">没有说明</span>{/if}
    </button>

    <!-- 收起时给一行摘要，不用展开也能看出这是个什么东西 -->
    {#if !open}
      <span class="mini it__brief" title={doc?.zh ?? ''}>
        {doc ? doc.zh : '这张表里没有这条参数的说明。'}
      </span>
    {/if}

    {#if open}
      <div class="doc">
        {#if doc}
          <p class="doc__zh">
            {#if srcTag}<span class="src src--{srcTag}">{srcTag}</span>{/if}
            {doc.zh}
          </p>
          {#if doc.how}<p class="doc__l"><b>怎么调</b>{doc.how}</p>{/if}
          {#if doc.cost}<p class="doc__l"><b>代价</b>{doc.cost}</p>{/if}
          {#if doc.options}
            <ul class="doc__opts">
              {#each doc.options as o (o.value)}
                <li class:on={value === o.value}><span class="mono">{o.value}</span>{o.label}</li>
              {/each}
            </ul>
          {/if}
        {:else}
          <p class="doc__zh">
            这张表里没有这条参数的说明。原文件也没写注释，只有名字能看出来。
            不编一段看着像那么回事的话填在这里。
          </p>
        {/if}
        <p class="doc__meta mono">
          第 {entry.line + 1} 行 · {entry.type || 'define'}
          {#if entry.comment} · 行尾 {entry.comment.trim()}{/if}
        </p>
      </div>
    {/if}
  </div>

  <div class="it__v">
    {#if entry.kind === 'commented'}
      <label class="chk">
        <input type="checkbox" checked={active} disabled={readOnly} onchange={(e) => onActive?.(e.currentTarget.checked)} />
        <span class="chk__box"></span>启用
      </label>

    {:else if field.kind === 'enum'}
      <select value={value} disabled={readOnly} onchange={(e) => onValue(e.currentTarget.value)} aria-label={entry.name}>
        {#if !field.options!.some((o) => o.value === value)}
          <option value={value}>{value} · 不在说明里</option>
        {/if}
        {#each field.options! as o (o.value)}
          <option value={o.value}>{o.value} · {o.label}</option>
        {/each}
      </select>

    {:else if field.kind === 'switch'}
      <label class="chk">
        <input
          type="checkbox"
          checked={value === '1'}
          disabled={readOnly}
          onchange={(e) => onValue(e.currentTarget.checked ? '1' : '0')}
        />
        <span class="chk__box"></span>{value === '1' ? '开' : '关'}
      </label>

    {:else if field.kind === 'color' && color}
      <div class="col">
        <input
          class="col__sw"
          type="color"
          value={toHex(color)}
          disabled={readOnly}
          oninput={onHex}
          aria-label="{entry.name} 取色器"
        />
        <div class="col__ch">
          {#each 通道表 as c (c.k)}
            <label class="col__r">
              <span>{c.t}</span>
              <input
                type="number"
                step="0.01"
                value={color[c.k]}
                disabled={readOnly}
                oninput={(e) => 设通道(c.k, Number(e.currentTarget.value))}
                aria-label="{entry.name} {c.t} 数值"
              />
              <input
                class="range col__rg"
                type="range"
                min={色范.min}
                max={色范.max}
                step={色范.step}
                value={color[c.k]}
                disabled={readOnly}
                oninput={(e) => 设通道(c.k, Number(e.currentTarget.value))}
                aria-label="{entry.name} {c.t}"
              />
            </label>
          {/each}
        </div>
        {#if hdr}
          <span class="mini">有分量大于 1。取色器只显示 0~1 那段，1 以上的值用数字框调。</span>
        {/if}
      </div>

    {:else if field.kind === 'texture'}
      <div class="tex" data-drop-target="ray:{entry.id}" bind:this={texEl}>
        <span class="mono tex__v" title={value}>{value || '（空）'}</span>
        <div class="acts">
          <button class="btn btn--ghost btn--sm" type="button" disabled={readOnly} onclick={() => onPickTexture?.(entry)}>
            <Icon name="ui.image" size={12} />选贴图
          </button>
          <button class="btn btn--ghost btn--sm" type="button" disabled={readOnly} onclick={() => onValue('""')} title="置空">
            清
          </button>
        </div>
        {#if texCaution}<span class="mini warn">{texCaution}</span>{/if}
      </div>

    {:else if field.kind === 'number'}
      <div class="num">
        <input
          class="range"
          type="range"
          min={范围.min}
          max={范围.max}
          step={范围.step}
          value={Number(value)}
          disabled={readOnly}
          oninput={(e) => onValue(e.currentTarget.value)}
          aria-label={entry.name}
        />
        <input
          type="number"
          step={field.int ? '1' : 'any'}
          value={value}
          disabled={readOnly}
          oninput={(e) => onValue(e.currentTarget.value)}
          aria-label="{entry.name} 数值"
        />
      </div>

    {:else if field.kind === 'expr'}
      <span class="ro mono" title={value}>{value.length > 40 ? value.slice(0, 40) + '…' : value}</span>
      {#if field.why}<span class="mini">{field.why}</span>{/if}

    {:else}
      <input
        type="text"
        value={value}
        disabled={readOnly}
        oninput={(e) => onValue(e.currentTarget.value)}
        aria-label={entry.name}
      />
    {/if}

    {#if field.kind !== 'expr' && entry.value !== value}
      <span class="mini was">原值 <span class="mono">{entry.value}</span></span>
    {/if}
  </div>
</div>

<style>
  .it {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(12rem, 20rem);
    gap: 8px 16px;
    align-items: start;
    padding: 8px 10px;
    border-radius: var(--r-md);
    border-bottom: 1px solid var(--line-divider);
  }
  .it:last-child { border-bottom: 0; }
  .it--changed { background: color-mix(in oklab, var(--primary) 7%, transparent); }
  .it--off { opacity: 0.72; }
  @media (max-width: 900px) {
    .it { grid-template-columns: minmax(0, 1fr); }
  }

  .it__k { min-width: 0; display: grid; gap: 3px; }
  .it__namebtn {
    display: flex;
    align-items: center;
    gap: 5px;
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    cursor: pointer;
    text-align: left;
    color: var(--deep-text);
  }
  .it__namebtn:hover .it__name { color: var(--primary-ink); }
  .it__name { font-size: var(--fs-xs); word-break: break-all; }
  .it__flag {
    flex: none;
    font-size: 10px;
    padding: 1px 5px;
    border-radius: var(--r-full);
    background: var(--surface-3);
    color: var(--content-meta);
  }
  .it__flag--chg { background: var(--rail-item-bg); color: var(--primary-ink); }
  .it__flag--none { background: color-mix(in oklab, var(--warn) 16%, var(--surface-3)); color: var(--warn); }
  .it__brief {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-left: 16px;
  }

  .doc {
    margin: 4px 0 2px 16px;
    padding: 9px 11px;
    border-left: 2px solid var(--line-color);
    display: grid;
    gap: 6px;
  }
  .doc__zh { margin: 0; font-size: var(--fs-xs); line-height: 1.7; color: var(--body-text); }
  .doc__l { margin: 0; font-size: var(--fs-2xs); line-height: 1.65; color: var(--content-meta); }
  .doc__l b { color: var(--body-text); margin-right: 6px; }
  .doc__opts { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
  .doc__opts li {
    display: flex;
    gap: 8px;
    font-size: var(--fs-2xs);
    color: var(--content-meta);
    padding: 1px 3px;
    border-radius: var(--r-sm);
  }
  .doc__opts li.on { background: var(--rail-item-bg); color: var(--deep-text); }
  .doc__opts li span { flex: none; min-width: 1.5rem; color: var(--primary-ink); }
  .doc__meta { margin: 0; font-size: 10px; color: var(--content-meta); opacity: 0.8; }

  .src {
    display: inline-block;
    margin-right: 6px;
    padding: 0 5px;
    border-radius: var(--r-sm);
    font-size: 10px;
    background: var(--surface-3);
    color: var(--content-meta);
  }
  .src--注释 { background: color-mix(in oklab, var(--ok) 20%, var(--surface-3)); color: var(--ok); }
  .src--定义 { background: color-mix(in oklab, var(--primary) 22%, var(--surface-3)); color: var(--primary-ink); }

  .it__v { display: grid; gap: 4px; justify-items: stretch; min-width: 0; }
  .it__v :global(select),
  .it__v :global(input[type='number']),
  .it__v :global(input[type='text']) { width: 100%; }
  .num { display: grid; gap: 5px; }
  .was { text-align: right; }

  .col { display: grid; gap: 6px; }
  .col__sw {
    width: 100%;
    height: 26px;
    padding: 0;
    border: 1px solid var(--line-color);
    border-radius: var(--r-sm);
    background: none;
    cursor: pointer;
  }
  /* 颜色四个分量：字母 | 数字框 | 滑条 —— 三个都能动（规范：数值既能填也能拖） */
  .col__ch { display: grid; gap: 3px; }
  .col__r {
    display: grid;
    grid-template-columns: 12px 4.6rem minmax(3rem, 1fr);
    gap: 5px;
    align-items: center;
    min-width: 0;
  }
  .col__r span { font-size: 10px; color: var(--content-meta); }
  .col__r input[type='number'] { padding: 3px 5px; font-size: var(--fs-2xs); }
  /* 这一条滑条待在网格格子里，不跨整行（全局 `.wb .range` 是"占满一行"的写法） */
  .col__r .col__rg { grid-column: auto; width: 100%; }

  .tex { display: grid; gap: 5px; }
  .tex__v {
    font-size: var(--fs-2xs);
    color: var(--deep-text);
    word-break: break-all;
    padding: 3px 6px;
    border-radius: var(--r-sm);
    background: var(--surface-2);
  }
  .warn { color: var(--warn); }
  .ro { font-size: var(--fs-2xs); color: var(--content-meta); word-break: break-all; }
  .btn--sm { padding: 3px 8px; font-size: var(--fs-2xs); }
</style>
