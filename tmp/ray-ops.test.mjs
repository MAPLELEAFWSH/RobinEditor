/**
 * Ray 解析器的自测。跑法：node tmp/ray-ops.test.mjs
 *
 * 三件事：
 *   1. 拿真的 ray.conf 解一遍，看项数和说明有没有抠对
 *   2. 改值、重新解析，确认只动了该动的那一行
 *   3. 造一份「Shift-JIS」字节流（双字节字符用两个 >=0x80 的字节冒充，
 *      对字节拼接来说和真 Shift-JIS 等价），确认改完只有值那几个字节变了
 */
import fs from 'node:fs';
import {
  parseRayText,
  setDefineValue,
  setConstValue,
  spliceAsciiLineEdits,
  collectChanges,
  docOptions,
  toggleCommented
} from '../src/lib/modules/ray/ops.ts';

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${extra}`);
  }
}

const RAY = 'D:\\ray-mmd-master\\ray.conf';

console.log('\n== 1. 真 ray.conf ==');
const raw = fs.readFileSync(RAY, 'utf8');
const parsed = parseRayText(raw, RAY);
console.log(`  行数 ${raw.split(/\r?\n/).length}，项数 ${parsed.entries.length}，flavor ${parsed.flavor}`);
ok('flavor 认成 ray-conf', parsed.flavor === 'ray-conf');
ok('没有解析错误', parsed.errors.length === 0, JSON.stringify(parsed.errors));

const sun = parsed.entries.find((e) => e.name === 'SUN_LIGHT_ENABLE');
ok('找得到 SUN_LIGHT_ENABLE', !!sun);
ok('它的值是 1', sun?.value === '1', sun?.value);
ok(
  '抠出了 0/1/2 三个选项',
  (docOptions(sun?.doc ?? '').length) === 3,
  JSON.stringify(docOptions(sun?.doc ?? ''))
);

const q = parsed.entries.find((e) => e.name === 'SUN_SHADOW_QUALITY');
ok('阴影质量抠出 6 档', docOptions(q?.doc ?? '').length === 6, JSON.stringify(docOptions(q?.doc ?? '')));
const qo = docOptions(q?.doc ?? '');
ok('档位说明里的缩进和对齐都留着', qo[3]?.label === 'High   (2048 * 4)', JSON.stringify(qo[3]?.label));
ok('第 4 档是 boom!', qo[4]?.label.startsWith('boom'), JSON.stringify(qo[4]?.label));

const allDefines = raw.match(/^\s*#define\s+/gm)?.length ?? 0;
ok(`#define 条数和正则数出来的对上（${allDefines}）`, parsed.entries.filter((e) => e.kind === 'define').length === allDefines);

console.log('\n== 2. 改值后重新解析 ==');
const target = parsed.entries.find((e) => e.name === 'SSDO_QUALITY');
const newRaw = setDefineValue(target.raw, '5');
ok('只换了值，行尾没动', newRaw === '#define SSDO_QUALITY 5', JSON.stringify(newRaw));

const withComment = '#define IBL_QUALITY 1  // 1 : Enable';
ok(
  '带注释的行，注释保留',
  setDefineValue(withComment, '2') === '#define IBL_QUALITY 2  // 1 : Enable',
  setDefineValue(withComment, '2')
);

const aligned = '#define   FOG_ENABLE\t 1';
ok(
  '对齐和制表符保留',
  setDefineValue(aligned, '0') === '#define   FOG_ENABLE\t 0',
  JSON.stringify(setDefineValue(aligned, '0'))
);

const edited = raw.split(/\r?\n/);
edited[target.line] = newRaw;
const reparsed = parseRayText(edited.join('\n'), RAY);
ok('项数不变', reparsed.entries.length === parsed.entries.length);
const changedNames = [];
for (let i = 0; i < parsed.entries.length; i++) {
  if (parsed.entries[i].value !== reparsed.entries[i].value) changedNames.push(parsed.entries[i].name);
}
ok('只有 SSDO_QUALITY 变了', changedNames.length === 1 && changedNames[0] === 'SSDO_QUALITY', changedNames.join(','));

console.log('\n== 2b. ray_advanced.conf 的 const ==');
const adv = fs.readFileSync('D:\\ray-mmd-master\\ray_advanced.conf', 'utf8');
const ap = parseRayText(adv, 'D:\\ray-mmd-master\\ray_advanced.conf');
ok('flavor 认成 ray-advanced', ap.flavor === 'ray-advanced');
const temp = ap.entries.find((e) => e.name === 'mTemperature');
ok('找到 mTemperature', !!temp, JSON.stringify(ap.entries.slice(0, 3).map((e) => e.name)));
ok('值是 6600.0', temp?.value === '6600.0', temp?.value);
ok('类型是 float', temp?.type === 'float', temp?.type);
const t2 = setConstValue(temp.raw, '7000.0');
ok('换 const 值时注释保留', t2.endsWith('// range 1000 ~ 40000 // Default value D66 used for pure white'), t2);
ok('换 const 值时 = 前没动', t2.startsWith('static const float mTemperature = '), t2);

const arr = ap.entries.find((e) => e.name === 'mSSDOParams');
ok('数组常量能解析', !!arr && arr.value === '{2.0, 2.0, 0.03, 0.15}', arr?.value);
if (arr) {
  const a2 = setConstValue(arr.raw, '{2.5, 2.5, 0.05, 0.2}');
  ok('数组常量能替换', a2.includes('{2.5, 2.5, 0.05, 0.2}') && a2.trim().endsWith(';'), a2);
}

console.log('\n== 3. 非 UTF-8 的字节拼接 ==');
// 「設定」用两个双字节字符冒充：每个字符两个字节都 >= 0x80
const jp = [0x93, 0xfa, 0x92, 0x7a];
const line0 = Buffer.concat([
  Buffer.from('// ', 'latin1'),
  Buffer.from(jp),
  Buffer.from(' // 0 : 無 // 1 : 有', 'latin1')
]);
const line1 = Buffer.from('#define SUN_LIGHT_ENABLE 1', 'latin1');
const line2 = Buffer.from('// 尾巴也是日文 ', 'latin1');
const fake = Buffer.concat([line0, Buffer.from('\n'), line1, Buffer.from('\n'), line2]);

// 用 latin1 解码，模拟「解码后看到的样子」。双字节字符会变成两个 latin1 字符
const fakeText = fake.toString('latin1');
const fp = parseRayText(fakeText, 'ray.conf');
ok('双字节文件也解出来了', fp.entries.length === 1, String(fp.entries.length));
const fe = fp.entries[0];
ok('值是 1', fe.value === '1', fe.value);

const newLine = setDefineValue(fe.raw, '0');
const spliced = spliceAsciiLineEdits(new Uint8Array(fake), [{ line: fe.line, oldRaw: fe.raw, newRaw: newLine }]);
ok('拼接成功', spliced.ok, spliced.why);

if (spliced.ok) {
  const out = Buffer.from(spliced.bytes);
  const before = fake.toString('latin1').split('\n');
  const after = out.toString('latin1').split('\n');
  ok('行数不变', before.length === after.length, `${before.length} vs ${after.length}`);
  ok('第一行（日文注释）逐字节相同', Buffer.from(before[0], 'latin1').equals(Buffer.from(after[0], 'latin1')));
  ok('第三行逐字节相同', Buffer.from(before[2], 'latin1').equals(Buffer.from(after[2], 'latin1')));
  ok('第二行的值改成了 0', after[1] === '#define SUN_LIGHT_ENABLE 0', JSON.stringify(after[1]));
  // 双字节序列还在，没有被打散
  const jpBytes = out.subarray(3, 7);
  ok('日文那几个字节原样在', jpBytes.equals(Buffer.from(jp)), jpBytes.toString('hex'));
}

console.log('\n== 3b. 拒绝该拒绝的 ==');
const bad = spliceAsciiLineEdits(new Uint8Array(fake), [
  { line: 1, oldRaw: fe.raw, newRaw: '#define SUN_LIGHT_ENABLE 設定' }
]);
ok('改动里带非 ASCII 就拒写', bad.ok === false && /非 ASCII/.test(bad.why ?? ''), bad.why);

const oob = spliceAsciiLineEdits(new Uint8Array(fake), [
  { line: 99, oldRaw: 'x', newRaw: 'y' }
]);
ok('行号越界就拒写', oob.ok === false);

console.log('\n== 3c. 日文注释在值后面的行也要能改 ==');
// `#define X 1 // <日文>`：后缀是双字节，靠 ASCII 前缀定位
const jpComment = '// 設定 // 0 : 無 // 1 : 有';
const l3 = Buffer.from('#define SUN_LIGHT_ENABLE 1 ', 'latin1');
const jpTail = Buffer.from('// ' + String.fromCharCode(0x93, 0xfa, 0x92, 0x7a), 'latin1');
const file3 = Buffer.concat([
  Buffer.from(jpComment, 'latin1'),
  Buffer.from('\n'),
  l3,
  jpTail
]);
const t3 = file3.toString('latin1');
const p3 = parseRayText(t3, 'ray.conf');
const e3 = p3.entries[0];
ok('值后面的日文没被当成值的一部分', e3?.value === '1', e3?.value);
const n3 = setDefineValue(e3.raw, '0');
const s3 = spliceAsciiLineEdits(new Uint8Array(file3), [{ line: e3.line, oldRaw: e3.raw, newRaw: n3 }]);
ok('后缀带日文也改得动', s3.ok, s3.why);
if (s3.ok) {
  const out3 = Buffer.from(s3.bytes);
  ok('整行字节数只差在值那一位', out3.length === file3.length, `${out3.length} vs ${file3.length}`);
  const after3 = out3.toString('latin1').split('\n');
  ok('值变成了 0', after3[1].startsWith('#define SUN_LIGHT_ENABLE 0'), JSON.stringify(after3[1]));
  const tail = out3.subarray(out3.length - 4);
  ok('结尾那 4 个日文字节原样', tail.equals(Buffer.from([0x93, 0xfa, 0x92, 0x7a])), tail.toString('hex'));
  ok('第一行的日文也原样', out3.subarray(0, file3.indexOf(0x0a)).equals(file3.subarray(0, file3.indexOf(0x0a))));
}

console.log('\n== 3d. 前后缀都有日文时拒写 ==');
const both = Buffer.from('#define ' + String.fromCharCode(0x93, 0xfa) + ' 1 ' + String.fromCharCode(0x92, 0x7a), 'latin1');
const bt = both.toString('latin1');
// 手工构造：名字里含双字节是假想的，只为触发"两边都非 ASCII"
const btOld = bt;
const btNew = bt.replace(' 1 ', ' 0 ');
const sb = spliceAsciiLineEdits(new Uint8Array(both), [{ line: 0, oldRaw: btOld, newRaw: btNew }]);
ok('两边都非 ASCII 就拒写', sb.ok === false, sb.why);

console.log('\n== 4. collectChanges ==');
const ch = collectChanges(parsed.entries, { [target.id]: '5' }, {});
ok('挑出 1 处改动', ch.length === 1 && ch[0].name === 'SSDO_QUALITY', JSON.stringify(ch.map((c) => c.name)));
const chNone = collectChanges(parsed.entries, { [target.id]: target.value }, {});
ok('值没变就不算改动', chNone.length === 0);

console.log('\n== 4b. material_2.0.fx 与 fxsub ==');
const mat = fs.readFileSync('D:\\ray-mmd-master\\Materials\\material_2.0.fx', 'utf8');
const mp = parseRayText(mat, 'D:\\ray-mmd-master\\Materials\\material_2.0.fx');
ok('flavor 认成 material', mp.flavor === 'material');
ok('解析出 60 项左右', mp.entries.length >= 55, String(mp.entries.length));
ok('include 也记下来了', mp.includes.length === 1 && mp.includes[0].target === 'material_common_2.0.fxsub', JSON.stringify(mp.includes));
const metal = mp.entries.find((e) => e.name === 'metalness');
ok('const metalness = 0.0 解出来了', metal?.value === '0.0' && metal?.type === 'float', JSON.stringify(metal && [metal.type, metal.value]));
const alb = mp.entries.find((e) => e.name === 'ALBEDO_MAP_FILE');
ok('字符串值带引号保留', alb?.value === '"albedo.png"', alb?.value);
ok('字符串值能安全替换', alb && setDefineValue(alb.raw, '"skin.png"') === '#define ALBEDO_MAP_FILE "skin.png"', alb && setDefineValue(alb.raw, '"skin.png"'));

const fx = fs.readFileSync('D:\\ray-mmd-master\\Materials\\Editor\\Standard\\material_editor.fxsub', 'utf8');
const fxp = parseRayText(fx, 'D:\\ray-mmd-master\\Materials\\Editor\\Standard\\material_editor.fxsub');
ok('flavor 认成 fxsub', fxp.flavor === 'fxsub');
const ctls = fxp.entries.filter((e) => e.kind === 'controller');
ok('控制器项数 33', ctls.length === 33, String(ctls.length));
const one = ctls.find((e) => e.name === 'mAlbedoH');
ok('item 名抠出来了', one?.item === 'AlbedoH', one?.item);
ok('对象名抠出来了', one?.object === 'CONTROLLER_NAME', one?.object);
ok('控制器不进改动清单', collectChanges(fxp.entries, {}, {}).length === 0);

console.log('\n== 4c. 注释开关的往返 ==');
const on = toggleCommented('//#define MAT_X 1', true);
ok('//#define → #define', on === '#define MAT_X 1', JSON.stringify(on));
ok('再注释回去是原样', toggleCommented(on, false) === '//#define MAT_X 1', JSON.stringify(toggleCommented(on, false)));
const on2 = toggleCommented('// #define MAT_Y 2', true);
ok('// #define 也认', on2 === '#define MAT_Y 2', JSON.stringify(on2));

console.log('\n== 5. ikClut 权重公式 ==');
const X = 0.3;
const Y = 0.7;
const w = [(1 - Y) * (1 - X), (1 - Y) * X, Y * (1 - X), Y * X];
ok(
  'X=0.3 Y=0.7 得到 21/9/49/21',
  w.map((v) => Math.round(v * 100)).join(',') === '21,9,49,21',
  w.map((v) => Math.round(v * 100)).join(',')
);

console.log(`\n通过 ${pass}，失败 ${fail}\n`);
process.exitCode = fail ? 1 : 0;
