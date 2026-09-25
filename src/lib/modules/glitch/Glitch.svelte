<script lang="ts">
  /**
   * ① 日文乱码修复。
   *
   * 乱码只有一种成因：拿错编码读。日文原文是 Shift-JIS 的字节，
   * 被当成 GBK 读出来就是 `僐儞僩儘乕儔乕`（原词 コントローラー）。
   * 修回去 = 按 GBK 编回字节 → 按 Shift-JIS 解一次。
   *
   * 编码转换在后端（Rust / encoding_rs）：浏览器里的 TextEncoder 只会 UTF-8，
   * 编不回 GBK。所以这个功能只在桌面端可用，浏览器里会明说。
   *
   * 后端会把几条候选路径都评一遍分，只有明显更好才动手 —— 认不出来就原样返回，
   * 宁可不改也别改坏。
   */
  import {
    repairText,
    readTextFixed,
    fixTextFile,
    scanTextFiles,
    scanNames,
    renameEntries,
    undoRenames,
    scanPieces,
    applyPieces,
    translateText,
    writeTextFile,
    pickFile,
    pickFolder,
    scanDir,
    probeDir,
    type FileRef,
    type RepairResult,
    type SegmentReport,
    type NameHit,
    type RenamePair,
    type ScanHit
  } from '$lib/io';
  import { registerZone, unregisterZone, type DropZone } from '$lib/dropzones.svelte';
  import { isTauri } from '$lib/open';
  import { goto } from '$app/navigation';
  import { 待挑段 } from '$lib/ui.svelte';
  import { 提示自动关毫秒 } from '$lib/ui.svelte';
  import { TEMPLATE_HINT, outPathFor, siblingPath } from '$lib/outpath';
  import { prefs } from '$lib/prefs.svelte';
  import { 翻段落, 并回译文, 都译了吗, 引擎填了, 引擎标签, 取引擎, type 段 } from '$lib/translate';
  import type { WbProps } from '$lib/modules/wb-props';
  import Note from '$lib/components/wb/Note.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import {
    BUILTIN,
    GROUP_NAMES,
    groupOf,
    loadUserTable,
    mergeTable,
    saveUserTable,
    translateWith,
    type GlossaryEntry,
    type TranslateResult
  } from './glossary';

  let { panelId = 'fix' }: WbProps = $props();

  /* ---------------- 原文编码（用户 2026-09-23 定的口径） ----------------
     「文本」栏先让人**选编码**，再拖东西进来，然后选"修的是名称/文件/文本/注释"。
     为什么要有这个选择：还原这条路是"**按 X 读错的字 → 编回字节 → 按 Y 解**"，
     自动认会在 Shift-JIS / EUC-JP / UTF-8 三路里按分数挑一个 —— 分高的不一定是他要的那个。
     操作者知道原文是什么编码时，直接指定比让他从候选里挑靠谱。

     预设**只有这三档**：UTF-16LE 不是这条路上的 Y（它是文件本身的编码，由 detect_text 认 BOM），
     ISO-2022-JP 引擎里没接 —— 列出来却选不动比不列更坏。 */
  type 编码id = '自动认' | 'shift_jis' | 'euc-jp' | 'utf-8';
  const 编码档: { id: 编码id; 名: string; 说明: string }[] = [
    {
      id: '自动认',
      名: '自动认（推荐）',
      说明:
        '四种误读 × 三种日文编码一起试，按分数挑。认不出来的段会原样留着（右边看得到），想更彻底就自己点一档具体的日文编码。'
    },
    {
      id: 'shift_jis',
      名: 'Shift-JIS',
      说明: 'MMD 圈最常见的那种：日文文件被中文系统按 GBK 读出来。选它 = 只按这一路解，不再猜。'
    },
    {
      id: 'euc-jp',
      名: 'EUC-JP',
      说明: '老一些的日文包 / 存档用得多。选它 = 只按这一路解。'
    },
    {
      id: 'utf-8',
      名: 'UTF-8',
      说明: '少数情况：原文是 UTF-8，却被按 GBK 读了。选它 = 只按这一路解。'
    }
  ];
  let 目标编码 = $state<编码id>('自动认');

  /** "要修哪一样" —— 四个目标，各自有专门的分区；选完就切过去（同一批能力，不另造一套） */
  const 修什么表: { panel: string; 名: string; 说明: string }[] = [
    { panel: 'fix', 名: '文本', 说明: '粘一段、读剪贴板、或拖一个文件进来，整段进、整段出' },
    { panel: 'batch', 名: '文件', 说明: '指一个目录，递归扫文本文件，出表勾选后写盘' },
    { panel: 'names', 名: '名称', 说明: '只修文件/目录名里的乱码，不动正文' },
    { panel: 'fx', 名: '.fx 注释', 说明: '只动注释正文，代码一个字符都不碰' }
  ];
  function 去修(t: { panel: string }) {
    if (t.panel === panelId) return;
    void goto(`/tools/glitch?panel=${t.panel}`);
  }

  /** 圈里最常见的几个例子，贴出来给人对照着认 */
  const KNOWN: { bad: string; good: string; note: string }[] = [
    { bad: '僐儞僩儘乕儔乕', good: 'コントローラー', note: '控制器' },
    { bad: '僥僋僗僠儍', good: 'テクスチャ', note: '贴图' },
    { bad: '僔僃乕僟乕', good: 'シェーダー', note: '着色器' },
    { bad: '僙僢僩', good: 'セット', note: '套件' },
    { bad: '儌僨儖', good: 'モデル', note: '模型' },
    { bad: '屲', good: '五', note: '汉字被读错' }
  ];

  /** 从批量那页把一段丢到"文本"页去挑 */
  function 去文本页挑(段: string) {
    待挑段.text = 段;
    void goto('/tools/glitch?panel=fix', { replaceState: true });
  }

  /* 文本页一挂上（或那条待挑的段换了）就把它粘进来跑一遍 —— 用户点的是"去文本页挑"，
     过去之后不该还得自己再粘一次 */
  $effect(() => {
    const 段 = 待挑段.text;
    if (!段 || panelId !== 'fix') return;
    待挑段.text = '';
    文件路 = '';
    文件结果 = null;
    input = 段;
    void run();
  });

  /* ---------------- 名字还原（文件/目录名里的乱码） ----------------
     由来：语料 `实战测试用例\乱码翻译\` 里**正文是好的、乱的是名字**
     （`00_僔僃乕僟乕傪嵞攝晍偡傞偲偒偺拲堄揰.txt` 这种），而以前整个工具对名字一个字符都不动。 */

  let 名根 = $state('');
  let 名命中 = $state<NameHit[]>([]);
  /** 勾了哪些要改 */
  let 名勾 = $state<Record<string, boolean>>({});
  /** 每一条最后要用的名字（自动是修后名，手动挑候选会覆盖它） */
  let 名要 = $state<Record<string, string>>({});
  let 名忙 = $state(false);
  let 名话 = $state<{ kind: 'ok' | 'warn' | 'info'; text: string } | null>(null);
  /** 上一次改名的日志，用来回滚 */
  let 名日志 = $state<RenamePair[]>([]);

  const 名勾数 = $derived(Object.values(名勾).filter(Boolean).length);

  async function 选名目录() {
    const d = await pickFolder('选一个目录，扫它里面文件/目录名里的乱码');
    if (!d) return;
    名根 = d;
    await 扫名字();
  }

  async function 扫名字() {
    if (!名根) return;
    名忙 = true;
    名话 = null;
    try {
      名命中 = await scanNames(名根, undefined, 目标编码);
      // 有把握的排前面；没把握的按"假名上升"降序 —— 那是最硬的信号
      名命中.sort((a, b) => {
        if (a.自动可改 !== b.自动可改) return a.自动可改 ? -1 : 1;
        return (b.候选[0]?.score ?? 0) - (a.候选[0]?.score ?? 0);
      });
      名勾 = {};
      名要 = {};
      for (const h of 名命中) {
        // 自动判据认了的默认勾上；没认的也摆出来，但不预先勾（默认不自动改不确定的）
        名勾[h.path] = h.自动可改;
        名要[h.path] = h.修后名;
      }
      名话 = {
        kind: 'info',
        text: `扫到 ${名命中.length} 个名字像乱码：${名命中.filter((h) => h.自动可改).length} 个能自动改，其余要你自己挑一条。`
      };
    } catch (e) {
      名话 = { kind: 'warn', text: `扫名字失败：${(e as Error).message}` };
    }
    名忙 = false;
  }

  /**
   * 挑一条候选当作这条的名字。
   *
   * 候选是**段级**的文本（`使い方`），要替回名字里那一段才算整名。
   * 那一段用"原名与修后名的公共前后缀"倒推出来 —— 两条路径（自动/手动）都是同一段。
   */
  function 名字用候选(h: NameHit, 候选文本: string) {
    const 段 = 段Of(h);
    if (段) {
      名要[h.path] = h.原名.replace(段, 候选文本);
    } else {
      /* 段推不出来（`修后名` 跟 `原名` 一模一样时，公共前后缀把整串吃掉了）——
         **不能拿一段候选把整个名字替掉**：那会把扩展名一起丢掉
         （`介绍.png` 变成 `紹介`，文件就再也认不出来了；语料里这类有 116 个不同名）。
         保留原来的扩展名。（2026-09-25 只读审查量出来的。） */
      const 点 = h.原名.lastIndexOf('.');
      const 尾 = 点 > 0 ? h.原名.slice(点) : '';
      名要[h.path] = 候选文本 + 尾;
    }
    名勾[h.path] = true;
  }

  /** 从"原名 → 修后名"倒推出被替换掉的那一段 */
  function 段Of(h: NameHit): string {
    let i = 0;
    while (i < h.原名.length && i < h.修后名.length && h.原名[i] === h.修后名[i]) i++;
    let j = 0;
    while (
      j < h.原名.length - i &&
      j < h.修后名.length - i &&
      h.原名[h.原名.length - 1 - j] === h.修后名[h.修后名.length - 1 - j]
    ) {
      j++;
    }
    return h.原名.slice(i, h.原名.length - j);
  }

  async function 改名() {
    const 计划: RenamePair[] = 名命中
      .filter((h) => 名勾[h.path] && 名要[h.path] && 名要[h.path] !== h.原名)
      .map((h) => ({ from: h.path, to: 名要[h.path] }));
    if (!计划.length) {
      名话 = { kind: 'warn', text: '没有勾选要改的名字。' };
      return;
    }
    名忙 = true;
    try {
      const r = await renameEntries(计划);
      名日志 = r.done;
      const 坏 = r.failed.length;
      名话 = {
        kind: 坏 ? 'warn' : 'ok',
        text: `改了 ${r.done.length} 个${坏 ? `，${坏} 个没改成（多半是目标已经存在）` : ''}。${
          坏 ? '没改成的：' + r.failed.slice(0, 3).map((f) => f.原因).join('；') : ''
        }`
      };
      await 扫名字();
    } catch (e) {
      名话 = { kind: 'warn', text: `改名失败：${(e as Error).message}` };
    }
    名忙 = false;
  }

  async function 回滚名字() {
    if (!名日志.length) return;
    名忙 = true;
    try {
      const r = await undoRenames(名日志);
      名话 = {
        kind: r.failed.length ? 'warn' : 'ok',
        text: `回滚了 ${r.done.length} 个${r.failed.length ? `，${r.failed.length} 个没回成` : ''}。`
      };
      if (!r.failed.length) 名日志 = [];
      if (名根) await 扫名字();
    } catch (e) {
      名话 = { kind: 'warn', text: `回滚失败：${(e as Error).message}` };
    }
    名忙 = false;
  }

  /* ---------------- 文本分区 ---------------- */
  let input = $state('');
  let result = $state<RepairResult | null>(null);
  let busy = $state(false);
  let err = $state<string | null>(null);

  /** 放了个文件就在这里。只粘贴的话是空的 —— 没有落点，落盘那一步会明说 */
  let 文件路 = $state('');
  /** `.fx`/`.fxsub` 只动注释（跟 ⑤ 那边同一条边界）；其它文本整篇算 */
  const 模式 = $derived<'whole' | 'fx-comments'>(
    /\.(fx|fxsub)$/i.test(文件路) ? 'fx-comments' : 'whole'
  );
  /** 文件那一路的还原结果（带编码与全文）；粘贴那一路走 result */
  let 文件结果 = $state<{
    日文: string;
    编码: string;
    changed: boolean;
    segments: SegmentReport[];
  } | null>(null);
  /** 第一步出来的日文全文 —— 第二步都拿它做输入 */
  const 日文 = $derived(文件结果 ? 文件结果.日文 : result?.changed ? result.fixed : input);

  /**
   * 逐段的交代。
   *
   * **不再画在界面上**（用户 2026-09-24："别只会细说把什么还原成什么"）——
   * 算出来的整段就在右边那块 `pre` 里。这里只留一个**数字**：
   * 有几段拿不准（看着像乱码但没到自动改的程度），一句话交代，不列候选、不摆增益。
   */
  const 交代 = $derived<SegmentReport[]>(
    文件结果 ? 文件结果.segments : result?.segments ?? []
  );
  /** 拿不准的段数（只用来出一句话，不给按钮） */
  const 待挑 = $derived(
    交代.map((s, i) => ({ s, i })).filter((x) => x.s.applied === null && x.s.候选.length > 0)
  );

  /** 有没有跑过第一步（决定右边那块是"结果"还是"提示语"） */
  const 还原过 = $derived(result !== null || 文件结果 !== null);
  /** 这一段到底是什么编码读错的（认出来了才报） */
  const 认出的编码 = $derived(文件结果?.编码 ?? result?.via ?? '');
  /** 这一步真的动过内容没有 */
  const 改了吗 = $derived(文件结果?.changed ?? result?.changed ?? false);

  async function 选文件() {
    err = null;
    try {
      const f = await pickFile(['fx', 'fxsub', 'txt', 'md', 'csv', 'log', 'json', 'conf', 'ini']);
      if (!f.length) return;
      文件路 = f[0].path;
      await run();
    } catch (e) {
      err = (e as Error).message;
    }
  }

  function 清文件() {
    文件路 = '';
    文件结果 = null;
    段s = [];
  }

  async function run() {
    if (!input.trim() && !文件路) {
      /* 以前这里是**静默 return** —— 空输入点「还原」什么都不发生、也不说为什么，
         看起来就是"功能坏了"（用户 2026-09-24 报的就是这一类观感）。 */
      err = '还没有内容可处理 —— 先「选文件 / 选目录」，或者把要还原的日文粘进上面的框。';
      return;
    }
    busy = true;
    err = null;
    try {
      if (文件路) {
        /* **编码要带进去**：这条原来只传 `模式`，界面上选的日文编码在"选文件"这条路上
           一次都没生效过（2026-09-24 修）。 */
        /* 出发时把框里的东西记下来：读一个几 MB 的 .fx 要等一会儿，这期间用户可能在
           「粘进来的乱码」框里打字 —— 回来那一下不许把人打的字冲掉
           （2026-09-25 只读审查量出来的）。 */
        const 出发时的输入 = input;
        const r = await readTextFixed(文件路, 模式, 目标编码);
        文件结果 = {
          日文: r.text,
          编码: r.encoding,
          changed: r.changed,
          segments: r.segments
        };
        /* 框里还是原来那份才填文件原文；用户动过就留他打的 */
        if (input === 出发时的输入) input = r.original;
        /* **让「文本」栏也有东西可看**：以前这里只填 `文件结果`，而「文本」栏读的是 `result`
           —— 于是"选了文件、点了还原、界面毫无变化"（用户报的"没反应"就是这个）。
           按 `RepairResult` 的真字段拼一份：还原后的日文进 `fixed`，原文/改动标记跟文件那条路一致；
           `attempts`/`score_*` 是"逐段候选打分"那套的产物，文件这条路不做候选，给空值，
           界面上那两块（够不着门槛时的候选表）本来就不会显示。 */
        result = {
          original: r.original,
          fixed: r.text,
          changed: r.changed,
          via: r.encoding,
          score_after: 0,
          score_before: 0,
          attempts: [],
          segments: r.segments
        };
      } else {
        文件结果 = null;
        result = await repairText(input, 目标编码);
      }
      段s = [];
      译错 = null;
    } catch (e) {
      err = (e as Error).message;
      result = null;
      文件结果 = null;
    }
    busy = false;
  }

  async function pasteClipboard() {
    try {
      input = await navigator.clipboard.readText();
      清文件();
      await run();
    } catch {
      err = '读不了剪贴板，手动贴一下。';
    }
  }

  function useExample(bad: string) {
    input = bad;
    清文件();
    run();
  }

  /* ---------------- 拖文件 / 拖文件夹进这一页（用户 2026-09-23 C8） ----------------

     原来这一页只支持"粘贴"和"选文件"两个按钮，拖进来什么都不接。
     现在整块主区就是一个落点：
       · 拖**文件**（.txt/.fx/.fxsub/… 文本类）→ 直接读进来跑一遍；
       · 拖**文件夹** → 扫里面的文本文件：只有一个就直接打开，多个就切到「文件」分区看清单。
     文件夹在拖放事件里只给一条没有后缀的路径，所以它必须单独注册一个 `dir` 落点
     （跟图片槽那套分不开，见 `dropzones.svelte.ts` 里那条注释）。

     **四个分栏都要挂落点**（用户 2026-09-24 报的"拖不进去、说没落在能接它的地方"）：
     以前只有「文本」栏这一处挂了，另外三栏一个落点都没有 —— 拖过去必然得到那句话，
     而那句话说的"拖到有落点的位置"在那一栏里根本不存在。每栏收什么由它自己那排按钮定，
     不另造一套语义：拖文件夹 = 点那一栏的「选目录」。 */
  let 落点 = $state<HTMLElement | null>(null);
  /** 拖进来的那个文件夹 + 扫出来的文本文件清单（**就地**显示，不跳页，设计准则 §四） */
  let 拖入根 = $state('');
  let 拖入清单 = $state<ScanHit[]>([]);

  /** 拖进来的文件夹清单里，"打开这个"就地打开那一个 */
  async function 打开拖入的那条(h: ScanHit) {
    文件路 = h.path;
    await run();
  }

  /** 路径最后一段。报错里要指名道姓说是哪个文件 */
  function 名底(p: string): string {
    return p.split(/[\\/]/).pop() ?? p;
  }

  /**
   * 目录里**没进清单**的那些，按**后端真正的三条筛法**分开数清楚。
   *
   * 为什么要有（用户 2026-09-24）：拖一个目录进来扫到 0 个文本文件时，原来只说一句
   * "这个文件夹里没有文本文件（只收 …）" —— **"没进来"和"进来了没处理"看起来一模一样**。
   *
   * 一开始我只做了"跟后缀表做差"，结果**界面说了假话**：语料里 18 个 `.fx` 和 13 个 `.x`
   * 明明在表里，却被打成"不在收的后缀里"。真因是后端 `scan_text_files` 有**三条**筛法
   * （`textenc.rs`）：
   *   ① 后缀不在 `want` 里 → 跳过；
   *   ② 整篇全 ASCII → 跳过（"乱码必然带非 ASCII"）；
   *   ③ 超过 4MB → 跳过。
   * 还有 500 条的默认上限。所以这里分开报，每一桶说清为什么。
   *
   * `scan_dir` 传空后缀就是"全要"（`fsops.rs` 那句注释），拿它跟清单做差。
   */
  type 一桶 = { 几个: number; 按后缀: [string, number][]; 例: string[] };
  type 筛掉话 = { 共几个: number; 后缀不收: 一桶 | null; 纯ascii: 一桶 | null; 太大: 一桶 | null };

  const 分桶 = (文件们: { path: string; name: string; ext: string; size: number }[]): 一桶 | null => {
    if (!文件们.length) return null;
    const 计 = new Map<string, number>();
    for (const f of 文件们) {
      const k = f.ext ? '.' + f.ext : '（没后缀）';
      计.set(k, (计.get(k) ?? 0) + 1);
    }
    return {
      几个: 文件们.length,
      按后缀: [...计.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
      例: 文件们.slice(0, 3).map((f) => f.name)
    };
  };

  async function 看筛掉了什么(
    root: string,
    收的后缀: string[],
    收下的: Set<string>
  ): Promise<筛掉话 | null> {
    try {
      const 全部 = await scanDir(root, [], true);
      if (!全部.length) return null;
      const 掉 = 全部.filter((f) => !收下的.has(f.path));
      if (!掉.length) return null;
      const 表内 = new Set(收的后缀.map((e) => e.toLowerCase()));
      const 后缀不收: typeof 掉 = [];
      const 纯ascii: typeof 掉 = [];
      const 太大: typeof 掉 = [];
      for (const f of 掉) {
        if (!表内.has(f.ext.toLowerCase())) 后缀不收.push(f);
        else if (f.size > 4 * 1024 * 1024) 太大.push(f);
        else 纯ascii.push(f); // 后缀收、又不大 → 后端那三条里只剩"全 ASCII"
      }
      return {
        共几个: 全部.length,
        后缀不收: 分桶(后缀不收),
        纯ascii: 分桶(纯ascii),
        太大: 分桶(太大)
      };
    } catch {
      /* 目录太大超了扫描上限之类 —— 不报假数 */
      return null;
    }
  }

  /** 「文本」栏拖文件夹那条：筛掉的是哪些 */
  let 拖入筛掉 = $state<筛掉话 | null>(null);
  /** 「文件」栏扫目录那条：筛掉的是哪些 */
  let 批量筛掉 = $state<筛掉话 | null>(null);
  /** 这一趟扫描是不是**到了后端 500 条的上限**（到了就不许再猜"剩下的为什么没进来"） */
  let 到上限了 = $state(false);

  /** 「文本」栏：拖一个文件进来直接读 */
  async function 文本接文件(p: string) {
    err = null;
    try {
      文件路 = p;
      await run();
    } catch (e) {
      err = (e as Error).message;
    }
  }

  /** 「文本」栏：拖一个文件夹进来，扫里面的文本文件 */
  async function 文本接文件夹(p: string) {
    const 列 = await scanTextFiles(p, TEXT_EXTS, 目标编码);
    拖入根 = p;
    拖入清单 = 列;
    拖入筛掉 = await 看筛掉了什么(p, TEXT_EXTS, new Set(列.map((h) => h.path)));
    if (!列.length) {
      err = `这个文件夹里没有文本文件（只收 ${TEXT_EXTS.map((e) => '.' + e).join(' / ')}）。${
        拖入筛掉
          ? `里面 ${拖入筛掉.共几个} 个文件：${
              拖入筛掉.后缀不收 ? `后缀不在表里 ${拖入筛掉.后缀不收.几个} 个（${拖入筛掉.后缀不收.按后缀.map(([k, v]) => `${k}×${v}`).join('、')}）` : ''
            }${拖入筛掉.后缀不收 && 拖入筛掉.纯ascii ? '；' : ''}${
              拖入筛掉.纯ascii ? `后缀在表里但整篇都是 ASCII ${拖入筛掉.纯ascii.几个} 个` : ''
            }。要收别的后缀，去「文件」栏那一栏点「连不在表里的后缀也扫」。`
          : ''
      }`;
      return;
    }
    /* **不跳页**（设计准则 §四）：就地在这张卡下面列出扫到的东西，
       要处理哪个就地打开；想批量再去「文件」分区（那个按钮是显式的，不自动跳）。 */
    if (列.length === 1) {
      文件路 = 列[0].path;
      await run();
    }
  }

  /**
   * 拖进来的**一个文件**。
   *
   * 四个分栏里只有「文本」栏有"处理单个文件"这件事（读进来跑一遍）；另外三栏
   * 本来就是按目录干的活。接过来说清楚该往哪儿拖 —— 别一声不响，也别让那句话
   * 指着一个不存在的落点。
   */
  async function 接拖文件(p: string) {
    err = null;
    if (panelId === 'fix') {
      await 文本接文件(p);
      return;
    }
    const 名 = 名底(p);
    err =
      panelId === 'batch'
        ? `${名} 是单个文件 —— 「文件」这一栏按目录扫：拖整个文件夹进来，或点「选目录」。只修一个文件去「文本」栏。`
        : panelId === 'names'
          ? `${名} 是单个文件 —— 这一栏扫的是名字，按目录来：拖整个文件夹进来，或点「选目录」。`
          : `${名} 是单个文件 —— 这一栏按目录扫 .fx / .fxsub：拖整个文件夹进来，或点「选 Ray / MME 目录」。`;
  }

  /**
   * 拖进来的**一个文件夹**。
   *
   * 走**当前那一栏**自己那套：拖文件夹 = 点那一栏的「选目录」。
   * 拖进来的东西是文件还是文件夹，在拖放事件里只能靠 `probeDir` 问一句
   * （文件夹那条路径没有后缀，看不出身份）。
   */
  async function 接拖文件夹(p: string) {
    err = null;
    const 名 = 名底(p);
    const 探测 = await probeDir(p).catch(() => null);
    if (!探测?.is_dir) {
      /* 走到这儿的是"没有收的后缀、又不是目录"那一种（比如 `.png`，或者没后缀的文件）——
         把这一处**到底收什么**说全，别只说它不是什么。 */
      err = `${名} 不是文件夹 —— 这一处收的是文件夹（拖文件夹进来 = 点这一栏的「选目录」），或者 ${TEXT_EXTS.map((e) => '.' + e).join(' / ')} 这些文本文件。`;
      return;
    }
    try {
      if (panelId === 'fix') {
        await 文本接文件夹(p);
        return;
      }
      if (panelId === 'batch') {
        batchRoot = p;
        await 扫批量(p);
        return;
      }
      if (panelId === 'names') {
        名根 = p;
        await 扫名字();
        return;
      }
      await 扫fx目录(p);
    } catch (e) {
      err = (e as Error).message;
    }
  }

  $effect(() => {
    const 撤: (() => void)[] = [];
    const el = 落点;
    if (!el) return;
    /* 四个分栏各绑一次 `落点`，一次只有一个在场。id 带栏名，看一眼就知道是谁在接。 */
    const 登记 = (id: string, 收: (r: FileRef) => void, 附加: Partial<DropZone>) => {
      撤.push(() => unregisterZone(id));
      registerZone({
        id,
        rect: el.getBoundingClientRect(),
        el,
        onDrop: 收,
        ...附加
      });
    };
    /* 顺序有关系：同面积时 `zoneAt` 取先注册的那个，所以文件落点先登记。
       文件那个按 `TEXT_EXTS` 筛 —— 不是文本的东西（比如 .png）由它把"只收 …"实话说出来；
       文件夹（路径没有后缀）落到下面那个 `dir` 落点上。 */
    登记(`glitch.${panelId}`, (r) => void 接拖文件(r.path), { accept: TEXT_EXTS });
    登记(`glitch.${panelId}.dir`, (r) => void 接拖文件夹(r.path), { dir: true });
    return () => {
      for (const f of 撤) f();
    };
  });

  async function copyOut() {
    try {
      await navigator.clipboard.writeText(日文);
    } catch {
      err = '写不进剪贴板，手动全选复制。';
    }
  }

  /* ---------------- 第二步：翻成中文（外接引擎） ---------------- */

  /** 默认关：不打开就一次请求都不发 */
  let 开翻译 = $state(false);
  let 段s = $state<段[]>([]);
  let 译中 = $state(false);
  let 译错 = $state<string | null>(null);
  /** 翻成功过（决定"写回"能不能点） */
  let 译过 = $state(false);

  const 段落上限 = 400;
  const 显示的段 = $derived(段s.slice(0, 段落上限));

  /**
   * 切段落。
   *
   * 段落由 Rust 用**跟还原同一份**注释扫描切出来；原文那一段也切一次用来并排显示
   * （两边的段数对不上时原文那栏留空，不硬凑）。
   */
  async function 切段() {
    const 日 = 日文;
    if (!日.trim()) {
      段s = [];
      return;
    }
    try {
      const 原 = await scanPieces(input, 模式);
      const 日段 = await scanPieces(日, 模式);
      段s = 日段.map((s, i) => ({ 原: 原[i] ?? '', 日: s, 译: '' }));
      译过 = false;
      译错 = null;
    } catch (e) {
      译错 = (e as Error).message;
    }
  }

  async function 切换翻译(v: boolean) {
    开翻译 = v;
    if (v) await 切段();
  }

  async function 翻译() {
    if (!段s.length) await 切段();
    if (!段s.length) {
      译错 = '这一段里没有可翻的东西（.fx 只翻注释，代码不算）。';
      return;
    }
    if (!引擎填了(prefs.engine)) {
      译错 =
        取引擎(prefs.engine).kind === 'off'
          ? '现在是离线：只做术语替换，不翻句子。要真译文就在右下角「外观」→「翻译引擎」里选 MyMemory（免费，不用填）或自定义。'
          : '自定义引擎还没填全 —— 右下角「外观」→「翻译引擎」里要填地址和模型名两条。';
      return;
    }
    译中 = true;
    译错 = null;
    const r = await 翻段落(prefs.engine, 段s.map((d) => d.日), (e, texts) => translateText(e, texts));
    if (!r.sent) {
      译错 = '没发请求（引擎是离线）。';
    } else if (!r.ok) {
      译错 = r.error ?? '翻译失败，原因不明';
    } else if (r.translations.length !== 段s.length) {
      译错 = `引擎回了 ${r.translations.length} 段，发过去 ${段s.length} 段 —— 号对不上，没写回`;
    } else {
      段s = 并回译文(段s, r.translations);
      译过 = true;
    }
    译中 = false;
  }

  /* ---------------- 落盘 ---------------- */

  let 落盘模式 = $state<'saveas' | 'inplace'>('saveas');
  let 后缀 = $state('_zh');
  let 落盘忙 = $state(false);
  let 落盘话 = $state<{ kind: 'ok' | 'warn' | 'info'; text: string } | null>(null);

  const 落盘目标 = $derived.by(() => {
    if (!文件路) return '';
    if (落盘模式 === 'inplace') return 文件路;
    const 扩展 = 文件路.slice(文件路.lastIndexOf('.') + 1) || 'txt';
    return siblingPath(文件路, 后缀, 扩展);
  });

  /** 只有翻过（或至少要有一段的译文）才允许写回 */
  const 可写回 = $derived(!!日文.trim() && (译过 || 都译了吗(段s)));

  async function 写回() {
    if (!文件路) {
      落盘话 = { kind: 'warn', text: '粘贴进来的内容没有落点：要么先「选一个文本文件」，要么用上面的「复制结果」。' };
      return;
    }
    if (!可写回) {
      落盘话 = { kind: 'warn', text: '还没有译文 —— 先把「再翻成中文」打开、翻一遍。' };
      return;
    }
    落盘忙 = true;
    落盘话 = null;
    try {
      /* 只替换段落内容：段落定位和拼接都在 Rust 里，跟切分共用同一份扫描 */
      const 全文 = await applyPieces(日文, 模式, 段s.map((d) => d.译));
      const r = await writeTextFile(落盘目标, 全文, true);
      落盘话 = {
        kind: 'ok',
        text:
          `写了 ${落盘目标}（UTF-8` +
          (r.backup ? '，覆盖前留了备份' : '') +
          '）。翻了中文就只能按 UTF-8 存 —— 原来的日文编码装不下中文。'
      };
    } catch (e) {
      落盘话 = { kind: 'warn', text: `写不了：${(e as Error).message}` };
    }
    落盘忙 = false;
  }

  /* ---------------- 离线术语表（不翻译，只换固定说法） ---------------- */

  let userTerms = $state<GlossaryEntry[]>([]);
  let tr = $state<TranslateResult | null>(null);
  let showGlossary = $state(false);
  let newJp = $state('');
  let newCn = $state('');

  $effect(() => {
    userTerms = loadUserTable();
  });

  const table = $derived(mergeTable(userTerms));

  function translateNow() {
    if (!日文.trim()) return;
    tr = translateWith(日文, table);
  }

  function addTerm(jp: string) {
    if (userTerms.some((e) => e.jp === jp)) return;
    userTerms = [{ jp, cn: '' }, ...userTerms];
    saveUserTable(userTerms);
    translateNow();
  }

  function commitNewTerm() {
    const jp = newJp.trim();
    if (!jp) return;
    const cn = newCn.trim();
    userTerms = [{ jp, cn }, ...userTerms.filter((e) => e.jp !== jp)];
    saveUserTable(userTerms);
    newJp = '';
    newCn = '';
    translateNow();
  }

  function dropTerm(jp: string) {
    userTerms = userTerms.filter((e) => e.jp !== jp);
    saveUserTable(userTerms);
    translateNow();
  }

  /** 词表里搜一下，界面用 */
  let gFilter = $state('');
  const tableRows = $derived(
    (gFilter.trim()
      ? table.filter((e) => e.jp.includes(gFilter.trim()) || e.cn.includes(gFilter.trim()))
      : table
    ).slice(0, 400)
  );

  /* ---------------- 文件分区 ---------------- */
  /* `x` = DirectX 的 `.x`（MME 那边不少效果带这个后缀的文本，语料里就有） */
  const TEXT_EXTS = ['txt', 'fx', 'fxsub', 'fxconf', 'conf', 'ini', 'md', 'csv', 'log', 'json', 'x'];
  let batchRoot = $state('');
  let hits = $state<ScanHit[]>([]);
  let picked = $state<Record<string, boolean>>({});
  let dryRun = $state(true);
  let batchBusy = $state(false);
  let results = $state<{ rel: string; ok: boolean; msg: string }[]>([]);
  let doneCount = $state(0);

  /**
   * 顺手把**名字**也还原（用户 2026-09-24："文件名称也要把编码读取错误的日文按需还原
   * （这就已经包含了名字还原的职责）"）。
   *
   * 只在这一次扫描里认出来的、**判据自己有把握的**那些（`自动可改`）——
   * 没把握的不动，也不在这儿让人一条条认（那是原来「名称」栏干的活，
   * 用户要的是顺手做掉，不是又开一张表）。
   * 目录名和文件名一起扫：`scanNames` 本来两样都出。
   */
  let 批量也改名 = $state(true);
  /**
   * 连不在 `TEXT_EXTS` 里的后缀也扫。
   *
   * **默认关**：`TEXT_EXTS` 是"什么算文本"的规格，不该由我猜着放宽 ——
   * 放宽了就会把 `.png` / `.dds` / `.pmx` 这些二进制也喂进还原那条路。
   * 但用户报过"选文件目录那里拖不进"，所以给一个**显式开关**：
   * 开了就把**这个目录里实际出现的后缀**全喂给扫描（不是无脑全收，还是按后缀走）。
   * 试跑默认开着，真写盘之前看得到结果。
   */
  let 也收表外的 = $state(false);
  let 批量名 = $state<NameHit[]>([]);
  /** 生效的是哪一次：勾没勾上、名字这一趟写不写盘，跑之前定死 */
  const 批量名数 = $derived(批量名.length);

  async function pickBatch() {
    err = null;
    try {
      const root = await pickFolder('乱码批处理', '/tools/glitch?panel=batch');
      if (!root) return;
      batchRoot = root;
      await 扫批量(root);
    } catch (e) {
      err = (e as Error).message;
    }
    batchBusy = false;
  }

  /** 扫一个目录里的文本文件（点「选目录」和拖文件夹进来都走这一条） */
  async function 扫批量(root: string) {
    batchBusy = true;
    try {
      /* 先把整个目录列一遍：既用来算"后缀表筛掉了什么"，也用来在开了"连表外的也扫"时
         把**实际出现的后缀**喂给扫描。`scan_dir` 传空后缀就是"全要"（`fsops.rs`）。 */
      const 全部 = await scanDir(root, [], true).catch(() => []);
      /* **本工具自己留的备份永远不收**：`X.txt.bak` 的后缀是 `bak`，一旦按"实际出现的后缀"
         放宽，它就会被当成待处理的文本扫进来 —— 而 `.bak` 里装的正是上一轮改前的乱码原文，
         于是"像乱码"→ 默认勾上 → 原地改写，还给自己留一份 `.bak.bak`。
         （2026-09-25 只读审查量出来的，是我这个开关带出来的坑。） */
      const 是备份 = (e: string) => /^bak\d*$/i.test(e);
      const 收的后缀 = 也收表外的
        ? [...new Set(全部.map((f) => f.ext).filter((e) => e && !是备份(e)))]
        : TEXT_EXTS;
      hits = await scanTextFiles(root, 收的后缀, 目标编码);
      到上限了 = hits.length >= 500; // 后端 `scan_text_files` 的默认上限（`textenc.rs`）
      picked = {};
      for (const h of hits) {
        /* 放宽之后扫进来的东西**默认不勾**：`.png` / `.dds` / `.pmx` 这些二进制也能凑出
           "像乱码"的判据（实测 3357 个真二进制里 376 个 changed=true），默认勾上就等于
           替用户选好了要改二进制。表里那些照旧按 `likely` 勾。 */
        const e = (h.path.split('.').pop() ?? '').toLowerCase();
        picked[h.path] = TEXT_EXTS.includes(e) && h.likely;
      }
      results = [];
      doneCount = 0;
      /* 名字那条：只留"判据自己有把握"的，列的账不摆到界面上，只在跑完报条数 */
      批量名 = (await scanNames(root, undefined, 目标编码).catch(() => [])).filter((h) => h.自动可改);
      /* 后缀表没收下的那些也数一遍：不然"没进来"和"进来了没处理"看起来一样。
         **按后端那三条筛法分桶**报，别把"后缀在表里但全是 ASCII"也算成"后缀不收"
         —— 那样界面就说假话了（`.fx`/`.x` 明明在表里）。 */
      批量筛掉 = await 看筛掉了什么(root, 收的后缀, new Set(hits.map((h) => h.path)));
    } finally {
      batchBusy = false;
    }
  }

  /* ---------------- 输出到哪儿 ---------------- */

  let outMode = $state<'inplace' | 'dir'>('inplace');
  let outDir = $state('');
  let tpl = $state('{name}_fixed.{ext}');
  let keepTree = $state(true);

  async function pickOutDir() {
    // 不传 label：这是"往哪儿写"，不是"在做哪个工程"，不进最近工程
    const d = await pickFolder();
    if (d) outDir = d;
  }

  /** 一条要写到哪个路径。原地改返回空串 */
  function outFor(h: ScanHit): string {
    if (outMode === 'inplace') return '';
    return outPathFor(outDir, { name: baseNameOf(h.path), rel: relOf(h) }, tpl, keepTree);
  }

  function baseNameOf(p: string): string {
    const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
    return i >= 0 ? p.slice(i + 1) : p;
  }

  /** 相对根目录的子目录。ScanHit 的 rel 是相对路径，去掉文件名就是子目录 */
  function relOf(h: ScanHit): string {
    const rel = h.rel || baseNameOf(h.path);
    const i = Math.max(rel.lastIndexOf('\\'), rel.lastIndexOf('/'));
    return i >= 0 ? rel.slice(0, i) : '';
  }

  /** 头几条的实际落点，给用户先看一眼对不对 */
  const outPreview = $derived.by(() => {
    if (outMode === 'inplace') return [];
    return hits
      .filter((h) => picked[h.path])
      .slice(0, 3)
      .map((h) => ({ from: h.rel, to: outFor(h) }));
  });

  const outReady = $derived(outMode === 'inplace' || !!outDir || !isTauri());

  const likelyCount = $derived(hits.filter((h) => h.likely).length);
  const pickedCount = $derived(Object.values(picked).filter(Boolean).length);

  /** 「文件」栏这一趟改过的名字，退回去（跟「名称」栏那个回滚同一套 `undoRenames`） */
  async function 回滚批量名() {
    if (!名日志.length) return;
    batchBusy = true;
    try {
      const r = await undoRenames(名日志);
      results = [
        ...results,
        ...r.done.map((p) => ({ rel: baseNameOf(p.to), ok: true, msg: `名字退回去了 → ${baseNameOf(p.from)}` })),
        ...r.failed.map((f) => ({ rel: baseNameOf(f.from), ok: false, msg: `没退成：${f.原因}` }))
      ];
      if (!r.failed.length) 名日志 = [];
      /* 退回去之后名字又变回乱的，重新扫一遍免得清单停在旧名字上 */
      if (batchRoot) await 扫批量(batchRoot);
    } catch (e) {
      err = (e as Error).message;
    }
    batchBusy = false;
  }

  async function runBatch() {
    if (!outReady) {
      err = '选了「另存到目录」但还没选目录。';
      return;
    }
    batchBusy = true;
    results = [];
    doneCount = 0;
    const todo = hits.filter((h) => picked[h.path]);
    for (const h of todo) {
      try {
        const r = await fixTextFile(h.path, !dryRun, 'whole', undefined, outFor(h), 目标编码);
        const where = r.error
          ? ''
          : dryRun
            ? ' 试跑'
            : outMode === 'inplace'
              ? ' 已写盘' + (r.backup ? '，留了备份' : '')
              : ` 已另存 → ${baseNameOf(r.path)}`;
        results = [
          ...results,
          {
            rel: h.rel,
            ok: !r.error,
            msg: r.error ? r.error : r.changed ? `${r.via}（${r.encoding}）${where}` : '没检出乱码'
          }
        ];
      } catch (e) {
        results = [...results, { rel: h.rel, ok: false, msg: (e as Error).message }];
      }
      doneCount++;
    }

    /* 名字那一趟**放在正文之后**：改名会把路径换掉，先跑正文那些 `h.path` 才是对的。
       只动"判据自己有把握"的那些；没把握的一个都不碰（宁可不改也别改坏）。
       试跑时不写盘，只报"会改成什么"。 */
    if (批量也改名 && 批量名.length) {
      const 计划 = 批量名.map((h) => ({ from: h.path, to: h.修后名 }));
      if (dryRun) {
        for (const p of 计划) {
          results = [...results, { rel: baseNameOf(p.from), ok: true, msg: `试跑 名字会改成 → ${baseNameOf(p.to)}` }];
        }
      } else {
        try {
          const r = await renameEntries(计划);
          名日志 = r.done;
          for (const p of r.done) {
            results = [...results, { rel: baseNameOf(p.from), ok: true, msg: `名字已改成 → ${baseNameOf(p.to)}` }];
          }
          for (const f of r.failed) {
            results = [...results, { rel: baseNameOf(f.from), ok: false, msg: `名字没改成：${f.原因}` }];
          }
        } catch (e) {
          results = [...results, { rel: '（名字那一趟）', ok: false, msg: (e as Error).message }];
        }
      }
    }

    batchBusy = false;
  }

  /* ---------------- .fx 注释分区 ---------------- */
  type FxScreen = {
    ref: FileRef;
    encoding: string;
    lines: number;
    changed: boolean;
    via: string;
    beforeSample: string;
    afterSample: string;
    error: string | null;
  };
  /** 一次最多扫多少个。渲染包里 .fx/.fxsub 上千个，全扫会卡很久 */
  const FX_SCAN_LIMIT = 400;

  let fxScreens = $state<FxScreen[]>([]);
  /** 目录里一共找到多少个（**不是**扫了多少个 —— 有上限，两个数要分开报） */
  let fxFound = $state(0);
  let fxScanned = $state(0);
  let fxPicked = $state<Record<string, boolean>>({});
  let fxBusy = $state(false);
  let fxDry = $state(true);
  let fxResults = $state<{ rel: string; ok: boolean; msg: string }[]>([]);

  /**
   * 选目录 → 每个 .fx 先跑一遍 dry run。
   * 后端在 dry run 下会把"改了哪几行、改前改后长什么样"一起返回，
   * 界面上直接摆出来，不用前端自己猜会改成什么。
   */
  async function pickFxFiles() {
    err = null;
    if (!isTauri()) {
      err = '文件读写在桌面端才有真路径。';
      return;
    }
    const root = await pickFolder('.fx 注释', '/tools/glitch?panel=fx');
    if (!root) return;
    await 扫fx目录(root);
  }

  /**
   * 扫一个目录里的 .fx / .fxsub，每个先跑一遍 dry run。
   *
   * 点「选 Ray / MME 目录」和**拖一个文件夹进来**都走这一条。
   * 后端在 dry run 下会把"改了哪几行、改前改后长什么样"一起返回，
   * 界面上直接摆出来，不用前端自己猜会改成什么。
   */
  async function 扫fx目录(root: string) {
    fxBusy = true;
    fxResults = [];
    try {
      const files = await scanDir(root, ['fx', 'fxsub'], true);
      /* 一次最多扫这么多。渲染包里 .fx/.fxsub 上千个，全扫会卡很久，
         所以留个上限 —— 但**必须如实报出来**：以前这里只显示
         `fxScreens.length`（就是 120），等于把截断后的数当总数报，
         用户会以为包里就这么多。 */
      fxFound = files.length;
      fxScanned = Math.min(files.length, FX_SCAN_LIMIT);
      const out: FxScreen[] = [];
      for (const f of files.slice(0, FX_SCAN_LIMIT)) {
        try {
          const r = await fixTextFile(f.path, false, 'fx-comments', undefined, undefined, 目标编码);
          out.push({
            ref: f,
            encoding: r.encoding,
            lines: 0,
            changed: r.changed,
            via: r.via,
            beforeSample: r.before_sample,
            afterSample: r.after_sample,
            error: r.error
          });
        } catch (e) {
          out.push({
            ref: f,
            encoding: '',
            lines: 0,
            changed: false,
            via: '',
            beforeSample: '',
            afterSample: '',
            error: (e as Error).message
          });
        }
      }
      fxScreens = out;
      const next: Record<string, boolean> = {};
      for (const s of out) next[s.ref.path] = s.changed && !s.error;
      fxPicked = next;
    } catch (e) {
      err = (e as Error).message;
    }
    fxBusy = false;
  }

  const fxPickedCount = $derived(Object.values(fxPicked).filter(Boolean).length);

  async function runFx() {
    fxBusy = true;
    fxResults = [];
    const todo = fxScreens.filter((s) => fxPicked[s.ref.path] && !s.error);
    for (const s of todo) {
      try {
        const r = await fixTextFile(s.ref.path, !fxDry, 'fx-comments', undefined, undefined, 目标编码);
        fxResults = [
          ...fxResults,
          {
            rel: s.ref.name,
            ok: !r.error,
            msg: r.error
              ? r.error
              : r.changed
                ? `${r.via}${fxDry ? ' 试跑' : ' 已写盘' + (r.backup ? '，留了备份' : '')}`
                : '注释里没乱码'
          }
        ];
      } catch (e) {
        fxResults = [...fxResults, { rel: s.ref.name, ok: false, msg: (e as Error).message }];
      }
    }
    fxBusy = false;
  }
</script>

{#if !isTauri()}
  <Note kind="warn">
    编码转换要在桌面端跑。浏览器里的 TextEncoder 只支持 UTF-8，编不回 GBK，
    这条链路做不了。装好的 RobinEditor 里这个功能是完整的。
  </Note>
{/if}

<!--
  编码那一排：**四个分栏各画一份**（用户 2026-09-24："那几个文本的分栏都应该按日文的
  几个编码选择还原啊，名称，文本，文件，注释可选，这些已经是之前的要求你根本没做好"）。
  以前只有「文本」栏有这排按钮，另外三栏只挂一行只读读数「原文编码：X · 去「文本」栏改」——
  在那一栏干活的人得先跑回「文本」栏改一下再回来，等于把"编码"绑死在一个分栏上。

  **四栏共用同一个 `目标编码`**（同一个组件、同一个 `$state`），所以在哪一栏选、
  切到别的栏都跟着走 —— 这一点是用户明确要的"在哪儿选就在哪儿生效"。
  后端四条路都收这个参数：`repair_text` / `fix_text_file` / `scan_names` / `scan_text_files`
  （还有 `选一个文件` 走的 `read_text_fixed`）。
-->
{#snippet 编码条()}
  <div class="row">
    <span class="row__k">原文是什么日文编码</span>
    <div class="pick">
      {#each 编码档 as c (c.id)}
        <button class="pick__b" type="button" aria-pressed={目标编码 === c.id}
          onclick={() => (目标编码 = c.id)}>{c.名}</button>
      {/each}
    </div>
  </div>
  <p class="mini" style="margin:6px 0 0">
    {编码档.find((c) => c.id === 目标编码)?.说明 ?? ''}
  </p>
{/snippet}

{#if !['fix', 'batch', 'fx', 'names'].includes(panelId)}
  <!-- 不认识的 id 不再悄悄渲染最后一个分区（原来裸 `{:else}` 就是干这个的） -->
  <div class="card pad">
    <Note kind="warn">
      分区 id「{panelId}」这个组件不认识，所以这一页是空的。
      多半是注册表里加/改分区的时候，组件里的分支没跟着改 —— 两边要一起改。
    </Note>
  </div>
{:else if panelId === 'fix'}
  <div class="wb">
    <div class="wb__main" bind:this={落点}>
      <!-- ① 原文是什么编码 + ② 要修哪一样（用户 2026-09-23 定的口径）。
           编码那一排见上面那个 `编码条` 片段 —— **四个分栏各画一份**，共用同一个选择。
           下面那四个目标各自有专门的分区，点一下就切过去 —— 同一批能力，不另造一套。 -->
      <div class="card pad">
        {@render 编码条()}

        <div class="row" style="margin-top:12px">
          <span class="row__k">要修哪一样</span>
          <div class="pick">
            {#each 修什么表 as t (t.panel)}
              <button class="pick__b" type="button" aria-pressed={panelId === t.panel}
                onclick={() => 去修(t)}>{t.名}</button>
            {/each}
          </div>
        </div>
        <p class="mini" style="margin:6px 0 0">
          {修什么表.find((t) => t.panel === panelId)?.说明 ?? ''} —— 选别的会切到对应分区，编码这一档跟着走。
        </p>
      </div>

      <div class="card pad">
        <div class="row">
          <span class="row__k">
            {#if 文件路}第一步：还原成日文 · {文件路.split(/[\\/]/).pop()}{:else}第一步：把乱码还原成日文{/if}
          </span>
          <div class="acts">
            <button class="btn btn--ghost btn--sm" disabled={busy || !isTauri()} onclick={选文件}>
              <Icon name="ui.file" size={13} />选一个文件
            </button>
            <button class="btn btn--ghost btn--sm" onclick={pasteClipboard}>
              <Icon name="ui.copy" size={13} />读剪贴板
            </button>
            <button class="btn btn--ghost btn--sm"
              onclick={() => { input = ''; result = null; 清文件(); 开翻译 = false; }}>
              <Icon name="ui.close" size={13} />清空
            </button>
          </div>
        </div>
        <!-- 拖进来也行（用户 2026-09-23 C8）：文件直接读，文件夹扫里面的文本文件 -->
        <p class="mini" style="margin-top:6px">
          也可以把<b>文件</b>或<b>文件夹</b>直接拖到这一页：文件直接读进来；
          文件夹会扫里面的文本文件（多个就切到「文件」分区看清单）。
        </p>
        {#if 拖入清单.length}
          <!-- 拖进来一个文件夹：就地列出扫到的文本文件（不跳页，设计准则 §四），带"像乱码"读数 -->
          <details class="fold" open={true} style="margin-top:8px">
            <summary>
              这个文件夹里扫到 {拖入清单.length} 个文本文件
              （像乱码的 {拖入清单.filter((h) => h.likely).length} 个）
            </summary>
            <div class="fold__body">
              <p class="mini">{拖入根}</p>
              {#if 拖入筛掉}
                <!-- 没进清单的那些，按后端三条筛法分桶说（用户 2026-09-24 要的） -->
                <p class="mini mut">
                  另外这些没进清单：
                  {#if 拖入筛掉.后缀不收}
                    后缀不在表里 {拖入筛掉.后缀不收.几个} 个（{拖入筛掉.后缀不收.按后缀.map(([k, v]) => `${k}×${v}`).join('、')}，例：{拖入筛掉.后缀不收.例.join('、')}）
                  {/if}
                  {#if 拖入筛掉.纯ascii}
                    {#if 拖入筛掉.后缀不收}；{/if}后缀在表里但整篇都是 ASCII {拖入筛掉.纯ascii.几个} 个（{拖入筛掉.纯ascii.按后缀.map(([k, v]) => `${k}×${v}`).join('、')}）
                  {/if}
                  {#if 拖入筛掉.太大}；太大没读 {拖入筛掉.太大.几个} 个{/if}
                </p>
              {/if}
              <ul class="list" style="max-height:16rem">
                {#each 拖入清单.slice(0, 40) as h (h.path)}
                  <li>
                    <span class="mono nowrap">{h.rel || h.path.split(/[\\/]/).pop()}</span>
                    {#if h.likely}<span class="chip chip--g">像乱码</span>{:else}<span class="mini mut">没检出</span>{/if}
                    <span class="list__sp"></span>
                    <button class="btn btn--ghost btn--sm" disabled={busy} onclick={() => 打开拖入的那条(h)}>打开这个</button>
                  </li>
                {/each}
              </ul>
              <div class="acts" style="margin-top:6px">
                <button class="btn btn--ghost btn--sm" onclick={() => { 拖入清单 = []; 拖入根 = ''; }}>收起这个清单</button>
                <span class="acts__sp"></span>
                <button
                  class="btn btn--ghost btn--sm"
                  title="一次处理这一整批（同一套规则）"
                  onclick={() => {
                    batchRoot = 拖入根;
                    hits = 拖入清单;
                    picked = {};
                    for (const h of 拖入清单) picked[h.path] = h.likely;
                    results = [];
                    doneCount = 0;
                    void goto('/tools/glitch?panel=batch');
                  }}>去「文件」分区批量跑这一批</button>
              </div>
            </div>
          </details>
        {/if}

        {#if 文件路}
          <p class="mini" style="margin-top:6px">
            读的是 <span class="mono">{文件路}</span>
            {#if 模式 === 'fx-comments'}· <b>.fx 只动注释，代码一个字符不碰</b>{/if}
            {#if 文件结果}· 认出的编码 <span class="mono">{文件结果.编码}</span>{/if}
          </p>
        {/if}
        <!--
          整段进出（用户 2026-09-24）：左边是粘进来的乱码，右边就是**还原后的整段**。
          以前这一块只有一个输入框，还原完屏幕上什么都不变 —— 结果只躺在「复制日文」
          那颗按钮后面；旁边还摆着"这几段没自动改"（每条都列增益/门槛/假名上升和三个候选）
          和"自动改的 N 段"。用户的原话是"别只会细说把什么还原成什么"。
          那些逐段的账不再画在界面上：算出来的整段就在右边。
        -->
        <div class="pair">
          <div class="pair__h">粘进来的乱码</div>
          <div class="pair__h">
            还原后的日文
            {#if 认出的编码}<span class="mini mut">· {认出的编码}</span>{/if}
          </div>
          <textarea
            class="ta"
            bind:value={input}
            oninput={() => { result = null; 清文件(); }}
            placeholder="僐儞僩儘乕儔乕"
            spellcheck="false"
            aria-label="乱码输入"
          ></textarea>
          <pre class="pair__out" aria-label="还原结果">{还原过 ? 日文 : '（把乱码粘到左边，点「还原」）'}</pre>
        </div>
        <div class="acts" style="margin-top:10px">
          <button class="btn btn--primary" disabled={(!input.trim() && !文件路) || busy || !isTauri()} onclick={run}>
            <Icon name="ui.run" size={15} />{busy ? '算中…' : '还原'}
          </button>
          <button class="btn btn--ghost" disabled={!还原过} onclick={copyOut}>
            <Icon name="ui.copy" size={15} />复制结果
          </button>
          <span class="mini mut">
            {#if !还原过}
              粘进去或选个文件，点「还原」就是整段的结果。
            {:else if 改了吗}
              认出来了 —— 右边就是整段，直接复制走。
            {:else}
              没认出乱码，原样返回（编码那一档换个试试）。
            {/if}
          </span>
        </div>
      </div>

      <!--
        拿不准的段**只报一个数**（用户 2026-09-24：别再逐条细说、别再摆候选）。
        以前这里是一张表：每段列出增益/门槛/假名上升 + 三个候选 + 「就用这个」按钮。
      -->
      {#if 待挑.length}
        <p class="mini" style="margin:0 0 10px">
          有 {待挑.length} 段拿不准（看着像乱码，但没到自动改的程度），右边那一段里它们还是原样。
          想动手的话去「文件」栏按整个目录跑，或者把编码那一档改成具体的日文编码再试一次。
        </p>
      {/if}

      <!-- 第二步：可选。默认关，打开才发请求 -->
      <div class="card pad">
        <div class="row">
          <span class="row__k">第二步：再翻成中文</span>
          <label class="chk">
            <input type="checkbox" checked={开翻译} onchange={(e) => 切换翻译(e.currentTarget.checked)} />
            <span class="chk__box"></span>打开
          </label>
        </div>
        {#if 开翻译}
          <p class="mini" style="margin-top:6px">
            引擎：<span class="mono">{引擎标签(prefs.engine)}</span>
            {#if !引擎填了(prefs.engine)}
              —— <b>还没配</b>。右下角「外观」面板最下面能填。
            {/if}
            　窗口：{Math.round(prefs.engine.timeoutMs / 1000)}s
          </p>
          <div class="acts" style="margin-top:10px">
            <button class="btn btn--primary" disabled={译中 || !日文.trim() || !引擎填了(prefs.engine)}
              onclick={翻译}>
              <Icon name="ui.text" size={15} />{译中 ? '翻着呢…' : `翻 ${段s.length || '?'} 段`}
            </button>
            <button class="btn btn--ghost" disabled={译中 || !日文.trim()} onclick={切段}>
              <Icon name="ui.refresh" size={15} />重切段落
            </button>
            <span class="mini mut">只发注释那几段，代码不发</span>
          </div>
          {#if 译错}
            <div style="margin-top:10px"><Note kind="warn" onclose={() => (译错 = null)} 自动关={提示自动关毫秒}>{译错}</Note></div>
          {/if}
        {:else}
          <p class="mini" style="margin-top:6px">
            关着的时候<b>一次请求都不发</b>。还原那一步永远不联网。
          </p>
        {/if}
      </div>

      {#if 开翻译 && 段s.length}
        <div class="card pad">
          <div class="row" style="margin-bottom:8px">
            <span class="row__k">三栏对照</span>
            <span class="row__v">{段s.length} 段{段s.length > 段落上限 ? `（只列前 ${段落上限}）` : ''}</span>
          </div>
          <div class="tri">
            <span class="tri__h">原文（乱码）</span>
            <span class="tri__h">日文</span>
            <span class="tri__h">中文（可以直接改）</span>
            {#each 显示的段 as d, i (i)}
              <pre class="tri__p">{d.原}</pre>
              <pre class="tri__p">{d.日}</pre>
              <textarea class="tri__t" bind:value={d.译} spellcheck="false"
                aria-label="第 {i + 1} 段的中文"></textarea>
            {/each}
          </div>
          <p class="mini" style="margin-top:8px">
            模型翻歪的地方直接在右边那栏改；写回时用的是这一栏里的字。
          </p>
        </div>

        <div class="card pad">
          <div class="row">
            <span class="row__k">写回</span>
            <div class="pick">
              <button class="pick__b" type="button" aria-pressed={落盘模式 === 'saveas'}
                onclick={() => (落盘模式 = 'saveas')}>另存</button>
              <button class="pick__b" type="button" aria-pressed={落盘模式 === 'inplace'}
                onclick={() => (落盘模式 = 'inplace')}>原地写回</button>
            </div>
          </div>
          {#if 落盘模式 === 'saveas'}
            <div class="row" style="margin-top:8px">
              <span class="row__k">后缀</span>
              <input type="text" bind:value={后缀} aria-label="另存后缀" style="width:8rem" />
              <span class="mini mut">写在原名后面</span>
            </div>
          {/if}
          <p class="mini" style="margin-top:8px">
            {#if 文件路}
              → <span class="mono">{落盘目标}</span>
            {:else}
              粘贴进来的内容没有落点，先选一个文件。
            {/if}
          </p>
          <div class="acts" style="margin-top:10px">
            <button class="btn btn--primary" disabled={落盘忙 || !可写回} onclick={写回}>
              <Icon name="ui.export" size={15} />{落盘忙 ? '写着…' : '写盘'}
            </button>
            {#if 落盘模式 === 'inplace'}
              <span class="mini mut">覆盖前自动留 .bak</span>
            {/if}
          </div>
          {#if 落盘话}
            <div style="margin-top:10px">
              <Note kind={落盘话.kind} onclose={() => (落盘话 = null)} 自动关={提示自动关毫秒}>{落盘话.text}</Note>
            </div>
          {/if}
          <p class="mini" style="margin-top:8px">
            只替换注释正文，<b>代码行一个字符都不动</b>；翻了中文就按 UTF-8 存
            —— 原来的日文编码装不下中文。
          </p>
        </div>
      {/if}

      {#if tr}
        <div class="card pad">
          <div class="row" style="margin-bottom:8px">
            <span class="row__k">离线：术语替换的结果</span>
            <span class="row__v">词条覆盖 {Math.round(tr.coverage * 100)}%</span>
          </div>
          <pre class="out">{tr.text}</pre>

          <div class="notewrap">
            <Note kind="info">
              <b>离线：术语替换，不是翻译，句子不会翻。</b>
              它只把固定说法换成中文，语法结构一个字没动 —— 没被词表盖住的日文原样留着，下面列出来了。
              这条路<b>不联网</b>，所以拿它当翻译用会失望；要真译文就把上面那个开关打开。
            </Note>
          </div>

          {#if tr.hits.length}
            <h4 class="sub">命中的词条</h4>
            <ul class="list">
              <!-- 键用下标：同一个日文词条在词表里出现两次是可能的，`(h.jp)` 会撞。 -->
              {#each tr.hits.slice(0, 30) as h, hi (hi)}
                <li>
                  <span class="mono">{h.jp}</span>
                  <Icon name="ui.arrowRight" size={11} />
                  <b>{h.cn || '（省略）'}</b>
                  {#if h.count > 1}<span class="list__sp">×{h.count}</span>{/if}
                </li>
              {/each}
            </ul>
          {/if}

          {#if tr.uncovered.length}
            <h4 class="sub">没盖住的（点一下加进词表）</h4>
            <div class="acts">
              {#each tr.uncovered as u (u)}
                <button class="btn btn--ghost btn--sm" type="button" onclick={() => addTerm(u)}>
                  ＋ {u}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      {#if result && result.changed}
        <div class="card pad">
          <div class="row" style="margin-bottom:8px">
            <span class="row__k">算过的几条路</span>
          </div>
          <ul class="list">
            {#each result.attempts as a (a.via)}
              <li>
                <span class="mono">{a.via}</span>
                <span class="list__sp">分 {a.score.toFixed(2)}</span>
              </li>
              <li><span class="mini">{a.text.slice(0, 80)}</span></li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>

    <aside class="card wb__side">
      <div class="grp">
        <h3 class="grp__t">认不出的对照一下</h3>
        <ul class="list">
          {#each KNOWN as k (k.bad)}
            <li>
              <button class="link" type="button" onclick={() => useExample(k.bad)}>{k.bad}</button>
              <Icon name="ui.arrowRight" size={11} />
              <b>{k.good}</b>
              <span class="list__sp">{k.note}</span>
            </li>
          {/each}
        </ul>
      </div>
      <div class="grp">
        <h3 class="grp__t">怎么判断</h3>
        <ul class="mini ul">
          <li>乱码里的字都长得很"方"，笔画挤在一起 —— 那是日文假名的字节被 GBK 拆开读了。</li>
          <li>出现 <span class="mono">锟斤拷</span> 说明中间已经被转坏一次，救不回来。</li>
          <li>原文含中文的话，还原可能不彻底 —— 这条路认得没那么准，界面会显示"没认出"。</li>
        </ul>
      </div>

      <div class="grp">
        <h3 class="grp__t">离线那一条（术语表）</h3>
        <div class="row">
          <span class="row__k">内置 {BUILTIN.length} 条，你自己加的 {userTerms.length} 条</span>
          <button class="btn btn--ghost btn--sm" type="button" onclick={() => (showGlossary = !showGlossary)}>
            {showGlossary ? '收起' : '看/改'}
          </button>
        </div>
        <p class="mini" style="margin-top:8px">
          <b>离线：术语替换，不是翻译，句子不会翻。</b>
          只把固定说法换成中文，不联网、不花钱。要真译文用上面那个开关（那一步才需要引擎）。
        </p>
        <button class="btn btn--ghost btn--sm" type="button" style="margin-top:8px"
          disabled={!日文.trim()} onclick={translateNow}>
          <Icon name="ui.text" size={13} />离线替换一下
        </button>
      </div>

      {#if showGlossary}
        <div class="grp">
          <h3 class="grp__t">加一条</h3>
          <div class="row">
            <input type="text" bind:value={newJp} placeholder="日文" aria-label="日文词" />
          </div>
          <div class="row" style="margin-top:6px">
            <input type="text" bind:value={newCn} placeholder="中文（留空＝删掉不翻）" aria-label="中文词" />
          </div>
          <button class="btn btn--primary btn--sm" type="button" style="margin-top:8px" onclick={commitNewTerm}>
            加进去
          </button>
        </div>

        {#if userTerms.length}
          <div class="grp">
            <h3 class="grp__t">你加的</h3>
            <ul class="list">
              <!-- 键用下标：用户自己加的词表里同一个日文可以有两条不同译法，`(e.jp)` 会撞。 -->
              {#each userTerms as e, ei (ei)}
                <li>
                  <span class="mono">{e.jp}</span>
                  <Icon name="ui.arrowRight" size={11} />
                  <b>{e.cn || '（省略）'}</b>
                  <button class="link list__sp" type="button" onclick={() => dropTerm(e.jp)}>删</button>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        <div class="grp">
          <h3 class="grp__t">查词表</h3>
          <input type="text" bind:value={gFilter} placeholder="搜日文或中文" aria-label="搜词表" />
          <ul class="list" style="margin-top:8px; max-height:18rem">
            <!-- 键用下标：`e.jp + e.cn` 在合并过用户词表之后可能重复，重复键会让带键 each 整个抛 -->
            {#each tableRows as e, ei (ei)}
              <li>
                <span class="mini">{groupOf(e.jp)}</span>
                <span class="mono">{e.jp}</span>
                <b>{e.cn || '（省略）'}</b>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </aside>
  </div>
{:else if panelId === 'batch'}
  <div class="wb">
    <div class="wb__main" bind:this={落点}>
      <!-- 编码那一档的属主在「文本」栏（同一样东西只有一个属主），这里只报读数 ——
           不然用户在这一页跑完发现结果不对，却不知道要去哪儿改。 -->
      <!-- 编码那一排**在这一栏也能选**（用户 2026-09-24："名称，文本，文件，注释可选"）；
           四栏共用同一个选择，在哪儿选都在哪儿生效、切栏也不丢。 -->
      <div class="card pad">{@render 编码条()}</div>
      <div class="card pad">
        <div class="acts">
          <button class="btn" disabled={batchBusy || !isTauri()} onclick={pickBatch}>
            <Icon name="ui.folder" size={15} />选目录
          </button>
          {#if batchRoot}
            <span class="mini mono">{batchRoot}</span>
          {/if}
          {#if hits.length}
            <span class="mini">扫了 {hits.length} 个文本文件，{likelyCount} 个像乱码</span>
          {/if}
          {#if 批量筛掉}
            <!-- 没进清单的那些：**按后端真正的筛法分桶**说，别把"在表里但全是 ASCII"
                 也算成"后缀不收"（`.fx`/`.x` 明明在表里，那样就是界面在说假话）。 -->
            <span class="mini mut">
              另有没进清单的：
              {#if 批量筛掉.后缀不收}
                后缀不在表里 {批量筛掉.后缀不收.几个} 个（{批量筛掉.后缀不收.按后缀.map(([k, v]) => `${k}×${v}`).join('、')}）
              {/if}
              {#if !到上限了}
                {#if 批量筛掉.后缀不收 && 批量筛掉.纯ascii}；{/if}
                {#if 批量筛掉.纯ascii}
                  后缀在表里但整篇都是 ASCII {批量筛掉.纯ascii.几个} 个（{批量筛掉.纯ascii.按后缀.map(([k, v]) => `${k}×${v}`).join('、')}）—— ASCII 里没有乱码可还原
                {/if}
                {#if 批量筛掉.太大}；太大没读 {批量筛掉.太大.几个} 个{/if}
              {:else}
                ；<b>扫到 500 条就停了</b>（后端上限），剩下的没数
              {/if}
              —— 共 {批量筛掉.共几个} 个文件
            </span>
          {/if}
          {#if 批量名数}
            <!-- 名字跟正文一起做掉（用户 2026-09-24 要的"按需还原"）。
                 只列"判据自己有把握的"条数；没把握的不在这儿露面。 -->
            <label class="chk" title="目录名和文件名里的乱码，跟正文一趟改掉">
              <input type="checkbox" bind:checked={批量也改名} />
              <span class="chk__box"></span>名字也一起还原（{批量名数} 个）
            </label>
          {/if}
        </div>
      </div>

      {#if hits.length}
        <div class="card pad">
          <div class="row" style="margin-bottom:8px">
            <span class="row__k">勾上要处理的（默认只勾了像乱码的）</span>
            <span class="row__v">已勾 {pickedCount} / {hits.length}</span>
          </div>
          <ul class="list" style="max-height:26rem">
            {#each hits as h (h.path)}
              <li>
                <label class="chk">
                  <input type="checkbox" bind:checked={picked[h.path]} />
                  <span class="chk__box"></span>
                </label>
                <b>{h.rel}</b>
                {#if h.likely}
                  <i class="tag tag--ok">像乱码</i>
                {:else}
                  <span class="mini">没检出</span>
                {/if}
                {#if h.uncertain.length}
                  <i class="tag tag--soon">{h.uncertain.length} 段没自动改</i>
                {/if}
              </li>
              {#if h.sample_before}
                <li class="samp">
                  <span class="mini">{h.sample_before}</span>
                </li>
                {#if h.likely}
                  <li class="samp">
                    <span class="mini mono">{h.sample_after}</span>
                  </li>
                {/if}
              {/if}
              <!--
                看着像乱码、但没自动改的段：批量不敢替用户动它们（安全网不许拆），
                但要摆出来给人挑 —— 以前这些是静悄悄跳过的，用户只看到"没检出"。
              -->
              {#if h.uncertain.length}
                <!-- 每份文件最多列 5 段，剩下的只报个数：语料里那几份"改名对照/过目报告"
                     一类文件里这类段能上千，全列出来就成了用户说的"只会细说"。
                     键**用下标**：`h.path + s.run` 会重复 —— 同一个乱码名字在一份报告里
                     出现两次太正常了，键一重复 Svelte 的带键 each 整个抛掉，
                     这张清单连同后面的结果卡一起不渲染（2026-09-24 量的）。 -->
                {#each h.uncertain.slice(0, 5) as s, si (h.path + '#' + si)}
                  <li class="samp" style="display:block">
                    <span class="mini">
                      <span class="mono">{s.run}</span> —— 看着像乱码但没自动改
                      <button class="linkbtn" type="button"
                        onclick={() => 去文本页挑(s.run)}>拿这段去「文本」栏试</button>
                    </span>
                  </li>
                {/each}
                {#if h.uncertain.length > 5}
                  <li class="samp" style="display:block">
                    <span class="mini mut">
                      另外还有 {h.uncertain.length - 5} 段也是这个样子（不一条条列了；要挑就把这一段
                      拿去「文本」栏，或者把编码那一档改成具体的日文编码再跑一遍）。
                    </span>
                  </li>
                {/if}
              {/if}
            {/each}
          </ul>
        </div>

        {#if results.length}
          <div class="card pad">
            <h3 class="h3">跑完 {doneCount} / {pickedCount}{#if dryRun}<span class="tag">试跑，没写盘</span>{/if}</h3>
            <!-- 名字那一趟在这栏里改过名，就得在这栏里退得回来 ——
                 回滚按钮原来只长在「名称」栏上，在这一栏改完名根本找不着退路
                 （2026-09-24 做真写盘验收时量出来的）。 -->
            {#if 名日志.length && !dryRun}
              <div class="acts" style="margin-bottom:8px">
                <button class="btn btn--ghost btn--sm" disabled={batchBusy} onclick={回滚批量名}>
                  <Icon name="ui.undo" size={13} />回滚改名（{名日志.length}）
                </button>
                <span class="mini mut">把这一趟改掉的名字逐个退回原名</span>
              </div>
            {/if}
            <ul class="list">
              <!--
                **别拿 `r.rel` 当键**：这一列里装的既有正文条目（rel 是相对路径，唯一），
                也有我这趟加进来的改名条目（rel 是**文件名**）—— 而两处 `夵曄尦readme`、
                各处都有的 `readme.txt` 这种同名文件一抓一把，键一重复 Svelte 的带键 each
                **直接抛**，整张结果卡一个字都不画。
                现象极其难查：盘上明明改对了，界面上却是"跑完 0 条"、回滚按钮也不出来
                （2026-09-24 做真写盘验收时量出来的）。
                这个列表只往后追加、不重排，所以用下标当键最稳。
              -->
              {#each results as r, i (i)}
                <li class:bad={!r.ok}>
                  <b>{r.rel}</b>
                  <span class="list__sp">{r.msg}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      {:else if !batchBusy}
        <Note>
          选一个目录，会把里面的文本文件扫一遍，把像乱码的挑出来先给你看。
          <b>默认只试跑不写盘</b>，确认了对得上再关掉试跑。
        </Note>
      {/if}

      <!-- 主操作条（规范 §16.3 / 设计准则 §一、§四）：这一页**唯一**的主按钮在这儿，
           原来它画在参数抽屉里 —— 抽屉默认收起，新手扫完目录**找不到"跑"那一下**。 -->
      <div class="wb__acts">
        <span class="mini mut">
          {#if !hits.length}
            先选一个目录。
          {:else}
            已勾 {pickedCount} / {hits.length}
          {/if}
        </span>
        <!--
          **试跑 / 真跑的选择必须摆在主按钮旁边**（用户 2026-09-25："文本的文件处理
          只有试跑没有真正处理选择"）。那颗开关原来画在参数抽屉里，而抽屉**默认收起** ——
          页面上只看得到一颗写着「试跑」的按钮，压根没地方选真跑。
          规范里"主按钮不许画在抽屉里"那条，开关这一层也得照办：
          要用户拍板的东西，得跟那个动作长在一起。
        -->
        <div class="pick" style="margin:0 10px 0 auto">
          <button class="pick__b" type="button" aria-pressed={dryRun} onclick={() => (dryRun = true)}>
            先试跑
          </button>
          <button class="pick__b" type="button" aria-pressed={!dryRun} onclick={() => (dryRun = false)}>
            真跑（写盘）
          </button>
        </div>
        <button
          class="btn btn--primary"
          disabled={!pickedCount || batchBusy || !outReady}
          onclick={runBatch}
        >
          <Icon name="ui.run" size={15} />{batchBusy
            ? `跑中 ${doneCount}/${pickedCount}`
            : dryRun
              ? '试跑'
              : outMode === 'inplace'
                ? '开跑（原地改）'
                : '开跑（另存）'}
        </button>
      </div>
    </div>

    <aside class="card wb__side">
      <div class="grp">
        <h3 class="grp__t">扫哪些后缀</h3>
        <p class="mini mono">{TEXT_EXTS.join(' · ')}</p>
        <p class="mini" style="margin-top:6px">纯 ASCII 的文件直接跳过，乱码必然带非 ASCII。</p>
        <label class="chk" style="margin-top:8px" title="开了就把这个目录里实际出现的后缀全扫一遍">
          <input type="checkbox" bind:checked={也收表外的} />
          <span class="chk__box"></span>连不在表里的后缀也扫
        </label>
        <p class="mini" style="margin-top:6px">
          {#if 也收表外的}
            现在是"这个目录里有什么后缀就扫什么"。<b>二进制文件（png / dds / pmx 那些）也会被扫进来</b>，
            而且它们<b>也会</b>被判成"像乱码"（实测 3357 个真二进制里 376 个是）——
            所以这些<b>默认不勾</b>，要动哪个得你自己勾。本工具自己留的备份（`.bak`）一律不扫。
          {:else}
            上面这些之外的（png / dds / pmx…）<b>不扫</b>，扫完会告诉你筛掉了几个、都是什么后缀。
          {/if}
        </p>
      </div>
      <div class="grp">
        <!-- 这个选择**没有第二个属主**：开关在主区最下面那条上、跟主按钮挨着
             （原来那颗复选框在这儿，抽屉一收起页面上就只剩「试跑」，没法选真跑）。 -->
        <p class="mini">
          现在是 <b>{dryRun ? '先试跑（不写盘）' : '真跑（会写盘）'}</b> ——
          试跑 / 真跑在主区最下面那条上，跟主按钮挨着。
        </p>
        <p class="mini" style="margin-top:6px">真跑时原地改会在同目录留一份 <span class="mono">.bak</span>。</p>
      </div>

      <div class="grp">
        <h3 class="grp__t">写到哪</h3>
        <div class="pick">
          <button class="pick__b" type="button" aria-pressed={outMode === 'inplace'} onclick={() => (outMode = 'inplace')}>
            原地改
          </button>
          <button class="pick__b" type="button" aria-pressed={outMode === 'dir'} onclick={() => (outMode = 'dir')}>
            另存目录
          </button>
        </div>

        {#if outMode === 'inplace'}
          <p class="mini" style="margin-top:8px">
            改的就是原文件，改之前在同目录留一份 <span class="mono">.bak</span>（已存在就顺成 .bak2、.bak3）。
            认不出乱码的文件一个字节都不动。
          </p>
        {:else}
          <div class="row" style="margin-top:10px">
            <span class="row__k">目录</span>
            <div class="grow">
              <button class="btn btn--ghost btn--sm" type="button" onclick={pickOutDir}>
                <Icon name="ui.folder" size={14} />{outDir ? '换一个' : '选目录'}
              </button>
            </div>
          </div>
          {#if outDir}
            <p class="mini mono path" title={outDir}>{outDir}</p>
          {/if}

          <div class="row" style="margin-top:10px">
            <span class="row__k">文件名</span>
            <div class="grow">
              <input class="inp mono" type="text" bind:value={tpl} spellcheck="false" />
            </div>
          </div>
          <p class="mini" style="margin-top:6px">{TEMPLATE_HINT}</p>

          <label class="chk" style="margin-top:8px">
            <input type="checkbox" bind:checked={keepTree} />
            <span class="chk__box"></span>保留子目录结构
          </label>
          <p class="mini" style="margin-top:6px">
            关掉就全平铺到输出目录根下 —— 不同子目录里的同名文件会互相覆盖，除非模板里带上
            <span class="mono">{'{rel}'}</span> 或 <span class="mono">{'{dir}'}</span>。
          </p>

          {#if outPreview.length}
            <ul class="pvp">
              {#each outPreview as p (p.from)}
                <li><span class="mono">{p.from}</span><Icon name="ui.arrowRight" size={12} /><span class="mono">{p.to}</span></li>
              {/each}
            </ul>
          {/if}
        {/if}
      </div>

      <div class="grp">
        <button
          class="btn btn--ghost"
          disabled={!pickedCount || batchBusy || !outReady}
          onclick={runBatch}
        >
          <Icon name="ui.run" size={15} />{batchBusy
            ? `跑中 ${doneCount}/${pickedCount}`
            : dryRun
              ? '试跑'
              : outMode === 'inplace'
                ? '开跑（原地改）'
                : '开跑（另存）'}
        </button>
        <p class="mini" style="margin-top:6px">主按钮在主区最下面那条上（这里只是同一个动作的另一颗，收抽屉时也够得着）。</p>
      </div>
    </aside>
  </div>
{:else if panelId === 'names'}
  <!-- 名字还原：正文是好的、乱的是名字时用这一页 -->
  <div class="wb">
    <div class="wb__main" bind:this={落点}>
      <!-- 编码那一排**在这一栏也能选**（用户 2026-09-24："名称，文本，文件，注释可选"）；
           四栏共用同一个选择，在哪儿选都在哪儿生效、切栏也不丢。 -->
      <div class="card pad">{@render 编码条()}</div>
      <div class="card pad">
        <div class="acts">
          <button class="btn btn--primary" disabled={名忙 || !isTauri()} onclick={选名目录}>
            <Icon name="ui.folder" size={15} />选目录
          </button>
          {#if 名根}
            <button class="btn btn--ghost" disabled={名忙} onclick={扫名字}>
              <Icon name="ui.refresh" size={15} />重扫
            </button>
            <span class="mini mono nowrap" title={名根}>{名根}</span>
          {/if}
        </div>
        <p class="mini" style="margin-top:10px">
          扫的是<b>名字</b>（文件名和目录名），不是文件内容 —— 语料里常见的就是正文好好的、
          名字被读坏（<span class="mono">00_僔僃乕僟乕傪嵞攝晍偡傞偲偒偺拲堄揰.txt</span>）。
          <b>改名不覆盖同名</b>：目标已经存在就跳过并说明；改完可以整批回滚。
          <br />默认只勾"自动判据认了的"那些 —— 没把握的（比如你自己起的中文名）也会列出来，
          但要不要改得你一条条看。
        </p>
      </div>

      {#if 名命中.length}
        <div class="card pad">
          <div class="acts" style="margin-bottom:10px">
            <h3 class="h3" style="margin:0">原名 → 修后名</h3>
            <span class="tag">{名命中.length} 个</span>
            <span class="acts__sp"></span>
            <button class="btn btn--ghost btn--sm" onclick={() => {
              // 只勾"自动判据认了的" —— 没把握的那些要人一条条看。
              // 语料里真踩过：`乱码翻译`（用户自己的中文目录名）也能凑出一个候选
              // （`岱鷹鍬咎`，增益 0），全选把它勾上就等于把好名字改成乱码。
              const m: Record<string, boolean> = {};
              for (const h of 名命中) m[h.path] = h.自动可改;
              名勾 = m;
            }}>只勾有把握的</button>
            <button class="btn btn--ghost btn--sm" onclick={() => {
              const m: Record<string, boolean> = {};
              for (const h of 名命中) m[h.path] = true;
              名勾 = m;
            }}>连没把握的也勾上</button>
            <button class="btn btn--ghost btn--sm" onclick={() => (名勾 = {})}>全不选</button>
          </div>

          <ul class="list">
            {#each 名命中 as h (h.path)}
              <li style="display:block">
                <label class="chk" style="display:flex; align-items:center; gap:8px">
                  <input type="checkbox" checked={!!名勾[h.path]}
                    onchange={(e) => (名勾 = { ...名勾, [h.path]: e.currentTarget.checked })} />
                  <span class="chk__box"></span>
                  <span class="mono">{h.原名}</span>
                  <span class="mut">→</span>
                  <span class="mono" class:good={名要[h.path] !== h.原名}>
                    {名要[h.path] ?? h.修后名}
                  </span>
                  {#if h.自动可改}
                    <span class="chip chip--g">自动</span>
                  {:else}
                    <span class="chip chip--r">要你认</span>
                  {/if}
                </label>
                {#if !h.自动可改}
                  <p class="mini" style="margin:4px 0 4px 28px">{h.原因}</p>
                  <div class="acts" style="margin-left:28px">
                    {#each h.候选.slice(0, 3) as c, ci (ci)}
                      <button class="btn btn--ghost btn--sm" type="button" disabled={名忙}
                        onclick={() => 名字用候选(h, c.text)}>
                        就用这个：<span class="mono">{c.text}</span>
                      </button>
                    {/each}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {:else if 名根}
        <div class="card pad"><p class="mini">这个名字都看不出来是乱码。换个目录，或者去「文本」页粘一段。</p></div>
      {/if}
    </div>

    <aside class="card wb__side">
      <div class="grp">
        <h3 class="grp__t">改名</h3>
        <div class="row">
          <span class="row__k">勾了</span>
          <span class="row__v">{名勾数} / {名命中.length}</span>
        </div>
        <div class="acts" style="margin-top:8px">
          <button class="btn btn--primary btn--sm" disabled={名忙 || !名勾数} onclick={改名}>
            <Icon name="ui.run" size={13} />改名
          </button>
          {#if 名日志.length}
            <button class="btn btn--ghost btn--sm" disabled={名忙} onclick={回滚名字}>
              <Icon name="ui.undo" size={13} />回滚上一次（{名日志.length}）
            </button>
          {/if}
        </div>
        <p class="mini" style="margin-top:8px">
          改名日志就在内存里（上面那个「回滚」用的就是它）—— 关掉这一页就没了。
        </p>
      </div>

      {#if 名话}
        <div class="grp"><Note kind={名话.kind} onclose={() => (名话 = null)} 自动关={提示自动关毫秒}>{名话.text}</Note></div>
      {/if}

      <div class="grp">
        <Note kind="info">
          只改名字，<b>不碰文件内容</b>。名字里的乱码和正文里的乱码成因一样：
          日文按 Shift-JIS 存的名字被当成 GBK 读出来了。
          <br />判据跟正文那条完全同一套（同一个还原函数），门槛也是同一档。
        </Note>
      </div>
    </aside>
  </div>
{:else}
  <div class="wb">
    <div class="wb__main" bind:this={落点}>
      <!-- 编码那一排**在这一栏也能选**（用户 2026-09-24："名称，文本，文件，注释可选"）；
           四栏共用同一个选择，在哪儿选都在哪儿生效、切栏也不丢。 -->
      <div class="card pad">{@render 编码条()}</div>
      <div class="card pad">
        <div class="acts">
          <!-- 一页**只有一个主按钮**（规范 §16.3），主按钮是下面那条里的「开跑」——
               这颗"选目录"跟「文件」栏那颗一样，是普通按钮。原来它是 `btn--primary`，
               而当时开跑画在**默认收起的抽屉**里，体检数不到，所以一直没露头；
               把开跑挪到主区之后两个一起可见，体检当场报 `primary=2`。 -->
          <button class="btn" disabled={fxBusy || !isTauri()} onclick={pickFxFiles}>
            <Icon name="ui.folder" size={15} />选 Ray / MME 目录
          </button>
          {#if fxScreens.length}
            <span class="mini">
              目录里共 {fxFound} 个 .fx / .fxsub{#if fxFound > fxScanned}，这一轮扫了前 {fxScanned} 个{/if}
            </span>
          {/if}
        </div>
        {#if fxFound > fxScanned}
          <div class="notewrap">
            <Note kind="warn">
              目录里有 {fxFound} 个 .fx / .fxsub，一次只扫前 {FX_SCAN_LIMIT} 个（扫太多会卡很久）。
              还剩 {fxFound - fxScanned} 个这次<b>没碰</b>。要处理全部就分目录来，或者先把这个上限调大。
            </Note>
          </div>
        {/if}
        <div class="notewrap">
          <Note kind="warn">
            <b>这个模式只改注释</b>（<span class="mono">//</span> 和 <span class="mono">/* */</span> 里的内容），
            代码一个字符都不碰。.fx 是要直接编译的，整文件改编码有可能把宏名或路径上的
            非 ASCII 弄坏，那改完就跑不起来了。
          </Note>
        </div>
      </div>

      {#if fxScreens.length}
        <div class="card pad">
          <div class="row" style="margin-bottom:8px">
            <span class="row__k">勾上要处理的（默认只勾了检出乱码的）</span>
            <span class="row__v">已勾 {fxPickedCount} / {fxScreens.length}</span>
          </div>
          <ul class="list" style="max-height:26rem">
            {#each fxScreens as s (s.ref.path)}
              <li>
                <label class="chk">
                  <input type="checkbox" bind:checked={fxPicked[s.ref.path]} />
                  <span class="chk__box"></span>
                </label>
                <b>{s.ref.name}</b>
                {#if s.error}
                  <span class="list__sp bad">{s.error}</span>
                {:else if s.changed}
                  <i class="tag tag--ok">注释有乱码</i>
                  <span class="list__sp mono">{s.encoding}</span>
                {:else}
                  <span class="list__sp">{s.encoding} · 没检出</span>
                {/if}
              </li>
              {#if s.beforeSample}
                <li class="samp"><span class="mini">{s.beforeSample}</span></li>
                <li class="samp"><span class="mini mono">{s.afterSample}</span></li>
              {/if}
            {/each}
          </ul>
        </div>
      {/if}

      {#if fxResults.length}
        <div class="card pad">
          <h3 class="h3">结果</h3>
          <ul class="list">
            <!--
              键**用下标**：`r.rel` 在这里是**文件名**（`fxResults` 存的是 `s.ref.name`），
              而渲染包里同名 `.fx` 到处都是 —— 工程自己的语料里 `BlackMask.fx` 就在 3 个不同目录。
              两个同名一进来，Svelte 的带键 each 直接抛 `each_key_duplicate`，
              **整张结果卡不渲染**（跟「文件」栏那处同一个病，2026-09-25 全库扫出来的）。
            -->
            {#each fxResults as r, ri (ri)}
              <li class:bad={!r.ok}>
                <b>{r.rel}</b>
                <span class="list__sp">{r.msg}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <!-- 主操作条：**试跑 / 真跑 + 主按钮都在这儿**（跟「文件」栏同一条规矩：
           要用户拍板的选择得跟动作长在一起，不能藏在默认收起的参数抽屉里）。
           **必须画在 `.wb__main` 里面** —— 放进 `.wb` 那个栅格会占掉一列、
           把参数抽屉挤到下一行（⑥ 那条底栏的笔记里记着）。 -->
      <div class="wb__acts">
        <span class="mini mut">
          {#if !fxScreens.length}
            先选一个 Ray / MME 目录。
          {:else}
            扫了 {fxScanned} 个 .fx / .fxsub，{fxPickedCount} 个勾上了
          {/if}
        </span>
        <div class="pick" style="margin:0 10px 0 auto">
          <button class="pick__b" type="button" aria-pressed={fxDry} onclick={() => (fxDry = true)}>
            先试跑
          </button>
          <button class="pick__b" type="button" aria-pressed={!fxDry} onclick={() => (fxDry = false)}>
            真跑（写盘）
          </button>
        </div>
        <button class="btn btn--primary" disabled={!fxScreens.length || fxBusy} onclick={runFx}>
          <Icon name="ui.run" size={15} />{fxBusy ? '跑中…' : fxDry ? '试跑' : '开跑'}
        </button>
      </div>
    </div>

    <aside class="card wb__side">
      <div class="grp">
        <h3 class="grp__t">几条边界</h3>
        <ul class="mini ul">
          <li>注释修坏顶多是注释难看；整文件改编码有可能一编译就报错。所以这里分开做。</li>
          <li>写盘前在同目录留 <span class="mono">.bak</span>。</li>
          <li>文件本来就不是 UTF-8 的话，写回时按它原来的编码写，不会换成 UTF-8。</li>
        </ul>
      </div>
      <div class="grp">
        <!-- 同「文件」栏那条：这个选择也不留在抽屉里（抽屉默认收起就等于没有）。 -->
        <p class="mini">
          现在是 <b>{fxDry ? '先试跑（不写盘）' : '真跑（会写盘）'}</b> —— 在主区最下面那条上。
        </p>
      </div>
    </aside>
  </div>
{/if}

{#if err}
  <!-- 拖放/读写失败那句话。**必须带叉和时限**：`Note` 只在传了 `onclose` 时才画那颗叉、
      `自动关` 才起定时器 —— 两个都不传的话它就永久挂在页面上（2026-09-24 用户报的
      "警告框不可以消失"）。跟侧栏那条错误通道同一档 9 秒，见 `ui.svelte.ts`。 -->
  <div style="margin-top:12px"><Note kind="warn" onclose={() => (err = null)} 自动关={提示自动关毫秒}>{err}</Note></div>
{/if}

<style>
  .pad { padding: 16px; }
  .h3 { margin: 0 0 10px; font-size: var(--fs-md); }
  .sub { margin: 14px 0 8px; font-size: var(--fs-xs); color: var(--content-meta); font-weight: 600; }
  .ul { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 5px; }
  .btn--sm { padding: 4px 10px; font-size: var(--fs-2xs); }
  .grow { flex: 1; min-width: 0; }
  .path {
    margin: 6px 0 0;
    font-size: 10px;
    color: var(--content-meta);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .inp {
    width: 100%;
    padding: 5px 9px;
    border: 1px solid var(--line-divider);
    border-radius: var(--r-sm);
    background: var(--surface-2);
    font-size: var(--fs-2xs);
    color: var(--deep-text);
    font-family: var(--font-mono);
  }
  .inp:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
  /* 改前 → 改后，先让用户看一眼落点对不对再跑 */
  .pvp {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 10px;
    color: var(--content-meta);
    max-height: 7rem;
    overflow-y: auto;
  }
  .pvp li {
    display: grid;
    grid-template-columns: 1fr 14px 1fr;
    gap: 4px;
    align-items: center;
  }
  .pvp li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pvp li span:last-child { color: var(--deep-text); }

  .ta {
    width: 100%;
    min-height: 9rem;
    margin-top: 8px;
    padding: 10px 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    line-height: 1.7;
    color: var(--deep-text);
    background: var(--surface-2);
    border: 1px solid var(--line-color);
    border-radius: var(--r-lg);
    resize: vertical;
  }
  .ta:focus-visible { outline: 2px solid var(--primary); outline-offset: -1px; }

  /* 整段进出：左「粘进来的乱码」 / 右「还原后的日文」，两栏等高。
     右边那块是**只读结果**，跟左边共用一套字号行高，方便一眼对着看。 */
  .pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 4px 10px;
    align-items: start;
    margin-top: 10px;
  }
  .pair__h { font-size: var(--fs-2xs); font-weight: 700; color: var(--content-meta); }
  .pair .ta { margin-top: 0; min-height: 16rem; }
  .pair__out {
    margin: 0;
    min-height: 16rem;
    max-height: 32rem;
    overflow: auto;
    padding: 10px 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    line-height: 1.7;
    color: var(--deep-text);
    background: var(--surface-2);
    border: 1px solid var(--line-divider);
    border-radius: var(--r-lg);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  @media (max-width: 900px) {
    .pair { grid-template-columns: minmax(0, 1fr); }
  }

  /* 三栏对照：原文 / 日文 / 中文。中文那栏是 textarea，能直接改 */
  .tri {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.2fr);
    gap: 6px 8px;
    align-items: start;
    max-height: 26rem;
    overflow: auto;
  }
  .tri__h {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 4px 6px;
    background: var(--card-bg);
    font-size: var(--fs-2xs);
    font-weight: 700;
    color: var(--content-meta);
  }
  .tri__p,
  .tri__t {
    margin: 0;
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    line-height: 1.7;
    color: var(--deep-text);
    background: var(--surface-2);
    border: 1px solid var(--line-divider);
    border-radius: var(--r-sm);
    white-space: pre-wrap;
    word-break: break-all;
    min-height: 2.4rem;
  }
  .tri__t { width: 100%; resize: vertical; }
  .tri__t:focus-visible { outline: 2px solid var(--primary); outline-offset: -1px; }

  .out {
    margin: 0;
    padding: 10px 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    line-height: 1.75;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--deep-text);
    background: var(--surface-2);
    border-radius: var(--r-lg);
    max-height: 18rem;
    overflow: auto;
  }

  .link {
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    color: var(--primary-ink);
    cursor: pointer;
    font-family: var(--font-mono);
  }
  .link:hover { text-decoration: underline; }
  .list li.bad, .bad { color: var(--danger); }
  .list li.samp { padding-top: 0; background: none; }
  .list li.samp + li.samp { margin-top: -4px; }
  .notewrap { margin-top: 10px; }
</style>
