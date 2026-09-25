(async () => {
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  /* 面板可能被"上次用的那个"占着，先切到配置开关 */
  if (!location.search.includes('panel=conf')) {
    const b = [...document.querySelectorAll('button, a')].find((x) => (x.textContent || '').includes('配置开关'));
    b?.click();
    await 等(1200);
  }
  const m = await import('/src/lib/dropzones.svelte.ts');
  const 区 = m.listZones();
  const 目标 = 区.find((z) => z.dir);
  const 出 = {
    地址: location.href,
    落点: 区.map((z) => ({
      id: z.id,
      dir: !!z.dir,
      框: [Math.round(z.rect.left), Math.round(z.rect.top), Math.round(z.rect.right - z.rect.left), Math.round(z.rect.bottom - z.rect.top)]
    }))
  };
  if (!目标) return { ...出, 没找到认文件夹的落点: true };

  /* 把真目录直接交给落点 —— 系统级拖放没法在 CDP 里合成，
     但"落点收到一个文件夹路径之后干什么"这条链能整条跑通 */
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
      rayconf: (文.match(/ray[_.]?conf[^\n]{0,40}/) || [])[0] ?? null,
      项数: (文.match(/(\d+)\s*项/) || [])[0] ?? null,
      材质数: (文.match(/材质[^\n]{0,30}/) || [])[0] ?? null,
      侧栏报错: (document.querySelector('.side__err')?.innerText || '').trim() || null
    }
  };
})()
