/**
 * 工程文件的自检。
 *
 * 盯的是"打不开的时候说不说得清"，以及"载回来之后 id 会不会撞"。
 * 这两件事坏了界面上都只是"看起来没反应"，很难查。
 *
 * 跑：node --import ./tmp/register-loader.mjs tmp/project.test.mjs
 */
import {
  PROJECT_VERSION,
  buildProject,
  describeFails,
  describeProject,
  parseProject,
  reassignIds,
  restoreSlots,
  serializeProject,
  slotSummary
} from '../src/lib/project.ts';
import { makeLayer, nextLayerId } from '../src/lib/modules/channels/ops.ts';

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

const SAMPLE = {
  panel: 'layers',
  slots: [
    { id: 'diffuse', path: 'D:\\m\\tex\\body_d.png' },
    { id: 'lightmap', path: 'D:\\m\\tex\\body_lm.png' },
    { id: 's3', path: '' },
    { id: 's4', path: '' }
  ],
  layers: [makeLayer('底图', 'diffuse'), makeLayer('金属区', 'lightmap')],
  adjustOps: [{ k: 'invert' }],
  adjustScope: 'rgb',
  blendBase: makeLayer('底层', 'base'),
  blendLayers: [makeLayer('上层', 'top')]
};

/* ============================================================ */

section('存了能读回来');

{
  const doc = buildProject(SAMPLE, 1700000000000);
  const text = serializeProject(doc);
  const back = parseProject(text);
  ok(back.ok, '读得回来');
  if (!back.ok) process.exit(1);

  eq(back.doc.version, PROJECT_VERSION, '版本号对');
  eq(back.doc.panel, 'layers', '分区对');
  eq(back.doc.savedAt, 1700000000000, '时间对');
  eq(back.doc.slots.length, 4, '槽位四个');
  eq(back.doc.slots[0].path, 'D:\\m\\tex\\body_d.png', '路径原样');
  eq(back.doc.slots[2].path, '', '空路径也留着（说明"这格当时就是空的"）');
  eq(back.doc.layers.length, 2, '图层两层');
  eq(back.doc.layers[1].slot, 'lightmap', '图层的源槽位保住');
  eq(back.doc.adjustOps.length, 1, '调整一步');
  eq(back.doc.adjustScope, 'rgb', '作用范围保住');
  eq(back.doc.blendLayers.length, 1, '混合页一层');
  ok(!!back.doc.blendBase, '混合页底层在');
}

{
  // 缩进过的 JSON 也是合法 JSON，读回来要一致
  const doc = buildProject(SAMPLE, 1);
  const text = serializeProject(doc);
  ok(text.includes('\n  '), '写出来是缩进的（给人看得懂）');
  ok(parseProject(text).ok, '缩进版读得回来');
}

section('打不开的时候要说得清');

{
  const r = parseProject('{ 这不是 json');
  eq(r.ok, false, '坏 JSON 打不开');
  if (!r.ok) ok(/JSON/.test(r.error), `说清是 JSON 的问题：${r.error}`);
}

{
  const r = parseProject('[1,2,3]');
  eq(r.ok, false, '数组打不开');
  if (!r.ok) ok(/不是一个对象/.test(r.error), '说清结构不对');
}

{
  const r = parseProject('{"hello":"world"}');
  eq(r.ok, false, '别的 JSON 打不开');
  if (!r.ok) ok(/不是本工具的工程文件/.test(r.error), '说清不是本工具的');
}

{
  // 更新版本存的：不能糊弄着读，要说清是版本问题
  const r = parseProject(JSON.stringify({ magic: 'robineditor-project', version: 99 }));
  eq(r.ok, false, '更高版本打不开');
  if (!r.ok) {
    ok(/v99/.test(r.error), '点出文件是哪个版本');
    ok(/升级/.test(r.error), '给出下一步（升级程序）');
  }
}

{
  const r = parseProject(JSON.stringify({ magic: 'robineditor-project', version: 0 }));
  eq(r.ok, false, '缺版本号打不开');
}

section('坏字段不该把整个工程带崩');

{
  const r = parseProject(
    JSON.stringify({
      magic: 'robineditor-project',
      version: 1,
      slots: [null, 1, {}, { id: '' }, { id: 'diffuse', path: 5 }, { id: 'ok', path: 'a.png' }],
      layers: '不是数组',
      blendLayers: null
    })
  );
  eq(r.ok, true, '还是读得开');
  if (r.ok) {
    eq(r.doc.slots.length, 2, '坏槽位丢掉，留下 id 合法的两个');
    eq(r.doc.slots[1].path, 'a.png', '合法路径保住');
    eq(r.doc.slots[0].path, '', 'path 不是字符串就当空');
    eq(r.doc.layers.length, 0, 'layers 不是数组就当空');
    eq(r.doc.blendLayers.length, 0, 'blendLayers 为 null 就当空');
    eq(r.doc.adjustScope, 'all', 'adjustScope 缺失给默认');
  }
}

section('载回来之后 id 不能撞');

{
  // 同一个会话先后载入两个工程，或者载入后再套预设 ——
  // 沿用文件里的 id 会撞，撞了点一层会同时展开两层
  const a = buildProject(SAMPLE).layers;
  const b = buildProject(SAMPLE).layers;
  const ra = reassignIds(a, nextLayerId);
  const rb = reassignIds(b, nextLayerId);
  const ids = [...ra, ...rb].map((l) => l.id);
  eq(new Set(ids).size, ids.length, '两次载入的图层 id 互不相同');
  ok(!ra.some((l) => a.some((x) => x.id === l.id)), '跟文件里原来的 id 也不撞');

  // 内容要保住
  eq(ra[1].slot, 'lightmap', '重新发 id 不影响内容');
  eq(ra[0].name, a[0].name, '名字保住');
  ok(a[0] !== ra[0], '返回的是新对象，没就地改原数组');
}

section('载入槽位：读不到的必须报出来');

{
  const doc = buildProject(SAMPLE, 1);
  const loaded = [];
  const cleared = [];
  // 假 loader：lightmap 那张故意读不到
  const fails = await restoreSlots(
    doc,
    ['diffuse', 'lightmap', 's3', 's4'],
    async (id, path) => {
      if (id === 'lightmap') return '读不了：系统找不到指定的文件。';
      loaded.push([id, path]);
      return null;
    },
    (id) => cleared.push(id)
  );

  eq(fails.length, 1, '一个槽位读不到');
  eq(fails[0].id, 'lightmap', '报的是 lightmap');
  ok(/读不了/.test(fails[0].error), '带上了底层给的原因');
  eq(loaded.length, 1, '另外那个有图的装进去了');
  eq(loaded[0][0], 'diffuse', '装进去的是 diffuse');
  eq(cleared.length, 2, '两个空路径的槽位被清掉（当时就是空的）');
  ok(cleared.includes('s3') && cleared.includes('s4'), '清的是 s3 / s4');

  const msg = describeFails(fails);
  ok(/lightmap/.test(msg), `提示里点出是哪个槽：${msg}`);
  ok(/body_lm\.png/.test(msg), '顺带把文件名带上，好找');
  ok(/重选/.test(msg), '给出下一步');
}

{
  // 全读得到 → 不该有提示
  const doc = buildProject(SAMPLE, 1);
  const fails = await restoreSlots(doc, ['diffuse', 'lightmap'], async () => null, () => {});
  eq(fails.length, 0, '都读到了');
  eq(describeFails(fails), '', '没有失败就不给提示');
}

{
  // loader 直接抛异常也要兜住，不能把整个工程打开流程带崩
  const doc = buildProject(SAMPLE, 1);
  const fails = await restoreSlots(
    doc,
    ['diffuse', 'lightmap'],
    async (id) => {
      if (id === 'diffuse') throw new Error('炸了');
      return null;
    },
    () => {}
  );
  eq(fails.length, 1, '抛异常的那格被记下来');
  eq(fails[0].error, '炸了', '用的是异常里的消息');
}

{
  // 工程里有、界面不认识的槽位 id：跳过，不算失败
  const doc = buildProject(
    { ...SAMPLE, slots: [{ id: 'diffuse', path: 'a.png' }, { id: '未来的槽位', path: 'b.png' }] },
    1
  );
  let touched = 0;
  const fails = await restoreSlots(doc, ['diffuse'], async () => (touched++, null), () => {});
  eq(fails.length, 0, '不认识的槽位不算失败');
  eq(touched, 1, '只碰了认识的那个');
}

{
  // 多个都读不到 → 全列出来，不能只报第一个
  const doc = buildProject(
    {
      ...SAMPLE,
      slots: [
        { id: 'diffuse', path: 'D:\\m\\a.png' },
        { id: 'lightmap', path: 'D:\\m\\b.png' },
        { id: 's3', path: 'D:\\m\\c.png' }
      ]
    },
    1
  );
  const fails = await restoreSlots(doc, ['diffuse', 'lightmap', 's3'], async () => '没了', () => {});
  eq(fails.length, 3, '三个全记下来');
  const msg = describeFails(fails);
  ok(/diffuse/.test(msg) && /lightmap/.test(msg) && /s3/.test(msg), '提示里三个都在');
}

section('摘要');

{
  const doc = buildProject(SAMPLE, 1700000000000);
  eq(slotSummary(doc).total, 4, '四个槽');
  eq(slotSummary(doc).filled, 2, '两个有图');
  const d = describeProject(doc);
  ok(/2 \/ 4 个槽位有图/.test(d), `摘要里有槽位：${d}`);
  ok(/2 层图层/.test(d), '摘要里有图层数');
  ok(/1 层/.test(d) && /混合/.test(d), '摘要里有混合页');
  ok(/1 步调整/.test(d), '摘要里有调整步数');
}

{
  // 什么都没存的空工程也不该出乱子
  const empty = buildProject({
    panel: '',
    slots: [],
    layers: [],
    adjustOps: [],
    adjustScope: 'all',
    blendBase: null,
    blendLayers: []
  });
  const d = describeProject(empty);
  ok(/0 \/ 0/.test(d), `空工程也有话说：${d}`);
  ok(!/undefined|NaN/.test(d), '没有 undefined/NaN 漏出来');
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
