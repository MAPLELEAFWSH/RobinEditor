/**
 * 养乐多 fx 模板的解析与回写。
 *
 * 模板长什么样（对着 MMDStarRail4Fun_v2.2.1/mat_body.fx 看出来的，519 行）：
 *   · 开头一段「以下不要动」的常量定义，是给人看的枚举，不是设置
 *   · `// ============= 纹理 begin/end =============` 这种段标记，把参数分块
 *   · 贴图是两行写法，`#define NAME \` 换行再接 `"路径"`
 *   · 开关是 `#define NAME 0` / `#define NAME 1`
 *   · 数值是 `const float3 Name0 = float3(1.0, 0.9, 0.88);`
 *   · 每个数值参数常常有 0~7 八个槽（Name0..Name7），对应子材质索引
 *   · 最后两行是 `#include "shared.fxsub"` 和 `#include "internal/shader.hlsl"`
 *
 * 所以这里不做「认识所有参数名」这件事 —— 版本一升参数就变。
 * 只做通用的三件事：认结构、改值、原样写回。
 * 认值的那部分（哪张贴图填哪一行）单独放 autofill，参数名写在表里，改起来一眼能找到。
 *
 * 回写的原则：**没动的行一个字节都不动**。保留原来的换行符、缩进和行尾注释，
 * 只有这样生成的 fx 和手改的才能对得上 diff。
 */

export type ParamKind = 'switch' | 'int' | 'float' | 'vec2' | 'vec3' | 'vec4' | 'texture' | 'text';

export type Param = {
  /** 参数名，模板里的标识符 */
  name: string;
  /** 原文是 `#define` 还是 `const T x = ...;`，回写时照原样来 */
  decl: 'define' | 'const';
  kind: ParamKind;
  /** 当前值。vec 类型存括号里的内容，如 `1.0, 0.9, 0.88` */
  value: string;
  /** 行尾注释（不含 `//`） */
  comment: string;
  /** 原文第几行（0 起） */
  line: number;
  /** 占几行：贴图是 2，其余是 1 */
  span: number;
  /** 有没有被注释掉。注释掉的贴图在着色器里等于没启用 */
  enabled: boolean;
  /** 所属段名 */
  section: string;
  /** Name0..Name7 里的 0..7；不是槽位参数就没有 */
  slot?: number;
  /** 槽位参数去掉序号的名字，如 `BaseColorTint` */
  base?: string;
  /** `#define` 的原始前导（缩进 + 可能的 `// `），用来原样写回 */
  lead: string;
  /** 第二行（贴图路径那行）的原始前导 */
  lead2: string;
};

export type Section = { title: string; line: number; count: number };

export type Parsed = {
  lines: string[];
  params: Param[];
  sections: Section[];
  eol: '\n' | '\r\n';
  /** 文件里的 include，用来提示要不要把包一起带上 */
  includes: string[];
  /** 解析时觉得可疑的地方，界面顶上挂出来 */
  notes: string[];
};

const SECTION_RE = /^\s*\/\/\s*=+\s*(.+?)\s+(begin|end)\s*=+\s*$/;
const DEFINE_RE = /^(\s*(?:\/\/\s*)?)#define\s+([A-Za-z_]\w*)\s*(.*)$/;
const CONST_RE =
  /^(\s*(?:\/\/\s*)?)const\s+(float|float2|float3|float4|int|int2|int3|int4|bool|double)\s+([A-Za-z_]\w*)\s*=\s*(.+?);\s*(\/\/.*)?$/;
const INCLUDE_RE = /^\s*#include\s+"([^"]+)"/;

/** 把行尾注释切出来。注释只在 `//` 且不在引号里时才算。 */
function splitComment(s: string): { value: string; comment: string } {
  let inQuote = false;
  for (let i = 0; i < s.length - 1; i++) {
    const c = s[i];
    if (c === '"') inQuote = !inQuote;
    else if (!inQuote && c === '/' && s[i + 1] === '/') {
      return { value: s.slice(0, i).trim(), comment: s.slice(i + 2).trim() };
    }
  }
  return { value: s.trim(), comment: '' };
}

function kindOf(type: string): ParamKind {
  switch (type) {
    case 'float2':
    case 'int2':
      return 'vec2';
    case 'float3':
    case 'int3':
      return 'vec3';
    case 'float4':
    case 'int4':
      return 'vec4';
    case 'int':
    case 'bool':
      return 'int';
    default:
      return 'float';
  }
}

/** `float3(1.0, 0.9, 0.88)` → `1.0, 0.9, 0.88`；`1.5` → `1.5` */
function unwrapInit(init: string): string {
  const m = init.match(/^\s*[A-Za-z_]\w*\s*\((.*)\)\s*$/s);
  return m ? m[1].trim() : init.trim();
}

/** 数字个数，用来决定渲染几个输入框 */
export function componentCount(kind: ParamKind): number {
  switch (kind) {
    case 'vec2':
      return 2;
    case 'vec3':
      return 3;
    case 'vec4':
      return 4;
    default:
      return 1;
  }
}

export function parseFx(text: string): Parsed {
  const eol: '\n' | '\r\n' = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const params: Param[] = [];
  const sections: Section[] = [];
  const includes: string[] = [];
  const notes: string[] = [];

  let section = '';
  // 第一段标记之前那批枚举常量，不该给人改
  const HEAD = '（头部枚举，一般不用动）';

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    const inc = raw.match(INCLUDE_RE);
    if (inc) {
      includes.push(inc[1]);
      continue;
    }

    const sec = raw.match(SECTION_RE);
    if (sec) {
      if (sec[2] === 'begin') {
        section = sec[1];
        sections.push({ title: section, line: i, count: 0 });
      } else {
        section = '';
      }
      continue;
    }

    const def = raw.match(DEFINE_RE);

    // 贴图：本行以 `\` 结尾，下一行是引号路径
    if (def && /\\\s*$/.test(def[3])) {
      const next = lines[i + 1] ?? '';
      const q = next.match(/^(\s*(?:\/\/\s*)?)"(.*)"\s*(?:\/\/.*)?$/);
      if (q) {
        const lead = def[1];
        params.push({
          name: def[2],
          decl: 'define',
          kind: 'texture',
          value: q[2],
          comment: '',
          line: i,
          span: 2,
          enabled: !/^\s*\/\//.test(lead),
          section: section || HEAD,
          lead,
          lead2: q[1]
        });
        i++;
        continue;
      }
      notes.push(`第 ${i + 1} 行的 #define 后面不是引号路径，按普通定义读了`);
    }

    if (def) {
      const lead = def[1];
      const { value, comment } = splitComment(def[3]);
      params.push({
        name: def[2],
        decl: 'define',
        /* **单行贴图写法**（`#define NAME "路径"` 一行搞定）也要认成贴图。
           2026-09-23 修：原来只有"本行以 `\` 结尾 + 下一行是引号路径"的两行写法才走贴图分支，
           单行写法落到这里变成 `int` —— 界面给 int 的是 `<input type="number">`，
           浏览器把 `"路径"` 清洗成空串，于是**屏上是空白框、文件里是路径**（用户报的"有偏差"）。
           **真模板实测**：`实战测试用例\渲染联动\养乐多\MMDStarRail4Fun_v2.2.1` 的 26 个 `.fx` 里，
           这种单行写法有 **72 处** —— 是主流写法，不是边角。 */
        kind: /^".*"$/.test(value) ? 'texture' : value === '0' || value === '1' ? 'switch' : 'int',
        value: /^".*"$/.test(value) ? value.slice(1, -1) : value,
        /* 单行贴图的**行尾注释要留着**（跟两行写法一样，写回时原样带出去） */
        comment,
        line: i,
        span: 1,
        enabled: !/^\s*\/\//.test(lead),
        section: section || HEAD,
        lead,
        lead2: ''
      });
      continue;
    }

    const con = raw.match(CONST_RE);
    if (con) {
      const lead = con[1];
      params.push({
        name: con[3],
        decl: 'const',
        kind: kindOf(con[2]),
        value: unwrapInit(con[4]),
        comment: con[5] ? con[5].replace(/^\s*\/\/\s*/, '').trim() : '',
        line: i,
        span: 1,
        enabled: !/^\s*\/\//.test(lead),
        section: section || HEAD,
        lead,
        lead2: ''
      });
    }
  }

  // 槽位识别：Name0..Name7 → base=Name、slot=0..7。
  // 要求同名兄弟至少两个，免得把单蹦的数字结尾参数误判成槽。
  for (const p of params) {
    const m = p.name.match(/^(.*\S)([0-7])$/);
    if (!m) continue;
    const sibs = params.filter(
      (q) => q.name.startsWith(m[1]) && /^[0-7]$/.test(q.name.slice(m[1].length))
    );
    if (sibs.length >= 2) {
      p.base = m[1];
      p.slot = +m[2];
    }
  }

  for (const s of sections) {
    const next = sections.find((x) => x.line > s.line);
    const end = next ? next.line : lines.length;
    s.count = params.filter((p) => p.line > s.line && p.line < end).length;
  }

  return { lines, params, sections, eol, includes, notes };
}

/** 前导里去掉注释标记和多余空格，拿到真正的缩进 */
function coreLead(lead: string): string {
  return lead.replace(/^\s*\/\/\s*/, '').replace(/^\s+/, '');
}

/**
 * 把参数值写回文本。
 *
 * 只改真正变了的行，其余整行照抄 —— 段标记、注释、include 全部原样。
 *
 * 这里有个坑，第一版就踩了：模板里的 `#define` 是对齐过的
 * （`#define MATERIAL_DOMAIN_COMMON         0   // 普通(身体&头发)`），
 * 无脑按「名字 + 空格 + 值」重排一遍的话，值没变但整文件的空白全变了 ——
 * 实测 49 行凭空进 diff。所以值和开关都没动就直接跳过。
 */
export function writeFx(parsed: Parsed, params: Param[]): string {
  const out = [...parsed.lines];
  const byName = new Map(params.map((p) => [p.name, p]));

  for (const orig of parsed.params) {
    const p = byName.get(orig.name);
    if (!p) continue;
    if (p.value === orig.value && p.enabled === orig.enabled) continue;
    const lead = p.enabled ? coreLead(p.lead) : '// ' + coreLead(p.lead);

    if (p.kind === 'texture') {
      /* **单行写法要按一行写回**：`span === 1` 的贴图如果照下面那个两行分支写，
         会把**下一行**覆盖掉（那是别人的代码）—— 这是"改一个贴图毁一行"级别的错。 */
      if (orig.span === 1) {
        const tail = p.comment ? ` // ${p.comment}` : '';
        out[orig.line] = `${lead}#define ${p.name} "${p.value}"${tail}`;
        continue;
      }
      out[orig.line] = `${lead}#define ${p.name} \\`;
      const lead2 = p.enabled ? coreLead(p.lead2) : '// ' + coreLead(p.lead2);
      out[orig.line + 1] = `${lead2}"${p.value}"`;
      continue;
    }

    if (orig.decl === 'const') {
      const src = parsed.lines[orig.line];
      const type = (src.match(/const\s+([A-Za-z_]\w*)\s+/) ?? [, 'float'])[1];
      // 原来带括号的才补括号，不然 `const float x = 1.0;` 会被写成 `= 1.0(...)`
      const hadParens = /=\s*[A-Za-z_]\w*\s*\(/.test(src);
      const val = hadParens ? `${type}(${p.value})` : p.value;
      const tail = p.comment ? ` // ${p.comment}` : '';
      out[orig.line] = `${lead}const ${type} ${p.name} = ${val};${tail}`;
      continue;
    }

    const tail = p.comment ? ` // ${p.comment}` : '';
    out[orig.line] = `${lead}#define ${p.name} ${p.value}${tail}`;
  }

  return out.join(parsed.eol);
}

/* ---------------------------------------------------------------- 自动填 */

export type FillMaterial = {
  name: string;
  kind: string;
  /** 0-1 的 RGBA */
  diffuse: [number, number, number, number];
  specular: [number, number, number];
  specular_power: number;
  ambient: [number, number, number];
  edge_size: number;
};

export type FillResult = {
  values: Record<string, string>;
  /** 每个赋值为什么这么填，界面上要能看见 */
  why: { name: string; value: string; from: string }[];
  /** 想填但没找到来源的（**整句话**，给人看的） */
  missing: string[];
  /**
   * 同一批"没填上"里**涉及到的参数名**。
   *
   * 为什么单开一个：界面上「没填上的」那一档是拿**参数名**去筛参数表的，
   * 而 `missing` 里存的是整句话（`X（没找到Y的贴图）`）—— 拿整句当参数名比，恒假，
   * 于是那一档永远显示"这个模式下没有内容"，可角标还在报非零的数字（2026-09-23 修）。
   * 这里把名字单独攒一份，界面按它筛。
   */
  missingNames: string[];
};

const TEX_RULES: { param: string; match: RegExp; label: string }[] = [
  { param: 'LIGHTMAP_TEXTURE', match: /lightmap|_lm(\.|_|$)/i, label: '文件名带 LightMap / _LM' },
  { param: 'FACEMAP_TEXTURE', match: /facemap|face_lightmap|face_color/i, label: '文件名带 FaceMap / Face_' },
  { param: 'COLOR_TEXTURE', match: /color|diffuse|albedo|_d(\.|_|$)/i, label: '文件名带 Color / Diffuse' },
  { param: 'STOCKINGS_TEXTURE', match: /stocking|sock/i, label: '文件名带 Stockings' },
  { param: 'RAMP_COOL_TEXTURE', match: /cool[_-]?ramp/i, label: '文件名带 Cool_Ramp' },
  { param: 'RAMP_WARM_TEXTURE', match: /warm[_-]?ramp/i, label: '文件名带 Warm_Ramp' },
  { param: 'NORMALMAP_TEXTURE', match: /normal|_n(\.|_|$)/i, label: '文件名带 Normal / _N' },
  { param: 'MATCAP_TEXTURE', match: /metalmap|matcap/i, label: '文件名带 MetalMap / MatCap' },
  { param: 'EMISSIVE_TEXTURE', match: /emissive|_e(\.|_|$)|effect/i, label: '文件名带 Emissive / Effect' }
];

/** PMX 里的路径是相对模型的，MMD 用反斜杠，写进 fx 要统一成斜杠 */
export function normalizeTexPath(p: string): string {
  return p.replace(/\\/g, '/').trim();
}

function fmt(n: number, digits = 4): string {
  if (!isFinite(n)) return '0';
  const s = n.toFixed(digits);
  // 去掉尾部的 0，`1.0000` 写成 `1.0` 更像手写的
  return s.replace(/0+$/, '').replace(/\.$/, '.0');
}

function rgb(v: [number, number, number]): string {
  return `${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])}`;
}

/**
 * 按 PMX 的材质清单和贴图清单，给一份模板填值。
 *
 * 只填「能确定来源」的东西；填不了的进 missing，不瞎猜。
 */
export function autofill(
  params: Param[],
  opts: {
    domain: 'body' | 'face' | 'hair';
    materials: FillMaterial[];
    textures: string[];
    /** 用户自己指了 lightmap，优先用它 */
    lightmapPath?: string;
  }
): FillResult {
  const values: Record<string, string> = {};
  const why: { name: string; value: string; from: string }[] = [];
  const missing: string[] = [];
  const missingNames: string[] = [];
  const has = (n: string) => params.some((p) => p.name === n);
  const set = (name: string, value: string, from: string) => {
    if (!has(name)) return;
    values[name] = value;
    why.push({ name, value, from });
  };

  // 1. 材质域。这个决定着色器走脸那套还是身体那套，必须先定
  set('MATERIAL_DOMAIN', opts.domain === 'face' ? '1' : '0', opts.domain === 'face' ? '脸' : '身体 / 头发');

  // 2. 贴图路径
  for (const rule of TEX_RULES) {
    if (rule.param === 'LIGHTMAP_TEXTURE' && opts.lightmapPath) {
      set(rule.param, normalizeTexPath(opts.lightmapPath), '你指定的 lightmap');
      continue;
    }
    if (!has(rule.param)) continue;
    const hit = opts.textures.find((t) => rule.match.test(t));
    if (hit) set(rule.param, normalizeTexPath(hit), rule.label);
    else {
      missing.push(`${rule.param}（没找到${rule.label}的贴图）`);
      missingNames.push(rule.param);
    }
  }

  // 3. 通道来源与取道。这是养乐多的排法，写在这里但界面上能改
  set('SUB_INDEX_FROM', '1', '子材质索引走贴图');
  set('SUB_INDEX_SWIZZLE', '3', '索引取 A 通道');
  set('DIFFUSE_THRESHOLD_FROM', '1', '漫反射阈值走贴图');
  set('DIFFUSE_THRESHOLD_SWIZZLE', '1', '阈值取 G 通道');
  set('SPECULAR_THRESHOLD_FROM', '1', '高光阈值走贴图');
  set('SPECULAR_THRESHOLD_SWIZZLE', '2', '阈值取 B 通道');
  if (has('STOCKINGS_MASK_FROM')) {
    set('STOCKINGS_MASK_FROM', '1', '黑丝遮罩走贴图');
    set('STOCKINGS_MASK_SWIZZLE', '0', '遮罩取 R 通道');
  }
  if (has('RAMP_COLOR_FROM') && values['RAMP_COOL_TEXTURE']) {
    set('RAMP_COLOR_FROM', '1', '有 ramp 贴图，明暗色改从贴图取');
  }

  // 4. 每个槽的常量，按这一域里的材质顺序填 0..7
  const mine = opts.materials.filter((m) =>
    opts.domain === 'face' ? m.kind === 'face' : m.kind !== 'face'
  );
  const slots = Math.min(8, mine.length);
  for (let i = 0; i < slots; i++) {
    const m = mine[i];
    const n = String(i);
    set(`BaseColorTint${n}`, rgb([m.diffuse[0], m.diffuse[1], m.diffuse[2]]), `材质「${m.name}」的 diffuse`);
    set(`BaseColorGamma${n}`, '1.0', '默认');
    set(`SpecularColor${n}`, rgb(m.specular), `材质「${m.name}」的 specular`);
    set(`SpecularShininess${n}`, fmt(m.specular_power, 2), `材质「${m.name}」的高光强度`);
    // 阴影色拿 diffuse 压暗一档当起点，具体得自己调
    set(
      `ShadowColor${n}`,
      rgb([m.diffuse[0] * 0.72, m.diffuse[1] * 0.72, m.diffuse[2] * 0.72]),
      `材质「${m.name}」的 diffuse 压暗到 72%`
    );
    set(
      `ShallowColor${n}`,
      rgb([m.diffuse[0] * 0.88, m.diffuse[1] * 0.88, m.diffuse[2] * 0.88]),
      `材质「${m.name}」的 diffuse 压暗到 88%`
    );
    set(`SpecularRoughness${n}`, '0.02', '默认');
    set(`SpecularIntensity${n}`, m.specular_power > 0 ? '1.0' : '0.0', `材质「${m.name}」有没有高光`);
    set(`RimShadowWidth${n}`, '0.0', '边缘阴影默认关掉');
  }

  if (has('AlphaConst') && mine.length) {
    set('AlphaConst', fmt(mine[0].diffuse[3], 3), `材质「${mine[0].name}」的透明度`);
  }

  if (has('BaseColorTint7') && slots < 8) {
    missing.push(`这一域只有 ${slots} 个材质，槽 ${slots}~7 保持模板原值`);
    /* 槽 ${slots}~7 那一批参数名（界面上「没填上的」按名字筛，得把它们列全） */
    for (let i = slots; i < 8; i++) {
      for (const 前缀 of ['BaseColorTint', 'ShadowColor', 'ShallowColor', 'SpecularColor', 'SpecularShininess', 'SpecularRoughness', 'RimShadowWidth', 'SpecularIntensity']) {
        if (has(前缀 + i)) missingNames.push(前缀 + i);
      }
    }
  }
  if (opts.domain !== 'face' && mine.length === 0) {
    missing.push('这一域里没匹配到材质，槽 0~7 会保持模板原值');
  }

  return { values, why, missing, missingNames };
}

/** 把填好的值合并进参数表 */
export function mergeValues(params: Param[], values: Record<string, string>): Param[] {
  return params.map((p) =>
    values[p.name] !== undefined ? { ...p, value: values[p.name], enabled: true } : p
  );
}

/** 生成行级 diff，只列真正变了的 */
export function diffParams(
  orig: Param[],
  next: Param[]
): { name: string; from: string; to: string }[] {
  const byName = new Map(orig.map((p) => [p.name, p]));
  const out: { name: string; from: string; to: string }[] = [];
  for (const p of next) {
    const o = byName.get(p.name);
    if (!o) continue;
    const a = o.enabled ? o.value : `(注释掉) ${o.value}`;
    const b = p.enabled ? p.value : `(注释掉) ${p.value}`;
    if (a !== b) out.push({ name: p.name, from: a, to: b });
  }
  return out;
}

/* ---------------------------------------------------------------- 常不常用 */

/**
 * 什么算"常用参数"。
 *
 * 判据只能从**名字**上认，因为模板各版本参数完全不同，硬编码清单活不过一次升级。
 * 三类算常用：
 *   · 贴图格（`kind === 'texture'`）—— 这是用户真正每份都要改的东西；
 *   · 名字里带来源 / 纹理 / 材质 / 全局 / 强度 这些词（日文模板写 テクスチャ・材質・強度 也会命中）；
 *   · 模板第一个段里的参数（多数模板第一段就是全局那几项）。
 * 其余归"完整"。判据放这儿是为了能单测 —— 界面里写死正则就没法验了。
 */
const 常用词 = /来源|SOURCE|纹理|TEXTURE|テクスチャ|材质|材質|MATERIAL|全局|GLOBAL|整体|強度|强度|INTENSITY/i;

export function 常用参数(params: Param[]): Param[] {
  const 命中 = params.filter((p) => p.kind === 'texture' || 常用词.test(p.name));
  if (命中.length) return 命中;
  /* 一条都没命中（模板用了一套完全陌生的命名）→ 退回头一段，别给一张空面板 */
  const 首段 = params.find((p) => p.section)?.section ?? '';
  const 退 = params.filter((p) => p.section === 首段);
  return 退.length ? 退 : params;
}

/* ---------------------------------------------------------------- 规则 */

export type Rule = { kw: string; kind: string };

export const KINDS = [
  { id: 'body', label: '身体' },
  { id: 'face', label: '脸' },
  { id: 'hair', label: '头发' },
  { id: 'cloth', label: '衣服' },
  { id: 'shoe', label: '鞋袜' },
  { id: 'metal', label: '金属' },
  { id: 'accessory', label: '饰件' },
  { id: 'effect', label: '特效' },
  { id: 'shadow', label: '阴影' },
  { id: 'other', label: '其它' }
];

/** 后端给的 kind 之外，用户自己加的关键词规则。后加的优先。 */
export function applyRules(name: string, builtin: string, rules: Rule[]): { kind: string; by: string } {
  for (let i = rules.length - 1; i >= 0; i--) {
    const r = rules[i];
    if (r.kw && name.includes(r.kw)) return { kind: r.kind, by: `规则「${r.kw}」` };
  }
  return { kind: builtin, by: '内置' };
}

/** 模板按域挑：脸走 mat_face，头发走 mat_hair，其余 mat_body */
export function templateFor(kind: string): 'body' | 'face' | 'hair' {
  if (kind === 'face') return 'face';
  if (kind === 'hair') return 'hair';
  return 'body';
}

export const RULES_KEY = 'robin.yaku.rules';

export function loadRules(): Rule[] {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    if (!raw) return defaultRules();
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : defaultRules();
  } catch {
    return defaultRules();
  }
}

export function saveRules(rules: Rule[]) {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(rules));
  } catch {
    /* 隐私模式下写不了，忽略 */
  }
}

function defaultRules(): Rule[] {
  return [
    { kw: '袖', kind: 'cloth' },
    { kw: 'スカート', kind: 'cloth' },
    { kw: '靴', kind: 'shoe' },
    { kw: '瞳', kind: 'face' },
    { kw: '眉', kind: 'face' },
    { kw: 'アホ毛', kind: 'hair' }
  ];
}
