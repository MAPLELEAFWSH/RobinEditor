/**
 * 存过偏好的机器：`initFromSystem()` 一个字都不许动。
 *
 * 跟 `prefs-first-run.test.mjs` 是一对 —— **必须是两个文件**：
 * "头一次进来"这个事实是模块求值那一刻定下来的，而 Node 的模块缓存按 URL 走，
 * 同一个进程里 import 第二次拿到的是同一份，换不掉那个事实。
 * 分成两个文件，各自一个进程，才是最干净的"两种机器"。
 *
 * 顺带把这条钉住：小机器 + **已经存过偏好** = 不许自动降档（人家自己调过的东西不能被覆盖）。
 */
let n = 0;
let bad = 0;
const ok = (c, m) => {
  n++;
  if (!c) {
    bad++;
    console.error(`FAIL ${m}`);
    process.exitCode = 1;
  }
};
const eq = (a, b, m) => ok(a === b, `${m}（期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}）`);

/* 盘上先放一份"用户自己调过"的偏好：整档关掉低配的特征值 */
const 存过的 = {
  hue: 130,
  theme: 'dark',
  bgMode: 'carousel',
  bgScope: 'work',
  bgFit: 'cover',
  bgPos: 'center center',
  bg: 'wp-03',
  bgEvery: 15,
  bgOpacity: 90,
  cardOpacity: 92,
  sideOpacity: 100,
  barOpacity: 100,
  sbOpacity: 100,
  panelOpacity: 98,
  cardBorder: true,
  soften: false,
  motion: 'full',
  glass: 'lite',
  fpsLive: true,
  collapsed: false,
  hiddenBgs: [],
  bgOrder: []
};

const store = new Map([['robin.prefs', JSON.stringify(存过的)]]);
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear()
};
globalThis.document = { documentElement: { setAttribute() {}, style: { setProperty() {} } } };
globalThis.matchMedia = () => ({ matches: false });
Object.defineProperty(globalThis, 'navigator', {
  value: { hardwareConcurrency: 2, deviceMemory: 4 },
  configurable: true,
  writable: true
});

const { prefs, initFromSystem, looksSmall, autoLowSpec } = await import('../src/lib/prefs.svelte.ts');

eq(looksSmall(), true, '这台机器确实算小');
eq(prefs.motion, 'full', '读出来的是存过的那份');
eq(prefs.hue, 130, '主题色也是存过的那份');

initFromSystem();

eq(prefs.motion, 'full', '存过偏好就不许自动降档：动效');
eq(prefs.glass, 'lite', '存过偏好就不许自动降档：毛玻璃');
eq(prefs.bgMode, 'carousel', '存过偏好就不许自动降档：背景');
eq(prefs.fpsLive, true, '存过偏好就不许自动降档：尾栏帧率');
eq(prefs.theme, 'dark', '存过的主题也不许被系统主题顶掉');
eq(autoLowSpec.used, false, '不该标记成"自动低配"');

console.log(`prefs-saved：${n} 条断言，${bad} 条没过`);
