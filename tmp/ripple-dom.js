(async () => {
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 吸取 = ['.btn', '.quick__it', '.leaf', '.elem', '.seg__b', '.fab', '.sb__btn', '.chip', '.pick__b'];
  const 出 = { 动效设置: document.documentElement.dataset.motion ?? null, 宿主: [] };

  for (const 选 of 吸取) {
    const el = document.querySelector(选);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2
      })
    );
    await 等(60);
    const 涟 = el.querySelector(':scope > .ripple');
    const 记 = { 选, 文字: (el.textContent || '').trim().slice(0, 12), 宿主矩形: [r.left, r.top, r.width, r.height], 生成: !!涟 };
    if (涟) {
      const lr = 涟.getBoundingClientRect();
      const cs = getComputedStyle(涟);
      记.涟漪矩形 = [+lr.left.toFixed(1), +lr.top.toFixed(1), +lr.width.toFixed(1), +lr.height.toFixed(1)];
      记.zIndex = cs.zIndex;
      记.动画 = 涟.getAnimations().map((a) => a.playState);
      记.宿主类 = el.className;
      记.宿主层级 = { position: getComputedStyle(el).position, isolation: getComputedStyle(el).isolation, overflow: getComputedStyle(el).overflow, zIndex: getComputedStyle(el).zIndex };
      /* 宿主自己的子元素里，谁可能盖在涟漪上（有 z-index 或 position 的） */
      记.子元素 = [...el.children].filter((c) => !c.classList.contains('ripple')).slice(0, 6).map((c) => {
        const cc = getComputedStyle(c);
        return `${c.tagName.toLowerCase()}.${(c.className || '').toString().split(' ')[0]}[${cc.position}/${cc.zIndex}]`;
      });
      涟.remove();
    }
    出.宿主.push(记);
    await 等(40);
  }
  return 出;
})()
