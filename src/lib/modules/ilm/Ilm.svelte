<script lang="ts">
  /**
   * ⑤ ILM / lightmap 打包。
   *
   * 三个分区：
   *   pack    —— 绝区零那套 _A / _M / _N → _LM，映射是验过的
   *   repack  —— 同一个操作换个目标规格（原神 / 星铁），加 ladder 配比生成
   *   pairing —— 对着目录核一遍，缺哪张、尺寸对不对、PMX 引没引
   *
   * 像素在 ops.ts，这里只管接和显示。
   * 预览一律缩略，导出按原尺寸重算 —— 2048² 每动一下都全算会卡。
   */
  import { Slots } from '$lib/wb.svelte';
  import {
    CHANNEL_KEYS,
    CHANNEL_LABEL,
    type ChannelKey,
    extractChannel,
    grayToImageData,
    imageDataToUrl,
    resize,
    预览长边,
    type ScaleMode
  } from '$lib/img';
  import { IMAGE_EXTS, joinPath, scanDir, saveImage, pickFolder, readPmx, isTauri } from '$lib/io';
  import type { WbProps } from '$lib/modules/wb-props';
  import Slot from '$lib/components/wb/Slot.svelte';
  import Preview from '$lib/components/wb/Preview.svelte';
  import Note from '$lib/components/wb/Note.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { 接目录 } from '$lib/dirdrop';
  /* 提示类提示条的统一下限：跟侧栏那条错误通道同一个 9 秒（`ui.svelte.ts`）。
     不传 `自动关` + `onclose` 的话 `Note` 既没有叉也不会自己走。 */
  import { 提示自动关毫秒 } from '$lib/ui.svelte';
  import {
    LM_SLOTS,
    MANUAL_LAYOUT_NOTE,
    PRESETS,
    REF_SLOT,
    ROLE_LABEL,
    ZZZ_MAP,
    baseStem,
    diffAgainst,
    lmOutName,
    packLm,
    planeStats,
    presetOf,
    roleOf,
    type DiffResult,
    type LmMap,
    type Role,
    type SrcRef
  } from './ops';

  let { panelId = 'pack' }: WbProps = $props();

  /* 预览按预览台的实际宽度算（见 img.ts 的 预览长边）。打包/抽通道很便宜，用默认上限 */
  const PREVIEW = 预览长边();

  /* ------------------------------------------------------------------ 槽位 */

  const packSlots = new Slots('ilm.pack', [
    { id: 'A', label: '_A 自发光 / 遮罩' },
    { id: 'M', label: '_M 材质' },
    { id: 'N', label: '_N 法线' },
    { id: REF_SLOT, label: '参照 LM（可选）' }
  ]);

  /* ------------------------------------------------------------------ 打包映射 */

  function cloneMap(m: LmMap): LmMap {
    const out = {} as LmMap;
    for (const k of CHANNEL_KEYS) out[k] = { ...m[k], ladder: m[k].ladder.map((e) => [...e] as [number, number]), drive: { ...m[k].drive } };
    return out;
  }

  let map = $state<LmMap>(cloneMap(ZZZ_MAP));
  let kernel = $state<ScaleMode>('lanczos');
  /** 数字是拿 vivian 的真实 LM 对出来的平均误差（级/255），见 ops.ts 的 packLm */
  const KERNELS: { id: ScaleMode; n: string }[] = [
    { id: 'lanczos', n: 'Lanczos · 差 0.13' },
    { id: 'bicubic', n: '立方 · 差 0.14' },
    { id: 'bilinear', n: '双线性 · 差 0.30' },
    { id: 'nearest', n: '最邻近 · 差 0.53' }
  ];
  let grid = $state(0);
  /* 规格 id。**现在只有 'zzz' 一个**（原神 / 星铁那两条映射已删，见 `ops.ts`），
     留着这个变量是因为下面一串都从 `presetOf(presetId)` 取 suffix / grid / semantics ——
     等哪天真有第二种验过的规格，把按钮加回来就行。原来那个 `applyPreset` 已删（没人调了）。 */
  let presetId = $state('zzz');

  /* ------------------------------------------------------------------ 导出状态 */

  let outDir = $state('');
  let busy = $state(false);
  let msg = $state<{ kind: 'ok' | 'warn' | 'info'; text: string } | null>(null);

  /* ------------------------------------------------------------------ 派生 */

  /** 有图就拿来当基准，优先级 A > M > N */
  function baseSlot() {
    for (const id of ['A', 'M', 'N']) {
      const sl = packSlots.get(id);
      if (sl?.data) return sl;
    }
    return null;
  }

  const target = $derived.by(() => {
    const b = baseSlot();
    return b?.data ? { w: b.data.width, h: b.data.height } : null;
  });

  /** 预览用的缩放比例：最长边压到 PREVIEW */
  const previewDims = $derived.by(() => {
    if (!target) return null;
    const m = Math.max(target.w, target.h);
    const k = m > PREVIEW ? PREVIEW / m : 1;
    return { w: Math.max(1, Math.round(target.w * k)), h: Math.max(1, Math.round(target.h * k)), k };
  });

  function sourceMap(): Map<string, ImageData> {
    const m = new Map<string, ImageData>();
    for (const id of Object.keys(packSlots.map)) {
      if (id === REF_SLOT) continue;
      const d = packSlots.get(id).data;
      if (d) m.set(id, d);
    }
    return m;
  }

  /** 缩略尺寸的源，给实时预览用 */
  function previewSources(w: number, h: number): Map<string, ImageData> {
    const out = new Map<string, ImageData>();
    for (const [id, img] of sourceMap()) {
      out.set(id, img.width === w && img.height === h ? img : resize(img, w, h, kernel));
    }
    return out;
  }

  let packedUrl = $state<string | null>(null);
  let tiles = $state<{ ch: ChannelKey; url: string }[]>([]);
  let packed: ImageData | null = null;

  const activeSlots = $derived(packSlots);

  $effect(() => {
    // 依赖：图、映射、核、网格 —— 都在下面被读到
    const pd = previewDims;
    if (!pd) {
      packedUrl = null;
      tiles = [];
      packed = null;
      return;
    }
    const src = previewSources(pd.w, pd.h);
    if (!src.size) {
      packedUrl = null;
      tiles = [];
      packed = null;
      return;
    }
    const m = packLm(pd.w, pd.h, map, src, kernel, grid);
    packed = m;
    packedUrl = imageDataToUrl(m);
    tiles = CHANNEL_KEYS.map((ch) => ({
      ch,
      url: imageDataToUrl(grayToImageData(extractChannel(m, ch), m.width, m.height))
    }));
  });

  const refSlot = $derived(packSlots.get(REF_SLOT));

  /**
   * 参照 LM 的逐通道核对。口径跟那张验证报告一样。
   *
   * 不挂 $derived —— 这个要按原尺寸跑一遍打包，2048² 是几百毫秒，
   * 每拖一下滑杆都来的话界面就顿住了。做成按钮点一下算一次。
   */
  let check = $state<DiffResult | null>(null);
  let checking = $state(false);

  async function runCheck() {
    const refImg = packSlots.get(REF_SLOT).data;
    if (!refImg || !target) return;
    const src = sourceMap();
    if (!src.size) return;
    checking = true;
    // 让浏览器先画出"算中"，再干活
    await new Promise((r) => setTimeout(r, 16));
    try {
      const full = packLm(target.w, target.h, map, src, kernel, grid);
      check = diffAgainst(full, refImg);
    } catch (e) {
      msg = { kind: 'warn', text: `核对失败：${(e as Error).message}` };
      check = null;
    }
    checking = false;
  }

  const stats = $derived.by(() => {
    // 先取到局部变量 —— packed 是 let，闭包里 TS 收窄不了
    const p = packed;
    if (!p) return null;
    return CHANNEL_KEYS.map((ch) => ({
      ch,
      ...planeStats(extractChannel(p, ch), 4)
    }));
  });

  /**
   * 图、映射、放大核、网格任意一个动了，上一次的核对结果就不算数了。
   * 这个 effect 不读 check，所以 runCheck 写进去的值不会被它清掉。
   */
  $effect(() => {
    void packSlots.get(REF_SLOT).data;
    void map;
    void kernel;
    void grid;
    void target;
    check = null;
  });

  /** 尺寸对不上就要说清楚，不然用户看到放大后的结果不知道为什么糊 */
  const sizeNotes = $derived.by(() => {
    const out: { label: string; size: string; vsTarget: string }[] = [];
    if (!target) return out;
    const slots = packSlots;
    for (const id of ['A', 'M', 'N']) {
      const s = slots.get(id);
      if (!s?.data) continue;
      if (s.data.width !== target.w || s.data.height !== target.h) {
        const k = target.w / s.data.width;
        out.push({
          label: s.label,
          size: `${s.data.width}×${s.data.height}`,
          vsTarget: k === Math.round(k) ? `放大 ${Math.round(k)}×` : `缩放到 ${target.w}×${target.h}`
        });
      }
    }
    return out;
  });

  /* ------------------------------------------------------------------ 操作 */

  function setCh(k: ChannelKey, patch: Partial<SrcRef>) {
    map = { ...map, [k]: { ...map[k], ...patch } };
  }

  async function autoPair() {
    const root = await pickFolder('绝区零打包', '/tools/ilm?panel=pack');
    if (!root) return;
    const files = await scanDir(root, IMAGE_EXTS, true);
    const groups = groupFiles(files);
    // 找第一组凑齐 A/M/N 的，直接填进来
    const hit = groups.find((g) => g.roles.A && g.roles.M && g.roles.N);
    if (!hit) {
      msg = { kind: 'warn', text: '这个目录里没找到凑齐 _A / _M / _N 的一组' };
      return;
    }
    for (const id of ['A', 'M', 'N'] as const) {
      const f = hit.roles[id];
      if (f) await activeSlots.loadRef(id, f);
    }
    msg = {
      kind: 'ok',
      text: `填进来一组：${hit.stem}（这个目录里一共 ${groups.length} 组）`
    };
  }

  /** 一组里的角色 → 文件 */
  type Group = { stem: string; roles: Partial<Record<Role, { path: string; name: string; rel: string; ext: string; size: number }>>; all: string[] };

  function groupFiles(files: { path: string; name: string; rel: string; ext: string; size: number }[]): Group[] {
    const m = new Map<string, Group>();
    for (const f of files) {
      const stem = baseStem(f.name);
      let g = m.get(stem);
      if (!g) {
        g = { stem, roles: {}, all: [] };
        m.set(stem, g);
      }
      g.all.push(f.name);
      const role = roleOf(f.name);
      // 同角色有多张就留第一张，够用了
      if (!g.roles[role]) g.roles[role] = f;
    }
    return [...m.values()].sort((a, b) => a.stem.localeCompare(b.stem));
  }

  async function exportLm() {
    if (!target) return;
    busy = true;
    msg = null;
    try {
      const p = presetOf(presetId);
      const full = packLm(target.w, target.h, map, sourceMap(), kernel, grid);
      const b = baseSlot();
      const name = lmOutName(b?.ref?.name ?? 'lightmap', p.suffix);

      let dir = outDir;
      if (isTauri() && !dir) {
        dir = (await pickFolder()) ?? '';
        if (!dir) {
          busy = false;
          return;
        }
        outDir = dir;
      }
      await saveImage(dir ? joinPath(dir, name) : name, full);
      msg = { kind: 'ok', text: `写了 ${name}（${full.width}×${full.height}）` };
    } catch (e) {
      msg = { kind: 'warn', text: `导出失败：${(e as Error).message}` };
    }
    busy = false;
  }

  async function exportParts() {
    if (!target) return;
    busy = true;
    try {
      const p = presetOf(presetId);
      const full = packLm(target.w, target.h, map, sourceMap(), kernel, grid);
      const b = baseSlot();
      const stem = baseStem(b?.ref?.name ?? 'lightmap');
      let dir = outDir;
      if (isTauri() && !dir) {
        dir = (await pickFolder()) ?? '';
        if (!dir) {
          busy = false;
          return;
        }
        outDir = dir;
      }
      for (const ch of CHANNEL_KEYS) {
        const gray = grayToImageData(extractChannel(full, ch), full.width, full.height);
        const name = `${stem}${p.suffix}_${CHANNEL_LABEL[ch]}.png`;
        await saveImage(dir ? joinPath(dir, name) : name, gray);
      }
      msg = { kind: 'ok', text: '写了 4 张分量' };
    } catch (e) {
      msg = { kind: 'warn', text: `导出失败：${(e as Error).message}` };
    }
    busy = false;
  }

  /* `loadLadder` / `LADDER_NAMES` 已删（2026-09-26）：它们服务的是「换成别的排法」那一页，
     而那一页的 `repack` 分区**根本没注册**（注册表里只有 pack / pairing）——
     于是这两个函数从头到尾没人调过。原神 / 星铁的配比表也一并删了，理由见 `ops.ts`。
     顺带把 `MANUAL_LAYOUT_NOTE` 从"只 import 不画"改成真的画出来：手填「按 ladder 配比」
     那条路还在，那句话就该在人面前。 */

  /* ------------------------------------------------------------------ 配对检查 */

  let pairRoot = $state('');
  let pairFiles = $state<{ path: string; name: string; rel: string; ext: string; size: number }[]>([]);
  let pairGroups = $state<Group[]>([]);
  let pairPmx = $state<{ name: string; textures: string[]; materials: number; error?: string } | null>(null);
  let pairScanning = $state(false);

  async function scanPair() {
    const root = await pickFolder('配对检查', '/tools/ilm?panel=pairing');
    if (!root) {
      pairScanning = false;
      return;
    }
    await 扫配对这个目录(root);
  }

  /**
   * 扫一个模型目录 —— 点「选模型目录」和**拖文件夹进来**走同一条
   * （这一页原来一个落点都没有，拖进来只会得到"没落在能接它的地方"）。
   */
  async function 扫配对这个目录(root: string) {
    pairScanning = true;
    pairPmx = null;
    try {
      pairRoot = root;
      pairFiles = await scanDir(root, IMAGE_EXTS, true);
      pairGroups = groupFiles(pairFiles);

      // 目录里有 pmx 就读一遍，看材质引了哪些贴图
      if (isTauri()) {
        const pmxFiles = await scanDir(root, ['pmx'], true);
        if (pmxFiles.length) {
          try {
            const info = await readPmx(pmxFiles[0].path);
            pairPmx = {
              name: pmxFiles[0].name,
              textures: info.textures,
              materials: info.materials.length
            };
          } catch (e) {
            pairPmx = { name: pmxFiles[0].name, textures: [], materials: 0, error: (e as Error).message };
          }
        }
      }
    } catch (e) {
      msg = { kind: 'warn', text: `扫描失败：${(e as Error).message}` };
    }
    pairScanning = false;
  }

  const pairSummary = $derived.by(() => {
    let complete = 0;
    let missing = 0;
    let hasLm = 0;
    for (const g of pairGroups) {
      const ok = !!(g.roles.A && g.roles.M && g.roles.N);
      if (ok) complete++;
      else missing++;
      if (g.roles.LM) hasLm++;
    }
    return { complete, missing, hasLm, total: pairGroups.length };
  });

  /** PMX 里引到的贴图文件名 → 磁盘上有没有 */
  const pmxCrossRef = $derived.by(() => {
    if (!pairPmx || pairPmx.error) return null;
    const onDisk = new Set(pairFiles.map((f) => f.name.toLowerCase()));
    const rows = pairPmx.textures.map((t) => {
      const base = t.replace(/\\/g, '/').split('/').pop() ?? t;
      return { raw: t, base, exists: onDisk.has(base.toLowerCase()) };
    });
    return { rows, missing: rows.filter((r) => !r.exists).length };
  });

  /* ------------------------------------------------------------------ ladder 编辑 */

  function ladderAdd(ch: ChannelKey) {
    const cur = map[ch].ladder;
    setCh(ch, { ladder: [...cur, [0.5, 0.1]] });
  }
  function ladderDel(ch: ChannelKey, i: number) {
    const cur = [...map[ch].ladder];
    cur.splice(i, 1);
    setCh(ch, { ladder: cur });
  }
  function ladderSet(ch: ChannelKey, i: number, idx: 0 | 1, v: number) {
    const cur = map[ch].ladder.map((e, j) => (j === i ? ([idx === 0 ? v : e[0], idx === 1 ? v : e[1]] as [number, number]) : e));
    setCh(ch, { ladder: cur });
  }
  /**
   * ladder 占比合计。写成普通函数而不是 $derived 包一层 ——
   * $derived 只在它自己的依赖变化时重算，把函数当值存下来之后，
   * 后面调用时读 map 已经不在响应式上下文里了，会读到旧值。
   */
  function ladderSum(ch: ChannelKey): number {
    return map[ch].ladder.reduce((s, e) => s + e[1], 0);
  }

  const curPreset = $derived(presetOf(presetId));
</script>

{#if !['pack', 'pairing'].includes(panelId)}
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
        <div class="acts" style="margin-bottom:12px">
          <button class="btn btn--ghost" onclick={autoPair}>
            <Icon name="ui.folder" size={15} />从目录自动配对
          </button>
          <button
            class="btn btn--ghost"
            onclick={() => packSlots.pickInto(['A', 'M', 'N'])}
          >
            <Icon name="ui.images" size={15} />一次选三张
          </button>
          <button class="btn btn--ghost" onclick={() => { packSlots.clearAll(); msg = null; }}>
            <Icon name="ui.refresh" size={15} />清空
          </button>
        </div>

        <div class="slots slots--3">
          {#each ['A', 'M', 'N'] as id (id)}
            {@const s = packSlots.get(id)}
            <Slot
              label={s.label}
              url={s.url}
              name={s.ref?.name}
              meta={s.srcFormat ? `${s.size} · ${s.srcFormat}` : s.size}
              need={id === 'A'}
              onpick={() => packSlots.pick(id)}
              onclear={() => packSlots.clear(id)}
              ondropfile={(f) => packSlots.loadFile(id, f)}
              slot={{ group: packSlots, id }}
            />
          {/each}
        </div>

        {#if sizeNotes.length}
          <div style="margin-top:12px">
            <Note kind="warn">
              {#each sizeNotes as n, i (n.label)}
                {#if i > 0}<br />{/if}
                <b>{n.label}</b> 是 {n.size}，跟基准差了尺寸 —— 会{n.vsTarget}。
              {/each}
              法线贴图半分辨率是常态。放大核默认 Lanczos，实测平均误差最小。
            </Note>
          </div>
        {/if}
      </div>

      {#if packedUrl}
        <div class="card pad">
          <h3 class="h3">打包结果</h3>
          <Preview url={packedUrl} wide />
          <p class="mini" style="margin-top:8px">
            预览是缩略图。导出按 {target?.w}×{target?.h} 重算。
          </p>
        </div>

        <div class="card pad">
          <h3 class="h3">四个分量</h3>
          <div class="tiles">
            {#each tiles as t (t.ch)}
              <figure class="tile">
                <img src={t.url} alt="" />
                <figcaption>
                  <i class="chip chip--{t.ch}">{CHANNEL_LABEL[t.ch]}</i>
                  <span class="mini">{curPreset.semantics[t.ch]}</span>
                </figcaption>
              </figure>
            {/each}
          </div>
        </div>

        {#if stats}
          <div class="card pad">
            <h3 class="h3">各通道分布</h3>
            <ul class="list">
              {#each stats as s (s.ch)}
                <li>
                  <i class="chip chip--{s.ch}">{CHANNEL_LABEL[s.ch]}</i>
                  <b>均值 {s.mean.toFixed(3)}</b>
                  <span class="list__sp">
                    用到 {s.levelCount} 档 ·
                    {#each s.levels as l, i (i)}
                      {#if i > 0} · {/if}{l.v.toFixed(2)}:{(l.pct * 100).toFixed(1)}%
                    {/each}
                  </span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      {:else}
        <Note>凑齐 _A / _M / _N 三张就能出图。L 那张如果已经存在，放到右下角当核对用。</Note>
      {/if}

      {#if refSlot.data}
        <div class="card pad">
          <div class="acts" style="margin-bottom:10px">
            <h3 class="h3" style="margin:0">核对</h3>
            <span class="acts__sp"></span>
            <button class="btn btn--ghost" disabled={!target || checking} onclick={runCheck}>
              <Icon name="ui.compare" size={15} />{checking ? '算中…' : '跟参照 LM 逐像素比'}
            </button>
          </div>
          {#if check}
            {#if check.sizeMismatch}
              <Note kind="warn">参照图尺寸跟打包尺寸不一样，没法逐像素比。</Note>
            {:else}
              <ul class="list">
                {#each check.perChannel as c (c.ch)}
                  <li>
                    <i class="chip chip--{c.ch}">{CHANNEL_LABEL[c.ch]}</i>
                    <b>平均差 {c.meanDiff.toFixed(3)}</b>
                    <span class="list__sp">
                      完全相同 {(c.identical * 100).toFixed(2)}% · max|diff| {c.maxDiff}
                    </span>
                  </li>
                {/each}
              </ul>
              <p class="mini" style="margin-top:8px">
                四通道全同 {(check.identicalAll * 100).toFixed(2)}%。
                R 和 B 应该是 100% —— 对不上说明源图不是同一套。
                G 取自半分辨率法线，高频在源图上就没有了，换哪个放大核都补不回来，
                所以这一路看平均差（0.2 级以内算对上了），别看「完全相同」的比例。
              </p>
            {/if}
          {:else}
            <p class="mini">
              参照图已经放进来了。点上面的按钮按原尺寸跑一遍，逐通道报相同像素比例和最大差。
            </p>
          {/if}
        </div>
      {/if}

      <div class="wb__acts">
        <span class="mini mut">{outDir || '跟 _A 放一起'}</span>
        <button class="btn btn--ghost" disabled={!target || busy} onclick={exportParts}>
          <Icon name="ui.channel" size={15} />四张分量
        </button>
        <button class="btn btn--primary" disabled={!target || busy} onclick={exportLm}>
          <Icon name="ui.export" size={15} />{busy ? '导出中…' : '导出 LM'}
        </button>
      </div>
    </div>

    <aside class="card wb__side">
      <div class="grp">
        <h3 class="grp__t">目标规格</h3>
        <p class="mini" style="margin:0">
          只有 <b>{curPreset.name}</b> 一种。这一页是"把三张现成的图按固定通道拼起来"，
          拼法是逐像素验过的。
        </p>
        <p class="mini" style="margin-top:6px">{curPreset.note}</p>
        <p class="mini" style="margin-top:6px">
          原神 / 星铁的 lightmap <b>不是这么来的</b> —— 那得自己画。
          这里原来摆着它们的预设和一串实测配比，已经删掉：自动那套只对得上"各档占多少面积"、
          对不上"哪块归哪档"。{MANUAL_LAYOUT_NOTE}
        </p>
      </div>

      <div class="grp">
        <h3 class="grp__t">每个分量从哪来</h3>
        {#each CHANNEL_KEYS as k (k)}
          <div class="row">
            <span class="row__k"><i class="chip chip--{k}">{CHANNEL_LABEL[k]}</i> {curPreset.semantics[k]}</span>
            <select
              value={map[k].kind === 'slot' ? map[k].slot : map[k].kind === 'const' ? '__const' : '__ladder'}
              aria-label="{CHANNEL_LABEL[k]} 来源"
              onchange={(e) => {
                const v = e.currentTarget.value;
                if (v === '__const') setCh(k, { kind: 'const' });
                else if (v === '__ladder') setCh(k, { kind: 'ladder' });
                else setCh(k, { kind: 'slot', slot: v });
              }}
            >
              {#each LM_SLOTS as sl (sl.id)}
                <option value={sl.id}>{sl.label}</option>
              {/each}
              <option value="__const">常量</option>
              <option value="__ladder">按 ladder 配比</option>
            </select>

            {#if map[k].kind === 'slot'}
              <div class="row--stack" style="grid-column:1/-1;margin-top:6px">
                <div class="pick">
                  {#each CHANNEL_KEYS as sc (sc)}
                    <button
                      class="pick__b"
                      type="button"
                      aria-pressed={map[k].ch === sc}
                      onclick={() => setCh(k, { ch: sc })}
                    >{CHANNEL_LABEL[sc]}</button>
                  {/each}
                </div>
              </div>
            {:else if map[k].kind === 'const'}
              <div class="row--stack" style="grid-column:1/-1;margin-top:6px">
                <input
                  type="range"
                  class="range"
                  min="0"
                  max="255"
                  value={map[k].constant}
                  aria-label="{CHANNEL_LABEL[k]} 常量"
                  oninput={(e) => setCh(k, { constant: +e.currentTarget.value })}
                />
                <span class="mini">常量 {map[k].constant}</span>
              </div>
            {/if}
            <label class="chk" style="margin-top:6px;grid-column:1/-1">
              <input type="checkbox" checked={map[k].invert} onchange={(e) => setCh(k, { invert: e.currentTarget.checked })} />
              <span class="chk__box"></span>反相
            </label>
          </div>
        {/each}
      </div>

      <div class="grp">
        <h3 class="grp__t">放大核</h3>
        <div class="pick">
          {#each KERNELS as o (o.id)}
            <button
              class="pick__b"
              type="button"
              aria-pressed={kernel === o.id}
              onclick={() => (kernel = o.id)}
            >{o.n}</button>
          {/each}
        </div>
        <p class="mini" style="margin-top:8px">
          只对尺寸对不上的源生效。数字是对照真实 LM 测的平均误差（级/255）。
          最邻近看着「保边」，在半分辨率法线上反而差得最多。
          Lanczos 最准但慢，2048² 上约 0.9 秒；立方 0.3 秒而误差只多 0.01 级，
          批量导出时选它更划算。
        </p>
      </div>

      <div class="grp">
        <h3 class="grp__t">导出</h3>
        <div class="row">
          <span class="row__k">目录</span>
          <button class="btn btn--ghost btn--sm" onclick={async () => (outDir = (await pickFolder()) ?? '')}>选</button>
        </div>
        <p class="mini" style="margin-top:6px">{outDir || '跟 _A 放一起'}</p>
        <p class="mini" style="margin-top:6px">主按钮在主区最后一行。</p>
      </div>

      <div class="grp">
        <h3 class="grp__t">映射说明</h3>
        <ul class="mini ul">
          <li><span class="mono">R ← _A.G</span>、<span class="mono">B ← _M.B</span> 是逐像素精确的。</li>
          <li><span class="mono">G ← _N.B</span>，法线常是主贴图的 1/2，得先放大。</li>
          <li><span class="mono">_M</span> 的 G 通道最终图里不用，只要它的 B。</li>
          <li>A 填 1。</li>
        </ul>
      </div>
    </aside>
  </div>
{:else if panelId === 'pairing'}
  <div class="wb">
    <!-- 拖文件夹进来 = 点这颗「选模型目录」（这一页整页的活就是"指一个目录"） -->
    <div class="wb__main" use:接目录={{ 收: (p) => void 扫配对这个目录(p), label: '配对检查', href: '/tools/ilm?panel=pairing' }}>
      <div class="card pad">
        <div class="acts">
          <button class="btn btn--primary" onclick={scanPair} disabled={pairScanning}>
            <Icon name="ui.folder" size={15} />{pairScanning ? '扫描中…' : '选模型目录'}
          </button>
          {#if pairRoot}<span class="mini mono">{pairRoot}</span>{/if}
          {#if pairGroups.length}
            <span class="mini">
              共 {pairSummary.total} 组 · 齐 {pairSummary.complete} · 缺 {pairSummary.missing} · 已有 LM {pairSummary.hasLm}
            </span>
          {/if}
        </div>
      </div>

      {#if pairGroups.length}
        <div class="card pad">
          <h3 class="h3">按名字分组</h3>
          <ul class="list">
            {#each pairGroups as g (g.stem)}
              <li>
                <span class="roles">
                  {#each ['A', 'M', 'N', 'D', 'LM'] as r (r)}
                    {#if g.roles[r as Role]}
                      <i class="role role--on">{ROLE_LABEL[r as Role]}</i>
                    {:else if r === 'A' || r === 'M' || r === 'N'}
                      <i class="role role--miss">{ROLE_LABEL[r as Role]}</i>
                    {/if}
                  {/each}
                </span>
                <b>{g.stem}</b>
                <span class="list__sp">
                  {#if g.roles.A && g.roles.M && g.roles.N}
                    可打包{#if g.roles.LM}，已有 LM 会被覆盖{/if}
                  {:else}
                    缺 {['A', 'M', 'N'].filter((r) => !g.roles[r as Role]).map((r) => ROLE_LABEL[r as Role]).join(' ')}
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
        </div>

        {#if pairPmx}
          <div class="card pad">
            <h3 class="h3">对着材质文件核一遍</h3>
            {#if pairPmx.error}
              <Note kind="warn">读不了 {pairPmx.name}：{pairPmx.error}</Note>
            {:else}
              <p class="mini" style="margin-bottom:10px">
                {pairPmx.name} 里有 {pairPmx.materials} 个材质，引了 {pairPmx.textures.length} 张贴图。
                其中有 {pmxCrossRef?.missing ?? 0} 张在这个目录里找不到。
              </p>
              <ul class="list">
                {#each pmxCrossRef?.rows ?? [] as r (r.raw)}
                  <li>
                    <i class="role" class:role--miss={!r.exists} class:role--on={r.exists}>
                      {r.exists ? '有' : '缺'}
                    </i>
                    <b>{r.base}</b>
                    <span class="list__sp mono">{r.raw}</span>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      {:else if !pairScanning}
        <Note>
          选一个模型目录，按文件名把 _A / _M / _N / _D / _LM 归成组，
          报哪组缺哪张。目录里有 .pmx 的话也会读一遍材质表，看引的贴图齐不齐。
        </Note>
      {/if}
    </div>

    <aside class="card wb__side">
      <div class="grp">
        <h3 class="grp__t">分组规则</h3>
        <ul class="mini ul">
          <li>同名不同后缀算一组：<span class="mono">Body_A</span> / <span class="mono">Body_M</span> / <span class="mono">Body_N</span>。</li>
          <li>后缀识别：_A _M _N _D _LM _LightMap _ILM _Color _Diffuse。</li>
          <li>要能把 _A / _M / _N 凑齐才叫"可打包"，缺一张就不出图。</li>
        </ul>
      </div>
      <div class="grp">
        <h3 class="grp__t">为什么只做绝区零</h3>
        <p class="mini">
          绝区零是"打包"：三张现成的图按固定通道拼起来，零误差。
          原神、星铁的 lightmap 得靠画，那是另一条路 —— 换到「换成别的排法」去配。
        </p>
      </div>
    </aside>
  </div>
{/if}

{#if activeSlots.lastError && panelId !== 'pairing'}
  <div style="margin-top:12px">
    <Note kind="warn" onclose={() => activeSlots.clearError()} 自动关={提示自动关毫秒}>{activeSlots.lastError}</Note>
  </div>
{/if}
{#if msg}
  <div style="margin-top:12px"><Note kind={msg.kind} onclose={() => (msg = null)} 自动关={提示自动关毫秒}>{msg.text}</Note></div>
{/if}

<style>
  .tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
  @media (max-width: 900px) { .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .tile { margin: 0; display: grid; gap: 6px; justify-items: center; }
  .tile img {
    width: 100%; height: 118px; object-fit: contain;
    image-rendering: pixelated;
    border-radius: var(--r-md);
    background: #fff;
  }
  .tile figcaption { font-size: var(--fs-2xs); display: grid; gap: 3px; justify-items: center; text-align: center; }

  .ul { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 5px; }
  .btn--sm { padding: 4px 10px; font-size: var(--fs-2xs); }
  /* 选中的预设**不加粗**（2026-09-23 统一口径）。
     这里原来写的 `font-weight: 600` 其实是个**空操作** —— `.btn` 基础字重就是 600
     （`tokens.css` 的 `.btn`），所以它从来没把邻座推动过（实测点「原神」：三颗的字重
     都是 600→600、位置 0 位移）。去掉是为了不给"选中态改字重"留先例：
     ① 那边的 `.pick__b` 就是这么把整排横挪 3.15px 的（见 `PROGRESS.md` 本轮）。
     选中本来就有底色 + 主题色文字，再补一条 inset 描边 —— 不参与布局。 */
  .btn--ghost.is-on {
    background: var(--rail-item-bg);
    color: var(--primary-ink);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--primary) 45%, var(--line));
  }

  .roles { display: inline-flex; gap: 3px; flex: none; }
  .role {
    display: inline-grid; place-items: center;
    min-width: 22px; height: 17px; padding: 0 4px;
    border-radius: var(--r-sm);
    font-size: 10px; font-style: normal; font-weight: 700;
    background: var(--btn-regular-bg); color: var(--content-meta);
  }
  .role--on { background: var(--rail-item-bg); color: var(--primary-ink); }
  .role--miss { background: transparent; color: var(--danger); border: 1px dashed color-mix(in oklab, var(--danger) 50%, transparent); }
</style>
