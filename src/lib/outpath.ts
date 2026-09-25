/**
 * 输出路径的拼法。批量写盘的东西都走这里 —— 乱码修复、贴图批处理。
 *
 * 单独一个文件是为了能在 Node 里单测：模板拼路径这种东西错一个字符，
 * 用户拿到的是几百个文件名不对的文件，而且界面上看着"成功"。
 */

/** 模板里能用的占位符。留着 `{}` 是为了好打，不用记 shell 那套语法 */
export const TEMPLATE_KEYS = ['name', 'ext', 'rel', 'dir'] as const;

export const TEMPLATE_HINT =
  '{name} 原文件名（不带后缀）、{ext} 后缀、{rel} 相对子目录、{dir} 原目录名';

export type PathParts = {
  /** 文件名（带后缀），比如 `model.fx` */
  name: string;
  /** 相对根目录的子目录，比如 `Materials\\toon`；没有就是空串 */
  rel: string;
};

/** 去掉最后的扩展名。`.fxsub` 这种多重后缀按最后一个点切，跟常规做法一致 */
function stem(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1) : '';
}

/** 路径最后那一段（文件名）。不引 `io.ts` 的版本 —— 那个文件要浏览器 API，这个模块要保持纯的 */
export function baseName(p: string): string {
  const s = p.replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
  return i >= 0 ? s.slice(i + 1) : s;
}

/**
 * **同目录同名、只加后缀** —— 全工程唯一一份。
 *
 * 为什么不能写成 `dirName()` + `joinPath()`：那两步分开判，而 `joinPath` 靠"目录串里有没有
 * 反斜杠"猜分隔符，传进来一个单段相对目录（`M`）就会给出 `M/xxx` —— 目录名里恰好没有
 * 反斜杠时就判错了（`pipeline.ts` 的注释里记着这个坑）。这里按**原串**切一刀，
 * 原来用的是什么分隔符就还是什么。
 *
 * 原来五处各写各的：`wb.svelte.ts` 的 `outPathNear`（dirName+joinPath 那一版）、
 * `pipeline.ts` 的 `sibling`（避开坑的那一版）、`batch.ts` 的 `batchOutNames`、
 * `Extract.svelte` 的七处 `split(...).pop()`、以及这个模块的模板那一路。
 */
export function siblingPath(path: string, suffix: string, 后缀名 = 'png'): string {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  const dir = cut >= 0 ? path.slice(0, cut + 1) : '';
  return `${dir}${stem(baseName(path))}${suffix}.${后缀名}`;
}

/** 相对子目录的末段 */
function leafDir(rel: string): string {
  const s = rel.replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
  return i >= 0 ? s.slice(i + 1) : s;
}

/**
 * 套模板。**只处理模板本身，不拼根目录** —— 根目录是调用方给的，
 * 这样这个函数是纯的，好测。
 *
 * 认不出来的 `{xxx}` 原样留着而不是丢掉：用户打错了应该看得见，
 * 悄悄删掉会让他拿到一批名字莫名少一截的文件。
 */
export function applyTemplate(tpl: string, parts: PathParts): string {
  const name = parts.name;
  const table: Record<string, string> = {
    name: stem(name),
    ext: ext(name),
    rel: parts.rel,
    dir: leafDir(parts.rel)
  };
  return tpl.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = table[key];
    return v === undefined ? whole : v;
  });
}

/**
 * 相对子目录保留不保留。
 *
 * 保留的话，`Materials\toon\a.fx` 会写成 `<输出目录>\Materials\toon\a.fx`；
 * 不保留就全平铺到输出目录根下 —— 平铺会把同名文件撞在一起，
 * 所以默认保留。
 */
export function isAbsolutePath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/');
}

/** 目录拼文件，分隔符跟着目录走 */
export function joinOut(dir: string, sub: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  const d = dir.replace(/[\\/]+$/, '');
  const s = sub.replace(/^[\\/]+/, '');
  return `${d}${sep}${s}`;
}

/**
 * 算一个条目要写到哪儿。
 *
 * `outDir` 为空 = 原地改，返回空串（让调用方走"不传 out_path"那条路）。
 */
export function outPathFor(
  outDir: string,
  parts: PathParts,
  tpl: string,
  keepTree: boolean
): string {
  if (!outDir) return '';
  const fileName = applyTemplate(tpl, parts);
  if (!keepTree || !parts.rel) return joinOut(outDir, fileName);
  // 模板里已经用了 {rel} 的话就别再拼一层，不然会重复
  if (tpl.includes('{rel}') || tpl.includes('{dir}')) return joinOut(outDir, fileName);
  return joinOut(outDir, joinOut(parts.rel, fileName));
}
