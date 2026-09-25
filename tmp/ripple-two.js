(() => {
  /* 为什么 .elem / .seg__b 上涟漪盖不住？把两边的几何和层级都摊开看 */
  const 查 = (选) => {
    const el = document.querySelector(选);
    if (!el) return { 选, 没有: true };
    const b = el.getBoundingClientRect();
    el.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 })
    );
    const s = el.querySelector(':scope > .ripple');
    const 宿主 = getComputedStyle(el);
    const 记 = {
      选,
      宿主: {
        标签: el.tagName.toLowerCase(),
        display: 宿主.display,
        position: 宿主.position,
        overflow: 宿主.overflow,
        isolation: 宿主.isolation,
        borderRadius: 宿主.borderRadius,
        pointerEvents: 宿主.pointerEvents,
        clipPath: 宿主.clipPath,
        transform: 宿主.transform,
        有类: el.classList.contains('ripple-host')
      },
      矩形: [b.left, b.top, b.width, b.height]
    };
    if (s) {
      const 涟 = getComputedStyle(s);
      const lr = s.getBoundingClientRect();
      记.涟漪 = {
        矩形: [lr.left, lr.top, lr.width, lr.height],
        zIndex: 涟.zIndex,
        pointerEvents: 涟.pointerEvents,
        display: 涟.display,
        opacity: 涟.opacity,
        包含宿主中心: lr.left <= b.left + b.width / 2 && lr.right >= b.left + b.width / 2 && lr.top <= b.top + b.height / 2 && lr.bottom >= b.top + b.height / 2
      };
      s.style.pointerEvents = 'auto';
      记.涟漪.pointerEvents = getComputedStyle(s).pointerEvents;
      const 中心 = document.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2);
      记.涟漪中心最上面是 = 中心 === s ? '涟漪' : `${中心?.tagName?.toLowerCase()}.${(中心?.className || '').toString().split(' ')[0]}`;
      const 宿主中心 = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      记.宿主中心最上面是 = 宿主中心 === s ? '涟漪' : `${宿主中心?.tagName?.toLowerCase()}.${(宿主中心?.className || '').toString().split(' ')[0]}`;
      s.remove();
    }
    return 记;
  };
  return { 两处: [查('.elem'), 查('.seg__b')], 动效: document.documentElement.dataset.motion };
})()
