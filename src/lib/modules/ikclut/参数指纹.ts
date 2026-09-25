/**
 * 参数指纹：把"会影响出图的那一堆参数"读成一行字符串。
 *
 * **为什么非要有它**：`$effect` 里写 `void 基本;` 是**不建立依赖**的 ——
 * `基本` 是 `$state` 的代理对象，读**变量本身**不触发，只有读它的**字段**才触发。
 * 所以原来那个"参数一变就把「停手」推倒重来"的 effect 从来没被参数改动静过：
 * `停手` 开机约 250ms 之后永远是 `true`，
 * 「拖动时按 512 粗算、停手后补 1024 细图」这两级等于没生效 ——
 * **每敲一个数字都按 1024 走全量**。拿 1920×1080 的参考图在无头 Chrome 里量：
 * 一次改动主线程被堵 **99.5ms**（22ms 跑链 + 3ms 烘表 + 43ms 自检 + 28ms 编码 + 3ms 排 CLUT），
 * 一帧预算 33ms，等于掉三帧。
 *
 * `JSON.stringify` 会**逐个字段读**，依赖这才真挂上；顺带把"整份换掉"也算得出来。
 *
 * `lut.lut` 那张表（33³ 三万多个数）不进指纹：它是导入时整份换掉的，
 * 换它必然连带链的形状一起变，形状已经在指纹里了。
 */

export type 链形一格 = { id: string; kind: string; on: boolean };

/** 图上那个 LUT 节点的可序列化部分（表本身不进指纹，见文件头） */
export type 指纹用Lut = {
  name: string;
  strength: number;
  clamped: number;
  size: number;
  有表: boolean;
};

export type 指纹输入 = {
  链形: readonly 链形一格[];
  基本: unknown;
  曲线: unknown;
  色轮: unknown;
  hsl: unknown;
  log: unknown;
  变形: unknown;
  lut: 指纹用Lut;
  /** 蓝切片反序 */
  切片反序: boolean;
  /** 抄参考图那几个参数 */
  抄参考图: unknown;
  用测试图: boolean;
  有参考图: boolean;
};

/**
 * 出一行指纹。**读到的每一个字段都会变成依赖** ——
 * 所以调用它的地方（组件里的 `$derived`）会自动跟着这些字段变脏。
 */
export function 算指纹(i: 指纹输入): string {
  return JSON.stringify([
    i.链形.map((n) => [n.id, n.kind, n.on]),
    i.基本,
    i.曲线,
    i.色轮,
    i.hsl,
    i.log,
    i.变形,
    i.lut,
    i.切片反序,
    i.抄参考图,
    i.用测试图,
    i.有参考图
  ]);
}
