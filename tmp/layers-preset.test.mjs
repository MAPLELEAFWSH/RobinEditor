/**
 * 图层预设的自检。
 *
 * 重点盯"槽位对不上"这一路，但要分清是哪一种对不上：
 *
 * - **槽位不存在**（从别的页存下来的预设，拿到这页套）→ 必须降级成常量，
 *   蒙版也要跟着关掉。这是这套机制存在的理由。
 * - **槽位在、只是还没放图** → 必须留着。常见顺序就是"先套预设搭架子、再往槽里放图"，
 *   按"有没有图"判的话套完就降级，放图进去也不会变回来。这条以前写错过一次。
 *
 * 跑：node --import ./tmp/register-loader.mjs tmp/layers-preset.test.mjs
 */
import {
  BUILTIN_PRESETS,
  materializeSeeds,
  nextFreeSlot,
  sanitizePresets,
  toSeeds
} from '../src/lib/layers-preset.ts';
import { makeLayer, makeMask, nextLayerId } from '../src/lib/modules/channels/ops.ts';

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

// 发 id 用跟 makeLayer 同一个计数器 —— 自己起一个会从 1 开始数，
// 跟已有的图层撞 id，撞了之后点一层会同时展开两层
const idOf = nextLayerId;

/** ⑦ 图层页的四个槽位名 */
const LAYER_SLOTS = ['diffuse', 'lightmap', 's3', 's4'];
const onLayerPage = (id) => LAYER_SLOTS.includes(id);
/** 换到「分离」那页，只有一个叫 src 的槽 —— 图层页存下来的预设到这儿就该降级 */
const onSplitPage = (id) => id === 'src';
const allSlots = () => true;
const noSlots = () => false;

/* ============================================================ */

section('内置预设本身得是合法的');

{
  ok(BUILTIN_PRESETS.length >= 3, `内置至少三套（实得 ${BUILTIN_PRESETS.length}）`);
  eq(new Set(BUILTIN_PRESETS.map((p) => p.id)).size, BUILTIN_PRESETS.length, 'id 不重复');
  for (const p of BUILTIN_PRESETS) {
    ok(!!p.name && !!p.hint, `${p.id} 有名字和说明`);
    ok(p.layers.length > 0, `${p.id} 至少一层`);
    ok(
      p.layers.every((l) => typeof l.name === 'string' && l.name),
      `${p.id} 每层都有名字`
    );
    ok(
      p.layers.every((l) => l.opacity >= 0 && l.opacity <= 1),
      `${p.id} 不透明度都在 0-1`
    );
    ok(
      p.layers.every((l) => l.constant >= 0 && l.constant <= 255),
      `${p.id} 常量都在 0-255`
    );
  }
}

section('套到有这些槽位的页面上');

{
  const preset = BUILTIN_PRESETS[0]; // diffuse + LM.B 蒙版
  const got = materializeSeeds(preset.layers, onLayerPage, idOf);
  eq(got.length, 1, '一层');
  eq(got[0].slot, 'diffuse', '源指向 diffuse');
  eq(got[0].name, 'diffuse', '名字保留');
  ok(got[0].mask.on, '蒙版开着');
  eq(got[0].mask.slot, 'lightmap', '蒙版指向 lightmap');
  eq(got[0].mask.ch, 'b', '蒙版取 B 路 —— B 才是这套打包里的金属度');
  eq(got[0].mask.black, 8, '蒙版黑点保住');
  eq(got[0].mask.white, 210, '蒙版白点保住');
  eq(got[0].mask.blur, 1, '蒙版羽化保住');
  ok(!!got[0].id, '发了 id');
}

{
  // 槽位在、只是还没放图 —— 必须留着，这条是"先套预设再放图"那个顺序的关键
  const preset = BUILTIN_PRESETS[1]; // 金属区提亮，两层
  const got = materializeSeeds(preset.layers, onLayerPage, idOf);
  eq(got.length, 2, '两层');
  eq(got[0].slot, 'diffuse', '底层源留着 diffuse（槽位在，只是空）');
  eq(got[1].slot, 'lightmap', '上层源留着 lightmap');
  eq(got[1].ch, 'b', '取 B 路');
  eq(got[1].blend, 'screen', '混合是 screen');
  eq(got[1].opacity, 0.6, '不透明度 0.6');
  ok(got[0].mask.on && got[1].mask.on, '两层的蒙版都留着');
}

section('槽位不存在才降级成常量');

{
  // 从图层页存下来、换到「分离」页（那页槽位只有 src）去套
  const preset = BUILTIN_PRESETS[0];
  const got = materializeSeeds(preset.layers, onSplitPage, idOf);
  eq(got[0].slot, '', 'diffuse 这页没有 → 源降级成常量');
  eq(got[0].constant, preset.layers[0].constant, '常量值沿用种子里给的');
  ok(!got[0].mask.on, '蒙版指的 lightmap 这页也没有 → 蒙版必须关掉');
}

{
  // 源和蒙版用同一个槽：槽不存在，两个一起降级
  const seeds = [
    {
      name: 'x',
      on: true,
      slot: 's3',
      ch: 'rgb',
      invert: false,
      constant: 40,
      adjust: [],
      adjustScope: 'all',
      blend: 'normal',
      opacity: 1,
      mask: { on: true, slot: 's3', ch: 'a', invert: false, black: 0, white: 255, gamma: 1, blur: 0 }
    }
  ];
  const got = materializeSeeds(seeds, noSlots, idOf);
  eq(got[0].slot, '', '源降级');
  ok(!got[0].mask.on, '同一个槽的蒙版也降级');
}

{
  // 源没了但蒙版用的另一个槽还在 —— 蒙版该留着

  const seeds = [
    {
      name: 'x',
      on: true,
      slot: 's3',
      ch: 'rgb',
      invert: false,
      constant: 40,
      adjust: [],
      adjustScope: 'all',
      blend: 'normal',
      opacity: 1,
      mask: { on: true, slot: 'diffuse', ch: 'a', invert: false, black: 0, white: 255, gamma: 1, blur: 0 }
    }
  ];
  const has = (s) => s === 'diffuse';
  const got = materializeSeeds(seeds, has, idOf);
  eq(got[0].slot, '', 's3 这页没有 → 源降级成常量');
  ok(got[0].mask.on, '蒙版指的 diffuse 这页有 → 蒙版留着');
  eq(got[0].mask.slot, 'diffuse', '蒙版还指着原槽');
}

section('常量层不受影响');

{

  const seeds = [
    {
      name: '纯色',
      on: true,
      slot: '',
      ch: 'rgb',
      invert: false,
      constant: 70,
      adjust: [],
      adjustScope: 'all',
      blend: 'multiply',
      opacity: 0.8,
      mask: { on: true, slot: 'diffuse', ch: 'a', invert: false, black: 0, white: 255, gamma: 1, blur: 0 }
    }
  ];
  const got = materializeSeeds(seeds, noSlots, idOf);
  eq(got[0].slot, '', '本来就是常量');
  eq(got[0].constant, 70, '常量没被改');
  ok(!got[0].mask.on, '蒙版槽这页没有 → 关掉');
}

section('不该动到原预设');

{

  const preset = BUILTIN_PRESETS[0];
  const before = JSON.stringify(preset);
  const got = materializeSeeds(preset.layers, allSlots, idOf);
  // 改穿出来的那层，不能污染预设本体
  got[0].mask.blur = 99;
  got[0].adjust.push({ k: 'invert' });
  eq(JSON.stringify(preset), before, '套出来的层改了，预设本体没变');
}

section('倒成种子再套回来要一致');

{

  const l1 = makeLayer('底图', 'diffuse');
  const l2 = makeLayer('压暗', '');
  l2.constant = 70;
  l2.blend = 'multiply';
  l2.opacity = 0.8;
  l2.mask = { ...makeMask(), on: true, slot: 'diffuse', ch: 'a', black: 10, white: 240, blur: 3 };
  const seeds = toSeeds([l1, l2]);
  eq(seeds.length, 2, '两层都倒出来了');

  const back = materializeSeeds(seeds, allSlots, idOf);
  eq(back[0].name, '底图', '名字保留');
  eq(back[1].constant, 70, '常量保留');
  eq(back[1].blend, 'multiply', '混合保留');
  eq(back[1].opacity, 0.8, '不透明度保留');
  eq(back[1].mask.blur, 3, '蒙版参数保留');
  eq(back[1].mask.black, 10, '蒙版黑点保留');
  ok(back[0].id !== l1.id, '套回来的是新 id，不跟原来撞');
}

section('新层默认用哪个槽');

{
  const S = ['diffuse', 'lightmap', 's3', 's4'];

  eq(nextFreeSlot([], S), 'diffuse', '第一层用第一个槽');
  eq(nextFreeSlot(['diffuse'], S), 'lightmap', '第二层用第二个 —— 不能再来一次 diffuse');
  eq(nextFreeSlot(['diffuse', 'lightmap'], S), 's3', '第三层用第三个');
  eq(nextFreeSlot(['diffuse', 'lightmap', 's3', 's4'], S), 'diffuse', '槽用完了退回第一个');

  // 层里可能有源是空的（常量层），不能把它算成"占了一个槽"
  eq(nextFreeSlot(['', 'diffuse'], S), 'lightmap', '空源不算占用');
}

{
  // 混合页：底层那格归底图用，它不在 layers 里，得靠 reserved 排掉
  const S = ['base', 'top', 'top2', 'top3'];
  eq(nextFreeSlot([], S, ['base']), 'top', 'reserved 排掉之后从上层开始');
  eq(nextFreeSlot(['top'], S, ['base']), 'top2', '再点一次是上层 2');
  eq(nextFreeSlot(['top', 'top2'], S, ['base']), 'top3', '再来是上层 3');
  // 全占完也不能给出 reserved 那个
  eq(nextFreeSlot(['top', 'top2', 'top3'], S, ['base']), 'top', '兜底也不拿 reserved 的槽');
}

{
  // 边界：一个槽都没有
  eq(nextFreeSlot([], []), '', '没有槽就返回空串（那就是常量层）');
  eq(nextFreeSlot(['x'], [], ['y']), '', '同样不崩');
}

section('localStorage 里读出来的烂数据');

{
  eq(sanitizePresets(null).length, 0, 'null → 空');
  eq(sanitizePresets('不是数组').length, 0, '不是数组 → 空');
  eq(sanitizePresets([null, 1, {}]).length, 0, '没有名字的丢掉');
  eq(sanitizePresets([{ name: '空的' }]).length, 0, '一层都没有的丢掉（套上去等于什么都没发生）');
  eq(sanitizePresets([{ name: '', layers: [{ name: 'x' }] }]).length, 0, '名字是空的丢掉');
}

{
  const s = sanitizePresets([
    {
      name: '  带空格的  ',
      layers: [
        { name: 'A' },
        {
          name: 'B',
          slot: 'diffuse',
          ch: 'a',
          blend: 'multiply',
          opacity: 5,
          constant: 999,
          on: false,
          mask: { on: true, slot: 'diffuse', ch: 'a', blur: 2 }
        }
      ]
    }
  ]);
  eq(s.length, 1, '留下一条');
  eq(s[0].name, '带空格的', '名字 trim 过');
  eq(s[0].layers.length, 2, '两层都在');
  eq(s[0].layers[0].constant, 128, '缺 constant 补 128');
  eq(s[0].layers[0].blend, 'normal', '缺 blend 补 normal');
  eq(s[0].layers[0].opacity, 1, '缺 opacity 补 1');
  eq(s[0].layers[0].on, true, '缺 on 默认开');
  eq(s[0].layers[1].opacity, 1, 'opacity 超范围夹回 1');
  eq(s[0].layers[1].constant, 255, 'constant 超范围夹到 255');
  eq(s[0].layers[1].on, false, 'on:false 要保住');
  ok(s[0].layers[1].mask.on, '蒙版 on 保住');
  eq(s[0].layers[1].mask.blur, 2, '蒙版 blur 保住');
  eq(s[0].layers[1].mask.white, 255, '蒙版缺的字段补默认');
}

{
  // 夹到 40 条，免得列表被撑爆
  const many = Array.from({ length: 60 }, (_, i) => ({ name: `p${i}`, layers: [{ name: 'x' }] }));
  eq(sanitizePresets(many).length, 40, '最多留 40 条');
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
