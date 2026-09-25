(async () => {
  const t0 = performance.now();
  let 幕布撤的时刻 = null;
  for (let i = 0; i < 120; i++) {
    const w = document.querySelector('.bootwrap');
    const 撤了 = !w || w.classList.contains('bootwrap--hidden');
    if (撤了) { 幕布撤的时刻 = Math.round(performance.now() - t0); break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    地址: location.pathname + location.search,
    幕布撤了用ms: 幕布撤的时刻,
    幕布还在: !!document.querySelector('.intro'),
    主界面隐藏: (() => { const w = document.querySelector('.bootwrap'); return w ? w.classList.contains('bootwrap--hidden') : null; })(),
    主区字数: (document.querySelector('.wb__main')?.innerText ?? document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' ').length,
    悬浮球: [...document.querySelectorAll('.fabs .fab')].map((b) => (b.textContent || '').trim() || '（外观）'),
    侧栏报错: (document.querySelector('.sb__err, .err')?.innerText ?? '').slice(0, 200),
    全局报错: (window.__探?.侧栏错?.() ?? null)
  };
})()
