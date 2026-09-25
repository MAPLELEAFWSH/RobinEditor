/**
 * ⑥ 养乐多（yaku）的自检。
 *
 * 跑：node --import ./tmp/register-loader.mjs tmp/yaku-ops.test.mjs
 *
 * 这一套原来叫 `tmp/test_yaku.mts`：**没有任何脚本会跑它**（`pnpm test` 的 glob 是
 * `tmp/*.test.mjs`，它是 `.mts`），而且里面把语料路径写死成 `D:/9.26mmd/...`。
 * 现在改成可配（环境变量 `YAKU_REF` / `YAKU_CORPUS`）+ 接进 `pnpm test`。
 *
 * 语料的真身：`实战测试用例\渲染联动\养乐多\MMDStarRail4Fun_v2.2.1`（只读）。
 * 基准就是它自己 —— 同一个包里既有 `mat_body.fx` 这种模板，又有各角色已经填好的
 * `*_body.fx`，以及配套的真贴图。**同一目录、同一套命名**，这才是本工程认的地面真值。
 */
import fs from 'node:fs';
import path from 'node:path';
import * as ops from '../src/lib/modules/yaku/ops.ts';

const CORPUS =
  process.env.YAKU_CORPUS ??
  String.raw`E:\deepseek-harness\mmd集成工具\实战测试用例\渲染联动\养乐多\MMDStarRail4Fun_v2.2.1`;
/** 模板。优先语料里那份，环境变量能覆盖 */
const REF = process.env.YAKU_REF ?? path.join(CORPUS, 'mat_body.fx');

let pass = 0;
let fail = 0;
function ok(cond, label, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}${extra ? '   ' + extra : ''}`);
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

/* 语料不在就跳过，不算失败 —— 但要说清跳了什么，别装成跑过了 */
if (!fs.existsSync(REF)) {
  console.log(`语料不在：${REF}`);
  console.log('设 YAKU_REF / YAKU_CORPUS 指过去，或者把这台机器上的语料放回原位。');
  console.log(`\n0 通过 / 0 失败（整套跳过）`);
  process.exit(0);
}

const raw = fs.readFileSync(REF, 'utf8');

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return `第 ${i} 字符：${JSON.stringify(a.slice(Math.max(0, i - 30), i + 30))}`;
    }
  }
  return `长度不同 ${a.length} vs ${b.length}`;
}

section('1. 解析真模板');
const p = ops.parseFx(raw);
{
  eq(p.eol, '\r\n', '换行是 CRLF');
  eq(p.lines.length, raw.split(/\r?\n/).length, '行数对得上');
  eq(p.includes.length, 2, 'include 认出两个');
  ok(p.params.length > 200, '参数数量合理', `实到 ${p.params.length}`);
  ok(p.sections.length > 0, '段识别出来', p.sections.map((s) => `${s.title}(${s.count})`).join(' '));
}

section('2. 原样回写必须逐字节相同');
{
  const same = ops.writeFx(p, p.params);
  ok(same === raw, '原样回写逐字节相同', same === raw ? '' : firstDiff(same, raw));
}

section('3. 关键参数都认出来了');
{
  const byName = new Map(p.params.map((q) => [q.name, q]));
  for (const n of [
    'SUB_INDEX_SWIZZLE',
    'DIFFUSE_THRESHOLD_SWIZZLE',
    'SPECULAR_THRESHOLD_SWIZZLE',
    'STOCKINGS_MASK_SWIZZLE',
    'MATERIAL_DOMAIN',
    'LIGHTMAP_TEXTURE',
    'RAMP_COOL_TEXTURE'
  ]) {
    ok(!!byName.get(n), `认出 ${n}`, byName.get(n) ? `${byName.get(n).kind} value=${byName.get(n).value}` : '');
  }
  eq(byName.get('LIGHTMAP_TEXTURE')?.kind, 'texture', '贴图是 texture 类型');
  eq(byName.get('COLOR_TEXTURE')?.enabled, false, '被注释的 RAMP 识别到开关状态');
  ok(
    byName.get('BaseColorTint7')?.slot === 7 && byName.get('BaseColorTint7')?.base === 'BaseColorTint',
    '槽位识别 BaseColorTint7.slot=7'
  );
}

section('4. autofill + 回写 + 再解析');
{
  const mats = [
    { name: '身体', kind: 'body', diffuse: [0.9, 0.85, 0.8, 1], specular: [0.3, 0.3, 0.3], specular_power: 12, ambient: [0, 0, 0], edge_size: 0.5 },
    { name: '袖', kind: 'cloth', diffuse: [0.2, 0.3, 0.6, 1], specular: [0, 0, 0], specular_power: 0, ambient: [0, 0, 0], edge_size: 0.3 }
  ];
  const texs = [
    'Avatar_RobinS_00_Body_Color_A_L.png',
    'Avatar_RobinS_00_Body_LightMap_L.png',
    'Avatar_RobinS_00_Body_Cool_Ramp.png',
    'Avatar_RobinS_00_Body_Warm_Ramp.png',
    'Avatar_RobinS_00_Body_Mask_01.png'
  ];
  const filled = ops.autofill(p.params, { domain: 'body', materials: mats, textures: texs });
  ok(filled.why.length > 0, 'autofill 填了一批', `${filled.why.length} 项`);

  ok(String(filled.values['LIGHTMAP_TEXTURE'] ?? '').includes('LightMap'), '填了贴图路径');
  eq(filled.values['SUB_INDEX_SWIZZLE'], '3', '填了通道排法');
  eq(filled.values['BaseColorTint0'], '0.9, 0.85, 0.8', '槽 0 用了材质 0 的 diffuse');
  eq(filled.values['BaseColorTint1'], '0.2, 0.3, 0.6', '槽 1 用了材质 1 的 diffuse');

  const next = ops.mergeValues(p.params, filled.values);
  const out = ops.writeFx(p, next);
  const diff = ops.diffParams(p.params, next);
  ok(diff.length > 0, 'diff 有内容', `${diff.length} 条`);
  ok(
    diff.every((d) => filled.why.some((w) => w.name === d.name)),
    'diff 只列真正变了的（模板原值和填入值相同的那些不该进 diff）'
  );

  const p2 = ops.parseFx(out);
  const b2 = new Map(p2.params.map((q) => [q.name, q]));
  eq(b2.get('LIGHTMAP_TEXTURE')?.value, filled.values['LIGHTMAP_TEXTURE'], '再解析：贴图路径对');
  eq(b2.get('SUB_INDEX_SWIZZLE')?.value, '3', '再解析：swizzle 对');
  eq(b2.get('BaseColorTint0')?.value, '0.9, 0.85, 0.8', '再解析：BaseColorTint0 对');
  eq(p2.params.length, p.params.length, '再解析：参数量不变');
  eq(p2.includes.length, p.includes.length, '再解析：include 还在');
  eq(p2.lines.length, p.lines.length, '再解析：行数不变');

  /* 没碰的行一个字都不能动 —— 这条是写盘安全的地基 */
  const byName = new Map(p.params.map((q) => [q.name, q]));
  const changedLines = new Set(diff.map((d) => byName.get(d.name)?.line));
  let untouchedBroken = 0;
  for (let i = 0; i < p.lines.length; i++) {
    if (changedLines.has(i) || changedLines.has(i - 1)) continue;
    if (p.lines[i] !== p2.lines[i]) untouchedBroken++;
  }
  eq(untouchedBroken, 0, '没碰的行一个字都没变');
}

section('5. 注释切换');
{
  const toggled = ops.writeFx(
    p,
    p.params.map((q) => (q.name === 'COLOR_TEXTURE' ? { ...q, enabled: true } : q))
  );
  const p3 = ops.parseFx(toggled);
  eq(p3.params.find((q) => q.name === 'COLOR_TEXTURE')?.enabled, true, '把注释掉的贴图打开能生效');
  eq(ops.diffParams(p.params, p3.params).length, 1, '打开一张贴图只影响那一行');
}

section('6. 分类规则');
{
  eq(ops.applyRules('袖 白', 'other', []).kind, 'other', '没有自定义规则时用内置');
  eq(ops.applyRules('袖 白', 'other', [{ kw: '袖', kind: 'cloth' }]).kind, 'cloth', '自定义规则命中');
  eq(
    ops.applyRules('袖 白', 'other', [{ kw: '袖', kind: 'cloth' }, { kw: '白', kind: 'metal' }]).kind,
    'metal',
    '后加的规则优先'
  );
  eq(ops.templateFor('face'), 'face', 'templateFor: face→face');
  eq(ops.templateFor('hair'), 'hair', 'templateFor: hair→hair');
  eq(ops.templateFor('metal'), 'body', 'templateFor: 其余→body');
  eq(ops.normalizeTexPath('tex\\body\\a.png'), 'tex/body/a.png', '反斜杠转正斜杠');
}

section('7. 真实素材基准：全部模板 + 已填好的产物');
{
  const corpusOk = fs.existsSync(CORPUS);
  ok(corpusOk, '语料目录在', CORPUS);
  if (corpusOk) {
    const templates = fs
      .readdirSync(CORPUS)
      .filter((f) => /^mat_.*\.fx$/i.test(f))
      .sort();
    ok(templates.length >= 3, '根目录有模板', templates.join(' '));

    /* 每一个模板都要能解析、能原样回写、参数认得出一批 */
    let parsed = 0;
    let byteExact = 0;
    let withParams = 0;
    const bad = [];
    for (const f of templates) {
      const text = fs.readFileSync(path.join(CORPUS, f), 'utf8');
      try {
        const q = ops.parseFx(text);
        parsed++;
        if (ops.writeFx(q, q.params) === text) byteExact++;
        else bad.push(`${f}:回写不一致`);
        if (q.params.length > 50) withParams++;
        else bad.push(`${f}:只认出 ${q.params.length} 个参数`);
      } catch (e) {
        bad.push(`${f}:抛了 ${e.message}`);
      }
    }
    eq(parsed, templates.length, `模板全部解析成功（${templates.length} 个）`);
    eq(byteExact, templates.length, '每个模板原样回写都逐字节相同');
    eq(withParams, templates.length, '每个模板都认得出一批参数');
    ok(bad.length === 0, '没有坏掉的模板', bad.join(' / '));

    /* 已填好的产物也要认得出来 —— 它们是"填完之后长什么样"的真样本 */
    const filled = fs
      .readdirSync(CORPUS)
      .filter((f) => /_body.*\.fx$/i.test(f))
      .sort();
    let fParsed = 0;
    let fHasTex = 0;
    for (const f of filled) {
      const text = fs.readFileSync(path.join(CORPUS, f), 'utf8');
      try {
        const q = ops.parseFx(text);
        fParsed++;
        const names = new Set(q.params.map((x) => x.name));
        if (names.has('LIGHTMAP_TEXTURE') || names.has('COLOR_TEXTURE')) fHasTex++;
      } catch {
        /* 记在计数里 */
      }
    }
    ok(filled.length > 0, '有已填好的产物', `${filled.length} 个`);
    eq(fParsed, filled.length, '已填好的产物也全部解析成功');
    ok(fHasTex > filled.length / 2, '其中多数认得出一整套贴图参数', `${fHasTex}/${filled.length}`);
  }
}

section('8. 真实贴图名：字符集与长度都不越界');
{
  const dirs = fs.existsSync(CORPUS)
    ? fs
        .readdirSync(CORPUS, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== 'internal')
        .map((e) => path.join(CORPUS, e.name))
    : [];
  const charDirs = [];
  for (const d of dirs) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) charDirs.push(path.join(d, e.name));
    }
  }
  ok(charDirs.length > 0, '找得到角色目录', `${charDirs.length} 个`);

  /* 真贴图名归一化之后仍然是个合法路径段：不含反斜杠、不含空格开头、没被截断 */
  let checked = 0;
  let bad = 0;
  for (const d of charDirs) {
    for (const f of fs.readdirSync(d)) {
      if (!/\.(png|tga|dds|bmp)$/i.test(f)) continue;
      checked++;
      const n = ops.normalizeTexPath(f);
      if (n.includes('\\') || n !== n.trim() || !n.includes('.')) {
        if (bad < 3) console.log(`    归一化之后不对劲：${JSON.stringify(f)} → ${JSON.stringify(n)}`);
        bad++;
      }
    }
  }
  ok(checked > 20, '真的扫到了一批贴图名', `${checked} 个`);
  eq(bad, 0, '归一化之后都还是合法路径段');
}

/* ---------- 常用 / 完整 两档：判据要在真模板上站得住 ---------- */
{
  const parsed = ops.parseFx(fs.readFileSync(REF, 'utf8'));
  const all = parsed.params;
  const 常用 = ops.常用参数(all);

  ok(all.length > 0, '真模板解析出参数', `${all.length} 个`);
  ok(常用.length > 0, '常用一档不是空的（空了就是判据写死了）', `${常用.length} 个`);
  ok(常用.length < all.length, '常用确实比全部少', `${常用.length} < ${all.length}`);
  ok(
    常用.every((p) => p.kind === 'texture' || /来源|SOURCE|纹理|TEXTURE|テクスチャ|材质|材質|MATERIAL|全局|GLOBAL|整体|強度|强度|INTENSITY/i.test(p.name)),
    '常用里的每一项都命中判据（不是随手取的）'
  );
  const 贴图数 = all.filter((p) => p.kind === 'texture').length;
  eq(常用.filter((p) => p.kind === 'texture').length, 贴图数, '所有贴图格都在常用里');

  /* 破坏性对照：判据要是写成"全都算常用"，上面那条 < 就会红；写成"全都不算"，
     第一条 > 0 就会红 —— 这两条一起把"空"和"全"都堵住了 */
  ok(常用.length !== all.length && 常用.length !== 0, '常用既不是空集也不是全集');

  /* 完全不认识的名字 → 退回头一段，不许给一张空面板 */
  const 怪 = [
    { name: 'ZZZ_A', section: 'S1', kind: 'float', value: '1', enabled: true, line: 0 },
    { name: 'ZZZ_B', section: 'S2', kind: 'float', value: '1', enabled: true, line: 1 }
  ];
  const 退 = ops.常用参数(怪);
  ok(退.length > 0, '一条都不命中时退回一个非空集合', `${退.length} 个`);
  ok(退.every((p) => p.section === 'S1'), '退回的是头一段');
  eq(ops.常用参数([]).length, 0, '空输入给空输出，不炸');
}

/* ---------------- 单行贴图写法（2026-09-23 修的那条，真模板里有 72 处） ---------------- */

{
  /* 真模板里最常见的两种写法并排：两行（`\` 续行）和单行 */
  const 文本 = [
    '#define TWO_LINE_TEXTURE \\',
    '    "two_line.png"    // 两行写法',
    '#define ONE_LINE_TEXTURE "one_line.png"   // 单行写法',
    '#define AFTER_IT 42',
    ''
  ].join('\r\n');
  const parsed = ops.parseFx(文本);
  const 两行 = parsed.params.find((p) => p.name === 'TWO_LINE_TEXTURE');
  const 单行 = parsed.params.find((p) => p.name === 'ONE_LINE_TEXTURE');

  ok(两行?.kind === 'texture', '两行写法仍认成贴图', String(两行?.kind));
  ok(单行?.kind === 'texture', '单行写法也认成贴图（原来会变成 int → 界面是空数字框）', String(单行?.kind));
  eq(单行?.value, 'one_line.png', '单行贴图的值是路径本身（引号剥掉）');
  eq(单行?.span, 1, '单行贴图占 1 行');
  eq(单行?.comment, '单行写法', '单行贴图的行尾注释留着');

  /* **关键回归**：改单行贴图的值，只能动它那一行 —— 早先按两行写回会把下一行覆盖掉 */
  const 改 = parsed.params.map((p) => (p.name === 'ONE_LINE_TEXTURE' ? { ...p, value: '新路径.png' } : p));
  const 出 = ops.writeFx(parsed, 改);
  const 行 = 出.split(/\r?\n/);
  eq(行.length, 5, '改完之后行数没变（没有多写/少写行）');
  ok(行[2].includes('"新路径.png"'), '第 3 行是改过的单行贴图', 行[2]);
  ok(行[3] === '#define AFTER_IT 42', '**下一行没被覆盖**', 行[3]);
  ok(行[1].includes('two_line.png'), '两行写法那一处没被碰（值没变就整行跳过）', 行[1]);

  /* 注释掉的单行贴图：enabled=false 要认出来 */
  const 注释版 = ops.parseFx('// #define HIDDEN_TEX "x.png"\r\n');
  const 隐藏 = 注释版.params.find((p) => p.name === 'HIDDEN_TEX');
  ok(隐藏 ? 隐藏.enabled === false : false, '被注释掉的单行贴图认成 enabled=false', JSON.stringify(隐藏?.enabled));
}

/* ---------------- 「没填上的」要能被界面按名字筛（缺的那批名字） ---------------- */

{
  const 文本 = ['#define LIGHTMAP_TEXTURE \\', '    "body_LM.png"', '#define OTHER 1'].join('\r\n');
  const parsed = ops.parseFx(文本 + '\r\n');
  const filled = ops.autofill(parsed.params, {
    domain: 'body',
    textures: [], /* 一张都不给 → 规则全部落进 missing */
    materials: [],
    lightmapPath: undefined
  });
  ok(filled.missing.length > 0, '确实有没填上的', `${filled.missing.length} 条`);
  ok(
    filled.missing.every((s) => typeof s === 'string' && s.length > 0),
    'missing 是给人看的整句（没变）'
  );
  ok(
    filled.missingNames.length > 0 && filled.missingNames.every((n) => /^[A-Za-z_]\w*$/.test(n)),
    'missingNames 里是**参数名**（界面按它筛参数表，拿整句比是恒假的）',
    filled.missingNames.join(',')
  );
  ok(
    filled.missingNames.includes('LIGHTMAP_TEXTURE'),
    '没找到 lightmap 的那个参数名在里面'
  );
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
