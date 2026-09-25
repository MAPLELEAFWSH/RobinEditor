<script lang="ts">
  /**
   * 外观面板。浮在右下角，一行一个参数：
   * 滑杆给数值，分段给枚举，开关给开关。
   * 值只往 :root 上写 CSS 变量，长什么样由 tokens.css 决定。
   */
  import Icon from './Icon.svelte';
  import Note from './wb/Note.svelte';
  import { prefs, reset, apply, lowSpec, autoLowSpec, machineHint, save } from '$lib/prefs.svelte';
  import {
    BG_MODES, BG_SCOPES, BG_FITS, BG_POS,
    allBgs, bgUsage, hideBg, showAllBgs, thumbSrc, type BgItem
  } from '$lib/bg';
  import { moveInOrder, nextBgAfter } from '$lib/bg-order';
  import { addMany, remove as removeBg, rename as renameBg } from '$lib/bg-store.svelte';
  import { ELEMENTS } from '$lib/elements';
  import { 翻段落, 引擎填了, 引擎标签, 试句, type 引擎种类 } from '$lib/translate';
  import { translateText } from '$lib/io';
  import { isTauri } from '$lib/open';
  /* 提示条的统一下限：跟侧栏那条错误通道同一个 9 秒（`ui.svelte.ts`） */
  import { 提示自动关毫秒 } from '$lib/ui.svelte';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  /**
   * 「试一下」的结果。
   *
   * 成功也要显示 —— 只报错的话用户不知道它到底通没通；失败则**原样**把引擎的话摆出来
   * （HTTP 码 + 响应体开头），401 / 404 / 连不上各是哪一种一眼能看出。
   */
  let 试 = $state({ busy: false, ok: false, text: '' });

  async function 试一下() {
    试 = { busy: true, ok: false, text: '' };
    if (!isTauri()) {
      试 = { busy: false, ok: false, text: '翻译请求要在桌面端跑。' };
      return;
    }
    const r = await 翻段落(prefs.engine, [试句], (e, texts) => translateText(e, texts));
    if (!r.sent) {
      试 = { busy: false, ok: false, text: '还没填地址和模型名。' };
      return;
    }
    试 = {
      busy: false,
      ok: r.ok,
      text: r.ok ? `通了。${试句} → ${r.translations[0] ?? ''}` : `没通：${r.error ?? '原因不明'}`
    };
  }

  const MOTIONS = [
    { id: 'off', label: '关' },
    { id: 'lite', label: '轻' },
    { id: 'full', label: '全' }
  ] as const;

  const GLASSES = [
    { id: 'lite', label: '轻量', hint: '不加模糊' },
    { id: 'full', label: '模糊', hint: 'backdrop-filter，核显上会掉帧' },
    { id: 'off', label: '关', hint: '不模糊' }
  ] as const;

  /* ---------- 壁纸的增删改 ---------- */
  const list = $derived(allBgs());
  const usage = $derived(bgUsage());
  let importing = $state(false);
  let editing = $state<string | null>(null);
  let editName = $state('');
  let note = $state('');

  async function onFiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    if (!input.files?.length) return;
    importing = true;
    note = '';
    try {
      const added = await addMany(input.files);
      // 新导入的接在末尾，直接选中最后一张 —— 导完就想看效果是常态
      if (added.length) {
        prefs.bgOrder = [...prefs.bgOrder.filter((x) => !added.some((a) => a.id === x)), ...added.map((a) => a.id)];
        pick('bgMode', prefs.bgMode === 'none' || prefs.bgMode === 'native' ? 'solid' : prefs.bgMode);
        pick('bg', added[added.length - 1].id);
        note = `导入了 ${added.length} 张。`;
      }
    } catch (e2) {
      note = `导入失败：${(e2 as Error).message}`;
    }
    importing = false;
    input.value = '';
  }

  function startRename(bg: BgItem) {
    editing = bg.id;
    editName = bg.name;
  }
  async function commitRename() {
    if (editing) await renameBg(editing, editName);
    editing = null;
  }

  /** 从列表里去掉。导入的连数据一起删，内置的只是藏起来 */
  async function drop(bg: BgItem) {
    const wasCurrent = prefs.bg === bg.id;
    const rest = list.filter((x) => x.id !== bg.id).map((x) => x.id);
    if (bg.custom) {
      if (!confirm(`删掉导入的「${bg.name}」？图片数据会一起从本机去掉，不能恢复。`)) return;
      await removeBg(bg.id);
      prefs.bgOrder = prefs.bgOrder.filter((x) => x !== bg.id);
    } else {
      hideBg(bg.id);
    }
    if (wasCurrent) pick('bg', nextBgAfter(rest, bg.id));
    note = '';
  }

  /** 往前/往后挪一格，顺便把完整顺序写进 prefs */
  function shift(id: string, delta: number) {
    const now = list.map((x) => x.id);
    const next = moveInOrder(now, id, delta);
    if (next === now) return;
    // 顺序表里没出现过的补在末尾，否则它们会跑到前面去
    const tail = prefs.bgOrder.filter((x) => !next.includes(x));
    prefs.bgOrder = [...next, ...tail];
  }

  function restoreAll() {
    showAllBgs();
    note = '';
  }

  function setHue(v: number) {
    prefs.hue = v;
    apply();
  }
  function pick<K extends keyof typeof prefs>(k: K, v: (typeof prefs)[K]) {
    prefs[k] = v;
    apply();
  }
</script>

<aside class="sheet glass glass--panel" class:sheet--open={open} aria-label="外观设置" aria-hidden={!open}>
  <header class="sheet__head">
    <Icon name="ui.tune" size={16} />
    <b>外观</b>
    <button class="sheet__x" type="button" aria-label="关闭" onclick={() => (open = false)}>
      <Icon name="ui.close" size={15} />
    </button>
  </header>

  <div class="sheet__body">
    <!-- 主题色 -->
    <div class="row row--stack">
      <div class="row__top">
        <span class="row__k">主题色相</span>
        <span class="row__v">{prefs.hue}</span>
      </div>
      <input
        class="range"
        type="range"
        min="0"
        max="360"
        value={prefs.hue}
        aria-label="主题色相"
        oninput={(e) => setHue(+(e.currentTarget as HTMLInputElement).value)}
        style="--range-hue: {prefs.hue}"
      />
      <div class="swatches">
        {#each ELEMENTS as el (el.id)}
          <button
            class="swatch"
            class:on={prefs.hue === el.hue}
            type="button"
            title={el.name}
            aria-label={el.name}
            style="--sw: {el.c}"
            onclick={() => setHue(el.hue)}
          ></button>
        {/each}
      </div>
      <p class="row__hint">元素色是原神那七个色相，也可以直接拖滑杆自己配。</p>
    </div>

    <!-- 背景 -->
    <div class="row row--stack">
      <div class="row__top"><span class="row__k">背景</span></div>
      <div class="seg seg--wide">
        {#each BG_MODES as m (m.id)}
          <button
            class="seg__b"
            class:on={prefs.bgMode === m.id}
            type="button"
            title={m.hint}
            onclick={() => pick('bgMode', m.id)}
          >{m.label}</button>
        {/each}
      </div>

      {#if prefs.bgMode === 'native'}
        <p class="row__hint">底色渐变加三团极光，跟着主题色走，不带图片。</p>
      {/if}

      {#if prefs.bgMode === 'solid' || prefs.bgMode === 'carousel'}
        <div class="thumbs">
          {#each list as bg, i (bg.id)}
            <div class="thumb-wrap">
              <button
                class="thumb"
                class:on={prefs.bg === bg.id}
                type="button"
                title={bg.name}
                onclick={() => pick('bg', bg.id)}
              >
                <img src={thumbSrc(bg.id)} alt={bg.name} loading="lazy" decoding="async" />
              </button>

              <div class="thumb__ops">
                <button
                  type="button"
                  title="往前挪"
                  aria-label="往前挪"
                  disabled={i === 0}
                  onclick={() => shift(bg.id, -1)}
                >‹</button>
                <button
                  type="button"
                  title="往后挪"
                  aria-label="往后挪"
                  disabled={i === list.length - 1}
                  onclick={() => shift(bg.id, 1)}
                >›</button>
                {#if bg.custom}
                  <button type="button" title="改名" aria-label="改名" onclick={() => startRename(bg)}>✎</button>
                {/if}
                <button type="button" title={bg.custom ? '删除' : '从列表里藏起来'} aria-label="移除" onclick={() => drop(bg)}>✕</button>
              </div>

              {#if editing === bg.id}
                <input
                  class="thumb__edit"
                  bind:value={editName}
                  maxlength="20"
                  aria-label="壁纸名字"
                  onblur={commitRename}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                    if (e.key === 'Escape') editing = null;
                  }}
                />
              {:else}
                <span class="thumb__name">{bg.name}</span>
              {/if}
            </div>
          {/each}

          <!-- 导入 -->
          <label class="thumb thumb--add" title="导入图片">
            {#if importing}
              <span class="thumb__busy">导入中</span>
            {:else}
              <span class="thumb__plus">＋</span>
            {/if}
            <input
              type="file"
              accept="image/*"
              multiple
              hidden
              onchange={onFiles}
            />
          </label>
        </div>

        <div class="bgbar">
          <span class="row__hint">
            显示 {usage.shown} / 共 {usage.total} 张（内置 {usage.builtin}、导入 {usage.custom}{#if usage.hidden}，藏了 {usage.hidden}{/if}）。
          </span>
          {#if usage.hidden > 0}
            <button class="btn btn--ghost btn--sm" type="button" onclick={restoreAll}>
              <Icon name="ui.restore" size={13} />放回藏起来的 {usage.hidden} 张
            </button>
          {/if}
        </div>

        {#if note}<p class="row__hint">{note}</p>{/if}

        <p class="row__hint">
          导入的图会压到宽 1920 再存进本机数据库，跟内置那批一样量亮度来配遮罩。
          内置的是打包在程序里的静态文件，删不掉文件本身，只能从列表里藏起来（✕ 可逆）。
        </p>
      {/if}
    </div>

    {#if prefs.bgMode !== 'none'}
      <!-- 适应方式 -->
      <div class="row row--stack">
        <div class="row__top"><span class="row__k">适应方式</span></div>
        <div class="seg seg--wide">
          {#each BG_FITS as f (f.id)}
            <button
              class="seg__b"
              class:on={prefs.bgFit === f.id}
              type="button"
              title={f.hint}
              onclick={() => pick('bgFit', f.id)}
            >{f.label}</button>
          {/each}
        </div>
        <p class="row__hint">
          {prefs.bgFit === 'cover'
            ? '铺满并裁掉多出来的。壁纸普遍比窗口宽，两侧会切掉一些。'
            : prefs.bgFit === 'blur'
              ? '整张完整显示，空的地方垫一张同一张的模糊放大版。多一层模糊，核显上会掉帧。'
              : prefs.bgFit === 'contain'
                ? '整张完整显示，空的地方露出底色。不裁，但会有边框。'
                : '拉满，不变形就会失真。'}
        </p>
      </div>

      {#if prefs.bgFit === 'cover' || prefs.bgFit === 'blur'}
        <!-- 裁切时保哪一块 -->
        <div class="row row--stack">
          <div class="row__top"><span class="row__k">保住哪一块</span></div>
          <div class="pos">
            {#each BG_POS as p (p.id)}
              <button
                class="pos__b"
                class:on={prefs.bgPos === p.id}
                type="button"
                title={p.label}
                aria-label={p.label}
                onclick={() => pick('bgPos', p.id)}
              ></button>
            {/each}
          </div>
          <p class="row__hint">裁切时从九格里选一块留在画面里。人物偏哪边就选哪边。</p>
        </div>
      {/if}

      <!-- 作用范围 -->
      <div class="row row--stack">
        <div class="row__top"><span class="row__k">铺到哪儿</span></div>
        <div class="seg seg--wide">
          {#each BG_SCOPES as s (s.id)}
            <button
              class="seg__b"
              class:on={prefs.bgScope === s.id}
              type="button"
              title={s.hint}
              onclick={() => pick('bgScope', s.id)}
            >{s.label}</button>
          {/each}
        </div>
        <p class="row__hint">
          {prefs.bgScope === 'work'
            ? '只铺内容区，侧栏、顶栏、尾栏都是实色，挡不到东西。'
            : '铺满整窗，界面改用毛玻璃浮在上面。'}
        </p>
      </div>

      {#if prefs.bgScope === 'full'}
        <div class="row">
          <span class="row__k">毛玻璃</span>
          <div class="seg">
            {#each GLASSES as g (g.id)}
              <button
                class="seg__b"
                class:on={prefs.glass === g.id}
                type="button"
                title={g.hint}
                onclick={() => pick('glass', g.id)}
              >{g.label}</button>
            {/each}
          </div>
        </div>
        <p class="row__hint">
          {prefs.glass === 'full'
            ? '真模糊。每个玻璃元素每帧都要重新模糊背后，核显上很痛。'
            : prefs.glass === 'lite'
              ? '不加模糊，只有半透明底加一道内高光。不吃光栅化，观感也是雾面。'
              : '界面实色。'}
        </p>
      {/if}
    {/if}

    <div class="row">
      <span class="row__k">壁纸不透明度</span>
      <input
        class="range range--short"
        type="range"
        min="0"
        max="100"
        value={prefs.bgOpacity}
        aria-label="壁纸不透明度"
        oninput={(e) => pick('bgOpacity', +(e.currentTarget as HTMLInputElement).value)}
      />
      <span class="row__v">{prefs.bgOpacity}</span>
    </div>

    {#if prefs.bgMode === 'carousel'}
      <div class="row">
        <span class="row__k">轮放间隔</span>
        <input
          class="range range--short"
          type="range"
          min="4"
          max="60"
          step="1"
          value={prefs.bgEvery}
          aria-label="壁纸轮放间隔"
          oninput={(e) => pick('bgEvery', +(e.currentTarget as HTMLInputElement).value)}
        />
        <span class="row__v">{prefs.bgEvery}s</span>
      </div>
    {/if}

    <!-- 不透明度：一层一个滑杆，从卡片到四周框架都能调 -->
    <div class="group">
      <div class="group__h">不透明度</div>

      {#each [
        { k: 'cardOpacity', label: '卡片', min: 30, hint: '卡片和它里面的嵌套面' },
        { k: 'sideOpacity', label: '侧栏', min: 20 },
        { k: 'barOpacity', label: '顶栏', min: 20 },
        { k: 'sbOpacity', label: '尾栏', min: 20 },
        { k: 'panelOpacity', label: '设置面板', min: 40 }
      ] as it (it.k)}
        <div class="row">
          <span class="row__k">{it.label}</span>
          <input
            class="range range--short"
            type="range"
            min={it.min}
            max="100"
            value={prefs[it.k as keyof typeof prefs] as number}
            aria-label="{it.label}不透明度"
            oninput={(e) =>
              pick(it.k as 'cardOpacity', +(e.currentTarget as HTMLInputElement).value)}
          />
          <span class="row__v">{prefs[it.k as keyof typeof prefs] as number}</span>
        </div>
      {/each}

      {#if prefs.cardOpacity < 70}
        <p class="row__hint row__hint--warn">
          卡片这么透，壁纸会从字底下穿过来。衬底想压住就配「模糊补边」或深色主题。
        </p>
      {/if}
      <p class="row__hint">
        卡片管内容区，另外三个管四周的框架。想整片玻璃感就把它们一起往下拉，
        再开「模糊」。
      </p>
    </div>

    <div class="row">
      <span class="row__k">卡片描边</span>
      <div class="seg">
        <button class="seg__b" class:on={prefs.cardBorder} type="button" onclick={() => pick('cardBorder', true)}>开</button>
        <button class="seg__b" class:on={!prefs.cardBorder} type="button" onclick={() => pick('cardBorder', false)}>关</button>
      </div>
    </div>

    <div class="row">
      <span class="row__k">壁纸柔化</span>
      <div class="seg">
        <button class="seg__b" class:on={prefs.soften} type="button" onclick={() => pick('soften', true)}>开</button>
        <button class="seg__b" class:on={!prefs.soften} type="button" onclick={() => pick('soften', false)}>关</button>
      </div>
    </div>
    <p class="row__hint">默认关。全屏图上挂模糊会多走一遍光栅化，帧时间差不多翻倍。</p>

    <div class="row">
      <span class="row__k">动效</span>
      <div class="seg">
        {#each MOTIONS as m (m.id)}
          <button class="seg__b" class:on={prefs.motion === m.id} type="button" onclick={() => pick('motion', m.id)}>
            {m.label}
          </button>
        {/each}
      </div>
    </div>

    <div class="row">
      <span class="row__k">尾栏帧率</span>
      <div class="seg">
        <button class="seg__b" class:on={prefs.fpsLive} type="button" onclick={() => pick('fpsLive', true)}>开</button>
        <button class="seg__b" class:on={!prefs.fpsLive} type="button" onclick={() => pick('fpsLive', false)}>关</button>
      </div>
    </div>
    <p class="row__hint">关掉就不再逐帧采样，笔记本上省电。</p>

    <div class="row">
      <span class="row__k">低配档</span>
      <button class="btn btn--ghost" type="button" onclick={() => lowSpec()}>
        <Icon name="ui.speed" size={14} />一键低配
      </button>
    </div>
    <p class="row__hint">
      一起拨这五项：动效轻、毛玻璃关、背景换纯代码、壁纸柔化关、尾栏帧率关。
      每一项上面都能再单独调回来。老机器或核显上最值得先按这个。
    </p>
    {#if autoLowSpec.used}
      <p class="row__hint">
        这台机器是 {machineHint().cores || '?'} 核{machineHint().mem ? ` / 内存档 ${machineHint().mem} GB` : ''}，
        第一次打开时自动按低配档起的。想要壁纸就在上面把背景调回去。
      </p>
    {/if}

    <button class="sheet__reset" type="button" onclick={() => { reset(); open = true; }}>
      <Icon name="ui.restore" size={14} />恢复默认
    </button>

    <!-- ① 的翻译引擎。放在这一栏是因为整个工具只有这一处"设置"面板 -->
    <div class="row row--stack">
      <div class="row__top"><span class="row__k">翻译引擎（① 日文那个功能用）</span></div>
      <div class="pick">
        {#each ([['mymemory', 'MyMemory（默认）'], ['custom', '自定义'], ['off', '离线']] as [引擎种类, string][]) as [id, 名] (id)}
          <button class="btn btn--ghost btn--sm" type="button" aria-pressed={prefs.engine.kind === id}
            onclick={() => { prefs.engine.kind = id; 试.text = ''; save(); }}>{名}</button>
        {/each}
      </div>

      {#if prefs.engine.kind === 'mymemory'}
        <p class="row__hint">
          免费公开的翻译接口，<b>不用填任何东西</b>就能用。匿名有每日额度，
          用满了它会回一句"今天的免费翻译用完了"（原话会摆在下边），那就要等明天，或者换成自定义引擎。
          请求只发到 <span class="mono">api.mymemory.translated.net</span>。
        </p>
      {:else if prefs.engine.kind === 'custom'}
        <input class="eng__in" type="text" bind:value={prefs.engine.baseUrl}
          placeholder="http://127.0.0.1:11434/v1" aria-label="引擎地址" oninput={save} />
        <input class="eng__in" type="text" bind:value={prefs.engine.model}
          placeholder="模型名，例如 qwen2.5:7b" aria-label="模型名" oninput={save} />
        <input class="eng__in" type="password" bind:value={prefs.engine.apiKey}
          placeholder="Key（本机服务一般留空）" aria-label="Key" oninput={save} />
      {:else}
        <p class="row__hint row__hint--warn">
          离线：<b>一条请求都不发</b>。① 只做乱码还原 + 术语替换 —— 术语替换<b>不是翻译</b>，
          句子的语法不动，没被词表盖住的日文原样留着。
        </p>
      {/if}

      {#if prefs.engine.kind !== 'off'}
        <div class="row">
          <span class="row__k">超时</span>
          <input class="range range--short" type="range" min="5" max="180" step="5"
            value={prefs.engine.timeoutMs / 1000}
            aria-label="超时秒数"
            oninput={(e) => { prefs.engine.timeoutMs = +e.currentTarget.value * 1000; save(); }} />
          <span class="row__v">{Math.round(prefs.engine.timeoutMs / 1000)}s</span>
        </div>
      {/if}

      <div class="acts">
        <button class="btn btn--ghost btn--sm" type="button"
          disabled={试.busy || !引擎填了(prefs.engine)} onclick={试一下}>
          <Icon name="ui.run" size={13} />{试.busy ? '发着呢…' : '试一下'}
        </button>
        <span class="mini mut">{引擎标签(prefs.engine)}</span>
      </div>
      {#if 试.text}
        <Note kind={试.ok ? 'ok' : 'warn'} onclose={() => (试.text = '')} 自动关={提示自动关毫秒}>{试.text}</Note>
      {/if}
      <p class="row__hint" class:row__hint--warn={!引擎填了(prefs.engine)}>
        请求只在你在 ① 那页打开「再翻成中文」时发出（那个开关默认关着），
        并且只发到你选的这个引擎。乱码还原与批量那两页本来就不用联网。
      </p>
    </div>
  </div>
</aside>

<style>
  .sheet {
    position: fixed;
    right: var(--edge);
    /* 底边 = 状态栏 + 间隙 + 球列高度 + 间隙。
       以前面板和球写在同一个 bottom 上，面板一打开就把球盖住，
       想再点一次球关掉都点不到 —— 那正是"图层重叠摆放错误"。 */
    bottom: calc(var(--status-h) + var(--fab-gap) + var(--fab-stack) + var(--fab-gap));
    z-index: var(--z-sheet);
    width: 20rem;
    max-height: calc(
      100vh - var(--status-h) - var(--fab-stack) - var(--fab-gap) * 4
    );
    display: flex;
    flex-direction: column;
    border-radius: var(--card-radius);
    border: var(--card-border);
    background: var(--sheet-bg);
    box-shadow: var(--card-shadow-hover);
    overscroll-behavior: contain;
    opacity: 0;
    visibility: hidden;
    transform: translateY(14px) scale(0.96);
    transform-origin: bottom right;
    transition:
      opacity var(--t-micro) var(--ease-std),
      transform var(--t-enter) var(--ease-std),
      visibility 0s linear var(--t-micro);
  }
  .sheet--open {
    opacity: 1;
    visibility: visible;
    transform: none;
    transition-delay: 0s;
  }

  .sheet__head {
    display: flex; align-items: center; gap: 8px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--line-divider);
    color: var(--deep-text);
    flex: none;
  }
  .sheet__head b { font-size: 14px; }
  .sheet__x {
    margin-left: auto; display: grid; place-items: center;
    width: 24px; height: 24px; border: 0; border-radius: var(--r-md);
    background: transparent; color: var(--content-meta); cursor: pointer;
    transition: background var(--t-micro) var(--ease-std), color var(--t-micro) var(--ease-std);
  }
  .sheet__x:hover { background: var(--rail-item-hover); color: var(--deep-text); }

  .sheet__body {
    padding: 12px 14px 14px;
    overflow-y: auto;
    display: flex; flex-direction: column; gap: 11px;
  }

  .row { display: flex; align-items: center; gap: 8px; }
  .row--stack { flex-direction: column; align-items: stretch; gap: 8px; }

  /* 一组参数外面套个浅底，跟相邻的组分开 */
  .group {
    display: flex; flex-direction: column; gap: 9px;
    padding: 10px 11px;
    border: 1px solid var(--line-divider);
    border-radius: var(--r-lg);
    background: var(--surface-2);
  }
  .group__h {
    font-size: var(--fs-2xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--content-meta);
    text-transform: uppercase;
  }
  .group .row__hint { padding: 0; }
  .row__top { display: flex; align-items: baseline; justify-content: space-between; }
  .row__k { font-size: 12.5px; color: var(--body-text); flex: none; }
  .row__v {
    margin-left: auto;
    font-family: var(--font-mono); font-size: 11.5px;
    color: var(--btn-content); font-weight: 600;
  }
  .row__hint {
    margin: 0;
    font-size: 11px; line-height: 1.6; color: var(--content-meta);
  }
  .row__hint--warn {
    color: var(--warn);
    padding: 6px 8px;
    border-radius: var(--r-sm);
    background: color-mix(in oklab, var(--warn) 12%, transparent);
  }

  /* 翻译引擎那三栏输入框 */
  .eng__in {
    width: 100%;
    padding: 6px 9px;
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--btn-regular-bg);
    color: var(--body-text);
    font: inherit;
    font-size: 12px;
  }
  .eng__in + .eng__in { margin-top: 6px; }
  .eng__in::placeholder { color: var(--content-meta); }

  .range {
    appearance: none;
    width: 100%; height: 18px;
    background: transparent; cursor: pointer;
  }
  .range--short { width: 7.5rem; margin-left: auto; }
  .range::-webkit-slider-runnable-track {
    height: 5px; border-radius: var(--r-full);
    background: linear-gradient(
      90deg,
      var(--rail-item-active),
      var(--primary)
    );
  }
  .range::-webkit-slider-thumb {
    appearance: none;
    width: 15px; height: 15px; margin-top: -5px;
    border-radius: 50%;
    background: var(--primary);
    border: 2px solid var(--card-bg);
    box-shadow: var(--shadow-sm);
    transition: transform var(--t-micro) var(--ease-std);
  }
  .range:hover::-webkit-slider-thumb { transform: scale(1.15); }
  .range:active::-webkit-slider-thumb { transform: scale(0.96); }

  .swatches { display: flex; gap: 6px; }
  .swatch {
    width: 22px; height: 22px; padding: 0;
    border: 2px solid transparent;
    border-radius: 50%;
    background: var(--sw);
    cursor: pointer;
    box-shadow: var(--shadow-sm);
    transition: transform var(--t-micro) var(--ease-std), border-color var(--t-micro) var(--ease-std);
  }
  .swatch:hover { transform: translateY(-2px) scale(1.08); }
  .swatch.on { border-color: var(--deep-text); }

  .thumbs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }

  .thumb-wrap { position: relative; }
  .thumb-wrap .thumb { width: 100%; }

  /* 挪顺序 / 改名 / 移除，鼠标移上去才出。四张一排，按钮摞不下就换两行 */
  .thumb__ops {
    position: absolute;
    top: 3px; right: 3px;
    display: flex;
    flex-wrap: wrap-reverse;
    justify-content: flex-end;
    max-width: 40px;
    gap: 2px;
    opacity: 0;
    transition: opacity var(--t-micro) var(--ease-std);
  }
  .thumb-wrap:hover .thumb__ops,
  .thumb-wrap:focus-within .thumb__ops { opacity: 1; }
  .thumb__ops button {
    width: 18px; height: 18px;
    display: grid; place-items: center;
    padding: 0;
    border: 0; border-radius: var(--r-sm);
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 11px; line-height: 1;
    cursor: pointer;
  }
  .thumb__ops button:hover:not(:disabled) { background: rgba(0, 0, 0, 0.78); }
  .thumb__ops button:disabled { opacity: 0.3; cursor: default; }

  /* 显示几张 / 放回藏起来的那一排 */
  .bgbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }
  .btn--sm { padding: 3px 8px; font-size: 11px; gap: 4px; }

  .thumb__name {
    position: absolute; left: 0; right: 0; bottom: 0;
    padding: 2px 0;
    font-size: 10px; text-align: center;
    background: rgba(0, 0, 0, 0.45); color: #fff;
    pointer-events: none;
  }
  .thumb__edit {
    position: absolute; left: 0; right: 0; bottom: 0;
    width: 100%;
    padding: 1px 4px;
    border: 0;
    background: var(--card-bg);
    color: var(--deep-text);
    font: inherit; font-size: 10px; text-align: center;
    outline: 2px solid var(--accent-solid);
  }

  .thumb--add {
    display: grid;
    place-items: center;
    border: 1px dashed var(--line-color);
    background: transparent;
    cursor: pointer;
  }
  .thumb--add:hover { background: var(--surface-3); border-color: var(--accent-solid); }
  .thumb__plus { font-size: 20px; color: var(--content-meta); line-height: 1; }
  .thumb__busy { font-size: 10px; color: var(--content-meta); }

  /* 3×3 的定位格。每个格子对应 object-position 的一个组合 */
  .pos {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3px;
    width: 84px;
    padding: 3px;
    border-radius: var(--r-md);
    background: var(--surface-2);
  }
  .pos__b {
    aspect-ratio: 1;
    border: 0;
    border-radius: var(--r-sm);
    background: var(--surface-3);
    cursor: pointer;
    transition: background var(--t-micro) var(--ease-std), transform var(--t-press) var(--ease-std);
  }
  .pos__b:hover { background: color-mix(in oklab, var(--primary) 30%, var(--surface-3)); }
  .pos__b:active { transform: scale(0.9); }
  .pos__b.on {
    background: var(--accent-solid);
  }
  .thumb {
    position: relative; padding: 0; overflow: hidden;
    aspect-ratio: 4 / 3;
    border: 2px solid transparent;
    border-radius: var(--r-md);
    background: none; cursor: pointer;
    transition: transform var(--t-micro) var(--ease-std), border-color var(--t-micro) var(--ease-std);
  }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .thumb:hover { transform: translateY(-2px); }
  .thumb.on { border-color: var(--accent-solid); }

  .seg {
    display: inline-flex; gap: 3px; margin-left: auto;
    padding: 3px; border-radius: var(--r-md);
    background: var(--surface-2);
  }
  .seg--wide { margin-left: 0; }
  .seg--wide .seg__b { flex: 1 1 0; }
  .seg__b {
    padding: 4px 10px;
    border: 0; border-radius: var(--r-sm);
    background: transparent; color: var(--content-meta);
    font: inherit; font-size: 12px; cursor: pointer;
    transition: background var(--t-micro) var(--ease-std), color var(--t-micro) var(--ease-std);
  }
  .seg__b:hover { background: var(--rail-item-hover); color: var(--deep-text); }
  /* 选中的那一格**不加粗**（2026-09-23 统一口径）。这里原来确实是 400→600 的真变化：
     `.seg--wide` 每格是 `flex: 1 1 0` 等宽，邻座不会被推走，但**选中那颗的字会在格子里
     重新居中**（左右各挪一两个像素）。跟 ① 的 `.pick__b`（那个把整排横挪了 3.15px）
     统一去掉加粗，选中靠底色 + 描边 + 阴影。 */
  .seg__b.on {
    background: var(--card-bg);
    box-shadow: var(--shadow-sm), inset 0 0 0 1px var(--line-divider);
    color: var(--btn-content);
  }

  .sheet__reset {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    margin-top: 2px; padding: 7px;
    border: 1px solid var(--line-divider); border-radius: var(--r-md);
    background: transparent; color: var(--content-meta);
    font: inherit; font-size: 12.5px; cursor: pointer;
    transition: background var(--t-micro) var(--ease-std), color var(--t-micro) var(--ease-std);
  }
  .sheet__reset:hover { background: var(--rail-item-hover); color: var(--deep-text); }

  @media (max-width: 620px) {
    .sheet { left: 0.9rem; width: auto; }
  }
</style>
