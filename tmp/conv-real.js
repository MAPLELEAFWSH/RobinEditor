(async () => {
  /* 实战测试：⑦「分块定档」+ 通道约定表，拿真基础色走一遍
     ① 约定条在不在、四套齐不齐
     ② 切到"原神 lightmap"→ 通道名变成 金属度/AO/高亮反光/发光，G 的默认档位变成 0.50
     ③ 画一块 → R 的档位占比跟着变
     ④ 切"三渲二" → A 的含义变"不用" */
  const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 出 = {};
  const t = () => document.body.innerText;
  const 按 = (文) => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 文);
  const 分区行 = (名) => {
    const 行 = [...document.querySelectorAll('.row')].find((r) => (r.querySelector('.row__k')?.textContent || '').trim() === 名);
    return (行?.querySelector('.row__v')?.textContent || '').trim();
  };
  const 档位行 = (通) => {
    const 块 = [...document.querySelectorAll('.grp')].find((g) => (g.querySelector('.grp__t')?.textContent || '').includes(`${通} 各档占多少面积`));
    return (块?.innerText || '').replace(/\n+/g, ' ').trim().slice(0, 80);
  };

  /* 进分区 */
  [...document.querySelectorAll('a.leaf')].find((a) => (a.textContent || '').includes('贴图通道处理'))?.click();
  await 等(1500);
  [...document.querySelectorAll('.seg__btn')].find((b) => (b.textContent || '').includes('分块定档'))?.click();
  await 等(1500);
  出.地址 = location.href;

  /* 塞图 */
  const 响应 = await fetch('/' + encodeURIComponent('预览用基础色.png'));
  出.取到图 = 响应.ok;
  if (!响应.ok) return 出;
  const 槽 = document.querySelector('[data-drop-key^="channels.region"]');
  const r = 槽.getBoundingClientRect();
  const dt = new DataTransfer();
  dt.items.add(new File([await 响应.blob()], 'Vodyanitsa_Body_Diffuse_RGB.png', { type: 'image/png' }));
  for (const 类型 of ['dragenter', 'dragover', 'drop']) {
    槽.dispatchEvent(new DragEvent(类型, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  }
  await 等(4000);
  出.取到块 = (t().match(/\d+×\d+ · \d+ 块[^\n]*/) || [])[0] ?? null;

  /* ① 约定条 */
  出.约定按钮 = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim())
    .filter((x) => ['自定', '原神 lightmap', '三渲二：金属度 + AO + 高光', '本工程实测（三游戏）'].includes(x));

  /* ② 切到原神 lightmap，看通道名与 G 的默认档 */
  按('原神 lightmap')?.click();
  await 等(2500);
  出.切后_通道按钮 = [...document.querySelectorAll('.pick__b')].map((b) => (b.textContent || '').trim())
    .filter((x) => /^(R|G|B|A) /.test(x));
  出.切后_G档位 = 档位行('G');
  出.切后_来源 = (t().match(/来源：[^\n]*/) || [])[0] ?? null;

  /* ③ 选一块、定档 */
  const 图 = document.querySelector('.stage img');
  if (图) {
    const b = 图.getBoundingClientRect();
    图.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: b.left + b.width * 0.5, clientY: b.top + b.height * 0.5 }));
    await 等(500);
    出.选中 = 分区行('选中的块');
    按('选同色的全部块')?.click();
    await 等(500);
    出.选一族 = 分区行('选中的块');
    按('1.00')?.click();
    await 等(600);
    出.定档后_当前通道 = 档位行('R');
  }

  /* ④ 切三渲二，A 的含义应当变 */
  按('三渲二：金属度 + AO + 高光')?.click();
  await 等(2500);
  出.三渲二_通道按钮 = [...document.querySelectorAll('.pick__b')].map((b) => (b.textContent || '').trim())
    .filter((x) => /^(R|G|B|A) /.test(x));
  出.侧栏报错 = (document.querySelector('.side__err')?.innerText || '').trim() || null;
  return 出;
})()
