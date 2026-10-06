/**
 * 输入输出层。所有功能只从这里拿文件、往这里交结果。
 *
 * 两条路：
 *   · 桌面端（Tauri）—— 真路径、真读写，TGA/DDS 由 Rust 解
 *   · 浏览器（开发时 vite dev 直接开）—— 走 File System Access API，
 *     能选目录能写回，方便不等编译就调界面
 *
 * 浏览器那条不是给用户的，所以做不到的地方会明说"这个功能要在桌面端跑"，
 * 不假装能用。
 */
import { isTauri } from './open';
/* `img.ts` 不引本文件，所以静态引它不会绕成环 */
import { bitmapToImageData } from './img';

export { isTauri };

export type FileRef = {
  /** 桌面端是真路径；浏览器下是「根目录名/相对路径」这种可读的键 */
  path: string;
  name: string;
  rel: string;
  ext: string;
  size: number;
};

export type ScanResult = {
  root: string;
  rootName: string;
  files: FileRef[];
};

export type ImagePayload = {
  path: string;
  width: number;
  height: number;
  bitmap: ImageBitmap;
  srcFormat: string;
  srcBytes: number;
};

/* ------------------------------------------------------------ 浏览器侧的句柄表 */

type BrowserRef = { handle: FileSystemFileHandle; file: File };
const browserFiles = new Map<string, BrowserRef>();
const browserRoots = new Map<string, FileSystemDirectoryHandle>();

/** 浏览器模式有没有 File System Access API */
export function hasFsAccess(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

/**
 * Uint8Array → BlobPart。
 * 直接传会报错：TS 5.7 起 Uint8Array 的 buffer 类型是 ArrayBufferLike，
 * 可能落在 SharedArrayBuffer 上，而 Blob 只收 ArrayBuffer。
 * 切一份精确的区间出来，顺带避开 view 带偏移的情况。
 */
function blobPart(bytes: Uint8Array): BlobPart {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/* ------------------------------------------------------------ 选择 */

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'tga', 'bmp', 'gif', 'webp', 'tif', 'tiff', 'dds', 'ico'];

/** 选一批图片文件 */
export async function pickImages(multiple = true): Promise<FileRef[]> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const sel = await open({
      multiple,
      filters: [{ name: '贴图', extensions: IMAGE_EXTS }]
    });
    if (!sel) return [];
    const paths = Array.isArray(sel) ? sel : [sel];
    return paths.map((p) => refFromPath(p));
  }
  const handles = await browserPickFiles(IMAGE_EXTS, multiple);
  return handles;
}

/** 选一个文件夹，递归扫出里面的贴图 */
export async function pickAndScan(
  exts: string[] = IMAGE_EXTS,
  recursive = true
): Promise<ScanResult | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const dir = await open({ directory: true, multiple: false });
    if (!dir || Array.isArray(dir)) return null;
    const files = await scanDir(dir, exts, recursive);
    return { root: dir, rootName: baseName(dir), files };
  }
  if (!hasFsAccess()) return null;
  const root = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
  const files: FileRef[] = [];
  await walkBrowser(root, root.name, '', exts, files, recursive);
  browserRoots.set(root.name, root);
  return { root: root.name, rootName: root.name, files };
}

/**
 * 「用户选了一个工程目录」的回调。由 `recent.svelte.ts` 在求值时挂上。
 *
 * 为什么不在这里直接 `import` 最近工程那套：本文件是全站的地基，
 * 最近工程要用它（查目录在不在），它再用最近工程就是一个环。
 * 而且顶层 `import` 会绕成 `io → recent → io`；用 `await import()` 也绕不开，
 * 构建会报 INEFFECTIVE_DYNAMIC_IMPORT（这俩模块本来就被别处静态引着）。
 * 干脆反过来：本文件只认这个钩子，谁想记谁自己挂。
 */
let folderRecorder: ((path: string, label: string, href: string) => void) | null = null;

export function setFolderRecorder(
  fn: ((path: string, label: string, href: string) => void) | null
): void {
  folderRecorder = fn;
}

/**
 * 只选文件夹。
 *
 * 两个用途，参数区分：
 *   · `pickFolder()` —— 选**导出目标**。往哪儿写，不记进最近工程。
 *   · `pickFolder('批量提取', '/tools/channels?panel=pipeline')` —— 选**工程目录**。
 *     "在做什么"顺手记进最近工程，下次能一键回来。
 *
 * 为什么要调用方自己说清楚：同一个站内两种"选目录"混在一起，
 * 把导出目录也记成工程的话，最近工程那页会一半是 `_out` 这种临时目录。
 */
export async function pickFolder(label?: string, href?: string): Promise<string | null> {
  const dir = await pickFolderRaw();
  if (dir && label) 记工程目录(dir, label, href);
  return dir;
}

/**
 * 把「这就是现在打开的工程」报出去（记进最近工程 + 顶栏那颗 `当前工程`）。
 *
 * **给拖放那条路用。** 选目录那条路已经在 `pickFolder(label, href)` 里报了；
 * 而拖文件夹进来走的是落点（`dirdrop.ts` 的 `接目录`），**压根不经过 `pickFolder`** ——
 * 于是同一个目录，点按钮选它顶栏会变、拖进来不变（用户 2026-09-26 报的）。
 * 两处都走这一个出口，就不会再分叉。
 *
 * `label` 是"当时在干什么"，没给就不记（跟 `pickFolder` 的判据一致）。
 * 记录失败不该影响落点本身，所以吞掉。
 */
export function 记工程目录(path: string, label?: string, href?: string): void {
  if (!path || !label) return;
  try {
    folderRecorder?.(path, label, href ?? '');
  } catch {
    /* 记录失败不影响调用方 */
  }
}

async function pickFolderRaw(): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const dir = await open({ directory: true, multiple: false });
    if (!dir || Array.isArray(dir)) return null;
    return dir;
  }
  if (!hasFsAccess()) return null;
  const root = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
  browserRoots.set(root.name, root);
  return root.name;
}

/** 选保存路径（单个产物） */
export async function pickSavePath(
  defaultName: string,
  exts: string[] = ['png']
): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    return (await save({
      defaultPath: defaultName,
      filters: [{ name: exts.join(' / ').toUpperCase(), extensions: exts }]
    })) ?? null;
  }
  // 浏览器下没有"路径"，返回文件名让上层走下载
  return defaultName;
}

/**
 * 选一个**非图片**的文件（工程文件、配置之类的）。
 *
 * 跟 `pickImages` 分开：那条路会把文件塞进 `browserFiles` 当成可解码的图，
 * 而且过滤器写死成图片类型，选 `.redproj` 根本选不到。
 */
export async function pickFile(exts: string[], multiple = false): Promise<FileRef[]> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({
      multiple,
      filters: [{ name: exts.map((e) => e.toUpperCase()).join(' / '), extensions: exts }]
    });
    if (!picked) return [];
    return (Array.isArray(picked) ? picked : [picked]).map(refFromPath);
  }
  // 浏览器下走 input[type=file]，拿不到真路径，只能拿到名字 + 内容
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.accept = exts.map((e) => '.' + e).join(',');
    input.onchange = () => {
      const out = Array.from(input.files ?? []).map((f) => {
        const path = `浏览器/${f.name}`;
        browserFiles.set(path, { handle: null as any, file: f });
        return { path, name: f.name, rel: f.name, ext: extOf(f.name), size: f.size };
      });
      resolve(out);
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/** 读一个文本文件成字符串（工程文件、配置之类的） */
export async function readTextFile(path: string): Promise<string> {
  const f = browserFiles.get(path)?.file;
  if (f) return await f.text();
  const bytes = await readBytes(path);
  return new TextDecoder('utf-8').decode(bytes);
}

/** 写一段文本。走 save_bytes，覆盖前照例留 .bak */
export async function writeTextFile(path: string, text: string, backup = true): Promise<WriteReport> {
  return saveBytes(path, new TextEncoder().encode(text), backup);
}

function refFromPath(p: string): FileRef {
  const name = baseName(p);
  const dot = name.lastIndexOf('.');
  return {
    path: p,
    name,
    rel: name,
    ext: dot >= 0 ? name.slice(dot + 1).toLowerCase() : '',
    size: 0
  };
}

export function baseName(p: string): string {
  const s = p.replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
  return i >= 0 ? s.slice(i + 1) : s;
}

export function dirName(p: string): string {
  const s = p.replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
  return i > 0 ? s.slice(0, i) : '';
}

export function joinPath(a: string, b: string): string {
  if (!a) return b;
  const sep = a.includes('\\') ? '\\' : '/';
  return a.replace(/[\\/]+$/, '') + sep + b.replace(/^[\\/]+/, '');
}

export function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/* ------------------------------------------------------------ 浏览器实现 */

async function browserPickFiles(exts: string[], multiple: boolean): Promise<FileRef[]> {
  if (hasFsAccess()) {
    const handles: FileSystemFileHandle[] = await (window as any).showOpenFilePicker({
      multiple,
      types: [{ description: '贴图', accept: { 'image/*': exts.map((e) => '.' + e) } }]
    });
    const out: FileRef[] = [];
    for (const h of handles) {
      const f = await h.getFile();
      const path = `浏览器/${h.name}`;
      browserFiles.set(path, { handle: h, file: f });
      out.push({
        path,
        name: h.name,
        rel: h.name,
        ext: extOf(h.name),
        size: f.size
      });
    }
    return out;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.accept = exts.map((e) => '.' + e).join(',');
    input.onchange = () => {
      const out: FileRef[] = [];
      for (const f of Array.from(input.files ?? [])) {
        const path = `浏览器/${f.name}`;
        /* **必须存进 `browserFiles`**：下面 `loadImage` / `readRgba` 那几条路
           都是按 path 回这里取 `File` 的。原来只 push 了 FileRef、没存 ——
           于是在没有 File System Access API 的浏览器里选完图读不出来，
           报的还是"找不到这个文件"，看着像路径错了。 */
        browserFiles.set(path, { handle: null as any, file: f });
        out.push({ path, name: f.name, rel: f.name, ext: extOf(f.name), size: f.size });
      }
      resolve(out);
    };
    input.click();
  });
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

async function walkBrowser(
  dir: FileSystemDirectoryHandle,
  rootName: string,
  prefix: string,
  exts: string[],
  out: FileRef[],
  recursive: boolean
) {
  for await (const [name, handle] of (dir as any).entries()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      if (recursive) await walkBrowser(handle, rootName, rel, exts, out, recursive);
      continue;
    }
    const e = extOf(name);
    if (exts.length && !exts.includes(e)) continue;
    const file = await (handle as FileSystemFileHandle).getFile();
    const path = `${rootName}/${rel}`;
    browserFiles.set(path, { handle: handle as FileSystemFileHandle, file });
    out.push({ path, name, rel, ext: e, size: file.size });
  }
}

/* ------------------------------------------------------------ 扫描 */

export async function scanDir(
  root: string,
  exts: string[] = IMAGE_EXTS,
  recursive = true
): Promise<FileRef[]> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke('scan_dir', { root, exts, recursive })) as FileRef[];
  }
  const out: FileRef[] = [];
  const h = browserRoots.get(root);
  if (h) await walkBrowser(h, root, '', exts, out, recursive);
  return out;
}

/* ------------------------------------------------------------ 读图 */

/** 读一张图，解成 ImageBitmap 给 canvas 用 */
export async function loadImage(path: string): Promise<ImagePayload> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const r = (await invoke('read_image', { path })) as {
      width: number;
      height: number;
      png: string;
      src_format: string;
      src_bytes: number;
    };
    const bytes = base64ToBytes(r.png);
    const blob = new Blob([blobPart(bytes)], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    return {
      path,
      width: r.width,
      height: r.height,
      bitmap,
      srcFormat: r.src_format,
      srcBytes: r.src_bytes
    };
  }
  const f = browserFiles.get(path)?.file;
  if (!f) throw new Error(`浏览器模式下拿不到这个文件：${path}`);
  const bitmap = await createImageBitmap(f);
  return {
    path,
    width: bitmap.width,
    height: bitmap.height,
    bitmap,
    srcFormat: extOf(f.name),
    srcBytes: f.size
  };
}

/**
 * 只读像素：拿**没被动过的** RGBA 字节。
 *
 * 桌面端走 `read_rgba`，绕开 PNG + 画布那条 —— 浏览器画布是预乘 alpha 存的，
 * 读回来要反预乘，alpha 越小精度越差，alpha=0 的像素 RGB 直接归零。
 * 实测 `实战测试用例` 里的 `sample_hair_normal.png`：PIL 读 R 路 75 个不同取值，
 * 走画布读出来 197 个 —— 多出来的全是反预乘炸开的噪声。
 * 法线图正是最多带半透明的那种，所以"按某一路提数据"必须走这条。
 *
 * 浏览器里没有 Rust，只能退回画布那条路，返回值里标 `exact: false`。
 */
export async function readRgba(
  path: string
): Promise<{ width: number; height: number; data: ImageData; exact: boolean }> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const r = (await invoke('read_rgba', { path })) as {
      width: number;
      height: number;
      rgba: string;
    };
    const bytes = base64ToBytes(r.rgba);
    // 复制一份而不是包 view：`bytes.buffer` 的类型是 ArrayBufferLike（可能是
    // SharedArrayBuffer），ImageData 只认 ArrayBuffer，直接传过不了类型检查。
    const data = new ImageData(new Uint8ClampedArray(bytes), r.width, r.height);
    return { width: r.width, height: r.height, data, exact: true };
  }
  const p = await loadImage(path);
  const data = bitmapToImageData(p.bitmap);
  p.bitmap.close?.();
  return { width: data.width, height: data.height, data, exact: false };
}

/** 读二进制（前端自己解的格式，比如 .fx 里的东西） */
export async function readBytes(path: string): Promise<Uint8Array> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return base64ToBytes((await invoke('read_bytes', { path })) as string);
  }
  const f = browserFiles.get(path)?.file;
  if (!f) throw new Error(`拿不到这个文件：${path}`);
  return new Uint8Array(await f.arrayBuffer());
}

/* ------------------------------------------------------------ 写 */

export type WriteReport = { path: string; bytesWritten: number; backup: string | null };

/**
 * 存一张图。桌面端按扩展名交给 Rust 选格式（PNG/TGA/BMP/JPG），
 * 浏览器下一律下载 PNG。
 */
export async function saveImage(
  path: string,
  data: ImageData,
  backup = true
): Promise<WriteReport> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const raw = new Uint8Array(data.data.buffer, data.data.byteOffset, data.data.byteLength);
    const r = (await invoke('write_rgba_image', {
      path,
      width: data.width,
      height: data.height,
      rgbaB64: bytesToBase64(raw),
      backup
    })) as { path: string; bytes_written: number; backup: string | null };
    return { path: r.path, bytesWritten: r.bytes_written, backup: r.backup };
  }
  await browserDownload(path, data);
  return { path, bytesWritten: data.data.byteLength, backup: null };
}

/** 存任意二进制（PNG 编码好的、.fx 文本转的字节等） */
export async function saveBytes(
  path: string,
  bytes: Uint8Array,
  backup = true
): Promise<WriteReport> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const r = (await invoke('write_bytes', {
      path,
      b64: bytesToBase64(bytes),
      backup
    })) as { path: string; bytes_written: number; backup: string | null };
    return { path: r.path, bytesWritten: r.bytes_written, backup: r.backup };
  }
  const blob = new Blob([blobPart(bytes)]);
  downloadBlob(blob, baseName(path));
  return { path, bytesWritten: bytes.length, backup: null };
}

async function browserDownload(path: string, data: ImageData): Promise<void> {
  const cv = new OffscreenCanvas(data.width, data.height);
  const ctx = cv.getContext('2d')!;
  ctx.putImageData(data, 0, 0);
  const blob = await cv.convertToBlob({ type: 'image/png' });
  downloadBlob(blob, baseName(path));
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ------------------------------------------------------------ 文本 */

export type TextPayload = { text: string; encoding: string; lossy: boolean; bom: boolean };

export async function readText(path: string): Promise<TextPayload> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke('read_text_file', { path })) as TextPayload;
  }
  const f = browserFiles.get(path)?.file;
  if (!f) throw new Error(`拿不到这个文件：${path}`);
  return { text: await f.text(), encoding: 'utf-8', lossy: false, bom: false };
}

export type RepairAttempt = { via: string; score: number; text: string };

/**
 * 一段乱码的**交代**：候选、增益、以及为什么没自动改。
 *
 * 存在的理由就是用户那句"别给我丢回乱码"：够不着门槛时也要把候选摆出来，
 * 让人点「就用这个」——只有 `候选` 是空的才算真修不了。
 */
export type SegmentReport = {
  run: string;
  base: number;
  /** 这一段用的门槛（短串严、长串松） */
  门槛: number;
  gain: number;
  /** 假名占比上升多少（中文被读坏的样子几乎不涨） */
  假名上升: number;
  半角片假名: boolean;
  via: string;
  候选: RepairAttempt[];
  /** 自动采用了第几个候选；null = 没自动改 */
  applied: number | null;
  原因: string;
};

export type RepairResult = {  original: string;
  fixed: string;
  changed: boolean;
  via: string;
  score_after: number;
  score_before: number;
  attempts: RepairAttempt[];
  segments: SegmentReport[];
};

/**
 * 修一段乱码文本。编码转换只有桌面端做得了。
 *
 * `目标编码` = 操作者在 ① 文本栏选的那一档（"原文是什么日文编码"）：
 * `'自动认'` / 不传 = 三路一起试、按分数挑（老行为）；指定了就只试那一路。
 */
export async function repairText(text: string, 目标编码?: string): Promise<RepairResult> {
  if (!isTauri()) {
    throw new Error('编码转换要在桌面端跑：浏览器里的 TextEncoder 只会 UTF-8，编不回 GBK。');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('repair_text', { text, 目标编码: 目标编码 ?? null })) as RepairResult;
}

/**
 * 按用户选的候选修：`强制` 是 `[第几段, 用第几个候选]` 的列表。
 *
 * 界面上的「就用这个」走这条 —— 自动判据够不着门槛时，人也能把这一段修回来。
 * `mode` 跟还原那条一致：`.fx` 传 `fx-comments`，那时只会在注释正文里应用，
 * 代码行一个字符都不碰。
 *
 * **`目标编码` 必须跟列表生成时用的是同一个** —— 候选下标是按那次的候选表算的，
 * 换一档就对不上号了。
 */
export async function repairTextForced(
  text: string,
  强制: [number, number][],
  mode: 'whole' | 'fx-comments' = 'whole',
  目标编码?: string
): Promise<RepairResult> {
  if (!isTauri()) {
    throw new Error('编码转换要在桌面端跑：浏览器里的 TextEncoder 只会 UTF-8，编不回 GBK。');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('repair_text_forced', {
    text,
    强制,
    mode,
    目标编码: 目标编码 ?? null
  })) as RepairResult;
}

/* ------------------------------------------------------------ 名字还原 */

export type NameHit = {
  path: string;
  dir: string;
  原名: string;
  修后名: string;
  自动可改: boolean;
  原因: string;
  候选: RepairAttempt[];
};

/** 扫目录树里的**名字**（文件/目录名像乱码的挑出来）。 */
export async function scanNames(root: string, limit?: number, 目标编码?: string): Promise<NameHit[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('scan_names', {
    root,
    limit: limit ?? null,
    目标编码: 目标编码 ?? null
  })) as NameHit[];
}

export type RenamePair = { from: string; to: string };
export type RenameReport = {
  done: RenamePair[];
  failed: { from: string; 原因: string }[];
};

/**
 * 改名。**不覆盖同名**：目标已经存在就跳过并说明。
 * 返回的 `done` 就是改名日志，回滚时原样交给 `undoRenames`。
 */
export async function renameEntries(计划: RenamePair[]): Promise<RenameReport> {
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('rename_entries', { 计划 })) as RenameReport;
}

/** 改名回滚：把日志里的 from→to 反过来做一遍。 */
export async function undoRenames(日志: RenamePair[]): Promise<RenameReport> {
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('undo_renames', { 日志 })) as RenameReport;
}

export type FixedText = {
  /** 还原后的全文 */
  text: string;
  /** 读进来时的原文 */
  original: string;
  encoding: string;
  bom: boolean;
  changed: boolean;
  /** 逐段的交代（够不着门槛时界面要摆候选） */
  segments: SegmentReport[];
};

/**
 * 读一个文件、还原完、把全文给出来。
 *
 * 跟 `fixTextFile` 的分工：那条只回"改了哪几行"，够批量用；这条要全文 ——
 * ① 那一页要拿还原后的日文接着翻中文。
 */
export async function readTextFixed(
  path: string,
  mode: 'whole' | 'fx-comments' = 'whole',
  /* 用户选的日文编码。**原来这条没有这个参数** —— 于是"选文件"这条路上，
     界面上选的编码一次都没生效（2026-09-24 修）。四栏口径要一致。 */
  目标编码?: string
): Promise<FixedText> {
  if (!isTauri()) throw new Error('编码转换要在桌面端跑。');
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('read_text_fixed', { path, mode, targetEncoding: 目标编码 })) as FixedText;
}

export type FileTextResult = {
  path: string;
  rel: string;
  encoding: string;
  changed: boolean;
  via: string;
  lines: number[];
  before_sample: string;
  after_sample: string;
  written: boolean;
  backup: string | null;
  error: string | null;
};

/**
 * 修一个文本文件。
 *
 * `outPath` 给了就**另存到那儿**，原文件一个字节都不动；不给就原地改，改前留 `.bak`。
 * 另存的时候父目录不存在会自动建，跨盘也行。
 */
export async function fixTextFile(
  path: string,
  write: boolean,
  mode: 'whole' | 'fx-comments' = 'whole',
  encoding?: string,
  outPath?: string,
  目标编码?: string
): Promise<FileTextResult> {
  if (!isTauri()) throw new Error('编码转换要在桌面端跑。');
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('fix_text_file', {
    path,
    write,
    mode,
    encoding: encoding ?? null,
    outPath: outPath ?? null,
    目标编码: 目标编码 ?? null
  })) as FileTextResult;
}

export type ScanHit = {
  path: string;
  rel: string;
  likely: boolean;
  via: string;
  sample_before: string;
  sample_after: string;
  /** 看着像乱码、但没自动改的段（有候选）。批量默认不敢动，但要摆出来让人挑 */
  uncertain: SegmentReport[];
};

export async function scanTextFiles(root: string, exts: string[], 目标编码?: string): Promise<ScanHit[]> {
  if (!isTauri()) throw new Error('编码识别要在桌面端跑。');
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('scan_text_files', { root, exts, 目标编码: 目标编码 ?? null })) as ScanHit[];
}

/* ------------------------------------------------------------ 翻译（外接引擎） */

/**
 * 取一个文件里可翻译的段落。
 *
 * `mode` 跟还原那条路同一个口径：`fx-comments` 只给注释正文（Rust 里跟还原共用一份扫描），
 * 其它值整篇算一段。段落是**原文**，翻完要用 `applyPieces` 按原位写回。
 */
export async function scanPieces(text: string, mode: 'whole' | 'fx-comments'): Promise<string[]> {
  if (!isTauri()) throw new Error('段落切分要在桌面端跑。');
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('scan_pieces', { text, mode })) as string[];
}

/** 把译文按原位写回。段落数对不上会抛错 —— 不许错位写进文件。 */
export async function applyPieces(
  text: string,
  mode: 'whole' | 'fx-comments',
  translations: string[]
): Promise<string> {
  if (!isTauri()) throw new Error('写回要在桌面端跑。');
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('apply_pieces', { text, mode, translations })) as string;
}

export type TranslateReply = { ok: boolean; translations: string[]; error: string | null };

/**
 * 发一次翻译请求。配置每次传进去，后端不落盘。
 *
 * 离线（`kind = 'off'`）的时候**不要**调这个 —— 那条规矩在前端那层守卫里
 * （`$lib/translate.ts` 的 `翻段落`，有测试钉住"离线下一次请求都不发"）。
 */
export async function translateText(
  engine: { kind: string; baseUrl: string; model: string; apiKey: string; timeoutMs: number },
  texts: string[]
): Promise<TranslateReply> {
  if (!isTauri()) throw new Error('翻译请求要在桌面端跑。');
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('translate_text', {
    engine: engine.kind,
    baseUrl: engine.baseUrl,
    model: engine.model,
    apiKey: engine.apiKey,
    timeoutMs: engine.timeoutMs,
    texts
  })) as TranslateReply;
}

/* ------------------------------------------------------------ PMX */

export type PmxMaterial = {
  index: number;
  name: string;
  name_en: string;
  texture: string | null;
  texture_index: number;
  sphere_texture: string | null;
  sphere_index: number;
  sphere_mode: number;
  toon_index: number;
  toon_shared: boolean;
  face_count: number;
  draw_flag: number;
  diffuse: [number, number, number, number];
  specular: [number, number, number];
  specular_power: number;
  ambient: [number, number, number];
  edge_size: number;
  kind: string;
};

export type PmxInfo = {
  path: string;
  version: number;
  encoding: string;
  name: string;
  name_en: string;
  vertex_count: number;
  face_count: number;
  texture_count: number;
  material_count: number;
  bone_count: number;
  morph_count: number;
  textures: string[];
  materials: PmxMaterial[];
  notes: string[];
};

export async function readPmx(path: string): Promise<PmxInfo> {
  if (!isTauri()) throw new Error('PMX 解析要在桌面端跑。');
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('read_pmx', { path, materialLimit: null })) as PmxInfo;
}

export async function probeDir(path: string) {
  if (!isTauri()) return { exists: false, is_dir: false, entries: 0, names: [] as string[] };
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('probe_dir', { path })) as {
    exists: boolean;
    is_dir: boolean;
    entries: number;
    names: string[];
  };
}

export async function findFile(root: string, target: string, depth = 4): Promise<string | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('find_file', { root, target, depth })) as string | null;
}

/* ---------------- ⑥ 工程迁移打包 ---------------- */

export type 工程对象 = {
  key: string;
  kind: 'model' | 'accessory';
  index: number;
  path: string;
};

export type 工程特效 = {
  key: string;
  material: number | null;
  field: string | null;
  path: string;
};

export type 工程贴图 = { pmx: string; index: number; path: string; exists: boolean };

export type 工程命中 = {
  key: string;
  offset: number;
  /** 这条路径在 `.pmm` 里**所有**字段的偏移（含残留的旧字段）；改写时全都要写 */
  全部: number[];
  path: string;
  怎么找到的: string;
  /** `.pmm` 条目里写的名字（模型 = 长度前缀名字；附件 = 100 字节名字区） */
  名称: string;
};

export type 工程扫描 = {
  pmm: string;
  emm: string;
  objects: 工程对象[];
  effects: 工程特效[];
  在盘上: boolean[];
  /** 打包后会落在输出目录的哪个相对路径（规则只在 Rust 里一份） */
  目标: string[];
  pmm_hits: 工程命中[];
  问题: string[];
  textures: 工程贴图[];
  /** A 用：模型各自散在哪些目录里 */
  模型目录: 工程目录组[];
  /** A 用：附件各自散在哪些目录里 */
  附件目录: 工程目录组[];
  /** B 用：条目链成立才允许摘条目 */
  能摘: boolean;
  /** 不能摘的原因（空串 = 能） */
  摘拦: string;
};

export type 工程目录组 = { 目录: string; 条数: number; 有: number };

export type 工程搬家行 = {
  key: string;
  类别: string;
  旧: string;
  新: string;
  新位置有: boolean;
  定位: string;
  /** `指到新位置` / `保持原路径` / `找不到` */
  处置: string;
  /** `.pmm` 里现在写的名字（模型才有） */
  名称: string;
  /** 要改成的新名字（没改就是空串） */
  新名: string;
};

export type 工程搬家结果 = {
  表: 工程搬家行[];
  改了几处: number;
  /** 改了几个模型名字（只支持等长改名） */
  改名几处: number;
  输出: string;
  问题: string[];
  干跑: boolean;
};

export type 工程摘掉 = {
  key: string;
  类别: string;
  路径: string;
  起: number;
  止: number;
  为什么: string;
};

export type 工程摘结果 = {
  去掉: 工程摘掉[];
  留: number;
  旧模型数: number;
  新模型数: number;
  emm去行: number;
  emm改号: number;
  pmm原字节: number;
  pmm新字节: number;
  输出: string;
  问题: string[];
  干跑: boolean;
};

export async function 扫工程(pmm: string, emm: string): Promise<工程扫描> {
  if (!isTauri()) throw new Error('工程迁移要在桌面端跑。');
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('扫', { pmm, emm })) as 工程扫描;
}

/**
 * 根替换：工程里的路径指向**别的机器上的根**（本机没有那个盘/目录）时，把整段前缀换掉。
 *
 * 与 `搬家工程` 的分工：`搬家工程` 是"素材挪到一个新目录了，按文件名指过去"；
 * 根替换是"**相对结构要保持原样**、只把根换掉" —— 真工程里模型散在 6 个目录、贴图就在模型旁边，
 * 只有保留结构才不会把贴图引用打断（`香港观塘 夜间 2.1` 上实测 119/119 靠结构才对）。
 */
export type 工程根组 = {
  /** 一个旧根，形如 `D:\MMD一键渲染工程项目` */
  根: string;
  条数: number;
  例: string[];
  /** 从工程目录往上试出来的候选新根（空 = 没试出来，让用户自己填） */
  建议: string;
  建议命中: number;
  /** 这个根下有多少条**按原样就在盘上**（= 条数 说明这个根没坏） */
  在盘条数: number;
};

export type 工程搬根结果 = {
  根表: [string, string][];
  emm改行: number;
  pmm改字段: number;
  /** 盘上回读：旧根 → 还剩几次（必须全 0） */
  旧根残留: [string, number][];
  新根出现: [string, number][];
  pmm长度: number;
  emm长度: number;
  原先pmm长度: number;
  原先emm长度: number;
  输出: string;
  干跑: boolean;
  问题: string[];
  /* ---- 自带（打包迁移）模式才填的计数。**必须带回结果**：不填界面会显示"拷了 0 个文件"。
     名字**照后端 `搬根结果` 的字段名写**（原来写的是 `拷贝文件数`，后端叫 `拷贝文件` ——
     两个名字对不上，界面就恒读成 undefined、一直报"拷了 0 个文件"）。 */
  拷贝文件?: number;
  拷贝字节?: number;
  重名冲突?: string[];
  /** 产物里每条路径（路径, 在盘上吗）（自带模式才填） */
  产物路径?: [string, boolean][];
};

export async function 找工程根(pmm: string, emm: string): Promise<工程根组[]> {
  if (!isTauri()) throw new Error('工程迁移要在桌面端跑。');
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('找根', { pmm, emm })) as 工程根组[];
}

export type 工程路径行 = {
  /** 所在段：`Object` / `Effect` / `Effect@FogMap` … */
  段: string;
  键: string;
  原路径: string;
  在盘上: boolean;
  根: string;
  /** 按现在的规则算出来的目标路径（空 = 没落定） */
  目标: string;
  /** `原位在` / `已按根找到` / `已逐条指定` / `需要指定` / `找不到` */
  状态: string;
};

/**
 * 列出工程里**每一处**绝对路径 + 状态（界面出表用）。
 *
 * `根表` 是批量层、`逐条` 是单条覆盖层；覆盖按"旧串更长优先"命中，
 * 所以**逐条指定永远压过根规则**（用户改过的那条不会被根规则改回去）。
 */
export async function 列工程路径(
  pmm: string,
  emm: string,
  根表: [string, string][],
  逐条: [string, string][]
): Promise<工程路径行[]> {
  if (!isTauri()) throw new Error('工程迁移要在桌面端跑。');
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('列路径', { pmm, emm, 根表, 逐条 })) as 工程路径行[];
}

export async function 根替换工程(
  pmm: string,
  emm: string,
  根表: [string, string][],
  输出: string,
  干跑: boolean,
  逐条: [string, string][] = []
): Promise<工程搬根结果> {
  if (!isTauri()) throw new Error('工程迁移要在桌面端跑。');
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('搬根', { pmm, emm, 根表, 逐条, 输出, 干跑 })) as 工程搬根结果;
}

/**
 * 自包含打包：**和 `根替换工程` 同一条链**，只多一个"把素材也拷进去"的开关。
 *
 * 跟老的那条平铺打包器（`打包工程` → `project::打包`）的区别是**保结构**：
 * 按"新根 + 原相对尾部"拷（例如 `…\UserFile\ray-mmd-1.5.2\...` 整段留着），
 * 模型旁边的贴图才找得到 —— 平铺会把贴图引用全打断（实测 119/119 条贴图靠相对结构才对得上）。
 *
 * `配布` = 打包的两种情形（用户 2026-09-23 要求显式选）：
 *   · false = **本机内打包**：包内工程文件写"包内的本机绝对路径"（在这台机器上直接能开）；
 *   · true  = **配布打包**：包内写"相对包根"的路径（`.\模型\x.pmx`，一个盘符都不带），
 *     并附一份 `配布说明.txt`。MMD 各版本对相对路径的接受度本工程**没有在真 MMD 上验过**。
 */
export async function 自包含工程(
  pmm: string,
  emm: string,
  根表: [string, string][],
  输出: string,
  干跑: boolean,
  逐条: [string, string][] = [],
  配布 = false
): Promise<工程搬根结果> {
  if (!isTauri()) throw new Error('工程迁移要在桌面端跑。');
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('搬根自带', { pmm, emm, 根表, 逐条, 输出, 干跑, 配布 })) as 工程搬根结果;
}

export type 工程检索行 = {
  /** 工程里写的那条（可能已经死了） */
  原路径: string;  文件名: string;
  /** 在搜索起点里找到的候选（按"尾部还能对上几段"排序） */
  候选: string[];
  /** 建议用哪个（**唯一最优**才有；并列或没找到 = 空） */
  建议: string;
  /** `已唯一找到` / `多个候选` / `没找到` */
  状态: string;
  备注: string;
};

/**
 * 检索：从若干**搜索起点**里，按文件名把挪走的文件找出来。
 *
 * 用户原话"**让其检索移动后的文件的位置**"就是这条 —— 工程里的路径死了，
 * 人不必一条条指：给几个搜索起点目录（可以多选：模型在 A 盘、特效在 B 盘），
 * 唯一最优的直接给建议，并列的把候选摆出来让人挑（**不许猜**）。
 *
 * **不许把界面卡住**（用户实测"起点选到 `D:\` 就卡死"）：这条命令在后端是 `async` 的
 * （不在渲染线程上跑），递归还有层数/条目/时间三条上限 —— 超了后端直接返回
 * 「范围太大，请给更具体的起点」。进度由 `查扫描进度()` 轮询，`取消扫描()` 能停下它。
 */
export async function 检索工程文件(
  pmm: string,
  emm: string,
  根表: [string, string][],
  逐条: [string, string][],
  起点: string[]
): Promise<工程检索行[]> {
  if (!isTauri()) throw new Error('工程迁移要在桌面端跑。');
  if (!起点.length) throw new Error('先加一个搜索起点目录。');
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('检索', { pmm, emm, 根表, 逐条, 起点 })) as 工程检索行[];
}

/** 后端报上来的扫描进度（轮询用） */
export type 扫描进度 = {
  /** 已经看过几个文件 */
  已看: number;
  /** 已经跑了多少毫秒 */
  毫秒: number;
  /** 现在在哪个起点 */
  在哪: string;
};

export async function 查扫描进度(): Promise<扫描进度 | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const r = (await invoke('查进度')) as 扫描进度 | null;
  return r ?? null;
}

/** 停掉正在跑的那一趟递归扫描（取消位在下一趟命令入口会被清掉） */
export async function 取消扫描(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('取消扫描');
}

/** 这是不是那条"范围太大"的错误（界面按它决定怎么说话） */
export function 是范围太大(e: unknown): boolean {
  const t = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
  return t.includes('范围太大');
}

/** 把后端抛出来的东西变成一句话（Tauri 拒绝时给的是字符串，不是 Error） */
export function 差错话(e: unknown): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
}

export type 工程搬运结果 = {
  /** 拷过去多少个文件 / 多少字节 */
  拷贝文件: number;
  拷贝字节: number;
  /** 「搬」模式下删掉的原件数（只在**逐个字节核对相同**之后才删） */
  删除文件: number;
  重名冲突: string[];
  目标表: [string, string][];
  说明: string[];
  根结果: 工程搬根结果;
};

/**
 * **搬运**：真的把文件搬/拷到（**可以多个**）指定位置，再把工程里的路径改过去并保存。
 *
 * 用户原话："看一眼要动哪些文件后，对文件都在的情况可以选择将**文件迁移**到指定位置
 * （**单选或多选都可以**）然后保存，工程文件迁移也可以做到修复"。
 *
 * `目标表` = 旧前缀 → 目标目录（可以多组：模型放 A、特效放 B）；
 * `方式` = `'拷'`（默认，保留原件）/ `'搬'`（拷完逐字节核对相同再删原件）；
 * `干跑` = true 时只报"会拷多少"，不碰盘。
 */
export async function 搬运工程(
  pmm: string,
  emm: string,
  目标表: [string, string][],
  方式: '拷' | '搬',
  干跑: boolean,
  逐条: [string, string][] = []
): Promise<工程搬运结果> {
  if (!isTauri()) throw new Error('工程迁移要在桌面端跑。');
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('搬运工程', { pmm, emm, 目标表, 逐条, 方式, 干跑 })) as 工程搬运结果;
}

/* ---------------- 撤销（照上一次的操作记录反着做） ---------------- */

export type 记录件 = { 路径: string; 备份: string; 字节: number; 校验: number };
export type 记录目录对 = { 源: string; 目标: string; 目标本来就在: boolean };
export type 原件动过 = { 原: string; 新: string; 字节: number; 校验: number };

export type 操作记录 = {
  版本: number;
  时间: number;
  人话: string;
  动作: string;
  方式: string;
  pmm: string;
  emm: string;
  改前: 记录件[];
  产物: 记录件[];
  目录对: 记录目录对[];
  原件: 原件动过[];
  已撤销: boolean;
  文件: string;
};

export type 撤销条目 = { 做什么: string; 从: string; 到: string; 备注: string };

export type 撤销结果 = {
  干跑: boolean;
  时间: number;
  动作: string;
  方式: string;
  人话: string;
  /** 先出的那张表：撤销会做什么 */
  条目: 撤销条目[];
  /** 预检不过的（有一条就不许执行） */
  问题: string[];
  /** 执行后的回读核对 */
  回读: string[];
  写回: number;
  删目录: number;
  搬回: number;
};

/** 最近一份还没撤销的记录；没有就是 `null`（界面据此禁用「撤销」）。 */
export async function 待撤销(): Promise<操作记录 | null> {
  if (!isTauri()) throw new Error('工程迁移要在桌面端跑。');
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('待撤销')) as 操作记录 | null;
}

/**
 * 撤销上一次处理。`干跑 = true` **只预检、只出表**，一个字节都不动（界面先给用户看的就是它）。
 * 没有记录会抛错（"没有可撤销的记录"），绝不"尽力还原"。
 */
export async function 撤销工程(干跑: boolean): Promise<撤销结果> {
  if (!isTauri()) throw new Error('工程迁移要在桌面端跑。');
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('撤销工程', { 干跑 })) as 撤销结果;
}

/**
 * A：把工程里的路径指到新位置（**不拷贝文件** —— 素材用户自己挪过去的）。
 * `模型目录` / `附件目录` 是新位置；`输出` 空串 = 原地改（先留 `.bak`）。
 * `改名` 是"模型键 → 新名字"，**只支持等长**（长度变了会被后端拒绝，理由见 `project.rs`）。
 */
export async function 搬家工程(
  pmm: string,
  emm: string,
  模型目录: string,
  附件目录: string,
  输出: string,
  干跑: boolean,
  改名?: Record<string, string>
): Promise<工程搬家结果> {
  if (!isTauri()) throw new Error('工程迁移要在桌面端跑。');
  const { invoke } = await import('@tauri-apps/api/core');
  const 名 = 改名 && Object.keys(改名).length ? 改名 : null;
  return (await invoke('搬家', {
    pmm,
    emm,
    模型目录,
    附件目录,
    输出,
    干跑,
    改名: 名
  })) as 工程搬家结果;
}

/** B：把盘上找不到的条目从工程里摘掉，剩下的照常保存（附件不做、最后一条不做） */
export async function 摘丢失条目(
  pmm: string,
  emm: string,
  输出: string,
  干跑: boolean
): Promise<工程摘结果> {
  if (!isTauri()) throw new Error('工程迁移要在桌面端跑。');
  const { invoke } = await import('@tauri-apps/api/core');
  return (await invoke('摘丢失', { pmm, emm, 输出, 干跑 })) as 工程摘结果;
}
