(() => {
  /* 环要从指针处荡开：涟漪的框中心应当正好落在点击点上（边框算不算进尺寸里直接影响这 2px） */
  const el = document.querySelector('.btn');
  const b = el.getBoundingClientRect();
  const 点 = { x: b.left + b.width / 2 + 7, y: b.top + b.height / 2 - 3 };
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 点.x, clientY: 点.y }));
  const s = el.querySelector(':scope > .ripple');
  if (!s) return { 没有涟漪: true };
  const a = s.getAnimations()[0];
  const 原 = a ? a.currentTime : null;
  if (a) { a.pause(); a.currentTime = 0; }
  const lr = s.getBoundingClientRect();
  const 中心 = [lr.left + lr.width / 2, lr.top + lr.height / 2];
  const 结果 = {
    boxSizing: getComputedStyle(s).boxSizing,
    点击点: [+点.x.toFixed(2), +点.y.toFixed(2)],
    框中心: [+中心[0].toFixed(2), +中心[1].toFixed(2)],
    偏差: [+(中心[0] - 点.x).toFixed(2), +(中心[1] - 点.y).toFixed(2)],
    尺寸: [+lr.width.toFixed(2), +lr.height.toFixed(2)]
  };
  s.remove();
  return 结果;
})()
