(async () => {
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 带时戳 = performance
    .getEntriesByType('resource')
    .map((e) => e.name)
    .find((n) => n.includes('dropzones.svelte.ts?t='));
  const m = await import(带时戳 || '/src/lib/dropzones.svelte.ts');
  const 区 = m.listZones();
  const 目标 = 区.find((z) => z.dir);
  const 出 = {
    落点: 区.map((z) => ({
      id: z.id,
      dir: !!z.dir,
      框: [Math.round(z.rect.left), Math.round(z.rect.top), Math.round(z.rect.right - z.rect.left), Math.round(z.rect.bottom - z.rect.top)]
    }))
  };
  if (!目标) return { ...出, 没找到认文件夹的落点: true };
  目标.onDrop({
    path: 'E:\\deepseek-harness\\mmd集成工具\\参考工具样本\\MikuMikuEffect-NodeEditor-main\\Main1.0\\Assets\\Controllers',
    name: 'Controllers',
    rel: 'Controllers',
    ext: '',
    size: 0
  });
  await 等(5000);
  const 文 = document.body.innerText;
  return {
    ...出,
    落下去之后: {
      目录: document.querySelector('.card .mono')?.textContent?.trim() ?? null,
      pmx数: (文.match(/\.pmx/g) || []).length,
      提示: (文.match(/扫到[^\n]{0,30}/) || 文.match(/没扫到[^\n]{0,20}/) || [])[0] ?? null,
      侧栏报错: (document.querySelector('.side__err')?.innerText || '').trim() || null
    }
  };
})()
