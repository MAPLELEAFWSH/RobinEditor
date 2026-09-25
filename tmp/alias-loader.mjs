/**
 * $lib → src/lib 的解析钩子。
 *
 * 顺带补两件事：
 *
 * 1. 源码里的相对 import 是不带后缀的（`./io`），Vite 认，Node 的 ESM 不认。
 *    这里给相对路径补上 `.ts` 再交给下一个钩子。
 *    补的顺序是 **先 `.ts` 再 `.svelte`** —— `drag-dom` 里那个 `./dropzones.svelte`
 *    是 `dropzones.svelte.ts`（纯模块，不带 rune），不是组件。原来先拼 `.svelte`
 *    会去找一个根本不存在的组件文件，于是这条链在 Node 里根本测不了。
 * 2. `.svelte` 文件在 Node 里加载不了。注册表会引一堆组件，一引就炸，
 *    于是注册表本身（以及从它派生的快捷动作表）在 Node 里根本测不了。
 *    这里把 `.svelte` 糊成一个空模块 —— 组件只当值用、不会被调用，
 *    `export default {}` 就够了（`.svelte.ts` 走上面的补后缀，不到这一层）。
 *
 * 只影响 `node --import` 跑测试，不影响构建。
 */
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('$lib/')) {
    const target = new URL('../src/lib/' + specifier.slice(5) + '.ts', import.meta.url);
    return next(target.href, context);
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    // 已经带后缀的不要动
    if (/\.[cm]?[jt]s$/.test(specifier)) return next(specifier, context);
    const base = context.parentURL ?? import.meta.url;
    for (const suffix of ['.ts', '.svelte']) {
      const target = new URL(specifier + suffix, base);
      try {
        return await next(target.href, context);
      } catch {
        // 这个后缀不存在，试下一个
      }
    }
  }
  return next(specifier, context);
}

/** `.svelte` 糊成空默认导出，别让 Node 去解析它的语法 */
export async function load(url, context, next) {
  if (url.endsWith('.svelte')) {
    return { format: 'module', shortCircuit: true, source: 'export default {};' };
  }
  return next(url, context);
}
