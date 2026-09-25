/**
 * 撤销 / 重做。
 *
 * 两条规矩：
 *
 * 1. **一次连续操作算一步。** 这里不接指针事件，用**同键合并**：
 *    同一个 `key` 的连续改动在 `coalesceMs` 之内合并成一步。拖滑杆会连着改十几次，
 *    但键都是同一个，时间也挨着，于是只留一步。
 * 2. **有上限。** 这边存的是图层配置（几 KB 的 JSON），不是像素，
 *    所以上限只防"改一下午把内存吃光"，给 120 步足够。
 *
 * 存的是**整个状态快照**，不是逆操作。理由：图层配置这种数据本来就小，
 * 快照实现简单、不会出现"逆操作算错导致状态飘走"这种事；像素级的历史才需要存逆操作，
 * 这边完全没必要。
 */

export type HistoryOpts = {
  /** 最多留几步 */
  cap?: number;
  /** 同一个 key 在这个毫秒窗口内的连续改动合并成一步 */
  coalesceMs?: number;
};

export type HistoryState<T> = {
  stack: T[];
  /** 当前停在第几格 */
  pos: number;
};

export class History<T> {
  private stack: T[] = [];
  private pos = -1;
  private lastKey = '';
  private lastAt = 0;
  private readonly cap: number;
  private readonly coalesceMs: number;

  constructor(opts: HistoryOpts = {}) {
    this.cap = Math.max(2, opts.cap ?? 120);
    this.coalesceMs = Math.max(0, opts.coalesceMs ?? 500);
  }

  get size(): number {
    return this.stack.length;
  }
  get index(): number {
    return this.pos;
  }
  get canUndo(): boolean {
    return this.pos > 0;
  }
  get canRedo(): boolean {
    return this.pos >= 0 && this.pos < this.stack.length - 1;
  }
  /** 当前这一格的状态（还没记过任何东西时是 null） */
  get current(): T | null {
    return this.pos >= 0 ? this.stack[this.pos] : null;
  }

  /** 清空并记下第一个状态 */
  reset(state: T, now = Date.now()): void {
    this.stack = [state];
    this.pos = 0;
    this.lastKey = '';
    this.lastAt = now;
  }

  /**
   * 记一个新状态。
   *
   * - 如果当前不在末尾（撤销过之后又改了），先把后面的重做分支砍掉。
   * - 同一个 `key`、且在合并窗口之内 → 覆盖当前这一格，不新增。
   */
  push(state: T, key: string, now = Date.now()): void {
    if (this.pos < 0) {
      this.reset(state, now);
      return;
    }
    // 撤销过之后再改，重做的分支就没意义了
    if (this.pos < this.stack.length - 1) this.stack.length = this.pos + 1;

    // 窗口用**严格小于**：`coalesceMs: 0` 要在直觉上等于"从不合并"。
    // 写成 `<= 0` 的话，同一毫秒内的两次改动还是会被并掉。
    const mergeable = key === this.lastKey && now - this.lastAt < this.coalesceMs;
    if (mergeable && this.pos > 0) {
      // 覆盖当前格：这一步还没"落定"
      this.stack[this.pos] = state;
    } else {
      this.stack.push(state);
      this.pos = this.stack.length - 1;
      if (this.stack.length > this.cap) {
        // 从头丢，pos 跟着挪
        const drop = this.stack.length - this.cap;
        this.stack.splice(0, drop);
        this.pos -= drop;
      }
    }
    this.lastKey = key;
    this.lastAt = now;
  }

  undo(): T | null {
    if (!this.canUndo) return null;
    this.pos--;
    // 撤销之后紧接着的改动不该跟撤销前那次合并
    this.lastKey = '';
    return this.stack[this.pos];
  }

  redo(): T | null {
    if (!this.canRedo) return null;
    this.pos++;
    this.lastKey = '';
    return this.stack[this.pos];
  }

  /** 给测试和调试看的一眼快照 */
  snapshot(): HistoryState<T> {
    return { stack: [...this.stack], pos: this.pos };
  }
}
