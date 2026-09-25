(async () => {
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 出 = [];
  for (const 选 of ['.leaf', '.fab', '.sb__btn']) {
    const el = document.querySelector(选);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    await 等(80);
    const s = el.querySelector(':scope > .ripple');
    if (!s) { 出.push({ 选, 生成: false }); continue; }
    s.style.pointerEvents = 'auto';
    出.push({ 选, z: getComputedStyle(s).zIndex, 在最上面: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === s, 宿主disabled: el.disabled === true });
    s.remove();
  }
  return 出;
})()
