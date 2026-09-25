/**
 * 工作台的图片槽状态。七个功能都是"放几张图进来 → 调 → 导出"，
 * 每个功能各写一遍加载/预览/错误处理就会长歪。
 *
 * 用法：
 *   const slots = new Slots('channels.split', [{ id: 'src', label: '源图' }]);
 *   slots.get('src').data      // ImageData | null
 *   await slots.pick('src')
 */
import type { FileRef } from './io';
import { readRgba, pickImages, baseName, stemOf, dirName, joinPath } from './io';
import { siblingPath } from './outpath';
import { bitmapToImageData, imageDataToUrl, type ChannelKey } from './img';
import type { DropGroup } from './drop';

export type Slot = {
  id: string;
  label: string;
  ref: FileRef | null;
  data: ImageData | null;
  url: string | null;
  error: string | null;
  loading: boolean;
  /** 源文件尺寸，导出时按它对齐 */
  size: string;
  /** 解出来的原始格式（tga / png / jpg…），界面上标一下 */
  srcFormat: string;
};

export type SlotDef = { id: string; label: string };

/**
 * 一组图片槽。七个功能都是"放几张图进来 → 调 → 导出"，
 * 每个功能各写一遍加载/预览/错误处理就会长歪。
 *
 * 它同时就是拖放要的那一份契约（`DropGroup`）：`key` + `defs` + 三件事
 * （问哪格有图、按路径填、按 File 填）。`Slot` 只认这份契约，不认具体模块。
 */
export class Slots implements DropGroup {
  map = $state<Record<string, Slot>>({});
  /** 最近一次操作失败的原因，界面顶上挂一条 */
  lastError = $state<string | null>(null);

  /** 拖放的组名。同一个模块里几组槽要各不相同，重名就会串台 */
  readonly key: string;

  constructor(key: string, defs: SlotDef[]) {
    this.key = key;
    this.defs = defs;
    for (const d of defs) {
      this.map[d.id] = {
        id: d.id,
        label: d.label,
        ref: null,
        data: null,
        url: null,
        error: null,
        loading: false,
        size: '',
        srcFormat: ''
      };
    }
  }

  /** 本组有哪几格，按声明顺序。界面上的摆放顺序由 DOM 说了算 */
  defs: SlotDef[];

  /** 这一格有图没有。多文件拖进来时决定先铺空槽还是从头盖 */
  loaded(id: string): boolean {
    return !!this.map[id]?.data;
  }

  /** 拖放下来的文件解不了时往哪儿报。跟 `lastError` 一条道 */
  fail(msg: string): void {
    this.lastError = msg;
  }

  /**
   * 手边那条报错收掉。
   *
   * 原来只有 `clearAll()`（也就是点「清空」）会清它 —— 拖错一个文件之后那条警告就一直挂着，
   * 换一张好图也不消失（`set()` 只清槽自己的 `error`）。现在加载成功也清。
   */
  clearError(): void {
    this.lastError = null;
  }

  get(id: string): Slot {
    return this.map[id];
  }

  /** 填进槽位。data 为空就当成清空 */
  set(id: string, ref: FileRef | null, data: ImageData | null) {
    const s = this.map[id];
    if (!s) return;
    s.ref = ref;
    s.data = data;
    s.url = data ? imageDataToUrl(data) : null;
    s.size = data ? `${data.width}×${data.height}` : '';
    s.error = null;
    s.loading = false;
    /* 成功填进来一张，就把上次那条"解不了"的报错收掉 */
    if (data) this.lastError = null;
  }

  /** 直接塞一张算好的图（比如从源图里拆出来的分量），不改 ref */
  derive(id: string, data: ImageData) {
    const s = this.map[id];
    if (!s) return;
    s.data = data;
    s.url = imageDataToUrl(data);
    s.size = `${data.width}×${data.height}`;
  }

  clear(id: string) {
    this.set(id, null, null);
  }

  clearAll() {
    for (const k of Object.keys(this.map)) this.clear(k);
    this.lastError = null;
  }

  /** 有没有至少一张图 */
  get anyLoaded(): boolean {
    return Object.values(this.map).some((s) => s.data);
  }

  get loadedCount(): number {
    return Object.values(this.map).filter((s) => s.data).length;
  }

  /** 选一张放进这个槽 */
  async pick(id: string): Promise<void> {
    const s = this.map[id];
    if (!s) return;
    let refs: FileRef[] = [];
    try {
      refs = await pickImages(false);
    } catch (e) {
      this.lastError = `选文件失败：${(e as Error).message}`;
      return;
    }
    if (!refs.length) return;
    await this.loadRef(id, refs[0]);
  }

  /** 一次选多张，按顺序填进给的槽位 */
  async pickInto(ids: string[]): Promise<void> {
    let refs: FileRef[] = [];
    try {
      refs = await pickImages(ids.length > 1);
    } catch (e) {
      this.lastError = `选文件失败：${(e as Error).message}`;
      return;
    }
    for (let i = 0; i < ids.length && i < refs.length; i++) {
      await this.loadRef(ids[i], refs[i]);
    }
  }

  async loadRef(id: string, ref: FileRef): Promise<void> {
    const s = this.map[id];
    if (!s) return;
    s.loading = true;
    s.error = null;
    try {
      /* 走 `readRgba` 拿原始字节，不走 `loadImage` + 画布。
         画布是预乘 alpha 存的，反预乘会把半透明像素的 RGB 弄脏、
         把全透明的 RGB 抹成 0 —— 而 MMD 贴图里半透明很正常，
         法线图尤其（实测 55% 的 _N 在 alpha 里还藏了东西）。
         这一条是整个 ⑦ 的入口，走错这里后面全错。 */
      const r = await readRgba(ref.path);
      this.set(id, ref, r.data);
      s.srcFormat = ref.ext.toUpperCase() || 'PNG';
    } catch (e) {
      s.loading = false;
      s.error = (e as Error).message;
      this.lastError = `${ref.name}：${(e as Error).message}`;
    }
  }

  /** 从浏览器拖进来的 File（桌面端走不了这条路，WebView 收不到 HTML5 drop） */
  async loadFile(id: string, file: File): Promise<void> {
    const s = this.map[id];
    if (!s) return;
    s.loading = true;
    try {
      const bmp = await createImageBitmap(file);
      const dot = file.name.lastIndexOf('.');
      this.set(
        id,
        {
          path: `拖入/${file.name}`,
          name: file.name,
          rel: file.name,
          ext: dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : '',
          size: file.size
        },
        bitmapToImageData(bmp)
      );
    } catch (e) {
      s.loading = false;
      s.error = `拖进来的文件解不了：${(e as Error).message}`;
      this.lastError = `${file.name}：${s.error}`;
    }
  }

  /** 每个槽各自选（点一次） */
  async pickEach(): Promise<void> {
    for (const id of Object.keys(this.map)) {
      if (!this.map[id].data) await this.pick(id);
    }
  }
}

// FileRef 之外还想记住解出来的原始格式，挂在槽上

/** 导出路径：跟源图同目录，换后缀（拼法走 `outpath.ts` 那一份，别在这儿再写一个） */
export function outPathNear(slot: Slot, suffix: string, ext = 'png'): string {
  if (!slot.ref) return `out${suffix}.${ext}`;
  return siblingPath(slot.ref.path, suffix, ext);
}

/** 汇总尺寸：几张图不一样大时以第一张为准，并说明 */
export function commonSize(slots: Slot[]): {
  w: number;
  h: number;
  mismatch: { label: string; size: string }[];
} {
  const loaded = slots.filter((s) => s.data);
  if (!loaded.length) return { w: 1, h: 1, mismatch: [] };
  const w = loaded[0].data!.width;
  const h = loaded[0].data!.height;
  const mismatch = loaded
    .filter((s) => s.data!.width !== w || s.data!.height !== h)
    .map((s) => ({ label: s.label, size: `${s.data!.width}×${s.data!.height}` }));
  return { w, h, mismatch };
}

export function fileNameOf(slot: Slot): string {
  return slot.ref ? baseName(slot.ref.path) : '未选文件';
}

export type { ChannelKey };
