(async () => {
  /* 打包版里能验的：涟漪的图层（CSS 打在包里）与新增的拖文件夹提示文案。
     落点表要 import 源码模块，生产包里没有，所以那条靠 dev 那轮的真机验证。 */
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 出 = { 地址: location.href };

  const btn = document.querySelector('.btn');
  if (btn) {
    const b = btn.getBoundingClientRect();
    btn.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 })
    );
    const s = btn.querySelector(':scope > .ripple');
    if (s) {
      const a = s.getAnimations()[0];
      if (a) {
        a.pause();
        a.currentTime = 0;
      }
      const lr = s.getBoundingClientRect();
      出.涟漪 = {
        zIndex: getComputedStyle(s).zIndex,
        boxSizing: getComputedStyle(s).boxSizing,
        宿主zIndex: getComputedStyle(btn).zIndex,
        宿主isolation: getComputedStyle(btn).isolation,
        中心偏差: [Math.round((lr.left + lr.width / 2 - (b.left + b.width / 2)) * 100) / 100, Math.round((lr.top + lr.height / 2 - (b.top + b.height / 2)) * 100) / 100]
      };
      s.style.pointerEvents = 'auto';
      出.涟漪.在最上面 = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === s;
      s.remove();
    } else {
      出.涟漪 = '没生成';
    }
  }

  /* 进 Ray 那页，看工具条上那句提示在不在（生产包里文案是打进去的） */
  const 点 = (名) => [...document.querySelectorAll('a, button')].find((x) => (x.textContent || '').includes(名));
  点('Ray 编辑器')?.click();
  await 等(1500);
  出.Ray工具条 = document.querySelector('.wbar__l')?.innerText?.trim().replace(/\n/g, ' / ').slice(0, 80) ?? null;

  点('养乐多上材质')?.click();
  await 等(1500);
  出.养乐多卡片 = document.querySelector('.card.pad')?.innerText?.trim().replace(/\n/g, ' / ').slice(0, 90) ?? null;
  出.侧栏报错 = (document.querySelector('.side__err')?.innerText || '').trim() || null;
  return 出;
})()
