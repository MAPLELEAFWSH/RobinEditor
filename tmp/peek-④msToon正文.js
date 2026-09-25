({
  地址: location.pathname + location.search,
  正文: (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 400),
  顶层元素: [...(document.querySelector('main')?.children ?? [])].map((e) => e.tagName + '.' + (typeof e.className === 'string' ? e.className : '')).slice(0, 8),
  分区条: [...document.querySelectorAll('nav.seg .seg__btn')].map((b) => b.textContent.trim() + (b.classList.contains('is-on') ? '←' : ''))
})
