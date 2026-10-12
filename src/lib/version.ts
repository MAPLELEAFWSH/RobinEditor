/**
 * 版本与构建时间。**一个来源**：`src-tauri/tauri.conf.json` 的 `version`
 * （安装包文件名、exe 属性看到的也是它），构建时由 `vite.config.js` 的 `define` 注入。
 *
 * 为什么走注入而不是运行时读：`@tauri-apps/api/app` 的 `getVersion()` 只有桌面端能用，
 * 浏览器里调界面（`pnpm dev`）就没有版本可显示；而版本号这种东西不该在界面里写死
 * （底栏那颗 `v1.0` 就是写死的，跟 `1.0.0` 对不上）。
 *
 * `typeof` 那层兜底：万一某条路（比如直接在 Node 里 import 这个模块）没经过 Vite 的替换，
 * 读未声明的标识符会抛 ReferenceError，`typeof` 不会 —— 退成 `0.0.0` 也比崩了强。
 */
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

export const 版本 = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
/** 构建那一刻的本机时间，打进包里就不会变（"这一版是什么时候打的"） */
export const 构建时间 = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';
