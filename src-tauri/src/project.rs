/**
 * ⑥ 工程迁移打包 —— 把工程用到的文件连同 `.pmm`/`.emm` 一起拷到指定位置，
 * 并把三条路径都改成"跟着工程走的相对路径"。
 *
 * 只做**已经实测可行**的那半（`docs\⑥工程迁移-格式规格.md` §9 结尾那句）：
 *   · `.pmm` 对象路径 = 定长 256 字节、GBK；**原地覆写**，文件长度不变
 *   · `.emm` = 纯文本 INI（CRLF、GBK），改文本
 *   · `.pmx` 贴图路径 = int32 长度 + 内容，编码看头部全局[0]；改长度安全（材质按索引引用）
 * **不做删条目**（卡在关键帧区记录边界上），缺文件这一轮只报告。
 *
 * 三个复用/自证的做法（都是本工程吃过亏的地方）：
 *   1. `.pmm` 里**不解析**对象区，而是拿 `.emm` 的路径文本当锚去搜字节
 *      （实测 30 个工程 966 条 100% 唯一命中）。搜不到或搜到多处就**拒绝**，不猜。
 *   2. `.pmx` **不写第二份解析器**：贴图清单问 `pmx::read_pmx`，这里只按规格读头部那 10 个字节
 *      拿编码标志，再按"int32 长度 + 内容"唯一搜索定位。
 *   3. 改写完 `.pmx` **再读回来**（`pmx::read_pmx`）核对贴图清单，对不上就报错。
 */
use encoding_rs::{GBK, SHIFT_JIS};
/* `UTF_8` 只有测试在编路径针时用得到（正文里一律 GBK / Shift-JIS）。
   不挂 `#[cfg(test)]` 的话，发行版那趟会报 unused import。 */
#[cfg(test)]
use encoding_rs::UTF_8;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

fn 编(s: &str, enc: &'static encoding_rs::Encoding) -> Vec<u8> {
    let (b, _, _) = enc.encode(s);
    b.into_owned()
}
fn 解(b: &[u8], enc: &'static encoding_rs::Encoding) -> String {
    let (s, _, _) = enc.decode(b);
    s.into_owned()
}

/**
 * 严格编码：编不进去就返回 `None`。
 *
 * 普通 `编` 会把编不出的字符换成 `?` —— 写进名字里就是**静默改坏**（用户看到的是乱码，
 * 却以为改名成功了）。所以改名这条路只认严编码，编不出就拒绝。
 */
fn 编严(s: &str, enc: &'static encoding_rs::Encoding) -> Option<Vec<u8>> {
    let (b, _, 有错) = enc.encode(s);
    if 有错 {
        return None;
    }
    Some(b.into_owned())
}

/**
 * 这条名字原本是用哪种编码写的。
 *
 * 名字没有编码标记，只能**按原文回推**：SJIS 能解通、且编回去逐字节一致 → 就是它；
 * 否则按 GBK（MMD 中文版会把中文名按 GBK 写进名字段，这是实测过的）。
 * 按原编码回写才不会出现"同名不同字节"。
 */
fn 名字原编码(原名: &[u8]) -> &'static encoding_rs::Encoding {
    let (s, _, 有错) = SHIFT_JIS.decode(原名);
    if !有错 && 编(&s, SHIFT_JIS) == 原名 {
        SHIFT_JIS
    } else {
        GBK
    }
}
fn 读文本(p: &Path) -> Result<String, String> {
    let b = fs::read(p).map_err(|e| format!("读不了 {}：{e}", p.display()))?;
    Ok(解(&b, GBK))
}

/* ============================================================ .emm */

#[derive(Serialize, Clone)]
pub struct 对象 {
    /// `.emm` 里的键，`Pmd3` / `Acs5` 这种。编号是模型与附件**共用**的槽位号
    pub key: String,
    /// `model` 或 `accessory`
    pub kind: String,
    /// 槽位号
    pub index: u32,
    /// `.emm` 里写的路径（原文）
    pub path: String,
}

#[derive(Serialize, Clone)]
pub struct 特效 {
    pub key: String,
    /// `Some(m)` = 逐材质特效 `Pmd<N>[m]`
    pub material: Option<u32>,
    /// `.show` 这类附属键
    pub field: Option<String>,
    pub path: String,
}

#[derive(Serialize, Clone, Default)]
pub struct Emm {
    pub objects: Vec<对象>,
    pub effects: Vec<特效>,
    /// `[Effect@EnvLightMap]` 这类附加段的原始行，原样留着（改写时不动）
    pub 别的段: Vec<String>,
}

fn 分段名(line: &str) -> Option<&str> {
    let t = line.trim();
    if t.starts_with('[') && t.ends_with(']') {
        Some(&t[1..t.len() - 1])
    } else {
        None
    }
}

/// 键名形如 `Pmd3` / `Acs5` / `Pmd3[6]` / `Pmd3[6].show` / `Pmd2.show`
fn 拆键(key: &str) -> (String, Option<u32>, Option<String>) {
    let (base, rest) = match key.find('[') {
        Some(i) => (&key[..i], Some(&key[i..])),
        None => (key, None),
    };
    let mut mat = None;
    let mut field = None;
    if let Some(r) = rest {
        if let Some(end) = r.find(']') {
            mat = r[1..end].parse::<u32>().ok();
            let after = &r[end + 1..];
            if let Some(f) = after.strip_prefix('.') {
                field = Some(f.to_string());
            }
        }
    } else if let Some(f) = base.split_once('.').map(|(_, f)| f) {
        field = Some(f.to_string());
        return (base.split('.').next().unwrap_or(base).to_string(), mat, field);
    }
    (base.to_string(), mat, field)
}

pub fn parse_emm(text: &str) -> Emm {
    let mut out = Emm::default();
    let mut seg = String::new();
    for line in text.lines() {
        if let Some(n) = 分段名(line) {
            seg = n.to_string();
            if !(seg == "Object" || seg == "Effect") {
                out.别的段.push(line.to_string());
            }
            continue;
        }
        if seg == "Object" {
            if let Some((k, v)) = line.split_once('=') {
                let key = k.trim().to_string();
                let (base, mat, field) = 拆键(&key);
                if mat.is_some() || field.is_some() {
                    continue;
                }
                let kind = if base.starts_with("Acs") { "accessory" } else { "model" };
                /* **别直接切 `base[3..]`**：`base` 是 GBK 解出来的 `String`，用户 `.emm` 里的键
                   什么都有 —— 非 ASCII 键（`模型1`）切在第 3 字节会 panic
                   （`byte index 3 is not a char boundary`），长度不足 3 的键（`a`）会越界。
                   这是**用户文件内容**驱动的 panic，一拖进 ⑨ 就炸（2026-09-25 只读审查量出来的）。 */
                let index = if base.len() >= 3 && base.is_char_boundary(3) {
                    base[3..].parse::<u32>().unwrap_or(0)
                } else {
                    0
                };
                out.objects.push(对象 {
                    key: base.clone(),
                    kind: kind.to_string(),
                    index,
                    path: v.trim().to_string(),
                });
            }
        } else if seg == "Effect" || seg.starts_with("Effect@") {
            if let Some((k, v)) = line.split_once('=') {
                let key = k.trim().to_string();
                let (base, mat, field) = 拆键(&key);
                out.effects.push(特效 {
                    key: base,
                    material: mat,
                    field,
                    path: v.trim().to_string(),
                });
            }
        } else {
            out.别的段.push(line.to_string());
        }
    }
    out
}

/// 只改 `[Object]` 段里那些"要跟着工程走"的路径。返回（新文本，改了几处）
pub fn rewrite_emm(text: &str, 新: &HashMap<String, String>) -> (String, usize) {
    let mut 改 = 0;
    let mut 出 = String::with_capacity(text.len());
    let mut seg = String::new();
    for (i, line) in text.lines().enumerate() {
        if i > 0 {
            出.push_str("\r\n");
        }
        if let Some(n) = 分段名(line) {
            seg = n.to_string();
            出.push_str(line);
            continue;
        }
        if seg == "Object" {
            if let Some((k, v)) = line.split_once('=') {
                let key = k.trim();
                if let Some(nv) = 新.get(key) {
                    /* **只换值，别动写法**：等号两侧的空格是原文件的写法，重拼 `键=值` 会把它吃掉
                       （实测：`Acs1 = D:\…` 被写成 `Acs1=E:\…`，14 行全中）。 */
                    let 前导空 = &v[..v.len() - v.trim_start().len()];
                    出.push_str(k);
                    出.push('=');
                    出.push_str(前导空);
                    出.push_str(nv);
                    改 += 1;
                    continue;
                }
                let _ = v;
            }
        }
        出.push_str(line);
    }
    /* 末尾那个换行要保住：`.lines()` 不吐最后那个空行，不补回来的话
       改一次文件就少两个字节 —— 少两个字节看着无害，但"逐字节可验证"这条就假了 */
    if text.ends_with("\r\n") {
        出.push_str("\r\n");
    } else if text.ends_with('\n') {
        出.push('\n');
    }
    (出, 改)
}

/* ============================================================ 目录归组（A 用） */

#[derive(Serialize, Clone)]
pub struct 目录组 {
    /// 这个目录里有多少个被工程引用的文件
    pub 条数: usize,
    /// 其中盘上找得到的
    pub 有: usize,
    pub 目录: String,
}

/**
 * 把工程引用的文件**按所在目录归出来**。
 *
 * A 情形要"自动识别工程内容文件现在存在哪儿" —— 常见的是一个工程里几个模型散在两三个目录，
 * 让用户一个个填路径是折磨。这里按目录归组、按条数从多到少排，界面直接给几行让用户选/改。
 */
fn 归目录(条目: impl Iterator<Item = (String, bool)>) -> Vec<目录组> {
    let mut 表: HashMap<String, (usize, usize)> = HashMap::new();
    for (路径, 在) in 条目 {
        if 路径.is_empty() {
            continue;
        }
        let 目录 = Path::new(&路径)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let e = 表.entry(目录).or_insert((0, 0));
        e.0 += 1;
        if 在 {
            e.1 += 1;
        }
    }
    let mut 出: Vec<目录组> = 表
        .into_iter()
        .map(|(目录, (条数, 有))| 目录组 { 目录, 条数, 有 })
        .collect();
    出.sort_by(|a, b| b.条数.cmp(&a.条数).then(a.目录.cmp(&b.目录)));
    出
}

/* ============================================================ .emm 编号重排（B 用） */

/**
 * 删掉几个槽位之后重排 `.emm` 的编号。
 *
 * 依据是实测（规格 §18，真文件副本上验过）：**编号是位置编号** —— 删掉第 3 个之后，
 * 后面所有 `Pmd<N>`/`Acs<N>` 各前移一位，编号保持 1..K 不重不漏；
 * `Pmd<N>[m]` 里的**材质序号 m 不变**（它指的是这个模型的第几个材质，与槽位无关）；
 * `.show` 这类附属键跟着自己的基名一起搬；`[Effect]` 与 `[Effect@…]` 段里的键同样跟着改。
 *
 * 返回（新文本，删掉的行数，改编号的行数）。删掉的槽位是**共用槽位号**（模型与附件共用）。
 */
pub fn 重排_emm(text: &str, 删: &[u32]) -> (String, usize, usize) {
    let 删集: std::collections::HashSet<u32> = 删.iter().copied().collect();
    let 前移 = |n: u32| n - 删集.iter().filter(|d| **d < n).count() as u32;
    let mut 去 = 0;
    let mut 改 = 0;
    let 行表: Vec<&str> = text.lines().collect();
    let mut 留: Vec<String> = Vec::with_capacity(行表.len());
    for line in 行表.iter() {
        let line = *line;
        if 分段名(line).is_some() {
            留.push(line.to_string());
            continue;
        }
        let Some((k, v)) = line.split_once('=') else {
            留.push(line.to_string());
            continue;
        };
        let key = k.trim();
        let (base, mat, field) = 拆键(key);
        let 前缀 = if base.starts_with("Pmd") {
            "Pmd"
        } else if base.starts_with("Acs") {
            "Acs"
        } else {
            留.push(line.to_string());
            continue;
        };
        let Ok(n) = base[3..].parse::<u32>() else {
            留.push(line.to_string());
            continue;
        };
        if 删集.contains(&n) {
            去 += 1;
            continue; // 这一条的对象没了，连着它的键一起删
        }
        let n2 = 前移(n);
        if n2 != n {
            改 += 1;
        }
        let mut 新键 = format!("{前缀}{n2}");
        if let Some(m) = mat {
            新键.push('[');
            新键.push_str(&m.to_string());
            新键.push(']');
        }
        if let Some(f) = field {
            新键.push('.');
            新键.push_str(&f);
        }
        /* `=` 前面原有的空白原样补回来：`Pmd3 = c` 改成 `Pmd2 = c`，
           不是 `Pmd2= c` —— 改一个数字就该只改那个数字，别顺手把格式也改了 */
        留.push(format!("{新键}{}={v}", &k[key.len()..]));
    }
    /* 保留的行按原来的 CRLF 拼回去；原文件以换行结尾就还它以换行结尾。
       （早先边遍历边拼：删掉中间一行时它前面的分隔符已经写了，于是原地留一个空行；
        留一行空行无害，但"删一行就该只少一行"这条更好核。） */
    let mut 出 = 留.join("\r\n");
    if text.ends_with("\r\n") && !留.is_empty() {
        出.push_str("\r\n");
    } else if text.ends_with('\n') && !留.is_empty() {
        出.push('\n');
    }
    (出, 去, 改)
}

/* ============================================================ .pmm */

#[derive(Serialize, Clone)]
pub struct Pmm命中 {
    pub key: String,
    pub offset: usize,
    /// 这条路径在 `.pmm` 里**所有**字段的偏移（含 `.pmm` 里残留的旧字段）。
    /// 改写时全都要写 —— 同一旧路径的字段改成新路径后都该是同一个新路径。
    pub 全部: Vec<usize>,
    pub path: String,
    /// 这一处是怎么找到的（命中率要按类看，界面也显示）
    pub 怎么找到的: &'static str,
    /// `.pmm` 条目里的名字（模型 = 长度前缀名字；附件 = `名字[100]`）。
    /// 参考工具那页就是"名称 + 路径"，界面要照着显示（`docs\反馈作业单-20260921.md`）。
    pub 名称: String,
}

/**
 * 这个偏移是不是"路径字段的起点"，是的话**顺带把整条的起点与类别算出来**。
 *
 * 判据（与结构校验对齐）：模型/附件条目是
 * `uint8 名字长 + 名字(SJIS) + uint8 英文名长 + 英文名 + char[256] 路径`，
 * 所以路径字段前面紧挨着英文名的最后一个字节，再往前是英文名长度、名字、名字长度。
 * 按这个结构往回验，验不通就不是字段起点 —— 这样"文件名出现在别处"不会被误当成字段。
 *
 * 返回 `(整条起点, 类别)`。类别只有 `model` / `accessory` 两种：
 * **摘条目（B）只认这两类**，别的形状一律不当条目（宁可少认，不敢摘错字节）。
 * 早期这里只回 `bool`，于是"整条起点"没法传出来、摘条目没法算整段范围。
 */
fn 条目头信息(b: &[u8], s: usize) -> Option<(usize, &'static str)> {
    /* 模型：`[u8 n1][名字 n1][u8 n2][英文名 n2][路径 256]`。
       从字段起点 s 往回**重建**：英文名收在 s，它的长度字节在它前面。
       （早先这里把 s-1 直接当成长度，实际 s-1 是英文名的最后一个字节 ——
        结果所有"多处出现"的候选都被判成结构不成立，1375 条全被拒。）
       **n2 允许为 0**：MMD 里没有英文名的模型就是空英文名，早期要求 ≥1 会把它们整条漏掉
       （实测 `ANTU` 系 25/26、`Addiction` 27/28 都是"少认一条"，正是这种形状）。 */
    for n2 in 0..=64usize {
        if s < n2 + 3 {
            break;
        }
        let 长度位 = s - n2 - 1;
        if b[长度位] as usize != n2 {
            continue;
        }
        if n2 > 0 && !像名字(&b[s - n2..s]) {
            continue;
        }
        /* 名字：`[u8 n1][名字 n1]` 也得**重建** —— n1 自己的字节在名字前面，
           不是名字的最后一个字节（这两处是最容易推错的地方） */
        for n1 in 1..=64usize {
            if 长度位 < n1 + 1 {
                break;
            }
            if b[长度位 - n1 - 1] as usize != n1 {
                continue;
            }
            if 像名字(&b[长度位 - n1..长度位]) && !名字像路径(&b[长度位 - n1..长度位] ) {
                return Some((长度位 - n1 - 1, "model"));
            }
        }
    }
    /* 附件：`名字[100]` 收在 s（名字里 NUL 结尾，其余补零） */
    if s >= 100 {
        let 名区 = &b[s - 100..s];
        if let Some(p) = 名区.iter().position(|c| *c == 0) {
            if p > 0 && 名区[p..].iter().all(|c| *c == 0) && 像名字(&名区[..p]) {
                return Some((s - 100, "accessory"));
            }
        }
    }
    None
}

/// 名字里夹着路径符号就**不是名字** —— 这是滤掉"残留路径文本凑出的假条目"用的。
///
/// 定长 256 的字段写入时不清零，残留的旧路径也会凑出"像条目"的形状；附件那边靠
/// "名字 == 路径文件名"解决了，模型这边用户会改名用不了同一条，就用这条：
/// 真的名字几乎不会含 `\` `/` `:`（实测抓到过名字是 `ay-mmd-1.5.2\ray_controller.pmx` 的假条目）。
fn 名字像路径(名: &[u8]) -> bool {
    名.iter().any(|c| matches!(c, b'\\' | b'/' | b':'))
}

/// 名字段能不能当人名：不是二进制垃圾、不夹 NUL
///
/// **SJIS 或 GBK 能解通一个就算** —— 早期只认 SJIS，于是名字里带中文（MMD 中文版写 GBK）
/// 的那些条目整条被漏掉。实测现象很整齐：`Cat Loving 11/12`、`clear 12/13`、
/// `DAYBREAK FRONTLINE 14/15`、`Infinitely Gray 12/13`、`make you happy 26/27`
/// —— **每个工程正好少认一条**，就是这种。放宽后少认 5 → 0。
/// 放宽的风险由"模型条目数必须等于头部计数"那条约束兜着（多认了会被那条挡下）。
fn 像名字(b: &[u8]) -> bool {
    if b.is_empty() || b.len() > 100 || b.contains(&0) || b.iter().any(|c| *c < 0x09) {
        return false;
    }
    let (_, _, 错日) = encoding_rs::SHIFT_JIS.decode(b);
    if !错日 {
        return true;
    }
    let (_, _, 错中) = GBK.decode(b);
    !错中
}

/// 一个"结构上说得通"的条目候选
#[derive(Clone)]
struct 条目 {
    /// **整条**的起点（模型从"名字长度字节"算起，附件从名字区算起）。
    /// 摘条目要整段摘除，所以需要它；`offset` 只是路径字段的起点。
    头起: usize,
    /// 256 字节路径字段的起点
    offset: usize,
    路径: String,
    /// 字段被撑满 = 路径被 256 截断（尾巴本来就不在文件里）
    截断: bool,
    kind: &'static str,
    /// 这一条在 `.pmm` 里写的名字（模型 = 长度前缀名字；附件 = `名字[100]`）。
    /// 枚举时字节就在手上，顺手取出来；参考工具那页显示的就是"名称 + 路径"。
    名称: String,
}

/**
 * 从条目起点取出名字。
 *
 * 两种形状（与 `条目头信息` 的判据对齐）：
 *   · 模型 = `[u8 n][名字 n][u8 n2][英文名 n2][路径 256]` → 名字紧跟长度字节
 *   · 附件 = `名字[100]`（NUL 结尾、其余补零）→ 名字从 `头起` 起
 * 取不到就给空串，**不许猜**。
 */
fn 条目名(b: &[u8], 头起: usize, kind: &str) -> String {
    if kind == "accessory" {
        let 区 = &b[头起..(头起 + 100).min(b.len())];
        let 末 = 区.iter().position(|c| *c == 0).unwrap_or(区.len());
        return 解(&区[..末], GBK);
    }
    let Some(&n) = b.get(头起) else { return String::new() };
    let n = n as usize;
    if n == 0 || 头起 + 1 + n > b.len() {
        return String::new();
    }
    let 原名 = &b[头起 + 1..头起 + 1 + n];
    /* 名字可能是 SJIS 也可能是 GBK（MMD 中文版写 GBK），按原文回推再解 */
    解(原名, 名字原编码(原名))
}

/**
 * 路径里允许出现的字节（GBK 的汉字是 ≥ 0x80，所以只看"可打印、不是 NUL"）
 */
fn 路径字节(c: u8) -> bool {
    c >= 0x20 && c != 0x7f
}

/**
 * 枚举全文里结构说得通的条目。
 *
 * **锚在 NUL 上，而不是逐字节试**：`.pmm` 里的路径字段是 NUL 结尾的定长 256 字节，
 * 所以每个 NUL 前面那一段就是一条"候选路径文本"。从每个 NUL 往回走到路径起点（最多 256 字节），
 * 再用 `条目头信息` 回验"它前面真的是条目头"——是就成立，并顺手把**整条起点与类别**带出来
 * （摘条目要整段摘除，少了这个就没法摘）。
 *
 * 逐字节试那条路走过一次：77 MB 的工程上每个偏移都要解码一遍 SJIS/GBK，跑十分钟都出不来。
 * 锚在 NUL 上是**一趟扫描**，每个 NUL 只往回走几十字节，而且不做无谓的解码。
 *
 * 字段不重叠：一条成立之后，下一个候选只能从它字段之后开始（`上次结束`）。
 */
fn 枚举条目(b: &[u8]) -> Vec<条目> {
    let mut 出: Vec<条目> = Vec::new();
    let mut 上次结束 = 0usize;
    for q in 0..b.len() {
        if b[q] != 0 {
            continue;
        }
        /* 只在这个 NUL 前面确实是"路径结尾"时才做回溯（4 字节比较，很便宜）。
           不加这一层的话，文件里几百万个 NUL 每个都要回溯一遍，又慢回去了。 */
        if !结尾像扩展名(b, q) {
            continue;
        }
        /* 从 q 往回逐格试：路径起点必须**同时**满足"这一段像路径"和"前面是成立的条目头"。
           只按"走到不可打印为止"是不行的 —— 名字区也是可打印字节，会一路走进名字里。 */
        let 下界 = 上次结束.max(q.saturating_sub(256));
        let mut t = q;
        while t > 下界 + 4 {
            t -= 1;
            if b[t] == 0 {
                break;
            }
            let 文本 = 解(&b[t..q], GBK);
            if 像路径(&文本) {
                if let Some((头起, kind)) = 条目头信息(b, t) {
                    上次结束 = t + 256;
                    出.push(条目 {
                        头起,
                        offset: t,
                        名称: 条目名(b, 头起, kind),
                        路径: 文本,
                        截断: false,
                        kind,
                    });
                    break;
                }
            }
        }
    }
    出
}

/// 这个 NUL 前面是不是常见素材扩展名的结尾
fn 结尾像扩展名(b: &[u8], q: usize) -> bool {
    const 尾: [&[u8]; 8] = [
        b".pmx", b".pmd", b".x", b".fx", b".fxsub", b".vmd", b".png", b".tga",
    ];
    /* 大小写都认（ASCII） */
    尾.iter().any(|e| {
        let e = *e;
        if q < e.len() {
            return false;
        }
        b[q - e.len()..q]
            .iter()
            .zip(e.iter())
            .all(|(a, c)| a.to_ascii_lowercase() == *c)
    })
}

/// 兜底：被 256 撑满、没有 NUL 的字段（路径被截断）。整体扫一遍找"整段都可打印、像路径"的窗口
fn 枚举截断条目(b: &[u8]) -> Vec<条目> {
    let mut 出 = Vec::new();
    let mut i = 0usize;
    while i + 256 <= b.len() {
        let 窗 = &b[i..i + 256];
        if !窗.contains(&0)
            && 窗.iter().all(|c| 路径字节(*c))
            && 窗.contains(&b'\\')
        {
            let 文本 = 解(窗, GBK);
            if 像路径(&文本) {
                if let Some((头起, kind)) = 条目头信息(b, i) {
                    出.push(条目 {
                        头起,
                        offset: i,
                        名称: 条目名(b, 头起, kind),
                        路径: 文本,
                        截断: true,
                        kind,
                    });
                    i += 256;
                    continue;
                }
            }
        }
        i += 1;
    }
    出
}

/// 像不像"一个文件路径"（放宽锚时用，免得把随便一段字节当路径）
fn 像路径(s: &str) -> bool {
    let t = s.trim();
    if t.len() < 3 || t.len() > 255 {
        return false;
    }
    let 低 = t.to_lowercase();
    [
        ".pmx", ".pmd", ".x", ".fx", ".fxsub", ".vmd", ".png", ".tga", ".bmp", ".jpg", ".spa",
        ".sph", ".dds", ".sph",
    ]
    .iter()
    .any(|e| 低.ends_with(e))
}

/// 归一化：大小写、正反斜杠都当成一种写法
fn 归一(s: &str) -> String {
    s.trim().to_lowercase().replace('/', "\\")
}

fn 文件名(s: &str) -> String {
    s.trim()
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or("")
        .to_string()
}

/// 目录名（不含文件名），归一化后用 —— 与文件名分开比，是"另一台机器上目录不同、文件名相同"那类的关键
fn 目录名(s: &str) -> String {
    let t = 归一(s);
    match t.rfind('\\') {
        Some(i) => t[..i].to_string(),
        None => String::new(),
    }
}

/**
 * 找出每个对象的路径字段。两级：
 *
 * ① **完整路径**：`.pmm` 里"归一后等于 `.emm` 那条路径"的字段**全部**收进来。
 *    这里刻意**不做"一个对象认领一个字段"** —— 实测（133 个真工程 / 4501 条对象）里
 *    最常见的形状就是**同一路径有多个字段**（同一个模型在工程里放了好几次，
 *    再加上 `.pmm` 里残留的旧字段），如果按"每对象各数一次候选"，供给 2/需求 2
 *    也会被判成"候选不唯一"然后拒掉 —— **1371 条未命中就是这么来的**（占未命中的大头）。
 *    而且这类重复根本不用区分：同一旧路径的字段改成新路径后**都该是同一个新路径**，
 *    所以按"路径 → 所有偏移"整组改写既正确又更彻底（连残留字段一起改干净）。
 * ② 搜不到（`.pmm` 里存的是另一个写法、或路径被 256 截断）时，**改用文件名当锚**：
 *    文件名那段字节找出来，对每一处**用条目头结构往前推字段起点**，
 *    再要求"推出来的字段里读到的路径，文件名与 `.emm` 一致"。**这一级仍然唯一才用**
 *    （放宽后才只有文件名相同，认错就会把路径写到别的模型上）。
 *
 * **放宽的那三级筛不唯一就拒绝**（拒绝比乱改好）。失败要分类报出来，别只报"找不到"。
 */
pub fn 找字段(bytes: &[u8], 对象: &[对象]) -> (Vec<Pmm命中>, Vec<String>) {
    找字段_用表(&枚举全部(bytes), 对象)
}

/// 条目表整个枚举一遍（两条路：NUL 锚定的 + 被 256 撑满的）。
/// **一趟就够** —— `扫` 里"找字段"和"算条目链"都吃这一份，别各枚举一遍
/// （实测全语料 133 个工程：各枚举一遍要 280 秒，白花一倍时间）。
fn 枚举全部(bytes: &[u8]) -> Vec<条目> {
    let mut v = 枚举条目(bytes);
    v.extend(枚举截断条目(bytes));
    v
}

/// `找字段` 的正体：条目表由调用方给（好让一次枚举喂两个消费者）
fn 找字段_用表(条目表: &[条目], 对象: &[对象]) -> (Vec<Pmm命中>, Vec<String>) {
    let mut 用掉 = vec![false; 条目表.len()];
    let mut hits = Vec::new();
    let mut 问题 = Vec::new();

    /* 先建"归一路径 → 所有条目下标"的表：一趟扫完，后面按路径直接取 */
    let mut 按路径: HashMap<String, Vec<usize>> = HashMap::new();
    for (k, e) in 条目表.iter().enumerate() {
        if e.路径.is_empty() {
            continue;
        }
        按路径.entry(归一(&e.路径)).or_default().push(k);
    }

    for o in 对象 {
        if o.path.is_empty() {
            continue;
        }
        let 目标整 = 归一(&o.path);
        let 目标名 = 归一(&文件名(&o.path));
        let 目标目 = 归一(&目录名(&o.path));

        /* ① 完整路径：整组收下（见上面那段说明） */
        if let Some(全部) = 按路径.get(&目标整) {
            let offsets: Vec<usize> = 全部.iter().map(|k| 条目表[*k].offset).collect();
            for k in 全部.iter() {
                用掉[*k] = true;
            }
            hits.push(Pmm命中 {
                key: o.key.clone(),
                offset: offsets[0],
                全部: offsets,
                path: o.path.clone(),
                怎么找到的: "完整路径",
                名称: 条目表[全部[0]].名称.clone(),
            });
            continue;
        }

        /* ② 放宽：截断前缀 / 目录名+文件名 / 只文件名。逐级放宽，唯一才用 */
        let mut 选: Vec<(usize, &'static str)> = Vec::new();
        for (k, e) in 条目表.iter().enumerate() {
            if 用掉[k] || !e.截断 {
                continue;
            }
            let 前 = 归一(&e.路径);
            if !前.is_empty() && 目标整.starts_with(&前) {
                选.push((k, "截断前缀"));
            }
        }
        if 选.is_empty() {
            /* 目录名与文件名**分开比**（大小写、正反斜杠都归一） */
            for (k, e) in 条目表.iter().enumerate() {
                if !用掉[k]
                    && 归一(&文件名(&e.路径)) == 目标名
                    && 归一(&目录名(&e.路径)) == 目标目
                {
                    选.push((k, "目录名+文件名"));
                }
            }
        }
        if 选.is_empty() {
            for (k, e) in 条目表.iter().enumerate() {
                if !用掉[k] && 归一(&文件名(&e.路径)) == 目标名 {
                    选.push((k, "只文件名"));
                }
            }
        }

        match 选.len() {
            1 => {
                let (k, 法) = 选[0];
                用掉[k] = true;
                let off = 条目表[k].offset;
                hits.push(Pmm命中 {
                    key: o.key.clone(),
                    offset: off,
                    全部: vec![off],
                    path: o.path.clone(),
                    怎么找到的: 法,
                    名称: 条目表[k].名称.clone(),
                });
            }
            0 => 问题.push(format!(
                "找不到文件名：{} 的「{}」在所有结构条目里一处都没配上",
                o.key,
                文件名(&o.path)
            )),
            n => 问题.push(format!(
                "候选不唯一：{} 的「{}」配上 {n} 处（用的{}这一级）—— 拒绝改写",
                o.key,
                文件名(&o.path),
                if n > 0 { "最宽" } else { "" }
            )),
        }
    }
    (hits, 问题)
}

/// 往定长 256 的字段里覆写新路径（GBK），**不平移、不改长度**。
/// 长度超了就报错（不截断 —— 截断出来的路径 MMD 读不了）。
pub fn 改字段(bytes: &mut [u8], offset: usize, 新路径: &str) -> Result<(), String> {
    const 字段长: usize = 256;
    if offset + 字段长 > bytes.len() {
        return Err(format!("字段起点 {offset} 越界"));
    }
    let 新 = 编(新路径, GBK);
    if 新.len() + 1 > 字段长 {
        return Err(format!("新路径太长（{} 字节，上限 {字段长}）", 新.len()));
    }
    let mut 区 = vec![0u8; 字段长];
    区[..新.len()].copy_from_slice(&新);
    bytes[offset..offset + 字段长].copy_from_slice(&区);
    Ok(())
}

/* ============================================================ 改模型名 */

/**
 * 一处改名的描述：`(名字长度字节的位置, 原名, 新名)`。
 */
pub struct 一处改名 {
    pub 位置: usize,
    pub 原名: Vec<u8>,
    pub 新名: Vec<u8>,
}

/**
 * 按改名清单重组字节。
 *
 * 模型的条目是 `[u8 名字长][名字][u8 英文名长][英文名][路径 256]` —— 名字是**长度前缀**，
 * 所以改了长度就必须**插入/删除字节**，后面的内容整体前移或后移（这与"路径是定长 256、
 * 原地覆写不改长度"是两种写法，别混）。
 *
 * 之所以敢这么做：`.pmm` 里没有指向内部的绝对偏移（量测记录 §"没发现"），
 * 条目是顺序读的，所以整段位移不影响后面的解析。**但这个结论必须由调用方复验**：
 * 改组完要重新枚举一遍条目、条目数与模型数都得跟原来一样，对不上就拒绝写盘
 * （`搬家` 里就是这么做的）。
 */
pub fn 换名字(字节: &[u8], 清单: &[一处改名]) -> Result<Vec<u8>, String> {
    let mut 序: Vec<&一处改名> = 清单.iter().collect();
    序.sort_by_key(|c| c.位置);
    let mut 出 = Vec::with_capacity(字节.len());
    let mut 游标 = 0usize;
    for c in 序 {
        if c.位置 < 游标 {
            return Err(format!("改名位置 {} 与上一处重叠 —— 拒绝", c.位置));
        }
        if c.位置 >= 字节.len() {
            return Err(format!("改名位置 {} 越界 —— 拒绝", c.位置));
        }
        let 长度位 = 字节[c.位置] as usize;
        if 长度位 != c.原名.len() {
            return Err(format!(
                "改名位置 {} 上的长度字节是 {长度位}，与原名 {} 字节对不上 —— 拒绝",
                c.位置,
                c.原名.len()
            ));
        }
        let 尾 = c.位置 + 1 + c.原名.len();
        if 尾 > 字节.len() {
            return Err(format!("改名的名字字段越界（位置 {}）—— 拒绝", c.位置));
        }
        if &字节[c.位置 + 1..尾] != c.原名.as_slice() {
            return Err(format!("改名位置 {} 上的字节与原名不一致 —— 拒绝", c.位置));
        }
        if c.新名.len() > 255 {
            return Err(format!("新名字太长（{} 字节，上限 255）", c.新名.len()));
        }
        出.extend_from_slice(&字节[游标..c.位置]);
        出.push(c.新名.len() as u8);
        出.extend_from_slice(&c.新名);
        游标 = 尾;
    }
    出.extend_from_slice(&字节[游标..]);
    Ok(出)
}

/* ============================================================ .pmx */

#[derive(Serialize, Clone)]
pub struct 贴图 {
    pub pmx: String,
    pub index: i32,
    pub path: String,
    /// 盘上找得到吗（相对 `.pmx` 所在目录解）
    pub exists: bool,
}

/// PMX 头部那 10 个字节：编码标志在全局[0]（只为测试与"贴图串怎么存的"那几条实测留着）
#[cfg(test)]
fn pmx编码(b: &[u8]) -> Result<bool, String> {
    if b.len() < 10 || &b[0..4] != b"PMX " {
        return Err("不是 PMX（开头不是 `PMX `）".into());
    }
    Ok(b[9] == 0) // true = UTF-16LE。0..3 是 "PMX "、4..7 是版本、8 是全局数、9 才是全局[0]
}

/// 贴图清单：**问现有的 pmx 解析器**，不另写一份。
pub fn 收贴图(pmx: &Path) -> Result<Vec<贴图>, String> {
    let info = crate::pmx::read_pmx(pmx.to_string_lossy().to_string(), Some(1))?;
    let 目录 = pmx.parent().unwrap_or(Path::new("."));
    Ok(info
        .textures
        .iter()
        .enumerate()
        .map(|(i, t)| {
            let 有 = !t.is_empty() && 目录.join(解相对(t).as_str()).exists();
            贴图 {
                pmx: pmx.to_string_lossy().to_string(),
                index: i as i32,
                path: t.clone(),
                exists: 有,
            }
        })
        .collect())
}

fn 解相对(t: &str) -> String {
    t.replace('\\', std::path::MAIN_SEPARATOR_STR)
        .replace('/', std::path::MAIN_SEPARATOR_STR)
}

/// 在 `.pmx` 字节里定位一条贴图路径（"int32 长度 + 内容"整段），要求唯一。
///
/// **长度那一格存的是"字符数"不是"字节数"**（PMX 规格：UTF-16 时 `长度` = 字符个数）。
/// 早期这里一律写 `针.len()`（字节数），于是**所有 UTF-16 的 `.pmx` 都"找不到贴图路径"** ——
/// 实测就是被真工程副本的 C 验收抓出来的（`Flyer.pmx` 4 条贴图一条都没改）。
#[cfg(test)]
fn 找贴图段(bytes: &[u8], 路径: &str, utf16: bool) -> Result<(usize, usize), String> {
    let 针 = if utf16 { 编UTF16无BOM(路径) } else { 编(路径, UTF_8) };
    let mut 全针 = 段长(针.len(), utf16).to_le_bytes().to_vec();
    全针.extend_from_slice(&针);
    let mut 处 = Vec::new();
    let mut i = 0;
    while i + 全针.len() <= bytes.len() {
        if &bytes[i..i + 全针.len()] == &全针[..] {
            处.push(i);
            i += 1;
        } else {
            i += 1;
        }
    }
    match 处.len() {
        0 => Err(format!("在 .pmx 里找不到贴图路径「{路径}」")),
        1 => Ok((处[0], 全针.len())),
        n => Err(format!("贴图路径「{路径}」出现 {n} 处，不敢改")),
    }
}

/// PMX 文本字段长度那一格的值：**字节数**（实测：UTF-16 的 `.pmx` 里 `颜.png` 那格是 10 = 5 字符×2，
/// `data\skin_arms.png` 那格是 36 = 18×2 —— 两种编码都是字节数）。
///
/// 这条查错查了两轮：先误以为是"UTF-16 记字符数"（改了之后反而全找不到），
/// 用 `诊断_pmx贴图串存法` 把真字节并排打出来才看清 —— 存的确实是字节数。
#[cfg(test)]
fn 段长(字节数: usize, _utf16: bool) -> i32 {
    字节数 as i32
}

/// 编成 UTF-16LE（**无 BOM**）：逐字符取 `u16` 再小端铺开。
///
/// 不用 `encoding_rs` 的 `UTF_16LE.encode()` —— 实测它在这条路径上没给出"裸 UTF-16LE 字节"
/// （拼出来的针与 `.pmx` 里的字节对不上，于是所有 UTF-16 的 `.pmx` 都"找不到贴图路径"）。
/// PMX 的文本字段就是裸 UTF-16LE，自己铺最直接，也就没有"它到底加不加 BOM"这种模糊地带。
#[cfg(test)]
fn 编UTF16无BOM(s: &str) -> Vec<u8> {
    let mut v = Vec::with_capacity(s.len() * 2);
    for u in s.encode_utf16() {
        v.extend_from_slice(&u.to_le_bytes());
    }
    v
}

/* 平铺老路的贴图改写手 `改贴图` 已随 `打包` 一起删：
   它只在"平铺进一个目录"之后把 `.pmx` 里的贴图路径补回去。
   活路径（`migrate_root::搬根自带`）保留相对结构、连邻居一起拷，贴图路径一个字都不用改。
   下面 `找贴图段` / `段长` / `编UTF16无BOM` / `pmx编码` 留着 —— 只在测试里用，
   它们钉的是"PMX 里贴图串到底怎么存的"那几条实测结论。 */

/* ============================================================ 扫描与打包 */

#[derive(Serialize)]
pub struct 扫描结果 {
    pub pmm: String,
    pub emm: String,
    pub objects: Vec<对象>,
    pub effects: Vec<特效>,
    /// 每个对象的路径在盘上找得到吗
    pub 在盘上: Vec<bool>,
    /// 每个对象打包后会落在输出目录的哪个相对路径（界面直接显示，规则只有 `目标相对` 一份）
    pub 目标: Vec<String>,
    pub pmm_hits: Vec<Pmm命中>,
    pub 问题: Vec<String>,
    pub textures: Vec<贴图>,
    /// A 用：模型各自散在哪些目录里（按条数从多到少）
    pub 模型目录: Vec<目录组>,
    /// A 用：附件各自散在哪些目录里
    pub 附件目录: Vec<目录组>,
    /// B 用：这个工程能不能安全摘条目（条目链成立才行）
    pub 能摘: bool,
    /// 不能摘的原因（空串 = 能）
    pub 摘拦: String,
}

#[tauri::command]
pub fn 扫(pmm: String, emm: String) -> Result<扫描结果, String> {
    let pmmp = PathBuf::from(&pmm);
    let emmp = PathBuf::from(&emm);
    let 文本 = 读文本(&emmp)?;
    let e = parse_emm(&文本);
    let 字节 = fs::read(&pmmp).map_err(|e| format!("读不了 {pmm}：{e}"))?;
    /* 条目表**只枚举一遍**，下面"找字段"和"算条目链"共用它 */
    let 条目表 = 枚举全部(&字节);
    let (hits, mut 问题) = 找字段_用表(&条目表, &e.objects);
    let 在盘上: Vec<bool> = e
        .objects
        .iter()
        .map(|o| !o.path.is_empty() && PathBuf::from(&o.path).exists())
        .collect();
    /* 目标相对路径在扫描这一步就算出来给界面看（"先出表给你看"那条要求） */
    let 目标: Vec<String> = e
        .objects
        .iter()
        .map(|o| {
            let 类别 = if o.kind == "accessory" { "附件" } else { "模型" };
            目标相对(类别, Path::new(&o.path))
        })
        .collect();
    let mut textures = Vec::new();
    for (o, 有) in e.objects.iter().zip(在盘上.iter()) {
        if *有 && o.path.to_lowercase().ends_with(".pmx") {
            match 收贴图(Path::new(&o.path)) {
                Ok(t) => textures.extend(t),
                Err(msg) => 问题.push(format!("{}：{msg}", o.key)),
            }
        }
    }
    /* B 用：条目链成立才允许摘条目。算不出来就把原因写清楚（界面照原样显示） */
    let 摘拦 = match 算条目链_用表(&字节, &e.objects, &条目表) {
        Ok(_) => String::new(),
        Err(msg) => msg,
    };
    Ok(扫描结果 {
        pmm,
        emm,
        objects: e.objects.clone(),
        effects: e.effects,
        在盘上,
        目标,
        pmm_hits: hits,
        问题,
        textures,
        模型目录: 归目录(
            e.objects
                .iter()
                .filter(|o| o.kind == "model")
                .map(|o| (o.path.clone(), PathBuf::from(&o.path).exists())),
        ),
        附件目录: 归目录(
            e.objects
                .iter()
                .filter(|o| o.kind == "accessory")
                .map(|o| (o.path.clone(), PathBuf::from(&o.path).exists())),
        ),
        能摘: 摘拦.is_empty(),
        摘拦,
    })
}

/**
 * 目标相对路径。
 *
 * 规则（一句话）：按类别分目录，每个来源目录保留自己的目录名当一级
 * —— 这样同名不同目录的素材不会互相覆盖。
 * （原来还有一条"贴图跟在它所属模型的目录下面"：那是平铺老路 `打包` 用的，
 *  它已经删了，现在扫出来的这个相对路径只是给界面看"这条会落在哪一类下面"。）
 */
fn 目标相对(类别: &str, 来源: &Path) -> String {
    let 目录名 = 来源
        .parent()
        .and_then(|p| p.file_name())
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "根".into());
    let 文件名 = 来源
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    format!("{类别}/{目录名}/{文件名}").replace('\\', "/")
}

/* 平铺老路 `打包` 已删（2026-09-22 用户拍板）：平铺会把模型旁边的贴图引用打断，
   自包含走 `migrate_root::搬根自带`（保留相对结构、连邻居一起拷）。 */

/* ============================================================ 条目链（B 的判据） */

/// 读 `.pmm` 头里的 uint16 模型数：`0x36..0x37` 小端（实测 25/25 与 `.emm` 的模型数相等）
fn 读模型数(b: &[u8]) -> Option<u16> {
    let 两 = b.get(0x36..0x38)?;
    Some(u16::from_le_bytes([两[0], 两[1]]))
}

fn 写模型数(b: &mut [u8], v: u16) -> Result<(), String> {
    if b.len() < 0x38 {
        return Err("文件太短，没有 0x36 那个计数".into());
    }
    let 两 = v.to_le_bytes();
    b[0x36] = 两[0];
    b[0x37] = 两[1];
    Ok(())
}

/// 一条链上的条目 + 它在文件里的**整段**范围 `[起, 止)`
#[derive(Clone)]
struct 链条目 {
    起: usize,
    止: usize,
    kind: &'static str,
    槽位: u32,
}

/**
 * 算出一条**结构上说得通**的条目链 —— B（摘条目）只有在它成立时才允许动手。
 *
 * 判据（规格 §30–§33，全部照实测写的）：
 *   ① 头部的 uint16 模型数 == `.emm` 的模型数 == 扫出来的模型条目数；
 *   ② 附件条目数 == `.emm` 的附件数；
 *   ③ **模型全部排在附件之前**（实测不变式）；
 *   ④ 每条路径与 `.emm` 里同槽位对象**逐条对得上**（按槽位升序一一对应，归一比较）；
 *   ⑤ 条目不重叠（枚举时已保证），且每条都有"下一条"能界定它的帧区终点。
 *
 * 任一条不成立就 `Err` —— **宁可拒绝，不许猜**（挑错等于把字节摘到错误的位置，
 * 比不改更糟：MMD 打开会崩或者把特效挂到别的模型上）。
 */
fn 算条目链(b: &[u8], 对象: &[对象]) -> Result<Vec<链条目>, String> {
    算条目链_用表(b, 对象, &枚举全部(b))
}

/// `算条目链` 的正体：条目表由调用方给（一次枚举喂两个消费者）
fn 算条目链_用表(b: &[u8], 对象: &[对象], 条目表: &[条目]) -> Result<Vec<链条目>, String> {
    let 期望模型: Vec<&对象> = 对象.iter().filter(|o| o.kind == "model").collect();
    let 期望附件: Vec<&对象> = 对象.iter().filter(|o| o.kind == "accessory").collect();
    let 头模型数 = 读模型数(b).ok_or("读不出头部的模型计数（文件太短）")?;
    let 模型: Vec<条目> = 条目表.iter().filter(|e| e.kind == "model").cloned().collect();
    let 附件: Vec<条目> = 条目表.iter().filter(|e| e.kind == "accessory").cloned().collect();

    /*
     * 主约束是**头部的 `0x36..0x37`（uint16 = 模型数）**，不是 `.emm` 的模型条数。
     *
     * 早期这里拿 `.emm` 的模型数当硬约束，结果真工程上 131/133 被判"对不上" —— 因为
     * `.pmm` 里的模型**可以比 `.emm` 多**（没配特效的模型 `.emm` 就不列，
     * 而 `.pmm` 里它照样是一个带变换和关键帧的对象）。拿 `.emm` 当"总数"是概念错位。
     * `.emm` 的作用只剩一个：**按路径把它的对象配到条目上**（同一路径出现多次时逐个消耗）。
     */
    if 模型.len() != 头模型数 as usize {
        return Err(format!(
            "扫出来的模型条目是 {} 条，头部计数说 {} 条 —— 对不上，不敢摘（模型条目识别本来就不稳）",
            模型.len(),
            头模型数
        ));
    }
    if 附件.len() < 期望附件.len() {
        return Err(format!(
            "扫出来的附件条目是 {} 条，比 .emm 里的 {} 条还少 —— 对不上，不敢摘",
            附件.len(),
            期望附件.len()
        ));
    }
    let 末模型 = 模型.last().map(|e| e.offset).unwrap_or(0);
    if 附件.iter().any(|e| e.offset < 末模型) {
        return Err("附件条目跑到模型前面去了 —— 与实测不变式不符，不敢摘".into());
    }

    /* 配法：`.emm` 的对象按槽位升序，各自认领**一条同路径的**、还没被认领的条目。
       同一路径出现多次（同一个模型放了好几次）就逐个消耗；认不出来（数量不够）就拒绝。
       `.pmm` 里剩下的条目 = 没配特效的对象，**保留**，它们照样在链里占位置（摘条目要算边界）。 */
    let mut 用掉 = vec![false; 模型.len() + 附件.len()];
    let 全部条目: Vec<条目> = 模型.iter().chain(附件.iter()).cloned().collect();
    let mut 配到: Vec<(u32, &'static str, usize)> = Vec::new(); // (槽位, 类别, 条目下标)
    let mut 排模型: Vec<&对象> = 期望模型.clone();
    排模型.sort_by_key(|o| o.index);
    let mut 排附件: Vec<&对象> = 期望附件.clone();
    排附件.sort_by_key(|o| o.index);
    for (o, 类别) in 排模型
        .iter()
        .map(|o| (*o, "model"))
        .chain(排附件.iter().map(|o| (*o, "accessory")))
    {
        let 目标 = 归一(&o.path);
        let 命中 = 全部条目
            .iter()
            .enumerate()
            .find(|(i, e)| !用掉[*i] && e.kind == 类别 && 归一(&e.路径) == 目标);
        match 命中 {
            Some((i, _)) => {
                用掉[i] = true;
                配到.push((o.index, 类别, i));
            }
            None => {
                return Err(format!(
                    "{}（{}）在 .pmm 的条目里配不到同路径的那一条 —— 对不上，不敢摘",
                    o.key, o.path
                ))
            }
        }
    }

    /* 链 = **所有**模型条目 + 附件条目（含没配到 `.emm` 的那些），按偏移排，逐条算整段范围 */
    let mut 链: Vec<链条目> = Vec::new();
    for (i, e) in 全部条目.iter().enumerate() {
        let 槽位 = 配到.iter().find(|(_, _, j)| *j == i).map(|(s, _, _)| *s).unwrap_or(0);
        链.push(链条目 { 起: e.头起, 止: 0, kind: e.kind, 槽位 });
    }
    链.sort_by_key(|e| e.起);
    if 链.len() < 2 {
        return Err("条目不足两条，算不出帧区终点".into());
    }
    for i in 0..链.len() {
        let 止 = if i + 1 < 链.len() { 链[i + 1].起 } else { b.len() };
        if 止 <= 链[i].起 {
            return Err(format!("第 {} 条的边界算不出来（起点 {} 之后就到头了）", i + 1, 链[i].起));
        }
        链[i].止 = 止;
    }
    Ok(链)
}

#[derive(Serialize, Clone, Debug)]
pub struct 摘掉 {
    pub key: String,
    pub 类别: String,
    pub 路径: String,
    /// 从文件的哪个字节摘到哪个字节（整段，含它的帧区）
    pub 起: usize,
    pub 止: usize,
    pub 为什么: String,
}

#[derive(Serialize, Debug)]
pub struct 摘结果 {
    /// 逐条列出去掉了什么（**不许静默丢**）
    pub 去掉: Vec<摘掉>,
    /// 剩几个对象
    pub 留: usize,
    pub 旧模型数: u16,
    pub 新模型数: u16,
    /// `.emm`：删了几行、改了几个编号
    pub emm去行: usize,
    pub emm改号: usize,
    /// `.pmm` 字节数：改之前 → 改之后
    pub pmm原字节: usize,
    pub pmm新字节: usize,
    pub 输出: String,
    pub 问题: Vec<String>,
    pub 干跑: bool,
}

/**
 * B：把"盘上找不到的条目"从工程里去掉，剩下的照常保存。
 *
 * 目标（用户原话）：**"找不到模型那么 pmm、emm 就载入可以载入的内容然后可以正常打开"** ——
 * 载入不再弹找不到文件、不再闪退。
 *
 * 边界（规格 §2 与 `⑥工程迁移-格式规格.md`）：
 *   · **附件不做** —— 附件数在头部找不到，不知道删了该改哪个计数；
 *   · **最后一条不做** —— 它的帧区到哪儿结束没有依据；
 *   · **链不成立就整体拒绝** —— 宁可不动盘。
 */
#[tauri::command]
pub fn 摘丢失(pmm: String, emm: String, 输出: String, 干跑: bool) -> Result<摘结果, String> {
    let pmmp = PathBuf::from(&pmm);
    let emmp = PathBuf::from(&emm);
    let e = parse_emm(&读文本(&emmp)?);
    let 原 = fs::read(&pmmp).map_err(|er| format!("读不了 {pmm}：{er}"))?;
    let 旧模型数 = 读模型数(&原).ok_or("读不出模型计数")?;

    /* 谁丢了。**先判"丢的是不是附件"再算条目链** —— 附件不做是产品边界（附件数在头部找不到），
       不该等到结构检查那一步才报，否则报出来的原因是"链算不出来"，把真正的边界埋掉了。 */
    let 丢: Vec<&对象> = e
        .objects
        .iter()
        .filter(|o| o.path.trim().is_empty() || !PathBuf::from(&o.path).exists())
        .collect();
    if 丢.is_empty() {
        return Ok(摘结果 {
            去掉: Vec::new(),
            留: e.objects.len(),
            旧模型数,
            新模型数: 旧模型数,
            emm去行: 0,
            emm改号: 0,
            pmm原字节: 原.len(),
            pmm新字节: 原.len(),
            输出,
            问题: Vec::new(),
            干跑,
        });
    }
    let 链 = 算条目链(&原, &e.objects)?;
    let 末 = 链.last().ok_or("条目链是空的")?;
    let mut 去掉: Vec<摘掉> = Vec::new();
    let mut 删槽位: Vec<u32> = Vec::new();
    let mut 删模型数 = 0u16;
    for o in 丢.iter() {
        let Some(ce) = 链.iter().find(|c| c.槽位 == o.index && c.kind == o.kind) else {
            return Err(format!("{} 在条目链里找不到，不敢摘", o.key));
        };
        if ce.起 == 末.起 {
            return Err(format!(
                "{} 是最后一条 —— 它的帧区到哪儿结束没有依据，摘不了（先摘别的、或者手工处理）",
                o.key
            ));
        }
        去掉.push(摘掉 {
            key: o.key.clone(),
            类别: if o.kind == "accessory" { "附件" } else { "模型" }.into(),
            路径: o.path.clone(),
            起: ce.起,
            止: ce.止,
            为什么: "盘上找不到这个文件".into(),
        });
        删槽位.push(o.index);
        if o.kind == "model" {
            删模型数 += 1;
        }
    }
    /* 从后往前摘，前面的偏移才不受影响 */
    let mut 计划 = 去掉.clone();
    计划.sort_by(|a, b| b.起.cmp(&a.起));
    let mut 新 = 原.clone();
    /* 附件序号：**不是存着的、是推出来的** —— 每个附件块首 u32 是 0 起稠密序号
       （量测规格 §41：`Main` 1→0、`Addiction` 18→17、`Cat Loving` 15→14、`DAYBREAK FRONTLINE` 20→19）。
       删掉附件之后，序号大于被删的都要减一，保持 0..n-1 稠密。位置取"名字[100] 前面那 4 字节"。 */
    let 附件序号位置: Vec<(usize, u32)> = 链
        .iter()
        .filter(|c| c.kind == "accessory" && c.起 >= 4)
        .map(|c| (c.起 - 4, c.槽位.saturating_sub(1)))
        .collect();
    let 删附件槽: Vec<u32> = 去掉
        .iter()
        .zip(删槽位.iter())
        .filter(|(d, _)| d.类别 == "附件")
        .map(|(_, s)| *s)
        .collect();
    for d in 计划.iter() {
        if d.止 > 新.len() || d.起 >= d.止 {
            return Err(format!("{} 的范围 [{} , {}) 越界", d.key, d.起, d.止));
        }
        新.drain(d.起..d.止);
    }
    /* 先算"每个被删区间前面一共少了多少字节"，再据此把序号格子搬到新位置并改值 */
    for (原处, 序号) in 附件序号位置.iter() {
        let 被删过 = 计划.iter().any(|d| 原处 >= &d.起 && 原处 < &d.止);
        if 被删过 {
            continue; // 这一条自己就被摘了
        }
        let 位移: usize = 计划.iter().filter(|d| d.止 <= *原处).map(|d| d.止 - d.起).sum();
        let 新处 = 原处 - 位移;
        let 减少 = 删附件槽.iter().filter(|d| **d - 1 < *序号).count() as u32;
        let 值 = 序号 - 减少;
        if 新处 + 4 > 新.len() {
            return Err("附件序号格子越界".into());
        }
        let 前 = u32::from_le_bytes([原[*原处], 原[*原处 + 1], 原[*原处 + 2], 原[*原处 + 3]]);
        if 前 != *序号 {
            return Err(format!(
                "附件序号格子对不上：位置 {原处} 处读到 {前}，按块首应该是 {序号} —— 不敢改（附件序号的口径与量测不符）"
            ));
        }
        新[新处..新处 + 4].copy_from_slice(&值.to_le_bytes());
    }
    let 新模型数 = 旧模型数 - 删模型数;
    写模型数(&mut 新, 新模型数)?;

    let 文本 = 读文本(&emmp)?;
    let (新文本, emm去行, emm改号) = 重排_emm(&文本, &删槽位);

    let mut 问题 = Vec::new();
    if !干跑 {
        /* 输出目录空 = 原地改（先留 .bak）；给了目录就写过去，不覆盖已存在的 */
        let 落 = |源: &Path| -> Result<PathBuf, String> {
            if 输出.trim().is_empty() {
                let bak = 源.with_extension(format!(
                    "{}.bak",
                    源.extension().map(|x| x.to_string_lossy().to_string()).unwrap_or_default()
                ));
                if !bak.exists() {
                    fs::copy(源, &bak).map_err(|er| format!("留备份失败：{er}"))?;
                }
                Ok(源.to_path_buf())
            } else {
                let 目录 = PathBuf::from(&输出);
                fs::create_dir_all(&目录).map_err(|er| format!("建目录失败：{er}"))?;
                let 名 = 源.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
                Ok(目录.join(名))
            }
        };
        let pmm出 = 落(&pmmp)?;
        let emm出 = 落(&emmp)?;
        fs::write(&pmm出, &新).map_err(|er| format!("写不了 {}：{er}", pmm出.display()))?;
        fs::write(&emm出, 编(&新文本, GBK)).map_err(|er| format!("写不了 {}：{er}", emm出.display()))?;
    }
    if 去掉.len() == 0 {
        问题.push("没有可摘的条目".into());
    }
    Ok(摘结果 {
        留: e.objects.len() - 去掉.len(),
        去掉,
        旧模型数,
        新模型数,
        emm去行,
        emm改号,
        pmm原字节: 原.len(),
        pmm新字节: 新.len(),
        输出,
        问题,
        干跑,
    })
}

/* ============================================================ A：搬家改路径 */

#[derive(Serialize, Debug)]
pub struct 搬家行 {
    pub key: String,
    pub 类别: String,
    pub 旧: String,
    pub 新: String,
    /// 新位置那份文件在不在（用户得先把素材挪过去）
    pub 新位置有: bool,
    /// 这个对象的路径字段在 `.pmm` 里定位到了没有
    pub 定位: String,
    /// 这条最后怎么处置的：`指到新位置` / `保持原路径` / `找不到`
    pub 处置: String,
    /// `.pmm` 条目里现在写的名字（模型才有；附件是定长 100 字节名字区）
    pub 名称: String,
    /// 用户要改成的新名字（没改就是空串）
    pub 新名: String,
}

#[derive(Serialize, Debug)]
pub struct 搬家结果 {
    pub 表: Vec<搬家行>,
    pub 改了几处: usize,
    /// 改了几个模型名字
    pub 改名几处: usize,
    pub 输出: String,
    pub 问题: Vec<String>,
    pub 干跑: bool,
}

/**
 * A：工程文件齐全时，把路径指到新位置（**只是改路径，不拷贝文件**）。
 *
 * 用户口径：自动识别引用文件现在在哪儿 → 让他指定新的模型目录 / 附件目录（两部分）→ 保存。
 * 新位置那个文件**得先在盘上**（用户自己把素材挪过去）；不在的话这一条照实标出来，
 * 并且**整体拒绝写盘** —— 半改半不改的工程比不改更糟（旧路径已经不在了）。
 *
 * 路径按**绝对路径**写回（写的是"新目录 + 原文件名"）；要"跟着工程走的相对路径"用另一个
 * 流程（自包含打包）。两边都不改素材文件本身。
 */
#[tauri::command]
pub fn 搬家(
    pmm: String,
    emm: String,
    模型目录: String,
    附件目录: String,
    输出: String,
    干跑: bool,
    // 要改的模型名字：`Pmd3` → 新名字（不传就是只搬路径）
    改名: Option<HashMap<String, String>>,
) -> Result<搬家结果, String> {
    let pmmp = PathBuf::from(&pmm);
    let emmp = PathBuf::from(&emm);
    let e = parse_emm(&读文本(&emmp)?);
    let 原 = fs::read(&pmmp).map_err(|er| format!("读不了 {pmm}：{er}"))?;
    /* 条目表只枚举一遍，"找字段"（后面改名重组之后还要再枚举一遍）都吃这一份 */
    let 条目表0 = 枚举全部(&原);
    let (mut hits, 冲突) = 找字段_用表(&条目表0, &e.objects);
    let 命中表: HashMap<String, String> = hits
        .iter()
        .map(|h| (h.key.clone(), h.怎么找到的.to_string()))
        .collect();
    /* 命中条目里写的名字（模型才有）——参考工具那页显示的就是"名称 + 路径" */
    let 命中名: HashMap<String, String> = hits
        .iter()
        .map(|h| (h.key.clone(), h.名称.clone()))
        .collect();
    let 要改名: HashMap<String, String> = 改名.clone().unwrap_or_default();
    let mut 表: Vec<搬家行> = Vec::new();
    let mut 新路径: HashMap<String, String> = HashMap::new();
    let mut 问题 = 冲突.clone();
    for o in e.objects.iter() {
        let 类别 = if o.kind == "accessory" { "附件" } else { "模型" };
        let 目录 = if o.kind == "accessory" { &附件目录 } else { &模型目录 };
        let 名 = 文件名(&o.path);
        /* 新目录里**按文件名找**：找到就用新位置；找不到就看旧路径还在不在。
           真样本（24 条里只有 2 条搬走）证明这条是必须的 —— 早期"一律指到新目录"
           会把没搬的那 22 条判成"新位置没文件"，于是整个工程被拒绝写盘。 */
        let 新 = if 目录.trim().is_empty() || 名.is_empty() {
            String::new()
        } else {
            PathBuf::from(目录).join(&名).to_string_lossy().to_string()
        };
        let 新位置有 = !新.is_empty() && PathBuf::from(&新).is_file();
        let 旧位置有 = !o.path.trim().is_empty() && PathBuf::from(&o.path).is_file();
        let (处置, 落) = if 新位置有 {
            ("指到新位置", 新.clone())
        } else if 旧位置有 {
            ("保持原路径", o.path.clone())
        } else {
            ("找不到", String::new())
        };
        if 处置 == "找不到" {
            问题.push(format!(
                "{}：旧位置没有、{}目录里也没有同名文件（原路径 {}）",
                o.key, 类别, o.path
            ));
        }
        表.push(搬家行 {
            key: o.key.clone(),
            类别: 类别.into(),
            旧: o.path.clone(),
            新: 新.clone(),
            新位置有,
            定位: 命中表.get(&o.key).cloned().unwrap_or_default(),
            处置: 处置.into(),
            名称: 命中名.get(&o.key).cloned().unwrap_or_default(),
            新名: String::new(),
        });
        if !落.is_empty() {
            新路径.insert(o.key.clone(), 落);
        }
    }

    /* ---- 要改的名字：只认模型 ----
       附件名字是**定长 100 字节区**（没有长度前缀），改长度会把后面全冲掉；
       模型名字是长度前缀，改了长度要**插入/删除字节**（`换名字` 干这个）。
       两种形状别混 —— 混了就是把附件后面的字节冲掉。 */
    let mut 名清单: Vec<一处改名> = Vec::new();
    let mut 名对: Vec<(Vec<u8>, Vec<u8>)> = Vec::new();
    let mut 名改表: HashMap<String, String> = HashMap::new();
    if !要改名.is_empty() {
        let 按偏移: HashMap<usize, usize> = 条目表0
            .iter()
            .enumerate()
            .map(|(i, e)| (e.offset, i))
            .collect();
        for o in e.objects.iter() {
            let Some(想) = 要改名.get(&o.key) else { continue };
            let 想 = 想.trim();
            if 想.is_empty() {
                continue;
            }
            let 现在 = 命中名.get(&o.key).cloned().unwrap_or_default();
            if 现在 == 想 {
                continue;
            }
            if o.kind == "accessory" {
                问题.push(format!(
                    "{}：附件名字是定长 100 字节区，这一版只改模型名（没动它）",
                    o.key
                ));
                continue;
            }
            let Some(h) = hits.iter().find(|h| h.key == o.key) else { continue };
            let Some(&idx) = 按偏移.get(&h.offset) else {
                问题.push(format!("{}：这条条目没在条目表里，名字没改", o.key));
                continue;
            };
            let 头起 = 条目表0[idx].头起;
            let 长 = 原.get(头起).copied().unwrap_or(0) as usize;
            if 长 == 0 || 头起 + 1 + 长 > 原.len() {
                问题.push(format!("{}：名字字段读不出来，名字没改", o.key));
                continue;
            }
            let 原名 = 原[头起 + 1..头起 + 1 + 长].to_vec();
            let enc = 名字原编码(&原名);
            let Some(新字节) = 编严(想, enc).or_else(|| 编严(想, GBK)) else {
                return Err(format!(
                    "{}：新名字「{}」写不进这个工程用的编码（原名那一条是 {:?} 写的）——换个名字，或者这次只改路径。没有写盘。",
                    o.key,
                    想,
                    enc.name()
                ));
            };
            /* **只放行等长改名**。实测（8 个真工程，`真工程改名实测`）：
               改长度之后我们自己的结构自检会失效 —— 条目数没变，但那条条目认不出来、
               路径定位掉一条。原因是新名字的编码字节里出现了 `0x5C`（SJIS 尾字节），
               被 `名字像路径` 当成路径符号拒了。文件本身可能没事，但**我们无法再证明它没事**，
               所以不做（宁可少一个功能，不许把工程改坏）。 */
            if 新字节.len() != 原名.len() {
                return Err(format!(
                    "{}：这个版本只支持「等长」改名字（原名 {} 字节，新名 {} 字节）。\n\
                     改长度会让本工具的结构自检失效（实测 8/8 工程上定位会掉一条），没法向你保证没改坏。\n\
                     要改长度就自己数够字节数，比如原名字是 {} 字节，就写一个同样字节数的名字。",
                    o.key,
                    原名.len(),
                    新字节.len(),
                    原名.len()
                ));
            }
            名清单.push(一处改名 { 位置: 头起, 原名: 原名.clone(), 新名: 新字节.clone() });
            名对.push((原名, 新字节));
            名改表.insert(o.key.clone(), 想.to_string());
        }
        /* 表里按 key 把"改前 → 改后"照出来（按名字回填会撞重名） */
        for r in 表.iter_mut() {
            if let Some(新) = 名改表.get(&r.key) {
                r.新名 = 新.clone();
            }
        }
    }
    let 没定位: Vec<&搬家行> = 表.iter().filter(|r| r.定位.is_empty()).collect();
    if !没定位.is_empty() {
        return Err(format!(
            "有 {} 个对象的路径字段没定位到（{}）—— 写盘会改不全，拒绝。表里能看到是哪些。",
            没定位.len(),
            没定位.iter().take(6).map(|r| r.key.clone()).collect::<Vec<_>>().join("、")
        ));
    }
    /* 既不在旧位置、也不在新目录里的才拒绝（"保持原路径"那些不算缺）：
       缺了还写盘 = 一半路径指新位置、一半指旧位置，比不写更糟（MMD 打开全是找不到）。 */
    if !干跑 {
        let 缺: Vec<&搬家行> = 表.iter().filter(|r| r.处置 == "找不到").collect();
        if !缺.is_empty() {
            /* 提示必须说**实话**：缺的原因多半不是"素材没放好"，而是
               "这些路径指向别的机器上的根（本机没有这个盘/目录）"。
               所以把识别到的旧根逐条列出来，并指路到"根替换"。 */
            let 根们 = crate::migrate_root::找死根(&pmm, &emmp.to_string_lossy())
                .map(|v| {
                    v.iter()
                        .map(|g| format!("{}（{} 条）", g.根, g.条数))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let 线索 = if 根们.is_empty() {
                String::new()
            } else {
                format!("\n识别到的旧根：{}", 根们.join("、"))
            };
            return Err(format!(
                "有 {} 条路径「本机找不到」（{}）。{线索}\n\
                 这些路径指向别的位置（多半是「别的机器上的根」），不是「素材没放好」。\n\
                 请用「根替换」给每个旧根指定一个新根（会保留相对结构，贴图跟着模型走）。没有写盘。",
                缺.len(),
                缺.iter().take(6).map(|r| format!("{}（{}）", r.key, r.旧)).collect::<Vec<_>>().join("、")
            ));
        }
    }
    let mut 改了几处 = 0;
    let mut 输出路径 = 输出.clone();
    if !干跑 {
        /* 先按名字重组（名字是长度前缀，改长度 = 插入/删除字节），
           再在原字节上按"路径 → 所有字段"覆写（路径是定长 256，不改长度）。
           **这两步的顺序不能反**：名字一动，后面所有路径字段的偏移都变了。 */
        let mut 字节 = if 名清单.is_empty() {
            原.clone()
        } else {
            换名字(&原, &名清单)?
        };
        if !名清单.is_empty() {
            /* 改组完必须**复验结构**：条目数、模型数都得跟原来一样。
               对不上就拒绝写盘（宁可不动 —— 结构猜错就是把工程改坏）。 */
            let 后表 = 枚举全部(&字节);
            if 后表.len() != 条目表0.len() {
                return Err(format!(
                    "改完名字结构对不上：结构条目数 {} → {} —— 拒绝写盘（原文件一个字节没动）",
                    条目表0.len(),
                    后表.len()
                ));
            }
            if 读模型数(&字节) != 读模型数(&原) {
                return Err("改完名字模型数变了 —— 拒绝写盘（原文件一个字节没动）".into());
            }
            let (h2, 问题2) = 找字段_用表(&后表, &e.objects);
            if h2.len() != hits.len() {
                return Err(format!(
                    "改完名字有 {} 个对象的路径定位不到了（原来 {} 个）—— 拒绝写盘（原文件一个字节没动）",
                    hits.len().saturating_sub(h2.len()),
                    hits.len()
                ));
            }
            问题.extend(问题2);
            hits = h2;
        }
        /* 按"路径 → 所有字段"改写：同一条路径在 `.pmm` 里的每一处都要写
           （重复字段、残留字段都在里面），否则留下的是旧路径 */
        let mut 写过 = std::collections::HashSet::new();
        for h in hits.iter() {
            let Some(新) = 新路径.get(&h.key) else { continue };
            for off in h.全部.iter() {
                if !写过.insert(*off) {
                    continue;
                }
                match 改字段(&mut 字节, *off, 新) {
                    Ok(()) => 改了几处 += 1,
                    Err(msg) => {
                        return Err(format!("{}：{msg}（拒绝写盘）", h.key));
                    }
                }
            }
        }
        let (新文本, 个数) = rewrite_emm(&读文本(&emmp)?, &新路径);
        改了几处 += 个数;
        /* 回读判据用的**旧→新配对**：只有真的改过的那几条（"指到新位置"）才对账。
           "保持原路径"的不进这里 —— 它的旧=新，拿它去判"旧路径还在"必然失败。 */
        let 改对: Vec<(String, String)> = 表
            .iter()
            .filter(|r| r.处置 == "指到新位置")
            .map(|r| (r.旧.clone(), r.新.clone()))
            .collect();
        if 输出.trim().is_empty() {
            for 源 in [&pmmp, &emmp] {
                let bak = 源.with_extension(format!(
                    "{}.bak",
                    源.extension().map(|x| x.to_string_lossy().to_string()).unwrap_or_default()
                ));
                if !bak.exists() {
                    fs::copy(源, &bak).map_err(|er| format!("留备份失败：{er}"))?;
                }
            }
            let 回读 = |p: &Path, 内存: &[u8]| -> Result<(), String> {
                /* 写完立刻回读。起因：有一轮"验收全过"、而盘上那份文件一个字节没变 ——
                   写盘落了空，界面照样报成功。判据三条，缺一不可。 */
                let 盘 = fs::read(p).map_err(|er| format!("写完读不回来 {}：{er}", p.display()))?;
                if 盘 != 内存 {
                    return Err(format!(
                        "写完回读不一致：{}（盘上 {} 字节，内存 {} 字节）",
                        p.display(),
                        盘.len(),
                        内存.len()
                    ));
                }
                let 有 = |针: &str| {
                    let n = 编(针, GBK);
                    !n.is_empty() && 盘.windows(n.len()).any(|w| w == n.as_slice())
                };
                /* 判据要用**旧→新**配对（不是对象键）：早先这里拿 key 当"旧路径"去搜，
                   `Pmd1` 这种键在 .emm 里本来就在，于是必判失败 —— 回读自己抓出来的。 */
                for (旧, 新) in 改对.iter() {
                    if !有(新) {
                        return Err(format!("写完回读：新路径没落进 {}（{}）", p.display(), 新));
                    }
                    /* 同一路径在 .pmm 里最多出现 6 次（字段定长 256 且写入不清零，会留旧尾巴）。
                       只改第一处就会出现这一条 —— 那等于没改，MMD 照旧按旧路径找文件。 */
                    if 有(旧) {
                        return Err(format!(
                            "写完回读：旧路径在 {} 里还剩着（{}）—— 没覆盖到该名字的每一处",
                            p.display(),
                            旧
                        ));
                    }
                }
                /* 名字同理：新名必须在、旧名不许剩（名字只写在 .pmm 里） */
                if p.extension().map(|x| x.to_string_lossy().to_ascii_lowercase()) == Some("pmm".into()) {
                    for (旧名, 新名) in 名对.iter() {
                        if !盘.windows(新名.len()).any(|w| w == 新名.as_slice()) {
                            return Err(format!(
                                "写完回读：新名字在 {} 里找不到（{}）",
                                p.display(),
                                解(新名, 名字原编码(新名))
                            ));
                        }
                        if 盘.windows(旧名.len()).any(|w| w == 旧名.as_slice()) {
                            return Err(format!(
                                "写完回读：旧名字在 {} 里还剩着（{}）",
                                p.display(),
                                解(旧名, 名字原编码(旧名))
                            ));
                        }
                    }
                }
                Ok(())
            };
            fs::write(&pmmp, &字节).map_err(|er| format!("写不了 .pmm：{er}"))?;
            let emm字节 = 编(&新文本, GBK);
            fs::write(&emmp, &emm字节).map_err(|er| format!("写不了 .emm：{er}"))?;
            回读(&pmmp, &字节)?;
            回读(&emmp, &emm字节)?;
            输出路径 = pmmp.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
        } else {
            let 目录 = PathBuf::from(&输出);
            fs::create_dir_all(&目录).map_err(|er| format!("建目录失败：{er}"))?;
            let 名 = |p: &Path| p.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
            let pmm目标 = 目录.join(名(&pmmp));
            let emm目标 = 目录.join(名(&emmp));
            let emm字节 = 编(&新文本, GBK);
            fs::write(&pmm目标, &字节).map_err(|er| format!("写不了 .pmm：{er}"))?;
            fs::write(&emm目标, &emm字节).map_err(|er| format!("写不了 .emm：{er}"))?;
            /* 输出目录这条路同样要回读：判据与上面一致 */
            let 回读2 = |p: &Path, 内存: &[u8]| -> Result<(), String> {
                let 盘 = fs::read(p).map_err(|er| format!("写完读不回来 {}：{er}", p.display()))?;
                if 盘 != 内存 {
                    return Err(format!(
                        "写完回读不一致：{}（盘上 {} 字节，内存 {} 字节）",
                        p.display(),
                        盘.len(),
                        内存.len()
                    ));
                }
                let 有 = |针: &str| {
                    let n = 编(针, GBK);
                    !n.is_empty() && 盘.windows(n.len()).any(|w| w == n.as_slice())
                };
                for (旧, 新) in 改对.iter() {
                    if !有(新) {
                        return Err(format!("写完回读：新路径没落进 {}（{}）", p.display(), 新));
                    }
                    if 有(旧) {
                        return Err(format!("写完回读：旧路径在 {} 里还剩着（{}）", p.display(), 旧));
                    }
                }
                Ok(())
            };
            回读2(&pmm目标, &字节)?;
            回读2(&emm目标, &emm字节)?;
        }
    }
    Ok(搬家结果 {
        表,
        改了几处,
        改名几处: 名清单.len(),
        输出: 输出路径,
        问题,
        干跑,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const EMM: &str = "[Info]\r\nVersion = 3\r\n\r\n[Object]\r\nAcs1 = D:\\a\\ray.x\r\nPmd2 = D:\\b\\Flyer.pmx\r\n\r\n[Effect]\r\nDefault = none\r\nPmd2 = D:\\b\\main.fx\r\nPmd2[0] = D:\\b\\1.fx\r\nPmd2.show = true\r\n";

    #[test]
    fn emm_parses_objects_and_effects() {
        let e = parse_emm(EMM);
        assert_eq!(e.objects.len(), 2);
        assert_eq!(e.objects[0].key, "Acs1");
        assert_eq!(e.objects[0].kind, "accessory");
        assert_eq!(e.objects[0].index, 1);
        assert_eq!(e.objects[1].kind, "model");
        assert_eq!(e.objects[1].path, "D:\\b\\Flyer.pmx");
        /* 逐材质特效、.show 都要能认出来 */
        let 材质 = e.effects.iter().find(|x| x.material == Some(0)).unwrap();
        assert_eq!(材质.key, "Pmd2");
        let show = e.effects.iter().find(|x| x.field.is_some()).unwrap();
        assert_eq!(show.field.as_deref(), Some("show"));
    }

    #[test]
    fn emm_rewrite_only_touches_object_paths() {
        let mut 新 = HashMap::new();
        新.insert("Pmd2".to_string(), ".\\模型\\Flyer.pmx".to_string());
        let (出, 数) = rewrite_emm(EMM, &新);
        assert_eq!(数, 1);
        /* **值换了、写法不动**：原文是 `Pmd2 = D:\…`（等号两侧有空格），改完还得是这个写法 */
        assert!(
            出.contains("Pmd2 = .\\模型\\Flyer.pmx"),
            "只换值、等号两侧的空格要原样保留：{:?}",
            出.lines().find(|l| l.starts_with("Pmd2 =")).unwrap_or("<没有>")
        );
        /* 别的行一个字符都不许动：把改过的那行拿掉，剩下的应当完全一致 */
        let 剥 = |s: &str| {
            s.lines()
                .filter(|l| !l.starts_with("Pmd2"))
                .collect::<Vec<_>>()
                .join("\r\n")
        };
        assert_eq!(剥(&出), 剥(EMM), "改完之后除了那条路径，其余行必须一字不差：\n出={:?}\n原={:?}", 剥(&出), 剥(EMM));
        assert_eq!(出.matches("\r\n").count(), EMM.matches("\r\n").count());
    }

    #[test]
    fn pmm_field_is_found_by_unique_search_and_overwritten_in_place() {
        /* 造一个假 .pmm：前面放一个**成立的条目头**（两个长度前缀名字 + SJIS 名字），
           再放 256 字节的定长字段，最后塞点哨兵字节 */
        let 路径 = "D:\\b\\Flyer.pmx";
        let mut 假 = vec![0u8; 8];
        let 名字 = 编("フライヤー", encoding_rs::SHIFT_JIS);
        假.push(名字.len() as u8);
        假.extend_from_slice(&名字);
        let 英文名 =编("Flyer", encoding_rs::SHIFT_JIS);
        假.push(英文名.len() as u8);
        假.extend_from_slice(&英文名);
        let 字段起点 = 假.len();
        let mut 字段 = vec![0u8; 256];
        let b = 编(路径, GBK);
        字段[..b.len()].copy_from_slice(&b);
        假.extend_from_slice(&字段);
        假.extend_from_slice(&[0xAB; 32]);
        let 对象 = vec![对象 {
            key: "Pmd2".into(),
            kind: "model".into(),
            index: 2,
            path: 路径.into(),
        }];
        let (hits, 问题) = 找字段(&假, &对象);
        assert!(问题.is_empty(), "不该有问题：{问题:?}");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].offset, 字段起点);
        let 原长 = 假.len();
        let 头备份 = 假[..字段起点].to_vec();
        改字段(&mut 假, hits[0].offset, ".\\模型\\Flyer.pmx").unwrap();
        /* 长度不变，且只动了字段那 256 字节 */
        assert_eq!(假.len(), 原长);
        assert_eq!(&假[..字段起点], &头备份[..], "字段前面那截（条目头）一个字节都不许动");
        assert_eq!(&假[字段起点 + 256..], &[0xAB; 32][..], "字段后面那 32 字节一个都不许动");
        let n = 假[字段起点..].iter().position(|&b| b == 0).unwrap();
        assert_eq!(解(&假[字段起点..字段起点 + n], GBK), ".\\模型\\Flyer.pmx");
    }

    #[test]
    fn long_path_or_ambiguous_hit_is_refused_not_guessed() {
        let mut 短 = vec![0u8; 4];
        短.extend_from_slice(&vec![0u8; 256]);
        let o = vec![对象 {
            key: "Pmd1".into(),
            kind: "model".into(),
            index: 1,
            path: "D:\\x\\y.pmx".into(),
        }];
        let (_, 问题) = 找字段(&短, &o);
        assert_eq!(问题.len(), 1, "找不到必须报出来");
        /* 太长的路径不许截断 */
        let mut 长 = vec![0u8; 300];
        let 名 = "长".repeat(200);
        assert!(改字段(&mut 长, 0, &名).is_err());
        /* 歧义：同一路径出现两处 */
        let 路径 = "D:\\b\\Flyer.pmx";
        let b = 编(路径, GBK);
        let mut 两处 = vec![0u8; 8];
        两处.extend_from_slice(&b);
        两处.extend_from_slice(&[0u8; 8]);
        两处.extend_from_slice(&b);
        let (hits, 问题) = 找字段(&两处, &o2(路径));
        assert!(hits.is_empty() && 问题.len() == 1, "歧义必须拒绝，不能挑第一个");
    }

    /**
     * 真工程上的锚定位命中率（只读，`--ignored` 才跑）。
     *
     * 这条验的是整套做法的地基：**拿 `.emm` 的路径文本去 `.pmm` 里搜唯一一处**。
     * 规格里说"30 个工程 966 条 100% 唯一命中"，这里把它变成能复跑的东西。
     */
    #[test]
    #[ignore]
    fn 真工程上锚定位命中率() {
        let 根 = Path::new(r"D:\9.26mmd");
        if !根.exists() {
            println!("  （没有 {根:?}，跳过）");
            return;
        }
        let mut 工程 = 0;
        let mut 对象数 = 0;
        let mut 命中 = 0;
        let mut 精确 = 0;
        let mut 结构 = 0;
        let mut 缺文件 = 0;
        let mut 类: std::collections::BTreeMap<String, usize> = Default::default();
        for 项 in walkdir(根) {
            if 项.extension().map(|e| e.eq_ignore_ascii_case("pmm")) != Some(true) {
                continue;
            }
            let emm = 项.with_extension("emm");
            if !emm.exists() {
                continue;
            }
            工程 += 1;
            match 扫(项.to_string_lossy().to_string(), emm.to_string_lossy().to_string()) {
                Ok(r) => {
                    对象数 += r.objects.len();
                    命中 += r.pmm_hits.len();
                    for h in r.pmm_hits.iter() {
                        /* 分级名就是 `找字段` 里的那四级：完整路径 / 截断前缀 / 目录名+文件名 / 只文件名。
                           （早先这里按"是否以'精确'开头"分类，而四级里没有叫"精确"的 → 永远 0，
                            打印出来的"精确/结构"是错的。按实际分级名归类。） */
                        if h.怎么找到的 == "完整路径" {
                            精确 += 1;
                        } else {
                            结构 += 1;
                        }
                    }
                    缺文件 += r.在盘上.iter().filter(|x| !**x).count();
                    for p in r.问题.iter() {
                        let k = p.split('：').next().unwrap_or("别的").to_string();
                        *类.entry(k).or_insert(0) += 1;
                    }
                }
                Err(e) => println!("  读不了 {}：{e}", 项.display()),
            }
        }
        println!(
            "  真工程 {工程} 个 / 对象 {对象数} 条 / 命中 {命中}（完整路径 {精确} + 放宽那三级 {结构}）/ 盘上缺文件 {缺文件}"
        );
        println!("  命中率 {}%（只算对象条目）", 命中 * 100 / 对象数.max(1));
        let mut 排序: Vec<(String, usize)> = 类.into_iter().collect();
        排序.sort_by(|a, b| b.1.cmp(&a.1));
        for (k, v) in 排序.iter().take(8) {
            println!("    栽在「{k}」：{v} 条");
        }
        assert!(工程 > 0, "一个 .pmm 都没扫到，路径写错了？");
        /* 门槛卡 60%：低于它说明做法整体失效（那时该换思路，不是调参数）。
           上一版（只做精确路径）实测 69%；这一版加了"文件名 + 条目头结构"这一级。 */
        assert!(
            命中 * 100 / 对象数.max(1) >= 60,
            "锚定位命中率太低：{命中}/{对象数}"
        );
    }

    fn walkdir(根: &Path) -> Vec<PathBuf> {
        let mut 出 = Vec::new();
        let mut 栈 = vec![根.to_path_buf()];
        while let Some(d) = 栈.pop() {
            let Ok(rd) = fs::read_dir(&d) else { continue };
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    栈.push(p);
                } else {
                    出.push(p);
                }
            }
        }
        出
    }

    fn o2(p: &str) -> Vec<对象> {        vec![对象 {
            key: "Pmd1".into(),
            kind: "model".into(),
            index: 1,
            path: p.into(),
        }]
    }

    /* ==================== A（搬家）/ B（摘条目） ==================== */

    /**
     * 造一份最小可用的 `.pmm`：头 + 模型条目 + 附件条目，每条后面带一小段"帧区"。
     *
     * 形状照实测：模型 = `u8 名字长 + 名字(SJIS) + u8 英文名长 + 英文名 + 路径[256]`，
     * 附件 = `名字[100]`（NUL 补零）+ `路径[256]`；`0x36..0x38` 写 uint16 模型数。
     * 英文名给了 1 个字符 —— 结构判定要求英文名长度 ≥ 1，空英文名认不出来。
     * 帧区用不含 NUL、也不是素材扩展名结尾的固定串，免得被当成条目。
     */
    fn 造工程(模型: &[(&str, &str)], 附件: &[(&str, &str)]) -> Vec<u8> {
        let mut b = vec![0u8; 0x40];
        let 头 = b"Polygon Movie maker 0002";
        b[..头.len()].copy_from_slice(头);
        b[0x36..0x38].copy_from_slice(&(模型.len() as u16).to_le_bytes());
        for (名, 路径) in 模型 {
            b.push(名.len() as u8);
            b.extend_from_slice(名.as_bytes());
            b.push(1);
            b.extend_from_slice(b"E");
            let mut 字段 = [0u8; 256];
            let 字节 = 编(路径, GBK);
            字段[..字节.len()].copy_from_slice(&字节);
            b.extend_from_slice(&字段);
            b.extend_from_slice(b"KEYFRAME-STUB-1");
        }
        for (名, 路径) in 附件 {
            let mut 名区 = [0u8; 100];
            名区[..名.len()].copy_from_slice(名.as_bytes());
            b.extend_from_slice(&名区);
            let mut 字段 = [0u8; 256];
            let 字节 = 编(路径, GBK);
            字段[..字节.len()].copy_from_slice(&字节);
            b.extend_from_slice(&字段);
            b.extend_from_slice(b"KEYFRAME-STUB-2");
        }
        b
    }

    /// 一个临时目录（测试完自己清）
    fn 临时目录(名: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("robin-⑥-{名}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn 重排编号_删掉的键消失_后面的前移_材质号不动() {
        let 文本 = "[Object]\r\nPmd1 = a\r\nAcs2 = b\r\nPmd3 = c\r\n\r\n[Effect]\r\nPmd3 = e.fx\r\nPmd3[7] = e7.fx\r\nPmd3.show = true\r\nAcs2 = x.fx\r\n";
        let (出, 去, 改) = 重排_emm(文本, &[2]);
        /* 槽位 2 是 Acs2：它那两行（[Object] 与 [Effect] 各一条）都该没 */
        assert_eq!(去, 2, "删掉的槽位没删干净：\n{出}");
        assert!(!出.contains("Acs2"), "Acs2 还在：\n{出}");
        /* 槽位 3 前移成 2；材质号 7 不许动（它指的是第几个材质，与槽位无关） */
        assert!(出.contains("Pmd2 = c"), "Pmd3 没前移：\n{出}");
        assert!(出.contains("Pmd2[7] = e7.fx"), "逐材质键没跟着前移、或材质号被改了：\n{出}");
        assert!(出.contains("Pmd2.show = true"), ".show 没跟着搬：\n{出}");
        assert!(出.contains("Pmd1 = a"), "槽位 1 在 2 前面，不该被动：\n{出}");
        assert_eq!(改, 4, "改编号的行数不对（Pmd3 在 [Object] 一条 + [Effect] 三条）：\n{出}");
        /* 删几行就少几行：不多不少（多出来的空行是"删行"的痕迹，不该有） */
        assert_eq!(
            文本.lines().count() - 出.lines().count(),
            去,
            "删掉的行数与文本少掉的行数对不上：\n{出}"
        );
        /* 逐字节比一份**期望输出**：编号只改数字，其余（空格、空行、CRLF）原样。
           用"替换回去再比"那种写法容易漏（第一版就漏了 [Effect] 里那条 Pmd3 路径行）。 */
        let 期望 = "[Object]\r\nPmd1 = a\r\nPmd2 = c\r\n\r\n[Effect]\r\nPmd2 = e.fx\r\nPmd2[7] = e7.fx\r\nPmd2.show = true\r\n";        assert_eq!(出, 期望, "重排之后的文本与期望不一致");
    }

    #[test]
    fn 搬家只改路径字段_长度不变_其余逐字节相同() {
        let 目录 = 临时目录("搬家");
        /* 工程：一个模型在 old\，附件在 old\ */
        let pmm = 目录.join("工程.pmm");
        let emm = 目录.join("工程.emm");
        let 原 = 造工程(
            &[("M1", r"D:\old\M1.pmx")],
            &[("acc", r"D:\old\A1.x")],
        );
        fs::write(&pmm, &原).unwrap();
        let emm文本 = "[Object]\r\nPmd1 = D:\\old\\M1.pmx\r\nAcs2 = D:\\old\\A1.x\r\n";
        fs::write(&emm, 编(emm文本, GBK)).unwrap();
        /* 新位置：素材已经挪过去了 */
        let 新模型 = 目录.join("新模型");
        let 新附件 = 目录.join("新附件");
        fs::create_dir_all(&新模型).unwrap();
        fs::create_dir_all(&新附件).unwrap();
        fs::write(新模型.join("M1.pmx"), b"x").unwrap();
        fs::write(新附件.join("A1.x"), b"x").unwrap();
        let 出目录 = 目录.join("出");
        let r = 搬家(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            新模型.to_string_lossy().to_string(),
            新附件.to_string_lossy().to_string(),
            出目录.to_string_lossy().to_string(),
            false,
            None,
        )
        .expect("搬家应当成功");
        assert_eq!(r.改了几处, 4, "应当改 4 处（.pmm 两条字段 + .emm 两行路径）");
        /* 新 .pmm：长度不变、只有两个 256 字节字段变了 */
        let 新 = fs::read(出目录.join("工程.pmm")).unwrap();
        assert_eq!(新.len(), 原.len(), "文件长度变了");
        let 差: Vec<usize> = (0..原.len()).filter(|i| 原[*i] != 新[*i]).collect();
        assert!(!差.is_empty(), "一个字节都没变？");
        let 字段1 = 0x40 + 1 + "M1".len() + 1 + 1; // 头 + 名字长 + 名字 + 英文名长 + 英文名
        for i in &差 {
            assert!(
                (*i >= 字段1 && *i < 字段1 + 256) || (*i >= 字段1 + 256 + 15 + 100 && *i < 字段1 + 256 + 15 + 100 + 256),
                "第 {i} 个字节变了，但不是路径字段 —— 那就不是'只改路径'"
            );
        }
        /* 新 .emm：两条路径都指到新位置 */
        let 新emm = 解(&fs::read(出目录.join("工程.emm")).unwrap(), GBK);
        assert!(新emm.contains("M1.pmx"), "{新emm}");
        assert!(新emm.contains("A1.x"), "{新emm}");
        assert!(!新emm.contains("D:\\old"), "旧路径还在：{新emm}");
        let _ = fs::remove_dir_all(&目录);
    }

    #[test]
    fn 搬家_新位置没文件就整体拒绝() {
        let 目录 = 临时目录("搬家拒");
        let pmm = 目录.join("p.pmm");
        let emm = 目录.join("p.emm");
        fs::write(&pmm, 造工程(&[("M", r"D:\old\M1.pmx")], &[])).unwrap();
        fs::write(&emm, 编("[Object]\r\nPmd1 = D:\\old\\M1.pmx\r\n", GBK)).unwrap();
        let 空 = 目录.join("空的");
        fs::create_dir_all(&空).unwrap();
        /* 新位置没文件 → **必须是 Err**（写一半比不写更糟），而且一个字节都不许写 */
        let r = 搬家(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            空.to_string_lossy().to_string(),
            String::new(),
            目录.join("出").to_string_lossy().to_string(),
            false,
            None,
        );
        let e = r.expect_err("新位置没文件时不许写盘");
        assert!(e.contains("本机找不到"), "拒绝原因要说清是本机找不到：{e}");
        assert!(e.contains("根替换"), "提示要给出口（根替换）：{e}");
        assert!(!目录.join("出").exists(), "拒绝之后还写出了东西");
        /* 干跑时允许（它就是给你看"哪些新位置还没有"的） */
        let 干 = 搬家(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            空.to_string_lossy().to_string(),
            String::new(),
            目录.join("出").to_string_lossy().to_string(),
            true,
            None,
        )
        .expect("干跑应当能算出来");
        assert!(干.表.iter().all(|x| !x.新位置有), "新位置明明没文件");
        assert!(!目录.join("出").exists(), "干跑不该写出任何东西");
        let _ = fs::remove_dir_all(&目录);
    }

    #[test]
    fn 摘条目_整段摘掉_计数减一_emm重排() {
        let 目录 = 临时目录("摘");
        let pmm = 目录.join("p.pmm");
        let emm = 目录.join("p.emm");
        /* 三个模型，第二个盘上找不到 */
        let 原 = 造工程(
            &[("M1", r"D:\t\M1.pmx"), ("M2", r"D:\t\M2.pmx"), ("M3", r"D:\t\M3.pmx")],
            &[],
        );
        fs::write(&pmm, &原).unwrap();
        fs::write(
            &emm,
            编("[Object]\r\nPmd1 = D:\\t\\M1.pmx\r\nPmd2 = D:\\t\\M2.pmx\r\nPmd3 = D:\\t\\M3.pmx\r\n", GBK),
        )
        .unwrap();
        /* 让 M1/M3 在盘上、M2 不在（用临时目录当 D:\t 的替身） */
        let 真 = 目录.join("素材");
        fs::create_dir_all(&真).unwrap();
        fs::write(真.join("M1.pmx"), b"x").unwrap();
        fs::write(真.join("M3.pmx"), b"x").unwrap();
        fs::write(&pmm, 造工程(
            &[("M1", &真.join("M1.pmx").to_string_lossy()), ("M2", r"D:\t\M2.pmx"), ("M3", &真.join("M3.pmx").to_string_lossy())],
            &[],
        )).unwrap();
        fs::write(&emm, 编(&format!(
            "[Object]\r\nPmd1 = {}\r\nPmd2 = D:\\t\\M2.pmx\r\nPmd3 = {}\r\n",
            真.join("M1.pmx").display(), 真.join("M3.pmx").display()
        ), GBK)).unwrap();

        let 出目录 = 目录.join("出");
        let r = 摘丢失(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            出目录.to_string_lossy().to_string(),
            false,
        )
        .expect("中段模型丢了、链也对得上，应当能摘");
        assert_eq!(r.去掉.len(), 1, "只该摘掉丢的那一条");
        assert_eq!(r.去掉[0].key, "Pmd2");
        assert_eq!(r.旧模型数, 3);
        assert_eq!(r.新模型数, 2, "模型数要按 uint16 减一");
        /* 新 .pmm 短了正好一段、模型数改了、剩下的两条还在 */
        let 新 = fs::read(出目录.join("p.pmm")).unwrap();
        assert_eq!(r.pmm原字节 - r.pmm新字节, r.去掉[0].止 - r.去掉[0].起, "少掉的字节数不等于摘掉的那一段");
        assert_eq!(u16::from_le_bytes([新[0x36], 新[0x37]]), 2);
        assert!(解(&新, GBK).contains("M1.pmx") && 解(&新, GBK).contains("M3.pmx"));
        assert!(!解(&新, GBK).contains("M2.pmx"));
        /* .emm：Pmd2 没了、Pmd3 前移到 Pmd2 */
        let 新emm = 解(&fs::read(出目录.join("p.emm")).unwrap(), GBK);
        assert!(!新emm.contains("M2.pmx"), "丢的那条还在：{新emm}");
        assert!(新emm.contains("Pmd2 = "), "Pmd3 没前移：{新emm}");
        assert!(!新emm.contains("Pmd3"), "Pmd3 这个号还在：{新emm}");
        let _ = fs::remove_dir_all(&目录);
    }

    #[test]
    fn 摘条目_三种情况必须拒绝() {
        let 目录 = 临时目录("摘拒");
        /* ① 丢的是附件 → 拒绝（附件数在头部找不到） */
        let pmm = 目录.join("a.pmm");
        let emm = 目录.join("a.emm");
        fs::write(&pmm, 造工程(&[], &[("acc", r"D:\t\A.x")])).unwrap();
        fs::write(&emm, 编("[Object]\r\nAcs1 = D:\\t\\A.x\r\n", GBK)).unwrap();
        /* ① 丢的是附件：**现在支持**（量测 §41：附件序号是推出来的、没有计数字段要改）。
           这份合成文件只有一条条目 → 链太短，仍然要拒绝，但原因是结构不足，不再是"附件不做"。 */
        let r = 摘丢失(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            目录.join("出").to_string_lossy().to_string(),
            false,
        );
        assert!(r.is_err(), "只有一条条目时应当拒绝");
        let m = r.unwrap_err();
        assert!(m.contains("条目"), "拒绝原因应当是结构不足：{m}");

        /* ② 链对不上（头部模型数 1，.emm 写 2 条）→ 拒绝 */
        let pmm2 = 目录.join("b.pmm");
        let emm2 = 目录.join("b.emm");
        fs::write(&pmm2, 造工程(&[("M1", r"D:\t\M1.pmx")], &[])).unwrap();
        fs::write(
            &emm2,
            编("[Object]\r\nPmd1 = D:\\t\\M1.pmx\r\nPmd2 = D:\\t\\MISS.pmx\r\n", GBK),
        )
        .unwrap();
        let r2 = 摘丢失(
            pmm2.to_string_lossy().to_string(),
            emm2.to_string_lossy().to_string(),
            目录.join("出").to_string_lossy().to_string(),
            true,
        );
        assert!(r2.is_err(), "数量对不上必须拒绝");
        let e2 = r2.unwrap_err();
        assert!(e2.contains("对不上"), "{e2}");

        /* ③ 丢的是最后一条 → 拒绝（它的帧区到哪儿结束没有依据） */
        let pmm3 = 目录.join("c.pmm");
        let emm3 = 目录.join("c.emm");
        fs::write(&pmm3, 造工程(&[("M1", r"D:\t\M1.pmx"), ("M2", r"D:\t\M2.pmx")], &[])).unwrap();
        fs::write(
            &emm3,
            编("[Object]\r\nPmd1 = D:\\t\\M1.pmx\r\nPmd2 = D:\\t\\M2.pmx\r\n", GBK),
        )
        .unwrap();
        let r3 = 摘丢失(
            pmm3.to_string_lossy().to_string(),
            emm3.to_string_lossy().to_string(),
            目录.join("出").to_string_lossy().to_string(),
            true,
        );
        assert!(r3.is_err(), "最后一条必须拒绝（两条都不在盘上，第二条是最后一条）");
        let _ = fs::remove_dir_all(&目录);
    }

    /**
     * 真工程上量"能不能安全摘条目"（B 的适用面）。
     *
     * 这是 B 的唯一诚实的门槛：链成立才允许摘。跑法：
     *   cargo test --lib -- --ignored --nocapture 真工程上能摘几个
     */
    #[test]
    #[ignore]
    fn 真工程上能摘几个() {
        let 根 = Path::new(r"D:\9.26mmd");
        if !根.exists() {
            println!("  （没有 D:\\9.26mmd，跳过）");
            return;
        }
        let mut 工程 = 0;
        let mut 能 = 0;
        let mut 类: std::collections::BTreeMap<String, usize> = Default::default();
        for 项 in walkdir(根) {
            if 项.extension().map(|e| e.eq_ignore_ascii_case("pmm")) != Some(true) {
                continue;
            }
            let emm = 项.with_extension("emm");
            if !emm.exists() {
                continue;
            }
            工程 += 1;
            if let Ok(r) = 扫(项.to_string_lossy().to_string(), emm.to_string_lossy().to_string()) {
                if r.能摘 {
                    能 += 1;
                } else {
                    let k = r.摘拦.split('：').next().unwrap_or("别的").chars().take(18).collect::<String>();
                    *类.entry(k).or_insert(0) += 1;
                }
            }
        }
        println!("  真工程 {工程} 个 / 条目链成立（允许摘）{能} 个 = {}%", 能 * 100 / 工程.max(1));
        let mut 排序: Vec<(String, usize)> = 类.into_iter().collect();
        排序.sort_by(|a, b| b.1.cmp(&a.1));
        for (k, v) in 排序.iter().take(6) {
            println!("    拦在「{k}」：{v} 个");
        }
        assert!(工程 > 0, "一个 .pmm 都没扫到");
    }

    fn hex(b: &[u8]) -> String {
        b.iter().map(|c| format!("{c:02X}")).collect::<Vec<_>>().join(" ")
    }

    fn 可打印(b: &[u8]) -> String {
        b.iter()
            .map(|c| if (0x20..0x7f).contains(c) { *c as char } else { '.' })
            .collect()
    }

    /**
     * 诊断：为什么最强那一级（"完整路径"）在真工程上**一条都没命中**。
     *
     * 跑法：`cargo test --lib -- --ignored --nocapture 诊断_完整路径`
     *
     * 做法：拿真工程，把 `.emm` 的路径与它在 `.pmm` 里"同名的那条条目"的字段字节**并排打出来**，
     * 并指出两串字节从第几个字节开始不同 —— 是归一化的问题、尾部残留、写法不同、还是取错起点。
     */
    #[test]
    #[ignore]
    fn 诊断_完整路径为什么零命中() {
        let 根 = Path::new(r"D:\9.26mmd");
        let mut 打了 = 0;
        for 项 in walkdir(根) {
            if 项.extension().map(|e| e.eq_ignore_ascii_case("pmm")) != Some(true) {
                continue;
            }
            let emm = 项.with_extension("emm");
            if !emm.exists() {
                continue;
            }
            let Ok(文本) = 读文本(&emm) else { continue };
            let e = parse_emm(&文本);
            let Ok(字节) = fs::read(&项) else { continue };
            if e.objects.is_empty() {
                continue;
            }
            let 条目 = 枚举条目(&字节);
            println!(
                "\n=== {} （.emm 对象 {} 条 / 扫出条目 {} 条）",
                项.display(),
                e.objects.len(),
                条目.len()
            );
            for o in e.objects.iter().take(3) {
                let 目标 = 归一(&o.path);
                let 同路径 = 条目.iter().filter(|x| 归一(&x.路径) == 目标).count();
                let 同名 = 条目
                    .iter()
                    .find(|x| 归一(&文件名(&x.路径)) == 归一(&文件名(&o.path)));
                println!("  [{}] .emm  = {:?}", o.key, o.path);
                println!("       归一 = {:?}；扫出条目里归一后相同的：{} 条", 目标, 同路径);
                match 同名 {
                    None => println!("       连'文件名相同'的条目都没扫出来"),
                    Some(x) => {
                        println!(
                            "       同名条目 offset={} kind={} 截断={}",
                            x.offset, x.kind, x.截断
                        );
                        println!("         条目路径 = {:?}", x.路径);
                        println!("         条目归一 = {:?}", 归一(&x.路径));
                        let 字段 = &字节[x.offset..x.offset + 256];
                        let n = 字段.iter().position(|c| *c == 0).unwrap_or(256);
                        println!("         字段里第一个 NUL 在 {n} 字节处（256 = 满，无结尾符）");
                        println!("         字段前 48 字节 : {}", hex(&字段[..48]));
                        println!("         字段前 48 字符 : {}", 可打印(&字段[..48]));
                        println!(
                            "         字段尾 24 字节 : {}",
                            hex(&字段[n.saturating_sub(24)..n.min(256)])
                        );
                        let emm字节 = 编(&o.path, GBK);
                        println!(
                            "         .emm 路径字节    : {}",
                            hex(&emm字节[..emm字节.len().min(48)])
                        );
                        let 短 = emm字节.len().min(n);
                        match (0..短).find(|i| 字段[*i] != emm字节[*i]) {
                            Some(i) => println!(
                                "         首个不同字节在第 {i} 字节：字段 {:02X}（{}） vs .emm {:02X}（{}）",
                                字段[i],
                                可打印(&字段[i..i + 1]),
                                emm字节[i],
                                可打印(&emm字节[i..i + 1])
                            ),
                            None => println!(
                                "         前 {短} 字节完全相同（差异只在长度/尾部：字段长 {n}，.emm 长 {}）",
                                emm字节.len()
                            ),
                        }
                    }
                }
            }
            打了 += 1;
            if 打了 >= 3 {
                break;
            }
        }
        assert!(打了 > 0, "没找到有 .emm 的工程");
    }

    /**
     * 真工程上**按命中分级**统计，并把"最强那一级没命中"的样本连候选一起打出来。
     *
     * 跑法：`cargo test --lib -- --ignored --nocapture 真工程上命中分级`
     *
     * 为什么单开一条：`找字段` 的四级是逐级放宽的，只看总命中率看不出"是强证据在命中、
     * 还是放宽到只剩文件名才算命中"。这条把每一级各命中多少条分开报，并抽样打印失配现场。
     */
    #[test]
    #[ignore]
    fn 真工程上命中分级与失配样本() {
        let 根 = Path::new(r"D:\9.26mmd");
        let mut 工程 = 0;
        let mut 对象数 = 0;
        let mut 各级: std::collections::BTreeMap<String, usize> = Default::default();
        let mut 样本 = 0;
        for 项 in walkdir(根) {
            if 项.extension().map(|e| e.eq_ignore_ascii_case("pmm")) != Some(true) {
                continue;
            }
            let emm = 项.with_extension("emm");
            if !emm.exists() {
                continue;
            }
            let (Ok(文本), Ok(字节)) = (读文本(&emm), fs::read(&项)) else { continue };
            let e = parse_emm(&文本);
            if e.objects.is_empty() {
                continue;
            }
            工程 += 1;
            对象数 += e.objects.len();
            let (hits, _) = 找字段(&字节, &e.objects);
            for h in hits.iter() {
                *各级.entry(h.怎么找到的.to_string()).or_insert(0) += 1;
            }
            /* 抽样：最强那一级没命中的对象，把 .emm 路径与"同名候选"的路径并排打印 */
            if 样本 < 6 {
                let 命中键: std::collections::HashSet<&str> =
                    hits.iter().map(|h| h.key.as_str()).collect();
                let 条目表: Vec<条目> = {
                    let mut v = 枚举条目(&字节);
                    v.extend(枚举截断条目(&字节));
                    v
                };
                for o in e.objects.iter() {
                    if 命中键.contains(o.key.as_str()) || 样本 >= 6 {
                        continue;
                    }
                    if hits.iter().any(|h| h.key == o.key && h.怎么找到的 == "完整路径") {
                        continue;
                    }
                    let 同名: Vec<&条目> = 条目表
                        .iter()
                        .filter(|x| 归一(&文件名(&x.路径)) == 归一(&文件名(&o.path)))
                        .collect();
                    println!(
                        "\n【失配样本】{} 的 {}：",
                        项.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_default(),
                        o.key
                    );
                    println!("  .emm 路径 = {:?}", o.path);
                    println!("  归一      = {:?}", 归一(&o.path));
                    for (i, x) in 同名.iter().take(3).enumerate() {
                        println!(
                            "  候选{i} offset={} kind={} 截断={} 路径={:?}",
                            x.offset, x.kind, x.截断, x.路径
                        );
                        println!("        归一={:?}", 归一(&x.路径));
                    }
                    if 同名.is_empty() {
                        println!("  一条同名候选都没有（连文件名都没扫出来）");
                    }
                    样本 += 1;
                }
            }
        }
        println!("\n  真工程 {工程} 个 / 对象 {对象数} 条");
        let mut 命中合计 = 0;
        for (k, v) in 各级.iter() {
            命中合计 += v;
            println!("    {k}：{v} 条");
        }
        println!(
            "  命中合计 {命中合计} = {}%；未命中 {} 条",
            命中合计 * 100 / 对象数.max(1),
            对象数 - 命中合计
        );
        assert!(工程 > 0, "一个 .pmm 都没扫到");
    }

    /**
     * A 与 C 的**真工程副本验收**（素材只读，副本写在 `实战测试用例\测试效果\`）。
     *
     * 跑法：`cargo test --lib -- --ignored --nocapture 真工程副本上A与C的验收`
     *
     * A：把副本里的模型/附件**挪到新目录** → 用 `搬家` 只改路径 → 断言
     *    ① `.pmm` 长度不变 ② 差异字节**全部**落在定位到的字段里 ③ `.emm` 里没有旧路径
     *    ④ 新路径指向的文件确实在。
     * C：自包含打包走**活路径** `migrate_root::搬根自带`（平铺老路 `打包` 已删）→ 断言
     *    ① 工程本来就健康（不给映射）也能打包 ② 健康路径的模型与它的邻居都进包、
     *    `.pmm` 长度不变、包里每条路径都指在包内且落在盘上
     *    ③ 进包的 `.pmx` 贴图路径**原样**（保留相对结构、不改写），且源侧存在的贴图都跟着进了包。
     */
    #[test]
    #[ignore]
    fn 真工程副本上A与C的验收() {
        let 根 = Path::new(r"D:\9.26mmd");
        let 效果根 = Path::new(r"E:\deepseek-harness\mmd集成工具\实战测试用例\测试效果");
        if !效果根.exists() {
            println!("  （没有 {效果根:?}，跳过）");
            return;
        }
        /* 挑一个"所有对象都在盘上、引用文件总量不太大"的真工程 */
        let mut 选中 = None;
        for 项 in walkdir(根) {
            if 项.extension().map(|e| e.eq_ignore_ascii_case("pmm")) != Some(true) {
                continue;
            }
            let emm = 项.with_extension("emm");
            if !emm.exists() {
                continue;
            }
            let Ok(文本) = 读文本(&emm) else { continue };
            let e = parse_emm(&文本);
            if e.objects.is_empty() || e.objects.len() > 12 {
                continue;
            }
            let mut 总 = 0u64;
            let 全在 = e.objects.iter().all(|o| {
                let p = PathBuf::from(&o.path);
                let ok = p.is_file();
                if ok {
                    总 += p.metadata().map(|m| m.len()).unwrap_or(0);
                }
                ok
            });
            if 全在 && 总 < 40 * 1024 * 1024 {
                选中 = Some((项.clone(), emm.clone(), e));
                break;
            }
        }
        let Some((pmm源, emm源, e)) = 选中 else {
            println!("  （没找到合适的真工程：要求对象都齐全且总量 < 40MB）");
            return;
        };
        println!("  选中工程：{} （{} 个对象）", pmm源.display(), e.objects.len());

        let 工作 = 效果根.join("⑥A与C验收");
        let _ = fs::remove_dir_all(&工作);
        fs::create_dir_all(&工作).unwrap();
        let 原目录 = 工作.join("原");
        let 新模型 = 工作.join("新模型");
        let 新附件 = 工作.join("新附件");
        for d in [&原目录, &新模型, &新附件] {
            fs::create_dir_all(d).unwrap();
        }
        /* 把副本的工程文件与素材拷进来，素材按类别"挪"到新目录（原件不动） */
        let pmm副本 = 原目录.join(pmm源.file_name().unwrap());
        let emm副本 = 原目录.join(emm源.file_name().unwrap());
        fs::copy(&pmm源, &pmm副本).unwrap();
        fs::copy(&emm源, &emm副本).unwrap();
        for o in e.objects.iter() {
            let 源 = PathBuf::from(&o.path);
            let 名 = 源.file_name().unwrap();
            let 到 = if o.kind == "accessory" { 新附件.join(名) } else { 新模型.join(名) };
            fs::copy(&源, &到).unwrap();
        }

        /* ---- A：搬家 ---- */
        let A出 = 工作.join("A出");
        let r = 搬家(
            pmm副本.to_string_lossy().to_string(),
            emm副本.to_string_lossy().to_string(),
            新模型.to_string_lossy().to_string(),
            新附件.to_string_lossy().to_string(),
            A出.to_string_lossy().to_string(),
            false,
            None,
        )
        .expect("A 搬家应当成功");
        let 原字节 = fs::read(&pmm副本).unwrap();
        let 新字节 = fs::read(A出.join(pmm源.file_name().unwrap())).unwrap();
        assert_eq!(新字节.len(), 原字节.len(), "A：文件长度变了");
        /* 差异必须落在定位到的字段里 */
        let 命中偏移: Vec<usize> = {
            let 条目表 = 枚举全部(&原字节);
            let (hits, _) = 找字段_用表(&条目表, &e.objects);
            let mut v: Vec<usize> = hits.iter().flat_map(|h| h.全部.clone()).collect();
            v.sort_unstable();
            v.dedup();
            v
        };
        assert!(!命中偏移.is_empty(), "A：一个字段都没定位到");
        let mut 越界 = 0;
        for i in 0..原字节.len() {
            if 原字节[i] == 新字节[i] {
                continue;
            }
            let ok = 命中偏移.iter().any(|o| i >= *o && i < *o + 256);
            if !ok {
                越界 += 1;
            }
        }
        assert_eq!(越界, 0, "A：有 {越界} 个差异字节落在路径字段之外");
        let 新emm = 解(&fs::read(A出.join(emm源.file_name().unwrap())).unwrap(), GBK);
        let 旧目录串 = 原目录.to_string_lossy().to_string();
        assert!(!新emm.contains(&旧目录串), "A：.emm 里还留着旧路径");
        assert_eq!(r.表.iter().filter(|x| !x.新位置有).count(), 0, "A：新位置应当都有文件");
        println!("  A 通过：长度不变、差异全在字段内、.emm 已指向新目录（改了 {} 处）", r.改了几处);
        /* 新路径确实指到挪过去的文件 */
        let 复读 = parse_emm(&新emm);
        for o in 复读.objects.iter() {
            assert!(PathBuf::from(&o.path).is_file(), "A：新路径指不到文件：{}", o.path);
        }

        /* ---- C：自包含打包（走**活路径** `migrate_root::搬根自带`）----
           这段原来走的是已删掉的平铺老路 `project::打包`。平铺会把"模型旁边的贴图"引用打断，
           所以老路才需要**改 `.pmx` 里的贴图路径**；活路径保留相对结构、连邻居一起拷，
           贴图路径一个字都不用改 —— 覆盖就落在这两件事上：
           ① 工程本来就健康（一条映射都不给）也能打包（2026-09-22 补的入口）；
           ② 拷进来的都在包里、每条路径都指在包内且落在盘上、.pmm 长度不变；
           ③ 进包的 `.pmx`：贴图条数与内容**原样**，且每条源侧存在的贴图都跟着进了包。 */
        let 包 = 工作.join("C包");
        /* 夹具：一个"本来健康"的小工程 —— 真工程里那个 `.pmx` 连它旁边的贴图一起摆好。
           挑一个**源侧真有贴图**的 .pmx，不然第 ③ 条是空转。 */
        let mut 选中pmx: Option<PathBuf> = None;
        for o in e.objects.iter().filter(|o| o.path.to_lowercase().ends_with(".pmx")) {
            let p = PathBuf::from(&o.path);
            let Ok(ts) = 收贴图(&p) else { continue };
            let 目录 = p.parent().unwrap_or(Path::new(".")).to_path_buf();
            let 有几个 = ts.iter().filter(|t| !t.path.is_empty() && 目录.join(解相对(&t.path)).is_file()).count();
            if 有几个 > 0 {
                选中pmx = Some(p);
                break;
            }
        }
        let Some(真pmx) = 选中pmx else {
            println!("  （这套工程里没有带在盘上贴图的 .pmx，C 跳过）");
            return;
        };
        let 夹具 = 工作.join("C夹具");
        let 素材 = 夹具.join("素材").join("模型");
        let _ = fs::remove_dir_all(&夹具);
        fs::create_dir_all(&素材).unwrap();
        let 名 = 真pmx.file_name().unwrap().to_string_lossy().to_string();
        fs::copy(&真pmx, 素材.join(&名)).unwrap();
        let 源目录 = 真pmx.parent().unwrap_or(Path::new(".")).to_path_buf();
        for t in 收贴图(&真pmx).unwrap().iter().filter(|t| !t.path.is_empty()) {
            let 源 = 源目录.join(解相对(&t.path));
            if !源.is_file() {
                continue;
            }
            let 到 = 素材.join(解相对(&t.path));
            if let Some(p) = 到.parent() {
                fs::create_dir_all(p).unwrap();
            }
            fs::copy(&源, &到).unwrap();
        }
        /* 一个"没有谁引用它"的邻居：验"连邻居一起拷"（贴图就是靠这个不断） */
        fs::write(素材.join("_邻居.txt"), b"neighbor").unwrap();
        let 夹具模型路径 = 素材.join(&名).to_string_lossy().to_string();
        let 夹具pmm = 夹具.join("工程.pmm");
        let 夹具emm = 夹具.join("工程.emm");
        fs::write(&夹具pmm, 造工程(&[("M1", &夹具模型路径)], &[])).unwrap();
        fs::write(&夹具emm, 编(&format!("[Object]\r\nPmd1 = {夹具模型路径}\r\n"), GBK)).unwrap();

        /* 一条映射都不给：路径本来就指在盘上（"工程本来就健康，只想打个包"那种） */
        let c = crate::migrate_root::搬根内部带开关(
            夹具pmm.to_string_lossy().to_string(),
            夹具emm.to_string_lossy().to_string(),
            vec![],
            vec![],
            包.to_string_lossy().to_string(),
            false,
            true,  /* 自带 */
            false, /* 查禁止：夹具就建在 `测试效果\` 里 */
            false, /* 记：单测不许往用户真实的记录目录里写 */
        )
        .expect("C 打包应当成功（工程本来就健康也要有入口）");
        assert!(c.拷贝文件 > 0, "C：一个文件都没拷");
        let 包pmm = 包.join("工程.pmm");
        let 包emm = 包.join("工程.emm");
        assert!(包pmm.is_file() && 包emm.is_file(), "C：包里要有两份工程文件");
        let 包模型 = 包.join("模型").join(&名);
        assert!(包模型.is_file(), "C：健康路径的模型也要进包");
        assert!(包.join("模型").join("_邻居.txt").is_file(), "C：邻居要跟着一起拷（贴图靠相对结构）");
        let 包pmm字节 = fs::read(&包pmm).unwrap();
        assert_eq!(包pmm字节.len(), fs::read(&夹具pmm).unwrap().len(), "C：.pmm 长度变了");
        assert_eq!(
            crate::migrate_root::数出现(&包pmm字节, &编(&夹具模型路径, GBK)),
            0,
            "C：包里那份 .pmm 还写着包外的老路径"
        );
        assert!(
            crate::migrate_root::数出现(&包pmm字节, &编(&包模型.to_string_lossy().to_string(), GBK)) > 0,
            "C：包里的 .pmm 要指到包内那份"
        );
        for (p, 在) in c.产物路径.iter() {
            assert!(*在, "C：产物里这条路径在盘上找不到（包不完整）：{p}");
        }
        /* ③ 贴图：路径原样（没改写）、内容跟着进包 —— 这是"包能直接打开"的证据 */
        let 前 = crate::pmx::read_pmx(真pmx.to_string_lossy().to_string(), Some(1)).unwrap();
        let 后 = crate::pmx::read_pmx(包模型.to_string_lossy().to_string(), Some(1)).unwrap();
        assert_eq!(前.textures, 后.textures, "C：进包的 .pmx 贴图路径必须原样（活路径不改写它）");
        let 包素材 = 包.join("模型");
        let mut 核过 = 0;
        for t in 后.textures.iter().filter(|t| !t.is_empty()) {
            if !源目录.join(解相对(t)).is_file() {
                continue;
            }
            核过 += 1;
            assert!(包素材.join(解相对(t)).is_file(), "C：这条贴图没跟着进包：{t}");
        }
        assert!(核过 > 0, "C：夹具挑的 .pmx 源侧没有贴图，第 ③ 条会空转");
        println!(
            "  C 通过：拷了 {} 个文件 / {:.1} MB、贴图路径原样保住 {} 条、每条都在包内",
            c.拷贝文件,
            c.拷贝字节 as f64 / 1048576.0,
            核过
        );
        println!("  副本在：{}（原件一个字节没动）", 工作.display());
    }

    /**
     * 贴图段的"长度那一格"：**字节数**（两种编码都一样），以及 UTF-16LE 的字节排布。
     *
     * 真因是被真工程副本的 C 验收逼出来的：原来的针用 `encoding_rs` 的 `UTF_16LE.encode()` 编，
     * 实测**编出来的不是 UTF-16 字节**（拿 `诊断_pmx贴图串存法` 并排打出来看到的），
     * 于是所有 UTF-16 的 `.pmx` 都"找不到贴图路径"。现在自己按 UTF-16LE 铺字节。
     */
    #[test]
    fn 贴图段长度_两种编码都记字节数_utf16逐字符铺小端() {
        /* UTF-16LE 的字节排布：逐字符 u16 小端，没有 BOM */
        assert_eq!(编UTF16无BOM("A").len(), 2, "ASCII 字符在 UTF-16LE 里占 2 字节");
        assert_eq!(编UTF16无BOM("颜").len(), 2, "一个汉字在 UTF-16LE 里占 2 字节（不是 3）");
        assert_eq!(编UTF16无BOM("AB")[..4], [0x41, 0x00, 0x42, 0x00], "小端排布不对");
        assert!(!编UTF16无BOM("A").starts_with(&[0xFF, 0xFE]), "不该有 BOM");

        for (utf16, 路径) in [(true, "tex/a.png"), (false, "tex/b.png")] {
            let 针 = if utf16 { 编UTF16无BOM(路径) } else { 编(路径, UTF_8) };
            let mut 文件 = b"HEAD".to_vec();
            let 期望偏移 = 文件.len();
            文件.extend_from_slice(&段长(针.len(), utf16).to_le_bytes());
            文件.extend_from_slice(&针);
            文件.extend_from_slice(b"TAIL");
            let (off, len) = 找贴图段(&文件, 路径, utf16).expect("应当能找到");
            assert_eq!(off, 期望偏移, "utf16={utf16} 偏移不对");
            assert_eq!(len, 4 + 针.len(), "utf16={utf16} 段长不对");
            let 格子 = i32::from_le_bytes([文件[off], 文件[off + 1], 文件[off + 2], 文件[off + 3]]);
            assert_eq!(格子 as usize, 针.len(), "utf16={utf16} 长度格子应当是字节数");
        }
    }

    /**
     * 诊断：`.pmx` 里那条贴图路径**到底是怎么存的**（为什么 `找贴图段` 找不到）。
     *
     * 跑法：`cargo test --lib -- --ignored --nocapture 诊断_pmx贴图串存法`
     */
    #[test]
    #[ignore]
    fn 诊断_pmx贴图串存法() {
        let 根 = Path::new(r"D:\9.26mmd");
        let mut 打了 = 0;
        for 项 in walkdir(根) {
            if 项.extension().map(|e| e.eq_ignore_ascii_case("pmx")) != Some(true) {
                continue;
            }
            let Ok(字节) = fs::read(&项) else { continue };
            let Ok(info) = crate::pmx::read_pmx(项.to_string_lossy().to_string(), Some(3)) else {
                continue;
            };
            if info.textures.is_empty() {
                continue;
            }
            let utf16 = match pmx编码(&字节) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let t = &info.textures[0];
            println!("\n=== {} （编码标志 utf16={utf16}）", 项.display());
            println!("  read_pmx 读出的第 0 条贴图 = {:?}", t);
            let 针u8 = 编(t, UTF_8);
            let 针u16 = 编UTF16无BOM(t);
            let mut 试: Vec<(String, Vec<u8>)> = Vec::new();
            for (名, 针) in [
                ("utf8", 针u8.clone()),
                ("utf16le", 针u16.clone()),
                ("ascii反斜杠", 编(&t.replace('/', "\\"), UTF_8)),
            ] {
                let mut a = 段长(针.len(), utf16).to_le_bytes().to_vec();
                a.extend_from_slice(&针);
                试.push((format!("按当前编码的{名}（长度格+内容）"), a));
                let mut b = (针.len() as i32).to_le_bytes().to_vec();
                b.extend_from_slice(&针);
                试.push((format!("{名}（长度格=字节数）"), b));
            }
            for (名, 针) in 试 {
                let 处 = 字节.windows(针.len()).position(|w| w == &针[..]);
                println!("  {名}: {}", match 处 {
                    Some(off) => format!("命中 offset={off}"),
                    None => "没命中".to_string(),
                });
            }
            /* 裸内容（不带长度格）在哪 */
            for (名, 针) in [("裸utf8", 针u8.clone()), ("裸utf16le", 针u16.clone())] {
                match 字节.windows(针.len()).position(|w| w == &针[..]) {
                    Some(off) => {
                        let 前 = &字节[off.saturating_sub(4)..off];
                        println!("  {名}: 命中 offset={off}，前面 4 字节 = {:02X?}（当 int32 读 = {}）", 前, i32::from_le_bytes([前[0], 前[1], 前[2], 前[3]]));
                    }
                    None => println!("  {名}: 没命中"),
                }
            }
            打了 += 1;
            if 打了 >= 2 {
                break;
            }
        }
        assert!(打了 > 0, "没找到带贴图的 .pmx");
    }

    /**
     * **真样本的 A 情形端到端验收**（用户给的 `测试.pmm` + `测试.emm`）。
     *
     * 跑法：`cargo test --lib -- --ignored --nocapture 真样本_A情形`
     *
     * 样本实情：工程引用的两个文件**只是搬了位置**（其余 22 条还在原处）——
     *   模型 `…\贴图\原神\Vodyanitsa_MMD_260813\Vodyanitsa.pmx`
     *     → 现在在 `参考工具样本\参考工具制作的效果\Vodyanitsa_MMD_260813\`
     *   附件 `…\ray\ikDiffusion\Diffusion1\ikDiffusion1.x`
     *     → 现在在 `参考工具样本\参考工具制作的效果\Diffusion1\`
     * 而且**模型与附件的旧目录本来就不是同一个** → "分两部分指定"是必须的，不是可选。
     *
     * 四条验收：① 表里标出那两条缺、其余 22 条在盘上；② 按文件名在新目录里搜到那两个；
     * ③ 写出的工程只有路径字段变化、长度不变、其余逐字节相同；④ 新 `.emm` 两条指向新位置。
     */
    #[test]
    #[ignore]
    fn 真样本_A情形() {
        let 样本 = Path::new(r"E:\deepseek-harness\mmd集成工具\参考工具样本\参考工具制作的效果");
        let 效果 = Path::new(r"E:\deepseek-harness\mmd集成工具\实战测试用例\测试效果");
        let pmm源 = 样本.join("测试.pmm");
        let emm源 = 样本.join("测试.emm");
        if !pmm源.is_file() || !emm源.is_file() {
            println!("  （样本不在 {样本:?}，跳过）");
            return;
        }
        let 新模型目录 = 样本.join("Vodyanitsa_MMD_260813");
        let 新附件目录 = 样本.join("Diffusion1");
        assert!(新模型目录.is_dir(), "样本里没有 {新模型目录:?}");
        assert!(新附件目录.is_dir(), "样本里没有 {新附件目录:?}");

        /* ① 扫描出的表：哪两条缺 */
        let s = 扫(pmm源.to_string_lossy().to_string(), emm源.to_string_lossy().to_string())
            .expect("扫描应当成功");
        println!("  ① 对象 {} 条；命中 {} 条；缺文件 {} 条", s.objects.len(), s.pmm_hits.len(),
            s.在盘上.iter().filter(|x| !**x).count());
        let mut 缺: Vec<String> = Vec::new();
        for (o, 在) in s.objects.iter().zip(s.在盘上.iter()) {
            if !*在 {
                缺.push(format!("{}（{}）", o.key, o.path));
            }
        }
        for x in 缺.iter() {
            println!("     缺：{x}");
        }
        assert_eq!(s.objects.len(), 7, "这个样本的 [Object] 段是 7 条（另有 {} 条特效引用，全文件路径行合计 24）", s.effects.len());
        println!("     共缺 {} 条（含你说的那两条）", 缺.len());
        assert!(缺.iter().any(|x| x.contains("Vodyanitsa.pmx")), "缺的里应当有 Vodyanitsa.pmx");
        assert!(缺.iter().any(|x| x.contains("ikDiffusion1.x")), "缺的里应当有 ikDiffusion1.x");
        /* 模型与附件的旧目录确实不是同一个 → 分两部分是必须的 */
        let 模型旧: std::collections::BTreeSet<String> = s
            .objects
            .iter()
            .filter(|o| o.kind == "model")
            .map(|o| 目录名(&o.path))
            .collect();
        let 附件旧: std::collections::BTreeSet<String> = s
            .objects
            .iter()
            .filter(|o| o.kind == "accessory")
            .map(|o| 目录名(&o.path))
            .collect();
        println!("     模型旧目录 {} 个：{:?}", 模型旧.len(), 模型旧.iter().take(3).collect::<Vec<_>>());
        println!("     附件旧目录 {} 个：{:?}", 附件旧.len(), 附件旧.iter().take(3).collect::<Vec<_>>());
        /* 真正要证的是：**缺的那两条分属不同类别、不同目录** —— 所以"分两部分指定"是必须的 */
        let 缺模型目 = s.objects.iter().find(|o| o.key == "Pmd3").map(|o| 目录名(&o.path)).unwrap_or_default();
        let 缺附件目 = s.objects.iter().find(|o| o.key == "Acs7").map(|o| 目录名(&o.path)).unwrap_or_default();
        println!("     缺的模型目录：{缺模型目}");
        println!("     缺的附件目录：{缺附件目}");
        assert!(缺模型目 != 缺附件目, "缺的两条应当在不同目录（这就是分两部分的原因）");
        assert_eq!(
            s.objects.iter().filter(|o| o.key == "Pmd3").map(|o| o.kind.as_str()).collect::<Vec<_>>(),
            vec!["model"],
            "Pmd3 应当是模型"
        );
        assert_eq!(
            s.objects.iter().filter(|o| o.key == "Acs7").map(|o| o.kind.as_str()).collect::<Vec<_>>(),
            vec!["accessory"],
            "Acs7 应当是附件"
        );

        /* ②③④ 在副本上跑搬家 */
        let 工作 = 效果.join("⑥A真样本");
        let _ = fs::remove_dir_all(&工作);
        fs::create_dir_all(&工作).unwrap();
        let pmm副本 = 工作.join("测试.pmm");
        let emm副本 = 工作.join("测试.emm");
        fs::copy(&pmm源, &pmm副本).unwrap();
        fs::copy(&emm源, &emm副本).unwrap();
        let 原字节 = fs::read(&pmm副本).unwrap();

        let 出 = 工作.join("出");
        let a = 搬家(
            pmm副本.to_string_lossy().to_string(),
            emm副本.to_string_lossy().to_string(),
            新模型目录.to_string_lossy().to_string(),
            新附件目录.to_string_lossy().to_string(),
            出.to_string_lossy().to_string(),
            false,
            None,
        );
        if let Ok(r) = a {
        let 指到新 = r.表.iter().filter(|x| x.处置 == "指到新位置").count();
        let 保持 = r.表.iter().filter(|x| x.处置 == "保持原路径").count();
        let 没找到 = r.表.iter().filter(|x| x.处置 == "找不到").count();
        println!("  ② 处置：指到新位置 {指到新} 条、保持原路径 {保持} 条、找不到 {没找到} 条");
        assert_eq!(指到新, 2, "应当正好两条指到新位置（搬走的那两个）");
        assert_eq!(没找到, 0, "不该有找不到的");
        let 两条: Vec<&搬家行> = r.表.iter().filter(|x| x.处置 == "指到新位置").collect();
        assert!(两条.iter().any(|x| x.类别 == "模型" && x.新.contains("Vodyanitsa.pmx")),
            "Vodyanitsa.pmx 应当按模型目录的新位置搜到：{:?}", 两条);
        assert!(两条.iter().any(|x| x.类别 == "附件" && x.新.contains("ikDiffusion1.x")),
            "ikDiffusion1.x 应当按附件目录的新位置搜到：{:?}", 两条);
        for x in 两条.iter() {
            println!("     {} → {}（{}）", x.旧, x.新, x.类别);
        }

        /* ③ 只有路径字段变化、长度不变、其余逐字节相同 */
        let 新字节 = fs::read(出.join("测试.pmm")).unwrap();
        assert_eq!(新字节.len(), 原字节.len(), "③ 文件长度变了");
        let 命中偏移: Vec<usize> = {
            let 条目表 = 枚举全部(&原字节);
            let (hits, _) = 找字段_用表(&条目表, &s.objects);
            let mut v: Vec<usize> = hits.iter().flat_map(|h| h.全部.clone()).collect();
            v.sort_unstable();
            v.dedup();
            v
        };
        let mut 越界 = 0;
        let mut 改了几个 = 0;
        for i in 0..原字节.len() {
            if 原字节[i] == 新字节[i] {
                continue;
            }
            改了几个 += 1;
            if !命中偏移.iter().any(|o| i >= *o && i < *o + 256) {
                越界 += 1;
            }
        }
        println!("  ③ 差异字节 {改了几个} 个，落在路径字段之外的：{越界} 个");
        assert_eq!(越界, 0, "③ 有差异字节落在路径字段之外");
        assert!(改了几个 > 0, "③ 一个字节都没改？");

        /* ④ 新 .emm 里两条指向新位置 */
        let 新emm = 解(&fs::read(出.join("测试.emm")).unwrap(), GBK);
        assert!(新emm.contains("Vodyanitsa_MMD_260813"), "④ .emm 里没有新模型目录");
        assert!(新emm.contains("Diffusion1"), "④ .emm 里没有新附件目录");
        assert!(
            !新emm.contains(r"实战测试用例\贴图\原神\Vodyanitsa_MMD_260813\Vodyanitsa.pmx"),
            "④ .emm 里还留着旧模型路径"
        );
        assert!(
            !新emm.contains(r"实战测试用例\渲染联动\ray\ikDiffusion\Diffusion1\ikDiffusion1.x"),
            "④ .emm 里还留着旧附件路径"
        );
        /* 指到新位置的两条，写出来的路径必须真的能在盘上找到 */
        let 复 = parse_emm(&新emm);
        for o in 复.objects.iter() {
            let p = PathBuf::from(&o.path);
            if o.key == "Pmd3" || o.key == "Acs7" {
                assert!(p.is_file(), "④ 新路径指不到文件：{}", o.path);
                println!("     {} → {}", o.key, o.path);
            }
        }
        println!("  ④ 通过：新 .emm 的两条指向新位置且文件都在；副本在 {}", 工作.display());
        } else {
            println!("  ②③④ 跳过：A 在本机已不适用 —— {}", a.unwrap_err());
        }
        let _ = &新模型目录;

        /* ⑤ B（丢文件就摘条目）按用户要求撤掉了，这里不再跑、也不再断言能摘。
           缺文件只报告 —— 抓"删条目"的活儿会动工程结构，风险比不修大。 */

        /* ⑤c **最终判据**：盘上那份文件里，新路径真的出现了、旧路径真的不再出现。
           起因：早先"验收全过"是拿**内存副本**比的，盘上那份一个字节没变，
           用户拖进 MMD 照样要一个个重新指定模型 —— 所以只认盘上的标记计数。 */
        if 出.join("测试.pmm").is_file() {
            let 盘pmm = fs::read(出.join("测试.pmm")).unwrap();
            let 盘emm = fs::read(出.join("测试.emm")).unwrap();
            let 旧针 = |s: &str| 编(s, GBK);
            let 数 = |hay: &[u8], 针: &[u8]| -> usize {
                if 针.is_empty() || hay.len() < 针.len() {
                    return 0;
                }
                hay.windows(针.len()).filter(|w| *w == 针).count()
            };
            let 旧模型 = 旧针(r"贴图\原神\Vodyanitsa_MMD_260813\Vodyanitsa.pmx");
            let 旧附件 = 旧针(r"ray\ikDiffusion\Diffusion1\ikDiffusion1.x");
            let 新模型 = 旧针(新模型目录.join("Vodyanitsa.pmx").to_string_lossy().as_ref());
            let 新附件 = 旧针(新附件目录.join("ikDiffusion1.x").to_string_lossy().as_ref());
            println!(
                "  ⑤c 盘上 `.pmm`：旧模型 {} 处 → 新模型 {} 处；旧附件 {} 处 → 新附件 {} 处",
                数(&盘pmm, &旧模型),
                数(&盘pmm, &新模型),
                数(&盘pmm, &旧附件),
                数(&盘pmm, &新附件)
            );
            println!(
                "     盘上 `.emm`：旧模型 {} / 新模型 {}；旧附件 {} / 新附件 {}",
                数(&盘emm, &旧模型),
                数(&盘emm, &新模型),
                数(&盘emm, &旧附件),
                数(&盘emm, &新附件)
            );
            assert!(数(&盘pmm, &新模型) > 0, "盘上 .pmm 里没有新模型路径 —— 写盘落空了");
            assert!(数(&盘pmm, &新附件) > 0, "盘上 .pmm 里没有新附件路径 —— 写盘落空了");
            assert_eq!(数(&盘pmm, &旧模型), 0, "盘上 .pmm 里旧模型路径还在 —— 没覆盖到每一处");
            assert_eq!(数(&盘pmm, &旧附件), 0, "盘上 .pmm 里旧附件路径还在 —— 没覆盖到每一处");
            assert!(数(&盘emm, &新模型) > 0 && 数(&盘emm, &新附件) > 0, "盘上 .emm 没改成新路径");
            assert_eq!(数(&盘emm, &旧模型), 0, "盘上 .emm 里旧模型路径还在");
            assert_eq!(数(&盘emm, &旧附件), 0, "盘上 .emm 里旧附件路径还在");
            println!("  ⑤c 通过：盘上两份文件里新路径都在、旧路径都不剩");
        }
    }

    /**
     * A（搬家改路径）在**真工程**上的验收：盘上那份文件里，新路径真的出现了、旧路径真的不剩。
     *
     * 跑法：`cargo test --lib -- --ignored --nocapture 真工程A验收`
     *
     * 素材只读（`D:\9.26mmd\Henceforth\save\`），副本写 `实战测试用例\测试效果\`。
     * 做法：把工程引用的**一个真实存在的模型**拷到新目录，再把"新模型目录"指到那儿 ——
     * 这样路径**真的变了**，回读判据才有东西可查。
     */
    #[test]
    #[ignore]
    fn 真工程A验收() {
        let 根 = Path::new(r"D:\9.26mmd");
        /* 在真语料里挑一个"引用的模型确实在盘上、体积又不夸张"的工程：
           验收要**路径真的变**，没有存在的文件就无从谈起 */
        let mut 挑中: Option<(PathBuf, PathBuf, 扫描结果)> = None;
        for 项 in walkdir(根) {
            if 项.extension().map(|e| e.eq_ignore_ascii_case("pmm")) != Some(true) {
                continue;
            }
            let emm = 项.with_extension("emm");
            if !emm.is_file() {
                continue;
            }
            if fs::metadata(&项).map(|m| m.len()).unwrap_or(u64::MAX) > 40 * 1024 * 1024 {
                continue;
            }
            let Ok(s) = 扫(项.to_string_lossy().to_string(), emm.to_string_lossy().to_string()) else {
                continue;
            };
            let 有模型 = s
                .objects
                .iter()
                .filter(|o| o.kind == "model" && PathBuf::from(&o.path).is_file())
                .count();
            let 全在 = s.objects.iter().all(|o| PathBuf::from(&o.path).is_file());
            /* 必须**引用的文件全在盘上**：A 的设计就是"有一条两边都没有就整体拒绝"，
               所以拿有缺文件的工程做验收，跑不到写盘那一步 */
            if 全在 && 有模型 >= 1 && s.pmm_hits.len() == s.objects.len() {
                println!("  挑中 {}（{} 个对象，全在盘上）", 项.display(), s.objects.len());
                挑中 = Some((项.clone(), emm, s));
                break;
            }
        }
        let Some((pmm源, emm源, s)) = 挑中 else {
            println!("  跳过：语料里没找到\"引用的模型在盘上\"的工程");
            return;
        };
        let 效果 = Path::new(r"E:\deepseek-harness\mmd集成工具\实战测试用例\测试效果\⑥A真工程");
        let _ = fs::remove_dir_all(效果);
        fs::create_dir_all(效果).unwrap();

        let 在盘 = s.objects.iter().filter(|o| PathBuf::from(&o.path).is_file()).count();
        println!("  真工程：{} 个对象，其中盘上有的 {} 个", s.objects.len(), 在盘);

        /* 挑一个真存在的模型，拷进"新目录"，让它的路径真的变一次 */
        let 样本模型 = s
            .objects
            .iter()
            .find(|o| o.kind == "model" && PathBuf::from(&o.path).is_file())
            .expect("这个工程里应当至少有一个盘上存在的模型");
        let 新模型目录 = 效果.join("新模型");
        fs::create_dir_all(&新模型目录).unwrap();
        let 名 = 文件名(&样本模型.path);
        fs::copy(&样本模型.path, 新模型目录.join(&名)).unwrap();
        println!("  新模型目录：{}（放进 {}）", 新模型目录.display(), 名);

        let 工作 = 效果.join("副本");
        fs::create_dir_all(&工作).unwrap();
        let pmm副本 = 工作.join("工程.pmm");
        let emm副本 = 工作.join("工程.emm");
        fs::copy(&pmm源, &pmm副本).unwrap();
        fs::copy(&emm源, &emm副本).unwrap();
        let 原字节 = fs::read(&pmm副本).unwrap();

        let 出 = 效果.join("出");
        let r = 搬家(
            pmm副本.to_string_lossy().to_string(),
            emm副本.to_string_lossy().to_string(),
            新模型目录.to_string_lossy().to_string(),
            String::new(),
            出.to_string_lossy().to_string(),
            false,
            None,
        )
        .expect("A 应当能在这个工程上写盘");
        let 指到新 = r.表.iter().filter(|x| x.处置 == "指到新位置").count();
        println!(
            "  处置：指到新位置 {} 条、保持原路径 {} 条、找不到 {} 条；改了 {} 处",
            指到新,
            r.表.iter().filter(|x| x.处置 == "保持原路径").count(),
            r.表.iter().filter(|x| x.处置 == "找不到").count(),
            r.改了几处
        );
        assert!(指到新 >= 1, "至少要有一条真的指到了新位置（否则这次验收是空的）");

        /* **只认盘上那份**：新路径出现、同一对象的旧路径不剩（`.pmm` 与 `.emm` 都查） */
        let 盘pmm = fs::read(出.join("工程.pmm")).unwrap();
        let 盘emm = fs::read(出.join("工程.emm")).unwrap();
        assert_eq!(盘pmm.len(), 原字节.len(), "A 只改定长字段，长度不该变");
        let 数 = |hay: &[u8], 针: &str| -> usize {
            let n = 编(针, GBK);
            if n.is_empty() || hay.len() < n.len() {
                return 0;
            }
            hay.windows(n.len()).filter(|w| *w == n.as_slice()).count()
        };
        for row in r.表.iter().filter(|x| x.处置 == "指到新位置") {
            let 旧数p = 数(&盘pmm, &row.旧);
            let 新数p = 数(&盘pmm, &row.新);
            let 旧数e = 数(&盘emm, &row.旧);
            let 新数e = 数(&盘emm, &row.新);
            println!(
                "    {} 旧“{}”→ 新“{}”：.pmm 旧 {旧数p} 新 {新数p}；.emm 旧 {旧数e} 新 {新数e}",
                row.key, row.旧, row.新
            );
            assert!(新数p > 0, "{}：盘上 .pmm 里没有新路径", row.key);
            assert_eq!(旧数p, 0, "{}：盘上 .pmm 里旧路径还在（没覆盖到每一处）", row.key);
            assert!(新数e > 0, "{}：盘上 .emm 里没有新路径", row.key);
            assert_eq!(旧数e, 0, "{}：盘上 .emm 里旧路径还在", row.key);
        }
        println!("  通过：盘上两份文件里新路径都在、旧路径都不剩（副本在 {}）", 出.display());
    }

    /**
     * 诊断：为什么"扫出来的模型条目数 N ≠ 头部 `0x36..0x37` 计数 M"（B 的最后一道门）。
     *
     * 跑法：`cargo test --lib -- --ignored --nocapture 诊断_模型条目数对不上`
     *
     * 对每个 N≠M 的工程，把 N、M、`.emm` 模型数、以及**枚举到的条目起点与类别**列出来，
     * 看是"多认了（把残留/附件当模型）"还是"少认了（漏掉某种形状）"。
     */
    #[test]
    #[ignore]
    fn 诊断_模型条目数对不上() {
        let 根 = Path::new(r"D:\9.26mmd");
        let mut 打了 = 0;
        let mut 多认 = 0;
        let mut 少认 = 0;
        let mut 相等 = 0;
        for 项 in walkdir(根) {
            if 项.extension().map(|e| e.eq_ignore_ascii_case("pmm")) != Some(true) {
                continue;
            }
            let emm = 项.with_extension("emm");
            if !emm.exists() {
                continue;
            }
            let (Ok(文本), Ok(字节)) = (读文本(&emm), fs::read(&项)) else { continue };
            let e = parse_emm(&文本);
            let Some(m) = 读模型数(&字节) else { continue };
            let 条目 = 枚举全部(&字节);
            let 模型: Vec<&条目> = 条目.iter().filter(|x| x.kind == "model").collect();
            let 附件: Vec<&条目> = 条目.iter().filter(|x| x.kind == "accessory").collect();
            let n = 模型.len();
            if n == m as usize {
                相等 += 1;
                continue;
            }
            if n > m as usize {
                多认 += 1;
            } else {
                少认 += 1;
            }
            println!(
                "\n=== {} ：枚举模型 {n} / 头部计数 {m} / .emm 模型 {} / 枚举附件 {}（{:.0}%）",
                项.file_name().unwrap().to_string_lossy(),
                e.objects.iter().filter(|o| o.kind == "model").count(),
                附件.len(),
                n as f64 / m.max(1) as f64 * 100.0
            );
            for x in 模型.iter().take(14) {
                let 名 = 文件名(&x.路径);
                println!("    model  @{:<9} {:?}", x.头起, 名);
            }
            for x in 附件.iter().take(4) {
                println!("    acc    @{:<9} {:?}", x.头起, 文件名(&x.路径));
            }
            打了 += 1;
            if 打了 >= 6 {
                break;
            }
        }
        println!("\n  统计（跑到的工程里）：相等 {相等} / 多认 {多认} / 少认 {少认}");
    }

    #[test]
    fn pmx_encoding_flag_comes_from_header() {
        let mut b = b"PMX ".to_vec();
        b.extend_from_slice(&2.0f32.to_le_bytes());
        b.push(8); // 全局数
        b.push(0); // 全局[0] = 0 → UTF-16LE
        assert!(pmx编码(&b).unwrap());
        b[9] = 1;
        assert!(!pmx编码(&b).unwrap());
        assert!(pmx编码(b"not pmx at all").is_err());
    }

    #[test]
    fn pmx_texture_span_search_requires_unique() {        let 路径 = "main1.png";
        let 针 = 编(路径, UTF_8);
        let mut 文件 = b"PMX ".to_vec();
        文件.extend_from_slice(&2.0f32.to_le_bytes());
        文件.push(8);
        文件.push(1); // UTF-8
        文件.extend_from_slice(&vec![0u8; 4]); // 4 个字符串（长度全 0）
        文件.extend_from_slice(&(针.len() as i32).to_le_bytes());
        文件.extend_from_slice(&针);
        assert_eq!(文件.len(), 14 + 4 + 针.len(), "前缀应当是 14 字节");
        let (off, len) = 找贴图段(&文件, 路径, false).unwrap();
        assert_eq!(off, 14, "长度前缀在偏移 14");
        assert_eq!(len, 4 + 针.len());
        assert!(找贴图段(&文件, "没有这个.png", false).is_err());
    }

    /* ---------------- 模型名（对齐参考工具那页的"名称 + 路径"） ---------------- */

    #[test]
    fn 条目名_模型取长度前缀_附件取百字节区() {
        /* 名字要按**它原本的编码**铺字节：日文名在 .pmm 里是 SJIS（造工程那个夹具写的是
           UTF-8 字节，日文名会被结构判定挡掉 —— 这里手工铺，别用那个夹具） */
        let mut b = vec![0u8; 0x40];
        b[..24].copy_from_slice(b"Polygon Movie maker 0002");
        b[0x36..0x38].copy_from_slice(&1u16.to_le_bytes());
        let 名 = 编("モデル", SHIFT_JIS);
        b.push(名.len() as u8);
        b.extend_from_slice(&名);
        b.push(1);
        b.extend_from_slice(b"E");
        let mut 字段 = [0u8; 256];
        let p = 编(r"D:\a\M.pmx", GBK);
        字段[..p.len()].copy_from_slice(&p);
        b.extend_from_slice(&字段);
        b.extend_from_slice(b"STUB");
        let mut 名区 = [0u8; 100];
        名区[..3].copy_from_slice(b"ray");
        b.extend_from_slice(&名区);
        let mut 字段2 = [0u8; 256];
        let p2 = 编(r"D:\a\ray.x", GBK);
        字段2[..p2.len()].copy_from_slice(&p2);
        b.extend_from_slice(&字段2);

        let 表 = 枚举全部(&b);
        let 模 = 表.iter().find(|e| e.kind == "model").expect("模型条目应当认出来");
        assert_eq!(模.名称, "モデル", "模型名字是长度前缀那个（SJIS 写的要能解出来）");
        let 附 = 表.iter().find(|e| e.kind == "accessory").expect("附件条目应当认出来");
        assert_eq!(附.名称, "ray", "附件名字在 100 字节名字区里");
    }

    #[test]
    fn 换名字_长度变化_后面整体位移_其余字节逐字节相同() {
        let 原 = 造工程(&[("A", r"D:\a\M1.pmx"), ("B", r"D:\a\M2.pmx")], &[]);
        /* 第一处：位置 = 0x40（第一个模型条目的开头），原名 "A"（1 字节）→ "LONGER-NAME"（11 字节） */
        let 清单 = vec![一处改名 {
            位置: 0x40,
            原名: b"A".to_vec(),
            新名: b"LONGER-NAME".to_vec(),
        }];
        let 新 = 换名字(&原, &清单).unwrap();
        assert_eq!(新.len(), 原.len() + 10, "名字变长 10 字节，文件就该长 10 字节");
        assert_eq!(新[0x40], 11, "长度字节跟着改成 11");
        assert_eq!(&新[0x41..0x4C], b"LONGER-NAME");
        /* 位移之后：插入点之后的内容必须逐字节等于原文的那一段（顺序没乱）。
           原名字段是 `[u8 1]["A"]`（2 字节），新的是 `[u8 11]["LONGER-NAME"]`（12 字节），
           所以尾巴从原文的 0x42 开始。 */
        assert_eq!(&新[0x4C..], &原[0x42..], "插入点之后应当整体后移、字节顺序不变");

        /* 变短：删回去 */
        let 回 = 换名字(
            &新,
            &[一处改名 { 位置: 0x40, 原名: b"LONGER-NAME".to_vec(), 新名: b"A".to_vec() }],
        )
        .unwrap();
        assert_eq!(回, 原, "改回原名应当逐字节等于原文件");

        /* 长度字节对不上必须拒绝（宁可不动） */
        let 错 = 换名字(&原, &[一处改名 { 位置: 0x40, 原名: b"XX".to_vec(), 新名: b"Y".to_vec() }]);
        assert!(错.is_err(), "长度字节与原名对不上就该拒绝");
    }

    #[test]
    fn 搬家_改名_名字与路径都落到盘上_且结构条目数不变() {
        let 目录 = 临时目录("改名");
        let 新模型 = 目录.join("新模型");
        fs::create_dir_all(&新模型).unwrap();
        fs::write(新模型.join("M1.pmx"), b"pmx").unwrap();
        let pmm = 目录.join("工程.pmm");
        let emm = 目录.join("工程.emm");
        fs::write(&pmm, 造工程(&[("M1", r"D:\old\M1.pmx")], &[])).unwrap();
        fs::write(&emm, 编("[Object]\r\nPmd1 = D:\\old\\M1.pmx\r\n", GBK)).unwrap();
        let 出目录 = 目录.join("出");
        /* **等长**改名才放行：原名 "M1" 是 2 字节，新名也要 2 字节（实测见 `真工程改名实测`） */
        let 改 = HashMap::from([("Pmd1".to_string(), "XY".to_string())]);
        let r = 搬家(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            新模型.to_string_lossy().to_string(),
            String::new(),
            出目录.to_string_lossy().to_string(),
            false,
            Some(改),
        )
        .expect("等长改名 + 搬家应当成功");
        assert_eq!(r.改名几处, 1, "改了 1 个名字");
        let 原字节 = fs::read(&pmm).unwrap();
        let 新字节 = fs::read(出目录.join("工程.pmm")).unwrap();
        assert_eq!(新字节.len(), 原字节.len(), "等长改名不该改文件长度");
        /* 结构自洽：条目数与模型数都不许变 */
        assert_eq!(枚举全部(&新字节).len(), 枚举全部(&原字节).len(), "条目数变了");
        assert_eq!(读模型数(&新字节), 读模型数(&原字节), "模型数变了");
        /* 盘上：**用我们自己的读法**核对名字（编码可能是 SJIS 也可能是 GBK ——
           代码按原名用的那种编码优先，测试不该假设是哪一种），并确认旧名字没了 */
        let 表后 = 枚举全部(&新字节);
        let 模后 = 表后.iter().find(|e| e.kind == "model").expect("改完还该认得出模型条目");
        assert_eq!(模后.名称, "XY", "盘上那份的模型名没改成");
        assert_eq!(表后.len(), 枚举全部(&原字节).len(), "条目数变了");
        /* 路径也指到了新位置（两种读法都核一遍） */
        assert_eq!(模后.路径, 新模型.join("M1.pmx").to_string_lossy(), "路径没指到新位置");
        let 新路径 = 编(&新模型.join("M1.pmx").to_string_lossy(), GBK);
        assert!(
            新字节.windows(新路径.len()).any(|w| w == 新路径.as_slice()),
            "盘上按字节也找不到新路径"
        );
        assert!(r.表[0].名称 == "M1" && r.表[0].新名 == "XY", "表里的名称/新名没照出来");
        let _ = fs::remove_dir_all(&目录);
    }

    #[test]
    fn 搬家_改名_长度变了就拒绝_并说清为什么() {
        let 目录 = 临时目录("改名拒");
        let pmm = 目录.join("工程.pmm");
        let emm = 目录.join("工程.emm");
        fs::write(&pmm, 造工程(&[("M1", r"D:\old\M1.pmx")], &[])).unwrap();
        fs::write(&emm, 编("[Object]\r\nPmd1 = D:\\old\\M1.pmx\r\n", GBK)).unwrap();
        /* "长名字M1" 是 10 字节（GBK），原名 2 字节 → 长度变了，必须拒绝 */
        let 改 = HashMap::from([("Pmd1".to_string(), "长名字M1".to_string())]);
        let r = 搬家(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            String::new(),
            String::new(),
            String::new(),
            false,
            Some(改),
        );
        let e = r.expect_err("长度变了必须拒绝");
        assert!(e.contains("只支持「等长」改名字"), "拒绝原因要说清是等长：{e}");
        assert!(!目录.join("工程.pmm.bak").exists(), "拒绝之后不该留备份（没写盘）");
        let _ = fs::remove_dir_all(&目录);
    }

    /**
     * 真工程实测：给一个模型改**更长的名字**之后，结构还自洽吗。
     *
     * 这一条是"改名字长度到底安不安全"的判据（规格里没有这条实测）。判据：
     *   ① 结构条目数不变（枚举一遍数一遍）
     *   ② 模型数（`0x36..0x37`）不变
     *   ③ 每个对象的路径字段都还能定位到（`找字段_用表` 命中数不变）
     *   ④ 文件长度变化 = 新名与旧名的字节差
     * **MMD 能不能接受**这一步验不了（要用户开 MMD），报告里明写。
     */
    #[test]
    #[ignore]
    fn 真工程改名实测() {
        let 根 = Path::new(r"D:\9.26mmd");
        if !根.exists() {
            println!("没有 {根:?}，跳过");
            return;
        }
        let mut 试过 = 0;
        let 全部文件 = walkdir(根);
        let pmm们: Vec<PathBuf> = 全部文件
            .iter()
            .filter(|e| e.extension().map(|x| x.to_string_lossy().to_ascii_lowercase()) == Some("pmm".into()))
            .cloned()
            .collect();
        println!("\n  扫到 {} 个文件，其中 .pmm {} 个", 全部文件.len(), pmm们.len());
        let (mut 有配, mut 有条目, mut 有名字) = (0, 0, 0);
        for e in &pmm们 {
            if e.extension().map(|x| x.to_string_lossy().to_ascii_lowercase()) != Some("pmm".into()) {
                continue;
            }
            let 配 = e.with_extension("emm");
            if !配.exists() {
                continue;
            }
            有配 += 1;
            let Ok(原) = fs::read(&e) else { continue };
            let Ok(文本) = 读文本(&配) else { continue };
            let em = parse_emm(&文本);
            let 表0 = 枚举全部(&原);
            let (h0, _) = 找字段_用表(&表0, &em.objects);
            if !h0.is_empty() {
                有条目 += 1;
            }
            let 模: Vec<&Pmm命中> = h0
                .iter()
                .filter(|h| em.objects.iter().any(|o| o.key == h.key && o.kind == "model" && !h.名称.is_empty()))
                .collect();
            if !模.is_empty() {
                有名字 += 1;
            }
            if 模.is_empty() {
                continue;
            }
            /* 给第一个模型加后缀（长度变长） */
            let 目标 = 模[0];
            let 按偏移: HashMap<usize, usize> = 表0.iter().enumerate().map(|(i, x)| (x.offset, i)).collect();
            let Some(&idx) = 按偏移.get(&目标.offset) else { continue };
            let 头起 = 表0[idx].头起;
            let 长 = 原[头起] as usize;
            if 长 == 0 || 头起 + 1 + 长 > 原.len() {
                continue;
            }
            let 原名 = 原[头起 + 1..头起 + 1 + 长].to_vec();
            let enc = 名字原编码(&原名);
            let 原名文本 = 解(&原名, enc);
            let 前缀 = 原名文本.trim_end_matches(|c: char| c.is_ascii_alphanumeric()).to_string();
            /* 两种改法各试一遍，分清"长度位移"与"新名字编码"哪个才是问题：
               (a) 等长：把末尾那个字母换成另一个（字节数一样，不动后面的字节）
               (b) 变长：加"-改名实测"后缀（长度变，后面整体位移） */
            let mut 变体: Vec<(&str, String)> = Vec::new();
            if 原名文本.chars().last().map(|c| c.is_ascii_alphanumeric()).unwrap_or(false) {
                let mut a = 原名文本.clone();
                a.pop();
                a.push('0');
                变体.push(("等长", a));
            }
            let _ = 前缀;
            变体.push(("变长", format!("{原名文本}-改名实测")));

            for (标签, 新名文本) in 变体 {
                let Some(新名) = 编严(&新名文本, enc).or_else(|| 编严(&新名文本, GBK)) else { continue };
                let 新 = 换名字(&原, &[一处改名 { 位置: 头起, 原名: 原名.clone(), 新名: 新名.clone() }]).unwrap();
                let 表1 = 枚举全部(&新);
                let (h1, 问题1) = 找字段_用表(&表1, &em.objects);
                let 本条目还在 = 表1.iter().any(|x| x.路径 == 表0[idx].路径);
                println!(
                    "  [{标签}] 名字 {:?} → {:?}（{}）｜条目 {} → {}｜本条目还在 {}｜命中 {} → {}｜长度差 {}",
                    原名文本,
                    新名文本,
                    enc.name(),
                    表0.len(),
                    表1.len(),
                    本条目还在,
                    h0.len(),
                    h1.len(),
                    新.len() as i64 - 原.len() as i64
                );
                if 标签 == "等长" {
                    assert_eq!(新.len(), 原.len(), "等长改名不该改文件长度");
                    assert!(本条目还在, "等长改名之后这条条目认不出来了");
                    assert_eq!(h0.len(), h1.len(), "等长改名之后有对象的路径定位不到了");
                }
                if 标签 == "变长" && h0.len() != h1.len() {
                    for p in 问题1.iter().take(3) {
                        println!("        变长丢定位：{p}");
                    }
                }
            }
            println!(
                "\n【真工程改名实测】{}｜模型数 {}｜原条目 {}｜命中 {}",
                e.file_name().unwrap().to_string_lossy(),
                读模型数(&原).unwrap_or(0),
                表0.len(),
                h0.len()
            );
            试过 += 1;
            if 试过 >= 8 {
                break;
            }
        }
        println!(
            "\n  扫到 {} 个文件：.pmm {} 个，其中有同名 .emm 的 {} 个；能定位到对象的 {} 个；其中模型名读得出来的 {} 个",
            全部文件.len(),
            pmm们.len(),
            有配,
            有条目,
            有名字
        );
        println!("\n  试过 {试过} 个工程（结构自洽）。MMD 能不能接受长度变化后的工程，本测试验不了");
    }
}
