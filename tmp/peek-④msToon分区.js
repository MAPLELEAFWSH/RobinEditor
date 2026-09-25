({
  地址: location.pathname + location.search,
  有_wb: !!document.querySelector('.wb'),
  有_main: !!document.querySelector('.wb__main'),
  有_side: !!document.querySelector('.wb__side'),
  有_acts: !!document.querySelector('.wb__acts'),
  主按钮数: document.querySelectorAll('button.btn--primary').length,
  主按钮文字: [...document.querySelectorAll('button.btn--primary')].map((b) => (b.textContent || '').trim().slice(0, 16)),
  主按钮的家: [...document.querySelectorAll('button.btn--primary')].map((b) =>
    b.closest('.wb__acts') ? '.wb__acts' : b.closest('.wb__side') ? '.wb__side' : b.closest('.wb__main') ? '.wb__main' : b.closest('.wb') ? '.wb（但不在 main 里）' : '不在 .wb 里'
  ),
  主区字数: (document.querySelector('.wb__main')?.innerText ?? document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' ').length,
  主区开头: (document.querySelector('.wb__main')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 90),
  幕布还在: !!document.querySelector('.intro'),
  主界面隐藏: (() => { const w = document.querySelector('.bootwrap'); return w ? w.classList.contains('bootwrap--hidden') : null; })(),
  侧栏报错: (document.querySelector('.sb__err, .err')?.innerText ?? '').slice(0, 160)
})
