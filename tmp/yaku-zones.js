(async () => {
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  await 等(1500);
  const m = await import('/src/lib/dropzones.svelte.ts');
  return { 地址: location.href, 落点id: m.listZones().map((z) => z.id), 数据属性落点: document.querySelectorAll('[data-drop-target]').length };
})()
