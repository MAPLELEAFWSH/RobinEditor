/**
 * 打开外部链接。
 *
 * 在 Tauri 里走 opener 插件（交给系统默认浏览器），
 * 浏览器里开发时退回 window.open。
 *
 * 为什么要分：WebView2 里直接 window.open 会被当成新窗口，
 * 有些情况下什么都不发生。走系统 shell 才稳。
 */

/** 是否跑在 Tauri 的 WebView 里 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function openExternal(url: string): Promise<void> {
  if (!url) return;
  if (isTauri()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    } catch {
      /* 插件没接上就退回浏览器那条路 */
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
