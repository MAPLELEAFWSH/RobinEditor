/**
 * 批量提取流水线 —— 把 Blender 那套「三张图一起提」的动作做成一次跑完。
 *
 * 拆成两步是刻意的：
 *
 * 1. `buildPlan()` 只看文件名，不读像素。三千个文件也就几毫秒，
 *    所以可以随便扫目录、随便改选项，界面立刻刷新。
 * 2. `inspect()` 才真去读图、量通道。这步慢，所以按行单独做、有进度条、
 *    结果写回行里 —— 用户能看到"哪几张没东西可提"之后再决定跑不跑。
 *
 * 为什么不合成一步：`_D` 14%、`_D1` 11%、`_D2` 12%（`channel-facts.ts` 实测），
 * 三个变体比例差不多，**光看文件名判断不出哪张带数据**。合成一步的话，
 * 用户按了运行只得到一堆全白图，还得自己一张张翻哪儿出错了。
 */

import type { FileRef } from './io';
import { baseName, dirName, readRgba, saveImage, stemOf } from './io';
import { siblingPath } from './outpath';
import { type ChannelKey, CHANNEL_LABEL, imageDataToUrl, previewOf } from './img';
import {
  type AlphaVerdict,
  analyzeAlpha,
  analyzeChannel,
  richestChannel,
  glossFromAlpha,
  mapFromChannel
} from './texops';

/* ------------------------------------------------------------ 认角色 */

export type Role =
  | 'normal' // 法线
  | 'basecolor' // 基础色 / 漫反射
  | 'lightmap' // 光照图
  | 'otherdata' // _M / _OtherDataTex
  | 'otherdata2' // _A / _OtherDataTex2
  | 'sdf'
  | 'ramp'
  | 'matcap'
  | 'metal' // 单独一张金属度
  | 'glossmap' // 单独一张光泽
  | 'roughmap' // 单独一张粗糙
  | 'ao' // 遮蔽图
  | 'faceshadow' // 面部阴影
  | 'idmap' // 材质 ID 图
  | 'partcolor' // 只有部件名的基础色（颜 / 肌 / 髪）
  | 'auxmap' // 辅助图：遮罩 / 细节 / 反射 / 视差 / 描边 / LUT
  | 'mmefx' // ray-mmd / MME 的控制器贴图，不是模型贴图
  | 'unknown';

export const ROLE_LABEL: Record<Role, string> = {
  normal: '法线',
  basecolor: '基础色',
  lightmap: '光照图',
  otherdata: '附属数据 _M',
  otherdata2: '附属数据 _A',
  sdf: 'SDF',
  ramp: 'Ramp',
  matcap: 'MatCap',
  metal: '金属度',
  glossmap: '光泽度',
  roughmap: '粗糙度',
  ao: '遮蔽图',
  faceshadow: '面部阴影',
  idmap: '材质 ID',
  partcolor: '部件名基础色',
  auxmap: '辅助图',
  mmefx: '特效控制器图',
  unknown: '认不出'
};

/**
 * 按名字认。顺序有讲究 —— 越具体的排前面。
 *
 * `metal` / `gloss` / `normal` 这类是**关键词**（哪个位置都可能出现），
 * 其余是**后缀**（锚在词尾），因为 `T_Body_N` 里的 `N` 是后缀，
 * 而 `TE_Normal_D` 那个 `Normal` 在中段、属于另一个东西的名字。
 *
 * 这几条不是拍出来的。`tools/probe_roles.py` 在三个真库 13,977 张图上跑过：
 * 只按 `_N` `_D` `_M` 那套后缀认，**71% 认不出**。认不出的分三堆 ——
 * 一堆是 ray-mmd 自带的控制器贴图（`DiffuseMul*` `CTR.bmp` `mc1.png`，20%），
 * 本来就该排除；一堆是别家作者没用那套后缀（`_Normalmap` `_bump` `_ao`
 * `_Color_L` `FaceShadow2`）；剩下的是 `hair.bmp` `颜.png` 这种只有部件名的，
 * 光看名字真判断不出，留给用户拿「认不出的不动」那个开关决定。
 */
const RULES: { re: RegExp; role: Role }[] = [
  // 特效控制器 —— 排最前，因为它们的名字里常带别的关键词（black / toon / mc）
  {
    re: /diffusemul|diffuseadd|diffusehue|diffuseallmask|diffusematerialmask|diffuseshadowmask|addsphere/i,
    role: 'mmefx'
  },
  { re: /(^|[^a-z])(ctr|defo|black|white|blank)([^a-z]|$)/i, role: 'mmefx' },
  { re: /(^|[^a-z])(mc|toon)\d*([^a-z]|$)/i, role: 'mmefx' },

  /**
   * 辅助图。**必须排在基础色前面** —— 基础色那条允许挂后缀，
   * `_Body_Mask`、`_Tex_Detailmap` 会被 `_D` 顺手吃掉认成基础色。
   *
   * 这批不是"认不出"，是**认得出但用不上**：遮罩、细节图、反射图、视差图、
   * 描边图、LUT 各有各的用途，但都不是"哪一路装了数据要提出来"。
   * 单独一类，界面上说清为什么不动。
   *
   * 名单照 `实战测试用例` 那批真文件列的（1122 张里 20 多张）。
   */
  {
    re: /(^|[_\-])(mask|detail|detail ?map|reflect ?map|parallax ?map|expression ?map|outline ?map|material ?map|dirt|dirt ?map|lut|curvaturelut|shadowlut)([_\-]?\d+)?$/i,
    role: 'auxmap'
  },

  { re: /metal/i, role: 'metal' },
  { re: /gloss|smoothness/i, role: 'glossmap' },
  { re: /roughness|(^|[^a-z])rough([^a-z]|$)/i, role: 'roughmap' },
  { re: /matcap/i, role: 'matcap' },
  { re: /faceshadow|face_shadow|face\d*_shadow/i, role: 'faceshadow' },
  { re: /(^|[^a-z])ao([^a-z]|$)/i, role: 'ao' },
  { re: /sdf$/i, role: 'sdf' },
  { re: /(_ramp|ramp)([_\-]?\d+)?$/i, role: 'ramp' },
  // `_LightMapR` 这种尾巴不跟分隔符的也得认；`+` 是手改过的记号
  { re: /(_lm|lightmap)[\-_]?[a-z0-9+]{0,3}$/i, role: 'lightmap' },
  { re: /mat_?id\d*/i, role: 'idmap' },

  // 法线：`_N` `_Normal` `_Normalmap` `_Body_Normalmap` `_normal-ogl` `_bump`
  // `NM-Fabric01` 这种是 Substance / PBR 素材包的写法
  { re: /^nm?[-_][a-z]/i, role: 'normal' },
  { re: /(^|[^a-z])normal ?map([^a-z]|$)/i, role: 'normal' },
  { re: /normal[-_](ogl|dx|gl)/i, role: 'normal' },
  { re: /(^|[^a-z])bump([^a-z]|$)/i, role: 'normal' },
  { re: /_(n|nm|nrm|normal)$/i, role: 'normal' },

  // 基础色：`_D` `_Diffuse` `_Diffuse_RGBAA` `_Color` `_Color_A_L` `FaceMap`
  // 后缀允许**两段**：实测那批里有 `_Diffuse_Alpha`、`_Diffuse_RGBCR`、
  // `_Color_A_LB`。只给一段的话 `_Color_A_L` 会落空。
  // 更长的（`Detailmap` 之类）已经在辅助图那条被拦下了。
  { re: /facemap/i, role: 'basecolor' },
  { re: /^(albedo|basecolor|diffuse|color|col)$/i, role: 'basecolor' },
  {
    re: /_(d|diff|diffuse|alb|albedo|bc|basecolor|color|col|base)(([_\-]?[a-z0-9]{1,4}){0,2})$/i,
    role: 'basecolor'
  },
  // 光秃秃一个部件名（颜 / 肌 / 髪 / 衣服 / weapon）。国产和日系模型作者的习惯，
  // 这种名字下就是漫反射本体；真库里这种写法有 1800 张上下
  {
    re: /^(颜|臉|脸|肌|肤|膚|体|體|身|髪|发|髮|头发|衣服|衣|服|裙|袜|絲|丝|武器|刀|剑|表情|眼|瞳|眉|口|牙|黑|白)$/,
    role: 'partcolor'
  },
  {
    re: /^(hair|skin|face|body|cloth|clothes|clothing|dress|skirt|sock|socks|stocking|stockings|eye|eyes|brow|brows|mouth|tooth|teeth|nail|nails|weapon|sword|wing|wings|tail|ear|ears|horn|horns|shoe|shoes|boot|boots|glove|gloves|hat|cap)([_\-]?\d{0,2})?$/i,
    role: 'partcolor'
  },
  // 带前缀也一样：`Avatar_BlackSwan_00_Body_Stockings`。放在基础色后面，
  // 所以 `X_Body_D.png` 那种仍然先被基础色接住
  {
    re: /_(hair|skin|face|body|cloth|clothes|clothing|dress|skirt|sock|socks|stocking|stockings|eye|eyes|brow|brows|mouth|tooth|teeth|nail|weapon|sword|wing|wings|tail|ear|ears|horn|horns|shoe|shoes|boot|boots|glove|gloves|hat|cap)([_\-]?\d{0,2})$/i,
    role: 'partcolor'
  },

  { re: /_(m|od|otherdata)$/i, role: 'otherdata' },
  { re: /_(a|od2|otherdata2|extra)$/i, role: 'otherdata2' }
];

/**
 * 认角色。**不特意排除"本工具上次的产出"** —— 这件事看着该做，其实不用。
 *
 * 产出叫 `T_Body_N_Gloss.png`，重扫时被 `gloss` 关键词接住，落到「已就位」那一类、
 * 不再动它；`_Roughness` / `_Metal` / `_MatID3` 一样。也就是说产出在后缀上
 * 天然跟自己不是一类，绕回来也不会自我循环。
 *
 * 反过来硬要认「这是我写的」会误伤：`T_Body_Metal.png` 既是游戏里单独的金属度图，
 * 也会是 `T_Body_M.png` 提完的名字，光看名字分不开。文件名里没有权威依据时，
 * 宁可让它落到「已就位」，也不要拍一个可能错的判断。
 */
export function classify(name: string): Role {
  const stem = stemOf(name);
  for (const r of RULES) if (r.re.test(stem)) return r.role;
  return 'unknown';
}

/* ------------------------------------------------------------ 计划 */

export type JobKind =
  /** 从透明通道提灰度（法线 / 基础色那两条） */
  | 'alpha'
  /** 从指定的一路提灰度（`_M` → 金属度） */
  | 'chan'
  /** 本来就是目标图，认出即可，不动它 */
  | 'asis';

export type RowState = 'wait' | 'ok' | 'skip' | 'err' | 'done';

export type PlanRow = {
  key: string;
  ref: FileRef;
  role: Role;
  /** null = 这一行不产出东西 */
  job: JobKind | null;
  /** 提取后要反相吗 */
  invert: boolean;
  /** job === 'chan' 时用哪一路 */
  channel: ChannelKey;
  /** 输出路径 */
  out: string;
  /** 输出文件名 */
  outName: string;
  /** 为什么这么排 */
  why: string;
  state: RowState;
  detail: string;
  /** 量到的透明通道情况，`inspect` 之后才有 */
  verdict: AlphaVerdict | null;
  /** 勾没勾上 */
  on: boolean;
  /** 预览用的 objectURL，跑完或离开页面要吊销 */
  url: string | null;
};

export type PlanOpts = {
  /** alpha 里装的是光泽还是粗糙 —— 一个开关同时管法线和基础色 */
  alphaIsGloss: boolean;
  /** `_M` 里金属度在哪一路 */
  metalChannel: ChannelKey;
  /** 认不出的一律不提 */
  skipUnknown: boolean;
};

export const DEFAULT_OPTS: PlanOpts = {
  alphaIsGloss: true,
  metalChannel: 'b',
  skipUnknown: true
};

/**
 * 跟源图同目录同名、只加后缀。
 *
 * 拼法搬到了 `outpath.ts` 的 `siblingPath`（全工程一份，那个坑的注释也一起搬过去了）。
 * 不能拼 `dirName()` + `joinPath()`：那两步分开判，`joinPath` 靠"目录串里有没有反斜杠"
 * 选分隔符，传进来一个单段相对目录（`M`）就会给出 `M/xxx`。
 */
const sibling = (path: string, suffix: string, ext = 'png') => siblingPath(path, suffix, ext);

/**
 * 组计划。不看像素，所以可以随便重算。
 *
 * 有条跨行的判断：**同一个目录里已经有 `Metal*` 的话，那张 `_M` 就不用再提金属度了** ——
 * 人家本来就单独给了一张。这是批量跟单张最大的区别，单张看不出这事。
 */
export function buildPlan(refs: FileRef[], opts: PlanOpts): PlanRow[] {
  const rows: PlanRow[] = refs.map((ref, i) => {
    const role = classify(ref.name);
    const r: PlanRow = {
      key: `${i}:${ref.path}`,
      ref,
      role,
      job: null,
      invert: false,
      channel: opts.metalChannel,
      out: '',
      outName: '',
      why: '',
      state: 'wait',
      detail: '',
      verdict: null,
      on: false,
      url: null
    };

    const inv = !opts.alphaIsGloss;
    switch (role) {
      case 'normal':
        r.job = 'alpha';
        r.invert = inv;
        r.why = '法线图的 alpha —— 实测 55% 藏着光泽/平滑度，全库最强的一条';
        break;
      case 'basecolor':
        r.job = 'alpha';
        r.invert = inv;
        r.why = '基础色的 alpha —— 实测只有 14% 有东西，所以先量再提';
        break;
      case 'partcolor':
        r.job = 'alpha';
        r.invert = inv;
        // 这条是按作者习惯推的，如实写出来，别让它看着像量过的结论
        r.why = '名字只说得出部件（颜 / 肌 / 髪），按基础色试 —— 没东西会自动撤掉';
        break;
      case 'otherdata':
        r.job = 'chan';
        r.why = `附属数据 _M 的 ${CHANNEL_LABEL[opts.metalChannel]} 路 —— Unity 槽名 _OtherDataTex`;
        break;
      case 'metal':
        r.job = 'asis';
        r.why = '本来就是单独的金属度图，不用提';
        break;
      case 'glossmap':
      case 'roughmap':
        r.job = 'asis';
        r.why = '已经是光泽/粗糙图了';
        break;
      case 'ao':
        r.job = 'asis';
        r.why = '遮蔽图（AO），本来就是一张独立灰度图';
        break;
      case 'auxmap':
        r.job = null;
        r.why = '辅助图（遮罩 / 细节 / 反射 / 视差 / 描边 / LUT）—— 不是"哪一路装了数据"的那种，这批不提';
        break;
      case 'faceshadow':
        r.job = 'asis';
        r.why = '面部阴影图 —— 想转成距离场去「SDF 贴图」那块';
        break;
      case 'mmefx':
        r.why = 'ray-mmd / MME 的控制器贴图，不是模型贴图，不动';
        break;
      case 'idmap':
        r.why = '材质 ID 图，去「材质 ID」那块拆遮罩';
        break;
      case 'unknown':
        r.why = opts.skipUnknown ? '认不出是哪一路，不动它' : '认不出，按基础色处理';
        if (!opts.skipUnknown) {
          r.role = 'basecolor';
          r.job = 'alpha';
          r.invert = inv;
        }
        break;
      default:
        r.why = `${ROLE_LABEL[role]}，这批不处理`;
        break;
    }

    if (r.job === 'alpha') {
      const sfx = r.invert ? '_Roughness' : '_Gloss';
      r.out = sibling(ref.path, sfx);
      r.outName = baseName(r.out);
    } else if (r.job === 'chan') {
      r.out = sibling(ref.path, '_Metal');
      r.outName = baseName(r.out);
    }
    r.on = r.job === 'alpha' || r.job === 'chan';
    return r;
  });

  // 跨行判断：同目录有单独的金属度图就不从 _M 里提
  const dirsWithMetal = new Set(
    rows.filter((r) => r.role === 'metal').map((r) => dirName(r.ref.path))
  );
  if (dirsWithMetal.size) {
    for (const r of rows) {
      if (r.role === 'otherdata' && dirsWithMetal.has(dirName(r.ref.path))) {
        r.job = null;
        r.on = false;
        r.why = '同目录已经有单独的金属度图了，不用从 _M 里提';
      }
    }
  }

  return rows;
}

/** 组完之后的分堆统计，界面顶部那排数字 */
export function summarize(rows: PlanRow[]) {
  const bucket = (f: (r: PlanRow) => boolean) => rows.filter(f).length;
  return {
    total: rows.length,
    todo: bucket((r) => r.job === 'alpha' || r.job === 'chan'),
    asis: bucket((r) => r.job === 'asis'),
    idle: bucket((r) => !r.job),
    unknown: bucket((r) => r.role === 'unknown')
  };
}

/* ------------------------------------------------------------ 有界并发 */

/**
 * 有界并发。
 *
 * 为什么不用 `Promise.all(map(load))`：一次目录几千张图，
 * 每张要 invoke 一次 Rust 解码再把 ImageData 拿回来，全放出去会把
 * IPC 和内存一起打满 —— 界面上表现为进度条卡死、内存飙到几个 G。
 * 卡在 4 条：解码本来就在 Rust 侧排队，开太多只是互相抢。
 */
export async function runPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
  onStep?: (done: number, total: number) => void
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
        done++;
        onStep?.(done, items.length);
      }
    })
  );
  return out;
}

/* ------------------------------------------------------------ 读图 → ImageData */

/**
 * 读一张图并转成 ImageData。流水线里要按像素算，不用留着 ImageBitmap。
 *
 * 走 `readRgba`（原始字节）而不是 `loadImage` + 画布：画布是预乘 alpha 存的，
 * 反预乘会把半透明像素的 RGB 弄脏、把全透明的 RGB 抹成 0。
 * 实测见 `io.ts` 里 `readRgba` 的注释。
 */
export async function readPixels(path: string): Promise<ImageData> {
  return (await readRgba(path)).data;
}

/* ------------------------------------------------------------ 量一量 */

/**
 * 判一行的源图，看这一路到底有没有东西可提。**纯逻辑，不读文件。**
 *
 * 判完可能把 `job` 撤了 —— 这是核心行为，不是异常分支。
 * 返回 true 表示这一行确实有得提。
 */
export function judgeRow(row: PlanRow, img: ImageData): boolean {
  if (row.job === 'alpha') {
    const v = analyzeAlpha(img);
    row.verdict = v;
    if (v.rich) {
      row.state = 'ok';
      row.detail = v.verdict;
      return true;
    }
    row.state = 'skip';
    row.job = null;
    row.on = false;
    // 提出来是全白，指一条别的路给用户
    const alt = richestChannel(img);
    row.detail =
      v.verdict +
      (alt.stats.rich && alt.ch !== 'a'
        ? ` 不过 ${CHANNEL_LABEL[alt.ch]} 路有东西，想要的话用「通道提取」那块单独提。`
        : '');
    return false;
  }

  if (row.job === 'chan') {
    const v = analyzeChannel(img, row.channel);
    row.verdict = v;
    if (v.rich) {
      row.state = 'ok';
      row.detail = v.verdict;
      return true;
    }
    const alt = richestChannel(img);
    if (alt.stats.rich && alt.ch !== row.channel) {
      // 不替用户改通道，只把答案摆在旁边
      row.state = 'ok';
      row.detail = `${v.verdict} 有东西的是 ${CHANNEL_LABEL[alt.ch]} 路。`;
      return true;
    }
    row.state = 'skip';
    row.job = null;
    row.on = false;
    row.detail = `${v.verdict} 四路都没什么可提的。`;
    return false;
  }

  // 没有 job 或者 asis 的，不该走到读像素这一步
  row.state = 'skip';
  row.detail = row.why;
  return false;
}

/**
 * 把一行的源图读进来量一遍。
 *
 * 量完可能把 `job` 撤了 —— 这是这个工具的核心行为，不是异常分支。
 * 返回 false 表示这一行没得做。
 */
export async function inspect(row: PlanRow): Promise<boolean> {
  if (!row.job) {
    row.state = 'skip';
    row.detail = row.why;
    return false;
  }
  if (row.job === 'asis') {
    row.state = 'ok';
    row.detail = row.why;
    return false;
  }
  try {
    return judgeRow(row, await readPixels(row.ref.path));
  } catch (e) {
    row.state = 'err';
    row.detail = `读不了：${(e as Error).message}`;
    return false;
  }
}

/* ------------------------------------------------------------ 跑 */

/** 一行要提出来的是什么。纯计算，不碰磁盘 */
export function extractRow(row: PlanRow, img: ImageData): ImageData | null {
  if (row.job === 'alpha') return glossFromAlpha(img, row.invert);
  if (row.job === 'chan') return mapFromChannel(img, row.channel, row.invert);
  return null;
}

/**
 * 真跑一行：读图 → 算 → 写。
 *
 * 每行的输出都跟源图同目录同名加后缀。写到已存在的文件时 Rust 侧会先备份
 * （`.bak`），跟其它面板一个行为。
 */
export async function runRow(row: PlanRow): Promise<PlanRow> {
  if (!row.job) return row;
  try {
    const out = extractRow(row, await readPixels(row.ref.path));
    if (!out) return row;
    await saveImage(row.out, out);
    row.state = 'done';
    row.detail = `写了 ${row.outName}（${out.width}×${out.height}）`;
    return row;
  } catch (e) {
    row.state = 'err';
    row.detail = `写失败：${(e as Error).message}`;
    return row;
  }
}

/**
 * 「量一遍」那一步真正调的东西：读一次图，判完，顺手出预览。
 *
 * 为什么合成一个函数：分开写的话一张图要被读两遍（判一次、出预览一次），
 * 而且界面上很容易顺手写成 `inspect(r)` 后面挂个不 await 的 `previewRow(r)` ——
 * 那就等于绕过了有界并发，几千张图一起放出去读，正是 `runPool` 要防的那件事。
 * 一次读进来两件事都用，慢的那步就在池子里。
 */
export async function measureRow(row: PlanRow, side = 256): Promise<boolean> {
  if (!row.job) {
    row.state = 'skip';
    row.detail = row.why;
    return false;
  }
  if (row.job === 'asis') {
    row.state = 'ok';
    row.detail = row.why;
    return false;
  }
  try {
    const img = await readPixels(row.ref.path);
    const ok = judgeRow(row, img);
    try {
      const out = extractRow(row, previewOf(img, side));
      if (out) {
        if (row.url) URL.revokeObjectURL(row.url);
        row.url = imageDataToUrl(out);
      }
    } catch {
      // 预览失败不影响判定，安静跳过
    }
    return ok;
  } catch (e) {
    row.state = 'err';
    row.detail = `读不了：${(e as Error).message}`;
    return false;
  }
}

export function releaseRowUrls(rows: PlanRow[]): void {
  for (const r of rows) {
    if (r.url) {
      URL.revokeObjectURL(r.url);
      r.url = null;
    }
  }
}
