({
  地址: location.pathname + location.search,
  生效分区: [...document.querySelectorAll('.seg__btn')]
    .filter((b) => b.getAttribute('aria-current') === 'page' || b.classList.contains('is-on'))
    .map((b) => b.textContent.trim()),
  主区字数: (document.querySelector('.wb__main')?.innerText ?? '').replace(/\s+/g, ' ').length,
  幕布还在: !!document.querySelector('.intro'),
  主界面隐藏: (() => { const w = document.querySelector('.bootwrap'); return w ? w.classList.contains('bootwrap--hidden') : null; })(),
  标题: (document.querySelector('h1, .h1')?.textContent ?? '').trim(),
  报错: window.__量?.报错 ?? null
})
