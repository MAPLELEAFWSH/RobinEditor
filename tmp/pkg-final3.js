(async () => {
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 出 = { 地址: location.href };
  [...document.querySelectorAll('a.leaf')].find((a) => (a.textContent || '').includes('贴图通道处理'))?.click();
  await 等(1500);
  [...document.querySelectorAll('.seg__btn')].find((b) => (b.textContent || '').includes('分块定档'))?.click();
  await 等(1500);
  const 约定按钮 = [...document.querySelectorAll('.pick__b')].filter((b) => ['自定','原神 lightmap','三渲二：金属度 + AO + 高光','本工程实测（三游戏）'].includes((b.textContent||'').trim()));
  出.约定按钮 = 约定按钮.map((b) => (b.textContent||'').trim() + (b.getAttribute('aria-pressed') === 'true' ? '(默认选中)' : ''));
  出.侧栏报错 = (document.querySelector('.side__err')?.innerText || '').trim() || null;
  return 出;
})()
