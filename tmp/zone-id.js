(async () => {
  const 名 = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes('dropzones'));
  const m1 = await import('/src/lib/dropzones.svelte.ts');
  const m2 = await import('/src/lib/dropzones.svelte.ts');
  return {
    资源: 名,
    两次同一个: m1 === m2,
    我的落点: m1.listZones().map((z) => z.id),
    工具条: document.querySelector('.wbar__l')?.innerText?.trim().slice(0, 40) ?? null
  };
})()
