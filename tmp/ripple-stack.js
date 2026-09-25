(() => {
  /* .seg__b 上涟漪为什么还是压不住：把命中栈整条列出来 */
  const el = document.querySelector('.seg__b');
  const b = el.getBoundingClientRect();
  const 点 = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 点.x, clientY: 点.y }));
  const s = el.querySelector(':scope > .ripple');
  if (!s) return { 没有涟漪: true };
  const cs = getComputedStyle(s);
  const lr = s.getBoundingClientRect();
  s.style.pointerEvents = 'auto';
  const 栈 = document.elementsFromPoint(点.x, 点.y).slice(0, 8).map((e) => `${e.tagName.toLowerCase()}.${(e.className || '').toString().split(' ')[0]}`);
  const 栈2 = document.elementsFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2).slice(0, 8).map((e) => `${e.tagName.toLowerCase()}.${(e.className || '').toString().split(' ')[0]}`);
  const 宿主cs = getComputedStyle(el);
  const 记 = {
    宿主z: 宿主cs.zIndex,
    宿主isolation: 宿主cs.isolation,
    涟漪: { boxSizing: cs.boxSizing, border: cs.borderWidth, z: cs.zIndex, 矩形: [lr.left, lr.top, lr.width, lr.height], 中心: [lr.left + lr.width / 2, lr.top + lr.height / 2], 点击点: [点.x, 点.y] },
    点击点命中栈: 栈,
    涟漪中心命中栈: 栈2
  };
  /* 顺带看祖先里有没有盖在它上面的定位元素 */
  记.祖先层 = [];
  for (let p = el.parentElement, i = 0; p && i < 5; p = p.parentElement, i++) {
    const c = getComputedStyle(p);
    const 伪 = getComputedStyle(p, '::after');
    记.祖先层.push({
      节点: `${p.tagName.toLowerCase()}.${(p.className || '').toString().split(' ')[0]}`,
      position: c.position,
      z: c.zIndex,
      isolation: c.isolation,
      after定位: 伪.position,
      after层级: 伪.zIndex,
      after有内容: 伪.content
    });
  }
  s.remove();
  return 记;
})()
