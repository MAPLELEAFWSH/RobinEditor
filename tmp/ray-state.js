(async () => {
  const m = await import('/src/lib/dropzones.svelte.ts');
  return {
    地址: location.href,
    有工具条: !!document.querySelector('.wbar__l'),
    工具条文字: document.querySelector('.wbar__l')?.innerText?.trim().slice(0, 60) ?? null,
    落点数: m.listZones().length,
    落点id: m.listZones().map((z) => z.id + (z.dir ? '(dir)' : '')),
    侧栏报错: (document.querySelector('.side__err')?.innerText || '').trim() || null,
    页面片段: document.body.innerText.trim().slice(0, 150)
  };
})()
