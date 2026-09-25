/**
 * ② 调色「按步撤销」的那点**纯逻辑**：两步之间改的是哪个字段、两份快照一不一样、要不要记。
 *
 * 撤销栈本身用现成的 `$lib/history.ts`（⑦ 通道那边是同一份，不另造一套）。
 * 这里只放"能单测、不该长在组件里"的部分 —— 组件里碰不到 Node，
 * 而"同一条滑杆连着拖要合并成一步"这条判据必须能单测（`tmp\调色-撤销.test.mjs`）。
 *
 * **记什么**：整套调色状态（链 + 七组参数 + 切片反序 + 抄参考图 + 混合面板那几个旋钮）。
 * **不记什么**：源图与参考图本身、`useTest`（那是"放素材"不是"改参数" —— 跟 ⑦ 一个口径）、
 * 界面焦点（当前参数板 / 选中的 HSL 段 / 变形格）、A/B 对照槽（用户自己存的档）。
 */

/** 两份快照第一个不一样的字段路径（`基本.exposure` / `链形[2].on`）。一样就返回空串 */
export function 变了哪个字段(旧: unknown, 新: unknown, 前缀 = ''): string {
  if (旧 === 新) return '';
  /* 到叶子（不是对象）了还不一样，就是这里 */
  if (typeof 旧 !== 'object' || typeof 新 !== 'object' || 旧 === null || 新 === null) return 前缀 || '（根）';

  if (Array.isArray(旧) || Array.isArray(新)) {
    const a = Array.isArray(旧) ? 旧 : [];
    const b = Array.isArray(新) ? 新 : [];
    /* 数组长度变了（增删/重排）先看逐项：某一项不一样就顺着那一项报，
       全一样但长度不同 → 报数组本身（增删一步） */
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const k = 变了哪个字段(a[i], b[i], `${前缀}[${i}]`);
      if (k) return k;
    }
    if (a.length !== b.length) return 前缀 || '（根）';
    return '';
  }

  const 甲 = 旧 as Record<string, unknown>;
  const 乙 = 新 as Record<string, unknown>;
  /* 两边的键合起来看：只有一边有的键也算"变了" */
  const 键们 = [...new Set([...Object.keys(甲), ...Object.keys(乙)])];
  for (const k of 键们) {
    const 子 = 变了哪个字段(甲[k], 乙[k], 前缀 ? `${前缀}.${k}` : k);
    if (子) return 子;
  }
  return '';
}

/** 两份快照在结构上一样吗（不看键的顺序）。撤销后不该又被记一步，就靠它判 */
export function 一样吗(a: unknown, b: unknown): boolean {
  return 变了哪个字段(a, b) === '';
}

/**
 * 提交一步。
 *
 * **提交前先比一次**：跟当前这一格一样就什么都不做。这一条同时解决两件事 ——
 * ① 撤销/重做把状态还原之后，`参数指纹` 会再触发一次"落定"，那一下不该被记成新的一步；
 * ② 开关没真的改到值（比如把滑杆拖回原位）也不该多出一格。
 *
 * `key` 取"第一个不同的字段路径"：同一条滑杆连着拖出来的是同一个 key，
 * `History` 按 key + 时间窗合并 → 一次连续操作 = 一步。
 *
 * 返回是否真的记了一格（给测试和读数用）。
 */
export function 提交一步<T>(
  栈: { current: T | null; push(s: T, key: string, now?: number): void },
  新快照: T,
  now?: number
): boolean {
  const 现 = 栈.current;
  if (现 !== null && 一样吗(现, 新快照)) return false;
  栈.push(新快照, 现 === null ? '初始' : 变了哪个字段(现, 新快照) || '改动', now);
  return true;
}
