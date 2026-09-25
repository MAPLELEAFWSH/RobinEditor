<script lang="ts">
  /**
   * 通道提取 —— 从一张图里认出"哪一路装的是什么"，然后提出来。
   *
   * 这里的每一条都基于实测，不是按文件名拍脑袋。依据在 `$lib/channel-facts.ts`：
   * 扫过 43,440 张真图，量的是**透明通道里到底有没有东西**。
   *
   * 最重要的一条：**法线图的 alpha 有 55% 藏着数据**（全库最强），
   * 那通常就是光泽/平滑度。所以法线进来先检测、有才让你提。
   *
   * 「先检测再提示」这条是用户定的：不按后缀硬认。
   * 原因也实测过 —— `_D` 14%、`_D1` 11%、`_D2` 12%，三个变体差不了多少，
   * 光看文件名判断不出哪张带数据。硬认的话遇到那 86% 没数据的会提一张全白。
   */
  import { Slots, outPathNear } from '$lib/wb.svelte';
  import {
    type ChannelKey,
    CHANNEL_KEYS,
    CHANNEL_LABEL,
    extractChannel,
    grayToImageData,
    imageDataToUrl,
    previewOf,
    resize,
    预览长边
  } from '$lib/img';
  import {
    type AlphaVerdict,
    analyzeAlpha,
    glossFromAlpha,
    mapFromChannel,
    readMaterialIds,
    splitById,
    type MaterialId
  } from '$lib/texops';
  import { saveImage, pickSavePath } from '$lib/io';
  import { baseName } from '$lib/outpath';
  import Note from '$lib/components/wb/Note.svelte';
  import { 提示自动关毫秒 } from '$lib/ui.svelte';
  import Slot from '$lib/components/wb/Slot.svelte';
  import Icon from '$lib/components/Icon.svelte';

  /* 预览按预览台的实际宽度算（见 img.ts 的 预览长边）。取通道/取遮罩这条路很便宜，用默认上限 */
  const PREVIEW = 预览长边();
  /** 全尺寸运算前让出一帧，好让"算中…"先画出来 */
  const 让帧 = () => new Promise((r) => setTimeout(r, 0));
  const slots = new Slots('channels.extract', [
    { id: 'src', label: '源图' },
    { id: 'idmap', label: '材质 ID 图' }
  ]);

  let msg = $state<{ kind: 'ok' | 'warn' | 'info'; text: string } | null>(null);
  let busy = $state(false);

  /* ---------------- 透明通道检测 ---------------- */

  let verdict = $state<AlphaVerdict | null>(null);
  let glossUrl = $state<string | null>(null);
  let invert = $state(false);

  const src = $derived(slots.get('src'));

  /**
   * 换图就重新检测。检测本身很快（一遍直方图），2048² 也就几毫秒。
   *
   * **这里不许再读回 `verdict`。** 改前是写完 `verdict` 紧接着读自己的 `verdict.rich`，
   * 于是这个 effect 依赖了自己的产物，而 `analyzeAlpha` 每次给的是**新对象** ——
   * 身份一直变，就一路重跑到 Svelte 抛 `effect_update_depth_exceeded`：
   * 载入一张透明通道有层次的贴图冻 3.97 秒，之后整页点不动（用户 2026-09-23 报的"卡死"）。
   * 用局部变量 `v` 判断、`verdict` 只写不读，就没有这条自环了。
   */
  $effect(() => {
    const img = src.data;
    const 反相 = invert;
    if (!img) {
      verdict = null;
      glossUrl = null;
      return;
    }
    const v = analyzeAlpha(img);
    verdict = v;
    // 只有真有数据才生成预览，没数据就不做了 —— 提出来是一张全白，没意义
    glossUrl = v.rich ? imageDataToUrl(glossFromAlpha(previewOf(img, PREVIEW), 反相)) : null;
  });

  /** 换个反相方向要重算预览 */
  $effect(() => {
    void invert;
    const img = src.data;
    if (!img || !verdict?.rich) return;
    glossUrl = imageDataToUrl(glossFromAlpha(previewOf(img, PREVIEW), invert));
  });

  /**
   * 导出该往哪写。
   *
   * **没有真路径时不许拼相对路径**：「拿去当源图」放进来的那张只在内存里
   * （`slots.set('src', { path: '内存/MatID3.png' … })` 那条假路径），
   * 拿它拼出来的是 `内存/MatID3_Gloss.png` —— 相对路径一路交到 Rust，
   * `write_rgba_image` 还会 `create_dir_all(parent)`，于是产物写进**应用进程的当前目录**、
   * 在那儿建一个 `内存\` 文件夹，而提示语只说"写了 MatID3_Gloss.png"，用户按名字在源图旁边
   * 永远找不到（2026-09-25 只读审查量出来的）。那种情况直接弹保存框问用户。
   */
  async function 导出去哪(suffix: string, 兜底名: string): Promise<string | null> {
    const 真路径 = src.ref?.path?.trim() ?? '';
    if (真路径) return outPathNear(src, suffix);
    return await pickSavePath(兜底名);
  }

  async function exportGloss() {
    if (!src.data) return;
    busy = true;
    msg = null;
    try {
      const out = glossFromAlpha(src.data, invert);
      const suffix = invert ? '_Roughness' : '_Gloss';
      const path = await 导出去哪(suffix, `gloss${suffix}.png`);
      if (!path) {
        msg = { kind: 'warn', text: '没选保存位置，什么都没写。' };
        busy = false;
        return;
      }
      await saveImage(path, out);
      msg = { kind: 'ok', text: `写了 ${baseName(path)}（${out.width}×${out.height}）` };
    } catch (e) {
      msg = { kind: 'warn', text: `导出失败：${(e as Error).message}` };
    }
    busy = false;
  }

  /* ---------------- 单通道提灰度 ---------------- */

  let pickCh = $state<ChannelKey>('g');
  let chInvert = $state(false);
  let chUrl = $state<string | null>(null);

  $effect(() => {
    void pickCh;
    void chInvert;
    const img = src.data;
    if (!img) {
      chUrl = null;
      return;
    }
    chUrl = imageDataToUrl(mapFromChannel(previewOf(img, PREVIEW), pickCh, chInvert));
  });

  async function exportChannel() {
    if (!src.data) return;
    busy = true;
    msg = null;
    try {
      const out = mapFromChannel(src.data, pickCh, chInvert);
      const suffix = `_${CHANNEL_LABEL[pickCh]}${chInvert ? 'inv' : ''}`;
      const path = await 导出去哪(suffix, `chan${suffix}.png`);
      if (!path) {
        msg = { kind: 'warn', text: '没选保存位置，什么都没写。' };
        busy = false;
        return;
      }
      await saveImage(path, out);
      msg = { kind: 'ok', text: `写了 ${baseName(path)}` };
    } catch (e) {
      msg = { kind: 'warn', text: `导出失败：${(e as Error).message}` };
    }
    busy = false;
  }

  /* ---------------- 材质 ID ---------------- */

  const idSrc = $derived(slots.get('idmap'));
  let idChannel = $state<ChannelKey>('r');
  let ids = $state<MaterialId[]>([]);
  /** 降采样过的那张 ID 图：遮罩预览在它上面抠，4K 也只要几毫秒 */
  let 小ID图 = $state<ImageData | null>(null);
  let selUrl = $state<string | null>(null);
  let selected = $state<number | null>(null);

  /**
   * 预览遮罩的缓存。**故意不是 `$state`** —— 它只是省一遍像素，
   * 让它参与响应式就变成"effect 读自己写的东西"，那种自环 2026-09-23 刚栽过一次。
   */
  const 小遮罩缓存 = new Map<string, ImageData>();

  /** 抠某一号的小遮罩（在降采样那张上抠） */
  function 小遮罩(编号: number, 路: ChannelKey): ImageData | null {
    const 小 = 小ID图;
    if (!小) return null;
    const k = `${编号}:${路}:${小.width}x${小.height}`;
    let m = 小遮罩缓存.get(k);
    if (!m) {
      m = splitById(小, [编号], 路).get(编号)!;
      小遮罩缓存.set(k, m);
    }
    return m;
  }

  /**
   * 全尺寸遮罩：**只在"写盘 / 拿去当源图"那一刻抠一张，抠完就丢**。
   * 不缓存 —— 一张 4K 的遮罩就是 67MB，攒几张就把内存吃光。
   */
  function 全尺寸遮罩(编号: number, 路: ChannelKey): ImageData | null {
    const 图 = idSrc.data;
    return 图 ? splitById(图, [编号], 路).get(编号)! : null;
  }

  /** ID 图的预览图。**必须 nearest** —— 插值会把两个编号混成第三个，认出来的编号全是假的 */
  function 降采样(图: ImageData): ImageData {
    const 长边 = Math.max(图.width, 图.height);
    if (长边 <= PREVIEW) return 图;
    const k = PREVIEW / 长边;
    return resize(图, Math.max(1, Math.round(图.width * k)), Math.max(1, Math.round(图.height * k)), 'nearest');
  }

  /**
   * 换图 / 换通道就重新数一遍编号。**只数，不建遮罩。**
   *
   * 原来这里 `splitById(img, 全部编号, …)` 把每一号都做成一张**全尺寸**遮罩：
   * 4K 的 ID 图十来种材质 = 十来遍全图 + 十来张 67MB 的图。实测载入冻
   * 1024² **813ms**、2048² **3389ms**（照面积涨，4K 约 13 秒）。
   * 而"数编号"本身只是一遍 256 格直方图，几毫秒。
   * 所以遮罩改成**看哪张抠哪张**：预览在降采样那张上抠，导出时才按全尺寸抠。
   */
  $effect(() => {
    const img = idSrc.data;
    const 路 = idChannel;
    小遮罩缓存.clear();
    if (!img) {
      ids = [];
      小ID图 = null;
      selected = null;
      return;
    }
    const 找到 = readMaterialIds(img, 路);
    ids = 找到;
    小ID图 = 降采样(img);
    // 用局部那份，别读回 `ids` —— 读回来就是"effect 读自己写的东西"，那正是上面那条自环
    selected = 找到[0]?.id ?? null;
  });

  /** 选中哪一号，就把它的遮罩预览画出来 */
  $effect(() => {
    const 编号 = selected;
    const 路 = idChannel;
    void 小ID图;
    const m = 编号 === null ? null : 小遮罩(编号, 路);
    selUrl = m ? imageDataToUrl(m) : null;
  });

  /** 每个材质给一个颜色，跟参考稿里的"材质糖果罐"一个意思 */
  function idColor(i: number) {
    return `oklch(0.66 0.12 ${(i * 47) % 360})`;
  }

  async function exportMask(id: number) {
    if (!idSrc.data || !idSrc.ref) {
      msg = { kind: 'info', text: '带个源文件路径才能写到它旁边。' };
      return;
    }
    busy = true;
    try {
      // 全尺寸抠一张也要几百毫秒；先让出一帧，"算中…"才画得出来
      await 让帧();
      const m = 全尺寸遮罩(id, idChannel);
      if (!m) {
        msg = { kind: 'warn', text: '源图不在了，重新放一张再试。' };
        return;
      }
      const suffix = `_MatID${id}`;
      const name = baseName(outPathNear(idSrc, suffix)) || 'mask.png';
      await saveImage(outPathNear(idSrc, suffix), m);
      msg = { kind: 'ok', text: `写了 ${name}（占 ${(ids.find((x) => x.id === id)?.share ?? 0) * 100}% 面积）` };
    } catch (e) {
      msg = { kind: 'warn', text: `导出失败：${(e as Error).message}` };
    } finally {
      // 走在 finally 里：上面那条提前 return 也要把按钮放开，不然它一直禁用
      busy = false;
    }
  }

  async function exportAllMasks() {
    if (!idSrc.data || !idSrc.ref) {
      msg = { kind: 'info', text: '带个源文件路径才能写到它旁边。' };
      return;
    }
    busy = true;
    let n = 0;
    try {
      // 逐张抠、逐张写：每张之间让一帧，进度看得见，界面也不会僵住
      for (const it of ids) {
        msg = { kind: 'info', text: `正在抠第 ${n + 1}/${ids.length} 张（编号 ${it.id}）…` };
        await 让帧();
        const m = 全尺寸遮罩(it.id, idChannel);
        if (!m) break;
        await saveImage(outPathNear(idSrc, `_MatID${it.id}`), m);
        n++;
      }
      msg = { kind: 'ok', text: `写了 ${n} 张遮罩` };
    } catch (e) {
      msg = { kind: 'warn', text: `写到第 ${n + 1} 张失败：${(e as Error).message}` };
    }
    busy = false;
  }

  /** 送进图层栈当蒙版用 —— 之后接图层那套 */
  async function useAsMask(id: number) {
    if (!idSrc.data) return;
    busy = true;
    await 让帧(); // 全尺寸抠一张是几百毫秒，先让界面把"算中…"画出来
    const m = 全尺寸遮罩(id, idChannel);
    busy = false;
    if (!m) return;
    slots.set('src', { path: `内存/MatID${id}.png`, name: `MatID${id}`, rel: '', ext: 'png', size: 0 }, m);
    selected = id;
    msg = { kind: 'info', text: `把 MatID${id} 放到左边当源图了，可以直接拿去提取或调。` };
  }
</script>

<div class="wb">
  <div class="wb__main">
    <div class="card pad">
      <div class="slots">
        <Slot
          label="源图"
          url={src.url}
          name={src.ref?.name}
          meta={src.srcFormat ? `${src.size} · ${src.srcFormat}` : src.size}
          onpick={() => slots.pick('src')}
          onclear={() => slots.clear('src')}
          ondropfile={(f) => slots.loadFile('src', f)}
          slot={{ group: slots, id: 'src' }}
        />
      </div>

      {#if verdict}
        <div class="msgwrap">
          <Note kind={verdict.rich ? 'ok' : 'info'}>
            <b>透明通道检测：</b>{verdict.verdict}
          </Note>
        </div>
      {/if}
    </div>

    {#if src.data}
      <div class="card pad">
        <div class="row" style="margin-bottom:10px">
          <span class="row__k">
            {#if verdict?.rich}
              从透明通道提出来
            {:else}
              透明通道没数据，换个来源
            {/if}
          </span>
          <div class="pick" style="width:16rem">
            <button class="pick__b" type="button" aria-pressed={!invert} onclick={() => (invert = false)}>当光泽</button>
            <button class="pick__b" type="button" aria-pressed={invert} onclick={() => (invert = true)}>当粗糙</button>
          </div>
        </div>

        {#if verdict?.rich && glossUrl}
          <div class="duo">
            <figure>
              <img src={glossUrl} alt="" />
              <figcaption class="mini">{invert ? '粗糙度（已反相）' : '光泽 / 平滑度'}</figcaption>
            </figure>
            {#if chUrl}
              <figure>
                <img src={chUrl} alt="" />
                <figcaption class="mini">另一条路：单通道 {CHANNEL_LABEL[pickCh]}{chInvert ? '（反相）' : ''}</figcaption>
              </figure>
            {/if}
          </div>
        {:else if chUrl}
          <div class="stage">
            <img src={chUrl} alt="" />
            <span class="stage__tag">单通道 {CHANNEL_LABEL[pickCh]}{chInvert ? ' 反相' : ''}</span>
          </div>
        {/if}
      </div>
    {:else}
      <Note>
        放一张图进来。法线图优先 —— 实测 <b>55% 的法线图在透明通道里藏了光泽/平滑度图</b>，
        是全库里最值得提的一路。基础色图只有 14% 有，所以这里先检测再告诉你有没有。
      </Note>
    {/if}

    {#if idSrc.data && ids.length}
      <div class="card pad">
        <h3 class="h3">材质 ID 图里有 {ids.length} 种材质</h3>
        <p class="mini" style="margin-bottom:10px">
          ID 图不能直接拿去调色 —— 值本身是"编号"不是"亮度"，取平均值没有意义。
          先按编号拆成一张张遮罩，再拿去当蒙版。
        </p>
        <div class="candy">
          {#each ids as m, i (m.id)}
            <button
              class="candy__it"
              class:is-on={selected === m.id}
              type="button"
              style="--c:{idColor(i)}"
              onclick={() => (selected = m.id)}
              title="编号 {m.id}，占 {(m.share * 100).toFixed(1)}%"
            >
              <i class="candy__dot"></i>
              <b>{m.id}</b>
              <span>{(m.share * 100).toFixed(1)}%</span>
            </button>
          {/each}
        </div>
        {#if selUrl}
          <div class="stage" style="margin-top:12px">
            <img src={selUrl} alt="" />
            <span class="stage__tag">编号 {selected}</span>
          </div>
        {/if}
      </div>
    {/if}

    <div class="wb__acts">
      {#if ids.length}<span class="mini mut">ID 图里有 {ids.length} 种材质。</span>{/if}
      {#if selected !== null}
        <button class="btn btn--ghost" disabled={busy} onclick={() => exportMask(selected!)}>
          只导这一张
        </button>
        <button class="btn btn--ghost" onclick={() => useAsMask(selected!)}>拿去当源图</button>
      {/if}
      <button class="btn btn--primary" disabled={busy || !ids.length} onclick={exportAllMasks}>
        <Icon name="ui.export" size={15} />全部导出
      </button>
    </div>
  </div>

  <aside class="card wb__side">
    <div class="grp">
      <h3 class="grp__t">单通道提取</h3>
      <div class="pick">
        {#each CHANNEL_KEYS as k (k)}
          <button class="pick__b" type="button" aria-pressed={pickCh === k} onclick={() => (pickCh = k)}>
            {CHANNEL_LABEL[k]}
          </button>
        {/each}
      </div>
      <label class="chk" style="margin-top:8px">
        <input type="checkbox" bind:checked={chInvert} />
        <span class="chk__box"></span>反相
      </label>
      <p class="mini" style="margin-top:8px">
        从任意一路提成灰度。绝区零那套的金属度就在附属数据图的 RGB 里
        —— Unity 槽名是 <span class="mono">_OtherDataTex</span>（文件名 `_M`）。
      </p>
      <button class="btn btn--ghost btn--sm" type="button" style="margin-top:8px" disabled={!src.data || busy} onclick={exportChannel}>
        导出这一路
      </button>
      {#if verdict?.rich}
        <button class="btn btn--ghost btn--sm" type="button" style="margin-top:6px" disabled={busy} onclick={exportGloss}>
          导出{invert ? '粗糙度' : '光泽'}
        </button>
      {/if}
    </div>

    <div class="grp">
      <h3 class="grp__t">材质 ID 图</h3>
      <div class="slots" style="margin-bottom:10px">
        <Slot
          label="ID 图"
          url={idSrc.url}
          name={idSrc.ref?.name}
          meta={idSrc.size}
          onpick={() => slots.pick('idmap')}
          onclear={() => slots.clear('idmap')}
          ondropfile={(f) => slots.loadFile('idmap', f)}
          slot={{ group: slots, id: 'idmap' }}
        />
      </div>
      <div class="row">
        <span class="row__k">编号在哪一路</span>
        <div class="pick" style="width:11rem">
          {#each CHANNEL_KEYS as k (k)}
            <button class="pick__b" type="button" aria-pressed={idChannel === k} onclick={() => (idChannel = k)}>
              {CHANNEL_LABEL[k]}
            </button>
          {/each}
        </div>
      </div>
      {#if ids.length}
        <ul class="list" style="margin-top:10px">
          {#each ids as m (m.id)}
            <li>
              <b>编号 {m.id}</b>
              <span class="list__sp">{(m.share * 100).toFixed(2)}%</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="grp">
      <h3 class="grp__t">实测依据</h3>
      <ul class="mini ul">
        <li>法线 `_N` 的 alpha：<b>55%</b> 有数据（全库最强）</li>
        <li>光照图 `_LM`：68%；SDF：55%</li>
        <li>基础色 `_D`：<b>14%</b>；`_D1` 11%；`_D2` 12%</li>
        <li>Ramp：<b>0%</b>，alpha 一律是常量</li>
      </ul>
      <p class="mini" style="margin-top:8px">
        `_D` / `_D1` / `_D2` 三个变体差不多 —— <b>光看文件名判断不出哪张带数据</b>，
        所以这里一律先检测。
      </p>
    </div>
  </aside>
</div>

{#if msg}
  <div class="msgwrap"><Note kind={msg.kind} onclose={() => (msg = null)} 自动关={提示自动关毫秒}>{msg.text}</Note></div>
{/if}

<style>
  .pad { padding: 16px; }
  .ul { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 5px; }
  .msgwrap { margin-top: 12px; }
  .btn--sm { padding: 4px 10px; font-size: var(--fs-2xs); }

  .duo {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 14px;
  }
  .duo figure { margin: 0; display: grid; gap: 6px; justify-items: center; }
  .duo img {
    width: 100%; height: 150px; object-fit: contain;
    image-rendering: pixelated;
    border-radius: var(--r-md);
    background: #fff;
  }

  /* 材质糖果罐：一个编号一颗糖，颜色是按编号派生的，只为了好认 */
  .candy {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
    gap: 8px;
    max-height: 15rem;
    overflow-y: auto;
  }
  .candy__it {
    display: grid;
    justify-items: center;
    gap: 3px;
    padding: 8px 6px;
    border: 2px solid var(--line-divider);
    border-radius: var(--r-lg);
    background: var(--surface-2);
    cursor: pointer;
    font: inherit;
    transition: border-color var(--t-micro) var(--ease-std), transform var(--t-micro) var(--ease-std);
  }
  .candy__it:hover { transform: translateY(var(--lift-btn)); }
  .candy__it.is-on { border-color: var(--c); }
  .candy__dot {
    width: 20px; height: 20px;
    border-radius: 50%;
    background: var(--c);
    display: block;
  }
  .candy__it b { font-size: var(--fs-2xs); color: var(--deep-text); }
  .candy__it span { font-size: 10px; color: var(--content-meta); }
</style>
