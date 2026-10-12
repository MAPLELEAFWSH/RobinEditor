/**
 * 窗口级的拖放接线 —— 只认 DOM，落点判断全在 `drop.ts`。
 *
 * 两条路，都从这儿进 `applyDrop`：
 *   · 桌面端：Tauri 开了原生拖放（`dragDropEnabled` 默认 true），
 *     webview 里的 HTML5 `drop` 一个字节都收不到，文件在系统层就被接走了。
 *     只有 `onDragDropEvent` 给真路径。
 *   · 浏览器：没有那个 API，走 HTML5。
 *
 * `pnpm dev` 里调试不会报错，就是靠这个降级。
 */
import { getCurrentWebview } from '@tauri-apps/api/webview';
import {
  applyDrop,
  baseOfPath,
  extOfName,
  parseFileObj,
  parseFileRef,
  setSlotOrder,
  收吗,
  type DragState,
  type ExtFilter,
  type Incoming
} from './drop';
import { listZones, noticeForward, updateRect, zonesAt, type DropZone } from './dropzones.svelte';
import { 记工程目录, isTauri, probeDir } from './io';

/**
 * 落进一个"收文件夹"的落点之后，顺手把它记成"现在打开的工程"。
 *
 * 判据都在落点自己身上（`zone.记`）：没写就什么都不做 —— 导出目录那类落点不该记。
 * 跟 `pickFolder(label, href)` 报到同一处（`io.ts` 的 `folderRecorder`），
 * 所以最近工程与 `recent.svelte.ts` 的 `当前工程` 是一个来源
 * （两者现在都不在界面上显示了 —— 顶栏那颗 2026-10-07、底栏那一条 2026-10-12，
 * 见 `recent.svelte.ts` 顶上那段）。
 */
function 记成工程(zone: DropZone, path: string): void {
  if (!zone.记 || !path) return;
  记工程目录(path, zone.记.label, zone.记.href);
}

/** 槽位在 DOM 上的标记。`Slot` 自己写上去 */
const KEY_ATTR = 'data-drop-key';

/** 吸附半径（CSS 像素）。槽之间那几像素的缝、卡片留白都够得着，又不会从别的卡片捞一个过来 */
const 吸附半径 = 64;

/**
 * 没正对着槽时，找**离这一点最近**的那个槽的键。
 *
 * 为什么要这个（用户 2026-09-24 报的"贴图通道处理拖拽判定有问题"）：
 * ⑦ 那几页的槽是一排挨着的，**缝只有 10px**。鼠标正好落在缝里时 `elementFromPoint`
 * 命中的是卡片背景，`slotAt` 返回空串 —— 于是交给 `drop.ts` 的兜底，
 * 而兜底是**按展示顺序挑第一个**，不是按距离。
 * 实测（`tmp\probe-⑦拖拽判定.mjs` 的丙）：图层与蒙版 / 混合 / 合并 / 通道提取四页，
 * 丢在"两个槽正中间"全都**一格都不高亮**、落下去却进了**最左边**那一格 ——
 * 用户看不出会落到哪，而且落点也不是他指的那一边。
 * 改成就近吸附之后，高亮会走到最近那一格，落点跟高亮一致。
 *
 * 超出吸附半径就仍然返回空串，交给 `drop.ts` 原来那套兜底（丢到离得远的地方，
 * 别硬塞进某一格）。
 */
function 就近的槽(x: number, y: number): string {
  let 键 = '';
  let 最近 = 吸附半径;
  for (const el of document.querySelectorAll(`[${KEY_ATTR}]`)) {
    const k = (el as HTMLElement).dataset.dropKey;
    if (!k) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    const d = Math.hypot(dx, dy);
    if (d <= 最近) {
      最近 = d;
      键 = k;
    }
  }
  return 键;
}

/** 鼠标底下那个槽。指到缝里就**就近吸附**；离得太远返回空串，由 `drop.ts` 兜底 */
function slotAt(x: number, y: number): string {
  const el = document.elementFromPoint(x, y);
  const host = el?.closest?.(`[${KEY_ATTR}]`) as HTMLElement | null;
  if (host?.dataset.dropKey) return host.dataset.dropKey;
  return 就近的槽(x, y);
}

/**
 * 先把每个已注册落点的矩形重算一遍。
 *
 * 拖拽期间页面可能滚了、面板可能展开了、窗口可能缩放了 —— 不重算的话
 * 高亮会停在旧位置，还可能把文件落进一行已经挪走的输入框里。
 */
function refreshZones(): void {
  for (const z of listZones()) {
    if (z.el) updateRect(z.id, z.el);
  }
}

/** 展示顺序就按 DOM 顺序来。比自己维护一份稳 */
function refreshOrder(st: DragState): void {
  const keys = [...document.querySelectorAll(`[${KEY_ATTR}]`)]
    .map((el) => (el as HTMLElement).dataset.dropKey ?? '')
    .filter(Boolean);
  setSlotOrder(st, keys);
}

function looksLikeFiles(e: DragEvent): boolean {
  const t = e.dataTransfer?.types;
  return !!t && [...t].includes('Files');
}

/**
 * 这个落点收什么后缀。
 *   `'any'`   → null（任何文件）
 *   数组      → 那几种
 *   没写      → undefined（只收图片，跟图片槽一致）
 */
function 落点筛法(z: { accept?: 'any' | string[] } | null): ExtFilter {
  if (!z) return undefined;
  if (z.accept === 'any') return null;
  if (Array.isArray(z.accept)) return z.accept;
  return undefined;
}

/** 落点不收这个文件时，说出来的是实话（原来一律说"不是图片"） */
function 拒收说法(z: { accept?: 'any' | string[]; dir?: boolean } | null, 名: string): string {
  if (z && Array.isArray(z.accept)) return `${名} 不是这个落点要的文件（只收 ${z.accept.map((e) => '.' + e).join(' / ')}）`;
  if (z && z.accept === 'any') return `${名} 没接上`;
  return `${名} 不是图片，没接`;
}

/**
 * 这批文件里有没有这个落点收的。
 *
 * `dir` 的落点收的是**文件夹**：拖进来的是文件时**不能**算"收得下"——
 * 它会把同一叠里明写 `accept` 的落点压掉（原来这里是无条件 `return true`，
 * 2026-09-25 三个只读审查各自独立报了这件事）。`是目录` 是这一轮拖拽**已经问过盘**的结论：
 * `null` = 还不知道（那就先当它是文件夹，高亮不会指错太久），`false` = 明确是文件。
 */
function 收得下(z: DropZone, 名字们: string[], 是目录: boolean | null = null): boolean {
  if (z.dir) return 是目录 !== false;
  const 允许 = 落点筛法(z);
  return 名字们.some((n) => 收吗(extOfName(n), 允许));
}

/**
 * 这一批文件该落给谁。
 *
 * 从最具体的那个往下找第一个**收得下**的：贴在贴图行上的 `.fx` 会被那一行拒收
 * （贴图行只收图片），但它下面还有整页那个落点接着（见 `zonesAt` 的说明）。
 * 谁都不收就把最具体的那个交回去，让它把"只收 …"那句话说出来，别一声不响。
 */
function 选落点(cands: DropZone[], 名字们: string[], 是目录: boolean | null = null): DropZone | null {
  return cands.find((z) => 收得下(z, 名字们, 是目录)) ?? cands[0] ?? null;
}

/**
 * 没落成时说的话。
 *
 * `key` 有值 = 落在图片槽上了，那是"这一处只收图片"；
 * 空 = 落的地方谁都没接 —— 那句"不是图片，没接"对拖 `.fx` 进来的人是假话
 * （2026-09-23 用户报的就是它：改材质参数那一页拖进来只得到这一句）。
 */
function 没人接说法(key: string, 名们: string[]): string {
  return key
    ? `${名们.join('、')} 不是图片，没接`
    : `${名们.join('、')} 没落在能接它的地方 —— 拖到有落点的位置，或用那一处的「选…」按钮`;
}

export function bringIn(st: DragState): () => void {
  const offs: (() => void)[] = [];
  let nativeOff: (() => void) | null = null;
  let cancelled = false;
  /** 原生那条路上鼠标最后指着的**一串**候选落点（`over` 不带后缀，得记着） */
  let hotCands: DropZone[] = [];
  /** 原生 `enter` 给的路径。`over` 里挑落点要用它判"这个落点收不收" */
  let nativePaths: string[] = [];
  /**
   * 这一轮拖进来的是**文件夹**还是文件。
   *
   * 在 `enter` 那一下**点火即走**地问一次盘，`drop` 里**同步**读这个结果 ——
   * 不在 `drop` 里 `await`：`drop` 那一整段必须是同步的（不然落点解析、报错、
   * 高亮清理全都推到微任务里，`拖材质链` 那份单测的同步断言会全部读空，
   * 实测 10 条红）。真机上 `enter` 一定先到（wry 的 `Drop` 只在 `DragEnter` 之后才发），
   * 拖拽过程足够这次探盘回来。
   *
   * `null` = 还不知道 / 问不出来 → 按老规矩办（`dir` 落点照常参选）。
   */
  let 是目录: boolean | null = null;

  async function 问是不是目录(p: string | undefined): Promise<boolean | null> {
    if (!p) return null;
    try {
      const r = await probeDir(p);
      if (!r || !r.exists) return null;
      return !!r.is_dir;
    } catch {
      return null;
    }
  }

  /**
   * 鼠标底下有没有"通用落点"（不是图片槽的那种）。
   *
   * `名字们` 是手上这批文件的名字：叠着的落点里挑**收得下它们的那个**
   * （贴图行拒收 `.fx` 之后还有整页那一个接着）。
   *
   * `flash=false` 用在**落下去之后**：那时候不能再挂高亮，
   * 不然刚清掉的 `is-drop` 会被重新加上，看着就是"拖完了还亮着"。
   */
  function zoneUnder(
    x: number,
    y: number,
    名字们: string[],
    flash = true,
    是不是目录: boolean | null = null
  ) {
    refreshZones();
    const cands = zonesAt(x, y);
    const z = 选落点(cands, 名字们, 是不是目录);
    if (flash) noticeForward(z);
    return { z, cands };
  }

  /**
   * 原生载荷里那个坐标 → CSS 像素。
   *
   * wry 在 `webview2/drag_drop.rs` 里对 `DragEnter` / `DragOver` / `Drop` 三个回调
   * 都做 `ScreenToClient(hwnd)`，交给前端的**是设备像素**（那个 hwnd 是 webview 的子窗口，
   * 原点是视口左上角）。落点矩形和 `elementFromPoint` 都按 CSS 像素算，
   * 所以得除一次 `devicePixelRatio` —— 125% 缩放的屏上不除会整体偏右下。
   */
  function 原生转CSS(p?: { x: number; y: number } | null): { x: number; y: number } | null {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    const dpr = devicePixelRatio || 1;
    return { x: p.x / dpr, y: p.y / dpr };
  }

  /** 一轮拖拽结束（落下了 / 出窗口了）：状态和高亮一起收干净 */
  function clearHot() {
    st.active = false;
    st.over = '';
    hotCands = [];
    nativePaths = [];
    noticeForward(null);
  }

  /**
   * 落完之后把话说清楚。
   *
   * `没接的` 是被筛法挡掉的；`接了几个` 是 `applyDrop` 真填进去的。
   * 两处都不出声的时候（落在一片没人接的空地上）也要出声 ——
   * 以前那条路上是静默的。
   */
  function 落完说话(key: string, incoming: Incoming[], 没接的: string[], 接了几个: number) {
    if (没接的.length) st.fail(没人接说法(key, 没接的));
    else if (!接了几个 && !key && incoming.length) st.fail(没人接说法('', incoming.map((it) => it.name)));
    clearHot();
  }

  const over = (e: DragEvent) => {
    if (!looksLikeFiles(e)) return;
    // 不拦下来后面收不到 drop；顺便把光标标成"复制"
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    st.active = true;
    refreshOrder(st);
    /* 通用落点优先：指着一行贴图输入框时，那一行比图片槽更具体 */
    const { z } = zoneUnder(e.clientX, e.clientY, []);
    st.over = z ? '' : slotAt(e.clientX, e.clientY);
  };

  /** 拖到窗口外面。子元素之间挪动也会报 dragleave，所以只认"出去"那种 */
  const leave = (e: DragEvent) => {
    const to = e.relatedTarget as Node | null;
    if (to && document.documentElement.contains(to)) return;
    clearHot();
  };

  /** 窗口外拖进来的东西才接。窗口内拖图层、拖排序那些不带 Files，放过 */
  const enter = (e: DragEvent) => {
    if (looksLikeFiles(e)) st.active = true;
  };

  const drop = (e: DragEvent) => {
    if (!looksLikeFiles(e)) return;
    /* 已经有人收下了就别再收一遍。
       `Slot` 自己那套 HTML5 的 `ondrop` 会 `preventDefault`（它拿 `dataTransfer.files`
       交给页面自己的 `ondropfile`），但它**不 `stopPropagation`**，事件照样冒到 window ——
       于是同一次落放被处理两遍（槽一发、这里再一发）。 */
    if (e.defaultPrevented) return;
    e.preventDefault();
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    /* 落下来这一下有真名字了：叠着的落点里挑收得下的那个 */
    const { z: zone } = zoneUnder(e.clientX, e.clientY, files.map((f) => f.name), false);
    const key = zone ? '' : slotAt(e.clientX, e.clientY);
    const incoming: Incoming[] = [];
    const skipped: string[] = [];
    /* 筛法跟着落点走：落点说收什么就收什么，没人接才按图片筛 */
    const 允许 = 落点筛法(zone);
    for (const f of files) {
      const it = parseFileObj(f, 允许);
      if (it) incoming.push(it);
      else skipped.push(f.name);
    }
    /* 通用落点只认真路径：它要的是"这个文件在磁盘上的位置"（写进 conf/fx），
       而浏览器那条合成 File 没有路径，给它也是错的值 */
    if (zone) {
      if (zone.dir && !incoming.some((it) => it.path)) {
        /* 浏览器那条路拿不到文件夹的真实路径（安全模型决定的），别让人对着空气试 */
        st.fail(isTauri() ? '松手那一下没拿到路径，用「选目录」按钮吧' : '浏览器里拖文件夹拿不到真路径，这处只能用桌面端或「选目录」按钮');
        clearHot();
        return;
      }
      const first = incoming[0];
      if (first?.path) {
        zone.onDrop({
          path: first.path,
          name: first.name,
          rel: first.name,
          ext: first.ext,
          size: first.file?.size ?? 0
        });
        /* 拖进来的目录也算"打开工程"（跟原生那条路同一个出口，见 `记成工程`） */
        if (zone.dir) 记成工程(zone, first.path);
      } else if (first) {
        st.fail(`${first.name} 没有真实路径，这个位置只能拖桌面端的文件`);
      }
      for (const s of skipped) st.fail(拒收说法(zone, s));
      clearHot();
      return;
    }
    void applyDrop(st, incoming, key).then((r) => 落完说话(key, incoming, skipped, r.filled));
    /* 当场也要收一遍：`applyDrop` 是异步的，等它回来之前高亮会一直挂着 */
    noticeForward(null);
  };

  addEventListener('dragenter', enter);
  addEventListener('dragover', over);
  addEventListener('dragleave', leave);
  addEventListener('drop', drop);
  offs.push(() => {
    removeEventListener('dragenter', enter);
    removeEventListener('dragover', over);
    removeEventListener('dragleave', leave);
    removeEventListener('drop', drop);
  });

  /* 桌面端还要接系统层那份。浏览器里没有这个 API，整个跳过 */
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    void getCurrentWebview()
      .onDragDropEvent((ev) => {
        if (cancelled) return;
        const p = ev.payload as {
          type: string;
          paths?: string[];
          position?: { x: number; y: number };
        };
        switch (p.type) {
          case 'enter':
            st.active = true;
            /* `over` 不带路径，只有 `enter` 带 —— 挑落点时要拿它判"收不收" */
            nativePaths = p.paths ?? [];
            /* 点火即走地问一次"是文件还是文件夹"（`drop` 里要同步用它的结果，见 `是目录`） */
            void 问是不是目录(nativePaths[0]).then((v) => (是目录 = v));
            /* **顺手就把落点算一遍**。`over` 可能一次都不来（拖进来就撒手，
               或者鼠标一动没动），但 `enter` 一定来过：wry 的 `Drop` 只在 `DragEnter`
               设了 `enter_is_valid` 之后才发（`webview2/drag_drop.rs`）。
               在这儿算出候选，`drop` 那一下就算自己不带坐标也还有落点可用。 */
            {
              const at = 原生转CSS(p.position);
              if (at) {
                const { z, cands } = zoneUnder(at.x, at.y, nativePaths.map(baseOfPath));
                hotCands = cands;
                st.over = z ? '' : slotAt(at.x, at.y);
              }
            }
            refreshOrder(st);
            break;
          case 'over': {
            const at = 原生转CSS(p.position);
            if (at) {
              const { z, cands } = zoneUnder(at.x, at.y, nativePaths.map(baseOfPath));
              /* 记下这一串：`drop` 回来时要按真后缀再挑一次 */
              hotCands = cands;
              st.over = z ? '' : slotAt(at.x, at.y);
            }
            break;
          }
          case 'drop': {
            const paths = p.paths ?? [];
            const incoming: Incoming[] = [];
            const skipped: string[] = [];
            /* 落点怎么定：**`drop` 自己带的位置最准**（鼠标最后停在哪就是哪），
               拿它在当下重算一遍矩形再命中 —— `over` 那次算出来的可能已经过期
               （拖的过程中页面滚了、抽屉展开了）。

               `drop` 不带坐标时才退回 `enter` / `over` 记下的那一串。
               **必须有这条退路**：没有坐标又没得退，就等于"没找到落点"，
               后缀筛法退回默认的"只收图片"，拖一个 `.fx` 进来得到那句
               "不是图片，没接" —— 落点明明声明了 accept，却因为没轮到它说话
               （2026-09-23 用户报的就是这一条）。 */
            const at = 原生转CSS(p.position);
            let cands: DropZone[];
            let 落点键: string;
            if (at) {
              refreshZones();
              cands = zonesAt(at.x, at.y);
              落点键 = cands.length ? '' : slotAt(at.x, at.y);
              /* `drop` 的坐标偶尔不可靠（Tauri 的 API 文档就写着"调试器开着时落点会偏"）。
                 那一下算不出落点、但刚才 `over` 明明指着一处，就以 `over` 那次为准。 */
              if (!cands.length && hotCands.length) {
                cands = hotCands;
                落点键 = st.active ? st.over : '';
              }
            } else {
              cands = hotCands;
              落点键 = st.active ? st.over : '';
            }
            /* 落下来这一下有真后缀了：叠着的落点里挑收得下的那个。
               `是目录` 是 `enter` 那一下问好的 —— `false`（明确是文件）时把 `dir` 落点
               **从候选里剔掉**：光靠 `收得下` 拒它不够，`选落点` 的兜底 `cands[0]`
               会把它又交回来（2026-09-25 实测：剔在 `收得下` 里没用，量具照样报
               "拖文件进来被当目录扫了"）。全程同步。 */
            const 候选 = 是目录 === false ? cands.filter((c) => !c.dir) : cands;
            const z = 选落点(候选, paths.map(baseOfPath), 是目录);
            hotCands = [];
            /* 认文件夹的落点（渲染包目录那几处）：不过后缀那道筛 ——
                文件夹在拖放事件里只给一条路径，没有后缀，按图片筛会被当成"不是图片"挡掉。 */
            if (z?.dir) {
              const dir = paths[0];
              if (dir) {
                z.onDrop({ path: dir, name: baseOfPath(dir), rel: baseOfPath(dir), ext: '', size: 0 });
                /* **拖进来的目录也算"打开工程"**（用户 2026-09-26）。
                   不补这一下的话：点「选目录」记下的那份会变，拖同一个目录进来不变（底账对不上）。 */
                记成工程(z, dir);
              } else {
                st.fail('松手那一下没拿到路径，用「选目录」按钮吧');
              }
              clearHot();
              break;
            }
            /* 整页就是一个 `dir` 落点、结果拖进来的是**文件**：`选落点` 会把那些落点全剔掉，
               这里得说人话。原来它会被当目录交给 `scan_dir`，报一句"不是一个目录"甚至
               拿文件路径当目录用（三个只读审查各自独立报的，2026-09-25）。 */
            if (!z && 是目录 === false && cands.some((c) => c.dir)) {
              const 名 = paths.length === 1 ? baseOfPath(paths[0]) : `${paths.length} 个文件`;
              st.fail(`${名} 是文件 —— 这一处收的是文件夹：把整个文件夹拖进来，或用那一处的「选目录」按钮。`);
              clearHot();
              break;
            }
            for (const path of paths) {
              const it = parseFileRef(path, 落点筛法(z));
              if (it) incoming.push(it);
              else skipped.push(path.split(/[\\/]/).pop() ?? path);
            }
            if (z) {
              const first = incoming[0];
              if (first) {
                z.onDrop({
                  path: first.path,
                  name: first.name,
                  rel: first.name,
                  ext: first.ext,
                  size: 0
                });
              }
              for (const s of skipped) st.fail(拒收说法(z, s));
              clearHot();
              break;
            }
            // 落点用鼠标最后指的那个；`over` 没来过就用 `drop` 带的位置现算的那一个
            const key = 落点键;
            void applyDrop(st, incoming, key).then((r) => 落完说话(key, incoming, skipped, r.filled));
            noticeForward(null);
            break;
          }
          case 'leave':
            clearHot();
            break;
        }
      })
      .then((un) => {
        if (cancelled) void un();
        else nativeOff = () => void un();
      })
      .catch(() => {
        /* 拿不到就只剩 HTML5 那条，浏览器里就是这样，不是错 */
      });
    offs.push(() => nativeOff?.());
  }

  return () => {
    cancelled = true;
    for (const off of offs) off();
  };
}

/** 套件用：DOM 属性的名字只在这一个地方写 */
export const DROP_KEY_ATTR = KEY_ATTR;
