(async () => {
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  /* HMR 之后应用引的是 `?t=…` 那个 URL，直接 import 裸路径会拿到**另一个空实例**
     —— 落点表当然是空的。先问性能条目要应用用的那个 URL。 */
  const 全部 = performance.getEntriesByType('resource').map((e) => e.name);
  const 带时戳 = 全部.find((n) => n.includes('dropzones.svelte.ts?t='));
  const m = await import(带时戳 || '/src/lib/dropzones.svelte.ts');

  if (!location.search.includes('panel=conf')) {
    [...document.querySelectorAll('button, a')].find((x) => (x.textContent || '').includes('配置开关'))?.click();
    await 等(1200);
  }
  const 区 = m.listZones();
  const 目标 = 区.find((z) => z.dir);
  const 出 = {
    用的模块: 带时戳 ? '带时戳那个（应用的实例）' : '裸路径',
    落点: 区.map((z) => ({ id: z.id, dir: !!z.dir, 框: [Math.round(z.rect.left), Math.round(z.rect.top), Math.round(z.rect.right - z.rect.left), Math.round(z.rect.bottom - z.rect.top)] }))
  };
  if (!目标) return { ...出, 没找到认文件夹的落点: true };

  目标.onDrop({
    path: 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例\\渲染联动\\ray\\ray-mmd-1.5.2',
    name: 'ray-mmd-1.5.2',
    rel: 'ray-mmd-1.5.2',
    ext: '',
    size: 0
  });
  await 等(4000);
  const 文 = document.body.innerText;
  return {
    ...出,
    拖进去之后: {
      目录: document.querySelector('.wbar__l .mono')?.textContent?.trim() ?? null,
      看到conf: (文.match(/ray[_.]?conf[^\n]{0,50}/g) || []).slice(0, 3),
      项数: (文.match(/(\d+)\s*项/) || [])[0] ?? null,
      侧栏报错: (document.querySelector('.side__err')?.innerText || '').trim() || null
    }
  };
})()
