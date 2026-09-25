(async () => {
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 按文字 = (文) => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 文);
  const 去分区 = async (名) => {
    [...document.querySelectorAll('.seg__btn')].find((x) => (x.textContent || '').includes(名))?.click();
    await 等(1200);
  };
  const 出 = {};
  await 去分区('ShadowRate');

  /* 找准那个"兜底值"滑块（有 aria-label，别按顺序取第一个 —— 第一档可能是别的控件） */
  const 滑块 = document.querySelector('input[aria-label="R 兜底值"]') ?? document.querySelector('input[aria-label="R 常量"]');
  出.找到滑块 = !!滑块;
  出.滑块标签 = 滑块?.getAttribute('aria-label') ?? null;
  if (!滑块) return 出;
  const 原值 = 滑块.value;

  按文字('星铁')?.click();
  await 等(700);
  滑块.value = '0.77';
  滑块.dispatchEvent(new Event('input', { bubbles: true }));
  await 等(500);
  出.星铁改成 = 滑块.value;

  按文字('原神')?.click();
  await 等(800);
  出.切原神后 = document.querySelector('input[aria-label="R 兜底值"], input[aria-label="R 常量"]')?.value ?? null;

  按文字('星铁')?.click();
  await 等(800);
  出.切回星铁后 = document.querySelector('input[aria-label="R 兜底值"], input[aria-label="R 常量"]')?.value ?? null;
  出.星铁标注 = /你存的这套/.test(document.body.innerText) ? '你存的这套' : '还没调过';
  出.原值 = 原值;

  /* 再验落盘：把值写进 localStorage 之后换页回来还在（同一会话内 store 已经存过） */
  出.存了键 = Object.keys(localStorage).filter((k) => k.includes('mstoon'));
  return 出;
})()
