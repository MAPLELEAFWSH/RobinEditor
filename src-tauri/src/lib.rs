//! RobinEditor 后端。
//!
//! 分工：像素运算全在前端（canvas 现成，还能实时预览），
//! 后端只干前端干不了或干不好的几件事 ——
//!   · 解 TGA / DDS 这类 canvas 不认的贴图格式（fsops）
//!   · 按原路径写盘并留备份（fsops）
//!   · GBK / Shift-JIS 编码转换（textenc，TextEncoder 只支持 UTF-8）
//!   · PMX 二进制解析（pmx）
//!   · 外接翻译引擎那个 POST（translate，自己写就不必引 http 插件）

mod fsops;
mod pmx;
mod textenc;
mod translate;
mod project;
/// ⑥ 的「根替换」：死根发现 + 全段换根（见文件头注释里为什么单开一条路）
mod migrate_root;
/// ⑥ 真实迁移的量具（只测，不进默认套件）
#[cfg(test)]
mod migrate_probe;
/// ① 乱码修复的过目用量具（拿真素材跑三种功能，产物落单独目录）
#[cfg(test)]
mod review_probe;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            /* ---------- 任务栏图标 ----------
             * Tauri v2 的窗口配置里**没有 icon 字段**：窗口图标是 codegen 从 bundle.icon
             * 里挑最大的那张 PNG 嵌进去的（实测 exe 里嵌的是 `128x128@2x.png`，256² 整张插画）。
             * 用户的屏幕是 150% 缩放，任务栏那一格要 36px —— 让 Windows 把一张细节很密的
             * 256² 插画一步缩到 36，出来就是糊的，这就是"图标过于模糊"的来源。
             *
             * 这里显式换成一张**专门给任务栏做的小图**（48²，放大取人物主体 + Lanczos 重采样）：
             * 标题栏 24、任务栏 36、Alt-Tab 48 三个尺寸全落在降采样那一边。
             * 图由 `tools/make-app-icon.mjs` 生成，别手改。
             */
            use tauri::Manager;
            if let Some(win) = app.get_webview_window("main") {
                /* 裸 RGBA（48²×4 = 9216 字节），由 tools/make-app-icon.mjs 生成。
                   不用 `Image::from_bytes`：那个要开 `image-png` feature，
                   等于为了 48×48 的小图往包里塞一个 PNG 解码器。 */
                const TASKBAR_RGBA: &[u8] = include_bytes!("../icons/icon-taskbar.rgba");
                let icon = tauri::image::Image::new_owned(TASKBAR_RGBA.to_vec(), 48, 48);
                if let Err(e) = win.set_icon(icon) {
                    eprintln!("[icon] 设任务栏图标失败：{e}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 文件与图片
            fsops::scan_dir,
            // 递归扫描的「取消」与「进度」（范围太大时界面要能看见、也能停下它）
            fsops::取消扫描,
            fsops::查进度,
            fsops::read_image,
            fsops::read_rgba,
            fsops::read_bytes,
            fsops::write_bytes,
            fsops::write_rgba_image,
            fsops::file_exists,
            fsops::probe_dir,
            fsops::find_file,
            fsops::list_subdirs,
            // 文本与编码
            textenc::detect_text,
            textenc::repair_text,
            textenc::read_text_file,
            textenc::read_text_fixed,
            textenc::fix_text_file,
            textenc::scan_text_files,
            textenc::scan_pieces,
            textenc::apply_pieces,
            // 够不着门槛时由用户点「就用这个」
            textenc::repair_text_forced,
            // 名字还原
            textenc::scan_names,
            textenc::rename_entries,
            textenc::undo_renames,
            // 外接翻译引擎
            translate::translate_text,
            // PMX
            pmx::read_pmx,
            pmx::read_pmx_materials,
            // ⑥ 工程迁移（A 搬家改路径 / B 摘掉丢失的条目）
            // 平铺老路 `project::打包` 已删：平铺会打断模型旁边的贴图引用（实测 119/119 靠相对结构），
            // 自包含走 `migrate_root::搬根自带`。
            project::扫,
            project::搬家,
            project::摘丢失,
            // ⑥ 根替换（实测出来的正解：死根 → 新根，保相对结构、所有段都换）
            migrate_root::找根,
            migrate_root::列路径,
            migrate_root::检索,
            migrate_root::搬根,
            // 自包含：素材一并拷进输出目录（原来这条没注册，界面上够不着）
            migrate_root::搬根自带,
            // 搬运：真的把文件搬/拷到（可以多个）指定位置，再改路径保存
            migrate_root::搬运工程,
            // 撤销：上一次处理的反操作（先出表、预检、回读核对）
            migrate_root::待撤销,
            migrate_root::撤销工程,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
