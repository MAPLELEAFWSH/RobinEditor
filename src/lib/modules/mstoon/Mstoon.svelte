<script lang="ts">
  /**
   * ④ msToon 四张控制图。
   *
   * 两件事分开说：
   *
   * · **通道是干什么用的有出处** —— 作者自己的 `*_common.fxsub` 里写着，
   *   带行号的整理在 `mstoon/ops.ts` 的 `MSTOON_CONVENTION` 注释里。
   * · **怎么从一张贴图推出这几张没有出处** —— 官方包里只有产物、没有源图，
   *   拿不到配对。所以：**参数全部露在界面上**，默认值不好用就自己调。
   *
   * 组装（`buildControlMaps` / `buildEdge` / `buildSdf`）都在 `ops.ts`，
   * 这里只做状态和画界面 —— 预览和导出走同一个函数，不会各写一份。
   *
   * 每张图分别做：
   *   ShadowRate   从源图取通道，或者按 ladder 做直方图匹配
   *   SubLightRate 同上，通道含义不同
   *   EdgeRate     亮度 →（可选降噪/归一）→ Sobel → 阈值/软过渡
   *   FaceSDF      阈值切交界线 → 距离场
   *
   * 能自证的只有两处，界面上会写出来：
   *   · ladder 那套是标准直方图规定化，出来图的分布可以直接对着 ladder 核
   *   · 距离场走 img.ts 的 distanceField，那个有单测
   */
  import { Slots, outPathNear } from '$lib/wb.svelte';
  import {
    type ChannelKey,
    CHANNEL_KEYS,
    CHANNEL_LABEL,
    extractChannel,
    grayToImageData,
    imageDataToUrl,
    lumaOf,
    pack,
    previewOf,
    histogram,
    预览长边
  } from '$lib/img';
  import {
    LADDER_PRESETS,
    MSTOON_CONVENTION,
    MSTOON_PRESETS,
    HSR_WINDOWS,
    type ChMode,
    type ChSpec,
    type Ladder,
    blankChain,
    buildControlMaps,
    buildEdge,
    buildFromLightmap,
    buildSdfEncoded,
    buildSdfFromChannel,
    channelGray,
    findPreset,
    onGridRatio
  } from './ops';
  /* 三条验过配对的映射就在 ⑦ 那一条 GAMES 里，这儿只读不抄 */
  import { getGame } from '$lib/modules/channels/ops';
  import { saveBytes, saveImage } from '$lib/io';
  import { ENCODINGS } from '$lib/sdf';
  import {
    GAME_LABEL,
    SDF_GAME,
    loadParams,
    saveParams,
    type GameKey,
    type GameParams
  } from './params.svelte';
  import type { WbProps } from '$lib/modules/wb-props';
  import Slot from '$lib/components/wb/Slot.svelte';
  import Preview from '$lib/components/wb/Preview.svelte';
  import Note from '$lib/components/wb/Note.svelte';
  import { 提示自动关毫秒 } from '$lib/ui.svelte';
  import Icon from '$lib/components/Icon.svelte';

  let { panelId = 'shadowrate' }: WbProps = $props();

  /* 预览按预览台的实际宽度算（见 img.ts 的 预览长边）。实测控制图在 1536 下 19.7ms，扛得住 */
  const PREVIEW = 预览长边();
  /* lightmap 打包这条路的源可以是 lightmap，也可以是 _M，所以按游戏分几组 */
  const lmSlots = new Slots('mstoon.lm', [{ id: 'lm', label: 'lightmap' }]);
  const mSlots = new Slots('mstoon.m', [{ id: 'm', label: '_M' }]);
  const slots = new Slots('mstoon.src', [{ id: 'src', label: '源图' }]);

  /* ---------------- lightmap 打包 ----------------
   * 选一个游戏、丢一张 lightmap（绝区零丢 _M），出 MS_TOON 那张打包图。
   * 映射不在这儿，在 ⑦ 的 GAMES 里 —— 见 ops.ts 的 buildFromLightmap。 */
  let packGame = $state('gi');
  let packUrl = $state<string | null>(null);
  let packTiles = $state<{ ch: ChannelKey; label: string; url: string }[]>([]);
  let packW = $state(0);
  let packH = $state(0);
  let packSrcName = $state('');
  /** 星铁那个窗口的当前值。null = 用模板里那个 */
  let packWindow = $state<number | null>(null);
  let packBusy = $state(false);
  let packMsg = $state<{ kind: 'ok' | 'warn' | 'info'; text: string } | null>(null);

  const packPreset = $derived(findPreset(packGame));
  const packGameDef = $derived(getGame(packPreset.gameId));
  const packSlots = $derived(packGame === 'zzz' ? mSlots : lmSlots);
  const packSlot = $derived(packSlots.get(packGame === 'zzz' ? 'm' : 'lm'));
  /** 星铁那一档才有窗口可调；那两个实测值也只对星铁有意义 */
  const packHasWindow = $derived(packGame === 'hsr');

  $effect(() => {
    void packGame;
    void packWindow;
    const src = packSlots.get(packGame === 'zzz' ? 'm' : 'lm').data;
    if (panelId !== 'pack' || !src) {
      packUrl = null;
      packTiles = [];
      packW = 0;
      packH = 0;
      return;
    }
    const small = previewOf(src, PREVIEW);
    const r = buildFromLightmap(small, packGame, {
      windowHi: packWindow ?? undefined
    });
    packTiles = CHANNEL_KEYS.map((k) => ({
      ch: k,
      label: CHANNEL_LABEL[k],
      url: imageDataToUrl(grayToImageData(extractChannel(r.out, k), r.out.width, r.out.height))
    }));
    packUrl = imageDataToUrl(r.out);
    packW = r.out.width;
    packH = r.out.height;
  });

  function pickPackGame(id: string) {
    if (id === packGame) return;
    packGame = id;
    packWindow = null;
    packMsg = null;
    packSrcName = '';
    /* 源那两组不是一个槽，换档时把旧的清掉，免得拿 _M 去当 lightmap 用 */
    lmSlots.clear('lm');
    mSlots.clear('m');
  }

  /* ---------------- 四个手画分区的「游戏」维度 ----------------
   * 用户要的："lightmap 之外的分区也应该分游戏生成效果"。
   * 但这三个分区（ShadowRate / SubLightRate / EdgeRate）在三个模型库和参考样本里
   * **没有每游戏的实测样本**（扫过：只有原神有 7 张 `Avatar_*_FaceSDF.png`），
   * 所以这里**不编"实测默认值"** —— 切的是一组**用户自己存的**参数，
   * 三套出厂默认相同，谁调过就标"你存的"（见 params.svelte.ts）。
   */
  let game = $state<GameKey>('gi');
  let 已存 = $state<Partial<Record<GameKey, GameParams>>>(loadParams());

  /* ---------------- ShadowRate ---------------- */
  const SR默认: Record<ChannelKey, ChSpec> = {
    r: blankChain(0.6),
    g: blankChain(1.0),
    b: blankChain(0.3),
    a: blankChain(1.0)
  };
  let srSpec = $state<Record<ChannelKey, ChSpec>>(structuredClone(SR默认));

  /* ---------------- SubLightRate ---------------- */
  const SL默认: Record<ChannelKey, ChSpec> = {
    r: blankChain(0.5),
    g: blankChain(0.5),
    b: blankChain(0.0),
    a: blankChain(1.0)
  };
  let slSpec = $state<Record<ChannelKey, ChSpec>>(structuredClone(SL默认));

  /* ---------------- 共用的产出 ---------------- */

  type Built = { tiles: { ch: ChannelKey; url: string }[]; composed: string | null; w: number; h: number };
  let built = $state<Built>({ tiles: [], composed: null, w: 0, h: 0 });

  function buildFrom(spec: Record<ChannelKey, ChSpec>, preview: boolean): ImageData | null {
    const src = slots.get('src').data;
    if (!src) return null;
    return buildControlMaps(preview ? previewOf(src, PREVIEW) : src, spec, snap05);
  }

  let snap05 = $state(true);
  let gridRatio = $state(0);

  /** 当前产出的 R/G/B/A 分别有多大比例落在 0.05 网格上 */
  function ratioOf(data: ImageData | null): number {
    if (!data) return 0;
    return onGridRatio(new Uint8ClampedArray(data.data), 0.05);
  }

  let chanView = $state<'all' | ChannelKey>('all');

  let busy = $state(false);
  let msg = $state<{ kind: 'ok' | 'warn' | 'info'; text: string } | null>(null);

  function refresh(spec: Record<ChannelKey, ChSpec>) {
    const src = slots.get('src').data;
    if (!src) {
      built = { tiles: [], composed: null, w: 0, h: 0 };
      gridRatio = 0;
      return;
    }
    const composed = buildFrom(spec, true);
    if (!composed) return;
    const tiles = CHANNEL_KEYS.map((k) => ({
      ch: k,
      url: imageDataToUrl(grayToImageData(extractChannel(composed, k), composed.width, composed.height))
    }));
    built = { tiles, composed: imageDataToUrl(composed), w: composed.width, h: composed.height };
    gridRatio = ratioOf(composed);
  }

  $effect(() => {
    void srSpec;
    void slSpec;
    void snap05;
    void slots.get('src').data;
    if (panelId === 'shadowrate') refresh(srSpec);
    else if (panelId === 'sublight') refresh(slSpec);
  });

  /* ---------------- EdgeRate ---------------- */
  let edgeThreshold = $state(60);
  let edgeSoft = $state(false);
  let edgeSoftWidth = $state(40);
  let edgeDenoise = $state(true);
  let edgeNormalize = $state(false);
  let edgeToGB = $state(false);
  let edgeUrl = $state<string | null>(null);
  let edgeOverlayUrl = $state<string | null>(null);
  let edgeBusy = $state(false);

  $effect(() => {
    void edgeThreshold;
    void edgeSoft;
    void edgeSoftWidth;
    void edgeDenoise;
    void edgeNormalize;
    void edgeToGB;
    const src = slots.get('src').data;
    if (panelId !== 'edge' || !src) {
      edgeUrl = null;
      edgeOverlayUrl = null;
      return;
    }
    const small = previewOf(src, PREVIEW);
    const { out, strength } = buildEdge(small, {
      threshold: edgeThreshold,
      soft: edgeSoft,
      softWidth: edgeSoftWidth,
      denoise: edgeDenoise,
      normalize: edgeNormalize,
      toGB: edgeToGB
    });
    edgeUrl = imageDataToUrl(out);

    // 叠在源图上，半透明红，看描边落在哪儿
    const ov = new Uint8ClampedArray(small.data);
    for (let i = 0; i < strength.length; i++) {
      if (strength[i] > 127) {
        ov[i * 4] = 255;
        ov[i * 4 + 1] = 40;
        ov[i * 4 + 2] = 40;
      }
    }
    const overlay = new ImageData(ov, small.width, small.height);
    edgeOverlayUrl = imageDataToUrl(overlay);
  });

  /* ---------------- FaceSDF ---------------- */
  /**
   * 三条路：
   *   'channel'  直接取源图的某一路（可反相）：原神取脸部 lightmap 的 G，
   *              星铁取脸部图的 A 再反相，都不做距离场。
   *              **形状是量出来的**：产物是 R 放数据、G/B 恒 0、A 恒 1。
   *   'distance' 阈值切交界线 → 距离场，再按**游戏各自的排法**码进 RGBA
   *              （三套排法见 `$lib/sdf.ts` 的 ENCODINGS，规格目录 17 张量出来的）。
   * 默认走 'channel'，因为这张纸的用途是产 msToon 要的那张图。
   */
  let sdfMode = $state<'channel' | 'distance'>('channel');
  let sdfCh = $state<ChannelKey>('g');
  let sdfThreshold = $state(110);
  let sdfMaxDist = $state(24);
  let sdfInvert = $state(false);
  let sdfToA = $state(true);
  let sdfUrl = $state<string | null>(null);
  let sdfMaskUrl = $state<string | null>(null);
  let sdfHist = $state<number[]>([]);
  /* 星铁那片 0.5 要手标：单独一张遮罩图（白 = 标成 0.5）。没有就不标，R 只有 0/1。 */
  const markSlots = new Slots('mstoon.mark', [{ id: 'mark', label: '0.5 区（白 = 标成 0.5）' }]);
  const markSlot = $derived(markSlots.get('mark'));

  $effect(() => {
    void sdfMode;
    void sdfCh;
    void sdfThreshold;
    void sdfMaxDist;
    void sdfInvert;
    void sdfToA;
    void game;
    void markSlot.data;
    const src = slots.get('src').data;
    if (panelId !== 'facesdf' || !src) {
      sdfUrl = null;
      sdfMaskUrl = null;
      sdfHist = [];
      return;
    }
    const small = previewOf(src, PREVIEW);
    sdfHist = Array.from(histogram(lumaOf(small)));
    if (sdfMode === 'channel') {
      // 取通道这条路没有掩膜可看
      sdfMaskUrl = null;
      sdfUrl = imageDataToUrl(buildSdfFromChannel(small, { ch: sdfCh, invert: sdfInvert }));
      return;
    }
    /* 距离场那条路走 ops 里那个唯一实现（预览与导出同一个函数） */
    const { out, mask } = buildSdfEncoded(small, {
      threshold: sdfThreshold,
      maxDist: sdfMaxDist,
      invert: sdfInvert,
      toA: true,
      game: SDF_GAME[game],
      mark: markSlot.data ? previewOf(markSlot.data, PREVIEW) : null
    });
    sdfMaskUrl = imageDataToUrl(grayToImageData(mask, small.width, small.height));
    sdfUrl = imageDataToUrl(out);
  });

  /* ---------------- 游戏切换：存下这一套、载入那套 ---------------- */

  function 快照(): GameParams {
    return {
      sr: $state.snapshot(srSpec) as Record<string, ChSpec>,
      sl: $state.snapshot(slSpec) as Record<string, ChSpec>,
      edge: {
        threshold: edgeThreshold,
        soft: edgeSoft,
        softWidth: edgeSoftWidth,
        denoise: edgeDenoise,
        normalize: edgeNormalize,
        toGB: edgeToGB
      },
      sdf: {
        threshold: sdfThreshold,
        maxDist: sdfMaxDist,
        invert: sdfInvert,
        toA: sdfToA,
        game
      },
      touched: true
    };
  }

  function 套用(p: GameParams) {
    /* `p` 是从 `$state` 里取出来的 **Proxy**，`structuredClone(proxy)` 会抛 DataCloneError
       （实测：切游戏时参数没恢复，就是因为这一句抛了、后半段没跑到）。
       要复制就用 `$state.snapshot` —— 它认得代理。 */
    if (p.sr) srSpec = $state.snapshot(p.sr) as Record<ChannelKey, ChSpec>;
    if (p.sl) slSpec = $state.snapshot(p.sl) as Record<ChannelKey, ChSpec>;
    if (p.edge) {
      edgeThreshold = p.edge.threshold;
      edgeSoft = p.edge.soft;
      edgeSoftWidth = p.edge.softWidth;
      edgeDenoise = p.edge.denoise;
      edgeNormalize = p.edge.normalize;
      edgeToGB = p.edge.toGB;
    }
    if (p.sdf) {
      sdfThreshold = p.sdf.threshold;
      sdfMaxDist = p.sdf.maxDist;
      sdfInvert = p.sdf.invert;
      sdfToA = p.sdf.toA;
    }
  }

  /**
   * 切游戏。**不用 `$effect` 盯着 `game` 写状态** —— 那个 effect 既要读这些状态又要写，
   * 很容易自己触发自己。切是用户按出来的，直接在事件里做。
   */
  function 切游戏(g: GameKey) {
    if (g === game) return;
    已存 = { ...已存, [game]: 快照() };
    saveParams(已存);
    game = g;
    const p = 已存[g];
    if (p) 套用(p);
    else {
      /* 没存过的这套：回到出厂默认，并标一句"还没调过" */
      srSpec = structuredClone(SR默认);
      slSpec = structuredClone(SL默认);
      edgeThreshold = 60;
      edgeSoft = false;
      edgeSoftWidth = 40;
      edgeDenoise = true;
      edgeNormalize = false;
      edgeToGB = false;
      sdfThreshold = 110;
      sdfMaxDist = 24;
      sdfInvert = false;
      sdfToA = true;
    }
    该游戏调过没 = !!p;
  }

  let 该游戏调过没 = $state(false);

  /* ---------------- 导出 ---------------- */

  async function exportCurrent(tag: string) {
    const src = slots.get('src').data;
    if (!src) return;
    busy = true;
    msg = null;
    try {
      let out: ImageData | null = null;
      /** 取通道那条路还会额外导一份灰度（就是素材里 `_G_Channel` / `_A_Channel` 那种） */
      let extra: ImageData | null = null;
      if (panelId === 'shadowrate') out = buildFrom(srSpec, false);
      else if (panelId === 'sublight') out = buildFrom(slSpec, false);
      else if (panelId === 'edge') out = buildEdge(src, {
        threshold: edgeThreshold,
        soft: edgeSoft,
        softWidth: edgeSoftWidth,
        denoise: edgeDenoise,
        normalize: edgeNormalize,
        toGB: edgeToGB
      }).out;
      else if (sdfMode === 'channel') {
        out = buildSdfFromChannel(src, { ch: sdfCh, invert: sdfInvert });
        extra = channelGray(src, sdfCh, sdfInvert);
      } else
        out = buildSdfEncoded(src, {
          threshold: sdfThreshold,
          maxDist: sdfMaxDist,
          invert: sdfInvert,
          toA: true,
          game: SDF_GAME[game],
          mark: markSlot.data
        }).out;
      if (!out) {
        msg = { kind: 'info', text: '没有可导出的结果。' };
        busy = false;
        return;
      }
      const ref = slots.get('src').ref;
      const name = ref ? outPathNear(slots.get('src'), tag).split(/[\\/]/).pop()! : `out${tag}.png`;
      const path = ref ? outPathNear(slots.get('src'), tag) : name;
      await saveImage(path, out);
      let tail = '';
      if (extra) {
        const gname = ref
          ? outPathNear(slots.get('src'), `${tag}_channel`).split(/[\\/]/).pop()!
          : `out${tag}_channel.png`;
        const gpath = ref ? outPathNear(slots.get('src'), `${tag}_channel`) : gname;
        await saveImage(gpath, extra);
        tail = `，另加一份灰度 ${gname}`;
      }
      msg = { kind: 'ok', text: `写了 ${name}（${out.width}×${out.height}）${tail}` };
    } catch (e) {
      msg = { kind: 'warn', text: `导出失败：${(e as Error).message}` };
    }
    busy = false;
  }

  /** 出图 + 一份能照着重来的说明。窗口那种手填参数不写在说明里就只能靠记 */
  async function exportPack() {
    const id = packGame === 'zzz' ? 'm' : 'lm';
    const src = packSlots.get(id).data;
    if (!src) return;
    packBusy = true;
    packMsg = null;
    try {
      /* **窗口要跟预览同一个**（`packWindow`）：预览那条 effect（118-120）传了
         `{ windowHi: packWindow ?? undefined }`，而这里原来一个参数都没传 →
         导出按模板默认窗口（255 / 3.5）出图，屏幕上看到的却是你填的那个窗口，
         产物跟预览对不上；紧跟的 477 行还拿默认 plan 反算 `hi` 写进说明 .txt，
         于是"说明"里记的也是错的（2026-09-25 只读审查量出来的）。
         星铁「头发」实测窗口是 85，一按就命中这一条。 */
      const r = buildFromLightmap(src, packGame, { windowHi: packWindow ?? undefined });
      const ref = packSlots.get(id).ref;
      const base = ref ? outPathNear(packSlots.get(id), '_MS_TOON') : 'out_MS_TOON.png';
      const rep = await saveImage(base, r.out);
      const hi = r.plan.b.stretch === 'manual' ? 255 - r.plan.b.lo : null;

      const name = rep.path.split(/[\\/]/).pop() || rep.path;
      const lines = [
        'RobinEditor · msToon 控制图',
        `游戏：${r.preset.name}`,
        `源图：${r.preset.srcLabel}`,
        `映射：⑦ 的「${r.gameDef.name}」模板（拿真实配对逐像素验过）`,
        '  G ← 源 lightmap 的 B，逐像素搬运',
        hi === null
          ? '  B ← 恒 0（这一档不映射 B）'
          : `  B ← 源 G 反相，窗口 [${(255 - hi).toFixed(1)}, 255]（hi = ${hi.toFixed(4)}）`,
        '  R 恒 0，A 恒 1',
        `产物：${r.out.width}×${r.out.height}`,
        `备份：${rep.backup ?? '（没有旧文件，不用备份）'}`
      ];
      const repPath = ref ? outPathNear(packSlots.get(id), '_说明', 'txt') : 'out_说明.txt';
      await saveBytes(repPath, new TextEncoder().encode(lines.join('\n') + '\n'));
      packMsg = { kind: 'ok', text: `写了 ${name}（${r.out.width}×${r.out.height}），另加说明 ${repPath.split(/[\\/]/).pop()}` };
    } catch (e) {
      packMsg = { kind: 'warn', text: `导出失败：${(e as Error).message}` };
    }
    packBusy = false;
  }

  /* ---------------- ladder 编辑 ---------------- */
  function applyLadderPreset(spec: Record<ChannelKey, ChSpec>, presetId: string) {
    const p = LADDER_PRESETS.find((x) => x.id === presetId);
    if (!p) return;
    const next = { ...spec };
    for (const k of CHANNEL_KEYS) {
      const lad = p.per[CHANNEL_LABEL[k] as 'R' | 'G' | 'B' | 'A'];
      next[k] = {
        ...spec[k],
        mode: 'ladder',
        ladder: { def: lad.def, rungs: lad.rungs.map((r) => ({ ...r })) }
      };
    }
    if (panelId === 'shadowrate') srSpec = next;
    else slSpec = next;
  }

  function currentSpec(): Record<ChannelKey, ChSpec> {
    return panelId === 'shadowrate' ? srSpec : slSpec;
  }

  function setSpec(k: ChannelKey, patch: Partial<ChSpec>) {
    if (panelId === 'shadowrate') srSpec = { ...srSpec, [k]: { ...srSpec[k], ...patch } };
    else slSpec = { ...slSpec, [k]: { ...slSpec[k], ...patch } };
  }

  function setRung(k: ChannelKey, i: number, patch: Partial<{ v: number; share: number }>) {
    const spec = currentSpec();
    const rungs = spec[k].ladder.rungs.map((r, j) => (j === i ? { ...r, ...patch } : r));
    setSpec(k, { ladder: { ...spec[k].ladder, rungs } });
  }

  function addRung(k: ChannelKey) {
    const spec = currentSpec();
    setSpec(k, {
      ladder: { ...spec[k].ladder, rungs: [...spec[k].ladder.rungs, { v: 0.5, share: 0.1 }] }
    });
  }

  function delRung(k: ChannelKey, i: number) {
    const spec = currentSpec();
    const rungs = spec[k].ladder.rungs.filter((_, j) => j !== i);
    setSpec(k, { ladder: { ...spec[k].ladder, rungs } });
  }

  /** 当前规格的实际占比合计，超了要提醒 */
  function shareSum(k: ChannelKey): number {
    return currentSpec()[k].ladder.rungs.reduce((s, r) => s + r.share, 0);
  }

  const srcSlot = $derived(slots.get('src'));
  const histMax = $derived(sdfHist.length ? Math.max(...sdfHist) : 1);
  /** 成品还是单看某一路 */
  const viewUrl = $derived(
    chanView === 'all'
      ? built.composed
      : (built.tiles.find((t) => t.ch === chanView)?.url ?? null)
  );
</script>

<!-- 四个手画分区共用的「游戏」条。切游戏 = 换你自己存的那套参数（不是我们编的实测值，
     见 params.svelte.ts 开头那段说明）。做成 snippet 是为了别抄四遍 —— 抄四遍就会漂。 -->
{#snippet 游戏条()}
  <div class="card pad">
    <div class="row">
      <span class="row__k">游戏</span>
      <div class="pick" style="width:16rem">
        {#each ['gi', 'hsr', 'zzz'] as g (g)}
          <button class="pick__b" type="button" aria-pressed={game === g}
            onclick={() => 切游戏(g as GameKey)}>{GAME_LABEL[g as GameKey]}</button>
        {/each}
      </div>
      <span class="mini mut">{已存[game] ? '你存的这套' : '还没调过（三套出厂默认相同）'}</span>
    </div>
    <p class="mini" style="margin-top:6px">
      三个分区的参数<b>按游戏各存一套</b>，切过去就换一套；离开这个页面再回来也还在。
      这三个分区在模型库里<b>没有每游戏的实测样本</b>（只有原神有 7 张脸 SDF），
      所以这里存的是你自己调的值 —— 不给默认值编"实测"两个字。
    </p>
  </div>
{/snippet}

{#if !['pack', 'shadowrate', 'sublight', 'edge', 'facesdf'].includes(panelId)}
  <!-- 不认识的 id 不再悄悄渲染最后一个分区（原来裸 `{:else}` 就是干这个的） -->
  <div class="card pad">
    <Note kind="warn">
      分区 id「{panelId}」这个组件不认识，所以这一页是空的。
      多半是注册表里加/改分区的时候，组件里的分支没跟着改 —— 两边要一起改。
    </Note>
  </div>
{:else if panelId === 'pack'}
  <div class="wb">
    <div class="wb__main">
      <div class="card pad">
        <div class="seg seg--inline" role="group" aria-label="选游戏">
          {#each MSTOON_PRESETS as g (g.id)}
            <button
              class="seg__btn {packGame === g.id ? 'is-on' : ''}"
              type="button"
              aria-pressed={packGame === g.id}
              onclick={() => pickPackGame(g.id)}
            >
              <span class="seg__label">{g.name}</span>
            </button>
          {/each}
        </div>

        <p class="mini" style="margin-top:8px">
          丢一张 <b>{packPreset.srcLabel}</b> 进来，这里把它打包成 msToon 要的那张控制图。
          映射用的是 ⑦ 里「{packGameDef.name}」那条模板 —— 拿素材里的真实配对逐像素验过的那条。
        </p>

        <div class="slots" style="margin-top:12px">
          <Slot
            label={packPreset.srcLabel}
            url={packSlot.url}
            name={packSlot.ref?.name}
            meta={packSlot.size}
            onpick={() => packSlots.pick(packGame === 'zzz' ? 'm' : 'lm')}
            onclear={() => packSlots.clear(packGame === 'zzz' ? 'm' : 'lm')}
            ondropfile={(f) => packSlots.loadFile(packGame === 'zzz' ? 'm' : 'lm', f)}
            slot={{ group: packSlots, id: packGame === 'zzz' ? 'm' : 'lm' }}
          />
        </div>

        {#if packGame === 'zzz'}
          <div style="margin-top:10px">
            <Note>绝区零这一档要的是 <span class="mono">_M</span>（金属度 / 阴影图），不是 lightmap。</Note>
          </div>
        {/if}

        {#if packSlot.ref}
          <p class="mini" style="margin-top:8px">
            源：<span class="mono">{packSlot.ref.name}</span>
          </p>
        {/if}
      </div>

      {#if packUrl}
        <div class="card pad">
          <h3 class="h3">打包结果 {packW}×{packH}</h3>
          <Preview url={packUrl} wide />
          <div class="tiles" style="margin-top:10px">
            {#each packTiles as t (t.ch)}
              <figure class="tile">
                <img src={t.url} alt="" />
                <figcaption><i class="chip chip--{t.ch}">{t.label}</i> {packGameDef.roles[t.ch]}</figcaption>
              </figure>
            {/each}
          </div>
        </div>
      {:else}
        <Note>选一张图，这里出打包好的控制图，R/G/B/A 四路会分开摊开给你核。</Note>
      {/if}

      <div class="wb__acts">
        <span class="mini mut">
          {packSlot.ref
            ? `写到 ${outPathNear(packSlot, '_MS_TOON').split(/[\\/]/).pop()}，另加一份能照着重来的说明。`
            : '没带源图路径就写到当前目录。'}
        </span>
        <button class="btn btn--primary" disabled={!packSlot.data || packBusy} onclick={exportPack}>
          <Icon name="ui.export" size={15} />导出控制图
        </button>
      </div>
    </div>

    <aside class="card wb__side">
      <div class="grp">
        <h3 class="grp__t">这一档的映射</h3>
        <ul class="mini ul">
          {#each packGameDef.specs as s (s)}
            <li>{s}</li>
          {/each}
        </ul>
      </div>

      {#if packHasWindow}
        <div class="grp">
          <h3 class="grp__t">B 那个窗口</h3>
          <p class="mini">星铁这档才有：每张贴图不一样，是手填的参数。两个实测值点一下就用：</p>
          <div class="seg seg--inline" role="group" aria-label="窗口预设" style="margin-top:8px">
            {#each HSR_WINDOWS as w (w.id)}
              <button
                class="seg__btn {packWindow !== null && Math.abs(packWindow - w.hi) < 1e-9 ? 'is-on' : ''}"
                type="button"
                title={w.note}
                onclick={() => (packWindow = w.hi)}
              >{w.label}</button>
            {/each}
          </div>
          <div class="row" style="margin-top:8px">
            <span class="row__k">hi</span>
            <input
              class="range range--inline"
              type="number"
              min="1"
              max="255"
              step="0.001"
              aria-label="窗口"
              value={packWindow ?? 255 - packGameDef.plan.b.lo}
              onchange={(e) => {
                const v = Number(e.currentTarget.value);
                if (Number.isFinite(v) && v > 0) packWindow = v;
              }}
            />
          </div>
          <p class="mini" style="margin-top:6px">
            现在 hi = <span class="mono">{(packWindow ?? 255 - packGameDef.plan.b.lo).toFixed(3)}</span>
            {#if packWindow === null}（模板里的值）{/if}
          </p>
        </div>
      {/if}

      <div class="grp">
        <p class="mini">{packGameDef.note.replace(/\*\*/g, '')}</p>
      </div>

    </aside>
  </div>
{:else if !srcSlot.data}
  <!-- 空态也要是**标准工作区骨架**（`.wb` + `.wb__main` + `.wb__acts`）。
       原来这里是一个裸 `.card`，没有 `.wb` —— 后果有两个：
       ① 体检把这四个分区记成 `n/a（还没工作区版面）`（判据就是"有没有 `.wb`"）；
       ② 新手进这一页看到的是"没版面的半页"，跟别的页不是一个东西。
       主按钮照旧摆出来但**禁用**（没源图没什么可导的），跟 ⑦ 那些页一个做法。 -->
  <div class="wb">
    <div class="wb__main">
      <div class="card pad">
        <div class="slots">
          <Slot
            label="源图"
            url={srcSlot.url}
            name={srcSlot.ref?.name}
            meta={srcSlot.size}
            onpick={() => slots.pick('src')}
            onclear={() => slots.clear('src')}
            ondropfile={(f) => slots.loadFile('src', f)}
            slot={{ group: slots, id: 'src' }}
          />
        </div>
        <div class="msgwrap">
          <Note kind="warn">
            这四张图是按官方 msToon ver1.1 的真包量出来的通道约定做的，但<b>生成规则</b>是我自己定的 ——
            原版怎么从 diffuse 推出这几张，作者没写文档。默认值不好用就直接改参数，界面上每一项都能动。
          </Note>
          <div style="margin-top:10px">
            <Note>量出来的约定：{MSTOON_CONVENTION.note}</Note>
          </div>
          <ul class="mini ul" style="margin-top:10px">
            {#each MSTOON_CONVENTION.measured as m (m)}
              <li>{m}</li>
            {/each}
          </ul>
        </div>
      </div>
      <div class="wb__acts">
        <span class="mini mut nowrap">先放一张源图，参数与预览就出来了</span>
        <button class="btn btn--primary" disabled>导出控制图</button>
      </div>
    </div>
  </div>
{:else if panelId === 'shadowrate' || panelId === 'sublight'}
  <div class="wb">
    <div class="wb__main">
      {@render 游戏条()}
      <div class="card pad">
        <div class="slots slots--4">
          {#each CHANNEL_KEYS as k (k)}
            <Slot
              label="源图"
              tag={CHANNEL_LABEL[k]}
              tagKind={k}
              url={built.tiles.find((t) => t.ch === k)?.url ?? null}
              meta={built.w ? `${built.w}×${built.h}` : ''}
              onpick={() => slots.pick('src')}
              onclear={() => slots.clear('src')}
              ondropfile={(f) => slots.loadFile('src', f)}
        slot={{ group: slots, id: 'src' }}
            />
          {/each}
        </div>
      </div>

      <div class="card pad">
        <div class="row" style="margin-bottom:10px">
          <span class="row__k">合成结果</span>
          <div class="pick" style="width:18rem">
            {#each ['all', 'r', 'g', 'b', 'a'] as v (v)}
              <button class="pick__b" type="button" aria-pressed={chanView === v} onclick={() => (chanView = v as typeof chanView)}>
                {v === 'all' ? '成品' : CHANNEL_LABEL[v as ChannelKey]}
              </button>
            {/each}
          </div>
        </div>
        {#if viewUrl}
          <Preview url={viewUrl} wide />
          <p class="mini" style="margin-top:8px">
            预览是缩略图。导出按源图原尺寸重算。
          </p>
        {:else}
          <Note>源图读不进来的话这里空着。</Note>
        {/if}
      </div>
    </div>

    <aside class="card wb__side">
      <div class="grp">
        <h3 class="grp__t">网格</h3>
        <label class="chk">
          <input type="checkbox" bind:checked={snap05} />
          <span class="chk__box"></span>吸附到 0.05 网格
        </label>
        {#if built.composed}
          <p class="mini" style="margin-top:8px">
            当前产出落在网格上的比例 <b class="mono">{(gridRatio * 100).toFixed(1)}%</b>。
            真包实测：Lumine 披风 G 97.2%、ZZZ 身体 G 99.6%、面部阴影 R 99.3%。
          </p>
        {/if}
      </div>

      <div class="grp">
        <h3 class="grp__t">现成 ladder</h3>
        <div class="acts">
          {#each LADDER_PRESETS as p (p.id)}
            <button class="btn btn--ghost btn--sm" type="button" onclick={() => applyLadderPreset(currentSpec(), p.id)}>
              {p.name}
            </button>
          {/each}
        </div>
        <p class="mini" style="margin-top:8px">
          抄自 <span class="mono">星铁预设.json</span>，是那四类材质的实测分布。
        </p>
      </div>

      {#each CHANNEL_KEYS as k (k)}
        {@const s = currentSpec()[k]}
        <div class="grp">
          <h3 class="grp__t"><i class="chip chip--{k}">{CHANNEL_LABEL[k]}</i> 怎么给</h3>
          <div class="pick">
            {#each [['source', '取通道'], ['ladder', '按分布'], ['const', '常量']] as opt (opt[0])}
              <button
                class="pick__b"
                type="button"
                aria-pressed={s.mode === opt[0]}
                onclick={() => setSpec(k, { mode: opt[0] as ChMode })}
              >{opt[1]}</button>
            {/each}
          </div>

          {#if s.mode === 'source'}
            <div class="row" style="margin-top:10px">
              <span class="row__k">取源图的哪一路</span>
              <div class="pick" style="width:11rem">
                {#each CHANNEL_KEYS as sc (sc)}
                  <button class="pick__b" type="button" aria-pressed={s.ch === sc} onclick={() => setSpec(k, { ch: sc })}>
                    {CHANNEL_LABEL[sc]}
                  </button>
                {/each}
              </div>
            </div>
            <div class="row" style="margin-top:8px">
              <span class="row__k">上下限拉伸</span>
              <div class="pick" style="width:11rem">
                {#each [['none', '不拉'], ['auto', '自动'], ['manual', '手填']] as opt (opt[0])}
                  <button
                    class="pick__b"
                    type="button"
                    aria-pressed={s.stretchMode === opt[0]}
                    onclick={() => setSpec(k, { stretchMode: opt[0] as 'none' | 'auto' | 'manual' })}
                  >{opt[1]}</button>
                {/each}
              </div>
            </div>
            {#if s.stretchMode === 'manual'}
              <div class="row" style="margin-top:8px">
                <span class="row__k">下限</span>
                <input class="range range--inline" type="range" min="0" max="254" bind:value={s.lo} aria-label="{CHANNEL_LABEL[k]} 下限" />
                <span class="row__v">{s.lo}</span>
              </div>
              <div class="row">
                <span class="row__k">上限</span>
                <input class="range range--inline" type="range" min="1" max="255" bind:value={s.hi} aria-label="{CHANNEL_LABEL[k]} 上限" />
                <span class="row__v">{s.hi}</span>
              </div>
            {/if}
            <label class="chk" style="margin-top:8px">
              <input type="checkbox" checked={s.invert} onchange={(e) => setSpec(k, { invert: e.currentTarget.checked })} />
              <span class="chk__box"></span>反相
            </label>
          {:else if s.mode === 'ladder'}
            <div class="row" style="margin-top:10px">
              <span class="row__k">兜底值</span>
              <input
                class="range range--inline"
                type="range" min="0" max="1" step="0.01"
                value={s.ladder.def}
                aria-label="{CHANNEL_LABEL[k]} 兜底值"
                oninput={(e) => setSpec(k, { ladder: { ...s.ladder, def: +e.currentTarget.value } })}
              />
              <span class="row__v">{s.ladder.def.toFixed(2)}</span>
            </div>
            <div class="row" style="margin-top:6px">
              <span class="row__k">档位</span>
              <span class="row__v" class:bad={shareSum(k) > 1}>合计 {shareSum(k).toFixed(3)}</span>
            </div>
            {#each s.ladder.rungs as r, i (i)}
              <div class="rung">
                <input
                  class="rung__num" type="number" min="0" max="1" step="0.05" value={r.v}
                  aria-label="{CHANNEL_LABEL[k]} 第 {i + 1} 档值"
                  oninput={(e) => setRung(k, i, { v: +e.currentTarget.value })}
                />
                <input
                  class="rung__num" type="number" min="0" max="1" step="0.01" value={r.share}
                  aria-label="{CHANNEL_LABEL[k]} 第 {i + 1} 档占比"
                  oninput={(e) => setRung(k, i, { share: +e.currentTarget.value })}
                />
                <button class="rung__x" type="button" onclick={() => delRung(k, i)} title="删这一档">×</button>
              </div>
            {/each}
            <button class="btn btn--ghost btn--sm" type="button" style="margin-top:6px" onclick={() => addRung(k)}>加一档</button>
            <p class="mini" style="margin-top:8px">
              左边是值、右边是占比。出来的图会按这个分布重排源通道 —— 暗的还是暗的，但每个值的占比被拉到这儿写的数。
            </p>
          {:else}
            <div class="row" style="margin-top:10px">
              <span class="row__k">常量值</span>
              <input
                class="range range--inline"
                type="range" min="0" max="1" step="0.01"
                value={s.ladder.def}
                aria-label="{CHANNEL_LABEL[k]} 常量"
                oninput={(e) => setSpec(k, { ladder: { ...s.ladder, def: +e.currentTarget.value } })}
              />
              <span class="row__v">{s.ladder.def.toFixed(2)}</span>
            </div>
          {/if}
        </div>
      {/each}
    </aside>
  </div>
  <div class="msgwrap">
    <button class="btn btn--primary" disabled={busy} onclick={() => exportCurrent(panelId === 'shadowrate' ? '_ShadowRate' : '_SubLightRate')}>
      <Icon name="ui.export" size={15} />导出
    </button>
  </div>
{:else if panelId === 'edge'}
  <div class="wb">
    <div class="wb__main">
      {@render 游戏条()}
      <div class="card pad">
        <h3 class="h3">描边落在哪儿</h3>
        {#if edgeOverlayUrl}
          <Preview url={edgeOverlayUrl} />
        {:else}
          <div class="slots">
            <Slot label="源图" url={srcSlot.url} name={srcSlot.ref?.name} meta={srcSlot.size} onpick={() => slots.pick('src')} onclear={() => slots.clear('src')} />
          </div>
        {/if}
      </div>
      <div class="card pad">
        <h3 class="h3">EdgeRate 成品</h3>
        {#if edgeUrl}
          <Preview url={edgeUrl} wide />
        {/if}
      </div>
    </div>

    <aside class="card wb__side">
      <div class="grp">
        <h3 class="grp__t">阈值</h3>
        <div class="row">
          <span class="row__k">切在哪儿</span>
          <input class="range range--inline" type="range" min="0" max="255" bind:value={edgeThreshold} aria-label="阈值" />
          <span class="row__v">{edgeThreshold}</span>
        </div>
        <label class="chk" style="margin-top:8px">
          <input type="checkbox" bind:checked={edgeSoft} />
          <span class="chk__box"></span>软过渡
        </label>
        {#if edgeSoft}
          <div class="row" style="margin-top:8px">
            <span class="row__k">过渡宽度</span>
            <input class="range range--inline" type="range" min="2" max="120" bind:value={edgeSoftWidth} aria-label="过渡宽度" />
            <span class="row__v">{edgeSoftWidth}</span>
          </div>
        {/if}
      </div>
      <div class="grp">
        <h3 class="grp__t">Sobel 之前</h3>
        <label class="chk">
          <input type="checkbox" bind:checked={edgeDenoise} />
          <span class="chk__box"></span>3×3 均值降噪
        </label>
        <label class="chk" style="margin-top:6px">
          <input type="checkbox" bind:checked={edgeNormalize} />
          <span class="chk__box"></span>先拉满量程
        </label>
        <p class="mini" style="margin-top:8px">不降噪的话麻点会全被当成描边。</p>
      </div>
      <div class="grp">
        <h3 class="grp__t">输出</h3>
        <label class="chk">
          <input type="checkbox" bind:checked={edgeToGB} />
          <span class="chk__box"></span>同时写进 G / B
        </label>
        <p class="mini" style="margin-top:8px">不勾就只写 R，G/B 留 0，A 沿用源图的透明区。</p>
      </div>
      <div class="grp">
        <button class="btn btn--primary" disabled={busy} onclick={() => exportCurrent('_EdgeRate')}>
          <Icon name="ui.export" size={15} />导出 EdgeRate
        </button>
      </div>
    </aside>
  </div>
{:else}
  <div class="wb">
    <div class="wb__main">
      {@render 游戏条()}
      {#if sdfMode === 'distance'}
        <div class="card pad">
          <h3 class="h3">交界线</h3>
          {#if sdfMaskUrl}
            <Preview url={sdfMaskUrl} note="阈值切出来的掩膜" />
          {/if}
        </div>
      {/if}
      <div class="card pad">
        <h3 class="h3">{sdfMode === 'channel' ? `取出来的 ${CHANNEL_LABEL[sdfCh]} 通道` : '距离场'}</h3>
        {#if sdfUrl}
          <Preview url={sdfUrl} wide />
          <p class="mini" style="margin-top:8px">
            {sdfMode === 'channel'
              ? 'R 放数据，G / B 恒 0，A 恒 1 —— 真图就是这个形状。'
              : `掩膜上为 0，越远越大，${sdfMaxDist} 像素外全部拉满。`}
          </p>
        {/if}
      </div>
    </div>

    <aside class="card wb__side">
      <div class="grp">
        <h3 class="grp__t">怎么做</h3>
        <div class="pick">
          {#each [['channel', '取通道'], ['distance', '交界线转距离场']] as opt (opt[0])}
            <button
              class="pick__b"
              type="button"
              aria-pressed={sdfMode === opt[0]}
              onclick={() => (sdfMode = opt[0] as 'channel' | 'distance')}
            >{opt[1]}</button>
          {/each}
        </div>
        <p class="mini" style="margin-top:8px">
          {sdfMode === 'channel'
            ? '这两个游戏都用这条：原神直接取脸部 lightmap 的 G，星铁取脸图的 A 再反相。都不做距离场。'
            : '阈值切出交界线，再往两侧铺距离场，最后按<b>游戏各自的排法</b>码进 RGBA（三套都是量出来的）。'}
        </p>
      </div>

      {#if sdfMode === 'channel'}
        <div class="grp">
          <h3 class="grp__t">取哪一路</h3>
          <div class="pick">
            {#each CHANNEL_KEYS as k (k)}
              <button
                class="pick__b"
                type="button"
                aria-pressed={sdfCh === k}
                onclick={() => (sdfCh = k)}
              >{CHANNEL_LABEL[k]}</button>
            {/each}
          </div>
          <label class="chk" style="margin-top:8px">
            <input type="checkbox" bind:checked={sdfInvert} />
            <span class="chk__box"></span>反相
          </label>
        </div>
      {:else}
        <div class="grp">
          <h3 class="grp__t">按哪个游戏的排法码通道</h3>
          <div class="pick">
            {#each ['genshin', 'hsr', 'zzz'] as g (g)}
              <button class="pick__b" type="button" aria-pressed={SDF_GAME[game] === g}
                onclick={() => (game = (g === 'genshin' ? 'gi' : g) as GameKey)}>
                {g === 'genshin' ? '原神' : g === 'hsr' ? '星铁' : '绝区零'}
              </button>
            {/each}
          </div>
          <p class="mini" style="margin-top:8px">
            {ENCODINGS.find((e) => e.id === SDF_GAME[game])?.hint ?? ''}
          </p>
          {#if SDF_GAME[game] === 'hsr'}
            <div class="slots" style="margin-top:10px">
              <Slot label="0.5 区（白 = 标成 0.5）" url={markSlot.url} name={markSlot.ref?.name}
                meta={markSlot.size || ''} onpick={() => markSlots.pick('mark')}
                onclear={() => markSlots.clear('mark')} ondropfile={(f) => markSlots.loadFile('mark', f)}
                slot={{ group: markSlots, id: 'mark' }} />
            </div>
            <p class="mini" style="margin-top:6px">
              实测那 11 张星铁 FaceMap：R 是 0/0.5/1 三档，那片 0.5 跟 G 的边界对不上
              （只有 1~3% 落在边界 ±2px 里）——<b>它是作者按脸部结构画的，算法推不出来</b>，
              所以留给你手标：把要标成 0.5 的地方涂白导出，丢进这一格。不给就是 0/1 两档。
            </p>
          {/if}
        </div>
        <div class="grp">
          <h3 class="grp__t">阈值</h3>
          <div class="row">
            <span class="row__k">切在哪儿</span>
            <input class="range range--inline" type="range" min="0" max="255" bind:value={sdfThreshold} aria-label="阈值" />
            <span class="row__v">{sdfThreshold}</span>
          </div>
          <label class="chk" style="margin-top:8px">
            <input type="checkbox" bind:checked={sdfInvert} />
            <span class="chk__box"></span>反相（切亮的那边）
          </label>
        </div>
        <div class="grp">
          <h3 class="grp__t">距离场</h3>
          <div class="row">
            <span class="row__k">扩散范围</span>
            <input class="range range--inline" type="range" min="2" max="120" bind:value={sdfMaxDist} aria-label="扩散范围" />
            <span class="row__v">{sdfMaxDist}px</span>
          </div>
          <p class="mini" style="margin-top:6px">
            A 放什么由排法决定（原神四通道同一个场、星铁 A 放场、绝区零 A 拉满），不在这里选。
          </p>
        </div>
      {/if}
      <div class="grp">
        <h3 class="grp__t">源图亮度分布</h3>
        <div class="hist">
          {#each sdfHist as c, i (i)}
            <i style="height:{(c / histMax) * 100}%"></i>
          {/each}
          <span class="hist__mark" style="left:{sdfThreshold / 2.55}%"></span>
        </div>
        <p class="mini" style="margin-top:6px">竖线是当前阈值的位置。</p>
      </div>
      <div class="grp">
        <button class="btn btn--primary" disabled={busy} onclick={() => exportCurrent('_FaceSDF')}>
          <Icon name="ui.export" size={15} />导出 FaceSDF
        </button>
      </div>
    </aside>
  </div>
{/if}

{#if msg}
  <div class="msgwrap"><Note kind={msg.kind} onclose={() => (msg = null)} 自动关={提示自动关毫秒}>{msg.text}</Note></div>
{/if}

{#if packMsg}
  <div class="msgwrap"><Note kind={packMsg.kind} onclose={() => (packMsg = null)} 自动关={提示自动关毫秒}>{packMsg.text}</Note></div>
{/if}

{#if srcSlot.data && srcSlot.ref}
  <p class="mini" style="margin-top:10px">
    写到 <span class="mono">{outPathNear(srcSlot, '_EdgeRate').split(/[\\/]/).pop()}</span> 这种名字，跟源图放一起。
  </p>
{/if}

<style>
  .pad { padding: 16px; }
  .ul { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 5px; }
  .btn--sm { padding: 4px 10px; font-size: var(--fs-2xs); }
  .msgwrap { margin-top: 12px; }

  .rung { display: flex; gap: 6px; align-items: center; margin-top: 6px; }
  .rung__num {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: var(--fs-2xs);
    font-variant-numeric: tabular-nums;
    color: var(--deep-text);
    background: var(--surface-2);
    border: 1px solid var(--line-color);
    border-radius: var(--r-sm);
    padding: 3px 6px;
  }
  .rung__x {
    flex: none;
    width: 20px;
    height: 20px;
    border: 0;
    border-radius: var(--r-sm);
    background: var(--btn-regular-bg);
    color: var(--btn-content);
    cursor: pointer;
    line-height: 1;
  }
  .rung__x:hover { background: var(--btn-regular-bg-hover); }

  .hist {
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: 1px;
    height: 60px;
    padding: 0 1px;
    border-radius: var(--r-sm);
    background: var(--surface-2);
    overflow: hidden;
  }
  .hist i { flex: 1; background: var(--primary); opacity: 0.55; min-height: 1px; }
  .hist__mark {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--accent-solid-2);
    transform: translateX(-1px);
  }
</style>
