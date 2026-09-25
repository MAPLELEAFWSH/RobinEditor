//! ⑥ 的「根替换」：把工程里**已经死掉的绝对路径根**换成新的根，**保留相对结构**。
//!
//! 为什么单开一条路（实测出来的，不是设计洁癖）：
//! 真实工程里（`香港观塘 一键启动 夜间 2.1`）对象散在 **6 个模型目录 + 3 个附件目录**，
//! 而模型把贴图放在自己旁边 —— 按"新根 + 原相对尾部"解 **119/119 条贴图全在盘上**，
//! **平铺进一个目录会把贴图引用全打断**。所以"一个模型目录 + 按文件名找"那条路（`project::搬家`）
//! 表达不了真工程；这里做的是整段**前缀替换**。
//!
//! 三个要点（每条都有实测依据）：
//!   · **所有段都要换**：死路径的大头在 `.emm` 的 `[Effect]` / `[Effect@…]` 段
//!     （实测 158 条在那里面，`[Object]` 只有 14 条）—— 只改 `[Object]` 正是"拖进 MMD 还要挨个指定"的来源。
//!   · **可以有多个旧根**：同一份 `.emm` 里同时存在 `D:\MMD一键渲染工程项目` 与 `H:\UserFile`。
//!   · **字节级替换**：保住 `Acs1 = D:\…` 里等号两侧的原始写法（重拼 `键=值` 会吃掉空格）。
//!
//! 判据一律"宁可拒绝，不许猜"：有一条新路径在盘上不存在就整体拒绝写盘。

use crate::project::{改字段, 找字段};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/** 一个旧根：一批共享同一前缀的绝对路径，外加从工程目录往上试出来的候选新根 */
#[derive(Serialize, Clone, Debug)]
pub struct 根组 {
    pub 根: String,
    /// 这个根下面有多少条绝对路径
    pub 条数: usize,
    /// 逐条列出来太长，给界面看前几条
    pub 例: Vec<String>,
    /// 从工程目录往上试：哪个目录能让这个根下**全部**尾部都在盘上（空 = 没试出来，让用户自己填）
    pub 建议: String,
    /// 建议那个目录下能解开多少条（给界面显示"全部解开 / 部分"）
    pub 建议命中: usize,
    /// 这个根下有多少条**按原样就在盘上**（= 条数 说明这个根没坏，不用改）
    pub 在盘条数: usize,
}

#[derive(Serialize, Default, Debug)]
pub struct 搬根结果 {
    /// 实际用的旧根 → 新根
    pub 根表: Vec<(String, String)>,
    /// `.emm` 改了几行、`.pmm` 改了几处字段
    pub emm改行: usize,
    pub pmm改字段: usize,
    /// 盘上回读：每个旧根还剩几次（必须全 0）
    pub 旧根残留: Vec<(String, usize)>,
    /// 盘上回读：每个新根出现几次（必须 > 0）
    pub 新根出现: Vec<(String, usize)>,
    pub pmm长度: usize,
    pub emm长度: usize,
    pub 原先pmm长度: usize,
    pub 原先emm长度: usize,
    pub 输出: String,
    pub 干跑: bool,
    pub 问题: Vec<String>,
    /// 自带模式：拷进来的文件数 / 总字节数
    pub 拷贝文件: usize,
    pub 拷贝字节: u64,
    /// 自带模式：目标位置已存在且内容不同（不覆盖，整体拒绝）
    pub 重名冲突: Vec<String>,
    /// 自带模式：产物里每条路径是否都指向**拷进来的那份**
    pub 产物路径: Vec<(String, bool)>,
}

/// `.emm` 是 GBK 的文本（实测 `Version = 3`、CRLF）
fn 读emm字节(p: &Path) -> Result<Vec<u8>, String> {
    fs::read(p).map_err(|e| format!("读不了 {}：{e}", p.display()))
}

fn 解gbk(b: &[u8]) -> String {
    encoding_rs::GBK.decode(b).0.to_string()
}

fn 编gbk(s: &str) -> Vec<u8> {
    encoding_rs::GBK.encode(s).0.to_vec()
}

#[allow(dead_code)] // 量具（`migrate_probe.rs`，cfg(test)）在用；非测试构建里没人调，所以放行
/// 量具用：把 `.emm` 读成文本（GBK）
pub fn 读emm文本(p: &Path) -> String {
    fs::read(p).map(|b| 解gbk(&b)).unwrap_or_default()
}

/**
 * 这条路径算不算"我自己的测试/临时地方"。
 *
 * 起因（用户实测抓到的）：我把"测试副本"当搜索起点给检索用过一次，结果产物里
 * **主体模型 `香港观瑭.pmx` 和 `ikClut.x` 指向了 `…\测试效果\⑥香港验收\情形2\UserFile\…`** ——
 * 那是我自己的副本。用户拿到的工程一旦依赖它，我把副本一删工程就废，而且那根本不是他文件所在的位置。
 *
 * 所以定成硬规矩：**产物里任何一条目标路径落在这些地方，整体拒绝写盘**；
 * 检索里在那些地方找到的候选**只列出来让人确认，不许自动采用**。
 */
const 禁止标记: [&str; 5] = ["测试效果", "\\temp\\", "\\tmp\\", "applocalstu", "robin-⑥"];

pub fn 是禁止路径(p: &str) -> bool {
    let 低 = p.to_lowercase();
    禁止标记.iter().any(|m| 低.contains(m))
        || 低.contains("%temp%")
        || (低.contains("\\appdata\\local\\temp"))
}

#[allow(dead_code)] // 同上：只有 cfg(test) 的量具在用
/// 量具用：把字符串编成 GBK 字节
pub fn 编gbk串(s: &str) -> Vec<u8> {
    编gbk(s)
}

/// 一行 `键 = 值` 取值（值必须像绝对路径）；返回 `(值起点, 值字节)`
fn 取绝对路径值(行: &[u8]) -> Option<(usize, Vec<u8>)> {
    let eq = 行.iter().position(|b| *b == b'=')?;
    let 起 = 行[eq + 1..]
        .iter()
        .position(|b| *b != b' ' && *b != b'\t')
        .map(|i| i + eq + 1)?;
    let 值 = &行[起..];
    /* 去尾部空白（CRLF 的 \r 会挂在值尾巴上） */
    let 尾 = 值.iter().rposition(|b| *b != b' ' && *b != b'\t' && *b != b'\r').map(|i| i + 1)?;
    let 值 = &值[..尾];
    if 值.len() >= 3 && 值[1] == b':' && (值[2] == b'\\' || 值[2] == b'/') {
        Some((起, 值.to_vec()))
    } else {
        None
    }
}

/// 取前 `深` 段（`D:\a\b\c` 深 2 → `D:\a`）
fn 前缀(值: &str, 深: usize) -> String {
    let 段: Vec<&str> = 值.split(['\\', '/']).collect();
    if 段.len() <= 深 {
        return String::new();
    }
    段[..深].join("\\")
}

fn 尾部(根: &str, 值: &str) -> String {
    if 根.is_empty() || 值.len() <= 根.len() {
        return String::new();
    }
    值[根.len()..].trim_start_matches(['\\', '/']).to_string()
}

/// 从 `起点` 往上试：哪个目录能让 `根` 下**全部**值的尾部都在盘上
///
/// 候选 = 每一层祖先**自己**，再加上它的**直接子目录**（素材常常放在工程目录下的某个子目录里，
/// 比如 `…\UserFile`；只往上找会漏掉这种，实测就被这个漏洞咬过）。
fn 试新根(根: &str, 值们: &[String], 起点: &Path) -> (String, usize) {
    let mut 最好 = (String::new(), 0usize);
    let 判 = |d: &Path| -> usize {
        值们
            .iter()
            .filter(|v| {
                let 尾 = 尾部(根, v);
                !尾.is_empty() && d.join(&尾).is_file()
            })
            .count()
    };
    let mut 游 = Some(起点.to_path_buf());
    '层: while let Some(d) = 游 {
        let mut 候选: Vec<PathBuf> = vec![d.clone()];
        if let Ok(读) = fs::read_dir(&d) {
            for e in 读.flatten() {
                let p = e.path();
                if p.is_dir() {
                    候选.push(p);
                }
            }
        }
        for c in 候选 {
            let 中 = 判(&c);
            if 中 > 最好.1 {
                最好 = (c.to_string_lossy().to_string(), 中);
            }
            if 中 == 值们.len() && !值们.is_empty() {
                break '层;
            }
        }
        游 = d.parent().map(|p| p.to_path_buf());
    }
    最好
}

/// 发现工程里的所有死根（按"分量前缀"分组；深层分不出来时自动往深试）
pub fn 找死根(pmm: &str, emm: &str) -> Result<Vec<根组>, String> {
    let pmmp = PathBuf::from(pmm);
    let emmp = PathBuf::from(emm);
    let 字节 = 读emm字节(&emmp)?;
    let mut 值们: Vec<String> = Vec::new();
    for 行 in 字节.split(|b| *b == b'\n') {
        if let Some((_, v)) = 取绝对路径值(行) {
            值们.push(解gbk(&v).trim().to_string());
        }
    }
    if 值们.is_empty() {
        return Ok(Vec::new());
    }
    let 起点 = pmmp.parent().unwrap_or(Path::new(".")).to_path_buf();
    /* 先按 2 段分组；某一组试不出新根就把它拆到 3 段、4 段再试 */
    let mut 出: Vec<根组> = Vec::new();
    let mut 待办: Vec<(String, Vec<String>, usize)> = Vec::new();
    let mut 组2: HashMap<String, Vec<String>> = HashMap::new();
    for v in 值们.iter() {
        let p = 前缀(v, 2);
        if p.len() >= 4 {
            组2.entry(p).or_default().push(v.clone());
        }
    }
    for (根, vs) in 组2 {
        待办.push((根, vs, 3));
    }
    while let Some((根, vs, 深)) = 待办.pop() {
        let (建议, 命中) = 试新根(&根, &vs, &起点);
        let 在盘条数 = vs.iter().filter(|v| Path::new(v.as_str()).is_file()).count();
        /* 有一条能解开就**不再拆细**：
           实测（用户"两个情形"验收里的情形②：素材被挪到两处、剩下的还在原地）
           `H:\UserFile` 这一组里一部分搬走了、一部分没搬 —— 以前要求"全解开"才收，
           于是整组拆成了 11 个碎根、每个都 0 命中，**连本来能解开的那部分也丢了规则**，
           最后 4 条没落定、写盘被拒。
           现在只要有命中就用它当**部分规则**：落不到真文件的那几条由「检索/逐条指定」
           在那之上覆盖（两层叠加），写盘前仍然逐条验"目标在不在盘上"，一条不通就整体拒绝。 */
        if 命中 > 0 || 深 > 4 {
            出.push(根组 {
                根: 根.clone(),
                条数: vs.len(),
                例: vs.iter().take(4).cloned().collect(),
                建议,
                建议命中: 命中,
                在盘条数,
            });
            continue;
        }
        /* 拆细再试 */
        let mut 子: HashMap<String, Vec<String>> = HashMap::new();
        for v in vs.iter() {
            let p = 前缀(v, 深);
            if p.len() > 根.len() {
                子.entry(p).or_default().push(v.clone());
            } else {
                子.entry(根.clone()).or_default().push(v.clone());
            }
        }
        if 子.len() <= 1 {
            出.push(根组 {
                根,
                条数: vs.len(),
                例: vs.iter().take(4).cloned().collect(),
                建议,
                建议命中: 命中,
                在盘条数,
            });
            continue;
        }
        for (k, v) in 子 {
            待办.push((k, v, 深 + 1));
        }
    }
    出.sort_by(|a, b| b.条数.cmp(&a.条数));
    Ok(出)
}

/**
 * 一行里把"值开头的旧根"换掉（**字节级**，其余一个字节都不动）。
 *
 * 只换**值开头**那一段 —— 路径中间出现同样的串不算（那是别的意思）。
 * 长根优先，免得 `D:\a` 抢了 `D:\a\b` 的活。
 */
fn 换根一行(行: &[u8], 表: &[(Vec<u8>, Vec<u8>)]) -> (Vec<u8>, bool) {
    let Some((起, 值)) = 取绝对路径值(行) else {
        return (行.to_vec(), false);
    };
    for (旧, 新) in 表 {
        if 值.starts_with(旧.as_slice()) {
            let mut 出 = 行[..起].to_vec();
            出.extend_from_slice(新);
            出.extend_from_slice(&行[起 + 旧.len()..]);
            return (出, true);
        }
    }
    (行.to_vec(), false)
}

/// `.emm` 全文换根：**所有段**，逐行，字节级（CRLF 与 `键 = 值` 的写法原样保留）
pub fn 换根_emm(字节: &[u8], 表: &[(Vec<u8>, Vec<u8>)]) -> (Vec<u8>, usize) {
    let mut 出: Vec<u8> = Vec::with_capacity(字节.len() + 4096);
    let mut 改 = 0;
    let 段们: Vec<&[u8]> = 字节.split(|b| *b == b'\n').collect();
    for (i, 段) in 段们.iter().enumerate() {
        if i > 0 {
            出.push(b'\n');
        }
        if 段.is_empty() {
            continue;
        }
        let (新段, 动) = 换根一行(段, 表);
        if 动 {
            改 += 1;
        }
        出.extend_from_slice(&新段);
    }
    (出, 改)
}

/// 统计针出现次数（字节级）
pub fn 数出现(字节: &[u8], 针: &[u8]) -> usize {
    if 针.is_empty() || 字节.len() < 针.len() {
        return 0;
    }
    字节.windows(针.len()).filter(|w| *w == 针).count()
}

/** 一支路径行（界面逐条指定用）：**每一处**绝对路径一行 */
#[derive(Serialize, Clone, Debug)]
pub struct 路径行 {
    /// 所在段：`Object` / `Effect` / `Effect@FogMap` …
    pub 段: String,
    /// 键：`Acs1` / `Pmd2[3]` …
    pub 键: String,
    pub 原路径: String,
    /// 原路径现在就在盘上吗
    pub 在盘上: bool,
    /// 它落在哪个旧根里（空 = 没有可用的根规则）
    pub 根: String,
    /// 按现在的规则（根 + 逐条覆盖）算出来的目标路径（空 = 没落定）
    pub 目标: String,
    /// `原位在` / `已按根找到` / `已逐条指定` / `需要指定` / `找不到`
    pub 状态: String,
}

/// 一行到底是哪一段的键（`.emm` 是 `[段]` 分段 + `键 = 值`）
fn 段与键(行: &[u8]) -> Option<(String, String)> {
    let eq = 行.iter().position(|b| *b == b'=')?;
    let 键 = 解gbk(&行[..eq]).trim().to_string();
    Some((String::new(), 键))
}

/**
 * 列出**每一处**绝对路径 + 它现在的状态。界面靠它出表、显示"还有几条没落定"。
 *
 * 状态是在**给定规则**下算的：`根表` 是批量层，`逐条` 是单条覆盖层。
 * 覆盖层写成"完整路径 → 新完整路径"，检索时按**旧串长度从大到小**匹配 ——
 * 所以**逐条指定永远压过根规则**（用户改过的那条不会被根规则改回去，这是硬要求）。
 */
#[tauri::command]
pub fn 列路径(
    pmm: String,
    emm: String,
    根表: Vec<(String, String)>,
    逐条: Vec<(String, String)>,
) -> Result<Vec<路径行>, String> {
    /* `.pmm` 的对象路径与 `.emm` 的 `[Object]` 是同一套（量过：966 条一一对应），
       所以表里用 `.emm` 那份就够，这个参数留着是为了命令签名稳定（前端一直传它）。 */
    let emmp = PathBuf::from(&emm);
    let 字节 = 读emm字节(&emmp)?;
    let 规则 = 合规则(&根表, &逐条);
    let e = crate::project::parse_emm(&解gbk(&字节));
    /* 对象路径：`.emm` 的 `[Object]` 段就有，但 `.pmm` 字段里才是 MMD 真正读的那份 ——
       两边都会改，所以按"对象路径"单独标一下段名 */
    /* 它落在哪个旧根里 —— `.emm` 那批和"只在 `.pmm` 里"的那批用同一套算法。
       长串优先：完整路径那条会压过根前缀。 */
    let 算根 = |原: &str| -> String {
        规则
            .iter()
            .filter(|(旧, _)| 原.starts_with(旧.as_str()) && 旧.len() < 原.len())
            .map(|(旧, _)| 旧.clone())
            .max_by_key(|s| s.len())
            .unwrap_or_default()
    };
    let mut 出: Vec<路径行> = Vec::new();
    let mut 段 = String::new();
    for 行 in 字节.split(|b| *b == b'\n') {
        let t = 解gbk(行);
        let t = t.trim_end_matches(['\r', '\n']);
        if t.starts_with('[') && t.ends_with(']') {
            段 = t.trim_matches(['[', ']']).to_string();
            continue;
        }
        let Some((_, 值)) = 取绝对路径值(行) else { continue };
        let 原 = 解gbk(&值).trim().to_string();
        let 键 = 段与键(行).map(|(_, k)| k).unwrap_or_default();
        let (目标, 状态) = 定目标(&原, &规则);
        出.push(路径行 {
            段: 段.clone(),
            键,
            在盘上: Path::new(&原).is_file(),
            根: 算根(&原),
            原路径: 原,
            目标,
            状态,
        });
    }
    /* 对象里可能还有**只在 `.pmm` 字段里**的（`.emm` 的 `[Object]` 没列全）——也补上。
       原来这里拿 `e.objects` 再筛一遍：那个条件恒真（筛的就是同一份清单），
       循环一行都出不来，**是死代码** —— 界面于是只看得见 `.emm` 列过的那些。
       真正该看的是 `.pmm`：`找字段` 会把 `.pmm` 里每个对象条目的路径读出来（`path`）。 */
    if let Ok(pmm字节) = std::fs::read(PathBuf::from(&pmm)) {
        let (命中, _) = crate::project::找字段(&pmm字节, &e.objects);
        let mut 见过: std::collections::HashSet<String> =
            出.iter().map(|行| 行.原路径.clone()).collect();
        for h in 命中 {
            if h.path.is_empty() || !见过.insert(h.path.clone()) {
                continue;
            }
            let (目标, 状态) = 定目标(&h.path, &规则);
            出.push(路径行 {
                段: "Object".into(),
                键: h.名称.clone(),
                在盘上: Path::new(&h.path).is_file(),
                根: 算根(&h.path),
                原路径: h.path.clone(),
                目标,
                状态,
            });
        }
    }
    Ok(出)
}

/// 根表 + 逐条覆盖合成一套规则；**长串优先**（所以完整路径会压过根前缀）
pub fn 合规则(根表: &[(String, String)], 逐条: &[(String, String)]) -> Vec<(String, String)> {
    let 清 = |s: &str| s.trim().trim_end_matches(['\\', '/']).to_string();
    let mut 出: Vec<(String, String)> = Vec::new();
    for (a, b) in 根表.iter().chain(逐条.iter()) {
        let (a, b) = (清(a), b.trim().to_string());
        if !a.is_empty() && !b.is_empty() {
            出.push((a, b));
        }
    }
    出.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
    出
}

/// 一条路径在给定规则下落到哪儿、算什么状态（量具也用，所以是 pub）
/**
 * "多套了一段"的提示。
 *
 * 形状：某条 `旧 → 新` 里，**尾巴的第一段**已经出现在新根的最后一段上 ——
 * 也就是用户把新根指到了"已经含那一段"的目录，拼出来就是 `新根\那一段\剩下的…`
 * （多套一层，盘上当然找不到）。返回一句人话（含该指到哪儿）—— 是**提示方向**，不是结论。
 */
fn 多套一段提示(规则: &[(String, String)], 坏行: &str) -> Option<String> {
    let (左, 右) = 坏行.split_once(" → ")?;
    let (旧, 新) = 规则.iter().find(|(o, _)| 左.starts_with(o.as_str()))?;
    let 尾 = 左[旧.len()..].trim_start_matches(['\\', '/']).to_string();
    let 首段 = 尾.split(['\\', '/']).next().unwrap_or("");
    if 首段.is_empty() {
        return None;
    }
    /* 新路径里"倒数第二段"是不是正好是尾巴的第一段 */
    let 段: Vec<&str> = 右.split(['\\', '/']).collect();
    let 末二 = 段.iter().rev().nth(1).copied().unwrap_or("");
    if !末二.eq_ignore_ascii_case(首段) {
        return None;
    }
    let 上一层 = Path::new(新)
        .ancestors()
        .nth(1)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    /* 只有"指到上一层就真能对上"才算数 —— 不然只是猜（本工程的规矩：宁可不说，不许猜） */
    if 上一层.is_empty() || !Path::new(&拼路径(&上一层, &尾)).is_file() {
        return None;
    }
    Some(format!(
        "看起来是「新根指得深了一层」：新根最后一段已经是「{首段}」，再拼上尾巴就多套一层。\
         要么把新根改成上一层（{上一层}），要么用「逐条指定」把这条单独指过去。"
    ))
}

/**
 * 拼「新根 + 原相对尾部」。
 *
 * 为什么单写一个：原来是 `format!("{新}{尾}")` 直接接 —— 新根末尾带分隔符时会出现
 * `E:\out\\UserFile\a.pmx` 这种双斜杠，落盘就是脏字符串（Windows 能读，但看着像 bug）。
 * 现在**保证中间恰好一个分隔符**。
 */
pub fn 拼路径(新: &str, 尾: &str) -> String {
    let 新 = 新.trim_end_matches(['\\', '/']);
    let 尾 = 尾.trim_start_matches(['\\', '/']);
    if 尾.is_empty() {
        新.to_string()
    } else if 新.is_empty() {
        尾.to_string()
    } else {
        format!("{新}\\{尾}")
    }
}

pub fn 定目标(原: &str, 规则: &[(String, String)]) -> (String, String) {
    for (旧, 新) in 规则 {
        if 原.starts_with(旧.as_str()) {
            let 尾 = &原[旧.len()..];
            let 目标 = 拼路径(新, 尾);
            let 状态 = if 目标 == 原 {
                "原位在"
            } else if 旧.len() == 原.len() {
                "已逐条指定"
            } else {
                "已按根找到"
            };
            return (目标, 状态.into());
        }
    }
    if Path::new(原).is_file() {
        (原.to_string(), "原位在".into())
    } else {
        (String::new(), "需要指定".into())
    }
}

/* ------------------------------------------------------------ 检索 */

#[derive(Serialize, Clone, Debug)]
pub struct 检索行 {
    /// 工程里写的那条（可能已经死了）
    pub 原路径: String,
    pub 文件名: String,
    /// 在搜索起点里找到的候选（按尾部匹配分从高到低）
    pub 候选: Vec<String>,
    /// 建议用哪个（**唯一最优**才有；并列或没找到 = 空，交界面让人挑）
    pub 建议: String,
    /// `已唯一找到` / `多个候选` / `没找到`
    pub 状态: String,
    pub 备注: String,
}

/**
 * 尾部段匹配分：从后往前数**连续相同的路径段**（忽略大小写与斜杠方向）。
 *
 * 为什么不能只按文件名配：这套工程里同一个文件名会出现在好几个模型目录下
 * （`Lighting\PointLightIES.pmx` 5 处、`Fog\VolumetricSphere.pmx` 2 处），
 * 只按文件名会串台 —— 拿"尾部还能对上几段"当判据，5 处各自都能对到自己的那一份。
 */
fn 尾分(原: &str, 候选: &str) -> usize {
    let 切 = |s: &str| -> Vec<String> {
        s.split(['\\', '/'])
            .map(|x| x.trim().to_lowercase())
            .filter(|x| !x.is_empty())
            .collect()
    };
    let a = 切(原);
    let b = 切(候选);
    let mut n = 0usize;
    while n < a.len() && n < b.len() && a[a.len() - 1 - n] == b[b.len() - 1 - n] {
        n += 1;
    }
    n
}

/// 把一棵目录树按「小写文件名 → 全路径」建成索引（**一次遍历喂所有查询**）。
///
/// **必须有界**：用户实测"搜索起点选到 `D:\` 就卡死"。三条线（层数 / 条目 / 时间）
/// 在 `fsops::有界遍历` 里兜着，超了就把「范围太大，请给更具体的起点」原样带出去。
fn 建索引(根: &Path, 索引: &mut HashMap<String, Vec<String>>) -> Result<(), String> {
    crate::fsops::有界遍历(根, crate::fsops::检索扫描上限, true, |entry| {
        let p = entry.path();
        if let Some(名) = p.file_name() {
            索引
                .entry(名.to_string_lossy().to_lowercase())
                .or_default()
                .push(p.to_string_lossy().to_string());
        }
    })?;
    Ok(())
}

/**
 * 检索：从用户给的搜索起点里，按文件名把**挪走了的那些**找出来。
 *
 * 这是"工程修复"那一步的入口（用户原话"**让其检索移动后的文件的位置**"）：
 * 工程里写的路径死了（文件被挪到别处、或本来就是别人机器上的根），人不必一条条指 ——
 * 给几个搜索起点目录，这里按文件名找齐，**唯一最优的直接给建议**，并列的把候选摆出来让人挑。
 *
 * `async` + `progress` + 全局取消位：手动选到盘根那种大范围时**界面不许冻住**，
 * 要能看见进度、也要能停。上限三条线在 `建索引` 里（超了报"范围太大"）。
 *
 * 判据（宁可让人挑，不许猜）：
 *   · 已经在盘上的（原位在 / 规则算出来的目标真在盘上）**不进这张表**；
 *   · 一条候选都没有 = `没找到`，如实报；
 *   · 多个候选按"尾部还能对上几段"排序，**只有最优严格领先才给建议**；
 *     并列一律 `多个候选`、建议留空 —— 猜错就是把工程指向别人的同名文件。
 */
#[tauri::command(async)]
pub fn 检索(
    pmm: String,
    emm: String,
    根表: Vec<(String, String)>,
    逐条: Vec<(String, String)>,
    起点: Vec<String>,
) -> Result<Vec<检索行>, String> {
    检索内部(pmm, emm, 根表, 逐条, 起点, true)
}

/// `查禁止 = false` 只给单测用（量具的夹具就建在 `%TEMP%` 里，那是合法的）
fn 检索内部(
    pmm: String,
    emm: String,
    根表: Vec<(String, String)>,
    逐条: Vec<(String, String)>,
    起点: Vec<String>,
    查禁止: bool,
) -> Result<Vec<检索行>, String> {
    let 全部 = 列路径(pmm, emm, 根表, 逐条)?;
    let mut 要: Vec<路径行> = Vec::new();
    let mut 见过: std::collections::HashSet<String> = std::collections::HashSet::new();
    for r in 全部 {
        if !见过.insert(r.原路径.clone()) {
            continue;
        }
        /* 落定的（规则算出来的目标真的在盘上）不用检索 */
        if !r.目标.is_empty() && Path::new(&r.目标).is_file() {
            continue;
        }
        要.push(r);
    }
    let mut 索引: HashMap<String, Vec<String>> = HashMap::new();
    crate::fsops::设扫描取消(false);
    for s in 起点.iter() {
        let p = Path::new(s.trim());
        if p.is_dir() {
            建索引(p, &mut 索引).map_err(|e| format!("{e}（起点：{}）", p.display()))?;
        }
    }
    let mut 出: Vec<检索行> = Vec::new();
    for r in 要 {
        let 名 = Path::new(&r.原路径)
            .file_name()
            .map(|x| x.to_string_lossy().to_string())
            .unwrap_or_default();
        let mut 候选 = 索引.get(&名.to_lowercase()).cloned().unwrap_or_default();
        /* **测试/临时目录里找到的一律不许自动采用**（用户实测抓到的：主体模型被指到了我的测试副本里）。
           它们仍然列在候选里给人看，但只作"待确认"。 */
        let 可疑: Vec<String> = if 查禁止 {
            候选.iter().filter(|c| 是禁止路径(c)).cloned().collect()
        } else {
            Vec::new()
        };
        候选.retain(|c| !查禁止 || !是禁止路径(c));
        候选.sort_by(|a, b| 尾分(&r.原路径, b).cmp(&尾分(&r.原路径, a)).then(a.cmp(b)));
        let (建议, 状态, 备注) = if 候选.is_empty() {
            if 可疑.is_empty() {
                (
                    String::new(),
                    "没找到".to_string(),
                    format!("搜索起点里没有叫「{名}」的文件"),
                )
            } else {
                let mut c = 可疑.clone();
                c.sort();
                (
                    String::new(),
                    "待确认（在测试/临时目录里）".to_string(),
                    format!("只在测试/临时目录里找到 {} 个：{}", c.len(), c.join("、")),
                )
            }
        } else if 候选.len() == 1 {
            (候选[0].clone(), "已唯一找到".to_string(), String::new())
        } else {
            let 首 = 尾分(&r.原路径, &候选[0]);
            let 次 = 尾分(&r.原路径, &候选[1]);
            if 首 > 次 {
                (
                    候选[0].clone(),
                    "已唯一找到".to_string(),
                    format!("另有 {} 个同名候选，尾部对不上", 候选.len() - 1),
                )
            } else {
                (
                    String::new(),
                    "多个候选".to_string(),
                    format!("{} 个同名候选尾部一样长，得由人挑", 候选.len()),
                )
            }
        };
        /* 候选列表给人挑时，可疑的那些也一起列出来（末尾，标注来源） */
        let mut 全部候选 = 候选.clone();
        全部候选.extend(可疑.clone());
        出.push(检索行 {
            原路径: r.原路径,
            文件名: 名,
            候选: 全部候选,
            建议,
            状态,
            备注,
        });
    }
    Ok(出)
}

/// 找根：给界面出表用
#[tauri::command]
pub fn 找根(pmm: String, emm: String) -> Result<Vec<根组>, String> {
    找死根(&pmm, &emm)
}

/* ==================================================================
   搬运：**真的把文件搬/拷过去**，然后改工程里的路径指向新位置。

   用户原话："看一眼要动哪些文件后，对文件都在的情况可以选择将**文件迁移**到指定位置
   （**单选或多选都可以**）然后保存，工程文件迁移也可以做到修复"。

   跟"自包含打包"的关系：自包含 = 全部拷到**一个**位置；这条支持**多个**位置
   （模型放 A、特效放 B…），而且可以选择"移动"（默认"拷贝"，保留原件更安全）。
   ================================================================== */

#[derive(Serialize, Default, Debug)]
pub struct 搬运结果 {
    /// 拷过去多少个文件 / 多少字节
    pub 拷贝文件: usize,
    pub 拷贝字节: u64,
    /// 「搬」模式下删掉的原件数（只在**逐个字节核对相同**之后才删）
    pub 删除文件: usize,
    /// 目标位置已有同名但内容不同（不覆盖，整体拒绝）
    pub 重名冲突: Vec<String>,
    /// 实际用的「旧前缀 → 目标位置」
    pub 目标表: Vec<(String, String)>,
    /// 逐条说明（给界面看：哪条去了哪、跳过了什么）
    pub 说明: Vec<String>,
    /// 改完路径之后的那套回读结果
    pub 根结果: 搬根结果,
}

/// 比路径用的归一：小写 + 斜杠统一成 `\` + 去掉尾部分隔符。
///
/// **必须归一**：界面/`.emm` 里的路径可能混着 `/` 和 `\`，不归一的话
/// "同一个目录"会被判成两个，于是**把一个目录拷到它自己里面** —— 实测会栈溢出（自己套自己无限递归）。
fn 归一路径(p: &str) -> String {
    p.trim()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

/// 一条路径按「旧前缀 → 目标目录」算出 (源, 目标)；匹配不到返回 None（长前缀优先）
fn 搬运定位(原: &str, 表: &[(String, String)]) -> Option<(String, String)> {
    let 原归 = 归一路径(原);
    let mut 最佳: Option<(&String, &String, usize)> = None;
    for (旧, 到) in 表.iter() {
        let 旧归 = 归一路径(旧);
        if !旧归.is_empty() && 原归.starts_with(&旧归) && 最佳.map(|(_, _, n)| 旧归.len() > n).unwrap_or(true) {
            最佳 = Some((旧, 到, 旧归.len()));
        }
    }
    let (_, 到, 旧长) = 最佳?;
    /* 尾段**从原串上切**：`归一路径` 会把字母转小写，照它切会把拷出来的文件名也变成小写。
       转小写改变了长度时（极少数 Unicode）退回归一后的串 —— 宁可变小写，也不许切坏 UTF-8 边界。 */
    let 原斜 = 原.trim().replace('/', "\\");
    let 原斜 = 原斜.trim_end_matches('\\');
    let 保原样 = 原斜.to_lowercase().len() == 原斜.len() && 原斜.is_char_boundary(旧长);
    let 尾 = if 保原样 {
        原斜[旧长..].trim_start_matches('\\').to_string()
    } else {
        原归[旧长..].trim_start_matches('\\').to_string()
    };
    if 尾.is_empty() {
        return None;
    }
    let 到 = 到.trim().trim_end_matches(['\\', '/']).replace('/', "\\");
    Some((原.to_string(), format!("{}\\{}", 到, 尾)))
}

/// 目标目录是不是在源目录里面（那样拷下去会自己套自己）
fn 在里层(内: &Path, 外: &Path) -> bool {
    let a = 归一路径(&内.to_string_lossy());
    let b = 归一路径(&外.to_string_lossy());
    !b.is_empty() && a.starts_with(&b)
}

/**
 * 「包内绝对路径」→「相对包根」：`E:\输出\模型\x.pmx` → `.\模型\x.pmx`。
 *
 * 配布打包用的就是它：写成相对路径，包里一个盘符都不带。落不到包根下面的返回 `None`
 * （调用方整体拒绝，不许写半份）。切的时候**按原串切**，免得把大小写也带下去。
 */
fn 配布相对(绝对: &str, 包根: &str) -> Option<String> {
    let a = 归一路径(绝对);
    let b = 归一路径(包根);
    if b.is_empty() || !a.starts_with(&b) {
        return None;
    }
    let 原 = 绝对.trim().replace('/', "\\");
    let 原无尾 = 原.trim_end_matches('\\');
    /* 转小写改变了长度（极少数 Unicode）时按归一后的串对齐 —— 宁可变小写也不许切坏边界 */
    let 保原样 = 原无尾.to_lowercase().len() == 原无尾.len() && 原无尾.is_char_boundary(b.len());
    let 尾 = if 保原样 {
        原无尾[b.len()..].trim_start_matches('\\').to_string()
    } else {
        a[b.len()..].trim_start_matches('\\').to_string()
    };
    if 尾.is_empty() {
        /* 值正好等于包根本身 = 这是"按根"那条前缀（后面还会接尾部）。
           写成 `.` —— `拼路径(".", 尾)` 出来就是 `.\尾`。 */
        Some(".".to_string())
    } else {
        Some(format!(".\\{尾}"))
    }
}

/// 配布模式写进去的是 `.\尾`：判"在不在盘上"要按**包根**解回来。
fn 解配布(值: &str, 包根: &Path) -> PathBuf {
    let t = 值.trim();
    let t = t
        .strip_prefix(".\\")
        .or_else(|| t.strip_prefix("./"))
        .unwrap_or(t);
    包根.join(t)
}

/// 配布模式读回用：`=` 右边那一格，**不要求是绝对路径**（写进去的就是 `.\…`）。
fn 取配布值(行: &[u8]) -> Option<(usize, Vec<u8>)> {
    let i = 行.iter().position(|b| *b == b'=')?;
    let mut s = i + 1;
    while s < 行.len() && (行[s] == b' ' || 行[s] == b'\t') {
        s += 1;
    }
    let mut e = 行.len();
    while e > s
        && (行[e - 1] == b'\r' || 行[e - 1] == b'\n' || 行[e - 1] == b' ' || 行[e - 1] == b'\t')
    {
        e -= 1;
    }
    if e <= s || 行[s] != b'.' || !行[s..e].contains(&b'\\') {
        return None;
    }
    Some((s, 行[s..e].to_vec()))
}

/// 配布包里那份 `配布说明.txt` 的内容。
///
/// **照实写**：本工具在这个工程里验过的是"包里一个本机盘符都没有、每条路径都指在包内"，
/// **没有**在真 MMD 上验过各版本对相对路径的接受度 —— 不许写成"保证能开"。
fn 配布说明(pmm目标: &Path) -> String {
    format!(
        "这个文件夹是 RobinEditor 打出来的「配布包」。\r\n\
         \r\n\
         怎么用\r\n\
         1. 整个文件夹一起给出去（别只挑其中的文件），放在哪个盘、哪个目录都行。\r\n\
         2. 打开 MMD，拖进去的工程是这一个：{}\r\n\
         3. 特效分配存在 .emm 里，MMD 打开工程不会自动读它 —— 菜单「エフェクト割り当て → 読み込み」单独载入。\r\n\
         \r\n\
         这个包里有什么\r\n\
         · 工程文件与素材都在这个文件夹里，工程里写的是**相对这个文件夹**的路径（一个盘符都不带）。\r\n\
         · 所以换机器、换盘符都不用重指。\r\n\
         \r\n\
         有一条没验过（照实说）\r\n\
         · 「相对路径」这种写法本工具只在包里核对过位置，**没有在真 MMD 上逐个版本验过**。\r\n\
           如果 MMD 打开时问你要某个文件的路径，就指到这个文件夹里对应的那一份；\r\n\
           或者让对方用 RobinEditor 的「修复工程」把路径重新指一遍。\r\n",
        pmm目标
            .file_name()
            .map(|x| x.to_string_lossy().to_string())
            .unwrap_or_default()
    )
}

/**
 * 搬运 + 改路径 + 保存。
 *
 * `目标表`：**旧前缀 → 目标前缀**（可以多组：模型放 A、特效放 B）。
 * `逐条`：也是一样的「旧前缀 → 目标前缀」，只是串更长（个别目录单独放时用，长的压过 `目标表`）。
 *   注意：**不是**「文件 → 目录」—— 后缀是拼上来的（`目标前缀 + 原串剩余的那一段`），
 *   所以给完整文件路径当旧串会剩不下任何后缀，工具会判成"没有目标位置"并拒绝。
 * `方式`：`拷`（默认，保留原件）/ `搬`（拷完核对字节相同再删原件）。
 * `干跑`：只算不写。
 *
 * 判据（宁可拒绝不许猜）：① 每条引用都得能匹配到一个目标位置、且源文件在盘上；
 * ② 目标目录不许在源目录里面（会自己套自己）；③ 目标已有同名但内容不同 → 整体拒绝；
 * ④ 搬完之后**逐个字节核对**，相同才删原件；⑤ 最后照常走"改路径 + 回读核对"那套
 * （路径必须都在盘上、且不许落到测试/临时目录）。
 */
#[tauri::command]
pub fn 搬运工程(
    pmm: String,
    emm: String,
    目标表: Vec<(String, String)>,
    逐条: Vec<(String, String)>,
    方式: String,
    干跑: bool,
) -> Result<搬运结果, String> {
    搬运内部(pmm, emm, 目标表, 逐条, 方式, 干跑, true, true)
}

/// `查禁止 = false` 只给单测用（夹具建在 `%TEMP%` 里，那是合法的）
/// `记 = false` 也只给单测用：**单测不许往用户真实的操作记录目录里写东西**
/// （记录目录是进程级环境变量，并行跑的测试还会互相看到对方的记录 —— 实测就被这个咬过）
fn 搬运内部(
    pmm: String,
    emm: String,
    目标表: Vec<(String, String)>,
    逐条: Vec<(String, String)>,
    方式: String,
    干跑: bool,
    查禁止: bool,
    记: bool,
) -> Result<搬运结果, String> {
    let 搬 = 方式.trim() == "搬";
    let 表 = 合规则(&目标表, &逐条);
    if 表.is_empty() {
        return Err("没有指定任何目标位置：先在表里给要动的那些文件挑一个目标目录。没有动任何文件。".into());
    }
    let pmmp = PathBuf::from(&pmm);
    let emmp = PathBuf::from(&emm);
    let 原pmm = fs::read(&pmmp).map_err(|e| format!("读不了 {pmm}：{e}"))?;
    let 原emm = 读emm字节(&emmp)?;

    /* ---- ① 收齐所有引用（.emm 全段 + .pmm 对象字段），逐条算源/目标 ---- */
    let mut 所有: Vec<String> = Vec::new();
    for 行 in 原emm.split(|b| *b == b'\n') {
        if let Some((_, 值)) = 取绝对路径值(行) {
            所有.push(解gbk(&值).trim().to_string());
        }
    }
    let e0 = crate::project::parse_emm(&解gbk(&原emm));
    let (hits0, _) = 找字段(&原pmm, &e0.objects);
    for h in hits0.iter() {
        所有.push(h.path.clone());
    }
    所有.sort();
    所有.dedup();

    let mut 待拷: Vec<(String, String)> = Vec::new();
    let mut 说明: Vec<String> = Vec::new();
    let mut 没指定: Vec<String> = Vec::new();
    for v in 所有.iter() {
        let Some((源, 目标)) = 搬运定位(v, &表) else {
            没指定.push(v.clone());
            continue;
        };
        if !Path::new(&源).is_file() {
            没指定.push(format!("{v}（源文件不在盘上）"));
            continue;
        }
        if 源 == 目标 || 归一路径(&源) == 归一路径(&目标) {
            continue; /* 本来就指对地方了（含只差斜杠的写法），不用搬 */
        }
        let 源目录 = Path::new(&源).parent().map(|p| p.to_path_buf()).unwrap_or_default();
        let 目标目录 = Path::new(&目标).parent().map(|p| p.to_path_buf()).unwrap_or_default();
        if 在里层(&目标目录, &源目录) {
            return Err(format!(
                "目标位置在源目录里面（{} ← {}）—— 那样会自己套自己，拒绝。没有动任何文件。",
                目标目录.display(),
                源目录.display()
            ));
        }
        待拷.push((源, 目标));
    }
    if !没指定.is_empty() {
        return Err(format!(
            "有 {} 条「没有可用的目标位置」（或者源文件不在盘上）—— 先给它们指定目标目录。没有动任何文件。前几条：\n{}",
            没指定.len(),
            没指定.iter().take(8).cloned().collect::<Vec<_>>().join("\n")
        ));
    }

    /* ---- ② 拷（按「源目录 → 目标目录」整目录拷，把贴图这些邻居一起带上） ---- */
    let mut 拷贝文件 = 0usize;
    let mut 拷贝字节 = 0u64;
    let mut 重名冲突: Vec<String> = Vec::new();
    let mut 已拷: Vec<(String, String)> = Vec::new(); /* (源文件, 目标文件) 供"搬"模式删源 */
    let mut 拷过: HashMap<String, ()> = HashMap::new();
    /* 搬运这条没有干跑（`if 干跑 { continue }` 在上面），这个集合只是跟着 `拷树` 的新参数走 */
    let mut 本轮写过: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut 目录对: Vec<记录目录对> = Vec::new(); /* 给撤销用 */
    let mut 删过: Vec<原件动过> = Vec::new(); /* 「搬」模式删掉的原件 */
    for (源, 目标) in 待拷.iter() {
        let 源目录 = Path::new(源).parent().map(|p| p.to_path_buf()).unwrap_or_default();
        let 目标目录 = Path::new(目标).parent().map(|p| p.to_path_buf()).unwrap_or_default();
        let 键 = format!("{}|{}", 源目录.display(), 目标目录.display());
        if 拷过.insert(键, ()).is_some() {
            continue;
        }
        if 干跑 {
            continue;
        }
        目录对.push(记录目录对 {
            源: 源目录.to_string_lossy().to_string(),
            目标: 目标目录.to_string_lossy().to_string(),
            目标本来就在: 目标目录.is_dir(),
        });
        拷树(&源目录, &目标目录, &mut 拷贝文件, &mut 拷贝字节, &mut 重名冲突, false, &mut 本轮写过)?;
        已拷.push((源.clone(), 目标.clone()));
    }
    if !重名冲突.is_empty() {
        return Err(format!(
            "目标位置已经有同名但内容不同的文件（{} 处）—— 不覆盖，换个空目录或自己先处理。没有动任何文件。前几条：\n{}",
            重名冲突.len(),
            重名冲突.iter().take(6).cloned().collect::<Vec<_>>().join("\n")
        ));
    }
    /* 干跑：只报"会拷多少"，不碰盘 */
    if 干跑 {
        let mut 字节 = 0u64;
        let mut 数 = 0usize;
        for (源, _) in 待拷.iter() {
            if let Ok(元) = fs::metadata(源) {
                数 += 1;
                字节 += 元.len();
            }
        }
        return Ok(搬运结果 {
            拷贝文件: 数,
            拷贝字节: 字节,
            删除文件: 0,
            重名冲突: vec![],
            目标表: 表,
            说明: vec![format!("干跑：会搬/拷 {数} 个被引用的文件（约 {:.1} MB），并改工程里的路径", 字节 as f64 / 1048576.0)],
            根结果: 搬根结果::default(),
        });
    }

    /* ---- ③ 改路径 + 保存：复用「根替换」那套（含回读核对与"禁止测试目录"硬闸） ----
       **这一步必须排在"删原件"之前**：它有好几个拒绝口子（是禁止路径 / 换完不在盘上 /
       旧根残留 > 0），一拒绝就用 `?` 返回。原来「搬」的删除写在这一步**前面**，
       于是"报错了、用户原件却已经没了、撤销记录也没落" ——
       唯一不可逆的一条（2026-09-25 只读审查量出来的，三个只读审查里最重的一条）。
       删原件是不可逆动作，必须放在**所有还能拒绝的步骤之后**。 */
    let 根结果 = 搬根内部带开关(
        pmm.clone(),
        emm.clone(),
        表.clone(),
        vec![],
        String::new(), /* 原地改工程文件（留 .bak） */
        false,
        false,
        查禁止,
        false, /* 记录由这里自己落（要把"删过的原件"和"拷出来的目录"一起写进去） */
    )?;
    if 根结果.pmm改字段 == 0 && 根结果.emm改行 == 0 {
        return Err("一个路径都没改到（表可能没匹配上工程里的路径）—— 检查目标位置填对没有。".into());
    }

    /* ---- ④ 「搬」模式：工程那边已经改成功了，**这才**删原件；空目录顺手收掉 ----
       （顺序反过来就是"删完才发现不让改"，用户原件白白没了。） */
    let mut 删除文件 = 0usize;
    if 搬 {
        for (源, 目标) in 已拷.iter() {
            let Ok(a) = fs::read(源) else { continue };
            let Ok(b) = fs::read(目标) else { continue };
            if a == b && fs::remove_file(源).is_ok() {
                删除文件 += 1;
                说明.push(format!("搬走了原件：{源}"));
                /* 记下来 —— 撤销就照这个把原件搬回去 */
                删过.push(原件动过 {
                    原: 源.clone(),
                    新: 目标.clone(),
                    字节: a.len() as u64,
                    校验: 校验64(&a),
                });
            }
        }
        /* 收掉空目录：从最深的往上试，只删空目录 */
        let mut 目录们: Vec<PathBuf> = 待拷
            .iter()
            .filter_map(|(源, _)| Path::new(源).parent().map(|p| p.to_path_buf()))
            .collect();
        目录们.sort_by_key(|p| std::cmp::Reverse(p.components().count()));
        目录们.dedup();
        for d in 目录们 {
            let mut 游 = Some(d.as_path());
            while let Some(cur) = 游 {
                let Ok(mut 读) = fs::read_dir(cur) else { break };
                if 读.next().is_some() {
                    break; /* 还有东西，停 */
                }
                if fs::remove_dir(cur).is_err() {
                    break;
                }
                说明.push(format!("删掉空目录：{}", cur.display()));
                游 = cur.parent();
            }
        }
    }
    /* 落操作记录（写盘之后）：把"拷出来的目录"和"删掉的原件"一起写进去，撤销照它反着做 */
    let 人话 = format!(
        "搬运（{}）→ {}（拷了 {} 个文件{}）",
        方式.trim(),
        if 表.len() == 1 { 表[0].1.clone() } else { format!("{} 处目标", 表.len()) },
        拷贝文件,
        if 删除文件 > 0 { format!("，搬走原件 {} 个", 删除文件) } else { String::new() }
    );
    if 记 {
        if let Err(e) = 落记录(
            "搬运",
            方式.trim(),
            &pmm,
            &emm,
            vec![(pmm.clone(), 原pmm.clone()), (emm.clone(), 原emm.clone())],
            Vec::new(),
            目录对,
            删过,
            人话,
        ) {
            eprintln!("[⑥] 操作记录没落成：{e}（不影响这次写盘的结果）");
        }
    }
    Ok(搬运结果 {
        拷贝文件,
        拷贝字节,
        删除文件,
        重名冲突,
        目标表: 表,
        说明,
        根结果,
    })
}


/**
 * 根替换写盘。
 *
 * `根表`：旧根 → 新根（用户可改，界面默认填"从工程目录往上试出来"的候选）。
 * `输出`：空 = 原地改（留 `.bak`）；非空 = 写这个目录（**不覆盖已存在的**）。
 *
 * 拒绝规则（宁可拒绝不许猜）：有任何一条换完的路径在盘上找不到 → 整体拒绝、不写盘、逐条列出来。
 */
#[tauri::command]
pub fn 搬根(
    pmm: String,
    emm: String,
    根表: Vec<(String, String)>,
    逐条: Vec<(String, String)>,
    输出: String,
    干跑: bool,
) -> Result<搬根结果, String> {
    搬根内部(pmm, emm, 根表, 逐条, 输出, 干跑, false)
}

/// 自包含：把工程引用的素材**一并拷进输出目录**，路径改成指向拷进来的那份
///
/// `配布` = **配布打包**（发给别人）：
///   · false（默认，**本机内打包**）—— 包内两份工程文件写的是**包内的本机绝对路径**
///     （`E:\输出\模型\x.pmx`）。在这台机器上双击就能开；换台机器、或者把包挪到别的盘，
///     就全指空（那是用户实测过的老毛病："产物指向的是别的机器上的绝对路径"）。
///   · true（**配布打包**）—— 包内写的是**相对包根**的路径（`.\模型\x.pmx`），
///     一个盘符都不带，谁拿到、放在哪个盘都指在包自己里面。
///     （MMD 各版本对相对路径的接受度本工程**没有在真 MMD 上验过** —— 界面与包内说明都照实写着。）
#[tauri::command]
pub fn 搬根自带(
    pmm: String,
    emm: String,
    根表: Vec<(String, String)>,
    逐条: Vec<(String, String)>,
    输出: String,
    干跑: bool,
    配布: Option<bool>,
) -> Result<搬根结果, String> {
    搬根内部全参(pmm, emm, 根表, 逐条, 输出, 干跑, true, 配布.unwrap_or(false), true, true)
}

fn 搬根内部(
    pmm: String,
    emm: String,
    根表: Vec<(String, String)>,
    逐条: Vec<(String, String)>,
    输出: String,
    干跑: bool,
    自带: bool,
) -> Result<搬根结果, String> {
    搬根内部全参(pmm, emm, 根表, 逐条, 输出, 干跑, 自带, false, true, true)
}

/// `查禁止 = false` 只给单测用（夹具建在 `%TEMP%` 或 `测试效果\` 里，那是合法的）
/// `记 = false`：由调用方自己落记录（搬运要把"删过的原件"一起记进去，所以它关掉这里的）
/// `pub(crate)`：⑥ 那套"真工程副本 A 与 C 验收"（在 `project.rs` 的测试里）也要用它，
/// 因为它同样不能碰用户真实的记录目录、夹具同样落在 `测试效果\` 里。
pub(crate) fn 搬根内部带开关(
    pmm: String,
    emm: String,
    根表: Vec<(String, String)>,
    逐条: Vec<(String, String)>,
    输出: String,
    干跑: bool,
    自带: bool,
    查禁止: bool,
    记: bool,
) -> Result<搬根结果, String> {
    搬根内部全参(pmm, emm, 根表, 逐条, 输出, 干跑, 自带, false, 查禁止, 记)
}

/// 全参数那个（`配布` 只有 `搬根自带` 那条路会用，其余调用方走上面那个薄的）
pub(crate) fn 搬根内部全参(
    pmm: String,
    emm: String,
    根表: Vec<(String, String)>,
    逐条: Vec<(String, String)>,
    输出: String,
    干跑: bool,
    自带: bool,
    配布: bool,
    查禁止: bool,
    记: bool,
) -> Result<搬根结果, String> {
    let 配布 = 配布 && 自带;
    let 出目录 = PathBuf::from(输出.trim());
    let pmmp = PathBuf::from(&pmm);
    let emmp = PathBuf::from(&emm);
    let 原pmm = fs::read(&pmmp).map_err(|e| format!("读不了 {pmm}：{e}"))?;
    let 原emm = 读emm字节(&emmp)?;
    let mut 表文本: Vec<(String, String)> = 合规则(&根表, &逐条);
    /* 长串优先已经排好了；同一旧串重复给就取第一条（用户的逐条覆盖排在根之后，但更长的串天然先命中） */
    表文本.dedup_by(|a, b| a.0 == b.0);
    /* 拷贝清单和改写清单都是从映射表里长出来的（自带模式把「旧根 → 新根」换成「旧根 → 输出目录」）。
       自带模式**允许一条映射都不给**：工程本来就健康（路径都指在盘上）时，
       拷贝清单直接从"盘上确实有的那些路径"长出来 —— 这就是"只想打个包"的入口。
       原地修复那条路没有映射仍然拒（它没有别的办法知道该改成什么）。 */
    if 表文本.is_empty() && !自带 {
        return Err("没有给「旧根 → 新根」或「逐条指定」的映射：先「找根」看看这批路径指向哪儿。没有写盘。".into());
    }

    /* ---- 自带模式：先按「解析表」找到源文件，连它所在的整棵目录拷进输出；
           再把映射换成「写表」（旧根 → 输出目录），后面照常改写与回读。
           为什么连整目录拷：模型把贴图放在自己旁边（实测 119/119 条贴图靠相对结构），
           只拷 .pmx 会把贴图引用全打断。 ---- */
    let mut 拷贝文件 = 0usize;
    let mut 拷贝字节 = 0u64;
    let mut 重名冲突: Vec<String> = Vec::new();
    /* 这次拷出来的「源目录 → 目标目录」，给撤销用（撤销只删**我们造出来的**那些） */
    let mut 目录对: Vec<记录目录对> = Vec::new();
    if 自带 {
        if 输出.trim().is_empty() {
            return Err("自包含要把素材拷进输出目录，所以先选一个输出目录。没有写盘。".into());
        }
        let 出 = PathBuf::from(&输出);
        let 解析 = 表文本.clone();
        /* 收集「源文件 → 相对尾部」 */
        let mut 待拷: Vec<(String, String)> = Vec::new();
        let mut 逐条目标: HashMap<String, String> = HashMap::new();
        let e0 = crate::project::parse_emm(&解gbk(&原emm));
        let (hits0, _) = 找字段(&原pmm, &e0.objects);
        let mut 所有: Vec<String> = Vec::new();
        for 行 in 原emm.split(|b| *b == b'\n') {
            if let Some((_, 值)) = 取绝对路径值(行) {
                所有.push(解gbk(&值).trim().to_string());
            }
        }
        for h in hits0.iter() {
            所有.push(h.path.clone());
        }
        for v in 所有 {
            let (源, 状态) = 定目标(&v, &解析);
            if 状态 == "需要指定" || 状态 == "找不到" {
                return Err(format!(
                    "自包含要求每条路径都能在盘上找到：这条没有（{v}）—— 先按「找根」把旧根指到实际位置。没有写盘。"
                ));
            }
            if !Path::new(&源).is_file() {
                return Err(format!("自包含要求每条路径都在盘上：找不到文件（{v} → {源}）。没有写盘。"));
            }
            /* 尾部：
               · 命中根规则的 → 去掉规则前缀的相对尾部（保住「新根下的相对结构」）；
               · **一条规则都没命中、但盘上确实有**的（工程本来就健康）→ 取「源目录名\文件名」：
                 连它的邻居（贴图）一起进包，且**也进写表**改指包内 —— 这就是原来漏在包外的那批。 */
            let 精确指定 = 解析.iter().any(|(旧, _)| 旧 == &v);
            let 按根 = !精确指定 && 解析.iter().any(|(旧, _)| v.starts_with(旧.as_str()));
            let 尾 = if 按根 {
                相对尾部(&v, &解析)
            } else {
                目录名文件名(&源)
            };
            if !按根 {
                逐条目标.insert(v.clone(), 尾.clone());
            }
            待拷.push((源, 尾));
        }
        /* 去重：同一个「源目录 → 目标目录」只拷一次 */
        let mut 拷过: HashMap<String, ()> = HashMap::new();
        /* 干跑时"本次已经数过的目标文件"（真跑靠盘上那份存在与否自己就认出来了，见 `拷树`） */
        let mut 本轮写过: std::collections::HashSet<String> = std::collections::HashSet::new();
        for (源, 尾) in 待拷 {
            let 源目录 = Path::new(&源).parent().map(|p| p.to_path_buf()).unwrap_or_default();
            let 尾目录 = Path::new(&尾).parent().map(|p| p.to_path_buf()).unwrap_or_default();
            let 目标目录 = 出.join(&尾目录);
            let 键 = format!("{}|{}", 源目录.display(), 目标目录.display());
            if 拷过.insert(键, ()).is_some() {
                continue;
            }
            if !源目录.is_dir() {
                continue;
            }
            /* 输出目录落在源目录**里面**时不许拷：那会一边拷一边把新拷出来的东西再当成源，
               越拷越深（实测这一条在搬运那边会直接把进程弄崩，所以那条也拒）。 */
            if 在里层(&出, &源目录) {
                return Err(format!(
                    "输出目录在源目录里面（{} 在 {} 里）—— 那会自己拷自己、越拷越深。换个输出位置。没有写盘。",
                    出.display(),
                    源目录.display()
                ));
            }
            目录对.push(记录目录对 {
                源: 源目录.to_string_lossy().to_string(),
                目标: 目标目录.to_string_lossy().to_string(),
                目标本来就在: 目标目录.is_dir(),
            });
            /* 干跑时只走一遍数数（不建目录、不写文件）；冲突照样查 */
            拷树(&源目录, &目标目录, &mut 拷贝文件, &mut 拷贝字节, &mut 重名冲突, 干跑, &mut 本轮写过)?;
        }
        if !重名冲突.is_empty() {
            return Err(format!(
                "输出目录里已经有同名但内容不同的文件（{} 处），不覆盖 —— 换个空目录再来，或者把同名的那几个文件改个名。没有写盘。前几条：\n{}",
                重名冲突.len(),
                重名冲突.iter().take(6).cloned().collect::<Vec<_>>().join("\n")
            ));
        }
        /* 写表：
           · 根条目 → 输出目录（原相对尾部照旧）
           · 逐条条目 / 本来健康的那条 → 输出\源目录名\文件名（保留那个文件的邻居，否则贴图会断） */
        let 拼到出 = |尾: &str| -> String {
            let mut p = 出.clone();
            for 段 in 尾.split(['\\', '/']) {
                if !段.is_empty() {
                    p.push(段);
                }
            }
            p.to_string_lossy().to_string()
        };
        let mut 写表覆盖: HashMap<String, String> = HashMap::new();
        let mut 根写: Vec<(String, String)> = Vec::new();
        for (旧, _) in 表文本.clone().into_iter() {
            if let Some(尾) = 逐条目标.get(&旧) {
                写表覆盖.insert(旧, 拼到出(尾));
            } else {
                根写.push((旧, 输出.clone()));
            }
        }
        /* 本来就是健康、一条规则都没命中的那些：也要进写表 —— 不然文件进了包、路径却还在包外 */
        for (旧, 尾) in 逐条目标.iter() {
            if 写表覆盖.contains_key(旧) {
                continue;
            }
            写表覆盖.insert(旧.clone(), 拼到出(尾));
        }
        表文本 = 写表覆盖.into_iter().collect();
        表文本.extend(根写);
        表文本.sort_by(|a, b| b.0.len().cmp(&a.0.len()));

        /* ---- 配布打包：把「包内绝对路径」换成「相对包根」（`.\模型\x.pmx`） ----
           本机内打包写绝对路径（在这台机器上双击就能开），配布写相对路径（不带盘符）。
           两条路只有这一处不同 —— 拷贝、回读、撤销全都是同一套。 */
        if 配布 {
            let 包根 = 出.to_string_lossy().to_string();
            let mut 换不成: Vec<String> = Vec::new();
            表文本 = 表文本
                .into_iter()
                .map(|(旧, 新)| match 配布相对(&新, &包根) {
                    Some(相) => (旧, 相),
                    None => {
                        换不成.push(新.clone());
                        (旧, String::new())
                    }
                })
                .collect();
            if !换不成.is_empty() {
                return Err(format!(
                    "配布打包要求每条新路径都落在输出目录里，这几条不是（{}）—— 没有写盘。",
                    换不成.iter().take(4).cloned().collect::<Vec<_>>().join("、")
                ));
            }
        }
    }

    /* 「旧根 == 新根」= 原地不动。这种情况必须**单独说清楚**：
       ① 写盘只是把同样的字节再写一遍；
       ② 回读那条"旧根必须归零"必然误报 —— 它数到的正是新根自己（实测：工程本来就在原位时，
          找死根给出的建议就是它自己，用户点写盘会收到"旧根还剩 186 次"这种看不懂的报错）。
       **必须放在自带模式改写之后**：自带模式里写表会被换成"旧根 → 输出目录"，
       传进来的"旧==新"只是用来**找源文件**的，那时候是有真东西要写的。 */
    if 表文本.iter().all(|(a, b)| 归一路径(a) == 归一路径(b)) {
        return Err("工程里的路径已经指在原位了（旧根和新根是同一处），没有需要改的地方。没有写盘。".into());
    }

    let 表: Vec<(Vec<u8>, Vec<u8>)> = 表文本
        .iter()
        .map(|(a, b)| (编gbk(a), 编gbk(b)))
        .collect();

    /* ---- 先验：每条会被换的路径，换完必须在盘上；换不到的（本机也没有）→ 逐条拒绝 ----
       配布模式下目标写的是 `.\…`（相对包根），所以凡是要看盘的地方都过这个解回来。 */
    let 解落点 = |s: &str| -> PathBuf {
        if 配布 {
            解配布(s, &出目录)
        } else {
            PathBuf::from(s)
        }
    };
    let mut 问题: Vec<String> = Vec::new();
    let mut 坏: Vec<String> = Vec::new();
    let mut 没落定: Vec<String> = Vec::new();
    /* 落在"测试/临时地方"的目标路径（硬拒绝，见 `是禁止路径`） */
    let mut 禁止: Vec<String> = Vec::new();
    let mut 根命中: HashMap<String, usize> = HashMap::new();
    /* 新路径**写不进 256 字节字段**的那些（改不动就整体拒绝，见下面） */
    let mut 改写失败: Vec<String> = Vec::new();
    /* 自带模式**试算**时"换完在盘上"这条查不了：目标是输出目录里那一份，而干跑真的不碰盘、
       包还没建出来（源文件在不在盘上，上面那张拷贝清单已经逐条验过了）。
       不跳过的话试算永远报"有 N 条换完在盘上找不到"—— 打包区的"试算（不写盘）"就一直是坏的。 */
    let 查目标在盘上 = !(自带 && 干跑);
    for 行 in 原emm.split(|b| *b == b'\n') {
        let Some((_, 值)) = 取绝对路径值(行) else { continue };
        let vs = 解gbk(&值).trim().to_string();
        let (目标, 状态) = 定目标(&vs, &表文本);
        match 状态.as_str() {
            "需要指定" => 没落定.push(vs),
            "找不到" => 没落定.push(vs),
            _ => {
                if let Some((旧, _)) = 表文本.iter().find(|(旧, _)| vs.starts_with(旧.as_str())) {
                    *根命中.entry(旧.clone()).or_insert(0) += 1;
                }
                if 查目标在盘上 && !解落点(&目标).is_file() {
                    坏.push(format!("{vs} → {目标}"));
                }
                if 查禁止 && 是禁止路径(&解落点(&目标).to_string_lossy()) {
                    禁止.push(format!("{vs} → {目标}"));
                }
            }
        }
    }
    if !没落定.is_empty() {
        return Err(format!(
            "有 {} 条路径「既没有根规则、本机也没有这个文件」（没落定）—— 拒绝写盘（没有动任何文件）。前几条：\n{}",
            没落定.len(),
            没落定.iter().take(8).cloned().collect::<Vec<_>>().join("\n")
        ));
    }
    /* 目标不许落在"测试/临时地方"：那是我自己的副本/临时目录，用户一旦依赖它，
       我一删副本工程就废（实测被这条坑过：主体模型被指到了我的测试副本里）。 */
    if !禁止.is_empty() {
        return Err(format!(
            "有 {} 条目标路径落在「测试/临时目录」里（{}）—— 拒绝写盘：工程的路径不许依赖这种地方。\n前几条：\n{}",
            禁止.len(),
            禁止标记.join(" / "),
            禁止.iter().take(6).cloned().collect::<Vec<_>>().join("\n")
        ));
    }
    /* .pmm 里的对象路径同样要验（它们在 256 字节字段里） */
    let e = crate::project::parse_emm(&解gbk(&原emm));
    let (hits, 命中问题) = 找字段(&原pmm, &e.objects);
    问题.extend(命中问题);
    let mut pmm改字段 = 0usize;
    let mut 字节 = 原pmm.clone();
    let mut 范围: Vec<(usize, usize)> = Vec::new();
    for h in hits.iter() {
        let (新, 状态) = 定目标(&h.path, &表文本);
        if 状态 == "需要指定" {
            没落定.push(format!("{}（{}）", h.key, h.path));
            continue;
        }
        if 解落点(&新).is_file() || !查目标在盘上 {
            /* 只有真的换了才写 */
            let 换了 = 新 != h.path;
            if 查禁止 && 换了 && 是禁止路径(&解落点(&新).to_string_lossy()) {
                禁止.push(format!("{}（{}）→ {新}", h.key, h.path));
                continue;
            }
            if !换了 {
                continue;
            }
        } else {
            坏.push(format!("{}（{}）→ {新}", h.key, h.path));
            continue;
        }
        for off in h.全部.iter() {
            match 改字段(&mut 字节, *off, &新) {
                Ok(()) => {
                    pmm改字段 += 1;
                    范围.push((*off, *off + 256));
                }
                /* **改不动就是整体拒绝**（原来是塞进 `问题` 继续跑）——
                   塞进 `问题` 的后果是：这一条字段留在原位（还是死路径），
                   用户拿到一份"改好了"的工程，里面却仍有一条指向别处。
                   典型触因：新路径按 GBK 编出来超过 255 字节。试算阶段就要拦。 */
                Err(msg) => 改写失败.push(format!("{}：{msg}", h.key)),
            }
        }
    }
    if !改写失败.is_empty() {
        return Err(format!(
            "有 {} 条路径「写不进那个 256 字节的字段」（新路径太长之类）—— 拒绝写盘（没有动任何文件）。\
             \n换个短一点的新根，或者把那条用「逐条指定」指到更深一层的目录。前几条：\n{}",
            改写失败.len(),
            改写失败.iter().take(6).cloned().collect::<Vec<_>>().join("\n")
        ));
    }
    if !没落定.is_empty() {
        return Err(format!(
            "有 {} 条对象路径没落定（本机找不到、也没有规则）—— 拒绝写盘。前几条：\n{}",
            没落定.len(),
            没落定.iter().take(8).cloned().collect::<Vec<_>>().join("\n")
        ));
    }
    if !坏.is_empty() {
        /* 这里最容易犯的错是"新根指得深了一层"：目标落在旧根里面、或者用户把新根指到了
           已经含尾巴第一段的那个目录上，于是拼出来多套一段（现场那个错就是这个形状）。
           这种时候光说"找不到文件"没用，要把**可能是哪一段多了**写出来。 */
        let 提示 = 坏
            .iter()
            .find_map(|s| 多套一段提示(&表文本, s))
            .map(|h| format!("\n{h}"))
            .unwrap_or_default();
        return Err(format!(
            "有 {} 条换完在盘上找不到 —— 拒绝写盘（没有动任何文件）。前几条：\n{}{}",
            坏.len(),
            坏.iter().take(8).cloned().collect::<Vec<_>>().join("\n"),
            提示
        ));
    }
    if !禁止.is_empty() {
        return Err(format!(
            "有 {} 条对象路径落在「测试/临时目录」里 —— 拒绝写盘：工程的路径不许依赖这种地方。前几条：\n{}",
            禁止.len(),
            禁止.iter().take(6).cloned().collect::<Vec<_>>().join("\n")
        ));
    }
    if 根命中.is_empty() && pmm改字段 == 0 {
        return Err("这些旧根在工程里一条都没匹配上（可能根写错了）—— 没有写盘。".into());
    }

    /* ---- .emm：所有段 ---- */
    let (新emm, emm改行) = 换根_emm(&原emm, &表);

    let mut r = 搬根结果 {
        根表: 表文本.clone(),
        emm改行,
        pmm改字段,
        pmm长度: 字节.len(),
        emm长度: 新emm.len(),
        原先pmm长度: 原pmm.len(),
        原先emm长度: 原emm.len(),
        输出: 输出.clone(),
        干跑,
        问题,
        ..Default::default()
    };

    /* 自带模式那几个计数**必须带回结果**：不填的话界面会显示"拷了 0 个文件"，
       用户看到的就是"打包只丢出一个文件"（实测被这条坑过）。
       **试算也要带**（干跑在下面就先返回了）—— 不然「试算（不写盘）」报的是"要拷 0 个文件"。 */
    if 自带 {
        r.拷贝文件 = 拷贝文件;
        r.拷贝字节 = 拷贝字节;
        r.重名冲突 = 重名冲突.clone();
    }

    if 干跑 {
        r.旧根残留 = 表文本.iter().map(|(a, _)| (a.clone(), 0)).collect();
        r.新根出现 = 表文本.iter().map(|(_, b)| (b.clone(), 0)).collect();
        return Ok(r);
    }

    /* ---- 写盘：原地（留 .bak）或写到指定目录（不覆盖） ---- */
    let (pmm目标, emm目标) = if 输出.trim().is_empty() {
        let bak = |p: &Path| {
            let b = p.with_extension(format!(
                "{}.bak",
                p.extension().map(|x| x.to_string_lossy().to_string()).unwrap_or_default()
            ));
            if !b.exists() {
                fs::copy(p, &b).map_err(|e| format!("留备份失败：{e}"))?;
            }
            Ok::<(), String>(())
        };
        bak(&pmmp)?;
        bak(&emmp)?;
        (pmmp.clone(), emmp.clone())
    } else {
        let d = PathBuf::from(&输出);
        fs::create_dir_all(&d).map_err(|e| format!("建目录失败：{e}"))?;
        let 名 = |p: &Path| p.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
        let a = d.join(名(&pmmp));
        let b = d.join(名(&emmp));
        if a.exists() || b.exists() {
            return Err(format!(
                "输出目录里已经有同名文件了（{}）—— 不覆盖，换个目录或先搬走它。没有写盘。",
                a.display()
            ));
        }
        (a, b)
    };
    fs::write(&pmm目标, &字节).map_err(|e| format!("写不了 .pmm：{e}"))?;
    fs::write(&emm目标, &新emm).map_err(|e| format!("写不了 .emm：{e}"))?;
    r.输出 = 目标目录字符串(&pmm目标);

    /* ---- 回读核对（盘上不许变样、旧根必须归零、新根必须出现） ---- */
    let 盘pmm = fs::read(&pmm目标).map_err(|e| format!("写完读不回来：{e}"))?;
    let 盘emm = fs::read(&emm目标).map_err(|e| format!("写完读不回来：{e}"))?;
    if 盘pmm != 字节 {
        return Err(format!("写完回读不一致：{}（盘上 {} 字节，内存 {} 字节）", pmm目标.display(), 盘pmm.len(), 字节.len()));
    }
    if 盘emm != 新emm {
        return Err(format!("写完回读不一致：{}", emm目标.display()));
    }
    for (旧s, 新s) in 表文本.iter() {
        /* 同一处的映射（只差大小写/斜杠）跳过：它没被"换掉"是因为**残留的就是新根本身** */
        if 归一路径(旧s) == 归一路径(新s) {
            continue;
        }
        let 旧针 = 编gbk(旧s);
        let mut n = 数出现(&盘pmm, &旧针) + 数出现(&盘emm, &旧针);
        /* **新路径本身就带旧串**的时候（`新` 以 `旧` 开头 —— 例如把包打在旧根命名的那个目录里面：
           `E:\C test` 是老根、包落在 `E:\C test\⑥验收\打包\包里\…`），数出来的全是**新路径**，
           不是"没换掉的旧路径"。判据改成 `数(旧) − 数(新)`。
           香港那套真工程量具就是这么假红过一次（包里 172/172 条路径都在盘上，却被这条拦住）。 */
        if 归一路径(新s).starts_with(&归一路径(旧s)) {
            let 新针 = 编gbk(新s);
            n = n.saturating_sub(数出现(&盘pmm, &新针) + 数出现(&盘emm, &新针));
        }
        r.旧根残留.push((旧s.clone(), n));
    }
    for (_, 新s) in 表文本.iter() {
        let n = 数出现(&盘pmm, &编gbk(新s)) + 数出现(&盘emm, &编gbk(新s));
        r.新根出现.push((新s.clone(), n));
    }
    if let Some((根, n)) = r.旧根残留.iter().find(|(_, n)| *n > 0) {
        return Err(format!(
            "写完回读：旧根「{根}」在产物里还剩 {n} 次（不在对象字段/值开头的位置，没换成）—— 请把剩下的这几处也定位清楚再写。",
        ));
    }
    if r.新根出现.iter().all(|(_, n)| *n == 0) {
        return Err("写完回读：新根在产物里一次都没出现（写盘可能落空）".into());
    }
    /* 差异字节必须全部落在被改的 256 字节字段里 —— "没碰别处"的硬证据 */
    let 越界 = (0..原pmm.len())
        .filter(|i| 原pmm[*i] != 字节[*i])
        .filter(|i| !范围.iter().any(|(a, b)| i >= a && i < b))
        .count();
    if 越界 > 0 {
        return Err(format!("写完核对：有 {越界} 个差异字节落在路径字段之外 —— 拒绝（说明改到了别处）"));
    }
    if 自带 {
        /* 产物里每条绝对路径是不是都指向**拷进来的那份**（在包内、且在盘上）。
           这是"包能直接打开"的判据：有一条不在盘上就整体算失败。
           注意：要按**原始字节**切行再按 GBK 解 —— 先解成 String 再 `as_bytes()`
           会变成 UTF-8 字节、再当 GBK 解一遍，路径就全成乱码（自己踩过）。 */
        if 配布 {
            /* 配布写的是 `.\…`：`取绝对路径值` 认不出它，换 `取配布值`；
               而且 **.pmm 那 256 字节字段也要逐条回读**（它不在 .emm 里）。 */
            for 行 in 盘emm.split(|b| *b == b'\n') {
                let Some((_, 值)) = 取配布值(行) else { continue };
                let v = 解gbk(&值).trim().to_string();
                r.产物路径.push((v.clone(), 解配布(&v, &出目录).is_file()));
            }
            for (起, 止) in 范围.iter() {
                let v = 解gbk(&盘pmm[*起..*止]).trim_matches('\0').trim().to_string();
                if v.is_empty() {
                    continue;
                }
                r.产物路径.push((v.clone(), 解配布(&v, &出目录).is_file()));
            }
        } else {
            for 行 in 盘emm.split(|b| *b == b'\n') {
                let Some((_, 值)) = 取绝对路径值(行) else { continue };
                let v = 解gbk(&值).trim().to_string();
                r.产物路径.push((v.clone(), Path::new(&v).is_file()));
            }
        }
        let 不在: Vec<String> = r
            .产物路径
            .iter()
            .filter(|(_, ok)| !ok)
            .map(|(p, _)| p.clone())
            .collect();
        if !不在.is_empty() {
            return Err(format!(
                "打包核对：产物里有 {} 条路径在盘上找不到（包不完整）—— 前几条：\n{}",
                不在.len(),
                不在.iter().take(6).cloned().collect::<Vec<_>>().join("\n")
            ));
        }
        if 配布 {
            /* 配布额外一条硬判据：**包里不许留本机的绝对路径**。
               写进去的全是 `.\…`，所以"还能数到 `X:\`"就等于这条路没走通。 */
            let 数盘符 = |b: &[u8]| -> usize {
                (0..b.len().saturating_sub(2))
                    .filter(|i| {
                        b[*i].is_ascii_alphabetic()
                            && b[*i + 1] == b':'
                            && (b[*i + 2] == b'\\' || b[*i + 2] == b'/')
                    })
                    .count()
            };
            let 本机路径 = 数盘符(&盘pmm) + 数盘符(&盘emm);
            if 本机路径 > 0 {
                return Err(format!(
                    "配布核对：产物里还有 {本机路径} 处本机绝对路径（`X:\\…`）—— 配布包不该带盘符，拒绝。"
                ));
            }
            /* 包里附一份说明：接收方拿到就知道该怎么开、以及哪一条没验过 */
            let 说明位 = 出目录.join("配布说明.txt");
            let 说明 = 配布说明(&pmm目标);
            fs::write(&说明位, 说明.as_bytes()).map_err(|e| format!("写配布说明失败：{e}"))?;
            r.产物路径.push((说明位.to_string_lossy().to_string(), true));
        }
    }
    /* ---- 落"操作记录"（写盘之后、返回之前）----
       原地改 → 记 `改前`（含整份副本）；另存/自包含 → 记 `产物`（那两个写出来的工程文件）。
       记录写不成也**不算失败**（已经写盘了），但要如实说一句。 */
    if 记 && !干跑 {
        let 就地 = 输出.trim().is_empty();
        let (动作, 改前, 产物) = if 就地 {
            (
                if 自带 { "自包含目录" } else { "原地修复" },
                vec![
                    (pmm目标.to_string_lossy().to_string(), 原pmm.clone()),
                    (emm目标.to_string_lossy().to_string(), 原emm.clone()),
                ],
                Vec::new(),
            )
        } else {
            let mut 出产物 = Vec::new();
            for p in [&pmm目标, &emm目标] {
                if let Ok(b) = fs::read(p) {
                    出产物.push(记录件 {
                        路径: p.to_string_lossy().to_string(),
                        备份: String::new(),
                        字节: b.len() as u64,
                        校验: 校验64(&b),
                    });
                }
            }
            (
                if 自带 { "自包含目录" } else { "另存换根" },
                Vec::new(),
                出产物,
            )
        };
        let 人话 = format!(
            "{}{} → {}（改字段 {} / 改行 {}{}）",
            动作,
            if 就地 { "（就地改）" } else { "（另存）" },
            if 就地 { 目标目录字符串(&pmm目标) } else { 输出.clone() },
            r.pmm改字段,
            r.emm改行,
            if r.拷贝文件 > 0 { format!("，拷了 {} 个文件", r.拷贝文件) } else { String::new() }
        );
        if let Err(e) = 落记录(
            动作,
            "",
            &pmm目标.to_string_lossy(),
            &emm目标.to_string_lossy(),
            改前,
            产物,
            目录对.clone(),
            Vec::new(),
            人话,
        ) {
            eprintln!("[⑥] 操作记录没落成：{e}（不影响这次写盘的结果）");
        }
    }
    Ok(r)
}

fn 目标目录字符串(p: &Path) -> String {
    p.parent().map(|x| x.to_string_lossy().to_string()).unwrap_or_default()
}

/// 「源目录名\文件名」——自带模式里"没有根前缀可切"的那些路径（逐条指定、以及本来就健康的）
/// 用这个当尾部：它进了包还带着自己那一层目录名，贴图等邻居一起跟上，相对引用就不会断。
fn 目录名文件名(源: &str) -> String {
    let p = Path::new(源);
    let 目 = p
        .parent()
        .and_then(|x| x.file_name())
        .map(|x| x.to_string_lossy().to_string())
        .unwrap_or_default();
    let 名 = p
        .file_name()
        .map(|x| x.to_string_lossy().to_string())
        .unwrap_or_default();
    if 目.is_empty() {
        名
    } else {
        format!("{目}\\{名}")
    }
}

/// 路径去掉**匹配到的那条规则前缀**之后剩下的部分（自带模式靠它保住相对结构）。
/// 一条规则都没匹配上（"原位在"）时退化成文件名。
fn 相对尾部(v: &str, 规则: &[(String, String)]) -> String {
    let mut 最佳: Option<&str> = None;
    for (旧, _) in 规则.iter() {
        if v.starts_with(旧.as_str()) && 最佳.map(|b| 旧.len() > b.len()).unwrap_or(true) {
            最佳 = Some(旧.as_str());
        }
    }
    let 尾 = match 最佳 {
        Some(旧) => &v[旧.len()..],
        None => v,
    };
    let 尾 = 尾.trim_start_matches(['\\', '/']);
    if 尾.is_empty() {
        Path::new(v)
            .file_name()
            .map(|x| x.to_string_lossy().to_string())
            .unwrap_or_default()
    } else {
        尾.to_string()
    }
}

/**
 * 整棵目录拷过去（自带模式用）。
 *
 * 为什么拷整棵而不是只拷那一个文件：模型把贴图放在自己旁边，只拷 `.pmx` 会把贴图引用全打断
 * （实测 119/119 条贴图靠相对结构才都在盘上）。目标已存在且**内容相同**就跳过，内容不同算冲突。
 */
/**
 * 把 `源` 整棵树拷到 `目标`（保相对结构）。
 *
 * `干跑 = true` 时**只走一遍、只报数**：不建目录、不写文件 —— 但**冲突照样查**
 * （"目标里已经有同名但内容不同的文件"必须在试算阶段就告诉用户，不能等真跑才拦）。
 *
 * 为什么要有这个开关（用户实测抓到的）：自带模式的试算原来直接调了会写盘的那条路，
 * 于是"试算（不写盘）"**真的往盘上拷了文件** —— 说了不碰盘就必须不碰。
 */
/**
 * 目标的"盘上身份"键：只给干跑数数用。
 *
 * 真跑判"这个目标文件是不是已经有了"是问文件系统（`到.exists()`）；
 * 干跑不能问（本次还没落盘），只能用自己记的集合 —— 那就得按**同一套规矩**比，
 * 否则 Windows 上 `Materials` 与 `materials` 会被当成两个目录。
 */
fn 路径键(p: &Path) -> String {
    let s = p.to_string_lossy().to_string();
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s
    }
}

fn 拷树(
    源: &Path,
    目标: &Path,
    文件数: &mut usize,
    字节数: &mut u64,
    冲突: &mut Vec<String>,
    干跑: bool,
    本轮写过: &mut std::collections::HashSet<String>,
) -> Result<(), String> {
    if !干跑 {
        fs::create_dir_all(目标).map_err(|e| format!("建目录失败 {}：{e}", 目标.display()))?;
    }
    let 读 = fs::read_dir(源).map_err(|e| format!("读不了目录 {}：{e}", 源.display()))?;
    for 项 in 读 {
        let 项 = 项.map_err(|e| format!("遍历失败：{e}"))?;
        let p = 项.path();
        let 名 = 项.file_name();
        let 到 = 目标.join(&名);
        let 元 = 项.metadata().map_err(|e| format!("取不到属性：{e}"))?;
        if 元.is_dir() {
            拷树(&p, &到, 文件数, 字节数, 冲突, 干跑, 本轮写过)?;
        } else {
            if 到.exists() {
                let 源字节 = fs::read(&p).map_err(|e| format!("读不了 {}：{e}", p.display()))?;
                let 旧字节 = fs::read(&到).unwrap_or_default();
                if 旧字节 == 源字节 {
                    continue; /* 已经有一份一样的，不重复拷 */
                }
                冲突.push(format!("{}", 到.display()));
                continue;
            }
            if 干跑 {
                /* 干跑：只数。字节数按源文件大小算，跟真跑同一个口径。
                   **但"同一个目标文件本次已经数过"这一手必须自己补**：真跑里上面那条
                   `到.exists() && 字节相同 → continue` 会把重叠加叠的部分跳过（多条源目录
                   映射到同一个或互相嵌套的目标目录时很常见），而干跑不落盘、那个条件
                   永远不成立。不补就虚报 —— 实测香港那套（1160 个文件进包）：
                   试算报 2475 个 / 264.9 MB，真跑只拷 1160 个 / 197.0 MB，2.1 倍。
                   **键要按盘上的规矩比**：Windows 上 `Materials` 和 `materials` 是同一个目录，
                   真跑那条 `到.exists()` 是文件系统在判（不区分大小写），干跑用大小写敏感的
                   路径键就会又把这 474 个文件多数一遍。 */
                if !本轮写过.insert(路径键(&到)) {
                    continue;
                }
                *文件数 += 1;
                *字节数 += 元.len();
                continue;
            }
            let 源字节 = fs::read(&p).map_err(|e| format!("读不了 {}：{e}", p.display()))?;
            fs::write(&到, &源字节).map_err(|e| format!("写不了 {}：{e}", 到.display()))?;
            *文件数 += 1;
            *字节数 += 源字节.len() as u64;
        }
    }
    Ok(())
}

/* ==================================================================
   操作记录 / 撤销（用户 2026-09-22："指定路径错了可以还原"）

   规矩（跟写盘一样严）：
     · **先落记录、后动手** —— 中途崩了也知道做过什么；
     · 撤销 **先预检、再执行、最后回读核对**；预检有一条不过就**整体拒绝**；
     · 撤销只做**上一次**（成功就标 `已撤销`）；
     · 记录里任何路径命中测试/临时目录 → 一律拒绝。

   为什么不能只靠 `.bak`：连做两次就把上一次的 `.bak` 盖掉了（实测就是这样），
   而且实测现场有一份 `.emm` 连 `.bak` 都没有。所以**改前的工程文件整份存进记录目录**
   （一次约 47 KB），`.bak` 只当交叉校验。
   ================================================================== */

/// 64 位 FNV-1a。用途只有一个：**"这个文件还是不是当初那份"**。
/// 需要"逐字节一致"的地方（原件搬回、目标目录是不是纯副本）走的是**真读字节比对**，不靠它。
fn 校验64(b: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for x in b {
        h ^= *x as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

fn 现在秒() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 记录放哪儿：`%APPDATA%\com.robineditor.app\undo\`（Tauri 的 app_data_dir 就是这个）。
/// 量具用 `ROBIN_撤销目录` 指到别处 —— 免得测试污染真记录。
pub fn 记录根() -> PathBuf {
    if let Ok(p) = std::env::var("ROBIN_撤销目录") {
        if !p.trim().is_empty() {
            return PathBuf::from(p);
        }
    }
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(base).join("com.robineditor.app").join("undo")
}

fn 名安全(s: &str) -> String {
    s.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
pub struct 记录件 {
    /// 真正会被写回 / 删掉的那个文件
    pub 路径: String,
    /// 改前副本（只有 `改前` 用；`产物` 留空）
    pub 备份: String,
    pub 字节: u64,
    pub 校验: u64,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
pub struct 记录目录对 {
    pub 源: String,
    pub 目标: String,
    /// 动手之前目标目录**本来就在**吗？本来就在 → 撤销时一个都不删（那不是我们造的）
    pub 目标本来就在: bool,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
pub struct 原件动过 {
    pub 原: String,
    pub 新: String,
    pub 字节: u64,
    pub 校验: u64,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
pub struct 操作记录 {    pub 版本: u32,
    pub 时间: u64,
    /// 界面上那一行："搬运（拷）→ E:\C test\达到"
    pub 人话: String,
    pub 动作: String,
    pub 方式: String,
    pub pmm: String,
    pub emm: String,
    /// 被就地改写的工程文件 + 改前副本
    pub 改前: Vec<记录件>,
    /// 这次新写出来的工程文件（另存/自包含）
    pub 产物: Vec<记录件>,
    /// 这次拷出来的目录（源 → 目标）
    pub 目录对: Vec<记录目录对>,
    /// 「搬」模式删掉的原件
    pub 原件: Vec<原件动过>,
    pub 已撤销: bool,
    /// 记录文件自己的路径（撤销时改 `已撤销` 用）
    pub 文件: String,
}

/// 记录目录里留最近这么多份，多的删掉（只删我们自己造的记录目录）
fn 收拾旧记录(根: &Path, 留: usize) {
    let Ok(读) = fs::read_dir(根) else { return };
    let mut 们: Vec<PathBuf> = 读
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir() && p.join("记录.json").is_file())
        .collect();
    们.sort();
    while 们.len() > 留 {
        let 老 = 们.remove(0);
        let _ = fs::remove_dir_all(&老);
    }
}

/// 落一份记录（**写盘之前**调用）。返回写好的记录；写不成就是 `Err`（调用方据此拒绝写盘）。
#[allow(clippy::too_many_arguments)]
fn 落记录(
    动作: &str,
    方式: &str,
    pmm: &str,
    emm: &str,
    改前: Vec<(String, Vec<u8>)>,
    产物: Vec<记录件>,
    目录对: Vec<记录目录对>,
    原件: Vec<原件动过>,
    人话: String,
) -> Result<操作记录, String> {
    let 时间 = 现在秒();
    let 根 = 记录根();
    /* 同一秒里连做两次会撞名：后面加 -2、-3 */
    let mut 夹 = 根.join(format!("{时间}-{}", 名安全(动作)));
    let mut n = 1;
    while 夹.exists() {
        n += 1;
        夹 = 根.join(format!("{时间}-{}-{}", 名安全(动作), n));
    }
    fs::create_dir_all(夹.join("改前")).map_err(|e| format!("建不了记录目录 {}：{e}", 夹.display()))?;
    let mut 件: Vec<记录件> = Vec::new();
    for (路径, 字节) in 改前.iter() {
        let 名 = Path::new(路径)
            .file_name()
            .map(|x| x.to_string_lossy().to_string())
            .unwrap_or_else(|| "改前".to_string());
        let 备份 = 夹.join("改前").join(format!("{}-{}", 件.len() + 1, 名));
        fs::write(&备份, 字节).map_err(|e| format!("写改前副本失败 {}：{e}", 备份.display()))?;
        件.push(记录件 {
            路径: 路径.clone(),
            备份: 备份.to_string_lossy().to_string(),
            字节: 字节.len() as u64,
            校验: 校验64(字节),
        });
    }
    let mut r = 操作记录 {
        版本: 1,
        时间,
        人话,
        动作: 动作.to_string(),
        方式: 方式.to_string(),
        pmm: pmm.to_string(),
        emm: emm.to_string(),
        改前: 件,
        产物,
        目录对,
        原件,
        已撤销: false,
        文件: String::new(),
    };
    let p = 夹.join("记录.json");
    r.文件 = p.to_string_lossy().to_string();
    fs::write(&p, serde_json::to_string_pretty(&r).map_err(|e| format!("序列化记录失败：{e}"))?)
        .map_err(|e| format!("写记录失败 {}：{e}", p.display()))?;
    收拾旧记录(&根, 30);
    Ok(r)
}

/// 最近一份**还没撤销**的记录
fn 读最近记录() -> Result<Option<操作记录>, String> {
    let 根 = 记录根();
    let Ok(读) = fs::read_dir(&根) else {
        return Ok(None);
    };
    let mut 们: Vec<PathBuf> = 读
        .flatten()
        .map(|e| e.path().join("记录.json"))
        .filter(|p| p.is_file())
        .collect();
    们.sort();
    for p in 们.iter().rev() {
        let Ok(s) = fs::read_to_string(p) else { continue };
        let Ok(mut r) = serde_json::from_str::<操作记录>(&s) else { continue };
        r.文件 = p.to_string_lossy().to_string();
        if !r.已撤销 {
            return Ok(Some(r));
        }
    }
    Ok(None)
}

/// 删一个文件，然后**只在空了的时候**往上收目录（绝不动非空目录）
fn 删文件收空目录(p: &Path) {
    if fs::remove_file(p).is_err() {
        return;
    }
    let mut 游 = p.parent();
    while let Some(cur) = 游 {
        let Ok(mut 读) = fs::read_dir(cur) else { break };
        if 读.next().is_some() {
            break;
        }
        if fs::remove_dir(cur).is_err() {
            break;
        }
        游 = cur.parent();
    }
}

/// 目标目录里的东西是不是**全都**能在源目录里逐字节对上（目标 ⊆ 源）。
///
/// 反向**有意不查**：搬模式撤销时原件已经从目标搬回源，目标里剩下的正是我们拷过去的"邻居副本"，
/// 它们当然也在源里 —— 这正是要删的。而"目标里多出源里没有的东西"说明用户自己往里放过东西，那就一个都不删。
/// 判据能成立还靠一条：`目录对.目标本来就在 == false`（这个目录是我们这次造的）。
fn 目标都是源的副本(源: &Path, 目标: &Path) -> Result<(bool, String), String> {
    if !目标.is_dir() {
        return Ok((false, format!("目标不是目录：{}", 目标.display())));
    }
    let 读 = fs::read_dir(目标).map_err(|e| format!("读不了 {}：{e}", 目标.display()))?;
    for 项 in 读 {
        let 项 = 项.map_err(|e| format!("遍历失败：{e}"))?;
        let 名 = 项.file_name();
        let a = 源.join(&名);
        let b = 目标.join(&名);
        let 元 = 项.metadata().map_err(|e| format!("取不到属性：{e}"))?;
        if 元.is_dir() {
            let (同, 因) = 目标都是源的副本(&a, &b)?;
            if !同 {
                return Ok((false, 因));
            }
        } else {
            if !a.is_file() {
                return Ok((false, format!("目标里有原处没有的文件：{}", b.display())));
            }
            let ba = fs::read(&a).map_err(|e| format!("读不了 {}：{e}", a.display()))?;
            let bb = fs::read(&b).map_err(|e| format!("读不了 {}：{e}", b.display()))?;
            if ba != bb {
                return Ok((false, format!("内容跟原处不一样：{}", b.display())));
            }
        }
    }
    Ok((true, String::new()))
}

fn 字节同(a: &Path, b: &Path) -> bool {
    match (fs::read(a), fs::read(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

#[derive(Serialize, Default, Debug)]
pub struct 撤销条目 {
    /// 写回 / 删副本目录 / 搬回原件 / 删掉产物
    pub 做什么: String,
    pub 从: String,
    pub 到: String,
    pub 备注: String,
}

#[derive(Serialize, Default, Debug)]
pub struct 撤销结果 {
    pub 干跑: bool,
    pub 时间: u64,
    pub 动作: String,
    pub 方式: String,
    pub 人话: String,
    /// 先出的那张表：撤销会做什么
    pub 条目: Vec<撤销条目>,
    /// 预检不过的（**有一条就不许执行**）
    pub 问题: Vec<String>,
    /// 执行后的回读核对
    pub 回读: Vec<String>,
    pub 写回: usize,
    pub 删目录: usize,
    pub 搬回: usize,
}

/// 界面上那行"上一次：…"。没有可撤销的就 `None`。
#[tauri::command]
pub fn 待撤销() -> Result<Option<操作记录>, String> {
    读最近记录()
}

/// 预检 + 出表（不碰盘）
fn 撤销预检(r: &操作记录) -> (Vec<撤销条目>, Vec<String>) {
    let mut 条目 = Vec::new();
    let mut 问题 = Vec::new();

    /* 禁止目录：记录里出现的任何路径都得先过这道闸 */
    let mut 全: Vec<String> = vec![r.pmm.clone(), r.emm.clone()];
    for x in r.改前.iter().chain(r.产物.iter()) {
        全.push(x.路径.clone());
        全.push(x.备份.clone());
    }
    for x in r.目录对.iter() {
        全.push(x.源.clone());
        全.push(x.目标.clone());
    }
    for x in r.原件.iter() {
        全.push(x.原.clone());
        全.push(x.新.clone());
    }
    for p in 全.iter().filter(|p| 是禁止路径(p)) {
        问题.push(format!("记录里有测试/临时目录的路径，一律不动：{p}"));
    }

    /* 改前：备份在不在、还是不是当初那份 */
    for x in r.改前.iter() {
        let 备 = Path::new(&x.备份);
        match fs::read(备) {
            Ok(b) => {
                if b.len() as u64 != x.字节 || 校验64(&b) != x.校验 {
                    问题.push(format!("改前副本跟记录对不上（可能被改过）：{}", x.备份));
                } else {
                    条目.push(撤销条目 {
                        做什么: "写回工程文件".into(),
                        从: x.备份.clone(),
                        到: x.路径.clone(),
                        备注: format!("{} 字节，校验 OK", x.字节),
                    });
                }
            }
            Err(_) => 问题.push(format!("改前副本不在了：{}", x.备份)),
        }
    }

    /* 产物（另存/自包含写出来的工程文件）：不在就当已经删过 */
    for x in r.产物.iter() {
        if Path::new(&x.路径).is_file() {
            条目.push(撤销条目 {
                做什么: "删掉产物".into(),
                从: x.路径.clone(),
                到: String::new(),
                备注: format!("{} 字节", x.字节),
            });
        } else {
            条目.push(撤销条目 {
                做什么: "删掉产物".into(),
                从: x.路径.clone(),
                到: String::new(),
                备注: "已经不在了，跳过".into(),
            });
        }
    }

    /* 「搬」模式删掉的原件：新位置那份必须还在、还得是当初那份 */
    for x in r.原件.iter() {
        match fs::read(&x.新) {
            Ok(b) => {
                if b.len() as u64 != x.字节 || 校验64(&b) != x.校验 {
                    问题.push(format!("要搬回的那份跟记录对不上（可能被改过）：{}", x.新));
                    continue;
                }
                if Path::new(&x.原).is_file() && !字节同(Path::new(&x.原), Path::new(&x.新)) {
                    问题.push(format!("它原来的位置已经有同名但内容不同的文件，不覆盖：{}", x.原));
                    continue;
                }
                条目.push(撤销条目 {
                    做什么: "搬回原件".into(),
                    从: x.新.clone(),
                    到: x.原.clone(),
                    备注: format!("{} 字节，逐字节比对过", x.字节),
                });
            }
            Err(_) => {
                条目.push(撤销条目 {
                    做什么: "搬回原件".into(),
                    从: x.新.clone(),
                    到: x.原.clone(),
                    备注: "那份已经不在了，跳过".into(),
                });
            }
        }
    }

    /* 这次拷出来的目录：目标是"我们造的新空目录"才考虑删；本来就在的说清楚不动 */
    for x in r.目录对.iter() {
        if x.目标本来就在 {
            continue; /* 不是我们造的，撤的时候一个都不碰 */
        }
        条目.push(撤销条目 {
            做什么: "删副本目录".into(),
            从: x.目标.clone(),
            到: String::new(),
            备注: "只在里面全是原处的副本时才删".into(),
        });
    }
    (条目, 问题)
}

/// 真正动手：**先搬回原件 → 再写回工程文件 → 再删产物 → 最后删副本目录**
/// （这个顺序保证任何中间态都不会出现"工程指向不存在的文件"）
fn 撤销执行(r: &操作记录) -> Result<(usize, usize, usize, Vec<String>), String> {
    let mut 记 = Vec::new();
    let mut 写回 = 0usize;
    let mut 删目录 = 0usize;
    let mut 搬回 = 0usize;

    /* ① 原件搬回原位 */
    for x in r.原件.iter() {
        let (新, 原) = (Path::new(&x.新), Path::new(&x.原));
        if !新.is_file() {
            continue;
        }
        if 原.is_file() {
            if 字节同(原, 新) {
                删文件收空目录(新);
                记.push(format!("原件已经在原位（内容一样），删掉新位置那份：{}", x.新));
                continue;
            }
            return Err(format!("它原来的位置有同名但内容不同的文件，拒绝覆盖：{}", x.原));
        }
        if let Some(d) = 原.parent() {
            fs::create_dir_all(d).map_err(|e| format!("建不了目录 {}：{e}", d.display()))?;
        }
        fs::copy(新, 原).map_err(|e| format!("搬不回 {}：{e}", x.原))?;
        if !字节同(原, 新) {
            return Err(format!("搬回之后内容跟原来那份不一样，停手（原位置:{}）", x.原));
        }
        fs::remove_file(新).map_err(|e| format!("删不掉 {}：{e}", x.新))?;
        搬回 += 1;
        记.push(format!("搬回原件：{} → {}", x.新, x.原));
    }

    /* ② 写回工程文件（改前副本） */
    for x in r.改前.iter() {
        let b = fs::read(&x.备份).map_err(|e| format!("读不了改前副本 {}：{e}", x.备份))?;
        if b.len() as u64 != x.字节 || 校验64(&b) != x.校验 {
            return Err(format!("改前副本跟记录对不上，拒绝写回：{}", x.备份));
        }
        fs::write(&x.路径, &b).map_err(|e| format!("写不回去 {}：{e}", x.路径))?;
        写回 += 1;
        记.push(format!("写回工程文件：{}（从 {}）", x.路径, x.备份));
    }

    /* ③ 删掉这次新写出来的产物文件 */
    for x in r.产物.iter() {
        let p = Path::new(&x.路径);
        if p.is_file() {
            删文件收空目录(p);
            记.push(format!("删掉产物：{}", x.路径));
        }
    }

    /* ④ 删掉这次拷出来的副本目录（**只有逐字节一样才删**） */
    for x in r.目录对.iter() {
        if x.目标本来就在 {
            continue;
        }
        let (源, 目标) = (Path::new(&x.源), Path::new(&x.目标));
        if !目标.exists() {
            记.push(format!("副本目录已经不在了：{}", x.目标));
            continue;
        }
        match 目标都是源的副本(源, 目标) {
            Ok((true, _)) => match fs::remove_dir_all(目标) {
                Ok(_) => {
                    删目录 += 1;
                    记.push(format!("删掉副本目录（里面全是原处的副本）：{}", x.目标));
                }
                Err(e) => 记.push(format!("删不掉副本目录 {}：{e}", x.目标)),
            },
            Ok((false, 因)) => 记.push(format!(
                "副本目录「留着没删」（{}）—— 里面有你后来放/改过的东西：{}",
                因, x.目标
            )),
            Err(e) => 记.push(format!("比对不了 {}：{e}", x.目标)),
        }
    }
    Ok((写回, 删目录, 搬回, 记))
}

/// 撤销之后的回读核对（跟写盘一样：不看打印，看盘）
fn 撤销回读(r: &操作记录) -> (Vec<String>, bool) {
    let mut 话 = Vec::new();
    let mut 过 = true;
    for x in r.改前.iter() {
        match fs::read(&x.路径) {
            Ok(b) => {
                let ok = b.len() as u64 == x.字节 && 校验64(&b) == x.校验;
                过 &= ok;
                话.push(format!(
                    "{}：{} 字节，跟改前{}",
                    x.路径,
                    b.len(),
                    if ok { "一致" } else { "「不一致」" }
                ));
            }
            Err(_) => {
                过 = false;
                话.push(format!("{}：读不回来", x.路径));
            }
        }
    }
    for x in r.产物.iter() {
        if Path::new(&x.路径).exists() {
            过 = false;
            话.push(format!("产物还在：{}", x.路径));
        }
    }
    for x in r.原件.iter() {
        let 原 = Path::new(&x.原);
        if !原.is_file() {
            过 = false;
            话.push(format!("原件没回到位：{}", x.原));
        } else {
            let ok = fs::read(原).map(|b| b.len() as u64 == x.字节 && 校验64(&b) == x.校验).unwrap_or(false);
            过 &= ok;
            话.push(format!("原件 {}：{}", x.原, if ok { "已回位且一致" } else { "「内容对不上」" }));
        }
        if Path::new(&x.新).exists() {
            过 = false;
            话.push(format!("新位置那份还在：{}", x.新));
        }
    }
    (话, 过)
}

/**
 * 撤销上一次处理。
 *
 * `干跑 = true` → **只预检、只出表**，一个字节都不动（界面就是这么先给用户看的）。
 * `干跑 = false` → 预检全过才动手；动完回读核对，核对不过如实报出来。
 * 没有记录 → 返回 `Err("没有可撤销的记录")`，绝不"尽力还原"。
 */
#[tauri::command]
pub fn 撤销工程(干跑: bool) -> Result<撤销结果, String> {
    let Some(r) = 读最近记录()? else {
        return Err("没有可撤销的记录。".into());
    };
    let (条目, 问题) = 撤销预检(&r);
    let mut out = 撤销结果 {
        干跑,
        时间: r.时间,
        动作: r.动作.clone(),
        方式: r.方式.clone(),
        人话: r.人话.clone(),
        条目,
        问题: 问题.clone(),
        ..Default::default()
    };
    if 干跑 {
        return Ok(out);
    }
    if !问题.is_empty() {
        return Err(format!(
            "预检没过（{} 条），一个字都没动：\n{}",
            问题.len(),
            问题.iter().take(8).cloned().collect::<Vec<_>>().join("\n")
        ));
    }
    let (写回, 删目录, 搬回, 记) = 撤销执行(&r)?;
    let (回读, 过) = 撤销回读(&r);
    out.写回 = 写回;
    out.删目录 = 删目录;
    out.搬回 = 搬回;
    out.条目 = 记
        .iter()
        .map(|s| 撤销条目 {
            做什么: s.clone(),
            从: String::new(),
            到: String::new(),
            备注: String::new(),
        })
        .collect();
    out.回读 = 回读;
    /* 标已撤销：再点就是"没有记录" */
    if let Ok(s) = fs::read_to_string(&r.文件) {
        if let Ok(mut m) = serde_json::from_str::<操作记录>(&s) {
            m.已撤销 = true;
            if let Ok(t) = serde_json::to_string_pretty(&m) {
                let _ = fs::write(&r.文件, t);
            }
        }
    }
    if !过 {
        return Err(format!(
            "撤销动作做完了，但「回读核对没过」 —— 请照下面这几条查：\n{}",
            out.回读.join("\n")
        ));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn 临时目录(名: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("robin-⑥-搬根-{名}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn 写(p: &Path, 内容: &str) {
        fs::write(p, 内容.as_bytes()).unwrap();
    }

    /// 让 `\n` 变成 CRLF：`.emm` 实测是 CRLF，换根必须原样保回来
    fn 改分行(s: &str) -> String {
        s.replace('\n', "\r\n")
    }

    /// 造一个真 `.pmm`：条目 = `[u8 名字长][名字][u8 英文名长][英文名][路径 256]`
    fn 造pmm(条目: &[(&str, &str)]) -> Vec<u8> {
        let mut b = b"Polygon Movie maker 0002".to_vec();
        b.resize(0x40, 0);
        for (名, 路径) in 条目 {
            b.push(名.len() as u8);
            b.extend_from_slice(名.as_bytes());
            b.push(0u8);
            let p = 编gbk(路径);
            let mut f = vec![0u8; 256];
            f[..p.len()].copy_from_slice(&p);
            b.extend_from_slice(&f);
        }
        b
    }

    /// 单测用的 `搬根`：**关掉"禁止测试目录"那道闸**（夹具就建在 `%TEMP%` 里，那是合法的）。
    /// 那道闸本身有两条专门的测试盯着（见 `搬根_目标落在测试目录就拒绝`）。
    fn 搬根_夹具(
        pmm: String,
        emm: String,
        根表: Vec<(String, String)>,
        逐条: Vec<(String, String)>,
        输出: String,
        干跑: bool,
    ) -> Result<搬根结果, String> {
        搬根内部带开关(pmm, emm, 根表, 逐条, 输出, 干跑, false, false, false)
    }

    /// 单测用的 `检索`：同上（夹具在 `%TEMP%` 里）
    fn 检索_夹具(
        pmm: String,
        emm: String,
        根表: Vec<(String, String)>,
        逐条: Vec<(String, String)>,
        起点: Vec<String>,
    ) -> Result<Vec<检索行>, String> {
        检索内部(pmm, emm, 根表, 逐条, 起点, false)
    }

    #[test]
    fn 找死根_按段分组_并试出新根() {
        let d = 临时目录("找根");
        /* 盘上真的放两份文件：新根 = 工程目录本身 */
        fs::create_dir_all(d.join("UserFile/a")).unwrap();
        fs::write(d.join("UserFile/a/x.pmx"), b"x").unwrap();
        fs::create_dir_all(d.join("UserFile/b")).unwrap();
        fs::write(d.join("UserFile/b/y.x"), b"y").unwrap();
        let emm = d.join("工程.emm");
        write!(
            fs::File::create(&emm).unwrap(),
            "[Info]\r\nVersion = 3\r\n\r\n[Object]\r\nAcs1 = H:\\UserFile\\b\\y.x\r\nPmd2 = D:\\old\\UserFile\\a\\x.pmx\r\n\r\n[Effect]\r\nPmd2 = H:\\UserFile\\a\\x.pmx\r\n"
        )
        .unwrap();
        let pmm = d.join("工程.pmm");
        fs::write(&pmm, 造pmm(&[("Acs1", "H:\\UserFile\\b\\y.x")])).unwrap();
        let 根 = 找死根(&pmm.to_string_lossy(), &emm.to_string_lossy()).unwrap();
        assert_eq!(根.len(), 2, "应当认出两个旧根：{根:?}");
        let h = 根.iter().find(|g| g.根 == "H:\\UserFile").expect("H:\\UserFile 要在里面");
        assert_eq!(h.条数, 2);
        /* H 根的尾部是 `a\x.pmx` / `b\y.x`，两份都在 `工程目录\UserFile\` 下 → 新根应当是那一层 */
        assert_eq!(h.建议, d.join("UserFile").to_string_lossy(), "建议新根应当是工程目录下的 UserFile");
        assert_eq!(h.建议命中, 2);
        let d根 = 根.iter().find(|g| g.根.starts_with("D:\\")).expect("D 根要在里面");
        assert_eq!(d根.条数, 1);
    }

    #[test]
    fn 换根_所有段都换_等号空格与CRLF原样保留() {
        let d = 临时目录("换根");
        let emm = d.join("工程.emm");
        let 原 = "[Object]\r\nAcs1 = H:\\UserFile\\b\\y.x\r\n\r\n[Effect]\r\nPmd2=H:\\UserFile\\a\\x.pmx\r\nPmd2[3] = H:\\UserFile\\a\\x.pmx\r\n";
        fs::write(&emm, 原).unwrap();
        let 表 = vec![(编gbk("H:\\UserFile"), 编gbk("E:\\new"))];
        let (出, 改) = 换根_emm(&fs::read(&emm).unwrap(), &表);
        let s = String::from_utf8(出.clone()).unwrap();
        assert_eq!(改, 3, "三行都要改（含 [Effect] 与逐材质键）");
        assert!(s.contains("Acs1 = E:\\new\\b\\y.x"), "等号两侧空格要保留：{s:?}");
        assert!(s.contains("Pmd2=E:\\new\\a\\x.pmx"), "原来没空格的就别加：{s:?}");
        assert!(s.contains("Pmd2[3] = E:\\new\\a\\x.pmx"), "逐材质键也要换：{s:?}");
        assert!(!s.contains("H:\\UserFile"), "旧根不许剩");
        /* 除被改的三行外，其余逐行一致（含段名与 CRLF 数）。
           判据按"这一行的值像绝对路径"来剔 —— 两侧都要用同一个判据，
           拿旧路径去剔产物是剔不掉的（我第一次就写错了）。 */
        let 剥 = |t: &str| {
            t.split("\r\n")
                .filter(|l| !l.contains(":\\"))
                .collect::<Vec<_>>()
                .join("\r\n")
        };
        assert_eq!(剥(&s), 剥(原), "别的行必须一字不差");
        assert_eq!(出.iter().filter(|b| **b == b'\n').count(), 原.matches('\n').count());
    }

    #[test]
    fn 搬根_写盘_回读核对_长度与内容() {
        let d = 临时目录("搬根");
        let 新根 = d.join("新家");
        fs::create_dir_all(新根.join("UserFile/a")).unwrap();
        fs::write(新根.join("UserFile/a/x.pmx"), b"x").unwrap();
        let 名 = "工程";
        let pmm = d.join(format!("{名}.pmm"));
        let emm = d.join(format!("{名}.emm"));
        fs::write(&pmm, 造pmm(&[("Pmd2", "D:\\old\\UserFile\\a\\x.pmx")])).unwrap();
        write!(
            fs::File::create(&emm).unwrap(),
            "[Object]\r\nPmd2 = D:\\old\\UserFile\\a\\x.pmx\r\n\r\n[Effect]\r\nPmd2 = D:\\old\\UserFile\\a\\x.pmx\r\n"
        )
        .unwrap();
        let 出 = d.join("出");
        let r = 搬根_夹具(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![("D:\\old".into(), 新根.to_string_lossy().to_string())],
            vec![],
            出.to_string_lossy().to_string(),
            false,
        )
        .expect("应当能写盘");
        assert_eq!(r.pmm长度, r.原先pmm长度, ".pmm 长度不许变");
        assert_eq!(r.旧根残留.iter().map(|(_, n)| *n).sum::<usize>(), 0, "旧根必须归零");
        assert!(r.新根出现.iter().all(|(_, n)| *n > 0), "新根必须出现");
        assert_eq!(r.emm改行, 2, "[Object] 与 [Effect] 两行都要改");
        let 盘 = fs::read(出.join(format!("{名}.emm"))).unwrap();
        let s = 编解(&盘);
        assert!(s.contains("Pmd2 = "));
        assert!(s.contains("UserFile\\a\\x.pmx"), "尾部要原样保留（相对结构不变）：{s:?}");
        assert_eq!(盘.len(), r.emm长度);
    }

    fn 编解(b: &[u8]) -> String {
        解gbk(b)
    }

    #[test]
    fn 写辅助_不改内容() {
        let d = 临时目录("写辅助");
        let p = d.join("a.txt");
        写(&p, "abc");
        assert_eq!(fs::read_to_string(&p).unwrap(), "abc");
    }

    #[test]
    fn 搬根_有一条换完不在盘上就整体拒绝() {
        let d = 临时目录("拒绝");
        let pmm = d.join("工程.pmm");
        let emm = d.join("工程.emm");
        fs::write(&pmm, 造pmm(&[("Pmd2", "D:\\old\\UserFile\\a\\不存在.pmx")])).unwrap();
        write!(
            fs::File::create(&emm).unwrap(),
            "[Object]\r\nPmd2 = D:\\old\\UserFile\\a\\不存在.pmx\r\n"
        )
        .unwrap();
        let 出 = d.join("出");
        let e = 搬根(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![("D:\\old".into(), d.to_string_lossy().to_string())],
            vec![],
            出.to_string_lossy().to_string(),
            false,
        )
        .expect_err("换完不在盘上就该拒绝");
        assert!(e.contains("拒绝写盘"), "提示要说清是拒绝：{e}");
        assert!(!出.exists(), "拒绝时不许写出目录");
    }

    #[test]
    fn 逐条覆盖压过根规则() {
        /* 一条在根下面、但被逐条指定到别处 —— 必须听逐条的（硬要求：用户改过的不许被根规则改回去） */
        let 规则 = 合规则(
            &[("H:\\UserFile".into(), "E:\\新根".into())],
            &[(
                "H:\\UserFile\\a\\x.pmx".into(),
                "F:\\别处\\x.pmx".into(),
            )],
        );
        let (目标, 状态) = 定目标("H:\\UserFile\\a\\x.pmx", &规则);
        assert_eq!(目标, "F:\\别处\\x.pmx", "逐条指定必须压过根规则");
        assert_eq!(状态, "已逐条指定");
        /* 同根下的其它路径仍走根规则 */
        let (目标2, 状态2) = 定目标("H:\\UserFile\\b\\y.x", &规则);
        assert_eq!(目标2, "E:\\新根\\b\\y.x");
        assert_eq!(状态2, "已按根找到");
    }

    #[test]
    fn 定目标_原位在_与需要指定() {
        let d = 临时目录("状态");
        let f = d.join("在.png");
        fs::write(&f, b"x").unwrap();
        let (目标, 状态) = 定目标(&f.to_string_lossy(), &[]);
        assert_eq!(状态, "原位在");
        assert_eq!(目标, f.to_string_lossy());
        let (目标2, 状态2) = 定目标("Z:\\没有\\的东西.png", &[]);
        assert_eq!(状态2, "需要指定");
        assert!(目标2.is_empty());
    }

    #[test]
    fn 列路径_逐条列出每一处并算状态() {
        let d = 临时目录("列路径");
        fs::create_dir_all(d.join("UserFile/a")).unwrap();
        fs::write(d.join("UserFile/a/x.pmx"), b"x").unwrap();
        let emm = d.join("工程.emm");
        write!(
            fs::File::create(&emm).unwrap(),
            "[Object]\r\nPmd2 = D:\\old\\UserFile\\a\\x.pmx\r\n\r\n[Effect]\r\nPmd2 = H:\\dead\\f.fx\r\n"
        )
        .unwrap();
        let pmm = d.join("工程.pmm");
        fs::write(&pmm, 造pmm(&[("Pmd2", "D:\\old\\UserFile\\a\\x.pmx")])).unwrap();
        let 行 = 列路径(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![("D:\\old".into(), d.to_string_lossy().to_string())],
            vec![],
        )
        .unwrap();
        assert_eq!(行.len(), 2, "两处绝对路径各一行：{行:?}");
        let 对象行 = 行.iter().find(|r| r.段 == "Object").unwrap();
        assert_eq!(对象行.状态, "已按根找到");
        assert_eq!(对象行.目标, d.join("UserFile\\a\\x.pmx").to_string_lossy());
        let 特效行 = 行.iter().find(|r| r.段 == "Effect").unwrap();
        assert_eq!(特效行.状态, "需要指定", "没有根规则、本机也没有 → 需要指定");
        assert!(特效行.目标.is_empty());
        /* 每个对象路径都要有行（`.emm` 里 `[Object]` 段那份已经算过，不许重复成两行） */
        assert_eq!(行.iter().filter(|r| r.原路径.contains("x.pmx")).count(), 1);
    }

    #[test]
    fn 搬根_有没落定的就拒绝() {
        let d = 临时目录("没落定");
        let pmm = d.join("工程.pmm");
        let emm = d.join("工程.emm");
        fs::write(&pmm, 造pmm(&[("Pmd2", "D:\\old\\a.pmx")])).unwrap();
        write!(
            fs::File::create(&emm).unwrap(),
            "[Object]\r\nPmd2 = D:\\old\\a.pmx\r\n\r\n[Effect]\r\nPmd2 = H:\\dead\\f.fx\r\n"
        )
        .unwrap();
        let 出 = d.join("出");
        let e = 搬根(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![("D:\\old".into(), d.to_string_lossy().to_string())],
            vec![],
            出.to_string_lossy().to_string(),
            false,
        )
        .expect_err("有一条没落定就该拒绝");
        assert!(e.contains("没落定"), "提示要说清没落定：{e}");
        assert!(!出.exists(), "拒绝时不许写出目录");
    }

    #[test]
    fn 搬根_逐条指定到别处的文件() {
        let d = 临时目录("逐条");
        let 新根 = d.join("新根");
        let 别处 = d.join("别处");
        fs::create_dir_all(新根.join("UserFile/a")).unwrap();
        fs::create_dir_all(&别处).unwrap();
        fs::write(新根.join("UserFile/a/x.pmx"), b"x").unwrap();
        fs::write(新根.join("UserFile/a/y.pmx"), b"y").unwrap();
        fs::write(别处.join("y挪走了.pmx"), b"y").unwrap();
        let pmm = d.join("工程.pmm");
        let emm = d.join("工程.emm");
        fs::write(
            &pmm,
            造pmm(&[("Pmd2", "D:\\old\\UserFile\\a\\x.pmx"), ("Pmd3", "D:\\old\\UserFile\\a\\y.pmx")]),
        )
        .unwrap();
        write!(
            fs::File::create(&emm).unwrap(),
            "[Object]\r\nPmd2 = D:\\old\\UserFile\\a\\x.pmx\r\nPmd3 = D:\\old\\UserFile\\a\\y.pmx\r\n"
        )
        .unwrap();
        let 出 = d.join("出");
        let r = 搬根_夹具(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![("D:\\old".into(), 新根.to_string_lossy().to_string())],
            vec![(
                "D:\\old\\UserFile\\a\\y.pmx".into(),
                别处.join("y挪走了.pmx").to_string_lossy().to_string(),
            )],
            出.to_string_lossy().to_string(),
            false,
        )
        .expect("逐条指定 + 根规则应当能写盘");
        assert_eq!(r.旧根残留.iter().map(|(_, n)| *n).sum::<usize>(), 0, "旧根必须归零");
        let 文本 = 解gbk(&fs::read(出.join("工程.emm")).unwrap());
        assert!(文本.contains(&别处.join("y挪走了.pmx").to_string_lossy().to_string()), "被挪走的那条要指向新位置：{文本:?}");
        assert!(文本.contains(&新根.join("UserFile\\a\\x.pmx").to_string_lossy().to_string()), "没挪的走根规则：{文本:?}");
        assert!(!文本.contains("D:\\old"), "旧根不许剩");
    }

    #[test]
    fn 搬根_没给根表就说清楚() {
        let d = 临时目录("空表");
        let pmm = d.join("工程.pmm");
        let emm = d.join("工程.emm");
        fs::write(&pmm, 造pmm(&[("Pmd2", "D:\\old\\a.pmx")])).unwrap();
        fs::write(&emm, 改分行("[Object]\nPmd2 = D:\\old\\a.pmx\n")).unwrap();
        let e = 搬根(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![("".into(), "".into())],
            vec![],
            String::new(),
            true,
        )
        .expect_err("空根表要报错");
        assert!(e.contains("找根"), "提示要指路：{e}");
    }

    /* ---------------- A1/A2：起点选到盘根 / 文件散在多个目录与多个起点 ---------------- */

    /// **A1 实证**：搜索起点选到盘根 → 立刻拒绝，不卡死，耗时打出来。
    #[test]
    fn 检索_起点选到盘根_立刻拒绝不卡死() {
        let (d, pmm, emm) = 检索夹具("检索盘根", "[Object]\nPmd1 = D:\\旧根\\UserFile\\x.pmx\n");
        let 盘根 = std::env::temp_dir()
            .ancestors()
            .find(|p| p.has_root() && p.parent().is_none())
            .map(|p| p.to_path_buf())
            .expect("找不到盘根");
        let 起 = std::time::Instant::now();
        let e = 检索_夹具(
            pmm,
            emm,
            vec![],
            vec![],
            vec![盘根.to_string_lossy().to_string()],
        )
        .expect_err("选到盘根必须拒绝");
        let 耗时 = 起.elapsed().as_millis();
        println!("  【A1】检索起点 = {} → 拒绝耗时 {耗时} ms：{e}", 盘根.display());
        assert!(e.contains("范围太大，请给更具体的起点"), "要说清是范围太大：{e}");
        assert!(e.contains("起点："), "要指出是哪个起点：{e}");
        assert!(耗时 < 200, "盘根要给立刻反应（实测 {耗时} ms）");
        fs::remove_dir_all(&d).ok();
    }

    /// **A2 实证**：文件**散在多个不相干目录**（这里用两个各自独立的起点模拟"散到不同地方"）
    /// —— 一次检索要把两边都收回来。
    #[test]
    fn 检索_散在多个目录的文件要一次收敛() {
        let (d, pmm, emm) = 检索夹具(
            "检索散开",
            "[Object]\n\
             Pmd1 = D:\\旧根\\模型甲\\a.pmx\n\
             Pmd2 = D:\\旧根\\模型乙\\b.pmx\n\
             Acs1 = D:\\旧根\\附件丙\\c.x\n",
        );
        /* 三个文件落在三个互不相干的目录里，分别当起点 */
        let 起点1 = d.join("散A\\深一层\\模型甲");
        let 起点2 = d.join("散B");
        let 起点3 = d.join("散C\\更深\\再深");
        for p in [&起点1, &起点2, &起点3] {
            fs::create_dir_all(p).unwrap();
        }
        fs::write(起点1.join("a.pmx"), b"a").unwrap();
        fs::write(起点2.join("b.pmx"), b"b").unwrap();
        fs::write(起点3.join("c.x"), b"c").unwrap();

        let 表 = 检索_夹具(
            pmm,
            emm,
            vec![],
            vec![],
            vec![
                起点1.to_string_lossy().to_string(),
                起点2.to_string_lossy().to_string(),
                起点3.to_string_lossy().to_string(),
            ],
        )
        .unwrap();
        println!("  【A2】三个起点（三个不相干目录）→ 检索出 {} 条", 表.len());
        assert_eq!(表.len(), 3, "三条都要进表：{表:?}");
        assert!(
            表.iter().all(|r| r.状态 == "已唯一找到" && !r.建议.is_empty()),
            "三条各自只有一个候选，应当都唯一找到：{表:?}"
        );
        let 建议: Vec<String> = 表.iter().map(|r| r.建议.clone()).collect();
        assert!(建议.iter().any(|p| p.ends_with("a.pmx")));
        assert!(建议.iter().any(|p| p.ends_with("b.pmx")));
        assert!(建议.iter().any(|p| p.ends_with("c.x")));
        fs::remove_dir_all(&d).ok();
    }

    /// 起点太深/太大时也要按上限停下（时间 0 毫秒那条线，走的就是检索这条路）
    #[test]
    fn 检索_起点太宽就报范围太大() {
        let (d, pmm, emm) = 检索夹具("检索太宽", "[Object]\nPmd1 = D:\\旧根\\x.pmx\n");
        let 起点 = d.join("宽");
        /* 造到超过 `检索扫描上限.条目`（12 万）不现实，改**造深**：超过 12 层就够 */
        let mut p = 起点.clone();
        for i in 0..14 {
            p = p.join(format!("l{i}"));
        }
        fs::create_dir_all(&p).unwrap();
        fs::write(p.join("x.pmx"), b"x").unwrap();
        let e = 检索_夹具(
            pmm,
            emm,
            vec![],
            vec![],
            vec![起点.to_string_lossy().to_string()],
        )
        .expect_err("超过层数上限就要拒");
        println!("  【A1】检索起点 14 层深 → {e}");
        assert!(e.contains("范围太大，请给更具体的起点"), "{e}");
        assert!(e.contains("层数"), "要说清是哪条线：{e}");
        fs::remove_dir_all(&d).ok();
    }

    /* ---------------- 检索（用户"让其检索移动后的文件的位置"那条） ---------------- */

    /// 造一份只有 `.emm` 的工程（`列路径` 只吃 `.emm`，`.pmm` 给个空壳就够）
    fn 检索夹具(名: &str, emm内容: &str) -> (PathBuf, String, String) {
        let d = 临时目录(名);
        let emm = d.join("工程.emm");
        fs::write(&emm, 编gbk(&改分行(emm内容))).unwrap();
        let pmm = d.join("工程.pmm");
        fs::write(&pmm, 造pmm(&[])).unwrap();
        (
            d,
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
        )
    }

    #[test]
    fn 检索_同名多份时按尾部对上是哪一份() {
        let (d, pmm, emm) = 检索夹具(
            "检索唯一",
            "[Object]\n\
             Pmd1 = D:\\旧根\\UserFile\\ray-mmd-1.5.2\\Lighting\\PointLightIES.pmx\n\
             Pmd2 = D:\\旧根\\UserFile\\ikBokeh_v019\\ikBokehController.pmx\n\
             Acs1 = H:\\UserFile\\根本没这个.pmx\n",
        );
        let 起点 = d.join("起点");
        /* 挪走的文件（用户那套工程的形状）：同名两份散在不同目录 */
        fs::create_dir_all(起点.join("12\\ray-mmd-1.5.2\\Lighting")).unwrap();
        fs::write(起点.join("12\\ray-mmd-1.5.2\\Lighting\\PointLightIES.pmx"), b"a").unwrap();
        fs::create_dir_all(起点.join("12\\ray-mmd-1.5.2\\Fog")).unwrap();
        fs::write(起点.join("12\\ray-mmd-1.5.2\\Fog\\PointLightIES.pmx"), b"b").unwrap();
        fs::create_dir_all(起点.join("24\\ikBokeh_v019")).unwrap();
        fs::write(起点.join("24\\ikBokeh_v019\\ikBokehController.pmx"), b"c").unwrap();

        let 表 = 检索_夹具(
            pmm,
            emm,
            vec![],
            vec![],
            vec![起点.to_string_lossy().to_string()],
        )
        .unwrap();
        assert_eq!(表.len(), 3, "三条都没落定，都该进表：{表:?}");

        let r1 = 表.iter().find(|r| r.文件名 == "PointLightIES.pmx").unwrap();
        assert_eq!(r1.状态, "已唯一找到", "尾部能对上 Lighting 那一份：{r1:?}");
        assert!(
            r1.建议.to_lowercase().ends_with("lighting\\pointlighties.pmx"),
            "要挑 Lighting 那份，实得 {}",
            r1.建议
        );
        assert_eq!(r1.候选.len(), 2, "两份同名候选都要列出来：{:?}", r1.候选);

        let r2 = 表.iter().find(|r| r.文件名 == "ikBokehController.pmx").unwrap();
        assert!(r2.建议.to_lowercase().contains("ikbokeh_v019"), "{}", r2.建议);

        let r3 = 表.iter().find(|r| r.文件名 == "根本没这个.pmx").unwrap();
        assert_eq!(r3.状态, "没找到");
        assert!(r3.建议.is_empty(), "没找到就不给建议");
        assert!(r3.备注.contains("没找到") || r3.备注.contains("没有叫"), "{}", r3.备注);
    }

    #[test]
    fn 检索_尾部一样长就交给人挑_不许猜() {
        let (d, pmm, emm) = 检索夹具("检索并列", "[Object]\nPmd1 = D:\\别处\\同名.pmx\n");
        let 起点 = d.join("起点");
        fs::create_dir_all(起点.join("A")).unwrap();
        fs::write(起点.join("A\\同名.pmx"), b"a").unwrap();
        fs::create_dir_all(起点.join("B")).unwrap();
        fs::write(起点.join("B\\同名.pmx"), b"b").unwrap();

        let 表 = 检索_夹具(pmm, emm, vec![], vec![], vec![起点.to_string_lossy().to_string()]).unwrap();
        assert_eq!(表.len(), 1);
        assert_eq!(表[0].状态, "多个候选", "并列不许猜：{表:?}");
        assert!(表[0].建议.is_empty(), "并列时建议必须留空");
        assert_eq!(表[0].候选.len(), 2);
    }

    #[test]
    fn 检索_已经落定的不进表() {
        let (d, pmm, emm) = 检索夹具(
            "检索落定",
            "[Object]\nPmd1 = D:\\旧根\\UserFile\\a\\x.pmx\nPmd2 = D:\\旧根\\UserFile\\b\\y.pmx\n",
        );
        let 新根 = d.join("新家");
        fs::create_dir_all(新根.join("UserFile\\a")).unwrap();
        fs::write(新根.join("UserFile\\a\\x.pmx"), b"x").unwrap();
        /* y.pmx 没放到新家 → 它没落定，要进表 */
        let 表 = 检索_夹具(
            pmm,
            emm,
            vec![("D:\\旧根".into(), 新根.to_string_lossy().to_string())],
            vec![],
            vec![],
        )
        .unwrap();
        assert_eq!(表.len(), 1, "只有没落定的那条该进表：{表:?}");
        assert!(表[0].文件名 == "y.pmx", "{:?}", 表[0]);
        assert_eq!(表[0].状态, "没找到", "没给搜索起点 → 没找到");
    }

    #[test]
    fn 找死根_部分搬走也给部分规则_不再拆碎() {
        /* 用户情形②的形状：一个根下面一部分搬走了、一部分还在原地。
           以前"全解开才收"会把它拆成一堆 0 命中的碎根，连能解开的那部分也丢规则。 */
        let d = 临时目录("找根部分");
        fs::create_dir_all(d.join("UserFile/stay")).unwrap();
        fs::write(d.join("UserFile/stay/x.pmx"), b"x").unwrap();
        fs::create_dir_all(d.join("UserFile/moved")).unwrap();
        let emm = d.join("工程.emm");
        /* 路径段一律用 ASCII：`.emm` 是按 GBK 读的，中文段会读成乱码、测不出东西 */
        write!(
            fs::File::create(&emm).unwrap(),
            "[Object]\r\nPmd1 = H:\\UserFile\\stay\\x.pmx\r\nPmd2 = H:\\UserFile\\moved\\y.pmx\r\n\r\n[Effect]\r\nPmd3 = H:\\UserFile\\moved\\z.fx\r\n"
        )
        .unwrap();
        let pmm = d.join("工程.pmm");
        fs::write(&pmm, 造pmm(&[("Pmd1", "H:\\UserFile\\stay\\x.pmx")])).unwrap();
        let 根 = 找死根(&pmm.to_string_lossy(), &emm.to_string_lossy()).unwrap();
        assert_eq!(根.len(), 1, "有命中的时候不许拆碎：{根:?}");
        let g = &根[0];
        assert_eq!(g.根, "H:\\UserFile");
        assert_eq!(g.条数, 3);
        assert_eq!(g.建议命中, 1, "只有没搬走的那条能解开");
        assert_eq!(g.建议, d.join("UserFile").to_string_lossy(), "建议仍然指向原地");
    }

    /**
     * 用户要求"两者支持对应工程内 **VMD** 一起成功载入"。
     *
     * 实测结论（先量后写）：`.pmm` / `.emm` 里**根本没有 VMD 路径** ——
     * 扫过 363 个 `.pmm`/`.emm`（`D:\9.26mmd` + 用户那套香港工程）含 `.vmd` 引用的 **0 个**；
     * 香港夜间那份 `.pmm` 里有 41 处 `.pmx` 引用、0 处 `.vmd`，而帧区里有 114 处
     * VMD 那套插值花样 `14 14 6B 6B` → **动作数据是嵌在工程里的**，不是按路径外挂的。
     *
     * 所以"VMD 一起载入"的达成条件就是：**换路径时一个字节都不许碰到帧区**。
     * 这条测试把它钉死：造一份带"假帧区"的工程，改完之后帧区那段必须原样。
     */
    #[test]
    fn 换根不碰帧区_vmd动作嵌在工程里() {
        let d = 临时目录("帧区");
        let 新根 = d.join("新家");
        fs::create_dir_all(新根.join("UserFile")).unwrap();
        fs::write(新根.join("UserFile/x.pmx"), b"x").unwrap();

        /* 造一个"模型条目 + 帧区"的 .pmm：帧区里塞 VMD 那套插值花样与关键帧数据 */
        let mut b = b"Polygon Movie maker 0002".to_vec();
        b.resize(0x40, 0);
        b.push(3u8);
        b.extend_from_slice(b"Pmd");
        b.push(0u8);
        let p = 编gbk("D:\\旧根\\UserFile\\x.pmx");
        let mut f = vec![0u8; 256];
        f[..p.len()].copy_from_slice(&p);
        b.extend_from_slice(&f);
        let 帧区起 = b.len();
        let mut 帧区: Vec<u8> = Vec::new();
        for i in 0..8u8 {
            帧区.extend_from_slice(&[0x14, 0x14, 0x6B, 0x6B]); /* 线性插值花样 */
            帧区.extend_from_slice(&[i, 0, 0, 0, 0, 0, 0, 0]);
        }
        帧区.extend_from_slice(&[0xF9, 0x7F, 0x00, 0x00]); /* MMD 写盘留下的未初始化内存 */
        b.extend_from_slice(&帧区);

        let pmm = d.join("工程.pmm");
        let emm = d.join("工程.emm");
        fs::write(&pmm, &b).unwrap();
        fs::write(&emm, 编gbk(&改分行("[Object]\nPmd2 = D:\\旧根\\UserFile\\x.pmx\n"))).unwrap();

        let r = 搬根_夹具(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![("D:\\旧根".into(), 新根.to_string_lossy().to_string())],
            vec![],
            String::new(),
            false,
        )
        .expect("应当能写盘");

        let 后 = fs::read(&pmm).unwrap();
        assert_eq!(后.len(), b.len(), "换路径不许改长度（{} 处字段）", r.pmm改字段);
        assert_eq!(&后[帧区起..], 帧区.as_slice(), "帧区（VMD 动作）必须一个字节都不动");
        assert_eq!(后.windows(4).filter(|w| *w == [0x14, 0x14, 0x6B, 0x6B]).count(), 8, "插值花样不许变");
        assert!(数出现(&后, &编gbk("D:\\旧根")) == 0, "旧根要归零");
        assert!(数出现(&后, &编gbk(&新根.to_string_lossy())) > 0, "新根要出现");
    }

    /**
     * §四 遗留第 1 条："干跑没验路径能不能改"。
     *
     * 现在的行为：**试算也验**（改写是在内存里先做一遍，`改字段` 塞不进 256 字节就整体拒绝），
     * 而且**真跑也照样拒**。这条钉的就是它 —— 夹具造一条"盘上确实存在、但 GBK 字节超过 255"的深目录
     * （目录名全用汉字，GBK 一个汉字 2 字节，字符数仍不超 Windows 的 260）。
     */
    #[test]
    fn 干跑与真跑都拒_新路径塞不进256字节字段() {
        let d = 临时目录("干跑验路径");
        let mut 深 = d.clone();
        /* 5 层 × 20 汉字 = 200 汉字 = 400 GBK 字节（字符数才 100，Windows 的 260 挡不住） */
        for _ in 0..5 {
            深 = 深.join("一二三四五六七八九十一二三四五六七八九十");
        }
        fs::create_dir_all(深.join("模型")).unwrap();
        fs::write(深.join("模型/x.pmx"), b"abc").unwrap();
        assert!(深.join("模型/x.pmx").is_file(), "夹具本身要在盘上");
        assert!(
            编gbk(&format!(r"{}\模型\x.pmx", 深.display())).len() + 1 > 256,
            "夹具的新路径必须真的超过 255 GBK 字节，不然这条量具没验到东西"
        );

        let pmm = d.join("工程.pmm");
        let emm = d.join("工程.emm");
        let 原路径 = r"D:\旧根\模型\x.pmx";
        fs::write(&pmm, 造pmm(&[("Pmd1", 原路径)])).unwrap();
        fs::write(&emm, 编gbk(&改分行(&format!("[Object]\nPmd1 = {原路径}\n")))).unwrap();
        let 前pmm = fs::read(&pmm).unwrap();
        let 前emm = fs::read(&emm).unwrap();

        for 干跑 in [true, false] {
            let e = 搬根_夹具(
                pmm.to_string_lossy().to_string(),
                emm.to_string_lossy().to_string(),
                vec![("D:\\旧根".into(), 深.to_string_lossy().to_string())],
                vec![],
                String::new(),
                干跑,
            )
            .unwrap_err();
            assert!(
                e.contains("写不进") && e.contains("256"),
                "干跑={干跑} 要拒得明白（说的是字段塞不下）：{e}"
            );
        }
        assert_eq!(fs::read(&pmm).unwrap(), 前pmm, "拒了就不许动 .pmm");
        assert_eq!(fs::read(&emm).unwrap(), 前emm, "拒了就不许动 .emm");
        assert!(!pmm.with_extension("pmm.bak").exists(), "连 .bak 都不该出现");
    }

    /**
     * 用户实测抓到的那个错：产物里**主体模型**被指到了我自己的测试副本里
     * （`…\测试效果\⑥香港验收\情形2\UserFile\…`）。这道闸就是为它加的：
     * 只要有一条目标落在"测试/临时目录"，**整体拒绝写盘**。
     */
    #[test]
    fn 搬根_目标落在测试目录就拒绝() {
        let d = 临时目录("禁止闸");
        let 测试出 = d.join("测试效果");
        fs::create_dir_all(测试出.join("UserFile")).unwrap();
        fs::write(测试出.join("UserFile/x.pmx"), b"x").unwrap();
        let pmm = d.join("工程.pmm");
        let emm = d.join("工程.emm");
        fs::write(&pmm, 造pmm(&[("Pmd2", "D:\\旧根\\UserFile\\x.pmx")])).unwrap();
        fs::write(&emm, 编gbk(&改分行("[Object]\nPmd2 = D:\\旧根\\UserFile\\x.pmx\n"))).unwrap();
        /* 目标确实在盘上（`测试效果\UserFile\x.pmx` 存在）→ 只可能被"禁止路径"那道闸拦下 */
        let e = 搬根内部带开关(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![("D:\\旧根".into(), 测试出.to_string_lossy().to_string())],
            vec![],
            String::new(),
            false,
            false,
            true,
            false,
        )
        .expect_err("目标落在测试目录里必须拒绝");
        assert!(e.contains("测试") && e.contains("临时"), "提示要说清为什么：{e}");
        /* 原件不许被动过 */
        assert!(数出现(&fs::read(&emm).unwrap(), &编gbk("D:\\旧根")) > 0, "拒绝时不许改文件");
    }

    /**
     * 检索的保守规则：**在测试/临时目录里找到的不许自动采用**。
     *
     * 用户踩过一次：我把测试副本当搜索起点给检索用过，主体模型就被悄悄指到副本里了。
     * 现在这种命中只列出来、状态是"待确认"，`建议` 一定为空。
     */
    #[test]
    fn 检索_测试目录里的候选只列待确认() {
        let (d, pmm, emm) = 检索夹具("检索禁止", "[Object]\nPmd1 = D:\\旧根\\UserFile\\x.pmx\n");
        let 测试起点 = d.join("测试效果");
        fs::create_dir_all(测试起点.join("某副本")).unwrap();
        fs::write(测试起点.join("某副本\\x.pmx"), b"x").unwrap();

        let 表 = 检索内部(
            pmm,
            emm,
            vec![],
            vec![],
            vec![测试起点.to_string_lossy().to_string()],
            true,
        )
        .unwrap();
        assert_eq!(表.len(), 1);
        assert_eq!(表[0].状态, "待确认（在测试/临时目录里）", "{:?}", 表[0]);
        assert!(表[0].建议.is_empty(), "测试目录里的命中绝不许自动采用");
        assert_eq!(表[0].候选.len(), 1, "候选仍然要列出来给人看");
        assert!(表[0].备注.contains("测试"), "备注要说清来源：{}", 表[0].备注);
    }

    /**
     * 用户要的那条：**看一眼要动哪些文件后，可以把文件迁移到指定位置（一个或多个）再保存**。
     *
     * 这里验"多目标 + 拷贝模式"这条主路（默认拷、保留原件）。
     */
    #[test]
    fn 搬运_多个目标位置_拷模式_原件还在() {
        let d = 临时目录("搬运多目标");
        /* 源：两个"旧根"下的文件（还带一个邻居贴图，看整目录拷有没有把邻居带上） */
        let 源A = d.join("旧A/UserFile/模型");
        fs::create_dir_all(&源A).unwrap();
        fs::write(源A.join("x.pmx"), b"pmx").unwrap();
        fs::write(源A.join("x_tex.png"), b"tex").unwrap();
        let 源B = d.join("旧B/UserFile/特效");
        fs::create_dir_all(&源B).unwrap();
        fs::write(源B.join("y.fx"), b"fx").unwrap();
        /* 目标：两个不同的地方 */
        let 到A = d.join("新处/模型");
        let 到B = d.join("新处2/特效");

        let 旧A = d.join("旧A");
        let 旧B = d.join("旧B");
        let emm = d.join("工程.emm");
        fs::write(
            &emm,
            编gbk(&改分行(&format!(
                "[Object]\nPmd1 = {}\\UserFile\\模型\\x.pmx\n\n[Effect]\nPmd2 = {}\\UserFile\\特效\\y.fx\n",
                旧A.display(),
                旧B.display()
            ))),
        )
        .unwrap();
        let pmm = d.join("工程.pmm");
        fs::write(&pmm, 造pmm(&[("Pmd1", &format!("{}\\UserFile\\模型\\x.pmx", 旧A.display()))])).unwrap();

        let r = 搬运内部(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![
                (旧A.to_string_lossy().to_string(), 到A.to_string_lossy().to_string()),
                (旧B.to_string_lossy().to_string(), 到B.to_string_lossy().to_string()),
            ],
            vec![],
            "拷".into(),
            false,
            false,
            false,
        )
        .expect("多目标拷贝应当成功");

        println!(
            "  拷贝 {} 个文件 / {} 字节；改字段 {} 处 / 改行 {} 行",
            r.拷贝文件, r.拷贝字节, r.根结果.pmm改字段, r.根结果.emm改行
        );
        assert!(到A.join("UserFile/模型/x.pmx").is_file(), "模型要拷到 A");
        assert!(到A.join("UserFile/模型/x_tex.png").is_file(), "邻居贴图要一起带上");
        assert!(到B.join("UserFile/特效/y.fx").is_file(), "特效要拷到 B");
        assert_eq!(r.删除文件, 0, "拷贝模式不许删原件");
        assert!(源A.join("x.pmx").is_file() && 源B.join("y.fx").is_file(), "原件必须还在");

        /* 工程里的路径必须改成指向新位置 */
        let 文本 = 解gbk(&fs::read(&emm).unwrap());
        assert!(文本.contains(&format!("{}\\UserFile\\模型\\x.pmx", 到A.display())), "模型路径要指向 A：{文本}");
        assert!(文本.contains(&format!("{}\\UserFile\\特效\\y.fx", 到B.display())), "特效路径要指向 B");
        assert!(!文本.contains(&旧A.to_string_lossy().to_string()), "旧根不许剩");
        assert!(均存在(&文本), "产物里每条绝对路径都要在盘上");
    }

    /** 只认盘上真有的路径（搬运测试的收尾判据） */
    fn 均存在(文本: &str) -> bool {
        文本.split("\r\n").all(|行| {
            let Some(v) = 行.split('=').nth(1) else { return true };
            let v = v.trim();
            let b = v.as_bytes();
            if b.len() > 3 && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/') {
                Path::new(v).is_file()
            } else {
                true
            }
        })
    }

    /**
     * 「搬」模式：**逐个字节核对相同之后**才删原件（不相同的绝不删）。
     */
    #[test]
    fn 搬运_搬模式_核对相同才删原件() {
        let d = 临时目录("搬模式");
        let 旧 = d.join("旧");
        fs::create_dir_all(旧.join("UserFile/模型")).unwrap();
        fs::write(旧.join("UserFile/模型/x.pmx"), b"abc").unwrap();
        let 到 = d.join("新/模型根");
        let emm = d.join("工程.emm");
        let 目标文件 = format!("{}\\UserFile\\模型\\x.pmx", 旧.display());
        fs::write(&emm, 编gbk(&改分行(&format!("[Object]\nPmd1 = {目标文件}\n")))).unwrap();
        let pmm = d.join("工程.pmm");
        fs::write(&pmm, 造pmm(&[("Pmd1", &目标文件)])).unwrap();

        let r = 搬运内部(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![(旧.to_string_lossy().to_string(), 到.to_string_lossy().to_string())],
            vec![],
            "搬".into(),
            false,
            false,
            false,
        )
        .expect("搬模式应当成功");
        println!("  拷贝 {} / 删除 {}", r.拷贝文件, r.删除文件);
        assert!(到.join("UserFile/模型/x.pmx").is_file(), "新位置要有那份");
        assert!(!旧.join("UserFile/模型/x.pmx").exists(), "搬模式要把原件删掉");
        assert_eq!(r.删除文件, 1);
        assert!(均存在(&解gbk(&fs::read(&emm).unwrap())), "产物路径都在盘上");
    }

    /** 目标在源目录里面 → 拒绝（会自己套自己；实测不拦会栈溢出） */
    #[test]
    fn 搬运_目标在源里面就拒绝() {
        let d = 临时目录("搬运套自己");
        let 旧 = d.join("旧");
        fs::create_dir_all(旧.join("UserFile/模型")).unwrap();
        fs::write(旧.join("UserFile/模型/x.pmx"), b"abc").unwrap();
        let emm = d.join("工程.emm");
        let 目标 = format!("{}\\UserFile\\模型\\x.pmx", 旧.display());
        fs::write(&emm, 编gbk(&改分行(&format!("[Object]\nPmd1 = {目标}\n")))).unwrap();
        let pmm = d.join("工程.pmm");
        fs::write(&pmm, 造pmm(&[("Pmd1", &目标)])).unwrap();
        /* 前缀 = 文件所在目录，目标 = 它下面的子目录 → 目标目录在源目录里面 */
        let e = 搬运内部(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![(
                旧.join("UserFile/模型").to_string_lossy().to_string(),
                旧.join("UserFile/模型/子").to_string_lossy().to_string(),
            )],
            vec![],
            "拷".into(),
            false,
            false,
            false,
        )
        .expect_err("目标在源目录里必须拒绝");
        assert!(e.contains("自己套自己"), "{e}");
        assert!(!旧.join("UserFile/模型/子").exists(), "拒绝时不许建目录");
    }

    /** 只差斜杠（源 == 目标）时不许当成要搬 —— 不然会把目录拷进它自己里面 */
    #[test]
    fn 搬运_只差斜杠不搬() {
        let d = 临时目录("搬运斜杠");
        let 旧 = d.join("旧");
        fs::create_dir_all(旧.join("UserFile/模型")).unwrap();
        fs::write(旧.join("UserFile/模型/x.pmx"), b"abc").unwrap();
        let emm = d.join("工程.emm");
        let 目标 = format!("{}\\UserFile\\模型\\x.pmx", 旧.display());
        fs::write(&emm, 编gbk(&改分行(&format!("[Object]\nPmd1 = {目标}\n")))).unwrap();
        let pmm = d.join("工程.pmm");
        fs::write(&pmm, 造pmm(&[("Pmd1", &目标)])).unwrap();
        /* 前缀与目标目录只差斜杠写法 → 归一后是同一个位置 → 不该拷，也不该无限递归 */
        let r = 搬运内部(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![(
                format!("{}\\UserFile/模型", 旧.display()),
                format!("{}\\UserFile\\模型", 旧.display()),
            )],
            vec![],
            "拷".into(),
            false,
            false,
            false,
        );
        match r {
            Ok(ok) => println!("  归一后认为不用搬：拷贝 {} 个", ok.拷贝文件),
            Err(e) => println!("  归一后报错（也是对的，只要没递归拷自己）：{e}"),
        }
        assert!(旧.join("UserFile/模型/x.pmx").is_file(), "原件必须在");
    }

    /** 工程本来就在原位（旧根 == 新根）点写盘：要说清"没需要改的地方"，不许报"旧根还剩 N 次" */
    #[test]
    fn 搬根_旧新同一处_说清原地不动不写盘() {
        let d = 临时目录("旧新同一处");
        let 旧 = d.join("UserFile");
        fs::create_dir_all(旧.join("模型")).unwrap();
        fs::write(旧.join("模型/x.pmx"), b"abc").unwrap();
        let 目标 = format!(r"{}\模型\x.pmx", 旧.display());
        let emm = d.join("工程.emm");
        fs::write(&emm, 编gbk(&改分行(&format!("[Object]\nPmd1 = {目标}\n")))).unwrap();
        let pmm = d.join("工程.pmm");
        fs::write(&pmm, 造pmm(&[("Pmd1", &目标)])).unwrap();
        let 原 = fs::read(&pmm).unwrap();

        /* 新根 = 旧根（只差一个尾部分隔符也算同一处） */
        let e = 搬根_夹具(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![(旧.to_string_lossy().to_string(), format!(r"{}\", 旧.display()))],
            vec![],
            String::new(),
            false,
        )
        .expect_err("旧新同一处不该写盘");
        println!("  报错：{e}");
        assert!(e.contains("原位"), "要说清是「已经在原位」：{e}");
        assert_eq!(fs::read(&pmm).unwrap(), 原, "拒绝时一个字节都不许动");
        assert!(!pmm.with_extension("pmm.bak").exists(), "拒绝时不该留 .bak");
    }

    /** 干跑：只报数，不碰盘 */
    #[test]
    fn 搬运_干跑不碰盘() {
        let d = 临时目录("搬运干跑");
        let 旧 = d.join("旧");
        fs::create_dir_all(旧.join("UserFile/模型")).unwrap();
        fs::write(旧.join("UserFile/模型/x.pmx"), b"abc").unwrap();
        let emm = d.join("工程.emm");
        let 目标 = format!("{}\\UserFile\\模型\\x.pmx", 旧.display());
        fs::write(&emm, 编gbk(&改分行(&format!("[Object]\nPmd1 = {目标}\n")))).unwrap();
        let pmm = d.join("工程.pmm");
        fs::write(&pmm, 造pmm(&[("Pmd1", &目标)])).unwrap();
        搬运内部(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![(旧.to_string_lossy().to_string(), d.join("新").to_string_lossy().to_string())],
            vec![],
            "拷".into(),
            true,
            false,
            false,
        )
        .expect("干跑应当成功");
        assert!(!d.join("新").exists(), "干跑不许建目录");
        assert!(解gbk(&fs::read(&emm).unwrap()).contains(&旧.to_string_lossy().to_string()), "干跑不许改工程");
    }

    /**
     * **不可逆的动作必须排在所有还能拒绝的步骤之后**（2026-09-25 只读审查量出来的真 bug）。
     *
     * 原来「搬」是"先删原件、再改工程路径"，而改路径那一步有好几个拒绝口子
     * （是禁止路径 / 换完不在盘上 / 旧根残留 > 0）。一拒绝就 `?` 返回 ——
     * 用户原件已经没了、工程一个字没改、**撤销记录也没落**（`落记录` 在更后面），
     * 退都退不回来。这条钉死：**拒绝了，原件必须还在、内容还得原样**。
     */
    #[test]
    fn 搬运_搬模式下后续校验拒绝时原件必须还在() {
        let d = 临时目录("搬不丢原件");
        let 旧 = d.join("旧");
        fs::create_dir_all(旧.join("UserFile/模型")).unwrap();
        let 原文件 = 旧.join("UserFile/模型/x.pmx");
        fs::write(&原文件, b"abc").unwrap();
        let emm = d.join("工程.emm");
        let 目标 = format!(r"{}\UserFile\模型\x.pmx", 旧.display());
        fs::write(&emm, 编gbk(&改分行(&format!("[Object]\nPmd1 = {目标}\n")))).unwrap();
        let pmm = d.join("工程.pmm");
        fs::write(&pmm, 造pmm(&[("Pmd1", &目标)])).unwrap();

        /* 目标目录里带「测试效果」→ `搬根内部带开关` 的硬闸会拒（`查禁止 = true`） */
        let 新 = d.join("测试效果").join("新");
        let e = 搬运内部(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![(旧.to_string_lossy().to_string(), 新.to_string_lossy().to_string())],
            vec![],
            "搬".into(),
            false,
            true,
            false,
        )
        .expect_err("目标落在禁止路径里就该拒绝");
        println!("  报错：{e}");
        assert!(
            原文件.exists(),
            "**拒绝了就不许把原件删掉**：{} 已经不在了",
            原文件.display()
        );
        assert_eq!(fs::read(&原文件).unwrap(), b"abc", "原件内容也不许动");
    }

    #[test]
    fn 检索_搜索起点给空目录不炸() {        let (d, pmm, emm) = 检索夹具("检索空起点", "[Object]\nPmd1 = D:\\旧根\\a.pmx\n");
        let 空 = d.join("空");
        fs::create_dir_all(&空).unwrap();
        let 表 = 检索_夹具(pmm, emm, vec![], vec![], vec![空.to_string_lossy().to_string()]).unwrap();
        assert_eq!(表.len(), 1);
        assert_eq!(表[0].状态, "没找到");
        /* 起点不存在也不该炸（用户可能填了个盘符不存在的路径） */
        let 表2 = 检索_夹具(
            d.join("工程.pmm").to_string_lossy().to_string(),
            d.join("工程.emm").to_string_lossy().to_string(),
            vec![],
            vec![],
            vec![r"Z:\不存在的地方".into()],
        )
        .unwrap();
        assert_eq!(表2.len(), 1);
    }

    /* ---------------- 撤销（用户 2026-09-22："指定路径错了可以还原"） ----------------
       两条放在**同一个测试**里：`ROBIN_撤销目录` 是进程级环境变量，
       两个测试并行跑会互相改指向；放一起就串行。 */

    /// 撤销量具用的目录。**不能放 `%TEMP%`**：撤销有一条硬闸 ——
    /// 记录里出现"测试/临时目录"的路径就整体拒绝，而 `临时目录()` 造出来的名字带 `robin-⑥`，正好命中。
    /// 所以放用户指定的验收目录下（跟香港那批量具同一处）。
    fn 撤销量具目录(名: &str) -> PathBuf {
        let d = PathBuf::from(r"E:\C test\⑥验收\撤销量具").join(名);
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn 撤销_原地修复写回改前那份_搬模式把原件搬回原位() {
        /* ---- ① 原地修复：撤销 = 从记录里的改前副本整份写回 ---- */
        let d = 撤销量具目录("原地");
        std::env::set_var("ROBIN_撤销目录", d.join("记录").to_string_lossy().to_string());

        let 旧 = d.join("旧");
        let 新 = d.join("新");
        fs::create_dir_all(旧.join("模型")).unwrap();
        fs::create_dir_all(新.join("模型")).unwrap();
        fs::write(旧.join("模型/x.pmx"), b"abc").unwrap();
        fs::write(新.join("模型/x.pmx"), b"abc").unwrap();
        let 指向 = format!(r"{}\模型\x.pmx", 旧.display());
        let emm = d.join("工程.emm");
        fs::write(&emm, 编gbk(&改分行(&format!("[Object]\nPmd1 = {指向}\n")))).unwrap();
        let pmm = d.join("工程.pmm");
        fs::write(&pmm, 造pmm(&[("Pmd1", &指向)])).unwrap();
        let 原pmm = fs::read(&pmm).unwrap();
        let 原emm = fs::read(&emm).unwrap();

        /* 查禁止=false（夹具在 %TEMP% 里）、记=true（要落记录） */
        搬根内部带开关(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![(旧.to_string_lossy().to_string(), 新.to_string_lossy().to_string())],
            vec![],
            String::new(), /* 就地改 */
            false,
            false,
            false,
            true,
        )
        .expect("原地修复应当成功");
        assert_ne!(fs::read(&pmm).unwrap(), 原pmm, "写盘之后 .pmm 应当变了");

        let r = 待撤销().unwrap().expect("应当有一份可撤销记录");
        assert_eq!(r.动作, "原地修复");
        assert_eq!(r.改前.len(), 2, "改前要存 .pmm 和 .emm 两份");

        /* 先出表：干跑不碰盘 */
        let 干 = 撤销工程(true).unwrap();
        assert!(干.问题.is_empty(), "不该有问题：{:?}", 干.问题);
        assert!(干.条目.iter().any(|x| x.做什么 == "写回工程文件"), "表里要写清会写回哪几个文件");
        let 快照 = fs::read(&pmm).unwrap();
        let _ = 撤销工程(true).unwrap();
        assert_eq!(fs::read(&pmm).unwrap(), 快照, "干跑一个字节都不许动");

        /* 真撤销 → 逐字节回到改前 */
        let 真 = 撤销工程(false).unwrap();
        assert_eq!(真.写回, 2, "两个工程文件都要写回");
        assert_eq!(fs::read(&pmm).unwrap(), 原pmm, "撤销后 .pmm 必须逐字节回到改前");
        assert_eq!(fs::read(&emm).unwrap(), 原emm, "撤销后 .emm 必须逐字节回到改前");
        assert!(!真.回读.is_empty() && 真.回读.iter().all(|s| !s.contains("不一致")), "回读要全过：{:?}", 真.回读);

        /* 撤过就不许再撤 */
        let e = 撤销工程(false).unwrap_err();
        assert!(e.contains("没有可撤销"), "撤过之后应当说没有记录：{e}");

        /* ---- ② 搬运（搬模式）：撤销 = 把原件从新位置搬回原位，再把副本目录删掉 ---- */
        let d2 = 撤销量具目录("搬回");
        std::env::set_var("ROBIN_撤销目录", d2.join("记录").to_string_lossy().to_string());
        let 源 = d2.join("源User");
        fs::create_dir_all(源.join("模型")).unwrap();
        fs::write(源.join("模型/x.pmx"), b"abc").unwrap();
        let 指向2 = format!(r"{}\模型\x.pmx", 源.display());
        let emm2 = d2.join("工程.emm");
        fs::write(&emm2, 编gbk(&改分行(&format!("[Object]\nPmd1 = {指向2}\n")))).unwrap();
        let pmm2 = d2.join("工程.pmm");
        fs::write(&pmm2, 造pmm(&[("Pmd1", &指向2)])).unwrap();
        let 原pmm2 = fs::read(&pmm2).unwrap();
        let 目标根 = d2.join("新");
        let 新文件 = 目标根.join("模型/x.pmx");
        let 新目录 = 目标根.join("模型");

        搬运内部(
            pmm2.to_string_lossy().to_string(),
            emm2.to_string_lossy().to_string(),
            vec![(源.to_string_lossy().to_string(), 目标根.to_string_lossy().to_string())],
            vec![],
            "搬".into(),
            false,
            false,
            true, /* 这条量具**要**记录：验的就是"撤销照记录搬回原件" */
        )
        .expect("搬模式应当成功");
        assert!(!源.join("模型/x.pmx").exists(), "搬模式应当删掉原件");
        assert!(新文件.is_file(), "新位置应当有那份");

        let r2 = 待撤销().unwrap().expect("搬完应当有记录");
        assert_eq!(r2.动作, "搬运");
        assert_eq!(r2.方式, "搬");
        assert_eq!(r2.原件.len(), 1, "要记下删掉的那份原件");

        let 真2 = 撤销工程(false).unwrap();
        assert_eq!(真2.搬回, 1, "要搬回 1 个原件");
        assert!(源.join("模型/x.pmx").is_file(), "原件必须回到原位");
        assert_eq!(fs::read(源.join("模型/x.pmx")).unwrap(), b"abc", "内容要一样");
        assert!(!新文件.exists(), "新位置那份要撤掉");
        assert!(!新目录.exists(), "副本目录要删掉（里面全是原处的副本）");
        assert_eq!(fs::read(&pmm2).unwrap(), 原pmm2, "工程文件要回到搬之前");

        /* ---- ③ 没有记录时：只提示，绝不动盘 ---- */
        let 空 = 撤销量具目录("空");
        std::env::set_var("ROBIN_撤销目录", 空.join("记录").to_string_lossy().to_string());
        assert!(待撤销().unwrap().is_none(), "空目录里不该有记录");
        let e2 = 撤销工程(false).unwrap_err();
        assert!(e2.contains("没有可撤销"), "要说清没有记录：{e2}");
        let e3 = 撤销工程(true).unwrap_err();
        assert!(e3.contains("没有可撤销"), "试算也要说清没有记录：{e3}");

        /* ---- ④ 打包迁移（自带）：撤销 = 删掉包里的工程文件与副本目录，**素材一个不动** ----
           这是 2026-09-22 新加的那条腿（`搬根自带`），原来没有任何撤销证据。 */
        let d4 = 撤销量具目录("自带");
        std::env::set_var("ROBIN_撤销目录", d4.join("记录").to_string_lossy().to_string());
        /* 工程里写的是死根（`旧地\`），文件实际在 `素材User\`：根规则只负责**找到源文件**，
           自带模式会把写表换成「旧根 → 输出目录」，所以包里落的是相对结构。 */
        let 死根 = d4.join("旧地");
        let 素材 = d4.join("素材User");
        fs::create_dir_all(素材.join("模型")).unwrap();
        fs::write(素材.join("模型/x.pmx"), b"abc").unwrap();
        fs::write(素材.join("模型/tex.png"), b"png").unwrap(); /* 邻居贴图：要跟着一起进包 */
        let 指向4 = format!(r"{}\模型\x.pmx", 死根.display());
        let emm4 = d4.join("工程.emm");
        fs::write(&emm4, 编gbk(&改分行(&format!("[Object]\nPmd1 = {指向4}\n")))).unwrap();
        let pmm4 = d4.join("工程.pmm");
        fs::write(&pmm4, 造pmm(&[("Pmd1", &指向4)])).unwrap();
        let 原pmm4 = fs::read(&pmm4).unwrap();
        let 原emm4 = fs::read(&emm4).unwrap();
        let 包 = d4.join("包");

        搬根内部带开关(
            pmm4.to_string_lossy().to_string(),
            emm4.to_string_lossy().to_string(),
            vec![(死根.to_string_lossy().to_string(), 素材.to_string_lossy().to_string())],
            vec![],
            包.to_string_lossy().to_string(),
            false,
            true, /* 自带 */
            false,
            true, /* 记 */
        )
        .expect("打包迁移应当成功");

        let 包pmm = 包.join("工程.pmm");
        let 包emm = 包.join("工程.emm");
        assert!(包pmm.is_file() && 包emm.is_file(), "工程文件要落进包里");
        assert!(包.join("模型/x.pmx").is_file(), "包里要有模型");
        assert!(包.join("模型/tex.png").is_file(), "邻居贴图也要一起拷（不然贴图引用会断）");
        /* 包里那两份工程文件**写的是包内的完整路径**（不是相对路径、也不是原处的老路径）——
           写表在自带模式里被换成了「旧根 → 输出目录」 */
        let 针 = 编gbk(&format!(r"{}\模型\x.pmx", 包.display()));
        for (名, b) in [("pmm", fs::read(&包pmm).unwrap()), ("emm", fs::read(&包emm).unwrap())] {
            assert!(
                b.windows(针.len()).any(|w| w == 针),
                "包里的 .{名} 要写着包内的完整路径（找不到 {}\\模型\\x.pmx）",
                包.display()
            );
        }
        assert_eq!(fs::read(&pmm4).unwrap(), 原pmm4, "自带是写到输出目录，原件不许被动");
        assert_eq!(fs::read(&emm4).unwrap(), 原emm4, "原件 .emm 同样不许动");

        let r4 = 待撤销().unwrap().expect("打包完应当有记录");
        assert_eq!(r4.动作, "自包含目录");

        /* 先出表：表上要写清"删哪两个产物、删哪个副本目录"，干跑不许动盘 */
        let 干4 = 撤销工程(true).unwrap();
        assert!(干4.问题.is_empty(), "不该有问题：{:?}", 干4.问题);
        assert!(
            干4.条目.iter().any(|x| x.做什么.contains("删掉产物")),
            "表里要写清会删掉哪几个产物：{:?}",
            干4.条目.iter().map(|x| x.做什么.clone()).collect::<Vec<_>>()
        );
        assert!(包pmm.is_file() && 包emm.is_file(), "干跑不许碰产物");

        let 真4 = 撤销工程(false).unwrap();
        assert!(!包pmm.exists() && !包emm.exists(), "撤销要把包里的工程文件删掉");
        assert_eq!(真4.删目录, 1, "拷进包里的那个副本目录要删掉");
        assert!(!包.join("模型").exists(), "撤销要把拷进包里的副本目录删掉");
        assert_eq!(fs::read(&pmm4).unwrap(), 原pmm4, "撤销之后原件依然不许动");
        assert_eq!(fs::read(&emm4).unwrap(), 原emm4, "原件 .emm 同样不许动");
        assert!(
            素材.join("模型/x.pmx").is_file() && 素材.join("模型/tex.png").is_file(),
            "素材一个都不许少"
        );
        /* 自带模式**从头到尾没改过原处的任何文件**（只往包里写），所以撤销时
           `改前`/`原件` 两张表本来都是空的 —— 回读为空是正常的，不是"没核对"。
           源工程"没被动过"由上面那两条逐字节断言兜。 */
        assert!(真4.回读.iter().all(|s| !s.contains("不一致")), "回读不许报不一致：{:?}", 真4.回读);
    }

    /* ---------------- B6：两种打包 ── 本机内（绝对路径）/ 配布（相对包根） ----------------

       用户 2026-09-23 的第二批要求："打包要分两种情形 —— 本机内打包（自己备份/换盘用）
       / 配布打包（发给别人：必须自包含 + 路径不依赖本机）"。
       这条测试就量两件事：**配布包里一个本机盘符都没有**、**每一条相对路径都指在包内**；
       顺带把"本机内那一种仍旧写绝对路径"钉住（那是两种模式的区别本身）。 */
    fn 造打包夹具(d: &Path) -> (String, String, String, String) {
        let 好 = d.join("好");
        let 死 = d.join("死");
        let 实际 = d.join("实际");
        fs::create_dir_all(好.join("模型")).unwrap();
        fs::create_dir_all(实际.join("模型")).unwrap();
        fs::write(好.join("模型/a.pmx"), b"aaa").unwrap();
        fs::write(实际.join("模型/b.pmx"), b"bbb").unwrap();
        let 好路径 = format!(r"{}\模型\a.pmx", 好.display());
        let 死路径 = format!(r"{}\模型\b.pmx", 死.display());
        let pmm = d.join("工程.pmm");
        let emm = d.join("工程.emm");
        fs::write(&pmm, 造pmm(&[("Pmd1", &好路径), ("Pmd2", &死路径)])).unwrap();
        fs::write(
            &emm,
            编gbk(&改分行(&format!("[Object]\nPmd1 = {好路径}\nPmd2 = {死路径}\n"))),
        )
        .unwrap();
        (
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            死.to_string_lossy().to_string(),
            实际.to_string_lossy().to_string(),
        )
    }

    #[test]
    fn 配布打包_包里一个本机盘符都不带() {
        let d = 临时目录("配布");
        let (pmm, emm, 死, 实际) = 造打包夹具(&d);
        let 包 = d.join("配布包");
        let r = 搬根内部全参(
            pmm,
            emm,
            vec![(死, 实际)],
            vec![],
            包.to_string_lossy().to_string(),
            false,
            true,  /* 自带 */
            true,  /* 配布 */
            false,
            false,
        )
        .expect("配布打包应当成功");

        let 包pmm = fs::read(包.join("工程.pmm")).unwrap();
        let 包emm = fs::read(包.join("工程.emm")).unwrap();
        let 数盘符 = |b: &[u8]| -> usize {
            (0..b.len().saturating_sub(2))
                .filter(|i| {
                    b[*i].is_ascii_alphabetic()
                        && b[*i + 1] == b':'
                        && (b[*i + 2] == b'\\' || b[*i + 2] == b'/')
                })
                .count()
        };
        let 本机 = 数盘符(&包pmm) + 数盘符(&包emm);
        println!("  【B6】配布包：.pmm/.emm 里的本机绝对路径 = {本机} 处");
        assert_eq!(本机, 0, "配布包不该带盘符（本机内打包那一种才写绝对路径）");

        /* 写的是 `.\模型\…`：相对包根，落在包内 */
        let 文本 = 解gbk(&包emm);
        println!("  【B6】配布包 .emm 里的路径行：{}", 文本.lines().take(4).collect::<Vec<_>>().join(" | "));
        assert!(文本.contains(".\\模型\\"), "配布要写相对包根的路径：{文本}");
        for (p, 在) in r.产物路径.iter() {
            assert!(*在, "配布包里边条路径要指在包内：{p}");
        }
        assert!(包.join("模型/a.pmx").is_file() && 包.join("模型/b.pmx").is_file(), "素材要进包");
        assert!(包.join("配布说明.txt").is_file(), "配布包要附一份说明（接收方拿到要知道怎么开）");
        let 说明 = fs::read_to_string(包.join("配布说明.txt")).unwrap();
        assert!(说明.contains("相对"), "说明里要写清包里是相对路径：{说明}");
        assert!(说明.contains("没有在真 MMD 上"), "没验过的那一条要照实写：{说明}");
    }

    #[test]
    fn 本机内打包_仍旧写包内绝对路径() {
        let d = 临时目录("本机内");
        let (pmm, emm, 死, 实际) = 造打包夹具(&d);
        let 包 = d.join("本机包");
        let r = 搬根内部全参(
            pmm,
            emm,
            vec![(死, 实际)],
            vec![],
            包.to_string_lossy().to_string(),
            false,
            true,  /* 自带 */
            false, /* 本机内 */
            false,
            false,
        )
        .expect("本机内打包应当成功");
        let 包emm = 解gbk(&fs::read(包.join("工程.emm")).unwrap());
        let 包内 = 包.join("模型").join("a.pmx").to_string_lossy().to_string();
        println!("  【B6】本机内包：路径写成 {}", 包内);
        assert!(包emm.contains(&包内), "本机内打包写的是包内**绝对**路径：{包emm}");
        assert!(!包.join("配布说明.txt").is_file(), "本机内打包不出配布说明");
        for (p, 在) in r.产物路径.iter() {
            assert!(*在, "产物里这条路径在盘上找不到：{p}");
        }
    }

    /* ---------------- 打包不漏件（原来那条缺口，2026-09-23 按用户拍板的「改法 1」修掉） ----------------

       原来的行为：自带模式只把"被规则命中"的路径拷进包、也只改那几条。
       工程里本来就指对（文件在盘上）的那些根既不在根表里、也没进逐条表，于是
       文件不进包、路径也不改 —— 包里那份工程仍然指在包外（量具原来钉的就是这个现状）。
       现在：**没被规则覆盖、但盘上确实有**的路径也进拷贝清单（尾部取「目录名\文件名」，
       连它的邻居一起拷）并进写表改指包内；**一条映射都不给**（工程本来就健康）也能打包。
       同名冲突仍按原来那道闸整体拒绝（不覆盖、不猜）。 */
    #[test]
    fn 打包_没被规则覆盖的健康路径也进包_连邻居一起() {
        let d = 临时目录("漏件");
        let 好 = d.join("好");
        let 实际 = d.join("实际");
        let 死 = d.join("死");
        fs::create_dir_all(好.join("模型")).unwrap();
        fs::create_dir_all(实际.join("模型")).unwrap();
        fs::write(好.join("模型/a.pmx"), b"aaa").unwrap();
        /* 邻居：没人引用它，但"模型旁边的贴图"就是靠整棵目录一起拷才不断 */
        fs::write(好.join("模型/tex.png"), b"png").unwrap();
        fs::write(实际.join("模型/b.pmx"), b"bbb").unwrap();

        let 好路径 = format!(r"{}\模型\a.pmx", 好.display());
        let 死路径 = format!(r"{}\模型\b.pmx", 死.display());
        let pmm = d.join("工程.pmm");
        let emm = d.join("工程.emm");
        fs::write(&pmm, 造pmm(&[("Pmd1", &好路径), ("Pmd2", &死路径)])).unwrap();
        fs::write(
            &emm,
            编gbk(&改分行(&format!("[Object]\nPmd1 = {好路径}\nPmd2 = {死路径}\n"))),
        )
        .unwrap();

        let 包 = d.join("包");
        /* 只给"死根 → 文件实际在的地方"这一条规则：健康的那条根界面上根本不会出现在「要改的根」里 */
        let r = 搬根内部带开关(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![(死.to_string_lossy().to_string(), 实际.to_string_lossy().to_string())],
            vec![],
            包.to_string_lossy().to_string(),
            false,
            true, /* 自带 */
            false,
            false,
        )
        .expect("打包应当成功");

        /* 死根那条：进了包、路径改指包内 */
        assert!(包.join("模型/b.pmx").is_file(), "缺文件的那条要进包");
        /* 健康那条：**也要进包**，而且邻居一起 —— 这就是修掉的那条缺口 */
        assert!(包.join("模型/a.pmx").is_file(), "本来就健康的那条也要进包");
        assert!(包.join("模型/tex.png").is_file(), "它的邻居要一起进包（贴图靠相对结构）");
        assert!(r.拷贝文件 >= 3, "拷进来的文件数不对：{}", r.拷贝文件);
        assert!(r.重名冲突.is_empty(), "不该有重名冲突：{:?}", r.重名冲突);

        /* 包里那两份工程文件：包外的老路径一条都不许剩，健康那条要改指包内 */
        let 包内好 = 包.join("模型").join("a.pmx").to_string_lossy().to_string();
        for (名, b) in [
            ("pmm", fs::read(包.join("工程.pmm")).unwrap()),
            ("emm", fs::read(包.join("工程.emm")).unwrap()),
        ] {
            assert_eq!(
                数出现(&b, &编gbk(&好路径)),
                0,
                "包里的 .{名} 还写着包外的老路径（{好路径}）—— 整包搬走就会缺这个模型"
            );
            assert!(数出现(&b, &编gbk(&包内好)) > 0, "包里的 .{名} 要指到包内那份");
        }
        /* 产物里每条路径都得在盘上（这条是"包能直接打开"的判据） */
        for (p, 在) in r.产物路径.iter() {
            assert!(*在, "产物里这条路径在盘上找不到：{p}");
        }
    }

    #[test]
    fn 打包_工程本来就健康时没有映射也有入口() {
        let d = 临时目录("本来就健康");
        let 素材 = d.join("素材");
        fs::create_dir_all(素材.join("模型")).unwrap();
        fs::write(素材.join("模型/a.pmx"), b"aaa").unwrap();
        fs::write(素材.join("模型/tex.png"), b"png").unwrap();
        let 路径 = format!(r"{}\模型\a.pmx", 素材.display());
        let pmm = d.join("工程.pmm");
        let emm = d.join("工程.emm");
        fs::write(&pmm, 造pmm(&[("Pmd1", &路径)])).unwrap();
        fs::write(&emm, 编gbk(&改分行(&format!("[Object]\nPmd1 = {路径}\n")))).unwrap();

        let 包 = d.join("包");
        /* 一条映射都不给 —— 原来这里会被"没有给映射"直接拒（连带界面上也没有入口） */
        let r = 搬根内部带开关(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![],
            vec![],
            包.to_string_lossy().to_string(),
            false,
            true, /* 自带 */
            false,
            false,
        )
        .expect("工程本来就健康时打包也要有入口");

        assert!(包.join("模型/a.pmx").is_file(), "模型要进包");
        assert!(包.join("模型/tex.png").is_file(), "邻居要进包");
        assert!(包.join("工程.pmm").is_file() && 包.join("工程.emm").is_file(), "两份工程文件要进包");
        assert!(r.拷贝文件 > 0, "得真拷了东西");
        let 包内 = 包.join("模型").join("a.pmx").to_string_lossy().to_string();
        for (名, b) in [
            ("pmm", fs::read(包.join("工程.pmm")).unwrap()),
            ("emm", fs::read(包.join("工程.emm")).unwrap()),
        ] {
            assert_eq!(数出现(&b, &编gbk(&路径)), 0, "包里的 .{名} 还指着包外");
            assert!(数出现(&b, &编gbk(&包内)) > 0, "包里的 .{名} 要指到包内那份");
        }
        /* 干跑也一样：只报数、一个字节不写 */
        let 干包 = d.join("干包");
        let 干 = 搬根内部带开关(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![],
            vec![],
            干包.to_string_lossy().to_string(),
            true, /* 干跑 */
            true,
            false,
            false,
        )
        .expect("干跑也要能算");
        assert!(干.拷贝文件 > 0, "干跑要算出会拷多少");
        assert!(!干包.exists(), "干跑不许建目录");
    }

    /** 多条源目录映射到**互相嵌套的目标目录**时，试算的数必须跟真跑一样。
     *
     *  实测（2026-09-23，香港那套真工程）：试算报 2475 个文件 / 264.9 MB，
     *  真跑只拷 1160 个 / 197.0 MB —— 差 2.1 倍。根因在 `拷树`：真跑靠"目标文件已经在盘上
     *  且字节相同"跳过重叠加叠的那些，干跑不落盘、那个条件永远不成立，于是同一批文件被数了两遍。
     *  界面拿试算的数给用户看，所以这个数就是用户看到的数，必须对齐。 */
    #[test]
    fn 打包_试算与真跑的数必须一样_源目录嵌套时也不例外() {
        let d = 临时目录("试算口径");
        let 源 = d.join("源");
        /* 一个目录 + 它里面的子目录都各自被引用到 —— 两条映射的目标目录是嵌套的 */
        fs::create_dir_all(源.join("贴图/子")).unwrap();
        fs::write(源.join("贴图/a.png"), b"aaaa").unwrap();
        fs::write(源.join("贴图/子/b.png"), b"bbbb").unwrap();
        let 路径 = 源.join("贴图/a.png").to_string_lossy().to_string();
        let 子路径 = 源.join("贴图/子/b.png").to_string_lossy().to_string();

        let pmm = d.join("工程.pmm");
        let emm = d.join("工程.emm");
        fs::write(&pmm, 造pmm(&[("Pmd1", &路径), ("Pmd2", &子路径)])).unwrap();
        fs::write(
            &emm,
            编gbk(&改分行(&format!("[Object]\nPmd1 = {路径}\nPmd2 = {子路径}\n")))
        )
        .unwrap();

        let 干包 = d.join("干包");
        let 干 = 搬根内部带开关(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![],
            vec![],
            干包.to_string_lossy().to_string(),
            true, /* 干跑 */
            true,
            false,
            false,
        )
        .expect("试算要能算");

        let 真包 = d.join("真包");
        let 真 = 搬根内部带开关(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![],
            vec![],
            真包.to_string_lossy().to_string(),
            false,
            true,
            false,
            false,
        )
        .expect("真跑要能跑");

        assert!(!干包.exists(), "试算不许建目录");
        assert_eq!(
            干.拷贝文件, 真.拷贝文件,
            "试算报的就会拷多少个文件，必须跟真跑拷出来的一样"
        );
        assert_eq!(干.拷贝字节, 真.拷贝字节, "字节数也要同一个口径");
        /* 两条映射的落点有重叠（`源\贴图` 整目录拷一次、`源\贴图\子` 又单独拷一次），
           所以 b.png 在包里出现两处 —— 这是产品本来的排法（保住文件自己的邻居），
           这里钉的是「试算把重叠的那份也数对了」，不是钉一个具体数字。 */
        assert!(真.拷贝文件 >= 2, "两个引用文件都得进包");
    }

    /** 自带模式：输出目录落在源目录**里面** → 整体拒绝。
     *
     *  不拦的话就是"一边拷一边把新拷出来的东西再当源"，越拷越深 —— 搬运那边实测过这条
     *  会把进程弄崩。⑥ 那轮把它加进自带模式（原来只拷"被规则命中"的目录，现在健康路径
     *  的目录也进包，所以这条闸在自带模式下同样必要）。 */
    #[test]
    fn 打包_输出目录落在源目录里面就拒绝() {
        let d = 临时目录("包里套自己");
        let 源 = d.join("源");
        fs::create_dir_all(源.join("模型")).unwrap();
        fs::write(源.join("模型/a.pmx"), b"aaa").unwrap();
        let 路径 = 源.join("模型/a.pmx").to_string_lossy().to_string();
        let pmm = d.join("工程.pmm");
        let emm = d.join("工程.emm");
        fs::write(&pmm, 造pmm(&[("Pmd1", &路径)])).unwrap();
        fs::write(&emm, 编gbk(&改分行(&format!("[Object]\nPmd1 = {路径}\n")))).unwrap();

        /* 输出目录摆在**源目录里面** */
        let 里面 = 源.join("模型").join("打到里面");
        let e = 搬根内部带开关(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![],
            vec![],
            里面.to_string_lossy().to_string(),
            false,
            true,
            false,
            false,
        )
        .unwrap_err();
        assert!(
            e.contains("输出目录在源目录里面"),
            "要拒得明白，说的是「输出目录在源目录里面」：{e}"
        );
        assert!(!里面.exists(), "拒绝之后一个目录都不许建");
    }

    #[test]
    fn 打包_同名不同内容时按原来的闸拒绝并说清楚() {
        let d = 临时目录("重名");
        /* 两个不同的源目录**同名**（都叫"模型"）、里面的同名文件内容不同 → 进包会撞在一起 */
        let 甲 = d.join("甲");
        let 乙 = d.join("乙");
        fs::create_dir_all(甲.join("模型")).unwrap();
        fs::create_dir_all(乙.join("模型")).unwrap();
        fs::write(甲.join("模型/a.pmx"), b"aaa").unwrap();
        fs::write(乙.join("模型/a.pmx"), b"zzz").unwrap();
        let 路甲 = format!(r"{}\模型\a.pmx", 甲.display());
        let 路乙 = format!(r"{}\模型\a.pmx", 乙.display());
        let pmm = d.join("工程.pmm");
        let emm = d.join("工程.emm");
        fs::write(&pmm, 造pmm(&[("Pmd1", &路甲), ("Pmd2", &路乙)])).unwrap();
        fs::write(
            &emm,
            编gbk(&改分行(&format!("[Object]\nPmd1 = {路甲}\nPmd2 = {路乙}\n"))),
        )
        .unwrap();

        let 包 = d.join("包");
        let e = 搬根内部带开关(
            pmm.to_string_lossy().to_string(),
            emm.to_string_lossy().to_string(),
            vec![],
            vec![],
            包.to_string_lossy().to_string(),
            false,
            true,
            false,
            false,
        )
        .unwrap_err();
        assert!(e.contains("同名但内容不同"), "重名要拒得明白：{e}");
        assert!(e.contains("改名") || e.contains("换个空目录"), "要说清怎么办：{e}");
        assert!(!包.join("工程.pmm").exists(), "拒绝之后不许写盘");
    }
}
