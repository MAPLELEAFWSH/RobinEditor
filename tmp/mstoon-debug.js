(async () => {
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 出 = { 地址: location.href };
  const 叶 = [...document.querySelectorAll('a.leaf')].map((a) => (a.textContent || '').trim());
  出.侧栏叶子 = 叶.slice(0, 20);
  const 目标 = [...document.querySelectorAll('a.leaf')].find((a) => (a.textContent || '').includes('msToon'));
  出.找到叶子 = !!目标;
  目标?.click();
  await 等(1500);
  出.点后地址 = location.href;
  出.分区按钮 = [...document.querySelectorAll('.seg__b, .chip, button')]
    .map((b) => (b.textContent || '').trim())
    .filter((t) => /lightmap 打包|ShadowRate|SubLightRate|EdgeRate|FaceSDF|分批|分块定档/.test(t))
    .slice(0, 10);
  出.正文片段 = document.body.innerText.trim().slice(0, 160).replace(/\n/g, ' | ');
  return 出;
})()
