(async () => {
  /* 打包版里过一遍这一轮新加的东西（生产包没有源码模块可 import，只能看 DOM/CSS） */
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  const t = () => document.body.innerText;
  const 出 = { 地址: location.href };
  const 叶 = (名) => [...document.querySelectorAll('a.leaf')].find((a) => (a.textContent || '').includes(名));

  /* ① ⑦ 新的「分块定档」分区在不在 */
  叶('贴图通道处理')?.click();
  await 等(1500);
  出.分块定档按钮 = [...document.querySelectorAll('button, a')].some((b) => (b.textContent || '').includes('分块定档'));
  const 分块 = [...document.querySelectorAll('button, a')].find((b) => (b.textContent || '').includes('分块定档'));
  分块?.click();
  await 等(1200);
  出.分块定档_页面文字 = (t().match(/纯色化选区|基础色（纯色底）/) || [])[0] ?? null;

  /* ② 涟漪还是"盖在内容上面" */
  const 按钮 = document.querySelector('.btn');
  if (按钮) {
    const r = 按钮.getBoundingClientRect();
    按钮.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    await 等(60);
    const s = 按钮.querySelector(':scope > .ripple');
    if (s) {
      s.style.pointerEvents = 'auto';
      出.涟漪 = { z: getComputedStyle(s).zIndex, 在最上面: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === s };
      s.remove();
    }
  }

  /* ③ msToon 的游戏条（要先塞一张图，不然那四个分区只渲染"放一张图"那张卡） */
  叶('msToon')?.click();
  await 等(1500);
  出.msToon_分区 = [...document.querySelectorAll('.seg__btn')].map((b) => (b.textContent || '').trim().slice(0, 10));
  出.侧栏报错 = (document.querySelector('.side__err')?.innerText || '').trim() || null;
  return 出;
})()
