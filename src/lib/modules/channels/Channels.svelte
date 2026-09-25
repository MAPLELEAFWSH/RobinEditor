<script lang="ts">
  /**
   * ⑦ 贴图通道处理。七个分区：
   *
   *   split   分离  —— 一张进去，RGBA 四张出来
   *   merge   合并  —— 最多四张进去，挑通道拼成一张
   *   swizzle 调换  —— 一张进去，四个输出通道各自挑来源
   *   adjust  调整  —— PS「图像 > 调整」那一套
   *   blend   混合  —— 两张图按混合模式叠
   *   layers  图层  —— 图层栈 + 每层独立蒙版（金属材质那条流程落在这儿）
   *   batch   批量  —— 一个目录按同一条规则跑一遍
   *
   * 游戏分区（原神 / 星铁 / 绝区零那套约定）2026-09-23 删了界面；
   * `ops.ts` 里的 `GAMES` / `GAME_PRESETS` / `MAP_PRESETS` / `getGame` 留着 ——
   * ④ msToon 的映射是从那儿读的，删了它会一起死。
   *
   * 性能上的三条规矩，所有分区都遵守：
   *   1. 预览一律在缩略图上算，导出才按原尺寸全量跑
   *   2. 参数连着变只合并到一帧算一次（`Raf`）
   *   3. 图层的中间结果按参数缓存，没动就不重算（`LayerCache`）
   */
  import { Slots, outPathNear } from '$lib/wb.svelte';
  import { readRgba } from '$lib/io';
  import { histogram } from '$lib/hist';
  import Hist from '$lib/components/wb/Hist.svelte';
  import { materializeSeeds } from '$lib/layers-preset';
  import { allPresets } from '$lib/layers-preset.svelte';
  import {
    BATCH_OPS,
    batchOpInfo,
    batchOutNames,
    batchTransform as batchTransformAt,
    调换预设,
    type BatchOp
  } from './batch';
  import { History } from '$lib/history';
  import {
    describeSnapshot,
    lastSavedSig,
    markSaved,
    readSnapshot,
    shouldWrite,
    signature,
    writeSnapshot
  } from '$lib/autosave';
  import { onMount } from 'svelte';
  import {
    PROJECT_EXT,
    type ProjectDoc,
    buildProject,
    describeFails,
    describeProject,
    parseProject,
    reassignIds,
    restoreSlots,
    serializeProject
  } from '$lib/project';
  import {
    CHANNEL_KEYS,
    CHANNEL_LABEL,
    type ChannelKey,
    type ChannelSource,
    bitmapToImageData,
    extractChannel,
    grayToImageData,
    imageDataToUrl,
    pack,
    previewOf,
    预览长边
  } from '$lib/img';
  import {
    type AdjustOp,
    type AdjustScope,
    type Layer,
    LayerCache,
    Raf,
    applyAdjust,
    buildMask,
    composite,
    makeLayer,
    nextLayerId
  } from './ops';
  import {
    pickFolder,
    scanDir,
    saveImage,
    joinPath,
    stemOf,
    baseName,
    pickFile,
    pickSavePath,
    readTextFile,
    writeTextFile,
    IMAGE_EXTS
  } from '$lib/io';
  import { 接目录 } from '$lib/dirdrop';
  import type { WbProps } from '$lib/modules/wb-props';
  import Slot from '$lib/components/wb/Slot.svelte';
  import Note from '$lib/components/wb/Note.svelte';
  import { 提示自动关毫秒 } from '$lib/ui.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import SourcePick from './SourcePick.svelte';
  import AdjustEditor from './AdjustEditor.svelte';
  import LayerStack from './LayerStack.svelte';
  import Preview from '$lib/components/wb/Preview.svelte';
  import { isTauri } from '$lib/open';

  let { panelId = 'split' }: WbProps = $props();

  /**
   * 预览最长边。按预览台的实际宽度算（见 img.ts 的 `预览长边`）。
   *
   * 上限压到 1024 是有数的：这条链路上跑图层/调整，跟调色那一路同量级 ——
   * `tmp/preview-cost.mjs` 量到 1536 时单帧 70ms，超了 33ms 的预算。
   */
  const PREVIEW = 预览长边(1024);
  const cache = new LayerCache(64);
  const raf = new Raf();

  /* ============================================================
     分离
     ============================================================ */
  const splitSlots = new Slots('channels.split', [{ id: 'src', label: '源图' }]);
  let splitTiles = $state<{ ch: ChannelKey; url: string; label: string }[]>([]);
  /** 源图那份像素留着给直方图数 —— 拆之前先看一眼四路各自的分布 */
  let splitSrc = $state<ImageData | null>(null);
  const splitHist = $derived(splitSrc ? histogram(splitSrc, 2) : null);

  $effect(() => {
    const s = splitSlots.get('src');
    if (!s.data) {
      splitTiles = [];
      splitSrc = null;
      return;
    }
    const small = previewOf(s.data, PREVIEW);
    splitSrc = small;
    splitTiles = CHANNEL_KEYS.map((ch) => ({
      ch,
      label: CHANNEL_LABEL[ch],
      url: imageDataToUrl(grayToImageData(extractChannel(small, ch), small.width, small.height))
    }));
  });

  /* ============================================================
     合并
     ============================================================ */
  const mergeSlots = new Slots('channels.merge', [
    { id: 's1', label: '第一张' },
    { id: 's2', label: '第二张' },
    { id: 's3', label: '第三张' },
    { id: 's4', label: '第四张' }
  ]);
  let mergeMap = $state<Record<ChannelKey, ChannelSource>>({
    r: { slot: 's1', ch: 'r', constant: 255, invert: false },
    g: { slot: 's2', ch: 'g', constant: 255, invert: false },
    b: { slot: 's3', ch: 'b', constant: 255, invert: false },
    a: { slot: 's4', ch: 'a', constant: 255, invert: false }
  });
  let mergeUrl = $state<string | null>(null);
  /** 合成那份像素留着给直方图数 */
  let mergeOut = $state<ImageData | null>(null);
  const mergeHist = $derived(mergeOut ? histogram(mergeOut, 2) : null);

  $effect(() => {
    const loaded = Object.keys(mergeSlots.map)
      .map((id) => mergeSlots.get(id))
      .filter((s) => s.data);
    if (!loaded.length) {
      mergeUrl = null;
      mergeOut = null;
      return;
    }
    void mergeMap;
    raf.schedule(() => {
      const base = previewOf(loaded[0].data!, PREVIEW);
      const src = new Map<string, ImageData>();
      for (const s of loaded) src.set(s.id, previewOf(s.data!, base.width));
      const out = pack(base.width, base.height, mergeMap, src);
      mergeUrl = imageDataToUrl(out);
      mergeOut = out;
    });
  });

  /* ============================================================
     调换
     ============================================================ */
  const swzSlots = new Slots('channels.swizzle', [{ id: 'src', label: '源图' }]);
  let swzMap = $state<Record<ChannelKey, ChannelSource>>({
    r: { slot: 'src', ch: 'r', constant: 0, invert: false },
    g: { slot: 'src', ch: 'g', constant: 0, invert: false },
    b: { slot: 'src', ch: 'b', constant: 0, invert: false },
    a: { slot: 'src', ch: 'a', constant: 0, invert: false }
  });
  let swzUrl = $state<string | null>(null);
  /** 调换之后那份像素留着给直方图数 */
  let swzOut = $state<ImageData | null>(null);
  const swzHist = $derived(swzOut ? histogram(swzOut, 2) : null);

  type SwzPreset = { id: string; name: string; hint: string; map: Record<ChannelKey, { ch?: ChannelKey; invert?: boolean; const?: number }> };
  /* 预设表在 `batch.ts`（那一份两个界面共用）—— 这里原来自己抄了同样的 9 条，
     而批量页只实现了其中 5 条，用户在调换页能用的"法线 B↔R"到批量页就找不到。
     现在两边同一个数组，加一条两边都有。 */
  const SWZ_PRESETS = 调换预设;

  $effect(() => {
    const s = swzSlots.get('src');
    if (!s.data) {
      swzUrl = null;
      swzOut = null;
      return;
    }
    void swzMap;
    raf.schedule(() => {
      const use = previewOf(s.data!, PREVIEW);
      const out = pack(use.width, use.height, swzMap, new Map([['src', use]]));
      swzUrl = imageDataToUrl(out);
      swzOut = out;
    });
  });

  /* ============================================================
     调整
     ============================================================ */
  const adjSlots = new Slots('channels.adjust', [{ id: 'src', label: '源图' }]);
  let adjOps = $state<AdjustOp[]>([]);
  let adjScope = $state<AdjustScope>('all');
  let adjBefore = $state<string | null>(null);
  let adjAfter = $state<string | null>(null);
  let adjMs = $state(0);
  /** 调完那份像素留着给直方图数，不然还得再算一遍 */
  let adjAfterData = $state<ImageData | null>(null);
  const adjHist = $derived(adjAfterData ? histogram(adjAfterData, 2) : null);

  function recomputeAdjust() {
    const s = adjSlots.get('src');
    if (!s.data) {
      adjBefore = null;
      adjAfter = null;
      adjAfterData = null;
      return;
    }
    const small = previewOf(s.data, PREVIEW);
    const t0 = performance.now();
    const out = applyAdjust(small, adjOps, adjScope);
    adjMs = performance.now() - t0;
    adjBefore = imageDataToUrl(small);
    adjAfter = imageDataToUrl(out);
    adjAfterData = out;
  }

  $effect(() => {
    void adjOps;
    void adjScope;
    void adjSlots.get('src').data;
    raf.schedule(recomputeAdjust);
  });

  /* ============================================================
     混合
     ============================================================ */
  const blSlots = new Slots('channels.blend', [
    { id: 'base', label: '底层' },
    { id: 'top', label: '上层' },
    { id: 'top2', label: '上层 2' },
    { id: 'top3', label: '上层 3' }
  ]);
  /**
   * 底层是固定的那一个，上面可以叠任意多层。
   *
   * 原来是"底层 + 一层"写死的，界面上也只有一组混合模式/不透明度/蒙版。
   * 但实际做贴图经常要叠三四层（金属 + 高光 + 阴影），叠到第三层就没地方放了。
   * 现在上层的编辑直接复用图层页那套 `LayerStack` —— 一样能加层、调顺序、
   * 每层单独给蒙版和调整，两边的操作方式也就一致了。
   */
  let blBase = $state<Layer>(makeLayer('底层', 'base', 'rgb'));
  // 先造出这一层再分别赋值：写成 `$state(blLayers[0]?.id)` 只会取到初始值，
  // Svelte 会警告（而且真改了意图也看不出来）。这里要的本来就是"初始选中第一层"。
  const firstBlLayer = makeLayer('上层', 'top', 'rgb');
  let blLayers = $state<Layer[]>([firstBlLayer]);
  let blSelected = $state<string | null>(firstBlLayer.id);
  let blUrl = $state<string | null>(null);
  let blMaskUrl = $state<string | null>(null);
  /** 合成那份像素留着给直方图数 */
  let blOut = $state<ImageData | null>(null);
  const blHist = $derived(blOut ? histogram(blOut, 2) : null);

  /**
   * 槽位 → 预览用的图。混合页与图层页原来各写一遍（逐字相同，只差 `blSlots` / `lySlots`）——
   * 合成一份，槽组当参数传进来。
   */
  function 取源图(组: Slots, preview: boolean): Map<string, ImageData> {
    const map = new Map<string, ImageData>();
    for (const id of Object.keys(组.map)) {
      const d = 组.get(id).data;
      if (d) map.set(id, preview ? previewOf(d, PREVIEW) : d);
    }
    return map;
  }

  const blSources = (preview: boolean) => 取源图(blSlots, preview);
  const lySources = (preview: boolean) => 取源图(lySlots, preview);

  /** 蒙版缩略图：两页原来也各写一遍，同样合成一处 */
  function 蒙版缩略(蒙版: Uint8ClampedArray | null, base: ImageData): string | null {
    return 蒙版 ? imageDataToUrl(grayToImageData(蒙版, base.width, base.height)) : null;
  }

  /** 叠了几层（不含底层）。界面上要报这个数 */
  const blLayerCount = $derived(blLayers.filter((l) => l.on).length);

  $effect(() => {
    void blLayers;
    void blBase;
    void blSelected;
    for (const id of Object.keys(blSlots.map)) void blSlots.get(id).data;
    raf.schedule(() => {
      const map = blSources(true);
      if (!map.size) {
        blUrl = null;
        blMaskUrl = null;
        blOut = null;
        return;
      }
      const base = map.get('base') ?? map.get('top')!;
      const out = composite(base.width, base.height, [blBase, ...blLayers], map, {
        cache,
        cacheKeyPrefix: 'bl'
      });
      blUrl = imageDataToUrl(out);
      blOut = out;
      // 蒙版缩略图跟着当前选中那层走，跟图层页一个行为
      const sel = blLayers.find((l) => l.id === blSelected);
      blMaskUrl = sel && sel.mask.on ? 蒙版缩略(buildMask(sel.mask, map.get(sel.mask.slot), base.width, base.height), base) : null;
    });
  });

  /* ============================================================
     图层
     ============================================================ */
  const lySlots = new Slots('channels.layers', [
    { id: 'diffuse', label: 'diffuse 底图' },
    { id: 'lightmap', label: 'lightmap' },
    { id: 's3', label: '素材 3' },
    { id: 's4', label: '素材 4' }
  ]);
  let lyLayers = $state<Layer[]>([]);
  let lySelected = $state<string | null>(null);
  let lyUrl = $state<string | null>(null);
  let lyMaskUrl = $state<string | null>(null);
  let lyMs = $state(0);
  let lyStats = $state({ hits: 0, miss: 0 });
  /** 合成那份像素留着给直方图数 —— 调图层最容易把暗部压塌，得看得见 */
  let lyOut = $state<ImageData | null>(null);
  const lyHist = $derived(lyOut ? histogram(lyOut, 2) : null);

  /* lySources / lyMaskUrl 走共用实现（见上面 取源图 / 蒙版缩略） */

  /* ---------------- 撤销 / 重做 ---------------- */

  /**
   * 记的是"结构性改动"那一份状态：图层栈、调整链、混合页的层。
   *
   * 槽位里装的图**不进历史** —— 那是"放素材"，不是"改参数"；
   * 把它也记进去的话，换个图就会把前面的图层操作挤掉一格。
   *
   * 存的是快照不是逆操作：图层配置就几 KB，快照实现简单、也不会出现
   * "逆操作算错导致状态飘走"。对比像素级的历史（那边必须存逆操作）这边完全没必要。
   */
  type EditState = {
    lyLayers: Layer[];
    adjOps: AdjustOp[];
    adjScope: AdjustScope;
    blLayers: Layer[];
    blBase: Layer;
  };
  const hist = new History<EditState>({ cap: 120, coalesceMs: 600 });
  /** 恢复状态的时候别再记一遍，不然撤销会自己把自己记成新的一步 */
  let restoring = false;
  /** 按钮的可用状态。**只有下面这几个函数会写它**，不在 effect 里写 */
  let canUndo = $state(false);
  let canRedo = $state(false);
  let histDepth = $state('');

  function syncHistUi() {
    canUndo = hist.canUndo;
    canRedo = hist.canRedo;
    histDepth = `${hist.index + 1} / ${hist.size}`;
  }

  function editSnapshot(): EditState {
    return {
      // 快照要**深一点**：就一层 `{...}` 不够，`Layer` 里的 mask 和 adjust 是嵌套对象，
      // 浅拷的话后面改蒙版会把历史里那一格也一起改掉，撤销就等于没撤。
      lyLayers: lyLayers.map((l) => ({ ...l, adjust: [...l.adjust], mask: { ...l.mask } })),
      adjOps: adjOps.map((o) => ({ ...o })),
      adjScope,
      blLayers: blLayers.map((l) => ({ ...l, adjust: [...l.adjust], mask: { ...l.mask } })),
      blBase: { ...blBase, adjust: [...blBase.adjust], mask: { ...blBase.mask } }
    };
  }

  function applyEdit(s: EditState) {
    restoring = true;
    lyLayers = s.lyLayers;
    adjOps = s.adjOps;
    adjScope = s.adjScope;
    blLayers = s.blLayers;
    blBase = s.blBase;
    lySelected = lyLayers.length ? lyLayers[lyLayers.length - 1].id : null;
    blSelected = blLayers.length ? blLayers[blLayers.length - 1].id : null;
    cache.clear();
    restoring = false;
  }

  /**
   * 记一步。
   *
   * **不用 `$effect` 自动记。** 试过，Svelte 直接报
   * `effect_update_depth_exceeded`（"一个 effect 读写同一份状态"）——
   * 而且自动记会多出一步莫名其妙的初始状态。改成在**改动的那个地方**显式调，
   * 顺带还有个好处：`key` 是调用方给的，比自动推出来的准 ——
   * 拖滑杆是"同一个 key 连着来"，连点两次"加图层"是"同一个 key 但隔了一千毫秒"，
   * 两种情况自动推分不出来。
   *
   * 顺手在这里挂自动保存：改动的入口就这一处，挂这儿不会漏。
   */
  function commit(key: string) {
    if (restoring) return;
    const snap = editSnapshot();
    if (hist.size === 0) hist.reset(snap);
    else hist.push(snap, key);
    syncHistUi();
    maybeAutosave();
  }

  /* ---------------- 自动保存 ---------------- */

  /** 上次写的时间/签名，用来挡掉太频繁和没变化的写 */
  let autoAt = 0;
  let autoSig = lastSavedSig();
  let recover = $state<{ doc: ProjectDoc; savedAt: number } | null>(null);

  function maybeAutosave() {
    const doc = lyBuildDoc();
    const now = Date.now();
    if (!shouldWrite(doc, autoAt, autoSig, now)) return;
    if (writeSnapshot(doc, now)) {
      autoAt = now;
      autoSig = signature(doc);
    }
  }

  /** 进页面时看看上次有没有没存完的东西。**只提示，不自动铺上去** */
  function checkRecoverable() {
    const r = readSnapshot();
    if (!r.ok) return;
    // 跟当前状态一样的就不用提示了
    if (signature(r.doc) === signature(lyBuildDoc())) return;
    recover = { doc: r.doc, savedAt: r.savedAt };
  }

  async function doRecover() {
    if (!recover) return;
    const doc = recover.doc;
    recover = null;
    const fails = await restoreSlots(
      doc,
      LY_SLOT_IDS,
      async (id, path) => {
        await lySlots.loadRef(id, {
          path,
          name: baseName(path),
          rel: baseName(path),
          ext: (path.split('.').pop() ?? '').toLowerCase(),
          size: 0
        });
        return lySlots.get(id).error;
      },
      (id) => lySlots.clear(id)
    );
    lyLayers = reassignIds(doc.layers, nextLayerId);
    lySelected = lyLayers.length ? lyLayers[lyLayers.length - 1].id : null;
    adjOps = doc.adjustOps as typeof adjOps;
    adjScope = doc.adjustScope as typeof adjScope;
    blBase = doc.blendBase ? reassignIds([doc.blendBase], nextLayerId)[0] : blBase;
    blLayers = reassignIds(doc.blendLayers, nextLayerId);
    blSelected = blLayers.length ? blLayers[blLayers.length - 1].id : null;
    cache.clear();
    // 恢复出来的状态要能一路撤回去（把恢复前那一下当起点）
    hist.reset(editSnapshot());
    syncHistUi();
    projMsg = fails.length
      ? { kind: 'warn', text: describeFails(fails) }
      : { kind: 'ok', text: '上次没存完的东西恢复好了。' };
  }

  function dropRecover() {
    recover = null;
    markSaved();
  }

  /** 每个面板初始化时先把起点记下来 */
  function commitInit() {
    if (hist.size) return;
    hist.reset(editSnapshot());
    syncHistUi();
  }

  function doUndo() {
    const s = hist.undo();
    if (s) applyEdit(s);
    syncHistUi();
  }
  function doRedo() {
    const s = hist.redo();
    if (s) applyEdit(s);
    syncHistUi();
  }

  function onHistKey(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault();
      doUndo();
    } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
      e.preventDefault();
      doRedo();
    }
  }

  /* ---------------- 工程文件 ---------------- */

  const LY_SLOT_IDS = ['diffuse', 'lightmap', 's3', 's4'] as const;
  let projMsg = $state<{ kind: 'ok' | 'warn' | 'info'; text: string } | null>(null);
  let projSummary = $state('');
  let projBusy = $state(false);

  /** 当前状态打包成工程文档。槽位记的是"路径"，不是像素 */
  function lyBuildDoc() {
    return buildProject({
      panel: 'layers',
      slots: LY_SLOT_IDS.map((id) => ({ id, path: lySlots.get(id).ref?.path ?? '' })),
      layers: lyLayers,
      adjustOps: adjOps,
      adjustScope: adjScope,
      blendBase: blBase,
      blendLayers: blLayers
    });
  }

  async function saveProject() {
    projBusy = true;
    projMsg = null;
    try {
      const doc = lyBuildDoc();
      const text = serializeProject(doc);
      const path = await pickSavePath(`贴图工程.${PROJECT_EXT}`, [PROJECT_EXT]);
      if (!path) {
        projBusy = false;
        return;
      }
      await writeTextFile(path, text);
      // 用户自己存过了，不用再提"要不要恢复自动存的那份"
      markSaved();
      autoSig = signature(doc);
      autoAt = Date.now();
      recover = null;
      projSummary = describeProject(doc);
      projMsg = { kind: 'ok', text: `存好了：${baseName(path)}\n${projSummary}` };
    } catch (e) {
      projMsg = { kind: 'warn', text: `存不了：${(e as Error).message}` };
    }
    projBusy = false;
  }

  /**
   * 载入工程。
   *
   * **读不到的图要如实报出来**，不能静默跳过：
   * 资源是记路径的，文件一移，旧工程就得重指。悄悄少两张图比报错更难查。
   */
  async function openProject() {
    projBusy = true;
    projMsg = null;
    try {
      const files = await pickFile([PROJECT_EXT]);
      if (!files.length) {
        projBusy = false;
        return;
      }
      const text = await readTextFile(files[0].path);
      const r = parseProject(text);
      if (!r.ok) {
        projMsg = { kind: 'warn', text: `打不开 ${files[0].name}：${r.error}` };
        projBusy = false;
        return;
      }
      const doc = r.doc;

      // 1. 槽位：按路径读回来，读不到的记下来
      const fails = await restoreSlots(
        doc,
        LY_SLOT_IDS,
        async (id, path) => {
          await lySlots.loadRef(id, {
            path,
            name: baseName(path),
            rel: baseName(path),
            ext: (path.split('.').pop() ?? '').toLowerCase(),
            size: 0
          });
          return lySlots.get(id).error;
        },
        (id) => lySlots.clear(id)
      );

      // 2. 图层和调整：id 重新发一遍，免得跟已有的撞
      lyLayers = reassignIds(doc.layers, nextLayerId);
      lySelected = lyLayers.length ? lyLayers[lyLayers.length - 1].id : null;
      adjOps = doc.adjustOps as typeof adjOps;
      adjScope = doc.adjustScope as typeof adjScope;
      blBase = doc.blendBase ? reassignIds([doc.blendBase], nextLayerId)[0] : blBase;
      blLayers = reassignIds(doc.blendLayers, nextLayerId);
      blSelected = blLayers.length ? blLayers[blLayers.length - 1].id : null;
      cache.clear();

      projSummary = describeProject(doc);
      projMsg = fails.length
        ? { kind: 'warn', text: describeFails(fails) }
        : { kind: 'ok', text: `载入了 ${files[0].name}\n${projSummary}` };
    } catch (e) {
      projMsg = { kind: 'warn', text: `载入失败：${(e as Error).message}` };
    }
    projBusy = false;
  }

  $effect(() => {
    void lyLayers;
    void lySelected;
    for (const id of Object.keys(lySlots.map)) void lySlots.get(id).data;
    raf.schedule(() => {
      const map = lySources(true);
      if (!map.size || !lyLayers.length) {
        lyUrl = null;
        lyMaskUrl = null;
        lyOut = null;
        return;
      }
      const base = map.values().next().value!;
      const t0 = performance.now();
      const composed = composite(base.width, base.height, lyLayers, map, { cache, cacheKeyPrefix: 'ly' });
      lyUrl = imageDataToUrl(composed);
      lyOut = composed;
      lyMs = performance.now() - t0;
      lyStats = { hits: cache.hits, miss: cache.miss };

      const sel = lyLayers.find((l) => l.id === lySelected);
      lyMaskUrl = sel && sel.mask.on ? 蒙版缩略(buildMask(sel.mask, map.get(sel.mask.slot), base.width, base.height), base) : null;
    });
  });

  /* ============================================================
     批量
     ============================================================ */
  let batchRoot = $state('');
  let batchFiles = $state<{ path: string; rel: string; ext: string; size: number }[]>([]);
  let batchOp = $state<BatchOp>('split');
  let batchFolder = $state('');
  let batchSuffix = $state('');
  let batchRunning = $state(false);
  let batchDone = $state(0);
  let batchTotal = $state(0);
  let batchLog = $state<{ rel: string; ok: boolean; msg: string }[]>([]);
  let batchDry = $state(true);
  let batchOps = $state<AdjustOp[]>([]);
  let batchScope = $state<AdjustScope>('all');

  /**
   * 批量走图层工作流时用的那一套图层。
   *
   * 两种装法：**用图层页现在这套**，或者**从预设搭一套**。
   * 预设里指名的槽位在图层页存在，套过来就是现成的；
   * 套的时候按图层页那四个槽判存在性，跟图层页套预设一个规则。
   */
  let batchLayers = $state<Layer[]>([]);
  let batchSrcKind = $state<'panel' | 'preset'>('panel');
  let batchPresetId = $state('');
  /** 每个文件当哪一格用。批量只有一张图，剩下的格子只能是常量或图层页里已经放的图 */
  let batchMainSlot = $state('diffuse');

  const BATCH_SLOT_IDS = ['diffuse', 'lightmap', 's3', 's4'];

  /** 批量这轮实际会用到的图层：图层页那套，或者某个预设套出来的 */
  const batchStack = $derived.by(() => {
    if (batchSrcKind === 'panel') return lyLayers;
    const p = allPresets().find((x) => x.id === batchPresetId);
    if (!p) return [];
    return materializeSeeds(p.layers, (id: string) => BATCH_SLOT_IDS.includes(id), nextLayerId);
  });

  const opInfo = $derived(batchOpInfo(batchOp));

  function outNames(rel: string, op: BatchOp): string[] {
    return batchOutNames(rel, op, batchSuffix);
  }

  /**
   * 图层栈跑批量。
   *
   * 每个文件填进 `batchMainSlot` 那一格，其余格子用图层页里已经放好的图
   * （没放的就是空，`composite` 会把它当成"这层没源"）。
   *
   * 为什么不做成"每张图配一整组槽"：批量目录里通常只有一类贴图（一堆 `_D`、
   * 或者一堆 `_N`），配不出成组的 lightmap。真要成组地用，那是 ⑤ 的 ILM 配对
   * 该干的事，不是这里。
   */
  function batchRunLayers(src: ImageData): { name: string; data: ImageData }[] {
    if (!batchStack.length) {
      throw new Error('这一套图层是空的。先去图层页搭一套，或者在下面挑一个预设。');
    }
    const map = new Map<string, ImageData>();
    map.set(batchMainSlot, src);
    // 其余槽位：图层页里放了的就带上（尺寸不一致的交给 composite 自己裁）
    for (const id of Object.keys(lySlots.map)) {
      if (id === batchMainSlot) continue;
      const d = lySlots.get(id).data;
      if (d) map.set(id, d);
    }
    const out = composite(src.width, src.height, batchStack, map, { cacheKeyPrefix: 'blw' });
    return [{ name: '', data: out }];
  }

  /** 批量对一张图做什么 —— 像素那一半在 `batch.ts`（那边有测试），这里只交出两个依赖 */
  function batchTransform(src: ImageData, op: BatchOp): { name: string; data: ImageData }[] {
    return batchTransformAt(src, op, {
      调整: (s) => applyAdjust(s, batchOps, batchScope),
      /* 叠图层那条在组件里（要读图层栈），它自己也返回 `{name, data}[]` 的形状 */
      叠图层: (s) => batchRunLayers(s)[0].data
    });
  }

  /* ============================================================
     导出与提示
     ============================================================ */
  let msg = $state<{ kind: 'ok' | 'warn' | 'info'; text: string } | null>(null);
  let busy = $state(false);
  let outDir = $state('');

  async function ensureDir(): Promise<string | null> {
    if (!isTauri()) return '';
    if (outDir) return outDir;
    const d = await pickFolder();
    if (!d) return null;
    outDir = d;
    return d;
  }

  /** 导出前把排队的重算跑完，保证拿到的是最新参数 */
  function settle() {
    raf.flush();
  }

  /** 一件要写盘的产物 */
  type 导出项 = { 图: ImageData; 名: string };

  /**
   * 七个分区的导出**共用这一条**。
   *
   * 原来每个分区各写一遍：settle → 查槽 → busy → ensureDir → 造图 → 存 → 报话 → catch → busy，
   * 抄七遍的结果是不一致的：只有三处"先让出一帧"（全尺寸合成是同步的，不让帧界面会僵住），
   * 而 `busy = false` 有两处走在提前 return 之后（取消选目录那条路上漏掉）。
   *
   * `备` 只做"有没有可导的东西"，`出` 才干活 —— 分开是为了**先弹选目录、再算重活**：
   * 合在一处的话，用户得先干等几秒合成才看到目录框。
   */
  async function 导出(
    备: () => boolean,
    出: () => 导出项[] | Promise<导出项[]>,
    备注?: (列: 导出项[], 毫秒: number) => string
  ) {
    settle();
    if (!备()) return;
    busy = true;
    msg = null;
    try {
      const dir = await ensureDir();
      if (dir === null) return; // 用户把选目录取消了
      const t0 = performance.now();
      const 列 = await 出();
      if (!列.length) return;
      for (const it of 列) await saveImage(dir ? joinPath(dir, it.名) : it.名, it.图);
      const 毫秒 = Math.round(performance.now() - t0);
      msg = {
        kind: 'ok',
        text: 备注
          ? 备注(列, 毫秒)
          : 列.length === 1
            ? `写了 ${列[0].名}（${列[0].图.width}×${列[0].图.height}）`
            : `写了 ${列.length} 张：${列.map((x) => x.名).join('、')}`
      };
    } catch (e) {
      msg = { kind: 'warn', text: `导出失败：${(e as Error).message}` };
    } finally {
      busy = false;
    }
  }

  /** 全尺寸运算前让出一帧，好让"算中…"先画出来 */
  const 让帧 = () => new Promise((r) => setTimeout(r, 0));

  /* 取槽用函数包一层：`导出` 的守卫和造图要读**同一刻**的槽，
     分两处各写一遍 `slots.get('src')` 容易改一处忘一处 */
  const 槽split = () => splitSlots.get('src');
  const 槽swz = () => swzSlots.get('src');
  const 槽adj = () => adjSlots.get('src');

  async function exportSplit() {
    await 导出(
      () => !!(槽split().data && 槽split().ref),
      () => {
        const s = 槽split();
        const stem = stemOf(s.ref!.name);
        return CHANNEL_KEYS.map((ch) => ({
          图: grayToImageData(extractChannel(s.data!, ch), s.data!.width, s.data!.height),
          名: `${stem}_${CHANNEL_LABEL[ch]}.png`
        }));
      }
    );
  }

  async function exportMerged() {
    const 有图的 = () =>
      Object.keys(mergeSlots.map)
        .map((id) => mergeSlots.get(id))
        .filter((s) => s.data);
    await 导出(
      () => !!有图的().find((s) => s.ref),
      () => {
        const loaded = 有图的();
        const first = loaded.find((s) => s.ref)!;
        const src = new Map<string, ImageData>();
        for (const s of loaded) src.set(s.id, s.data!);
        return [
          {
            图: pack(first.data!.width, first.data!.height, mergeMap, src),
            名: `${stemOf(first.ref!.name)}_merged.png`
          }
        ];
      }
    );
  }

  async function exportSwizzled() {
    await 导出(
      () => !!(槽swz().data && 槽swz().ref),
      () => {
        const s = 槽swz();
        return [
          {
            图: pack(s.data!.width, s.data!.height, swzMap, new Map([['src', s.data!]])),
            名: `${stemOf(s.ref!.name)}_swizzled.png`
          }
        ];
      }
    );
  }

  async function exportAdjusted() {
    await 导出(
      () => !!(槽adj().data && 槽adj().ref),
      async () => {
        await 让帧();
        const s = 槽adj();
        return [{ 图: applyAdjust(s.data!, adjOps, adjScope), 名: outPathNear(s, '_adj').split(/[\\/]/).pop()! }];
      }
    );
  }

  async function exportBlend() {
    await 导出(
      () => blSources(false).size > 0,
      async () => {
        await 让帧();
        const map = blSources(false);
        const base = map.get('base') ?? map.get('top')!;
        return [
          {
            图: composite(base.width, base.height, [blBase, ...blLayers], map, { cacheKeyPrefix: 'blx' }),
            名: 'blend_result.png'
          }
        ];
      }
    );
  }

  async function exportLayers() {
    await 导出(
      () => lySources(false).size > 0 && lyLayers.length > 0,
      async () => {
        await 让帧();
        const map = lySources(false);
        const base = map.values().next().value!;
        return [{ 图: composite(base.width, base.height, lyLayers, map, { cacheKeyPrefix: 'lyx' }), 名: 'layers_result.png' }];
      },
      (列, 毫秒) =>
        `写了 ${列[0].名}（${列[0].图.width}×${列[0].图.height}，` +
        `${((列[0].图.width * 列[0].图.height) / 1000000) | 0} 百万像素，全尺寸合成花了 ${毫秒}ms）`
    );
  }


  async function pickBatchDir() {
    const root = await pickFolder('整个目录批处理', '/tools/channels?panel=batch');
    if (!root) return;
    await 扫批量的目录(root);
  }

  /**
   * 扫一个目录 —— 点「选目录」和**拖文件夹进来**走同一条
   * （这一页原来一个落点都没有，拖进来只会得到"没落在能接它的地方"）。
   */
  async function 扫批量的目录(root: string) {
    /* 先把上一次的结果清干净再扫。原来没有 try、也不清旧的：
       扫失败（指了一张 png、或 `C:\Users` 这种权限目录）时**一句话都不说**，
       而 `batchRoot` 已经换成新目录、`batchFiles` 还是上一批的 ——
       再点开跑就按旧文件名往新目录里写。 */
    batchFiles = [];
    batchLog = [];
    batchDone = 0;
    batchTotal = 0;
    batchRoot = root;
    try {
      const 找到 = await scanDir(root, IMAGE_EXTS, true);
      batchFiles = 找到;
      batchTotal = 找到.length;
      if (!找到.length) msg = { kind: 'warn', text: `这个目录里没扫到图：${root}` };
      else msg = { kind: 'ok', text: `扫到 ${找到.length} 张图。` };
    } catch (e) {
      msg = { kind: 'warn', text: `扫不了这个目录：${(e as Error).message}` };
    }
  }

  async function runBatch() {
    if (!batchFiles.length) return;
    batchRunning = true;
    batchLog = [];
    batchDone = 0;
    const dir = batchFolder || batchRoot;
    for (const f of batchFiles) {
      try {
        /* 走 `readRgba` 拿原始字节，**不能**走 `loadImage` + 画布。
           画布是预乘 alpha 存的，反预乘会把半透明像素的 RGB 弄脏、
           把全透明的 RGB 抹成 0 —— 实测一张原神法线图 98.2% 的像素会中招。
           批量这里是最后一条还走画布的读图路径。 */
        const src = (await readRgba(f.path)).data;
        const relDir = f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '';
        const targetDir = relDir ? joinPath(dir, relDir) : dir;
        const results = batchTransform(src, batchOp);
        const names = outNames(f.rel, batchOp);
        if (batchDry) {
          batchLog = [...batchLog, { rel: f.rel, ok: true, msg: `会写 ${results.length} 个：${names.join(' ')}` }];
        } else {
          for (let i = 0; i < results.length; i++) {
            await saveImage(joinPath(targetDir, names[i] ?? results[i].name), results[i].data);
          }
          batchLog = [...batchLog, { rel: f.rel, ok: true, msg: `写了 ${results.length} 个` }];
        }
      } catch (e) {
        batchLog = [...batchLog, { rel: f.rel, ok: false, msg: (e as Error).message }];
      }
      batchDone++;
    }
    batchRunning = false;
  }

  /* ============================================================
     小工具
     ============================================================ */
  function setMerge(k: ChannelKey, patch: Partial<ChannelSource>) {
    mergeMap = { ...mergeMap, [k]: { ...mergeMap[k], ...patch } };
  }
  function setSwz(k: ChannelKey, patch: Partial<ChannelSource>) {
    swzMap = { ...swzMap, [k]: { ...swzMap[k], ...patch } };
  }
  function applySwzPreset(p: SwzPreset) {
    const next = {} as Record<ChannelKey, ChannelSource>;
    for (const k of CHANNEL_KEYS) {
      const v = p.map[k];
      next[k] = v && v.ch
        ? { slot: 'src', ch: v.ch, constant: 0, invert: !!v.invert }
        : { slot: '', ch: 'a', constant: v?.const ?? 0, invert: false };
    }
    swzMap = next;
  }
  const splitSlot = $derived(splitSlots.get('src'));
  const swzSlot = $derived(swzSlots.get('src'));
  const adjSlot = $derived(adjSlots.get('src'));

  onMount(() => {
    window.addEventListener('keydown', onHistKey);
    // 起点记一格，不然第一次撤销没地方退
    commitInit();
    // 上次有没存完的东西就提示一下（只提示，不自动铺）
    checkRecoverable();
    return () => window.removeEventListener('keydown', onHistKey);
  });
</script>

{#if !['split', 'merge', 'swizzle', 'adjust', 'blend', 'layers', 'batch'].includes(panelId)}
  <!-- 不认识的 id 不再悄悄渲染最后一个分区（原来裸 `{:else}` 就是干这个的）：
       注册表和组件里的分区列表一旦对不上，这里会明说，而不是给一个看起来正常的面板。 -->
  <div class="card pad">
    <Note kind="warn">
      分区 id「{panelId}」这个组件不认识，所以这一页是空的。
      多半是注册表里加/改分区的时候，组件里的分支没跟着改 —— 两边要一起改。
    </Note>
  </div>
{:else if panelId === 'split'}
  <div class="wb">
    <div class="wb__main">
      <div class="card pad">
        <div class="slots">
          <Slot
            label="源图"
            url={splitSlot.url}
            name={splitSlot.ref?.name}
            meta={splitSlot.srcFormat ? `${splitSlot.size} · ${splitSlot.srcFormat}` : splitSlot.size}
            onpick={() => splitSlots.pick('src')}
            onclear={() => splitSlots.clear('src')}
            ondropfile={(f) => splitSlots.loadFile('src', f)}
            slot={{ group: splitSlots, id: 'src' }}
          />
        </div>
      </div>

      {#if splitTiles.length}
        <div class="card pad">
          <h3 class="h3">四个分量</h3>
          <div class="tiles">
            {#each splitTiles as t (t.ch)}
              <figure class="tile">
                <img src={t.url} alt="" />
                <figcaption><i class="chip chip--{t.ch}">{t.label}</i></figcaption>
              </figure>
            {/each}
          </div>
          <!-- 拆之前先看一眼四路分布：哪一路挤在两端，拆出来就是一张没内容的图 -->
          <div style="margin-top:12px">
            <Hist hist={splitHist} label="源图" />
          </div>
        </div>
      {:else}
        <Note>选一张图，这里把 R / G / B / A 四路分别摊开。</Note>
      {/if}

      <div class="wb__acts">
        <span class="mini mut">四张灰度图，名字是 <span class="mono">原名_R.png</span> 这种。</span>
        <button class="btn btn--primary" disabled={!splitSlot.data || busy} onclick={exportSplit}>
          <Icon name="ui.export" size={15} />导出四张
        </button>
      </div>
    </div>

    <aside class="card wb__side">
      <div class="grp">
        <h3 class="grp__t">几条边界</h3>
        <ul class="mini ul">
          <li>出来的是灰度，不是彩色通道 —— 方便改单路再合回去。</li>
          <li>原图不动，产物是新文件。</li>
          <li>A 全是白的话，说明这张图没有透明区。</li>
        </ul>
      </div>
    </aside>
  </div>
{:else if panelId === 'merge'}
  <div class="wb">
    <div class="wb__main">
      <div class="card pad">
        <div class="slots slots--4">
          {#each ['s1', 's2', 's3', 's4'] as id, i (id)}
            {@const s = mergeSlots.get(id)}
            <Slot
              label={s.label}
              tag={CHANNEL_LABEL[CHANNEL_KEYS[i]]}
              tagKind={CHANNEL_KEYS[i]}
              url={s.url}
              name={s.ref?.name}
              meta={s.size}
              onpick={() => mergeSlots.pick(id)}
              onclear={() => mergeSlots.clear(id)}
              ondropfile={(f) => mergeSlots.loadFile(id, f)}
              slot={{ group: mergeSlots, id }}
            />
          {/each}
        </div>
      </div>

      <div class="card pad">
        <h3 class="h3">合成结果</h3>
        {#if mergeUrl}
          <Preview url={mergeUrl} wide />
          <div style="margin-top:12px">
            <Hist hist={mergeHist} label="合成结果" />
          </div>
          <p class="mini" style="margin-top:8px">这里是缩略图。导出按源图原尺寸重算。</p>
        {:else}
          <Note>放进来至少一张。</Note>
        {/if}
      </div>

      <div class="wb__acts">
        <button class="btn btn--primary" disabled={!mergeUrl || busy} onclick={exportMerged}>
          <Icon name="ui.export" size={15} />导出合成图
        </button>
      </div>
    </div>

    <aside class="card wb__side">
      <div class="grp">
        <h3 class="grp__t">每个分量从哪来</h3>
        {#each CHANNEL_KEYS as k (k)}
          <div class="chan">
            <div class="row">
              <span class="row__k"><i class="chip chip--{k}">{CHANNEL_LABEL[k]}</i></span>
            </div>
            <SourcePick
              value={mergeMap[k]}
              slots={[
                { id: 's1', label: '第一张' },
                { id: 's2', label: '第二张' },
                { id: 's3', label: '第三张' },
                { id: 's4', label: '第四张' }
              ]}
              onpatch={(p) => setMerge(k, p as Partial<ChannelSource>)}
            />
          </div>
        {/each}
      </div>
    </aside>
  </div>
{:else if panelId === 'swizzle'}
  <div class="wb">
    <div class="wb__main">
      <div class="card pad">
        <div class="slots">
          <Slot
            label="源图"
            url={swzSlot.url}
            name={swzSlot.ref?.name}
            meta={swzSlot.srcFormat ? `${swzSlot.size} · ${swzSlot.srcFormat}` : swzSlot.size}
            onpick={() => swzSlots.pick('src')}
            onclear={() => swzSlots.clear('src')}
            ondropfile={(f) => swzSlots.loadFile('src', f)}
            slot={{ group: swzSlots, id: 'src' }}
          />
        </div>
      </div>
      <div class="card pad">
        <h3 class="h3">调换之后</h3>
        {#if swzUrl}
          <Preview url={swzUrl} wide />
          <div style="margin-top:12px">
            <Hist hist={swzHist} label="调换之后" />
          </div>
        {:else}
          <Note>放一张源图进来。</Note>
        {/if}
      </div>

      <div class="wb__acts">
        <button class="btn btn--primary" disabled={!swzUrl || busy} onclick={exportSwizzled}>
          <Icon name="ui.export" size={15} />导出
        </button>
      </div>
    </div>

    <aside class="card wb__side">
      <div class="grp">
        <h3 class="grp__t">预设</h3>
        <div class="acts">
          {#each SWZ_PRESETS as p (p.id)}
            <button class="btn btn--ghost btn--sm" type="button" title={p.hint} onclick={() => applySwzPreset(p)}>
              {p.name}
            </button>
          {/each}
        </div>
      </div>
      <div class="grp">
        <h3 class="grp__t">输出通道各取哪儿</h3>
        {#each CHANNEL_KEYS as k (k)}
          <div class="chan">
            <div class="row">
              <span class="row__k">输出 <i class="chip chip--{k}">{CHANNEL_LABEL[k]}</i></span>
            </div>
            <SourcePick
              value={swzMap[k]}
              slots={[{ id: 'src', label: '源图' }]}
              onpatch={(p) => setSwz(k, p as Partial<ChannelSource>)}
            />
          </div>
        {/each}
      </div>
    </aside>
  </div>
{:else if panelId === 'adjust'}
  <div class="wb">
    <div class="wb__main">
      <div class="card pad">
        <div class="slots">
          <Slot
            label="源图"
            url={adjSlot.url}
            name={adjSlot.ref?.name}
            meta={adjSlot.srcFormat ? `${adjSlot.size} · ${adjSlot.srcFormat}` : adjSlot.size}
            onpick={() => adjSlots.pick('src')}
            onclear={() => adjSlots.clear('src')}
            ondropfile={(f) => adjSlots.loadFile('src', f)}
            slot={{ group: adjSlots, id: 'src' }}
          />
        </div>
      </div>

      {#if adjAfter}
        <div class="card pad">
          <h3 class="h3">
            前 / 后
            <span class="mini" style="margin-left:8px">预览重算 {adjMs.toFixed(1)}ms · 缩到 {PREVIEW}px 算的</span>
          </h3>
          <div class="stage stage--split">
            <div class="stage__col">
              <img src={adjBefore} alt="" />
              <span class="stage__cap">原图</span>
            </div>
            <div class="stage__col">
              <img src={adjAfter} alt="" />
              <span class="stage__cap">调整后</span>
            </div>
          </div>
          <!-- 直方图跟图放一起，不塞侧栏 —— 三个面板都是这个位置 -->
          <div style="margin-top:12px">
            <Hist hist={adjHist} label="调整后" />
          </div>
          <p class="mini" style="margin-top:8px">
            预览缩到 {PREVIEW}px。导出时按原尺寸全量重算，像素值以那一遍为准。
            贴边那两个数是<b>三路同时</b>压到 0 或 255 的比例 ——
            单路贴边通常说明那一路本来就是遮罩，不算错。
          </p>
        </div>
      {:else}
        <Note>放一张图进来，右边挑调整项。所有调整实时预览。</Note>
      {/if}

      <div class="wb__acts">
        <button class="btn btn--primary" disabled={!adjSlot.data || !adjOps.length || busy} onclick={exportAdjusted}>
          <Icon name="ui.export" size={15} />{busy ? '算中…' : '导出'}
        </button>
      </div>
    </div>

    <aside class="card wb__side">
      <div class="grp">
        <h3 class="grp__t">调整</h3>
        <AdjustEditor
          ops={adjOps}
          scope={adjScope}
          onchange={(o, s) => {
            adjOps = o;
            adjScope = s;
            // 滑杆拖过程中会连着来，键都一样、时间也挨着，历史那边自己合并成一步
            commit(`adjust:${o.length}:${o.map((x) => x.k).join(',')}`);
          }}
        />
      </div>
      <div class="grp">
        <p class="mini">
          作用范围选单一通道时，那条 op 只动那一路。
        </p>
      </div>
    </aside>
  </div>
{:else if panelId === 'blend'}
  <div class="wb">
    <div class="wb__main">
      <div class="card pad">
        <div class="slots slots--2">
          {#each ['base', 'top', 'top2', 'top3'] as id (id)}
            {@const s = blSlots.get(id)}
            <Slot
              label={s.label}
              url={s.url}
              name={s.ref?.name}
              meta={s.size}
              onpick={() => blSlots.pick(id)}
              onclear={() => blSlots.clear(id)}
              ondropfile={(f) => blSlots.loadFile(id, f)}
              slot={{ group: blSlots, id }}
            />
          {/each}
        </div>
      </div>

      <div class="card pad">
        <h3 class="h3">叠出来</h3>
        {#if blUrl}
          <Preview url={blUrl} wide />
          <div style="margin-top:12px">
            <Hist hist={blHist} label="合成结果" />
          </div>
        {:else}
          <Note>底层放一张，上面想叠几层都行。左边的槽不够用就不用槽 —— 图层里把源选成常量也能叠。</Note>
        {/if}
      </div>

      <div class="wb__acts">
        <span class="mini mut">{blLayerCount} 层叠在底层上，按原尺寸全量重算一遍再写盘。</span>
        <button class="btn btn--primary" disabled={!blUrl || busy} onclick={exportBlend}>
          <Icon name="ui.export" size={15} />导出
        </button>
      </div>
    </div>

    <aside class="card wb__side">
      <div class="grp">
        <h3 class="grp__t">叠在上面的</h3>        <LayerStack
          layers={blLayers}
          slots={[
            { id: 'base', label: '底层' },
            { id: 'top', label: '上层' },
            { id: 'top2', label: '上层 2' },
            { id: 'top3', label: '上层 3' }
          ]}
          reserved={['base']}
          selected={blSelected}
          maskPreview={blMaskUrl}
          onchange={(next) => {
            blLayers = next;
            // 键按"层数 + 各层 id"拼：加一层、删一层、挪顺序是不同的事，不该合并；
            // 而在同一层里连拖滑杆是同键，会被合并
            commit(`bl:${next.length}:${next.map((l) => l.id).join(',')}`);
          }}
          onselect={(id) => (blSelected = id)}
        />
        <p class="mini" style="margin-top:8px">
          底层是下面那张，这里的每一层依次盖上去。每层的混合模式、不透明度、蒙版、
          调整都在层里面展开 —— 跟图层页是同一套。
        </p>
      </div>

      <div class="grp">
        <p class="mini">
          {blLayerCount} 层叠在底层上，导出时按原尺寸全量重算一遍再写盘。
        </p>
      </div>
    </aside>
  </div>
{:else if panelId === 'layers'}
  <div class="wb">
    <div class="wb__main">
      <div class="card pad">
        <div class="slots slots--4">
          {#each ['diffuse', 'lightmap', 's3', 's4'] as id (id)}
            {@const s = lySlots.get(id)}
            <Slot
              label={s.label}
              url={s.url}
              name={s.ref?.name}
              meta={s.size}
              onpick={() => lySlots.pick(id)}
              onclear={() => lySlots.clear(id)}
              ondropfile={(f) => lySlots.loadFile(id, f)}
              slot={{ group: lySlots, id }}
            />
          {/each}
        </div>
      </div>

      <div class="card pad">
        <div class="row">
          <span class="row__k">合成结果</span>
          <span class="row__v">
            {lyLayers.length} 层 · 预览重算 {lyMs.toFixed(1)}ms · 缓存命中 {lyStats.hits}/{(lyStats.hits + lyStats.miss)}
          </span>
        </div>
        {#if lyUrl}
          <div style="margin-top:10px"><Preview url={lyUrl} wide /></div>
          <div style="margin-top:12px">
            <Hist hist={lyHist} label="合成结果" />
          </div>
        {:else}
          <div style="margin-top:10px">
            <Note>放素材进来，然后在右边加图层。或者直接点一个预设。</Note>
          </div>
        {/if}
      </div>

      <div class="wb__acts">
        <span class="mini mut">导出按素材原尺寸全量重算。层多、图大的话要等一会儿。</span>
        <button class="btn btn--primary" disabled={!lyUrl || !lyLayers.length || busy} onclick={exportLayers}>
          <Icon name="ui.export" size={15} />{busy ? '算中…' : '导出合成图'}
        </button>
      </div>
    </div>

    <aside class="card wb__side">
      <div class="grp">
        <h3 class="grp__t">撤销</h3>
        <div class="acts">
          <button class="btn btn--ghost btn--sm" type="button" disabled={!canUndo} onclick={doUndo}>
            <Icon name="ui.undo" size={13} />撤销
          </button>
          <button class="btn btn--ghost btn--sm" type="button" disabled={!canRedo} onclick={doRedo}>
            <Icon name="ui.redo" size={13} />重做
          </button>
          <span class="mini" style="margin-left:auto">{histDepth}</span>
        </div>
        <p class="mini" style="margin-top:8px">
          <span class="mono">Ctrl+Z</span> / <span class="mono">Ctrl+Y</span>。
          记的是图层栈和调整链 —— <b>放素材不算</b>，那是"换图"不是"改参数"。
          同一次连续改动（比如拖一个滑杆）合并成一步，不会让你点十几下。
        </p>
      </div>

      <div class="grp">
        <h3 class="grp__t">工程</h3>

        {#if recover}
          <div style="margin-bottom:8px">
            <Note kind="info">
              {describeSnapshot(recover.doc, recover.savedAt)}
              <div class="acts" style="margin-top:6px">
                <button class="btn btn--ghost btn--sm" type="button" onclick={doRecover}>恢复</button>
                <button class="btn btn--ghost btn--sm" type="button" onclick={dropRecover}>不要了</button>
              </div>
            </Note>
          </div>
        {/if}

        <div class="acts">
          <button class="btn btn--ghost btn--sm" type="button" disabled={projBusy} onclick={saveProject}>
            <Icon name="ui.save" size={13} />保存工程
          </button>
          <button class="btn btn--ghost btn--sm" type="button" disabled={projBusy} onclick={openProject}>
            <Icon name="ui.folder" size={13} />打开工程
          </button>
        </div>
        {#if projMsg}
          <div style="margin-top:8px"><Note kind={projMsg.kind} onclose={() => (projMsg = null)} 自动关={提示自动关毫秒}>{projMsg.text}</Note></div>
        {:else}
          <p class="mini" style="margin-top:8px">
            存成一个 <span class="mono">.{PROJECT_EXT}</span> 文件：四个槽位指向哪张图、
            图层栈、调整链、混合页的层。<b>不存像素</b> —— 图还在盘上，工程里只记路径。
          </p>
          <p class="mini" style="margin-top:6px">
            另外每改几下会往本机<b>自动存一份</b>。关窗口没来得及存的话，下次进来上面会出一条提示，
            点"恢复"就能拿回来。自动存的那份只在你说"不要了"或者自己保存过之后才清掉。
          </p>
        {/if}
      </div>

      <div class="grp">
        <h3 class="grp__t">图层</h3>
        <LayerStack
          layers={lyLayers}
          slots={[
            { id: 'diffuse', label: 'diffuse 底图' },
            { id: 'lightmap', label: 'lightmap' },
            { id: 's3', label: '素材 3' },
            { id: 's4', label: '素材 4' }
          ]}
          selected={lySelected}
          maskPreview={lyMaskUrl}
          onchange={(next) => {
            lyLayers = next;
            commit(`ly:${next.length}:${next.map((l) => l.id).join(',')}`);
          }}
          onselect={(id) => (lySelected = id)}
        />
      </div>

      <div class="grp">
        <p class="mini">
          导出按素材原尺寸全量重算。层多、图大的话要等一会儿。
        </p>
      </div>
    </aside>
  </div>
{:else}
  <div class="wb">
    <!-- 拖文件夹进来 = 点这颗「选目录」（这一页整页的活就是"指一个目录"） -->
    <div class="wb__main" use:接目录={(p) => void 扫批量的目录(p)}>
      <div class="card pad">
        <div class="acts">
          <button class="btn btn--primary" onclick={pickBatchDir}>
            <Icon name="ui.folder" size={15} />选目录
          </button>
          {#if batchRoot}
            <span class="mini mono">{batchRoot}</span>
            <span class="mini">扫到 {batchFiles.length} 张图</span>
          {/if}
        </div>
      </div>

      {#if batchFiles.length}
        <div class="card pad">
          <h3 class="h3">会写这些文件</h3>
          <p class="mini" style="margin-bottom:10px">
            按 <span class="mono">{opInfo.name}</span> 跑，每张源图产出 {opInfo.out} 个文件。前 8 张：
          </p>          <ul class="list">
            {#each batchFiles.slice(0, 8) as f (f.path)}
              <li>
                <b>{f.rel}</b>
                <Icon name="ui.arrowRight" size={12} />
                <span class="mono">{outNames(f.rel, batchOp).join(' , ')}</span>
              </li>
            {/each}
          </ul>
        </div>

        {#if batchLog.length}
          <div class="card pad">
            <h3 class="h3">
              跑完 {batchDone} / {batchTotal}
              {#if batchDry}<span class="tag">试跑，没写盘</span>{/if}
            </h3>
            <ul class="list">
              {#each batchLog.slice(-30) as l (l.rel)}
                <li class:bad={!l.ok}>
                  <b>{l.rel}</b>
                  <span class="list__sp">{l.msg}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      {:else}
        <Note>选一个目录，里面所有贴图按同一条规则跑一遍，子目录结构保持原样。</Note>
      {/if}
    </div>

    <aside class="card wb__side">
      <div class="grp">
        <h3 class="grp__t">跑什么</h3>
        {#each BATCH_OPS as o (o.id)}
          <label class="chk" style="margin-bottom:6px">
            <input type="radio" name="batchop" checked={batchOp === o.id} onchange={() => (batchOp = o.id)} />
            <span class="chk__box"></span>
            <span>{o.name}<br /><span class="mini">{o.hint}</span></span>
          </label>
        {/each}
      </div>

      {#if batchOp === 'adjust'}
        <div class="grp">
          <h3 class="grp__t">带上这些调整</h3>
          <AdjustEditor ops={batchOps} scope={batchScope} onchange={(o, s) => { batchOps = o; batchScope = s; }} />
          {#if !batchOps.length}
            <p class="mini" style="margin-top:8px">一步都没加的话，批量就是原样另存。</p>
          {/if}
        </div>
      {/if}

      {#if batchOp === 'layers'}
        <div class="grp">
          <h3 class="grp__t">用哪一套图层</h3>
          <div class="pick">
            <button class="pick__b" type="button" aria-pressed={batchSrcKind === 'panel'} onclick={() => (batchSrcKind = 'panel')}>
              图层页那套
            </button>
            <button class="pick__b" type="button" aria-pressed={batchSrcKind === 'preset'} onclick={() => (batchSrcKind = 'preset')}>
              挑个预设
            </button>
          </div>

          {#if batchSrcKind === 'preset'}
            <div class="row" style="margin-top:8px">
              <span class="row__k">预设</span>
              <select value={batchPresetId} aria-label="预设"
                onchange={(e) => (batchPresetId = e.currentTarget.value)}>
                <option value="">— 挑一个 —</option>
                {#each allPresets() as p (p.id)}
                  <option value={p.id}>{p.name}（{p.layers.length} 层）</option>
                {/each}
              </select>
            </div>
          {/if}

          <div class="row" style="margin-top:8px">
            <span class="row__k">每个文件当哪一格</span>
            <select value={batchMainSlot} aria-label="主槽位"
              onchange={(e) => (batchMainSlot = e.currentTarget.value)}>
              {#each BATCH_SLOT_IDS as id (id)}
                <option value={id}>{id}</option>
              {/each}
            </select>
          </div>

          {#if batchStack.length}
            <ul class="mini ul" style="margin-top:8px">
              {#each batchStack as l (l.id)}
                <li>{l.name} · {l.slot ? `源 = ${l.slot}` : `源 = 常量 ${l.constant}`}{l.blend !== 'normal' ? ` · 叠法 ${l.blend}` : ''}</li>
              {/each}
            </ul>
            <p class="mini" style="margin-top:8px">
              每张图填进「{batchMainSlot}」那一格，其余格子用图层页里已经放好的图。
              别的槽都没放的话，指到那些槽的图层就是空源 —— 先在图层页放一张，或者换成常量。
            </p>
          {:else}
            <p class="mini" style="margin-top:8px">
              这一套还是空的。先去图层页搭一套，或者在上面挑一个预设。
            </p>
          {/if}
        </div>
      {/if}

      <div class="grp">
        <h3 class="grp__t">写到哪</h3>
        <div class="row">
          <span class="row__k">目录</span>
          <button class="btn btn--ghost btn--sm" onclick={async () => (batchFolder = (await pickFolder()) ?? '')}>选</button>
        </div>
        <p class="mini" style="margin-top:6px">{batchFolder || batchRoot || '跟源图放一起'}</p>
        <label class="chk" style="margin-top:8px">
          <input type="checkbox" bind:checked={batchDry} />
          <span class="chk__box"></span>先试跑不写盘
        </label>
      </div>

      <div class="grp">
        <button
          class="btn btn--primary"
          disabled={!batchFiles.length || batchRunning || (batchOp === 'layers' && !batchStack.length)}
          onclick={runBatch}
        >
          <Icon name="ui.run" size={15} />{batchRunning ? `跑中 ${batchDone}/${batchTotal}` : batchDry ? '试跑' : '开跑'}
        </button>
        {#if batchOp === 'layers' && !batchStack.length}
          <p class="mini" style="margin-top:8px">图层是空的，跑不了。</p>
        {/if}
      </div>
    </aside>
  </div>
{/if}

{#if msg}
  <div class="toast"><Note kind={msg.kind} onclose={() => (msg = null)} 自动关={提示自动关毫秒}>{msg.text}</Note></div>
{/if}

<style>
  .pad { padding: 16px; }
  .h3 { margin: 0 0 10px; font-size: var(--fs-md); }
  .ul { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 5px; }
  .btn--sm { padding: 4px 10px; font-size: var(--fs-2xs); }
  .toast { margin-top: 12px; }

  .tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
  @media (max-width: 780px) { .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .tile { margin: 0; display: grid; gap: 6px; justify-items: center; }
  .tile img {
    width: 100%; height: 120px; object-fit: contain;
    image-rendering: pixelated;
    border-radius: var(--r-md);
    background: #fff;
  }
  .tile figcaption { font-size: var(--fs-2xs); display: flex; gap: 5px; align-items: center; }

  /* 通道块之间用虚线隔开，四路排下来不至于糊成一片 */
  .chan { padding-top: 8px; margin-top: 8px; border-top: 1px dashed var(--line-divider); }
  .chan:first-child { padding-top: 0; margin-top: 0; border-top: 0; }

  .list li.bad { color: var(--danger); }
</style>
