(async () => {
  const t = () => document.body.innerText;
  const wb = document.querySelector('.wb');
  return {
    地址: location.href,
    标题: document.querySelector('h1')?.textContent?.trim() ?? null,
    有wb: !!wb,
    有主列: !!document.querySelector('.wb__main'),
    wb文字: (wb?.innerText || '').trim().slice(0, 220).replace(/\n/g, ' | '),
    有游戏条: /按游戏各存一套/.test(t()),
    游戏按钮: [...document.querySelectorAll('.pick__b')].map((b) => (b.textContent || '').trim()).slice(0, 12)
  };
})()
