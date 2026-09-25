/**
 * 通用拖放落点（`dropzones.svelte.ts`）的自检。
 *
 * 跑：node --import ./tmp/register-loader.mjs tmp/dropzones.test.mjs
 *
 * 这一套盯的是纯逻辑：谁认领、重叠时谁赢、高亮怎么换、撤销之后干不干净。
 * 真机那条（真路径落进输入框）在 PROGRESS 里记着，脚本验不了 —— 它要系统层的拖放。
 */
import {
  DROP_HOT_CLASS,
  listZones,
  noticeForward,
  registerZone,
  resetZones,
  unregisterZone,
  updateRect,
  zoneAt,
  zonesAt,
  zoneIds
} from '../src/lib/dropzones.svelte.ts';
import { parseFileRef } from '../src/lib/drop.ts';

let pass = 0;
let fail = 0;
function ok(cond, label, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${extra ? '  → ' + extra : ''}`);
  }
}
// 自检 ok() 本身
{
  const before = fail;
  const real = console.log;
  console.log = () => {};
  ok(false, '__selfcheck__');
  console.log = real;
  if (fail !== before + 1) {
    console.error('ok() 本身是坏的：条件为假没被记成失败');
    process.exit(1);
  }
  fail = before;
}
const eq = (a, b, label) => ok(a === b, label, `实得 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}`);

/** 假元素：`noticeForward` 只用 `el.classList` 这三下 */
function fakeEl(initial = '') {
  const set = new Set(initial ? initial.split(' ').filter(Boolean) : []);
  return {
    classList: {
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
      contains: (c) => set.has(c)
    },
    有: (c) => set.has(c)
  };
}
/** 造一个落点。`el` 只给需要测高亮的用 */
const box = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b });
const zone = (id, rect, el = null, onDrop = () => {}) => ({ id, rect, el, onDrop });

resetZones();

/* ================================================================ */
console.log('\n== 1. 注册与撤销 ==');
{
  resetZones();
  eq(zoneIds().length, 0, '一开始是空的');

  const a = fakeEl();
  registerZone(zone('a', box(0, 0, 100, 100), a));
  eq(zoneIds().join(','), 'a', '注册进来一个');
  eq(a.有(DROP_HOT_CLASS), false, '刚注册时不该带高亮');

  registerZone(zone('b', box(0, 0, 50, 50)));
  eq(zoneIds().join(','), 'a,b', '两个都在（按 id 排）');
  eq(listZones().length, 2, 'listZones 也数得到两个');

  unregisterZone('a');
  eq(zoneIds().join(','), 'b', '撤掉 a');
  eq(listZones().length, 1, '表里就剩一个');

  registerZone(zone('', box(0, 0, 10, 10)));
  eq(zoneIds().length, 1, 'id 是空的拒收');

  /* 同 id 再注册一次 = 覆盖，不该出现两个 */
  registerZone(zone('b', box(0, 0, 200, 200)));
  eq(listZones().length, 1, '同 id 覆盖，不重复');
  eq(listZones()[0].rect.right, 200, '覆盖的是新的矩形');
}

console.log('\n== 2. 命中判定 ==');
{
  resetZones();
  registerZone(zone('panel', box(0, 0, 400, 300)));
  registerZone(zone('row', box(50, 100, 350, 130)));

  eq(zoneAt(10, 10)?.id, 'panel', '只在面板里 → 面板');
  eq(zoneAt(200, 115)?.id, 'row', '压在一行上 → 那一行（面积更小，更具体）');
  eq(zoneAt(200, 200)?.id, 'panel', '行下面 → 面板');
  eq(zoneAt(500, 500), null, '都不在 → null');
  eq(zoneAt(0, 0)?.id, 'panel', '左上角算在里面（闭区间）');
  eq(zoneAt(400, 300)?.id, 'panel', '右下角也算在里面');

  /* 同面积的两块重叠时，后注册的不该抢 —— 取第一个遇到的更小面积，
     这里两块一样大，行为是"先注册的赢"，钉住它免得以后改乱 */
  resetZones();
  registerZone(zone('first', box(0, 0, 100, 100)));
  registerZone(zone('second', box(0, 0, 100, 100)));
  eq(zoneAt(50, 50)?.id, 'first', '同面积重叠时先注册的赢');
}

console.log('\n== 3. 高亮换人 ==');
{
  resetZones();
  const a = fakeEl();
  const b = fakeEl();
  registerZone(zone('a', box(0, 0, 100, 100), a));
  registerZone(zone('b', box(0, 0, 100, 100), b));

  noticeForward(null);
  eq(a.有(DROP_HOT_CLASS), false, '传 null 谁都不亮');
  eq(b.有(DROP_HOT_CLASS), false, '两个都不亮');

  noticeForward(zoneAt(50, 50));
  eq(a.有(DROP_HOT_CLASS), true, '指到的那块亮了');

  /* 换到另一个：上一块必须灭，不能两块同时亮 */
  const bz = listZones().find((z) => z.id === 'b');
  noticeForward(bz);
  eq(b.有(DROP_HOT_CLASS), true, '新的一块亮');
  eq(a.有(DROP_HOT_CLASS), false, '旧的一块灭了（同时亮两块就是错的）');

  /* 撤销时要顺手把高亮摘掉，不然会留一个亮着但没有落点的框 */
  unregisterZone('b');
  eq(b.有(DROP_HOT_CLASS), false, '撤销时高亮一起摘');

  noticeForward(null);
  eq(a.有(DROP_HOT_CLASS), false, '再传 null 也干净');
}

console.log('\n== 4. 矩形重算（滚动/缩放之后要用） ==');
{
  resetZones();
  const el = { getBoundingClientRect: () => box(10, 20, 110, 60) };
  registerZone(zone('r', box(0, 0, 1, 1), el));
  eq(zoneAt(50, 40), null, '旧矩形只有 1×1，指不中');

  updateRect('r', el);
  eq(zoneAt(50, 40)?.id, 'r', '重算之后能指中了');

  /* 元素换了位置，重算要跟上 */
  const moved = { getBoundingClientRect: () => box(200, 300, 300, 340) };
  updateRect('r', moved);
  eq(zoneAt(50, 40), null, '挪走之后旧位置不认了');
  eq(zoneAt(250, 320)?.id, 'r', '新位置认得');

  /* 认不出的 id 不该炸 */
  updateRect('不存在', moved);
  ok(true, '给不存在的 id 重算不抛异常');
}

console.log('\n== 5. 落下去 ==');
{
  resetZones();
  const got = [];
  registerZone(zone('t', box(0, 0, 100, 100), fakeEl(), (ref) => got.push(ref.path)));
  const z = zoneAt(50, 50);
  eq(z?.id, 't', '找得到');
  z.onDrop({ path: 'D:/a/b.png', name: 'b.png', rel: 'b.png', ext: 'png', size: 3 });
  eq(got.join(','), 'D:/a/b.png', '回调拿到的是真路径');
}

console.log('\n== 6. 清空 ==');
{
  resetZones();
  registerZone(zone('x', box(0, 0, 100, 100)));
  resetZones();
  eq(listZones().length, 0, 'resetZones 清干净');
}

console.log('\n== 7. 落点各自收什么后缀（accept） ==');
{
  /* 起由：`.fx` / `.pmm` 不是图片，原来一律被"不是图片，没接"挡在门口
     （2026-09-21 用户实测：拖工程文件进来报这个；材质也不能拖）。
     现在筛法跟着落点走，这里是那条规则的钉子。 */
  eq(parseFileRef('D:/a/b.png')?.name, 'b.png', '不写 accept = 老行为：收图片');
  eq(parseFileRef('D:/a/b.pmm'), null, '不写 accept：工程文件不收（老行为）');

  eq(parseFileRef('D:/a/b.pmm', null)?.name, 'b.pmm', "accept:'any' 收任何文件");
  eq(parseFileRef('D:/a/b.emm', null)?.ext, 'emm', "accept:'any' 连 .emm 也收");
  eq(parseFileRef('D:/a/b.没有后缀', null)?.name, 'b.没有后缀', "accept:'any' 没有后缀也收");

  eq(parseFileRef('D:/a/mat_body.fx', ['fx', 'fxsub'])?.name, 'mat_body.fx', '给后缀数组：列表里的收');
  eq(parseFileRef('D:/a/mat.fxsub', ['fx', 'fxsub'])?.ext, 'fxsub', '给后缀数组：列表里的收（fxsub）');
  eq(parseFileRef('D:/a/b.png', ['fx', 'fxsub']), null, '给后缀数组：不在列表里的不收');
  eq(parseFileRef('D:/a/MAT.FX', ['fx'])?.ext, 'fx', '后缀比大小写无关');

  /* 落点带着 accept 注册，别的行为不受影响 */
  resetZones();
  registerZone({ ...zone('m', box(0, 0, 50, 50)), accept: ['fx', 'fxsub'] });
  const z = zoneAt(10, 10);
  eq(z?.id, 'm', '带 accept 的落点照常能指中');
  ok(Array.isArray(z?.accept), 'accept 跟着落点存下来了');
}

console.log('\n== 8. 叠着的落点要能逐个拿出来（挑"收得下"的那个用） ==');
{
  /* 起由：贴图那一行只收图片、面积更小，压在它上面的 `.fx` 会被它拒收。
     只给"最小的那个"的话，整页那个落点就等于不存在 —— 拖材质进来正好卡这儿。 */
  resetZones();
  registerZone(zone('页', box(0, 0, 400, 400)));
  registerZone(zone('行', box(100, 100, 200, 150)));

  eq(zonesAt(150, 120).map((z) => z.id).join(','), '行,页', '压在行上：行在前（面积小）');
  eq(zonesAt(300, 300).map((z) => z.id).join(','), '页', '不在行上：只有页');
  eq(zonesAt(900, 900).length, 0, '都不在：空数组');
  eq(zoneAt(150, 120)?.id, '行', 'zoneAt 还是给最具体的那个（老行为没变）');
  eq(zonesAt(150, 120).length, 2, '两个都拿得到');

  /* 同面积的按注册顺序 */
  resetZones();
  registerZone(zone('先', box(0, 0, 100, 100)));
  registerZone(zone('后', box(0, 0, 100, 100)));
  eq(zonesAt(50, 50).map((z) => z.id).join(','), '先,后', '同面积时先注册的排前面');
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
