<script lang="ts">
  /**
   * ② ikClut 调色。
   *
   * 三个分区：生成 / 混合 / 导出。
   *
   * CLUT 的排法不是猜的，是对着 ikClut 包自己那套格式来的（本工具就是要把烘出来的表喂给它）：
   *   ClutPixelSize = 32，所以一张 1024×32 的图 = 32 个 32×32 的切片横排。
   *   切片内横轴 = 红、纵轴 = 绿，切片号 = 蓝；
   *   也就是**蓝通道从左到右递增**，对应 img.ts 里 flipB = false。
   *   4 张的混法：X 混 (1,2) 和 (3,4)，Y 再混这两组；
   *   官方注释给的 X=0.3 / Y=0.7 → 21% / 9% / 49% / 21%，和这个公式对得上。
   *
   * 纯运算都在 ops.ts 里，那边有 Node 测试。这个文件只管接和显示。
   */
  import type { WbProps } from '$lib/modules/wb-props';
  import { Slots } from '$lib/wb.svelte';
  import {
    applyClut,
    clutFromImage,
    clutToImage,
    imageDataToUrl,
    imageDataToUrl记住,
    previewOf,
    预览长边,
    type Clut,
    type CurveKind
  } from '$lib/img';
  import { pickFile, pickSavePath, readTextFile, saveBytes, saveImage } from '$lib/io';
  import Preview from '$lib/components/wb/Preview.svelte';
  import NumBox from '$lib/components/wb/NumBox.svelte';
  import { isTauri } from '$lib/open';
  import Slot from '$lib/components/wb/Slot.svelte';
  import Note from '$lib/components/wb/Note.svelte';
  import { 提示自动关毫秒 } from '$lib/ui.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Curve from './Curve.svelte';
  import { History } from '$lib/history';
  import { 提交一步 } from './撤销';
  import { onMount, untrack } from 'svelte';
  import {
    DEFAULT_REF,
    clutFromReference,
    type RefSampleOptions
  } from './refsample';
  import {
    CLUT_H,
    CLUT_SIZE,
    CLUT_W,
    channelDiff,
    clutWeights,
    makeClutGrid,
    makeTestImage,
    mixClutTables
  } from './ops';
  import { 烘成CLUT, 跑链, 造链缓存, type 链缓存 } from './grade/chain';
  import { 算指纹 } from './参数指纹';
  import { 解析Cube, Lut转3D } from './grade/lut';
  import {
    新建基本,
    新建曲线,
    新建Lut参数,
    新建色轮,
    新建Hsl,
    新建Log,
    新建变形,
    HSL段,
    LOG曲线名,
    变形边,
    新节点id,
    节点名,
    节点一句,
    曲线是恒等,
    type BasicParams,
    type CurveChannel,
    type CurveParams,
    type GradeNode,
    type HslParams,
    type LogCurveId,
    type LogParams,
    type LutParams,
    type NodeKind,
    type WarpParams,
    type Wheel,
    type WheelsParams
  } from './grade/types';

  let { panelId = 'clut' }: WbProps = $props();

  /**
   * 细档的**上限**：源不超过它就一点都不缩 —— 细档就是原分辨率。
   *
   * 用户 2026-09-23 原话："调色栏展示的图片要原分辨率不压缩"。这一档只在停手后跑，
   * 所以按实测是付得起的（`tmp\量-②原分辨率开销.mjs` + `tmp\量-②真图编码.mjs`，真 4096×2048 贴图）：
   * `跑链` 21ms + 编码 92ms ≈ **113ms**，`原图` 那张再编码一次 ≈ 205ms 一次性。
   *
   * **前提是把自检那两遍挪到粗图上**（见下面 `result`）：`applyClut` 在 4096×2048 上一遍 540ms、
   * `channelDiff` 39ms —— 留在原图上，每停一次手要堵主线程 700ms。
   *
   * 4096 这个上限的依据是**真素材**：`实战测试用例\贴图` 254 张里最大的长边就是 4096
   * （2049~4096 那 17 张全是 4096×2048）。再大（8192² 那种，源图自己就 268MB）不赌，
   * 退回按屏宽算的那一档，并在读数里写明"超出上限、缩到多少"。
   */
  const 细预览上限 = 4096;
  /** 超上限时退到这一档：还是按屏宽算（`预览长边` 的契约没动，别的页面还在用它） */
  const 回退长边 = 预览长边(1024);

  /**
   * 拖动时先给粗的，停手之后再补一张细的。
   *
   * `tmp/grade-cost.mjs` 量的（1024×614）：整条链 62.7ms + 自检把表打回图 31.4ms ≈ 94ms
   * —— 拖滑杆会掉到十来帧。缩到 512 长边大约四分之一，能跟上手。
   *
   * 两级不是为了"省事"，两级是一样的链、只是分辨率不同；停手后那一张才是给人看的，
   * 而且那张现在是**原分辨率**。
   */
  const 粗预览长边 = 512;
  /** 最后一次改动之后隔这么久算"停手了" */
  const 停手毫秒 = 250;
  let 停手 = $state(false);

  /* ---------------- 原图 / 调色后：两个各自独立可缩放、可平移的视图 ----------------
     用户原话："原图 / 调色后显示图片的区域要原图和调色后的图都可以缩放拖动"。
     同步开关**默认都关**（用户拍的板）：放大对比细节时经常要各自看各自的。 */
  type 比对模式 = 'after' | 'before' | 'both';
  let 比对 = $state<比对模式>('both');
  let 同步倍 = $state(false);
  let 同步移 = $state(false);
  /** 0 = 适应 */
  let 左倍 = $state(0);
  let 右倍 = $state(0);
  let 左位置 = $state({ x: 0, y: 0 });
  let 右位置 = $state({ x: 0, y: 0 });

  /** 快照：把当前这一屏（模式 + 两边的倍率与位置）存成一个可以切回去的位 */
  type 快照 = {
    比对: 比对模式;
    左倍: number;
    右倍: number;
    左位置: { x: number; y: number };
    右位置: { x: number; y: number };
  };
  let 快照A = $state<快照 | null>(null);
  let 快照B = $state<快照 | null>(null);

  /**
   * 同步缩放 / 同步平移。
   *
   * **这里是单向的：谁动了，就把另一边拉过去。没有 `$effect`。**
   *
   * 以前是两个 `$effect`：读两边的值、再写回其中一个。那种形状一旦被读的那个值
   * 也是 `$state`（当时那个"上次值"记录就是），effect 就会把自己再叫一遍 ——
   * 跑满深度上限抛 `effect_update_depth_exceeded`，抛完启动幕布再也不撤，
   * 整页停在 `opacity: 0`，看着就是"点了没反应、界面卡死"。
   * 实测复现记录在 `tmp\坏掉对照-②.log`。
   *
   * 现在由 `Preview` 在**用户动作**发生时（按钮 / 滚轮 / 拖动 / 滚动）回调过来，
   * 只可能一侧动、另一侧跟，方向是死的，构不成环。
   */
  function 左动了倍(v: number) {
    左倍 = v;
    if (同步倍) 右倍 = v;
  }
  function 右动了倍(v: number) {
    右倍 = v;
    if (同步倍) 左倍 = v;
  }
  function 左动了移(p: { x: number; y: number }) {
    左位置 = p;
    if (同步移) 右位置 = { ...p };
  }
  function 右动了移(p: { x: number; y: number }) {
    右位置 = p;
    if (同步移) 左位置 = { ...p };
  }

  function 存快照(哪个: 'A' | 'B') {
    const s: 快照 = {
      比对,
      左倍,
      右倍,
      左位置: { ...左位置 },
      右位置: { ...右位置 }
    };
    if (哪个 === 'A') 快照A = s;
    else 快照B = s;
    msg = { kind: 'info', text: `把当前这一屏存到快照 ${哪个}（模式 + 两边倍率与位置）` };
  }
  function 用快照(哪个: 'A' | 'B') {
    const s = 哪个 === 'A' ? 快照A : 快照B;
    if (!s) {
      msg = { kind: 'warn', text: `快照 ${哪个} 还是空的，先按「存到 ${哪个}」` };
      return;
    }
    比对 = s.比对;
    左倍 = s.左倍;
    右倍 = s.右倍;
    左位置 = { ...s.左位置 };
    右位置 = { ...s.右位置 };
  }

  /* ---------------- 参数板：固定板块 + 标签切换 ----------------
     用户原话："那一长串过长面板操作反人类……应该分成一个固定合适的板块切换不同选项"。 */
  type 参数页id = 'basic' | 'curve' | 'wheels' | 'hsl' | 'log' | 'warp' | 'lut';
  const 参数页表: { id: 参数页id; 名: string }[] = [
    { id: 'basic', 名: '基本' },
    { id: 'curve', 名: '曲线' },
    { id: 'wheels', 名: '色轮' },
    { id: 'hsl', 名: 'HSL' },
    { id: 'log', 名: 'LOG/HDR' },
    { id: 'warp', 名: '变形' },
    { id: 'lut', 名: 'LUT' }
  ];
  let 参数板 = $state<参数页id>('basic');

  /* 参数一变就把「停手」推倒重来 —— 见下面 `参数指纹` 那一段（它得排在参数声明之后） */

  /** 现在这张预览按多长的边算 */
  /**
   * 预览的分段缓存，**一级一张**。
   *
   * 粗（拖动中）和细（停手后）是两个不同尺寸的源图，缓存按源图身份认路，
   * 混用会让两边互相作废 —— 所以分开存。拖滑杆时只重跑被改动节点之后的几步，
   * 前面几步直接拿上一次的中间结果。
   */
  const 预览缓存 = new Map<number, 链缓存>();
  function 取缓存(src: ImageData): 链缓存 {
    const 键 = src.width * src.height;
    let c = 预览缓存.get(键);
    if (!c) {
      c = 造链缓存();
      预览缓存.set(键, c);
    }
    return c;
  }

  /* ---------------------------------------------------------- 基准图 */

  const refSlots = new Slots('ikclut.ref', [{ id: 'ref', label: '参考图' }]);
  let useTest = $state(true);

  const testImg = makeTestImage();
  const grid = makeClutGrid(CLUT_SIZE);

  /** 现在这一档用的源（用了程序生成的测试图就是那张测试图）。三处引用都收在这一处 */
  const 源图 = $derived(useTest || !refSlots.get('ref').data ? testImg : refSlots.get('ref').data!);

  /** 真源图尺寸（不随粗/细档变）—— 读数里那个"源"报的是它 */
  const 源尺寸 = $derived({ w: 源图.width, h: 源图.height });

  const 源长边 = $derived(Math.max(源图.width, 源图.height));

  /** 细档按多长的边算：**源没超上限就一点都不缩**（`previewOf` 走"不用缩"那条早退，原样返回源） */
  const 细长边 = $derived(源长边 <= 细预览上限 ? 源长边 : 回退长边);

  /** 现在这张预览按多长的边算：拖动中给粗的，停手后给原分辨率 */
  const 当前长边 = $derived(停手 ? 细长边 : 粗预览长边);

  const baseImage = $derived(previewOf(源图, 当前长边));

  /**
   * **细档的尺寸**，给两个 `Preview` 当"适应倍"的基准。
   *
   * 为什么需要它：拖动中给的是 512 的粗图、停手后换成原分辨率的细图（源只有 512 时两张一样）。
   * `Preview` 原来按**当前这张图**的像素算适应倍 —— 粗图 512 装在 643 宽的框里"装得下"，
   * 于是按 1:1 显示成 512；细图装不下，按框宽缩着显示成 643。
   * 结果每敲一下参数、图就在 643 和 512 之间跳一次（用户报的"图片大小异常波动"）。
   * 传细图的尺寸当基准之后，两级显示同一大小，停手只是"变清楚"。
   */
  const 细预览尺寸 = $derived.by(() => {
    const p = previewOf(源图, 细长边); // `previewOf` 按（源, 长边）记忆化，这里不会重复算
    return { w: p.width, h: p.height };
  });

  /** 这一档是不是原分辨率（读数与说明文案照它说人话） */
  const 是原分辨率 = $derived(细长边 >= 源长边);

  /* ---------------------------------------------------------- 调色链 */

  /**
   * 参数与"链的形状"分开放，链由两者派生出（`链` 那个 `$derived`）。
   *
   * 为什么不全塞进一个深对象里改：调色参数是成套的滑杆状态，链要管的是
   * **顺序 / 开关 / 增删**。分开之后"重排"只动 `链形` 那一个数组，
   * 不会碰到参数；而且派生出来的链每次都是新的，`跑链` 拿到的是纯数据。
   */
  let 基本 = $state<BasicParams>(新建基本());
  let 曲线 = $state<CurveParams>(新建曲线());
  let lutP = $state<LutParams>(新建Lut参数());
  let 色轮 = $state<WheelsParams>(新建色轮());
  let hslP = $state<HslParams>(新建Hsl());
  let logP = $state<LogParams>(新建Log());
  let 变形 = $state<WarpParams>(新建变形());

  /** 色轮那四个轮子。取的是 `$state` 代理里的同一个对象，`bind` 进去改的就是它 */
  const 轮清单 = $derived<{ 名: string; 轮: Wheel }[]>([
    { 名: '暗部', 轮: 色轮.暗 },
    { 名: '中间调', 轮: 色轮.中 },
    { 名: '高光', 轮: 色轮.高 },
    { 名: '全局', 轮: 色轮.全局 }
  ]);

  /* HSL 八段用"选一段再调"的排法：24 个滑杆一次铺出来没法看 */
  let hsl选 = $state(0);
  /* 变形两张网格同理：选一张、选一格、再调那一格 */
  let 变形张 = $state<'饱和' | '亮度'>('饱和');
  let 变形选 = $state(0);
  const 变形格 = $derived(变形张 === '饱和' ? 变形.色相饱和 : 变形.色相亮度);

  /** 色轮上那个色相角的色块颜色 */
  function 色轮色(h: number): string {
    return `hsl(${Math.round(h)} 85% 55%)`;
  }

  /** 变形网格每一格的底色：正偏红、负偏蓝，深浅按绝对值 */
  function 格底(v: number): string {
    if (!v) return 'transparent';
    const a = Math.min(1, Math.abs(v));
    return v > 0 ? `rgba(217,83,79,${a})` : `rgba(74,127,208,${a})`;
  }

  /**
   * 插值方式跟着曲线节点走（存在 `曲线.kind` 里，不另开一份状态 ——
   * 两份状态迟早会漂开，这工程已经在别处吃过这个亏）。
   *
   * 默认给线性，不给平滑。踩过一次：evalCurve 的 'smooth' 是两点之间做 smoothstep，
   * 所以只有两个端点时（0,0）→（1,1）出来的**不是恒等**，是一条 S 曲线 ——
   * 等于一进这个页面每条通道都被偷偷加了对比度，而且界面上看不出来。
   */
  type 链形一格 = { id: string; kind: NodeKind; on: boolean };
  let 链形 = $state<链形一格[]>([
    { id: 新节点id(), kind: 'basic', on: true },
    { id: 新节点id(), kind: 'curves', on: true }
  ]);

  function 打包(n: 链形一格): GradeNode {
    if (n.kind === 'basic') return { kind: 'basic', id: n.id, on: n.on, p: 基本 };
    if (n.kind === 'curves') return { kind: 'curves', id: n.id, on: n.on, p: 曲线 };
    if (n.kind === 'wheels') return { kind: 'wheels', id: n.id, on: n.on, p: 色轮 };
    if (n.kind === 'hsl') return { kind: 'hsl', id: n.id, on: n.on, p: hslP };
    if (n.kind === 'log') return { kind: 'log', id: n.id, on: n.on, p: logP };
    if (n.kind === 'warp') return { kind: 'warp', id: n.id, on: n.on, p: 变形 };
    return { kind: 'lut', id: n.id, on: n.on, p: lutP };
  }

  /** 界面上跑的就是这条 —— 预览、自检、导出三处共用 */
  const 链 = $derived<GradeNode[]>(链形.map(打包));

  function 加节点(k: NodeKind) {
    if (链形.some((n) => n.kind === k)) {
      msg = { kind: 'info', text: `链上已经有一个「${节点名[k]}」了，同一种先只放一个。` };
      return;
    }
    链形.push({ id: 新节点id(), kind: k, on: true });
  }

  function 挪(i: number, 方向: number) {
    const j = i + 方向;
    if (j < 0 || j >= 链形.length) return;
    const 抄 = [...链形];
    [抄[i], 抄[j]] = [抄[j], 抄[i]];
    链形 = 抄;
  }

  let flipB = $state(false);

  /**
   * 原图那张和参数无关，单独派生一次就够，别每拖一下滑杆都重新编码一遍 PNG。
   *
   * 用带记忆的那版：细档改成原分辨率之后，`baseImage` 每停一次手就在
   * 512 粗图 ↔ 原图之间换一次，而**原图像素自始至终没变** ——
   * 不带记忆就是每次停手白编一张 4096×2048（实测纯编码 92ms）。
   */
  const beforeUrl = $derived(imageDataToUrl记住(baseImage));

  /** 抄参考图模式：不调参数，直接按参考图的亮度分带取色拼 CLUT */
  let fromRef = $state(false);
  let refOpts = $state<RefSampleOptions>({ ...DEFAULT_REF });

  /* 混合页那三个旋钮。**声明在这里、不在混合面板旁边**：`历史指纹` 要读它们，
     而它排在参数指纹后面（用 `let` 声明在下面就是 TDZ，`svelte-check` 直接报
     "used before its declaration"）。 */
  let numClut = $state(2);
  let mixX = $state(0.5);
  let mixY = $state(0.5);

  /* ---------------- 撤销 / 重做（按步） ----------------

     用户 2026-09-23 要的："调色需要可以按步撤销操作"。

     栈用现成的 `$lib/history.ts`（⑦ 通道那边是同一份，不另造）：快照式、同键合并且带时间窗、
     上限 120 步。**记的是整套调色状态**：链（顺序/开关/增删）+ 七组参数 + 切片反序 +
     抄参考图那套 + 混合面板那几个旋钮。**不记**：源图与参考图本身、`useTest`
     （那是"放素材"不是"改参数" —— 跟 ⑦ 一个口径）、界面焦点（当前参数板 / 选的 HSL 段 /
     变形格）、A/B 对照槽（用户自己存的档）。

     **在哪记**：参数是 `bind:` 直连的几十个控件，逐个加 handler 动静太大 ——
     复用已有的 `停手` 防抖：一次改动落定（250ms 内没有新改动）时提交一步。
     触发源是 `历史指纹`（预览指纹 +「混合」+「抄参考图」—— 那两样不在预览指纹里，
     少了它们点错了撤不回来，见 `历史指纹` 那一段）。
     ⑦ 那边留过一条实测教训：**自动记（挂 `$effect`）会报 `effect_update_depth_exceeded`** ——
     这里没走那条路，提交发生在 `setTimeout` 的回调里，不是 effect 的同步执行体。
  */
  type 调色快照 = {
    链形: 链形一格[];
    基本: BasicParams;
    曲线: CurveParams;
    色轮: WheelsParams;
    hsl: HslParams;
    log: LogParams;
    变形: WarpParams;
    lut: LutParams;
    切片反序: boolean;
    从参考图: boolean;
    抄参考图: RefSampleOptions;
    混合: { 表数: number; x: number; y: number };
    /**
     * **用的是哪张源**。用户 2026-09-24 定的：载入参考图 / 导入 `.cube` **也要算一步**，
     * 撤销能退回去 —— 所以"哪张图"必须在快照里。
     *
     * 这里存的是**对象引用**，不是像素副本：本工程的规矩是"源图换引用、不改内容"
     * （`previewOf` 的缓存注释里就写着这条），所以记引用既省内存又准。
     * 注意它**不进 `$state.snapshot`**（ImageData 不是普通对象，不该被深拷）——
     * 见下面 `取快照` 是分两步拼的。
     */
    源: { 用测试图: boolean; 参考图: ImageData | null; 参考图引用: unknown };
  };

  const 撤销栈 = new History<调色快照>({ cap: 120, coalesceMs: 600 });
  let 能撤销 = $state(false);
  let 能重做 = $state(false);
  let 撤销读数 = $state('');

  /** 现在的整套状态，深拷一份。**必须深拷**：浅拷的话后面改参数会把历史里那一格一起改掉，撤销等于没撤 */
  function 取快照(): 调色快照 {
    /* 分两步拼：参数那份走 `$state.snapshot` 深拷；**源图那份只记引用** ——
       `ImageData` 不是普通对象，塞进 `$state.snapshot` 里既没意义（像素本来就没人就地改）也不该拷。 */
    const 参数份 = $state.snapshot({
      链形,
      基本,
      曲线,
      色轮,
      hsl: hslP,
      log: logP,
      变形,
      lut: lutP,
      切片反序: flipB,
      从参考图: fromRef,
      抄参考图: refOpts,
      混合: { 表数: numClut, x: mixX, y: mixY }
    }) as Omit<调色快照, '源'>;
    const 槽 = refSlots.get('ref');
    return { ...参数份, 源: { 用测试图: useTest, 参考图: 槽.data, 参考图引用: 槽.ref } };
  }

  /** 只有下面几个函数会写这几个按钮状态（不在 effect 里写，免得自己触发自己） */
  function 同步撤销钮() {
    能撤销 = 撤销栈.canUndo;
    能重做 = 撤销栈.canRedo;
    撤销读数 = 撤销栈.size ? `${撤销栈.index + 1} / ${撤销栈.size}` : '';
  }

  function 套用快照(s: 调色快照) {
    链形 = s.链形;
    基本 = s.基本;
    曲线 = s.曲线;
    色轮 = s.色轮;
    hslP = s.hsl;
    logP = s.log;
    变形 = s.变形;
    lutP = s.lut;
    flipB = s.切片反序;
    fromRef = s.从参考图;
    refOpts = s.抄参考图;
    numClut = s.混合.表数;
    mixX = s.混合.x;
    mixY = s.混合.y;
    /* 源也还原：载入参考图 / 导入 `.cube` 现在是可撤销的一步（用户 2026-09-24 定的），
       所以撤销时要把"用的是哪张源"一起放回去 —— 清空也是一个状态（参考图为 null）。 */
    useTest = s.源.用测试图;
    refSlots.set('ref', s.源.参考图引用 as never, s.源.参考图);
  }

  function 撤销一步() {
    const s = 撤销栈.undo();
    if (!s) return;
    套用快照(s);
    同步撤销钮();
  }
  function 重做一步() {
    const s = 撤销栈.redo();
    if (!s) return;
    套用快照(s);
    同步撤销钮();
  }

  /** Ctrl+Z / Ctrl+Shift+Z（也收 Ctrl+Y）。⑦ 通道那边同一套键位 */
  function 撤销键(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault();
      撤销一步();
    } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
      e.preventDefault();
      重做一步();
    }
  }

  /* 换源（换参考图 / 切"用程序生成的测试图"）**也记一步** —— 用户 2026-09-24 定的：
   载入参考图、导入 `.cube` 都要能撤销回去。所以这里不再是"重开一段历史"，而是照常提交。
   快照在 `untrack` 里取：不这么写的话这个 effect 会依赖上**每一个**参数，改一下滑杆就多记一步。 */
  $effect(() => {
    void 源图;
    untrack(() => {
      提交一步(撤销栈, 取快照());
      同步撤销钮();
    });
  });

  onMount(() => {
    window.addEventListener('keydown', 撤销键);
    return () => window.removeEventListener('keydown', 撤销键);
  });

  /**
   * 参数指纹。**它是"参数一变就把下面那个计时器推倒重来"的唯一依赖来源。**
   *
   * 原来这里写的是 `void 基本; void 曲线; …` —— 那样**不建立依赖**：
   * 它们是 `$state` 的代理对象，读变量本身不触发，只有读**字段**才触发。
   * 结果这个 effect 从来不会因为改了滑杆而重跑，`停手` 开机约 250ms 之后
   * 永远是 `true`，两级预览（拖动 512 粗算 / 停手补 1024 细图）等于没生效：
   * 每敲一个数字都按 1024 走全量。1920×1080 的参考图在无头 Chrome 里实测
   * **一次改动堵主线程 99.5ms**（一帧预算 33ms）。
   *
   * `算指纹` 里是 `JSON.stringify`，会逐个字段读，依赖这才挂上。
   * 口径、实测数字、哪些字段为什么不进去，见 `参数指纹.ts`。
   */
  const 参数指纹 = $derived(
    算指纹({
      链形,
      基本,
      曲线,
      色轮,
      hsl: hslP,
      log: logP,
      变形,
      lut: {
        name: lutP.name,
        strength: lutP.strength,
        clamped: lutP.clamped,
        size: lutP.lut ? lutP.lut.size : 0,
        有表: !!lutP.lut
      },
      切片反序: flipB,
      抄参考图: refOpts,
      用测试图: useTest,
      有参考图: !!refSlots.get('ref').data
    })
  );

  /**
   * 历史指纹 = 预览指纹 + **只影响"记不记一步"、不影响出图**的那几个旋钮。
   *
   * 为什么要分开（用户 2026-09-26 问"调色点错了可以撤销操作吗"）：
   * 提交一步挂在下面那个 250ms 收尾里，而它的唯一触发源就是指纹 ——
   * 「混合」页的 张数 / 横向 / 纵向 和「抄参考图」那个开关**不在预览指纹里**
   * （`result` 根本不读它们），于是：点了它们**一步都不记**，接着改别的东西时
   * 它们已经被算进新那一格的快照，**撤销会把它们一起翻回去** —— 点错了撤不回来。
   *
   * 不塞进 `参数指纹` 是因为那个函数的定义就是"会影响出图的那一堆参数"（见 `参数指纹.ts`），
   * 塞进去会让"改混合张数"也把停手那档推倒重来、白算一遍原分辨率细图。
   */
  const 历史指纹 = $derived(`${参数指纹}|${fromRef ? 1 : 0}|${numClut}|${mixX}|${mixY}`);

  /**
   * 推倒重来的计时器。
   *
   * **必须是 `$effect.pre`，不能是普通 `$effect`**：同一次 flush 里 render effect
   * 排在普通 effect 前面（`batch.js`：先 `flush_queued_effects(render_effects)`，
   * 再 `flush_queued_effects(effects)`）。写成普通 effect 的话，画面已经先按 1024
   * 全量算完一遍了，再置回 `false` 只会让它再补一遍粗图 —— 比不改还慢。
   */
  $effect.pre(() => {
    void 参数指纹;
    停手 = false;
    const id = setTimeout(() => {
      停手 = true;
    }, 停手毫秒);
    return () => clearTimeout(id);
  });

  /**
   * 记一步。
   *
   * **跟上面那条分开**：这条挂的是 `历史指纹`（比预览指纹宽，多了「混合」和「抄参考图」）。
   * 合在一条里的话，改「混合张数」这种跟出图无关的旋钮也会把 `停手` 推倒重来、
   * 白算一遍原分辨率细图；而只挂预览指纹的话，那两个旋钮改了**一步都不记**
   * （用户 2026-09-26 报的"点错了撤不回来"）。
   *
   * 提交在 `setTimeout` 的回调里，不是 effect 的同步执行体 ——
   * ⑦ 那边踩过"自动记会 `effect_update_depth_exceeded`"，这条规矩照旧。
   * 同一条滑杆连着拖出来的是同一个 key（`History` 按 key + 时间窗合并），
   * 所以一次连续操作只占一步；跟当前那一格一样就一格都不记（撤销还原之后走的就是这条）。
   */
  $effect(() => {
    void 历史指纹;
    const id = setTimeout(() => {
      提交一步(撤销栈, 取快照());
      同步撤销钮();
    }, 停手毫秒);
    return () => clearTimeout(id);
  });

  /**
   * 预览 + 自检一次算完。
   *
   * **预览与导出走的是同一个函数**：预览是 `跑链(缩略图)`，导出是
   * `烘成CLUT(网格, 链)` —— 而烘表就是"拿同一条链跑一遍 32³ 的采样网格图"。
   * 所以自检那个差值只反映量化与三线性插值，不掺实现分歧。
   *
   * 自检的差值来自 32³ 的量化误差和三线性插值 —— 它就是这张 LUT 的
   * 精度上限，改小 CLUT 尺寸也没用（ikClut 只认 32）。
   *
   * 抄参考图那条路不走链，所以自检差值没意义，那条下面单独说明。
   *
   * **停手那一档现在是原分辨率**，代价分两种（真 4096×2048，`tmp\量-②原分辨率开销.mjs`）：
   *   · 链上只有点运算（基本/曲线/色轮/HSL/LOG/变形）→ 出图就是 `跑链`，**21ms**；
   *   · 链上有 LUT 节点、或走「抄参考图」→ 出图本身要把表打回整张图，**约 540ms**。
   * 这两种都只在停手后付一次（拖动中是 512 粗图，17ms 一档），文案里没吹"原生一定不卡"。
   */
  const result = $derived.by(() => {
    const nodes = 链;
    const src = baseImage;
    const refData = refSlots.get('ref').data;
    const useRef = fromRef && !!refData;

    if (useRef) {
      const clut = clutFromReference(previewOf(refData!, 512), refOpts);
      return {
        after: imageDataToUrl(applyClut(src, clut)),
        maxDiff: -1,
        meanDiff: -1,
        clut,
        clutUrl: imageDataToUrl(clutToImage(clut, flipB)),
        fromRef: true,
        粗: false
      };
    }

    const 直算 = 跑链(src, nodes, 取缓存(src));
    const 表 = 烘成CLUT(grid, nodes, CLUT_SIZE);

    /* 拖动中只出图，不做自检、也不排那张 CLUT 缩略图 —— 这两样都是"给你看"的，
       一帧里多花一倍时间不值得；停手之后那张才是要判断的东西 */
    if (!停手) {
      return {
        after: imageDataToUrl(直算),
        maxDiff: -1,
        meanDiff: -1,
        clut: 表,
        clutUrl: '',
        fromRef: false,
        粗: true
      };
    }

    /**
     * 自检差值**按粗图（512）算，不按原图**。
     *
     * 为什么：自检要 `applyClut` 把表打回整张图再跟直接跑链比，这两遍都是全图扫 ——
     * 实测真 4096×2048 上 `applyClut` 540ms + `channelDiff` 39ms；挪到 512 粗图上只要 17ms。
     * 细档现在是**原分辨率**（这一轮改的），不挪的话每停一次手要堵主线程约 700ms。
     *
     * 敢挪的依据：这个数反映的是"32³ 量化 + 三线性插值"这条链自己的误差，
     * 是个像素统计量，不是分辨率敏感的东西；而且粗图在拖动中早跑过、在缓存里，
     * 这一挪几乎不额外花时间。**三处读数都标了"按 512 粗图算"**，不冒充实测原图。
     */
    const 自检源 = previewOf(源图, 粗预览长边);
    const 自检直算 = 跑链(自检源, nodes, 取缓存(自检源));

    const viaLut = applyClut(自检源, 表);
    const diff = channelDiff(自检直算, viaLut);
    return {
      after: imageDataToUrl(直算),
      maxDiff: diff.max,
      meanDiff: diff.mean,
      clut: 表,
      clutUrl: imageDataToUrl(clutToImage(表, flipB)),
      fromRef: false,
      粗: false
    };
  });

  /* ---------------------------------------------------------- 导入 .cube */

  let msg = $state<{ kind: 'ok' | 'warn' | 'info'; text: string } | null>(null);
  let 导中 = $state(false);

  async function 导入Cube() {
    const [f] = await pickFile(['cube'], false);
    if (!f) return;
    导中 = true;
    msg = null;
    try {
      const 文 = await readTextFile(f.path);
      const r = 解析Cube(文);
      if (!r.ok) {
        msg = { kind: 'warn', text: `这个 .cube 读不了：${r.error}` };
        导中 = false;
        return;
      }
      lutP = { lut: r.lut, strength: 1, name: f.name, clamped: r.clamped };
      if (!链形.some((n) => n.kind === 'lut')) 链形.push({ id: 新节点id(), kind: 'lut', on: true });
      const 形状 = r.lut.kind === '3d' ? `${r.lut.size}³` : `1D ${r.lut.size} 档`;
      msg = {
        kind: 'ok',
        text:
          `读了 ${f.name}：${形状}${r.lut.title ? `「${r.lut.title}」` : ''}` +
          (r.clamped ? ` —— 有 ${r.clamped} 个值超出 0~1，夹住了` : '')
      };
    } catch (e) {
      msg = { kind: 'warn', text: `读文件失败：${(e as Error).message}` };
    }
    导中 = false;
  }

  /** 混合页：把 .cube 摊成 32³ 的表、再排成 CLUT 图塞进槽位，后面的路一行不用改 */
  async function 导入Cube到槽(id: string, i: number) {
    const [f] = await pickFile(['cube'], false);
    if (!f) return;
    try {
      const r = 解析Cube(await readTextFile(f.path));
      if (!r.ok) {
        msg = { kind: 'warn', text: `这个 .cube 读不了：${r.error}` };
        return;
      }
      blendSlots.derive(id, clutToImage(Lut转3D(r.lut, CLUT_SIZE), false));
      msg = { kind: 'ok', text: `第 ${i + 1} 张换成了 ${f.name}（${r.lut.kind === '3d' ? `${r.lut.size}³` : `1D ${r.lut.size} 档`} 摊成 ${CLUT_SIZE}³）` };
    } catch (e) {
      msg = { kind: 'warn', text: `读文件失败：${(e as Error).message}` };
    }
  }

  /** 链上那个 LUT 节点的开关（没装表时打开没意义） */
  function 有Lut(): boolean {
    return !!lutP.lut;
  }

  /* ---------------------------------------------------------- 混合 */

  const blendSlots = new Slots('ikclut.blend', [
    { id: 'c1', label: 'CLUT 1' },
    { id: 'c2', label: 'CLUT 2' },
    { id: 'c3', label: 'CLUT 3' },
    { id: 'c4', label: 'CLUT 4' }
  ]);

  /* `numClut` / `mixX` / `mixY` 声明在上面（`历史指纹` 要读它们，放这儿就是 TDZ） */

  /** 载入的 CLUT 图和它解出来的表。尺寸不对当场报出来，别等到混完发现颜色是错的 */
  const loaded = $derived.by(() => {
    const out: { id: string; clut: Clut | null; bad: string }[] = [];
    for (const id of ['c1', 'c2', 'c3', 'c4']) {
      const s = blendSlots.get(id);
      if (!s.data) {
        out.push({ id, clut: null, bad: '' });
        continue;
      }
      if (s.data.width !== CLUT_W || s.data.height !== CLUT_H) {
        out.push({
          id,
          clut: null,
          bad: `是 ${s.data.width}×${s.data.height}，ikClut 要 ${CLUT_W}×${CLUT_H}`
        });
        continue;
      }
      out.push({ id, clut: clutFromImage(s.data, CLUT_SIZE, false), bad: '' });
    }
    return out;
  });

  const readyCount = $derived(loaded.slice(0, numClut).filter((c) => c.clut).length);

  const blended = $derived.by(() => {
    if (readyCount < numClut) return null;
    const tables = loaded.slice(0, numClut).map((c) => c.clut!) as Clut[];
    const c = mixClutTables(tables, mixX, mixY);
    if (!c) return null;
    const src = baseImage;
    return { clut: c, url: imageDataToUrl(applyClut(src, c)) };
  });

  const weights = $derived(clutWeights(numClut, mixX, mixY));

  /* ---------------------------------------------------------- 导出 */

  let exporting = $state(false);

  const stamp = $derived(new Date().toLocaleString());

  /** 参数清单：把链上一个一个节点写下来。改的是链，清单得跟着链走 */
  function paramReport(clut: Clut): string {
    const 行: string[] = [
      'RobinEditor ikClut 导出记录',
      `时间：${stamp}`,
      `CLUT 尺寸：${clut.size}³，导出图 ${clut.size * clut.size}×${clut.size}`,
      `蓝切片方向：${flipB ? '反序' : '正序'}`,
      '',
      `处理链（${链形.length} 个节点，${链形.filter((n) => n.on).length} 个开着）`
    ];
    for (const n of 链形) {
      行.push(`  [${n.on ? 'on ' : 'off'}] ${节点名[n.kind]}`);
      if (n.kind === 'basic') {
        行.push(
          `        曝光 ${基本.exposure.toFixed(3)}  对比 ${基本.contrast.toFixed(3)}` +
            `  饱和 ${基本.saturation.toFixed(3)}  色相 ${基本.hue.toFixed(1)}°`
        );
        行.push(
          `        色温 ${基本.temperature.toFixed(3)}  色调 ${基本.tint.toFixed(3)}` +
            `  高光 ${基本.highlights.toFixed(3)}  阴影 ${基本.shadows.toFixed(3)}` +
            `  黑 ${基本.black.toFixed(3)}  白 ${基本.white.toFixed(3)}`
        );
      } else if (n.kind === 'curves') {
        const 一条 = (名: string, pts: CurveParams['r']) =>
          `        ${名}：${pts.map((p) => `(${p.x.toFixed(3)},${p.y.toFixed(3)})`).join(' ')}`;
        行.push(一条('R', 曲线.r));
        行.push(一条('G', 曲线.g));
        行.push(一条('B', 曲线.b));
        行.push(一条('亮度', 曲线.luma));
        行.push(一条(`第四(${曲线.extraCh})`, 曲线.extra));
        行.push(`        插值：${曲线.kind}`);
      } else if (n.kind === 'wheels') {
        for (const x of 轮清单) {
          行.push(`        ${x.名}：色相 ${Math.round(x.轮.h)}°  强度 ${x.轮.s.toFixed(3)}  明暗 ${x.轮.l.toFixed(3)}`);
        }
        行.push(`        整体偏移 ${色轮.偏移.map((v) => v.toFixed(3)).join(' / ')}`);
      } else if (n.kind === 'hsl') {
        行.push(`        段间平滑 ${hslP.平滑.toFixed(2)}`);
        for (let i = 0; i < HSL段.length; i++) {
          const b = hslP.bands[i];
          if (!b || (b.h === 0 && b.s === 1 && b.l === 1)) continue;
          行.push(`        ${HSL段[i].name}：色相 ${b.h.toFixed(1)}°  饱和 ${b.s.toFixed(3)}  亮度 ${b.l.toFixed(3)}`);
        }
      } else if (n.kind === 'log') {
        行.push(
          `        曲线 ${logP.曲线}  曝光 ${logP.曝光.toFixed(3)} EV` +
            `  色轮 ${Math.round(logP.色轮色相)}° / ${logP.色轮强度.toFixed(3)}` +
            `  黑 ${logP.黑.toFixed(3)}  白 ${logP.白.toFixed(3)}  滚降 ${logP.滚降.toFixed(3)}`
        );
      } else if (n.kind === 'warp') {
        const 非零 = (a: number[]) => a.filter((v) => v !== 0).length;
        行.push(
          `        色相×饱和度 网格 ${变形边}×${变形边}（${非零(变形.色相饱和)} 格非零）` +
            `  色相×亮度（${非零(变形.色相亮度)} 格非零）`
        );
        行.push(
          `        饱和满量程 ${变形.饱和量.toFixed(3)}  亮度满量程 ${变形.亮度量.toFixed(3)}` +
            `  带动色相 ${变形.色相量.toFixed(1)}°`
        );
      } else {
        行.push(
          `        ${lutP.name || '（没装表）'}` +
            (lutP.lut ? `  ${lutP.lut.kind === '3d' ? `${lutP.lut.size}³` : `1D ${lutP.lut.size} 档`}` : '') +
            `  强度 ${lutP.strength.toFixed(3)}`
        );
      }
    }
    行.push('');
    行.push(`自检：LUT 与直接调色的最大差 ${result.maxDiff}/255，平均差 ${result.meanDiff.toFixed(3)}/255（按 ${粗预览长边} 粗图算）`);
    行.push('');
    return 行.join('\r\n');
  }

  async function exportClut(which: 'edit' | 'blend') {
    const clut = which === 'edit' ? result.clut : blended?.clut;
    if (!clut) return;
    const name = `clut${which === 'blend' ? '_blend' : ''}.png`;
    exporting = true;
    msg = null;
    try {
      if (!isTauri()) {
        await saveImage(name, clutToImage(clut, flipB));
        msg = { kind: 'info', text: '浏览器模式：PNG 已下载。桌面端才会顺手写参数清单的 .txt。' };
        exporting = false;
        return;
      }
      const path = await pickSavePath(name, ['png']);
      if (!path) {
        exporting = false;
        return;
      }
      const r = await saveImage(path, clutToImage(clut, flipB));
      const txtPath = path.replace(/\.png$/i, '') + '.txt';
      await saveBytes(txtPath, new TextEncoder().encode(paramReport(clut)));
      msg = {
        kind: 'ok',
        text: `写了 ${path}（${r.bytesWritten} 字节），参数清单写到同名 .txt`
      };
    } catch (e) {
      msg = { kind: 'warn', text: `导出失败：${(e as Error).message}` };
    }
    exporting = false;
  }

  /**
   * 「全部复位」：**每一组参数**都回出厂，链回默认那两个节点。
   *
   * 原来只回 基本 / 曲线 / 链形 —— 色轮、HSL、LOG、变形、LUT 的强度、切片反序、
   * 抄参考图、混合那几个旋钮全留着。按钮写着"全部"，做的事只有一半：
   * 用户点完发现色轮还是歪的，只会以为按钮坏了（`docs\整改清单.md` §J-10 量出来的）。
   *
   * **不动的是素材**，不是参数：导入的 `.cube` 表、当前源图、参考图 ——
   * 那些是"放在槽里的东西"，跟 ⑦ 那边"放素材不算改参数"一个口径。
   * 所以 LUT 只把**强度/裁切**回默认，`lutP.lut`（那张表本身）留着。
   */
  function resetParams() {
    基本 = 新建基本();
    曲线 = 新建曲线();
    色轮 = 新建色轮();
    hslP = 新建Hsl();
    logP = 新建Log();
    变形 = 新建变形();
    lutP = { ...新建Lut参数(), lut: lutP.lut, name: lutP.lut ? lutP.name : '' };
    flipB = false;
    fromRef = false;
    refOpts = { ...DEFAULT_REF };
    numClut = 2;
    mixX = 0.5;
    mixY = 0.5;
    链形 = [
      { id: 新节点id(), kind: 'basic', on: true },
      { id: 新节点id(), kind: 'curves', on: true }
    ];
  }

  const refSlot = $derived(refSlots.get('ref'));
</script>

<!-- 按步撤销那一对钮。三个分区的底栏都渲染它 —— 放抽屉里不行（抽屉默认收起，
     点不到就等于没有）；主按钮靠 `margin-left: auto` 顶到右边，这一对自然落在左边。 -->
{#snippet 撤销钮()}
  <span class="undobtns">
    <button class="btn btn--ghost btn--sm" type="button" disabled={!能撤销} onclick={撤销一步}
      title="退回上一步（Ctrl+Z）">
      <Icon name="ui.undo" size={13} />撤销
    </button>
    <button class="btn btn--ghost btn--sm" type="button" disabled={!能重做} onclick={重做一步}
      title="再做回来（Ctrl+Shift+Z）">
      <Icon name="ui.redo" size={13} />重做
    </button>
    {#if 撤销读数}<span class="mini mut undobtns__n" title="第几步 / 一共几步">{撤销读数}</span>{/if}
  </span>
{/snippet}

{#if !['clut', 'blend', 'export'].includes(panelId)}
  <!-- 不认识的 id 不再悄悄渲染最后一个分区（原来裸 `{:else}` 就是干这个的） -->
  <div class="card pad">
    <Note kind="warn">
      分区 id「{panelId}」这个组件不认识，所以这一页是空的。
      多半是注册表里加/改分区的时候，组件里的分支没跟着改 —— 两边要一起改。
    </Note>
  </div>
{:else if panelId === 'clut'}
  <div class="wb">
    <div class="wb__main">
      <div class="card pad">
        <div class="acts" style="margin-bottom:12px">
          <span class="h3" style="margin:0">基准图</span>
          <span class="acts__sp"></span>
          <label class="chk">
            <input type="checkbox" bind:checked={useTest} />
            <span class="chk__box"></span>用程序生成的测试图
          </label>
        </div>
        {#if useTest}
          <p class="mini">
            上段 32 级灰阶、中段满饱和色相扫、下段 12 个常用色调（肤色占多数）。
            判断曲线看灰阶那段，判断偏色看下段。
          </p>
        {:else}
          <div class="slots">
            <Slot
              label="参考图"
              url={refSlot.url}
              name={refSlot.ref?.name}
              meta={refSlot.srcFormat ? `${refSlot.size} · ${refSlot.srcFormat}` : refSlot.size}
              onpick={() => refSlots.pick('ref')}
              onclear={() => refSlots.clear('ref')}
              ondropfile={(f) => refSlots.loadFile('ref', f)}
              slot={{ group: refSlots, id: 'ref' }}
            />
          </div>
        {/if}
      </div>

      <div class="card pad">
        <div class="acts" style="margin-bottom:10px">
          <h3 class="h3" style="margin:0">原图 / 调色后</h3>
          <span class="acts__sp"></span>
          <div class="pick">
            <button class="pick__b" type="button" aria-pressed={比对 === 'before'}
              onclick={() => (比对 = 'before')}>调色前</button>
            <button class="pick__b" type="button" aria-pressed={比对 === 'both'}
              onclick={() => (比对 = 'both')}>前后对比</button>
            <button class="pick__b" type="button" aria-pressed={比对 === 'after'}
              onclick={() => (比对 = 'after')}>调色后</button>
          </div>
        </div>

        <div class="acts" style="margin-bottom:10px">
          <label class="chk"><input type="checkbox" bind:checked={同步倍} /><span class="chk__box"></span>同步缩放</label>
          <label class="chk"><input type="checkbox" bind:checked={同步移} /><span class="chk__box"></span>同步平移</label>
          <span class="acts__sp"></span>
          <span class="mini mut">两个视图各自滚轮缩放、按住左/中键拖动</span>
        </div>

        <!-- 对比快照（存 A / 用 A / 存 B / 用 B）是**老手**看前后差别用的，
             按设计准则 §八（一屏主线控件 ≤ 8）与 §十.4 收进展开区，默认收起。 -->
        <details class="fold fold--sub" style="margin-bottom:10px">
          <summary>
            <span class="fold__t">存快照对比（老手）</span>
            <span class="fold__sp"></span>
            <span class="fold__n mono">{快照A ? '有 A' : '没 A'} · {快照B ? '有 B' : '没 B'}</span>
          </summary>
          <div class="fold__body">
            <div class="acts">
              <button class="btn btn--ghost btn--sm" type="button" onclick={() => 存快照('A')}>存到 A</button>
              <button class="btn btn--ghost btn--sm" type="button" disabled={!快照A} onclick={() => 用快照('A')}>用 A</button>
              <button class="btn btn--ghost btn--sm" type="button" onclick={() => 存快照('B')}>存到 B</button>
              <button class="btn btn--ghost btn--sm" type="button" disabled={!快照B} onclick={() => 用快照('B')}>用 B</button>
            </div>
            <p class="mini">存下现在这一版，调完参数再「用 A / 用 B」跳回来比一比。</p>
          </div>
        </details>

        <div class="cmp" class:cmp--one={比对 !== 'both'}>
          {#if 比对 !== 'after'}
            <div class="cmp__col">
              <Preview url={beforeUrl} srcW={源尺寸.w} srcH={源尺寸.h}
                基准={细预览尺寸}
                最小倍={0.1} 最大倍={12} 滚轮直接缩放 重置
                缩放报={左动了倍} 平移报={左动了移}
                bind:倍={左倍} bind:位置={左位置} alt="原图" />
              <span class="cmp__cap">原图</span>
            </div>
          {/if}
          {#if 比对 !== 'before'}
            <div class="cmp__col">
              <Preview url={result.after} srcW={源尺寸.w} srcH={源尺寸.h}
                基准={细预览尺寸}
                最小倍={0.1} 最大倍={12} 滚轮直接缩放 重置
                缩放报={右动了倍} 平移报={右动了移}
                bind:倍={右倍} bind:位置={右位置} alt="调色后" />
              <span class="cmp__cap">调色后</span>
            </div>
          {/if}
        </div>

        <p class="mini" style="margin-top:8px">
          {#if result.粗}
            拖动时按 {粗预览长边}px 算（快），<b>停手后自动补一张原分辨率的图</b>（{源尺寸.w}×{源尺寸.h}）。
          {:else if 是原分辨率}
            现在这张就是<b>原分辨率</b>（{源尺寸.w}×{源尺寸.h}，一点没缩）。烘 LUT 走的是 {CLUT_SIZE}³ 全量，与预览多大无关。
          {:else}
            源长边 {源长边}px 超过上限 {细预览上限}，这一档缩到 {细长边}px 显示。
            烘 LUT 走的是 {CLUT_SIZE}³ 全量，与预览多大无关。
          {/if}
        </p>
      </div>

      <div class="card pad">
        <div class="acts" style="margin-bottom:10px">
          <h3 class="h3" style="margin:0">烘出来的 CLUT</h3>
          <span class="acts__sp"></span>
          <span class="mini mono">{CLUT_W}×{CLUT_H}</span>
        </div>
        <div class="clutwrap">
          <img src={result.clutUrl} alt="" />
        </div>
        <p class="mini" style="margin-top:8px">
          最左边一个切片是蓝=0，往右蓝递增；切片里横轴红、纵轴绿。
          {flipB ? '现在是反序排的。' : '现在和 ikClut.fx 的排法一致。'}
        </p>
      </div>

      <div class="wb__acts">
        <span class="mini mut">{CLUT_W}×{CLUT_H} PNG，旁边再写一份参数 .txt。</span>
        {@render 撤销钮()}
        <button class="btn btn--primary" disabled={exporting} onclick={() => exportClut('edit')}>
          <Icon name="ui.export" size={15} />{exporting ? '导出中…' : '导出 CLUT'}
        </button>
      </div>
    </div>

    <aside class="card wb__side 参数侧栏">
      <!-- 参数板：一排标签（按宽度自动换列），点哪个显示哪一组。固定高度、内部滚动 -->
      <div class="grp">
        <h3 class="grp__t">调色参数</h3>
        <div class="tabs">
          {#each 参数页表 as t (t.id)}
            <button class="tabs__b" type="button" aria-pressed={参数板 === t.id}
              onclick={() => (参数板 = t.id)}>{t.名}</button>
          {/each}
        </div>
      </div>
      <div class="grp">
        <h3 class="grp__t">怎么做这张 LUT</h3>
        <div class="pick">
          <button class="pick__b" type="button" aria-pressed={!fromRef} onclick={() => (fromRef = false)}>
            自己调
          </button>
          <button
            class="pick__b"
            type="button"
            aria-pressed={fromRef}
            disabled={!refSlot.data}
            onclick={() => (fromRef = true)}
          >抄参考图</button>
        </div>
        {#if !refSlot.data}
          <p class="mini" style="margin-top:8px">右边载入一张参考图，「抄参考图」才能用。</p>
        {:else if fromRef}
          <p class="mini" style="margin-top:8px">
            把参考图按亮度分成 {refOpts.bands} 个带取平均色，直接拼成 CLUT。
            这是 ikClut 原作者公开 readme 里那条"截图 → 贴身份 CLUT → 调色 → 切下来"的手工流程的自动版。
          </p>
          <div class="row" style="margin-top:10px">
            <span class="row__k">分带数</span>
            <input class="range range--inline" type="range" min="4" max="64" step="1" bind:value={refOpts.bands} aria-label="分带数" />
            <NumBox bind:value={refOpts.bands} min={4} max={64} step={1} 标题="分带数" />
          </div>
          <div class="row">
            <span class="row__k">抄多少</span>
            <input class="range range--inline" type="range" min="0" max="1" step="0.01" bind:value={refOpts.strength} aria-label="抄多少" />
            <NumBox bind:value={refOpts.strength} min={0} max={1} step={0.01} 标题="抄多少" />
          </div>
          <div class="row">
            <span class="row__k">饱和度</span>
            <input class="range range--inline" type="range" min="0" max="2" step="0.01" bind:value={refOpts.saturation} aria-label="饱和度" />
            <NumBox bind:value={refOpts.saturation} min={0} max={2} step={0.01} 标题="饱和度" />
          </div>
          <div class="row">
            <span class="row__k">掐头去尾</span>
            <input class="range range--inline" type="range" min="0" max="0.2" step="0.005" bind:value={refOpts.trim} aria-label="掐头去尾" />
            <NumBox bind:value={refOpts.trim} min={0} max={0.2} step={0.005} 倍={100} 位={1} 后缀="%" 标题="掐头去尾" />
          </div>
          <p class="mini" style="margin-top:8px">
            参考图只能定"亮度 → 色调"这一条关系，定不了整个 32³ 立方体。
            出来的是个起点，接着在「自己调」那边改，或者去混合页跟别的 LUT 混。
          </p>
        {/if}
      </div>

      <div class="grp">
        <h3 class="grp__t">处理链</h3>
        <ul class="list chain">
          {#each 链形 as n, i (n.id)}
            <li>
              <label class="chk" title="这一条参不参与">
                <input type="checkbox" bind:checked={n.on} />
                <span class="chk__box"></span>
              </label>
              <b>{节点名[n.kind]}</b>
              <span class="mini mut chain__hint">{节点一句[n.kind]}</span>
              <span class="list__sp acts">
                <button class="x" type="button" title="往上挪" disabled={i === 0}
                  onclick={() => 挪(i, -1)}>↑</button>
                <button class="x" type="button" title="往下挪" disabled={i === 链形.length - 1}
                  onclick={() => 挪(i, 1)}>↓</button>
                <button class="x" type="button" title="拿掉"
                  onclick={() => (链形 = 链形.filter((x) => x.id !== n.id))}>×</button>
              </span>
            </li>
          {/each}
        </ul>
        <div class="acts" style="margin-top:8px">
          {#each ['basic', 'curves', 'wheels', 'hsl', 'log', 'warp', 'lut'] as k (k)}
            <button class="btn btn--ghost btn--sm" type="button"
              disabled={链形.some((n) => n.kind === k)} onclick={() => 加节点(k as NodeKind)}>
              ＋{节点名[k as NodeKind]}
            </button>
          {/each}
        </div>
        <p class="mini" style="margin-top:8px">
          链<b>从上往下</b>跑，顺序有意义（先曝光再拉曲线，和反过来不是一回事）。
          勾掉 = 这一条不参与。同一种节点现在只能放一个。
        </p>
      </div>

      <div class="grp" class:grp--off={参数板 !== 'basic'} data-参数页="basic">
        <h3 class="grp__t">基本</h3>
        <div class="row">
          <span class="row__k">曝光</span>
          <NumBox bind:value={基本.exposure} min={0.2} max={2.5} step={0.01} 标题="曝光" />
          <input class="range" type="range" min="0.2" max="2.5" step="0.01" bind:value={基本.exposure}
            aria-label="曝光" />
        </div>
        <div class="row">
          <span class="row__k">对比度</span>
          <NumBox bind:value={基本.contrast} min={0.4} max={2.2} step={0.01} 标题="对比度" />
          <input class="range" type="range" min="0.4" max="2.2" step="0.01" bind:value={基本.contrast}
            aria-label="对比度" />
        </div>
        <div class="row">
          <span class="row__k">饱和度</span>
          <NumBox bind:value={基本.saturation} min={0} max={2.5} step={0.01} 标题="饱和度" />
          <input class="range" type="range" min="0" max="2.5" step="0.01" bind:value={基本.saturation}
            aria-label="饱和度" />
        </div>
        <div class="row">
          <span class="row__k">色相</span>
          <NumBox bind:value={基本.hue} min={-180} max={180} step={1} 后缀="°" 标题="色相旋转" />
          <input class="range" type="range" min="-180" max="180" step="1" bind:value={基本.hue}
            aria-label="色相旋转" />
        </div>
        <div class="row">
          <span class="row__k">色温</span>
          <NumBox bind:value={基本.temperature} min={-1} max={1} step={0.01} 标题="色温" />
          <input class="range" type="range" min="-1" max="1" step="0.01" bind:value={基本.temperature}
            aria-label="色温" />
        </div>
        <div class="row">
          <span class="row__k">色调</span>
          <NumBox bind:value={基本.tint} min={-1} max={1} step={0.01} 标题="色调" />
          <input class="range" type="range" min="-1" max="1" step="0.01" bind:value={基本.tint}
            aria-label="色调" />
        </div>
        <div class="row">
          <span class="row__k">高光</span>
          <NumBox bind:value={基本.highlights} min={-1} max={1} step={0.01} 标题="高光" />
          <input class="range" type="range" min="-1" max="1" step="0.01" bind:value={基本.highlights}
            aria-label="高光" />
        </div>
        <div class="row">
          <span class="row__k">阴影</span>
          <NumBox bind:value={基本.shadows} min={-1} max={1} step={0.01} 标题="阴影" />
          <input class="range" type="range" min="-1" max="1" step="0.01" bind:value={基本.shadows}
            aria-label="阴影" />
        </div>
        <div class="row">
          <span class="row__k">黑点</span>
          <NumBox bind:value={基本.black} min={0} max={0.5} step={0.002} 倍={255} 位={0} 标题="黑点" />
          <input class="range" type="range" min="0" max="0.5" step="0.002" bind:value={基本.black}
            aria-label="黑点" />
        </div>
        <div class="row">
          <span class="row__k">白点</span>
          <NumBox bind:value={基本.white} min={0.5} max={1} step={0.002} 倍={255} 位={0} 标题="白点" />
          <input class="range" type="range" min="0.5" max="1" step="0.002" bind:value={基本.white}
            aria-label="白点" />
        </div>
        <p class="mini" style="margin-top:8px">
          色温往正走偏暖（提红压蓝）、色调往正走偏品红；高光阴影按<b>亮度</b>加权，不改色相。
          黑点白点是收范围的，黑点 0 / 白点 1 就是没收。
        </p>
        <button class="btn btn--ghost btn--sm" style="margin-top:8px" onclick={resetParams}
          title="每一组调色参数都回出厂、链回默认两个节点。导入的 .cube 表、源图、参考图不动（那是素材）">
          <Icon name="ui.restore" size={13} />全部复位
        </button>
      </div>

      <div class="grp" class:grp--off={参数板 !== 'curve'} data-参数页="curve">
        <h3 class="grp__t">通道曲线</h3>
        <div class="pick" style="margin-bottom:10px">
          {#each [['linear', '线性'], ['smooth', '平滑'], ['step', '阶梯']] as [k, label] (k)}
            <button class="pick__b" type="button" aria-pressed={曲线.kind === k}
              onclick={() => (曲线.kind = k as CurveKind)}>{label}</button>
          {/each}
        </div>
        {#if 曲线.kind === 'smooth' && 曲线是恒等(曲线.r) && 曲线是恒等(曲线.g) && 曲线是恒等(曲线.b)}
          <p class="mini warnline">
            只有两个端点时"平滑"是一条 S 曲线，不是恒等 —— 等于三条通道都被加了对比度。
            要恒等就用线性，或者加几个控制点再说。
          </p>
        {/if}
        <Curve points={曲线.r} kind={曲线.kind} color="#d9534f" label="R" onchange={(p) => (曲线.r = p)} />
        <div style="height:10px"></div>
        <Curve points={曲线.g} kind={曲线.kind} color="#5cb85c" label="G" onchange={(p) => (曲线.g = p)} />
        <div style="height:10px"></div>
        <Curve points={曲线.b} kind={曲线.kind} color="#4a7fd0" label="B" onchange={(p) => (曲线.b = p)} />
        <div style="height:10px"></div>
        <Curve points={曲线.luma} kind={曲线.kind} color="#c8c8c8" label="亮度" onchange={(p) => (曲线.luma = p)} />
        <div style="height:10px"></div>
        <Curve points={曲线.extra} kind={曲线.kind} color="#c9a227"
          label={`第四(${曲线.extraCh})`} onchange={(p) => (曲线.extra = p)} />
        <div class="pick" style="margin-top:10px">
          {#each [['r', 'R'], ['g', 'G'], ['b', 'B'], ['luma', '亮度']] as [c, label] (c)}
            <button class="pick__b" type="button" aria-pressed={曲线.extraCh === c}
              onclick={() => (曲线.extraCh = c as CurveChannel)}>{label}</button>
          {/each}
        </div>
        <p class="mini" style="margin-top:8px">
          亮度那条是<b>按比例</b>缩放三条通道（不动色相），第四那条作用在哪个通道由上面这排按钮定。
          两条都留着恒等的两点直线就是不起作用 —— 不写进 LUT，也就不会掉精度。
        </p>
      </div>

      <div class="grp" class:grp--off={参数板 !== 'lut'} data-参数页="lut">
        <h3 class="grp__t">导入的 LUT（.cube）</h3>
        <div class="acts">
          <button class="btn btn--ghost btn--sm" disabled={导中} onclick={导入Cube}>
            <Icon name="ui.import" size={13} />{导中 ? '读中…' : '选一个 .cube'}
          </button>
          {#if lutP.lut}
            <button class="btn btn--ghost btn--sm" type="button"
              onclick={() => (lutP = 新建Lut参数())}>卸掉</button>
          {/if}
        </div>
        {#if lutP.lut}
          <div class="kv" style="margin-top:8px">
            <div class="kv__r"><span>文件</span><span class="mono">{lutP.name}</span></div>
            <div class="kv__r">
              <span>形状</span>
              <span>{lutP.lut.kind === '3d' ? `${lutP.lut.size}³` : `1D ${lutP.lut.size} 档`}</span>
            </div>
            {#if lutP.lut.title}
              <div class="kv__r"><span>标题</span><span class="mono">{lutP.lut.title}</span></div>
            {/if}
            <div class="kv__r">
              <span>输入范围</span>
              <span class="mono">
                {lutP.lut.domainMin.join('~')} → {lutP.lut.domainMax.join('~')}
              </span>
            </div>
          </div>
          <div class="row" style="margin-top:8px">
            <span class="row__k">掺多少</span>
            <NumBox bind:value={lutP.strength} min={0} max={1} step={0.01} 标题="LUT 强度" />
            <input class="range" type="range" min="0" max="1" step="0.01" bind:value={lutP.strength}
              aria-label="掺多少" />
          </div>
          {#if lutP.clamped}
            <p class="mini warnline" style="margin-top:6px">
              这张表里有 {lutP.clamped} 个值超出 0~1，读的时候夹住了（本工程存的是 8 位）。
            </p>
          {/if}
        {:else}
          <p class="mini" style="margin-top:8px">
            3D（<span class="mono">LUT_3D_SIZE</span>）和 1D（<span class="mono">LUT_1D_SIZE</span>）都能读。
            读进来的表<b>按原精度</b>参与这条链，不是先摊成 {CLUT_SIZE}³ 再用。
          </p>
        {/if}
        {#if msg && panelId === 'clut'}
          <div style="margin-top:8px"><Note kind={msg.kind} onclose={() => (msg = null)} 自动关={提示自动关毫秒}>{msg.text}</Note></div>
        {/if}
      </div>

      <div class="grp" class:grp--off={参数板 !== 'wheels'} data-参数页="wheels">
        <h3 class="grp__t">色轮</h3>
        {#each 轮清单 as x (x.名)}
          <div class="wheel">
            <div class="wheel__t">
              <span class="wheel__sw" style="background:{色轮色(x.轮.h)}"></span>
              <b>{x.名}</b>
              <span class="mini mut" style="margin-left:auto">色相</span>
              <NumBox bind:value={x.轮.h} min={0} max={360} step={1} 后缀="°" 标题="{x.名} 色相" />
            </div>
            <input class="range" type="range" min="0" max="360" step="1" bind:value={x.轮.h}
              aria-label="{x.名} 色相" />
            <div class="row">
              <span class="row__k">强度</span>
              <NumBox bind:value={x.轮.s} min={0} max={1} step={0.01} 标题="{x.名} 强度" />
              <input class="range" type="range" min="0" max="1" step="0.01" bind:value={x.轮.s}
                aria-label="{x.名} 强度" />
            </div>
            <div class="row">
              <span class="row__k">明暗</span>
              <NumBox bind:value={x.轮.l} min={-1} max={1} step={0.01} 标题="{x.名} 明暗" />
              <input class="range" type="range" min="-1" max="1" step="0.01" bind:value={x.轮.l}
                aria-label="{x.名} 明暗" />
            </div>
          </div>
        {/each}
        <div class="row" style="margin-top:10px">
          <span class="row__k">整体偏移 R</span>
          <NumBox bind:value={色轮.偏移[0]} min={-1} max={1} step={0.01} 标题="暗部偏移" />
          <input class="range" type="range" min="-1" max="1" step="0.01" bind:value={色轮.偏移[0]}
            aria-label="整体偏移 R" />
        </div>
        <div class="row">
          <span class="row__k">整体偏移 G</span>
          <NumBox bind:value={色轮.偏移[1]} min={-1} max={1} step={0.01} 标题="中间调偏移" />
          <input class="range" type="range" min="-1" max="1" step="0.01" bind:value={色轮.偏移[1]}
            aria-label="整体偏移 G" />
        </div>
        <div class="row">
          <span class="row__k">整体偏移 B</span>
          <NumBox bind:value={色轮.偏移[2]} min={-1} max={1} step={0.01} 标题="高光偏移" />
          <input class="range" type="range" min="-1" max="1" step="0.01" bind:value={色轮.偏移[2]}
            aria-label="整体偏移 B" />
        </div>
        <p class="mini" style="margin-top:8px">
          每个轮 = 朝这个色相<b>推色度</b>（灰的地方也会被推上色，这正是色轮该有的样子），
          明暗是这个段整体加同一个量、只动亮度不动色相。暗 / 中 / 高按亮度分三段加权。
        </p>
      </div>

      <div class="grp" class:grp--off={参数板 !== 'hsl'} data-参数页="hsl">
        <h3 class="grp__t">HSL</h3>
        <div class="pick" style="margin-bottom:10px">
          {#each HSL段 as s, i (s.name)}
            <button class="pick__b" type="button" aria-pressed={hsl选 === i} onclick={() => (hsl选 = i)}>
              {s.name}
            </button>
          {/each}
        </div>
        <div class="row">
          <span class="row__k">色相偏移</span>
          <NumBox bind:value={hslP.bands[hsl选].h} min={-60} max={60} step={1} 后缀="°" 标题="色相偏移" />
          <input class="range" type="range" min="-60" max="60" step="1" bind:value={hslP.bands[hsl选].h}
            aria-label="色相偏移" />
        </div>
        <div class="row">
          <span class="row__k">饱和</span>
          <NumBox bind:value={hslP.bands[hsl选].s} min={0} max={2} step={0.01} 标题="饱和" />
          <input class="range" type="range" min="0" max="2" step="0.01" bind:value={hslP.bands[hsl选].s}
            aria-label="饱和倍数" />
        </div>
        <div class="row">
          <span class="row__k">亮度</span>
          <NumBox bind:value={hslP.bands[hsl选].l} min={0} max={2} step={0.01} 标题="明度" />
          <input class="range" type="range" min="0" max="2" step="0.01" bind:value={hslP.bands[hsl选].l}
            aria-label="亮度倍数" />
        </div>
        <div class="row" style="margin-top:10px">
          <span class="row__k">段间平滑</span>
          <NumBox bind:value={hslP.平滑} min={0.5} max={2} step={0.05} 标题="段间平滑" />
          <input class="range" type="range" min="0.5" max="2" step="0.05" bind:value={hslP.平滑}
            aria-label="段间平滑" />
        </div>
        <div class="acts" style="margin-top:8px">
          <button class="btn btn--ghost btn--sm" type="button" onclick={() => (hslP = 新建Hsl())}>
            八段全部还原
          </button>
        </div>
        <p class="mini" style="margin-top:8px">
          一次只调一段（八段一次铺出来 24 个滑杆没法看）。权重按和归一化，所以平滑调大时
          中间地带不会被两段各加一次。八段都还原就是恒等 —— 那一步整段不执行，不掉精度。
        </p>
      </div>

      <div class="grp" class:grp--off={参数板 !== 'log'} data-参数页="log">
        <h3 class="grp__t">LOG / HDR</h3>
        <div class="pick" style="margin-bottom:10px">
          {#each [['log10', LOG曲线名.log10], ['log2', LOG曲线名.log2]] as [k, label] (k)}
            <button class="pick__b" type="button" aria-pressed={logP.曲线 === k}
              onclick={() => (logP.曲线 = k as LogCurveId)}>{label}</button>
          {/each}
        </div>
        <div class="row">
          <span class="row__k">曝光（EV）</span>
          <NumBox bind:value={logP.曝光} min={-4} max={4} step={0.05} 标题="LOG 曝光" />
          <input class="range" type="range" min="-4" max="4" step="0.05" bind:value={logP.曝光}
            aria-label="曝光" />
        </div>
        <div class="row">
          <span class="row__k">色轮色相</span>
          <NumBox bind:value={logP.色轮色相} min={0} max={360} step={1} 后缀="°" 标题="LOG 色轮色相" />
          <input class="range" type="range" min="0" max="360" step="1" bind:value={logP.色轮色相}
            aria-label="色轮色相" />
        </div>
        <div class="row">
          <span class="row__k">色轮强度</span>
          <NumBox bind:value={logP.色轮强度} min={0} max={1} step={0.01} 标题="LOG 色轮强度" />
          <input class="range" type="range" min="0" max="1" step="0.01" bind:value={logP.色轮强度}
            aria-label="色轮强度" />
        </div>
        <div class="row">
          <span class="row__k">黑点</span>
          <NumBox bind:value={logP.黑} min={0} max={0.5} step={0.01} 标题="LOG 黑点" />
          <input class="range" type="range" min="0" max="0.5" step="0.01" bind:value={logP.黑}
            aria-label="黑点" />
        </div>
        <div class="row">
          <span class="row__k">白点</span>
          <NumBox bind:value={logP.白} min={0.5} max={1} step={0.01} 标题="LOG 白点" />
          <input class="range" type="range" min="0.5" max="1" step="0.01" bind:value={logP.白}
            aria-label="白点" />
        </div>
        <div class="row">
          <span class="row__k">高光滚降</span>
          <NumBox bind:value={logP.滚降} min={0} max={1} step={0.01} 标题="高光滚降" />
          <input class="range" type="range" min="0" max="1" step="0.01" bind:value={logP.滚降}
            aria-label="高光滚降" />
        </div>
        <p class="mini" style="margin-top:8px">
          曝光在线性域做（乘 2^EV），两条曲线下手感一样；色轮那一步在 <b>log 空间</b>里推，
          中间不会撞 0~1 的天花板。滚降 0 = 直接夹断，越大高光收得越早。
          "HDR"指的是运算有超 1 的余量 —— <b>进这个节点的还是 8 位图</b>，不是能读浮点图。
        </p>
      </div>

      <div class="grp" class:grp--off={参数板 !== 'warp'} data-参数页="warp">
        <h3 class="grp__t">色彩变形</h3>
        <div class="pick" style="margin-bottom:10px">
          <button class="pick__b" type="button" aria-pressed={变形张 === '饱和'}
            onclick={() => { 变形张 = '饱和'; 变形选 = 0; }}>色相 × 饱和度</button>
          <button class="pick__b" type="button" aria-pressed={变形张 === '亮度'}
            onclick={() => { 变形张 = '亮度'; 变形选 = 0; }}>色相 × 亮度</button>
        </div>
        <div class="wgrid" style="--边:{变形边}">
          {#each 变形格 as v, i (i)}
            <button class="wcell" type="button" class:is-on={i === 变形选}
              style="background:{格底(v)}" title={`第 ${i} 格：${v.toFixed(2)}`}
              aria-label="第 {i} 格" onclick={() => (变形选 = i)}></button>
          {/each}
        </div>
        <p class="mini" style="margin-top:6px">
          横轴色相（左 = 红，右 = 品红），纵轴{变形张 === '饱和' ? '饱和度（下低上高）' : '亮度（下暗上亮）'}。
          点一格再调下面这个值。
        </p>
        <div class="row">
          <span class="row__k">这一格</span>
          <NumBox
            value={变形格[变形选]}
            min={-1}
            max={1}
            step={0.02}
            标题="这一格的值"
            改变={(v) => (变形格[变形选] = v)}
          />
          <input class="range" type="range" min="-1" max="1" step="0.02" value={变形格[变形选]}
            oninput={(e) => (变形格[变形选] = +e.currentTarget.value)} aria-label="这一格的值" />
        </div>
        <div class="row">
          <span class="row__k">{变形张 === '饱和' ? '饱和满量程' : '亮度满量程'}</span>
          <NumBox
            value={变形张 === '饱和' ? 变形.饱和量 : 变形.亮度量}
            min={0}
            max={1}
            step={0.01}
            标题="满量程"
            改变={(v) => {
              if (变形张 === '饱和') 变形.饱和量 = v;
              else 变形.亮度量 = v;
            }}
          />
          <input class="range" type="range" min="0" max="1" step="0.01"
            value={变形张 === '饱和' ? 变形.饱和量 : 变形.亮度量}
            oninput={(e) => {
              const v = +e.currentTarget.value;
              if (变形张 === '饱和') 变形.饱和量 = v;
              else 变形.亮度量 = v;
            }} aria-label="满量程" />
        </div>
        <div class="row">
          <span class="row__k">带动色相</span>
          <NumBox bind:value={变形.色相量} min={0} max={90} step={1} 后缀="°" 标题="带动色相" />
          <input class="range" type="range" min="0" max="90" step="1" bind:value={变形.色相量}
            aria-label="带动色相" />
        </div>
        <div class="acts" style="margin-top:8px">
          <button class="btn btn--ghost btn--sm" type="button" onclick={() => (变形 = 新建变形())}>
            两张网格清零
          </button>
        </div>
        <p class="mini" style="margin-top:8px">
          每一格的位移同时做两件事：改这一处的{变形张 === '饱和' ? '饱和度' : '亮度'}，
          以及把色相朝一个方向偏（只改不偏的话拖出来的是一条条横带，不像变形）。
        </p>
      </div>

      <div class="grp">
        <h3 class="grp__t">自检</h3>        {#if result.粗}
          <p class="mini">停下之后自动算（拖动时不算 —— 它要额外把表打回整张图，贵一倍）。</p>
        {:else}
          <div class="kv">
            <div class="kv__r"><span>最大差（按 {粗预览长边} 粗图算）</span><span>{result.maxDiff} / 255</span></div>
            <div class="kv__r"><span>平均差（按 {粗预览长边} 粗图算）</span><span>{result.meanDiff.toFixed(3)} / 255</span></div>
          </div>
          <p class="mini" style="margin-top:8px">
            把烘好的 LUT 打回图，和<b>直接跑这条链</b>的结果比。两者走的是同一段代码
            （烘表就是拿链跑一遍 {CLUT_SIZE}³ 的采样网格），所以差值只来自量化和三线性插值。
            <b>它按 {粗预览长边}px 的粗图算，不按原分辨率</b> —— 这个数是像素统计量，跟图多大无关，
            而按原图算每停一次手要多堵主线程 0.6 秒（真 4096×2048 实测）。
          </p>
        {/if}
      </div>

      <div class="grp">
        <label class="chk" style="margin-bottom:8px">
          <input type="checkbox" bind:checked={flipB} />
          <span class="chk__box"></span>蓝切片反序
        </label>
        <p class="mini">
          别家工具的 CLUT 排法不一定相同。导入别人的 LUT 颜色不对时先翻这个。
        </p>
      </div>
    </aside>
  </div>
{:else if panelId === 'blend'}
  <div class="wb">
    <div class="wb__main">
      <div class="card pad">
        <div class="slots slots--4">
          {#each ['c1', 'c2', 'c3', 'c4'] as id, i (id)}
            {@const s = blendSlots.get(id)}
            {@const info = loaded[i]}
            <Slot
              label={s.label}
              url={s.url}
              name={s.ref?.name}
              meta={info.bad || s.size}
              need={i < numClut && !s.data}
              disabled={i >= numClut}
              tag={i >= numClut ? '不用' : ''}
              onpick={() => blendSlots.pick(id)}
              onclear={() => blendSlots.clear(id)}
              ondropfile={(f) => blendSlots.loadFile(id, f)}
              slot={{ group: blendSlots, id }}
            />
          {/each}
        </div>
        <p class="mini" style="margin-top:10px">
          要 {CLUT_W}×{CLUT_H} 的 PNG。ikClut 自带那些（clut_vivid.png、clut_gold.png…）
          尺寸就是这个。{#if readyCount < numClut}<b> 还差 {numClut - readyCount} 张。</b>{/if}
        </p>
        <div class="acts" style="margin-top:8px">
          <span class="mini mut">导入 .cube 到第</span>
          {#each [0, 1, 2, 3] as i (i)}
            <button class="btn btn--ghost btn--sm" type="button"
              disabled={i >= numClut} onclick={() => 导入Cube到槽(`c${i + 1}`, i)}>{i + 1}</button>
          {/each}
          <span class="mini mut">张</span>
        </div>
        {#if msg}
          <div style="margin-top:8px"><Note kind={msg.kind} onclose={() => (msg = null)} 自动关={提示自动关毫秒}>{msg.text}</Note></div>
        {/if}
        {#each loaded as c, i (c.id)}
          {#if c.bad}
            <p class="mini bad" style="margin-top:6px">
              CLUT {i + 1} 的图尺寸不对：{c.bad}
            </p>
          {/if}
        {/each}
      </div>

      <div class="card pad">
        <h3 class="h3">混完的效果</h3>
        {#if blended}
          <Preview url={blended.url} wide />
        {:else}
          <Note>按当前张数把 LUT 填满，这里出预览。</Note>
        {/if}
      </div>

      <div class="wb__acts">
        <span class="mini mut">{numClut} 张按上面的权重混成一张 {CLUT_W}×{CLUT_H}。</span>
        {@render 撤销钮()}
        <button class="btn btn--primary" disabled={!blended} onclick={() => exportClut('blend')}>
          <Icon name="ui.export" size={15} />导出混合结果
        </button>
      </div>
    </div>

    <aside class="card wb__side">
      <div class="grp">
        <h3 class="grp__t">用几张</h3>
        <div class="pick">
          {#each [1, 2, 4] as n (n)}
            <button class="pick__b" type="button" aria-pressed={numClut === n}
              onclick={() => (numClut = n)}>{n} 张</button>
          {/each}
        </div>
        {#if numClut === 1}
          <p class="mini" style="margin-top:8px">只用 CLUT 1，不给混合系数。</p>
        {:else}
          <div class="row" style="margin-top:12px">
            <span class="row__k">X 向</span>
            <NumBox bind:value={mixX} min={0} max={1} step={0.01} 标题="横向混合" />
            <input class="range" type="range" min="0" max="1" step="0.01" bind:value={mixX}
              aria-label="X 向混合" />
          </div>
          {#if numClut === 4}
            <div class="row">
              <span class="row__k">Y 向</span>
              <NumBox bind:value={mixY} min={0} max={1} step={0.01} 标题="纵向混合" />
              <input class="range" type="range" min="0" max="1" step="0.01" bind:value={mixY}
                aria-label="Y 向混合" />
            </div>
          {/if}
        {/if}
      </div>

      <div class="grp">
        <h3 class="grp__t">实际权重</h3>
        <div class="kv">
          {#each weights as w, i (i)}
            <div class="kv__r"><span>CLUT {i + 1}</span><span>{(w * 100).toFixed(1)}%</span></div>
          {/each}
        </div>
        {#if numClut === 4}
          <p class="mini" style="margin-top:8px">
            和 ikClut 官方注释一致：X 先混 (1,2) 和 (3,4)，Y 再混这两组。
            这组权重在 MMD 里由附件的 X / Y 位置实时给。
          </p>
        {/if}
      </div>

      <div class="grp">
        <p class="mini">主按钮在主区最后一行。</p>
      </div>
    </aside>
  </div>
{:else}
  <div class="wb">
    <div class="wb__main">
      <div class="card pad">
        <h3 class="h3">导出的是什么</h3>
        <div class="kv">
          <div class="kv__r"><span>尺寸</span><span>{CLUT_W} × {CLUT_H}</span></div>
          <div class="kv__r"><span>切片</span><span>{CLUT_SIZE} 个 {CLUT_SIZE}×{CLUT_SIZE}</span></div>
          <div class="kv__r"><span>蓝切片方向</span><span>{flipB ? '反序' : '正序'}</span></div>
          <div class="kv__r"><span>自检最大差（{粗预览长边} 粗图）</span><span>{result.maxDiff} / 255</span></div>
        </div>
        <div style="height:14px"></div>
        <div class="clutwrap">
          <img src={result.clutUrl} alt="" />
        </div>
      </div>

      <div class="card pad">
        <h3 class="h3">放进 ikClut 要改的两行</h3>
        <p class="mini" style="margin-bottom:10px">
          <span class="mono">ikClut.fx</span> 里把生成的 PNG 挂上就行。路径相对于 ikClut 目录。
        </p>
        <pre class="code">#define USE_CLUT_NUM  1
#define ClutTexName1  "clut.png"</pre>
        <p class="mini" style="margin-top:10px">
          用 2 张就把 <span class="mono">USE_CLUT_NUM</span> 改成 2 再补
          <span class="mono">ClutTexName2</span>；4 张同理，文件名排到 4。
          混合比例在 MMD 里用附件的 X（2 张）或 X/Y（4 张）实时调，不用改文件。
        </p>
      </div>

      <div class="wb__acts">
        <span class="mini mut">导出 PNG，旁边再写一份同名 .txt。</span>
        {@render 撤销钮()}
        <button class="btn btn--primary" disabled={exporting} onclick={() => exportClut('edit')}>
          <Icon name="ui.export" size={15} />导出 PNG + TXT
        </button>
      </div>
    </div>

    <aside class="card wb__side">
      <div class="grp">
        <h3 class="grp__t">附带写出的 .txt</h3>
        <p class="mini">
          桌面端每次导出会在 PNG 旁边写一个同名 .txt：曝光、对比度、饱和度、色相、
          三条曲线的控制点、自检差值。想复现同一张 LUT 就看它。
        </p>
        <pre class="code" style="margin-top:10px">{paramReport(result.clut)}</pre>
      </div>
      <div class="grp">
        <p class="mini">主按钮在主区最后一行。</p>
      </div>
    </aside>
  </div>
{/if}

{#if msg}
  <div class="toast">
    <Note kind={msg.kind} onclose={() => (msg = null)} 自动关={提示自动关毫秒}>{msg.text}</Note>
  </div>
{/if}

<style>
  .pad { padding: 16px; }
  .h3 { margin: 0 0 10px; font-size: var(--fs-md); }
  .btn--sm { padding: 4px 10px; font-size: var(--fs-2xs); }
  /* 撤销那一对 + 步数读数，横着排，落在底栏左侧 */
  .undobtns { display: inline-flex; align-items: center; gap: 6px; }
  .undobtns__n { font-variant-numeric: tabular-nums; }
  .bad { color: var(--danger); }
  .warnline {
    margin: 0 0 10px;
    padding: 7px 9px;
    border-radius: var(--r-sm);
    background: color-mix(in oklab, var(--warn) 12%, var(--surface-2));
    color: var(--body-text);
  }
  .toast { margin-top: 12px; }

  /* 原图 / 调色后：左右各一个独立视图（各自缩放、各自拖动） */
  .cmp { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: start; }
  .cmp--one { grid-template-columns: minmax(0, 1fr); }
  .cmp__col { min-width: 0; display: grid; gap: 4px; }
  .cmp__cap { font-size: var(--fs-xs); color: var(--content-meta); text-align: center; }
  @media (max-width: 1100px) { .cmp { grid-template-columns: minmax(0, 1fr); } }

  /* 参数板标签：按可用宽度自动换列 */
  .tabs { display: flex; flex-wrap: wrap; gap: 4px; }
  .tabs__b {
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--body-text);
    font: inherit;
    font-size: var(--fs-2xs);
    padding: 4px 10px;
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: background var(--t-micro) var(--ease-std), color var(--t-micro) var(--ease-std);
  }
  .tabs__b:hover { background: var(--btn-plain-bg-hover); color: var(--deep-text); }
  .tabs__b[aria-pressed='true'] {
    background: color-mix(in oklab, var(--primary) 18%, var(--surface-2));
    border-color: color-mix(in oklab, var(--primary) 45%, var(--line));
    color: var(--primary-ink);
    font-weight: 650;
  }
  /* 没选中的参数组藏起来：侧栏不再变成一长串 */
  .grp--off { display: none; }
  /* 侧栏固定高度、内部滚动（sticky 只钉顶部，内容比视口高时底下那截永远够不着） */
  .参数侧栏 { max-height: calc(100vh - var(--bar-h) - 28px); overflow: auto; }

  /* CLUT 是 1024×32，等比铺满宽度会扁成一条线，所以放大到容器的 140% 横着滚 */
  /* 处理链那一列：一行一个节点，左边勾选、右边三个小按钮 */
  .chain li { align-items: center; gap: 6px; }
  .chain .chk { margin: 0; }
  .chain .x {
    border: 0;
    background: var(--btn-regular-bg);
    color: var(--btn-content);
    font: inherit;
    font-size: var(--fs-2xs);
    line-height: 1;
    padding: 3px 6px;
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .chain .x:disabled { opacity: 0.35; cursor: not-allowed; }
  .chain__hint { margin-left: 2px; }

  /* CLUT 长条：**宽了就缩到容器里，不许横向滚动**（规范 §十一：横向滚动一律不许有）。
     原来写的是 `overflow-x:auto` + `width:140%` —— 那是"故意让它滚动"，真窗口体检立刻判 FAIL。 */
  .clutwrap {
    overflow: hidden;
    padding: 8px;
    border-radius: var(--r-md);
    background: var(--surface-2);
  }
  .clutwrap img {
    display: block;
    width: 100%;
    max-width: 100%;
    height: auto;
    image-rendering: pixelated;
    border-radius: var(--r-sm);
  }

  .code {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--r-md);
    background: var(--surface-2);
    border: 1px solid var(--line-divider);
    font-family: var(--font-mono);
    font-size: var(--fs-2xs);
    line-height: 1.7;
    color: var(--deep-text);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 18rem;
    overflow: auto;
  }

  /* ---------------------------------------------------------- 色轮那一块 */

  .wheel {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--line-divider);
  }
  .wheel:first-of-type { margin-top: 0; padding-top: 0; border-top: 0; }
  .wheel__t { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  .wheel__sw {
    width: 14px; height: 14px; flex: none;
    border-radius: 50%;
    border: 1px solid var(--line);
  }

  /* 变形那两张 8×8 网格。浏览器里用 grid 铺，格子是按钮（键盘也点得着） */
  .wgrid {
    display: grid;
    grid-template-columns: repeat(var(--边, 8), 1fr);
    gap: 2px;
    padding: 4px;
    border: 1px solid var(--line-divider);
    border-radius: var(--r-sm);
    background: var(--surface-2);
  }
  .wcell {
    aspect-ratio: 1;
    min-height: 12px;
    border: 1px solid var(--line);
    border-radius: 2px;
    background: transparent;
    cursor: pointer;
    padding: 0;
  }
  .wcell.is-on {
    border-color: var(--primary);
    box-shadow: 0 0 0 1px var(--primary) inset;
  }
</style>
