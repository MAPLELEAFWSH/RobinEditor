(async () => {
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 抓 = [];
  addEventListener('error', (e) => 抓.push('error: ' + (e.message || e.error?.message || '')));
  addEventListener('unhandledrejection', (e) => 抓.push('reject: ' + (e.reason?.message || String(e.reason))));

  /* 先切到别的模块，再切回来 —— 触发一次动态 import */
  const 叶 = (名) => [...document.querySelectorAll('a.leaf')].find((a) => (a.textContent || '').includes(名));
  叶('总览')?.click();
  await 等(1200);
  错点 = 抓.length;
  叶('msToon')?.click();
  await 等(2500);
  const 分区按钮 = [...document.querySelectorAll('.seg__btn')].map((b) => (b.textContent || '').trim().slice(0, 12));
  分区按钮.find((t) => t.includes('ShadowRate'));
  const b = [...document.querySelectorAll('.seg__btn')].find((x) => (x.textContent || '').includes('ShadowRate'));
  b?.click();
  await 等(2000);
  return {
    抓到的错: 抓,
    地址: location.href,
    有wb: !!document.querySelector('.wb'),
    有游戏条: /按游戏各存一套/.test(document.body.innerText),
    分区按钮
  };
})()
