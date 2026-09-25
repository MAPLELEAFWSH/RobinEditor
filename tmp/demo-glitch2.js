(async () => {
  const inv = window.__TAURI_INTERNALS__.invoke;
  const OUT = 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例_效果\\①乱码修复';
  const out = {};

  // 重跑一遍整文件修（修好后的目录先清掉）
  const files = await inv('scan_dir', { root: OUT, exts: ['txt', 'fx'], recursive: false });
  out.扫到 = files.length;

  const rows = [];
  let changedCount = 0;
  let wroteCount = 0;
  let sameCount = 0;
  for (const f of files) {
    const r = await inv('fix_text_file', {
      path: f.path,
      write: true,
      mode: 'whole',
      encoding: null,
      outPath: OUT + '\\修好后\\' + f.name
    });
    if (r.changed) changedCount++;
    else sameCount++;
    if (r.written) wroteCount++;
    rows.push({ 文件: f.name, 编码: r.encoding, 改了: r.changed, 方式: r.via, 前: (r.before_sample || '').slice(0, 44), 后: (r.after_sample || '').slice(0, 44) });
  }
  out.统计 = { 扫到: files.length, 真改了: changedCount, 原样保留: sameCount, 写盘: wroteCount };
  out.明细 = rows.filter((r) => r.改了);
  out.没改的样例 = rows.filter((r) => !r.改了).slice(0, 4).map((r) => `${r.文件}：${r.前.slice(0, 40)}`);

  // 单独验那行：
  const bad = await inv('fix_text_file', {
    path: OUT + '\\AbsoluteShadowShaderSystem.fx',
    write: false,
    mode: 'whole',
    encoding: null,
    outPath: null
  });
  out.关键那一行 = { 改了: bad.changed, 方式: bad.via, 前: bad.before_sample, 后: bad.after_sample };

  // 再拿几个真乱码名字里的词试试修复
  out.词级修复 = [];
  for (const s of ['僐儞僩儘乕儔乕', '僔僃乕僟乕', '娍揹', '僥僋僗僠儍']) {
    const r = await inv('repair_text', { text: s });
    out.词级修复.push({ 乱码: s, 修后: r.fixed, 改了: r.changed });
  }
  return out;
})();
