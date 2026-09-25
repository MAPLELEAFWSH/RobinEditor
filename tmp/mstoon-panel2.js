(async () => {
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 出 = { 地址: location.href, 逐分区: [] };
  const 特征 = {
    'lightmap 打包': 'MS_TOON',
    ShadowRate: '合成结果',
    SubLightRate: '合成结果',
    EdgeRate: '描边落在哪儿',
    FaceSDF: '怎么做'
  };
  出.有wb = !!document.querySelector('.wb');
  出.panelHost文字头 = (document.querySelector('.panel-host')?.innerText || '').replace(/\n+/g, ' | ').slice(0, 120);
  出.正文里各分区特征 = Object.fromEntries(
    Object.entries(特征).map(([k, v]) => [k, document.body.innerText.includes(v)])
  );
  出.有游戏条 = /按游戏各存一套/.test(document.body.innerText);
  出.三个游戏按钮 = [...document.querySelectorAll('.pick__b')].map((b) => (b.textContent || '').trim()).filter((t) => ['原神', '星铁', '绝区零'].includes(t));
  /* 点侧栏的分区按钮，看渲染换不换 */
  const 段 = [...document.querySelectorAll('.seg__btn')].find((x) => (x.textContent || '').includes('EdgeRate'));
  段?.click();
  await 等(1500);
  出.点EdgeRate后 = {
    地址: location.href,
    有描边标题: document.body.innerText.includes('描边落在哪儿'),
    有游戏条: /按游戏各存一套/.test(document.body.innerText),
    有wb: !!document.querySelector('.wb')
  };
  return 出;
})()
