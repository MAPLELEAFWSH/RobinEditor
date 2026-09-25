<script lang="ts">
  /**
   * ⑥ 养乐多渲染自动上材质。
   *
   * 这个功能只做两件事：
   *   1. 读 PMX，把材质名按规则分到域里（脸 / 头发 / 身体）
   *   2. 拿一份 fx 模板，把贴图路径和每个槽的常量填进去，写出一份新的 fx
   *
   * 渲染包不进这个仓库，也不动用户那份。模板由用户指路，产物写到用户选的目录。
   *
   * fx 模板的结构和参数名见 ops.ts 顶部的注释。这里不硬编码参数清单 ——
   * 模板版本一升参数就变，认得结构就够了。
   */
  import { onMount } from 'svelte';
  import type { WbProps } from '$lib/modules/wb-props';
  import {
    isTauri,
    readPmx,
    scanDir,
    readText,
    saveBytes,
    pickFolder,
    joinPath,
    stemOf
  } from '$lib/io';
  import type { PmxInfo } from '$lib/io';
  import * as ops from './ops';
  import type { Param, Parsed } from './ops';
  import { registerZone, unregisterZone } from '$lib/dropzones.svelte';
  import Note from '$lib/components/wb/Note.svelte';
  import { 提示自动关毫秒 } from '$lib/ui.svelte';
  import Icon from '$lib/components/Icon.svelte';

  let { panelId = 'match' }: WbProps = $props();

  type Domain = 'body' | 'face' | 'hair';
  const DOMAINS: Domain[] = ['body', 'face', 'hair'];
  const DOMAIN_LABEL: Record<Domain, string> = { body: '身体', face: '脸', hair: '头发' };

  /* ------------------------------------------------------------ 状态 */

  type ModelRow = {
    path: string;
    rel: string;
    info: PmxInfo | null;
    error: string | null;
    loading: boolean;
    /** 用户手填的 lightmap 路径，留空就按贴图名自动挑 */
    lightmap: string;
  };

  type Tmpl = { path: string; name: string; text: string; parsed: Parsed };

  type GenItem = {
    key: string;
    model: string;
    domain: Domain;
    fileName: string;
    text: string;
    filled: ops.FillResult;
    diff: { name: string; from: string; to: string }[];
  };

  let root = $state('');
  let models = $state<ModelRow[]>([]);
  let scanning = $state(false);
  let rules = $state<ops.Rule[]>([]);
  let ruleKw = $state('');
  let ruleKind = $state('cloth');
  let digest = $state('');

  let tmpl = $state<Record<Domain, Tmpl | null>>({ body: null, face: null, hair: null });

  let outDir = $state('');
  let openSection = $state<Record<string, boolean>>({});
  let paramFilter = $state('');
  /** 左栏：按文件名过滤"要写的文件"那一列 */
  let 文件过滤 = $state('');
  /** 左栏：只看某一个域（null = 三个域都看）。这是导航，不是"必须先选" */
  let 域筛选 = $state<Domain | null>(null);
  /**
   * 参数检查器只显示常用项。默认开 —— 用户 2026-09-22 拍的口径：
   * 一上来只摆"真正要改的那几类"，要全看再点「显示全部参数」。
   */
  let 只显示常用 = $state(true);

  let gen = $state<GenItem[]>([]);
  let active = $state(0);
  /** 手动改过的参数表，按 gen 的 key 存 */
  let workingParams = $state<Record<string, Param[]>>({});

  /**
   * 正在改哪个域。**参数改动不再要求"先选中一份文件"** ——
   * 用户 2026-09-21 原话：「必须选完了才能改」就是很垃圾的操作。
   * 所以"编辑域"独立于"选中了哪份文件"：没生成之前也能改，改动落在域名下。
   */
  let 编辑域 = $state<Domain>('body');
  /**
   * 作用范围。默认「这一域的全部文件」——新手少一步（改一次，这一域都生效）；
   * 真的需要两份不一样时再切「只这一份」。
   */
  let 作用范围 = $state<'域' | '这份'>('域');
  /**
   * 生成前就先调好的值，按域存。生成时**叠在自动填的结果之上**，
   * 所以先改后生成、或者改完重新生成，都不会把用户填的丢掉。
   */
  let 预置 = $state<Record<Domain, Record<string, { v?: string; on?: boolean }>>>({
    body: {},
    face: {},
    hair: {}
  });
  let written = $state<{ file: string; ok: boolean; note: string }[]>([]);
  let busy = $state(false);
  let msg = $state<{ kind: 'ok' | 'warn' | 'info'; text: string } | null>(null);

  onMount(() => {
    rules = ops.loadRules();
  });

  /* ------------------------------------------------------------ 贴图格的拖放落点
     贴图那几格是输入框，拖进来的文件得能直接填进去。
     为什么不用输入框自己的 drop 事件：桌面端 Tauri 在系统层就把文件接走了，
     HTML5 的 drop 一个字节都收不到 —— 只有窗口级那条 `onDragDropEvent` 有真路径。
     所以这儿只负责"我这一格是谁、落下来填哪个参数"，落点解析在 drag-dom 统一做。 */

  /**
   * 哪些落点收 `.fx` / `.fxsub`。
   *
   * 模板卡、模板那三行、文件那几行，加**整页兜底那一个**。
   * 其余（`yaku:<选中序>:<参数名>`）是贴图格，仍然只收图片。
   *
   * **收什么必须由落点自己说**：不写在这儿的话，落下去会被全局那套
   * "只收图片后缀"的筛法先挡掉，一个 `.fx` 拖进来只会得到"不是图片，没接"
   * （用户 2026-09-23 实测就是这个）。上一轮只给了 `tmpl` / `file:` 那几处，
   * 拖到这一页别的地方落点解析找不到人接，照样是这句。
   */
  const 收fx的落点 = (id: string): boolean =>
    id === 'yaku:page' || id.startsWith('yaku:tmpl') || id.startsWith('yaku:file:');

  $effect(() => {
    const registered = new Map<string, HTMLElement>();

    const unregisterAll = () => {
      for (const id of registered.keys()) unregisterZone(id);
      registered.clear();
    };

    const sync = () => {
      const want = new Map<string, HTMLElement>();
      for (const el of document.querySelectorAll<HTMLElement>('[data-drop-target^="yaku:"]')) {
        const key = el.dataset.dropTarget ?? '';
        if (key) want.set(key, el);
      }
      /* 先撤掉这一轮不在了的（换分区、换模板之后 DOM 会重建） */
      for (const id of [...registered.keys()]) {
        if (!want.has(id) || registered.get(id) !== want.get(id)) {
          unregisterZone(id);
          registered.delete(id);
        }
      }
      for (const [id, el] of want) {
        if (registered.has(id)) continue;
        registered.set(id, el);
        registerZone({
          id,
          rect: el.getBoundingClientRect(),
          el,
          /* 收什么由落点自己说，见上面 收fx的落点 的说明 */
          accept: 收fx的落点(id) ? ['fx', 'fxsub'] : undefined,
          onDrop: (ref) => {
            const 部位 = id.split(':');
            /*
              落点分四种（前三种都收 .fx / .fxsub）：
                yaku:tmpl:<域>  —— 落在某个域那一行上，这份文件当那个域的模板
                yaku:tmplcard   —— 落在整张模板卡上，按文件名猜域（猜完在提示里说明）
                yaku:file:<序>  —— 落在"要写的文件"某一行上，当成那一行的域的模板
                yaku:page       —— 落在这一页别的地方，跟 tmplcard 一样按文件名猜域
              其余是贴图参数格：yaku:<选中序>:<参数名>，落下去填那个参数。
            */
            if (部位[1] === 'tmpl') {
              void 载入模板(部位[2] as Domain, ref.path);
              return;
            }
            if (部位[1] === 'tmplcard' || 部位[1] === 'page') {
              const d = 猜域(ref.path);
              /* 猜出来的要说清"是猜的" —— 不然用户不知道域可能选错了 */
              void 载入模板(d, ref.path, true);
              return;
            }
            if (部位[1] === 'file') {
              const i = Number(部位[2]);
              void 载入模板(gen[i]?.domain ?? 编辑域, ref.path);
              return;
            }
            /* 写进去的是路径本身（fx 里就是这么写的）。反斜杠转正斜杠 ——
               同一份 fx 换台机器也能对上 */
            const pname = 部位.slice(2).join(':');
            setParam(active, pname, ref.path.replace(/\\/g, '/'));
          }
        });
      }
    };

    sync();
    /* 分区切换、模板换了之后这一片会重建，所以盯着 DOM 变化再同步一次 */
    const mo = new MutationObserver(sync);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      unregisterAll();
    };
  });

  /* ------------------------------------------------------------ 工具 */

  /** 选指定扩展名的文件。io.ts 里那个 pickImages 写死了贴图后缀，这儿要 fx。 */
  async function pickByExt(exts: string[], multiple: boolean): Promise<string[]> {
    if (isTauri()) {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const sel = await open({ multiple, filters: [{ name: exts.join(' / '), extensions: exts }] });
      if (!sel) return [];
      return Array.isArray(sel) ? sel : [sel];
    }
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = multiple;
      input.accept = exts.map((e) => '.' + e).join(',');
      input.onchange = () => resolve(Array.from(input.files ?? []).map((f) => f.name));
      input.click();
    });
  }

  /**
   * 给"要写的文件"某一行挑一份 fx 模板。
   *
   * 跟**拖进来**走的是同一个 `载入模板` —— 两条路各写一份的话，迟早出现
   * "拖进去生效、点按钮不生效"这种哑差。
   */
  async function 给这一行选模板(i: number) {
    if (blocked('载入模板')) return;
    const [p] = await pickByExt(['fx', 'fxsub'], false);
    if (p) await 载入模板(gen[i]?.domain ?? 编辑域, p);
  }

  /** 浏览器里拿不到真实路径，读不了 PMX —— 直接说清楚，不假装 */  function blocked(what: string): boolean {
    if (isTauri()) return false;
    msg = {
      kind: 'warn',
      text: `${what}要在桌面端里跑。浏览器里只有文件名，没有路径，后端读不到文件。`
    };
    return true;
  }

  /* ------------------------------------------------------------ 扫描 */

  async function pickRoot() {
    if (blocked('解析 PMX')) return;
    const r = await pickFolder('养乐多上材质', '/tools/yaku?panel=match');
    if (!r) return;
    await useRoot(r);
  }

  /**
   * 认一个模型目录 —— 「选模型目录」和**拖文件夹进来**走的是同一个函数。
   * 两条路各写一份的话，迟早出现"拖进来的没扫到 .pmx"这种哑操作。
   */
  async function useRoot(r: string) {
    if (blocked('解析 PMX')) return;
    root = r;
    scanning = true;
    models = [];
    try {
      const files = await scanDir(r, ['pmx'], true);
      models = files.map((f) => ({
        path: f.path,
        rel: f.rel,
        info: null,
        error: null,
        loading: false,
        lightmap: ''
      }));
      if (!files.length) msg = { kind: 'info', text: '这个目录里没扫到 .pmx。' };
    } catch (e) {
      msg = { kind: 'warn', text: `扫目录失败：${(e as Error).message}` };
    }
    scanning = false;
  }

  /**
   * 拖一个**文件夹**到模型目录卡片上 = 点「选模型目录」。
   *
   * 桌面端的原生拖放只给路径、不给后缀，文件夹因此过不了图片那道筛 ——
   * `dir: true` 让 drag-dom 跳过筛法（见 dropzones 里的说明）。
   */
  let rootCard = $state<HTMLElement | null>(null);
  const ROOT_ZONE = 'yaku:root';
  $effect(() => {
    const el = rootCard;
    if (!el || panelId !== 'match') return;
    registerZone({
      id: ROOT_ZONE,
      dir: true,
      rect: el.getBoundingClientRect(),
      el,
      onDrop: (ref) => void useRoot(ref.path)
    });
    return () => unregisterZone(ROOT_ZONE);
  });

  async function parseOne(row: ModelRow) {
    row.loading = true;
    row.error = null;
    try {
      row.info = await readPmx(row.path);
    } catch (e) {
      // 单个模型解析失败就跳过它，界面不跟着崩
      row.error = (e as Error).message;
      row.info = null;
    }
    row.loading = false;
  }

  async function parseAll() {
    scanning = true;
    for (const m of models) {
      if (!m.info && !m.error) await parseOne(m);
    }
    scanning = false;
  }

  /* ------------------------------------------------------------ 规则 */

  function addRule() {
    const kw = ruleKw.trim();
    if (!kw) return;
    rules = [...rules, { kw, kind: ruleKind }];
    ops.saveRules(rules);
    ruleKw = '';
  }

  function delRule(i: number) {
    rules = rules.filter((_, j) => j !== i);
    ops.saveRules(rules);
  }

  function kindOf(m: { name: string; kind: string }): { kind: string; by: string } {
    return ops.applyRules(m.name, m.kind, rules);
  }

  const kindLabel = (k: string) => ops.KINDS.find((x) => x.id === k)?.label ?? k;

  const stats = $derived.by(() => {
    const by: Record<string, number> = {};
    let mats = 0;
    let texs = 0;
    let bad = 0;
    for (const m of models) {
      if (m.error) {
        bad++;
        continue;
      }
      if (!m.info) continue;
      mats += m.info.materials.length;
      texs += m.info.textures.length;
      for (const mat of m.info.materials) {
        const k = kindOf(mat).kind;
        by[k] = (by[k] ?? 0) + 1;
      }
    }
    return { mats, texs, bad, by };
  });

  const ruleCounts = $derived.by(() => {
    const by: Record<string, number> = {};
    for (const m of models) {
      if (!m.info) continue;
      for (const mat of m.info.materials) {
        const k = kindOf(mat).kind;
        by[k] = (by[k] ?? 0) + 1;
      }
    }
    return by;
  });

  /** 模型 × 域：哪些域里有材质，就该出一份 fx */
  function domainRows(): { model: ModelRow; domain: Domain; mats: ops.FillMaterial[] }[] {
    const out: { model: ModelRow; domain: Domain; mats: ops.FillMaterial[] }[] = [];
    for (const m of models) {
      if (!m.info) continue;
      const buckets: Record<Domain, ops.FillMaterial[]> = { body: [], face: [], hair: [] };
      for (const mat of m.info.materials) {
        const t = ops.templateFor(kindOf(mat).kind);
        buckets[t].push({
          name: mat.name,
          kind: kindOf(mat).kind,
          diffuse: mat.diffuse,
          specular: mat.specular,
          specular_power: mat.specular_power,
          ambient: mat.ambient,
          edge_size: mat.edge_size
        });
      }
      for (const d of ['body', 'face', 'hair'] as const) {
        if (buckets[d].length) out.push({ model: m, domain: d, mats: buckets[d] });
      }
    }
    return out;
  }

  /* ------------------------------------------------------------ 模板 */

  async function pickTemplate(domain: Domain) {
    if (blocked('读 fx 模板')) return;
    const paths = await pickByExt(['fx'], false);
    if (!paths.length) return;
    await 载入模板(domain, paths[0]);
  }

  /**
   * 按文件名猜这份 fx 属于哪个域。
   *
   * 只有"拖到整张卡上"那种没有明确目标时才用得上 —— 猜出来的会在提示里说明，
   * 猜错的话用户拖到具体那一行上就准了。
   */
  function 猜域(path: string): Domain {
    const n = (path.split(/[\\/]/).pop() ?? '').toLowerCase();
    if (/face|kao/.test(n)) return 'face';
    if (/hair|kami/.test(n)) return 'hair';
    if (/body|karada/.test(n)) return 'body';
    return 编辑域;
  }

  /** 把某个文件当某个域的模板载入。选模板、拖 `.fx` 到域行/文件行，都走这一条 */
  async function 载入模板(domain: Domain, path: string, 猜的 = false) {
    if (blocked('读 fx 模板')) return;
    try {
      const p = await readText(path);
      const parsed = ops.parseFx(p.text);
      const name = path.split(/[\\/]/).pop() ?? path;
      if (parsed.params.length < 20) {
        msg = {
          kind: 'warn',
          text: `${name} 只认出来 ${parsed.params.length} 个参数，看着不像养乐多的 fx 模板。`
        };
      }
      tmpl = { ...tmpl, [domain]: { path, name, text: p.text, parsed } };
      const open: Record<string, boolean> = { ...openSection };
      for (const s of parsed.sections) open[s.title] = open[s.title] ?? true;
      openSection = open;
      /* 换了模板就把已经生成的那几份按新模板重算一遍，免得"看着换了其实没换" */
      if (gen.length) regenerateFor(domain);
      msg = {
        kind: 'ok',
        text:
          `${DOMAIN_LABEL[domain]}的模板换成 ${name}：${parsed.params.length} 个参数、` +
          `${parsed.sections.length} 个段${parsed.includes.length ? `、include ${parsed.includes.length} 个` : ''}。` +
          (猜的 ? '（域是按文件名猜的 —— 不对就拖到具体那一行上）' : '')
      };
    } catch (e) {
      msg = { kind: 'warn', text: `读模板失败：${(e as Error).message}` };
    }
  }

  function templateOf(domain: Domain): { t: Tmpl; fallback: boolean } | null {
    const own = tmpl[domain];
    if (own) return { t: own, fallback: false };
    const b = tmpl.body;
    if (b && domain !== 'body') return { t: b, fallback: true };
    return null;
  }

  /* ------------------------------------------------------------ 生成 */

  /** 把一个参数按用户改过的值套一下（`v` 是值，`on` 是贴图那格的启用开关） */
  const 套一个 = (p: Param, o: { v?: string; on?: boolean }): Param => ({
    ...p,
    value: o.v ?? p.value,
    enabled: o.on ?? p.enabled
  });

  /** 生成前/生成后，用户改过的值都从这儿叠上去 —— 先改后生成、改完重新生成都不丢 */
  function 套预置(domain: Domain, params: Param[]): Param[] {
    const 表 = 预置[domain];
    if (!表 || !Object.keys(表).length) return params;
    return params.map((p) => {
      const o = 表[p.name];
      return o ? 套一个(p, o) : p;
    });
  }

  /** 换了模板之后，把已经生成的那几份按新模板重算（用户手改过的值按参数名留着） */
  function regenerateFor(domain: Domain) {
    const t = templateOf(domain);
    if (!t) return;
    const rows = domainRows();
    const next = [...gen];
    const wp = { ...workingParams };
    for (let i = 0; i < next.length; i++) {
      const g = next[i];
      if (g.domain !== domain) continue;
      const r = rows.find((x) => x.model.rel === g.model);
      if (!r) continue;
      const filled = ops.autofill(t.t.parsed.params, {
        domain: g.domain,
        materials: r.mats,
        textures: r.model.info?.textures ?? [],
        lightmapPath: r.model.lightmap || undefined
      });
      const 自动 = 套预置(g.domain, ops.mergeValues(t.t.parsed.params, filled.values));
      const 旧 = new Map((wp[g.key] ?? []).map((p) => [p.name, p]));
      const 合 = 自动.map((p) => {
        const o = 旧.get(p.name);
        return o ? { ...p, value: o.value, enabled: o.enabled } : p;
      });
      wp[g.key] = 合;
      next[i] = {
        ...g,
        text: ops.writeFx(t.t.parsed, 合),
        diff: ops.diffParams(t.t.parsed.params, 合),
        filled
      };
    }
    gen = next;
    workingParams = wp;
  }

  function generate() {
    const rows = domainRows();
    if (!rows.length) {
      msg = { kind: 'warn', text: '还没解析出材质。先扫目录，再点解析全部。' };
      return;
    }
    if (!tmpl.body && !tmpl.face && !tmpl.hair) {
      msg = { kind: 'warn', text: '还没载入 fx 模板。上面三个域各选一份 mat_body / mat_face / mat_hair。' };
      return;
    }
    const out: GenItem[] = [];
    const wp: Record<string, Param[]> = {};
    for (const r of rows) {
      const t = templateOf(r.domain);
      if (!t) continue;
      const filled = ops.autofill(t.t.parsed.params, {
        domain: r.domain,
        materials: r.mats,
        textures: r.model.info?.textures ?? [],
        lightmapPath: r.model.lightmap || undefined
      });
      const next = 套预置(r.domain, ops.mergeValues(t.t.parsed.params, filled.values));
      const base = r.model.info?.name || stemOf(r.model.rel);
      const key = `${r.model.rel}::${r.domain}`;
      wp[key] = next;
      out.push({
        key,
        model: r.model.rel,
        domain: r.domain,
        // 模型名可能是日文/中文，落到文件名里 Windows 也认，但冒号和斜杠要去掉
        fileName: `${base.replace(/[\\/:*?"<>|]/g, '_')}.mat_${r.domain}.fx`,
        text: ops.writeFx(t.t.parsed, next),
        filled,
        diff: ops.diffParams(t.t.parsed.params, next)
      });
    }
    去重文件名(out);
    workingParams = wp;
    gen = out;
    active = 0;
    paramFilter = '';
    msg = { kind: 'ok', text: `生成 ${out.length} 份，先看再写。` };
  }

  /**
   * 产物全平铺在同一个输出目录里，所以 `fileName` 必须彼此不同。
   *
   * 名字取自 **PMX 内部名**，而重名很常见 —— `贴图样本\木偶` 那 5 个 pmx
   * 内部名全叫 `sandrone`：原来 5 份产物写同一个路径，**后一个盖掉前一个**，
   * 日志还每条都 ok。重名的补上 pmx 文件名区分，还重就再挂序号。
   */
  function 去重文件名(项: GenItem[]) {
    const 次数 = new Map<string, number>();
    for (const g of 项) {
      const k = g.fileName.toLowerCase();
      次数.set(k, (次数.get(k) ?? 0) + 1);
    }
    const 用过 = new Set<string>();
    for (const g of 项) {
      let 名 = g.fileName;
      if ((次数.get(名.toLowerCase()) ?? 0) > 1) {
        名 = `${stemOf(g.model).replace(/[\\/:*?"<>|]/g, '_')}.${名}`;
      }
      let 定 = 名;
      for (let n = 2; 用过.has(定.toLowerCase()); n++) 定 = `${名.replace(/\.fx$/i, '')}_${n}.fx`;
      用过.add(定.toLowerCase());
      g.fileName = 定;
    }
  }

  function paramsAt(i: number): Param[] {
    const g = gen[i];
    if (!g) return [];
    const t = templateOf(g.domain);
    if (!t) return [];
    return workingParams[g.key] ?? ops.mergeValues(t.t.parsed.params, g.filled.values);
  }

  function commit(i: number, params: Param[]) {
    const g = gen[i];
    const t = templateOf(g.domain);
    if (!t) return;
    workingParams = { ...workingParams, [g.key]: params };
    const next = [...gen];
    next[i] = { ...g, text: ops.writeFx(t.t.parsed, params), diff: ops.diffParams(t.t.parsed.params, params) };
    gen = next;
  }

  function setParam(i: number, name: string, value: string) {
    落参数(name, { v: value }, i);
  }

  function toggleParam(i: number, name: string, on: boolean) {
    落参数(name, { on }, i);
  }

  /**
   * 改一个参数。**这是"不必先选完就能改"的落点。**
   *
   * 两条路：
   *   · 作用范围 = 这一域的全部（默认）：值记进 `预置[域]`，并把已生成的该域每一份一起更新
   *     —— 生成前改也行，改完再生成照样生效，重新生成也不会丢。
   *   · 作用范围 = 只这一份：只动当前那一份（`workingParams`），方便两份要不一样。
   *
   * `who` 是界面上那一行绑定的下标；只有"只这一份"才用它，其它时候由域名决定。
   */
  function 落参数(name: string, patch: { v?: string; on?: boolean }, who?: number) {
    const 域 = 当前域;
    const 只这份 = 作用范围 === '这份' && gen.length > 0;
    if (只这份) {
      const i = who ?? active;
      const g = gen[i];
      if (!g) return;
      commit(i, paramsAt(i).map((p) => (p.name === name ? 套一个(p, patch) : p)));
      return;
    }
    /* 记进预置：生成前、生成后都生效 */
    预置 = { ...预置, [域]: { ...(预置[域] ?? {}), [name]: { ...(预置[域]?.[name] ?? {}), ...patch } } };
    const t = templateOf(域);
    if (!t || !gen.length) return;
    const next = [...gen];
    const wp = { ...workingParams };
    let 动 = 0;
    for (let i = 0; i < next.length; i++) {
      const g = next[i];
      if (g.domain !== 域) continue;
      const 改后 = paramsAt(i).map((p) => (p.name === name ? 套一个(p, patch) : p));
      wp[g.key] = 改后;
      next[i] = {
        ...g,
        text: ops.writeFx(t.t.parsed, 改后),
        diff: ops.diffParams(t.t.parsed.params, 改后)
      };
      动++;
    }
    if (动) {
      workingParams = wp;
      gen = next;
    }
  }

  const activeGen = $derived(gen[active] ?? null);

  /** 现在在改哪个域：选中了文件就跟着文件走；没选中（或还没生成）就按用户挑的域 */
  const 当前域 = $derived<Domain>(activeGen ? activeGen.domain : 编辑域);

  /**
   * 面板上现在显示、可以直接改的参数。
   * **没有生成也照样给** —— 这是"不必先选完就能改"的那一半：
   * 没生成时给的是模板里的参数（叠上用户已预置的值）。
   */
  const 当前参数 = $derived.by(() => {
    if (activeGen) return paramsAt(active);
    const t = templateOf(编辑域);
    return t ? 套预置(编辑域, t.t.parsed.params) : [];
  });

  /** 段顺序按模板里的出现顺序，后面没有段名的都归到尾部 */
  const visibleSections = $derived.by(() => {
    const t = templateOf(当前域);
    if (!t) return [] as { title: string; items: Param[] }[];
    const map = new Map<string, Param[]>();
    for (const p of 当前参数) {
      const arr = map.get(p.section) ?? [];
      arr.push(p);
      map.set(p.section, arr);
    }
    const ordered: { title: string; items: Param[] }[] = [];
    for (const s of t.t.parsed.sections) {
      const items = map.get(s.title);
      if (items?.length) {
        ordered.push({ title: s.title, items });
        map.delete(s.title);
      }
    }
    for (const [title, items] of map) ordered.push({ title, items });

    const f = paramFilter.trim().toLowerCase();
    let 出 = ordered;
    if (f) {
      出 = 出
        .map((s) => ({ title: s.title, items: s.items.filter((p) => p.name.toLowerCase().includes(f)) }))
        .filter((s) => s.items.length);
    }
    /* 「常用 / 完整」这一档（默认常用）。放在过滤之后，两档能叠加 */
    if (只显示常用) {
      const 留 = new Set(ops.常用参数(当前参数).map((p) => p.name));
      出 = 出
        .map((s) => ({ title: s.title, items: s.items.filter((p) => 留.has(p.name)) }))
        .filter((s) => s.items.length);
    }
    return 出;
  });

  /** 左栏与中栏共用的文件筛选结果。**它只影响"看得见哪些行"，不影响能改什么** */
  function 看得见(g: GenItem): boolean {
    if (域筛选 && g.domain !== 域筛选) return false;
    const f = 文件过滤.trim().toLowerCase();
    return !f || g.fileName.toLowerCase().includes(f);
  }

  /** 每个域各几份（左栏分组上的计数，按未过滤的算） */
  const 域计数 = $derived.by(() => {
    const 数: Record<Domain, number> = { body: 0, face: 0, hair: 0 };
    for (const g of gen) 数[g.domain]++;
    return 数;
  });

  const diffCount = $derived(gen.reduce((n, g) => n + g.diff.length, 0));

  /**
   * 参数板块的模式。
   *
   * 原来是"所有段 + 所有参数 + 全文预览"一条长列表铺下去，找一项要滚半天
   * （用户 2026-09-21 实测说"一长串过长面板操作反人类"）。
   * 现在板块高度固定，切模式只换内容 —— 跟 ③ Ray 的界面一个形状。
   */
  const 模式表 = ['全部', '改过的', '没填上的', '全文'] as const;
  let 参数模式 = $state<(typeof 模式表)[number]>('全部');

  /** 按模式筛出来的段。'全文' 那种模式不走这里（它直接显示整份文本） */
  const 模式段 = $derived.by(() => {
    if (参数模式 === '全部' || 参数模式 === '全文') return visibleSections;
    /* 「改过的」「没填上的」这两档得知道"跟模板比差在哪"，那是生成之后才算得出来的 */
    if (!activeGen) return [] as { title: string; items: Param[] }[];
    const 要 = 参数模式 === '改过的'
      ? new Set(activeGen.diff.map((d) => d.name))
      /* **按参数名筛，不按整句话**：`missing` 里存的是 `X（没找到Y的贴图）` 这种句子，
         拿它当名字比恒假 —— 这一档以前永远显示"这个模式下没有内容"，可角标还在报数字 */
      : new Set(activeGen.filled.missingNames);
    return visibleSections
      .map((s) => ({ title: s.title, items: s.items.filter((p) => 要.has(p.name)) }))
      .filter((s) => s.items.length);
  });

  /** 「只显示常用」挡掉了多少条 —— 写在开关旁边，免得看着像"参数丢了" */
  const 被常用挡掉的条数 = $derived(
    只显示常用 ? Math.max(0, 当前参数.length - visibleSections.reduce((n, s) => n + s.items.length, 0)) : 0
  );

  async function writeAll() {
    if (!gen.length) return;
    const dir = outDir || (root ? joinPath(root, 'RobinEditor_out') : '');
    if (!dir) {
      msg = { kind: 'warn', text: '先选个输出目录。' };
      return;
    }
    busy = true;
    const log: { file: string; ok: boolean; note: string }[] = [];
    for (const g of gen) {
      try {
        const r = await saveBytes(joinPath(dir, g.fileName), new TextEncoder().encode(g.text));
        log.push({
          file: g.fileName,
          ok: true,
          note: r.backup ? `${r.bytesWritten} 字节，旧文件备份到 ${r.backup}` : `${r.bytesWritten} 字节`
        });
      } catch (e) {
        log.push({ file: g.fileName, ok: false, note: (e as Error).message });
      }
    }
    written = log;
    busy = false;
    const ok = log.filter((l) => l.ok).length;
    msg = { kind: ok === log.length ? 'ok' : 'warn', text: `写了 ${ok} / ${log.length} 份到 ${dir}` };
  }

  async function exportReport() {
    const lines: string[] = [];
    lines.push('# 养乐多材质匹配报告');
    lines.push('');
    lines.push(`目录：${root}`);
    lines.push(`模型：${models.length}　材质：${stats.mats}　贴图：${stats.texs}`);
    lines.push('');
    lines.push('## 各类别材质数');
    for (const [k, n] of Object.entries(stats.by).sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${kindLabel(k)}：${n}`);
    }
    lines.push('');
    lines.push('## 自定义规则（后加的优先）');
    if (!rules.length) lines.push('  （无）');
    for (const r of rules) lines.push(`  「${r.kw}」→ ${kindLabel(r.kind)}`);
    lines.push('');
    lines.push('## 逐模型逐材质');
    for (const m of models) {
      lines.push('');
      lines.push(`### ${m.rel}`);
      if (m.error) {
        lines.push(`  解析失败：${m.error}`);
        continue;
      }
      if (!m.info) {
        lines.push('  未解析');
        continue;
      }
      lines.push(
        `  模型名：${m.info.name}　编码 ${m.info.encoding}　顶点 ${m.info.vertex_count}　面 ${m.info.face_count}　材质 ${m.info.material_count}`
      );
      if (m.info.notes.length) lines.push(`  解析备注：${m.info.notes.join('；')}`);
      for (const mat of m.info.materials) {
        const k = kindOf(mat);
        lines.push(
          `  [${ops.templateFor(k.kind)}] ${mat.name}　主贴图=${mat.texture ?? '无'}　分类=${kindLabel(k.kind)}（${k.by}）　面数=${mat.face_count}`
        );
      }
    }
    const text = lines.join('\n');
    digest = text;
    const dir = outDir || (root ? joinPath(root, 'RobinEditor_out') : '');
    if (dir) {
      try {
        await saveBytes(joinPath(dir, '养乐多材质匹配报告.txt'), new TextEncoder().encode(text));
        msg = { kind: 'ok', text: `报告写到 ${dir}` };
      } catch (e) {
        msg = { kind: 'warn', text: `写报告失败：${(e as Error).message}` };
      }
    } else {
      msg = { kind: 'info', text: '报告在下面。选个输出目录就能存成文件。' };
    }
  }

  /** vec 的输入框数量按类型给足，值不够就补 0 */
  function partsOf(p: Param): string[] {
    const n = ops.componentCount(p.kind);
    const got = p.value.split(',').map((v) => v.trim());
    while (got.length < n) got.push('0');
    return got.slice(0, n);
  }

  function setPart(i: number, p: Param, vi: number, v: string) {
    const parts = partsOf(p);
    parts[vi] = v === '' ? '0' : v;
    setParam(i, p.name, parts.join(', '));
  }

  /**
   * 模板里这条参数的**原值**。滑条范围按它推。
   *
   * 为什么不按正在编辑的值推：拖到端点时范围会跟着变大，滑杆在手里一跳一跳的
   * —— 这一条 ③ Ray 那边已经吃过（`Row.svelte` 的 `范围` 里写着同一句）。
   * 传 `vi` 就拿 vec 的第 `vi` 个分量。
   */
  function 原值(name: string, vi?: number): string {
    const v = templateOf(当前域)?.t.parsed.params.find((p) => p.name === name)?.value ?? '';
    if (vi === undefined) return v;
    return v.split(',')[vi]?.trim() ?? '';
  }

  /**
   * 数值滑条的范围。**照 ③ Ray 那条规矩**：有范围表就用表，没有就按**原值**推一个量级。
   * 养乐多的 fx 里没有范围表，所以全走"按原值推"。
   *
   * 实测依据（29 个真模板、7508 条参数，`tmp\量-养乐多参数.mjs`）：
   * float 的原值落在 0~100，最常见的是 1（1129 次）、0、0.02、0.01、10、0.5；
   * vec 分量的原值落在 -0.137~20，最常见 1 / 0 / 0.5 / 0.75。
   * 按原值×2 推：原值 1 → 能拖到 2，原值 10 → 能拖到 20，原值 0.02 → 落到 0~1。
   */
  function 范围(原: string): { min: number; max: number; step: number } {
    const 基准 = Math.abs(Number(原));
    const 幅 = Number.isFinite(基准) && 基准 > 0 ? Math.ceil(基准 * 2 * 100) / 100 : 1;
    const 负 = Number(原) < 0;
    return { min: 负 ? -幅 : 0, max: 幅, step: 幅 / 200 };
  }

  /** 值是不是一个能拖的纯数（`#define X (1.0/3.0)` 那种算式不能拖，只能填） */
  const 是数 = (v: string) => v.trim() !== '' && Number.isFinite(Number(v));
</script>

{#if !['match', 'apply'].includes(panelId)}
  <!-- 不认识的 id 不再悄悄渲染最后一个分区（原来裸 `{:else}` 就是干这个的） -->
  <div class="card pad">
    <Note kind="warn">
      分区 id「{panelId}」这个组件不认识，所以这一页是空的。
      多半是注册表里加/改分区的时候，组件里的分支没跟着改 —— 两边要一起改。
    </Note>
  </div>
{:else if panelId === 'match'}
  <div class="wb">
    <div class="wb__main">
      <div class="card pad" bind:this={rootCard}>
        <div class="acts">
          <button class="btn btn--primary" onclick={pickRoot} disabled={scanning}>
            <Icon name="ui.folder" size={15} />{scanning ? '扫描中…' : '选模型目录'}
          </button>
          {#if models.length}
            <button class="btn btn--ghost" onclick={parseAll} disabled={scanning}>
              <Icon name="ui.run" size={15} />解析全部（{models.length}）
            </button>
          {/if}
          <span class="mini nowrap">这张卡上也可以直接拖文件夹</span>
        </div>
        {#if root}
          <p class="mini mono" style="margin:10px 0 0">{root}</p>
        {/if}
        {#if !isTauri()}
          <div style="margin-top:10px">
            <Note kind="warn">
              跑在浏览器里。PMX 是二进制格式，解析在后端做，这一步现在用不了；
              分包成桌面端之后才读得到。
            </Note>
          </div>
        {/if}
      </div>

      {#if models.length}
        <div class="card pad">
          <h3 class="h3">模型</h3>
          <ul class="list">
            {#each models as m (m.path)}
              <li>
                <b>{m.rel}</b>
                {#if m.loading}
                  <span class="list__sp">读中…</span>
                {:else if m.error}
                  <span class="list__sp bad" title={m.error}>{m.error}</span>
                {:else if m.info}
                  <span class="list__sp">
                    {m.info.name || '（无名）'}　材质 {m.info.material_count}　贴图 {m.info.texture_count}　v{m.info.version}
                  </span>
                {:else}
                  <button class="btn btn--ghost btn--sm" onclick={() => parseOne(m)}>解析</button>
                {/if}
              </li>
            {/each}
          </ul>
        </div>

        {#if Object.keys(ruleCounts).length}
          <div class="card pad">
            <h3 class="h3">分类结果</h3>
            <div class="kv">
              {#each Object.entries(ruleCounts).sort((a, b) => b[1] - a[1]) as [k, n] (k)}
                <div class="kv__r"><span>{kindLabel(k)}</span><span>{n}</span></div>
              {/each}
            </div>
            <p class="mini" style="margin-top:10px">
              分成 {domainRows().length} 份 fx（模型 × 域）。脸走 mat_face，头发走 mat_hair，其余走 mat_body。
            </p>
          </div>
        {/if}
      {/if}
    </div>

    <aside class="card wb__side">
      <div class="grp">
        <h3 class="grp__t">分类规则</h3>
        <p class="mini">后加的规则先命中。后端按名字给过一遍内置分类，这里是你盖在上面的。</p>
        <ul class="list" style="margin-top:8px">
          {#each rules as r, i (r.kw + '|' + i)}
            <li>
              <b>{r.kw}</b>
              <Icon name="ui.arrowRight" size={11} />
              <span>{kindLabel(r.kind)}</span>
              <button class="x" onclick={() => delRule(i)} title="删掉这条">×</button>
            </li>
          {/each}
        </ul>
        <div class="row row--stack" style="margin-top:8px">
          <input type="text" placeholder="关键词，比如 袖" bind:value={ruleKw} />
        </div>
        <div class="row row--stack" style="margin-top:6px">
          <select bind:value={ruleKind} aria-label="归到哪一类">
            {#each ops.KINDS as k (k.id)}<option value={k.id}>{k.label}</option>{/each}
          </select>
        </div>
        <button class="btn btn--ghost btn--sm" style="margin-top:8px" onclick={addRule}>
          <Icon name="ui.add" size={13} />加规则
        </button>
      </div>
      <div class="grp">
        <h3 class="grp__t">导出</h3>
        <div class="acts">
          <button class="btn btn--ghost" onclick={exportReport} disabled={!models.length}>
            <Icon name="ui.export" size={15} />匹配报告
          </button>
        </div>
      </div>
    </aside>
  </div>

  {#if digest}
    <div class="card pad" style="margin-top:12px">
      <h3 class="h3">报告</h3>
      <pre class="pre">{digest}</pre>
    </div>
  {/if}
{:else}
  <!-- 整页都是 `.fx` 的落点：这一页干的就是"拿几份 fx 当模板"，拖到哪儿都该认。
       不挂这一个的话，拖到模板卡外面就没人接，落点解析会退回"只收图片"那道筛，
       报一句"不是图片，没接"（用户 2026-09-23 实测）。模板卡那三行、文件那几行
       面积更小，指在它们上面时仍然归它们，不会串。 -->
  <div class="wb" data-drop-target="yaku:page">
    <div class="wb__main">
      <!-- 原来左边那一栏（文件过滤 / 分组 / 参数显示）就地解散：
           过滤与分组搬进 ② 卡顶部那条筛选条当筛选用；
           「参数显示」抽屉里已经有一个同义的，重复的那份删掉。 -->

      <div class="card pad">
        <h3 class="h3">fx 模板</h3>
        <p class="mini" style="margin-bottom:10px">
          指向养乐多包里的 mat_body.fx / mat_face.fx / mat_hair.fx。工具只读，不改你那几份。<br />
          把 .fx <b>拖到这一页任何地方</b>都行：拖到某一行上就是那个域的模板；
          拖在别处<b>按文件名猜</b>（猜不准就拖到具体那一行）。
        </p>
        <div class="tmpl" data-drop-target="yaku:tmplcard">
          {#each DOMAINS as d (d)}
            {@const t = tmpl[d]}
            <div class="tmpl__it" data-drop-target="yaku:tmpl:{d}">
              <div class="tmpl__k">{DOMAIN_LABEL[d]}</div>
              <div class="tmpl__v mini mono" title={t?.path ?? ''}>{t?.name ?? '未载入（拖 .fx 进来）'}</div>
              <span class="mini nowrap">{t ? `${t.parsed.params.length} 参数` : ''}</span>
              <button class="btn btn--ghost btn--sm" onclick={() => pickTemplate(d)}>选</button>
            </div>
          {/each}
        </div>
        {#if (tmpl.body || tmpl.face || tmpl.hair) && (!tmpl.face || !tmpl.hair)}
          <div style="margin-top:10px">
            <Note kind="warn">
              缺的域会拿已载入的那份去填。<span class="mono">MATERIAL_DOMAIN</span>
              仍然按域写对，但参数名跟那套模板对不上时，出来的东西不一定能编译。
            </Note>
          </div>
        {/if}
      </div>

      <div class="card pad">
        <div class="acts" style="margin-bottom:10px">
          <h3 class="h3" style="margin:0">要写的文件</h3>
          <span class="mini">{gen.filter(看得见).length} / {gen.length} 份</span>
          <span class="acts__sp"></span>
          <!-- 一页只许一个主按钮（规范 §10.3）：这一颗降成普通按钮，主按钮在底下 `.wb__acts` 里 -->
          <button class="btn btn--ghost btn--sm" onclick={generate}>
            <Icon name="ui.run" size={13} />重新生成
          </button>
        </div>

        <!-- 筛选条：按文件名过滤 + 按域分组（原来在左栏，左栏解散后搬到这张卡顶部） -->
        <div class="acts" style="margin-bottom:8px">
          <input
            type="text"
            placeholder="按文件名过滤"
            bind:value={文件过滤}
            aria-label="过滤文件"
            style="width:12rem"
          />
          <div class="pick">
            <!-- 这里**不报总数**：同一个 N 在 ② 卡标题里已经有一处（「看得见 M / N 份」），
                 一组数字只出现一次（设计准则 §七）。分组按钮上的计数是"每档几个"，另说。 -->
            <button class="pick__b" type="button" aria-pressed={域筛选 === null} onclick={() => (域筛选 = null)}>
              全部
            </button>
            {#each DOMAINS as d (d)}
              <button
                class="pick__b"
                type="button"
                aria-pressed={域筛选 === d}
                onclick={() => {
                  域筛选 = 域筛选 === d ? null : d;
                  编辑域 = d;
                }}
              >
                {DOMAIN_LABEL[d]} <span class="mut">({域计数[d]})</span>
              </button>
            {/each}
          </div>
        </div>

        <p class="mini" style="margin-bottom:8px">
          点一行就是把参数切到那一份；<b>不点也能直接改</b>（改动落在上面选的那个域上）。
          也可以把 .fx / .fxsub 拖到某一行上，当那个域的模板；拖到这一页别处就按文件名猜域。
        </p>

        <!-- 要写的文件排成一行：点哪个就把右边切到哪一份；也可以把 .fx 拖到某一行上当那个域的模板 -->
        {#if gen.length}
          <div class="files">
            {#each gen as g, i (g.key)}
              {#if 看得见(g)}
                <div
                  class="fbtn"
                  class:on={i === active}
                  role="button"
                  tabindex="0"
                  data-drop-target="yaku:file:{i}"
                  onclick={() => (active = i)}
                  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (active = i)}
                >
                  <b>{g.fileName}</b>
                  <span class="mini">
                    {DOMAIN_LABEL[g.domain]} · 改了 {g.diff.length} 项{#if g.filled.missing.length} · 缺 {g.filled.missing.length}{/if}
                  </span>
                  <button
                    class="btn btn--ghost btn--sm"
                    type="button"
                    title="给这一行挑一份 fx 模板（跟拖进来是一回事）"
                    onclick={(e) => {
                      e.stopPropagation();
                      void 给这一行选模板(i);
                    }}>选…</button
                  >
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      </div>

      <!-- ③ 写出与依据。**输出目录是主按钮的必填项，必须摆在这儿**（规范 §十八：
           折叠不许藏主按钮的必填项），剩下的都是读数与说明。 -->
      <div class="card">
        <div class="grp">
          <h3 class="grp__t">写到哪儿</h3>
          <div class="row">
            <span class="row__k">输出目录</span>
            <button class="btn btn--ghost btn--sm" onclick={async () => (outDir = (await pickFolder()) ?? '')}>
              选
            </button>
          </div>
          <p class="mini" style="margin-top:6px">
            {outDir || (root ? joinPath(root, 'RobinEditor_out') : '没选 —— 不选就不写盘')}
          </p>
        </div>
        {#if activeGen}
          <div class="grp">
            <h3 class="grp__t">相对模板改了什么（{activeGen.diff.length}）</h3>
            {#if activeGen.diff.length}
              <ul class="list">
                {#each activeGen.diff as d (d.name)}
                  <li>
                    <b class="mono">{d.name}</b>
                    <span class="list__sp mono">{d.from} → {d.to}</span>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="mini">没有改动。</p>
            {/if}
          </div>

          <div class="grp">
            <h3 class="grp__t">自动填的依据</h3>
            <ul class="list">
              {#each activeGen.filled.why as w (w.name)}
                <li>
                  <b class="mono">{w.name}</b>
                  <span class="list__sp">{w.value}　←　{w.from}</span>
                </li>
              {/each}
            </ul>
            {#if activeGen.filled.missing.length}
              <p class="mini" style="margin-top:10px">
                没填上的 {activeGen.filled.missing.length} 项（切到「没填上的」那个模式可以直接改）：
              </p>
              <ul class="mini ul" style="margin-top:4px">
                {#each activeGen.filled.missing as m (m)}<li class="mono">{m}</li>{/each}
              </ul>
            {/if}
          </div>
        {/if}

        <div class="grp">
          <h3 class="grp__t">要知道的事</h3>
          <ul class="mini ul">
            <li>
              生成的 fx 里有 <span class="mono">#include "shared.fxsub"</span> 和
              <span class="mono">#include "internal/shader.hlsl"</span>，所以要么放进渲染包目录，
              要么把那两样一起复制过去。
            </li>
            <li>填的是按规则配好的起手参数，不是成品效果。阴影色是拿 diffuse 压暗推的，得按角色自己调。</li>
            <li>槽 0~7 按材质顺序排。真正的子材质索引在 lightmap 的 A 通道里，工具读不到，所以顺序是猜的。</li>
            <li>渲染包不进这个仓库，工具也不改你那份模板。</li>
          </ul>
        </div>
        {#if written.length}
          <div class="grp">
            <h3 class="grp__t">上一轮</h3>
            <ul class="list">
              {#each written as w (w.file + w.note)}
                <li>
                  <b>{w.file}</b>
                  <span class="list__sp" class:bad={!w.ok}>{w.note}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>

        <!--
        参数检查器住在**主区最后一格**（③ Ray 就是这么摆的：参数行是主内容、不是侧栏）。
        原来那一版把它塞进 `aside.card.wb__side` 参数抽屉，问题是**抽屉默认收起** ——
        这一页整页干的事就是"填参数 + 写盘"，一进来参数全在视口外，新手看不到能改什么
        （设计准则 §一：主线必须一眼可见）。所以不设抽屉：参数就在主区，主按钮在它下面。
        **没生成、没选文件也能改**（那时改动落在"当前域"上，生成的时候自动叠上去）。
      -->
      <div class="card pad">
        <div class="acts" style="margin-bottom:10px">
          <h3 class="h3" style="margin:0">参数</h3>
          <span class="mini nowrap">
            正在改：{activeGen ? activeGen.fileName : `整个「${DOMAIN_LABEL[当前域]}」域`}
          </span>
          <span class="acts__sp"></span>
          <input
            type="text"
            placeholder="按名字过滤参数"
            bind:value={paramFilter}
            style="width:10rem"
            aria-label="过滤参数"
          />
          <button class="btn btn--ghost btn--sm" onclick={() => (只显示常用 = !只显示常用)}>
            {只显示常用 ? '全部参数' : '只看常用'}
          </button>
          {#if 被常用挡掉的条数 > 0}
            <span class="mini mut nowrap" title="这一档按名字和贴图挑的常用项；点左边那颗看全部">
              还挡着 {被常用挡掉的条数} 条
            </span>
          {/if}
        </div>

        <div class="row" style="margin-bottom:8px">
          <span class="row__k">改动作用到</span>
          <div class="pick">
            <button class="pick__b" type="button" aria-pressed={作用范围 === '域'} onclick={() => (作用范围 = '域')}>
              这一域的全部
            </button>
            <button class="pick__b" type="button" aria-pressed={作用范围 === '这份'} onclick={() => (作用范围 = '这份')}>
              只这一份
            </button>
          </div>
        </div>
        {#if 作用范围 === '这份' && !gen.length}
          <p class="mini" style="margin:-4px 0 8px">
            还没生成，所以现在改的先记在「{DOMAIN_LABEL[当前域]}」这个域上 —— 生成时自动叠上去。
          </p>
        {/if}

        <div class="pick" style="margin:0 0 8px">
          {#each 模式表 as m (m)}
            <button class="pick__b" type="button" aria-pressed={参数模式 === m} onclick={() => (参数模式 = m)}>
              {m}
              {#if m === '改过的'}<span class="mut">({activeGen?.diff.length ?? 0})</span>{/if}
              {#if m === '没填上的'}<span class="mut">({activeGen?.filled.missing.length ?? 0})</span>{/if}
            </button>
          {/each}
        </div>

        <div class="pane">
          {#if !activeGen && !templateOf(编辑域)}
            <p class="mini">
              先把某一域的 fx 模板拖进来（中间那排），这里就能改参数了 —— <b>不用先选中哪一份文件</b>。
            </p>
          {:else if 参数模式 === '全文'}
            {#if activeGen}
              <pre class="pre">{activeGen.text}</pre>
            {:else}
              <p class="mini">全文要在生成之后才有；现在改的值会先记着，生成时自动叠上去。</p>
            {/if}
          {:else if !模式段.length}
            <p class="mini">这个模式下没有内容。</p>
          {:else}
            {#each 模式段 as s (s.title)}
              <details class="sec" open={(openSection[s.title] ?? true) && !paramFilter}>
                <summary>
                  <span>{s.title}</span>
                  <span class="mini">{s.items.length}</span>
                </summary>
                <div class="sec__body">
                  {#each s.items as p (p.name)}
                    <div class="prow">
                      <span class="pname mono" title={p.name}>{p.name}</span>
                      {#if p.kind === 'texture'}
                        <label class="chk" title="注释掉就是不启用">
                          <input
                            type="checkbox"
                            checked={p.enabled}
                            onchange={(e) => toggleParam(active, p.name, e.currentTarget.checked)}
                          />
                          <span class="chk__box"></span>
                        </label>
                        <!-- 这一格也是一个拖放落点：把贴图拖到输入框上就填进去（见 dropzones） -->
                        <input
                          type="text"
                          value={p.value}
                          aria-label={p.name}
                          data-drop-target="yaku:{active}:{p.name}"
                          oninput={(e) => setParam(active, p.name, e.currentTarget.value)}
                        />
                      {:else if p.kind === 'switch'}
                        <label class="chk">
                          <input
                            type="checkbox"
                            checked={p.value === '1'}
                            onchange={(e) => setParam(active, p.name, e.currentTarget.checked ? '1' : '0')}
                          />
                          <span class="chk__box"></span>
                          <span class="mini">{p.value === '1' ? '开' : '关'}</span>
                        </label>
                      {:else if ops.componentCount(p.kind) > 1}
                        <!-- vec 的每个分量一行：序号 | 数字框 | 滑条（照 ③ Ray 颜色那几行的排法） -->
                        <div class="vecrows">
                          {#each partsOf(p) as v, vi (vi)}
                            {@const 范 = 范围(原值(p.name, vi))}
                            <label class="vrow">
                              <span>{vi + 1}</span>
                              <input
                                type="number"
                                step="0.01"
                                value={v}
                                aria-label="{p.name} 第 {vi + 1} 位"
                                oninput={(e) => setPart(active, p, vi, e.currentTarget.value)}
                              />
                              {#if 是数(v)}
                                <input
                                  class="range"
                                  type="range"
                                  min={范.min}
                                  max={范.max}
                                  step={范.step}
                                  value={Number(v)}
                                  aria-label="{p.name} 第 {vi + 1} 位滑条"
                                  oninput={(e) => setPart(active, p, vi, e.currentTarget.value)}
                                />
                              {/if}
                            </label>
                          {/each}
                        </div>
                      {:else if p.kind === 'float'}
                        <!-- 滑条在上、数字框在下：数值既能拖也能填（跟 ③ Ray 一个排法） -->
                        <div class="num">
                          {#if 是数(p.value)}
                            {@const 范 = 范围(原值(p.name))}
                            <input
                              class="range"
                              type="range"
                              min={范.min}
                              max={范.max}
                              step={范.step}
                              value={Number(p.value)}
                              aria-label={p.name}
                              oninput={(e) => setParam(active, p.name, e.currentTarget.value)}
                            />
                          {/if}
                          <input
                            type="number"
                            step="any"
                            value={p.value}
                            aria-label="{p.name} 数值"
                            oninput={(e) => setParam(active, p.name, e.currentTarget.value || '0')}
                          />
                        </div>
                      {:else}
                        <!-- `int` 不给滑条：实测（29 个真模板）这些 int 是**枚举**不是量 ——
                             取值就 2（从贴图取）/ 3（常量）/ SWIZZLE 下标 / PI，拖滑条没有意义。 -->
                        <input
                          type="number"
                          step="1"
                          value={p.value}
                          aria-label={p.name}
                          oninput={(e) => setParam(active, p.name, e.currentTarget.value || '0')}
                        />
                      {/if}
                      {#if p.comment}<span class="phint">{p.comment}</span>{/if}
                    </div>
                  {/each}
                </div>
              </details>
            {/each}
          {/if}
        </div>
      </div>

      <!-- 主操作条：全页**唯一**那颗主按钮待的地方（规范 §10.3 / §十六），
           排在参数下面 —— 调完顺手点它。原来那套自定义底栏 `.wbar` 删了，
           它那几行小字留在这儿当一行读数。 -->
      <div class="wb__acts">
        {#if gen.length}
          <span class="tag tag--ok">{gen.length} 份待写入</span>
          {#if diffCount}
            <span class="mini mut nowrap">合计改了 {diffCount} 个参数</span>
          {:else}
            <span class="mini mut nowrap">跟模板一致，没有改动</span>
          {/if}
        {:else}
          <span class="tag">还没有可写的文件</span>
          <span class="mini mut nowrap">先选模型目录再生成</span>
        {/if}
        {#if !(outDir || root)}
          <span class="mini mut nowrap">（没选输出目录，写不了）</span>
        {/if}
        <span class="mini mut nowrap">写盘前先备份成 .bak</span>
        <button class="btn btn--primary" disabled={!gen.length || busy || !(outDir || root)} onclick={writeAll}>
          <Icon name="ui.save" size={15} />{busy ? '写入中…' : `确认写入 ${gen.length} 份`}
        </button>
      </div>
    </div>
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
  .bad { color: var(--danger); }

  .x {
    margin-left: auto;
    border: 0;
    background: transparent;
    color: var(--content-meta);
    font: inherit;
    font-size: var(--fs-sm);
    line-height: 1;
    cursor: pointer;
    padding: 0 4px;
    border-radius: var(--r-sm);
  }
  .x:hover { color: var(--danger); }

  .pre {
    margin: 0;
    max-height: 28rem;
    overflow: auto;
    padding: 10px 12px;
    border-radius: var(--r-lg);
    background: var(--surface-2);
    border: 1px solid var(--line-divider);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    line-height: 1.6;
    white-space: pre;
    tab-size: 4;
  }

  .tmpl { display: flex; flex-direction: column; gap: 6px; }
  .tmpl__it {
    display: grid;
    grid-template-columns: 3.5rem minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border-radius: var(--r-lg);
    background: var(--surface-2);
    border: 1px solid var(--line-divider);
  }
  .tmpl__k { font-size: var(--fs-xs); color: var(--deep-text); }
  .tmpl__v { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* 要写的文件排成一行，点哪个改哪个 */
  .files {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .fbtn {
    display: grid;
    gap: 2px;
    text-align: left;
    padding: 6px 10px;
    border: 1px solid var(--line-divider);
    border-radius: var(--r-lg);
    background: var(--surface-2);
    color: var(--body-text);
    font: inherit;
    cursor: pointer;
    transition: border-color var(--t-micro) var(--ease-std), background var(--t-micro) var(--ease-std);
  }
  .fbtn:hover { background: var(--surface-3); }
  .fbtn.on {
    border-color: color-mix(in oklab, var(--primary) 45%, var(--line));
    background: color-mix(in oklab, var(--primary) 12%, var(--surface-2));
  }
  .fbtn b { font-size: var(--fs-xs); }

  /* 参数板块：高度固定，切模式只换内容（不许再往下堆一长条） */
  .pane {
    max-height: 54vh;
    overflow: auto;
    padding-right: 2px;
  }

  .sec {    border: 1px solid var(--line-divider);
    border-radius: var(--r-lg);
    margin-bottom: 8px;
    background: var(--surface-2);
  }
  .sec > summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 12px;
    cursor: pointer;
    font-size: var(--fs-xs);
    color: var(--deep-text);
    list-style: none;
  }
  .sec > summary::-webkit-details-marker { display: none; }
  .sec > summary::before {
    content: '▸';
    margin-right: -4px;
    color: var(--content-meta);
    transition: transform var(--t-micro) var(--ease-std);
  }
  .sec[open] > summary::before { transform: rotate(90deg); }
  .sec__body { padding: 2px 12px 12px; }

  /* 参数一行：名字固定宽，控件占中间的弹性位，注释另起一行满宽 */
  .prow {
    display: grid;
    grid-template-columns: 10.5rem minmax(0, 1fr);
    align-items: center;
    gap: 4px 10px;
    padding: 5px 0;
    border-top: 1px solid var(--line-divider);
  }
  .prow:first-child { border-top: 0; }
  .pname {
    font-size: var(--fs-2xs);
    color: var(--body-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* 贴图那行有勾选框 + 文本框，多占一列 */
  .prow:has(> .chk + input) { grid-template-columns: 10.5rem auto minmax(0, 1fr); }
  .prow input[type='text'],
  .prow input[type='number'] { width: 100%; }
  .phint {
    grid-column: 1 / -1;
    font-size: var(--fs-2xs);
    color: var(--content-meta);
  }
  /* 数值：滑条在上、数字框在下 —— 跟 ③ Ray 的参数行一个排法（规范：数值既能拖也能填） */
  .num { display: grid; gap: 5px; min-width: 0; }
  /* vec 的每个分量一行：序号 | 数字框 | 滑条 */
  .vecrows { display: grid; gap: 4px; min-width: 0; }
  .vrow {
    display: grid;
    grid-template-columns: 1rem 5.2rem minmax(3rem, 1fr);
    gap: 6px;
    align-items: center;
    min-width: 0;
  }
  .vrow > span { font-size: 10px; color: var(--content-meta); }
  .vrow input[type='number'] { padding: 3px 5px; font-size: var(--fs-2xs); }
  /* 这一条滑条待在网格格子里，不跨整行（全局 `.wb .range` 是"占满一行"的写法） */
  .vrow .range { grid-column: auto; width: 100%; }
</style>
