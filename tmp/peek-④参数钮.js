(async () => {
  const 列 = () => [...document.querySelectorAll('.fabs .fab')];
  const 参数钮 = () => 列().find((b) => /参数/.test(b.textContent || ''));
  const 前 = {
    悬浮球: 列().map((b) => (b.textContent || '').trim() || '（外观）'),
    有参数钮: !!参数钮(),
    参数钮的aria: 参数钮()?.getAttribute('aria-pressed') ?? null,
    抽屉在视口里: (() => { const s = document.querySelector('.wb__side'); if (!s) return '没有 .wb__side'; const r = s.getBoundingClientRect(); return r.left < innerWidth ? `在（left=${Math.round(r.left)}）` : `在视口外（left=${Math.round(r.left)}）`; })()
  };
  let 后 = null;
  if (参数钮()) {
    参数钮().click();
    await new Promise((r) => setTimeout(r, 700)); // 等滑出动画走完
    后 = {
      side_open: document.documentElement.classList.contains('side-open'),
      参数钮的aria: 参数钮()?.getAttribute('aria-pressed') ?? null,
      参数钮亮着吗: 参数钮()?.classList.contains('fab--on') ?? null,
      抽屉在视口里: (() => { const s = document.querySelector('.wb__side'); if (!s) return '没有'; const r = s.getBoundingClientRect(); return `${r.left < innerWidth ? '在' : '在视口外'}（left=${Math.round(r.left)}，宽=${Math.round(r.width)}）`; })(),
      中区宽: Math.round((document.querySelector('.wb__main')?.getBoundingClientRect().width) ?? 0)
    };
    /* 再点一次收起来，别把页面留在开着的样子 */
    参数钮().click();
    await new Promise((r) => setTimeout(r, 500));
  }
  return { 地址: location.pathname + location.search, 点之前: 前, 点之后: 后, 收起来了: !document.documentElement.classList.contains('side-open') };
})()
