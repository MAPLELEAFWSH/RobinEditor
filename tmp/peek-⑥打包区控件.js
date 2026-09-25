({
  地址: location.pathname + location.search,
  主区控件: [...document.querySelectorAll('.wb__main button, .wb__main input, .wb__main select')].map((e) =>
    (e.tagName === 'INPUT' ? `[${e.type}] ${e.getAttribute('aria-label') ?? ''}` : (e.textContent || '').trim().slice(0, 22))
  ).filter((x) => x && x !== ''),
  折叠卡: [...document.querySelectorAll('details.fold > summary .fold__t')].map((x) => x.textContent.trim()),
  底栏主按钮: [...document.querySelectorAll('.foot .btn--primary, .wb__acts .btn--primary')].map((b) => b.textContent.trim()),
  抽屉文字: (document.querySelector('.wb__side')?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
})
