//! 编码识别与日文乱码修复。
//!
//! 乱码的成因只有一种：**拿错编码去读**。
//! 日文原文是 Shift-JIS 的字节，被当成 GBK 读出来，就得到 `僐儞僩儘乕儔乕`
//! 这种字（原词是 コントローラー）。修回去就是把字符串按 GBK 编回字节，
//! 再按 Shift-JIS 解一次。
//!
//! 所以编码器必须能"编回去"。TextEncoder 只支持 UTF-8，纯前端做不了这件事，
//! 这段只能留在 Rust 里（encoding_rs）。
//!
//! 认不出的情况不猜到底：把候选都算出来打分，最好的那个如果没比原样好多少，
//! 就原样返回，宁可不改也别改坏。

use encoding_rs::{BIG5, EUC_JP, GBK, SHIFT_JIS, UTF_8, WINDOWS_1252};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
pub struct RepairAttempt {
    pub via: String,
    pub score: f64,
    pub text: String,
}

#[derive(Serialize)]
pub struct RepairResult {
    pub original: String,
    pub fixed: String,
    pub changed: bool,
    /// 命中的那条路，没命中就是 "none"
    pub via: String,
    /// 修复后的分 / 原样的分。差值就是这次修复的可信度
    pub score_after: f64,
    pub score_before: f64,
    pub attempts: Vec<RepairAttempt>,
    /// 逐段的交代（原文 / 增益 / 门槛 / 候选 / 为什么没自动改）。
    /// 界面据此摆「就用这个」—— 不许只把乱码丢回去。
    pub segments: Vec<SegmentReport>,
}

#[derive(Serialize)]
pub struct DetectedText {
    pub text: String,
    pub encoding: String,
    pub lossy: bool,
    pub bom: bool,
}

// ---------------------------------------------------------------- 打分

/// 给一段文本打分：越像"正常的日文/中文文本"分越高。
///
/// 权重是拍的，但方向明确：假名是强信号（乱码里几乎不出假名），
/// 替换符和私用区、康熙部首这类是强负信号。
///
/// 半角片假名只给 0.1，别给高：GBK 的中文一个字两个字节，被 Shift-JIS
/// 解出来正好是**半角片假名**。给高了就会出现"把整句中文改成假名垃圾反而分更高"
/// 这种事 —— 实测踩过：`材质名：僥僋僗僠儍_01 // 这是注释` 整段被改成了
/// `ｲﾄﾖﾊﾃ訒ｺテクスチャ_01 // ﾕ簗ﾇﾗ｢ﾊﾍ`。
fn score(s: &str) -> f64 {
    if s.is_empty() {
        return f64::NEG_INFINITY;
    }
    let mut v = 0.0f64;
    let mut n = 0.0f64;
    for c in s.chars() {
        n += 1.0;
        let u = c as u32;
        match u {
            // 平假名 / 片假名：正常日文的标志
            0x3041..=0x309F => v += 3.0,
            0x30A1..=0x30FF => v += 3.0,
            // 半角片假名：见上，GBK 误读的产物也长这样，不能当正面信号
            0xFF66..=0xFF9D => v += 0.1,
            // 中日韩统一表意
            0x4E00..=0x9FFF => v += 0.6,
            // 全角标点
            0x3000..=0x303F => v += 0.4,
            // 替换符：解码踩到非法字节
            0xFFFD => v -= 10.0,
            // 私用区：几乎只能是错的
            0xE000..=0xF8FF => v -= 6.0,
            // 康熙部首 / 注音 / 兼容区：GBK 误读 SJIS 的重灾区
            0x2E80..=0x2FDF => v -= 3.0,
            0x3100..=0x312F => v -= 2.5,
            0x31C0..=0x31EF => v -= 2.5,
            0xF900..=0xFAFF => v -= 2.0,
            // CJK 扩展：正常文本里罕见
            0x3400..=0x4DBF => v -= 1.5,
            0x20000..=0x2FFFF => v -= 2.0,
            // 希腊 / 西里尔 / 希伯来 / 阿拉伯 / 泰文：日文和中文文本里不会出现。
            // 这条是补一个实测抓到的 bug：`成分` 被 GBK→Shift-JIS 解成 `Θだ`，
            // 里面的平假名 だ 拿了 +3，把两字的中文段硬说成"修好了"。
            // 加了这个惩罚之后 `Θだ` 只有 (−1.5+3)/2 = 0.75，低于原样 0.6 + 0.35 的门槛。
            0x0370..=0x03FF | 0x0400..=0x04FF => v -= 1.5,
            0x0590..=0x05FF | 0x0600..=0x06FF => v -= 1.5,
            0x0900..=0x097F | 0x0E00..=0x0E7F => v -= 1.5,
            // 控制字符（换行/制表除外）
            0x00..=0x08 | 0x0B | 0x0C | 0x0E..=0x1F | 0x7F => v -= 2.0,
            // ASCII 正常
            0x20..=0x7E => v += 0.3,
            _ => v += 0.05,
        }
    }
    // 按字符数归一，否则长文本天然占优
    v / n.max(1.0)
}

/// 全角假名（平假名 / 片假名）在整串里的占比。
///
/// **半角片假名不算**：GBK 的中文一个字被 Shift-JIS 解出来常常正好是半角片假名
/// （`材质` 那一类会解成 `ｲﾄﾖﾊﾃ`），把它当假名的话中文反倒看着像"修好的日文"。
/// `score` 里给半角片假名只 0.1 分是同一个道理。
fn kana_ratio(s: &str) -> f64 {
    let mut kana = 0.0f64;
    let mut n = 0.0f64;
    for c in s.chars() {
        n += 1.0;
        if matches!(c as u32, 0x3041..=0x309F | 0x30A1..=0x30FF) {
            kana += 1.0;
        }
    }
    if n == 0.0 {
        0.0
    } else {
        kana / n
    }
}

/// 候选里有没有半角片假名。有 = 那是**中文**被读坏的样子，不是日文乱码。
fn has_halfwidth_kana(s: &str) -> bool {
    s.chars().any(|c| matches!(c as u32, 0xFF66..=0xFF9D))
}

/// 认一个修复所需的**最小假名占比上升**。
///
/// 乱码段里一个假名都没有（候选字符全是汉字，假名压根不进候选），
/// 所以修对了的段，假名占比一定是涨的。真乱码实测 0.6~1.0，中文被读坏的那种
/// 涨不到 0.5（它解出来大半是半角片假名，不算假名）。
const 假名上升门槛: f64 = 0.5;

/// 认一个修复所需的增益门槛，**按段长分档**。
///
/// 为什么不是固定 1.8（原来就是这个）：
///   真乱码 `僐儞僩儘乕儔乕` → `コントローラー` 增益 2.4（整段变假名）
///   假阳性 `部分` → `魁だ`               增益 1.2（只碰巧转掉一个字）
/// 1.8 卡在中间确实把上面两类分开了，但它同时把**真乱码里"假名+汉字混排"**那一类也挡掉了：
/// 语料里那三个乱码文件名就是 —— `捛壛儌乕僼` → `追加モーフ` 增益 1.44、
/// `00_僔僃乕僟乕傪嵞攝晍偡傞偲偒偺拄堄揰` → `シェーダーを再配布するときの注意点` 增益 1.55、
/// `傾僯儊晽夋柺僗僋儕乕儞` → `アニメ風画面スクリーン` 增益 1.75 —— 全差一点没够。
/// 修出来明明是正确日文，却因为"汉字还在（每个 +0.6）"而够不着按"整段变假名"校准的门槛。
///
/// 所以分两档：**短串（≤4 字）沿用 1.8**（`部分`/`手動`/`平面` 那一类假阳性都在这儿，
/// 一个字碰巧变假名就能凑出 1.2），**长串（≥5 字）降到 1.2**。
/// 光降门槛会把中文段也放进来，所以一起补了两条信号：假名占比必须真的上升 ≥0.5，
/// 且候选里不许有半角片假名 —— 那两条才是把中文挡在外面的东西。
fn 增益门槛(段长: usize) -> f64 {
    if 段长 <= 4 {
        1.8
    } else {
        1.2
    }
}

// ---------------------------------------------------------------- 编解码

/// 界面上那一排"原文是什么日文编码"预设 → 候选要试的目标编码表。
///
/// 空 / "auto" / "自动认" = 三路都试（老行为，按分数挑）。
/// 指定了就只试那一路 —— 候选表里也就只剩那一路，人一眼能看出"按我说的解成了什么"。
///
/// 为什么预设只有这三档：候选这条路是"**按 X 读错的字 → 编回字节 → 按 Y 解**"，
/// 这里的 Y 只能是引擎认得的日文编码。UTF-16LE 不是这条路上的 Y（它是**文件本身**的编码，
/// 由 `detect_text` 认 BOM），ISO-2022-JP 引擎里没接 —— 这两档要加得先动解码那一层，
/// 所以**没有列进界面**（列出来却选不动，比不列更坏）。
fn 目标编码表(目标: Option<&str>) -> Vec<&'static str> {
    match 目标.map(|s| s.trim()).unwrap_or("") {
        "" | "auto" | "自动认" | "自动" => vec!["shift_jis", "euc-jp", "utf-8"],
        "shift_jis" | "shift-jis" | "sjis" | "Shift-JIS" => vec!["shift_jis"],
        "euc-jp" | "euc_jp" | "EUC-JP" => vec!["euc-jp"],
        "utf-8" | "utf_8" | "UTF-8" => vec!["utf-8"],
        _ => vec!["shift_jis", "euc-jp", "utf-8"],
    }
}

fn decode(bytes: &[u8], enc: &str) -> Option<(String, bool)> {
    let (cow, _, lossy) = match enc {
        "utf-8" => UTF_8.decode(bytes),
        "shift_jis" => SHIFT_JIS.decode(bytes),
        "gbk" => GBK.decode(bytes),
        "gb18030" => encoding_rs::GB18030.decode(bytes),
        "euc-jp" => EUC_JP.decode(bytes),
        "big5" => BIG5.decode(bytes),
        "windows-1252" => WINDOWS_1252.decode(bytes),
        _ => return None,
    };
    Some((cow.into_owned(), lossy))
}

fn encode(s: &str, enc: &str) -> Option<Vec<u8>> {
    match enc {
        "utf-8" => return Some(s.as_bytes().to_vec()),
        // UTF-16LE 之前只解不编 —— `detect_text` 认得出它，写回时却在这里返回 None，
        // 于是 UTF-16LE 的 .fx **一次也修不了**，只会报"编不回去，已跳过"。
        // 这次补上，字节序跟着 MMD 那批文件（小端 + FF FE）。
        "utf-16le" => {
            let mut out = Vec::with_capacity(2 + s.len() * 2);
            out.extend_from_slice(&[0xFF, 0xFE]);
            for u in s.encode_utf16() {
                out.extend_from_slice(&u.to_le_bytes());
            }
            return Some(out);
        }
        _ => {}
    }
    let (cow, _, had_errors) = match enc {
        "shift_jis" => SHIFT_JIS.encode(s),
        "gbk" => GBK.encode(s),
        "gb18030" => encoding_rs::GB18030.encode(s),
        "euc-jp" => EUC_JP.encode(s),
        "big5" => BIG5.encode(s),
        "windows-1252" => WINDOWS_1252.encode(s),
        _ => return None,
    };
    // 编不回去就没意义：目标编码里没有这个字，硬编会变成替换符或者实体
    if had_errors {
        return None;
    }
    let bytes = cow.into_owned();
    if bytes.is_empty() && !s.is_empty() {
        return None;
    }
    Some(bytes)
}

/* ------------------------------------------------- 不靠假名的两条结构判据

   为什么要有：自动判据原来只认一条"**假名占比真的上升**"
   （`假名上升 >= 假名上升门槛`）。纯汉字 / 纯符号那种乱码两边一个假名都没有 ——
   判据看不见任何上升，于是一律原样留着。用户 2026-09-24 报的两条正好全落在这一档：

     · 正文：`丒巊梡曽朄` 该还原成 `・使用方法`，没还原；
     · 名字：`夵曄尦readme` 该还原成 `改変元readme`，判据说"够不着门槛"。

   用户定的口径是**不能把这个活丢给操作者去挑**，得程序判对。所以补两条
   **结构上**的证据（都不是启发式，是"字节本来就该长这样"）：

   实测（`tmp\量-纯汉字乱码判据.mjs`，语料 `乱码翻译\` 里 14 个真样本，8/8 判对）：
     6 个真乱码（夵曄尦readme / 丒巊梡曽朄 / 僄僢僕昤夋 / 傾僯儊晽夋柺僗僋儕乕儞 /
                readme(恓嬥P) / readme-巊偄曽）→ 两条都过；
     8 个不该动的（乱码翻译 / 修复结果_过目用 / 改名后 / 翻译后 / 还原后 / 测试效果 /
                   PostRimShilouhette / AnimeScreenTex_v1.0）→ 两条都不过。 */

/// 这串字是不是"真乱码"——**无损回环**说了算。
///
/// 道理：真乱码是"Shift-JIS 的字节被按 GBK 读出来"的产物，所以把它**编回 GBK**，
/// 一定得到一条**完整合法的 Shift-JIS 字节串**，解出来再编回去、再按 GBK 解，
/// 一圈下来原样回来。
///
/// 反过来，用户自己起的中文名编回 GBK 之后就**不是**合法 Shift-JIS 了 ——
/// 实测 `乱码翻译` 的 `B8 D2 C2 EB B7 AD D2 EB`：按 Shift-JIS 解到末尾那个 `EB`
/// 已经没有后继字节，只能出替换字符，解出来带 `�`，编回去当然对不上。
///
/// `源` / `目标` 就是候选那条路的 `via`（`"gbk -> shift_jis"` 拆成两半）。
fn 无损回环(坏: &str, 源: &str, 目标: &str) -> bool {
    let Some(去) = encode(坏, 源) else { return false };
    let Some((解, 丢)) = decode(&去, 目标) else { return false };
    if 丢 || 解 == 坏 {
        return false;
    }
    let Some(回) = encode(&解, 目标) else { return false };
    let Some((原, 丢2)) = decode(&回, 源) else { return false };
    !丢2 && 原 == 坏
}

/// 候选解出来的**汉字**是不是常用字。
///
/// 判据用 Shift-JIS 自己的排布：JIS X 0208 **第 1 级**（那 2965 个常用/人名用汉字）
/// 正好占前导字节 `0x88–0x98` 这一段 —— `亜` = `0x889F` 是头一个，第 47 区末尾 = `0x9872`；
/// 第 2 级那些生僻字排在 `0x98` 之后。
///
/// 实测：真乱码解出来的是 `改変元` / `使用方法` / `針金` / `風画面`，全在 1 级；
/// 而中文名凑出来的候选是 `岱鷹鍬咎` 这种生僻字。
///
/// **一个汉字都没有时返回 `true`**：这条判据对纯假名/纯 ASCII 的候选没话说，
/// 那种交给别的判据（不能因为"没汉字"就把它否掉）。
fn 汉字都常用(文: &str) -> bool {
    for ch in 文.chars() {
        if !matches!(ch as u32, 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF) {
            continue;
        }
        let Some(b) = encode(&ch.to_string(), "shift_jis") else { return false };
        if b.len() != 2 || !(0x88..=0x98).contains(&b[0]) {
            return false;
        }
    }
    true
}

/// 按原来的 BOM 状态编回去。
///
/// 之前**一律丢掉 BOM**：`detect_text` 认出 `EF BB BF` 并把那三字节剥掉，
/// 写回时 `encode` 只吐裸 UTF-8 —— 一个带 BOM 的文件被"修好"之后 BOM 就没了。
/// 有些工具靠 BOM 判断这是不是 UTF-8，改掉等于顺手破坏了别的约定。
/// 修文本的工具不该动这个，原来有就补回去，原来没有就别加。
fn encode_keep_bom(s: &str, enc: &str, bom: bool) -> Option<Vec<u8>> {
    if enc == "utf-16le" {
        // 这个分支的 encode 自己就带 BOM，不用再加
        return encode(s, enc);
    }
    let mut bytes = encode(s, enc)?;
    if bom && enc == "utf-8" && !bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        let mut out = Vec::with_capacity(bytes.len() + 3);
        out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
        out.append(&mut bytes);
        return Some(out);
    }
    Some(bytes)
}

// ---------------------------------------------------------------- 修复

/// 读文件时用的识别：先看 BOM，再试 UTF-8，最后按分挑。
#[tauri::command]
pub fn detect_text(bytes: Vec<u8>) -> DetectedText {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        let (t, lossy) = decode(&bytes[3..], "utf-8").unwrap();
        return DetectedText { text: t, encoding: "utf-8".into(), lossy, bom: true };
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        // UTF-16LE：MMD 的 .fx 偶尔是这个
        /* `chunks_exact(2)` 会**丢掉末尾那个凑不成码元的字节**，
           `from_utf16_lossy` 又会把落单的代理对换成 U+FFFD —— 两种都是有损的。
           原来这里写死 `lossy: false`，等于骗调用方"解码干净"，
           写盘那条路就不会警告、静默改写。这里改成说实话。 */
        let 尾字节 = bytes.len() % 2 != 0;
        let u16s: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let text = String::from_utf16_lossy(&u16s);
        let lossy = 尾字节 || text.contains('\u{FFFD}');
        return DetectedText {
            text,
            encoding: "utf-16le".into(),
            lossy,
            bom: true,
        };
    }
    // 严格 UTF-8 能过就认它
    if let Ok(s) = std::str::from_utf8(&bytes) {
        return DetectedText { text: s.to_string(), encoding: "utf-8".into(), lossy: false, bom: false };
    }
    // 挑分最高的
    let mut best = ("shift_jis".to_string(), String::new(), f64::NEG_INFINITY, true);
    for enc in ["shift_jis", "gbk", "gb18030", "euc-jp", "big5"] {
        if let Some((t, lossy)) = decode(&bytes, enc) {
            let sc = score(&t) - if lossy { 0.5 } else { 0.0 };
            if sc > best.2 {
                best = (enc.to_string(), t, sc, lossy);
            }
        }
    }
    DetectedText { text: best.1, encoding: best.0, lossy: best.3, bom: false }
}

/// 这个字符算不算"可能是乱码"的候选。
///
/// 乱码的本体是汉字区（GBK 双字节解成 Shift-JIS 落在 CJK 表意区），
/// 所以按段切的时候只需要认汉字区和 CJK 标点。ASCII 和真假名天然不是候选，
/// 这样"正常日文"永远不会被卷进来。
fn is_candidate(c: char) -> bool {
    matches!(c as u32,
        0x2E80..=0x2FDF   // 康熙部首
        | 0x3000..=0x303F // CJK 标点
        | 0x3400..=0x4DBF // 扩展 A
        | 0x4E00..=0x9FFF // 基本汉字
        | 0xF900..=0xFAFF // 兼容汉字
    )
}

/// 一段文本按候选字符切成若干段，逐段试修。
///
/// 为什么要分段：MMD 的文件经常中日记混（日文原注释 + 中文自己加的批注）。
/// 整段一起修的话，中文那一半会被 GBK→Shift-JIS 变成假名垃圾，
/// 总分反而看着"不差"，于是整段都不改，日文那边就一直烂着。
/// 分段之后各修各的，中文段因为修不出更高分被原样保留。
///
/// ## 单字段一律不动（这条是实战测试用例真跑抓出来的）
///
/// `乱码翻译/AbsoluteShadowShaderSystem.fx` 里有一行**正确的**日文注释
/// `// シャドウ用Zバッファのぼかし読み取り`。候选字符（汉字）在这一行里被切成两段：
/// `用` 单独一段，`読み取り` 一段 —— 因为中间的 `Z` 和两边的片假名/平假名都不是候选。
///
/// 于是 `用` 单独拿去打分：
///
/// ```text
/// base                                       0.600   （一个汉字 = +0.6）
/// big5 -> euc-jp   "ノ"                      3.000   （一个片假名 = +3.0）
/// ```
///
/// **片假名权重是汉字的五倍**，所以单字段里把任何汉字转成片假名都"更优"，稳赢。
/// 结果 `用` → `ノ`，正确的日文被改坏，还写进了盘（2026-09 实测，用户拿真文件跑发现）。
///
/// 字数一多这个偏差就被摊平了（`読み取り` 三个字，所有候选都更低分，正确地没动），
/// 所以这里定一条：**单字段不修**。真实的乱码是成串出现的（`僐儞僩儘乕儔乕`），
/// 孤零零一个汉字夹在假名/ASCII 中间，那基本就是原文本身。
const MIN_RUN: usize = 2;

/// 一段的完整交代：原文、得分、为什么没自动改、候选有哪些。
///
/// 为什么要摆出来：用户的原话是"**保证乱码可以翻译而不是给我丢回乱码，最起码要修复**"。
/// 以前够不着门槛就只把原文还回去，用户连"它其实能修"都看不出来（语料里那三个
/// 乱码文件名就是这样被"丢回来"的）。所以哪怕不自动改，候选、增益、原因也必须摆出来，
/// 让人自己按「就用这个」——**候选为空才算真的修不了**。
#[derive(Serialize, Clone)]
pub struct SegmentReport {
    /// 原文那一段（候选字符的连串）
    pub run: String,
    /// 原样得分
    pub base: f64,
    /// 这一段用的门槛
    pub 门槛: f64,
    /// 最好候选的增益（候选得分 − 原样得分）
    pub gain: f64,
    /// 假名占比上升了多少
    pub 假名上升: f64,
    /// 最好候选里有没有半角片假名
    pub 半角片假名: bool,
    /// 自动采用的那条路，没采用就是 "none"
    pub via: String,
    /// 候选（按分数降序，最多 6 条）
    pub 候选: Vec<RepairAttempt>,
    /// 自动采用了第几个候选；None = 没自动改
    pub applied: Option<usize>,
    /// 没自动改的原因，人话
    pub 原因: String,
}

/// 逐段修，并且把每段的交代都带回来。`强制` 是 "第几段 → 用第几个候选"。
///
/// `目标` 是操作者在界面上选的"原文是什么日文编码"（`① 文本` 那一排预设）：
/// 给了就**只走这一路**。原来是 shift_jis / euc-jp / utf-8 三路一起算分，
/// 谁分高用谁 —— 分高的那一支不一定是他要的那一支；人知道原文是 EUC-JP 时，
/// 让他直接指定比让他从候选里挑靠谱。`None` = 自动认 = 老行为。
fn repair_segments_at(text: &str, 强制: &[(usize, usize)], 目标: Option<&str>) -> (String, Vec<SegmentReport>) {
    let mut out = String::with_capacity(text.len());
    let mut run = String::new();
    let mut 报告: Vec<SegmentReport> = Vec::new();
    let 目标表 = 目标编码表(目标);

    let flush = |run: &mut String,
                 out: &mut String,
                 报告: &mut Vec<SegmentReport>,
                 强制: &[(usize, usize)]| {
        if run.is_empty() {
            return;
        }
        let 第几段 = 报告.len();
        let base = score(run);
        let 段长 = run.chars().count();

        if 段长 < MIN_RUN {
            // 单字段：打分会被字符权重带偏，一律原样留着
            报告.push(SegmentReport {
                run: run.clone(),
                base,
                门槛: 增益门槛(段长),
                gain: 0.0,
                假名上升: 0.0,
                半角片假名: false,
                via: "none".into(),
                候选: vec![],
                applied: None,
                原因: "单个字不成串：孤零零一个汉字夹在假名/ASCII 中间，那基本就是原文本身".into(),
            });
            out.push_str(run);
            run.clear();
            return;
        }

        // **能用 Shift-JIS 编出来 = 这一段本来就是正常日文，别动它。**
        //
        // 这条是拿真文件跑出来才想明白的。只靠"打分增益"分不开两种情况：
        //
        //   真乱码   僐儞僩儘乕儔乕 → コントローラー    增益 2.4
        //   假阳性   中心           → いみ              增益 2.4   ← 一模一样
        //
        // 因为两者都是"整段汉字变成整段假名"，假名 +3.0、汉字 +0.6，一算都是 2.4。
        // 打分这条路到头了。
        //
        // 换个问法就分得开：**这段字本来是不是日文？** 用目标编码试编一次就知道。
        // 实测 18 个样本 100% 分得开：
        //
        //   中心 平面 手動 部分 設定 読み取り シャドウ  → 都能编成 Shift-JIS（真日文）
        //   僐儞僩儘乕儔乕 僔僃乕僟乕 僥僋僗僠儍 愝掕 娍揹 → 都编不出来（乱码）
        //
        // 道理也顺：乱码是"Shift-JIS 的字节被按 GBK 读出来"的产物，
        // 那些汉字本来就不是日文里的字，回不到 Shift-JIS 里去。
        //
        // 已知边界：这条只按 Shift-JIS 判。EUC-JP 的日文文件不走这条（MMD 里极少见）。
        //
        // **操作者指定了编码时，这条按他指定的那档判** —— 他说原文是 EUC-JP，
        // 那就该问"这段能不能编成 EUC-JP"，而不是拿 Shift-JIS 去问。
        // 例外：指定 UTF-8 时不能用它判（UTF-8 什么都编得出来，一段都过不了这条闸），
        // 那种情况退回 Shift-JIS 这个老判据。
        let 判正常: &str = match 目标表.first().copied() {
            Some("utf-8") | None => "shift_jis",
            Some(x) => x,
        };
        if encode(run, 判正常).is_some() {
            报告.push(SegmentReport {
                run: run.clone(),
                base,
                门槛: 增益门槛(段长),
                gain: 0.0,
                假名上升: 0.0,
                半角片假名: false,
                via: "none".into(),
                候选: vec![],
                applied: None,
                原因: format!("这一段本身就能编成 {判正常} —— 是正常日文，不动它"),
            });
            out.push_str(run);
            run.clear();
            return;
        }

        let mut 候选: Vec<RepairAttempt> = Vec::new();
        for a in ["gbk", "gb18030", "big5", "windows-1252"] {
            let Some(bytes) = encode(run, a) else { continue };
            for b in &目标表 {
                let Some((t, lossy)) = decode(&bytes, b) else { continue };
                if t == *run {
                    continue;
                }
                let sc = score(&t) - if lossy { 1.0 } else { 0.0 };
                候选.push(RepairAttempt {
                    via: format!("{a} -> {b}"),
                    score: sc,
                    text: t,
                });
            }
        }
        候选.sort_by(|x, y| {
            y.score
                .partial_cmp(&x.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        候选.truncate(6);

        let 上限 = 增益门槛(段长);
        let (gain, 假名上升, 半角片假名, 最好via) = match 候选.first() {
            Some(b) => (
                b.score - base,
                kana_ratio(&b.text) - kana_ratio(run),
                has_halfwidth_kana(&b.text),
                b.via.clone(),
            ),
            None => (0.0, 0.0, false, "none".to_string()),
        };

        // 用户点了「就用这个」：这一段按他指定的候选来，不再走自动判据
        if let Some((_, 选)) = 强制.iter().find(|(i, _)| *i == 第几段) {
            if let Some(c) = 候选.get(*选) {
                out.push_str(&c.text);
                报告.push(SegmentReport {
                    run: run.clone(),
                    base,
                    门槛: 上限,
                    gain,
                    假名上升,
                    半角片假名,
                    via: c.via.clone(),
                    候选: 候选.clone(),
                    applied: Some(*选),
                    原因: "按你选的候选改的".into(),
                });
                run.clear();
                return;
            }
        }

        // 自动判据：候选里没有半角片假名，再加**两条里任意一条**说明它真是乱码：
        //   ① 打分数那条（老判据）：增益过门槛 + 假名占比真的上升 —— 管带假名的那种；
        //   ② 结构那条：**gbk -> shift_jis** 无损回环 + 解出来的汉字都是常用字 ——
        //      管**纯汉字/纯符号**那种。
        //
        // 为什么第 ② 条**不再要求过增益门槛**：增益是打分数出来的，它对纯汉字乱码本来就瞎
        // （`夵曄尦` 两边都没假名、分数几乎不动，实测 gain 0.00 / 门槛 1.80）。
        // 而"这串字节按 Shift-JIS 能完整解出来、解出来的还都是 JIS 第 1 级汉字"
        // 不是"打高一分"，是**结构上说得通**，比打分数硬。留一条地板 `gain >= 0.0`：
        // 结构说得通但解出来反而更差的，不认。
        //
        // **为什么只认 `-> shift_jis` 这一路**：这条结构论证成立的前提是
        // "这段字本来是 Shift-JIS 的字节、被按 GBK 读坏了" —— 那是本工具要修的那个真实损伤，
        // 也正好解释得了"编回 GBK 后是一条合法 Shift-JIS 字节串"。
        // `-> euc-jp` / `-> big5` 那几路是**猜**，对它们没有这层道理，仍然得走打分数那条。
        // 实测踩过：不限定的话 `修复结果` 会被 `gbk -> euc-jp` 解成 `俐鹸潤惚`
        // （无损、四个字还都在 JIS 第 1 级）—— 就把一个**用户自己起的中文名**改坏了。
        let 结构说得通 = match 候选.first() {
            Some(c) => match c.via.split_once(" -> ") {
                Some((源, "shift_jis")) => 无损回环(run, 源, "shift_jis") && 汉字都常用(&c.text),
                _ => false,
            },
            None => false,
        };
        let 自动ok = 候选.first().is_some()
            && !半角片假名
            && ((gain > 上限 && 假名上升 >= 假名上升门槛) || (结构说得通 && gain >= 0.0));

        if 自动ok {
            let c = &候选[0];
            out.push_str(&c.text);
            报告.push(SegmentReport {
                run: run.clone(),
                base,
                门槛: 上限,
                gain,
                假名上升,
                半角片假名,
                via: c.via.clone(),
                候选,
                applied: Some(0),
                原因: String::new(),
            });
            run.clear();
            return;
        }

        let 原因 = if 候选.is_empty() {
            "候选为空：几种「读错 → 重读」的组合都编不回去，只能人工处理".to_string()
        } else if 半角片假名 {
            format!(
                "最好的候选（{}）里出现半角片假名 —— 那是中文被读坏的样子，不是日文乱码，没敢改",
                最好via
            )
        } else if 假名上升 < 假名上升门槛 {
            format!(
                "候选解出来假名只上升 {:.2}（要 {:.2} 起才认）—— 看着不像日文乱码（{}）",
                假名上升, 假名上升门槛, 最好via
            )
        } else {
            format!(
                "增益 {:.2} 没够门槛 {:.2}（{} 这条路能修，要就点「就用这个」）",
                gain, 上限, 最好via
            )
        };
        报告.push(SegmentReport {
            run: run.clone(),
            base,
            门槛: 上限,
            gain,
            假名上升,
            半角片假名,
            via: "none".into(),
            候选,
            applied: None,
            原因,
        });
        out.push_str(run);
        run.clear();
    };

    for c in text.chars() {
        if is_candidate(c) {
            run.push(c);
        } else {
            flush(&mut run, &mut out, &mut 报告, 强制);
            out.push(c);
        }
    }
    flush(&mut run, &mut out, &mut 报告, 强制);
    (out, 报告)
}

/// 旧签名（只给结果、不要交代）已经没人用了 —— 三个调用方都改成走 `repair_segments_at`，
/// 因为批量那页也要"没自动改的候选"来列表。留着就是第二份实现，删掉。

/// 核心：把一段乱码修回去。
///
/// `目标编码` 是操作者选的那一档（见 `目标编码表`）；`None` / `"自动认"` = 老行为。
#[tauri::command]
pub fn repair_text(text: String, 目标编码: Option<String>) -> RepairResult {
    let base = score(&text);
    let mut attempts: Vec<RepairAttempt> = Vec::new();

    // 读错的编码 → 编回字节 → 正确编码解出来
    // GBK 排前面是因为这是 MMD 圈里最常见的一条（中文系统 + 日文文件）
    let ins = ["gbk", "gb18030", "big5", "windows-1252"];
    let outs = 目标编码表(目标编码.as_deref());

    for a in ins {
        let Some(bytes) = encode(&text, a) else { continue };
        for b in &outs {
            let Some((t, lossy)) = decode(&bytes, b) else { continue };
            if t == text {
                continue;
            }
            let sc = score(&t) - if lossy { 1.0 } else { 0.0 };
            attempts.push(RepairAttempt { via: format!("{a} -> {b}"), score: sc, text: t });
        }
    }

    attempts.sort_by(|x, y| y.score.partial_cmp(&x.score).unwrap_or(std::cmp::Ordering::Equal));
    attempts.truncate(6);

    // 实际用的是分段修：候选列表按整段算，只是给人看"有哪几条路"
    let (fixed, 报告) = repair_segments_at(&text, &[], 目标编码.as_deref());
    let changed = fixed != text;
    let segs = 报告.iter().filter(|s| s.applied.is_some()).count();
    let seg_via = 报告
        .iter()
        .filter(|s| s.applied.is_some())
        .last()
        .map(|s| s.via.clone())
        .unwrap_or_else(|| "none".to_string());
    let via = if !changed {
        "none".to_string()
    } else if segs > 1 {
        format!("逐段修，{} 段（{}）", segs, seg_via)
    } else {
        seg_via
    };

    RepairResult {
        score_before: base,
        score_after: score(&fixed),
        original: text,
        fixed,
        changed,
        via,
        attempts,
        segments: 报告,
    }
}

/// 按用户选的候选修：`强制` 是 `(第几段, 用第几个候选)`。
///
/// 界面上的「就用这个」走这条 —— 自动判据够不着门槛时，人也能把这一段修回来。
/// 段号就是 `repair_text` 返回的 `segments` 下标；候选号是那一段 `候选` 的下标。
#[tauri::command]
pub fn repair_text_forced(
    text: String,
    强制: Vec<(usize, usize)>,
    mode: Option<String>,
    目标编码: Option<String>,
) -> RepairResult {
    let base = score(&text);
    let m = mode.unwrap_or_else(|| "whole".into());
    let (fixed, 报告) = if m == "fx-comments" {
        let (f, _, r) = fix_fx_comments_forced_at(&text, &强制, 目标编码.as_deref());
        (f, r)
    } else {
        repair_segments_at(&text, &强制, 目标编码.as_deref())
    };
    let changed = fixed != text;
    let segs = 报告.iter().filter(|s| s.applied.is_some()).count();
    let seg_via = 报告
        .iter()
        .filter(|s| s.applied.is_some())
        .last()
        .map(|s| s.via.clone())
        .unwrap_or_else(|| "none".to_string());
    let via = if !changed {
        "none".to_string()
    } else if segs > 1 {
        format!("逐段修，{segs} 段（{seg_via}）")
    } else {
        seg_via
    };
    RepairResult {
        score_before: base,
        score_after: score(&fixed),
        original: text,
        fixed,
        changed,
        via,
        attempts: vec![],
        segments: 报告,
    }
}

/// 注释**正文**在原文里的字节区间（不含 `//`、`/*`、`*/` 这些符号本身）。
///
/// .fx 里"哪儿算注释"只允许有一个答案：还原（本文件）和翻译（translate 那条路）
/// 都走这一份。两份实现漂开正是这个工程反复吃过亏的地方。
///
/// 按字节扫是安全的：UTF-8 的续字节都 ≥ 0x80，不会撞上 ASCII 的 `/` `*` `\n`。
fn comment_spans(text: &str) -> Vec<(usize, usize)> {
    let b = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < b.len() {
        if b[i] == b'/' && i + 1 < b.len() && b[i + 1] == b'/' {
            let start = i + 2;
            let mut end = start;
            while end < b.len() && b[end] != b'\n' {
                end += 1;
            }
            out.push((start, end));
            i = end;
            continue;
        }
        if b[i] == b'/' && i + 1 < b.len() && b[i + 1] == b'*' {
            let start = i + 2;
            // 找闭合的那两个字符。没闭合就吃到文件尾 —— 跟以前一样，
            // 不许因为一个漏闭合的括号把后面的代码全当成注释
            let mut j = start;
            while j + 1 < b.len() && !(b[j] == b'*' && b[j + 1] == b'/') {
                j += 1;
            }
            let 有闭合 = j + 1 < b.len();
            out.push((start, if 有闭合 { j } else { b.len() }));
            i = if 有闭合 { j + 2 } else { b.len() };
            continue;
        }
        i += 1;
    }
    out
}

/// 一个文件里"可翻译"的区间。
///
/// `.fx`/`.fxsub` 只给注释正文；纯文本类整篇算可翻译。
/// `mode` 的取值跟现有那条还原的路一致（`fx-comments` / 其它）。
fn piece_spans(text: &str, mode: &str) -> Vec<(usize, usize)> {
    if text.is_empty() {
        return vec![];
    }
    if mode == "fx-comments" {
        comment_spans(text)
    } else {
        vec![(0, text.len())]
    }
}

/// 只看注释的 .fx 模式：只重写 `//` 和 `/* */` 里的内容，代码一个字符都不碰。
///
/// 为什么单开一个模式：.fx 是能直接编译的，注释修坏了顶多是注释难看，
/// 但如果整文件乱改编码，把宏名或路径上的非 ASCII 改动一下就跑不起来了。
/// 老签名的薄包装（`fix_fx_comments_at(text, None)`）。
///
/// **现在只有测试在用**：上一轮把调用方全换成了带 `目标编码` 的 `_at` 变体，
/// 这两个包装就只剩断言在调 —— release 编译下会报 `dead_code`。
/// 留着是因为测试读起来短（大半断言只关心"默认那一档"），加 `#[cfg(test)]` 让
/// 发布版不再为它报警告。**要删就删，但记得把测试里那些调用一起改**。
#[cfg(test)]
fn fix_fx_comments(text: &str) -> (String, usize, Vec<SegmentReport>) {
    fix_fx_comments_at(text, None)
}

/// 同上，但可以带上操作者指定的目标编码（界面那一排预设）。
fn fix_fx_comments_at(text: &str, 目标: Option<&str>) -> (String, usize, Vec<SegmentReport>) {
    let 片段 = comment_spans(text);
    if 片段.is_empty() {
        return (text.to_string(), 0, vec![]);
    }
    let mut out = String::with_capacity(text.len());
    let mut fixed_count = 0usize;
    let mut 报告: Vec<SegmentReport> = Vec::new();
    let mut pos = 0usize;
    for (start, end) in 片段 {
        // 片段之间的东西（代码、`//`、`/*`、`*/`、换行）原样搬过去
        out.push_str(&text[pos..start]);
        let r = repair_text_quiet_at(&text[start..end], 目标);
        if r.changed {
            fixed_count += 1;
        }
        报告.extend(r.segments);
        out.push_str(&r.fixed);
        pos = end;
    }
    out.push_str(&text[pos..]);
    (out, fixed_count, 报告)
}

/// 带"用户指定候选"的注释模式。
///
/// 段号是**跨注释体连着的**（跟 `fix_fx_comments` 往外报的顺序一致），
/// 所以在每个注释体里要把全局段号减掉前面那些体已经占掉的段数。
fn fix_fx_comments_forced_at(
    text: &str,
    强制: &[(usize, usize)],
    目标: Option<&str>,
) -> (String, usize, Vec<SegmentReport>) {
    let 片段 = comment_spans(text);
    if 片段.is_empty() {
        return (text.to_string(), 0, vec![]);
    }
    let mut out = String::with_capacity(text.len());
    let mut fixed_count = 0usize;
    let mut 报告: Vec<SegmentReport> = Vec::new();
    let mut pos = 0usize;
    for (start, end) in 片段 {
        out.push_str(&text[pos..start]);
        let body = &text[start..end];
        let (探, 段数) = {
            let (_, r0) = repair_segments_at(body, &[], 目标);
            (r0, 0)
        };
        let 基 = 报告.len();
        let _ = 段数;
        let 局部: Vec<(usize, usize)> = 强制
            .iter()
            .filter(|(i, _)| *i >= 基 && *i < 基 + 探.len())
            .map(|(i, c)| (i - 基, *c))
            .collect();
        let (f, r) = repair_segments_at(body, &局部, 目标);
        if f != body {
            fixed_count += 1;
        }
        报告.extend(r);
        out.push_str(&f);
        pos = end;
    }
    out.push_str(&text[pos..]);
    (out, fixed_count, 报告)
}

/// 取一个文件里可翻译的段落，按出现顺序。
///
/// 给翻译那条路用：段落是**注释正文**（或整篇文本），
/// 写回时调 `apply_pieces` —— 它用同一份扫描重新定位，段落数对不上就报错。
#[tauri::command]
pub fn scan_pieces(text: String, mode: Option<String>) -> Vec<String> {
    let m = mode.unwrap_or_else(|| "whole".into());
    piece_spans(&text, &m)
        .into_iter()
        .map(|(s, e)| text[s..e].to_string())
        .collect()
}

/// 把译文按原位置写回。**只替换段落内容**，其余一个字节都不动。
///
/// 段落数是硬约束：数对不上立刻报错返回，宁可不写也不要把译文错位塞进文件。
#[tauri::command]
pub fn apply_pieces(
    text: String,
    mode: Option<String>,
    translations: Vec<String>,
) -> Result<String, String> {
    let m = mode.unwrap_or_else(|| "whole".into());
    let 片段 = piece_spans(&text, &m);
    if 片段.len() != translations.len() {
        return Err(format!(
            "段落数对不上：原文 {} 段，译文 {} 段 —— 没动文件",
            片段.len(),
            translations.len()
        ));
    }
    let mut out = String::with_capacity(text.len());
    let mut pos = 0usize;
    for ((start, end), t) in 片段.iter().zip(translations.iter()) {
        out.push_str(&text[pos..*start]);
        out.push_str(t);
        pos = *end;
    }
    out.push_str(&text[pos..]);
    Ok(out)
}

/// repair_text 的内部版：逐段修，不返回整段候选列表，批量跑的时候省内存。
/// （逐段的交代还是要的 —— 批量那页要据此列出"看着像乱码但没自动改"的给人挑。）
/// 老签名的薄包装（`repair_text_quiet_at(text, None)`）。**现在只有测试在用** ——
/// 同上，加 `#[cfg(test)]` 让发布版不再报 `dead_code`。
#[cfg(test)]
fn repair_text_quiet(text: &str) -> RepairResult {
    repair_text_quiet_at(text, None)
}

/// 同上，但可以带上操作者指定的目标编码（① 文本栏那一排预设）。
fn repair_text_quiet_at(text: &str, 目标: Option<&str>) -> RepairResult {
    let (fixed, 报告) = repair_segments_at(text, &[], 目标);
    let changed = fixed != text;
    let segs = 报告.iter().filter(|s| s.applied.is_some()).count();
    let seg_via = 报告
        .iter()
        .filter(|s| s.applied.is_some())
        .last()
        .map(|s| s.via.clone())
        .unwrap_or_else(|| "none".to_string());
    RepairResult {
        score_before: score(text),
        score_after: score(&fixed),
        original: text.to_string(),
        fixed,
        changed,
        via: if !changed {
            "none".into()
        } else if segs > 1 {
            format!("逐段修，{segs} 段（{seg_via}）")
        } else {
            seg_via
        },
        attempts: vec![],
        segments: 报告,
    }
}

// ---------------------------------------------------------------- 文件级

#[derive(Serialize)]
pub struct FileTextResult {
    pub path: String,
    pub rel: String,
    pub encoding: String,
    pub changed: bool,
    pub via: String,
    /// 命中的行号（前 40 个），给界面做"改哪儿了"的提示
    pub lines: Vec<usize>,
    pub before_sample: String,
    pub after_sample: String,
    pub written: bool,
    pub backup: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<DetectedText, String> {
    let bytes = fs::read(&path).map_err(|e| format!("读不了 {path}：{e}"))?;
    Ok(detect_text(bytes))
}

/// 读一个文件、按模式还原完，**把还原后的全文一起给出来**。
///
/// `fix_text_file` 只回"改了哪几行、改前改后长什么样"，够批量用；但 ① 那一页要拿
/// 还原后的**全文**接着做中文翻译，所以单开这一条（不然前端得自己再实现一遍注释扫描）。
#[derive(Serialize)]
pub struct FixedText {
    pub text: String,
    pub original: String,
    pub encoding: String,
    pub bom: bool,
    pub changed: bool,
    /// 逐段的交代。单文件那一页要拿它摆候选与「就用这个」
    pub segments: Vec<SegmentReport>,
}

#[tauri::command]
pub fn read_text_fixed(
    path: String,
    mode: Option<String>,
    target_encoding: Option<String>,
) -> Result<FixedText, String> {
    let bytes = fs::read(&path).map_err(|e| format!("读不了 {path}：{e}"))?;
    let det = detect_text(bytes);
    let m = mode.unwrap_or_else(|| "whole".into());
    let 目标 = target_encoding.as_deref();
    /* 用户 2026-09-24 报"选了文件之后点还原没反应"时查出：这条命令原来只收 path+mode，
       走的是 `repair_text_quiet` / `fix_fx_comments` 两个**保留老签名的薄包装** ——
       于是"在界面上选日文编码"这件事，在"选文件"这条路上**一次都没生效过**。
       现在把 `目标编码` 接进来（跟 `repair_text` / `fix_text_file` / `scan_text_files` / `scan_names`
       同一批口径），四栏才是一致的。 */
    let (fixed, 报告) = if m == "fx-comments" {
        let (f, _, 段) = fix_fx_comments_forced_at(&det.text, &[], 目标);
        (f, 段)
    } else {
        let one = repair_text_quiet_at(&det.text, 目标);
        (one.fixed, one.segments)
    };
    Ok(FixedText {
        changed: fixed != det.text,
        text: fixed,
        original: det.text,
        encoding: det.encoding,
        bom: det.bom,
        segments: 报告,
    })
}

/// 批量修。write=false 时只报"会改成什么"，不落盘。
///
/// `out_path`：
///   · `None` —— **原地改**，改之前在同目录留 `.bak`。
///   · `Some(p)` —— 写到 `p`，原文件一个字节都不动。`p` 的父目录不存在就建；
///     目标已经存在的话同样先留备份 —— 那是用户指定的地方，不能闷头覆盖。
#[tauri::command]
pub fn fix_text_file(
    path: String,
    write: Option<bool>,
    mode: Option<String>,
    encoding: Option<String>,
    out_path: Option<String>,
    目标编码: Option<String>,
) -> FileTextResult {
    let rel = Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let mut r = FileTextResult {
        path: path.clone(),
        rel,
        encoding: String::new(),
        changed: false,
        via: String::new(),
        lines: vec![],
        before_sample: String::new(),
        after_sample: String::new(),
        written: false,
        backup: None,
        error: None,
    };

    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            r.error = Some(format!("读不了：{}", io_hint(&e, Path::new(&path), false)));
            return r;
        }
    };

    let det = if let Some(enc) = encoding.as_deref().filter(|e| !e.is_empty()) {
        match decode(&bytes, enc) {
            Some((t, lossy)) => DetectedText { text: t, encoding: enc.to_string(), lossy, bom: false },
            None => detect_text(bytes.clone()),
        }
    } else {
        detect_text(bytes.clone())
    };
    r.encoding = det.encoding.clone();

    let mode = mode.unwrap_or_else(|| "whole".into());
    let (fixed, count) = if mode == "fx-comments" {
        let (f, n, _) = fix_fx_comments_at(&det.text, 目标编码.as_deref());
        (f, n)
    } else {
        let one = repair_text_quiet_at(&det.text, 目标编码.as_deref());
        (one.fixed, if one.changed { 1 } else { 0 })
    };

    if fixed == det.text {
        // 没变化也留个样本，界面上要能看见"读了什么"
        r.before_sample = first_interesting_line(&det.text);
        r.after_sample = r.before_sample.clone();
        return r;
    }

    r.changed = true;
    r.via = if mode == "fx-comments" {
        format!("注释 {count} 处")
    } else {
        "整文件".into()
    };

    // 找出变了哪些行，给界面用
    let before: Vec<&str> = det.text.lines().collect();
    let after: Vec<&str> = fixed.lines().collect();
    for (i, (a, b)) in before.iter().zip(after.iter()).enumerate() {
        if a != b {
            r.lines.push(i + 1);
            if r.before_sample.is_empty() {
                r.before_sample = a.trim().chars().take(120).collect();
                r.after_sample = b.trim().chars().take(120).collect();
            }
            if r.lines.len() >= 40 {
                break;
            }
        }
    }
    if r.before_sample.is_empty() {
        r.before_sample = first_interesting_line(&det.text);
        r.after_sample = first_interesting_line(&fixed);
    }

    if write.unwrap_or(false) {
        // 写到哪儿：给了 out_path 就另存，没给就原地改
        let dest = match out_path.as_deref().filter(|s| !s.is_empty()) {
            Some(o) => PathBuf::from(o),
            None => PathBuf::from(&path),
        };
        let in_place = dest == PathBuf::from(&path);

        let bytes_out = match encode_keep_bom(&fixed, &r.encoding, det.bom) {
            Some(b) => b,
            None => {
                r.error = Some(format!(
                    "按 {} 编不回去（原文里有这个编码装不下的字），已跳过，没动这个文件",
                    r.encoding
                ));
                r.changed = false;
                return r;
            }
        };

        // 另存的时候父目录可能还不存在。跨盘输出也一样走这条。
        if let Some(parent) = dest.parent() {
            if !parent.as_os_str().is_empty() && !parent.exists() {
                if let Err(e) = fs::create_dir_all(parent) {
                    r.error = Some(format!("建不了输出目录 {}：{}", parent.display(), io_hint(&e, parent, true)));
                    r.changed = false;
                    return r;
                }
            }
        }

        if dest.exists() {
            match crate::fsops::backup_public(&dest) {
                Ok(b) => r.backup = Some(b),
                Err(e) => {
                    r.error = Some(e);
                    r.changed = false;
                    return r;
                }
            }
        }
        if let Err(e) = fs::write(&dest, &bytes_out) {
            r.error = Some(format!("写不了：{}", io_hint(&e, &dest, true)));
            r.changed = false;
            return r;
        }
        r.written = true;
        if !in_place {
            // 界面要知道东西落到哪儿去了
            r.path = dest.to_string_lossy().to_string();
            r.rel = dest
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| r.rel.clone());
        }
    }
    r
}

/// 把 `io::Error` 翻译成"人话 + 该怎么办"。
///
/// 光抛 `Permission denied (os error 5)` 用户不知道该干什么 ——
/// 这三个是实际会撞上的：只读属性、被别的程序占着、盘符不存在。
fn io_hint(e: &std::io::Error, p: &Path, writing: bool) -> String {
    use std::io::ErrorKind::*;
    let what = if writing { "写" } else { "读" };
    match e.kind() {
        PermissionDenied => format!(
            "没有{what}权限：{}。文件可能被设成了只读，或者被别的程序占着（MMD / 编辑器 / 杀软扫描）。
右键 → 属性 → 去掉「只读」；占着的话先关掉那个程序再试。",
            p.display()
        ),
        NotFound => format!("找不到：{}", p.display()),
        AlreadyExists => format!("目标已经存在，而且不让覆盖：{}", p.display()),
        _ => format!("{what}不了 {}：{e}", p.display()),
    }
}

/// 挑一行"最像乱码"的当样本。
///
/// 早先按**分最低**挑，挑出来的全是 `#define XXX 1` 这种纯 ASCII 行 ——
/// ASCII 每个字加 0.3，比乱码那些汉字每个 0.6 还低，等于专挑最没信息的那行。
/// 改成按"含几个非 ASCII 字符"挑，乱码行必然一屏都是汉字。
fn first_interesting_line(text: &str) -> String {
    let mut best = String::new();
    let mut best_n = 0usize;
    for line in text.lines().take(600) {
        let t = line.trim();
        if t.chars().count() < 2 {
            continue;
        }
        let n = t.chars().filter(|c| !c.is_ascii()).count();
        if n > best_n {
            best_n = n;
            best = t.chars().take(120).collect();
        }
    }
    best
}

/// 取第一处"改前改后不一样"的行，给界面当样本。
/// 比上面那个准 —— 直接看结果，不用猜哪行像乱码。
fn first_changed_line(before: &str, after: &str) -> Option<(String, String)> {
    for (x, y) in before.lines().zip(after.lines()) {
        if x != y {
            return Some((
                x.trim().chars().take(120).collect(),
                y.trim().chars().take(120).collect(),
            ));
        }
    }
    None
}

/// 一批文件先扫一遍，报哪些看着像乱码，别一上来就写盘
#[derive(Serialize)]
pub struct ScanHit {
    pub path: String,
    pub rel: String,
    pub likely: bool,
    pub via: String,
    pub sample_before: String,
    pub sample_after: String,
    /// 看着像乱码、但**没自动改**的段（有候选、够不着门槛或信号不过）。
    /// 批量默认不敢动它们，但要摆出来让人自己挑 —— 不许静悄悄跳过。
    pub uncertain: Vec<SegmentReport>,
}

#[tauri::command]
pub fn scan_text_files(
    root: String,
    exts: Vec<String>,
    limit: Option<usize>,
    目标编码: Option<String>,
) -> Vec<ScanHit> {
    let want: Vec<String> = exts
        .into_iter()
        .map(|e| e.trim_start_matches('.').to_ascii_lowercase())
        .collect();
    let cap = limit.unwrap_or(500);
    let mut out = Vec::new();
    for entry in walkdir::WalkDir::new(&root)
        .into_iter()
        .filter_map(Result::ok)
        .take(cap * 20)
    {
        if out.len() >= cap {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let p = entry.path();
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !want.is_empty() && !want.iter().any(|w| *w == ext) {
            continue;
        }
        let Ok(bytes) = fs::read(p) else { continue };
        if bytes.len() > 4 * 1024 * 1024 {
            continue;
        }
        // 全 ASCII 的文件不用看，乱码必然带非 ASCII
        if bytes.iter().all(|b| b.is_ascii()) {
            continue;
        }
        let det = detect_text(bytes);
        if det.text.is_empty() {
            continue;
        }
        let r = repair_text_quiet_at(&det.text, 目标编码.as_deref());
        let rel = p
            .strip_prefix(&root)
            .unwrap_or(p)
            .to_string_lossy()
            .replace('\\', "/");
        // 样本优先取"实际改了的那一行"，没有改动的文件才退回按非 ASCII 数量挑
        let (sample_before, sample_after) = match first_changed_line(&det.text, &r.fixed) {
            Some(pair) => pair,
            None => {
                let l = first_interesting_line(&det.text);
                (l.clone(), l)
            }
        };
        out.push(ScanHit {
            path: p.to_string_lossy().to_string(),
            rel,
            likely: r.changed,
            via: r.via.clone(),
            sample_before,
            sample_after,
            uncertain: r
                .segments
                .iter()
                .filter(|s| s.applied.is_none() && !s.候选.is_empty())
                .cloned()
                .collect(),
        });
    }
    out
}

// ---------------------------------------------------------------- 名字还原

/// 一个名字（文件或目录）的还原交代。
///
/// 为什么单开这条路：语料 `实战测试用例\乱码翻译\` 里**正文是好的、乱的是名字**
/// （`00_僔僃乕僟乕傪嵞攝晍偡傞偲偒偺拄堄揰.txt` 这种），而以前整个工具对名字一个字符都不动。
#[derive(Serialize)]
pub struct NameHit {
    pub path: String,
    pub dir: String,
    /// 现在的名字（最后一段）
    pub 原名: String,
    /// 修过之后的名字
    pub 修后名: String,
    /// 自动判据认了没有
    pub 自动可改: bool,
    pub 原因: String,
    /// 这一名字里所有候选，界面摆出来给人挑（点「就用这个」整名替换）
    pub 候选: Vec<RepairAttempt>,
}

/// 扫一遍目录树，把**名字**像乱码的挑出来。
///
/// 只报"能修"或"有候选"的 —— 名字多起来（几千个）全列出来没法看。
#[tauri::command]
pub fn scan_names(root: String, limit: Option<usize>, 目标编码: Option<String>) -> Vec<NameHit> {
    let cap = limit.unwrap_or(2000);
    let mut out = Vec::new();
    for entry in walkdir::WalkDir::new(&root)
        .into_iter()
        .filter_map(Result::ok)
        .take(cap * 4)
    {
        if out.len() >= cap {
            break;
        }
        // 根目录自己不参与（改它等于改用户选的路径）
        if entry.path() == Path::new(&root) {
            continue;
        }
        let Some(名) = entry.file_name().to_str().map(|s| s.to_string()) else {
            continue;
        };
        if 名.is_ascii() {
            continue;
        }
        let r = repair_text_quiet_at(&名, 目标编码.as_deref());
        let 候选: Vec<RepairAttempt> = r
            .segments
            .iter()
            .flat_map(|s| s.候选.iter().cloned())
            .collect();
        let 自动可改 = r.changed;
        if !自动可改 && 候选.is_empty() {
            continue;
        }
        let 原因 = if 自动可改 {
            String::new()
        } else {
            r.segments
                .iter()
                .find(|s| !s.原因.is_empty())
                .map(|s| s.原因.clone())
                .unwrap_or_else(|| "看着像乱码，但没到自动改的程度".into())
        };
        let p = entry.path();
        out.push(NameHit {
            path: p.to_string_lossy().to_string(),
            dir: p
                .parent()
                .map(|d| d.to_string_lossy().to_string())
                .unwrap_or_default(),
            原名: 名,
            修后名: r.fixed,
            自动可改,
            原因,
            候选,
        });
    }
    out
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RenameDone {
    pub from: String,
    pub to: String,
}

#[derive(Serialize, Debug)]
pub struct RenameFailed {
    pub from: String,
    pub 原因: String,
}

#[derive(Serialize)]
pub struct RenameReport {
    pub done: Vec<RenameDone>,
    pub failed: Vec<RenameFailed>,
}

/// 按计划改名。**不覆盖同名**：目标已经存在就跳过并说明。
///
/// 计划里同时有目录和它里面的东西时要**先深后浅**（先改里面的）——
/// 这里排一次序兜底，免得用户那边的顺序不对就全废。
#[tauri::command]
pub fn rename_entries(计划: Vec<RenameDone>) -> RenameReport {
    let mut 表 = 计划;
    表.sort_by_key(|x| std::cmp::Reverse(x.from.matches(['\\', '/']).count()));
    let mut done = Vec::new();
    let mut failed = Vec::new();
    for it in 表 {
        let from = PathBuf::from(&it.from);
        let Some(dir) = from.parent() else {
            failed.push(RenameFailed {
                from: it.from.clone(),
                原因: "拿不到所在目录".into(),
            });
            continue;
        };
        let to = dir.join(&it.to);
        if to.exists() && to != from {
            failed.push(RenameFailed {
                from: it.from.clone(),
                原因: format!("目标已经存在，不动它：{}", to.display()),
            });
            continue;
        }
        match fs::rename(&from, &to) {
            Ok(()) => done.push(RenameDone {
                from: it.from,
                to: to.to_string_lossy().to_string(),
            }),
            Err(e) => failed.push(RenameFailed {
                from: it.from.clone(),
                原因: io_hint(&e, &from, true),
            }),
        }
    }
    RenameReport { done, failed }
}

/// 改名回滚：把日志里的 from→to 反过来做一遍。
#[tauri::command]
pub fn undo_renames(日志: Vec<RenameDone>) -> RenameReport {
    let 反: Vec<RenameDone> = 日志
        .into_iter()
        .rev()
        .map(|x| RenameDone {
            from: x.to,
            to: PathBuf::from(&x.from)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| x.from.clone()),
        })
        .collect();
    rename_entries(反)
}

// ---------------------------------------------------------------- 测试

#[cfg(test)]
mod tests2 {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "robin-namefix-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|x| x.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// 语料里那几个乱码名字：**必须能自动修成正确日文**。
    ///
    /// 这是 §7.1 那一条的靶子。以前它们增益 1.44/1.55/1.75 够不着固定门槛 1.8，
    /// 被原样丢回给用户 —— 用户的原话就是"别给我丢回乱码"。
    ///
    /// 字串是从真目录 `实战测试用例\乱码翻译\` 里**扫出来照抄**的（`dump_corpus_names`），
    /// 别照着报告手打 —— 我第一版把 `拲堄揰` 打成了 `拄堄揰`，那一版就修不出来，
    /// 白白怀疑了半小时"字节对齐"。
    #[test]
    fn corpus_file_names_are_auto_repaired() {
        for (bad, good) in [
            (
                "00_僔僃乕僟乕傪嵞攝晍偡傞偲偒偺拲堄揰.txt",
                "00_シェーダーを再配布するときの注意点.txt",
            ),
            ("捛壛儌乕僼.csv", "追加モーフ.csv"),
            ("傾僯儊晽夋柺僗僋儕乕儞.exa", "アニメ風画面スクリーン.exa"),
        ] {
            let r = repair_text_quiet(bad);
            assert!(r.changed, "{bad:?} 应该被自动修（它是真乱码）");
            assert_eq!(r.fixed, good, "{bad:?} 应修成 {good:?}，实得 {}", r.fixed);
        }
    }

    /// 端到端还原实例量具（`cargo test --lib -- --ignored --nocapture dump_e2e_cases`）。
    ///
    /// 为什么要它：用户问"所以之前你是完全不修复乱码的吗"，这种问题**不能拿单测搪塞** ——
    /// 得把真输入的原始输出摆出来。四类都要有：
    ///   ① 会自动修的典型乱码；
    ///   ② **按真实成因构造**的（日文 → SJIS 字节 → 按 GBK 读出来），看它能不能原样还原回去；
    ///   ③ 够不着门槛但候选是对的（语料里那几个名字）；
    ///   ④ 中日记混（整段一起修会把中文那半变成假名垃圾，分段才对）；
    ///   ⑤ 本来就正常、不该被动（防假阳性）。
    #[test]
    #[ignore]
    fn dump_e2e_cases() {
        /// 按真实成因造乱码：日文 → Shift-JIS 字节 → 按 GBK 读出来。
        fn 造乱码(日文: &str) -> String {
            let (bytes, _, err) = SHIFT_JIS.encode(日文);
            assert!(!err, "造样本要求这段日文能编进 SJIS：{日文}");
            let (乱, _, _) = GBK.decode(&bytes);
            乱.into_owned()
        }

        let mut 例: Vec<(&str, String)> = Vec::new();
        例.push(("① 会自动修（典型）", "僐儞僩儘乕儔乕".into()));
        例.push(("① 会自动修（典型）", "僥僋僗僠儍".into()));
        for 原 in [
            "テクスチャの設定を変更する",
            "モデルを黒く塗りつぶすエフェクト",
            "シェーダーを再配布するときの注意点",
            "この影は影の色を追加します",
        ] {
            例.push(("② 按真实成因构造（SJIS 字节被按 GBK 读）", 造乱码(原)));
        }
        for 名 in [
            "00_僔僃乕僟乕傪嵞攝晍偡傞偲偒偺拲堄揰.txt",
            "捛壛儌乕僼.csv",
            "傾僯儊晽夋柺僗僋儕乕儞.exa",
        ] {
            例.push(("③ 语料里那三个名字（旧门槛 1.8 够不着，现在自动修）", 名.into()));
        }
        for 名 in ["巊偄曽.txt", "readme(恓嬥P).txt"] {
            例.push((
                "③b 真够不着门槛、走「就用这个」手动候选（短串档仍是 1.8）",
                名.into(),
            ));
        }
        例.push((
            "④ 中日记混（整段修会把中文那半变假名垃圾）",
            "材质名：僥僋僗僠儍_01 // 这是注释".into(),
        ));
        例.push((
            "④ 中日记混（中文批注 + 日文注释同处一行）",
            "// テクスチャの設定（材质设置）".into(),
        ));
        for 正常 in [
            "// シャドウ用Zバッファのぼかし読み取り",
            "部分",
            "中心",
            "这是一段正常的中文注释",
        ] {
            例.push(("⑤ 本来就正常、不该动", 正常.into()));
        }

        for (类, 入) in 例 {
            let r = repair_text_quiet(&入);
            println!("\n【{类}】");
            println!("  输入：{入:?}");
            println!("  输出：{:?}", r.fixed);
            println!(
                "  改了={}　得分 {:.2} → {:.2}",
                r.changed, r.score_before, r.score_after
            );
            for s in &r.segments {
                println!(
                    "  段 {:?}（{} 字）base {:.2}｜增益 {:.2}｜门槛 {:.2}｜假名上升 {:.2}｜半角 {}｜applied {:?}",
                    s.run,
                    s.run.chars().count(),
                    s.base,
                    s.gain,
                    s.门槛,
                    s.假名上升,
                    s.半角片假名,
                    s.applied
                );
                if let Some(c) = s.候选.first() {
                    println!("    最好候选（{}）：{:?}", c.via, c.text);
                    for (i, 另) in s.候选.iter().skip(1).take(2).enumerate() {
                        println!("    其他候选{}：{:?}（{}）", i + 2, 另.text, 另.via);
                    }
                }
                if !s.原因.is_empty() {
                    println!("    没自动改的原因：{}", s.原因);
                }
            }
        }
    }

    /// 反过来的边界：真目录里还有几个**够不着门槛**的（`巊偄曽.txt` → `使い方`、
    /// `readme(恓嬥P).txt` → `針金`、`傾僯儊晽Toon.exa` → `アニメ風`）。
    /// 这几个不自动改是对的（短串那一档门槛严），但**候选必须摆出来**、
    /// 并且点「就用这个」能真改成正确日文 —— 不许静悄悄跳过。
    #[test]
    fn below_margin_names_still_offer_the_right_candidate() {
        // 候选是**段级**的（`使い方`），「就用这个」替换的是那一段，
        // 整名结果才是 `使い方.txt` —— 这两层别混。
        for (bad, 候选, 整名) in [
            ("巊偄曽.txt", "使い方", "使い方.txt"),
            ("readme(恓嬥P).txt", "針金", "readme(針金P).txt"),
        ] {
            let r = repair_text_quiet(bad);
            let 段号 = r
                .segments
                .iter()
                .position(|s| s.候选.iter().any(|c| c.text == 候选))
                .unwrap_or_else(|| {
                    panic!(
                        "{bad:?} 的候选里应当有 {候选:?}，实得 {:?}",
                        r.segments
                            .iter()
                            .map(|s| s.候选.iter().map(|c| c.text.clone()).collect::<Vec<_>>())
                            .collect::<Vec<_>>()
                    )
                });
            let 号 = r.segments[段号]
                .候选
                .iter()
                .position(|c| c.text == 候选)
                .unwrap();
            let 强制 = repair_text_forced(bad.to_string(), vec![(段号, 号)], None, None);
            assert_eq!(
                强制.fixed, 整名,
                "{bad:?} 点「就用这个」之后应当是 {整名:?}"
            );
        }
    }

    /// 假阳性回归 ①：那三个踩过的汉字词**不许**被半改（§6.2b 明确要求）。
    /// 它们都在"短串"那一档（≤4 字），门槛仍然是 1.8。
    #[test]
    fn false_positives_kanji_words_stay_untouched() {
        for s in ["部分", "手動", "平面", "中心", "設定"] {
            let r = repair_text_quiet(s);
            assert!(!r.changed, "{s:?} 不许被改；实得 {:?}", r.fixed);
        }
    }

    /// 假阳性回归 ②：**长**简体中文串也不许被改。
    /// 这是降门槛（长串 1.2）之后新暴露出来的风险面，所以单独钉一条：
    /// 它编不进 Shift-JIS（简体字不在 SJIS 里），会走到候选那条路上去。
    #[test]
    fn false_positives_long_chinese_stay_untouched() {
        for s in [
            "这是一段正常的中文注释",
            "模型材质贴图设定面板",
            "这个是给模型的法线贴图",
            "骨骼动作数据导入",
        ] {
            let r = repair_text_quiet(s);
            assert!(!r.changed, "{s:?} 是中文，不许被改；实得 {:?}", r.fixed);
            // 而且要说得出为什么没改
            let 段 = r
                .segments
                .iter()
                .find(|x| x.run == s)
                .unwrap_or_else(|| panic!("{s:?} 应该有逐段交代"));
            assert!(!段.原因.is_empty(), "{s:?} 没自动改就要说明原因");
            // 中文段就算有候选，也不许带半角片假名之外的"像日文"的假名上升
            if !段.候选.is_empty() {
                assert!(
                    段.假名上升 < 假名上升门槛 || 段.半角片假名,
                    "{s:?} 是中文，凭什么看着像日文乱码？（假名上升 {:.2}）",
                    段.假名上升
                );
            }
        }
    }

    /// 假名占比上升这条正信号：中文被读坏的样子里大半是**半角**片假名，不算假名。
    #[test]
    fn kana_ratio_ignores_halfwidth() {
        assert_eq!(kana_ratio("ｲﾄﾖﾊﾃ"), 0.0, "半角片假名不算假名");
        assert_eq!(kana_ratio("テクスチャ"), 1.0, "全角片假名算");
        assert!(kana_ratio("追加モーフ") > 0.5, "混排也该过 0.5");
        assert!(has_halfwidth_kana("ｲﾄﾖﾊﾃ"));
        assert!(!has_halfwidth_kana("シェーダー"));
    }

    /// 门槛按段长分档：短串严、长串松（这就是那三个名字能被修的原因）
    #[test]
    fn margin_is_tiered_by_length() {
        assert_eq!(增益门槛(2), 1.8);
        assert_eq!(增益门槛(4), 1.8);
        assert_eq!(增益门槛(5), 1.2);
        assert_eq!(增益门槛(40), 1.2);
    }

    /// 够不着门槛时：**候选要摆出来**，不能只回原文（§6.2a / §7.3）。
    #[test]
    fn below_margin_still_reports_candidates() {
        // `愝掕` 是 `設定` 被读坏的样子，能不能自动改不保证 —— 但候选必须有交代
        let r = repair_text_quiet("愝掕");
        let 段 = &r.segments[0];
        assert_eq!(段.run, "愝掕");
        if !r.changed {
            assert!(!段.候选.is_empty(), "没自动改就必须给出候选");
            assert!(段.applied.is_none());
            assert!(!段.原因.is_empty(), "要说清为什么没自动改");
        }
    }

    /// 转坏两次的（锟斤拷）救不回来：不许自动改，也不许拿一条像模像样的候选骗人。
    /// （老测试只断言"原样返回"，这里再钉一条：它给出的交代必须是"没自动改"。）
    #[test]
    fn destroyed_text_is_never_auto_applied() {
        let r = repair_text_quiet("锟斤拷锟斤拷");
        assert!(!r.changed);
        assert!(
            r.segments.iter().all(|s| s.applied.is_none()),
            "这种救不回来的，一个段都不许自动应用"
        );
        for s in &r.segments {
            if !s.原因.is_empty() {
                continue;
            }
            panic!("{}：没自动改就要说明原因", s.run);
        }
    }

    /// 「就用这个」：强制指定候选之后，那一段必须真的用上
    #[test]
    fn forced_choice_applies_the_candidate() {
        let 原文 = "愝掕";
        let 探 = repair_text_quiet(原文);
        let 段 = 探.segments.iter().position(|s| s.run == 原文).unwrap();
        assert!(!探.segments[段].候选.is_empty(), "要有一条候选才谈得上强制");
        let 好 = 探.segments[段].候选[0].text.clone();

        let r = repair_text_forced(原文.to_string(), vec![(段, 0)], None, None);
        assert!(r.fixed.contains(&好), "强制之后应当用上那条候选：{}", r.fixed);
        assert_eq!(r.segments[段].applied, Some(0));
        assert!(r.segments[段].原因.contains("按你选的"));
    }

    /// 强制也要**只动那一段**：旁边的正常日文不许被牵连
    #[test]
    fn forced_choice_leaves_the_rest_alone() {
        let 原文 = "設定 愝掕 モデル";
        let 探 = repair_text_quiet(原文);
        let 段 = 探.segments.iter().position(|s| s.run == "愝掕").unwrap();
        let r = repair_text_forced(原文.to_string(), vec![(段, 0)], None, None);
        assert!(r.fixed.contains("設定"), "前面的正常日文不许动：{}", r.fixed);
        assert!(r.fixed.contains("モデル"), "后面的也不许动：{}", r.fixed);
    }

    /// 注释模式下挑候选：**代码行一个字符都不许动**（跟自动那条同一把尺子）。
    #[test]
    fn forced_choice_in_comment_mode_leaves_code_untouched() {
        let src = "float4 main() {\n  // 巊偄曽\n  #define TEX \"a.png\"\n  return 0;\n}\n";
        let 探 = repair_text_quiet("巊偄曽");
        let 段号 = 探.segments.iter().position(|s| s.候选.iter().any(|c| c.text == "使い方"));
        let 段号 = 段号.expect("`巊偄曽` 的候选里该有 `使い方`");
        let 号 = 探.segments[段号]
            .候选
            .iter()
            .position(|c| c.text == "使い方")
            .unwrap();

        let (out, _, 报告) = fix_fx_comments_forced_at(src, &[(段号, 号)], None);
        assert!(out.contains("// 使い方"), "注释该被改成日文：{out}");
        assert!(out.contains("#define TEX \"a.png\""), "代码一个字符都不许动：{out}");
        assert!(out.contains("float4 main() {"), "函数头也不许动：{out}");
        assert_eq!(报告.len(), 1, "只该报一个段（那句注释里只有一段候选字符）");
    }

    /// 名字还原：扫得出来、报得出修后名（在临时目录里造副本跑，不碰素材）
    #[test]
    fn scan_names_finds_mojibake_names() {
        let d = tmpdir("scan");
        let 子 = d.join("00_僔僃乕僟乕傪嵞攝晍偡傞偲偒偺拄堄揰");
        fs::create_dir_all(&子).unwrap();
        fs::write(d.join("捛壛儌乕僼.csv"), b"x").unwrap();
        fs::write(d.join("normal.txt"), b"x").unwrap();
        let hits = scan_names(d.to_string_lossy().into(), None, None);
        let 名: Vec<&str> = hits.iter().map(|h| h.原名.as_str()).collect();
        assert!(名.contains(&"捛壛儌乕僼.csv"), "乱码文件要进表：{名:?}");
        assert!(名.contains(&"00_僔僃乕僟乕傪嵞攝晍偡傞偲偒偺拄堄揰"), "乱码目录要进表：{名:?}");
        assert!(!名.contains(&"normal.txt"), "正常名字不该进表");
        let 文件 = hits.iter().find(|h| h.原名 == "捛壛儌乕僼.csv").unwrap();
        assert_eq!(文件.修后名, "追加モーフ.csv");
        assert!(文件.自动可改);
        let _ = fs::remove_dir_all(&d);
    }

    /// 改名：真改、不覆盖同名、能回滚
    #[test]
    fn rename_refuses_to_overwrite_and_can_roll_back() {
        let d = tmpdir("rename");
        let 坏 = d.join("捛壛儌乕僼.csv");
        fs::write(&坏, b"x").unwrap();
        fs::write(d.join("追加モーフ.csv"), "好".as_bytes()).unwrap(); // 目标已存在

        let r = rename_entries(vec![RenameDone {
            from: 坏.to_string_lossy().into(),
            to: "追加モーフ.csv".into(),
        }]);
        assert!(r.done.is_empty(), "目标已存在时不许覆盖");
        assert_eq!(r.failed.len(), 1);
        assert!(r.failed[0].原因.contains("目标已经存在"));
        assert!(坏.exists(), "原文件还在");

        // 换一个不冲突的目标，改成功之后回滚
        let r2 = rename_entries(vec![RenameDone {
            from: 坏.to_string_lossy().into(),
            to: "追加モーフ2.csv".into(),
        }]);
        assert_eq!(r2.done.len(), 1, "不该失败：{:?}", r2.failed);
        let 新 = d.join("追加モーフ2.csv");
        assert!(新.exists() && !坏.exists());
        let back = undo_renames(r2.done);
        assert_eq!(back.done.len(), 1, "回滚该成功：{:?}", back.failed);
        assert!(坏.exists(), "回滚之后原名回来了");
        assert!(!新.exists());
        let _ = fs::remove_dir_all(&d);
    }

    /// 批量扫：看着像乱码、但**没自动改**的段要单列出来（§6.2d）
    #[test]
    fn scan_lists_uncertain_segments() {
        let d = tmpdir("uncertain");
        // 中文段（编不进 SJIS）会被走到候选那条路；只要没自动改、又有候选，就该进 uncertain
        fs::write(d.join("a.txt"), "这是一段正常的中文注释".as_bytes()).unwrap();
        let hits = scan_text_files(d.to_string_lossy().into(), vec![], None, None);
        let 有 = hits.iter().any(|h| h.uncertain.iter().any(|s| !s.候选.is_empty()));
        assert!(有, "中文段没自动改时应当进 uncertain 列表给人挑");
        for h in &hits {
            for s in &h.uncertain {
                assert!(s.applied.is_none());
                assert!(!s.候选.is_empty());
            }
        }
        let _ = fs::remove_dir_all(&d);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 圈里最常见的样本：日文原文是 Shift-JIS，被当 GBK 读出来。
    /// 这些对子是拿真实文件名核对过的（贴图样本目录里就有这种名字）。
    const PAIRS: &[(&str, &str)] = &[
        ("僐儞僩儘乕儔乕", "コントローラー"),
        ("僥僋僗僠儍", "テクスチャ"),
        ("僔僃乕僟乕", "シェーダー"),
        ("僙僢僩", "セット"),
        ("儌僨儖", "モデル"),
        ("儊僞儕僢僋", "メタリック"),
    ];

    #[test]
    fn repairs_known_mojibake() {
        for (bad, good) in PAIRS {
            let r = repair_text_quiet(bad);
            assert_eq!(r.fixed, *good, "{bad} 应该还原成 {good}，实得 {}", r.fixed);
            assert!(r.changed);
        }
    }

    /// 混合文本：乱码夹在正常文字里也要能整段修好
    #[test]
    fn repairs_inside_a_sentence() {
        let src = "材质名：僥僋僗僠儍_01 // 这是注释";
        let r = repair_text_quiet(src);
        assert!(r.fixed.contains("テクスチャ_01"), "实得 {}", r.fixed);
        assert!(r.fixed.contains("这是注释"), "中文部分不该被改坏：{}", r.fixed);
    }

    /// 已经是正常文字的，一分都不许动。
    /// 这是最重要的一条：宁可不改，也不能把好好的文件改坏。
    #[test]
    fn leaves_normal_text_alone() {
        for s in [
            "这是一段正常的中文注释",
            "これは正常な日本語のコメントです",
            "// 普通の英語コメント",
            "材质 テクスチャ 混排",
            "",
        ] {
            let r = repair_text_quiet(s);
            assert!(!r.changed, "{s:?} 不该被判定为乱码，结果 {}", r.fixed);
            assert_eq!(r.fixed, *s);
        }
    }

    /// 已经转坏一次的（锟斤拷）救不回来，但也不许乱改
    #[test]
    fn does_not_guess_on_destroyed_text() {
        let r = repair_text_quiet("锟斤拷锟斤拷");
        assert_eq!(r.fixed, "锟斤拷锟斤拷");
    }

    #[test]
    fn reads_bom_and_utf8() {
        let mut with_bom = vec![0xEF, 0xBB, 0xBF];
        with_bom.extend_from_slice("你好".as_bytes());
        let d = detect_text(with_bom);
        assert_eq!(d.text, "你好");
        assert_eq!(d.encoding, "utf-8");
        assert!(d.bom);
    }

    /// Shift-JIS 的字节（没有 BOM）应该被认成 shift_jis
    #[test]
    fn detects_shift_jis() {
        let bytes = vec![0x83, 0x52, 0x83, 0x93, 0x83, 0x67]; // コント
        let d = detect_text(bytes);
        assert_eq!(d.text, "コント");
        assert_eq!(d.encoding, "shift_jis");
    }

    /// 只改注释：代码段一个字符都不能动
    #[test]
    fn fx_comment_mode_leaves_code_untouched() {
        let src = "float4 main() {\n  // 僐儞僩儘乕儔乕\n  return float4(1,1,1,1);\n}\n";
        let (out, n, _) = fix_fx_comments(src);
        assert_eq!(n, 1);
        assert!(out.contains("コントローラー"), "实得 {out}");
        assert!(out.contains("return float4(1,1,1,1);"), "代码被动了：{out}");
        assert_eq!(out.matches("float4 main()").count(), 1);
    }

    /// 行注释里的 `//` 之后的代码不能被波及 —— 这里主要是确认边界没错位
    #[test]
    fn fx_comment_mode_keeps_structure() {
        let src = "// a\nx = 1;\n/* b */\ny = 2;\n";
        let (out, _, _) = fix_fx_comments(src);
        assert_eq!(out, src, "没有乱码时整体必须原样：{out}");
    }
}

/// 真语料上的残留量：`cargo test --lib -- --ignored --nocapture corpus_residual`
///
/// 素材 `实战测试用例\乱码翻译\`（**只读**，只读不写）。量三件事：
///   ① 多少文本文件、多少个还原动了；
///   ② 还原之后还剩多少处"乱码特征串"——特征串的字符取自已知的乱码样本
///      （`僐儞僩儘乕儔乕` 那一类：GBK 把日文假名的字节拆开读出来的汉字，
///      正常日文里根本不会出现），连续 ≥2 个才算一处；
///   ③ 抽几条残留打出来给人看，免得只有数字没有样子。
#[cfg(test)]
mod corpus_report {
    use super::*;
    use std::path::PathBuf;

    /// 已知乱码样本里出现过的字符。正常日文文本不会用到它们。
    const 乱码字符: &str = "僐儞僩儘乕儔僥僋僗僠儍僔僃乕僟僙僢儌僨儖儊僞儕僢僋偲偒偺拲堄揰嵞攝晍偡傞奐巒実峴奨帪応強";

    /// 一串里连续多少个乱码字符才算"一处残留"
    const 最少连字: usize = 2;

    /// 一段文本里残留了几处乱码特征串，并给出第一处长什么样
    fn 残留(text: &str) -> (usize, String) {        let 集: Vec<char> = 乱码字符.chars().collect();
        let mut 处 = 0usize;
        let mut 样子 = String::new();
        let mut 连 = 0usize;
        let mut 起 = 0usize;
        for (i, c) in text.chars().enumerate() {
            if 集.contains(&c) {
                if 连 == 0 {
                    起 = i;
                }
                连 += 1;
                if 连 == 最少连字 {
                    处 += 1;
                    if 样子.is_empty() {
                        let s: String = text.chars().skip(起.saturating_sub(6)).take(30).collect();
                        样子 = s.replace('\n', " ");
                    }
                }
            } else {
                连 = 0;
            }
        }
        (处, 样子)
    }

    #[test]
    #[ignore]
    fn corpus_residual() {
        let root = PathBuf::from(r"E:\deepseek-harness\mmd集成工具\实战测试用例\乱码翻译");
        if !root.exists() {
            println!("没有素材目录 {root:?}，跳过");
            return;
        }
        let 想看的 = ["fx", "fxsub", "txt", "csv", "x", "xml", "md", "log", "json", "conf", "ini"];

        let mut 文件数 = 0usize;
        let mut 有改动 = 0usize;
        let mut 改动处 = 0usize;
        let mut 修前残留 = 0usize;
        let mut 修后残留 = 0usize;
        let mut 漏网文件 = 0usize;
        let mut 样本: Vec<String> = Vec::new();
        let mut 抽样: Vec<String> = Vec::new();
        let mut 编码统计: std::collections::BTreeMap<String, usize> = Default::default();

        for entry in walkdir::WalkDir::new(&root).into_iter().filter_map(Result::ok) {
            if !entry.file_type().is_file() {
                continue;
            }
            let p = entry.path();
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
            if !想看的.contains(&ext.as_str()) {
                continue;
            }
            let Ok(bytes) = fs::read(p) else { continue };
            if bytes.len() > 8 * 1024 * 1024 {
                continue;
            }
            let det = detect_text(bytes);
            if det.text.is_empty() {
                continue;
            }
            文件数 += 1;
            *编码统计.entry(det.encoding.clone()).or_default() += 1;

            let 前 = 残留(&det.text).0;
            let (fixed, n) = if ext == "fx" || ext == "fxsub" {
                let (f, n, _) = fix_fx_comments(&det.text);
                (f, n)
            } else {
                let r = repair_text_quiet(&det.text);
                (r.fixed, usize::from(r.changed))
            };
            if fixed != det.text {
                有改动 += 1;
                改动处 += n;
            }
            let (后, 样子) = 残留(&fixed);
            修前残留 += 前;
            修后残留 += 后;
            if 后 > 0 && 前 > 0 {
                漏网文件 += 1;
                if 样本.len() < 12 {
                    样本.push(format!(
                        "{} 处 {后}  ｜{}",
                        p.strip_prefix(&root).unwrap_or(p).display(),
                        样子
                    ));
                }
            }
            /* 抽几行原样打出来：数字要能被复核 —— 只看"0 个有改动"没法判断
               到底是"内容本来就没乱"还是"工具漏了" */
            if 抽样.len() < 10 {
                let 行 = det.text.lines().find(|l| l.chars().any(|c| !c.is_ascii())).unwrap_or("");
                if !行.trim().is_empty() {
                    抽样.push(format!(
                        "{}  [{}]  {}",
                        p.strip_prefix(&root).unwrap_or(p).display(),
                        det.encoding,
                        行.trim().chars().take(60).collect::<String>()
                    ));
                }
            }
        }

        println!("\n【真语料还原报告】{root:?}");
        println!("  文本文件 {文件数} 个，还原动了 {有改动} 个（改动 {改动处} 处）");
        println!("  编码分布：{编码统计:?}");
        println!("  乱码特征串：修前 {修前残留} 处 → 修后 {修后残留} 处");
        println!("  修前有特征串、修后仍有残留的文件：{漏网文件} 个");
        for s in &样本 {
            println!("    · {s}");
        }
        println!("\n  抽样子（文件 [认出的编码] 第一行非 ASCII 文本）—— 复核「0 改动」对不对：");
        for s in &抽样 {
            println!("    {s}");
        }

        /* ---- 文件的**名字**才是这批语料里真正乱掉的那部分 ---- */
        let mut 名总数 = 0usize;
        let mut 名有非ascii = 0usize;
        let mut 名能修 = 0usize;
        let mut 名残留 = 0usize;
        let mut 名样本: Vec<String> = Vec::new();
        let mut 名诊断: Vec<String> = Vec::new();
        for entry in walkdir::WalkDir::new(&root).into_iter().filter_map(Result::ok) {
            for 名 in [entry.file_name().to_string_lossy().to_string()] {
                if !名.chars().any(|c| !c.is_ascii()) {
                    continue;
                }
                名有非ascii += 1;
                /* 量具改用 `scan_names`（界面走的就是它）—— 以前这里自己复制了一遍候选循环，
                   门槛改了之后那份副本就开始说假话（"门槛 1.8"写死在格式串里）。 */
                let r = repair_text_quiet(&名);
                if r.changed {
                    名能修 += 1;
                }
                let (后, _) = 残留(&r.fixed);
                if 后 > 0 {
                    名残留 += 1;
                }
                if 名样本.len() < 8 && (r.changed || !r.segments.iter().all(|s| s.候选.is_empty())) {
                    let 段 = r.segments.iter().find(|s| !s.候选.is_empty());
                    let 样子 = 段.map(|s| s.候选[0].text.clone()).unwrap_or_default();
                    let 增益 = 段.map(|s| s.gain).unwrap_or(0.0);
                    let 门槛 = 段.map(|s| s.门槛).unwrap_or(0.0);
                    let 上升 = 段.map(|s| s.假名上升).unwrap_or(0.0);
                    let 半角 = 段.map(|s| s.半角片假名).unwrap_or(false);
                    名诊断.push(format!(
                        "{名} → {}（自动={}）\n        候选 {增益:.4} 增益 / 门槛 {门槛:.2} / 假名上升 {上升:.2} / 含半角片假名 {半角} → {样子}",
                        r.fixed,
                        r.changed,
                    ));
                    名样本.push(名.clone());
                }
                if 名样本.len() < 10 && r.changed {
                    名样本.push(format!("{名}  →  {}", r.fixed));
                }
            }
            名总数 += 1;
        }
        println!("\n  文件/目录名：共 {名总数} 个，含非 ASCII 的 {名有非ascii} 个，其中能还原的 {名能修} 个");
        println!("  还原之后仍含乱码特征串的名字：{名残留} 个");
        for s in &名样本 {
            println!("    {s}");
        }

        /* 名字为什么一个都没被还原？逐条查候选路 */
        if !名诊断.is_empty() {
            println!("\n  名字还原不动的原因（拿去对照「一个都没改动」）：");
            for s in &名诊断 {
                println!("    {s}");
            }
        }
        println!();
    }
}

/// 翻译那条路要用同一份注释扫描：段落切分与写回。
#[cfg(test)]
mod piece_tests {
    use super::*;

    const SAMPLE: &str = "// テクスチャの設定\n\
float4 albedo = 1.0;\n\
/* ブロック\n   複数行 */\n\
#define ALBEDO_MAP \"tex.png\"  // 末尾注释\n";

    /// `.fx` 的段落只该是注释正文：`//`、`/*`、`*/`、代码行都不在里面
    #[test]
    fn fx_pieces_are_comment_bodies_only() {
        let p = scan_pieces(SAMPLE.to_string(), Some("fx-comments".into()));
        assert_eq!(p.len(), 3, "三处注释：行注释、块注释、行尾那个：{p:?}");
        assert_eq!(p[0], " テクスチャの設定");
        assert_eq!(p[1], " ブロック\n   複数行 ");
        assert_eq!(p[2], " 末尾注释");
        assert!(
            !p.iter().any(|s| s.contains("float4") || s.contains("#define")),
            "代码不许进段落：{p:?}"
        );
    }

    /// 写回：**除注释内容外与原文逐字节相同**。
    ///
    /// 验法是两边的"非注释部分"直接比 —— 把原文件和结果里所有注释正文都挖掉，
    /// 剩下的字符串必须一模一样。这比"逐行比"强：段落中间夹的 `//`、`*/`、
    /// 缩进、换行全都要同一份字节。
    #[test]
    fn write_back_touches_comment_bodies_only() {
        let 译 = vec![
            " 贴图设置".to_string(),
            " 块注释\n   多行 ".to_string(),
            " 行尾注释".to_string(),
        ];
        let out = apply_pieces(SAMPLE.to_string(), Some("fx-comments".into()), 译.clone()).unwrap();

        let 挖掉 = |s: &str| {
            let mut r = String::new();
            let mut pos = 0usize;
            for (a, b) in comment_spans(s) {
                r.push_str(&s[pos..a]);
                pos = b;
            }
            r.push_str(&s[pos..]);
            r
        };
        assert_eq!(挖掉(SAMPLE), 挖掉(&out), "非注释部分被动了：\n{out}");
        assert!(out.contains("贴图设置"));
        assert!(out.contains("块注释\n   多行 "));
        assert!(out.contains(" 行尾注释"), "实得 {out}");
        assert!(out.starts_with("// 贴图设置"), "注释符号必须还在：{out}");
        assert!(out.contains("#define ALBEDO_MAP \"tex.png\""), "宏那行一个字都不能动：{out}");

        // 段落数和原文一致：再挖一次段落，应当就是传进去的那三个
        let 回 = scan_pieces(out.clone(), Some("fx-comments".into()));
        assert_eq!(回, 译, "写回后再切一次应当就是译文本身");
    }

    /// 纯文本：整篇一段，写回就是替换整篇
    #[test]
    fn plain_text_is_one_piece() {
        let src = "これは説明です。\n二行目。\n";
        let p = scan_pieces(src.to_string(), Some("whole".into()));
        assert_eq!(p.len(), 1);
        assert_eq!(p[0], src);
        let out = apply_pieces(src.to_string(), Some("whole".into()), vec!["这是说明。\n第二行。\n".into()]).unwrap();
        assert_eq!(out, "这是说明。\n第二行。\n");
    }

    /// 空文件 / 没有注释的文件：零段，而不是一段空字符串（否则会多发一次请求）
    #[test]
    fn empty_or_commentless_files_have_no_pieces() {
        assert!(scan_pieces(String::new(), Some("whole".into())).is_empty());
        assert!(scan_pieces(String::new(), Some("fx-comments".into())).is_empty());
        let 无注释 = "float4 main() { return 1; }\n";
        assert!(scan_pieces(无注释.to_string(), Some("fx-comments".into())).is_empty());
        // 纯文本模式下一个非空文件永远是有段的
        assert_eq!(scan_pieces(无注释.to_string(), Some("whole".into())).len(), 1);
    }

    /// 段落数对不上必须报错，不许"尽力而为"地错位写进去
    #[test]
    fn piece_count_mismatch_is_refused() {
        let 太短 = vec![" 只给了一段".to_string()];
        let e = apply_pieces(SAMPLE.to_string(), Some("fx-comments".into()), 太短).unwrap_err();
        assert!(e.contains("段落数对不上"), "实得 {e}");

        let 太多 = vec![
            "a".to_string(),
            "b".to_string(),
            "c".to_string(),
            "d".to_string(),
            "e".to_string(),
        ];
        assert!(apply_pieces(SAMPLE.to_string(), Some("fx-comments".into()), 太多).is_err());
    }

    /// 没闭合的块注释：吃到文件尾，但**不许**把前面的代码吞进去
    #[test]
    fn unclosed_block_comment_does_not_eat_code() {
        let src = "x = 1;\n/* 未闭合\n y = 2;\n";
        let p = scan_pieces(src.to_string(), Some("fx-comments".into()));
        assert_eq!(p.len(), 1, "实得 {p:?}");
        assert!(p[0].contains("y = 2;"), "未闭合块注释应当吃到文件尾：{p:?}");
        // 前面的 `x = 1;` 仍然是代码，不在段落里
        let out = apply_pieces(src.to_string(), Some("fx-comments".into()), vec![" 换掉".into()]).unwrap();
        assert!(out.starts_with("x = 1;\n/* 换掉"), "实得 {out}");
    }

    /// 括号里带 `*` 和 `/` 的普通代码不许被当成注释边界
    #[test]
    fn star_and_slash_in_code_do_not_confuse_the_scanner() {
        let src = "float a = 6 * 3 / 2; // 注释\nfloat b = 8 / 4 * 2;\n";
        let p = scan_pieces(src.to_string(), Some("fx-comments".into()));
        assert_eq!(p, vec![" 注释".to_string()], "实得 {p:?}");
    }
}

#[cfg(test)]
mod safety_tests {
    use super::*;

    /// 实测抓到的那个 bug：`メタリック成分を足す` 里的 `成分` 被解成 `Θだ`，
    /// 因为 だ 是平假名拿了 +3，两字的中文段就被当成"修好了"。
    /// 希腊/西里尔那里加了惩罚之后必须不再发生。
    #[test]
    fn clean_japanese_comments_stay_clean() {
        for s in [
            "メタリック成分を足す",
            "テクスチャの設定",
            "コントローラーから受け取る",
            "シェーダーの本体",
            "ここで返す",
            "陰影を付ける",
            "法線マップを読む",
        ] {
            let r = repair_text_quiet(s);
            assert!(!r.changed, "{s:?} 不该被改，结果 {:?}", r.fixed);
        }
    }

    /// 短的中文段也不许被动。2-3 个字是最容易误判的长度。
    #[test]
    fn short_chinese_runs_stay_clean() {
        for s in ["成分", "材质", "身体", "脸部", "高光", "阴影", "透明", "金属", "描边"] {
            let r = repair_text_quiet(s);
            assert!(!r.changed, "{s:?} 不该被改，结果 {:?}", r.fixed);
        }
    }

    /// 调试用：看单个字的候选是怎么评的。`cargo test --lib -- --ignored --nocapture dump_one_char`
    #[test]
    #[ignore]
    fn dump_one_char() {
        for s in ["用", "読み取り", "シャドウ用Zバッファ", "设"] {
            let r = repair_text_quiet(s);
            println!("--- {s:?}  base={:.3}  changed={}  fixed={:?}", score(s), r.changed, r.fixed);
            for a in ["gbk", "gb18030", "big5", "windows-1252"] {
                let Some(bytes) = encode(s, a) else { continue };
                for b in ["shift_jis", "euc-jp", "utf-8"] {
                    let Some((t, lossy)) = decode(&bytes, b) else { continue };
                    if t == s {
                        continue;
                    }
                    println!("      {a:>13} -> {b:<9} score={:>7.3}{}  {:?}", score(&t), if lossy { " LOSSY" } else { "" }, t);
                }
            }
        }
    }

    /// **拿实战测试用例真跑抓到的 bug。**
    ///
    /// `乱码翻译/AbsoluteShadowShaderSystem.fx` 里有一行本来是**正确的**日文注释：
    ///
    /// ```text
    /// // シャドウ用Zバッファのぼかし読み取り
    /// ```
    ///
    /// 工具把它改成了 `// シャドウノZバッファのぼかし読み取り` ——
    /// `用` 变成 `ノ`，把正确的日文改坏了，而且写进了盘。
    ///
    /// 单看一个字猜不出机制，所以照原样把整行搬进来钉住；
    /// 顺带把"汉字 + 单字母 + 汉字/假名"这种夹着一个 ASCII 字母的写法都列一遍 ——
    /// 那一小段 ASCII 会把候选切成两半，打分是**按段**算的，很容易只看半句就误判。
    #[test]
    fn real_case_line_with_latin_letter_in_the_middle() {
        for s in [
            "// シャドウ用Zバッファのぼかし読み取り",
            "シャドウ用Zバッファのぼかし読み取り",
            "シャドウ用Zバッファ",
            "頂点用W成分",
            "法線用Xの値",
            "材質用Mテクスチャ",
            "// 影用Aチャンネルを使う",
        ] {
            let r = repair_text_quiet(s);
            assert!(!r.changed, "{s:?} 已经是正常日文，不该被改；实得 {:?}", r.fixed);
        }
    }

    /// 同一趟真跑还抓到三处，跟上面那条是**同一个根因**：
    /// 片假名 +3.0、汉字 +0.6，只要把段里一小部分字碰巧变成假名，平均分就白涨 2.4/段长，
    /// 原来 0.35 的门槛一律放行。表现是把正常的日文汉字词改成"汉字+假名"的怪东西：
    ///
    /// - `平面` → `キ⑰`
    /// - `手動` → `も以`
    /// - `部分` → `魁だ`
    ///
    /// 这三条都是**在真文件里出现过的原句**，直接照搬进来。
    #[test]
    fn real_case_kanji_words_are_not_half_converted() {
        for s in [
            "//サイズ設定（PosにはXY平面とか入ってる）",
            "//　　MMEが自動更新されないので必ず手動で「全て更新」を行うこと",
            "//カメラとシャドウ中心の距離",
            "カメラとシャドウ中心の距離",
            "という部分を",
            "平面",
            "手動",
            "部分",
            "中心",
            "設定",
            "自動更新",
            "必ず手動で",
        ] {
            let r = repair_text_quiet(s);
            assert!(!r.changed, "{s:?} 是正常日文，不该被改；实得 {:?}", r.fixed);
        }
    }

    /// 反过来：真乱码还得修得回来。门槛从 0.35 提到 1.8 之后这条更关键 ——
    /// 提门槛有可能把真修复也挡掉，所以真乱码这里必须逐个钉住。
    #[test]
    fn real_mojibake_still_gets_repaired_after_raising_the_margin() {
        for (bad, good) in [
            ("僐儞僩儘乕儔乕", "コントローラー"),
            ("僔僃乕僟乕", "シェーダー"),
            ("僥僋僗僠儍", "テクスチャ"),
        ] {
            let r = repair_text_quiet(bad);
            assert!(r.changed, "{bad:?} 是真乱码，应该被修");
            assert_eq!(r.fixed, good, "{bad:?} 应修成 {good:?}");
        }
    }

    /// 整行混排：日文注释 + 中文批注 + 代码，三者都要各归各位
    #[test]
    fn mixed_line_untouched_when_already_correct() {
        let s = "// テクスチャの設定（材质设置）";
        let r = repair_text_quiet(s);
        assert!(!r.changed, "结果 {:?}", r.fixed);
    }
}

/// 写盘那一半：BOM、UTF-16LE、另存路径。
///
/// 这几条以前没有测试，而它们坏起来**界面全显示成功** ——
/// BOM 被吃掉、UTF-16LE 静默跳过、另存把原文件覆盖了，用户都看不出来。
#[cfg(test)]
mod write_tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "robin-textenc-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// 一段确定能被改动的乱码：Shift-JIS 的「コントローラー」被按 GBK 读出来
    const MOJIBAKE: &str = "// 僐儞僩儘乕儔乕";

    #[test]
    fn utf8_bom_survives_a_rewrite() {
        let d = tmpdir("bom");
        let p = d.join("a.fx");
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(MOJIBAKE.as_bytes());
        fs::write(&p, &bytes).unwrap();

        let r = fix_text_file(
            p.to_string_lossy().into(),
            Some(true),
            Some("whole".into()),
            None,
            None,
            None,
        );
        assert!(r.error.is_none(), "不该报错：{:?}", r.error);
        assert!(r.changed, "这段应该被认成乱码");

        let out = fs::read(&p).unwrap();
        assert!(
            out.starts_with(&[0xEF, 0xBB, 0xBF]),
            "写回来必须还是带 BOM 的：{:02X?}",
            &out[..out.len().min(6)]
        );
        // BOM 后面得是修好的日文
        let text = String::from_utf8(out[3..].to_vec()).unwrap();
        assert!(text.contains("コントローラー"), "实得 {text:?}");
        fs::remove_dir_all(&d).ok();
    }

    /// 操作者指定"原文是什么日文编码"：候选只留那一路，而且真按他那一路解。
    ///
    /// 这条同时钉住两件事：**指定生效**（指对了解得出原文）、**指定有约束力**
    /// （指错了就不该把原文"蒙"出来）—— 只测前半截的话，一个"忽略参数的老实现"也能过。
    ///
    /// 用的是**语料里那串真乱码**（`傾僯儊晽夋柺僗僋儕乕儞`，实测来自 GBK 误读 Shift-JIS 的包名），
    /// 不是自己现编的：合成样本踩过一次坑 —— EUC-JP 的字节按 GBK 解往往是**有损**的，
    /// 解出来带替换符，再编回 GBK 就回不到原字节，那种"配对"根本立不住。
    #[test]
    fn 指定目标编码只走那一路() {
        let 乱码 = "傾僯儊晽夋柺僗僋儕乕儞"; // 真样本：アニメ風画面スクリーン

        // ① 指定 Shift-JIS（这才是它的正解）：候选只能有这一路，而且解得回原文
        let r = repair_text(乱码.to_string(), Some("shift_jis".into()));
        let 路: Vec<String> = r
            .segments
            .iter()
            .flat_map(|s| s.候选.iter().map(|c| c.via.clone()))
            .collect();
        assert!(!路.is_empty(), "至少得有候选");
        assert!(
            路.iter().all(|v| v.ends_with("-> shift_jis")),
            "指定 Shift-JIS 之后候选只能有这一路，实得 {路:?}"
        );
        assert!(
            r.fixed.contains("アニメ風画面スクリーン"),
            "按 Shift-JIS 该解回原文，实得 {:?}（段交代：{:?}）",
            r.fixed,
            r.segments.iter().map(|s| s.原因.clone()).collect::<Vec<_>>()
        );

        // ② 指定 EUC-JP：候选只走 euc-jp，而且**不该**把原文蒙出来
        let r2 = repair_text(乱码.to_string(), Some("euc-jp".into()));
        let 路2: Vec<String> = r2
            .segments
            .iter()
            .flat_map(|s| s.候选.iter().map(|c| c.via.clone()))
            .collect();
        if !路2.is_empty() {
            assert!(路2.iter().all(|v| v.ends_with("-> euc-jp")), "实得 {路2:?}");
        }
        assert!(
            !r2.fixed.contains("アニメ風画面スクリーン"),
            "指定错了编码就不该解出原文 —— 否则「指定」根本没生效，实得 {:?}",
            r2.fixed
        );

        // ③ 不指定 = 自动认（老行为）：shift_jis 那一路仍然在候选里
        let r3 = repair_text(乱码.to_string(), None);
        assert!(
            r3.segments
                .iter()
                .any(|s| s.候选.iter().any(|c| c.via.contains("shift_jis"))),
            "自动认时 shift_jis 这一路该还在候选里"
        );
    }

    /// 名字还原那条路也认这个参数（`scan_names` 的第三个参数）
    #[test]
    fn 名字扫描也认指定编码() {
        let d = tmpdir("名字目标编码");
        let 乱码名 = "傾僯儊晽夋柺僗僋儕乕儞";
        fs::create_dir_all(d.join(乱码名)).unwrap();

        let 自动 = scan_names(d.to_string_lossy().into(), None, None);
        let 指定 = scan_names(d.to_string_lossy().into(), None, Some("shift_jis".into()));
        assert_eq!(自动.len(), 1, "自动认该扫出这个乱码名");
        assert_eq!(指定.len(), 1, "指定 Shift-JIS 也该扫出来");
        assert!(
            指定[0].候选.iter().all(|c| c.via.ends_with("-> shift_jis")),
            "指定之后候选只该有这一路，实得 {:?}",
            指定[0].候选.iter().map(|c| c.via.clone()).collect::<Vec<_>>()
        );
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn no_bom_file_does_not_gain_one() {
        let d = tmpdir("nobom");
        let p = d.join("b.fx");
        fs::write(&p, MOJIBAKE.as_bytes()).unwrap();
        let r = fix_text_file(
            p.to_string_lossy().into(),
            Some(true),
            Some("whole".into()),
            None,
            None,
            None,
        );
        assert!(r.error.is_none(), "{:?}", r.error);
        let out = fs::read(&p).unwrap();
        assert!(
            !out.starts_with(&[0xEF, 0xBB, 0xBF]),
            "本来没 BOM 就不该加，实得 {:02X?}",
            &out[..out.len().min(6)]
        );
        fs::remove_dir_all(&d).ok();
    }

    /// UTF-16LE 以前只能读不能写，等于这类 .fx 一次也修不了。
    #[test]
    fn utf16le_can_be_written_back() {
        let d = tmpdir("u16");
        let p = d.join("c.fx");
        let mut bytes = vec![0xFF, 0xFE];
        for u in MOJIBAKE.encode_utf16() {
            bytes.extend_from_slice(&u.to_le_bytes());
        }
        fs::write(&p, &bytes).unwrap();

        let r = fix_text_file(
            p.to_string_lossy().into(),
            Some(true),
            Some("whole".into()),
            None,
            None,
            None,
        );
        assert_eq!(r.encoding, "utf-16le", "该认成 utf-16le，实得 {}", r.encoding);
        assert!(r.error.is_none(), "以前这里会报「编不回去」：{:?}", r.error);
        assert!(r.written, "该写成功");

        let out = fs::read(&p).unwrap();
        assert!(out.starts_with(&[0xFF, 0xFE]), "UTF-16LE 的 BOM 要留着");
        let u16s: Vec<u16> = out[2..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let text = String::from_utf16_lossy(&u16s);
        assert!(text.contains("コントローラー"), "实得 {text:?}");
        fs::remove_dir_all(&d).ok();
    }

    /// 另存：原文件一个字节都不许动，目标目录不存在要自己建（跨盘也一样）。
    #[test]
    fn save_as_leaves_original_alone_and_creates_dir() {
        let d = tmpdir("saveas");
        let src = d.join("src");
        fs::create_dir_all(&src).unwrap();
        let p = src.join("d.fx");
        let original = MOJIBAKE.as_bytes().to_vec();
        fs::write(&p, &original).unwrap();

        // 目标目录故意不存在，模拟"输出到别的盘"
        let dst = d.join("out").join("deep").join("d_fixed.fx");
        let r = fix_text_file(
            p.to_string_lossy().into(),
            Some(true),
            Some("whole".into()),
            None,
            Some(dst.to_string_lossy().into()),
            None,
        );

        assert!(r.error.is_none(), "不该报错：{:?}", r.error);
        assert!(r.written, "该写成功");
        assert_eq!(
            fs::read(&p).unwrap(),
            original,
            "另存的时候原文件必须一个字节都没动"
        );
        assert!(dst.exists(), "目标文件该在，而且父目录是自动建的");
        assert_eq!(r.path, dst.to_string_lossy(), "返回的 path 该是落点");
        assert_eq!(r.rel, "d_fixed.fx", "rel 该换成新文件名");
        assert!(
            !src.join("d.fx.bak").exists(),
            "另存不该给原文件留 .bak —— 什么都没改"
        );
        fs::remove_dir_all(&d).ok();
    }

    /// 另存到已经存在的文件，得先备份，不能闷头覆盖
    #[test]
    fn save_as_backs_up_existing_target() {
        let d = tmpdir("saveas2");
        let p = d.join("e.fx");
        fs::write(&p, MOJIBAKE.as_bytes()).unwrap();
        let dst = d.join("e_out.fx");
        fs::write(&dst, b"old content").unwrap();

        let r = fix_text_file(
            p.to_string_lossy().into(),
            Some(true),
            Some("whole".into()),
            None,
            Some(dst.to_string_lossy().into()),
            None,
        );
        assert!(r.error.is_none(), "{:?}", r.error);
        assert!(r.backup.is_some(), "目标原来有东西，必须先备份");
        let bak = r.backup.unwrap();
        assert_eq!(fs::read(&bak).unwrap(), b"old content", "备份里是原来的内容");
        fs::remove_dir_all(&d).ok();
    }

    /// 试跑（write=false）时给了 out_path 也不许落盘
    #[test]
    fn dry_run_never_writes_anywhere() {
        let d = tmpdir("dry");
        let p = d.join("f.fx");
        fs::write(&p, MOJIBAKE.as_bytes()).unwrap();
        let dst = d.join("f_out.fx");
        let r = fix_text_file(
            p.to_string_lossy().into(),
            Some(false),
            Some("whole".into()),
            None,
            Some(dst.to_string_lossy().into()),
            None,
        );
        assert!(r.changed, "该认出来");
        assert!(!r.written, "试跑不写");
        assert!(!dst.exists(), "试跑不该建出目标文件");
        fs::remove_dir_all(&d).ok();
    }

    /// 编码装不下的字，要报清楚而不是写一半
    #[test]
    fn unencodable_text_is_refused_with_a_clear_message() {
        let d = tmpdir("unenc");
        let p = d.join("g.conf");
        // GBK 装不下的字符（emoji 不在任何 CJK 编码里）
        let mut bytes = MOJIBAKE.as_bytes().to_vec();
        bytes.extend_from_slice(b" \xF0\x9F\x98\x80");
        fs::write(&p, &bytes).unwrap();
        let r = fix_text_file(
            p.to_string_lossy().into(),
            Some(true),
            Some("whole".into()),
            Some("gbk".into()),
            None,
            None,
        );
        if let Some(e) = r.error {
            assert!(!r.written, "报错了就不该说写成功");
            assert!(
                e.contains("编不回去") || e.contains("没动这个文件"),
                "错误信息要说清是编码装不下：{e}"
            );
        }
        fs::remove_dir_all(&d).ok();
    }

    /* ------------------------------------------------ 不靠假名的那两条结构判据

       样本全是语料 `实战测试用例\乱码翻译\` 里**真实存在**的名字与正文
       （量具 `tmp\量-纯汉字乱码判据.mjs`）。这组测试守的是用户 2026-09-24 定的口径：
       **"真值选哪一个"这个活不许丢给操作者** —— 程序得自己判对，
       既要把纯汉字的乱码认出来，又**一个都不许动**用户自己起的中文名。 */

    /// 判据单元：无损回环
    #[test]
    fn 无损回环_真乱码过_中文名不过() {
        // 真乱码（Shift-JIS 的字节被按 GBK 读出来的产物）
        for ok in ["丒巊梡曽朄", "夵曄尦readme", "僄僢僕昤夋", "readme(恓嬥P)"] {
            assert!(
                无损回环(ok, "gbk", "shift_jis"),
                "真乱码该判成无损回环：{ok}"
            );
        }
        // 用户自己起的中文名 / 本来就好的东西 —— 一个都不许过
        for bad in [
            "乱码翻译",
            "修复结果_过目用",
            "改名后",
            "翻译后",
            "还原后",
            "测试效果",
        ] {
            assert!(
                !无损回环(bad, "gbk", "shift_jis"),
                "中文名不该判成无损回环：{bad}"
            );
        }
        // 纯 ASCII 编回去等于没变，回环要求"解出来跟原文不一样"，所以也不该过
        assert!(!无损回环("PostRimShilouhette", "gbk", "shift_jis"));
    }

    /// 判据单元：汉字常用度（Shift-JIS 前导字节 0x88–0x98 = JIS 第 1 级）
    #[test]
    fn 汉字常用度_常用字过_生僻字不过_没汉字不表态() {
        assert!(汉字都常用("改変元readme"), "改変元 全是常用字");
        assert!(汉字都常用("・使用方法"), "使用方法 全是常用字");
        assert!(汉字都常用("readme(針金P)"), "針金 都是常用字");
        assert!(!汉字都常用("岱鷹鍬咎"), "生僻字该被拦下");
        assert!(!汉字都常用("釚"), "釚 是生僻字");
        // 一个汉字都没有 = 这条判据没话说，**不许因此否掉**
        assert!(汉字都常用("エッジ描画"), "纯假名 + 常用汉字的照样过");
        assert!(汉字都常用("PostRimShilouhette"), "没汉字就不表态");
    }

    /// 端到端：纯汉字/纯符号的乱码**现在要认出来**
    #[test]
    fn 纯汉字乱码_现在认了() {
        for (坏, 好) in [
            ("丒巊梡曽朄", "・使用方法"),
            ("夵曄尦readme", "改変元readme"),
        ] {
            let r = repair_text_quiet(坏);
            assert!(
                r.fixed.contains(好),
                "纯汉字乱码该还原成「{好}」，实得「{}」（via={}）",
                r.fixed,
                r.via
            );
        }
    }

    /// 端到端：**中文名和纯 ASCII 名一个都不许动**（这条是防"把好名字改成乱码"）
    #[test]
    fn 中文名与英文名_一个字都不许动() {
        for 原 in [
            "乱码翻译",
            "修复结果_过目用",
            "改名后",
            "翻译后",
            "还原后",
            "测试效果",
            "PostRimShilouhette",
            "AnimeScreenTex_v1.0",
        ] {
            let r = repair_text_quiet(原);
            assert_eq!(r.fixed, 原, "这个名字不该被动：{原}（via={}）", r.via);
            assert!(!r.changed, "不该说改过：{原}");
        }
    }

    /// 老那条路（带假名的）不许被这次改动弄坏
    #[test]
    fn 带假名的乱码_老路没坏() {
        for (坏, 好) in [
            ("僄僢僕昤夋", "エッジ描画"),
            ("傾僯儊晽夋柺僗僋儕乕儞", "アニメ風画面スクリーン"),
            ("readme(恓嬥P)", "readme(針金P)"),
            ("readme-巊偄曽", "readme-使い方"),
        ] {
            let r = repair_text_quiet(坏);
            assert!(r.fixed.contains(好), "「{坏}」该还原成「{好}」，实得「{}」", r.fixed);
        }
    }
}
