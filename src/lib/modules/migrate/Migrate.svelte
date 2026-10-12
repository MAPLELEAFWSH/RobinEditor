<script lang="ts">
  /**
   * ⑥ 工程迁移。
   *
   * 用户 2026-09-21/22 口述的口径（见 `docs\⑥工程迁移-模块行为.md`、`docs\⑥香港验收-结果.md`）：
   *   A **原地修复**：文件都在，把工程里的死路径重新定向到文件现在实际所在的位置（**默认原地改，留 .bak**）；
   *   B **检索**：文件被挪到别处时，给若干搜索起点让工具按文件名找回来（唯一命中才自动填，并列交人挑）；
   *   C **搬运**：把文件**真的搬/拷**到（可以多个）指定位置，再把工程里的路径改过去并保存；
   *   D **自包含打包** —— 用户对这个词的定义是
   *     "**打包工程所有需要的文件到指定位置，并可以正常打开使用**"（就是 C 的"全部拷到一个位置"那种用法）。
   *
   * 顺序一律是：导入 → 扫描出表 → 试算（不写盘）→ 确认 → 才写盘。
   * 不能"尽力而为"：有对象定位不到、或旧位置和新目录里都没有，就整体拒绝。
   *
   * 缺文件**只报告**：丢文件就摘条目那条用户明确不要了，界面上一处都不留。
   */
  import {
    pickFile,
    pickFolder,
    probeDir,
    scanDir,
    saveBytes,
    扫工程,
    搬家工程,
    找工程根,
    根替换工程,
    自包含工程,
    列工程路径,
    检索工程文件,
    查扫描进度,
    取消扫描,
    是范围太大,
    搬运工程,
    待撤销,
    撤销工程,
    type 工程根组,
    type 工程搬根结果,
    type 工程路径行,
    type 工程检索行,
    type 工程搬运结果,
    type 工程扫描,
    type 工程搬家结果,
    type 撤销结果
  } from '$lib/io';
  import { registerZone, unregisterZone } from '$lib/dropzones.svelte';
  import { side, 开抽屉, 切钉, 拖把手, applySide } from '$lib/side.svelte';
  import { 汇总扫描 } from './ops';
  import type { WbProps } from '$lib/modules/wb-props';
  import Note from '$lib/components/wb/Note.svelte';
  import { 提示自动关毫秒 } from '$lib/ui.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { 报当前工程 } from '$lib/recent.svelte';

  let { panelId = 'pack' }: WbProps = $props();

  /**
   * 载进来的工程可以有好几个（用户 2026-09-23 B4：**中途拖入第二个工程不许静默覆盖**）。
   *
   * `工程们[当前工程]` 是**此刻唯一的写盘对象** —— 底栏那颗主按钮、试算、撤销全走它。
   * 拖第二个进来时先弹一条内联三选（换成 / 都留住 / 取消），选"都留住"就切成两份，
   * 上面出现一个「当前处理」的切换条。
   */
  type 工程项 = { pmm: string; emm: string };
  let 工程们 = $state<工程项[]>([]);
  let 当前工程 = $state(0);
  const 当前项 = $derived(工程们[当前工程] ?? null);
  const pmm = $derived(当前项?.pmm ?? '');
  const emm = $derived(当前项?.emm ?? '');
  const 工程名 = (x: 工程项 | null) => (x?.pmm ? x.pmm.split(/[\\/]/).pop() ?? x.pmm : '（没选）');

  /* ⑨ 的"工程"是**两个文件**（.pmm / .emm），不走"选目录"那条路，所以它得自己报一下，
     名字就用 `工程名()` 同一套 —— 报给 `recent.svelte.ts` 的 `当前工程`。
     （界面上**已经没有地方显示工程名了**：顶栏那颗胶囊 2026-10-07 删的、底栏那一条
     2026-10-12 删的，这个调用留着是为了底账一致，别顺手删。）
     用户 2026-09-26 报的"打开工程了上方还显示未打开工程"里，⑨ 这条路就是这么漏的。 */
  $effect(() => {
    const p = pmm;
    if (p) 报当前工程(p, 工程名(当前项));
  });
  /** 拖进来的第二个工程挂在这儿，等用户拍板（不许自动换） */
  let 冲突 = $state<{ 哪: 'pmm' | 'emm'; path: string } | null>(null);

  let 扫 = $state<工程扫描 | null>(null);
  let 扫中 = $state(false);
  let 输出 = $state('');
  let 忙 = $state(false);
  /**
   * 写盘前的**内联确认**（有副作用的动作一律先问一句，并且写清"会动哪些文件"）。
   * 全局规矩：错误与提示走内联，不弹 native 窗。
   */
  let 写盘问 = $state(false);
  let 按目录名问 = $state(false);
  let 搬运问 = $state(false);
  let msg = $state<{ kind: 'ok' | 'warn' | 'info'; text: string } | null>(null);
  /** 表太长只显示前这么多行（几千条会卡） */
  const 显示上限 = 200;
  let 只看有问题 = $state(false);

  /**
   * 两个区各管一件事，**由分区条决定**，页内不再放"哪种情况"的切换 ——
   * 分区条已经写着「修复工程」「打包迁移」，页里再摆一次就是同一件事两个属主（规范 §三：不重复）。
   *   repair → 只改路径（文件不动，含"文件被挪走了指回来"）
   *   pack   → 打包迁移：把文件连同工程一起拷到指定位置并改好路径
   */
  const 情形 = $derived<'A' | 'C'>(panelId === 'pack' ? 'C' : 'A');

  /**
   * 修复区第一条：**你属于哪种**（用户 2026-09-23 D11）。
   *
   * 两种来路的走法不一样，界面上要说得清：
   *   · 别人打包的工程（下载来的）—— 路径写的是**别人机器上的根**，本机没有那棵树
   *     → 走「路径指向了别的位置」，给每个旧根填一个本机的新根（保相对结构）；
   *   · 本机的文件被挪了位置 —— 文件还在本机，只是不在原来那个目录
   *     → 走「找回挪走的文件」按文件名找回来，或逐条指定。
   * 默认**按扫出来的事实猜**（有死根 = 前者），用户点过就听用户的。
   */
  let 来路手选 = $state<'' | '别人包' | '本机挪走'>('');
  let 新模型目录 = $state('');
  let 新附件目录 = $state('');
  let 搬家干跑 = $state<工程搬家结果 | null>(null);
  let 搬家做完 = $state<工程搬家结果 | null>(null);
  /** 根替换（真工程用这条）：发现的旧根 + 每个旧根对应的新根 */
  let 根们 = $state<工程根组[]>([]);
  let 根结果 = $state<工程搬根结果 | null>(null);
  /**
   * 只有**本机真的缺文件**的根才需要在界面上处理。
   *
   * 实测（60 个真工程 / 163 个根）：大部分根在这台机器上是**好的**（`本机有 == 条数`），
   * 那些不该被当成"要修的东西"—— 否则用户一进来就被一堆假问题糊住。
   */
  const 要改的根 = $derived(根们.filter((g) => g.在盘条数 < g.条数));
  const 好的根数 = $derived(根们.length - 要改的根.length);
  const 有死根 = $derived(要改的根.length > 0);
  const 来路 = $derived<'别人包' | '本机挪走'>(
    来路手选 || (有死根 ? '别人包' : '本机挪走')
  );

  /**
   * 打包的两种情形（用户 2026-09-23 B6）。**界面显式选**，不替用户猜：
   *   本机 = 包内写"包内的本机绝对路径"（自己备份/换盘用，这台机器上直接能开）；
   *   配布 = 包内写"相对包根"的路径（发给别人：自包含 + 不依赖本机）。
   */
  let 打包模式 = $state<'本机' | '配布'>('本机');

  const 汇 = $derived(扫 ? 汇总扫描(扫) : null);

  /**
   * `.pmm` 与 `.emm` 是不是同一套路径。
   *
   * 为什么单拎出来：**实测踩过**（用户现场那三拨产物）—— 四份工程文件互相指着对方的领地、
   * 7 份哈希两两不同，界面上只报"命中率 50%"，用户根本看不出真正的原因是**两份不同步**。
   * 判据：同一条对象在 `.pmm` 字段里写的路径与 `.emm` 的 `[Object]` 写的不一样。
   */
  const 不同步 = $derived.by(() => {
    const s = 扫;
    if (!s) return [] as string[];
    const emm表 = new Map(s.objects.map((o) => [o.key, o.path]));
    const 出: string[] = [];
    for (const h of s.pmm_hits) {
      const e = emm表.get(h.key);
      if (e && e.toLowerCase() !== h.path.toLowerCase()) {
        出.push(`${h.key}：.pmm → ${h.path}｜.emm → ${e}`);
      }
    }
    return 出;
  });

  /** 模型 / 附件 各几条、各几个在盘上 —— 顶部一眼看到（用户要的"一眼看到几条"） */
  const 分组 = $derived.by(() => {
    const s = 扫;
    const 空 = { 模型: 0, 模型有: 0, 附件: 0, 附件有: 0 };
    if (!s) return 空;
    let 模型 = 0;
    let 模型有 = 0;
    let 附件 = 0;
    let 附件有 = 0;
    s.objects.forEach((o, i) => {
      const 在 = !!s.在盘上[i];
      if (o.kind === 'accessory') {
        附件++;
        if (在) 附件有++;
      } else {
        模型++;
        if (在) 模型有++;
      }
    });
    return { 模型, 模型有, 附件, 附件有 };
  });

  /** 模型键 → `.pmm` 里现在写的名字（参考工具那页就是"名称 + 路径"） */
  const 名称表 = $derived(new Map((扫?.pmm_hits ?? []).map((h) => [h.key, h.名称])));

  /** 改名输入框：`键 → 新名字`（只放模型；只支持等长，界面上会提示字节数） */
  let 改名 = $state<Record<string, string>>({});

  /** 字节数按 GBK 估（名字大多是 SJIS/GBK 的单双字节，界面只用来提示"要等长"） */
  function 字节数(s: string): number {
    let n = 0;
    for (const ch of s) n += ch.charCodeAt(0) < 128 ? 1 : 2;
    return n;
  }

  const 要改的名 = $derived(
    Object.entries(改名).filter(([k, v]) => {
      const 原 = 名称表.get(k) ?? '';
      return v.trim() !== '' && v !== 原;
    })
  );
  const 长度不对的名 = $derived(
    要改的名.filter(([k, v]) => 字节数(v) !== 字节数(名称表.get(k) ?? ''))
  );

  /** 表里一行：对象 + 它在盘上有没有 + 命中没命中 */
  const 行 = $derived.by(() => {
    const s = 扫;
    if (!s) return [];
    const 命中表 = new Map(s.pmm_hits.map((h) => [h.key, h.怎么找到的]));
    return s.objects.map((o, i) => ({
      key: o.key,
      类别: o.kind === 'accessory' ? '附件' : '模型',
      名称: 名称表.get(o.key) ?? '',
      来源: o.path,
      目标: s.目标?.[i] ?? '',
      在盘上: s.在盘上[i],
      命中: 命中表.get(o.key) ?? '',
      // 缺文件、没命中，都是"要注意"的行
      要留意: !s.在盘上[i] || !命中表.has(o.key)
    }));
  });
  const 显示行 = $derived((只看有问题 ? 行.filter((r) => r.要留意) : 行).slice(0, 显示上限));

  /** 换工程了，旧那份的结果全清掉（换了一套工程，旧表不能留着） */
  function 清结果() {
    扫 = null;
    搬家干跑 = null;
    搬家做完 = null;
    根们 = [];
    根结果 = null;
    根手动 = {};
    逐条 = {};
    勾选 = {};
    路径表 = [];
    检索表 = [];
    起点们 = [];
    展开候选 = {};
    改名 = {};
    写盘问 = false;
    按目录名问 = false;
    搬运问 = false;
    搬运结果 = null;
    msg = null;
  }

  /**
   * 选定一个文件（拖进来或点选）。
   *
   * **已经载着一个工程、又要载另一个**时不许静默覆盖（用户 2026-09-23 B4）——
   * 先弹一条内联三选：「换成这一个 / 都留住，分别处理 / 取消」。
   */
  function 定(哪: 'pmm' | 'emm', path: string) {
    if (!path) return;
    const 现在 = 哪 === 'pmm' ? pmm : emm;
    if (现在 && path !== 现在) {
      /* **只挂起，不动现有状态**：用户选「取消」时现在这份连表都还在。
         真正的切换（换成 / 都留）各自去清结果、重扫。 */
      冲突 = { 哪, path };
      return;
    }
    真的定(哪, path);
  }

  function 真的定(哪: 'pmm' | 'emm', path: string) {
    冲突 = null;
    if (!工程们.length) {
      工程们 = [{ pmm: 哪 === 'pmm' ? path : '', emm: 哪 === 'emm' ? path : '' }];
      当前工程 = 0;
    } else {
      const 项 = 工程们[当前工程];
      工程们 = 工程们.map((x, i) =>
        i === 当前工程 ? { ...x, [哪]: path } as 工程项 : x
      );
      void 项;
    }
    清结果();
    /* **拖进一个 `.pmm` 就够了**：旁边一般就有同名的 `.emm`，自动接上并直接扫一遍，
       不让用户再选第二遍（用户原话："拖入 pmm 就可以了"）。
       猜错了不拦着 —— 扫描会明说读不到，用户自己换一个。 */
    if (哪 === 'pmm' && !emm) 猜Emm();
    if (pmm && emm) void 扫一遍();
  }

  /**
   * 冲突那三选（B4）。
   *   `换` → 只用新拖进来的这一个（旧的那份从界面上撤掉）；
   *   `都留` → 两份都留着，**新那份成为当前写盘对象**，上面出现「当前处理」的切换条；
   *   `取消` → 什么都不做。
   * 前两条都只动界面：盘上一个字节都不碰，写盘仍然是同一时刻一处。
   */
  function 冲突选(选: '换' | '都留' | '取消') {
    const c = 冲突;
    冲突 = null;
    if (!c || 选 === '取消') return;
    if (选 === '换') {
      工程们 = [];
      当前工程 = 0;
      真的定(c.哪, c.path);
      return;
    }
    工程们 = [
      ...工程们,
      { pmm: c.哪 === 'pmm' ? c.path : '', emm: c.哪 === 'emm' ? c.path : '' }
    ];
    当前工程 = 工程们.length - 1;
    清结果();
    if (c.哪 === 'pmm') 猜Emm();
    if (pmm && emm) void 扫一遍();
  }

  /** 切来路：顺手把该走的那张卡打开（新手不用自己去一堆卡里找） */
  function 选来路(哪: '别人包' | '本机挪走') {
    来路手选 = 哪;
    折叠 = {
      ...折叠,
      [页键]: { ...(折叠[页键] ?? {}), [哪 === '别人包' ? '旧根' : '更多工具']: true }
    };
    存折叠();
  }

  /** 在已经载入的两份之间切换（同一时刻只有一份是写盘对象） */
  function 切工程(i: number) {
    if (i === 当前工程) return;
    当前工程 = i;
    清结果();
    if (pmm && emm) void 扫一遍();
  }

  async function 选(哪: 'pmm' | 'emm') {
    const fs = await pickFile([哪], false);
    if (!fs.length) return;
    定(哪, fs[0].path);
  }

  /* `.pmm`/`.emm` 不是图片：落点必须写明 `accept`，否则会在窗口那层被当成"不是图片"挡掉
     （用户实测就卡在这：拖 .pmm 进来报"不是图片格式"）。 */
  let pmmEl = $state<HTMLElement | null>(null);
  let emmEl = $state<HTMLElement | null>(null);
  $effect(() => {
    /* 进这一页就问一次"有没有可撤销的记录" —— 按钮该亮就亮、该禁用就禁用 */
    void 刷新撤销();
    /* 右栏宽度/收起状态落到 <html> 上（规范 §八）；进这一页先套一次存下来的 */
    applySide();
    /* 老手快捷键（Ctrl+Enter / Ctrl+Shift+Enter）—— 写法写在「更多设置」里给人看 */
    addEventListener('keydown', 键);
    const 撤: (() => void)[] = [() => removeEventListener('keydown', 键)];
    const 登记 = (id: string, el: HTMLElement | null, 哪: 'pmm' | 'emm') => {
      if (!el) return;
      撤.push(() => unregisterZone(id));
      registerZone({
        id,
        rect: el.getBoundingClientRect(),
        el,
        accept: ['pmm', 'emm'],
        onDrop: (ref) => 定(哪, ref.path)
      });
    };
    登记('migrate.pmm', pmmEl, 'pmm');
    登记('migrate.emm', emmEl, 'emm');
    return () => {
      for (const f of 撤) f();
    };
  });

  /** 只填了 pmm 时，猜同目录同名的 emm —— 绝大多数工程都是这样成对的 */
  function 猜Emm() {
    if (!pmm || emm) return;
    const 项 = 工程们[当前工程];
    if (!项) return;
    工程们 = 工程们.map((x, i) =>
      i === 当前工程 ? { ...x, emm: x.pmm.replace(/\.pmm$/i, '.emm') } : x
    );
  }

  async function 扫一遍() {
    if (!pmm || !emm) {
      msg = { kind: 'warn', text: '先把 .pmm 和 .emm 都选上' };
      return;
    }
    扫中 = true;
    msg = null;
    搬家干跑 = null;
    搬家做完 = null;
    try {
      const s = await 扫工程(pmm, emm);
      扫 = s;
      /* 目录归组直接当"新位置"的默认值：用户挪到哪儿自己改，不用一条条填 */
      新模型目录 = s.模型目录[0]?.目录 ?? '';
      新附件目录 = s.附件目录[0]?.目录 ?? '';
      /* 顺手找一遍"死根"：真工程里路径常指向别的机器上的根，这条才是正解 */
      根结果 = null;
      逐条 = {};
      try {
        根们 = 合手动根(await 找工程根(pmm, emm));
      } catch {
        根们 = [];
      }
      await 刷新路径表();
      const h = 汇总扫描(s);
      /* 扫描结果**只说"能不能往下走"**：条数/命中率那些数字在 ② 卡与底栏各有一处属主，
         这里再复述一遍就是同一组数字的第三个地方（用户 2026-09-23：谢绝冗余重复）。 */
      msg = {
        kind: h.可打包 ? 'ok' : 'warn',
        text: h.可打包 ? '扫完了，可以往下走。' : '扫完了 —— 先别写盘，原因写在 ② 里。'
      };
    } catch (e) {
      msg = { kind: 'warn', text: `扫描失败：${说明差错(e)}` };
    }
    扫中 = false;
  }

  /* ---------------- 自动填好的那些值（设计准则 §二「能算的全算好」） ----------------

     新手**不填任何路径**：能推断的都先填好，人只做"确认"或"挑一个"。
     老手改过的值**不再被自动规则覆盖**（§十.2），而且界面上要标出来是手动定的。 */

  /** 老手手动定过的新根：`旧根 → 新根`（重扫之后仍按这份覆盖自动建议） */
  let 根手动 = $state<Record<string, string>>({});
  /**
   * 工具给的那一份（**自动层的原值**）：旧根 → `{建议, 命中}`。
   * 手动层覆盖它，但原值留着 —— 「用推荐值」就是退回这一份（设计准则 §十.1 的"二选一"）。
   */
  let 推荐根表 = $state<Record<string, { 建议: string; 命中: number }>>({});

  /** 把自动建议和手动值合起来：**手动的赢** */
  function 合手动根(来的: 工程根组[]): 工程根组[] {
    const 表: Record<string, { 建议: string; 命中: number }> = {};
    for (const g of 来的) if (g.建议) 表[g.根] = { 建议: g.建议, 命中: g.建议命中 };
    推荐根表 = 表;
    return 来的.map((g) =>
      根手动[g.根] !== undefined ? { ...g, 建议: 根手动[g.根], 建议命中: -1 } : g
    );
  }

  /** 这一条的新根是不是人手动定的（-1 命中是"别管自动那套"的记号） */
  const 是手动的 = (g: 工程根组) => 根手动[g.根] !== undefined;

  /** 一个旧根一行：记手动值 + 重画 */
  function 改根(g: 工程根组, v: string) {
    g.建议 = v;
    根手动 = { ...根手动, [g.根]: v };
    根们 = [...根们];
  }

  /** 「用推荐值」：退回自动找的那一份，**松掉**手动那一层 */
  function 用推荐根(g: 工程根组) {
    const 手 = { ...根手动 };
    delete 手[g.根];
    根手动 = 手;
    const 原 = 推荐根表[g.根];
    if (原) {
      g.建议 = 原.建议;
      g.建议命中 = 原.命中;
    }
    根们 = [...根们];
  }

  /** 「我自己填」：先标成手动（这样重扫不会把它冲掉），再把光标落到那个框里等人写 */
  function 自己填根(g: 工程根组) {
    根手动 = { ...根手动, [g.根]: g.建议 };
    根们 = [...根们];
    queueMicrotask(() => {
      const 框 = [...document.querySelectorAll<HTMLInputElement>('input[aria-label^="给"]')].find(
        (i) => i.getAttribute('aria-label') === `给 ${g.根} 指定新根`
      );
      框?.focus();
      框?.select();
    });
  }

  /**
   * **推荐的自包含目录**：工程旁边一个 `<工程名>_包`。
   * 新手不该从零挑路径 —— 先给一个能直接用的，想换再点「我自己选」。
   */
  const 推荐输出 = $derived.by(() => {
    if (!pmm) return '';
    const 名 = pmm.split(/[\\/]/).pop() ?? '';
    const 干 = 名.replace(/\.pmm$/i, '');
    const 目录 = pmm.slice(0, pmm.length - 名.length).replace(/[\\/]+$/, '');
    return 目录 ? `${目录}\\${干}_包` : '';
  });

  /** 输出目录是"工具推荐的那个"还是"人自己选的" */
  let 输出手动 = $state(false);

  /** 用它推荐的那个（第一次进打包区就自动用上，见下面那个 effect） */
  function 用推荐输出() {
    输出 = 推荐输出;
    输出手动 = false;
  }

  async function 选输出() {
    const d = await pickFolder('选输出目录');
    if (!d) return;
    输出 = d;
    输出手动 = true;
  }

  /* 打包区一进来就把推荐目录填好（老手点了「我自己选」之后不再被覆盖） */
  $effect(() => {
    if (!输出 && 推荐输出 && !输出手动) 输出 = 推荐输出;
  });

  async function 选新目录(哪: '模型' | '附件') {
    const d = await pickFolder(`选新的${哪}目录`);
    if (!d) return;
    if (哪 === '模型') 新模型目录 = d;
    else 新附件目录 = d;
  }

  /* ---------------- 老手那几样（设计准则 §十.6：可复现 + 快捷键，但不挡新手的路） ----------------

     · 「导出映射表」：把这次用的「旧根 → 新位置」与逐条指定写成一份文本 —— 同一套映射下次照着重跑；
     · 快捷键：Ctrl+Enter = 底栏主按钮，Ctrl+Shift+Enter = 试算（都写在界面文字里，不是隐藏功能）。 */

  async function 导出映射表() {
    if (!pmm) return;
    const { 根表, 逐条表 } = 当前映射();
    if (!根表.length && !逐条表.length) {
      msg = { kind: 'warn', text: '现在还没有映射可导出 —— 先扫描、让它自动找一遍，或者自己填几个新位置。' };
      return;
    }
    const 名 = (pmm.split(/[\\/]/).pop() ?? '工程').replace(/\.pmm$/i, '');
    const 目录 = pmm.slice(0, pmm.length - (pmm.split(/[\\/]/).pop() ?? '').length).replace(/[\\/]+$/, '');
    if (!目录) {
      msg = { kind: 'warn', text: '工程文件没有所在目录，导不了。' };
      return;
    }
    const 行: string[] = [
      '# RobinEditor 工程迁移 · 映射表',
      `# 工程：${pmm}`,
      `# 时间：${new Date().toLocaleString()}`,
      '# 用法：把下面 [按根] 那几行照抄到「路径指向了别的位置」里；[逐条] 那几行用「逐条指定」指。',
      '',
      '[按根]',
      ...根表.map(([旧, 新]) => `${旧} => ${新}`),
      '',
      '[逐条]',
      ...逐条表.map(([旧, 新]) => `${旧} => ${新}`),
      ''
    ];
    try {
      const r = await saveBytes(`${目录}\\${名}_路径映射.txt`, new TextEncoder().encode(行.join('\r\n')));
      msg = { kind: 'ok', text: `映射表写了 ${r.path}（${根表.length} 条按根 + ${逐条表.length} 条逐条）` };
    } catch (e) {
      msg = { kind: 'warn', text: `导出映射表失败：${说明差错(e)}` };
    }
  }

  /** 快捷键：老手的面子（写在「更多设置」里，新手不必知道） */
  function 键(e: KeyboardEvent) {
    if (!e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key !== 'Enter') return;
    if (忙 || 扫中) return;
    e.preventDefault();
    if (e.shiftKey) void (情形 === 'A' ? 跑根替换(true) : 跑自包含(true));
    else if (!写盘问) 写盘问 = true;
  }

  /* ---------------- A：搬家改路径 ---------------- */

  async function 跑搬家(干: boolean) {
    if (!pmm || !emm) return;
    按目录名问 = false;
    /* 只支持等长改名：长度不对的**先拦下来**，别等到写盘才报错（用户得能看见是哪一条） */
    if (长度不对的名.length) {
      msg = {
        kind: 'warn',
        text:
          `有 ${长度不对的名.length} 个新名字的字节数与原名不一样（${长度不对的名
            .slice(0, 4)
            .map(([k, v]) => `${k}：${字节数(名称表.get(k) ?? '')} → ${字节数(v)} 字节`)
            .join('、')}）——` +
          '改长度会让本工具的结构自检失效（实测 8/8 工程上定位会掉一条），所以只放行等长改名。'
      };
      return;
    }
    忙 = true;
    msg = null;
    try {
      const 名表: Record<string, string> = {};
      for (const [k, v] of 要改的名) 名表[k] = v.trim();
      const r = await 搬家工程(pmm, emm, 新模型目录, 新附件目录, 输出, 干, 名表);
      if (干) 搬家干跑 = r;
      else 搬家做完 = r;
      const 缺 = r.表.filter((x) => !x.新位置有).length;
      const 名话 = r.改名几处 ? `，改了 ${r.改名几处} 个模型名` : '';
      msg = {
        kind: 缺 ? 'warn' : 'ok',
        text: 干
          ? `算了一遍（没写盘）：${r.表.length} 条对象，改了 ${r.改了几处} 处路径${名话}，新位置还差 ${缺} 条`
          : `保存了：改了 ${r.改了几处} 处路径${名话} → ${r.输出}`
      };
    } catch (e) {
      msg = { kind: 'warn', text: `${干 ? '试算' : '保存'}失败：${说明差错(e)}` };
    }
    忙 = false;
  }

  /* ---------------- 根替换（真工程用这条） ---------------- */

  /**
   * **默认原地改**（用户原话："让工程**原地修复**正常能加载"）。
   *
   * 踩过的坑：以前只往"输出目录"写，用户根本不知道该开哪一份 —— 他拖的两个都是没处理过的原件
   * （旧根还在、新根 0 次），所以"两种情况都失败了"。
   * 现在：`原地` 默认开 → 改的就是他拖进来的那份 `.pmm` 和同名 `.emm`，改前留 `.bak`；
   * 关掉才"另存到别处"，那时完成提示里必须把**要拖的那一个文件**写出来。
   */
  let 原地 = $state(true);

  const 要拖的文件 = $derived(
    原地 ? pmm : 输出.trim() ? 输出.replace(/[\\/]+$/, '') + '\\' + (pmm.split(/[\\/]/).pop() ?? '') : ''
  );

  /**
   * 每个旧根都要有新根才让它跑；一个都没填就先拦下来（别等写盘才报错）。
   * `干` = 试算：只算不写。
   */
  /**
   * 区 2「打包迁移」：**把工程引用的素材连同工程文件一起拷到指定位置**，路径改成指向包内那一份。
   *
   * 走的是跟「修复工程」**同一条链**（`搬根` / 自带模式只差一个"把素材也拷过去"的开关），
   * 所以两区共用同一套表、同一套写盘与回读核对 —— 不是两份实现。
   * 拷的时候**保相对结构**（`新根 + 原相对尾部`）：平铺会把模型旁边的贴图引用全打断
   * （实测 119/119 条贴图靠相对结构才对得上）。
   */
  async function 跑自包含(干: boolean) {
    if (!pmm || !emm) return;
    写盘问 = false;
    if (!输出.trim()) {
      msg = { kind: 'warn', text: '先选一个输出目录（打包要有个落点）。' };
      return;
    }
    const { 根表, 逐条表 } = 当前映射();
    /* 一条映射都没有也**允许打包**：工程本来就健康（路径都指在盘上）时，
       拷贝清单直接从"盘上确实有的那些路径"长出来 —— 这就是"只想打个包"的入口。
       真正缺文件（没落定）的那些才拦下来。 */
    if (!根表.length && !逐条表.length && 没落定.length) {
      msg = {
        kind: 'warn',
        text:
          `还有 ${没落定.length} 条没落定（本机没有、也没有规则）—— 先把它们指出来（搜索起点 / 指定文件…）。` +
          `前几条：${没落定.slice(0, 4).map((r) => r.键).join('、')}`
      };
      return;
    }
    if (!干 && 没落定.length) {
      msg = {
        kind: 'warn',
        text:
          `还有 ${没落定.length} 条没落定（本机没有、也没有规则）—— 先把它们指出来（搜索起点 / 指定文件…）。` +
          `前几条：${没落定.slice(0, 4).map((r) => r.键).join('、')}`
      };
      return;
    }
    忙 = true;
    msg = null;
    try {
      const r = await 自包含工程(pmm, emm, 根表, 输出, 干, 逐条表, 打包模式 === '配布');
      根结果 = r;
      const 残留 = r.旧根残留.reduce((a: number, x: [string, number]) => a + x[1], 0);
      const 新根 = r.新根出现.reduce((a: number, x: [string, number]) => a + x[1], 0);
      const 拖 = `${输出.replace(/[\\/]+$/, '')}\\${pmm.split(/[\\/]/).pop() ?? ''}`;
      const 兆 = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
      const 模式话 =
        打包模式 === '配布'
          ? '（配布打包：包内写的是相对包根的路径、不带盘符，另附一份「配布说明.txt」）'
          : '（本机内打包：包内写的是本机的绝对路径，在这台机器上直接能开）';
      msg = {
        kind: 残留 ? 'warn' : 'ok',
        text: 干
          ? `算了一遍（没写盘）：${r.根表.length} 个旧根、要拷 ${r.拷贝文件 ?? 0} 个文件 / ${兆(r.拷贝字节 ?? 0)} ${模式话}`
          : `打好了：拷了 ${r.拷贝文件 ?? 0} 个文件 / ${兆(r.拷贝字节 ?? 0)}（重名冲突 ${(r.重名冲突 ?? []).length} 个）、` +
            `.pmm 改 ${r.pmm改字段} 处字段、.emm 改 ${r.emm改行} 行；盘上回读：新根出现 ${新根} 次、旧根残留 ${残留} 次。${模式话}\n` +
            `去 MMD 拖这一个：${拖}\n` +
            `（特效分配在 .emm 里，MMD 打开工程不会自动读 .emm —— 要单独载入：菜单「エフェクト割り当て → 読み込み」。）`
      };
      if (!干) {
        await 刷新路径表();
        await 刷新撤销();
      }
    } catch (e) {
      msg = { kind: 'warn', text: `${干 ? '试算' : '打包'}失败：${说明差错(e)}` };
      根结果 = null;
    }
    忙 = false;
  }

  async function 跑根替换(干: boolean) {
    if (!pmm || !emm) return;
    写盘问 = false;
    const { 根表, 逐条表 } = 当前映射();
    if (!根表.length && !逐条表.length) {
      msg = { kind: 'warn', text: '没有可用的映射：先给缺文件的旧根填新根，或对个别文件用「指定…」。' };
      return;
    }
    /* **全部落定才允许写盘**（有一条指向不存在的文件就拒绝；后端也会拒，这里先拦住省一次往返） */
    if (!干 && 没落定.length) {
      msg = {
        kind: 'warn',
        text:
          `还有 ${没落定.length} 条没落定（本机没有、也没有规则）—— 先用「指定文件…/指定目录…」把它们指出来。` +
          `前几条：${没落定.slice(0, 4).map((r) => r.键).join('、')}`
      };
      return;
    }
    if (!干 && !原地 && !输出.trim()) {
      msg = { kind: 'warn', text: '选了"另存到别处"，但还没选输出目录。' };
      return;
    }
    忙 = true;
    msg = null;
    try {
      const r = await 根替换工程(pmm, emm, 根表, 原地 ? '' : 输出, 干, 逐条表);
      根结果 = r;
      const 残留 = r.旧根残留.reduce((a, [, n]) => a + n, 0);
      const 新根 = r.新根出现.reduce((a, [, n]) => a + n, 0);
      const 拖 = 原地 ? pmm : `${输出.replace(/[\\/]+$/, '')}\\${pmm.split(/[\\/]/).pop() ?? ''}`;
      msg = {
        kind: 残留 ? 'warn' : 'ok',
        text: 干
          ? `算了一遍（没写盘）：${r.根表.length} 个旧根、.pmm 改 ${r.pmm改字段} 处字段、.emm 改 ${r.emm改行} 行`
          : `换好了：.pmm ${r.原先pmm长度} → ${r.pmm长度} B（${r.pmm长度 === r.原先pmm长度 ? '长度不变' : '长度变了'}）` +
            `、.emm 改 ${r.emm改行} 行；盘上回读：新根出现 ${新根} 次、旧根残留 ${残留} 次。\n` +
            `${原地 ? '改的就是你拖进来的那份（同目录留了 .bak）' : '已另存'}。去 MMD 拖这一个：${拖}\n` +
            `（特效分配在 .emm 里：MMD 打开工程不会自动读 .emm —— 要单独载入：菜单「エフェクト割り当て → 読み込み」。）`
      };
      /* 原地改之后，工程文件变了，路径表要重算（状态会变成"原位在"） */
      if (!干) {
        await 刷新路径表();
        await 刷新撤销();
      }
    } catch (e) {
      msg = { kind: 'warn', text: `${干 ? '试算' : '换根'}失败：${说明差错(e)}` };
      根结果 = null;
    }
    忙 = false;
  }

  /* ---------------- 搬运（真的把文件搬/拷过去，再改路径） ---------------- */

  /**
   * 用户原话："看一眼要动哪些文件后，对文件都在的情况可以选择将**文件迁移**到指定位置
   * （**单选或多选都可以**）然后保存，工程文件迁移也可以做到修复"。
   *
   * 每个"旧根"一行：给一个目标目录（留空 = 这组不动）。**默认「拷」**（保留原件最安全）。
   */
  let 目标到 = $state<Record<string, string>>({});
  let 搬运方式 = $state<'拷' | '搬'>('拷');
  let 搬运结果 = $state<工程搬运结果 | null>(null);
  /** 上面那个结果是"试算"还是"真做了" —— 两者的个数含义不一样（试算只数工程引用的那些），标签要分开写 */
  let 搬运是干跑 = $state(false);
  let 搬运忙 = $state(false);

  /** 要搬的那些组 = 用户填了目标位置的 */
  const 要搬的组 = $derived(根们.filter((g) => (目标到[g.根] ?? '').trim()));

  /**
   * 侧栏那一句「下一步」。**只写"现在点哪儿"**，不写原理 —— 新手在界面上要的是这个。
   * 按规范它现在挂在**底栏**（"这一步要写什么"），右栏只剩控件。
   */
  const 下一步 = $derived.by(() => {
    if (!pmm) return '第一步：把 .pmm 工程拖到上面那个框里（同名的 .emm 会自动接上）。';
    if (!emm) return '第二步：把同名的 .emm 也拖进来（或点「按同名猜 .emm」）。';
    if (!扫) return '点「扫描工程」看一眼里面有什么（不改任何文件）。';
    if (情形 === 'C') {
      if (!输出) return '先在「自包含目录」那一行点「选目录」。';
      /* 打包区没有逐条指定那层（那是修复区的事），所以这里**要指路**，也要报个数
         —— 这个数在打包区只出现在这一处。指路要指名道姓：
         「找回挪走的文件」在下面的「更多工具」里，两个区都有（用户 2026-09-23 B3）。 */
      if (没落定.length)
        return `还有 ${没落定.length} 条没找到 —— 在下面「更多工具 → 找回挪走的文件」里把它们指回来，这一区就能打包。`;
      return `最后一步：点「打包到输出目录」（现在这样：${打包模式 === '配布' ? '配布打包，发给别人也指得对' : '本机内打包，只在这台机器上能直接开'}）。`;
    }
    /* 修复区：没落定几条**由「每一处路径（逐条）」那个标签报**，这里不重复那个数 */
    if (没落定.length)
      return '还有没找到的文件：在「更多工具 → 找回挪走的文件」里按文件名找回，或在「逐条指定」里一条条指。';
    if (要搬的组.length) {
      return '在「更多工具 → 把文件也一起搬过去」里点「试算（搬运）」看一眼，没问题再点「搬运并改路径」。';
    }
    if (有死根) {
      const 都填了 = 要改的根.every((g) => g.建议.trim());
      return 都填了
        ? '新位置已经替你填好了（上面「路径指向了别的位置」里那几行），确认没问题就点「原地修好」。'
        : '在「路径指向了别的位置」里，给每个旧根填上新位置（点右边那个框自己填），然后点「原地修好」。';
    }
    if (根们.length) return '文件想让它们换个地方，就在「更多工具」里点「放到…」。否则直接点「原地修好」。';
    return '路径都能对上，直接点「原地修好」把工程保存好即可。';
  });

  /** 底栏主按钮按下去之前先问的那一句 —— **写清会动哪些文件** */
  const 写盘问句 = $derived.by(() => {
    if (情形 === 'C') {
      return 打包模式 === '配布'
        ? `确定打包？往 ${输出 || '（还没选输出目录）'} 里拷工程引用的文件 + 那份 .pmm/.emm，包内路径写成相对的（不带本机盘符）—— 不动你拖进来的原件。`
        : `确定打包？往 ${输出 || '（还没选输出目录）'} 里拷工程引用的文件 + 那份 .pmm/.emm，包内路径写成本机绝对路径 —— 不动你拖进来的原件。`;
    }
    if (原地) return `确定写盘？改的是这两份：${pmm} 与同名的 .emm（各留一份 .bak，不动素材）。`;
    return `确定写盘？写到 ${输出 || '（还没选输出目录）'} 里 —— 不动你拖进来的那两份原件。`;
  });

  /* ---------------- 撤销（照上一次的操作记录反着做） ---------------- */

  /**
   * **Tauri 的 `Result<T, String>` 拒绝时给 JS 的是字符串，不是 Error** ——
   * 直接取 `.message` 会显示成 `undefined`（用户实测就看到过「试算失败：undefined」，
   * 后端其实说得很清楚）。所有 catch 一律走这里。
   */
  const 说明差错 = (e: unknown) =>
    typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);

  /** 上一次处理的人话（空串 = 没有可撤销的） */
  let 撤销有 = $state('');
  let 撤销忙 = $state(false);
  let 撤销报告 = $state<撤销结果 | null>(null);
  /** 顶栏那个 `?`：这一页是干什么的（规范 §二：长说明只放这里和页面底部的折叠区） */
  let 说明开 = $state(false);

  async function 刷新撤销() {
    try {
      const r = await 待撤销();
      撤销有 = r ? `${new Date(r.时间 * 1000).toLocaleString()} · ${r.人话}` : '';
    } catch {
      撤销有 = '';
    }
  }

  /** 撤销：先出表（干跑不碰盘），确认了才真做 */
  async function 跑撤销(干: boolean) {
    if (!撤销有) {
      msg = { kind: 'warn', text: '没有可撤销的记录。' };
      return;
    }
    撤销忙 = true;
    msg = null;
    try {
      const r = await 撤销工程(干);
      撤销报告 = r;
      msg = 干
        ? { kind: 'info', text: `撤销会做 ${r.条目.length} 件事（还没动手）—— 看下面那张表，确认了再点「确认撤销」。` }
        : {
            kind: 'ok',
            text:
              `撤销做完了：写回 ${r.写回} 个工程文件、删掉 ${r.删目录} 个副本目录、搬回 ${r.搬回} 个原件。\n` +
              `回读核对在下面（工程文件的长度与校验要跟改前一致）。`
          };
      await 刷新撤销();
    } catch (e) {
      msg = { kind: 'warn', text: `撤销失败：${说明差错(e)}` };
    }
    撤销忙 = false;
  }

  /* ---------------- 重置（把界面复位，盘上一个字节都不动） ---------------- */

  /**
   * **重置 = 清界面**，不是"反着做"。
   *
   * 清掉：按根映射（`根们` 里填的新根）、逐条指定、勾选、输出目录、搜索起点、检索结果、
   * 搬运目标、改名、过滤词，然后**重新扫一遍** —— 回到"刚把 `.pmm` 拖进来"的样子。
   * **一个字节都不动盘**；"反着做上一次写盘"那是「撤销上一次处理」，两码事。
   *
   * 源文件被挪走或删掉时**明确报错**：重扫要读它，读不到就得说清是哪一份 ——
   * 不许把空表当成"工程是空的"（那正是会骗到人的地方）。
   */
  let 重置问 = $state(false);
  let 重置忙 = $state(false);

  async function 重置工程() {
    重置问 = false;
    if (!pmm || !emm) {
      msg = { kind: 'warn', text: '先把 .pmm 和 .emm 都选上，再重置。' };
      return;
    }
    重置忙 = true;
    try {
      const 丢: string[] = [];
      try {
        const [a, b] = await Promise.all([probeDir(pmm), probeDir(emm)]);
        if (!a.exists) 丢.push(pmm);
        if (!b.exists) 丢.push(emm);
      } catch {
        /* 探不动就交给下面那次扫描去报错 */
      }
      if (丢.length) {
        msg = { kind: 'warn', text: `重置失败：源文件不在了 —— ${丢.join('、')}。重新拖一份 .pmm 进来。` };
        return;
      }
      根们 = [];
      逐条 = {};
      勾选 = {};
      改名 = {};
      目标到 = {};
      起点们 = [];
      检索表 = [];
      展开候选 = {};
      搬运结果 = null;
      搬运是干跑 = false;
      根结果 = null;
      搬家干跑 = null;
      搬家做完 = null;
      撤销报告 = null;
      输出 = '';
      输出手动 = false;
      根手动 = {};
      新模型目录 = '';
      新附件目录 = '';
      路径过滤 = '';
      只看有问题 = false;
      写盘问 = false;
      按目录名问 = false;
      搬运问 = false;
      原地 = true;
      /* 收纳这一层也跟着复位：折叠卡的记忆清掉，回到"这一页自己的默认"
         （有未落定/有问题的自动展开，其余收起）—— 这一段只动 localStorage，不碰盘。 */
      折叠 = { ...折叠, [页键]: {} };
      存折叠();
      await 扫一遍();
      if (扫) msg = { kind: 'ok', text: `界面已复位（盘上没动一个字节）。${msg?.text ?? ''}` };
    } finally {
      重置忙 = false;
    }
  }

  async function 选搬运目标(根: string) {
    const d = await pickFolder(`这组文件要放到哪儿：${根}`);
    if (!d) return;
    目标到 = { ...目标到, [根]: d };
  }

  async function 跑搬运(干: boolean) {
    if (!pmm || !emm) return;
    搬运问 = false;
    const 表: [string, string][] = 要搬的组.map((g) => [g.根, 目标到[g.根].trim()]);
    if (!表.length) {
      msg = { kind: 'warn', text: '还没给任何一组文件挑目标位置 —— 先点「放到…」选目录。' };
      return;
    }
    搬运忙 = true;
    msg = null;
    try {
      const r = await 搬运工程(pmm, emm, 表, 搬运方式, 干);
      搬运结果 = r;
      搬运是干跑 = 干;
      const 改 = r.根结果;
      const 残留 = 改.旧根残留.reduce((a, [, n]) => a + n, 0);
      msg = 干
        ? { kind: 'info', text: `算了一遍（没写盘）：${r.说明[0] ?? ''}` }
        : {
            kind: 残留 ? 'warn' : 'ok',
            text:
              `拷过去 ${r.拷贝文件} 个文件（${(r.拷贝字节 / 1048576).toFixed(1)} MB，连模型旁边的贴图一起）` +
              `${r.删除文件 ? `、删掉原件 ${r.删除文件} 个（只删工程真正引用的那些，逐个字节核对过才删）` : ''}；` +
              `工程里的路径已改好（.pmm 改 ${改.pmm改字段} 处、.emm 改 ${改.emm改行} 行），` +
              `盘上回读：旧路径残留 ${残留} 处（要 0）。\n` +
              `改的就是你拖进来的那份。去 MMD 拖这一个：${pmm}\n` +
              `（特效分配在 .emm 里：MMD 打开工程不会自动读，要单独载入。）`
          };
      await 刷新路径表();
      /* 写盘成功 → 有一份新的操作记录，撤销按钮要亮起来 */
      if (!干) await 刷新撤销();
    } catch (e) {
      msg = { kind: 'warn', text: `${干 ? '试算' : '搬运'}失败：${说明差错(e)}` };
      搬运结果 = null;
    }
    搬运忙 = false;
  }

  /* ---------------- 逐条指定（跟"按根批量"是两层，能叠加） ---------------- */

  /**
   * 逐条覆盖：`原路径 → 现在在哪`。**用户指定过的条目不许被根规则改回去** ——
   * 这条由后端保证（覆盖按"旧串更长优先"命中），界面只负责把它传下去。
   */
  let 逐条 = $state<Record<string, string>>({});
  let 路径表 = $state<工程路径行[]>([]);
  let 表忙 = $state(false);
  /** 表太长时的过滤词（几千条会卡，展示也截到 200 行） */
  let 路径过滤 = $state('');

  /** 现在这套规则下，还有几条没落定（没落定就不许写盘） */
  const 没落定 = $derived(路径表.filter((r) => !r.目标));
  const 已落定 = $derived(路径表.length - 没落定.length);

  function 当前映射(): { 根表: [string, string][]; 逐条表: [string, string][] } {
    const 根表: [string, string][] = 要改的根
      .filter((g) => g.建议.trim())
      .map((g) => [g.根, g.建议.trim()]);
    const 逐条表: [string, string][] = Object.entries(逐条)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => [k, v.trim()]);
    return { 根表, 逐条表 };
  }

  async function 刷新路径表() {
    if (!pmm || !emm) return;
    表忙 = true;
    try {
      const { 根表, 逐条表 } = 当前映射();
      路径表 = await 列工程路径(pmm, emm, 根表, 逐条表);
    } catch (e) {
      msg = { kind: 'warn', text: `列路径失败：${说明差错(e)}` };
    }
    表忙 = false;
  }

  /** 指定一个文件：选完**立刻复验它在不在**（不在就当场说，别等写盘） */
  async function 指定文件(行: 工程路径行) {
    const 后缀 = 行.原路径.split('.').pop() ?? '';
    const 选的 = await pickFile(后缀 ? [后缀] : [], false);
    const p = 选的[0]?.path ?? '';
    if (!p) return;
    逐条 = { ...逐条, [行.原路径]: p };
    await 刷新路径表();
    const 新行 = 路径表.find((r) => r.原路径 === 行.原路径);
    msg = 新行?.目标
      ? { kind: 'ok', text: `「${行.键}」指到 ${p}` }
      : { kind: 'warn', text: `指过去了，但那条还是没落定 —— 确认选的是这个文件：${p}` };
  }

  /** 指定一个目录：**按文件名在那个目录里找**（找不到就直说，别猜） */
  async function 指定目录(行: 工程路径行) {
    const d = await pickFolder('选这个文件现在所在的目录');
    if (!d) return;
    const 名 = 行.原路径.split(/[\\/]/).pop() ?? '';
    let 找到 = '';
    try {
      const 列 = await scanDir(d, [], true);
      找到 = 列.find((f) => (f.path.split(/[\\/]/).pop() ?? '').toLowerCase() === 名.toLowerCase())?.path ?? '';
    } catch (e) {
      /* 选到一个太大范围的目录（盘根那种）时，后端会直接说"范围太大，请给更具体的起点" */
      msg = { kind: 'warn', text: 说明差错(e) };
      return;
    }
    if (!找到) {
      msg = { kind: 'warn', text: `这个目录里没找到 ${名} —— 用「指定文件…」直接点那个文件。` };
      return;
    }
    逐条 = { ...逐条, [行.原路径]: 找到 };
    await 刷新路径表();
    msg = { kind: 'ok', text: `「${行.键}」按文件名找到并指到 ${找到}` };
  }

  /* ---------------- 勾选 + 批量（用户："可以单选或多选改变选中的文件"） ---------------- */

  /**
   * 勾中的行（键 = 原路径）。
   *
   * 为什么要有这一层：文件**一个个挪散**时逐条点太慢 —— 用户原话是
   * "展示定位的位置**可以单选或多选**改变选中的文件"。
   * 批量只改**映射**（哪条指到哪），不直接动盘；最终仍走同一条写盘链。
   */
  let 勾选 = $state<Record<string, boolean>>({});
  const 勾中 = $derived(路径表.filter((r) => 勾选[r.原路径]));
  const 勾数 = $derived(勾中.length);

  /** 当前过滤出来、且真的会显示出来的那些行（批量的作用范围取它，避免"勾了看不见的行"） */
  const 可见行 = $derived(
    路径表
      .filter((r) => !路径过滤 || r.原路径.includes(路径过滤) || r.键.includes(路径过滤))
      .slice(0, 200)
  );

  function 切勾(键: string) {
    勾选 = { ...勾选, [键]: !勾选[键] };
  }

  function 全勾(开: boolean) {
    const 新 = { ...勾选 };
    for (const r of 可见行) 新[r.原路径] = 开;
    勾选 = 新;
  }

  /**
   * 批量：勾中的这些文件**现在都在同一个目录里** → 按文件名逐个找出来。
   * 找不到的那几条**如实列出来**，不许猜、不许"就近找一个"。
   */
  async function 批量指定目录() {
    if (!勾中.length) {
      msg = { kind: 'warn', text: '先在左边的小方框里勾几条。' };
      return;
    }
    const d = await pickFolder(`选这 ${勾中.length} 条文件现在所在的目录`);
    if (!d) return;
    表忙 = true;
    try {
      const 列 = await scanDir(d, [], true);
      const 索引 = new Map<string, string>();
      for (const f of 列) 索引.set((f.path.split(/[\\/]/).pop() ?? '').toLowerCase(), f.path);
      const 新 = { ...逐条 };
      const 没找到: string[] = [];
      for (const r of 勾中) {
        const 名 = (r.原路径.split(/[\\/]/).pop() ?? '').toLowerCase();
        const 命中 = 索引.get(名);
        if (命中) 新[r.原路径] = 命中;
        else 没找到.push(r.键);
      }
      逐条 = 新;
      await 刷新路径表();
      const 成 = 勾中.length - 没找到.length;
      msg = 没找到.length
        ? {
            kind: 'warn',
            text: `指过去 ${成} 条；这个目录里找不到 ${没找到.length} 条（原样留着）：${没找到.slice(0, 5).join('、')}${没找到.length > 5 ? ' 等' : ''}`
          }
        : { kind: 'ok', text: `这 ${勾中.length} 条都按文件名指到了 ${d}` };
    } catch (e) {
      /* 范围太大那条**原样显示**（后端已经写清是哪条线超了、该换成什么） */
      msg = { kind: 'warn', text: 是范围太大(e) ? 说明差错(e) : `按文件名找失败：${说明差错(e)}` };
    }
    表忙 = false;
  }

  /**
   * 批量：勾中的这些行，把它们**所属的旧根**统一指到一个新根（整段换根、保留相对结构）。
   *
   * 填的是「路径指向了别的位置」那张卡里的新根 —— 填完还能量个改（多个旧根指向同一个新目录
   * 只在"整棵树挪过去"时才对，逐个核对是用户的事，工具不替他猜）。
   */
  async function 批量改根() {
    if (!勾中.length) {
      msg = { kind: 'warn', text: '先在左边的小方框里勾几条。' };
      return;
    }
    const 相关根 = [...new Set(勾中.map((r) => r.根).filter((x) => x))];
    if (!相关根.length) {
      msg = { kind: 'warn', text: '勾中的这些行本来就在原位（没有旧根要换）。' };
      return;
    }
    const d = await pickFolder(`把这些旧根统一指到哪儿（新根）`);
    if (!d) return;
    let 填了 = 0;
    const 没这根: string[] = [];
    for (const 根 of 相关根) {
      const g = 根们.find((x) => x.根 === 根);
      if (!g) {
        没这根.push(根);
        continue;
      }
      g.建议 = d;
      填了++;
    }
    /* `根们` 是 $state 数组，元素是普通对象 —— 改完属性要重新赋值一次才会重画 */
    根们 = [...根们];
    await 刷新路径表();
    msg = 没这根.length
      ? { kind: 'warn', text: `填了新根 ${填了} 个；这 ${没这根.length} 个根不在列表里：${没这根.join('、')}` }
      : { kind: 'ok', text: `${填了} 个旧根都指到 ${d}（要改的可以在「路径指向了别的位置」那张卡里逐个改）` };
  }

  /** 批量：清掉勾中这些行的逐条指定（退回"按根"的结论） */
  async function 批量清指定() {
    if (!勾中.length) {
      msg = { kind: 'warn', text: '先在左边的小方框里勾几条。' };
      return;
    }
    const 新 = { ...逐条 };
    let 清了几 = 0;
    for (const r of 勾中) {
      if (新[r.原路径] !== undefined) {
        delete 新[r.原路径];
        清了几++;
      }
    }
    逐条 = 新;
    await 刷新路径表();
    msg = { kind: 'ok', text: `清掉了 ${清了几} 条逐条指定（其余 ${勾中.length - 清了几} 条本来就没有指定）` };
  }

  /* B（丢掉丢失的）整段已按用户要求撤掉：缺文件只报告，不动工程结构 */

  /* ---------------- 检索（用户："让其检索移动后的文件的位置"） ---------------- */

  /**
   * 搜索起点：**可以多选** —— 模型挪到一个盘、特效挪到另一个盘是常态。
   * 找完只是给"逐条指定"当建议，**采用不采用由人定**（采用后才进 `逐条`）。
   */
  let 起点们 = $state<string[]>([]);
  let 检索表 = $state<工程检索行[]>([]);
  let 检索忙 = $state(false);
  /** 多条候选时，逐行展开让人挑 */
  let 展开候选 = $state<Record<string, boolean>>({});

  const 检索唯一 = $derived(检索表.filter((r) => r.状态 === '已唯一找到' && r.建议));
  const 检索多个 = $derived(检索表.filter((r) => r.状态 === '多个候选'));
  const 检索没找 = $derived(检索表.filter((r) => r.状态 === '没找到'));

  async function 加起点() {
    const d = await pickFolder('选一个搜索起点目录（被挪走的文件大概在下面）');
    if (!d) return;
    if (!起点们.includes(d)) 起点们 = [...起点们, d];
  }

  function 去起点(i: number) {
    起点们 = 起点们.filter((_, k) => k !== i);
  }

  /**
   * 检索的进度与取消（用户 2026-09-23 A1：**不许把界面卡住**）。
   *
   * 后端那条命令是 `async`（不在渲染线程上跑），递归还有层数/条目/时间三条上限。
   * 进度靠轮询 `查扫描进度()`（假后端里没有这条命令，读不到就当没有进度，不算错）。
   */
  let 检索进度 = $state('');
  let 进度表: ReturnType<typeof setInterval> | null = null;

  function 停进度表() {
    if (进度表 !== null) {
      clearInterval(进度表);
      进度表 = null;
    }
  }

  function 开进度表() {
    停进度表();
    检索进度 = '开始找…';
    进度表 = setInterval(() => {
      void 查扫描进度()
        .then((p) => {
          if (!p) return;
          const 尾 = p.在哪.split(/[\\/]/).filter(Boolean).pop() ?? p.在哪;
          检索进度 = `已看 ${p.已看} 个文件 / ${(p.毫秒 / 1000).toFixed(1)} 秒 · 正在 ${尾}`;
        })
        .catch(() => {
          /* 假后端没有这条命令：不给进度也不算错 */
        });
    }, 300);
  }

  async function 停检索() {
    await 取消扫描().catch(() => {});
    msg = { kind: 'info', text: '已请求停下 —— 这一趟到下一个检查点就退出，盘上没动任何东西。' };
  }

  /** 用现在的根规则 + 起点们，把"还没落定"的那些按文件名找出来 */
  async function 跑检索() {
    if (!pmm || !emm) return;
    if (!起点们.length) {
      msg = { kind: 'warn', text: '先加一个搜索起点目录（被挪走的文件在哪儿）。' };
      return;
    }
    检索忙 = true;
    开进度表();
    try {
      const { 根表, 逐条表 } = 当前映射();
      检索表 = await 检索工程文件(pmm, emm, 根表, 逐条表, 起点们);
      展开候选 = {};
      const 唯一 = 检索表.filter((r) => r.状态 === '已唯一找到').length;
      const 多 = 检索表.filter((r) => r.状态 === '多个候选').length;
      const 无 = 检索表.filter((r) => r.状态 === '没找到').length;
      msg = 检索表.length
        ? { kind: 'info', text: `需要找 ${检索表.length} 条：唯一找到 ${唯一}、多个候选 ${多}、没找到 ${无}。采用之后才会进"逐条指定"。` }
        : { kind: 'ok', text: '没有需要检索的 —— 现在的规则已经把所有路径都落定了。' };
    } catch (e) {
      /* **范围太大那条原样显示**：后端已经把"哪条线超了、该换成什么"写清楚了，
         界面再包一层反而看不见。后面补一句指路（起点可以加好几个）。 */
      if (是范围太大(e)) {
        msg = {
          kind: 'warn',
          text: `${说明差错(e)}\n（起点可以加好几个：模型在一个目录、特效在另一个盘，分开加就行。整盘那种起点不会去扫。）`
        };
      } else {
        msg = { kind: 'warn', text: `检索失败：${说明差错(e)}` };
      }
    } finally {
      停进度表();
      检索进度 = '';
      检索忙 = false;
    }
  }

  async function 采用(行: 工程检索行, 用哪条: string) {
    if (!用哪条) return;
    逐条 = { ...逐条, [行.原路径]: 用哪条 };
    await 刷新路径表();
    msg = { kind: 'ok', text: `「${行.文件名}」指到 ${用哪条}` };
  }

  /** 一次采用所有"唯一找到"的（新手友好：能自动的就别让人一条条点） */
  async function 采用全部唯一() {
    if (!检索唯一.length) return;
    const 新 = { ...逐条 };
    for (const r of 检索唯一) 新[r.原路径] = r.建议;
    逐条 = 新;
    await 刷新路径表();
    msg = { kind: 'ok', text: `采用了 ${检索唯一.length} 条唯一找到的` };
  }

  /* ---------------- 收纳：区块卡的开合（规范 §十八） ----------------

     三级收纳，只有这三层：
       ① 主线常开 —— ① 导入 / ② 结果 / ③ 落点 / 底栏那颗主按钮；
       ② 区块卡可折叠 —— 旧根 / 逐条指定 / 检索 / 模型名称 / 打包方式；
       ③ 「更多工具」默认收起 —— 重置工程 / 按目录名整批改 / 把文件搬过去。

     展开态**按页 + 按区块记忆**（两个区各记各的）；第一次进来用"这一条的默认"：
     **有未落定/有问题的自动展开**，其余收起。存下来的东西不可信（手改过、老版本写过），
     读的时候一层层挑：不是对象、值不是布尔，就当没记过。 */

  const 折叠键 = 'robin.migrate.fold.v1';
  type 折叠表 = Record<string, Record<string, boolean>>;

  function 读折叠(): 折叠表 {
    if (typeof localStorage === 'undefined') return {};
    let 生: unknown;
    try {
      生 = JSON.parse(localStorage.getItem(折叠键) || '{}');
    } catch {
      return {};
    }
    if (!生 || typeof 生 !== 'object' || Array.isArray(生)) return {};
    const 出: 折叠表 = {};
    for (const [页, v] of Object.entries(生 as Record<string, unknown>)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const 一条: Record<string, boolean> = {};
      for (const [名, x] of Object.entries(v as Record<string, unknown>)) {
        if (typeof x === 'boolean') 一条[名] = x;
      }
      出[页] = 一条;
    }
    return 出;
  }

  let 折叠 = $state<折叠表>(读折叠());
  /** 这一页的键：两个区各记各的 */
  const 页键 = $derived(panelId === 'pack' ? 'pack' : 'repair');

  function 存折叠() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(折叠键, JSON.stringify(折叠));
    } catch {
      /* 存不下就这一轮照旧用着 */
    }
  }

  /** 这张卡开不开：**手动开合过就照记忆**，没记过用这一条自己的默认 */
  function 卡开(名: string, 默认开: boolean): boolean {
    const 记 = 折叠[页键]?.[名];
    return typeof 记 === 'boolean' ? 记 : 默认开;
  }

  /**
   * 收 / 开一张卡。**只挂在各卡标题的点击上**，不去听 `<details>` 的 `toggle` ——
   * 体检脚本是**直接把 `details.open` 打上去**量"全展开"那一层的，
   * 听 toggle 就等于"量一遍顺手把这一页的记忆改成全开"，下次进页面看到的不是默认状态。
   */
  function 切卡(名: string, 现在开着: boolean) {
    折叠 = { ...折叠, [页键]: { ...(折叠[页键] ?? {}), [名]: !现在开着 } };
    存折叠();
  }

  /** 各卡标题右边的**关键读数**：收起也知道这一条要不要展开（规范 §十八） */
  const 填了根 = $derived(要改的根.filter((g) => g.建议.trim()).length);
  const 读数根 = $derived(
    要改的根.length
      ? `旧根 ${要改的根.length} 个 · 填了 ${填了根}`
      : 好的根数
        ? `旧根 0 · ${好的根数} 个本机都有`
        : '旧根 0'
  );
  const 读数检索 = $derived(
    检索表.length
      ? `起点 ${起点们.length} · 唯一 ${检索唯一.length} / 候选 ${检索多个.length} / 没找 ${检索没找.length}`
      : `起点 ${起点们.length} 个`
  );
  const 读数名 = $derived(
    `模型 ${行.filter((r) => r.类别 === '模型').length} 条${要改的名.length ? ` · 改 ${要改的名.length}` : ''}`
  );
</script>

{#if !['repair', 'pack'].includes(panelId)}
  <div class="card pad">
    <Note kind="warn">
      分区 id「{panelId}」这个组件不认识，所以这一页是空的。
    </Note>
  </div>
{:else}
  <div class="wb">
    <div class="wb__main">
      <!-- 顶部一句话：**这一页干什么**（设计准则 §一：进页面一眼可见，不藏在「说明」按钮后面） -->
      <p class="topline">
        <Icon name="ui.info" size={13} />
        <span>
          {#if 情形 === 'C'}
            这一页把工程和它<b>用到的素材</b>一起打成一份包：文件拷进去、路径改成指包内，自己备份或发给别人都能直接开。
          {:else}
            这一页修工程的路径：文件在别处就把路径指过去，不知道挪哪去了就让工具<b>按文件名找回来</b>。
          {/if}
          <span class="mut">不改工程结构、不碰动作数据。</span>
        </span>
      </p>

      <div class="card pad">
        <!-- 顶栏这一行只放「说明」。
             「参数」开关不在这儿 —— 路由壳统一出（页里画了 `.wb__side` 就有）。 -->
        <div class="acts" style="margin-bottom:10px">
          <h3 class="h3" style="margin:0">① 导入工程</h3>
          <span class="acts__sp"></span>
          <button
            class="btn btn--ghost btn--sm"
            aria-expanded={说明开}
            onclick={() => (说明开 = !说明开)}
            title="这一页是干什么的（更细的规矩在页面最下面）"
          ><Icon name="ui.help" size={13} />说明</button>
        </div>
        {#if 说明开}
          <div class="explain mini">
            <p style="margin:0 0 6px">
              <b>这一页修工程的路径</b>：MMD 工程（`.pmm` + 同名 `.emm`）里存的是<b>绝对路径</b>，
              素材一挪位置就全指空 —— 打开时就会弹"指定模型文件路径"。这一页把它们重新指对，
              <b>不改工程结构、不碰动作数据</b>。
            </p>
            <ul style="margin:0; padding-left:1.2em">
              <li><b>别人打包的工程</b>（下载来的）：路径写的是别人机器上的根 → 走「路径指向了别的位置」，每个旧根填一个本机目录。</li>
              <li><b>本机的工程文件被挪了位置</b>：文件还在本机 → 走「找回挪走的文件」按文件名找回，或「逐条指定」。</li>
              <li><b>搬过去</b>：把文件真的搬/拷到你指定的位置（可以多组目标），再改路径并保存。</li>
              <li><b>做成自包含</b>：在「打包迁移」区把用到的文件连同 `.pmm`/`.emm` 全拷到一个目录。</li>
            </ul>
            <p style="margin:6px 0 0" class="mut">更细的规矩与注意事项在页面最下面那个「说明与注意事项」里。</p>
          </div>
        {/if}

        <!-- 载了不止一份工程时的切换条：**同一时刻只有一份是写盘对象**（用户 2026-09-23 B4） -->
        {#if 工程们.length > 1}
          <div class="row" style="margin-bottom:8px">
            <span class="row__k">当前处理</span>
            <div class="acts">
              {#each 工程们 as x, i (x.pmm + i)}
                <button
                  class="btn btn--ghost btn--sm"
                  aria-pressed={i === 当前工程}
                  title={x.pmm}
                  onclick={() => 切工程(i)}
                >{i === 当前工程 ? '● ' : ''}{工程名(x)}</button>
              {/each}
            </div>
          </div>
        {/if}

        <!-- 拖进来第二个工程：先问一句，不许静默换掉（B4） -->
        {#if 冲突}
          <div style="margin-bottom:8px">
            <Note kind="warn">
              <b>已经载着一份工程了</b>（{工程名(当前项)}），现在拖进来的是另一份。
              要怎么办？<b>替换会清掉现在这份的映射</b>（盘上不动），两份都留则一次只有一份是写盘对象。
              <div class="acts" style="margin-top:6px">
                <button class="btn btn--ghost btn--sm" onclick={() => 冲突选('换')}>换成这一个</button>
                <button class="btn btn--ghost btn--sm" onclick={() => 冲突选('都留')}>两份都留，分别处理</button>
                <button class="btn btn--ghost btn--sm" onclick={() => 冲突选('取消')}>取消</button>
              </div>
            </Note>
          </div>
        {/if}

        <div class="slotrow">
          <button class="pick" type="button" bind:this={pmmEl} onclick={() => 选('pmm')}>
            <Icon name="ui.file" size={16} />
            <b>{pmm ? pmm.split(/[\\/]/).pop() : '选 .pmm 工程'}</b>
            <span class="mini mut">{pmm || '把 .pmm 拖进来，或点这里选'}</span>
          </button>
          <button class="pick" type="button" bind:this={emmEl} onclick={() => 选('emm')}>
            <Icon name="ui.file" size={16} />
            <b>{emm ? emm.split(/[\\/]/).pop() : '选 .emm 特效表'}</b>
            <span class="mini mut">{emm || '把 .emm 拖进来，或点这里选（跟 .pmm 同名的那个）'}</span>
          </button>
        </div>
        <div class="acts" style="margin-top:10px">
          <button class="btn" disabled={扫中 || !pmm || !emm} onclick={扫一遍}>
            <Icon name="ui.open" size={14} />{扫中 ? '扫描中…' : 扫 ? '重新扫描工程' : '扫描工程（不改任何文件）'}
          </button>
          {#if pmm && !emm}
            <button class="btn btn--ghost btn--sm" onclick={猜Emm}>按同名猜 .emm</button>
          {/if}
        </div>
      </div>

      {#if 汇}
        <!-- ② 工程里有什么：**可伸缩折叠**（用户 2026-09-23 B7：那一堆路径别一直占地方），
             标题右边给读数，收起也知道要不要展开（规范 §十八）。 -->
        <details class="fold" open={卡开('工程里有什么', true)}>
          <summary onclick={() => 切卡('工程里有什么', 卡开('工程里有什么', true))}>
            <span class="fold__t">② 工程里有什么</span>
            <span class="fold__sp"></span>
            <span class="tag" class:tag--ok={汇.可打包}>{汇.可打包 ? '可以往下走' : '先别动盘'}</span>
            <span class="fold__n mono">
              模型 {分组.模型} · 附件 {分组.附件} · 认出 {汇.命中率}%
            </span>
          </summary>
          <div class="fold__body">
          <div class="acts">
            <span class="mini">路径认出来 {汇.命中率}%</span>
            <span class="acts__sp"></span>
            <label class="chk"><input type="checkbox" bind:checked={只看有问题} /><span class="chk__box"></span>只看要留意的</label>
          </div>

          {#if 汇.拦}
            <!-- **常驻**：这句说的是"这一次扫描为什么被拦"，是结果面板的一部分，
                 不是跟着某个动作冒出来的提示 —— 挂 9 秒自己走掉等于把理由藏了。 -->
            <div style="margin:10px 0"><Note kind="warn" 常驻>{汇.拦}</Note></div>
          {/if}

          <!-- `.pmm` 与 `.emm` 不同步：单独说清，否则只会看到"命中率很低"而不知道真正原因 -->
          {#if 不同步.length}
            <div style="margin:10px 0">
              <Note kind="warn">
                <b>.pmm 与 .emm 里的路径对不上</b>（{不同步.length} 条）：这两份文件各存一套对象路径，
                打开 MMD 时用的是它们各自那一份 —— 对不上就会出现"看着改好了、打开还要指定路径"。
                写盘会把<b>两份一起</b>改到同一个位置；下面先列出前几条，看清楚再动手。
                <ul class="ul" style="margin:6px 0 0">
                  {#each 不同步.slice(0, 4) as s (s)}<li class="mini mono wrapany">{s}</li>{/each}
                </ul>
              </Note>
            </div>
          {/if}

          <!-- 一眼看到：模型几条、附件几条、各几个在盘上（用户报过"看不到几条"）。
               这里**只放分项** —— 合计/"缺几条"/特效引用归底栏那条「影响 …」，
               同一组数字一页只留一处属主（用户 2026-09-23：谢绝冗余重复）。 -->
          <p class="mini" style="margin:8px 0">
            <b>模型 {分组.模型} 条</b>（盘上有 {分组.模型有}）·
            <b>附件 {分组.附件} 条</b>（盘上有 {分组.附件有}）
          </p>

          <div class="tblwrap">
            <table class="tbl">
              <thead>
                <tr><th>对象</th><th>类别</th><th>名称</th><th>来源路径</th><th>盘上</th><th>路径定位</th><th>改完落在哪</th></tr>
              </thead>
              <tbody>
                {#each 显示行 as r (r.key + r.来源)}
                  <tr class:hot={r.要留意}>
                    <td class="mono">{r.key}</td>
                    <td>{r.类别}</td>
                    <td class="mono wrap">{r.名称 || '—'}</td>
                    <td class="mono wrap" title={r.来源}>{r.来源}</td>
                    <td>{r.在盘上 ? '有' : '缺'}</td>
                    <td class="mono">{r.命中 || '没定位到'}</td>
                    <td class="mono wrap" title={r.目标}>{r.目标}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          {#if 行.length > 显示上限}
            <p class="mini" style="margin-top:8px">只列前 {显示上限} 行（一共 {行.length} 行）。</p>
          {/if}

          {#if 汇.问题类.length}
            <p class="mini" style="margin-top:10px">
              问题分类：{#each 汇.问题类 as p, i (p.类)}{i ? '、' : ''}{p.类} {p.数} 条{/each}
            </p>
          {/if}
          {#if 汇.贴图数}
            <p class="mini" style="margin-top:6px">
              贴图 {汇.贴图数} 条，盘上缺 {汇.贴图缺} 条（缺的只报告，不动引用）。
            </p>
          {/if}
          </div>
        </details>

        <!-- ============ 该怎么做：一次只问一个问题（设计准则 §三）+ 自动填好（§二） ============
             放在「工程里有什么」之后：先看见素材，再回答一个问题，然后照走法点底栏那颗主按钮。 -->
        {#if 情形 === 'A' && 汇}
          <div class="card pad">
            <div class="row" style="margin:0">
              <span class="row__k">你属于哪种</span>
              <div class="pick">
                <button
                  class="pick__b"
                  type="button"
                  aria-pressed={来路 === '别人包'}
                  title="别人做好打包发过来的工程：里面的路径写的是他机器上的根，本机没有那棵树"
                  onclick={() => 选来路('别人包')}
                >{来路 === '别人包' ? '推荐：' : ''}别人打包的工程</button>
                <button
                  class="pick__b"
                  type="button"
                  aria-pressed={来路 === '本机挪走'}
                  title="文件还在本机，只是不在原来那个目录了"
                  onclick={() => 选来路('本机挪走')}
                >{来路 === '本机挪走' ? '推荐：' : ''}本机的文件被挪了</button>
              </div>
            </div>
            <p class="mini" style="margin:6px 0 0">
              {#if 来路 === '别人包'}
                <b>这么走</b>：下面「路径指向了别的位置」里每个旧根都填好了能用的新位置（工具从工程旁边找的），
                看一眼没问题就点底栏的<b>「原地修好」</b>。
              {:else}
                <b>这么走</b>：先在「更多工具 → 找回挪走的文件」里按文件名把文件找回来；零散的用「逐条指定」。
              {/if}
              <span class="mut">（推荐是工具按扫出来的结果选的，点另一个就按你选的走。）</span>
            </p>
          </div>
        {/if}

        <div class="card pad">
          <div class="row" style="margin-top:12px">
            <span class="row__k">{情形 === 'C' ? '自包含目录' : '写到哪里'}</span>
            <span class="row__v mono wrap" title={输出}>
              {输出 || (情形 === 'C' ? '把 .pmm 拖进来就自动填一个' : '不选 = 原地改，留 .bak')}
            </span>
            {#if 输出手动}
              <span class="chip">你手动定的</span>
            {:else if 情形 === 'C' && 输出}
              <span class="chip chip--a">自动推荐</span>
            {/if}
            <!-- 同一个设置点给"默认 / 自定义"二选一（设计准则 §十.1）。
                 这里的词是「推荐目录」（跟下面按根那处的「推荐值」分开，免得两处重名）。 -->
            <div class="pick">
              <button
                class="pick__b"
                type="button"
                aria-pressed={!输出手动}
                disabled={!推荐输出}
                title="用工具按工程名字荐的那个目录（工程旁边一个 _包）"
                onclick={用推荐输出}
              >用推荐目录</button>
              <button
                class="pick__b"
                type="button"
                aria-pressed={输出手动}
                title="自己挑一个目录（挑过之后工具不再覆盖它）"
                onclick={选输出}
              >我自己选</button>
            </div>
          </div>

          <!-- 老手要的"专家参数"收在这一卡的「更多设置」里（设计准则 §十.2：不外露、不占主线控件数） -->
          <details class="fold fold--sub" open={卡开('更多设置', false)} style="margin-top:8px">
            <summary onclick={() => 切卡('更多设置', 卡开('更多设置', false))}>
              <span class="fold__t">更多设置（老手）</span>
              <span class="fold__sp"></span>
              <span class="fold__n mono">{原地 ? '原地改，留 .bak' : '另存到别处'}</span>
            </summary>
            <div class="fold__body">
              <div class="row">
                <span class="row__k">原地修复</span>
                <label class="chk">
                  <input type="checkbox" bind:checked={原地} /><span class="chk__box"></span>直接改拖进来的那份（改前留 .bak）
                </label>
              </div>
              <p class="mini">
                关掉它才是"另存到别处"（那时必须先选一个输出目录）。默认开着：改的就是你拖进来的那两份。
              </p>
              <div class="acts">
                <button class="btn btn--ghost btn--sm" disabled={!pmm} onclick={导出映射表} title="把这次用的「旧根 → 新位置」和逐条指定写成一份文本，下次照着重跑">
                  <Icon name="ui.export" size={13} />导出映射表（.txt）
                </button>
                <span class="mini mut">快捷键：Ctrl+Enter = 底栏主按钮，Ctrl+Shift+Enter = 试算（不写盘）</span>
              </div>
            </div>
          </details>

          <!-- 落点只在这一处说清（写盘那颗按钮在底栏，页里不再放第二颗） -->
          <p class="mini" style="margin-top:8px">
            {#if 情形 === 'C'}
              包就打在上面这个目录里（工具按工程名字推荐的，<b>想换点「我自己选」</b>），
              里面的 <span class="mono">.pmm</span> / <span class="mono">.emm</span> 就是改好的那一份。
            {:else if 要拖的文件}
              这一处的改动落在 <span class="mono wrap">{要拖的文件}</span>
              {原地 ? '（原地改，改前留 .bak）' : '（另存到这里）'}—— 改完拖这一个进 MMD。
            {:else}
              上面还没选输出目录，参数里也关掉了「原地修复」—— 先补一个落点。
            {/if}
          </p>

          <!-- 主按钮的**必填项**（打包的输出目录）就留在上面这一行、留在常开的卡里：
               抽屉和折叠卡都不许把它藏起来（规范 §十八）。 -->
          {#if 情形 === 'C'}
            <!-- 打包的两种情形（用户 2026-09-23 B6）：**界面显式选**，区别与后果就写在下面 -->
            <div class="row" style="margin-top:10px">
              <span class="row__k">打包成哪种</span>
              <div class="pick">
                <button
                  class="pick__b"
                  type="button"
                  aria-pressed={打包模式 === '本机'}
                  title="自己备份 / 换盘用：包内写本机的绝对路径，在这台机器上双击就能开"
                  onclick={() => (打包模式 = '本机')}
                >本机内打包（默认）</button>
                <button
                  class="pick__b"
                  type="button"
                  aria-pressed={打包模式 === '配布'}
                  title="发给别人用：包内写相对包根的路径（不带盘符），另附一份配布说明"
                  onclick={() => (打包模式 = '配布')}
                >配布打包</button>
              </div>
            </div>
            <p class="mini" style="margin-top:6px">
              {#if 打包模式 === '配布'}
                <b>配布打包</b>：包内写的是<b>相对这个文件夹</b>的路径（一个盘符都不带），随你放到哪个盘都指得对；
                包里另附一份「配布说明.txt」给接收方。拷什么、放什么结构，跟本机内打包一样。
              {:else}
                <b>本机内打包</b>：包内写的是本机的绝对路径 —— <b>只在这台机器上能直接开</b>；
                换台机器、或者把包挪到别的盘符，路径就全指空（那时得用「修复工程」重指一遍）。
              {/if}
            </p>
            <div class="kv" style="margin-top:8px">
              <div class="kv__r"><span>拷贝 / 搬走</span><span>拷贝（保留原件）—— 打包只有这一条</span></div>
              <div class="kv__r"><span>包里的结构</span><span>按旧的相对结构放，不平铺</span></div>
              <div class="kv__r"><span>本来就指对的路径</span><span>也进包（连旁边的邻居一起拷）</span></div>
              <div class="kv__r"><span>重名冲突</span><span>{根结果 ? `${(根结果.重名冲突 ?? []).length} 个` : '还没打包'}</span></div>
            </div>
            <p class="mini" style="margin-top:6px">
              要连原件一起挪走（移动那种），去「修复工程」的「把文件也一起搬过去」—— 打包这条路不删任何原件。
            </p>
          {/if}
        </div>

        {#if 有死根}
          <!-- 根替换：真工程的路径常指向**别的机器上的根**（本机没有那个盘），
               这时"按文件名指到一个目录"是错的（模型散在多个目录、贴图就在模型旁边，
               平铺会把贴图引用打断）。正解是整段换根、保留相对结构。
               §十八：区块卡 = 一件事，标题右边给"旧根几个 / 填了几个"的读数。 -->
          <details class="fold" open={卡开('旧根', 有死根)}>
            <summary onclick={() => 切卡('旧根', 卡开('旧根', 有死根))}>
              <span class="fold__t">路径指向了别的位置</span>
              <span class="fold__sp"></span>
              <span class="fold__n">{读数根}</span>
            </summary>
            <div class="fold__body">
            <p class="mini">
              这些<b>旧根</b>本机没有文件（那是别人机器上的位置）。工具已经<b>按工程旁边能找到的文件</b>
              替你填好了新位置 —— 看一眼没问题就点底栏的「原地修好」。
              {#if 好的根数}<span class="mut">另有 {好的根数} 个根本机就有，不用改。</span>{/if}
            </p>
            <ul class="list" style="margin-top:8px">
              {#each 要改的根 as g (g.根)}
                <li>
                  <span class="mono">{g.根}</span>
                  <span class="mini mut nowrap">{g.条数} 条 · 本机有 {g.在盘条数}</span>
                  <span class="list__sp"></span>
                  <!-- 同一个设置点给"默认 / 自定义"二选一（设计准则 §十.1）：
                       默认＝用工具找的推荐值；自定义＝自己填，填过之后不再被自动覆盖 -->
                  <div class="pick">
                    <button
                      class="pick__b"
                      type="button"
                      aria-pressed={!是手动的(g)}
                      title="用工具从工程旁边找到的那个目录"
                      onclick={() => 用推荐根(g)}
                    >用推荐值</button>
                    <button
                      class="pick__b"
                      type="button"
                      aria-pressed={是手动的(g)}
                      title="我自己填一个新位置（填过之后工具不再覆盖它）"
                      onclick={() => 自己填根(g)}
                    >我自己填</button>
                  </div>
                  {#if 是手动的(g)}
                    <span class="chip">你手动定的</span>
                  {/if}
                  <input
                    type="text"
                    style="width:20rem"
                    placeholder="点「我自己填」在这里写，或直接用左边的推荐值"
                    title="这个旧根现在该指向哪个目录，例如 E:\…\UserFile"
                    value={g.建议}
                    aria-label="给 {g.根} 指定新根"
                    oninput={(e) => 改根(g, e.currentTarget.value)}
                  />
                  {#if g.建议}
                    <span class="mini nowrap" class:bad={!是手动的(g) && g.建议命中 < g.条数}>
                      {#if 是手动的(g)}（你自己填的）{:else}对上 {g.建议命中}/{g.条数}{/if}
                    </span>
                  {/if}
                </li>
              {/each}
            </ul>
            <p class="mini" style="margin:6px 0 0">
              <b>推荐值怎么来的</b>：从工程目录往上找，旁边一层里有能按名字对上的文件就填上（右边「对上 N/M」是它对上几条）。
              想自己定就点「我自己填」再写 —— <b>改过之后工具不再覆盖它</b>，并且标上「你手动定的」。
            </p>
            {#if 根结果}
              <div class="kv" style="margin-top:10px">
                <div class="kv__r"><span>.pmm 长度</span><span>{根结果.原先pmm长度} → {根结果.pmm长度}</span></div>
                <div class="kv__r"><span>.pmm 改字段 / .emm 改行</span><span>{根结果.pmm改字段} / {根结果.emm改行}</span></div>
                <div class="kv__r">
                  <span>盘上回读：旧根残留</span>
                  <span>{根结果.旧根残留.reduce((a, [, n]) => a + n, 0)} 次</span>
                </div>
                <div class="kv__r">
                  <span>盘上回读：新根出现</span>
                  <span>{根结果.新根出现.reduce((a, [, n]) => a + n, 0)} 次</span>
                </div>
              </div>
            {/if}
            </div>
          </details>
        {/if}

        <!-- ============ 更多工具（规范 §7.2 / §十八：一次性、进阶、排查类动作全在这儿，默认收起） ============
             **「找回挪走的文件」在这里、两个区都有**（用户 2026-09-23 B3：它原来只作为修复区的一级卡，
             打包区根本没有入口，用户实测找不到）。有未落定时这条默认展开，省得新手去找。 -->
        <details class="more" open={卡开('更多工具', 没落定.length > 0)}>
          <summary onclick={() => 切卡('更多工具', 卡开('更多工具', 没落定.length > 0))}>
            更多工具：找回挪走的文件 / 重置工程{情形 === 'A' ? ' / 按目录名整批改 / 把文件搬过去' : ''}
          </summary>
          <div class="more__body">
          <!-- 找回挪走的文件：**两个区共用同一块**（打包前也要能先把缺的文件指回来） -->
          <div class="card pad">
            <div class="acts" style="margin-bottom:8px">
              <h3 class="h3" style="margin:0">找回挪走的文件</h3>
              <span class="tag">{读数检索}</span>
              <span class="acts__sp"></span>
              <button class="btn btn--ghost btn--sm" disabled={检索忙} onclick={加起点}>
                <Icon name="ui.folder" size={13} />加搜索起点…
              </button>
              <button
                class="btn"
                disabled={检索忙 || !起点们.length}
                onclick={跑检索}
              ><Icon name="ui.search" size={13} />{检索忙 ? '找…' : '开始找'}</button>
              {#if 检索忙}
                <button class="btn btn--ghost btn--sm" onclick={停检索}>停手</button>
              {/if}
            </div>
            <p class="mini">
              文件被挪到哪个目录，就把「加搜索起点…」指到那个目录（<b>可以加好几个</b>：模型在一个目录、
              特效在另一个盘，分开加就行）。<b>整盘那种起点不会去扫</b> —— 范围太大时工具会直接说
              "范围太大，请给更具体的起点"，界面不会卡住。
            </p>
            {#if 检索忙}
              <p class="mini mono" style="margin-top:6px">{检索进度 || '开始找…'}</p>
            {/if}
            {#if 起点们.length}
              <ul class="list" style="margin-top:6px">
                {#each 起点们 as d, i (d)}
                  <li>
                    <span class="mono mini">{d}</span>
                    <span class="list__sp"></span>
                    <button class="btn btn--ghost btn--sm" onclick={() => 去起点(i)}>去掉</button>
                  </li>
                {/each}
              </ul>
            {/if}

            {#if 检索表.length}
              <div class="acts" style="margin-top:8px">
                <span class="tag" class:tag--ok={!检索没找.length}>
                  唯一找到 {检索唯一.length} · 多个候选 {检索多个.length} · 没找到 {检索没找.length}
                </span>
                <span class="acts__sp"></span>
                <button class="btn btn--ghost btn--sm" disabled={!检索唯一.length || 表忙} onclick={采用全部唯一}>
                  采用全部唯一找到的
                </button>
              </div>
              <ul class="list" style="margin-top:8px; max-height:24rem">
                {#each 检索表 as r (r.原路径)}
                  <li>
                    <span class="mini nowrap" class:good={r.状态 === '已唯一找到'} class:bad={r.状态 === '没找到'}>{r.状态}</span>
                    <span class="mono nowrap">{r.文件名}</span>
                    {#if r.建议}
                      <span class="list__sp mini mut" title={r.建议}>{r.建议}</span>
                      <button class="btn btn--sm" disabled={表忙} onclick={() => 采用(r, r.建议)}>采用</button>
                    {:else}
                      <span class="list__sp mini mut">{r.备注}</span>
                      {#if r.候选.length}
                        <button class="btn btn--ghost btn--sm" onclick={() => (展开候选 = { ...展开候选, [r.原路径]: !展开候选[r.原路径] })}>
                          {展开候选[r.原路径] ? '收起候选' : `挑一个（${r.候选.length}）`}
                        </button>
                      {/if}
                    {/if}
                    {#if 展开候选[r.原路径]}
                      <ul class="list" style="margin-top:4px">
                        {#each r.候选.slice(0, 20) as c (c)}
                          <li>
                            <span class="mini mono">{c}</span>
                            <span class="list__sp"></span>
                            <button class="btn btn--ghost btn--sm" disabled={表忙} onclick={() => 采用(r, c)}>用这条</button>
                          </li>
                        {/each}
                      </ul>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </div>

          <!-- 重置 vs 撤销：两句话放同一块，别让人猜 -->
          <div class="card pad" style="margin-top:12px">
            <div class="acts" style="margin-bottom:8px">
              <h3 class="h3" style="margin:0">重置工程</h3>
              <span class="acts__sp"></span>
              {#if 重置问}
                <span class="mini">确定复位？清的是界面上的映射，盘上一个字节都不动。</span>
                <button class="btn btn--ghost btn--sm" disabled={重置忙 || 扫中 || 忙} onclick={重置工程}>确定重置</button>
                <button class="btn btn--ghost btn--sm" onclick={() => (重置问 = false)}>取消</button>
              {:else}
                <button
                  class="btn btn--ghost btn--sm"
                  disabled={重置忙 || 扫中 || 忙 || !pmm || !emm}
                  onclick={() => (重置问 = true)}
                ><Icon name="ui.refresh" size={13} />重置工程</button>
              {/if}
            </div>
            <p class="mini">
              <b>重置</b>＝清掉界面上的映射（勾选、逐条指定、输出目录、搜索起点），<b>不动文件</b>；
              <b>撤销上一次处理</b>＝把上一次写盘反着做，<b>动文件</b>。这两件事不是一回事。
            </p>
          </div>

          {#if 情形 === 'A'}
          <!-- 老路子：按文件名把路径指到「新模型/新附件目录」再保存。
               跟主线的按根替换是两条腿 —— 所以它待在工具区，不跟底栏那颗主按钮抢位置。
               设计准则 §十.2：批量/脚本向的东西收进**展开区**，默认不占主线控件数
               （标题右边给"能指到几个目录"的读数，收起也知道要不要展开）。 -->
          <details class="fold" open={卡开('按目录名', false)}>
            <summary onclick={() => 切卡('按目录名', 卡开('按目录名', false))}>
              <span class="fold__t">按目录名整批改（老手：按文件名一次指过去）</span>
              <span class="fold__sp"></span>
              <span class="fold__n mono">
                模型 {(扫?.模型目录 ?? []).length} 个目录 · 附件 {(扫?.附件目录 ?? []).length} 个
              </span>
            </summary>
            <div class="fold__body">
            <div class="card pad">
            <div class="acts" style="margin-bottom:8px">
              <span class="mini">文件散在几个已知目录里、想按文件名一次指过去时用它。</span>
              <span class="acts__sp"></span>
              {#if 按目录名问}
                <span class="mini">
                  确定写盘？会改 .pmm 与同名 .emm 里按目录名对上的那些路径{要改的名.length
                    ? `，并改 ${要改的名.length} 个模型名`
                    : ''}（原位各留一份 .bak）。
                </span>
                <button class="btn btn--ghost btn--sm" disabled={忙} onclick={() => 跑搬家(false)}>确定写盘</button>
                <button class="btn btn--ghost btn--sm" onclick={() => (按目录名问 = false)}>取消</button>
              {:else}
                <button class="btn btn--ghost btn--sm" disabled={忙 || !扫} onclick={() => 跑搬家(true)}>
                  <Icon name="ui.refresh" size={13} />试算（按目录名）
                </button>
                <button class="btn" disabled={忙 || !扫} onclick={() => (按目录名问 = true)}>
                  <Icon name="ui.export" size={13} />{忙 ? '处理中…' : '按目录名改并保存'}
                </button>
              {/if}
            </div>
            <p class="mini">
              什么时候用它：文件散在几个已知目录里、想按文件名一次指过去的时候。
              新位置还没那些文件的话会被拒绝，不会改一半。
            </p>
            <div class="dirs">
              <div class="dirbox">
                <span class="mini"><b>模型</b>的路径指向</span>
                {#each (扫?.模型目录 ?? []).slice(0, 6) as g (g.目录)}
                  <div class="dirl">
                    <span class="mono wrap" title={g.目录}>{g.目录 || '（没有目录）'}</span>
                    <span class="mini mut">{g.条数} 个（盘上 {g.有}）</span>
                    <!-- 「用这个」原来是死的：它填的是**路径现在指着的那个目录**，
                         单组工程上填完等于什么都没变。现在只在"这个目录里真有文件"时给，
                         并且点完直接试算一遍，让人当场看到效果。 -->
                    {#if g.有 > 0}
                      <button
                        class="btn btn--ghost btn--sm"
                        disabled={新模型目录 === g.目录}
                        title="把模型的路径指到这个目录（按文件名找）"
                        onclick={async () => {
                          新模型目录 = g.目录;
                          await 跑搬家(true);
                        }}>{新模型目录 === g.目录 ? '已选' : '用这个当新位置'}</button>
                    {/if}
                  </div>
                {/each}
                {#if !(扫?.模型目录 ?? []).length}
                  <p class="mini mut" style="margin-top:6px">这个工程没有模型条目。</p>
                {/if}
                <div class="row" style="margin-top:6px">
                  <span class="row__k">新模型目录</span>
                  <span class="row__v mono wrap" title={新模型目录}>{新模型目录 || '没填'}</span>
                  <button class="btn btn--ghost btn--sm" onclick={() => 选新目录('模型')}>选目录</button>
                </div>
              </div>
              <div class="dirbox">
                <span class="mini"><b>附件</b>的路径指向</span>
                {#each (扫?.附件目录 ?? []).slice(0, 6) as g (g.目录)}
                  <div class="dirl">
                    <span class="mono wrap" title={g.目录}>{g.目录 || '（没有目录）'}</span>
                    <span class="mini mut">{g.条数} 个（盘上 {g.有}）</span>
                    {#if g.有 > 0}
                      <button
                        class="btn btn--ghost btn--sm"
                        disabled={新附件目录 === g.目录}
                        title="把附件的路径指到这个目录（按文件名找）"
                        onclick={async () => {
                          新附件目录 = g.目录;
                          await 跑搬家(true);
                        }}>{新附件目录 === g.目录 ? '已选' : '用这个当新位置'}</button>
                    {/if}
                  </div>
                {/each}
                {#if !(扫?.附件目录 ?? []).length}
                  <p class="mini mut" style="margin-top:6px">这个工程没有附件条目。</p>
                {/if}
                <div class="row" style="margin-top:6px">
                  <span class="row__k">新附件目录</span>
                  <span class="row__v mono wrap" title={新附件目录}>{新附件目录 || '没填（没有附件也没关系）'}</span>
                  <button class="btn btn--ghost btn--sm" onclick={() => 选新目录('附件')}>选目录</button>
                </div>
              </div>
            </div>

            <!-- 模型名称：参考工具那页就有"名称 + 路径"，这里也让它能看能改。
                 只放行**等长**改名（实测 8/8 工程上改长度会让本工具的结构自检失效）。 -->
            {#if 行.some((r) => r.类别 === '模型')}
              <details class="fold fold--sub" open={卡开('模型名称', false)}>
                <summary onclick={() => 切卡('模型名称', 卡开('模型名称', false))}>
                  <span class="fold__t">模型名称</span>
                  <span class="fold__sp"></span>
                  <span class="fold__n">{读数名}</span>
                  {#if 要改的名.length}<span class="tag tag--ok">{要改的名.length} 条要改</span>{/if}
                </summary>
                <div class="fold__body">
                <p class="mini" style="margin:6px 0">
                  只能改成<b>同样字节数</b>的名字（括号里是字节数，中日文一个字 2 字节）。
                </p>
                {#each 行.filter((r) => r.类别 === '模型') as r (r.key)}
                  <div class="namerow">
                    <span class="mono namerow__k">{r.key}</span>
                    <input
                      class="namerow__in"
                      type="text"
                      placeholder={r.名称 || '（没名字）'}
                      value={改名[r.key] ?? ''}
                      aria-label="改 {r.key} 的名字"
                      oninput={(e) => (改名 = { ...改名, [r.key]: e.currentTarget.value })}
                    />
                    <span class="mini mut nowrap">
                      原 {字节数(r.名称)} 字节
                      {#if 改名[r.key] && 改名[r.key] !== r.名称}
                        　→ 新 {字节数(改名[r.key])} 字节
                        {#if 字节数(改名[r.key]) !== 字节数(r.名称)}<b class="bad"> 不等长</b>{/if}
                      {/if}
                    </span>
                  </div>
                {/each}
                </div>
              </details>
            {/if}
            </div>
            </div>
          </details>

          <!-- 搬运：**真的把文件搬/拷过去**（可以多组目标位置），再改路径。
               设计准则 §十.2：老手向的批量动作收进展开区。 -->
          <details class="fold" open={卡开('搬运', false)}>
            <summary onclick={() => 切卡('搬运', 卡开('搬运', false))}>
              <span class="fold__t">把文件也一起搬过去（老手：真的挪文件）</span>
              <span class="fold__sp"></span>
              <span class="fold__n mono">{要搬的组.length} 组选好了目标位置</span>
            </summary>
            <div class="fold__body">
            <div class="card pad">
            <div class="acts" style="margin-bottom:8px">
              <span class="mini">先给每组文件挑一个目标位置，再改路径并保存。</span>
              <span class="acts__sp"></span>
              <div class="pick">
                <button class="pick__b" type="button" aria-pressed={搬运方式 === '拷'}
                  onclick={() => (搬运方式 = '拷')}>拷贝（保留原件）</button>
                <button class="pick__b" type="button" aria-pressed={搬运方式 === '搬'}
                  onclick={() => (搬运方式 = '搬')}>移动（删原件）</button>
              </div>
              <button class="btn btn--ghost btn--sm" disabled={搬运忙 || !要搬的组.length} onclick={() => 跑搬运(true)}>
                <Icon name="ui.refresh" size={13} />试算（搬运）
              </button>
              {#if 搬运问}
                <span class="mini">
                  确定{搬运方式 === '搬' ? '搬走（会删原件）' : '拷一份'}？这 {要搬的组.length} 组里工程引用的那些文件会真的
                  {搬运方式 === '搬' ? '搬' : '拷'}过去，然后改 .pmm 与 .emm 里的路径。
                </span>
                <button class="btn btn--ghost btn--sm" disabled={搬运忙} onclick={() => 跑搬运(false)}>确定，开始搬</button>
                <button class="btn btn--ghost btn--sm" onclick={() => (搬运问 = false)}>取消</button>
              {:else}
                <button class="btn" disabled={搬运忙 || !要搬的组.length} onclick={() => (搬运问 = true)}>
                  <Icon name="ui.export" size={13} />{搬运忙 ? '搬…' : '搬运并改路径'}
                </button>
              {/if}
            </div>
            <p class="mini">先给每一组文件点「放到…」挑一个目标位置（可以多组）。默认拷贝，原件留着。</p>
            <ul class="list" style="margin-top:8px; max-height:22rem">
              {#each 根们 as g (g.根)}
                <li>
                  <span class="wrapany mono mini">{g.根}</span>
                  <span class="mini mut nowrap">{g.条数} 条</span>
                  <span class="list__sp"></span>
                  <button class="btn btn--ghost btn--sm" disabled={搬运忙} onclick={() => 选搬运目标(g.根)}>放到…</button>
                  {#if 目标到[g.根]}
                    <span class="wrapany mini good">{目标到[g.根]}</span>
                    <button class="btn btn--ghost btn--sm" disabled={搬运忙}
                      onclick={() => {
                        const m = { ...目标到 };
                        delete m[g.根];
                        目标到 = m;
                      }}>清掉</button>
                  {/if}
                </li>
              {/each}
            </ul>
            {#if 搬运结果}
              <div class="kv" style="margin-top:10px">
                <div class="kv__r">
                  <span>{搬运是干跑 ? '试算会拷（只数工程引用的那些）' : '拷过去（连模型旁边的贴图一起）'}</span>
                  <span>{搬运结果.拷贝文件} 个 / {(搬运结果.拷贝字节 / 1048576).toFixed(1)} MB</span>
                </div>
                {#if 搬运结果.删除文件}
                  <div class="kv__r">
                    <span>删掉的原件（只删工程引用的那些）</span>
                    <span>{搬运结果.删除文件} 个</span>
                  </div>
                {/if}
              </div>
            {/if}
            </div>
            </div>
          </details>
          {/if}
          </div>
        </details>

        {#if 情形 === 'A' && 路径表.length}
          <!-- 逐条指定：文件**一个个挪到不同地方**时用这层（跟"按根批量"叠加；
               用户指定过的那条永远压过根规则）。§十八：区块卡，**有未落定就自动展开**；
               标题右边那个标签就是"没落定 N"的唯一属主。 -->
          <details class="fold" open={卡开('逐条', 没落定.length > 0)}>
            <summary onclick={() => 切卡('逐条', 卡开('逐条', 没落定.length > 0))}>
              <span class="fold__t">逐条指定</span>
              <span class="fold__sp"></span>
              <span class="tag" class:tag--ok={!没落定.length}>
                {没落定.length ? `还有 ${没落定.length} 条没落定` : `${已落定} 条全部落定`}
              </span>
            </summary>
            <div class="fold__body">
            <div class="acts" style="margin-bottom:8px">
              <input type="text" placeholder="按键/路径过滤" style="width:12rem" bind:value={路径过滤} aria-label="过滤路径行" />
              <button class="btn btn--ghost btn--sm" disabled={表忙} onclick={刷新路径表}>
                <Icon name="ui.refresh" size={13} />重算
              </button>
            </div>
            <p class="mini">文件一个一个挪散了的时候，在这里一条条指（你指定过的那条压过上面的按根结论）。</p>
            <!-- 勾选 + 批量：用户原话"展示定位的位置可以单选或多选改变选中的文件"。
                 批量只改映射，不直接动盘；写盘仍走底部那一个主按钮。 -->
            <div class="acts" style="margin-top:8px">
              <span class="mini mut">勾选：</span>
              <button class="btn btn--ghost btn--sm" disabled={!可见行.length} onclick={() => 全勾(true)}>全选（当前列出的）</button>
              <button class="btn btn--ghost btn--sm" disabled={!勾数} onclick={() => 全勾(false)}>取消勾选</button>
              <span class="tag" class:tag--ok={!勾数}>{勾数 ? `勾中 ${勾数} 条` : '没勾'}</span>
              <span class="acts__sp"></span>
              <button class="btn btn--ghost btn--sm" disabled={!勾数 || 表忙} onclick={批量指定目录}>批量指定目录…</button>
              <button class="btn btn--ghost btn--sm" disabled={!勾数 || 表忙} onclick={批量改根}>批量改新根…</button>
              <button class="btn btn--ghost btn--sm" disabled={!勾数 || 表忙} onclick={批量清指定}>批量清除指定</button>
            </div>
            <ul class="list" style="margin-top:8px; max-height:26rem">
              {#each 路径表.filter((r) => !路径过滤 || r.原路径.includes(路径过滤) || r.键.includes(路径过滤)).slice(0, 200) as r (r.段 + '|' + r.键 + '|' + r.原路径)}
                <li>
                  <label class="chk" title="勾上它，用上面的批量按钮一起改">
                    <input type="checkbox" checked={!!勾选[r.原路径]} onchange={() => 切勾(r.原路径)} aria-label="勾选 {r.键}" />
                    <span class="chk__box"></span>
                  </label>
                  <span class="mono nowrap">{r.键}</span>
                  <span class="mini mut nowrap">[{r.段}]</span>
                  <span
                    class="mini nowrap"
                    class:bad={r.状态 === '需要指定' || r.状态 === '找不到'}
                    class:good={r.状态 !== '需要指定' && r.状态 !== '找不到'}
                  >{r.状态}</span>
                  <span class="list__sp mini mut" title={r.目标 || r.原路径}>
                    <span class="mut">原：</span>{r.原路径}
                    {#if r.目标 && r.目标 !== r.原路径}
                      <br /><span class="mut">现在在哪：</span><b>{r.目标}</b>
                    {/if}
                  </span>
                  {#if 逐条[r.原路径]}
                    <button
                      class="btn btn--ghost btn--sm"
                      disabled={表忙}
                      title="这条是你手动指定的；清掉之后它会回到按根的结论"
                      onclick={() => {
                        const m = { ...逐条 };
                        delete m[r.原路径];
                        逐条 = m;
                        void 刷新路径表();
                      }}>清除指定</button>
                  {/if}
                  <button class="btn btn--ghost btn--sm" disabled={表忙} onclick={() => 指定文件(r)}>指定文件…</button>
                  <button class="btn btn--ghost btn--sm" disabled={表忙} onclick={() => 指定目录(r)}>指定目录…</button>
                </li>
              {/each}
            </ul>
            </div>
          </details>
        {/if}
      {/if}

      {#if 搬家干跑 || 搬家做完}
        {@const m = (搬家做完 ?? 搬家干跑) as 工程搬家结果}
        <div class="card pad">
          <h3 class="h3">{搬家做完 ? '做完了' : '试算结果（没写盘）'}</h3>
          <p class="mini">
            {m.表.length} 条对象，改了 {m.改了几处} 处路径，新位置还差 {m.表.filter((x) => !x.新位置有).length} 条。
            {#if m.输出}写到了 <span class="mono">{m.输出}</span>。{/if}
          </p>
          <table class="tbl" style="margin-top:8px">
            <thead><tr><th>对象</th><th>类别</th><th>旧路径</th><th>新路径</th><th>新位置</th><th>处置</th><th>定位</th></tr></thead>
            <tbody>
              {#each m.表.slice(0, 60) as r (r.key + r.旧)}
                <tr class:hot={r.处置 === '找不到' || !r.定位}>
                  <td class="mono">{r.key}</td>
                  <td>{r.类别}</td>
                  <td class="mono wrap" title={r.旧}>{r.旧}</td>
                  <td class="mono wrap" title={r.新}>{r.新}</td>
                  <td>{r.新位置有 ? '有' : '缺'}</td>
                  <td>{r.处置}</td>
                  <td class="mono">{r.定位 || '没定位到'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      <!-- ============ 说明与注意事项（规范 §二：长说明只放这一处 + 顶栏，默认收起） ============ -->
      <details class="notes" open={卡开('说明', false)}>
        <summary onclick={() => 切卡('说明', 卡开('说明', false))}>说明与注意事项</summary>
        <div class="notes__body mini">
          <h4>你属于哪种来路（修复工程）</h4>
          <ul>
            <li><b>别人打包的工程</b>（下载来的、别人机器上做的）：工程里写的是<b>别人机器上的根</b>
              （`D:\…`、`H:\…` 那种），本机没有那棵树 → 用「路径指向了别的位置」给每个旧根填一个本机目录，
              工具整段换根、保留相对结构。</li>
            <li><b>本机的工程文件被挪了位置</b>（自己盘里搬过目录）：文件还在本机，只是不在原来那个目录 →
              用「更多工具 → 找回挪走的文件」按文件名找回，或用「逐条指定」一条条指。</li>
            <li>拿不准就先点「扫描」，工具按扫出来的事实替你选一种（上面那排「你属于哪种」会跟着动）。</li>
          </ul>

          <h4>找回挪走的文件（在「更多工具」里，两个区都有）</h4>
          <ul>
            <li>搜索起点<b>可以加好几个</b>：模型放一个目录、特效放另一个盘，分开加就行。</li>
            <li>递归<b>有上限</b>（层数 / 条目数 / 时间三条线）。选到 `D:\` 这种整盘起点时<b>不会硬扫</b>：
              直接报「<b>范围太大，请给更具体的起点</b>」，界面不会卡住，盘也一个字节没动。</li>
            <li>找的过程界面能看进度、也能点「停手」；停手之后盘上不会有半份结果。</li>
            <li>唯一最优的才给建议；并列的一律列候选让人挑 —— 猜错就是把工程指向别人的同名文件。</li>
          </ul>

          <h4>这一页四条路</h4>
          <ul>
            <li><b>只改路径</b>：文件都在盘上别的地方，把工程里的路径指过去（不拷、不动你的文件）。</li>
            <li><b>找回文件</b>：文件被挪走、不知道在哪儿，给几个搜索起点，工具按文件名找回来；拿不准就列候选让你挑。</li>
            <li><b>搬过去</b>：把文件真的搬/拷到你指定的位置（可以多组目标），再把路径改过去并保存。</li>
            <li><b>做成自包含</b>：把工程用到的所有文件连同 .pmm/.emm 拷到一个目录（在「打包迁移」区）。</li>
          </ul>

          <h4>打包的两种：本机内 / 配布</h4>
          <ul>
            <li><b>本机内打包</b>（自己备份 / 换盘）：包内两份工程文件写的是<b>包内的本机绝对路径</b> ——
              在这台机器上双击包里的 `.pmm` 就能开。<b>换台机器、或把包挪到别的盘符，路径就全指空。</b></li>
            <li><b>配布打包</b>（发给别人）：包内写的是<b>相对包根</b>的路径（`.\模型\x.pmx`，一个盘符都不带），
              还附一份「配布说明.txt」给接收方。这样别人放在哪个盘、哪个目录都指得对。</li>
            <li><b>有一条没验过，照实说</b>：相对路径这种写法，本工具在包里逐条核对过"都指在包内"，
              <b>没有在真 MMD 上逐个版本验过</b>。接收方那边打开时如果 MMD 问路径，就指到包里对应的那一份；
              或者让他用这一页的「修复工程」重指一遍。拿不准就用本机内打包 + 让对方走「修复工程」。</li>
            <li>两种模式拷的东西、放的结构完全一样，只有"包内路径怎么写"这一处不同。</li>
          </ul>

          <h4>写盘这一侧的规矩</h4>
          <ul>
            <li>一律<b>先出表、确认了才写盘</b>；写盘前后都会<b>回读核对</b>（新路径没落进文件、旧路径还留着就报错）。</li>
            <li>有一条路径定位不到、或换完之后在盘上找不到文件，就<b>整体拒绝</b>，不"尽力而为"。</li>
            <li>缺文件<b>只报告</b>，不替你删条目（那会动工程结构，风险比不修大）。</li>
            <li>目标路径落在测试/临时目录（<span class="mono">测试效果</span> / <span class="mono">%TEMP%</span> / <span class="mono">\tmp\</span> …）一律拒绝。</li>
          </ul>

          <h4>试算和真跑数的不是一回事</h4>
          <ul>
            <li><b>试算</b>只数"工程真正引用的那几个文件"，不碰盘。</li>
            <li><b>真跑</b>要<b>连模型旁边的东西一起拷</b>（贴图就在模型旁边，只拷 .pmx 会把贴图引用打断），所以真跑的个数会明显比试算多。</li>
          </ul>

          <h4>「搬」模式：只删工程真正引用的那些文件</h4>
          <ul>
            <li>搬模式<b>逐个字节核对相同之后</b>才删原件。</li>
            <li>它只删<b>工程引用的文件</b>，同一目录里那些没被引用的"邻居"留着不动 —— 这是安全方向：
              宁可在旧地方剩一堆邻居副本，也不许"因为引用了一个文件就把整棵共享目录删掉"。</li>
          </ul>

          <h4>包里的目录长什么样（两种模式一样）</h4>
          <ul>
            <li>按<b>旧的相对结构</b>保留（照旧根的尾巴放），<b>不把素材平铺</b> —— 平铺会把模型旁边的贴图引用打断。</li>
            <li><b>本来就指对的路径也进包</b>（连它旁边的邻居一起拷，尾部用「目录名\文件名」）——
              所以"工程本来就健康、只想打个包"也能直接用：一条映射都不用填。</li>
            <li>不同目录下同名文件内容不同时会<b>整体拒绝</b>并列出是哪几处 —— 换个空目录，或先把同名的那几个改名。</li>
            <li>收尾给的"要拖进 MMD 的文件"永远是包里的那一个 .pmm。</li>
            <li>包里工程文件的路径写法只有一处区别：<b>本机内=包内绝对路径</b>、<b>配布=相对包根</b>。</li>
          </ul>

          <h4>重置和撤销不是一回事</h4>
          <ul>
            <li><b>重置</b>（在「更多工具」里）＝把<b>界面</b>复位：清掉按根映射、逐条指定、勾选、输出目录、搜索起点，
              然后重新扫一遍 —— 回到"刚把 .pmm 拖进来"的样子，<b>盘上一个字节都不动</b>（没有 .bak、没有回读核对）。
              源文件被挪走或删掉时会直接报错并指出是哪一份，不会装成"工程是空的"。</li>
            <li><b>撤销上一次处理</b>（底栏）＝把<b>上一次写盘</b>反着做 —— 就地改的写回改前那份、拷出去的副本删掉、
              搬模式删过原件的把原件搬回原位。<b>它会动文件</b>。</li>
          </ul>

          <h4>撤销</h4>
          <ul>
            <li>每次会写盘的操作都<b>落一份操作记录</b>（时间、动了哪些文件、原位置、新位置），并<b>整份存下改前的 .pmm/.emm</b>。</li>
            <li>「撤销上一次处理」照它反着做：就地改的写回改前那份；拷出去的副本删掉；搬模式删过原件的<b>把原件搬回原位</b>。</li>
            <li>撤销也<b>先出表</b>（会动哪些文件、是删副本还是搬回原件）、<b>确认了才执行</b>，执行完<b>回读核对</b>。</li>
            <li>没有记录就不许撤销；撤过一次之后就不能再撤（只做"上一次"）。</li>
            <li>记录放在 <span class="mono">%APPDATA%\com.robineditor.app\undo\</span>，留最近 30 次。</li>
          </ul>

          <h4>MMD 那一侧</h4>
          <ul>
            <li>特效分配在 <b>.emm</b> 里，<b>MMD 打开工程不会自动读 .emm</b> —— 要单独载入（效果分配 → 载入）。</li>
            <li>动作用户自己上：工程里没有 VMD 路径，动作数据是嵌在 .pmm 里的，所以换路径时一字节都不会碰帧区。</li>
          </ul>
        </div>
      </details>

      {#if 撤销报告}
        <div class="card pad">
          <h3 class="h3">{撤销报告.干跑 ? '撤销会做这些（没动手）' : '撤销做完了'}</h3>
          <ul class="list" style="max-height:20rem">
            {#each 撤销报告.条目 as e (e.做什么 + e.从 + e.到)}
              <li>
                <span class="chip">{e.做什么}</span>
                <span class="wrapany mono mini" title={e.从}>{e.从}</span>
                {#if e.到}<span class="mini mut">→</span><span class="wrapany mono mini" title={e.到}>{e.到}</span>{/if}
                {#if e.备注}<span class="list__sp mini mut">{e.备注}</span>{/if}
              </li>
            {/each}
          </ul>
          {#if 撤销报告.问题.length}
            <ul class="mini ul" style="margin-top:8px">
              {#each 撤销报告.问题 as p (p)}<li class="bad">{p}</li>{/each}
            </ul>
          {/if}
          {#if 撤销报告.回读.length}
            <p class="mini" style="margin-top:8px">回读核对：</p>
            <ul class="mini ul">
              {#each 撤销报告.回读 as p (p)}<li class="wrapany">{p}</li>{/each}
            </ul>
          {/if}
          {#if 撤销报告.干跑}
            <div class="acts" style="margin-top:10px">
              <button class="btn" disabled={撤销忙 || 撤销报告.问题.length > 0} onclick={() => void 跑撤销(false)}>
                <Icon name="ui.check" size={14} />确认撤销
              </button>
              {#if 撤销报告.问题.length}
                <span class="mini bad">预检没过（{撤销报告.问题.length} 条）—— 先解决再撤销，一个字都没动。</span>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <aside class="card wb__side">
      <!-- 参数抽屉（规范 §十一）：从右侧滑出、盖在中区之上、**默认收起**。
           只有用户自己点「钉住」才占一列宽度。任何解释、注意事项都不许堆在这里。 -->
      <div class="wb__grip" role="separator" aria-label="拖动调整参数抽屉宽度" onpointerdown={拖把手}></div>
      <div class="grp">
        <div class="acts">
          <h3 class="grp__t" style="margin:0">参数</h3>
          <span class="acts__sp"></span>
          <button
            class="btn btn--ghost btn--sm"
            aria-pressed={side.pin}
            onclick={切钉}
            title="钉住＝让它占一列宽度（默认不钉，浮在上面不挤压工作区）"
          ><Icon name="ui.lock" size={13} />{side.pin ? '已钉住' : '钉住'}</button>
          <button class="btn btn--ghost btn--sm" onclick={() => 开抽屉(false)} title="收起来">
            <Icon name="ui.close" size={13} />收起
          </button>
        </div>
      </div>
      {#if 情形 === 'A'}
        <!-- 抽屉只放**主区没有的**控件。
             「原地修复」原来是这里的唯一一项，现在按设计准则 §十.2 搬进主区「写到哪里」那张卡的
             「更多设置（老手）」里 —— 专家参数收在**它自己那张卡**的展开区，而不是另一个抽屉，
             新手看不见它，老手在同一张卡里找得到。 -->
        <div class="grp">
          <h3 class="grp__t">写盘方式</h3>
          <p class="mini">
            「原地修复」已经搬到主区「写到哪里」那张卡的<b>「更多设置（老手）」</b>里 ——
            同一件事只留一个入口（谢绝重复）。
          </p>
        </div>
      {/if}
    </aside>
  </div>

  <!-- ============ 底栏（固定）：这一步要写什么 · 影响几个文件 · 执行 ============
       观感走全站的 `.wb__acts`（见下面样式里那段说明），`foot` 只当元素钩子（量具按它取）。
       放在 `.wb` **外面**：它不能去抢栅格的行（见下面 CSS 里的说明）。
       **它必须永远压在所有底栏之上、而且不被应用那条状态栏挡住**（用户 2026-09-23 B5：
       「打包到输出目录」原来被应用真正的底栏压住、点不到）—— 那两条现在由 `.wb__acts` 管。 -->
  <div class="wb__acts foot">
    <div class="foot__l">
      <span class="foot__t">{写盘问 ? 写盘问句 : 下一步}</span>
      {#if 汇}
        <span class="mini mut">
          影响 {汇.对象数} 条对象{汇.缺文件数 ? `（缺 ${汇.缺文件数}）` : ''}{汇.特效数 ? `、${汇.特效数} 条特效引用` : ''}
        </span>
      {/if}
    </div>
    {#if msg}
      <div class="foot__msg">
        <Note kind={msg.kind} onclose={() => (msg = null)} 自动关={提示自动关毫秒}>
          <span class="wrapany prewrap">{msg.text}</span>
        </Note>
      </div>
    {/if}
    <button class="btn btn--ghost" disabled={撤销忙 || !撤销有} onclick={() => void 跑撤销(true)} title="照上一次的操作记录反着做，先出表不动手">
      <Icon name="ui.refresh" size={14} />撤销上一次处理
    </button>
    <!-- 试算：全页只有这一处（页里不再放第二颗「试算」） -->
    <button
      class="btn btn--ghost"
      disabled={忙 || 扫中 || !扫}
      onclick={() => (情形 === 'A' ? 跑根替换(true) : 跑自包含(true))}
      title="只算不写：看一眼会改哪些、拷多少，盘上不动"
    ><Icon name="ui.search" size={14} />试算（不写盘）</button>
    {#if 写盘问}
      <button class="btn btn--ghost" onclick={() => (写盘问 = false)}>取消</button>
      <button
        class="btn btn--primary btn--main"
        disabled={忙 || (情形 === 'A' ? !扫 || 没落定.length > 0 || (!原地 && !输出) : !输出 || 没落定.length > 0)}
        onclick={() => (情形 === 'A' ? 跑根替换(false) : 跑自包含(false))}
      >{忙 ? '处理中…' : 情形 === 'A' ? '确定修复' : '确定打包'}</button>
    {:else}
      <button
        class="btn btn--primary btn--main"
        disabled={忙 || (情形 === 'A' ? !扫 || 没落定.length > 0 || (!原地 && !输出) : !输出 || 没落定.length > 0)}
        onclick={() => (写盘问 = true)}
      >{忙 ? '处理中…' : 情形 === 'A' ? (原地 ? '原地修好' : '另存并写盘') : '打包到输出目录'}</button>
    {/if}
  </div>
{/if}

<style>
  /* 顶部那一句话（设计准则 §一）：样式在 `wb.css` 的 `.topline`（全站同一个）。 */

  /* 底栏的**观感借全站那份 `.wb__acts`**（位置 / 吸底 / 描边 / 圆角 / 背景 / 阴影 /
     主按钮靠右全在那儿），这里只留它自己的两行排版。
     原来这一页自己写了一套：只有 `border-top`、通栏、还加了 `backdrop-filter` ——
     全库就它一页长得跟别的页不一样（用户 2026-09-23：「底部条栏观感割裂没有统一风格处理」）。
     `foot` 这个类名留着：`ui-audit` 的重叠扫描和几支 ⑥ 的探针都按它取元素。

     **它不能搬进 `.wb` 栅格**：带 `grid-column: 1/-1` 的它会占掉一整行、把右栏挤到下一行
     （实测右栏宽变 1037px、工作区塌成一列）。
     **B5**：状态栏是 `fixed bottom: 0`（高 `--status-h`、层级 60）；底栏原来写
     `bottom: 0; z-index: 3`，下半截被压住、「打包到输出目录」点不到 ——
     `bottom: var(--status-h)` 与 `z-index: calc(var(--z-status) + 5)` 现在由 `.wb__acts` 管，
     **这两条不许挪回本地样式里**。 */
  .foot__l { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .foot__t { font-size: var(--fs-xs); color: var(--body-text); overflow-wrap: anywhere; }
  .foot__msg { flex: 1 1 100%; min-width: 0; }

  /* ---------------- 区块卡（规范 §十八：三级收纳的第二级） ----------------
     标题一行 = **动词短语** + 右边的**关键读数**（收起也知道这条要不要展开，不靠记忆）。
     开合**就地、不弹窗不跳页**；动效**只做位移**，没有过冲曲线、没有缩放。 */
  .fold {
    border: 1px solid var(--line-divider);
    border-radius: var(--r-lg);
    background: var(--card-bg);
    min-width: 0;
  }
  .fold > summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    padding: 10px 16px;
    cursor: pointer;
    list-style: none;
    font-size: var(--fs-sm);
    color: var(--deep-text);
    min-width: 0;
  }
  .fold > summary::-webkit-details-marker { display: none; }
  .fold > summary::before { content: '＋'; flex: none; font-size: var(--fs-2xs); color: var(--content-meta); }
  .fold[open] > summary::before { content: '－'; }
  /* 标题 / 留白 / 读数三格：读数不许把标题顶出去，窄了就在自己这格里断行（收起时也不横向溢出） */
  .fold__t { min-width: 0; overflow-wrap: anywhere; }
  .fold__sp { margin-left: auto; }
  .fold__n {
    flex: 0 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: var(--fs-2xs);
    color: var(--content-meta);
    font-variant-numeric: tabular-nums;
  }
  /* 卡里的小卡（按目录名整批改里的「模型名称」）：轻一点，别看着像两级卡片 */
  .fold--sub { border-radius: var(--r-md); background: transparent; }
  .fold--sub > summary { padding: 8px 12px; font-size: var(--fs-xs); }
  .fold__body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    padding: 0 16px 14px;
    animation: fold-drop var(--t-micro) var(--ease-std) both;
  }
  .fold--sub > .fold__body { padding: 0 12px 10px; }
  @keyframes fold-drop {
    from { transform: translateY(-5px); }
    to   { transform: none; }
  }

  /* 更多工具 / 说明：默认收起，不占地方（规范 §7.2、§二） */
  .more, .notes {
    border: 1px solid var(--line-divider);
    border-radius: var(--r-lg);
    background: var(--card-bg);
  }
  .more > summary, .notes > summary {
    cursor: pointer;
    padding: 10px 16px;
    font-size: var(--fs-sm);
    color: var(--deep-text);
    list-style: none;
  }
  .more > summary::-webkit-details-marker, .notes > summary::-webkit-details-marker { display: none; }
  .more > summary::before { content: '＋ '; color: var(--content-meta); }
  .more[open] > summary::before { content: '－ '; }
  .notes > summary { color: var(--content-meta); }
  .more__body { display: flex; flex-direction: column; gap: 12px; padding: 0 12px 12px; }
  .notes__body { padding: 0 16px 14px; }
  .notes__body h4 { margin: 12px 0 6px; font-size: var(--fs-xs); color: var(--deep-text); }
  .notes__body ul { margin: 0; padding-left: 1.2em; }
  .notes__body li { margin: 3px 0; }
  /* 顶栏 `?` 展开的那一小块（规范 §二：需要解释的用 ? 图标，默认收起） */
  .explain {
    border-radius: var(--r-lg);
    border: 1px solid var(--line-divider);
    background: var(--surface-2);
    padding: 10px 12px;
  }
  .h3 { margin: 0 0 10px; font-size: var(--fs-md); }

  /* 长路径断行：路径动辄一百多个字符，不断行就会撑破卡片、跟旁边的字叠在一起（用户实测报的）。
     凡是会把路径塞进一行的 span 都挂 `.wrapany`。 */
  .wrapany {
    overflow-wrap: anywhere;
    word-break: break-word;
    min-width: 0;
  }
  .prewrap { white-space: pre-wrap; }

  /* 断行这条现在**全局都有**（`wb.css`：`.mono` 一律 anywhere、`.nowrap.mono` 不许挡换行、
     `.note > div` / `.kv__r` / `.row__v` / `.list li > *` 都给了 min-width:0）——
     本页只在全局没盖到的地方补：非 `.mono` 的 `.nowrap` 标签、表格单元格、列表行的对齐。 */
  .nowrap { white-space: normal; }
  .wrap {
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  td,
  th {
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  /* 列表行：长内容要能换行，别把右边的按钮挤出去 */
  .list li { align-items: flex-start; }
  .list__sp { min-width: 0; overflow-wrap: anywhere; }
  .slotrow { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  @media (max-width: 900px) { .slotrow { grid-template-columns: 1fr; } }
  .pick {
    display: grid;
    justify-items: start;
    gap: 3px;
    text-align: left;
    padding: 12px 14px;
    border: 1px dashed var(--line-strong);
    border-radius: var(--r-lg);
    background: var(--surface-2);
    color: var(--body-text);
    font: inherit;
    cursor: pointer;
    min-width: 0;
  }
  .pick:hover { border-color: var(--primary); background: var(--btn-plain-bg-hover); }
  .tblwrap { max-width: 100%; overflow-x: auto; }
  .tbl { width: 100%; border-collapse: collapse; font-size: var(--fs-2xs); }
  /* 「模型名称」那一块现在是 `.fold--sub` 区块卡（规范 §十八），它自己的样式在上面的 `.fold` 里 */
  .namerow { display: flex; align-items: center; gap: 8px; margin-top: 6px; flex-wrap: wrap; }
  .namerow__k { font-size: var(--fs-2xs); color: var(--content-meta); min-width: 4rem; }
  .namerow__in { flex: 1 1 14rem; min-width: 8rem; padding: 3px 6px; font: inherit; font-size: var(--fs-2xs); background: var(--surface-2); color: var(--body-text); border: 1px solid var(--line); border-radius: var(--r-sm); }
  .bad { color: var(--warn); }
  .tbl th {
    text-align: left; font-weight: 700; color: var(--content-meta);
    padding: 6px 8px; border-bottom: 1px solid var(--line-divider); white-space: nowrap;
  }
  .tbl td { padding: 5px 8px; border-bottom: 1px solid var(--line-divider); vertical-align: top; }
  .tbl tr.hot td { background: color-mix(in oklab, var(--warn) 12%, transparent); }
  /* 路径一律换行显示，不省略：用户报过"有些路径不让人看完整的" */
  .wrap { white-space: normal; overflow-wrap: anywhere; word-break: break-all; max-width: 30rem; }
  .dirs { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 10px; }
  @media (max-width: 900px) { .dirs { grid-template-columns: 1fr; } }
  .dirbox {
    border: 1px solid var(--line-divider);
    border-radius: var(--r-lg);
    padding: 10px 12px;
    background: var(--surface-2);
  }
  .dirl { display: flex; align-items: flex-start; gap: 8px; margin-top: 6px; }
</style>
