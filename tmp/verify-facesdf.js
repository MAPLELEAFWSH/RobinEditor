/**
 * 验 ④ FaceSDF 面板真手感：造一张图拖进去，然后点两档。
 *
 * 跑法（要 dev 起着 + 9222 开着，且页面已在 /tools/mstoon?panel=facesdf）：
 *   node tmp/cdp.mjs tmp/verify-facesdf.js
 *
 * 为什么要造图：`Mstoon.svelte` 整块被 `{#if !srcSlot.data}` 门住，
 * 没载素材时四个分区渲染的是同一个"先选源图"屏，点分区什么都验不到。
 * 载图本来要走原生对话框，脚本点不动 —— 但 `Slots.loadFile` 用的是
 * `createImageBitmap(file)`，所以**合成一个 File 走拖放**这条路是通的。
 */
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};

  // 造一张不是纯色的图（免得"看起来对"其实是空白）
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, '#102040');
  grad.addColorStop(0.5, '#80c0ff');
  grad.addColorStop(1, '#ffffff');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#ff0040';
  g.fillRect(96, 96, 64, 64);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  out.造的图 = blob ? `${blob.size} 字节` : '失败';

  const slot = document.querySelector('[aria-label="源图"]') || document.querySelector('.slot');
  out.找到源图槽 = !!slot;
  if (!slot) return out;

  const file = new File([blob], 'verify-facesdf.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const target = slot.querySelector('button') || slot;
  for (const type of ['dragenter', 'dragover', 'drop']) {
    target.dispatchEvent(
      new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })
    );
  }
  await wait(1500);

  const T = () => {
    const host = document.querySelector('.panel-host');
    const t = (host?.innerText || '').replace(/\s+/g, ' ').trim();
    return {
      组标题: [...document.querySelectorAll('.grp__t')].map((e) => e.textContent.trim()),
      模式按钮: [...document.querySelectorAll('.pick__b')]
        .map((b) => b.textContent.trim() + (b.getAttribute('aria-pressed') === 'true' ? '（按下）' : ''))
        .slice(0, 6),
      滑杆: document.querySelectorAll('.panel-host input[type=range]').length,
      勾选: document.querySelectorAll('.panel-host input[type=checkbox]').length,
      主区标题: [...document.querySelectorAll('.panel-host .h3')].map((e) => e.textContent.trim()),
      文本片段: t.slice(0, 130)
    };
  };
  out.载图后 = T();
  out.还是门屏 = (out.载图后.文本片段 || '').includes('点这里选');

  const byText = (t) =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t);

  // 切到距离场
  const dist = byText('交界线转距离场');
  out.找到距离场按钮 = !!dist;
  if (dist) {
    dist.click();
    await wait(1200);
    out.点距离场后 = T();
  }

  // 切回取通道
  const chan = byText('取通道');
  out.找到取通道按钮 = !!chan;
  if (chan) {
    chan.click();
    await wait(1200);
    out.点取通道后 = T();
  }

  // 换一路（选 B）
  const bBtn = [...document.querySelectorAll('.pick__b')].find((b) => b.textContent.trim() === 'B');
  out.找到B按钮 = !!bBtn;
  if (bBtn) {
    bBtn.click();
    await wait(1200);
    out.选B后 = T();
  }

  // 反相勾上
  const chk = document.querySelector('.panel-host input[type=checkbox]');
  out.找到反相勾选 = !!chk;
  if (chk) {
    chk.click();
    await wait(1200);
    out.勾反相后 = T();
  }

  // 导出按钮在不在（点了会写盘，这里只看状态）
  const exp = [...document.querySelectorAll('button')].find((b) =>
    /导出/.test(b.textContent)
  );
  out.导出按钮 = exp ? { 文字: exp.textContent.trim().slice(0, 12), 禁用: exp.disabled } : null;

  return out;
})();
