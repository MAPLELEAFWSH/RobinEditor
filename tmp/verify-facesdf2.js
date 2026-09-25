/** 补验：反相勾选 + 导出按钮（此时图已载入）。node tmp/cdp.mjs tmp/verify-facesdf2.js */
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const snap = () => ({
    主区标题: [...document.querySelectorAll('.panel-host .h3')].map((e) => e.textContent.trim()),
    勾选状态: [...document.querySelectorAll('.panel-host input[type=checkbox]')].map((c) => c.checked),
    模式按钮: [...document.querySelectorAll('.pick__b')]
      .map((b) => b.textContent.trim() + (b.getAttribute('aria-pressed') === 'true' ? '（按下）' : ''))
      .slice(0, 6)
  });
  const out = { 现在: snap() };

  const chk = document.querySelector('.panel-host input[type=checkbox]');
  if (chk) {
    chk.click();
    await wait(1200);
    out.勾反相后 = snap();
    chk.click();
    await wait(1000);
    out.再取消 = snap();
  } else out.找不到勾选 = true;

  const exp = [...document.querySelectorAll('button')].find((b) => /导出/.test(b.textContent));
  out.导出按钮 = exp ? { 文字: exp.textContent.trim().slice(0, 14), 禁用: exp.disabled } : '没找到';

  // 预览图到底有没有画出来（数值核验，不看图）
  const img = document.querySelector('.panel-host .stage img');
  out.预览图 = img
    ? { 有src: !!img.src, 是dataUrl: img.src.startsWith('data:'), 自然宽: img.naturalWidth, 自然高: img.naturalHeight }
    : '没有预览图';
  return out;
})();
