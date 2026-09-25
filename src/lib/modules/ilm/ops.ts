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

/* ------------------------------------------------------------------ ladder 库 */

/** 原神：`test/生成/预设库.json` 里「身体」「头发」两套实测配比 */
const GENSHIN_LADDERS: Record<string, Record<ChannelKey, { default: number; ladder: Ladder }>> = {
  身体: {
    r: { default: 0.0, ladder: [[1.0, 0.0887], [0.6, 0.0137], [0.35, 0.0135], [0.3, 0.0143], [0.1, 0.1207], [0.05, 0.1783]] },
    g: { default: 0.5, ladder: [[0.45, 0.0118], [0.05, 0.0105], [0.0, 0.4031]] },
    b: { default: 0.0, ladder: [[1.0, 0.057], [0.3, 0.0335], [0.25, 0.0128], [0.2, 0.0218], [0.15, 0.0186], [0.1, 0.1295], [0.05, 0.1827]] },
    a: { default: 0.0, ladder: [[1.0, 0.1969], [0.7, 0.0448], [0.5, 0.0823], [0.3, 0.1908]] }
  },
  头发: {
    r: { default: 0.0, ladder: [[1.0, 0.1463], [0.8, 0.0131], [0.5, 0.027], [0.05, 0.0123]] },
    g: { default: 0.5, ladder: [[0.45, 0.0182], [0.05, 0.0169], [0.0, 0.3887]] },
    b: { default: 0.0, ladder: [[0.9, 0.0232], [0.7, 0.0104], [0.3, 0.1071], [0.25, 0.0319], [0.15, 0.016], [0.1, 0.0969], [0.05, 0.0187]] },
    a: { default: 0.7, ladder: [[1.0, 0.0504], [0.5, 0.0638], [0.3, 0.1632], [0.0, 0.2498]] }
  }
};

/** 星铁：`贴图样本/honkaiSR/_验证/星铁预设.json` 里那四套 */
const HSR_LADDERS: Record<string, Record<ChannelKey, { default: number; ladder: Ladder }>> = {
  星铁_身体: {
    r: { default: 1.0, ladder: [[0.85, 0.07795111338297527], [0.0, 0.12566868464152017]] },
    g: { default: 0.4, ladder: [[0.0, 0.20508599281311035]] },
    b: { default: 0.0, ladder: [[0.65, 0.048416535059611]] },
    a: { default: 0.0, ladder: [[0.55, 0.17786033948262533], [0.45, 0.20738021532694498]] }
  },
  星铁_头发: {
    r: { default: 1.0, ladder: [[0.85, 0.12457760175069173]] },
    g: { default: 0.4, ladder: [[0.0, 0.13458124796549478]] },
    b: { default: 0.0, ladder: [[0.65, 0.048618157704671226], [0.45, 0.02668178081512451]] },
    a: {
      default: 0.0,
      ladder: [
        [0.95, 0.09484219551086426],
        [0.55, 0.22196869055430093],
        [0.45, 0.23049346605936685],
        [0.3, 0.0413057009379069],
        [0.2, 0.023741404215494793]
      ]
    }
  },
  星铁_披风: {
    r: { default: 1.0, ladder: [[0.85, 0.0675506591796875], [0.0, 0.13114519913991293]] },
    g: { default: 0.4, ladder: [[0.0, 0.19736305872599283]] },
    b: { default: 0.0, ladder: [[0.65, 0.04689621925354004]] },
    a: {
      default: 0.0,
      ladder: [
        [0.95, 0.09484219551086426],
        [0.55, 0.1441588799158732],
        [0.45, 0.09245737393697102],
        [0.3, 0.024450222651163738]
      ]
    }
  },
  星铁_武器: {
    r: { default: 1.0, ladder: [[0.85, 0.10648822784423828], [0.0, 0.134422500928243]] },
    g: { default: 0.4, ladder: [[0.0, 0.23957435290018717]] },
    b: { default: 0.0, ladder: [[0.45, 0.025628527005513508]] },
    a: {
      default: 0.0,
      ladder: [
        [0.95, 0.09484219551086426],
        [0.55, 0.12191816171010335],
        [0.45, 0.16114934285481772],
        [0.3, 0.04114349683125814],
        [0.2, 0.023599783579508465]
      ]
    }
  }
};

export const LADDER_GROUPS: { id: string; name: string; table: typeof GENSHIN_LADDERS }[] = [
  { id: 'genshin', name: '原神', table: GENSHIN_LADDERS },
  { id: 'hsr', name: '星铁', table: HSR_LADDERS }
];

export function genshinLadder(name: string, ch: ChannelKey): Ladder {
  const e = GENSHIN_LADDERS[name]?.[ch];
  return e ? e.ladder.map(([v, s]) => [v, s] as [number, number]) : [];
}
export function genshinDefault(name: string, ch: ChannelKey): number {
  return GENSHIN_LADDERS[name]?.[ch]?.default ?? 0;
}
export function hsrLadder(name: string, ch: ChannelKey): Ladder {
  const e = HSR_LADDERS[name]?.[ch];
  return e ? e.ladder.map(([v, s]) => [v, s] as [number, number]) : [];
}
export function hsrDefault(name: string, ch: ChannelKey): number {
  return HSR_LADDERS[name]?.[ch]?.default ?? 0;
}


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
 * 原神：一张 256×20 的 ramp，A 是 5 档材质区（0/0.3/0.5/0.7/1.0），
 * G 收敛到 {0, 0.5}。规格见 `test/生成/预设库.json` 的「规格」。
 */
export const GENSHIN_MAP: LmMap = {
  r: ref({ kind: 'ladder', ladder: genshinLadder('身体', 'r'), ladderDefault: 0.0, drive: { slot: 'A', ch: 'luma' } }),
  g: ref({ kind: 'ladder', ladder: genshinLadder('身体', 'g'), ladderDefault: 0.5, drive: { slot: 'A', ch: 'luma' } }),
  b: ref({ kind: 'ladder', ladder: genshinLadder('身体', 'b'), ladderDefault: 0.0, drive: { slot: 'A', ch: 'luma' } }),
  a: ref({ kind: 'ladder', ladder: genshinLadder('身体', 'a'), ladderDefault: 0.0, drive: { slot: 'A', ch: 'luma' } })
};

/**
 * 星铁：冷暖两张 ramp，A 对应 16 行，G 中性 0.4 且连续，尺寸跟 diffuse。
 * 规格见 `贴图样本/honkaiSR/_分析/HSR规格探测.txt` 与 `_验证/星铁预设.json`。
 */
export const HSR_MAP: LmMap = {
  r: ref({ kind: 'ladder', ladder: hsrLadder('星铁_身体', 'r'), ladderDefault: 1.0, drive: { slot: 'A', ch: 'luma' } }),
  g: ref({ kind: 'ladder', ladder: hsrLadder('星铁_身体', 'g'), ladderDefault: 0.4, drive: { slot: 'A', ch: 'luma' } }),
  b: ref({ kind: 'ladder', ladder: hsrLadder('星铁_身体', 'b'), ladderDefault: 0.0, drive: { slot: 'A', ch: 'luma' } }),
  a: ref({ kind: 'ladder', ladder: hsrLadder('星铁_身体', 'a'), ladderDefault: 0.0, drive: { slot: 'A', ch: 'luma' } })
};

export const PRESETS: Preset[] = [
  {
    id: 'zzz',
    name: '绝区零',
    semantics: { r: '_A.G 高光/自发光', g: '_N.B（法线）', b: '_M.B 金属度', a: '常量 1' },
    grid: 0,
    suffix: '_LM',
    map: ZZZ_MAP,
    note: 'R、B 逐像素精确；G 取自半分辨率法线，lanczos 放大后平均误差 0.13~0.24 级'
  },
  {
    id: 'genshin',
    name: '原神',
    semantics: { r: '高光/反射', g: '阴影基调（中性 0.5，离散）', b: '金属度', a: 'Ramp 层（5 档）' },
    grid: 0.05,
    suffix: '_Lightmap',
    map: GENSHIN_MAP,
    note: '0.05 网格 21 档；A 收敛到 0/0.3/0.5/0.7/1.0'
  },
  {
    id: 'hsr',
    name: '星铁',
    semantics: { r: '高光/反射', g: '阴影基调（中性 0.4，连续）', b: '金属度', a: 'Ramp 层 / 材质区' },
    grid: 0.05,
    suffix: '_LightMap',
    map: HSR_MAP,
    note: '冷暖两张 ramp；A 对应 16 行'
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
