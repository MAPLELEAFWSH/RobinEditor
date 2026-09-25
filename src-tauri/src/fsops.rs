//! 文件与图片读写。
//!
//! 为什么这些不放前端：
//!   · TGA / DDS 这类 MMD 贴图 canvas 解不了，必须后端解完转成 PNG 递过去
//!   · 写盘要覆盖前留备份，前端拿着 File 对象做不到"改回原路径"
//!   · 批量跑目录的时候不想把几百张图都塞进 WebView 内存

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::Serialize;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use walkdir::WalkDir;

/* ==================================================================
   递归扫描的**上限**（2026-09-23，用户实测"选到 D:\ 就卡死"）。

   以前 `scan_dir` 是 `WalkDir::new(root)` 一路走到黑，而且是**同步命令** ——
   Tauri 里不带 async 的命令在**主线程**上跑，扫盘根的那几十万次 read_dir
   全压在渲染线程上，界面就是这么冻住的。

   三条线一起兜：**层数 / 条目 / 时间**。超限**明说"范围太大，请给更具体的起点"**，
   不返回半张表（半张表会被当成"这个目录里就这些"，那是骗人）。
   盘根与 Windows 那几个大类目录**连扫都不扫**，选了立刻给反应。
   ================================================================== */

/// 「范围太大」这四个字是硬约定：界面按它认这条错误，用户按它知道该怎么做。
pub const 范围太大: &str = "范围太大，请给更具体的起点";

/// 递归扫描的上限。界面不传就用 `默认扫描上限`。
#[derive(Clone, Copy, serde::Deserialize, Debug, PartialEq, Eq)]
#[serde(default)]
pub struct 扫描上限 {
    /// 最多下钻几层（根这一层算 1）
    pub 层数: usize,
    /// 最多看几个文件（不是"收下几个"—— 收不收是筛法的事）
    pub 条目: usize,
    /// 最多跑多少毫秒
    pub 毫秒: u64,
}

impl Default for 扫描上限 {
    fn default() -> Self {
        默认扫描上限
    }
}

/// 默认那套：一般 MMD 素材树远够不到这些线（实测最深 8 层、单个目录几千个文件）。
pub const 默认扫描上限: 扫描上限 = 扫描上限 {
    层数: 16,
    条目: 200_000,
    毫秒: 8000,
};

/// 检索用的那套：起点可能有好几个，单个起点给紧一点。
pub const 检索扫描上限: 扫描上限 = 扫描上限 {
    层数: 12,
    条目: 120_000,
    毫秒: 5000,
};

/// 全局取消位。界面点「取消」就置上，正在走的那个遍历下一次检查就退出。
static 扫描取消: AtomicBool = AtomicBool::new(false);

pub fn 设扫描取消(开: bool) {
    扫描取消.store(开, Ordering::Relaxed);
}

pub fn 扫描被取消() -> bool {
    扫描取消.load(Ordering::Relaxed)
}

/// 界面点「取消扫描」走这条
#[tauri::command]
pub fn 取消扫描() {
    设扫描取消(true);
}

/// 正在跑的那一趟的进度（已看, 毫秒, 在哪个起点）。
///
/// 用**全局 + 轮询**而不是事件通道：界面每 300ms 问一次 `查进度`，
/// 不带 async 语义、不依赖 webview 的事件系统，假后端里也不会炸。
static 进度: std::sync::Mutex<(usize, u64, String)> =
    std::sync::Mutex::new((0, 0, String::new()));

/// 报给界面的进度
#[derive(Clone, serde::Serialize)]
pub struct 扫描进度 {
    /// 已经看过几个文件
    pub 已看: usize,
    /// 已经跑了多少毫秒
    pub 毫秒: u64,
    /// 现在在哪个起点（检索有多个起点）
    pub 在哪: String,
    /// 还在不在跑（跑完了界面就不必再轮询）
    pub 在跑: bool,
}

fn 报进度(已看: usize, 毫秒: u64, 在哪: &str) {
    if let Ok(mut p) = 进度.lock() {
        p.0 = 已看;
        p.1 = 毫秒;
        p.2 = 在哪.to_string();
    }
}

/// 界面每 300ms 问一次「跑到哪儿了」
#[tauri::command]
pub fn 查进度() -> 扫描进度 {
    match 进度.lock() {
        Ok(p) => 扫描进度 {
            已看: p.0,
            毫秒: p.1,
            在哪: p.2.clone(),
            在跑: true,
        },
        Err(_) => 扫描进度 {
            已看: 0,
            毫秒: 0,
            在哪: String::new(),
            在跑: false,
        },
    }
}

/// 盘根（`D:\`）与 Windows 那几个大类目录：**不值得递归扫**。
/// 返回"为什么太大"，`None` = 可以扫。
pub fn 大类目录(根: &Path) -> Option<String> {
    let 名 = 根
        .file_name()
        .map(|s| s.to_string_lossy().to_ascii_lowercase());
    /* 盘根：没有文件名那一段、但有根 */
    if 名.is_none() && 根.has_root() {
        return Some(format!(
            "{} 是**整个盘** —— 递归扫它要把盘里每一个目录都走一遍（几十万个文件起步）",
            根.display()
        ));
    }
    /* 一层大类：`C:\Windows` 这种，父目录就是盘根 */
    let 浅 = 根.parent().map(|p| p.parent().is_none()).unwrap_or(false);
    if 浅 {
        if let Some(n) = 名 {
            for 大 in [
                "windows",
                "program files",
                "program files (x86)",
                "programdata",
                "users",
                "$recycle.bin",
                "system volume information",
            ] {
                if n == 大 {
                    return Some(format!("{} 是系统大类目录", 根.display()));
                }
            }
        }
    }
    None
}

fn 超限说(根: &Path, 哪条: &str, 上: &str) -> String {
    format!(
        "{范围太大}：{} 这一趟在「{哪条}」上超了（{上}）—— 已经停下，界面没冻住，盘上一个字节都没动。\
         换成更靠里的一个目录，或者把起点分成几个分别加。",
        根.display()
    )
}

/**
 * 一次**有界**的目录遍历。层数 / 条目 / 时间三条线一起兜，还能被取消。
 *
 * · `收`：每个文件调一次；
 * · 进度写进全局那份（界面轮询 `查进度` 拿）；
 * · 超限或被取消一律 `Err(…)`。
 */
pub fn 有界遍历<F>(
    根: &Path,
    上限: 扫描上限,
    递归: bool,
    mut 收: F,
) -> Result<usize, String>
where
    F: FnMut(&walkdir::DirEntry),
{
    if let Some(说) = 大类目录(根) {
        return Err(format!(
            "{范围太大}：{说}。换成更靠里的一个目录，或者把起点分成几个分别加。"
        ));
    }
    let 起 = Instant::now();
    if 上限.毫秒 == 0 {
        return Err(超限说(根, "时间", "上限 0 毫秒"));
    }
    let 深上限 = if 递归 { 上限.层数 } else { 1 };
    /* 多要一层：**只有真的还有更深的东西**才叫"层数超了" */
    let walker = WalkDir::new(根).max_depth(if 递归 { 上限.层数 + 1 } else { 1 });
    报进度(0, 0, &根.to_string_lossy());
    let mut 已看 = 0usize;
    let mut 上次报 = 0usize;
    for entry in walker.into_iter() {
        let Ok(entry) = entry else { continue };
        if entry.depth() > 深上限 {
            return Err(超限说(根, "层数", &format!("上限 {} 层", 上限.层数)));
        }
        if !entry.file_type().is_file() {
            continue;
        }
        已看 += 1;
        if 已看 > 上限.条目 {
            return Err(超限说(根, "条目数", &format!("上限 {} 个文件", 上限.条目)));
        }
        /* 取消 / 超时 / 报进度**每 256 个查一次**：每个文件都读一次钟，扫小目录时反而更慢 */
        if 已看 % 256 == 0 {
            if 扫描被取消() {
                return Err(format!(
                    "扫描已取消（{} 里看过 {已看} 个文件）—— 盘上没动任何东西。",
                    根.display()
                ));
            }
            if 起.elapsed().as_millis() as u64 >= 上限.毫秒 {
                return Err(超限说(根, "时间", &format!("上限 {} 毫秒", 上限.毫秒)));
            }
        }
        if 已看 >= 上次报 + 512 {
            上次报 = 已看;
            报进度(已看, 起.elapsed().as_millis() as u64, &根.to_string_lossy());
        }
        收(&entry);
    }
    报进度(已看, 起.elapsed().as_millis() as u64, &根.to_string_lossy());
    Ok(已看)
}

#[derive(Serialize, Debug)]
pub struct FileEntry {
    pub path: String,
    pub rel: String,
    pub name: String,
    pub ext: String,
    pub size: u64,
}

#[derive(Serialize)]
pub struct ImagePayload {
    pub path: String,
    pub width: u32,
    pub height: u32,
    /// PNG 的 base64（不带 data: 前缀）。统一转 PNG 是因为 WebView 认这个。
    pub png: String,
    /// 原文件格式，出报告用
    pub src_format: String,
    pub src_bytes: u64,
}

#[derive(Serialize)]
pub struct WriteReport {
    pub path: String,
    pub bytes_written: u64,
    /// 覆盖时留下的备份路径，没覆盖就是 None
    pub backup: Option<String>,
}

/// 原始 RGBA。要按像素算的东西走这条，别走 PNG + 画布那条（见 `read_rgba` 的注释）。
#[derive(Serialize)]
pub struct RgbaPayload {
    pub path: String,
    pub width: u32,
    pub height: u32,
    /// 未预乘的 RGBA 字节，base64。长度 = width * height * 4
    pub rgba: String,
    pub src_format: String,
    pub src_bytes: u64,
}

fn ext_of(p: &Path) -> String {
    p.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

/// 递归扫目录。exts 为空就全要。
///
/// **有上限、且在别的线程上跑**（见文件头那段）：`async` 那一下是硬要求 ——
/// 不带它的命令在 Tauri 里走主线程，扫一大片时界面就是冻的。
#[tauri::command(async)]
pub fn scan_dir(
    root: String,
    exts: Option<Vec<String>>,
    recursive: Option<bool>,
    上限: Option<扫描上限>,
) -> Result<Vec<FileEntry>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("不是一个目录：{root}"));
    }
    let want: Vec<String> = exts
        .unwrap_or_default()
        .into_iter()
        .map(|e| e.trim_start_matches('.').to_ascii_lowercase())
        .filter(|e| !e.is_empty())
        .collect();
    let 递归 = recursive.unwrap_or(true);
    let 上限 = 上限.unwrap_or(默认扫描上限);

    let mut out = Vec::new();
    设扫描取消(false);
    有界遍历(&root_path, 上限, 递归, |entry| {
        let p = entry.path();
        let ext = ext_of(p);
        if !want.is_empty() && !want.iter().any(|w| *w == ext) {
            return;
        }
        let meta = entry.metadata().ok();
        let rel = p
            .strip_prefix(&root_path)
            .unwrap_or(p)
            .to_string_lossy()
            .replace('\\', "/");
        out.push(FileEntry {
            path: p.to_string_lossy().to_string(),
            rel,
            name: p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            ext,
            size: meta.map(|m| m.len()).unwrap_or(0),
        });
    })?;
    // 路径排序，跑批的时候顺序稳定，方便对着日志找
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    Ok(out)
}

/// 解一张图。先按**文件头**猜格式，猜不出来再按**后缀**认。
///
/// 为什么要补这一步：`image::load_from_memory` 靠 magic bytes 认格式，
/// 而 **TGA 头里没有 magic bytes** —— 它只有 image_type 和色深，前几个字节
/// 跟任何格式都对不上，所以 `guess_format` 永远认不出 TGA。
///
/// 后果是这个功能一直是死的：Cargo.toml 里早就开了 `tga` 特性、注释也写着
/// "TGA 是 MMD 贴图里的常客，浏览器 canvas 解不了，得在这儿解"，
/// 但读的时候直接报"解不了这个格式"，`.tga` 一张也读不进来。
/// 实测 `实战测试用例` 里的 `颜赤.tga`、`BRDF.tga` 全是这个错。
///
/// 按后缀认这一步是安全的：文件是用户自己选的，后缀就是他给的意图；
/// 真解错了 `decode()` 会报错，不会静默出一张垃圾图。
fn decode_image(bytes: &[u8], path: &Path) -> Result<image::DynamicImage, String> {
    if let Ok(img) = image::load_from_memory(bytes) {
        return Ok(img);
    }
    let ext = ext_of(path);
    let fmt = match ext.as_str() {
        "tga" => image::ImageFormat::Tga,
        "dds" => image::ImageFormat::Dds,
        "bmp" => image::ImageFormat::Bmp,
        "png" => image::ImageFormat::Png,
        "jpg" | "jpeg" => image::ImageFormat::Jpeg,
        "gif" => image::ImageFormat::Gif,
        "tif" | "tiff" => image::ImageFormat::Tiff,
        "webp" => image::ImageFormat::WebP,
        "ico" => image::ImageFormat::Ico,
        _ => {
            return Err(format!(
                "解不了这个格式：文件头认不出，后缀 .{ext} 也不是认识的贴图格式"
            ))
        }
    };
    image::ImageReader::with_format(Cursor::new(bytes), fmt)
        .decode()
        .map_err(|e| format!("按 .{ext} 解不开：{e}"))
}

/// 读一张图，统一转成 PNG 交给前端。
#[tauri::command]
pub fn read_image(path: String) -> Result<ImagePayload, String> {
    let bytes = fs::read(&path).map_err(|e| format!("读不了 {path}：{e}"))?;
    let src_bytes = bytes.len() as u64;
    let img = decode_image(&bytes, Path::new(&path))?;
    let rgba = img.to_rgba8();
    let (width, height) = (rgba.width(), rgba.height());
    let mut png = Vec::new();
    image::DynamicImage::ImageRgba8(rgba)
        .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|e| format!("转 PNG 失败：{e}"))?;
    let src_format = image::guess_format(&bytes)
        .map(|f| format!("{f:?}").to_ascii_lowercase())
        .unwrap_or_else(|_| ext_of(Path::new(&path)));
    Ok(ImagePayload {
        path,
        width,
        height,
        png: B64.encode(&png),
        src_format,
        src_bytes,
    })
}

/// 读任意文件成 base64（贴图之外的二进制，比如 .fx 里嵌的东西、备份用）
#[tauri::command]
pub fn read_bytes(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("读不了 {path}：{e}"))?;
    Ok(B64.encode(&bytes))
}

/// 读一张图的**原始 RGBA 字节**，不给前端 PNG、也不走画布。
///
/// 为什么要单开一条：`read_image` 是给"看一眼"用的（转成 PNG 塞进 `<img>`），
/// 那条路前端要经过 `createImageBitmap` → canvas → `getImageData`。而浏览器的
/// 画布是**预乘 alpha**存储的，读回来要反预乘 —— alpha 越小精度越差，
/// alpha=0 的像素 RGB 直接变成 0。
///
/// 实测（`实战测试用例` 里的 `sample_hair_normal.png`）：PIL 读出来 R 路 75 个不同取值，
/// 走画布读出来是 197 个 —— 多出来的全是反预乘炸开的噪声。法线图正好是最多带半透明的那种，
/// 所以"从某一路提数据"这类操作必须拿到没被动过的字节，不然提出来的是错的。
#[tauri::command]
pub fn read_rgba(path: String) -> Result<RgbaPayload, String> {
    let bytes = fs::read(&path).map_err(|e| format!("读不了 {path}：{e}"))?;
    let src_bytes = bytes.len() as u64;
    let img = decode_image(&bytes, Path::new(&path))?;
    let rgba = img.to_rgba8();
    let src_format = image::guess_format(&bytes)
        .map(|f| format!("{f:?}").to_ascii_lowercase())
        .unwrap_or_else(|_| ext_of(Path::new(&path)));
    Ok(RgbaPayload {
        path,
        width: rgba.width(),
        height: rgba.height(),
        rgba: B64.encode(rgba.as_raw()),
        src_format,
        src_bytes,
    })
}

/// 原子写：先写同目录的临时文件，落稳了再改名盖上去。
///
/// 为什么必须这么做：`fs::write` 是"打开就截断、然后一段段写"。写到一半
/// 断电 / 进程被杀 / 磁盘满，**原文件已经被截成 0 了**，新的又没写完 ——
/// 用户手里那份工程就没了，而且没有任何地方报错。
///
/// 两个参考工程都是这个做法：
/// - `MikuMikuEffect-NodeEditor` 的 `AutoSaveFxSettingsStore.WriteAllTextAtomic`
/// - StarRail 那个编辑器的 GUIDE 里写着"保存采用同目录临时文件替换"
///
/// 三个细节：
/// - **临时文件放同一个目录**：跨卷的 rename 不是原子的（Windows 上会失败），
///   图省事丢到 temp 目录反而会把原子性弄没。
/// - **写完之后 sync_all**：只 rename 不落盘的话，机器一断电剩下的还是旧内容 ——
///   那时候原子性只保证了"要么旧要么新"，但"新"可能根本没到盘上。
/// - **失败就把临时文件删掉**：不然目录里会攒一堆 `.tmp-xxxx`。
fn atomic_write(p: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = p.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    // 名字带上进程号 + 时间戳：两个实例同时写同一个文件时不会互相踩临时文件
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = dir.join(format!(".{name}.tmp-{}-{stamp}", std::process::id()));

    let write_result = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        use std::io::Write;
        f.write_all(bytes)?;
        f.sync_all()?;
        Ok(())
    })();

    if let Err(e) = write_result {
        let _ = fs::remove_file(&tmp);
        return Err(format!("写临时文件失败：{e}"));
    }

    if let Err(e) = fs::rename(&tmp, p) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("替换目标文件失败：{e}"));
    }
    Ok(())
}

/// 写 base64 字节。覆盖前自动留 .bak，写到盘上是原子替换。
#[tauri::command]
pub fn write_bytes(path: String, b64: String, backup: Option<bool>) -> Result<WriteReport, String> {
    let bytes = B64.decode(b64.as_bytes()).map_err(|e| format!("base64 坏了：{e}"))?;
    let p = PathBuf::from(&path);
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("建不了目录：{e}"))?;
    }
    let backup_path = if backup.unwrap_or(true) && p.exists() {
        Some(make_backup(&p)?)
    } else {
        None
    };
    atomic_write(&p, &bytes).map_err(|e| format!("写不了 {path}：{e}"))?;
    Ok(WriteReport {
        path,
        bytes_written: bytes.len() as u64,
        backup: backup_path,
    })
}

/// 写一张 RGBA 图。按目标扩展名选格式，认不出的就写 PNG。
/// rgba_b64 是解码后的原始字节（width*height*4），不是 base64 过的 PNG。
#[tauri::command]
pub fn write_rgba_image(
    path: String,
    width: u32,
    height: u32,
    rgba_b64: String,
    backup: Option<bool>,
) -> Result<WriteReport, String> {
    let raw = B64
        .decode(rgba_b64.as_bytes())
        .map_err(|e| format!("base64 坏了：{e}"))?;
    let expect = (width as usize) * (height as usize) * 4;
    if raw.len() != expect {
        return Err(format!(
            "像素数据对不上：应该是 {expect} 字节，实到 {}",
            raw.len()
        ));
    }
    let buf = image::RgbaImage::from_raw(width, height, raw)
        .ok_or_else(|| "拼不成图".to_string())?;
    let dynimg = image::DynamicImage::ImageRgba8(buf);

    let p = PathBuf::from(&path);
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("建不了目录：{e}"))?;
    }
    let backup_path = if backup.unwrap_or(true) && p.exists() {
        Some(make_backup(&p)?)
    } else {
        None
    };

    // 先编到内存里，再原子替换整个文件。
    // 原来是把 `save_with_format(&p, ...)` 直接写到目标路径上 —— 编码报错或者
    // 写到一半断电，原贴图就已经被截断了。编到内存之后失败是零副作用的：
    // 目标文件一个字节都没动。
    let ext = ext_of(&p);
    let mut out: Vec<u8> = Vec::new();
    let encoded = {
        let mut cur = Cursor::new(&mut out);
        match ext.as_str() {
            "tga" => dynimg.to_rgba8().write_to(&mut cur, image::ImageFormat::Tga),
            "bmp" => dynimg.to_rgb8().write_to(&mut cur, image::ImageFormat::Bmp),
            // JPEG 没有透明通道，合成到黑底上再写，免得 alpha 一丢颜色发灰
            "jpg" | "jpeg" => {
                flatten_on_black(&dynimg.to_rgba8()).write_to(&mut cur, image::ImageFormat::Jpeg)
            }
            _ => dynimg.to_rgba8().write_to(&mut cur, image::ImageFormat::Png),
        }
    };
    encoded.map_err(|e| format!("编 {} 失败：{e}", ext.to_uppercase()))?;

    atomic_write(&p, &out).map_err(|e| format!("写不了 {path}：{e}"))?;

    Ok(WriteReport {
        path,
        bytes_written: out.len() as u64,
        backup: backup_path,
    })
}

fn flatten_on_black(src: &image::RgbaImage) -> image::RgbImage {
    let (w, h) = (src.width(), src.height());
    let mut out = image::RgbImage::new(w, h);
    for (x, y, px) in src.enumerate_pixels() {
        let a = px[3] as u32;
        let mix = |c: u8| ((c as u32 * a) / 255) as u8;
        out.put_pixel(x, y, image::Rgb([mix(px[0]), mix(px[1]), mix(px[2])]));
    }
    out
}

/// 覆盖前留一份 `名字.bak`。已经有一份就不覆盖那份，改成 `.bak2`、`.bak3`……
fn make_backup(p: &Path) -> Result<String, String> {
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    let dir = p.parent().unwrap_or_else(|| Path::new("."));
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (name.clone(), String::new()),
    };
    let mut n = 1;
    loop {
        let suffix = if n == 1 {
            ".bak".to_string()
        } else {
            format!(".bak{n}")
        };
        let cand = dir.join(format!("{stem}{ext}{suffix}"));
        if !cand.exists() {
            fs::copy(p, &cand).map_err(|e| format!("留备份失败：{e}"))?;
            return Ok(cand.to_string_lossy().to_string());
        }
        n += 1;
        if n > 99 {
            return Err("同名备份太多了，先去清一下".into());
        }
    }
}

#[tauri::command]
pub fn file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// 给别的模块用的备份入口（textenc 写文件前也要留一份）
pub fn backup_public(p: &Path) -> Result<String, String> {
    make_backup(p)
}

#[derive(Serialize)]
pub struct DirProbe {
    pub exists: bool,
    pub is_dir: bool,
    pub entries: usize,
    /// 目录里的前 60 个文件名，用来认特征文件
    pub names: Vec<String>,
}

/// 认渲染包路径用：看这个目录在不在、里面有没有那个特征文件。
#[tauri::command]
pub fn probe_dir(path: String) -> DirProbe {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return DirProbe { exists: false, is_dir: false, entries: 0, names: vec![] };
    }
    if !p.is_dir() {
        return DirProbe { exists: true, is_dir: false, entries: 0, names: vec![] };
    }
    let mut names: Vec<String> = Vec::new();
    let mut entries = 0usize;
    if let Ok(rd) = fs::read_dir(&p) {
        for e in rd.filter_map(Result::ok) {
            entries += 1;
            if names.len() < 60 {
                names.push(e.file_name().to_string_lossy().to_string());
            }
        }
    }
    names.sort();
    DirProbe { exists: true, is_dir: true, entries, names }
}

/// 在目录树里找一个文件名（不区分大小写）。认 ray.conf / mat_body.fx 这类用。
///
/// 取**最浅**的那个，不是遇到的第一个。真渲染包里 ray.conf 出现在好几层
/// （`ray.conf`、`Materials/toon/ray.conf`、`Materials/toon/Toon/ray.conf`），
/// walkdir 先撞到哪一层不确定，撞到子目录那个就不是包根了 ——
/// 实测 ray-mmd-1.5.2 就是这种情况。
#[tauri::command]
pub fn find_file(root: String, target: String, depth: Option<usize>) -> Option<String> {
    let t = target.to_ascii_lowercase();
    let max = depth.unwrap_or(4);
    let mut best: Option<(usize, String)> = None;
    for entry in WalkDir::new(&root).max_depth(max).into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() {
            continue;
        }
        let n = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if n != t {
            continue;
        }
        let d = entry.depth();
        if best.as_ref().map(|(bd, _)| d < *bd).unwrap_or(true) {
            best = Some((d, entry.path().to_string_lossy().to_string()));
        }
    }
    best.map(|(_, p)| p)
}

/// 取目录下所有子目录（一层），给"选一批模型文件夹"用
#[tauri::command]
pub fn list_subdirs(path: String) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(&path) {
        for e in rd.filter_map(Result::ok) {
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                out.push(e.path().to_string_lossy().to_string());
            }
        }
    }
    out.sort();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "robin-fsops-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// **TGA 头里没有 magic bytes**，`image::load_from_memory` 永远认不出它。
    /// 这条以前是静默坏的：Cargo 里开着 tga 特性、注释也写着要在后端解 TGA，
    /// 但一读就报"解不了这个格式"，`.tga` 一张也读不进来。
    #[test]
    fn tga_decodes_by_extension_even_though_it_has_no_magic() {
        let d = tmpdir("tga");
        let p = d.join("a.tga");
        // 造一张有辨识度的 TGA
        let mut img = image::RgbaImage::new(4, 3);
        img.put_pixel(0, 0, image::Rgba([12, 34, 56, 255]));
        img.put_pixel(3, 2, image::Rgba([200, 100, 50, 128]));
        image::DynamicImage::ImageRgba8(img.clone())
            .save_with_format(&p, image::ImageFormat::Tga)
            .unwrap();

        let bytes = fs::read(&p).unwrap();
        // 先确认前提成立：光看文件头是认不出 TGA 的
        assert!(
            image::guess_format(&bytes).is_err(),
            "如果这条挂了，说明 image 开始能认 TGA 头了，下面那个 fallback 可以简化"
        );
        assert!(
            image::load_from_memory(&bytes).is_err(),
            "同上：magic 认不出来，这正是要补 fallback 的原因"
        );

        // 按后缀走就得解得开
        let got = decode_image(&bytes, &p).expect("按 .tga 后缀应该解得开");
        let got = got.to_rgba8();
        assert_eq!((got.width(), got.height()), (4, 3), "尺寸要保住");
        assert_eq!(
            got.get_pixel(0, 0).0,
            [12, 34, 56, 255],
            "左上角像素要一模一样"
        );
        assert_eq!(got.get_pixel(3, 2).0, [200, 100, 50, 128], "右下角连同 alpha");
        fs::remove_dir_all(&d).ok();
    }

    /// PNG 那种有 magic 的不能被 fallback 弄坏，而且后缀写错也不该影响它
    #[test]
    fn magic_detectable_formats_still_use_their_own_header() {
        let d = tmpdir("png");
        // 后缀故意写成 .tga，但内容是 PNG —— 有 magic 就该按 PNG 解
        let p = d.join("mislabeled.tga");
        let mut img = image::RgbaImage::new(2, 2);
        img.put_pixel(1, 1, image::Rgba([9, 8, 7, 255]));
        image::DynamicImage::ImageRgba8(img)
            .save_with_format(&p, image::ImageFormat::Png)
            .unwrap();
        let bytes = fs::read(&p).unwrap();
        let got = decode_image(&bytes, &p).expect("有文件头就该解得开");
        assert_eq!(got.to_rgba8().get_pixel(1, 1).0, [9, 8, 7, 255]);
        fs::remove_dir_all(&d).ok();
    }

    /// 完全认不出的东西要报清楚，不能静默返回空图
    #[test]
    fn unknown_bytes_are_refused() {
        let p = PathBuf::from("x.zzz");
        let err = decode_image(b"not an image at all", &p).unwrap_err();
        assert!(err.contains("解不了"), "错误信息要说清是什么问题：{err}");
    }

    /// read_rgba 给的字节数必须是 w*h*4 —— 前端要按这个长度切 ImageData，
    /// 多一个少一个字节整张图就错位了
    #[test]
    fn read_rgba_returns_exactly_w_h_4_bytes() {
        let d = tmpdir("rgba");
        let p = d.join("b.png");
        let mut img = image::RgbaImage::new(5, 7);
        img.put_pixel(2, 3, image::Rgba([1, 2, 3, 4]));
        image::DynamicImage::ImageRgba8(img)
            .save_with_format(&p, image::ImageFormat::Png)
            .unwrap();

        let r = read_rgba(p.to_string_lossy().into()).unwrap();
        let raw = B64.decode(r.rgba.as_bytes()).unwrap();
        assert_eq!(r.width, 5);
        assert_eq!(r.height, 7);
        assert_eq!(raw.len(), 5 * 7 * 4, "长度必须是 w*h*4");
        let o = (3 * 5 + 2) * 4;
        assert_eq!(&raw[o..o + 4], &[1, 2, 3, 4], "像素位置不能错位");
        fs::remove_dir_all(&d).ok();
    }

    /// 原始字节不能预乘。半透明的像素 RGB 必须原样出来 ——
    /// 前端画布那条路会把 alpha=0 的 RGB 抹成 0，这条测试是钉住"Rust 这条路没这个问题"
    #[test]
    fn read_rgba_does_not_touch_rgb_of_transparent_pixels() {
        let d = tmpdir("premul");
        let p = d.join("c.png");
        let mut img = image::RgbaImage::new(2, 1);
        img.put_pixel(0, 0, image::Rgba([200, 150, 100, 0])); // 全透明但 RGB 有值
        img.put_pixel(1, 0, image::Rgba([40, 80, 120, 3])); // 几乎全透明
        image::DynamicImage::ImageRgba8(img)
            .save_with_format(&p, image::ImageFormat::Png)
            .unwrap();

        let r = read_rgba(p.to_string_lossy().into()).unwrap();
        let raw = B64.decode(r.rgba.as_bytes()).unwrap();
        assert_eq!(&raw[0..4], &[200, 150, 100, 0], "全透明像素的 RGB 不能被抹掉");
        assert_eq!(&raw[4..8], &[40, 80, 120, 3], "低 alpha 的 RGB 不能被动");
        fs::remove_dir_all(&d).ok();
    }

    /* ---------------- 原子写 ---------------- */

    /// 本目录下有没有残留的临时文件。原子写失败忘了清理就会攒一堆 `.name.tmp-*`
    fn leftover_temps(dir: &Path) -> Vec<String> {
        fs::read_dir(dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.contains(".tmp-"))
            .collect()
    }

    #[test]
    fn atomic_write_lands_exactly_and_leaves_no_temp() {
        let d = tmpdir("atomic1");
        let p = d.join("a.txt");
        atomic_write(&p, b"hello \xE4\xB8\xAD\xE6\x96\x87").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"hello \xE4\xB8\xAD\xE6\x96\x87");
        assert!(leftover_temps(&d).is_empty(), "临时文件要清干净：{:?}", leftover_temps(&d));
        fs::remove_dir_all(&d).ok();
    }

    /// 覆盖已有的文件：内容要换掉，而且临时文件不能留在目录里
    #[test]
    fn atomic_write_replaces_existing_content() {
        let d = tmpdir("atomic2");
        let p = d.join("b.txt");
        fs::write(&p, b"old-and-longer-than-the-new-one").unwrap();
        atomic_write(&p, b"new").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"new", "旧内容要整段换掉，不能只覆盖前面几个字节");
        assert!(leftover_temps(&d).is_empty(), "不留临时文件");
        fs::remove_dir_all(&d).ok();
    }

    /// 目标**不可写**的时候，原文件必须一个字节都没动 ——
    /// 这正是 `fs::write` 做不到的那件事（它会先把文件截成 0）
    #[test]
    fn failed_write_does_not_touch_the_original() {
        let d = tmpdir("atomic3");
        let p = d.join("c.txt");
        let original = b"the original content that must survive".to_vec();
        fs::write(&p, &original).unwrap();

        // 往一个"目录路径"上写：create 会失败，但目标本身是个存在的目录，
        // 拿它当"写不进去"的场景，比改权限跨平台稳
        let dir_as_target = d.join("sub");
        fs::create_dir_all(&dir_as_target).unwrap();
        let r = atomic_write(&dir_as_target, b"whatever");
        assert!(r.is_err(), "往目录路径上写应该失败");

        assert_eq!(fs::read(&p).unwrap(), original, "另一个文件不该受影响");
        assert!(fs::read_dir(&dir_as_target).unwrap().next().is_none(), "那个目录里不该多出东西");
        assert!(leftover_temps(&d).is_empty(), "失败的临时文件要删掉");
        fs::remove_dir_all(&d).ok();
    }

    /// 走完整命令：写一段文本再读回来，内容要逐字节一致，且不留临时文件
    #[test]
    fn write_bytes_round_trips_through_the_command() {
        let d = tmpdir("wbytes");
        let p = d.join("proj.redproj");
        let text = r#"{"magic":"robineditor-project","name":"底图","n":1}"#;
        let w = write_bytes(p.to_string_lossy().into(), B64.encode(text.as_bytes()), Some(true))
            .unwrap();
        assert_eq!(w.bytes_written, text.as_bytes().len() as u64);
        assert!(w.backup.is_none(), "第一次写没有旧文件，不该有备份");

        let raw = fs::read(&p).unwrap();
        assert_eq!(raw, text.as_bytes(), "读回来要逐字节一致");

        // 再写一次：这次该留 .bak，而 .bak 里是上一版
        let w2 = write_bytes(
            p.to_string_lossy().into(),
            B64.encode(b"second"),
            Some(true),
        )
        .unwrap();
        assert!(w2.backup.is_some(), "覆盖要留备份");
        let bak = w2.backup.unwrap();
        assert_eq!(fs::read(&bak).unwrap(), text.as_bytes(), "备份里是上一版内容");
        assert_eq!(fs::read(&p).unwrap(), b"second");
        assert!(leftover_temps(&d).is_empty(), "不留临时文件");
        fs::remove_dir_all(&d).ok();
    }

    /// 写图那条也走原子替换，而且编到内存里 —— 编不出来时目标文件不动
    #[test]
    fn write_rgba_image_is_atomic_too() {
        let d = tmpdir("wimg");
        let p = d.join("t.png");
        // 先放一张已知内容的图
        let mut first = image::RgbaImage::new(2, 2);
        first.put_pixel(0, 0, image::Rgba([1, 2, 3, 255]));
        write_rgba_image(
            p.to_string_lossy().into(),
            2,
            2,
            B64.encode(first.as_raw()),
            Some(true),
        )
        .unwrap();
        let before = fs::read(&p).unwrap();

        // 尺寸对不上 → 直接报错，目标文件不能被动
        let err = write_rgba_image(
            p.to_string_lossy().into(),
            3,
            3,
            B64.encode(first.as_raw()),
            Some(true),
        );
        assert!(err.is_err(), "像素数对不上要报错");
        assert_eq!(fs::read(&p).unwrap(), before, "报错之后原图必须原封不动");
        assert!(leftover_temps(&d).is_empty(), "不留临时文件");

        // 正常写一次：内容要真的换掉
        let mut second = image::RgbaImage::new(2, 2);
        second.put_pixel(1, 1, image::Rgba([9, 8, 7, 255]));
        write_rgba_image(
            p.to_string_lossy().into(),
            2,
            2,
            B64.encode(second.as_raw()),
            Some(true),
        )
        .unwrap();
        let back = read_rgba(p.to_string_lossy().into()).unwrap();
        let raw = B64.decode(back.rgba.as_bytes()).unwrap();
        let o = (1 * 2 + 1) * 4;
        assert_eq!(&raw[o..o + 4], &[9, 8, 7, 255], "新内容要真的写进去");
        assert!(leftover_temps(&d).is_empty(), "不留临时文件");
        fs::remove_dir_all(&d).ok();
    }

    /* ==================================================================
       A1：**选到盘根 / 宽目录不许卡死**（用户 2026-09-23 报的第一条）

       这一组就是"拿真目录跑一遍"：造一棵真树，量耗时，
       断言两条路都走得通 —— 要么在限定时间内**明确拒绝**（"范围太大，请给更具体的起点"），
       要么**带进度**完成。数字都打出来，报告里直接抄。
       ================================================================== */

    /// 造一棵"宽"的树：`宽` 个子目录 × 每目录 `每目录` 个文件
    fn 造宽树(根: &Path, 宽: usize, 每目录: usize) {
        for i in 0..宽 {
            let d = 根.join(format!("d{i:04}"));
            fs::create_dir_all(&d).unwrap();
            for j in 0..每目录 {
                fs::write(d.join(format!("f{j:04}.pmx")), b"x").unwrap();
            }
        }
    }

    /// 这台机器上临时目录所在那个**盘根**（`D:\` 这种）
    fn 本机盘根() -> PathBuf {
        std::env::temp_dir()
            .ancestors()
            .find(|p| p.has_root() && p.parent().is_none())
            .map(|p| p.to_path_buf())
            .expect("找不到盘根")
    }

    /// **选到盘根＝立刻拒绝**（不扫、不卡）。用户报的就是"D:\ 卡死"。
    #[test]
    fn 选到盘根立刻拒绝_不扫整盘() {
        let 根 = 本机盘根();
        let 起 = std::time::Instant::now();
        let e = scan_dir(
            根.to_string_lossy().into(),
            Some(vec!["pmx".into()]),
            Some(true),
            None,
        )
        .expect_err("盘根必须被拒");
        let 耗时 = 起.elapsed().as_millis();
        println!("  【A1】选到盘根 {} → 拒绝耗时 {耗时} ms：{e}", 根.display());
        assert!(e.contains("范围太大，请给更具体的起点"), "要说清是范围太大：{e}");
        assert!(耗时 < 200, "盘根要给**立刻**反应（实测 {耗时} ms）");
    }

    /// 宽目录：条目上限一到就拒绝，并且**带耗时数字**。
    /// 同一棵树把上限放大就能完整扫完（"要么带进度完成"那一条）。
    #[test]
    fn 宽目录_超条目上限就拒绝_放开上限就扫完() {
        let d = tmpdir("宽目录");
        造宽树(&d, 40, 50); // 2000 个文件
        let 根 = d.to_string_lossy().to_string();

        let 起 = std::time::Instant::now();
        let e = scan_dir(
            根.clone(),
            None,
            Some(true),
            Some(扫描上限 { 层数: 16, 条目: 500, 毫秒: 5000 }),
        )
        .expect_err("条目上限 500 时必须拒");
        let 拒耗时 = 起.elapsed().as_millis();
        println!("  【A1】2000 个文件、条目上限 500 → 拒绝耗时 {拒耗时} ms：{e}");
        assert!(e.contains("范围太大，请给更具体的起点"), "{e}");
        assert!(e.contains("条目数"), "要说清是哪条线上超了：{e}");

        /* 放开上限（条目 5000）：同一棵树要**扫完**，而且进度要有值 */
        let 起2 = std::time::Instant::now();
        let 表 = scan_dir(根.clone(), None, Some(true), Some(扫描上限 { 层数: 16, 条目: 5000, 毫秒: 8000 }))
            .expect("放开上限就该扫完");
        let 扫耗时 = 起2.elapsed().as_millis();
        let p = 查进度();
        println!("  【A1】同一棵树放开上限 → 扫完 {} 个文件，耗时 {扫耗时} ms，进度 已看 {} / {} ms / 在 {}",
            表.len(), p.已看, p.毫秒, p.在哪);
        assert_eq!(表.len(), 2000, "宽目录里的文件要全在表里");
        assert_eq!(p.已看, 2000, "进度要报出看过的文件数");
        assert!(扫耗时 < 8000, "上限之内要能跑完（实测 {扫耗时} ms）");
        fs::remove_dir_all(&d).ok();
    }

    /// 太深：层数上限一到就拒绝（不许一路钻到底）
    #[test]
    fn 太深_超层数上限就拒绝() {
        let d = tmpdir("深");
        let mut p = d.clone();
        for i in 0..12 {
            p = p.join(format!("l{i}"));
            fs::create_dir_all(&p).unwrap();
        }
        fs::write(p.join("深处.pmx"), b"x").unwrap();

        let e = scan_dir(
            d.to_string_lossy().into(),
            None,
            Some(true),
            Some(扫描上限 { 层数: 4, 条目: 1000, 毫秒: 5000 }),
        )
        .expect_err("12 层深、上限 4 层时必须拒");
        println!("  【A1】12 层深、层数上限 4 → {e}");
        assert!(e.contains("范围太大，请给更具体的起点"), "{e}");
        assert!(e.contains("层数"), "要说清是层数超了：{e}");
        fs::remove_dir_all(&d).ok();
    }

    /// 时间上限：0 毫秒＝立刻停（时间那条线也要真能拦住）
    #[test]
    fn 时间上限到了就拒绝() {
        let d = tmpdir("时间");
        造宽树(&d, 5, 10);
        let e = scan_dir(
            d.to_string_lossy().into(),
            None,
            Some(true),
            Some(扫描上限 { 层数: 16, 条目: 100_000, 毫秒: 0 }),
        )
        .expect_err("时间上限 0 就要立刻拒");
        assert!(e.contains("范围太大，请给更具体的起点") && e.contains("时间"), "{e}");
        fs::remove_dir_all(&d).ok();
    }

    /// 取消：走到一半置上取消位，下一趟检查就得停（模拟界面点「取消」）
    #[test]
    fn 取消之后就停下_不扫完() {
        let d = tmpdir("取消");
        造宽树(&d, 40, 20); // 800 个文件
        let mut 收过 = 0usize;
        设扫描取消(false);
        let e = 有界遍历(&d, 默认扫描上限, true, |_| {
            收过 += 1;
            if 收过 == 300 {
                设扫描取消(true);
            }
        })
        .expect_err("取消位一置上，下一趟检查就得停");
        设扫描取消(false);
        println!("  【A1】800 个文件、收到第 300 个时取消 → {e}");
        assert!(e.contains("已取消"), "{e}");
        assert!(收过 < 800, "取消之后不许继续扫完（实收 {收过} 个）");

        /* 下一趟走命令入口要能正常开始 —— `scan_dir` 开头会把取消位清掉 */
        let 表 = scan_dir(d.to_string_lossy().into(), None, Some(true), None).unwrap();
        assert_eq!(表.len(), 800, "取消位清掉之后要能完整扫一遍");
        fs::remove_dir_all(&d).ok();
    }

    /// 非递归那一档（`recursive = false`）不该受"盘根"那条影响：名单层目录是正当用法
    #[test]
    fn 不递归时盘根也能列一层() {
        let d = tmpdir("单层");
        造宽树(&d, 3, 2);
        let 表 = scan_dir(d.to_string_lossy().into(), None, Some(false), None).unwrap();
        assert!(表.is_empty(), "根下面只有目录、没有文件：{表:?}");
        fs::remove_dir_all(&d).ok();
    }
}
