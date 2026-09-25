/**
 * ③ Ray 编辑器的自测。
 *
 * 跑的是真代码（src/lib/modules/ray 下的四个文件），语料是本机的真 Ray 包。
 * 覆盖这一条完整链路：
 *
 *   读 ray.conf → 列出参数 → 改一个 → 算 diff → 写回 → 重新读 → 值对得上
 *   → 撤销 → 逐字节回到原样 → 重做 → 又变回去
 *
 * 另外专门测三件容易出错的事：
 *   · Shift-JIS 的文件写完，日文注释的字节一个都不能变
 *   · CRLF 的文件写完还是 CRLF，不能多出孤立 LF
 *   · 路径里有中文 / 日文 / 空格时读写都正常
 *
 * 用法：node --import ./tmp/register-loader.mjs tmp/ray-editor.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRayText, collectChanges, spliceAsciiLineEdits, applyEditsToText, setDefineValue, setConstValue } from '../src/lib/modules/ray/ops.ts';
import { explain, coverage, sectionOf } from '../src/lib/modules/ray/docs.ts';
import { classify, parseColor, formatColor, toHex, fromHex, relativeFrom, pathNeedsCaution } from '../src/lib/modules/ray/value.ts';
import {
  recordWrite, undoWrite, redoWrite, undoAll, redoAll, timelineRows, canUndo, canRedo, reverseChange
} from '../src/lib/modules/ray/history.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, 'ray-editor-test');

const CORPUS = [
  'D:/9.26mmd/ray-mmd-1.5.2',
  'D:/ray-mmd-master',
  'D:/9.26mmd/modern_ray_alpha'
].find((d) => fs.existsSync(d));

const RAY_CONF = CORPUS ? path.join(CORPUS, 'ray.conf') : null;
const RAY_ADV = CORPUS ? path.join(CORPUS, 'ray_advanced.conf') : null;
const MATERIAL = CORPUS ? path.join(CORPUS, 'Materials/material_2.0.fx') : null;
// 一份 Shift-JIS 的材质（日文注释），用来测字节拼接
const SJIS_FX = CORPUS
  ? path.join(CORPUS, 'Materials/toon/Tex/RT_Normalmap/fx/RT_Fabric01.fx')
  : null;

let pass = 0;
let fail = 0;
const fails = [];

function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}${detail ? '  ' + detail : ''}`);
  } else {
    fail++;
    fails.push(name);
    console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`);
  }
}
function eq(name, got, want) {
  ok(name, got === want, got === want ? '' : `实得 ${JSON.stringify(got)}，应为 ${JSON.stringify(want)}`);
}
function head(t) {
  console.log(`\n== ${t} ==`);
}

const utf8 = (b) => new TextDecoder('utf-8').decode(b);
const sjis = (b) => new TextDecoder('shift_jis').decode(b);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const bytes = (s) => new TextEncoder().encode(s);

/* ============================================================ 0. 语料在不在 */

head('0. 语料');
if (!CORPUS) {
  console.log('  没找到本机的 Ray 包，只能测合成样本。');
} else {
  console.log(`  用 ${CORPUS}`);
}
ok('找得到 ray.conf', !!RAY_CONF && fs.existsSync(RAY_CONF));

/* ============================================================ 1. 说明表覆盖 */

head('1. 中文说明表覆盖多少条');

const rayConfText = utf8(fs.readFileSync(RAY_CONF));
const rayConf = parseRayText(rayConfText, RAY_CONF);
const rayDefines = rayConf.entries.filter((e) => e.kind === 'define' || e.kind === 'commented');
const cov1 = coverage('ray-conf', rayDefines.map((e) => e.name));
console.log(`  ray.conf：${rayDefines.length} 个 #define`);
eq('ray.conf 每个都有说明', cov1.hit, cov1.total);
if (cov1.miss.length) console.log(`    缺：${cov1.miss.join('、')}`);

const advText = utf8(fs.readFileSync(RAY_ADV));
const adv = parseRayText(advText, RAY_ADV);
const advConsts = adv.entries.filter((e) => e.kind === 'const');
const cov2 = coverage('ray-advanced', advConsts.map((e) => e.name));
console.log(`  ray_advanced.conf：${advConsts.length} 个 static const`);
eq('ray_advanced 每个都有说明', cov2.hit, cov2.total);
if (cov2.miss.length) console.log(`    缺：${cov2.miss.join('、')}`);

const matText = utf8(fs.readFileSync(MATERIAL));
const mat = parseRayText(matText, MATERIAL);
const matItems = mat.entries.filter((e) => e.kind === 'define' || e.kind === 'const');
const cov3 = coverage('material', matItems.map((e) => e.name));
console.log(`  material_2.0.fx：${matItems.length} 个可改项`);
console.log(`    有说明 ${cov3.hit} / ${cov3.total}`);
ok('material 覆盖过半', cov3.hit / cov3.total > 0.5, `${Math.round((cov3.hit / cov3.total) * 100)}%`);
if (cov3.miss.length) console.log(`    缺：${cov3.miss.slice(0, 12).join('、')}`);

console.log(`  合计解析出 ${rayDefines.length + advConsts.length + matItems.length} 个参数`);

/* ============================================================ 2. 分类 */

head('2. 控件分类');

const byName = (entries, n) => entries.find((e) => e.name === n);

const sunLight = byName(rayConf.entries, 'SUN_LIGHT_ENABLE');
const fSun = classify(sunLight, explain('SUN_LIGHT_ENABLE', 'ray-conf'));
eq('SUN_LIGHT_ENABLE 是枚举', fSun.kind, 'enum');
ok('枚举有 3 档', fSun.options.length === 3, `实得 ${fSun.options.length}`);

const sunShadow = byName(rayConf.entries, 'SUN_SHADOW_QUALITY');
eq('SUN_SHADOW_QUALITY 是枚举', classify(sunShadow, explain('SUN_SHADOW_QUALITY', 'ray-conf')).kind, 'enum');

const tonemapDoc = explain('HDR_TONEMAP_OPERATOR', 'ray-conf');
eq('色调映射是枚举', classify(byName(rayConf.entries, 'HDR_TONEMAP_OPERATOR'), tonemapDoc).kind, 'enum');
eq('色调映射有 7 档', tonemapDoc.options.length, 7);

const mTemp = byName(adv.entries, 'mTemperature');
const fTemp = classify(mTemp, explain('mTemperature', 'ray-advanced'));
eq('mTemperature 是数值', fTemp.kind, 'number');
eq('mTemperature 抠出下限', fTemp.min, 1000);
eq('mTemperature 抠出上限', fTemp.max, 40000);

const albedoFile = byName(mat.entries, 'ALBEDO_MAP_FILE');
eq('ALBEDO_MAP_FILE 是贴图', classify(albedoFile, explain('ALBEDO_MAP_FILE', 'material')).kind, 'texture');

const albedo = byName(mat.entries, 'albedo');
const fAlbedo = classify(albedo, explain('albedo', 'material'));
eq('albedo 是颜色', fAlbedo.kind, 'color');

const specular = byName(mat.entries, 'specular');
eq('specular 是颜色', classify(specular, explain('specular', 'material')).kind, 'color');

const emissive = byName(mat.entries, 'emissive');
eq('emissive 是颜色', classify(emissive, explain('emissive', 'material')).kind, 'color');

const uvFlip = byName(mat.entries, 'ALBEDO_MAP_UV_FLIP');
/* 这条原来断言的是 switch —— **那次断言本身就是错的**：
   真包里 *_MAP_UV_FLIP 有 1/2/3 三段不同的坐标改写（横翻/纵翻/都翻），
   按开关渲染用户就选不了 1/3（2026-09-21 用户实测报的正是这个）。 */
const fFlip = classify(uvFlip, explain('ALBEDO_MAP_UV_FLIP', 'material'));
eq('ALBEDO_MAP_UV_FLIP 是枚举（不是开关）', fFlip.kind, 'enum');
eq('UV 翻转有 4 档（0/1/2/3）', fFlip.options.length, 4);

/* 这三条是用户点名的"除了开还可以选 1/3" */
const subEnable = byName(mat.entries, 'ALBEDO_SUB_ENABLE');
const fSub = classify(subEnable, explain('ALBEDO_SUB_ENABLE', 'material'));
eq('ALBEDO_SUB_ENABLE 是枚举（不是开关）', fSub.kind, 'enum');
eq('叠加方式有 6 档（0~5）', fSub.options.length, 6);
ok(
  'ALBEDO_SUB_ENABLE 里能选到 3（加）',
  fSub.options.some((o) => o.value === '3'),
  fSub.options.map((o) => o.value).join(',')
);
ok(
  'ALBEDO_SUB_ENABLE 的默认值 0 在档位表里',
  fSub.options.some((o) => o.value === '0'),
  fSub.options.map((o) => o.value).join(',')
);

const blink = byName(mat.entries, 'EMISSIVE_MAP_APPLY_BLINK');
const fBlink = classify(blink, explain('EMISSIVE_MAP_APPLY_BLINK', 'material'));
eq('EMISSIVE_MAP_APPLY_BLINK 是枚举（不是开关）', fBlink.kind, 'enum');
eq('闪烁有 3 档（0/1/2）', fBlink.options.length, 3);

const custom = byName(mat.entries, 'CUSTOM_ENABLE');
const fCustom = classify(custom, explain('CUSTOM_ENABLE', 'material'));
eq('CUSTOM_ENABLE 是枚举（它是 shading model 编号，不是开关）', fCustom.kind, 'enum');
eq('着色模型有 11 档（0~10，含 MASK）', fCustom.options.length, 11);

const smMask = byName(mat.entries, 'SHADINGMODELID_MASK');
if (smMask) {
  ok(
    'SHADINGMODELID_MASK 有说明（它是 10 号着色模型）',
    !!explain('SHADINGMODELID_MASK', 'material'),
    '没有说明'
  );
}

/* 兜底：没写进说明表的"档位型"名字不许再退回复选框 */
const 假开关 = { kind: 'define', name: 'CUSTOM_B_MAP_UV_FLIP', value: '3', type: '', raw: '#define CUSTOM_B_MAP_UV_FLIP 3', comment: '', doc: '', line: 1 };
eq('没说明的多档参数给数字框而不是开关', classify(假开关, null).kind, 'number');
const 假开关2 = { ...假开关, name: 'SOME_MAP_UV_FLIP', value: '1' };
eq('值为 1 的多档参数也不是开关', classify(假开关2, null).kind, 'number');
const 真开关 = { ...假开关, name: 'ALBEDO_MAP_USE_ALPHA', value: '1' };
eq('普通开关仍然是开关', classify(真开关, null).kind, 'switch');

const alphaSwz = byName(mat.entries, 'ALPHA_MAP_SWIZZLE');
const fSwz = classify(alphaSwz, explain('ALPHA_MAP_SWIZZLE', 'material'));
eq('ALPHA_MAP_SWIZZLE 是枚举', fSwz.kind, 'enum');
eq('SWIZZLE 有 4 档', fSwz.options.length, 4);

const fromEntry = byName(mat.entries, 'ALBEDO_MAP_FROM');
const fFrom = classify(fromEntry, explain('ALBEDO_MAP_FROM', 'material'));
eq('ALBEDO_MAP_FROM 是枚举', fFrom.kind, 'enum');
eq('FROM 有 9 档', fFrom.options.length, 9);

const loopNum = byName(mat.entries, 'albedoMapLoopNum');
const fLoop = classify(loopNum, explain('albedoMapLoopNum', 'material'));
ok('albedoMapLoopNum 不是颜色（防止 1.0 被当成颜色）', fLoop.kind === 'number', `实得 ${fLoop.kind}`);

// fxsub 里的控制器项必须只读
const editorPath = CORPUS ? path.join(CORPUS, 'Materials/Editor/Standard/material_editor.fxsub') : null;
if (editorPath && fs.existsSync(editorPath)) {
  const ed = parseRayText(utf8(fs.readFileSync(editorPath)), editorPath);
  const ctrl = ed.entries.find((e) => e.kind === 'controller');
  ok('fxsub 里有 controller 项', !!ctrl);
  if (ctrl) {
    const f = classify(ctrl, null);
    eq('controller 是只读', f.kind, 'expr');
    ok('并且说明了为什么只读', !!f.why);
  }
}

/* ============================================================ 3. 分组 */

head('3. 分节');
eq('太阳光归到一处', sectionOf('SUN_LIGHT_ENABLE', 'ray-conf'), sectionOf('SUN_SHADOW_QUALITY', 'ray-conf'));
eq('点光源没被"光源"抢走', sectionOf('mPointLightNear', 'ray-advanced'), '点光源');
eq('环境光和光源分得开', sectionOf('mEnvLightIntensityMin', 'ray-advanced') !== sectionOf('mLightDistance', 'ray-advanced'), true);
eq('贴图槽位分得开', sectionOf('ALBEDO_MAP_FROM', 'material') !== sectionOf('NORMAL_MAP_FROM', 'material'), true);

/* ============================================================ 4. 颜色 */

head('4. 颜色解析与还原');
{
  const a = parseColor('1.0, 1.0, 1.0');
  ok('逗号平铺能解', !!a && a.r === 1 && a.g === 1 && a.b === 1);
  eq('三分量没有 A', a.hasAlpha, false);
  eq('逗号平铺还原样', formatColor(a, '1.0, 1.0, 1.0'), '1.0, 1.0, 1.0');

  const b = parseColor('{ 0.5, 0.25, 0.125 }');
  ok('花括号能解', !!b && Math.abs(b.g - 0.25) < 1e-9);
  eq('花括号还原样', formatColor(b, '{ 0.5, 0.25, 0.125 }'), '{ 0.5, 0.25, 0.125 }');

  const c = parseColor('1.0, 1.0, 1.0, 1.0');
  eq('四分量带 A', c.hasAlpha, true);
  eq('四分量还原样', formatColor(c, '1.0, 1.0, 1.0, 1.0'), '1.0, 1.0, 1.0, 1.0');

  const d = parseColor('1.5');
  ok('标量能解', !!d && d.r === 1.5);
  eq('标量还原样（不带括号）', formatColor(d, '1.5'), '1.5');

  ok('带 f 后缀能解', parseColor('1.0f, 0.5f, 0.0f') !== null);
  eq('不是颜色就返回 null', parseColor('MaterialToon.rgb'), null);
  eq('表达式不是颜色', parseColor('comp*(saturate(0.5))'), null);

  const hdr = parseColor('3.5, 1.0, 1.0');
  eq('大于 1 也留得住', formatColor(hdr, '3.5, 1.0, 1.0'), '3.5, 1.0, 1.0');
  // 1.5 钳到 255、0.5 钳到 128 = 0x80
  eq('取色器把超过 1 的分量钳到 255', toHex(hdr), '#ffffff');
  eq('取色器把 0.5 映到 0x80', toHex(parseColor('1.5, 0.5, 0.5')), '#ff8080');
  const back = fromHex('#ff0000');
  eq('十六进制转回 0~1', Math.round(back.r), 1);

  // 小数位数不能丢：源里三个分量位数不一样的时候，早年实现是拿第一个的位数
  // 套给全部，0.25 会写成 0.3
  const mix = parseColor('{ 0.5, 0.25, 0.125 }');
  eq('混合小数位原样还原', formatColor(mix, '{ 0.5, 0.25, 0.125 }'), '{ 0.5, 0.25, 0.125 }');
  eq('标量不会自己膨胀成三分量', formatColor(parseColor('1.5'), '1.5'), '1.5');
  eq('改动一个分量之后才展开', formatColor({ ...parseColor('1.5'), g: 0.25 }, '1.5'), '1.5, 0.25, 1.5');
  eq('整数写法不补小数', formatColor(parseColor('0'), '0'), '0');
  // 从取色器来的新值要有足够精度
  const fromPicker = { ...parseColor('{ 1.0, 1.0, 1.0 }'), r: 128 / 255 };
  const out = formatColor(fromPicker, '{ 1.0, 1.0, 1.0 }');
  ok('取色器来的值精度够（不会退化成 0.5 或 1）', out === '{ 0.502, 1.0, 1.0 }', out);
}

/* ============================================================ 5. 路径 */

head('5. 贴图相对路径');
{
  const r1 = relativeFrom('D:/pkg/Sub/mat.fx', 'D:/pkg/Sub/tex/a.png');
  eq('同目录下子文件夹', r1.path, 'tex/a.png');
  eq('不算跨盘', r1.crossDrive, false);

  const r2 = relativeFrom('D:/pkg/Sub/mat.fx', 'D:/pkg/tex/b.png');
  eq('往上一级', r2.path, '../tex/b.png');

  const r3 = relativeFrom('D:/pkg/mat.fx', 'E:/other/c.png');
  eq('跨盘返回绝对路径', r3.path, 'E:/other/c.png');
  eq('跨盘要标出来', r3.crossDrive, true);

  const r4 = relativeFrom(
    String.raw`D:\9.26mmd\ray-mmd-1.5.2\Materials\material_2.0.fx`,
    String.raw`D:\9.26mmd\ray-mmd-1.5.2\Materials\Tex\中文 贴图\衣服 01.png`
  );
  eq('中文 + 空格路径算相对', r4.path, 'Tex/中文 贴图/衣服 01.png');
  ok('中文路径给出提醒', pathNeedsCaution(r4.path) !== null);
  ok('纯 ASCII 路径不提醒', pathNeedsCaution('tex/a.png') === null);
}

/* ============================================================ 6. 完整链路 */

head('6. 完整链路：改 → diff → 写回 → 重读 → 撤销 → 重做');

fs.rmSync(WORK, { recursive: true, force: true });
// 目录名故意带中文、日文和空格 —— 要求里明确说了路径不能出问题
const TRICKY = path.join(WORK, '中文 目录', '日本語 テスト');
fs.mkdirSync(TRICKY, { recursive: true });

const target = path.join(TRICKY, 'ray.conf');
const original = fs.readFileSync(RAY_CONF);
fs.writeFileSync(target, original);
ok('带中文日文空格的目录建出来了', fs.existsSync(target), TRICKY);

// 假的 io，给 history 用；底下还是真文件
const io = {
  readBytes: async (p) => new Uint8Array(fs.readFileSync(p)),
  writeBytes: async (p, b) => fs.writeFileSync(p, b)
};

let log = [];
{
  // —— 读
  const text1 = utf8(fs.readFileSync(target));
  const parsed1 = parseRayText(text1, target);
  const n1 = parsed1.entries.length;
  console.log(`  读到 ${n1} 个参数，${parsed1.entries.filter((e) => e.kind === 'define').length} 个 #define`);
  eq('解析出的项数 > 10', n1 > 10, true);

  // —— 改一个：色调映射 4 → 6
  const values = {};
  for (const e of parsed1.entries) {
    if (e.kind === 'define' || e.kind === 'const') values[e.id] = e.value;
  }
  const tm = parsed1.entries.find((e) => e.name === 'HDR_TONEMAP_OPERATOR');
  eq('原值是 4', tm.value, '4');
  values[tm.id] = '6';

  // —— diff
  const changes = collectChanges(parsed1.entries, values, {});
  eq('只算出一处改动', changes.length, 1);
  eq('改动名对得上', changes[0].name, 'HDR_TONEMAP_OPERATOR');
  eq('旧值记对了', changes[0].before, '4');
  eq('新值记对了', changes[0].after, '6');
  ok('旧行原文留着', changes[0].oldRaw.includes('HDR_TONEMAP_OPERATOR 4'), changes[0].oldRaw.trim());
  ok('新行原文拼出来了', changes[0].newRaw.includes('HDR_TONEMAP_OPERATOR 6'), changes[0].newRaw.trim());
  // 对齐不能被压掉：原文件是 `#define HDR_TONEMAP_OPERATOR 4`（一个空格）
  eq('行尾注释跟着走', changes[0].newRaw.trim().endsWith('#define HDR_TONEMAP_OPERATOR 6'), true);

  // —— 写回（字节拼接）
  const spliced = spliceAsciiLineEdits(original, changes);
  ok('字节拼接成功', spliced.ok, spliced.why ?? '');
  const beforeBytes = spliced.bytes;
  fs.writeFileSync(target, beforeBytes);

  // —— 重新读，值要对得上
  const text2 = utf8(fs.readFileSync(target));
  const parsed2 = parseRayText(text2, target);
  const tm2 = parsed2.entries.find((e) => e.name === 'HDR_TONEMAP_OPERATOR');
  eq('写回之后值是 6', tm2.value, '6');
  eq('项数没变', parsed2.entries.length, n1);

  // —— 除了那一行，其它字节必须逐字节相同
  const linesBefore = Buffer.from(original).toString('latin1').split('\n');
  const linesAfter = Buffer.from(beforeBytes).toString('latin1').split('\n');
  eq('行数没变', linesAfter.length, linesBefore.length);
  let diffLines = 0;
  for (let i = 0; i < linesBefore.length; i++) {
    if (linesBefore[i] !== linesAfter[i]) diffLines++;
  }
  eq('只有 1 行变了', diffLines, 1);

  // —— 记一笔，然后撤销
  log = recordWrite(log, {
    path: target,
    fileLabel: 'ray.conf',
    encoding: 'utf-8',
    how: '字节拼接',
    changes: changes.map((c) => ({ name: c.name, line: c.line, before: c.before, after: c.after, oldRaw: c.oldRaw, newRaw: c.newRaw })),
    backup: target + '.bak'
  });
  // 造一份备份（真流程里是后端留的）
  fs.writeFileSync(target + '.bak', original);

  eq('有可撤的', canUndo(log), true);

  const u = await undoWrite(log, log[0].id, io);
  log = u.log;
  ok('撤销成功', u.ok, u.message);
  const restored = new Uint8Array(fs.readFileSync(target));
  ok('撤销后逐字节回到原样', same(restored, original), `长度 ${restored.length} vs ${original.length}`);
  eq('撤销后重新解析值是 4', parseRayText(utf8(restored), target).entries.find((e) => e.name === 'HDR_TONEMAP_OPERATOR').value, '4');

  eq('现在有可重做的', canRedo(log), true);
  const r = await redoWrite(log, log[0].id, io);
  log = r.log;
  ok('重做成功', r.ok, r.message);
  eq('重做后值是 6', parseRayText(utf8(fs.readFileSync(target)), target).entries.find((e) => e.name === 'HDR_TONEMAP_OPERATOR').value, '6');

  // —— 时间线
  const rows = timelineRows(log);
  eq('时间线一条', rows.length, 1);
  eq('时间线记了文件', rows[0].fileLabel, 'ray.conf');
  eq('时间线记了参数名', rows[0].name, 'HDR_TONEMAP_OPERATOR');
  eq('时间线记了行号', rows[0].line, tm.line);
  eq('时间线旧值', rows[0].before, '4');
  eq('时间线新值', rows[0].after, '6');
}

/* ============================================================ 7. 单条撤销 */

head('7. 单条撤销（改回旧值）');
{
  const text = utf8(fs.readFileSync(target));
  const parsed = parseRayText(text, target);
  const entry = parsed.entries.find((e) => e.name === 'HDR_TONEMAP_OPERATOR');
  const rec = { name: entry.name, line: entry.line, before: '4', after: '6', oldRaw: '', newRaw: '' };
  const target_raw = reverseChange(rec, setDefineValue, entry.raw);
  ok('拼出了这一行的旧值', !!target_raw && target_raw.includes('HDR_TONEMAP_OPERATOR 4'), target_raw ?? '');
  const ed = [{ line: entry.line, oldRaw: entry.raw, newRaw: target_raw }];
  const sp = spliceAsciiLineEdits(fs.readFileSync(target), ed);
  ok('单条撤销的字节拼接也过', sp.ok, sp.why ?? '');
  eq('撤销后解析值回到 4', parseRayText(utf8(sp.bytes), target).entries.find((e) => e.name === 'HDR_TONEMAP_OPERATOR').value, '4');
}

/* ============================================================ 8. Shift-JIS */

head('8. Shift-JIS 文件：日文注释的字节不能被碰');
if (SJIS_FX && fs.existsSync(SJIS_FX)) {
  const raw = fs.readFileSync(SJIS_FX);
  const isUtf8 = (() => {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(raw);
      return true;
    } catch {
      return false;
    }
  })();
  eq('这份语料确实不是 UTF-8', isUtf8, false);

  const text = sjis(raw);
  ok('能用 shift_jis 解出来', text.length > 0);
  const parsed = parseRayText(text, SJIS_FX);
  console.log(`  解析出 ${parsed.entries.length} 个可改项`);
  ok('解析到了 #define', parsed.entries.some((e) => e.kind === 'define'));

  // 挑一个数值型 #define 改掉
  const defs = parsed.entries.filter((e) => e.kind === 'define' && /^-?\d+(\.\d+)?$/.test(e.value));
  ok('有可改的数值 #define', defs.length > 0);
  if (defs.length) {
    const d = defs[0];
    const values = {};
    for (const e of parsed.entries) if (e.kind === 'define') values[e.id] = e.value;
    values[d.id] = String(Number(d.value) + 1);
    const changes = collectChanges(parsed.entries, values, {});
    eq('算出一处改动', changes.length, 1);

    const sjisTarget = path.join(TRICKY, 'sjis-test.fx');
    fs.writeFileSync(sjisTarget, raw);
    const sp = spliceAsciiLineEdits(raw, changes);
    ok('Shift-JIS 文件也能字节拼接', sp.ok, sp.why ?? '');
    if (sp.ok) {
      fs.writeFileSync(sjisTarget, sp.bytes);
      const after = fs.readFileSync(sjisTarget);
      // 长度应该只差改动那一位（这里 +1 让位数可能变，所以只要求行数一致）
      const beforeLines = Buffer.from(raw).toString('latin1').split('\n');
      const afterLines = Buffer.from(sp.bytes).toString('latin1').split('\n');
      eq('行数没变', afterLines.length, beforeLines.length);
      let diff = 0;
      for (let i = 0; i < beforeLines.length; i++) if (beforeLines[i] !== afterLines[i]) diff++;
      eq('只有 1 行变了', diff, 1);

      // 日文注释那段字节必须原封不动
      const jpBytesBefore = findJapaneseByteRun(raw);
      const jpBytesAfter = findJapaneseByteRun(after);
      ok('日文注释的字节原样保留', same(jpBytesBefore, jpBytesAfter), `${jpBytesBefore.length} 字节`);

      // 重新按 Shift-JIS 解出来，值要是新的
      const re = parseRayText(sjis(after), sjisTarget);
      const got = re.entries.find((e) => e.line === d.line);
      eq('重新解析值对得上', got.value, values[d.id]);
    }
  }

  // 改动里带非 ASCII 时必须拒写，而不是硬写
  const fileEntry = parsed.entries.find((e) => /_MAP_FILE$/.test(e.name));
  if (fileEntry) {
    const fake = [{ line: fileEntry.line, oldRaw: fileEntry.raw, newRaw: setDefineValue(fileEntry.raw, '"中文贴图.png"') }];
    const sp2 = spliceAsciiLineEdits(raw, fake);
    eq('中文文件名 + Shift-JIS → 拒写', sp2.ok, false);
    ok('拒写时说清了原因', (sp2.why ?? '').includes('非 ASCII'), sp2.why ?? '');
  } else {
    console.log('  （这份语料没有 _MAP_FILE，跳过拒写测试）');
  }
} else {
  console.log('  没找到 Shift-JIS 语料，跳过');
}

/** 从字节里挑出一段连续的双字节序列（日文），用来比对改前改后一致 */
function findJapaneseByteRun(buf) {
  let best = [];
  let cur = [];
  for (const b of buf) {
    if (b > 0x80) cur.push(b);
    else {
      if (cur.length > best.length) best = cur.slice();
      cur = [];
    }
  }
  if (cur.length > best.length) best = cur;
  return best;
}

/* ============================================================ 9. CRLF */

head('9. CRLF 保留');
{
  const lf = '// a\r\n#define TEST_SWITCH 0\r\n// 日文不会出现在这里\r\n';
  const parsed = parseRayText(lf, 'x.conf');
  eq('认出 CRLF', parsed.eol, '\r\n');
  const values = {};
  for (const e of parsed.entries) if (e.kind === 'define') values[e.id] = '1';
  const changes = collectChanges(parsed.entries, values, {});
  eq('算出一处改动', changes.length, 1);
  const sp = spliceAsciiLineEdits(bytes(lf), changes);
  ok('CRLF 文件拼接成功', sp.ok, sp.why ?? '');
  const out = utf8(sp.bytes);
  const crlf = (out.match(/\r\n/g) || []).length;
  const loneLF = (out.match(/(?<!\r)\n/g) || []).length;
  eq('CRLF 一个不少', crlf, 3);
  eq('没有多出孤立 LF', loneLF, 0);
  ok('值改成 1 了', out.includes('#define TEST_SWITCH 1'));

  // UTF-8 文件的整段重写也要保住 CRLF
  const rewritten = applyEditsToText(lf, changes);
  eq('整段重写也保 CRLF', (rewritten.match(/\r\n/g) || []).length, 3);
}

/* ============================================================ 10. 全撤 / 全重做 */

head('10. 全部撤销 / 全部重做（多次写盘）');
{
  const p = path.join(TRICKY, 'multi.conf');
  const base = Buffer.from('// t\n#define A 1\n#define B 2\n#define C 3\n', 'utf8');
  fs.writeFileSync(p, base);

  let lg = [];
  let cur = new Uint8Array(base);
  // 写三次，每次改一个
  const steps = [
    ['A', 1, 9],
    ['B', 2, 8],
    ['C', 3, 7]
  ];
  for (let i = 0; i < steps.length; i++) {
    const [name, from, to] = steps[i];
    const text = utf8(cur);
    const parsed = parseRayText(text, p);
    const e = parsed.entries.find((x) => x.name === name);
    const values = {};
    for (const x of parsed.entries) if (x.kind === 'define') values[x.id] = x.value;
    values[e.id] = String(to);
    const changes = collectChanges(parsed.entries, values, {});
    const sp = spliceAsciiLineEdits(cur, changes);
    // 每次写盘前留一份唯一命名的备份（跟后端的行为一致）
    const bak = `${p}.bak${i === 0 ? '' : i + 1}`;
    fs.writeFileSync(bak, cur);
    fs.writeFileSync(p, sp.bytes);
    cur = new Uint8Array(sp.bytes);
    lg = recordWrite(lg, {
      path: p, fileLabel: 'multi.conf', encoding: 'utf-8', how: '字节拼接',
      changes: changes.map((c) => ({ name: c.name, line: c.line, before: c.before, after: c.after, oldRaw: c.oldRaw, newRaw: c.newRaw })),
      backup: bak
    });
  }
  eq('记了三条', lg.length, 3);
  eq('时间线三条', timelineRows(lg).length, 3);
  const finalText = utf8(fs.readFileSync(p));
  ok('三次都写进去了', finalText.includes('A 9') && finalText.includes('B 8') && finalText.includes('C 7'));

  const ua = await undoAll(lg, io);
  lg = ua.log;
  ok('全部撤销成功', ua.ok, ua.message);
  ok('全部撤销后逐字节回到最初', same(new Uint8Array(fs.readFileSync(p)), base));
  eq('没有可撤的了', canUndo(lg), false);

  const ra = await redoAll(lg, io);
  lg = ra.log;
  ok('全部重做成功', ra.ok, ra.message);
  const back = utf8(fs.readFileSync(p));
  ok('全部重做后三次改动都回来了', back.includes('A 9') && back.includes('B 8') && back.includes('C 7'));
}

/* ============================================================ 11. 解析失败要说清楚 */

head('11. 解析失败的报错');
{
  const bad = parseRayText('const float x = 1.0\nconst float y = 2.0;\n', 'bad.conf');
  ok('漏分号的 const 报错', bad.errors.length >= 1);
  eq('报的是第 1 行', bad.errors[0].line, 0);
  ok('报了原因', bad.errors[0].why.includes('分号'), bad.errors[0].why);
  ok('带上了原文', bad.errors[0].raw.includes('const float x'), bad.errors[0].raw);
  eq('后面那行照样解析', bad.entries.length, 1);

  // 注释掉的开关
  const off = parseRayText('//#define OLD_SWITCH 1\n#define ON 1\n', 'c.conf');
  ok('认出注释掉的开关', off.entries.some((e) => e.kind === 'commented' && e.name === 'OLD_SWITCH'));
  const act = collectChanges(off.entries, {}, { 'commented:0': true });
  eq('启用它算一处改动', act.length, 1);
  ok('启用后不再带 //', act[0].newRaw.startsWith('#define'), act[0].newRaw);
}

/* ============================================================ 汇总 */

console.log(`\n${'='.repeat(50)}`);
console.log(`通过 ${pass}，失败 ${fail}`);
if (fail) {
  console.log('失败项：');
  for (const f of fails) console.log(`  - ${f}`);
}
process.exit(fail ? 1 : 0);
