/**
 * Ray 的配置文件解析。
 *
 * 三种真实存在的写法，都按实际文件量过：
 *
 *   ray.conf（131 行）
 *     // 0 : None
 *     // 1 : Enable
 *     #define SUN_LIGHT_ENABLE 1
 *   —— 选项值写在上面的注释里，所以注释块要当成这个选项的说明留着。
 *
 *   ray_advanced.conf
 *     static const float mTemperature = 6600.0; // range 1000 ~ 40000 // Default value ...
 *   —— 注释里带 range，能拿来当滑杆上下限。
 *
 *   Materials/material_2.0.fx
 *     #define ALBEDO_MAP_FROM 3
 *     const float3 albedo = 1.0;
 *     #include "material_common_2.0.fxsub"
 *
 *   Materials/Editor/Standard/material_editor.fxsub
 *     float mAlbedoH : CONTROLOBJECT<string name=CONTROLLER_NAME; string item = "AlbedoH";>;
 *   —— 控制器参数，写回没有意义（值由 PMX 控制），只列出来让人知道有哪些。
 *
 * 写回的两条硬约束：
 *   1. 只换值，不动别的字符。整行重排会把对齐和注释全冲掉，diff 就没法看了。
 *   2. 日文 Ray 包多半是 Shift-JIS，JS 里没有编码器，所以非 UTF-8 的文件走
 *      字节级拼接：只把改动那一段（一定是 ASCII）换掉，其余字节原样搬过去。
 *      拼完再读回来核对一遍，只改了该改的行才算过。
 */

export type Eol = '\r\n' | '\n';
export type EntryKind = 'define' | 'const' | 'controller' | 'commented';

export type Entry = {
  /** 唯一键：kind + 行号 */
  id: string;
  kind: EntryKind;
  /** 宏名 / 变量名 */
  name: string;
  /** 当前值（原始文本，没做类型转换） */
  value: string;
  /** const 的声明类型：float / float3 / int … */
  type: string;
  /** 0 起始的行号，跟 text.split 的下标一致 */
  line: number;
  /** 整行原文。写回时以它为基础做局部替换 */
  raw: string;
  indent: string;
  /** 行尾注释 */
  comment: string;
  /** 上方连续的 // 注释块，拼成一段说明 */
  doc: string;
  /** controller 的 item 名 */
  item: string;
  /** controller 的 name 属性（对象名，常见是 CONTROLLER_NAME） */
  object: string;
};

export type ParseError = { line: number; raw: string; why: string };

export type ParsedFile = {
  eol: Eol;
  entries: Entry[];
  /** #include 之类只是列一下 */
  includes: { line: number; target: string }[];
  errors: ParseError[];
  /** 认出来的文件类型，用来决定界面上显示哪些分组 */
  flavor: 'ray-conf' | 'ray-advanced' | 'material' | 'fxsub' | 'unknown';
};

/* ------------------------------------------------------------------ 工具 */

/** 把行尾 // 注释切出来。引号里的 // 不算注释（贴图路径里不会出现，但别赌） */
export function splitTrailingComment(s: string): [string, string] {
  let inQuote = false;
  for (let i = 0; i < s.length - 1; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== '\\') inQuote = !inQuote;
    if (!inQuote && c === '/' && s[i + 1] === '/') {
      return [s.slice(0, i), s.slice(i)];
    }
  }
  return [s, ''];
}

export function detectEol(text: string): Eol {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

export function looksAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return false;
  return true;
}

/**
 * 从说明文字里抠出「值 : 说明」这种选项表。
 * ray.conf 里全是这个写法，抠出来就能直接做下拉框。
 */
export function docOptions(doc: string): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const line of doc.split('\n')) {
    const m = line.match(/^\s*(\d+)\s*:\s*(.+?)\s*$/);
    if (m && !out.some((o) => o.value === m[1])) {
      out.push({ value: m[1], label: m[2] });
    }
  }
  return out;
}

/** 从注释里抠 range。ray_advanced.conf 的 `// range 1000 ~ 40000` 就是这个 */
export function rangeFrom(text: string): { min: number; max: number } | null {
  const m = text.match(/range\s+(-?[\d.]+)\s*[~\-–]\s*(-?[\d.]+)/i);
  if (!m) return null;
  const min = Number(m[1]);
  const max = Number(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  return { min, max };
}

/** 数值类选项判断。名字里带这些词的多半是可调的强度，给滑杆 */
export function isTunableName(name: string): boolean {
  return /RATE|INTENSITY|LEVEL|POWER|SIZE|QUALITY|SCALE|STRENGTH|RADIUS|BLUR|SPEED|LOOP|OFFSET|THRESHOLD|CONTRAST|BRIGHT|SATURATION/i.test(
    name
  );
}

/* ------------------------------------------------------------------ 解析 */

const RE_DEFINE = /^(\s*)(#define[ \t]+)([A-Za-z_]\w*)([ \t]+)(.*)$/;
const RE_DEFINE_OFF = /^(\s*)\/\/[ \t]*#define[ \t]+([A-Za-z_]\w*)([ \t]+)(.*)$/;
const RE_CONST =
  /^(\s*)((?:static\s+)?const\s+)([A-Za-z_]\w*(?:[234](?:x[234])?)?)([ \t]+)([A-Za-z_]\w*)([ \t]*(?:\[[^\]]*\])?[ \t]*=[ \t]*)([\s\S]*)$/;
const RE_CONTROLLER =
  /^(\s*)([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*:\s*CONTROLOBJECT\s*<([\s\S]*?)>\s*;/i;
const RE_INCLUDE = /^\s*#include\s+"([^"]+)"/;

export function parseRayText(text: string, path = ''): ParsedFile {
  const eol = detectEol(text);
  const lines = text.split(/\r?\n/);
  const entries: Entry[] = [];
  const includes: { line: number; target: string }[] = [];
  const errors: ParseError[] = [];
  let docBuf: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // 纯注释行 —— 可能是下一个选项的说明，也可能是被注释掉的开关，两种都得留
    if (/^\s*\/\//.test(trimmed)) {
      const off = trimmed.match(RE_DEFINE_OFF);
      if (off) {
        entries.push({
          id: `commented:${i}`,
          kind: 'commented',
          name: off[2],
          value: splitTrailingComment(off[4])[0].trim(),
          type: '',
          line: i,
          raw,
          indent: off[1],
          comment: splitTrailingComment(off[4])[1],
          doc: docBuf.join('\n'),
          item: '',
          object: ''
        });        docBuf = [];
        continue;
      }
      docBuf.push(trimmed.replace(/^\/\/\s?/, ''));
      continue;
    }

    if (trimmed === '') {
      // 空行把说明块切开，避免把上一段的注释挂到无关的选项上
      docBuf = [];
      continue;
    }

    const inc = raw.match(RE_INCLUDE);
    if (inc) {
      includes.push({ line: i, target: inc[1] });
      docBuf = [];
      continue;
    }

    const ctrl = raw.match(RE_CONTROLLER);
    if (ctrl) {
      const inner = ctrl[4];
      const nm = inner.match(/name\s*=\s*"?([^";]+)"?/i);
      const it = inner.match(/item\s*=\s*"([^"]*)"/i);
      entries.push({
        id: `controller:${i}`,
        kind: 'controller',
        name: ctrl[3],
        value: '',
        type: ctrl[2],
        line: i,
        raw,
        indent: ctrl[1],
        comment: '',
        doc: docBuf.join('\n'),
        item: it ? it[1] : '',
        object: nm ? nm[1].trim() : ''
      });
      docBuf = [];
      continue;
    }

    const def = raw.match(RE_DEFINE);
    if (def) {
      const [code, comment] = splitTrailingComment(def[5]);
      entries.push({
        id: `define:${i}`,
        kind: 'define',
        name: def[3],
        value: code.trim(),
        type: '',
        line: i,
        raw,
        indent: def[1],
        comment,
        doc: docBuf.join('\n'),
        item: '',
        object: ''
      });
      docBuf = [];
      continue;
    }

    const cnst = raw.match(RE_CONST);
    if (cnst) {
      // 值里可能有 {…}，分号要在括号外找
      const tail = cnst[7];
      let depth = 0;
      let semi = -1;
      for (let k = 0; k < tail.length; k++) {
        const c = tail[k];
        if (c === '{' || c === '(') depth++;
        else if (c === '}' || c === ')') depth--;
        else if (c === ';' && depth === 0) {
          semi = k;
          break;
        }
      }
      if (semi < 0) {
        errors.push({ line: i, raw, why: 'const 声明结尾找不到分号' });
        docBuf = [];
        continue;
      }
      entries.push({
        id: `const:${i}`,
        kind: 'const',
        name: cnst[5],
        value: tail.slice(0, semi).trim(),
        type: cnst[3],
        line: i,
        raw,
        indent: cnst[1],
        comment: tail.slice(semi + 1).trim(),
        doc: docBuf.join('\n'),
        item: '',
        object: ''
      });
      docBuf = [];
      continue;
    }

    // 其它非空行不报错 —— 函数体、语义声明一大堆，报出来只会刷屏
    docBuf = [];
  }

  const base = path.replace(/\\/g, '/').toLowerCase();
  const name = base.split('/').pop() ?? '';
  let flavor: ParsedFile['flavor'] = 'unknown';
  if (name === 'ray.conf') flavor = 'ray-conf';
  else if (name === 'ray_advanced.conf') flavor = 'ray-advanced';
  else if (name.endsWith('.fxsub')) flavor = 'fxsub';
  else if (name.endsWith('.fx')) flavor = 'material';

  return { eol, entries, includes, errors, flavor };
}

/* ------------------------------------------------------------------ 改值 */

/**
 * 换掉 #define 的值。
 * 头两段（`#define` 后面的空格、宏名后面的空格）原样搬过去 ——
 * 一开始这里写死了 `#define `，结果 `#define   X\t 1` 这种对齐会被压成一个空格，
 * 整份 conf 的对齐全散了，diff 里满屏都是改动。
 */
export function setDefineValue(raw: string, newValue: string): string {
  const m = raw.match(RE_DEFINE);
  if (!m) return raw;
  const [code, comment] = splitTrailingComment(m[5]);
  const head = m[1] + m[2] + m[3] + m[4];
  // 值前后的空白跟着原来那段走，不在值里
  const lead = code.match(/^\s*/)?.[0] ?? '';
  const trail = code.match(/\s*$/)?.[0] ?? '';
  return head + lead + newValue + trail + comment;
}

/** 换掉 const 的值。保留 `=` 之前和 `;` 之后的全部内容 */
export function setConstValue(raw: string, newValue: string): string {
  const m = raw.match(RE_CONST);
  if (!m) return raw;
  const tail = m[7];
  let depth = 0;
  let semi = -1;
  for (let k = 0; k < tail.length; k++) {
    const c = tail[k];
    if (c === '{' || c === '(') depth++;
    else if (c === '}' || c === ')') depth--;
    else if (c === ';' && depth === 0) {
      semi = k;
      break;
    }
  }
  if (semi < 0) return raw;
  const before = m[1] + m[2] + m[3] + m[4] + m[5] + m[6];
  const oldVal = tail.slice(0, semi);
  const lead = oldVal.match(/^\s*/)?.[0] ?? '';
  const trail = oldVal.match(/\s*$/)?.[0] ?? '';
  return before + lead + newValue + trail + tail.slice(semi);
}

/** 注释掉 / 取消注释一个开关。material 文件里那些可选开关全靠这个 */
export function toggleCommented(raw: string, active: boolean): string {
  if (active) {
    // //#define X 和 // #define X 都还原成 #define X
    return raw.replace(/^(\s*)\/\/[ \t]*(?=#define)/, '$1');
  }
  return raw.replace(/^(\s*)(?=#define)/, '$1//');
}

/* ------------------------------------------------------------------ 写回 */

export type LineEdit = { line: number; oldRaw: string; newRaw: string };

/**
 * UTF-8 文件的写法：整段文本重排，编码用 TextEncoder。
 */
export function applyEditsToText(text: string, edits: LineEdit[]): string {
  const eol = detectEol(text);
  const lines = text.split(/\r?\n/);
  for (const e of edits) {
    if (e.line >= 0 && e.line < lines.length) lines[e.line] = e.newRaw;
  }
  return lines.join(eol);
}

/**
 * 非 UTF-8 文件的写法：在字节上做拼接。
 *
 * 前提是**改动的那一段一定是 ASCII**（改的都是数字和标识符）。
 * 前后缀本身是不是 ASCII 无所谓 —— 只要有一边是可测的就能定位：
 *
 *   前缀全 ASCII  →  前缀字节数 = 字符数，后缀字节数 = 整行字节数 - 前缀 - 改动的旧值
 *   后缀全 ASCII  →  反过来算
 *   两边都含双字节字符  →  定位不了，拒写
 *
 * 这样 `#define X 1 // 日文注释` 这种（后缀是日文）也改得动：
 * 定位靠 ASCII 的前缀，日文那段作为原始字节整段搬过去。
 *
 * 不满足条件就返回 ok: false，调用方必须放弃写入而不是硬写。
 */
export function spliceAsciiLineEdits(
  bytes: Uint8Array,
  edits: LineEdit[]
): { ok: boolean; bytes?: Uint8Array; why?: string } {
  const segs: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) {
      segs.push(bytes.subarray(start, i));
      start = i + 1;
    }
  }
  segs.push(bytes.subarray(start));

  for (const e of edits) {
    if (e.line < 0 || e.line >= segs.length) {
      return { ok: false, why: `第 ${e.line + 1} 行超出文件范围` };
    }
    const oldS = e.oldRaw;
    const newS = e.newRaw;

    // 先按字符找最长公共前后缀，不加 ASCII 限制 —— 限制加到"改动段"上就够了
    let p = 0;
    while (p < oldS.length && p < newS.length && oldS[p] === newS[p]) p++;
    let s = 0;
    while (
      s < oldS.length - p &&
      s < newS.length - p &&
      oldS[oldS.length - 1 - s] === newS[newS.length - 1 - s]
    ) {
      s++;
    }

    const midOld = oldS.slice(p, oldS.length - s);
    const midNew = newS.slice(p, newS.length - s);
    if (!looksAscii(midOld) || !looksAscii(midNew)) {
      return {
        ok: false,
        why: `第 ${e.line + 1} 行改动的内容里有非 ASCII 字符（${JSON.stringify(midNew.slice(0, 24))}），按原编码写不安全`
      };
    }

    const seg = segs[e.line];
    // 段尾的 CR 属于换行符，不属于行内容
    const hasCR = seg.length > 0 && seg[seg.length - 1] === 0x0d;
    const body = hasCR ? seg.subarray(0, seg.length - 1) : seg;

    const prefix = oldS.slice(0, p);
    const suffix = oldS.slice(oldS.length - s);
    let headBytes: number;
    let tailBytes: number;

    if (looksAscii(prefix)) {
      // 前缀是 ASCII：字节数就是字符数，后缀从行尾倒着数
      headBytes = prefix.length;
      tailBytes = body.length - headBytes - midOld.length;
    } else if (looksAscii(suffix)) {
      tailBytes = suffix.length;
      headBytes = body.length - tailBytes - midOld.length;
    } else {
      return {
        ok: false,
        why: `第 ${e.line + 1} 行的值前后都有非 ASCII 字符，定位不了，拒写`
      };
    }

    if (headBytes < 0 || tailBytes < 0) {
      return {
        ok: false,
        why: `第 ${e.line + 1} 行的前后缀长度对不上（前缀 ${headBytes} 字节 / 后缀 ${tailBytes} 字节，整行 ${body.length} 字节）`
      };
    }

    const midBytes = bytesFromAscii(midNew);
    const merged = new Uint8Array(headBytes + midBytes.length + tailBytes + (hasCR ? 1 : 0));
    merged.set(body.subarray(0, headBytes), 0);
    merged.set(midBytes, headBytes);
    merged.set(body.subarray(body.length - tailBytes), headBytes + midBytes.length);
    if (hasCR) merged[merged.length - 1] = 0x0d;
    segs[e.line] = merged;
  }

  let total = 0;
  for (let i = 0; i < segs.length; i++) total += segs[i].length + (i < segs.length - 1 ? 1 : 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (let i = 0; i < segs.length; i++) {
    out.set(segs[i], off);
    off += segs[i].length;
    if (i < segs.length - 1) out[off++] = 0x0a;
  }
  return { ok: true, bytes: out };
}

function bytesFromAscii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0x7f;
  return out;
}

/* ------------------------------------------------------------------ 收集改动 */

export type Change = {
  id: string;
  line: number;
  name: string;
  before: string;
  after: string;
  oldRaw: string;
  newRaw: string;
};

/** 把「新值表」折成行级改动清单。值没变的行不进清单 */
export function collectChanges(
  entries: Entry[],
  values: Record<string, string>,
  actives: Record<string, boolean>
): Change[] {
  const out: Change[] = [];
  for (const e of entries) {
    if (e.kind === 'controller') continue;
    if (e.kind === 'commented') {
      const want = actives[e.id];
      if (want === undefined) continue;
      if (want !== true) continue;
      const newRaw = toggleCommented(e.raw, true);
      if (newRaw !== e.raw) {
        out.push({
          id: e.id,
          line: e.line,
          name: e.name,
          before: '注释掉',
          after: `启用（${e.value}）`,
          oldRaw: e.raw,
          newRaw
        });
      }
      continue;
    }
    const v = values[e.id];
    if (v === undefined || v === e.value) continue;
    const newRaw = e.kind === 'define' ? setDefineValue(e.raw, v) : setConstValue(e.raw, v);
    if (newRaw === e.raw) continue;
    out.push({
      id: e.id,
      line: e.line,
      name: e.name,
      before: e.value,
      after: v,
      oldRaw: e.raw,
      newRaw
    });
  }
  return out.sort((a, b) => a.line - b.line);
}
