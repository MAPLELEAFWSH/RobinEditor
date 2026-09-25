/**
 * 通道用途的实测依据。
 *
 * 数据来源：`tools/probe_channels.py` 扫 `D:\MMD模型动作\模型` 三个库，
 * 43,440 张贴图，每类抽 300 张看**透明通道里到底有没有东西**。
 * 判据是"唯一值 ≥16 且最常见值占比 <98%" —— 也就是排除了二值遮罩和常量。
 *
 * 为什么要把这个存成数据而不写死在注释里：这三条是**特定工作流的约定**，
 * 不是三个游戏的通则。量出来的覆盖率差别很大，界面上要如实标出来 ——
 * 用户看到"55% 的法线图 alpha 里有东西"和看到"法线图 alpha 里就是粗糙度"
 * 是两回事，前者能让他自己判断这张要不要提，后者会让他白忙。
 */

export type Fact = {
  /** 看哪类文件 */
  pattern: string;
  /** 有多少张 */
  total: number;
  /** 透明通道恒定（没藏东西）的比例 */
  constantPct: number;
  /** 透明通道里"像真的藏了图"的比例 */
  richPct: number;
  /** 一句话结论 */
  verdict: string;
};

export const ALPHA_FACTS: Fact[] = [
  {
    pattern: '法线 _N',
    total: 300,
    constantPct: 44,
    richPct: 55,
    verdict: '**55% 的法线图在 alpha 里藏了一张图**，是全库里最强的一条。要提出来当粗糙度/光泽用，通常还要反相一下。'
  },
  {
    pattern: '光照图 _LM / Lightmap',
    total: 300,
    constantPct: 15,
    richPct: 68,
    verdict: '68% 有数据。星铁那套规格里 A 是「Ramp 层 / 材质区」，量下来对得上 —— 这是**分层信息**，不是亮度。'
  },
  {
    pattern: 'SDF',
    total: 20,
    constantPct: 40,
    richPct: 55,
    verdict: '一半以上 alpha 里有距离场。原神式排法就是「R 放区域遮罩、A 放带符号距离」。'
  },
  {
    pattern: '基础色 _D',
    total: 300,
    constantPct: 81,
    richPct: 14,
    verdict: '只有 14% 的 alpha 里有东西。所谓「粗糙度在 D 的 alpha 里」是**部分模型的习惯，不是通则**。'
  },
  {
    pattern: '_D1',
    total: 18,
    constantPct: 78,
    richPct: 11,
    verdict: '11%。跟 _D 的 14% 基本一样 —— **「数据只在 D、不在 D1」这条在本库里不成立**，三个变体的比例差不多。'
  },
  {
    pattern: '_D2',
    total: 40,
    constantPct: 82,
    richPct: 12,
    verdict: '12%。同上。判断哪一张带数据只能一张张看，不能靠文件名。'
  },
  {
    pattern: '_M 附属数据',
    total: 300,
    constantPct: 84,
    richPct: 7,
    verdict: 'alpha 基本不用。这个槽的信息在 RGB 里（Unity JSON 里叫 _OtherDataTex）。'
  },
  {
    pattern: '_A 附属数据',
    total: 300,
    constantPct: 81,
    richPct: 4,
    verdict: 'alpha 基本不用（JSON 里叫 _OtherDataTex2）。'
  },
  {
    pattern: 'Ramp 贴图',
    total: 300,
    constantPct: 100,
    richPct: 0,
    verdict: '**alpha 一律是常量**。ramp 只占 RGB，做 ramp 时不用考虑透明通道。'
  }
];

/**
 * 金属度到底在哪。
 *
 * 用户说的是「金属度在 FTM 的 G 通道里」。三个库 43,440 张贴图里
 * **一个 FTM 都没有**。同一个库里按名字找得到的是这些：
 */
export const METAL_NAME_HITS = [
  { key: 'Metal', n: 1060 },
  { key: 'Gloss', n: 345 },
  { key: 'metal', n: 273 },
  { key: 'Rough', n: 242 },
  { key: 'AO', n: 174 },
  { key: 'rough', n: 169 },
  { key: 'Smooth', n: 104 },
  { key: 'Specular', n: 68 },
  { key: 'Occlusion', n: 24 },
  { key: 'Detail', n: 23 }
];

export const METAL_VERDICT =
  '本库里没有 FTM 文件，所以「金属度在 FTM 的 G 通道」这条在这里无从验证 —— ' +
  '它应该是你手上那个工作流里的命名。这三个库里金属度要么是**单独一张带 Metal 的图**（1060 张），' +
  '要么在绝区零那套的 `_M`（Unity 槽名 `_OtherDataTex`）的某个通道里。' +
  '工具不该硬编码 FTM，该做的是：认文件名关键词 + 认 Unity 槽名，两条都对不上就让用户自己指。';
