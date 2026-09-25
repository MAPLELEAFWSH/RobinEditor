/**
 * ⑤ ILM / lightmap 打包的算法。
 *
 * 这层只做像素，不碰界面，方便单独核对。
 *
 * 绝区零那条映射是逐像素验过的，写在下面的 ZZZ_MAP 里；
 * 原神 / 星铁只能做"配比对齐"，空间布局对不上 —— 见 MANUAL_LAYOUT_NOTE。
 */
import {
  CHANNEL_KEYS,
  type ChannelKey,
  blankImageData,
  extractChannel,
  lumaOf,
  resize,
  type ScaleMode
} from '$lib/img';

/* ------------------------------------------------------------------ 来源描述 */

/** ladder：`[值 0-1, 占比 0-1]`。占比合起来不到 1 的部分归 default。 */
export type Ladder = [number, number][];

/**
 * 输出通道的来源。
 * kind 决定用哪几项：
 *   slot   —— 取某张源图的某个通道
 *   ladder —— 按占比把一个 drive 通道切成几档，套上 ladder 的值
 *   const  —— 整片填一个常量
 */
export type SrcRef = {
  kind: 'slot' | 'ladder' | 'const';
  /** 源图槽位 id */
  slot: string;
  ch: ChannelKey;
  invert: boolean;
  /** kind=const 时用，0-255 */
  constant: number;
  /** kind=ladder 时用 */
  ladder: Ladder;
  /** ladder 没占满的部分填这个，0-1 */
  ladderDefault: number;
  /** ladder 按哪路明暗切档 */
  drive: { slot: string; ch: ChannelKey | 'luma' };
  /** true = 从最亮那头开始套 ladder */
  fromBright: boolean;
};

export type LmMap = Record<ChannelKey, SrcRef>;

export function ref(patch: Partial<SrcRef> = {}): SrcRef {
  return {
    kind: 'const',
    slot: '',
    ch: 'r',
    invert: false,
    constant: 0,
    ladder: [],
    ladderDefault: 0,
    drive: { slot: '', ch: 'luma' },
    fromBright: true,
    ...patch
  };
}

/* ------------------------------------------------------------------ 槽位常量 */

export const LM_SLOTS = [
  { id: 'A', label: '_A' },
  { id: 'M', label: '_M' },
  { id: 'N', label: '_N' }
] as const;

/** 核对用的参照 LM。不参与打包 */
export const REF_SLOT = 'REF';

/* ------------------------------------------------------------------ 只做绝区零 */

/**
 * **原神 / 星铁的实测配比表已经删掉了**（2026-09-26，用户问"既然是绝区零贴图合成，
 * 其他游戏规格参数保留还有什么用"）。
 *
 * 删的理由不是"用不上"，是**它们做不出对的东西**：
 *   · 绝区零这条路是"三张现成图按固定通道拼"，逐像素验过，零误差；
 *   · 原神 / 星铁的 lightmap 得**画** —— 自动那套只能对上"各档占多少面积"，
 *     对不上"哪块归哪档"。本工程自己量过：留一法里类型预设 + 颜色分数排序的
 *     最佳 IoU 只有 **0.387**（点了取样 0.63，纯手绘 1.0）。
 *     换句话说按一下按钮吐出来的是一张**看着像、区域全是错的** lightmap。
 *   · 那句警告（`MANUAL_LAYOUT_NOTE`）原来只 import 了、**从没画到界面上** ——
 *     连"这东西不准"都没告诉人。界面上只写着"目标规格：绝区零 / 原神 / 星铁"，
 *     跟本模块自己的说明（"只管这一个游戏的这一种排法"）打架。
 *
 * 删掉的是：`GENSHIN_LADDERS` / `HSR_LADDERS` / `LADDER_GROUPS` /
 * `genshinLadder` / `genshinDefault` / `hsrLadder` / `hsrDefault` / `GENSHIN_MAP` / `HSR_MAP`。
 * 数据本身没丢：`test/生成/预设库.json`、`贴图样本/honkaiSR/_验证/星铁预设.json`
 * 还在，git 历史里也查得到。
 *
 * `MANUAL_LAYOUT_NOTE` 留着 —— 手填「按 ladder 配比」那条路还在，
 * 只要人自己给配比，它就得看见"这只能对上面积"这句。现在它真的画在界面上了。
 */


/* ------------------------------------------------------------------ 映射预设 */

export type Preset = {
  id: string;
  name: string;
  /** 每个输出通道在这个游戏里是什么 */
  semantics: Record<ChannelKey, string>;
  /** 量化网格：0 = 不量化。原神/星铁是 0.05 */
  grid: number;
  /** 导出后缀 */
  suffix: string;
  /** 默认映射 */
  map: LmMap;
  note: string;
};

/**
 * 绝区零：`_A/_M/_N` → `_LM`。
 *
 * 对着 `渲染联动/养乐多/MMDStarRail4Fun_v2.2.1/ZZZ/vivian` 的真实配对逐像素验过，
 * Body_1 / Body_2 两张都对得上：
 *
 *   R = _A.G   99.97% 逐像素相同（Body_1），Body_2 是 100.00%
 *              差的那 0.033% 全落在 _A 的 alpha=254 那些像素上、只差 1 级：
 *              作者那边走了一趟预乘/反预乘，254/255 乘回去会掉 1 级，不是映射问题
 *   B = _M.B   100.00% 相同，corr +1.0000
 *   G = _N.B   corr +0.998；差的那些是 _N 只有一半分辨率的重采样损耗，见 packLm
 *   A          真值那张 LM 存的是 RGB，压根没有 alpha 通道，填 1
 *
 * B 那一路 bit-exact，说明映射本身没有别的花样，不用再猜。
 * `_M` 的 G 通道最终 LM 里根本不用。
 */
export const ZZZ_MAP: LmMap = {
  r: ref({ kind: 'slot', slot: 'A', ch: 'g' }),
  g: ref({ kind: 'slot', slot: 'N', ch: 'b' }),
  b: ref({ kind: 'slot', slot: 'M', ch: 'b' }),
  a: ref({ kind: 'const', constant: 255 })
};

/**
 * 原神 / 星铁那两条映射**已随配比表一起删掉**（理由见上面「只做绝区零」那一段）：
 * 它们只能做配比对齐、空间布局对不上，而那句警告原来从没画到界面上。
 * 要画原神 / 星铁的 lightmap 是另一条路 —— 手画，不在这个模块里。
 */

export const PRESETS: Preset[] = [
  {
    id: 'zzz',
    name: '绝区零',
    semantics: { r: '_A.G 高光/自发光', g: '_N.B（法线）', b: '_M.B 金属度', a: '常量 1' },
    grid: 0,
    suffix: '_LM',
    map: ZZZ_MAP,
    note: 'R、B 逐像素精确；G 取自半分辨率法线，lanczos 放大后平均误差 0.13~0.24 级'
  }
];

export function presetOf(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

/**
 * 印在界面上的一句话。自动生成只对得上配比，对不上位置 ——
 * 留一法实测：类型预设 + 颜色分数排序的最佳 IoU 只有 0.387，
 * 点了取样能到 0.63，纯手绘才 1.0。这句不是免责，是让人知道该往哪使劲。
 */
export const MANUAL_LAYOUT_NOTE =
  '自动只能对上「各档占多少面积」，对不上「哪块归哪档」（实测最佳 IoU 0.39）。要准就得自己画。';

/* ------------------------------------------------------------------ 单通道生成 */

/** 取 drive 通道。luma 就走 Rec.709 明度 */
function drivePlane(
  d: { slot: string; ch: ChannelKey | 'luma' },
  sources: Map<string, ImageData>,
  w: number,
  h: number
): Uint8ClampedArray | null {
  const img = sources.get(d.slot);
  if (!img) return null;
  const use = img.width === w && img.height === h ? img : resize(img, w, h, 'bilinear');
  return d.ch === 'luma' ? lumaOf(use) : extractChannel(use, d.ch);
}

/**
 * 按占比把 drive 切成档，套上 ladder 的值。
 *
 * 走的是直方图匹配那条路：算 drive 的分布，把 ladder 各档的占比翻译成
 * 一串阈值，落在同一档里的像素给同一个值。2048² 也不会卡。
 *
 * 顺序：ladder 按「值」从大到小排，然后从最亮（或最暗）那端开始一段段切。
 * 谁该归哪档本来就得人看，所以给了 fromBright 这个开关。
 */
export function ladderPlane(
  ladder: Ladder,
  def: number,
  drive: Uint8ClampedArray,
  fromBright: boolean,
  invert: boolean
): Uint8ClampedArray {
  const n = drive.length;
  const out = new Uint8ClampedArray(n);

  // 没配比就直接填 default
  const sorted = [...ladder].filter((e) => e[1] > 0).sort((a, b) => b[0] - a[0]);
  const total = sorted.reduce((s, e) => s + e[1], 0);
  if (!sorted.length || total <= 0) {
    out.fill(Math.max(0, Math.min(255, Math.round(def * 255))));
    return out;
  }

  // drive 的直方图（256 桶）。invert 就是把这个直方图翻过来
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[drive[i]]++;
  if (invert) {
    const rev = new Uint32Array(256);
    for (let v = 0; v < 256; v++) rev[v] = hist[255 - v];
    hist.set(rev);
  }

  // 对每个 drive 值算出「比它亮（或暗）的像素占多少」
  // 然后看这个累积比例落在 ladder 的哪一段
  const cum = new Float64Array(256);
  let acc = 0;
  if (fromBright) {
    for (let v = 255; v >= 0; v--) {
      cum[v] = acc;
      acc += hist[v];
    }
  } else {
    for (let v = 0; v < 256; v++) {
      cum[v] = acc;
      acc += hist[v];
    }
  }
  // 归一化
  for (let v = 0; v < 256; v++) cum[v] /= n || 1;

  // 每段的上界
  const bounds: number[] = [];
  let s = 0;
  for (const [, share] of sorted) {
    s += share;
    bounds.push(s);
  }
  const vals = sorted.map((e) => Math.max(0, Math.min(255, Math.round(e[0] * 255))));
  const defByte = Math.max(0, Math.min(255, Math.round(def * 255)));

  // 烘成 256 项查表，再逐像素查
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const c = cum[v];
    let hit = -1;
    for (let k = 0; k < bounds.length; k++) {
      if (c < bounds[k]) {
        hit = k;
        break;
      }
    }
    lut[v] = hit < 0 ? defByte : vals[hit];
  }
  for (let i = 0; i < n; i++) out[i] = lut[drive[i]];
  return out;
}

/** 生成一个输出通道 */
export function buildPlane(
  r: SrcRef,
  w: number,
  h: number,
  sources: Map<string, ImageData>
): Uint8ClampedArray {
  if (r.kind === 'const') {
    const plane = new Uint8ClampedArray(w * h);
    plane.fill(Math.max(0, Math.min(255, Math.round(r.constant))));
    return plane;
  }
  if (r.kind === 'ladder') {
    const drive = drivePlane(r.drive, sources, w, h);
    if (!drive) {
      const plane = new Uint8ClampedArray(w * h);
      plane.fill(Math.max(0, Math.min(255, Math.round(r.ladderDefault * 255))));
      return plane;
    }
    return ladderPlane(r.ladder, r.ladderDefault, drive, r.fromBright, r.invert);
  }
  // slot
  const img = sources.get(r.slot);
  if (!img) {
    const plane = new Uint8ClampedArray(w * h);
    plane.fill(r.constant);
    return plane;
  }
  // 先按目标尺寸放大（核由调用方决定，见 packLm），再抽通道
  const use = img.width === w && img.height === h ? img : resize(img, w, h, 'bilinear');
  return extractChannel(use, r.ch, r.invert);
}

/**
 * 打包。
 *
 * up 只作用在「尺寸对不上的源图」上 —— 绝区零那个半分辨率法线就靠它
 * （_N 是 1024、LM 是 2048）。放大核实测，参照是真值 LM 的 G 通道：
 *
 *   nearest   84.26% / 73.09%   MAE 0.533 / 1.056
 *   bilinear  85.59% / 74.13%   MAE 0.299 / 0.584
 *   bicubic   90.47% / 82.96%   MAE 0.144 / 0.260
 *   lanczos   90.67% / 82.36%   MAE 0.131 / 0.243
 *
 * 两列分别是 Body_1 和 Body_2。lanczos 两个样本的平均误差都最小，所以默认它。
 *
 * 剩下的残差（最大 29 级）不是插值能解决的：真值那张 LM 应该是拿全分辨率法线
 * 做的、之后再把法线降了一半，高频在我们手上已经没有了，换哪个核都补不回来。
 * 所以看核对结果时别只盯「完全相同」的比例，MAE 才是这个通道的有效指标。
 */
export function packLm(
  w: number,
  h: number,
  map: LmMap,
  sources: Map<string, ImageData>,
  up: ScaleMode = 'lanczos',
  grid = 0
): ImageData {
  // 先把源图统一到目标尺寸，这样 buildPlane 里就不会再走一次双线性
  const fitted = new Map<string, ImageData>();
  for (const [id, img] of sources) {
    fitted.set(id, img.width === w && img.height === h ? img : resize(img, w, h, up));
  }
  const planes: Record<ChannelKey, Uint8ClampedArray> = {
    r: buildPlane(map.r, w, h, fitted),
    g: buildPlane(map.g, w, h, fitted),
    b: buildPlane(map.b, w, h, fitted),
    a: buildPlane(map.a, w, h, fitted)
  };
  if (grid > 0) {
    for (const k of CHANNEL_KEYS) planes[k] = quantize(planes[k], grid);
  }
  return assemble(planes, w, h);
}

/** 四个平面拼成 ImageData */
export function assemble(
  planes: Record<ChannelKey, Uint8ClampedArray>,
  w: number,
  h: number
): ImageData {
  const out = blankImageData(w, h);
  const d = out.data;
  const n = w * h;
  const { r, g, b, a } = planes;
  for (let i = 0; i < n; i++) {
    const di = i * 4;
    d[di] = r[i];
    d[di + 1] = g[i];
    d[di + 2] = b[i];
    d[di + 3] = a[i];
  }
  return out;
}

/** 吸附到 step 网格（0.05 → 21 档）。step<=0 原样返回 */
export function quantize(plane: Uint8ClampedArray, step: number): Uint8ClampedArray {
  if (step <= 0) return plane;
  const out = new Uint8ClampedArray(plane.length);
  const levels = Math.round(1 / step);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(Math.round((v / 255) * levels) / levels * 255);
  for (let i = 0; i < plane.length; i++) out[i] = lut[plane[i]];
  return out;
}

/* ------------------------------------------------------------------ 核对 */

export type ChannelDiff = {
  ch: ChannelKey;
  /** 逐像素完全相同的比例 */
  identical: number;
  maxDiff: number;
  meanDiff: number;
};

export type DiffResult = {
  perChannel: ChannelDiff[];
  /** 整张图四个通道全同的像素比例 */
  identicalAll: number;
  width: number;
  height: number;
  /** 尺寸对不上时不能比 */
  sizeMismatch: boolean;
};

/**
 * 拿产出跟参照 LM 逐像素比。
 *
 * 这就是那张验证报告在做的事，数字口径保持一致，用户能自己复现
 * 「R/B 100%、G 85~95%」这个结论，不用信我。
 */
export function diffAgainst(got: ImageData, refImg: ImageData): DiffResult {
  if (got.width !== refImg.width || got.height !== refImg.height) {
    return {
      perChannel: [],
      identicalAll: 0,
      width: got.width,
      height: got.height,
      sizeMismatch: true
    };
  }
  const n = got.width * got.height;
  const a = got.data;
  const b = refImg.data;
  const per: ChannelDiff[] = [];
  const offs: Record<ChannelKey, number> = { r: 0, g: 1, b: 2, a: 3 };
  let allSame = 0;
  // 先记每像素是否四通道全同，避免第二遍
  const sameAll = new Uint8Array(n);
  sameAll.fill(1);

  for (const ch of CHANNEL_KEYS) {
    const o = offs[ch];
    let same = 0;
    let maxD = 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(a[i * 4 + o] - b[i * 4 + o]);
      if (d === 0) same++;
      else sameAll[i] = 0;
      if (d > maxD) maxD = d;
      sum += d;
    }
    per.push({ ch, identical: same / n, maxDiff: maxD, meanDiff: sum / n });
  }
  for (let i = 0; i < n; i++) allSame += sameAll[i];

  return {
    perChannel: per,
    identicalAll: allSame / n,
    width: got.width,
    height: got.height,
    sizeMismatch: false
  };
}

/** 一个通道的分布：均值 + 占比最高的几档 */
export function planeStats(plane: Uint8ClampedArray, top = 6) {
  const hist = new Uint32Array(256);
  let sum = 0;
  for (let i = 0; i < plane.length; i++) {
    hist[plane[i]]++;
    sum += plane[i];
  }
  const total = plane.length || 1;
  const levels: { v: number; pct: number }[] = [];
  for (let v = 0; v < 256; v++) {
    if (hist[v]) levels.push({ v: v / 255, pct: hist[v] / total });
  }
  levels.sort((x, y) => y.pct - x.pct);
  return { mean: sum / total / 255, levels: levels.slice(0, top), levelCount: levels.length };
}

/* ------------------------------------------------------------------ 命名 */

/** `Pheony_Body_A` → `Pheony_Body`。用来拼导出名和分组 */
const SUFFIX_RE =
  /_(A|M|N|D|LM|RMA|LightMap|Lightmap|lightmap|Color|Color_A|ColorA|Diffuse|Albedo|BaseColor|ILM)$/i;

export function baseStem(name: string): string {
  const stem = name.replace(/\.[^.]+$/, '');
  const stripped = stem.replace(SUFFIX_RE, '');
  return stripped || stem;
}

/**
 * 一张图属于哪一类。配对检查靠这个分组。
 *
 * 字符类里**不能带下划线**：拿 `_([A-Za-z_]+)$` 去配 `Pheony_Body_A`，
 * 正则从左往右找，第一个 `_` 处就能一路吃到结尾，拿到 `Body_A` 而不是 `A`，
 * 于是所有角色判定全掉进 OTHER。只能用纯字母。
 */
const ROLE_RE = /_([A-Za-z]+)$/;

export type Role = 'A' | 'M' | 'N' | 'D' | 'LM' | 'OTHER';

export function roleOf(name: string): Role {
  const stem = name.replace(/\.[^.]+$/, '');
  const m = stem.match(ROLE_RE);
  if (!m) return 'OTHER';
  const t = m[1].toLowerCase();
  if (t === 'a') return 'A';
  if (t === 'm') return 'M';
  if (t === 'n') return 'N';
  if (t === 'd') return 'D';
  if (t === 'lm' || t === 'lightmap') return 'LM';
  return 'OTHER';
}

/** 从 `_A` 那张的路径推出导出路径旁边的 LM 名 */
export function lmOutName(aName: string, suffix: string): string {
  return `${baseStem(aName)}${suffix}.png`;
}

export const ROLE_LABEL: Record<Role, string> = {
  A: '_A',
  M: '_M',
  N: '_N',
  D: '_D',
  LM: '_LM',
  OTHER: '其它'
};

export { CHANNEL_KEYS };
export type { ChannelKey, ScaleMode };
