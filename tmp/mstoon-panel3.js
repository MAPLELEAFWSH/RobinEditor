(async () => {
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 出 = {};
  const t = () => document.body.innerText;
  const 按文字 = (文) => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 文);

  const 去分区 = async (名) => {
    const b = [...document.querySelectorAll('.seg__btn')].find((x) => (x.textContent || '').includes(名));
    b?.click();
    await 等(1200);
  };

  /* 合成一次 HTML5 拖放把真 PNG 塞进源槽（桌面端原生拖放没法在 CDP 里合成） */
  const 响应 = await fetch('/' + encodeURIComponent('预览用基础色.png'));
  出.取到图 = 响应.ok;
  if (!响应.ok) return 出;
  const 文件 = new File([await 响应.blob()], 'Avatar_RobinS_00_Face_Color.png', { type: 'image/png' });
  const 槽 = document.querySelector('[data-drop-key^="mstoon.src"]');
  出.找到槽 = !!槽;
  if (!槽) return 出;
  const r = 槽.getBoundingClientRect();
  const dt = new DataTransfer();
  dt.items.add(文件);
  for (const 类型 of ['dragenter', 'dragover', 'drop']) {
    槽.dispatchEvent(new DragEvent(类型, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  }
  await 等(4000);
  出.槽里有图 = !/点这里选，或者把文件拖进来/.test(document.querySelector('.panel-host')?.innerText || '');

  /* ① ShadowRate：游戏条在不在 */
  await 去分区('ShadowRate');
  出.shadowrate_游戏条 = /按游戏各存一套/.test(t());
  出.游戏按钮 = [...document.querySelectorAll('.pick__b')].map((b) => (b.textContent || '').trim()).filter((x) => ['原神', '星铁', '绝区零'].includes(x));
  出.初始标注 = (t().match(/你存的这套|还没调过[^\n]*/) || [])[0] ?? null;

  /* ② 切星铁 → 改一个参数 → 切原神 → 切回来，看值还在不在 */
  const 看R档 = () => {
    const 行 = [...document.querySelectorAll('.row')].find((x) => (x.querySelector('.row__k')?.textContent || '').includes('R'));
    return (行?.innerText || '').replace(/\n/g, ' ').trim().slice(0, 40);
  };
  按文字('星铁')?.click();
  await 等(700);
  const R输入 = [...document.querySelectorAll('input[type=number]')][0];
  出.有R输入框 = !!R输入;
  if (R输入) {
    R输入.value = '0.42';
    R输入.dispatchEvent(new Event('input', { bubbles: true }));
    await 等(400);
    出.星铁改后 = 看R档();
    出.星铁标注 = /你存的这套/.test(t()) ? '你存的这套' : '还没调过';
    按文字('原神')?.click();
    await 等(800);
    出.切到原神 = { R档: 看R档(), 标注: /你存的这套/.test(t()) ? '你存的这套' : '还没调过' };
    按文字('星铁')?.click();
    await 等(800);
    出.切回星铁 = { R档: 看R档(), 标注: /你存的这套/.test(t()) ? '你存的这套' : '还没调过' };
  }

  /* ③ FaceSDF：距离场那页 + 星铁出现 0.5 区那一格 */
  await 去分区('FaceSDF');
  出.facesdf_游戏条 = /按游戏各存一套/.test(t());
  按文字('交界线转距离场')?.click();
  await 等(1200);
  出.距离场页 = {
    有排法按钮: !!按文字('星铁'),
    排法说明: (t().match(/R 三档[^\n]*/) || [])[0]?.slice(0, 50) ?? null,
    有预览: !!document.querySelector('.stage img')
  };
  按文字('星铁')?.click();
  await 等(800);
  出.切星铁后_有标记格 = /0\.5 区/.test(t());
  出.侧栏报错 = (document.querySelector('.side__err')?.innerText || '').trim() || null;
  return 出;
})()
