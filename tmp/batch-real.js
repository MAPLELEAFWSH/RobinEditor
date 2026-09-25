(async () => {
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 出 = {};
  [...document.querySelectorAll('a.leaf')].find((a) => (a.textContent || '').includes('贴图通道处理'))?.click();
  await 等(1200);
  /* 分区按钮文字是「标签 + hint」，两个"批量"开头：批量提取 vs 批量。按 hint 区分 */
  const 段 = [...document.querySelectorAll('.seg__btn')].find((b) => (b.textContent || '').includes('整个目录一起跑'));
  出.点的按钮 = 段?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 40) ?? null;
  段?.click();
  await 等(1500);
  出.地址 = location.href;
  出.操作下拉 = [...document.querySelectorAll('option, .pick__b')].map((o) => (o.textContent || '').trim())
    .filter((x) => /循环位移|法线 B↔R|R 反相|铺满 RGB|提到 A|拆成 RGBA/.test(x));
  出.侧栏报错 = (document.querySelector('.side__err')?.innerText || '').trim() || null;
  return 出;
})()
