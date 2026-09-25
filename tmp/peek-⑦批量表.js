({
  全部行数按钮: [...document.querySelectorAll('.pick__b')].map((b) => b.textContent.trim()).filter((t) => /全部|要提的|量出|跳过|已写/.test(t)),
  表里行数: document.querySelectorAll('.tree__row').length,
  前三个文件名: [...document.querySelectorAll('.tree__row .f b')].slice(0, 3).map((b) => b.textContent),
  前三条处理: [...document.querySelectorAll('.tree__row .plan')].slice(0, 3).map((b) => b.innerText.replace(/\s+/g, ' ').slice(0, 60)),
  提示: [...document.querySelectorAll('.note')].map((n) => n.innerText.replace(/\s+/g, ' ').slice(0, 100)),
  报错: window.__量?.报错 ?? null
})
