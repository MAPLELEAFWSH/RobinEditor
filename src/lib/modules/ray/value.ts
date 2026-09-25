/**
 * 参数值的类型判断、颜色解析、贴图路径处理。
 *
 * 为什么单独一个文件：`ops.ts` 只管「解析文件」和「把改动拼回去」，
 * 这里管「这个值是什么东西、界面上该给什么控件」。两件事的改动理由不一样，
 * 混在一起以后会互相牵制。
 *
 * 判断顺序是有讲究的，见 classify() 的注释。
 */

import type { Doc, Opt } from './docs';
import type { Entry } from './ops';

export type ValueKind =
  /** 0/1 开关 */
  | 'switch'
  /** 有明确枚举表，给下拉 */
  | 'enum'
  /** 数值，有范围就给滑杆 */
  | 'number'
  /** 颜色，给取色器 + RGB 数值 */
  | 'color'
  /** 贴图路径，给"选贴图"按钮 */
  | 'texture'
  /** 是表达式或代码，只读 */
  | 'expr'
  /** 普通文本 */
  | 'text';

export type Field = {
  kind: ValueKind;
  options?: Opt[];
  min?: number;
  max?: number;
  /** 颜色有几个分量：3 是 RGB，4 是 RGBA */
  colorArity?: 3 | 4;
  /** true 表示值是整数 */
  int?: boolean;
  /** 只读的原因，显示在界面上 */
  why?: string;
};

/* ------------------------------------------------------------ 数值 */

const NUM = /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/;

export function isNumeric(s: string): boolean {
  return NUM.test(s.trim());
}

/** 把一个数值文本原样换个值，尽量保持原来的写法（有没有小数点） */
export function likeNumber(sample: string, v: number): string {
  const t = sample.trim();
  if (t.includes('.') || /[eE]/.test(t)) {
    // 保留原来的小数位数，至少一位
    const dot = t.indexOf('.');
    const dec = dot < 0 ? 3 : Math.min(6, t.length - dot - 1);
    return v.toFixed(Math.max(1, dec));
  }
  return String(Math.round(v));
}

/* ------------------------------------------------------------ 颜色 */

export type Rgba = {
  r: number;
  g: number;
  b: number;
  a: number;
  hasAlpha: boolean;
  braced: boolean;
  /** 源写法里有几个分量。1 是标量（`= 1.5`），3 是 RGB，4 是 RGBA */
  arity: 1 | 3 | 4;
  /** 如果原文是用构造函数写的，记下是 float3 还是 float4，写回时照原样 */
  ctor: 'float3' | 'float4' | null;
};

/**
 * 解析颜色。真文件里出现过这几种写法：
 *   const float3 albedo = 1.5;                    → 标量，三个分量一样
 *   const float3 specular = { 0.5, 0.5, 0.5 };    → 花括号
 *   const float4 backColor = 1.0, 1.0, 1.0, 1.0;  → 逗号平铺
 *   const float3 contrast = float3(1.0, 1.0, 1.0); → HLSL 构造函数写法
 * 分量可能带 f 后缀（1.0f），也可能带负号。
 *
 * 构造函数那种是 ColorGrading 那一族用的（`colorContrastAll = float3(1,1,1)`），
 * 一开始没认，结果整个调色插件的二十多个参数都被判成了"表达式只读"。
 */
export function parseColor(value: string): Rgba | null {
  let t = value.trim();
  if (!t) return null;

  let ctor: 'float3' | 'float4' | null = null;
  const ctorMatch = t.match(/^float([34])\s*\(([\s\S]*)\)$/i);
  if (ctorMatch) {
    ctor = ctorMatch[1] === '4' ? 'float4' : 'float3';
    t = ctorMatch[2];
  }

  const braced = !ctor && t.startsWith('{') && t.endsWith('}');
  if (braced) t = t.slice(1, -1);

  const parts = t
    .split(',')
    .map((p) => p.trim().replace(/f$/i, ''))
    .filter((p) => p.length > 0);
  if (!parts.length || parts.length > 4) return null;
  if (!parts.every(isNumeric)) return null;
  const nums = parts.map(Number);
  if (!nums.every(Number.isFinite)) return null;

  if (nums.length === 1) {
    return { r: nums[0], g: nums[0], b: nums[0], a: 1, hasAlpha: false, braced, arity: 1, ctor };
  }
  if (nums.length === 3) {
    return { r: nums[0], g: nums[1], b: nums[2], a: 1, hasAlpha: false, braced, arity: 3, ctor };
  }
  return { r: nums[0], g: nums[1], b: nums[2], a: nums[3], hasAlpha: true, braced, arity: 4, ctor };
}

/** 数一个分量文本有几位小数。`1.0` → 1，`0.125` → 3，`1` → 0 */
function decimalsOf(s: string): number {
  const t = s.replace(/f$/i, '').trim();
  const dot = t.indexOf('.');
  return dot < 0 ? 0 : t.length - dot - 1;
}

/** 0~1 钳到 0~255 的整数，给 <input type="color"> 用 */
export function toHex(c: Rgba): string {
  const b = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  const h = (v: number) => b(v).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** 从 native picker 拿到的 #rrggbb 换回 0~1 */
export function fromHex(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace('#', '');
  return {
    r: parseInt(m.slice(0, 2), 16) / 255,
    g: parseInt(m.slice(2, 4), 16) / 255,
    b: parseInt(m.slice(4, 6), 16) / 255
  };
}

/**
 * 按原来的写法把颜色拼回去。
 *
 * 三条规矩，都是踩出来的：
 *
 *  1. **括号形式跟着 sample 走**。HLSL 里花括号和逗号平铺在有些上下文不等价，
 *     而且平白多一处 diff。
 *  2. **小数位数按分量各算，取"源位数"和"够用位数"的较大值**。
 *     一开始是拿第一个分量的小数位数套给全部 —— `{ 0.5, 0.25, 0.125 }` 里
 *     第一个是 1 位，于是 0.25 被写成 0.3、0.125 被写成 0.1，静默丢精度。
 *  3. **标量写法不许自己膨胀成三个分量**。源里写 `= 1.5` 的，改完之后
 *     还是 `= 1.5`；只有三个分量确实不一样了才展开成 RGB。
 */
export function formatColor(c: Rgba, sample: string, minArity?: 3 | 4): string {
  const src = sample.trim();
  const braced = src.startsWith('{');
  const inner = braced ? src.slice(1, -1) : src;
  const srcParts = inner
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const srcDec = srcParts.map(decimalsOf);

  /** 某个分量该写几位小数 */
  const pick = (i: number, v: number): number => {
    const keep = srcDec[i] ?? srcDec[srcDec.length - 1] ?? 0;
    // 整数不需要额外小数位；非整数至少留 3 位，够表示 1/255 这种
    const enough = Number.isInteger(v) ? 0 : 3;
    return Math.max(keep, enough);
  };

  const fmt = (i: number, v: number): string => {
    const keep = srcDec[i] ?? srcDec[srcDec.length - 1] ?? 0;
    let s = v.toFixed(pick(i, v));
    if (s.includes('.')) {
      // 去掉多余的尾零，但最少留 keep 位
      while (s.endsWith('0') && decimalsOf(s) > keep) s = s.slice(0, -1);
      if (s.endsWith('.')) s = keep > 0 ? s + '0' : s.slice(0, -1);
    }
    return s;
  };

  const want: 1 | 3 | 4 =
    minArity && minArity > c.arity ? minArity : c.arity;
  const four = want === 4 || (want !== 1 && c.hasAlpha);
  // 标量写法只在"声明宽度也是 1、三个分量还相等"时保留。
  // 声明是 float4 的（BackColor = 0.0 那种）要写成四个分量，
  // 只写三个的话 HLSL 里第四个分量会变成 0，alpha 凭空没了。
  const scalar = want === 1 && c.r === c.g && c.b === c.r && !c.hasAlpha;
  const body = scalar
    ? fmt(0, c.r)
    : four
      ? [c.r, c.g, c.b, c.a].map((v, i) => fmt(i, v)).join(', ')
      : [c.r, c.g, c.b].map((v, i) => fmt(i, v)).join(', ');

  // 写法优先级：构造函数 > 花括号 > 平铺。
  // 构造函数那种（float3(1.0, 1.0, 1.0)）如果改写成平铺，ColorGrading 那一片
  // 二十多行会全部进 diff，没法看。
  if (c.ctor) return `${c.ctor}(${body})`;
  return braced ? `{ ${body} }` : body;
}

/* ------------------------------------------------------------ 贴图路径 */

/** 这些后缀的值是贴图文件名 */
export function isTextureKey(name: string): boolean {
  return /_MAP_FILE$/i.test(name) || /_TEXTURE$/i.test(name) || /_TEX$/i.test(name);
}

/** 对应的 _MAP_FROM 名字。拿不到就返回 null */
export function fromKeyOf(textureKey: string): string | null {
  const m = textureKey.match(/^(.*)_MAP_FILE$/i);
  return m ? `${m[1]}_MAP_FROM` : null;
}

/**
 * 算目标相对路径。
 *
 * MME 里贴图路径是相对 .fx 所在目录解析的，所以能算相对就算相对 ——
 * 绝对路径一旦换机、换盘符就废了。
 *
 * 跨盘符没法相对，只能返回绝对路径，调用方要把这件事告诉用户。
 */
export function relativeFrom(baseFile: string, target: string): { path: string; crossDrive: boolean } {
  const norm = (p: string) => p.replace(/\\/g, '/');
  const b = norm(baseFile);
  const t = norm(target);
  const baseDir = b.slice(0, b.lastIndexOf('/'));
  const baseDrive = baseDir.slice(0, 2).toLowerCase();
  const tDrive = t.slice(0, 2).toLowerCase();

  if (baseDrive !== tDrive) {
    return { path: t, crossDrive: true };
  }
  const a = baseDir.split('/').filter(Boolean);
  const c = t.split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < c.length && a[i].toLowerCase() === c[i].toLowerCase()) i++;
  const up = a.length - i;
  const parts = [...Array(up).fill('..'), ...c.slice(i)];
  return { path: parts.join('/'), crossDrive: false };
}

/** 贴图路径里出现中文 / 日文 / 空格时，给个提醒但不禁用 —— MME 是认的 */
export function pathNeedsCaution(p: string): string | null {
  if (/[^\x00-\x7f]/.test(p)) return '这个路径里有非 ASCII 字符（中文或日文）。MME 本身认，但个别老版本对编码敏感，写完先在 MMD 里过一遍。';
  if (/\s/.test(p)) return '这个路径里有空格。MME 认带空格的路径，但如果那个包本身没有用引号包资源名，可能会读不到。';
  return null;
}

/* ------------------------------------------------------------ 分类 */

/**
 * 判断一个条目该给什么控件。
 *
 * 顺序不能乱：
 *   1. controller 永远是只读 —— 它的值在 MMD 里由附件位置决定，写回去没意义
 *   2. 名字明说是贴图文件的，就是贴图
 *   3. 有枚举表的走下拉 —— 比数字输入准确，用户不用记 0/1/2 是什么
 *   4. 能解析成颜色的才给取色器。**必须在数值判断之前**，因为
 *      `1.0` 既是合法数值也是合法的单分量颜色；只对 float3/float4
 *      或者多分量逗号写法才当颜色，标量留给数值处理
 *   5. 0/1 且名字像开关的给复选框
 *   6. 数值给数字框，有 range 的再加滑杆
 *   7. 剩下的如果含运算符就当表达式（只读），否则当文本
 */
export function classify(e: Entry, doc: Doc | null): Field {
  if (e.kind === 'controller') {
    return {
      kind: 'expr',
      why: '值由 MMD 里那个附件的骨骼位置决定，在这里改没有意义。'
    };
  }

  if (isTextureKey(e.name)) {
    return { kind: 'texture' };
  }

  const opts = doc?.options ?? [];
  // 只有 0 / 1 两档的枚举给复选框：省地方，也少一次展开动作。
  // 完整的档位说明在展开的注释里照样看得到，信息不丢。
  if (opts.length === 2 && opts.every((o) => o.value === '0' || o.value === '1')) {
    return { kind: 'switch' };
  }
  if (opts.length > 1) {
    return { kind: 'enum', options: opts };
  }

  const v = e.value.trim();
  // 数组声明不可能是颜色：`static const float sampleKernel[9] = {...}` 里那个
  // 花括号是数组初始化，元素个数和颜色分量数没关系。3 个元素的数组
  // （比如三档权重）如果被当成 RGB，取色器会把它按颜色改，那就坏了。
  const isArrayDecl = /\w\s*\[[^\]]*\]\s*=/.test(e.raw);
  const typeSaysColor = !isArrayDecl && (/^float[34]/.test(e.type) || /^const\s+float[34]/.test(e.type));
  const looksColor = !isArrayDecl && (v.includes(',') || /^\{.*\}$/.test(v)) && parseColor(v) !== null;
  if (typeSaysColor && parseColor(v) !== null) {
    const c = parseColor(v)!;
    // 声明的类型决定写回时给几个分量：float4 的就得给 4 个，
    // 不然从取色器改完只写 3 个，HLSL 那边第四个分量会变成 0。
    const declared = /float4/.test(e.type) ? 4 : 3;
    return { kind: 'color', colorArity: Math.max(declared, c.arity) as 3 | 4 };
  }
  if (looksColor) {
    const c = parseColor(v)!;
    return { kind: 'color', colorArity: c.arity === 4 ? 4 : 3 };
  }
  if (isArrayDecl && /[{}]/.test(v)) {
    return { kind: 'expr', why: '这是一个定长数组，不是单个值。改权重表要保证和还是 1，界面上不直接改。' };
  }

  const boolish = v === '0' || v === '1';
  const nameIsSwitch = /(_ENABLE|_UV_FLIP|_COLOR_FLIP|_APPLY_|_USE_|_SWITCH|_TOGGLE|ENABLE$|_FLIP$)/i.test(e.name);
  /**
   * 名字看着像"开关"、其实是**档位选择器**的那些。
   *
   * 依据（2026-09-21 实测真包）：`ALBEDO_SUB_ENABLE` 在包里取 0/1/3/4，
   * `*_MAP_UV_FLIP` 取 0/1/2/3，`EMISSIVE_MAP_APPLY_BLINK` 取 0/1/2 ——
   * 全是"用哪种方式"的档位，不是开关。按开关渲染就只能选 0/1，
   * **用户报的"除了开还可以选 1\3"就是这个**。
   *
   * 所以这里定一条兜底：名字命中这些形状的，**永远不给复选框** ——
   * 有说明表就出下拉，没有就给数字框（至少能填 3）。
   * 这一条只对"可能多档"的名字生效，普通开关（比如 `_USE_ALPHA`）不受影响。
   */
  const nameIsMode =
    /(_MODE|_TYPE|_FROM|_BLINK|_MAP_FROM|SUB_ENABLE|SHADINGMODELID|_APPLY_(BLINK|SCALE|MORPH)|_UV_FLIP|_COLOR_FLIP)/i.test(
      e.name
    );
  if (boolish && nameIsSwitch && !nameIsMode) {
    return { kind: 'switch' };
  }
  if (boolish && nameIsMode) {
    // 兜底：档位不明的先给整数框，让人自己填（有说明表的早就在上面出下拉了）
    return { kind: 'number', int: true, min: 0 };
  }

  if (isNumeric(v)) {
    const r = rangeOf(e, doc);
    return {
      kind: 'number',
      min: r?.min,
      max: r?.max,
      int: !v.includes('.')
    };
  }

  // 表达式：含运算符或函数调用
  if (/[()*+\/]|\.\w+/.test(v) && !/^"/.test(v)) {
    return { kind: 'expr', why: '这个值是一段表达式或代码，不是数字，界面上只读。' };
  }

  // 字符串字面量
  if (/^".*"$/.test(v)) return { kind: 'text' };

  // 0/1 但名字不像开关的，仍然给复选框 —— 总比让人手打强。
  // 但"像档位"的那些（nameIsMode）除外：那种填 3 是常态，复选框会把它藏掉。
  if (boolish && !nameIsMode) return { kind: 'switch' };
  if (boolish) return { kind: 'number', int: true, min: 0 };

  return { kind: 'text' };
}

/** 从行尾注释或上方注释里找 range */
export function rangeOf(e: Entry, doc: Doc | null): { min: number; max: number } | null {
  const text = `${e.comment} ${e.doc} ${doc?.how ?? ''}`;
  const m = text.match(/range\s+(-?[\d.]+)\s*[~\-–]\s*(-?[\d.]+)/i);
  if (m) {
    const min = Number(m[1]);
    const max = Number(m[2]);
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) return { min, max };
  }
  // 中文注释里的「0.02~0.1」这种区间
  const m2 = text.match(/(-?\d+(?:\.\d+)?)\s*[~–]\s*(-?\d+(?:\.\d+)?)/);
  if (m2) {
    const min = Number(m2[1]);
    const max = Number(m2[2]);
    if (Number.isFinite(min) && Number.isFinite(max) && max > min && max - min > 1e-9) {
      return { min, max };
    }
  }
  return null;
}
