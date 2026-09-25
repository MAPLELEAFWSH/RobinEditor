(async () => {
  const 台 = () => [...document.querySelectorAll('.pv')].map((pv) => {
    const 图 = pv.querySelector('img.pv__img');
    const r = 图.getBoundingClientRect();
    return { alt: 图.getAttribute('alt'), x: Math.round(r.left), y: Math.round(r.top) };
  });
  const 点视图 = async (字) => {
    const 摘要 = document.querySelector('.pv__zoom > summary');
    if (摘要 && !document.querySelector('.pv__zoom[open]')) 摘要.click();
    await new Promise((r) => requestAnimationFrame(r));
    [...document.querySelectorAll('.pv__b')].find((x) => (x.textContent || '').trim() === 字)?.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };
  const 拖 = async (第几个, dx, dy) => {
    const pv = [...document.querySelectorAll('.pv')][第几个 - 1];
    const 框 = pv.querySelector('.pv__box');
    const 图 = pv.querySelector('img.pv__img');
    const rb = 框.getBoundingClientRect();
    /* 起点挑图上**确实存在**的一点：图中心（可能不在框中心） */
    const ri = 图.getBoundingClientRect();
    const x = Math.round(ri.left + ri.width / 2), y = Math.round(ri.top + ri.height / 2);
    const 目标 = document.elementFromPoint(x, y) ?? 框;
    const 派 = (类型, xx, yy) => 目标.dispatchEvent(new PointerEvent(类型, {
      bubbles: true, cancelable: true, clientX: xx, clientY: yy, button: 0,
      buttons: 类型 === 'pointerup' ? 0 : 1, pointerId: 1, pointerType: 'mouse', isPrimary: true
    }));
    派('pointerdown', x, y);
    for (let i = 1; i <= 6; i++) 派('pointermove', x + (dx * i) / 6, y + (dy * i) / 6);
    派('pointerup', x + dx, y + dy);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { 命中: 目标.tagName };
  };

  await 点视图('重置');
  const 起 = 台();
  /* 打开同步平移 */
  const 勾 = [...document.querySelectorAll('label.chk')].find((l) => /同步平移/.test(l.textContent || ''));
  const i = 勾?.querySelector('input');
  if (i && !i.checked) i.click();
  await new Promise((r) => requestAnimationFrame(r));
  const 拖的结果 = await 拖(1, 90, 40);
  await new Promise((r) => setTimeout(r, 200));
  const 后 = 台();
  return {
    同步平移开着: !!i?.checked,
    拖命中: 拖的结果.命中,
    起: 起,
    后: 后,
    左视图位移: [后[0].x - 起[0].x, 后[0].y - 起[0].y],
    右视图位移: [后[1].x - 起[1].x, 后[1].y - 起[1].y],
    两边一致: 后[0].x - 起[0].x === 后[1].x - 起[1].x && 后[0].y - 起[0].y === 后[1].y - 起[1].y
  };
})()
