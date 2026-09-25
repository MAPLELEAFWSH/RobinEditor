(async () => {
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  /* 面板切换在顶部：找到写着「配置开关」的那个按钮点一下 */
  const 候选 = [...document.querySelectorAll('button, a')].filter((b) => (b.textContent || '').includes('配置开关'));
  const 点了 = 候选.length ? 候选[0].textContent.trim() : null;
  候选[0]?.click();
  await 等(1200);
  const m = await import('/src/lib/dropzones.svelte.ts');
  return {
    点了,
    地址: location.href,
    工具条文字: document.querySelector('.wbar__l')?.innerText?.trim().slice(0, 80) ?? null,
    落点: m.listZones().map((z) => ({ id: z.id, dir: !!z.dir, 框: [Math.round(z.rect.left), Math.round(z.rect.top), Math.round(z.rect.right - z.rect.left), Math.round(z.rect.bottom - z.rect.top)] }))
  };
})()
