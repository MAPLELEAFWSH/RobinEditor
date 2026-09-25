/**
 * 头一次进来那条逻辑，必须在**模块求值那一刻**就把"存过偏好没有"记下来。
 *
 * 这条是真机上验出来的 bug：界面上判了"该按低配起"，但偏好没变。
 * 根因是挂载顺序 —— 子组件 `AppShell` 的 `$effect` 排在 `+layout` 的 `onMount` 之前，
 * 它那句 `apply()` 一跑就把偏好写盘了；等 `initFromSystem()` 再去问 localStorage，
 * 答案永远是"存过"，整个 first-run 分支等于不存在（顺带发现"首次跟随系统主题"也一直没生效）。
 *
 * 这一套就是照着那个顺序复现的：**先** `apply()`（等于 AppShell 那一下），**再** `initFromSystem()`。
 * 老写法到这里会直接 return，新写法照旧按低配起。
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

/* ---------- 摆好 Node 里没有的东西，再 import ---------- */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear()
};
/* apply() 要往 :root 写属性，给个最小的替身让它真跑起来（这样 save() 也会被调到） */
globalThis.document = {
  documentElement: {
    setAttribute() {},
    style: { setProperty() {} }
  }
};
globalThis.matchMedia = () => ({ matches: false });
/* Node 25 自带一个只有 getter 的 navigator，得整条属性换掉 */
Object.defineProperty(globalThis, 'navigator', {
  value: { hardwareConcurrency: 2, deviceMemory: 4 },
  configurable: true,
  writable: true
});

const prefsMod = await import('../src/lib/prefs.svelte.ts');
const { prefs, initFromSystem, looksSmall, machineHint, autoLowSpec, apply, LOW_SPEC } = prefsMod;

ok(!store.has('robin.prefs'), '模块求值时盘上是空的（这就是"头一次进来"）');

/* ---------- 纯函数：什么样的机器算小 ---------- */
eq(machineHint().cores, 2, '读得到核数');
eq(machineHint().mem, 4, '读得到内存档');
eq(looksSmall(), true, '2 核 / 4 GB 算小');
globalThis.navigator.hardwareConcurrency = 16;
globalThis.navigator.deviceMemory = 32;
eq(looksSmall(), false, '16 核 / 32 GB 不算小');
globalThis.navigator.hardwareConcurrency = 2;
globalThis.navigator.deviceMemory = 4;
eq(looksSmall(), true, '换回小机器还算小');

/* ---------- 关键那一步：先 apply()（等于 AppShell 的 $effect），再 initFromSystem() ---------- */
apply();
ok(store.get('robin.prefs') !== null, 'apply() 一跑盘上就有偏好了 —— 所以"盘上有没有"这个条件已经不再说明是不是头一次');

initFromSystem();

eq(prefs.motion, LOW_SPEC.motion, '自动低配：动效');
eq(prefs.glass, LOW_SPEC.glass, '自动低配：毛玻璃');
eq(prefs.bgMode, LOW_SPEC.bgMode, '自动低配：背景');
eq(prefs.fpsLive, LOW_SPEC.fpsLive, '自动低配：尾栏帧率');
eq(autoLowSpec.used, true, '记下了"这次是自动按低配起的"（面板要照着说一句话）');

/* 再调一次不该重复做（也不该报错） */
const before = JSON.stringify({ ...prefs });
initFromSystem();
eq(JSON.stringify({ ...prefs }), before, '连着调两次，第二次什么都不做');

console.log(`prefs-first-run：${n} 条断言，${bad} 条没过`);
