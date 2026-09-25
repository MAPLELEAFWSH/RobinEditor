({
  模板行: [...document.querySelectorAll('.tmpl__it')].map((x) => ({
    文字: x.innerText.replace(/\s+/g, ' ').trim(),
    按钮: [...x.querySelectorAll('button')].map((b) => b.textContent.trim())
  })),
  模板卡文字: (document.querySelector('.tmpl')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 200),
  分区: [...document.querySelectorAll('.seg__btn')].map((b) => b.textContent.trim()),
  错误: (document.querySelector('.err, .sb__err')?.innerText ?? '').slice(0, 200)
})
