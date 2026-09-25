/**
 * 自己导入的壁纸。
 *
 * 存在 IndexedDB 里 —— localStorage 装不下（一张 1920 的 JPEG 转 base64 就 400KB，
 * 上限才 5MB）。IDB 能直接存 Blob，没有这个限制。
 *
 * 导入时用 canvas 压一遍（宽 1920、JPEG q85），顺便量平均亮度，
 * 这样自定义壁纸和内置那 9 张吃的是同一套自适应遮罩逻辑。
 *
 * 等 Tauri 的文件对话框接进来之后，这里可以改成「复制到 appdata + 存路径」，
 * 上层接口不用动。
 */

const DB = 'robin.bg';
const STORE = 'images';
const MAX_W = 1920;
const Q = 0.85;

// 遮罩范围，和 tools/import_wallpapers.py 里保持一致
const SCRIM_MIN = 0.03;
const SCRIM_MAX = 0.16;

export type CustomBg = {
  id: string;
  name: string;
  blob: Blob;
  w: number;
  h: number;
  luma: number;
  scrim: number;
  added: number;
};

/** id → objectURL。渲染用，删的时候要 revoke */
const urls = new Map<string, string>();

export const customBgs = $state<CustomBg[]>([]);

let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      })
  );
}

export function urlOf(id: string): string {
  if (urls.has(id)) return urls.get(id)!;
  const item = customBgs.find((b) => b.id === id);
  if (!item) return '';
  const u = URL.createObjectURL(item.blob);
  urls.set(id, u);
  return u;
}

/** 把图压到 MAX_W、转 JPEG，顺便量亮度 */
async function process(file: File): Promise<{ blob: Blob; w: number; h: number; luma: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_W / bitmap.width);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);

  // 平均亮度：缩到 128 再读像素，够准也够快
  const lc = document.createElement('canvas');
  lc.width = lc.height = 128;
  const lctx = lc.getContext('2d')!;
  lctx.drawImage(bitmap, 0, 0, 128, 128);
  const px = lctx.getImageData(0, 0, 128, 128).data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) {
    // 相对亮度（感知权重）
    sum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
  }
  const luma = sum / (px.length / 4);
  bitmap.close?.();

  const blob = await new Promise<Blob>((res, rej) =>
    cv.toBlob((b) => (b ? res(b) : rej(new Error('编码失败'))), 'image/jpeg', Q)
  );
  return { blob, w, h, luma };
}

export async function load() {
  const all = await tx<CustomBg[]>('readonly', (s) => s.getAll() as IDBRequest<CustomBg[]>);
  all.sort((a, b) => a.added - b.added);
  customBgs.length = 0;
  customBgs.push(...all);
}

export async function add(file: File, name?: string) {
  const { blob, w, h, luma } = await process(file);
  const item: CustomBg = {
    id: `cu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: name || file.name.replace(/\.[^.]+$/, '').slice(0, 20),
    blob,
    w,
    h,
    luma,
    scrim: +(SCRIM_MIN + (SCRIM_MAX - SCRIM_MIN) * luma).toFixed(3),
    added: Date.now()
  };
  await tx('readwrite', (s) => s.put(item));
  customBgs.push(item);
  return item;
}

export async function addMany(files: FileList | File[]) {
  const out: CustomBg[] = [];
  for (const f of Array.from(files)) {
    if (!f.type.startsWith('image/')) continue;
    try {
      out.push(await add(f));
    } catch (e) {
      console.warn('[bg] 导入失败', f.name, e);
    }
  }
  return out;
}

export async function rename(id: string, name: string) {
  const it = customBgs.find((b) => b.id === id);
  if (!it) return;
  it.name = name.slice(0, 20) || it.name;
  await tx('readwrite', (s) => s.put({ ...it }));
}

export async function remove(id: string) {
  await tx('readwrite', (s) => s.delete(id));
  const u = urls.get(id);
  if (u) {
    URL.revokeObjectURL(u);
    urls.delete(id);
  }
  const i = customBgs.findIndex((b) => b.id === id);
  if (i >= 0) customBgs.splice(i, 1);
}

/** 内置壁纸的亮度表在 bg-meta.json 里；自定义的从 IDB 里的 luma 取 */
export function customMeta(id: string) {
  return customBgs.find((b) => b.id === id) ?? null;
}
