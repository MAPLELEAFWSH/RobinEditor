/**
 * 拖放落点判断的自检。
 *
 * 这一套跟别的不同：它验不了"真人拖得动"。真拖放走系统层，
 * CDP 合成事件不经过它 —— 上一轮就是被这个骗过去的（合成 drop "通过"了，真人拖不动）。
 * 所以这里只钉住**能钉的那部分**：路径解析、落点选择、多文件怎么铺、装不下怎么报。
 * 剩下那条（真 WebView 里拖一张图进来、像素对不对）只能人工过。
 *
 * 跑：node --import ./tmp/register-loader.mjs tmp/drop-ops.test.mjs
 */
import {
  applyDrop,
  baseOfPath,
  createDragState,
  dropOrder,
  dropPlan,
  extOfName,
  isDroppable,
  parseFileObj,
  parseFileRef,
  registeredKeys,
  resetDropRegistry,
  setSlotOrder,
  slotKey,
  unregisterDropGroup,
  registerDropGroup
} from '../src/lib/drop.ts';

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
// 自检 ok() 本身：条件为假必须记成失败
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
function eq(a, b, label) {
  ok(a === b, label, `实得 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}`);
}
function section(t) {
  console.log(`\n== ${t} ==`);
}

/* ---------------------------------------------------------------
   假的一组槽。真身是 wb.svelte.ts 的 Slots —— 那边是 .svelte.ts
   （带 runes），Node 里引不进来，所以这里照着 DropGroup 那份契约搭一个。
   --------------------------------------------------------------- */
function fakeGroup(key, defs, filled = []) {
  const has = new Set(filled);
  const log = [];
  const errors = [];
  return {
    key,
    defs,
    log,
    errors,
    loaded: (id) => has.has(id),
    /* 填上就算有图，这样"一批里第二张该去哪儿"才看得出来 */
    loadRef: async (id, ref) => {
      log.push({ id, name: ref.name, path: ref.path });
      has.add(id);
    },
    loadFile: async (id, file) => {
      log.push({ id, name: file.name, path: '' });
      has.add(id);
    },
    fail: (msg) => errors.push(msg)
  };
}

const DEFS4 = [
  { id: 's1', label: '一' },
  { id: 's2', label: '二' },
  { id: 's3', label: '三' },
  { id: 's4', label: '四' }
];

const st = () => createDragState(() => {});

/* ================================================================ */
section('1. 这个模块在 Node 里能直接跑');
{
  /* 引得到就说明它没顺手把 svelte 或 DOM 拖进来。
     真引到了这里会直接抛，整套跑不下去。 */
  ok(typeof applyDrop === 'function', 'applyDrop 可调用');
  ok(typeof registerDropGroup === 'function', 'registerDropGroup 可调用');
  ok(typeof window === 'undefined', '这个环境里确实没有 window');
}

section('2. 槽位键');
{
  eq(slotKey('channels.split', 'src'), 'channels.split::src', '组名::槽位id');
  eq(slotKey('channels.game.zzz', 'a'), 'channels.game.zzz::a', '组名里本来有点也不影响');
}

section('3. 路径与扩展名');
{
  eq(baseOfPath('D:\\素材\\a.PNG'), 'a.PNG', '反斜杠');
  eq(baseOfPath('D:/素材/a.png'), 'a.png', '正斜杠');
  eq(baseOfPath('D:\\素材\\'), '素材', '去掉尾部分隔符');
  eq(baseOfPath('a.png'), 'a.png', '光文件名');

  eq(extOfName('a.PNG'), 'png', '大写归成小写');
  eq(extOfName('a.tga'), 'tga', 'tga');
  eq(extOfName('README'), '', '没后缀是空串');
  eq(extOfName('.gitignore'), 'gitignore', '点开头按最后一个点切');
}

section('4. 认不认这个文件');
{
  const png = parseFileRef('D:\\素材\\发型_N.png');
  ok(!!png, 'png 认得');
  eq(png?.name, '发型_N.png', '名字');
  eq(png?.ext, 'png', '扩展名');
  eq(png?.path, 'D:\\素材\\发型_N.png', '真路径原样留着');
  eq(png?.file, null, '真路径那条没有 File 对象');

  ok(!!parseFileRef('D:\\a\\b.TGA'), '大写 TGA 认得');
  ok(!!parseFileRef('D:\\a\\b.dds'), 'dds 认得');

  // 拖目录、拖 exe、拖压缩包 —— 都不该被当成图接进来
  eq(parseFileRef('D:\\素材\\发型'), null, '没有后缀的目录名不接');
  eq(parseFileRef('D:\\素材\\发型\\'), null, '带尾分隔符的目录名不接');
  eq(parseFileRef('D:\\tools\\MsToonConverter.exe'), null, 'exe 不接');
  eq(parseFileRef('D:\\素材\\贴图.zip'), null, 'zip 不接');
  eq(parseFileRef(''), null, '空串不接');
}

section('5. 注册表');
{
  resetDropRegistry();
  ok(!isDroppable(''), '一个都没注册时不可落');

  const a = fakeGroup('t.a', DEFS4);
  registerDropGroup(a);
  ok(isDroppable(slotKey('t.a', 's1')), '注册之后可落');
  ok(isDroppable(''), '只有一个组时，空落点也能兜到它');
  eq(registeredKeys().join(','), 't.a', '表里就一个');

  const b = fakeGroup('t.b', DEFS4);
  registerDropGroup(b);
  eq(registeredKeys().join(','), 't.a,t.b', '两个都在');
  ok(isDroppable(slotKey('t.b', 's3')), '第二组也可落');

  unregisterDropGroup('t.a');
  eq(registeredKeys().join(','), 't.b', '撤掉第一组');
  ok(isDroppable(slotKey('t.b', 's1')), '剩下的还是可落');
  ok(!isDroppable(slotKey('t.a', 's1')), '撤掉的组不可落');
  ok(!isDroppable('t.nope::s1'), '从没注册过的组名不可落');

  resetDropRegistry();
  ok(!isDroppable(''), '清空之后又不可落了');
}

section('6. 先铺空槽 —— 顺序按界面，不按声明');
{
  const g = fakeGroup('t.a', DEFS4, ['s2', 's4']);
  /* DOM 里的顺序是 s3, s1, s4, s2 —— 跟声明顺序不一样。
     不能信声明顺序，那是写代码的顺序，不是用户看到的顺序。 */
  const order = ['t.a::s3', 't.a::s1', 't.a::s4', 't.a::s2'];
  eq(dropOrder(g, order).join(','), 's3,s1,s4,s2', '两个空槽按界面顺序在前，满的按界面顺序在后');

  eq(dropOrder(fakeGroup('t.a', DEFS4), []).join(','), 's1,s2,s3,s4', '一个都没填时就是界面顺序');
  eq(dropOrder(fakeGroup('t.a', DEFS4)).join(','), 's1,s2,s3,s4', '没有 order 时退回声明顺序');

  const full = fakeGroup('t.a', DEFS4, ['s1', 's2', 's3', 's4']);
  eq(dropOrder(full, ['t.a::s2', 't.a::s1']).join(','), 's2,s1', '全满时按界面顺序');
}

section('7. 路线只算一次');
{
  /* 这条是回归钉：原来每落一张就重算一次"先空后满"，
     而填过的那格立刻就不空了、空槽队列跟着往前挪，
     三张图于是全挤进第一格（实测就是 s1,s3,s1）。 */
  const g = fakeGroup('t.a', DEFS4);
  eq(dropPlan(g, 3, null, []).join(','), 's1,s2,s3', '三张进前三格，不是反复算完都落第一格');
  eq(
    dropPlan(g, 6, null, ['t.a::s1', 't.a::s2', 't.a::s3', 't.a::s4']).join(','),
    's1,s2,s3,s4,s1,s2',
    '比槽位多的时候从头绕'
  );

  const half = fakeGroup('t.a', DEFS4, ['s1', 's2']);
  const four = ['t.a::s1', 't.a::s2', 't.a::s3', 't.a::s4'];
  eq(dropPlan(half, 1, null, four).join(','), 's3', '空槽优先');
  eq(dropPlan(half, 1, 's1', four).join(','), 's1', '指着有图的格子就覆盖它');
  eq(dropPlan(half, 2, 's2', four).join(','), 's2,s3', '指的那格是第一个，其余照路线走');
  eq(dropPlan(fakeGroup('t.a', []), 2, null, []).join(','), '', '一个槽都没有时不落');
}

section('8. 落点解析（走 applyDrop，看它真填了哪格）');
{
  resetDropRegistry();
  const g = fakeGroup('ch.b', DEFS4, ['s1']);
  registerDropGroup(g);
  const s = st();
  setSlotOrder(s, ['ch.b::s2', 'ch.b::s1', 'ch.b::s3', 'ch.b::s4']);

  /* 鼠标指着 s2 —— s2 是空的，就落 s2 */
  await applyDrop(s, [parseFileRef('D:\\x\\one.png')], 'ch.b::s2');
  eq(g.log.map((l) => l.id).join(','), 's2', '指着哪格就落哪格');

  /* 指着 s1（已经有图）—— 明确指定优先，覆盖它 */
  await applyDrop(s, [parseFileRef('D:\\x\\two.png')], 'ch.b::s1');
  eq(g.log.map((l) => l.id).join(','), 's2,s1', '指着一个有图的格子也照落（明确指定优先）');

  resetDropRegistry();
}

section('9. 没指哪儿 + 松手落在缝里');
{
  resetDropRegistry();
  const g = fakeGroup('ch.b', DEFS4, ['s1', 's2']);
  registerDropGroup(g);
  const s = st();
  setSlotOrder(s, ['ch.b::s1', 'ch.b::s2', 'ch.b::s3', 'ch.b::s4']);

  /* 空字符串 = 鼠标在槽的缝里。不能什么都不发生，得落到第一个空槽 */
  await applyDrop(s, [parseFileRef('D:\\x\\one.png')], '');
  eq(g.log.map((l) => l.id).join(','), 's3', '没指哪儿就落到第一个空槽');

  /* 认不出的组名同理（多组并存时挑界面最靠前的那个组） */
  await applyDrop(s, [parseFileRef('D:\\x\\two.png')], 'unknown.group::s9');
  eq(g.log.map((l) => l.id).join(','), 's3,s4', '组名不认识时落到界面最靠前的组');

  /* 全满了就从头盖 */
  const full = fakeGroup('ch.full', DEFS4, ['s1', 's2', 's3', 's4']);
  resetDropRegistry();
  registerDropGroup(full);
  const s2 = st();
  await applyDrop(s2, [parseFileRef('D:\\x\\three.png')], '');
  eq(full.log.map((l) => l.id).join(','), 's1', '一个空槽都没有时从头盖');

  resetDropRegistry();
}

section('10. 多文件按顺序铺');
{
  resetDropRegistry();
  const g = fakeGroup('ch.b', DEFS4);
  registerDropGroup(g);
  const s = st();
  const order = ['ch.b::s1', 'ch.b::s2', 'ch.b::s3', 'ch.b::s4'];
  setSlotOrder(s, order);

  await applyDrop(
    s,
    [parseFileRef('D:\\x\\a.png'), parseFileRef('D:\\x\\b.png'), parseFileRef('D:\\x\\c.png')],
    ''
  );
  eq(g.log.map((l) => l.id).join(','), 's1,s2,s3', '三张按顺序铺进前三格');
  eq(g.log.map((l) => l.name).join(','), 'a.png,b.png,c.png', '文件名跟着对得上');

  /* 前三格有图了，只剩 s4 空着 —— 第四张该补空槽，不是回头盖 s1 */
  const s2 = st();
  setSlotOrder(s2, order);
  await applyDrop(s2, [parseFileRef('D:\\x\\d.png')], '');
  eq(g.log.slice(3).map((l) => l.id).join(','), 's4', '还剩一个空槽时先补它，不回头盖');

  /* 整组都满了才从头盖 */
  const g2 = fakeGroup('ch.c', DEFS4, ['s1', 's2', 's3', 's4']);
  resetDropRegistry();
  registerDropGroup(g2);
  const s3 = st();
  setSlotOrder(s3, ['ch.c::s1', 'ch.c::s2', 'ch.c::s3', 'ch.c::s4']);
  await applyDrop(s3, [parseFileRef('D:\\x\\f.png'), parseFileRef('D:\\x\\g.png')], '');
  eq(g2.log.map((l) => l.id).join(','), 's1,s2', '四格都满了以后新一批从头上盖');

  eq(g.log.length, 4, '前面一共落了 4 张');

  resetDropRegistry();
}

section('11. 落完之后状态得清干净');
{
  resetDropRegistry();
  const g = fakeGroup('ch.b', DEFS4);
  registerDropGroup(g);
  const s = st();
  s.active = true;
  s.over = 'ch.b::s2';
  await applyDrop(s, [parseFileRef('D:\\x\\a.png')], 'ch.b::s2');
  eq(s.active, false, '落完 active 关掉');
  eq(s.over, '', '落完 over 清掉（不清的话那个槽会一直亮着）');
  resetDropRegistry();
}

section('12. 接不了的东西要出声');
{
  resetDropRegistry();
  const g = fakeGroup('ch.b', DEFS4);
  registerDropGroup(g);
  const s = st();

  /* 认不出类型的东西在界面层就被 parseFileRef 挡掉了，照理到不了这儿。
     真到了（路径和 File 都没有）也不能空转 —— 得记进 skipped 报出来。 */
  const r = await applyDrop(s, [{ path: '', name: '发型.zip', ext: 'zip', file: null }], '');
  eq(r.filled, 0, '接不了的文件不占槽位');
  eq(r.skipped.join(','), '发型.zip', '认不出的名字要报出来');
  eq(g.log.length, 0, '一个槽都没动');
  eq(s.active, false, '没接成也得把拖放状态关掉');

  resetDropRegistry();
}

section('13. 浏览器那条：File 对象');
{
  const f = new File([new Uint8Array([1, 2, 3])], 'a.PNG', { type: 'image/png' });
  const it = parseFileObj(f);
  ok(!!it, 'File 认得');
  eq(it?.ext, 'png', '扩展名归小写');
  eq(it?.path, '', '浏览器没有真路径');
  eq(it?.file, f, 'File 原样带着');

  const bad = new File([new Uint8Array([1])], '说明.txt', { type: 'text/plain' });
  eq(parseFileObj(bad), null, 'txt 不接');

  resetDropRegistry();
  const g = fakeGroup('ch.b', DEFS4);
  registerDropGroup(g);
  const s = st();
  await applyDrop(s, [parseFileObj(f)], 'ch.b::s1');
  eq(g.log.map((l) => l.id).join(','), 's1', 'File 落到指的那格');
  eq(g.log[0].path, '', '走的 loadFile 那条（path 是空串）');
  resetDropRegistry();
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
