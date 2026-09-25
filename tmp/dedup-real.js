(async () => {
  /* 去重之后真机过一遍：批量页要多出三条映射、调换页九条还在、图层/混合页的合成照旧 */
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 出 = {};
  const t = () => document.body.innerText;
  const 去分区 = async (名) => {
    [...document.querySelectorAll('a.leaf')].find((a) => (a.textContent || '').includes('贴图通道处理'))?.click();
    await 等(1200);
    [...document.querySelectorAll('.seg__btn')].find((b) => (b.textContent || '').includes(名))?.click();
    await 等(1200);
  };

  await 去分区('批量');
  出.批量_操作下拉 = [...document.querySelectorAll('option')].map((o) => o.textContent.trim()).filter((x) => /循环位移|法线|R 反相|铺满/.test(x));
  出.批量_地址 = location.href;

  await 去分区('调换');
  出.调换_预设按钮 = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim())
    .filter((x) => ['原样', '循环位移', '法线 B↔R', 'R 反相', 'R 铺满 RGB'].includes(x));

  await 去分区('图层与蒙版');
  出.图层页_在位 = /图层/.test(t()) && !!document.querySelector('.wb');

  await 去分区('混合');
  出.混合页_在位 = /混合/.test(t()) && !!document.querySelector('.wb');

  出.侧栏报错 = (document.querySelector('.side__err')?.innerText || '').trim() || null;
  return 出;
})()
