(async () => {
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  const t = () => document.body.innerText;
  const 出 = { 地址: location.href };
  出.含按游戏各存 = /按游戏各存一套/.test(t());
  出.含还没调过 = /还没调过/.test(t());
  出.含你存的 = /你存的这套/.test(t());
  出.主列卡片数 = document.querySelectorAll('.wb__main > .card').length;
  出.主列第一张卡的文字 = (document.querySelector('.wb__main > .card')?.innerText || '').trim().slice(0, 120).replace(/\n/g, ' | ');
  出.所有按钮文字 = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).slice(0, 24);
  出.控制台错误 = null;
  return 出;
})()
