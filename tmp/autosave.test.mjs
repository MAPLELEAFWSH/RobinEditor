/**
 * 自动保存的自检。
 *
 * 盯的是"什么时候该写、什么时候不该写"—— 写多了会把上一份能救的东西冲掉，
 * 写少了等于没做。这几条界面上都只是"某次打开发现东西没了"，很难查。
 *
 * 跑：node --import ./tmp/register-loader.mjs tmp/autosave.test.mjs
 */
import {
  describeSnapshot,
  shouldWrite,
  signature,
  worthKeeping
} from '../src/lib/autosave.ts';
import { buildProject } from '../src/lib/project.ts';
import { makeLayer, makeMask } from '../src/lib/modules/channels/ops.ts';

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
function eq(a, b, label) {
  ok(a === b, label, `实得 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}`);
}
function section(t) {
  console.log(`\n== ${t} ==`);
}

/**
 * 参数顺序是 (条件, 标签)，跟 ilmcheck 那批 (标签, 条件) 反着。
 * 写反了的话「条件」位置收到的是个非空字符串，恒为真，整套会假装全过。
 */
{
  const before = fail;
  const realLog = console.log;
  console.log = () => {};
  ok(false, '__selfcheck__');
  console.log = realLog;
  if (fail !== before + 1) {
    console.error('ok() 本身是坏的：条件为假没被记成失败');
    process.exit(1);
  }
  fail = before;
}

const mk = (over = {}) =>
  buildProject(
    {
      panel: 'layers',
      slots: [
        { id: 'diffuse', path: 'D:\\m\\d.png' },
        { id: 'lightmap', path: '' }
      ],
      layers: [makeLayer('底图', 'diffuse')],
      adjustOps: [],
      adjustScope: 'all',
      blendBase: null,
      blendLayers: [],
      ...over
    },
    1700000000000
  );

const EMPTY = mk({ layers: [], blendLayers: [], adjustOps: [] });

/* ============================================================ */

section('什么算"值得留"');

{
  eq(worthKeeping(EMPTY), false, '空的（没图层没调整没混合层）不值得留');
  eq(worthKeeping(mk()), true, '有一层图层就值得');
  eq(worthKeeping(mk({ layers: [], adjustOps: [{ k: 'invert' }] })), true, '有调整也值得');
  eq(
    worthKeeping(mk({ layers: [], blendLayers: [makeLayer('x', 'top')] })),
    true,
    '有混合层也值得'
  );
  // 只放了图、什么都没改：不值得（那是"放了素材"，不是"改了参数"）
  eq(worthKeeping(mk({ layers: [], blendLayers: [] })), false, '只放图没改参数不值得');
}

section('什么时候该写');

{
  const doc = mk();
  const sig = '';

  // 1. 太近不写
  eq(shouldWrite(doc, 1000, sig, 2000, 4000), false, '隔 1 秒不写');
  eq(shouldWrite(doc, 1000, sig, 5000, 4000), true, '隔 4 秒写');
  eq(shouldWrite(doc, 1000, sig, 4999, 4000), false, '差 1 毫秒也不写');
}

{
  // 2. 内容没变不写 —— 不然每次 commit 都写一遍，配额很快就满
  const doc = mk();
  const s = signature(doc);
  eq(shouldWrite(doc, 0, s, 999999), false, '签名一样就不写');
}

{
  // 3. 空的不写 —— 这条最关键：打开程序什么没干就关掉，不能把上一份能救的冲掉
  eq(shouldWrite(EMPTY, 0, '', 999999), false, '空状态不写');
}

{
  // 4. 有内容 + 够久 + 变了 → 写
  const doc = mk();
  eq(shouldWrite(doc, 0, '旧的签名', 999999), true, '三条都过就写');
}

section('签名要能分辨出改动');

{
  const a = mk();
  const b = mk({ layers: [makeLayer('a', 'diffuse'), makeLayer('b', 'lightmap')] });
  ok(signature(a) !== signature(b), '层数变了签名变');

  const c = mk({ adjustOps: [{ k: 'invert' }] });
  ok(signature(a) !== signature(c), '调整数变了签名变');

  const d = mk({
    slots: [
      { id: 'diffuse', path: 'D:\\m\\别的图.png' },
      { id: 'lightmap', path: '' }
    ]
  });
  ok(signature(a) !== signature(d), '槽位路径变了签名变');

  // 同样的内容签名要一样
  eq(signature(mk()), signature(mk()), '内容一样签名一样');
}

/**
 * A1 那条真 bug 的判据。
 *
 * 签名原来只数个数（图层 / 调整 / 混合层）加槽位路径，于是下面这些
 * "计数一样、参数不一样"的编辑全被读成"没变" → 自动保存一次都不写。
 * 自动保存存在的意义恰好就是这些编辑。
 *
 * 每条都用旧签名做一次对照断言 —— 证明这是真漏，不是等价改写。
 */
section('计数相同、参数不同，也必须算变了');

{
  const lay = (over = {}) => ({ ...makeLayer('底图', 'diffuse'), ...over });
  const one = (layer) => mk({ layers: [layer] });
  /** 旧签名，只留在这里当对照 */
  const oldSig = (doc) =>
    `${doc.layers.length}/${doc.adjustOps.length}/${doc.blendLayers.length}/` +
    doc.slots.map((s) => `${s.id}:${s.path}`).join('|');

  const base = one(lay());

  const cases = [
    ['拖不透明度', lay({ opacity: 0.42 })],
    ['换混合模式', lay({ blend: 'multiply' })],
    ['关掉这一层', lay({ on: false })],
    ['换源通道', lay({ ch: 'r' })],
    ['反相来源', lay({ invert: true })],
    ['改常量', lay({ constant: 77 })],
    ['改调整作用范围', lay({ adjustScope: 'r' })],
    ['开蒙版并换蒙版源', lay({ mask: { ...makeMask(), on: true, slot: 'lightmap' } })],
    ['改蒙版黑白色阶', lay({ mask: { ...makeMask(), on: true, black: 12, white: 233 } })],
    ['改蒙版伽马', lay({ mask: { ...makeMask(), on: true, gamma: 1.4 } })],
    ['改蒙版模糊', lay({ mask: { ...makeMask(), on: true, blur: 6 } })],
    ['蒙版反相', lay({ mask: { ...makeMask(), on: true, invert: true } })]
  ];
  for (const [what, layer] of cases) {
    const doc = one(layer);
    eq(oldSig(base), oldSig(doc), `${what}：旧签名读成"没变"（真漏）`);
    ok(signature(base) !== signature(doc), `${what}：新签名要变`);
    ok(shouldWrite(doc, 0, signature(base), 999999), `${what}：必须写`);
  }

  // 步数一样、参数不一样 —— 图层上挂的调整链
  const P4 = { k: 'posterize', levels: 4 };
  const P8 = { k: 'posterize', levels: 8 };
  const [pa, pb] = [one(lay({ adjust: [P4] })), one(lay({ adjust: [P8] }))];
  eq(oldSig(pa), oldSig(pb), '图层调整链：旧签名读成"没变"（真漏）');
  ok(signature(pa) !== signature(pb), '图层调整链参数变了：新签名要变');
  ok(shouldWrite(pb, 0, signature(pa), 999999), '图层调整链参数变了：必须写');

  // 调整页那条链
  const twoOps = (second) => mk({ adjustOps: [{ k: 'invert' }, second] });
  const [ta, tb] = [twoOps(P4), twoOps(P8)];
  eq(oldSig(ta), oldSig(tb), '调整页的链：旧签名读成"没变"（真漏）');
  ok(signature(ta) !== signature(tb), '调整页的链参数变了：新签名要变');
  ok(shouldWrite(tb, 0, signature(ta), 999999), '调整页的链参数变了：必须写');

  // 混合页：底层和上层栈
  const bl = (over = {}) => ({ ...makeLayer('底层', 'diffuse'), ...over });
  const [mb1, mb2] = [mk({ blendLayers: [bl({ opacity: 1 })] }), mk({ blendLayers: [bl({ opacity: 0.3 })] })];
  eq(oldSig(mb1), oldSig(mb2), '混合页上层：旧签名读成"没变"（真漏）');
  ok(signature(mb1) !== signature(mb2), '混合页上层不透明度变了：新签名要变');

  const [bb1, bb2] = [mk({ blendBase: bl({ opacity: 0.9 }) }), mk({ blendBase: bl({ opacity: 0.4 }) })];
  eq(oldSig(bb1), oldSig(bb2), '混合页底层：旧签名读成"没变"（真漏）');
  ok(signature(bb1) !== signature(bb2), '混合页底层不透明度变了：新签名要变');

  // 图层 id 是每个会话重发的把手（恢复工程会 reassignIds），不算内容
  const withId = (id) => one({ ...makeLayer('底图', 'diffuse'), id });
  eq(signature(withId('L1')), signature(withId('L900')), '只是图层 id 不同不算变');

  // 反过来：真没动的时候不能乱报"变了"，不然每 4 秒写一份
  eq(signature(base), signature(one(lay())), '同一个内容的两次构造签名一样');
}

section('签名刻意不算进去的东西');

{
  // 切标签页不该被当成改动，否则换个分区就写一份快照
  eq(signature(mk({ panel: 'layers' })), signature(mk({ panel: 'export' })), '换个 panel 不算变');
  // 存的时间每次写都不同，不排掉这道闸就等于没有
  eq(
    signature({ ...mk(), savedAt: 1 }),
    signature({ ...mk(), savedAt: 1799999999999 }),
    'savedAt 不同不算变'
  );
}

section('提示条那句话');

{
  const doc = mk();
  const msg = describeSnapshot(doc, 1700000000000, 1700000000000);
  ok(/刚刚/.test(msg), `说得出时间：${msg}`);
  ok(/1 层图层/.test(msg), '说得出几层');
  ok(/1 个槽位有图/.test(msg), '说得出几个槽位有图');

  // 时间戳用正数：0 在实现里表示"不知道什么时候存的"，那是另一条分支
  const T = 1700000000000;
  ok(/3 分钟前/.test(describeSnapshot(doc, T, T + 180000)), '分钟级');
  ok(/2 小时前/.test(describeSnapshot(doc, T, T + 7200000)), '小时级');
  ok(/3 天前/.test(describeSnapshot(doc, T, T + 3 * 86400000)), '天级');
  ok(/刚刚/.test(describeSnapshot(doc, T, T + 3000)), '几秒前算刚刚');

  // 时间未知也不能漏出 undefined
  const noTime = describeSnapshot(doc, 0, 1000);
  ok(!/undefined|NaN/.test(noTime), `时间未知时不漏字：${noTime}`);
}

{
  // 只有调整、没有图层时，那句话也要通顺
  const doc = mk({ layers: [], adjustOps: [{ k: 'invert' }, { k: 'levels' }] });
  const msg = describeSnapshot(doc, 0, 1000);
  ok(/2 步调整/.test(msg), `只有调整时也说得出：${msg}`);
  ok(!/undefined/.test(msg), '没有 undefined');
}

{
  // 真·空文档（理论上不会走到，因为 worthKeeping 挡着）也不该崩
  const msg = describeSnapshot(EMPTY, 0, 1000);
  ok(/没改什么/.test(msg), `空的时候有话说：${msg}`);
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
