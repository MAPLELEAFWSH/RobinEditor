(async () => {
  const 文 = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const 点 = async (字) => {
    const el = [...document.querySelectorAll('.pick__b')].find((x) => 文(x).includes(字));
    if (!el) return '找不到 ' + 字;
    el.click();
    await new Promise((r) => setTimeout(r, 1200));
    return '点了 ' + 文(el);
  };
  const 读数 = () => 文([...document.querySelectorAll('.wb__main .mini')].find((m) => /原文编码/.test(m.textContent || ''))) || '(没有读数)';
  const 按下 = () => [...document.querySelectorAll('.pick__b')].filter((b) => b.getAttribute('aria-pressed') === 'true').map(文);

  const 起点 = { 地址: location.search, 读数: 读数(), 按下的: 按下() };
  await 点('EUC-JP');
  const 选完 = { 地址: location.search, 按下的: 按下() };
  const 切 = await 点('名称');
  return {
    起点,
    选了EUC_JP: 选完,
    点名称: 切,
    切过去之后: {
      地址: location.search,
      读数: 读数(),
      按下的: 按下(),
      主按钮: [...document.querySelectorAll('.btn--primary')].map(文).slice(0, 2)
    }
  };
})()
