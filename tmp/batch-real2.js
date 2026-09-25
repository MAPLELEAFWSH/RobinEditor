(async () => {
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 出 = { 地址: location.href };
  const 侧 = [...document.querySelectorAll('.wb__side')].pop();
  const 组 = [...(侧?.querySelectorAll('.grp') ?? [])].find((g) => (g.querySelector('.grp__t')?.textContent || '').includes('跑什么'));
  出.跑什么_选项 = [...(组?.querySelectorAll('label') ?? [])].map((l) => (l.textContent || '').trim().replace(/\s+/g, ' '));
  出.单选框数 = 组?.querySelectorAll('input[type=radio]').length ?? 0;
  /* 选一下新补的那条，看会不会报错 */
  const 新条 = [...(组?.querySelectorAll('label') ?? [])].find((l) => (l.textContent || '').includes('法线 B↔R'));
  出.有法线条 = !!新条;
  新条?.querySelector('input')?.click();
  await 等(600);
  出.选了之后 = (document.body.innerText.match(/跑什么[\s\S]{0,40}/) || [])[0]?.replace(/\n/g, ' ').slice(0, 60) ?? null;
  出.侧栏报错 = (document.querySelector('.side__err')?.innerText || '').trim() || null;
  return 出;
})()
