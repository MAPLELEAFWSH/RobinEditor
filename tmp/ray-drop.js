(async () => {
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  await 等(1200);
  const m = await import('/src/lib/dropzones.svelte.ts');
  const 区 = m.listZones().map((z) => ({ id: z.id, dir: !!z.dir, 框: [Math.round(z.rect.left), Math.round(z.rect.top), Math.round(z.rect.right - z.rect.left), Math.round(z.rect.bottom - z.rect.top)], 节点: z.el ? z.el.className : null }));
  const 目标 = m.listZones().find((z) => z.dir);
  let 落下去 = null;
  if (目标) {
    目标.onDrop({ path: 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例\\渲染联动\\ray\\ray-mmd-1.5.2', name: 'ray-mmd-1.5.2', rel: 'ray-mmd-1.5.2', ext: '', size: 0 });
    await 等(2500);
    落下去 = {
      目录行: document.querySelector('.wbar__l .mono')?.textContent?.trim() ?? null,
      提示: (document.body.innerText.match(/[^\n]*ray\.conf[^\n]*/) || [])[0]?.slice(0, 120) ?? null,
      侧栏报错: (document.querySelector('.side__err')?.innerText || '').trim() || null,
      项数: (document.body.innerText.match(/(\d+) 项/) || [])[0] ?? null
    };
  }
  return { 落点: 区, 拖进去之后: 落下去 };
})()
