/**
 * 体检专用 vite 配置：起在 1422，**关掉 HMR**。
 *
 * 为什么需要它：这一轮有好几个 agent 在同一个 checkout 上同时改代码，共用 1420 那个 dev server。
 * 别人一存盘，vite 就把更新推给我的页面，`②` 这一页会整块重挂 —— 量到一半控件没了、
 * 计数归零，量出来的数全是废的。关掉 HMR 之后我的页面只会在我自己主动刷新时变。
 *
 * 用法：`pnpm exec vite dev --config tmp\vite.体检.config.js`
 */
import 基础 from '../vite.config.js';

export default async function (env) {
  const c = (await 基础(env)) ?? {};
  return {
    ...c,
    server: {
      ...(c.server ?? {}),
      port: 1422,
      strictPort: true,
      hmr: false
    }
  };
}
