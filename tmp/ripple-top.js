(() => {
  /* 直接问浏览器"这一点最上面是谁"：涟漪本身是 pointer-events:none（点得穿），
     临时改成 auto 再 elementFromPoint —— 答案就是它在不在文字/图标之上。
     比截图可靠：按钮上的字是白的、涟漪也是白的（currentColor），像素差不出来。 */
  const 吸取 = ['.btn', '.quick__it', '.leaf', '.elem', '.seg__b', '.fab', '.sb__btn'];
  const 出 = [];
  for (const 选 of 吸取) {
    const el = document.querySelector(选);
    if (!el) continue;
    const b = el.getBoundingClientRect();
    el.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 })
    );
    const s = el.querySelector(':scope > .ripple');
    if (!s) {
      出.push({ 选, 生成: false });
      continue;
    }
    s.style.pointerEvents = 'auto';
    const 顶 = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    出.push({
      选,
      生成: true,
      z: getComputedStyle(s).zIndex,
      最上面是: 顶 === s ? '涟漪' : `${顶?.tagName?.toLowerCase()}.${(顶?.className || '').toString().split(' ')[0]}`,
      涟漪在上面: 顶 === s
    });
    s.remove();
  }
  return 出;
})()
