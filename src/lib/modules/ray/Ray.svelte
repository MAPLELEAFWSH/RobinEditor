<script lang="ts">
  /**
   * ③ Ray 渲可视化编辑器。
   *
   * 两个分区：
   *   conf     —— 选 Ray 包根目录，读 ray.conf / ray_advanced.conf，也能顺手打开里面的材质文件
   *   material —— 直接选一个 .fx / .fxsub
   *
   * 写盘的规矩（一条都不能省）：
   *   先出 diff → 确认 → 写之前留 .bak → 写完读回来重新解析核对 → 只有该改的那几行确实
   *   变成新值才算成功，对不上就把备份路径报出来。
   *
   * 非 UTF-8 的文件（日文 Ray 包的注释是 Shift-JIS）走字节拼接，只换 ASCII 那一段，
   * 日文注释按原始字节搬过去。编不回去的情况直接拒写并说明原因，不硬写 ——
   * 硬写等于把整份文件的编码换成 UTF-8，MME 那边可能直接读不出来。
   *
   * 路径里有中文 / 日文 / 空格是没问题的（测试跑过「贴图样本」「木偶」这种目录）。
   * 真正受限的是**文件本身的编码**：Shift-JIS 的 .fx 里写不进中文文件名，
   * 因为没有 Shift-JIS 编码器，这个限制会在界面上明说。
   */
  import type { WbProps } from '$lib/modules/wb-props';
  import {
    findFile, saveBytes, readBytes, readText, probeDir, pickFolder, pickImages, scanDir
  } from '$lib/io';
  import { isTauri } from '$lib/open';
  import Note from '$lib/components/wb/Note.svelte';
  import { 提示自动关毫秒 } from '$lib/ui.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Row from './Row.svelte';
  import { explain, coverage, sectionOf, type Doc } from './docs';
  import {
    applyEditsToText, collectChanges, parseRayText, setConstValue, setDefineValue,
    spliceAsciiLineEdits, type Change, type Entry, type ParsedFile
  } from './ops';
  import { relativeFrom } from './value';
  import { registerZone, unregisterZone } from '$lib/dropzones.svelte';
  import { 材质落点表, type 落点声明 } from './落点';
  import { side, 开抽屉, 切钉, 拖把手 } from '$lib/side.svelte';
  import {
    canRedo, canUndo, fileLabelOf, hhmmss, recordWrite, redoAll, redoWrite, timelineRows,
    undoAll, undoWrite, reverseChange, type HistoryIo, type WriteRecord
  } from './history';

  let { panelId = 'conf' }: WbProps = $props();

  type Loaded = {
    path: string;
    text: string;
    bytes: Uint8Array;
    encoding: string;
    lossy: boolean;
    parsed: ParsedFile;
  };

  let file = $state<Loaded | null>(null);
  let values = $state<Record<string, string>>({});
  let actives = $state<Record<string, boolean>>({});
  let busy = $state(false);
  let msg = $state<{ kind: 'ok' | 'warn' | 'info'; text: string } | null>(null);
  let log = $state<WriteRecord[]>([]);
  let logMsg = $state<string | null>(null);

  /* ---------------------------------------------------------- 根目录 */

  type Probe = {
    root: string;
    rayConf: string | null;
    advanced: string | null;
    rayFx: string | null;
    controller: string | null;
    material: string | null;
    counts: { fx: number; fxsub: number; conf: number };
    materials: { path: string; rel: string; ext: string }[];
    readme: string | null;
  };
  let probe = $state<Probe | null>(null);
  let matFilter = $state('');

  /**
   * 拖东西进来的落点，**两页一起**登记。
   *
   * 哪一页有哪些落点写在 `落点.ts` 那张表里（那份表能单测：
   * "材质参数那一页必须有一个收 .fx 的落点"这条判据，光看页面看不出来）。
   * 这里只负责把表里的"槽"对上真元素、落下去了调 `loadFromPath`。
   *
   * 为什么要这一段（用户 2026-09-23 原话："改材质参数时没有按照要求可以拖拽载入材质"）：
   * 上一轮这张表只覆盖了 `conf` 那一页，`material` 那一页一个落点都没有 ——
   * 界面写着"把文件从窗口外拖进来"，拖进去落点解析找不到人接，
   * 最后只说一句"不是图片，没接"。拖进来的和「选…」按钮从此走**同一个** `loadFromPath`，
   * 不许两套。
   */
  let matRows = $state<Record<string, HTMLElement>>({});
  let matCardEl = $state<HTMLElement | null>(null);
  /** 材质参数那一页的中区。拖到这一页任何地方都算"打开这个材质" */
  let matPageEl = $state<HTMLElement | null>(null);
  /**
   * 工具条左边那一条。两页都在：`conf` 那一页它是"渲染包文件夹"的落点
   * （桌面端原生拖放只给路径、不给后缀，文件夹因此过不了图片那道筛，
   * `dir: true` 让它跳过筛法，见 dropzones 里的说明），
   * `material` 那一页它就是"把这个材质文件打开"的落点。
   */
  let rootBar = $state<HTMLElement | null>(null);

  $effect(() => {
    const 表 = 材质落点表(panelId);
    if (!表.length) return;
    const 撤: (() => void)[] = [];
    const 登记 = (id: string, el: HTMLElement | null, d: 落点声明, onDrop: (p: string) => void) => {
      if (!el) return;
      撤.push(() => unregisterZone(id));
      registerZone({
        id,
        rect: el.getBoundingClientRect(),
        el,
        accept: d.accept,
        dir: d.dir,
        /* 拖文件夹进来（`ray:root`）也算"打开工程"（用户 2026-09-26）。
           标签跟点「选 Ray 包目录」时 `pickFolder('Ray 配置', …)` 传的那一套对齐。 */
        记: d.dir ? { label: 'Ray 配置', href: '/tools/ray?panel=conf' } : undefined,
        onDrop: (ref) => onDrop(ref.path)
      });
    };
    for (const d of 表) {
      if (d.槽 === 'row') {
        /* 一行一个落点：id 拼上路径，指哪行就打开哪个文件，不会串 */
        for (const m of matShown) 登记(`${d.id}${m.path}`, matRows[m.path] ?? null, d, (p) => void loadFromPath(p));
        continue;
      }
      const el = d.槽 === 'bar' ? rootBar : d.槽 === 'card' ? matCardEl : matPageEl;
      登记(d.id, el, d, (p) => (d.dir ? void useRayRoot(p) : void loadFromPath(p)));
    }
    return () => {
      for (const f of 撤) f();
    };
  });

  async function pickRayRoot() {    const root = await pickFolder('Ray 配置', '/tools/ray?panel=conf');
    if (!root) return;
    await useRayRoot(root);
  }

  /**
   * 认一个渲染包目录 —— 「选目录」和**拖文件夹进来**走的是同一个函数。
   *
   * 两条路各写一份的话，迟早出现"拖进来的没探到 ray.conf"这种哑操作
   * （贴图那一行也是这个规矩，见下面 pickTexture 的注释）。
   */
  async function useRayRoot(root: string) {
    busy = true;
    msg = null;
    try {
      const rayConf = await findFile(root, 'ray.conf', 2);
      const advanced = await findFile(root, 'ray_advanced.conf', 2);
      const rayFx = await findFile(root, 'ray.fx', 2);
      const controller = await findFile(root, 'ray_controller.pmx', 3);
      const material = await findFile(root, 'material_2.0.fx', 4);
      const readme = (await findFile(root, 'README.md', 1)) ?? (await findFile(root, 'README_chs.md', 1));

      const all = await scanDir(root, ['fx', 'fxsub', 'conf'], true);
      const materials = all
        .filter((f) => f.ext === 'fx' || f.ext === 'fxsub')
        .map((f) => ({ path: f.path, rel: f.rel, ext: f.ext }));

      probe = {
        root,
        rayConf,
        advanced,
        rayFx,
        controller,
        material,
        counts: {
          fx: all.filter((f) => f.ext === 'fx').length,
          fxsub: all.filter((f) => f.ext === 'fxsub').length,
          conf: all.filter((f) => f.ext === 'conf').length
        },
        materials,
        readme
      };

      if (!rayConf && !advanced && !material) {
        const p = await probeDir(root);
        msg = {
          kind: 'warn',
          text: `这个目录里没找到 ray.conf / ray_advanced.conf / material_2.0.fx。目录里有 ${p.entries} 项，前几个是：${p.names.slice(0, 6).join('、')}`
        };
      } else if (rayConf) {
        await loadFromPath(rayConf);
      }
    } catch (e) {
      msg = { kind: 'warn', text: `读这个目录失败：${(e as Error).message}` };
    }
    busy = false;
  }

  /* ---------------------------------------------------------- 读文件 */

  async function pickFilePath(exts: string[]): Promise<string | null> {
    if (!isTauri()) return null;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const sel = await open({
      multiple: false,
      filters: [{ name: exts.map((e) => e.toUpperCase()).join(' / '), extensions: exts }]
    });
    if (!sel || Array.isArray(sel)) return null;
    return sel;
  }

  let needsPick = $state(false);
  async function loadFromPath(path: string) {    busy = true;
    msg = null;
    try {
      const t = await readText(path);
      const bytes = await readBytes(path);
      const parsed = parseRayText(t.text, path);
      file = { path, text: t.text, bytes, encoding: t.encoding, lossy: t.lossy, parsed };
      values = {};
      actives = {};
      for (const e of parsed.entries) {
        if (e.kind === 'define' || e.kind === 'const') values[e.id] = e.value;
      }
      needsPick = false;
      if (t.lossy) {
        msg = { kind: 'warn', text: '这个文件解码时有非法字节，解析出来的内容可能不全。' };
      }
      if (!parsed.entries.length) {
        msg = {
          kind: 'warn',
          text: '没解析出任何可改的项。可能不是 Ray 的配置写法，或者格式和规范不同。'
        };
      }
    } catch (e) {
      msg = { kind: 'warn', text: `读不了这个文件：${(e as Error).message}` };
    }
    busy = false;
  }

  /** 浏览器模式：没有真路径，写回只能下载 */
  async function loadFromBrowserFile(f: File) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    let text = '';
    let encoding = 'utf-8';
    let lossy = false;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder('utf-8').decode(bytes);
      encoding = 'unknown';
      lossy = true;
    }
    const parsed = parseRayText(text, f.name);
    file = { path: f.name, text, bytes, encoding, lossy, parsed };
    values = {};
    actives = {};
    for (const e of parsed.entries) {
      if (e.kind === 'define' || e.kind === 'const') values[e.id] = e.value;
    }
    needsPick = false;
    if (lossy) {
      msg = { kind: 'warn', text: '浏览器模式认不出非 UTF-8 的编码，只能按 UTF-8 试读，写回被禁用。' };
    }
  }

  async function openFile(exts: string[]) {
    const path = await pickFilePath(exts);
    if (path) {
      await loadFromPath(path);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = exts.map((e) => '.' + e).join(',');
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) void loadFromBrowserFile(f);
    };
    input.click();
  }

  /* ---------------------------------------------------------- 改动 */

  const changes = $derived<Change[]>(
    file ? collectChanges(file.parsed.entries, values, actives) : []
  );

  const changedIds = $derived(new Set(changes.map((c) => c.id)));

  /**
   * 什么文件能写。
   *
   * UTF-16 一律不让写：那边的 ASCII 是两字节，字节拼接的前提不成立，
   * 而 JS 没有 UTF-16 以外的编码器，重建整段只会把文件变成 UTF-8。
   */
  const canWrite = $derived(!!file && !file.encoding.startsWith('utf-16'));

  /** 哪些改动会被编码限制卡住（非 UTF-8 文件 + 改动里出现非 ASCII） */
  const spliceBlock = $derived.by(() => {
    if (!file || file.encoding === 'utf-8') return null;
    const probeRun = spliceAsciiLineEdits(file.bytes, changes);
    return probeRun.ok ? null : (probeRun.why ?? '未知原因');
  });

  const io: HistoryIo = {
    readBytes: (p) => readBytes(p),
    writeBytes: async (p, b) => {
      await saveBytes(p, b, false);
    }
  };

  /**
   * 原文带 BOM 就把 BOM 接回去。
   *
   * `file.text` 是**剥过 BOM** 的（`readText` 读的时候就剥了），走"字节拼接"那条路
   * 无所谓（它搬的是原始字节），但走"整段重写"就会把 BOM 吃掉 ——
   * 带 BOM 的 `.fx` 改一行、存一次，头三字节 `EF BB BF` 就没了。
   * 有些编辑器靠 BOM 认 UTF-8，丢了就整篇显示成乱码。
   */
  function 接回BOM(原件: Uint8Array, 正文: Uint8Array): Uint8Array {
    const 有 = 原件.length >= 3 && 原件[0] === 0xef && 原件[1] === 0xbb && 原件[2] === 0xbf;
    if (!有) return 正文;
    const 出 = new Uint8Array(正文.length + 3);
    出.set(原件.subarray(0, 3), 0);
    出.set(正文, 3);
    return 出;
  }

  /**
   * 写盘。单条撤销和批量改动都走这里 —— 只有一条写入路径，
   * 就不会出现"撤销那次忘了留备份"这种事。
   *
   * edits 是要落盘的行级改动；之前是不是从 values 来的无所谓。
   */
  async function writeEdits(edits: Change[], label: string) {
    if (!file || !edits.length) return;
    busy = true;
    msg = null;
    try {
      let out: Uint8Array | null = null;
      let how = '字节拼接';

      const spliced = spliceAsciiLineEdits(file.bytes, edits);
      if (spliced.ok && spliced.bytes) {
        out = spliced.bytes;
      } else if (file.encoding === 'utf-8') {
        out = 接回BOM(file.bytes, new TextEncoder().encode(applyEditsToText(file.text, edits)));
        how = '整段重写';
      } else {
        msg = { kind: 'warn', text: `没写：${spliced.why}` };
        busy = false;
        return;
      }

      if (!isTauri()) {
        await saveBytes(file.path, out, false);
        msg = { kind: 'info', text: '浏览器模式：改好的文件已下载，原文件没动。' };
        busy = false;
        return;
      }

      const path = file.path;
      const encoding = file.encoding;
      const fileLabel = fileLabelOf(path);
      const recs = edits.map((c) => ({
        name: c.name,
        line: c.line,
        before: c.before,
        after: c.after,
        oldRaw: c.oldRaw,
        newRaw: c.newRaw
      }));
      const beforeCount = file.parsed.entries.length;

      const rep = await saveBytes(path, out, true);

      // 读回来核对：只改了该改的行才算过
      const recheck = await readText(path);
      const reparsed = parseRayText(recheck.text, path);
      const bad: string[] = [];
      for (const c of edits) {
        const want = c.newRaw.trim();
        const got = reparsed.entries.find((e) => e.line === c.line);
        if (!got || got.raw.trim() !== want) bad.push(`第 ${c.line + 1} 行（${c.name}）`);
      }
      const countOk = reparsed.entries.length >= beforeCount;

      // 核对失败也要记一笔 —— 不然用户没法撤
      log = recordWrite(log, { path, fileLabel, encoding, how, changes: recs, backup: rep.backup });

      if (bad.length || !countOk) {
        msg = {
          kind: 'warn',
          text: `${label}写进去了，但读回来核对没对上：${bad.slice(0, 4).join('、') || '项数变少了'}。备份在 ${rep.backup ?? '（没留）'}，在下面的变更记录里点「撤销整次」可以还原。`
        };
      } else {
        msg = {
          kind: 'ok',
          text: `${label}${how}写了 ${edits.length} 处，读回来核对一致。备份：${rep.backup ?? '无（原文件不存在）'}`
        };
        await loadFromPath(path);
      }
    } catch (e) {
      msg = { kind: 'warn', text: `写盘失败：${(e as Error).message}` };
    }
    busy = false;
  }

  async function writeBack() {
    await writeEdits(changes, '');
  }

  function revert() {
    if (!file) return;
    const next: Record<string, string> = {};
    const nextActive: Record<string, boolean> = {};
    for (const e of file.parsed.entries) {
      if (e.kind === 'define' || e.kind === 'const') next[e.id] = e.value;
    }
    values = next;
    actives = nextActive;
    msg = null;
  }

  /** 撤回单条内存改动 */
  function revertOne(id: string) {
    const e = file?.parsed.entries.find((x) => x.id === id);
    if (!e) return;
    if (e.kind === 'commented') actives = { ...actives, [id]: false };
    else values = { ...values, [id]: e.value };
  }

  /* ---------------------------------------------------------- 贴图导入 */

  let texBusy = $state(false);

  /**
   * 给某个 *_MAP_FILE 选一张贴图。
   *
   * 选完顺手把同组的 *_MAP_FROM 拨到 1（外部文件），因为 FROM 是 0 的时候
   * 文件名根本不参与计算 —— 光填文件名是个哑操作。这一步也会进改动清单，
   * 看得见、能撤。
   */
  async function pickTextureFor(entry: Entry) {
    if (!file) return;
    texBusy = true;
    try {
      const refs = await pickImages(false);
      if (!refs.length) {
        texBusy = false;
        return;
      }
      applyTexture(entry, refs[0].path);
    } catch (e) {
      msg = { kind: 'warn', text: `选贴图失败：${(e as Error).message}` };
    }
    texBusy = false;
  }

  /**
   * 真路径 → 填进那一行 + 同组 FROM 拨到 1。
   *
   * 「选贴图」和「拖到那一行上」走的是**同一个函数** —— 两条路各写一份的话，
   * 迟早出现"拖进来的没拨 FROM"这种哑操作。
   */
  function applyTexture(entry: Entry, filePath: string) {
    if (!file) return;
    const { path, crossDrive } = relativeFrom(file.path, filePath);
    const quoted = `"${path}"`;
    const next = { ...values, [entry.id]: quoted };

    // 同组的 FROM 拨到 1
    const fromName = entry.name.replace(/_MAP_FILE$/i, '_MAP_FROM');
    const fromEntry = file.parsed.entries.find((e) => e.name === fromName);
    let fromNote = '';
    if (fromEntry && (fromEntry.kind === 'define' || fromEntry.kind === 'const')) {
      const cur = next[fromEntry.id] ?? fromEntry.value;
      if (cur !== '1' && cur !== '2') {
        next[fromEntry.id] = '1';
        fromNote = `，同时把 ${fromName} 从 ${cur} 改成 1（不改的话这个文件名不参与计算）`;
      }
    }
    values = next;

    msg = {
      kind: crossDrive ? 'warn' : 'info',
      text: crossDrive
        ? `填了绝对路径 ${path}${fromNote}。贴图跟 .fx 不在同一个盘，算不出相对路径 —— 换机器或换盘符之后会失效。`
        : `填了相对路径 ${path}${fromNote}。`
    };
  }

  /* ---------------------------------------------------------- 分组与过滤 */

  type Section = { key: string; items: Entry[] };

  const sections = $derived.by<Section[]>(() => {
    if (!file) return [];
    const flavor = file.parsed.flavor;
    const map = new Map<string, Entry[]>();
    for (const e of file.parsed.entries) {
      const k = sectionOf(e.name, flavor);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    return [...map.entries()].map(([key, items]) => ({ key, items }));
  });

  let filter = $state('');
  let onlyChanged = $state(false);
  let onlyMissing = $state(false);
  let openAll = $state(true);
  /**
   * 每节自己的展开状态。
   *
   * 早先是直接把 `open={openAll}` 写在 details 上 —— 那样手动展开一节之后，
   * 只要界面重绘（比如在过滤框里打一个字）就会被重置回去。
   * 所以手动 toggle 的状态要单独记。
   */
  let secOpen = $state<Record<string, boolean>>({});

  function isOpen(key: string): boolean {
    return secOpen[key] ?? openAll;
  }

  function toggled(key: string, open: boolean) {
    secOpen = { ...secOpen, [key]: open };
  }

  const shown = $derived.by<Section[]>(() => {
    const q = filter.trim().toLowerCase();
    return sections
      .map((s) => ({
        key: s.key,
        items: s.items.filter((e) => {
          if (q && !e.name.toLowerCase().includes(q)) return false;
          if (onlyChanged && !changedIds.has(e.id)) return false;
          if (onlyMissing && explain(e.name, file?.parsed.flavor ?? '')) return false;
          return true;
        })
      }))
      .filter((s) => s.items.length);
  });

  const shownCount = $derived(shown.reduce((n, s) => n + s.items.length, 0));

  /** 说明覆盖率：这张表盖住了多少个参数 */
  const cover = $derived.by(() => {
    if (!file) return { hit: 0, total: 0, miss: [] as string[] };
    const names = file.parsed.entries
      .filter((e) => e.kind === 'define' || e.kind === 'const')
      .map((e) => e.name);
    return coverage(file.parsed.flavor, names);
  });

  function docOf(e: Entry): Doc | null {
    return explain(e.name, file?.parsed.flavor ?? '');
  }

  /* ---------------------------------------------------------- 变更记录 */

  const rows = $derived(timelineRows(log));

  /** 把某一条已写盘的改动单独撤回：直接改那一行，然后走正常写盘流程 */
  let undoing = $state<string | null>(null);

  async function undoOneRow(rowId: string) {
    const row = rows.find((x) => x.id === rowId);
    if (!row || !file) return;

    if (row.path !== file.path) {
      msg = { kind: 'info', text: `${row.fileLabel} 不是当前打开的文件。先把它打开再撤这一条。` };
      return;
    }
    if (row.undone) {
      await doRedo(row.writeId);
      return;
    }
    const w = log.find((x) => x.id === row.writeId);
    const rec = w?.changes.find((c) => c.name === row.name && c.line === row.line);
    if (!rec) {
      msg = { kind: 'warn', text: '找不到这条改动的原始记录，撤不了。' };
      return;
    }
    const entry = file.parsed.entries.find((e) => e.line === rec.line);
    if (!entry || (entry.kind !== 'define' && entry.kind !== 'const')) {
      msg = { kind: 'warn', text: `现在这个文件第 ${rec.line + 1} 行不是可改的项，撤不了。` };
      return;
    }
    // 现在这一行必须还等于当初写入的内容，否则说明后面又被改过，硬撤会覆盖掉
    if (entry.raw.trim() !== rec.newRaw.trim()) {
      msg = {
        kind: 'info',
        text: `${row.name} 这一行现在是「${entry.raw.trim()}」，不是记录里的「${rec.newRaw.trim()}」，后面又被改过。先在参数栏把它改回原样再撤，免得覆盖掉后面的改动。`
      };
      return;
    }

    const target = reverseChange(rec, entry.kind === 'define' ? setDefineValue : setConstValue, entry.raw);
    if (!target || target === entry.raw) {
      msg = { kind: 'warn', text: `${row.name} 这一行按记录拼不出旧值，撤不了。` };
      return;
    }

    undoing = rowId;
    const edit: Change = {
      id: `undo:${row.id}`,
      line: entry.line,
      name: row.name,
      before: rec.after,
      after: rec.before,
      oldRaw: entry.raw,
      newRaw: target
    };
    await writeEdits([edit], `撤回 ${row.name}：`);
    undoing = null;
  }

  async function doUndo(writeId: string) {
    const res = await undoWrite(log, writeId, io);
    log = res.log;
    logMsg = res.message;
    if (res.ok && file && rows.find((r) => r.writeId === writeId)?.path === file.path) {
      await loadFromPath(file.path);
    }
  }

  async function doRedo(writeId: string) {
    const res = await redoWrite(log, writeId, io);
    log = res.log;
    logMsg = res.message;
    if (res.ok && file) await loadFromPath(file.path);
  }

  async function doUndoAll() {
    const res = await undoAll(log, io);
    log = res.log;
    logMsg = res.message;
    if (res.ok && file) await loadFromPath(file.path);
  }

  async function doRedoAll() {
    const res = await redoAll(log, io);
    log = res.log;
    logMsg = res.message;
    if (res.ok && file) await loadFromPath(file.path);
  }

  /* ---------------------------------------------------------- 杂项 */

  const isConf = $derived(file?.parsed.flavor === 'ray-conf' || file?.parsed.flavor === 'ray-advanced');
  const controllerCount = $derived(
    file ? file.parsed.entries.filter((e) => e.kind === 'controller').length : 0
  );
  const commentedCount = $derived(
    file ? file.parsed.entries.filter((e) => e.kind === 'commented').length : 0
  );

  let showRawDiff = $state(false);
  /** 顶栏那个 `?`：这一页干什么（规范 §二：长说明只放这里 + 页面底部的折叠区） */
  let 说明开 = $state(false);

  const matShown = $derived.by(() => {
    if (!probe) return [];
    const q = matFilter.trim().toLowerCase();
    const list = q ? probe.materials.filter((m) => m.rel.toLowerCase().includes(q)) : probe.materials;
    return list.slice(0, 60);
  });
</script>

<div class="wbar">
  <div class="wbar__l" bind:this={rootBar}>
    {#if panelId === 'conf'}
      <button class="btn btn--primary" disabled={busy} onclick={pickRayRoot}>
        <Icon name="ui.folder" size={15} />选 Ray 包目录
      </button>
      {#if probe}<span class="mini mono nowrap" title={probe.root}>{probe.root}</span>{/if}
      <span class="mini nowrap">这一条上也可以直接拖渲染包文件夹</span>
    {:else}
      <!-- 载入文件之后，"选文件"降级成次级按钮 —— 一页只留一个主按钮（规范 §10.3：那个是底栏的「写盘」） -->
      <button class="btn {file ? 'btn--ghost' : 'btn--primary'}" disabled={busy} onclick={() => openFile(['fx', 'fxsub'])}>
        <Icon name="ui.file" size={15} />选 .fx / .fxsub
      </button>
      {#if probe}
        <button class="btn btn--ghost" disabled={busy} onclick={() => openFile(['fx', 'fxsub'])}>
          <Icon name="ui.open" size={14} />换一个
        </button>
      {/if}
      <span class="mini nowrap">也可以把 .fx / .fxsub 拖到这一页上</span>
    {/if}
  </div>
  <div class="wbar__r">
    {#if file}
      <span class="mini mono" title={file.path}>{fileLabelOf(file.path)}</span>
      <span class="tag">{file.encoding}</span>
      <span class="mini">{file.parsed.entries.length} 项</span>
    {/if}
    <!-- 顶栏这一行只放「说明」。
         「参数」开关不在这儿 —— 路由壳统一出（页里画了 `.wb__side` 就有），
         各页各写一套的话，没写的那十个页面就等于没有参数（实测就是这个问题）。 -->
    <button
      class="btn btn--ghost btn--sm"
      aria-expanded={说明开}
      onclick={() => (说明开 = !说明开)}
      title="这一页是干什么的"
    ><Icon name="ui.help" size={13} />说明</button>
  </div>
</div>

{#if 说明开}
  <div class="card pad explain mini">
    <p style="margin:0 0 6px">
      <b>这一页改渲染包里的参数</b>：打开一个 <span class="mono">.fx</span> / <span class="mono">.fxsub</span>
      （或 <span class="mono">ray.conf</span>），把里面的开关与数值做成列表来改，
      <b>改完先看差异、再写盘</b>，写盘前在文件旁边留一份 <span class="mono">.bak</span>。
    </p>
    <ul style="margin:0; padding-left:1.2em">
      <li><b>改哪个</b>：点参数右边那一格改值；数值既有数字框也有滑条。</li>
      <li><b>找参数</b>：右侧「参数」抽屉里有过滤、只看改过的、只看没说明的。</li>
      <li><b>材质文件</b>：`conf` 分区里点一行打开它，也可以把 <span class="mono">.fx</span> 直接拖到那一行上。</li>
      <li><b>写盘</b>：底栏那个按钮；写完回读核对，只有改动那几行真的变了才算成功。</li>
    </ul>
  </div>
{/if}

{#if !['conf', 'material'].includes(panelId)}
  <!-- 不认识的 id 不再悄悄落到"材质"那一页（原来裸 `{:else}` 就是干这个的） -->
  <div class="card pad">
    <Note kind="warn">
      分区 id「{panelId}」这个组件不认识，所以这一页是空的。
      多半是注册表里加/改分区的时候，组件里的分支没跟着改 —— 两边要一起改。
    </Note>
  </div>
{:else if panelId === 'conf'}
  {#if probe}
    <div class="card pad">
      <h3 class="h3">这个目录里认出来的东西</h3>
      <div class="cols2">
        <ul class="list">
          {#each [
            ['ray.conf', probe.rayConf],
            ['ray_advanced.conf', probe.advanced],
            ['ray.fx', probe.rayFx],
            ['ray_controller.pmx', probe.controller],
            ['Materials/material_2.0.fx', probe.material]
          ] as [label, p] (label)}
            <li>
              {#if p}<Icon name="ui.check" size={12} /><span class="good">有</span>
              {:else}<Icon name="ui.close" size={12} /><span class="mini">没有</span>{/if}
              <b>{label}</b>
              {#if p}<span class="list__sp mono" title={p}>{p.split(/[\\/]/).pop()}</span>{/if}
            </li>
          {/each}
        </ul>
        <div class="kv">
          <div class="kv__r"><span>.fx 文件</span><span>{probe.counts.fx}</span></div>
          <div class="kv__r"><span>.fxsub 文件</span><span>{probe.counts.fxsub}</span></div>
          <div class="kv__r"><span>.conf 文件</span><span>{probe.counts.conf}</span></div>
          <div class="kv__r"><span>可打开的材质文件</span><span>{probe.materials.length}</span></div>
        </div>
      </div>
      <div class="acts" style="margin-top:12px">
        {#if probe.rayConf}
          <button class="btn btn--ghost btn--sm" onclick={() => loadFromPath(probe!.rayConf!)}>打开 ray.conf</button>
        {/if}
        {#if probe.advanced}
          <button class="btn btn--ghost btn--sm" onclick={() => loadFromPath(probe!.advanced!)}>打开 ray_advanced.conf</button>
        {/if}
        {#if probe.material}
          <button class="btn btn--ghost btn--sm" onclick={() => loadFromPath(probe!.material!)}>打开 material_2.0.fx</button>
        {/if}
      </div>
      <p class="mini" style="margin-top:10px">
        认文件是按文件名找特征文件，不解析版本号 —— Ray 各个版本的文件名一直没变，
        靠文件名区分不了 1.5.1 和 1.5.2。真正决定能改哪些参数的是下面解析出来的清单。
      </p>
    </div>
  {:else}
    <Note>
      选一个 Ray 包根目录（放着 <span class="mono">ray.conf</span> 和
      <span class="mono">ray.fx</span> 的那一层）。工具只在里面找特征文件，不改任何东西，
      直到你按下写盘。
    </Note>
  {/if}
{:else if panelId === 'material' && !file}
  <Note>
    材质文件的参数分两类：<span class="mono">#define</span> 和
    <span class="mono">const</span> 可以直接改；
    <span class="mono">CONTROLOBJECT</span> 那些的值由 MMD 里附件的骨骼位置决定，
    在这里改没有意义，所以只列出来。
    <br />
    贴图那一路（<span class="mono">*_MAP_FILE</span>）右边有"选贴图"按钮，
    选完会算成相对 <span class="mono">.fx</span> 的路径填进去，并把对应的
    <span class="mono">*_MAP_FROM</span> 拨到 1 —— 不改 FROM 的话文件名不参与计算。
  </Note>
{/if}

<!-- 没打开文件时也给一个工作区骨架：**中区＝整幅**（规范 §十一），
     不然这一页量不到、也没地方放"该做什么"的提示。载入文件后换成正片骨架（见下面 `{#if file}`）。 -->
{#if !file}
  <div class="wb">
    <div class="wb__main" bind:this={matPageEl}>
      <div class="card pad">
        <h3 class="h3">{panelId === 'conf' ? '先选一个 Ray 包目录' : '打开一个材质文件'}</h3>
        <p class="mini">
          {#if panelId === 'conf'}
            上面点「选 Ray 包目录」，或者把渲染包文件夹拖到那一条上。选完这里会列出包里的材质文件。
          {:else}
            上面点「选 .fx / .fxsub」，或者把文件从窗口外拖到这一页上（拖到哪儿都行）。
            打开之后参数列表在这里。
          {/if}
        </p>
      </div>
    </div>
  </div>
{/if}

  {#if probe && panelId === 'conf'}
    <div class="card pad" bind:this={matCardEl}>
      <div class="acts" style="margin-bottom:10px">
        <h3 class="h3" style="margin:0">包里的材质文件</h3>
        <span class="acts__sp"></span>
        <input type="text" placeholder="按路径过滤" style="width:12rem" bind:value={matFilter} aria-label="过滤材质文件" />
      </div>
      <p class="mini" style="margin:0 0 8px">
        点一行打开它；也可以把 <span class="mono">.fx</span> / <span class="mono">.fxsub</span>
        从窗口外直接拖到任意一行上（自己机器上别处的材质也能这样拖进来改）。
      </p>
      <ul class="list" style="max-height:16rem">
        {#each matShown as m (m.path)}
          <li bind:this={matRows[m.path]}>
            <button class="linkbtn" type="button" onclick={() => loadFromPath(m.path)} title={m.path}>
              <span class="mono">{m.rel}</span>
            </button>
            <span class="list__sp"><span class="tag">{m.ext}</span></span>
          </li>
        {/each}
      </ul>
      {#if probe.materials.length > matShown.length}
        <p class="mini" style="margin-top:8px">
          还有 {probe.materials.length - matShown.length} 个没列出来，用过滤框找。
        </p>
      {/if}
    </div>
  {/if}

{#if file}
  <div class="wb">
    <div class="wb__main" bind:this={matPageEl}>
      {#if file.parsed.errors.length}
        <div class="card pad">
          <h3 class="h3">没解析出来的行</h3>
          <ul class="list">
            {#each file.parsed.errors.slice(0, 20) as e (e.line)}
              <li>
                <b class="bad">第 {e.line + 1} 行</b>
                <span class="mini">{e.why}</span>
                <span class="list__sp mono" title={e.raw}>{e.raw.trim().slice(0, 48)}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <div class="card pad">
        <div class="acts" style="margin-bottom:12px">
          <h3 class="h3" style="margin:0">参数</h3>
          <span class="mini">{shownCount} / {file.parsed.entries.length}</span>
          <span class="acts__sp"></span>
          <input type="text" placeholder="按名字过滤" style="width:11rem" bind:value={filter} aria-label="过滤参数名" />
          <label class="chk"><input type="checkbox" bind:checked={onlyChanged} /><span class="chk__box"></span>只看改过的</label>
          <label class="chk"><input type="checkbox" bind:checked={onlyMissing} /><span class="chk__box"></span>只看没说明的</label>
          <button class="btn btn--ghost btn--sm" type="button" onclick={() => { openAll = !openAll; secOpen = {}; }}>
            {openAll ? '全部收起' : '全部展开'}
          </button>
        </div>

        {#each shown as s (s.key)}
          <details
            class="sec"
            open={isOpen(s.key)}
            ontoggle={(e) => toggled(s.key, e.currentTarget.open)}
          >
            <summary class="sec__h">
              <span class="sec__t">{s.key}</span>
              <span class="mini">{s.items.length} 项</span>
            </summary>
            <div class="rows">
              {#each s.items as e (e.id)}
                <Row
                  entry={e}
                  doc={docOf(e)}
                  value={values[e.id] ?? e.value}
                  active={actives[e.id] ?? false}
                  changed={changedIds.has(e.id)}
                  readOnly={!canWrite}
                  onValue={(v) => (values = { ...values, [e.id]: v })}
                  onActive={(v) => (actives = { ...actives, [e.id]: v })}
                  onPickTexture={pickTextureFor}
                  onDropTexture={(en, ref) => applyTexture(en, ref.path)}
                />
              {/each}
            </div>
          </details>
        {/each}

        {#if !shown.length}
          <p class="mini">没有匹配的项。</p>
        {/if}
      </div>
    </div>

    <aside class="card wb__side">
      <!-- 参数抽屉（规范 §十一）：从右滑出、盖在中区之上、**默认收起**；只有点「钉住」才占一列宽。
           这里**只放控件** —— 解释走顶栏 `?` 与页面底部的「说明与注意事项」，不在这儿堆字。 -->
      <div class="wb__grip" role="separator" aria-label="拖动调整参数抽屉宽度" onpointerdown={拖把手}></div>
      <div class="grp">
        <div class="acts">
          <h3 class="grp__t" style="margin:0">参数</h3>
          <span class="acts__sp"></span>
          <button
            class="btn btn--ghost btn--sm"
            aria-pressed={side.pin}
            onclick={切钉}
            title="钉住＝占一列宽度（默认不钉，浮在上面不挤压工作区）"
          ><Icon name="ui.lock" size={13} />{side.pin ? '已钉住' : '钉住'}</button>
          <button class="btn btn--ghost btn--sm" onclick={() => 开抽屉(false)} title="收起来">
            <Icon name="ui.close" size={13} />收起
          </button>
        </div>
      </div>

      <div class="grp">
        <h3 class="grp__t">改动清单</h3>

        {#if file.encoding.startsWith('utf-16')}
          <div style="margin-top:10px">
            <Note kind="warn">
              这个文件是 UTF-16。UTF-16 里 ASCII 占两个字节，字节拼接的前提不成立，
              浏览器里也没有 UTF-16 之外的编码器，硬写只会把文件变成 UTF-8 ——
              编码一变 MME 那边可能直接读不出来。写盘关掉了，看参数没问题。
            </Note>
          </div>
        {:else if changes.length}
          <ul class="list" style="max-height:18rem; margin-top:10px">
            {#each changes as c (c.id)}
              <li>
                <b>L{c.line + 1}</b>
                <span class="mono">{c.name}</span>
                <button class="x" type="button" title="只撤这一条" onclick={() => revertOne(c.id)}>×</button>
                <span class="list__sp mini">{c.before} → {c.after}</span>
              </li>
            {/each}
          </ul>

          <label class="chk" style="margin-top:10px">
            <input type="checkbox" bind:checked={showRawDiff} />
            <span class="chk__box"></span>看整行 diff
          </label>
          {#if showRawDiff}
            <div class="diff">
              {#each changes as c (c.id)}
                <div class="diff__h">第 {c.line + 1} 行</div>
                <pre class="diff__del">- {c.oldRaw.trim()}</pre>
                <pre class="diff__add">+ {c.newRaw.trim()}</pre>
              {/each}
            </div>
          {/if}

          <p class="mini" style="margin-top:10px">
            写盘怎么留备份、怎么核对，见页面底部的「说明与注意事项」。
          </p>
          {#if spliceBlock}
            <div style="margin-top:10px">
              <Note kind="warn">
                这处改动里有非 ASCII 字符，而文件是 {file.encoding} ——
                没有对应的编码器，按原编码写不安全。{spliceBlock}
                <br />
                两条路：改成纯 ASCII 的文件名（比如把贴图重命名成英文），
                或者先把贴图改到已有的英文文件名上。<b>路径里有中文不是问题</b>，
                受限的是这个文件本身的编码。
              </Note>
            </div>
          {/if}
        {:else}
          <p class="mini" style="margin-top:10px">改了值才会出现在这里。写盘在底下那条栏上，不用往上找。</p>
        {/if}
      </div>
    </aside>
  </div>

  <!--
    写盘条钉在视口底部。

    原来写盘按钮在右边那一栏里，而那一栏是 sticky 的：窗口一矮、侧栏内容比视口高，
    底下那截就永远在屏幕外，每改一个参数都得把页面滚回顶上才够得着按钮。
    现在动作固定在底下，滚到参数的哪个位置都在眼前；侧栏只留说明和清单。
  -->
  <div class="wbar wbar--foot">
    <div class="wbar__l">
      {#if changes.length}
        <span class="tag tag--ok">{changes.length} 处待写入</span>
        <span class="mini mut nowrap">按写盘才落盘，写盘前留 .bak</span>
      {:else}
        <span class="tag">没有改动</span>
        <span class="mini mut nowrap">改了哪个参数，这里就会亮起来</span>
      {/if}
      <span class="mini mono nowrap" title={file.path}>{fileLabelOf(file.path)}</span>
    </div>
    <div class="wbar__r">
      {#if !canWrite}
        <span class="mini nowrap">这个文件写不了（原因见右栏）</span>
      {/if}
      {#if changes.length}
        <button class="btn btn--ghost btn--sm" onclick={revert}>
          <Icon name="ui.undo" size={13} />全部还原
        </button>
      {/if}
      <button class="btn btn--primary" disabled={!changes.length || busy || !canWrite} onclick={writeBack}>
        <Icon name="ui.export" size={15} />{busy ? '写盘中…' : '写盘'}
      </button>
    </div>
  </div>

  <!-- 说明与核对细节集中在这里（规范 §二：右栏只放控件，长说明只走顶栏 `?` 与本折叠区） -->
  <details class="notes" style="margin-top:14px">
    <summary>说明与注意事项</summary>
    <div class="card pad">
      <div class="kv">
        <div class="kv__r"><span>这张表里有说明的</span><span>{cover.hit} / {cover.total}</span></div>
        <div class="kv__r"><span>没有说明的</span><span>{cover.total - cover.hit}</span></div>
        <div class="kv__r"><span>文件类型</span><span>{file.parsed.flavor}</span></div>
        <div class="kv__r"><span>换行</span><span>{file.parsed.eol === '\r\n' ? 'CRLF' : 'LF'}</span></div>
        {#if controllerCount}
          <div class="kv__r"><span>控制器项（只读）</span><span>{controllerCount}</span></div>
        {/if}
        {#if commentedCount}
          <div class="kv__r"><span>注释掉的开关</span><span>{commentedCount}</span></div>
        {/if}
      </div>
      {#if cover.miss.length}
        <p class="mini" style="margin-top:8px">
          没说明的：<span class="mono">{cover.miss.slice(0, 8).join('、')}{cover.miss.length > 8 ? ` 等 ${cover.miss.length} 个` : ''}</span>
        </p>
      {/if}
      <p class="mini" style="margin-top:10px">
        写盘前在文件旁边留一份 <span class="mono">.bak</span>。
        {#if file.encoding !== 'utf-8'}
          这个文件是 {file.encoding}，只替换改动的 ASCII 那一段，日文注释按原始字节搬过去，编码不变。
        {:else}
          UTF-8 文件按改动行重排，换行符原样保留。
        {/if}
        写完读回来重新解析，只有改动那几行确实变成新值才算成功。
      </p>
    </div>
  </details>

  <div class="card pad" style="margin-top:14px">
    <div class="acts" style="margin-bottom:10px">
      <h3 class="h3" style="margin:0">变更记录</h3>
      <span class="mini">{rows.length} 条</span>
      <span class="acts__sp"></span>
      <button class="btn btn--ghost btn--sm" disabled={!canUndo(log)} onclick={doUndoAll}>
        <Icon name="ui.undo" size={13} />全部撤销
      </button>
      <button class="btn btn--ghost btn--sm" disabled={!canRedo(log)} onclick={doRedoAll}>
        <Icon name="ui.redo" size={13} />全部重做
      </button>
      {#if log.length}
        <button class="btn btn--ghost btn--sm" onclick={() => (log = [])} title="只清这张表，不动文件">清空记录</button>
      {/if}
    </div>

    {#if logMsg}
      <div style="margin-bottom:10px"><Note kind="info" onclose={() => (logMsg = null)} 自动关={提示自动关毫秒}>{logMsg}</Note></div>
    {/if}

    {#if rows.length}
      <ul class="list" style="max-height:24rem">
        {#each rows as r (r.id)}
          <li class:undone={r.undone}>
            <span class="mono time">{hhmmss(r.at)}</span>
            <span class="mono file" title={r.path}>{r.fileLabel}</span>
            <span class="mono pname">{r.name}</span>
            <span class="mini val">{r.before} → {r.after}</span>
            <span class="list__sp acts">
              {#if r.undone}
                <button class="btn btn--ghost btn--sm" onclick={() => doRedo(r.writeId)}>重做</button>
              {:else}
                <button
                  class="btn btn--ghost btn--sm"
                  disabled={undoing === r.id}
                  onclick={() => undoOneRow(r.id)}
                  title="把这个参数改回旧值（确认后要按写盘）"
                >改回去</button>
                <button class="btn btn--ghost btn--sm" onclick={() => doUndo(r.writeId)} title="这一次写盘整体还原">
                  撤销整次
                </button>
              {/if}
            </span>
          </li>
        {/each}
      </ul>
      <p class="mini" style="margin-top:10px">
        「改回去」是把那一个参数改回旧值，改完要在右边按写盘才算落盘 ——
        跟普通改动走同一条路，照样留备份、照样核对。
        「撤销整次」是把那一次写盘整体还原：把当时留的 <span class="mono">.bak</span> 原样写回去。
        每次写盘的备份是唯一命名的（已经有 .bak 就让成 .bak2、.bak3），所以不会被后面的写盘覆盖。
      </p>
    {:else}
      <p class="mini">还没有写过盘。写过之后这里会按时间倒序列出每一次改了哪些参数，可以逐条或整次撤销。</p>
    {/if}
  </div>
{/if}

{#if msg}
  <div class="toast"><Note kind={msg.kind} onclose={() => (msg = null)} 自动关={提示自动关毫秒}>{msg.text}</Note></div>
{/if}

<style>
  .pad { padding: 16px; }
  .h3 { margin: 0 0 10px; font-size: var(--fs-md); }
  .btn--sm { padding: 4px 10px; font-size: var(--fs-2xs); }
  .bad { color: var(--danger); }
  .good { color: var(--ok); }
  .toast { margin-top: 12px; }

  .wbar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 10px 14px;
    border-radius: var(--r-lg);
    background: var(--card-bg);
    border: 1px solid var(--line-divider);
  }
  .wbar__l { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .wbar__r { display: flex; align-items: center; gap: 8px; margin-left: auto; min-width: 0; }

  /* 写盘条：钉在底部状态栏上面那条。要有底色，不然参数会从它底下穿过去 */
  .wbar--foot {
    position: sticky;
    bottom: var(--status-h);
    z-index: var(--z-bar);
    margin-top: 14px;
    box-shadow: 0 -6px 18px rgba(0, 0, 0, 0.12);
    backdrop-filter: blur(6px);
  }

  .cols2 {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(10rem, 1fr);
    gap: 16px;
    align-items: start;
  }
  @media (max-width: 900px) { .cols2 { grid-template-columns: minmax(0, 1fr); } }

  /* 分节。用 details 是为了不写状态管理 —— 浏览器自己记得住展开收起 */
  .sec { border-top: 1px solid var(--line-divider); }
  .sec:first-of-type { border-top: 0; }
  .sec__h {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 10px;
    cursor: pointer;
    list-style: none;
    border-radius: var(--r-md);
    transition: background var(--t-micro) var(--ease-std);
  }
  .sec__h::-webkit-details-marker { display: none; }
  .sec__h::before {
    content: '';
    width: 5px;
    height: 5px;
    border-right: 1.5px solid var(--content-meta);
    border-bottom: 1.5px solid var(--content-meta);
    transform: rotate(-45deg);
    transition: transform var(--t-micro) var(--ease-std);
    flex: none;
  }
  .sec[open] > .sec__h::before { transform: rotate(45deg); }
  .sec__h:hover { background: var(--rail-item-hover); }
  .sec__t {
    font-size: var(--fs-2xs);
    font-weight: 700;
    letter-spacing: 0.05em;
    color: var(--deep-text);
  }

  .rows { display: flex; flex-direction: column; padding-bottom: 6px; }

  .linkbtn {
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    color: var(--primary-ink);
    cursor: pointer;
    text-align: left;
    min-width: 0;
  }
  .linkbtn:hover { text-decoration: underline; }
  .linkbtn span { font-size: var(--fs-2xs); word-break: break-all; }

  .x {
    border: 0;
    background: var(--surface-3);
    color: var(--content-meta);
    width: 16px;
    height: 16px;
    border-radius: var(--r-sm);
    line-height: 1;
    cursor: pointer;
    flex: none;
  }
  .x:hover { background: var(--btn-regular-bg-hover); color: var(--deep-text); }

  .diff { display: grid; gap: 2px; margin-top: 8px; max-height: 20rem; overflow: auto; }
  .diff__h { font-size: 10px; color: var(--content-meta); margin-top: 6px; }
  .diff__del,
  .diff__add {
    margin: 0;
    padding: 3px 7px;
    border-radius: var(--r-sm);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    white-space: pre-wrap;
    word-break: break-all;
  }
  .diff__del { background: color-mix(in oklab, var(--danger) 12%, transparent); color: var(--body-text); }
  .diff__add { background: color-mix(in oklab, var(--ok) 14%, transparent); color: var(--deep-text); }

  .list li.undone { opacity: 0.55; }
  .list li.undone .val { text-decoration: line-through; }
  .time { flex: none; color: var(--content-meta); }
  .file { flex: none; max-width: 9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pname { flex: none; max-width: 12rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--deep-text); }
  .val { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
