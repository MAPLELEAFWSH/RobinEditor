(async () => {
  /* 验 ④ 的四件事：
     ① 四个手画分区顶部都在了「游戏」条
     ② 切到星铁 → FaceSDF 的距离场那页出现「0.5 区」那一格
     ③ 切游戏时参数各存一套（改一个值 → 切走 → 切回来还在）
     ④ 距离场预览按排法出图（星铁那张 B 应当全 0、绝区零那张 G 应当恒 0.5） */
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 出 = {};
  const 按文字 = (文) => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 文);

  const 去分区 = async (名) => {
    const 叶 = [...document.querySelectorAll('a.leaf')].find((a) => (a.textContent || '').includes('msToon'));
    叶?.click();
    await 等(900);
    /* 分区按钮的文字是「标签 + hint」拼在一起的，得用 includes 找 */
    const b = [...document.querySelectorAll('button, a')].find((x) => (x.textContent || '').includes(名));
    b?.click();
    await 等(1200);
  };

  /* ① ShadowRate 那页有没有游戏条 */
  await 去分区('ShadowRate');
  出.当前地址 = location.href;
  出.shadowrate_有游戏条 = /游戏/.test(document.body.innerText) && !!按文字('原神') && !!按文字('星铁');

  /* ② EdgeRate 那页 */
  await 去分区('EdgeRate');
  出.edge_有游戏条 = !!按文字('绝区零');

  /* ③ FaceSDF：切星铁 → 出现 0.5 区那一格 */
  await 去分区('FaceSDF');
  出.facesdf_有游戏条 = !!按文字('星铁');
  按文字('星铁')?.click();
  await 等(400);
  出.切星铁后_有标记格 = /0\.5 区/.test(document.body.innerText);
  按文字('交界线转距离场')?.click();
  await 等(800);
  出.距离场页_排法说明 = (document.body.innerText.match(/R 三档[^\n]*/) || [])[0]?.slice(0, 60) ?? null;
  出.距离场页_有预览 = !!document.querySelector('.stage img');

  /* ④ 参数按游戏各存一套：星铁这档改一下阈值，切原神再切回来，值应当还在 */
  const 滑块 = document.querySelector('input[type=range][aria-label=阈值]');
  if (滑块) {
    滑块.value = '77';
    滑块.dispatchEvent(new Event('input', { bubbles: true }));
    await 等(300);
    出.星铁改后 = (document.body.innerText.match(/切在哪儿[\s\S]{0,24}/) || [])[0]?.replace(/\n/g, ' ') ?? null;
    按文字('原神')?.click();
    await 等(600);
    出.切到原神 = (document.body.innerText.match(/切在哪儿[\s\S]{0,24}/) || [])[0]?.replace(/\n/g, ' ') ?? null;
    按文字('星铁')?.click();
    await 等(600);
    出.切回星铁 = (document.body.innerText.match(/切在哪儿[\s\S]{0,24}/) || [])[0]?.replace(/\n/g, ' ') ?? null;
    出.界面上标了谁存的 = /你存的这套|还没调过/.test(document.body.innerText);
  }
  出.侧栏报错 = (document.querySelector('.side__err')?.innerText || '').trim() || null;
  return 出;
})()
