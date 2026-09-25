/**
 * 变更记录与撤销 / 重做。
 *
 * 两级：
 *   1. **单条参数** —— 界面上改完还没写盘的那些，一条条退回去（组件里做）
 *   2. **整次写盘** —— 每写一次盘记一条，撤销就是把这次写盘前留的 .bak 搬回去
 *
 * 为什么整次写盘的撤销走 .bak 而不是在内存里存整份原文：
 * 后端写盘时会在文件旁边留一份唯一命名的备份（已经有 .bak 就让成 .bak2、.bak3），
 * 所以每次写盘都有自己那份，不会被后一次覆盖。撤销 = 读回来原样写回。
 * 代价是多一次读盘，但改的都是几 KB 的 conf 和 fx，可以忽略。
 *
 * 这个文件**不用 runes、不碰 DOM**，所有函数都是"传进去旧的、返回新的"。
 * 这样 Node 里能直接跑测试（tmp/ray-ops.test.mjs 就是这么测的），
 * 组件那边只负责把返回的数组塞回 $state。
 */

export type ChangeRecord = {
  /** 参数名，界面显示和单条撤销定位都用它 */
  name: string;
  line: number;
  before: string;
  after: string;
  /** 改动前后的整行原文。写回和还原都靠它 */
  oldRaw: string;
  newRaw: string;
};

export type WriteRecord = {
  id: string;
  /** 毫秒时间戳 */
  at: number;
  path: string;
  fileLabel: string;
  encoding: string;
  /** 这次用了哪条写入路径（字节拼接 / 整段重写） */
  how: string;
  changes: ChangeRecord[];
  /** 这次写盘前留的备份路径。原文件本来不存在时是 null */
  backup: string | null;
  /** 已撤销的写入：这里存撤销前的内容，重做时写回去 */
  redoBytes: Uint8Array | null;
  undone: boolean;
};

/** 时间线里的一行。整次写盘会摊成每个参数一行 */
export type TimelineRow = {
  id: string;
  writeId: string;
  at: number;
  fileLabel: string;
  path: string;
  name: string;
  /** 第几行（0 起）。单条撤销要按行号找回去 */
  line: number;
  before: string;
  after: string;
  undone: boolean;
};

/** 撤销 / 重做要用的两个文件操作。注入进来是为了能在 Node 里用假的实现测 */
export type HistoryIo = {
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
};

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function fileLabelOf(path: string): string {
  const s = path.replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
  return i >= 0 ? s.slice(i + 1) : s;
}

export function hhmmss(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 摊平成时间线，新的在前 */
export function timelineRows(log: WriteRecord[]): TimelineRow[] {
  const out: TimelineRow[] = [];
  for (const w of log) {
    w.changes.forEach((c, i) => {
      out.push({
        id: `${w.id}:${i}`,
        writeId: w.id,
        at: w.at,
        fileLabel: w.fileLabel,
        path: w.path,
        name: c.name,
        line: c.line,
        before: c.before,
        after: c.after,
        undone: w.undone
      });
    });
  }
  return out.sort((a, b) => b.at - a.at || a.name.localeCompare(b.name));
}

export function canUndo(log: WriteRecord[]): boolean {
  return log.some((w) => !w.undone);
}

export function canRedo(log: WriteRecord[]): boolean {
  return log.some((w) => w.undone);
}

/** 记一条写盘。返回新数组（调用方塞回 $state） */
export function recordWrite(
  log: WriteRecord[],
  rec: Omit<WriteRecord, 'id' | 'at' | 'redoBytes' | 'undone'>
): WriteRecord[] {
  return [...log, { ...rec, id: newId(), at: Date.now(), redoBytes: null, undone: false }];
}

function replace(log: WriteRecord[], id: string, patch: Partial<WriteRecord>): WriteRecord[] {
  return log.map((w) => (w.id === id ? { ...w, ...patch } : w));
}

export type OpResult = { log: WriteRecord[]; ok: boolean; message: string };

/**
 * 撤销一次写盘：把这份备份原样写回去。
 * 写之前先把当前内容读下来存着，重做要用 —— 这样重做不用重算，对称。
 */
export async function undoWrite(
  log: WriteRecord[],
  id: string,
  io: HistoryIo
): Promise<OpResult> {
  const w = log.find((x) => x.id === id);
  if (!w) return { log, ok: false, message: '没有这条记录。' };
  if (w.undone) return { log, ok: false, message: `${w.fileLabel} 这条已经撤过了。` };
  if (!w.backup) {
    return {
      log,
      ok: false,
      message: `${w.fileLabel} 这次写盘没有备份（写的时候原文件不存在），撤不了。`
    };
  }
  try {
    const current = await io.readBytes(w.path);
    const restored = await io.readBytes(w.backup);
    await io.writeBytes(w.path, restored);
    return {
      log: replace(log, id, { redoBytes: current, undone: true }),
      ok: true,
      message: `撤销了 ${w.fileLabel} 的 ${w.changes.length} 处改动，已从备份还原。`
    };
  } catch (e) {
    return { log, ok: false, message: `撤销失败：${(e as Error).message}` };
  }
}

/** 重做：把撤销时存下的内容再写回去 */
export async function redoWrite(
  log: WriteRecord[],
  id: string,
  io: HistoryIo
): Promise<OpResult> {
  const w = log.find((x) => x.id === id);
  if (!w) return { log, ok: false, message: '没有这条记录。' };
  if (!w.undone) return { log, ok: false, message: `${w.fileLabel} 这条没被撤销过。` };
  if (!w.redoBytes) {
    return { log, ok: false, message: `${w.fileLabel} 没有可重做的内容。` };
  }
  try {
    await io.writeBytes(w.path, w.redoBytes);
    return {
      log: replace(log, id, { undone: false }),
      ok: true,
      message: `重做了 ${w.fileLabel} 的 ${w.changes.length} 处改动。`
    };
  } catch (e) {
    return { log, ok: false, message: `重做失败：${(e as Error).message}` };
  }
}

/** 全部撤销：按时间倒着撤 */
export async function undoAll(log: WriteRecord[], io: HistoryIo): Promise<OpResult> {
  let cur = log;
  let n = 0;
  for (const w of [...log].reverse()) {
    if (w.undone) continue;
    const r = await undoWrite(cur, w.id, io);
    cur = r.log;
    if (r.ok) n++;
  }
  return {
    log: cur,
    ok: n > 0,
    message: n ? `全部撤销：还原了 ${n} 次写盘。` : '没有可撤的。'
  };
}

/** 全部重做：按时间正着做回来 */
export async function redoAll(log: WriteRecord[], io: HistoryIo): Promise<OpResult> {
  let cur = log;
  let n = 0;
  for (const w of log) {
    if (!w.undone) continue;
    const r = await redoWrite(cur, w.id, io);
    cur = r.log;
    if (r.ok) n++;
  }
  return {
    log: cur,
    ok: n > 0,
    message: n ? `全部重做：重新写了 ${n} 次。` : '没有可重做的。'
  };
}

/**
 * 单条参数撤销：算出"把这个参数改回旧值"之后那一行该长什么样。
 *
 * 这里不直接写盘 —— 调用方拿结果去走正常的写盘流程（照样留备份、照样读回来核对）。
 * 单条撤销和普通改动走同一条路，就不会有两套行为。
 *
 * setRaw 是 ops.ts 的 setDefineValue / setConstValue，按条目类型传进来。
 */
export function reverseChange(
  c: ChangeRecord,
  setRaw: (raw: string, newValue: string) => string,
  currentRaw: string
): string | null {
  // "从注释启用"的回退：再注释回去
  if (c.before === '注释掉') {
    if (!/^\s*#define/.test(currentRaw)) return null;
    return currentRaw.replace(/^(\s*)(?=#define)/, '$1//');
  }
  const out = setRaw(currentRaw, c.before);
  return out === currentRaw ? null : out;
}
