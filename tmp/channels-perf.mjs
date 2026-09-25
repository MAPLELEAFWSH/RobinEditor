/**
 * ⑦ 的性能实测。纯运算，不碰画布。
 *
 * 量三件事：
 *   1. 拖滑杆时一帧要花多少（预览 320 长边，4 层带蒙版和调整）
 *   2. 导出时全尺寸要花多少（1024² 和 2048²）
 *   3. 缓存命中能省多少
 *
 * 跑：node --import ./tmp/register-loader.mjs tmp/channels-perf.mjs
 */
import {
  LayerCache,
  applyAdjust,
  applyPlan,
  boxBlur,
  buildMask,
  composite,
  makeLayer,
  makeMask,
  GAMES
} from '../src/lib/modules/channels/ops.ts';

function noise(w, h, seed = 1) {
  const im = new ImageData(w, h);
  let s = seed;
  for (let i = 0; i < w * h; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    im.data[i * 4] = s & 255;
    im.data[i * 4 + 1] = (s >> 8) & 255;
    im.data[i * 4 + 2] = (s >> 16) & 255;
    im.data[i * 4 + 3] = 255;
  }
  return im;
}

function time(label, fn, runs = 5) {
  fn(); // 预热，让 JIT 先编好
  const ts = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    ts.push(performance.now() - t0);
  }
  ts.sort((a, b) => a - b);
  const med = ts[ts.length >> 1];
  console.log(
    `  ${label.padEnd(42)} 中位 ${med.toFixed(1).padStart(7)} ms   最好 ${ts[0].toFixed(1).padStart(6)}   最差 ${ts[ts.length - 1].toFixed(1).padStart(6)}`
  );
  return med;
}

function stack(w, h, n, withMask = true) {
  const map = new Map();
  const layers = [];
  const names = ['diffuse', 'lightmap', 's3', 's4'];
  for (let i = 0; i < n; i++) {
    const id = names[i] ?? `x${i}`;
    map.set(id, noise(w, h, i + 1));
    const l = makeLayer(`层${i}`, id, i % 2 === 0 ? 'rgb' : 'b');
    l.blend = (['normal', 'multiply', 'screen', 'overlay', 'soft-light'])[i % 5];
    l.opacity = 0.85;
    if (i > 0) {
      l.adjust = [{ k: 'levels', inBlack: 4, inWhite: 250, gamma: 1.05, outBlack: 0, outWhite: 255 }];
    }
    if (withMask) {
      l.mask = { ...makeMask(), on: true, slot: names[1] ?? 'diffuse', ch: 'b', black: 12, white: 220, blur: 2 };
    }
    layers.push(l);
  }
  return { layers, map };
}

console.log('== 1. 预览：320 长边，拖一下滑杆要算多久 ==');
{
  const { layers, map } = stack(320, 320, 4);
  const cache = new LayerCache(64);
  time('4 层 + 蒙版 + 调整（首次，无缓存）', () => {
    cache.clear();
    composite(320, 320, layers, map, { cache });
  });
  // 预热缓存
  composite(320, 320, layers, map, { cache });
  time('4 层 + 蒙版 + 调整（参数没变，全命中）', () => composite(320, 320, layers, map, { cache }));

  // 只有最上面一层的参数在变（拖那个图层的滑杆）
  const only = [...layers];
  time('4 层，只改最上层的混合模式', () => {
    const top = { ...layers[3], blend: 'hard-light' };
    composite(320, 320, [...only.slice(0, 3), top], map, { cache });
  });

  const noMask = stack(320, 320, 4, false);
  time('4 层，不带蒙版（对照）', () => {
    const c2 = new LayerCache(64);
    composite(320, 320, noMask.layers, noMask.map, { cache: c2 });
  });
}

console.log('\n== 2. 单步运算的单价（320×320） ==');
{
  const src = noise(320, 320);
  time('applyAdjust 一条色阶（LUT）', () =>
    applyAdjust(src, [{ k: 'levels', inBlack: 4, inWhite: 250, gamma: 1.2, outBlack: 0, outWhite: 255 }], 'all')
  );
  time('applyAdjust 一条 HSL（逐像素）', () =>
    applyAdjust(src, [{ k: 'hsl', hue: 20, sat: 15, light: 0 }], 'all')
  );
  time('applyAdjust 只改明度（走 LUT 快路）', () =>
    applyAdjust(src, [{ k: 'hsl', hue: 0, sat: 0, light: 10 }], 'all')
  );
  time('applyAdjust 一条色彩平衡（逐像素）', () =>
    applyAdjust(src, [{ k: 'color-balance', sh: [10, 0, -10], mi: [0, 0, 0], hi: [-5, 0, 5], preserve: true }], 'all')
  );
  time('applyAdjust 五条串起来', () =>
    applyAdjust(
      src,
      [
        { k: 'levels', inBlack: 4, inWhite: 250, gamma: 1.1, outBlack: 0, outWhite: 255 },
        { k: 'brightness-contrast', brightness: 4, contrast: 10 },
        { k: 'hsl', hue: 8, sat: 10, light: 0 },
        { k: 'curves', pts: [{ x: 0, y: 0 }, { x: 0.5, y: 0.55 }, { x: 1, y: 1 }], mode: 'smooth' },
        { k: 'color-balance', sh: [5, 0, -5], mi: [0, 0, 0], hi: [0, 0, 0], preserve: true }
      ],
      'all'
    )
  );
  time('applyAdjust 五条但都是默认值（应该整个跳过）', () =>
    applyAdjust(
      src,
      [
        { k: 'levels', inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
        { k: 'brightness-contrast', brightness: 0, contrast: 0 },
        { k: 'hsl', hue: 0, sat: 0, light: 0 },
        { k: 'curves', pts: [{ x: 0, y: 0 }, { x: 1, y: 1 }], mode: 'linear' },
        { k: 'color-balance', sh: [0, 0, 0], mi: [0, 0, 0], hi: [0, 0, 0], preserve: true }
      ],
      'all'
    )
  );
  const plane = new Uint8ClampedArray(320 * 320);
  for (let i = 0; i < plane.length; i++) plane[i] = i & 255;
  time('boxBlur 半径 2', () => boxBlur(plane, 320, 320, 2));
  time('boxBlur 半径 24', () => boxBlur(plane, 320, 320, 24), 3);
  const srcImg = noise(320, 320);
  time('buildMask（取通道 + 色阶 + 模糊 2）', () =>
    buildMask({ ...makeMask(), on: true, slot: 'm', ch: 'b', black: 10, white: 220, blur: 2 }, srcImg, 320, 320)
  );
}

console.log('\n== 3. 导出：全尺寸 ==');
{
  for (const [w, h, label] of [[1024, 1024, '1024×1024'], [2048, 2048, '2048×2048']]) {
    const { layers, map } = stack(w, h, 4);
    time(`${label} · 4 层 + 蒙版 + 调整`, () => {
      const c = new LayerCache(8);
      composite(w, h, layers, map, { cache: c });
    }, 3);
  }
  // 原神 lightmap 常见尺寸
  const g = GAMES.find((x) => x.id === 'zzz');
  const A = noise(2048, 2048, 3);
  const M = noise(2048, 2048, 4);
  const N = noise(1024, 1024, 5);
  time('2048² · 绝区零 LM 打包（含半分辨率放大 + 量化）', () =>
    applyPlan(2048, 2048, g.plan, new Map([['a', A], ['m', M], ['n', N]]))
  , 3);
}

console.log('\n== 4. 帧预算对照 ==');
console.log('  16.7ms 是 60fps 一帧的预算。上面的数都在这个数以下的话，拖滑杆不会掉帧。');
