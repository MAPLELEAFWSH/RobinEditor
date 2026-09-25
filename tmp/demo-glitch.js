(async () => {
  const inv = window.__TAURI_INTERNALS__.invoke;
  const OUT = 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例_效果\\①乱码修复';
  const out = {};

  // ---------- A. 文件名本身就是乱码：把名字也修回来 ----------
  const src = 'E:\\deepseek-harness\\mmd集成工具\\实战测试用例\\乱码翻译';
  const all = await inv('scan_dir', { root: src, exts: ['txt', 'csv'], recursive: false });
  out.文件名的修复 = [];
  for (const f of all.slice(0, 8)) {
    // 文件名按 GBK 读出来就是乱码，按 GBK 编回去再按 Shift-JIS 解就还原
    const bytes = new Uint8Array(f.name.length);
    // 用 Rust 的 repair_text 处理整个名字
    const r = await inv('repair_text', { text: f.name.replace(/\.[^.]+$/, '') });
    out.文件名的修复.push({ 原名: f.name, 修后: r.fixed + f.name.slice(f.name.lastIndexOf('.')), 改了: r.changed });
  }

  // ---------- B. 文件内容：整文件修，另存到效果目录 ----------
  const files = await inv('scan_dir', { root: OUT, exts: ['txt', 'fx'], recursive: false });
  out.内容的修复 = [];
  let wrote = 0;
  for (const f of files.slice(0, 14)) {
    const r = await inv('fix_text_file', {
      path: f.path,
      write: true,
      mode: 'whole',
      encoding: null,
      outPath: OUT + '\\修好后\\' + f.name
    });
    wrote += r.written ? 1 : 0;
    out.内容的修复.push({
      文件: f.name,
      编码: r.encoding,
      改了: r.changed,
      方式: r.via,
      写盘: r.written,
      备份: r.backup ? '有' : '无',
      前: (r.before_sample || '').slice(0, 46),
      后: (r.after_sample || '').slice(0, 46),
      错: r.error
    });
  }
  out.写出张数 = wrote;

  // ---------- C. 只改注释的模式（.fx 是拿来编译的，注释以外不许碰）----------
  const fx = await inv('scan_dir', { root: OUT + '\\修好后', exts: ['fx'], recursive: false });
  out.只改注释 = [];
  for (const f of fx.slice(0, 6)) {
    const r = await inv('fix_text_file', {
      path: f.path,
      write: true,
      mode: 'fx-comments',
      encoding: null,
      outPath: OUT + '\\只改注释\\' + f.name
    });
    out.只改注释.push({ 文件: f.name, 改了: r.changed, 方式: r.via, 写盘: r.written, 错: r.error });
  }

  return out;
})();
