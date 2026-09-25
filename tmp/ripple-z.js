(() => {
  const el = document.querySelector('.btn');
  const b = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 }));
  const r = el.querySelector(':scope > .ripple');
  const out = r ? { zIndex: getComputedStyle(r).zIndex, 宿主isolation: getComputedStyle(el).isolation, 宿主position: getComputedStyle(el).position } : { 没有: true };
  r?.remove();
  return out;
})()
