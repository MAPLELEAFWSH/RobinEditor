/**
 * 测试用的加载器：把 SvelteKit 的 $lib 别名指到 src/lib，
 * 顺便补上 Node 里没有的 ImageData / OffscreenCanvas。
 * 只在 node tmp/*.test.mjs 时用，不影响构建。
 */
import { register } from 'node:module';
register('./alias-loader.mjs', import.meta.url);

const ROOT = new URL('../', import.meta.url);

/** img.ts 里 new ImageData(w,h) 用得最多，做个最小实现就够 */
class ImageDataShim {
  constructor(a, b, c) {
    if (typeof a === 'number') {
      this.width = a;
      this.height = b;
      this.data = new Uint8ClampedArray(a * b * 4);
    } else {
      this.data = a;
      this.width = b;
      this.height = c ?? (a.length / 4 / b);
    }
  }
}
globalThis.ImageData = ImageDataShim;

// 测试里只用纯运算，不碰画布。真调到了就直接报错，免得静默返回垃圾。
globalThis.OffscreenCanvas = class {
  constructor() {
    throw new Error('测试环境没有 OffscreenCanvas，这条路径不该被测到');
  }
};
globalThis.document = undefined;

/**
 * Svelte rune 的最小替身。
 *
 * `.svelte.ts` 里 `$state(...)` 那些在 Node 里是**裸标识符**
 * —— 没有 Svelte 编译器把它们变成 `$.state(...)`，所以这里挂个全局就行。
 * 只做到"读得到值、改得动"，不追反应性：测试只验纯逻辑，
 * 反应性那部分在真界面里看。想验"改了会不会重渲染"的别写在这儿。
 */
globalThis.$state = (init) => init;
globalThis.$derived = (fn) => (typeof fn === 'function' ? fn() : fn);
globalThis.$effect = (fn) => {
  void fn;
  return () => {};
};

// $derived.by(fn) 是另一个写法，也得有
globalThis.$derived.by = (fn) => fn();

void ROOT;
