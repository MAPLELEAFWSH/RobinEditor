/**
 * 输出路径拼法的自检。
 *
 * 错一个字符的后果是"几百个文件名不对但是界面显示成功"，所以这里盯得细一点：
 * 占位符替换、相对目录保不保留、模板里自带 {rel} 时会不会多拼一层。
 *
 * 跑：node --import ./tmp/register-loader.mjs tmp/outpath.test.mjs
 */
import {
  applyTemplate,
  baseName,
  isAbsolutePath,
  joinOut,
  outPathFor,
  siblingPath,
  TEMPLATE_KEYS
} from '../src/lib/outpath.ts';

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

/* ============================================================ */

section('占位符');

{
  const p = { name: 'model.fx', rel: 'Materials\\toon' };
  eq(applyTemplate('{name}_fixed.{ext}', p), 'model_fixed.fx', 'name + ext');
  eq(applyTemplate('{name}.{ext}', p), 'model.fx', '原样还原');
  eq(applyTemplate('{rel}\\{name}.{ext}', p), 'Materials\\toon\\model.fx', '带上相对目录');
  eq(applyTemplate('{dir}_{name}.{ext}', p), 'toon_model.fx', '只取相对目录的末段');
  eq(applyTemplate('fixed_{name}.{ext}', p), 'fixed_model.fx', '前缀');
}

{
  // 打错了应该看得见，不能悄悄删掉
  const p = { name: 'a.fx', rel: '' };
  eq(applyTemplate('{nome}.{ext}', p), '{nome}.fx', '不认识的占位符原样留着');
  eq(applyTemplate('{name}.{ext}.bak', p), 'a.fx.bak', '普通文本里的点不会被吃');
}

{
  // 没有后缀的文件
  const p = { name: 'README', rel: '' };
  eq(applyTemplate('{name}{ext}', p), 'README', '没后缀时 ext 是空串');
  eq(applyTemplate('{name}.bak', p), 'README.bak', '没后缀也能加后缀');
}

{
  // 点开头的是隐藏文件，不该被当成"后缀在位置 0"
  const p = { name: '.gitignore', rel: '' };
  eq(applyTemplate('{name}{ext}', p), '.gitignore', '点开头的整个当名字');
}

{
  const p = { name: 'a.fxsub', rel: '' };
  eq(applyTemplate('{name}.bak', p), 'a.bak', '多重后缀按最后一个点切');
  eq(applyTemplate('{ext}', p), 'fxsub', 'ext 是最后一段');
}

section('相对目录');

{
  eq(leafDirOf('Materials\\toon'), 'toon', '反斜杠');
  eq(leafDirOf('Materials/toon'), 'toon', '正斜杠');
  eq(leafDirOf('Materials\\toon\\'), 'toon', '去掉尾部分隔符');
  eq(leafDirOf('Materials'), 'Materials', '只有一层');
  eq(leafDirOf(''), '', '空串');
}
function leafDirOf(rel) {
  return applyTemplate('{dir}', { name: 'x', rel });
}

section('拼目录');

{
  eq(joinOut('D:\\out', 'a.png'), 'D:\\out\\a.png', '反斜杠目录用反斜杠');
  eq(joinOut('D:/out', 'a.png'), 'D:/out/a.png', '正斜杠目录用正斜杠');
  eq(joinOut('D:\\out\\', 'a.png'), 'D:\\out\\a.png', '目录尾部有分隔符也不重复');
  eq(joinOut('D:\\out', '\\a.png'), 'D:\\out\\a.png', '文件名开头的分隔符去掉');
  eq(joinOut('D:\\out', 'Materials\\toon\\a.png'), 'D:\\out\\Materials\\toon\\a.png', '带子目录');
}

section('绝对路径识别');

{
  ok(isAbsolutePath('D:\\a'), 'D:\\a');
  ok(isAbsolutePath('d:/a'), '小写盘符');
  ok(isAbsolutePath('\\\\server\\share'), 'UNC');
  ok(!isAbsolutePath('Materials\\toon'), '相对子目录不是绝对路径');
  ok(!isAbsolutePath('a.png'), '光文件名不是绝对路径');
}

section('outputDir 为空 = 原地改');

{
  eq(outPathFor('', { name: 'a.fx', rel: 'x' }, '{name}_fixed.{ext}', true), '', '不给目录就返回空串');
}

section('保留相对目录');

{
  const parts = { name: 'a.fx', rel: 'Materials\\toon' };
  eq(
    outPathFor('D:\\out', parts, '{name}_fixed.{ext}', true),
    'D:\\out\\Materials\\toon\\a_fixed.fx',
    '默认保留子目录结构'
  );
  eq(
    outPathFor('D:\\out', parts, '{name}_fixed.{ext}', false),
    'D:\\out\\a_fixed.fx',
    '关掉就平铺到根下'
  );
  eq(
    outPathFor('D:\\out', { name: 'a.fx', rel: '' }, '{name}.{ext}', true),
    'D:\\out\\a.fx',
    '没有子目录时不多拼一层'
  );
}

section('模板里自带 rel 就别再拼一层');

{
  const parts = { name: 'a.fx', rel: 'Materials\\toon' };
  eq(
    outPathFor('D:\\out', parts, '{rel}\\{name}.{ext}', true),
    'D:\\out\\Materials\\toon\\a.fx',
    '用了 {rel} 不再套一层'
  );
  eq(
    outPathFor('D:\\out', parts, '{dir}_{name}.{ext}', true),
    'D:\\out\\toon_a.fx',
    '用了 {dir} 也不再套一层'
  );
}

section('占位符清单跟实现一致');

{
  // TEMPLATE_KEYS 是给界面出提示用的，跟实现对不上会误导用户
  const p = { name: 'a.fx', rel: 'Materials' };
  for (const k of TEMPLATE_KEYS) {
    const out = applyTemplate(`{${k}}`, p);
    ok(!out.includes('{'), `{${k}} 是被认得的占位符`, `实得 ${out}`);
  }
}

section('同目录同名文件会被撞上的情况');

{
  // 平铺 + 两个不同子目录里的同名文件 → 会撞。这不是 bug，
  // 但工具得让用户预先看见，所以这里把结论钉住：模板必须带 {rel} 或 {dir} 才不撞。
  const a = { name: 'a.fx', rel: 'Materials\\x' };
  const b = { name: 'a.fx', rel: 'Materials\\y' };
  eq(
    outPathFor('D:\\out', a, '{name}.{ext}', false),
    outPathFor('D:\\out', b, '{name}.{ext}', false),
    '平铺时两个同名文件确实会撞到同一个路径'
  );
  ok(
    outPathFor('D:\\out', a, '{dir}_{name}.{ext}', false) !==
      outPathFor('D:\\out', b, '{dir}_{name}.{ext}', false),
    '用 {dir} 就分开了'
  );
}

/* ---- baseName / siblingPath：原来五处各写各的，现在一份 ---- */

section('baseName / siblingPath');

{
  eq(baseName('E:\\a\\b\\x.png'), 'x.png', 'baseName 反斜杠');
  eq(baseName('/a/b/x.png'), 'x.png', 'baseName 正斜杠');
  eq(baseName('x.png'), 'x.png', 'baseName 单段');
  eq(baseName('E:\\a\\b\\'), 'b', 'baseName 末尾带分隔符');

  eq(siblingPath('E:\\a\\b\\x.png', '_ILM'), 'E:\\a\\b\\x_ILM.png', '同级同目录加后缀');
  eq(siblingPath('M\\x.png', '_ILM'), 'M\\x_ILM.png', '相对路径保留原分隔符');
  /* 这一条是 `pipeline.ts` 当年踩的坑：单段相对目录 + 正斜杠分隔符 */
  eq(siblingPath('M/x.png', '_ILM'), 'M/x_ILM.png', '单段目录用正斜杠时不改成反斜杠');
  eq(siblingPath('x.png', '_ILM'), 'x_ILM.png', '没有目录就不拼');
  eq(siblingPath('E:\\a\\x.tga', '_ILM', 'png'), 'E:\\a\\x_ILM.png', '扩展名跟着参数换');
  eq(siblingPath('E:\\a\\x', '_ILM'), 'E:\\a\\x_ILM.png', '原文件名没有扩展名也能拼');
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
