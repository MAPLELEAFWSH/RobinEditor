(async () => {
  /* 验"警告能不能自己走"：
     ① 用 setErr 挂一条 → 看侧栏有没有出现、有没有叉
     ② 点叉 → 看还在不在
     ③ 再挂一条 → 等 10 秒（ERR_MS=9000）→ 看有没有自己消失
     ④ 换页 → 看还在不在 */
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 带时戳 = performance
    .getEntriesByType('resource')
    .map((e) => e.name)
    .find((n) => n.includes('ui.svelte.ts?t='));
  const ui = await import(带时戳 || '/src/lib/ui.svelte.ts');
  const 看 = () => {
    const el = document.querySelector('.side__err');
    return el ? { 在: true, 文字: el.innerText.trim().slice(0, 40), 有叉: !!el.querySelector('.side__errx') } : { 在: false };
  };
  const 出 = {};

  ui.setErr('测试：这个格式不被支持');
  await 等(200);
  出.挂上之后 = 看();

  const 叉 = document.querySelector('.side__err .side__errx');
  叉?.click();
  await 等(200);
  出.点叉之后 = 看();

  ui.setErr('测试：自己该消失的那条');
  await 等(300);
  出.第二条挂上 = 看();
  await 等(9500);
  出['等 10 秒后'] = 看();

  ui.setErr('测试：换页该收掉');
  await 等(200);
  const 叶子 = [...document.querySelectorAll('a.leaf')].find((a) => (a.textContent || '').includes('Ramp'));
  叶子?.click();
  await 等(800);
  出.换页之后 = { ...看(), 地址: location.pathname };

  return 出;
})()
