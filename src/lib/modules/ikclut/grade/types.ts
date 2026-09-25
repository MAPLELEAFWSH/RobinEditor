/**
 * ② 调色链的类型与默认值。纯数据，不碰 DOM。
 *
 * 架构：**一条链 = 一个可增删、可重排、可单条关掉的处理节点数组**。
 * 每个节点一个纯函数 `(ImageData, 参数) => ImageData`，能单独测。
 * 自由连线的节点图不做（收益不确定、返工面极大）。
 *
 * 还没做的那几种（色轮 / HSL / LOG-HDR / 色彩变形）在 `待做节点` 里登记着：
 * 做的时候加一个类型、在 `chain.ts` 的实现表里加一项、在界面上加一块参数区，
 * **别的地方一行都不用动** —— 这就是把链做在类型上的意义。
 *
 * 逐像素的算式**不在这里**，在 `img.ts` 的 `applyGrade` 一份：
 * 基本节点就是"往它里面填基本项"，曲线节点是"填曲线"。两套实现漂开之后
 * "预览和烘出来的 LUT 颜色不一样"这种问题就再也查不出来了。
 */
import type { CurveKind, CurvePoint } from '$lib/img';

/* ------------------------------------------------------------ 基本 */

export type BasicParams = {
  exposure: number;
  contrast: number;
  saturation: number;
  hue: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
  black: number;
  white: number;
};

export function 新建基本(): BasicParams {
  return {
    exposure: 1,
    contrast: 1,
    saturation: 1,
    hue: 0,
    temperature: 0,
    tint: 0,
    highlights: 0,
    shadows: 0,
    black: 0,
    white: 1
  };
}

/** 全恒等 = 那一步整段不执行（`applyGrade` 里每一步都带开关） */
export function 基本是恒等(p: BasicParams): boolean {
  return (
    p.exposure === 1 &&
    p.contrast === 1 &&
    p.saturation === 1 &&
    p.hue === 0 &&
    p.temperature === 0 &&
    p.tint === 0 &&
    p.highlights === 0 &&
    p.shadows === 0 &&
    p.black === 0 &&
    p.white === 1
  );
}

/* ------------------------------------------------------------ 曲线 */

export type CurveChannel = 'r' | 'g' | 'b' | 'luma';

export type CurveParams = {
  /** 插值方式，四条曲线共用（跟 ⑧ 那边同一套） */
  kind: CurveKind;
  r: CurvePoint[];
  g: CurvePoint[];
  b: CurvePoint[];
  /** 亮度曲线：按亮度比例作用到三条通道上，不动色相 */
  luma: CurvePoint[];
  /** 第四条，通道可选 —— 这就是"单通道细化" */
  extra: CurvePoint[];
  extraCh: CurveChannel;
};

/** 两点直线 = 逐字节恒等。注意 'smooth' 在两点之间是 S 曲线，不是恒等 */
export const 平: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 }
];

export function 新建曲线(): CurveParams {
  return {
    kind: 'linear',
    r: 平.map((p) => ({ ...p })),
    g: 平.map((p) => ({ ...p })),
    b: 平.map((p) => ({ ...p })),
    luma: 平.map((p) => ({ ...p })),
    extra: 平.map((p) => ({ ...p })),
    extraCh: 'luma'
  };
}

/** 这条曲线是不是恒等（只有两个端点、且就是 (0,0)→(1,1)） */
export function 曲线是恒等(pts: CurvePoint[]): boolean {
  if (pts.length !== 2) return false;
  const s = [...pts].sort((a, b) => a.x - b.x);
  return s[0].x === 0 && s[0].y === 0 && s[1].x === 1 && s[1].y === 1;
}

export function 曲线都恒等(p: CurveParams): boolean {
  return 曲线是恒等(p.r) && 曲线是恒等(p.g) && 曲线是恒等(p.b) && 曲线是恒等(p.luma) && 曲线是恒等(p.extra);
}

/* ------------------------------------------------------------ LUT */

/**
 * 导入的 LUT（`.cube`）。
 *
 * 3D 那张就是本工程原来那个 `Clut` 的形状（size³×3 字节），1D 那张是三条独立的表。
 * 1D 不能摊成 3D：size=256 的 1D 摊成 3D 是 1600 万项（50 MB）。
 *
 * `domainMin` / `domainMax` 是 `.cube` 里写的**输入**范围：不是 0~1 的话，
 * 采样前要先把输入映进去（这是格式规定，不是我们的选择）。
 */
export type Lut3D = {
  kind: '3d';
  size: number;
  data: Uint8ClampedArray;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  title: string;
};

export type Lut1D = {
  kind: '1d';
  size: number;
  r: Uint8ClampedArray;
  g: Uint8ClampedArray;
  b: Uint8ClampedArray;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  title: string;
};

export type Lut = Lut3D | Lut1D;

export type LutParams = {
  lut: Lut | null;
  /** 掺多少，0 = 不用这张表，1 = 全用 */
  strength: number;
  /** 界面上显示的文件名 */
  name: string;
  /** 解析时被夹过的采样点数（>1 的 HDR 值），非 0 时界面上要说一句 */
  clamped: number;
};

export function 新建Lut参数(): LutParams {
  return { lut: null, strength: 1, name: '', clamped: 0 };
}

/* ------------------------------------------------------------ 色轮 */

/** 一个色轮：朝这个色相推色度（强度），外加这一段整体的明暗（亮度） */
export type Wheel = {
  /** 色相角 0~360 */
  h: number;
  /** 强度 0~1，0 = 不推 */
  s: number;
  /** 这一段整体的明暗 −1~1，0 = 不动 */
  l: number;
};

export type WheelsParams = {
  暗: Wheel;
  中: Wheel;
  高: Wheel;
  /** 不分段的那一个，整张图一起推 */
  全局: Wheel;
  /** 三条通道的整体偏移，各 −1~1（乘 0.25 后加） */
  偏移: [number, number, number];
};

export function 新建色轮(): WheelsParams {
  const 空 = (): Wheel => ({ h: 0, s: 0, l: 0 });
  return { 暗: 空(), 中: 空(), 高: 空(), 全局: 空(), 偏移: [0, 0, 0] };
}

export function 色轮是恒等(p: WheelsParams): boolean {
  for (const w of [p.暗, p.中, p.高, p.全局]) if (w.s !== 0 || w.l !== 0) return false;
  return p.偏移[0] === 0 && p.偏移[1] === 0 && p.偏移[2] === 0;
}

/* ------------------------------------------------------------ HSL */

/** 一个色相段：色相偏移（度）+ 饱和倍数 + 亮度倍数 */
export type HslBand = { h: number; s: number; l: number };

/** 段的中心角，红在 0° —— 八段各 45° */
export const HSL段: { name: string; 中心: number }[] = [
  { name: '红', 中心: 0 },
  { name: '橙', 中心: 45 },
  { name: '黄', 中心: 90 },
  { name: '绿', 中心: 135 },
  { name: '青', 中心: 180 },
  { name: '蓝', 中心: 225 },
  { name: '紫', 中心: 270 },
  { name: '品红', 中心: 315 }
];

export type HslParams = {
  bands: HslBand[];
  /** 段与段之间的过渡宽度倍数，0.5~2。1 = 每段各占 45° 的一半 */
  平滑: number;
};

export function 新建Hsl(): HslParams {
  return { bands: HSL段.map(() => ({ h: 0, s: 1, l: 1 })), 平滑: 1 };
}

export function Hsl是恒等(p: HslParams): boolean {
  return p.bands.every((b) => b.h === 0 && b.s === 1 && b.l === 1);
}

/* ------------------------------------------------------------ LOG / HDR */

/** 两条对数控码曲线，都是按对数编码的公开形式自己写的 */
export type LogCurveId = 'log2' | 'log10';

export const LOG曲线名: Record<LogCurveId, string> = {
  log2: 'log2（0 会去到负值）',
  log10: 'log10（把 0~1 映回 0~1）'
};

export type LogParams = {
  曲线: LogCurveId;
  /** log 空间的曝光，EV。线性域等于乘 2^EV */
  曝光: number;
  /** 在 log 空间里朝这个色相推色度（HDR 色轮） */
  色轮色相: number;
  色轮强度: number;
  /** 线性域的黑白点：低于黑压到 0、高于白提到 1 */
  黑: number;
  白: number;
  /** 高光滚降：>0 时超过 1 的部分按这个强度压回来（0 = 直接夹断） */
  滚降: number;
};

export function 新建Log(): LogParams {
  return { 曲线: 'log10', 曝光: 0, 色轮色相: 0, 色轮强度: 0, 黑: 0, 白: 1, 滚降: 0 };
}

export function Log是恒等(p: LogParams): boolean {
  return p.曝光 === 0 && p.色轮强度 === 0 && p.黑 === 0 && p.白 === 1 && p.滚降 === 0;
}

/* ------------------------------------------------------------ 色彩变形 */

/** 二维网格的边（8×8 = 64 个格点） */
export const 变形边 = 8;

export type WarpParams = {
  /** 横轴色相、纵轴饱和度：值 −1~1 = 该处饱和度的增减 */
  色相饱和: number[];
  /** 横轴色相、纵轴亮度：值 −1~1 = 该处亮度的增减 */
  色相亮度: number[];
  /** 饱和度增减的满量程倍数（0~1，0.5 = 最多 ±50%） */
  饱和量: number;
  /** 亮度增减的满量程倍数 */
  亮度量: number;
  /** 沿色相推的量（度，0~90）：把相邻色相一起带动，做"色相变形" */
  色相量: number;
};

export function 新建变形(): WarpParams {
  return {
    色相饱和: new Array(变形边 * 变形边).fill(0),
    色相亮度: new Array(变形边 * 变形边).fill(0),
    饱和量: 0.5,
    亮度量: 0.5,
    色相量: 30
  };
}

export function 变形是恒等(p: WarpParams): boolean {
  if (p.饱和量 === 0 && p.亮度量 === 0 && p.色相量 === 0) return true;
  return p.色相饱和.every((v) => v === 0) && p.色相亮度.every((v) => v === 0);
}

/* ------------------------------------------------------------ 节点 */

export type GradeNode =
  | { kind: 'basic'; id: string; on: boolean; p: BasicParams }
  | { kind: 'curves'; id: string; on: boolean; p: CurveParams }
  | { kind: 'lut'; id: string; on: boolean; p: LutParams }
  | { kind: 'wheels'; id: string; on: boolean; p: WheelsParams }
  | { kind: 'hsl'; id: string; on: boolean; p: HslParams }
  | { kind: 'log'; id: string; on: boolean; p: LogParams }
  | { kind: 'warp'; id: string; on: boolean; p: WarpParams };

export type NodeKind = GradeNode['kind'];

export const 节点名: Record<NodeKind, string> = {
  basic: '基本',
  curves: '曲线',
  lut: '导入的 LUT',
  wheels: '色轮',
  hsl: 'HSL',
  log: 'LOG / HDR',
  warp: '色彩变形'
};

export const 节点一句: Record<NodeKind, string> = {
  basic: '曝光 / 对比 / 饱和 / 色相 / 色温色调 / 高光阴影 / 黑白点',
  curves: 'RGB 三条 + 亮度 + 第四条自选通道',
  lut: '导入的 .cube，按强度掺进链里',
  wheels: '暗部 / 中间调 / 高光 各一个轮 + 全局轮 + 整体偏移',
  hsl: '8 个色相段，各调色相 / 饱和 / 亮度，带段间平滑',
  log: '进 log 空间调完再回来，带高光滚降',
  warp: '色相 × 饱和 / 色相 × 亮度 两张二维网格'
};

/**
 * 加一种节点要动三处：这块里的一个类型 + `nodes.ts` 里一个纯函数实现 +
 * 界面上（`Ikclut.svelte`）一块参数区。链本身不用改 —— `chain.ts` 的实现表
 * 会拿 kind 去查，没登记的直接抛错（不许静默跳过）。
 */

let 序号 = 0;
export function 新节点id(): string {
  序号++;
  return `n${序号}`;
}

export function 新建节点(kind: NodeKind): GradeNode {
  const id = 新节点id();
  if (kind === 'basic') return { kind, id, on: true, p: 新建基本() };
  if (kind === 'curves') return { kind, id, on: true, p: 新建曲线() };
  if (kind === 'wheels') return { kind, id, on: true, p: 新建色轮() };
  if (kind === 'hsl') return { kind, id, on: true, p: 新建Hsl() };
  if (kind === 'log') return { kind, id, on: true, p: 新建Log() };
  if (kind === 'warp') return { kind, id, on: true, p: 新建变形() };
  return { kind: 'lut', id, on: true, p: 新建Lut参数() };
}
