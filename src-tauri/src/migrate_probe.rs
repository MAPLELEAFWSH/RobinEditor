//! ⑥ 真实迁移实测 —— 只做验收的量具，不进默认套件。
//!
//! 用户指定的样本（**只读**）：
//! `E:\deepseek-harness\mmd集成工具\香港_by_胧月兔_20c4805607dd8ed4e6434b5379da3c59\UserFile\`
//! 里有两套工程（夜间 / 日间），输出只写同级的 `…\1`。
//!
//! 跑法：
//! ```text
//! cargo test --lib -- --ignored --nocapture 香港观塘
//! cargo test --lib -- --ignored --nocapture 香港观塘_真实迁移
//! ```
//! 迁移那条用环境变量给目录（不写死，方便换口径重跑）：
//! `MIG_模型目录` / `MIG_附件目录`（留空 = 那一类不指新位置）/ `MIG_输出`（默认 `…\1`）。
//!
//! 量具自己造的那些副本与落点全归 `暂存根()`（见下面那个函数）：默认 `E:\C test`，
//! 可以拿 `MIG_暂存根` 换掉（用户把 `E:\C test\` 划成只读时就这么跑）。

use crate::project::{搬家, 扫描结果, 搬家结果, 扫};
use std::fs;
use std::path::{Path, PathBuf};

const 工程根: &str = r"E:\deepseek-harness\mmd集成工具\香港_by_胧月兔_20c4805607dd8ed4e6434b5379da3c59";

/// **本次范围**：夜间那套是主角。
///
/// 日间那套（`香港观塘 一键启动 日间 2.1`）**用户没要求处理**，但它是一件现成的"坏工程"：
/// 它的 85 条路径里 84 条指着 `D:\MMD一键渲染工程项目`（本机没有这个盘）、1 条指着 `H:\UserFile`。
/// 夜间那套不一样 —— 它的 172 条路径本来就指在自己这边（`E:\deepseek-harness\…`），
/// **所以"原地修复"在夜间那套上是无事可做的**，拿它验"修不修得回来"永远验不出东西。
/// 于是：**修得回来 → 用日间验**；**已经指对了不许乱动 → 用夜间验**。
const 工程: [&str; 2] = ["香港观塘 一键启动 夜间 2.1", "香港观塘 一键启动 日间 2.1"];

fn 编gbk(s: &str) -> Vec<u8> {
    encoding_rs::GBK.encode(s).0.to_vec()
}

/// 针在字节里出现几次（按 GBK 编码找，跟写回一致）
fn 数(hay: &[u8], 针: &str) -> usize {
    let n = 编gbk(针);
    if n.is_empty() || hay.len() < n.len() {
        return 0;
    }
    hay.windows(n.len()).filter(|w| *w == n.as_slice()).count()
}

fn 扫一套(名: &str) -> (String, String, 扫描结果) {
    let pmm = format!(r"{工程根}\UserFile\{名}.pmm");
    let emm = format!(r"{工程根}\UserFile\{名}.emm");
    let s = 扫(pmm.clone(), emm.clone()).expect("扫不动这套工程");
    (pmm, emm, s)
}

fn 打一份(名: &str, s: &扫描结果) {
    let 模型: Vec<_> = s.objects.iter().filter(|o| o.kind == "model").collect();
    let 附件: Vec<_> = s.objects.iter().filter(|o| o.kind == "accessory").collect();
    let 在盘 = s.objects.iter().filter(|o| Path::new(&o.path).is_file()).count();
    println!("\n================ {名} ================");
    println!(
        "  对象 {} 条（模型 {} / 附件 {}）；引用文件在本机存在的 {} 条、缺 {} 条",
        s.objects.len(),
        模型.len(),
        附件.len(),
        在盘,
        s.objects.len() - 在盘
    );
    println!(
        "  路径字段定位：命中 {} 条（对象 {} 条）；贴图引用 {} 条",
        s.pmm_hits.len(),
        s.objects.len(),
        s.textures.len()
    );
    if !s.问题.is_empty() {
        println!("  扫描报的问题 {} 条：", s.问题.len());
        for p in s.问题.iter().take(20) {
            println!("    - {p}");
        }
    }
    println!("  ---- 缺文件的（逐条）----");
    let mut 缺 = 0;
    for o in s.objects.iter() {
        if !Path::new(&o.path).is_file() {
            缺 += 1;
            println!("    {} [{}] {}", o.key, o.kind, o.path);
        }
    }
    if 缺 == 0 {
        println!("    （没有缺的）");
    }
    println!("  ---- 模型目录归组（条数 / 盘上有）----");
    for g in s.模型目录.iter() {
        println!("    {}/{}  {}", g.有, g.条数, g.目录);
    }
    println!("  ---- 附件目录归组 ----");
    for g in s.附件目录.iter() {
        println!("    {}/{}  {}", g.有, g.条数, g.目录);
    }
    println!("  ---- 逐条对象 ----");
    for (i, o) in s.objects.iter().enumerate() {
        let 有 = if Path::new(&o.path).is_file() { "在" } else { "缺" };
        let 位 = s.pmm_hits.iter().find(|h| h.key == o.key);
        let 怎 = 位.map(|h| h.怎么找到的).unwrap_or("没定位到");
        let 处 = 位.map(|h| h.全部.len()).unwrap_or(0);
        let 名 = 位.map(|h| h.名称.clone()).unwrap_or_default();
        println!(
            "    {:>6} [{}] {有} 定位={怎}(字段{处}处) 名称={名:?} 路径={}",
            o.key, o.kind, o.path
        );
        let _ = i;
    }
}

#[test]
#[ignore]
fn 香港观塘_扫一遍() {
    for 名 in 工程 {
        match std::panic::catch_unwind(|| 扫一套(名)) {
            Ok((_, _, s)) => 打一份(名, &s),
            Err(_) => println!("\n================ {名} ================\n  扫不动（上面有 panic）"),
        }
    }
}

/// 旧根之后的那一段（相对尾部）
fn 尾路径(旧根: &str, 全路径: &str) -> String {
    if 旧根.is_empty() || 全路径.len() <= 旧根.len() {
        return String::new();
    }
    全路径[旧根.len()..].trim_start_matches('\\').to_string()
}

/// 所有对象路径的**公共前缀**（按路径分量比，不是按字符）——这就是"旧根"
fn 公共旧根(路径们: &[String]) -> String {
    let mut 分量: Vec<Vec<String>> = Vec::new();
    for p in 路径们 {
        if p.is_empty() {
            continue;
        }
        分量.push(
            p.split('\\')
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .collect(),
        );
    }
    if 分量.is_empty() {
        return String::new();
    }
    let mut n = 分量[0].len();
    for c in 分量.iter().skip(1) {
        let mut k = 0;
        while k < n && k < c.len() && 分量[0][k].eq_ignore_ascii_case(&c[k]) {
            k += 1;
        }
        n = k;
    }
    /* 最后一段是文件名时不算公共目录 */
    分量[0][..n.saturating_sub(1).max(1).min(n)].join("\\")
}

#[test]
#[ignore]
fn 香港观塘_诊断为什么A拒绝() {
    for 名 in 工程 {
        let (pmm, emm, s) = 扫一套(名);
        println!("\n================ {名} ================");
        let 路径们: Vec<String> = s.objects.iter().map(|o| o.path.clone()).collect();
        let 旧根 = 公共旧根(&路径们);
        println!("  对象 {} 条，全部路径的公共前缀（旧根）= {旧根:?}", s.objects.len());
        let 在盘 = s.objects.iter().filter(|o| Path::new(&o.path).is_file()).count();
        println!("  按**存储的旧路径**在盘上找得到：{在盘} / {} 条", s.objects.len());
        println!(
            "  工具给 A 的目录归组：模型 {} 组 / 附件 {} 组（A 每类只能填一个目录）",
            s.模型目录.len(),
            s.附件目录.len()
        );

        /* 结构保持的候选：旧根换成"某个祖先目录"，让相对尾部继续成立。
           这就是"自动识别内容文件现在存哪儿"该做的事 —— 从工程自己的目录往上找。 */
        let mut 最好: Option<(usize, String)> = None;
        let mut 试过: Vec<(String, usize)> = Vec::new();
        let mut 起 = Some(Path::new(&pmm).parent().unwrap().to_path_buf());
        while let Some(d) = 起 {
            let mut 命中 = 0;
            for o in s.objects.iter() {
                let 尾 = if o.path.len() > 旧根.len() {
                    o.path[旧根.len()..].trim_start_matches('\\')
                } else {
                    ""
                };
                if !尾.is_empty() && d.join(尾).is_file() {
                    命中 += 1;
                }
            }
            试过.push((d.to_string_lossy().to_string(), 命中));
            if 命中 == s.objects.len() {
                最好 = Some((命中, d.to_string_lossy().to_string()));
                break;
            }
            if 最好.as_ref().map(|(n, _)| 命中 > *n).unwrap_or(true) {
                最好 = Some((命中, d.to_string_lossy().to_string()));
            }
            起 = d.parent().map(|p| p.to_path_buf());
        }
        match &最好 {
            Some((n, d)) if *n == s.objects.len() => println!(
                "  ★ 找齐了：旧根换成 `{d}` 之后，{} / {} 条**全部在盘上**（保持相对结构）",
                n,
                s.objects.len()
            ),
            Some((n, d)) => println!(
                "  最好的候选 `{d}` 只找到 {n} / {} 条（没找齐，下面列前几个试过的）",
                s.objects.len()
            ),
            None => println!("  一个候选都没有"),
        }
        for (d, n) in 试过.iter().take(6) {
            println!("    试过 {n}/{}  {d}", s.objects.len());
        }

        /* A 的干跑：看它打算怎么办（不写盘） */
        let r: 搬家结果 = 搬家(
            pmm.clone(),
            emm.clone(),
            format!(r"{工程根}\1\模型"),
            format!(r"{工程根}\1\附件"),
            format!(r"{工程根}\1"),
            true,
            None,
        )
        .expect("干跑不该拒绝（拒绝只在真正写盘那一步）");
        println!(
            "  干跑：指到新位置 {} / 保持原路径 {} / 找不到 {}（改了 {} 处）",
            r.表.iter().filter(|x| x.处置 == "指到新位置").count(),
            r.表.iter().filter(|x| x.处置 == "保持原路径").count(),
            r.表.iter().filter(|x| x.处置 == "找不到").count(),
            r.改了几处
        );
        let 没定位 = r.表.iter().filter(|x| x.定位.is_empty()).count();
        println!("  干跑：路径字段没定位到的 {没定位} 条（0 才允许写盘）");

        /* ---- 模型自己的贴图引用：是不是也指着老根？ ---- */
        let Some((_, 新根)) = 最好.clone() else { continue };
        let 尾 = |p: &str| -> String {
            if p.len() > 旧根.len() {
                p[旧根.len()..].trim_start_matches('\\').to_string()
            } else {
                String::new()
            }
        };
        let mut 贴图总 = 0;
        let mut 贴图在 = 0;
        let mut 贴图缺例 = Vec::new();
        for o in s.objects.iter().filter(|o| o.path.to_lowercase().ends_with(".pmx")) {
            let pmx = Path::new(&新根).join(尾(&o.path));
            if !pmx.is_file() {
                continue;
            }
            let Ok(ts) = crate::project::收贴图(&pmx) else { continue };
            for t in ts {
                if t.path.trim().is_empty() {
                    continue;
                }
                贴图总 += 1;
                if t.exists {
                    贴图在 += 1;
                } else if 贴图缺例.len() < 6 {
                    贴图缺例.push(format!(
                        "{}: {}（{}，按 .pmx 同目录解）",
                        o.key,
                        t.path,
                        if Path::new(&t.path).is_absolute() { "绝对" } else { "相对" }
                    ));
                }
            }
        }
        println!("  模型自己的贴图引用：共 {贴图总} 条，按**新根**落到盘上的 {贴图在} 条");
        for l in 贴图缺例.iter() {
            println!("    ! 贴图找不到：{l}");
        }
    }
}

/**
 * **结构保持的根替换迁移**（量具实现，不是产品功能）。
 *
 * 为什么要它：用户这两套工程的对象散在 **6 个模型目录 + 3 个附件目录**（A 每类只能填一个目录），
 * 而模型又依赖同目录贴图 —— 平铺进一个目录会打断贴图。所以真正对的做法是
 * "**旧根 → 新根**"整段替换、相对结构原样保留；新根从工程所在目录往上自动找。
 *
 * 这里用产品里现成的三段拼出来（`找字段` / `改字段` / `rewrite_emm`），
 * 目的有两个：① 证明算法在真工程上端到端成立；② 给产品侧一个可直接照搬的参考实现。
 * **产物写在 `…\1`，素材只读。**
 */
#[test]
#[ignore]
fn 香港观塘_根替换迁移() {
    let 输出 = std::env::var("MIG_输出").unwrap_or_else(|_| format!(r"{工程根}\1"));
    fs::create_dir_all(&输出).expect("建不出输出目录");
    let 输出p = Path::new(&输出);

    for 名 in 工程 {
        println!("\n================ 根替换迁移：{名} ================");
        let (pmm, emm, s) = 扫一套(名);
        let 原pmm = fs::read(&pmm).unwrap();
        let 原emm = fs::read(&emm).unwrap();
        let 原文本 = fs::read_to_string(&emm).unwrap_or_else(|_| {
            let b = fs::read(&emm).unwrap();
            crate::project::parse_emm(&String::from_utf8_lossy(&b)).objects.len().to_string()
        });
        let _ = 原文本;
        let 旧文本 = {
            let b = fs::read(&emm).unwrap();
            /* .emm 是 GBK，按 GBK 解出来当文本 */
            encoding_rs::GBK.decode(&b).0.to_string()
        };

        let 路径们: Vec<String> = s.objects.iter().map(|o| o.path.clone()).collect();
        let 旧根 = 公共旧根(&路径们);

        /* 从工程目录往上找"让全部相对尾部都成立"的祖先 —— 这就是自动识别内容文件在哪 */
        let mut 新根 = String::new();
        let mut 起 = Some(Path::new(&pmm).parent().unwrap().to_path_buf());
        while let Some(d) = 起 {
            let 全 = s.objects.iter().all(|o| {
                let 尾 = 尾路径(&旧根, &o.path);
                !尾.is_empty() && d.join(&尾).is_file()
            });
            if 全 {
                新根 = d.to_string_lossy().to_string();
                break;
            }
            起 = d.parent().map(|p| p.to_path_buf());
        }
        if 新根.is_empty() {
            println!("  找不到能替换的根 —— 迁移做不了（这一套失败在这里）");
            continue;
        }
        println!("  旧根 {旧根:?}\n  新根 {新根:?}（自动找到：相对结构 100% 落在盘上）");

        /* 旧 → 新 路径表 */
        let mut 新表: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        let mut 落: Vec<(String, String, String)> = Vec::new();
        for o in s.objects.iter() {
            let 尾 = 尾路径(&旧根, &o.path);
            let 新 = Path::new(&新根).join(&尾).to_string_lossy().to_string();
            if !Path::new(&新).is_file() {
                println!("  ! {} 的新路径在盘上没有：{}", o.key, 新);
                continue;
            }
            新表.insert(o.key.clone(), 新.clone());
            落.push((o.key.clone(), o.path.clone(), 新));
        }
        println!("  对象 {} 条，算出新路径 {} 条", s.objects.len(), 落.len());

        /* 改字节：路径 → 所有字段（定长 256，不改长度） */
        let mut 字节 = 原pmm.clone();
        let (hits, 问题) = crate::project::找字段(&原pmm, &s.objects);
        if !问题.is_empty() {
            println!("  找字段报的问题 {} 条：{问题:?}", 问题.len());
        }
        let mut 改处 = 0;
        let mut 范围: Vec<(usize, usize)> = Vec::new();
        for h in hits.iter() {
            let Some(新) = 新表.get(&h.key) else { continue };
            for off in h.全部.iter() {
                match crate::project::改字段(&mut 字节, *off, 新) {
                    Ok(()) => {
                        改处 += 1;
                        范围.push((*off, *off + 256));
                    }
                    Err(msg) => {
                        println!("  ! {}：{msg}", h.key);
                    }
                }
            }
        }
        let (新emm文本, emm改) = crate::project::rewrite_emm(&旧文本, &新表);
        println!("  .pmm 改了 {改处} 处字段；.emm 改了 {emm改} 行");

        /* 写盘 */
        let 名p = Path::new(&pmm).file_name().unwrap().to_string_lossy().to_string();
        let 名e = Path::new(&emm).file_name().unwrap().to_string_lossy().to_string();
        let 出pmm = 输出p.join(&名p);
        let 出emm = 输出p.join(&名e);
        let emm字节 = 编gbk(&新emm文本);
        fs::write(&出pmm, &字节).expect("写不了产出 .pmm");
        fs::write(&出emm, &emm字节).expect("写不了产出 .emm");

        /* ---- 回读：只认盘上 ---- */
        let 盘pmm = fs::read(&出pmm).unwrap();
        let 盘emm = fs::read(&出emm).unwrap();
        println!(
            "  回读长度：.pmm {}（原 {}，{}）  .emm {}（原 {}，{}）",
            盘pmm.len(),
            原pmm.len(),
            if 盘pmm.len() == 原pmm.len() { "相同" } else { "不同" },
            盘emm.len(),
            原emm.len(),
            if 盘emm.len() == 原emm.len() { "相同" } else { "不同" }
        );
        assert_eq!(盘pmm.len(), 原pmm.len(), "根替换只写定长字段，.pmm 长度必须不变");
        assert_eq!(盘pmm, 字节, "盘上 .pmm 与内存不一致（写盘落空）");
        assert_eq!(盘emm, emm字节, "盘上 .emm 与内存不一致（写盘落空）");

        /* 差异字节必须全部落在被改的字段范围内 —— 这是"没碰别处"的硬证据 */
        let 变了: Vec<usize> = (0..原pmm.len()).filter(|i| 原pmm[*i] != 盘pmm[*i]).collect();
        let 在范围内 = |i: usize| 范围.iter().any(|(a, b)| i >= *a && i < *b);
        let 越界: Vec<usize> = 变了.iter().copied().filter(|i| !在范围内(*i)).collect();
        println!(
            "  差异字节 {} 个，落在被改字段之外的 {} 个（必须是 0）",
            变了.len(),
            越界.len()
        );
        assert!(越界.is_empty(), "有差异字节落在字段之外：{:?}", &越界[..越界.len().min(8)]);

        let 数 = |hay: &[u8], 针: &str| 数(hay, 针);
        let mut 坏 = 0;
        for (key, 旧, 新) in 落.iter() {
            let 旧p = 数(&盘pmm, 旧);
            let 新p = 数(&盘pmm, 新);
            let 旧e = 数(&盘emm, 旧);
            let 新e = 数(&盘emm, 新);
            println!("    {key:>6} .pmm 旧{旧p} 新{新p} | .emm 旧{旧e} 新{新e}");
            if 新p == 0 || 新e == 0 || 旧p != 0 || 旧e != 0 {
                坏 += 1;
            }
        }
        println!("  （对账不通过的：{坏} 条）");
        assert_eq!(坏, 0, "盘上产物里应当：新路径都在、旧路径都不剩");

        /* 产物里的路径逐条指过去，文件真的在吗 */
        let mut 在 = 0;
        let mut 不在 = 0;
        for (_, _, 新) in 落.iter() {
            if Path::new(新).is_file() {
                在 += 1;
            } else {
                不在 += 1;
            }
        }
        println!("  产物路径逐条核对：在盘上 {在} 条 / 找不到 {不在} 条");
        assert_eq!(不在, 0, "产物里不该有指不到文件的路径");
        println!("  这套工程迁移完成：{}", 出pmm.display());
    }

    println!("\n---- 输出目录 ----");
    for e in fs::read_dir(输出p).unwrap() {
        let e = e.unwrap();
        println!("    {} {} B", e.file_name().to_string_lossy(), e.metadata().unwrap().len());
    }
}

/// 一行 `键 = 值` 里，把值开头那个死根换成新根（**字节级**，不解码 —— 少一次编解码就少一次损坏机会）
fn 换根_行(行: &[u8], 表: &[(Vec<u8>, Vec<u8>)]) -> (Vec<u8>, bool) {
    let Some(eq) = 行.iter().position(|b| *b == b'=') else {
        return (行.to_vec(), false);
    };
    let 值起 = 行[eq + 1..].iter().position(|b| *b != b' ' && *b != b'\t').map(|i| i + eq + 1);
    let Some(值起) = 值起 else { return (行.to_vec(), false) };
    for (旧根, 新根) in 表 {
        if 行.len() >= 值起 + 旧根.len() && &行[值起..值起 + 旧根.len()] == 旧根.as_slice() {
            let mut 出 = 行[..值起].to_vec();
            出.extend_from_slice(新根);
            出.extend_from_slice(&行[值起 + 旧根.len()..]);
            return (出, true);
        }
    }
    (行.to_vec(), false)
}

/// 把一串绝对路径值里的"根"取出来（`D:\a\b\c` → `D:\a\b` 这种候选由调用方再收敛）
fn 取值(行: &[u8]) -> Option<Vec<u8>> {
    let eq = 行.iter().position(|b| *b == b'=')?;
    let 值起 = 行[eq + 1..]
        .iter()
        .position(|b| *b != b' ' && *b != b'\t')
        .map(|i| i + eq + 1)?;
    let 值 = &行[值起..];
    if 值.len() >= 3 && 值[1] == b':' && (值[2] == b'\\' || 值[2] == b'/') {
        Some(值.to_vec())
    } else {
        None
    }
}

/// 一个绝对路径取它的"根"：第 1 段（盘符）+ 目录段（不含文件名）
#[allow(dead_code)]
fn 路径根(值: &[u8]) -> Vec<u8> {
    let 斜 = 值.iter().rposition(|b| *b == b'\\' || *b == b'/');
    match 斜 {
        Some(i) if i > 2 => 值[..i].to_vec(),
        _ => Vec::new(),
    }
}

/**
 * **完整根替换迁移**（量具实现，不是产品功能）：把 `.emm` **所有段**的绝对路径死根、
 * 以及 `.pmm` 的对象字段，一起换到新根；新根从工程目录往上自动找。
 *
 * 与产品 `搬家` 的差别（也是"产品要改什么"的实物证明）：
 *   ① 支持**多个**死根（这两套工程同时有 `D:\MMD一键渲染工程项目` 与 `H:\UserFile`）；
 *   ② `.emm` 的 `[Effect]` / `[Effect@…]` 段**也改**（产品只改 `[Object]`）；
 *   ③ 字节级换根，**等号两侧的空格原样保留**（不重新拼 `键=值`）。
 */
#[test]
#[ignore]
fn 香港观塘_完整根替换迁移() {
    let 输出 = std::env::var("MIG_输出").unwrap_or_else(|_| format!(r"{工程根}\1"));
    fs::create_dir_all(&输出).expect("建不出输出目录");
    let 输出p = Path::new(&输出);

    for 名 in 工程 {
        println!("\n================ 完整根替换：{名} ================");
        let (pmm, emm, s) = 扫一套(名);
        let 原pmm = fs::read(&pmm).unwrap();
        let 原emm = fs::read(&emm).unwrap();

        /* ---- 收集所有段里的绝对路径取值 ----
           `.emm` 是 GBK：**判盘上有没有必须用 GBK 解出来的文本**（拿字节直接当 UTF-8 会变乱码、
           于是 `is_file()` 永远 false —— 这坑我自己踩过一次）。替换本身仍走字节级。 */
        let mut 全部值: Vec<Vec<u8>> = Vec::new();
        for 行 in 原emm.split(|b| *b == b'\n') {
            if let Some(值) = 取值(行) {
                全部值.push(值);
            }
        }
        let 值文本: Vec<String> = 全部值
            .iter()
            .map(|v| {
                /* **末尾要 trim**：我是按 `\n` 切的，CRLF 的 `\r` 会留在值尾巴上，
                   不 trim 的话 `is_file()` 永远 false（这坑我也踩了一次） */
                encoding_rs::GBK.decode(v).0.trim_end().to_string()
            })
            .collect();
        let 条数 = 全部值.len();
        /* 文本 → 前 N 段（分量由 `\` 或 `/` 分） */
        let 前缀 = |v: &str, 深: usize| -> String {
            let 段: Vec<&str> = v.split(['\\', '/']).collect();
            if 段.len() <= 深 {
                return String::new();
            }
            段[..深].join("\\")
        };
        /* 从浅到深按前缀分组：每个组找一个"新根"，能全解开就收下，并把这些值标记为已覆盖。
           这两套工程里 depth=2 正好分出 `D:\MMD一键渲染工程项目` 与 `H:\UserFile` 两个死根。 */
        let mut 覆盖 = vec![false; 条数];
        let mut 表: Vec<(Vec<u8>, Vec<u8>)> = Vec::new();
        let 祖先: Vec<PathBuf> = {
            let mut v = Vec::new();
            let mut cur = Some(Path::new(&pmm).parent().unwrap().to_path_buf());
            while let Some(d) = cur {
                v.push(d.clone());
                cur = d.parent().map(|p| p.to_path_buf());
            }
            v
        };
        for 深 in 2..=4usize {
            let mut 组: std::collections::HashMap<String, Vec<usize>> =
                std::collections::HashMap::new();
            for (i, v) in 值文本.iter().enumerate() {
                if 覆盖[i] {
                    continue;
                }
                let p = 前缀(v, 深);
                if p.len() < 4 {
                    continue;
                }
                组.entry(p).or_default().push(i);
            }
            for (根, 序号) in 组.iter() {
                let mut 选中: Option<(usize, String)> = None;
                for d in 祖先.iter() {
                    let mut 中 = 0;
                    for i in 序号.iter() {
                        let 尾 = 值文本[*i][根.len()..].trim_start_matches('\\').to_string();
                        if !尾.is_empty() && d.join(&尾).is_file() {
                            中 += 1;
                        }
                    }
                    if 选中.as_ref().map(|(n, _)| 中 > *n).unwrap_or(true) {
                        选中 = Some((中, d.to_string_lossy().to_string()));
                    }
                    if 中 == 序号.len() {
                        break;
                    }
                }
                let Some((n, d)) = 选中 else { continue };
                if n == 序号.len() {
                    println!(
                        "  死根 {根:?}（{} 条，按 {深} 段分组）→ 新根 {d:?}  ★ 全部解开",
                        序号.len()
                    );
                    表.push((编gbk(根), 编gbk(&d)));
                    for i in 序号.iter() {
                        覆盖[*i] = true;
                    }
                }
            }
        }
        println!(
            "  .emm 里绝对路径 {条数} 条，被映射覆盖 {} 条",
            覆盖.iter().filter(|x| **x).count()
        );
        for (i, v) in 值文本.iter().enumerate() {
            if !覆盖[i] {
                println!("    ! 没覆盖：{v}");
            }
        }
        assert!(!表.is_empty(), "一个死根都没找到 —— 映射逻辑没生效，后面的检查都会变成空断言");

        /* 对象路径的公共旧根也要有映射（.pmm 的对象字段用它） */
        let 旧根对象 = 公共旧根(&s.objects.iter().map(|o| o.path.clone()).collect::<Vec<_>>());
        let 对象根 = 编gbk(&旧根对象);
        let 对象新根 = if let Some((_, 新)) = 表.iter().find(|(k, _)| *k == 对象根) {
            /* `表` 里存的是**GBK 字节**（替换用得上），这里要变回文本 —— 必须按 GBK 解！
               我先前用了 `from_utf8_lossy`，于是新根里的中文变成乱码、
               `.pmm` 里 `mmd集成工具` / `香港_by_胧月兔` 直接查不到（自己踩的坑，靠字节核对抓出来的） */
            encoding_rs::GBK.decode(新).0.to_string()
        } else {
            /* 对象尾部是 `UserFile\…`，所以新根要比"某个已找到的新根"往上一级 */
            let 候选 = 表
                .iter()
                .filter(|(k, _)| {
                    let ks = encoding_rs::GBK.decode(k).0.to_string();
                    !ks.is_empty() && 旧根对象.starts_with(&ks)
                })
                .map(|(_, v)| encoding_rs::GBK.decode(v).0.to_string())
                .next();
            match 候选 {
                Some(v) => {
                    let 上 = Path::new(&v)
                        .parent()
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_default();
                    println!("  对象公共旧根 {旧根对象:?} → 新根 {上:?}");
                    表.push((对象根.clone(), 编gbk(&上)));
                    上
                }
                None => {
                    println!("    ! 对象公共旧根 {旧根对象:?} 没找到新根");
                    String::new()
                }
            }
        };
        assert!(!对象新根.is_empty(), "对象路径没有新根，.pmm 改不了");
        println!("  对象新根（给 .pmm 用的那个串）= {对象新根:?}");
        println!("  对象新根的 GBK 字节前 40 个 = {:02X?}", &编gbk(&对象新根)[..编gbk(&对象新根).len().min(40)]);

        /* ---- .pmm：对象字段（定长 256，覆盖该路径的每一处） ---- */
        let (hits, _) = crate::project::找字段(&原pmm, &s.objects);
        let mut 字节 = 原pmm.clone();
        let mut 改字段数 = 0;
        let mut 范围: Vec<(usize, usize)> = Vec::new();
        for h in hits.iter() {
            let 尾 = 尾路径(&旧根对象, &h.path);
            let 新 = Path::new(&对象新根).join(&尾).to_string_lossy().to_string();
            for off in h.全部.iter() {
                if crate::project::改字段(&mut 字节, *off, &新).is_ok() {
                    改字段数 += 1;
                    范围.push((*off, *off + 256));
                }
            }
        }

        /* ---- .emm：所有段，字节级换根（保留 CRLF 与等号两侧空格） ---- */
        let 换过 = |行: &[u8]| 换根_行(行, &表).1;
        let mut 新emm: Vec<u8> = Vec::with_capacity(原emm.len() + 4096);
        let mut 改行 = 0;
        let 行们: Vec<&[u8]> = 原emm.split(|b| *b == b'\n').collect();
        for (i, 段) in 行们.iter().enumerate() {
            /* 末尾那段可能是空串（文件以 \n 结尾）；CRLF 的 \r 留在段尾，原样带回去 */
            if i > 0 {
                新emm.push(b'\n');
            }
            if 段.is_empty() {
                continue;
            }
            let (新段, 改没) = 换根_行(段, &表);
            if 改没 {
                改行 += 1;
            }
            新emm.extend_from_slice(&新段);
        }
        let _ = 换过;
        println!("  .pmm 改 {改字段数} 处字段；.emm 改 {改行} 行（共 {} 行）", 行们.len());

        /* ---- 写盘 ---- */
        let 名p = Path::new(&pmm).file_name().unwrap().to_string_lossy().to_string();
        let 名e = Path::new(&emm).file_name().unwrap().to_string_lossy().to_string();
        let 出pmm = 输出p.join(&名p);
        let 出emm = 输出p.join(&名e);
        fs::write(&出pmm, &字节).unwrap();
        fs::write(&出emm, &新emm).unwrap();

        /* ---- 回读：只认盘上 ---- */
        let 盘pmm = fs::read(&出pmm).unwrap();
        let 盘emm = fs::read(&出emm).unwrap();
        assert_eq!(盘pmm, 字节, "盘上 .pmm 与内存不一致");
        assert_eq!(盘emm, 新emm, "盘上 .emm 与内存不一致");
        assert_eq!(盘pmm.len(), 原pmm.len(), ".pmm 长度必须不变");
        let 变了 = (0..原pmm.len()).filter(|i| 原pmm[*i] != 盘pmm[*i]).count();
        let 越界 = (0..原pmm.len())
            .filter(|i| 原pmm[*i] != 盘pmm[*i])
            .filter(|i| !范围.iter().any(|(a, b)| i >= a && i < b))
            .count();
        println!("  .pmm {} B（原 {}，相同）/ 差异 {变了} 字节，字段外 {越界} 个", 盘pmm.len(), 原pmm.len());
        assert_eq!(越界, 0, "有差异字节落在字段之外");

        /* 死根在产物里必须一个不剩 */
        let 针数 = |h: &[u8], 针: &[u8]| -> usize {
            if 针.is_empty() || h.len() < 针.len() {
                return 0;
            }
            h.windows(针.len()).filter(|w| *w == 针).count()
        };
        let mut 残留 = 0;
        for (根, _) in 表.iter() {
            let a = 针数(&盘pmm, 根);
            let b = 针数(&盘emm, 根);
            if a > 0 || b > 0 {
                println!(
                    "    ! 死根 {:?} 在产物里还剩：.pmm {a} 次 / .emm {b} 次",
                    String::from_utf8_lossy(根)
                );
                残留 += a + b;
            }
        }
        println!("  死根残留合计：{残留} 次（必须是 0）");
        assert_eq!(残留, 0, "产物里不该再有死根");

        /* 产物里每条被引用文件都在盘上吗（.emm 全段 + 对象） */
        let mut 在 = 0;
        let mut 缺 = 0;
        let mut 缺例: Vec<String> = Vec::new();
        for 行 in 盘emm.split(|b| *b == b'\n') {
            let Some(值) = 取值(行) else { continue };
            /* 又是 GBK：这里必须按 GBK 解，不然查盘永远是 false */
            let s = encoding_rs::GBK.decode(&值).0.trim().to_string();
            if Path::new(&s).is_file() {
                在 += 1;
            } else {
                缺 += 1;
                if 缺例.len() < 6 {
                    缺例.push(s);
                }
            }
        }
        println!("  产物 .emm 里的绝对路径逐条核对：在盘上 {在} 条 / 缺 {缺} 条");
        for l in 缺例.iter() {
            println!("    ! {l}");
        }
        assert_eq!(缺, 0, "产物 .emm 里仍有指不到文件的绝对路径");
        println!("  完成：{}", 出pmm.display());
    }
}

/**
 * **产品验收**：用产品命令那条路（`migrate_root::找死根` / `搬根`）在香港夜间 2.1 上跑一遍，
 * 输出写到 `…\2`（**不动 `…\1`** —— 那是已经验过能给 MMD 打开的那份，留着对照）。
 *
 * 跑法：`cargo test --lib -- --ignored --nocapture 香港观塘_产品根替换`
 */
#[test]
#[ignore]
fn 香港观塘_产品根替换_写到2() {
    let 名 = 工程[0];
    let pmm = format!(r"{工程根}\UserFile\{名}.pmm");
    let emm = format!(r"{工程根}\UserFile\{名}.emm");
    let 输出 = format!(r"{工程根}\2");
    let 输出p = Path::new(&输出);
    /* 允许重跑：先把上次产物清掉（**只清我们自己的输出目录**，素材一个字节都不碰） */
    if 输出p.exists() {
        for e in fs::read_dir(输出p).unwrap().flatten() {
            let _ = fs::remove_file(e.path());
        }
    }

    println!("\n================ 产品根替换验收：{名} ================");
    let 根们 = crate::migrate_root::找死根(&pmm, &emm).expect("找根不该失败");
    println!("  发现旧根 {} 个：", 根们.len());
    let mut 表: Vec<(String, String)> = Vec::new();
    for g in 根们.iter() {
        println!(
            "    {:?}：{} 条，建议新根 {:?}（解开 {}/{}）",
            g.根, g.条数, g.建议, g.建议命中, g.条数
        );
        for 例 in g.例.iter().take(2) {
            println!("        例：{例}");
        }
        if !g.建议.is_empty() {
            表.push((g.根.clone(), g.建议.clone()));
        }
    }
    assert!(!表.is_empty(), "一个能用的新根都没有，验收跑不下去");

    let r = crate::migrate_root::搬根(
        pmm.clone(),
        emm.clone(),
        表.clone(),
        vec![],
        输出.clone(),
        false,
    )
    .expect("产品搬根应当能写盘");

    println!("  ---- 产品返回的数字 ----");
    println!("  根表 {} 组；.pmm 改字段 {} 处；.emm 改行 {} 行", r.根表.len(), r.pmm改字段, r.emm改行);
    println!(
        "  .pmm 长度 {} → {}（{}）；.emm 长度 {} → {}",
        r.原先pmm长度,
        r.pmm长度,
        if r.pmm长度 == r.原先pmm长度 { "相同 ✓" } else { "不同 ✗" },
        r.原先emm长度,
        r.emm长度
    );
    for (根, n) in r.旧根残留.iter() {
        println!("  盘上回读：旧根 {根:?} 残留 {n} 次（必须 0）");
    }
    for (根, n) in r.新根出现.iter() {
        println!("  盘上回读：新根 {根:?} 出现 {n} 次（必须 > 0）");
    }
    for p in r.问题.iter() {
        println!("  问题：{p}");
    }
    assert_eq!(r.pmm长度, r.原先pmm长度, ".pmm 长度必须不变");
    assert_eq!(r.旧根残留.iter().map(|(_, n)| *n).sum::<usize>(), 0, "旧根必须归零");
    assert!(r.新根出现.iter().all(|(_, n)| *n > 0), "新根必须在产物里出现");

    /* ---- 独立核对（不靠产品自报）---- */
    let 名p = Path::new(&pmm).file_name().unwrap().to_string_lossy().to_string();
    let 名e = Path::new(&emm).file_name().unwrap().to_string_lossy().to_string();
    let 盘pmm = fs::read(输出p.join(&名p)).expect("盘上没有 .pmm 产物");
    let 盘emm = fs::read(输出p.join(&名e)).expect("盘上没有 .emm 产物");
    let 原pmm = fs::read(&pmm).unwrap();
    let 原emm = fs::read(&emm).unwrap();
    println!("  ---- 独立核对 ----");
    for (根, _) in 表.iter() {
        println!(
            "  死根 {根:?}：.pmm {} → {}；.emm {} → {}",
            数(&原pmm, 根),
            数(&盘pmm, 根),
            数(&原emm, 根),
            数(&盘emm, 根)
        );
    }
    /* 逐段统计"被换掉的行"落在哪个段（[Effect] 段的大头必须也换到）
       **按 GBK 解** —— 拿 `from_utf8_lossy` 解 GBK 会变乱码，中文判据全废（这坑踩过两次了） */
    let 文本 = encoding_rs::GBK.decode(&盘emm).0.to_string();
    let mut 段 = String::new();
    let mut 按段: std::collections::HashMap<String, (usize, usize)> =
        std::collections::HashMap::new();
    let mut 旧全: usize = 0;
    for 行 in 文本.split("\r\n") {
        if 行.starts_with('[') && 行.ends_with(']') {
            段 = 行.trim_matches(['[', ']']).to_string();
            continue;
        }
        let 有旧 = 表.iter().any(|(根, _)| 行.contains(根.as_str()));
        if 有旧 {
            旧全 += 1;
        }
        if let Some(eq) = 行.find('=') {
            let v = 行[eq + 1..].trim_start();
            if v.len() >= 3 && v.as_bytes()[1] == b':' {
                let e = 按段.entry(段.clone()).or_insert((0, 0));
                e.1 += 1;
                if v.starts_with('E') && v.contains("香港_by_胧月兔") {
                    e.0 += 1;
                }
            }
        }
    }
    let mut 键: Vec<_> = 按段.into_iter().collect();
    键.sort_by(|a, b| b.1 .1.cmp(&a.1 .1));
    let 绝对 = 键.iter().map(|(_, v)| v.1).sum::<usize>();
    let 换成新 = 键.iter().map(|(_, v)| v.0).sum::<usize>();
    println!("  产物 .emm 里绝对路径行 {绝对} 条，其中已指向新根 {换成新} 条（目标 {}/{绝对}）", 绝对);
    println!("  （残留旧根的行 {旧全} 条 —— 必须 0）");
    for (k, v) in 键.iter().take(6) {
        println!("    [{k}] 绝对路径 {} 条 / 换成新根 {} 条", v.1, v.0);
    }
    assert_eq!(旧全, 0, "产物 .emm 里不该再有旧根");
    assert_eq!(换成新, 绝对, "产物 .emm 里每条绝对路径都该指向新根");

    /* 产物里每条绝对路径都要真的在盘上 */
    let mut 在 = 0;
    let mut 缺: Vec<String> = Vec::new();
    for 行 in 文本.split("\r\n") {
        let Some(eq) = 行.find('=') else { continue };
        let v = 行[eq + 1..].trim();
        if v.len() >= 3 && v.as_bytes()[1] == b':' {
            if Path::new(v).is_file() {
                在 += 1;
            } else if 缺.len() < 6 {
                缺.push(v.to_string());
            }
        }
    }
    println!("  产物 .pmm/emm 路径查盘：.emm 这边在盘上 {在} 条 / 抽查缺 {缺:?}");
    assert!(缺.is_empty(), "产物里不该有指不到文件的绝对路径");
    let mut pmm缺: Vec<String> = Vec::new();
    let 文本pmm = encoding_rs::GBK.decode(&盘pmm).0.to_string();
    let mut 在p = 0;
    for 段 in 文本pmm.split('\u{0}') {
        let t = 段.trim();
        let b = t.as_bytes();
        if b.len() >= 3 && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/') {
            if Path::new(t).is_file() {
                在p += 1;
            } else if pmm缺.len() < 6 {
                pmm缺.push(t.to_string());
            }
        }
    }
    println!("  产物 .pmm 里能认出来的路径：在盘上 {在p} 条 / 抽查缺 {pmm缺:?}");
    assert!(pmm缺.is_empty(), "产物 .pmm 里不该有指不到文件的路径");

    /* `.emm` 除绝对路径行外逐行一致 */
    let 原文本 = encoding_rs::GBK.decode(&原emm).0.to_string();
    let 剥 = |t: &str| {
        t.split("\r\n")
            .filter(|l| !l.contains(":\\"))
            .collect::<Vec<_>>()
            .join("\r\n")
    };
    assert_eq!(剥(&原文本), 剥(&文本), ".emm 除绝对路径行外必须逐行一致");
    println!("  .emm 除绝对路径行外：与原文逐行一致 ✓");
    println!("  产物：{}", 输出);
}

/// 递归列文件（量具用；`.pmm` 可能在几层子目录里）
fn 列文件(根: &Path) -> Vec<PathBuf> {
    let mut 出 = Vec::new();
    let mut 栈 = vec![根.to_path_buf()];
    while let Some(d) = 栈.pop() {
        let Ok(读) = fs::read_dir(&d) else { continue };
        for e in 读.flatten() {
            let p = e.path();
            if p.is_dir() {
                栈.push(p);
            } else {
                出.push(p);
            }
        }
    }
    出.sort();
    出
}

/**
 * 真语料覆盖面：**别的工程里，死根长什么样、藏在哪个段、`.pmm` 里有没有藏在对象字段之外的**。
 *
 * 只读（`D:\9.26mmd`）。跑法：`cargo test --lib -- --ignored --nocapture 真语料_找根覆盖面`
 *
 * 要回答两件事：
 *   ① `找死根` 在真工程上认出的根对不对（数量 / 条数 / 建议能否解开）；
 *   ② **最要紧**：`.pmm` 里某个死根出现次数，是否**等于**对象字段能解释的次数 ——
 *      多了就说明"绝对路径藏在对象字段之外"，而产品现在对这种只会**拒绝**。
 */
#[test]
#[ignore]
fn 真语料_找根覆盖面() {
    let 根 = Path::new(r"D:\9.26mmd");
    if !根.exists() {
        println!("  跳过：没有 {根:?}");
        return;
    }
    let mut pmm们: Vec<std::path::PathBuf> = Vec::new();
    for p in 列文件(根) {
        if p.extension().map(|e| e.eq_ignore_ascii_case("pmm")) == Some(true) && p.with_extension("emm").is_file() {
            pmm们.push(p);
        }
    }
    pmm们.sort();
    println!("\n真工程 {} 个（只读）", pmm们.len());
    let mut 有死根 = 0;
    let mut 藏别处 = 0;
    let mut 总根 = 0;
    let mut 总条 = 0;
    for p in pmm们.iter().take(60) {
        let emm = p.with_extension("emm");
        let (Ok(根们), Ok(字节)) = (crate::migrate_root::找死根(&p.to_string_lossy(), &emm.to_string_lossy()), fs::read(p)) else {
            continue;
        };
        if 根们.is_empty() {
            continue;
        }
        有死根 += 1;
        let 对象 = crate::project::parse_emm(&crate::migrate_root::读emm文本(&emm)).objects;
        let 命中 = crate::project::找字段(&字节, &对象).0;
        let 字段总数: usize = 命中.iter().map(|h| h.全部.len()).sum();
        println!(
            "\n  {}：{} 个死根，{} 条（对象 {} 个，字段命中 {} 处）",
            p.file_name().unwrap().to_string_lossy(),
            根们.len(),
            根们.iter().map(|g| g.条数).sum::<usize>(),
            对象.len(),
            字段总数
        );
        for g in 根们.iter() {
            总根 += 1;
            总条 += g.条数;
            let 总出现 = crate::migrate_root::数出现(&字节, &crate::migrate_root::编gbk串(&g.根));
            /* 这个根下有多少条是**对象路径**（对象字段能解释的） */
            let 对象里 = 对象.iter().filter(|o| o.path.starts_with(g.根.as_str())).count();
            let 建议 = if g.建议.is_empty() {
                "（没试出新根）".to_string()
            } else {
                format!("{}（{}/{}）", g.建议, g.建议命中, g.条数)
            };
            println!(
                "    {:<44} {} 条 ｜ 本机有 {} ｜ .pmm 出现 {} 次（字段共 {} 处） ｜ 对象里 {} 条 ｜ 建议 {}",
                format!("{:?}", g.根),
                g.条数,
                g.在盘条数,
                总出现,
                字段总数,
                对象里,
                建议
            );
            /* 判据：`.pmm` 里的出现次数**不该超过"对象字段总处数"**（字段会留残留，所以是上界）。
               超过就说明这个根在 `.pmm` 里出现在别的地方 —— 产品现在对那种只会拒绝。 */
            if 总出现 > 字段总数 {
                藏别处 += 1;
                println!(
                    "      ! 出现 {总出现} 次 > 对象字段 {字段总数} 处 —— 有藏在别处的（产品对这种只会拒绝）"
                );
            }
        }
    }
    println!(
        "\n  合计：有死根的工程 {有死根} 个、死根 {总根} 个 / {总条} 条；**出现次数多于对象字段的根：{藏别处} 个**"
    );
}

/**
 * **逐条指定验收**：把工程里引用的**几个东西挪到别处**（副本，素材只读），
 * 用「逐条指定」把它们指过去 → 写盘 → 盘上回读。
 *
 * 跑法：`cargo test --lib -- --ignored --nocapture 香港观塘_逐条指定_写到2`
 *
 * 挪的三样：① 一个模型的**整个目录**（贴图跟着走，这才像真挪法）；② 一个附件 `.x`；③ 一个特效 `.fx`。
 */
#[test]
#[ignore]
fn 香港观塘_逐条指定_写到2() {
    let 名 = 工程[0];
    let pmm = format!(r"{工程根}\UserFile\{名}.pmm");
    let emm = format!(r"{工程根}\UserFile\{名}.emm");
    let 输出 = format!(r"{工程根}\2");
    let 挪走根 = 暂存根().join("⑥验收").join("挪走的");
    let 输出p = Path::new(&输出);
    if 输出p.exists() {
        for e in fs::read_dir(输出p).unwrap().flatten() {
            let _ = fs::remove_file(e.path());
        }
    }
    let _ = fs::remove_dir_all(&挪走根);
    fs::create_dir_all(&挪走根).unwrap();

    println!("\n================ 逐条指定验收：{名} ================");
    let 根们 = crate::migrate_root::找死根(&pmm, &emm).expect("找根");
    let 根表: Vec<(String, String)> = 根们
        .iter()
        .filter(|g| !g.建议.is_empty())
        .map(|g| (g.根.clone(), g.建议.clone()))
        .collect();
    println!("  根表 {} 组", 根表.len());

    /* 挑三样来"挪走"：一个模型目录、一个附件文件、一个特效文件 */
    let 文本 = crate::migrate_root::读emm文本(Path::new(&emm));
    let mut 挑: Vec<(String, String, &str)> = Vec::new(); // (原路径, 副本路径, 说明)
    let mut 段 = String::new();
    for 行 in 文本.split("\r\n") {
        if 行.starts_with('[') && 行.ends_with(']') {
            段 = 行.trim_matches(['[', ']']).to_string();
            continue;
        }
        let Some(eq) = 行.find('=') else { continue };
        let v = 行[eq + 1..].trim().to_string();
        if v.len() < 4 || v.as_bytes()[1] != b':' {
            continue;
        }
        let 落 = crate::migrate_root::定目标(&v, &根表).0;
        if 落.is_empty() || !Path::new(&落).is_file() {
            continue;
        }
        let 低 = v.to_lowercase();
        if 挑.iter().any(|(a, _, _)| a == &v) {
            continue;
        }
        if 挑.len() < 3 {
            if 低.ends_with("香港观瑭\\香港观瑭.pmx") && 段 == "Object" {
                /* 整个目录拷过去（贴图跟着走） */
                let 源 = Path::new(&落).parent().unwrap();
                let 目标 = 挪走根.join("香港观瑭");
                fs::create_dir_all(&目标).unwrap();
                let mut n = 0;
                for f in 列文件(源) {
                    if let Some(名) = f.file_name() {
                        if fs::copy(&f, 目标.join(名)).is_ok() {
                            n += 1;
                        }
                    }
                }
                println!("  挪走：整个模型目录（{n} 个文件）→ {}", 目标.display());
                挑.push((v.clone(), 目标.join("香港观瑭.pmx").to_string_lossy().to_string(), "模型整目录"));
            } else if 低.ends_with("ray-mmd-1.5.2\\ray.x") {
                let 目标 = 挪走根.join("ray_搬走了.x");
                fs::copy(&落, &目标).unwrap();
                println!("  挪走：附件 → {}", 目标.display());
                挑.push((v.clone(), 目标.to_string_lossy().to_string(), "附件"));
            } else if 低.ends_with("main\\main.fx") {
                let 目标 = 挪走根.join("main_搬走了.fx");
                fs::copy(&落, &目标).unwrap();
                println!("  挪走：特效 → {}", 目标.display());
                挑.push((v.clone(), 目标.to_string_lossy().to_string(), "特效"));
            }
        }
    }
    assert_eq!(挑.len(), 3, "三样都要挑到（模型目录 / 附件 / 特效），实挑到 {}：{挑:?}", 挑.len());

    /* 逐条映射（原路径 → 现在在哪） */
    let 逐条: Vec<(String, String)> = 挑.iter().map(|(a, b, _)| (a.clone(), b.clone())).collect();

    /* 先干跑：看状态对不对（这三条必须是"已逐条指定"，其余走根规则） */
    let 表 = crate::migrate_root::列路径(
        pmm.clone(),
        emm.clone(),
        根表.clone(),
        逐条.clone(),
    )
    .expect("列路径");
    let 没落定: Vec<_> = 表.iter().filter(|r| r.目标.is_empty()).collect();
    println!("  列路径：共 {} 行，没落定 {}", 表.len(), 没落定.len());
    for (原, 新, 说明) in 挑.iter() {
        let r = 表.iter().find(|r| &r.原路径 == 原).expect("那条要在表里");
        println!("    [{说明}] {} → {}", r.状态, r.目标);
        assert_eq!(r.目标, *新, "[{说明}]逐条指定必须压过根规则");
    }
    assert!(没落定.is_empty(), "不该有没落定的：{没落定:?}");

    let r = crate::migrate_root::搬根(
        pmm.clone(),
        emm.clone(),
        根表.clone(),
        逐条.clone(),
        输出.clone(),
        false,
    )
    .expect("逐条指定 + 根规则应当能写盘");
    println!("  .pmm 改字段 {} 处；.emm 改行 {} 行；长度 {} → {}", r.pmm改字段, r.emm改行, r.原先pmm长度, r.pmm长度);
    assert_eq!(r.pmm长度, r.原先pmm长度, ".pmm 长度必须不变");

    /* ---- 盘上回读 ---- */
    let 名p = Path::new(&pmm).file_name().unwrap().to_string_lossy().to_string();
    let 名e = Path::new(&emm).file_name().unwrap().to_string_lossy().to_string();
    let 盘emm = fs::read(输出p.join(&名e)).unwrap();
    let 盘pmm = fs::read(输出p.join(&名p)).unwrap();
    let 产 = encoding_rs::GBK.decode(&盘emm).0.to_string();
    for (原, 新, 说明) in 挑.iter() {
        let 在 = 产.contains(新.as_str());
        println!("    [{说明}] 产物里有新位置？{在} —— {新}");
        assert!(在, "[{说明}] 产物里应当指向挪走后的位置");
        assert!(!产.contains(原.as_str()), "[{说明}] 旧路径不该剩");
        assert!(Path::new(新).is_file(), "[{说明}] 新位置得真在盘上");
    }
    /* 每条绝对路径都在盘上 + 除绝对路径行外与原文逐行一致 */
    let mut 在 = 0;
    let mut 缺: Vec<String> = Vec::new();
    for 行 in 产.split("\r\n") {
        let Some(eq) = 行.find('=') else { continue };
        let v = 行[eq + 1..].trim();
        if v.len() >= 3 && v.as_bytes()[1] == b':' {
            if Path::new(v).is_file() {
                在 += 1;
            } else if 缺.len() < 6 {
                缺.push(v.to_string());
            }
        }
    }
    println!("  产物 .emm 绝对路径：在盘上 {在} 条 / 缺 {:?}", 缺);
    assert!(缺.is_empty(), "产物里每条都该在盘上");
    let 原文本 = crate::migrate_root::读emm文本(Path::new(&emm));
    let 剥 = |t: &str| t.split("\r\n").filter(|l| !l.contains(":\\")).collect::<Vec<_>>().join("\r\n");
    assert_eq!(剥(&原文本), 剥(&产), ".emm 除绝对路径行外必须逐行一致");
    println!("  .emm 除绝对路径行外：与原文逐行一致 ✓");
    /* `.pmm` 里也要核对（对象字段是 MMD 真正读的那份） */
    let 产p = encoding_rs::GBK.decode(&盘pmm).0.to_string();
    for (原, 新, 说明) in 挑.iter() {
        if 说明 == &"模型整目录" {
            assert!(产p.contains(新.as_str()), "对象字段里的新路径要在 .pmm 里");
            assert!(!产p.contains(原.as_str()), "对象字段里的旧路径不许剩");
        }
    }
    println!("  .pmm 对象字段核对：挪走的模型指向新位置 ✓");
    println!("  产物：{输出}");
}

/**
 * **逐条指定层的验收（输出 `…\3`，`1\` 与 `2\` 都不动）**
 *
 * 跑法：`cargo test --lib -- --ignored --nocapture 香港观塘_逐条指定_写到3`
 *
 * 两段：① 只按根替换 → 写 `…\3` → 与 `…\1`（已确认能给 MMD 打开那份）**逐字节比对**（回归）；
 * ② 在 `测试效果\` 里造副本、人为挪走三样（素材只读）→ 逐条指定 → 覆盖写 `…\3` → 回读核对。
 */
#[test]
#[ignore]
fn 香港观塘_逐条指定_写到3() {
    let 名 = 工程[0];
    let pmm = format!(r"{工程根}\UserFile\{名}.pmm");
    let emm = format!(r"{工程根}\UserFile\{名}.emm");
    let 输出 = format!(r"{工程根}\3");
    let 输出p = Path::new(&输出);
    let 挪走根 = 暂存根().join("⑥验收").join("逐条挪走");
    let 名p = Path::new(&pmm).file_name().unwrap().to_string_lossy().to_string();
    let 名e = Path::new(&emm).file_name().unwrap().to_string_lossy().to_string();
    let 清输出 = || {
        if 输出p.exists() {
            for e in fs::read_dir(输出p).unwrap().flatten() {
                let _ = fs::remove_file(e.path());
            }
        }
    };
    清输出();

    println!("\n================ 逐条指定层验收：{名} ================");
    let 根们 = crate::migrate_root::找死根(&pmm, &emm).expect("找根");
    let 根表: Vec<(String, String)> = 根们
        .iter()
        .filter(|g| !g.建议.is_empty())
        .map(|g| (g.根.clone(), g.建议.clone()))
        .collect();
    println!("  发现旧根 {} 个（可用 {} 组）", 根们.len(), 根表.len());

    /* ---------- ① 只按根替换：回归到那份已验过的产物 ---------- */
    let r1 = crate::migrate_root::搬根(
        pmm.clone(),
        emm.clone(),
        根表.clone(),
        vec![],
        输出.clone(),
        false,
    )
    .expect("只按根替换应当能写盘");
    let 三p = fs::read(输出p.join(&名p)).unwrap();
    let 三e = fs::read(输出p.join(&名e)).unwrap();
    println!(
        "  ① 只按根：改字段 {} 处 / 改行 {} 行；长度 {} → {}",
        r1.pmm改字段, r1.emm改行, r1.原先pmm长度, r1.pmm长度
    );
    let 一p = Path::new(&format!(r"{工程根}\1")).join(&名p);
    let 一e = Path::new(&format!(r"{工程根}\1")).join(&名e);
    if 一p.is_file() && 一e.is_file() {
        let a = fs::read(&一p).unwrap();
        let b = fs::read(&一e).unwrap();
        println!(
            "  ① 与 `1\\` 逐字节比对：.pmm {} / .emm {}",
            if a == 三p { "相同 ✓" } else { "不同 ✗" },
            if b == 三e { "相同 ✓" } else { "不同 ✗" }
        );
        assert_eq!(a, 三p, "只按根替换的结果必须与 1\\ 逐字节相同（回归）");
        assert_eq!(b, 三e, "只按根替换的结果必须与 1\\ 逐字节相同（回归）");
    } else {
        println!("  ① 跳过与 `1\\` 的比对（那份不在了）");
    }

    /* ---------- ② 造副本 + 人为挪走三样 ---------- */
    let _ = fs::remove_dir_all(&挪走根);
    fs::create_dir_all(&挪走根).unwrap();
    let 文本 = crate::migrate_root::读emm文本(Path::new(&emm));
    let mut 挑: Vec<(String, String, &str)> = Vec::new();
    let mut 段 = String::new();
    for 行 in 文本.split("\r\n") {
        if 行.starts_with('[') && 行.ends_with(']') {
            段 = 行.trim_matches(['[', ']']).to_string();
            continue;
        }
        let Some(eq) = 行.find('=') else { continue };
        let v = 行[eq + 1..].trim().to_string();
        if v.len() < 4 || v.as_bytes()[1] != b':' {
            continue;
        }
        let 落 = crate::migrate_root::定目标(&v, &根表).0;
        if 落.is_empty() || !Path::new(&落).is_file() || 挑.iter().any(|(a, _, _)| a == &v) {
            continue;
        }
        let 低 = v.to_lowercase();
        if 挑.len() < 3 {
            if 低.ends_with("香港观瑭\\香港观瑭.pmx") && 段 == "Object" {
                let 源 = Path::new(&落).parent().unwrap();
                let 目标 = 挪走根.join("香港观瑭");
                fs::create_dir_all(&目标).unwrap();
                let mut n = 0;
                for f in 列文件(源) {
                    if let Some(名f) = f.file_name() {
                        if fs::copy(&f, 目标.join(名f)).is_ok() {
                            n += 1;
                        }
                    }
                }
                println!("  ② 挪走：整个模型目录（{n} 个文件）→ {}", 目标.display());
                挑.push((v.clone(), 目标.join("香港观瑭.pmx").to_string_lossy().to_string(), "模型整目录"));
            } else if 低.ends_with("ray-mmd-1.5.2\\ray.x") {
                let 目标 = 挪走根.join("ray_挪走了.x");
                fs::copy(&落, &目标).unwrap();
                println!("  ② 挪走：附件 → {}", 目标.display());
                挑.push((v.clone(), 目标.to_string_lossy().to_string(), "附件"));
            } else if 低.ends_with("main\\main.fx") {
                let 目标 = 挪走根.join("main_挪走了.fx");
                fs::copy(&落, &目标).unwrap();
                println!("  ② 挪走：特效 → {}", 目标.display());
                挑.push((v.clone(), 目标.to_string_lossy().to_string(), "特效"));
            }
        }
    }
    assert_eq!(挑.len(), 3, "三样都要挑到，实得 {}：{挑:?}", 挑.len());
    let 逐条: Vec<(String, String)> = 挑.iter().map(|(a, b, _)| (a.clone(), b.clone())).collect();

    /* 状态：这三条必须"已逐条指定"，其余走根规则；且没有没落定的 */
    let 表 =
        crate::migrate_root::列路径(pmm.clone(), emm.clone(), 根表.clone(), 逐条.clone()).expect("列路径");
    let 没落定: Vec<_> = 表.iter().filter(|r| r.目标.is_empty()).collect();
    println!("  ② 列路径：{} 行，没落定 {}（必须 0）", 表.len(), 没落定.len());
    for (原, 新, 说明) in 挑.iter() {
        let r = 表.iter().find(|r| &r.原路径 == 原).expect("那条要在表里");
        println!("    [{说明}] {} → {}", r.状态, r.目标);
        assert_eq!(r.状态, "已逐条指定", "[{说明}] 用户指定过的必须压过根规则");
        assert_eq!(r.目标, *新);
    }
    assert!(没落定.is_empty(), "不该有没落定的：{没落定:?}");

    /* ---------- 覆盖写 `…\3` ---------- */
    清输出();
    let r2 = crate::migrate_root::搬根(
        pmm.clone(),
        emm.clone(),
        根表.clone(),
        逐条.clone(),
        输出.clone(),
        false,
    )
    .expect("逐条指定 + 根规则应当能写盘");
    println!(
        "  ② 写盘：改字段 {} 处 / 改行 {} 行；.pmm {} → {}（{}）",
        r2.pmm改字段,
        r2.emm改行,
        r2.原先pmm长度,
        r2.pmm长度,
        if r2.pmm长度 == r2.原先pmm长度 { "长度相同 ✓" } else { "长度不同 ✗" }
    );
    println!("  ② 盘上回读：旧根残留 {:?}", r2.旧根残留);
    assert_eq!(r2.pmm长度, r2.原先pmm长度, ".pmm 长度必须不变");
    assert_eq!(r2.旧根残留.iter().map(|(_, n)| *n).sum::<usize>(), 0, "旧根必须归零");

    /* ---------- 回读核对 ---------- */
    let 盘emm = fs::read(输出p.join(&名e)).unwrap();
    let 盘pmm = fs::read(输出p.join(&名p)).unwrap();
    let 产 = encoding_rs::GBK.decode(&盘emm).0.to_string();
    for (原, 新, 说明) in 挑.iter() {
        println!("    [{说明}] 产物指向 {新}（文件在盘上：{}）", Path::new(新).is_file());
        assert!(产.contains(新.as_str()), "[{说明}] 产物里应当指向挪走后的位置");
        assert!(!产.contains(原.as_str()), "[{说明}] 旧路径不该剩");
    }
    let mut 在 = 0;
    let mut 缺: Vec<String> = Vec::new();
    for 行 in 产.split("\r\n") {
        let Some(eq) = 行.find('=') else { continue };
        let v = 行[eq + 1..].trim();
        if v.len() >= 3 && v.as_bytes()[1] == b':' {
            if Path::new(v).is_file() {
                在 += 1;
            } else if 缺.len() < 6 {
                缺.push(v.to_string());
            }
        }
    }
    println!("  ② 产物 .emm 绝对路径：在盘上 {在} 条 / 缺 {缺:?}");
    assert!(缺.is_empty(), "产物里每条都该在盘上");
    let 原文本 = crate::migrate_root::读emm文本(Path::new(&emm));
    let 剥 = |t: &str| {
        t.split("\r\n")
            .filter(|l| !l.contains(":\\"))
            .collect::<Vec<_>>()
            .join("\r\n")
    };
    assert_eq!(剥(&原文本), 剥(&产), ".emm 除绝对路径行外必须逐行一致");
    println!("  ② .emm 除绝对路径行外：与原文逐行一致 ✓");
    let 产p = encoding_rs::GBK.decode(&盘pmm).0.to_string();
    for (原, 新, 说明) in 挑.iter() {
        if 说明 == &"模型整目录" {
            assert!(产p.contains(新.as_str()), "对象字段里的新路径要在 .pmm 里");
            assert!(!产p.contains(原.as_str()), "对象字段里的旧路径不许剩");
        }
    }
    println!("  ② .pmm 对象字段核对：挪走的模型指向新位置 ✓");
    for d in ["1", "2"] {
        let p = Path::new(&format!(r"{工程根}\{d}")).join(&名p);
        assert!(p.is_file(), "{d}\\ 里那份不该消失");
    }
    println!("  ① `1\\` / `2\\` 都还在 ✓");
    println!("  产物：{输出}");
}

#[test]
#[ignore]
fn 香港观塘_真实迁移() {
    let 输出 = std::env::var("MIG_输出").unwrap_or_else(|_| format!(r"{工程根}\1"));
    let 模型目录 = std::env::var("MIG_模型目录").unwrap_or_default();
    let 附件目录 = std::env::var("MIG_附件目录").unwrap_or_default();
    println!("\n输出目录：{输出}（模型目录={模型目录:?} 附件目录={附件目录:?}）");
    fs::create_dir_all(&输出).expect("建不出输出目录");
    let 输出p = Path::new(&输出);

    for 名 in 工程 {
        println!("\n================ 迁移：{名} ================");
        let pmm = format!(r"{工程根}\UserFile\{名}.pmm");
        let emm = format!(r"{工程根}\UserFile\{名}.emm");
        let 原pmm = fs::read(&pmm).expect("读不了源 .pmm");
        let 原emm = fs::read(&emm).expect("读不了源 .emm");
        let 原pmm长 = 原pmm.len();
        let 原emm长 = 原emm.len();

        let r: 搬家结果 = match 搬家(
            pmm.clone(),
            emm.clone(),
            模型目录.clone(),
            附件目录.clone(),
            输出.clone(),
            false,
            None,
        ) {
            Ok(r) => r,
            Err(msg) => {
                println!("  迁移失败：{msg}");
                println!("  （源文件未被改动，逐条原因见上）");
                continue;
            }
        };
        let 指 = r.表.iter().filter(|x| x.处置 == "指到新位置").count();
        let 保 = r.表.iter().filter(|x| x.处置 == "保持原路径").count();
        let 无 = r.表.iter().filter(|x| x.处置 == "找不到").count();
        println!(
            "  表：对象 {} 条；指到新位置 {} / 保持原路径 {} / 找不到 {}；改了 {} 处",
            r.表.len(),
            指,
            保,
            无,
            r.改了几处
        );
        if !r.问题.is_empty() {
            println!("  问题 {} 条：", r.问题.len());
            for p in r.问题.iter().take(15) {
                println!("    - {p}");
            }
        }

        /* ---- 回读盘上产物（只认盘上，不看内存） ---- */
        let 名p = Path::new(&pmm).file_name().unwrap().to_string_lossy().to_string();
        let 名e = Path::new(&emm).file_name().unwrap().to_string_lossy().to_string();
        let 出pmm = 输出p.join(&名p);
        let 出emm = 输出p.join(&名e);
        let 盘pmm = fs::read(&出pmm).expect("盘上没有产出的 .pmm");
        let 盘emm = fs::read(&出emm).expect("盘上没有产出的 .emm");
        println!(
            "  产物长度：.pmm {} （原 {}，{}）/ .emm {} （原 {}，{}）",
            盘pmm.len(),
            原pmm长,
            if 盘pmm.len() == 原pmm长 { "相同" } else { "不同" },
            盘emm.len(),
            原emm长,
            if 盘emm.len() == 原emm长 { "相同" } else { "不同" }
        );
        println!("  ---- 回读：新旧路径出现次数（盘上产物）----");
        let mut 新路径不存在 = 0;
        for row in r.表.iter().filter(|x| x.处置 == "指到新位置") {
            let 旧p = 数(&盘pmm, &row.旧);
            let 新p = 数(&盘pmm, &row.新);
            let 旧e = 数(&盘emm, &row.旧);
            let 新e = 数(&盘emm, &row.新);
            println!(
                "    {:>6} .pmm 旧{旧p} 新{新p} | .emm 旧{旧e} 新{新e} | {}",
                row.key, row.新
            );
            if 新p == 0 || 新e == 0 {
                新路径不存在 += 1;
            }
        }
        println!("  （新路径在产物里没出现的：{新路径不存在} 条）");

        /* ---- 产物里的新路径逐条指过去，文件真的在吗 ---- */
        let mut 在 = 0;
        let mut 不在 = 0;
        for row in r.表.iter() {
            let 看 = if row.处置 == "指到新位置" { &row.新 } else { &row.旧 };
            if 看.is_empty() {
                continue;
            }
            if Path::new(看).is_file() {
                在 += 1;
            } else {
                不在 += 1;
                println!("    ! 产物指的这份在盘上找不到：{}", 看);
            }
        }
        println!("  产物路径逐条核对：在盘上 {在} 条 / 找不到 {不在} 条");
        println!("  输出：{}", r.输出);
    }

    println!("\n---- 输出目录里现在有什么 ----");
    for e in fs::read_dir(输出p).unwrap() {
        let e = e.unwrap();
        let m = e.metadata().unwrap();
        println!("    {} {} B", e.file_name().to_string_lossy(), m.len());
    }
}

/* ==================================================================
   用户 2026-09-22 指定的**可执行验收场景**（两个情形）

   原话：
     "…\UserFile 这个例子，进行测试：第一点情况是让工程**原地修复**正常能加载；
      第二点情况让 …\UserFile\ray-mmd-1.5.2 放在 `E:\C test\12`、
      …\UserFile\ikBokeh_v019 放在 `E:\C test\24`、
      …\UserFile\香港观塘 一键启动 夜间 2.1.pmm 放在 `E:\C test`，**也能正常打开工程**。"

   **原件只读**：下面两个测试只在副本上动，
   `…\香港_by_胧月兔_…\UserFile` 一个字节都不改。

   **落点跟着 `暂存根()` 走**：上面那句原话里的 `E:\C test\{12,24,根}` 是当时的绝对路径，
   现在一律换成 `<暂存根>\{12,24,根}` —— 形状（三处互不相干的根 + 一个在根上的工程文件）
   一模一样，判据一条没改；只是暂存根可以被 `MIG_暂存根` 换掉。
   ================================================================== */

/// 整棵目录拷一份（副本用；不进默认套件）
fn 拷树(源: &Path, 目标: &Path) -> usize {
    let mut n = 0usize;
    let mut 栈 = vec![(源.to_path_buf(), 目标.to_path_buf())];
    while let Some((s, t)) = 栈.pop() {
        let _ = fs::create_dir_all(&t);
        let Ok(读) = fs::read_dir(&s) else { continue };
        for e in 读.flatten() {
            let p = e.path();
            let 到 = t.join(e.file_name());
            if p.is_dir() {
                栈.push((p, 到));
            } else if fs::copy(&p, &到).is_ok() {
                n += 1;
            }
        }
    }
    n
}

/// `.pmm` 帧区里 VMD 那套插值花样的个数（动作数据是**嵌在工程里**的，换路径不许碰它）
fn 花样数(b: &[u8]) -> usize {
    b.windows(4).filter(|w| *w == [0x14, 0x14, 0x6B, 0x6B]).count()
}

/**
 * 盘上独立回读（**不看产品自己的打印**）：`(旧根出现次数, emm 里绝对路径总数, 在盘上条数, 帧区是否原样)`
 *
 * 三样分别对应"旧根归零 / 每条都指到真文件 / 动作没被动过"。
 */
fn 盘上回读(
    出: &Path,
    名: &str,
    旧根们: &[String],
    原pmm: &[u8],
) -> (Vec<(String, usize)>, usize, usize, bool) {
    let p = 出.join(format!("{名}.pmm"));
    let e = 出.join(format!("{名}.emm"));
    let bp = fs::read(&p).unwrap_or_default();
    let be = fs::read(&e).unwrap_or_default();
    let 包串 = 出.to_string_lossy().to_string();
    /* **旧根是新根前缀时，数出来的其实是新路径**（包就打在旧根命名的那个目录里面，
       例如老根 `E:\C test`、包落 `E:\C test\⑥验收\打包\包里\…`）。
       这种情况下要减掉"包目录串"的出现次数，否则量具自己会假红（实测踩过：
       包里 172/172 条路径都在盘上，却被"旧根必须归零"拦住）。判据与产品里那条一致。 */
    let 残留 = |b: &[u8], r: &str| -> usize {
        let n = 数(b, r);
        if 包串.starts_with(r) {
            n.saturating_sub(数(b, &包串))
        } else {
            n
        }
    };
    let 旧: Vec<(String, usize)> = 旧根们
        .iter()
        .map(|r| (r.clone(), 残留(&bp, r) + 残留(&be, r)))
        .collect();
    let 文本 = crate::migrate_root::读emm文本(&e);
    let mut 总 = 0usize;
    let mut 在 = 0usize;
    for 行 in 文本.split("\r\n") {
        let Some(eq) = 行.find('=') else { continue };
        let v = 行[eq + 1..].trim();
        let b = v.as_bytes();
        if b.len() >= 3 && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/') {
            总 += 1;
            if Path::new(v).is_file() {
                在 += 1;
            }
        }
    }
    let 帧原样 = bp.len() == 原pmm.len() && 花样数(&bp) == 花样数(原pmm);
    (旧, 总, 在, 帧原样)
}

fn 打根组(根们: &[crate::migrate_root::根组]) {
    for g in 根们.iter() {
        println!(
            "    {:<28} 条数 {:>4}  在盘 {:>4}  建议 {}/{}  {}",
            g.根, g.条数, g.在盘条数, g.建议命中, g.条数, g.建议
        );
    }
}

/**
 * 数**新根**出现几次：产物里有几条绝对路径落在新根下面。
 *
 * `盘上回读` 只报"旧根有没有归零" —— 归零也可能是路径被写坏了、谁都不指。
 * 用户要的是**新旧根两个数**：旧根 0 **且**新根 ＝ 全部条目，才说明真搬过去了。
 */
fn 数新根(出: &Path, 名: &str, 新根: &str) -> (usize, usize) {
    let e = 出.join(format!("{名}.emm"));
    let 低根 = 新根.to_lowercase();
    let mut 总 = 0usize;
    let mut 在新根 = 0usize;
    for 行 in crate::migrate_root::读emm文本(&e).split("\r\n") {
        let Some(eq) = 行.find('=') else { continue };
        let v = 行[eq + 1..].trim();
        let b = v.as_bytes();
        if b.len() >= 3 && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/') {
            总 += 1;
            if v.to_lowercase().starts_with(&低根) {
                在新根 += 1;
            }
        }
    }
    (在新根, 总)
}

/// 把"新旧根"两个数打出来并核对（旧根 0 由调用方那条断言管）
fn 打新旧根(出: &Path, 名: &str, 新根: &Path, 旧根们: &[String]) {
    let (在新根, 总) = 数新根(出, 名, &新根.to_string_lossy());
    println!(
        "  盘上回读：新根 {} → {在新根}/{总} 条绝对路径落在它下面（旧根 {} 个）",
        新根.display(),
        旧根们.len()
    );
    assert_eq!(在新根, 总, "搬完之后每条绝对路径都该落在新根下面（新根 {}）", 新根.display());
}

/**
 * 量具的**暂存根**：所有"自己造出来的副本/落点"都摆在它下面。
 *
 * 默认还是 `E:\C test`（前几轮就是在这儿跑、文档里的数字也出自这儿），一个判据都没动。
 * 但 2026-09-23 那轮用户把 `E:\C test\` 划成**只读**（要试就在别处造副本），
 * 所以复跑时用 `MIG_暂存根` 把整块暂存挪走：
 *
 * ```text
 * $env:MIG_暂存根 = 'E:\C测试副本'
 * cargo test --lib -- --ignored --nocapture 香港验收
 * ```
 *
 * **别把暂存根指到 `…\测试效果\…` 下面** —— 产品里那条硬闸（`是禁止路径`）会认出
 * "测试效果" 这几个字，产物一律拒绝写盘，量具会成片红，而那不是代码的问题。
 */
fn 暂存根() -> PathBuf {
    PathBuf::from(std::env::var("MIG_暂存根").unwrap_or_else(|_| r"E:\C test".to_string()))
}

fn 验收工作目录(情形: &str) -> PathBuf {
    /* **不放 `测试效果` 里**：产品现在有一条硬闸 —— 目标路径落在"测试/临时目录"就整体拒绝写盘
       （用户实测抓到过一次：主体模型被指到了我的测试副本里）。验收副本历史上放用户指定的
       `E:\C test\⑥验收\` 下，闸是开着的，验的就是真实用法；换暂存根时同理，不能带"测试效果"字样。 */
    暂存根().join("⑥验收").join(情形)
}

/**
 * **情形①-反面：夜间那套本来就指对了 —— 不许乱动它。**
 *
 * 实测（2026-09-22 复核）：夜间那套 `.pmm`/`.emm` 里的 172 条绝对路径**全部**是
 * `E:\deepseek-harness\mmd集成工具\香港_by_胧月兔_…\UserFile\…`，也就是它自己现在待的地方
 * （这套工程是在本机做的）。所以"原地修复"在它上面**无事可做**。
 *
 * 这条钉的就是"无事可做时要说清楚、不许假报"：找死根给出的建议就是它自己，
 * 点写盘必须被拒并说明白（以前会报"旧根还剩 186 次"那种看不懂的错），且**一个字节都不许动**。
 *
 * 跑法：`cargo test --lib -- --ignored --nocapture 香港验收_情形1_夜间已经指对了`
 */
#[test]
#[ignore]
fn 香港验收_情形1_夜间已经指对了() {
    let 名 = 工程[0];
    let 源User = PathBuf::from(format!(r"{工程根}\UserFile"));
    let 工作 = 验收工作目录("情形1夜间指对了");
    let _ = fs::remove_dir_all(&工作);
    fs::create_dir_all(&工作).unwrap();
    let 副本 = 工作.join("UserFile");
    let n = 拷树(&源User, &副本);

    println!("\n================ 情形①（反面）夜间已经指对了：{名} ================");
    println!("  副本：{}（整棵拷了 {n} 个文件；**原件只读**）", 副本.display());
    let pmm = 副本.join(format!("{名}.pmm"));
    let emm = 副本.join(format!("{名}.emm"));
    let 原pmm = fs::read(&pmm).unwrap();
    let 原emm = fs::read(&emm).unwrap();

    let 根们 = crate::migrate_root::找死根(&pmm.to_string_lossy(), &emm.to_string_lossy())
        .expect("找死根");
    println!("  找死根 {} 组：", 根们.len());
    打根组(&根们);
    assert_eq!(根们.len(), 1, "夜间那套只有一处根");
    let 根 = 根们[0].根.clone();
    assert!(
        根们[0].建议命中 == 根们[0].条数,
        "自己那份应当全部命中（说明本来就指对了）"
    );
    assert!(
        根们[0].建议.trim_end_matches('\\').to_lowercase()
            == 根.trim_end_matches('\\').to_lowercase(),
        "建议必须就是它自己（说明无事可做），实际建议 {}",
        根们[0].建议
    );

    let 根表 = vec![(根.clone(), 根们[0].建议.clone())];
    let 表 = crate::migrate_root::列路径(
        pmm.to_string_lossy().to_string(),
        emm.to_string_lossy().to_string(),
        根表.clone(),
        vec![],
    )
    .expect("列路径");
    let 在盘 = 表.iter().filter(|r| Path::new(&r.目标).is_file()).count();
    println!("  列路径 {} 行；目标在盘上 {}/{}", 表.len(), 在盘, 表.len());
    assert_eq!(在盘, 表.len(), "本来就该每条都在盘上");

    /* 点写盘 → 必须被拒，而且要说人话；盘上一个字节都不许动 */
    /* 点写盘 → 必须被拒，而且要说人话；盘上一个字节都不许动。
       注意：这套料**本来就带着 `.bak`**（用户自己那次原地修复留下的原件，2023-09-24），
       所以这里比的是"变没变"，不是"有没有"。 */
    let bakp = pmm.with_extension("pmm.bak");
    let bake = emm.with_extension("emm.bak");
    let 原b = (fs::read(&bakp).ok(), fs::read(&bake).ok());
    if 原b.0.is_some() {
        println!("  料里本来就有 .bak（用户那次原地修复留下的原件），比对「有没有被动过」");
    }
    let e = crate::migrate_root::搬根(
        pmm.to_string_lossy().to_string(),
        emm.to_string_lossy().to_string(),
        根表,
        vec![],
        String::new(),
        false,
    )
    .expect_err("旧根 == 新根 时不该写盘");
    println!("  点写盘被拒（应当如此）：{e}");
    assert!(e.contains("原位"), "要说清是「已经在原位」：{e}");
    assert_eq!(fs::read(&pmm).unwrap(), 原pmm, "拒绝时 .pmm 一个字节都不许动");
    assert_eq!(fs::read(&emm).unwrap(), 原emm, "拒绝时 .emm 一个字节都不许动");
    assert_eq!(fs::read(&bakp).ok(), 原b.0, "拒绝时不该新写/改 .bak");
    assert_eq!(fs::read(&bake).ok(), 原b.1, "拒绝时不该新写/改 .bak");
    println!("  ⇒ 这套工程**不需要修**，直接拖进 MMD 就能开");
}

/**
 * **情形①：原地修复** —— 工程文件一条都不挪，把死根重新定向到"文件现在实际所在的地方"。
 *
 * 用**日间那套**当输入：它 85 条里 84 条指着 `D:\MMD一键渲染工程项目`、1 条指着 `H:\UserFile`，
 * 都是本机没有的地方 —— 这才是真的坏工程（夜间那套已经指对了，见上面那条）。
 *
 * 跑法：`cargo test --lib -- --ignored --nocapture 香港验收_情形1`
 */
#[test]
#[ignore]
fn 香港验收_情形1_原地修复() {
    let 名 = 工程[1];
    let 源User = PathBuf::from(format!(r"{工程根}\UserFile"));
    let 工作 = 验收工作目录("情形1");
    let _ = fs::remove_dir_all(&工作);
    fs::create_dir_all(&工作).unwrap();
    let 副本 = 工作.join("UserFile");
    let n = 拷树(&源User, &副本);

    println!("\n================ 情形① 原地修复（日间那套，本来就是坏的）：{名} ================");
    println!("  副本：{}（整棵拷了 {n} 个文件；**原件只读**）", 副本.display());
    let pmm = 副本.join(format!("{名}.pmm"));
    let emm = 副本.join(format!("{名}.emm"));
    assert!(pmm.is_file() && emm.is_file(), "副本里要有那对工程文件");
    let 原pmm = fs::read(&pmm).unwrap();

    let 根们 = crate::migrate_root::找死根(&pmm.to_string_lossy(), &emm.to_string_lossy())
        .expect("找死根");
    println!("  发现旧根 {} 个：", 根们.len());
    打根组(&根们);
    let 旧根们: Vec<String> = 根们.iter().map(|g| g.根.clone()).collect();
    let 根表: Vec<(String, String)> = 根们
        .iter()
        .filter(|g| !g.建议.is_empty())
        .map(|g| (g.根.clone(), g.建议.clone()))
        .collect();
    println!("  可用根表 {} 组", 根表.len());
    assert!(!根表.is_empty(), "原地修复必须能给出新根建议");

    /* 先出表：每一条都该有目标、且目标在盘上 */
    let 表 = crate::migrate_root::列路径(
        pmm.to_string_lossy().to_string(),
        emm.to_string_lossy().to_string(),
        根表.clone(),
        vec![],
    )
    .expect("列路径");
    let 没落定 = 表.iter().filter(|r| r.目标.is_empty()).count();
    let 在盘 = 表.iter().filter(|r| Path::new(&r.目标).is_file()).count();
    println!(
        "  列路径 {} 行；没落定 {}；目标在盘上 {}/{}",
        表.len(),
        没落定,
        在盘,
        表.len()
    );
    for r in 表.iter().filter(|r| r.目标.is_empty()).take(10) {
        println!("    ! 没落定：{} [{}]", r.原路径, r.段);
    }
    for r in 表.iter().filter(|r| !r.目标.is_empty() && !Path::new(&r.目标).is_file()).take(10) {
        println!("    ! 不在盘上：{} → {}", r.原路径, r.目标);
    }
    assert_eq!(没落定, 0, "情形① 不该有没落定的条目");
    assert_eq!(在盘, 表.len(), "每条目标都要在盘上");

    let 出 = 工作.join("修好后");
    let r = crate::migrate_root::搬根(
        pmm.to_string_lossy().to_string(),
        emm.to_string_lossy().to_string(),
        根表.clone(),
        vec![],
        出.to_string_lossy().to_string(),
        false,
    )
    .expect("情形① 应当能写盘");
    println!(
        "  写盘：改字段 {} 处 / 改行 {} 行；.pmm {} → {}；.emm {} → {}",
        r.pmm改字段, r.emm改行, r.原先pmm长度, r.pmm长度, r.原先emm长度, r.emm长度
    );
    /* 产品自己的回读（它内部做的） */
    println!("  产品回读：旧根残留 {:?}", r.旧根残留);
    println!("  产品回读：新根出现 {:?}", r.新根出现);

    /* ---- 盘上独立回读 ---- */
    let (旧, 总, 在, 帧原样) = 盘上回读(&出, 名, &旧根们, &原pmm);
    println!("  盘上回读：旧根出现 {旧:?}（必须全 0）");
    println!("  盘上回读：.emm 绝对路径 {总} 条，在盘上 {在} 条");
    println!("  盘上回读：.pmm 长度不变且帧区动作原样 = {帧原样}");
    assert!(旧.iter().all(|(_, n)| *n == 0), "旧根必须归零：{旧:?}");
    assert_eq!(在, 总, "产物里每条绝对路径都要在盘上");
    assert!(帧原样, "换路径不许碰帧区（VMD 动作嵌在那里）");

    println!("\n  给用户试的文件（拖进 MMD）：");
    for e in fs::read_dir(&出).unwrap().flatten() {
        println!("    {}", e.path().display());
    }

    /* ---- 再走一遍**真正的"原地修复"**：输出留空 = 改在副本原地、先留 `.bak` ----
       （原件只读；"原地"改的是副本，用户拿到的就是"工程文件不动、路径被修好"这个效果） */
    let r2 = crate::migrate_root::搬根(
        pmm.to_string_lossy().to_string(),
        emm.to_string_lossy().to_string(),
        根表.clone(),
        vec![],
        String::new(),
        false,
    )
    .expect("原地改也应当能成功");
    let bak = [
        副本.join(format!("{名}.pmm.bak")),
        副本.join(format!("{名}.emm.bak")),
    ];
    println!(
        "  原地修复：改字段 {} 处 / 改行 {} 行；备份 {} / {}",
        r2.pmm改字段,
        r2.emm改行,
        if bak[0].is_file() { "有 .bak" } else { "没有 .bak ✗" },
        if bak[1].is_file() { "有 .bak" } else { "没有 .bak ✗" }
    );
    assert!(bak[0].is_file() && bak[1].is_file(), "原地改必须先留 .bak");
    let (旧2, 总2, 在2, 帧2) = 盘上回读(&副本, 名, &旧根们, &原pmm);
    println!("  原地回读：旧根 {旧2:?}；.emm 绝对路径 {总2} 条、在盘 {在2} 条；帧区原样 {帧2}");
    assert!(旧2.iter().all(|(_, n)| *n == 0) && 在2 == 总2 && 帧2, "原地修复的回读不过");
    println!("  原地修好的工程（就是副本里那份，直接可开）：{}", pmm.display());
}

/**
 * **打包**（用户情形②的另一半）：把 `pmm`/`emm` **和素材一起**装进一个目录，包内路径指向拷进来的那份。
 *
 * 跑法：`cargo test --lib -- --ignored --nocapture 香港验收_打包`
 */
#[test]
#[ignore]
fn 香港验收_打包_自包含目录() {
    let 名 = 工程[0];
    let 源User = PathBuf::from(format!(r"{工程根}\UserFile"));
    let 工作 = 验收工作目录("打包");
    let _ = fs::remove_dir_all(&工作);
    fs::create_dir_all(&工作).unwrap();
    let 副本 = 工作.join("UserFile");
    let n = 拷树(&源User, &副本);

    println!("\n================ 打包（自包含）：{名} ================");
    println!("  从副本打包：{}（{n} 个文件）", 副本.display());
    let pmm = 副本.join(format!("{名}.pmm"));
    let emm = 副本.join(format!("{名}.emm"));
    let 原pmm = fs::read(&pmm).unwrap();

    let 根们 = crate::migrate_root::找死根(&pmm.to_string_lossy(), &emm.to_string_lossy()).unwrap();
    let 旧根们: Vec<String> = 根们.iter().map(|g| g.根.clone()).collect();
    let 根表: Vec<(String, String)> = 根们
        .iter()
        .filter(|g| !g.建议.is_empty())
        .map(|g| (g.根.clone(), g.建议.clone()))
        .collect();

    /* ---- 先试算，再真跑（用户点界面就是这个顺序）----
       ⑥ 改的那条「自带模式的试算一直是坏的」就在这条腿上：原来干跑真的不碰盘、
       包还没建出来，"换完在盘上"必然全灭 → 试算直接报错。 */
    let 干出 = 工作.join("干跑包里");
    let 干 = crate::migrate_root::搬根自带(
        pmm.to_string_lossy().to_string(),
        emm.to_string_lossy().to_string(),
        根表.clone(),
        vec![],
        干出.to_string_lossy().to_string(),
        true,
        None,
    )
    .expect("自带模式的试算不许报错");
    println!(
        "  试算（干跑）：会拷 {} 个文件 / {:.1} MB；重名冲突 {} 个",
        干.拷贝文件,
        干.拷贝字节 as f64 / 1048576.0,
        干.重名冲突.len()
    );
    assert!(干.拷贝文件 > 0, "试算要算出会拷多少个（原来这里报 0，界面就成了「要拷 0 个文件」）");
    assert!(!干出.exists(), "试算不许建目录");

    let 出 = 工作.join("包里");
    let r = crate::migrate_root::搬根自带(
        pmm.to_string_lossy().to_string(),
        emm.to_string_lossy().to_string(),
        根表.clone(),
        vec![],
        出.to_string_lossy().to_string(),
        false,
        None,
    )
    .expect("打包应当能成功");
    println!(
        "  打包：拷了 {} 个文件 / {:.1} MB；重名冲突 {} 个",
        r.拷贝文件,
        r.拷贝字节 as f64 / 1048576.0,
        r.重名冲突.len()
    );
    println!("  试算 vs 真跑：{} vs {} 个文件", 干.拷贝文件, r.拷贝文件);
    assert_eq!(干.拷贝文件, r.拷贝文件, "试算与真跑的数必须一样（试算就是给用户看这个数的）");
    println!("  改字段 {} 处 / 改行 {} 行", r.pmm改字段, r.emm改行);
    println!("  产品回读：旧根残留 {:?}", r.旧根残留);
    println!("  产物路径逐条指向包内：{} 条，全部命中 {} 条", r.产物路径.len(), r.产物路径.iter().filter(|(_, b)| *b).count());

    let (旧, 总, 在, 帧原样) = 盘上回读(&出, 名, &旧根们, &原pmm);
    println!("  盘上回读：旧根出现 {旧:?}（必须全 0）");
    println!("  盘上回读：.emm 绝对路径 {总} 条，在盘上 {在} 条");
    println!("  盘上回读：.pmm 长度不变且帧区动作原样 = {帧原样}");
    assert!(旧.iter().all(|(_, n)| *n == 0), "旧根必须归零：{旧:?}");
    assert_eq!(在, 总, "包里的每条路径都要在盘上（指向拷进来的那份）");
    assert!(r.拷贝文件 > 0, "打包必须把素材拷进去（用户骂过「只丢出一个文件」）");
    打新旧根(&出, 名, &出, &旧根们);

    println!("  包内文件数：{}", 列文件(&出).len());
    println!("\n  给用户试的文件（拖进 MMD）：");
    for e in fs::read_dir(&出).unwrap().flatten() {
        println!("    {}", e.path().display());
    }
}
#[test]
#[ignore]
fn 香港验收_情形2_分散到多处() {
    /* **用日间那套**：它的 85 条路径指着 `D:\MMD一键渲染工程项目` / `H:\UserFile`（本机都没有），
       这才是"素材被挪到别处、要靠检索找回来"的真输入。夜间那套已经被原地修好过了
       （见 `香港验收_情形1_夜间已经指对了`），拿它测不出东西。 */
    let 名 = 工程[1];
    let 源User = PathBuf::from(format!(r"{工程根}\UserFile"));
    let 工作 = 验收工作目录("情形2");
    let _ = fs::remove_dir_all(&工作);
    fs::create_dir_all(&工作).unwrap();
    let 副本 = 工作.join("UserFile");
    let n = 拷树(&源User, &副本);

    println!("\n================ 情形② 分散到多处：{名} ================");
    println!("  副本：{}（整棵拷了 {n} 个文件；**原件只读**）", 副本.display());

    /* ---- 把整棵 `UserFile` 挪到 12、再把其中 `ikBokeh_v019` 单独挪到 24（只在副本上动）----
       工程里那些旧根的尾部形如 `UserFile\ray-mmd-1.5.2\…`，所以"整棵挪走"才让**按根批量**
       对得上；单独挪走的那棵只能靠**检索**找回来 —— 两层都要用上，这才是情形②的形状。 */
    let 目标12 = 暂存根().join("12");
    let 目标24 = 暂存根().join("24");
    let 目标根 = 暂存根();
    for d in [&目标12, &目标24, &目标根] {
        fs::create_dir_all(d).unwrap();
    }
    /* 12 / 24 里可能有上次跑剩的，先清掉同名目标 */
    let _ = fs::remove_dir_all(目标12.join("UserFile"));
    let _ = fs::remove_dir_all(目标24.join("UserFile"));

    /* 先把工程文件拷到 `E:\C test`（用户指定的落点），再从副本里搬树 */
    let 工程pmm = 目标根.join(format!("{名}.pmm"));
    let 工程emm = 目标根.join(format!("{名}.emm"));
    fs::copy(副本.join(format!("{名}.pmm")), &工程pmm).unwrap();
    fs::copy(副本.join(format!("{名}.emm")), &工程emm).unwrap();
    println!("  工程文件 → {}", 目标根.display());

    fs::create_dir_all(&目标12).unwrap();
    fs::rename(&副本, 目标12.join("UserFile")).unwrap_or_else(|e| panic!("整棵挪到 12 失败：{e}"));
    println!("  挪走：整棵 UserFile → {}", 目标12.join("UserFile").display());
    let 从 = 目标12.join("UserFile").join("ikBokeh_v019");
    let 到 = 目标24.join("UserFile").join("ikBokeh_v019");
    fs::create_dir_all(到.parent().unwrap()).unwrap();
    fs::rename(&从, &到).unwrap_or_else(|e| panic!("挪 ikBokeh_v019 失败：{e}"));
    println!("  挪走：UserFile\\ikBokeh_v019 → {}", 到.display());

    let 原pmm = fs::read(&工程pmm).unwrap();

    /* ---- 第一层：按根批量（能自动推断的先自动） ---- */
    let 根们 = crate::migrate_root::找死根(&工程pmm.to_string_lossy(), &工程emm.to_string_lossy())
        .expect("找死根");
    println!("  发现旧根 {} 个：", 根们.len());
    打根组(&根们);
    let 旧根们: Vec<String> = 根们.iter().map(|g| g.根.clone()).collect();
    let 根表: Vec<(String, String)> = 根们
        .iter()
        .filter(|g| !g.建议.is_empty())
        .map(|g| (g.根.clone(), g.建议.clone()))
        .collect();
    println!("  可用根表 {} 组（剩下靠检索）", 根表.len());

    /* ---- 第二层：检索（**只给用户指的那几个起点**）----
       用户原话是"工具要能从用户指定的搜索起点按文件名把挪走的文件找出来"，而且"可以加好几个"。
       这里就给 12 / 24 两个 —— **不能给 `E:\C test` 那一层**：
       那一层底下压着本量具自己的一堆副本（`⑥验收\…`），同名文件全在里面，
       起点一给宽，检索就只会（正确地）说"多个候选、得由人挑"。 */
    let 起点 = vec![目标12.to_string_lossy().to_string(), 目标24.to_string_lossy().to_string()];
    let 检索表 = crate::migrate_root::检索(
        工程pmm.to_string_lossy().to_string(),
        工程emm.to_string_lossy().to_string(),
        根表.clone(),
        vec![],
        起点.clone(),
    )
    .expect("检索");
    let 唯一 = 检索表.iter().filter(|r| r.状态 == "已唯一找到").count();
    let 多个 = 检索表.iter().filter(|r| r.状态 == "多个候选").count();
    let 没找 = 检索表.iter().filter(|r| r.状态 == "没找到").count();
    println!(
        "  检索（起点 {}）：需要找 {} 条 → 唯一找到 {} / 多个候选 {} / 没找到 {}",
        目标根.display(),
        检索表.len(),
        唯一,
        多个,
        没找
    );
    for r in 检索表.iter() {
        println!(
            "    [{}] {:<34} {} {}",
            r.状态,
            r.文件名,
            r.建议,
            if r.备注.is_empty() { String::new() } else { format!("（{}）", r.备注) }
        );
    }

    let 逐条: Vec<(String, String)> = 检索表
        .iter()
        .filter(|r| !r.建议.is_empty())
        .map(|r| (r.原路径.clone(), r.建议.clone()))
        .collect();

    /* ---- 出表：没落定必须 0 ---- */
    let 表 = crate::migrate_root::列路径(
        工程pmm.to_string_lossy().to_string(),
        工程emm.to_string_lossy().to_string(),
        根表.clone(),
        逐条.clone(),
    )
    .expect("列路径");
    let 没落定 = 表.iter().filter(|r| r.目标.is_empty()).count();
    let 在盘 = 表.iter().filter(|r| Path::new(&r.目标).is_file()).count();
    println!(
        "  两层叠加后：{} 行；没落定 {}；目标在盘上 {}/{}",
        表.len(),
        没落定,
        在盘,
        表.len()
    );
    /* 逐条指定压过根规则：那几条的状态要是 `已逐条指定` */
    let 逐条数 = 表.iter().filter(|r| r.状态 == "已逐条指定").count();
    println!("  其中 `已逐条指定` {逐条数} 条（检索找回来的那些）");
    for r in 表.iter().filter(|r| r.目标.is_empty()).take(10) {
        println!("    ! 没落定：{} [{}]", r.原路径, r.段);
    }
    assert_eq!(没落定, 0, "情形② 不许有没落定的条目");

    /* ---- 原地修好用户拖进来的那一份（默认用法：输出留空 = 原地改，先留 .bak）---- */
    let r = crate::migrate_root::搬根(
        工程pmm.to_string_lossy().to_string(),
        工程emm.to_string_lossy().to_string(),
        根表.clone(),
        逐条.clone(),
        String::new(),
        false,
    )
    .expect("情形② 原地修复应当能写盘");
    println!(
        "  原地修复：改字段 {} 处 / 改行 {} 行；.pmm {} → {}（长度{}）",
        r.pmm改字段,
        r.emm改行,
        r.原先pmm长度,
        r.pmm长度,
        if r.pmm长度 == r.原先pmm长度 { "不变" } else { "变了 ✗" }
    );
    println!("  产品回读：旧根残留 {:?}", r.旧根残留);
    assert!(工程pmm.with_extension("pmm.bak").is_file(), "原地改必须留 .bak");
    assert!(工程emm.with_extension("emm.bak").is_file(), "原地改必须留 .bak");

    /* ---- 盘上独立回读 + **产物不许指向任何测试/临时目录** ---- */
    let 出 = 目标根.clone();
    let (旧, 总, 在, 帧原样) = 盘上回读(&出, 名, &旧根们, &原pmm);
    println!("  盘上回读：旧根出现 {旧:?}（必须全 0）");
    println!("  盘上回读：.emm 绝对路径 {总} 条，在盘上 {在} 条");
    println!("  盘上回读：.pmm 长度不变且帧区动作原样 = {帧原样}");
    assert!(旧.iter().all(|(_, n)| *n == 0), "旧根必须归零：{旧:?}");
    assert_eq!(在, 总, "产物里每条绝对路径都要在盘上");
    assert!(帧原样, "换路径不许碰帧区（VMD 动作嵌在那里）");
    打新旧根(&出, 名, &目标根, &旧根们);

    let 禁: Vec<String> = crate::migrate_root::读emm文本(&工程emm)
        .split("\r\n")
        .filter_map(|行| {
            let v = 行.split('=').nth(1)?.trim().to_string();
            let b = v.as_bytes();
            if b.len() > 3 && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/') && crate::migrate_root::是禁止路径(&v) {
                Some(v)
            } else {
                None
            }
        })
        .collect();
    println!("  产物里指向测试/临时目录的条数 = {}（必须 0）", 禁.len());
    for v in 禁.iter().take(5) {
        println!("    ! {v}");
    }
    assert!(禁.is_empty(), "产物绝不许指向测试/临时目录：{禁:?}");

    println!("\n  ⇒ 要拖进 MMD 的就是这一份（已原地修好，同目录有 .bak）：");
    println!("      {}", 工程pmm.display());
    println!("  ⇒ 特效分配在 .emm 里，MMD 打开工程不会自动读，要单独载入（效果分配 → 载入）");
}

/**
 * **搬运**验收：文件都在盘上时，把它们**真的搬/拷**到指定位置（**一处一个目标 = 多选**），
 * 再把工程里的路径改过去、原地保存（留 `.bak`）。
 *
 * 用户 2026-09-22 原话："看一眼要动哪些文件后，对文件都在的情况可以选择将**文件迁移**到指定位置
 * （**单选或多选都可以**）然后保存，工程文件迁移也可以做到修复"。
 *
 * 两趟：
 *   ① 拷模式（默认）—— 每个"文件现在在哪"的根各给一个目标位置，**原件必须一个不少**；
 *   ② 搬模式 —— 从①的产物再搬到另两处，**逐个字节核对相同之后**才删原件。
 *
 * 跑法：`cargo test --lib -- --ignored --nocapture 香港验收_搬运`
 */
#[test]
#[ignore]
fn 香港验收_搬运_多处目标() {
    let 名 = 工程[0];
    let 源User = PathBuf::from(format!(r"{工程根}\UserFile"));
    let 工作 = 验收工作目录("搬运");
    let _ = fs::remove_dir_all(&工作);
    fs::create_dir_all(&工作).unwrap();
    let 副本 = 工作.join("UserFile");
    let n = 拷树(&源User, &副本);

    println!("\n================ 搬运（多处目标）：{名} ================");
    println!("  副本：{}（整棵拷了 {n} 个文件；**原件只读**）", 副本.display());
    let pmm = 副本.join(format!("{名}.pmm"));
    let emm = 副本.join(format!("{名}.emm"));
    assert!(pmm.is_file() && emm.is_file(), "副本里要有那对工程文件");
    let 原pmm = fs::read(&pmm).unwrap();

    /* ---- 「文件都在」：工程里的路径现在就指着真文件（用户口径：文件都在才谈得上搬运）---- */
    let 根们 = crate::migrate_root::找死根(&pmm.to_string_lossy(), &emm.to_string_lossy()).expect("找死根");
    println!("  文件现在在 {} 处：", 根们.len());
    打根组(&根们);
    let 根 = 根们[0].根.trim_end_matches('\\').to_string();

    /* 拿「旧根 → 它自己」列一遍，只为看清每条路径现在落在哪（这一步不写盘） */
    let 自表: Vec<(String, String)> = 根们
        .iter()
        .map(|g| (g.根.clone(), g.根.clone()))
        .collect();
    let 表 = crate::migrate_root::列路径(
        pmm.to_string_lossy().to_string(),
        emm.to_string_lossy().to_string(),
        自表,
        vec![],
    )
    .expect("列路径");
    let 没落定 = 表.iter().filter(|r| r.目标.is_empty()).count();
    let 在盘 = 表.iter().filter(|r| Path::new(&r.目标).is_file()).count();
    println!("  列路径 {} 行；没落定 {}；在盘 {}/{}", 表.len(), 没落定, 在盘, 表.len());
    assert_eq!(没落定, 0, "「文件都在」这个前提不成立，就谈不上搬运");
    assert_eq!(在盘, 表.len(), "每条都要在盘上");

    /* ---- 多选：找"最浅的、能分出 ≥2 组"的那一层，每组各给一个目标位置 ---- */
    let mut 用层 = 0usize;
    let mut 排: Vec<(String, usize)> = vec![];
    for 层 in 1..=6usize {
        let mut 组: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
        for r in 表.iter() {
            let 尾 = r.原路径.trim_start_matches(根.as_str()).trim_start_matches(['\\', '/']);
            let 段: Vec<&str> = 尾.split(['\\', '/']).take(层).collect();
            if 段.len() == 层 && 段.iter().all(|s| !s.is_empty()) {
                *组.entry(段.join("\\")).or_insert(0) += 1;
            }
        }
        if 组.len() >= 2 {
            用层 = 层;
            let mut v: Vec<(String, usize)> = 组.into_iter().collect();
            v.sort_by(|a, b| b.1.cmp(&a.1));
            排 = v;
            break;
        }
    }
    println!("  路径在第 {用层} 层分成 {} 组：", 排.len());
    for (k, n) in 排.iter().take(8) {
        println!("    {k}  {n} 条");
    }
    assert!(排.len() >= 2, "这套工程的文件在 6 层内必须能分出多组，才验得了「多选」");

    let 区: Vec<PathBuf> = (0..3)
        .map(|i| 工作.join(format!(r"搬过去的\区{}", i + 1)))
        .collect();
    let 旧1 = format!(r"{}\{}", 根, 排[0].0);
    let 旧2 = format!(r"{}\{}", 根, 排[1].0);
    let 目标表: Vec<(String, String)> = vec![
        (旧1.clone(), 区[0].to_string_lossy().to_string()),
        (旧2.clone(), 区[1].to_string_lossy().to_string()),
        /* 兜底：剩下的整根搬去第三处（长串优先，所以上面两组不会被它抢走） */
        (根.clone(), 区[2].to_string_lossy().to_string()),
    ];
    println!("  多选目标（{} 组，长串优先）：", 目标表.len());
    for (a, b) in 目标表.iter() {
        println!("    {a}  →  {b}");
    }
    let 没盖 = 表
        .iter()
        .filter(|r| !目标表.iter().any(|(旧, _)| r.原路径.starts_with(旧.as_str())))
        .count();
    assert_eq!(没盖, 0, "目标表要盖住每一条，否则搬运会整体拒绝");

    /* ---- 干跑：不许碰盘 ---- */
    let 干 = crate::migrate_root::搬运工程(
        pmm.to_string_lossy().to_string(),
        emm.to_string_lossy().to_string(),
        目标表.clone(),
        vec![],
        "拷".into(),
        true,
    )
    .expect("干跑应当能算出来");
    println!(
        "  干跑：会搬/拷 {} 个文件 / {:.1} MB；产物目录已经存在？{}",
        干.拷贝文件,
        干.拷贝字节 as f64 / 1048576.0,
        区.iter().any(|d| d.exists())
    );
    assert!(!区.iter().any(|d| d.exists()), "干跑不许碰盘");
    assert!(干.拷贝文件 > 0, "干跑也要算出会拷多少");

    /* ---- 第一趟：拷模式（默认）—— 原件一个都不能少 ---- */
    let 副本前 = 列文件(&副本).len();
    let 全 = crate::migrate_root::搬运工程(
        pmm.to_string_lossy().to_string(),
        emm.to_string_lossy().to_string(),
        目标表.clone(),
        vec![],
        "拷".into(),
        false,
    )
    .expect("拷模式搬运应当成功");
    let 副本后 = 列文件(&副本).len();
    println!(
        "  拷模式：拷了 {} 个文件 / {:.1} MB；删掉的原件 {} 个（拷模式必须是 0）",
        全.拷贝文件,
        全.拷贝字节 as f64 / 1048576.0,
        全.删除文件
    );
    println!("  拷模式：源目录文件数 {副本前} → {副本后}（必须不变）");
    println!(
        "  改字段 {} 处 / 改行 {} 行；产品回读：旧根残留 {:?}",
        全.根结果.pmm改字段, 全.根结果.emm改行, 全.根结果.旧根残留
    );
    assert!(全.拷贝文件 > 0, "搬运必须真的拷了东西");
    assert_eq!(全.删除文件, 0, "拷模式不许删原件");
    assert_eq!(副本前, 副本后, "拷模式原件必须还在");
    assert!(pmm.with_extension("pmm.bak").is_file(), "改工程必须留 .bak");

    /* ---- 盘上独立回读 + 不许指向任何测试/临时目录 ---- */
    let 旧根们: Vec<String> = vec![旧1.clone(), 旧2.clone(), 根.clone()];
    let (旧, 总, 在, 帧原样) = 盘上回读(&副本, 名, &旧根们, &原pmm);
    println!("  盘上回读：旧位置出现 {旧:?}（必须全 0）");
    println!("  盘上回读：.emm 绝对路径 {总} 条，在盘上 {在} 条");
    println!("  盘上回读：.pmm 长度不变且帧区动作原样 = {帧原样}");
    assert!(旧.iter().all(|(_, n)| *n == 0), "旧位置必须归零：{旧:?}");
    assert_eq!(在, 总, "搬完之后每条绝对路径都要在盘上");
    assert!(帧原样, "搬运不许碰帧区（VMD 动作嵌在那里）");
    断言不许指向测试目录(&副本, 名);

    /* ---- 第二趟：搬模式 —— 从①的产物再搬到另两处 ---- */
    let 区2: Vec<PathBuf> = (0..区.len())
        .map(|i| 工作.join(format!(r"再搬\区{}", i + 1)))
        .collect();
    let 目标表2: Vec<(String, String)> = 区
        .iter()
        .zip(区2.iter())
        .map(|(a, b)| (a.to_string_lossy().to_string(), b.to_string_lossy().to_string()))
        .collect();
    let 搬 = crate::migrate_root::搬运工程(
        pmm.to_string_lossy().to_string(),
        emm.to_string_lossy().to_string(),
        目标表2,
        vec![],
        "搬".into(),
        false,
    )
    .expect("搬模式搬运应当成功");
    println!(
        "  搬模式：拷了 {} 个 / {:.1} MB；**逐个字节核对相同之后**删掉原件 {} 个",
        搬.拷贝文件,
        搬.拷贝字节 as f64 / 1048576.0,
        搬.删除文件
    );
    assert!(搬.删除文件 > 0, "搬模式必须真的删掉核对过的原件");

    let 老区: Vec<String> = 区.iter().map(|d| d.to_string_lossy().to_string()).collect();
    let (旧2, 总2, 在2, 帧2) = 盘上回读(&副本, 名, &老区, &原pmm);
    println!("  搬模式回读：上一处出现 {旧2:?}（必须全 0）；绝对路径 {总2} 条、在盘 {在2} 条；帧区原样 {帧2}");
    assert!(旧2.iter().all(|(_, n)| *n == 0), "上一处必须归零：{旧2:?}");
    assert_eq!(在2, 总2, "搬到新位置后每条路径都要在盘上");
    assert!(帧2, "搬运不许碰帧区");
    断言不许指向测试目录(&副本, 名);

    println!("\n  ⇒ 搬完的工程（就是这一份，直接拖进 MMD）：");
    println!("      {}", pmm.display());
    println!("  ⇒ 特效分配在 .emm 里，MMD 打开工程不会自动读，要单独载入（效果分配 → 载入）");
}

/// 产物里**绝不许**出现指向测试/临时目录的路径（产品硬闸的独立复核）
fn 断言不许指向测试目录(工程目录: &Path, 名: &str) {
    let emm = 工程目录.join(format!("{名}.emm"));
    let 禁: Vec<String> = crate::migrate_root::读emm文本(&emm)
        .split("\r\n")
        .filter_map(|行| {
            let v = 行.split('=').nth(1)?.trim().to_string();
            let b = v.as_bytes();
            if b.len() > 3
                && b[1] == b':'
                && (b[2] == b'\\' || b[2] == b'/')
                && crate::migrate_root::是禁止路径(&v)
            {
                Some(v)
            } else {
                None
            }
        })
        .collect();
    println!("  产物里指向测试/临时目录的条数 = {}（必须 0）", 禁.len());
    for v in 禁.iter().take(5) {
        println!("    ! {v}");
    }
    assert!(禁.is_empty(), "产物绝不许指向测试/临时目录：{禁:?}");
}

/**
 * **撤销在真工程上复跑**（两个区各一条腿 —— 用户 2026-09-22："撤销按分区逐条复跑，要证据"）。
 *
 * 夹具：把真工程整棵拷到 `<暂存根>\⑥验收\撤销复跑\UserFile\`（**原作只读**），
 * 记录目录由 `ROBIN_撤销目录` 指到同一个工作目录下 —— **不碰用户真实的 `%APPDATA%\…\undo\`**。
 *
 * · 修复区（`搬根` 原地改）→ 撤销 → `.pmm`/`.emm` 逐字节回到改前
 * · 打包区（`搬根自带`）→ 撤销 → 包里那两个工程文件没了、拷进去的目录没了、**源工程一个字节没被动过**
 *
 * 跑法：`cargo test --lib -- --ignored --nocapture 香港验收_撤销复跑`
 */
#[test]
#[ignore]
fn 香港验收_撤销复跑_修复区与打包区() {
    let 名 = 工程[1];
    let 源User = PathBuf::from(format!(r"{工程根}\UserFile"));
    let 工作 = 验收工作目录("撤销复跑");
    let _ = fs::remove_dir_all(&工作);
    fs::create_dir_all(&工作).unwrap();
    std::env::set_var("ROBIN_撤销目录", 工作.join("记录").to_string_lossy().to_string());

    let 副本 = 工作.join("UserFile");
    let n = 拷树(&源User, &副本);
    println!("\n================ 撤销复跑（真工程 {名}，副本 {n} 个文件） ================");
    let pmm = 副本.join(format!("{名}.pmm"));
    let emm = 副本.join(format!("{名}.emm"));
    assert!(pmm.is_file() && emm.is_file(), "副本里要有那对工程文件");
    let 改前pmm = fs::read(&pmm).unwrap();
    let 改前emm = fs::read(&emm).unwrap();

    let 根们 = crate::migrate_root::找死根(&pmm.to_string_lossy(), &emm.to_string_lossy()).expect("找死根");
    let 根表: Vec<(String, String)> = 根们
        .iter()
        .filter(|g| !g.建议.is_empty())
        .map(|g| (g.根.clone(), g.建议.clone()))
        .collect();
    assert!(!根表.is_empty(), "这套工程要能给出新根建议");
    assert!(crate::migrate_root::待撤销().unwrap().is_none(), "开工前不该有记录");

    /* ---- ① 修复区：原地改 → 撤销 ---- */
    let r1 = crate::migrate_root::搬根(
        pmm.to_string_lossy().to_string(),
        emm.to_string_lossy().to_string(),
        根表.clone(),
        vec![],
        String::new(),
        false,
    )
    .expect("原地修复应当成功");
    println!(
        "  ① 修复区：改字段 {} 处 / 改行 {} 行；旧根残留 {:?}",
        r1.pmm改字段, r1.emm改行, r1.旧根残留
    );
    assert_ne!(fs::read(&pmm).unwrap(), 改前pmm, "写盘之后 .pmm 必须真的变了");
    /* 盘上独立回读那三样（旧根归零 / 每条在盘上 / 帧区原样）**撤销之前量**，撤完就回到改前了。
       香港这个规模（172 条）必须有自己的数，不能只在小副本上验过。 */
    let 旧根们: Vec<String> = 根们.iter().map(|g| g.根.clone()).collect();
    let (旧A, 总A, 在A, 帧A) = 盘上回读(&副本, 名, &旧根们, &改前pmm);
    println!("     盘上回读：旧根出现 {旧A:?}（必须全 0）；.emm 绝对路径 {总A} 条、在盘上 {在A} 条；.pmm 长度不变且帧区原样 {帧A}");
    assert!(旧A.iter().all(|(_, n)| *n == 0), "修复区旧根必须归零：{旧A:?}");
    assert_eq!(在A, 总A, "修复区每条绝对路径都要在盘上");
    assert!(帧A, "修复区不许碰帧区");
    打新旧根(&副本, 名, &副本, &旧根们);
    let 记1 = crate::migrate_root::待撤销().unwrap().expect("原地修复要落一条记录");
    assert_eq!(记1.动作, "原地修复");
    println!("     记录：{}（改前副本 {} 份）", 记1.人话, 记1.改前.len());
    let 干1 = crate::migrate_root::撤销工程(true).unwrap();
    assert!(干1.问题.is_empty(), "撤销预检不该有问题：{:?}", 干1.问题);
    let 真1 = crate::migrate_root::撤销工程(false).unwrap();
    assert_eq!(真1.写回, 2, "两个工程文件都要写回");
    assert_eq!(fs::read(&pmm).unwrap(), 改前pmm, "撤销后 .pmm 必须逐字节回到改前");
    assert_eq!(fs::read(&emm).unwrap(), 改前emm, "撤销后 .emm 必须逐字节回到改前");
    assert!(
        !真1.回读.is_empty() && 真1.回读.iter().all(|s| !s.contains("不一致")),
        "回读要全过：{:?}",
        真1.回读
    );
    println!("     撤销：写回 {} 个文件，回读 {} 条全过（.pmm/.emm 逐字节回到改前）", 真1.写回, 真1.回读.len());

    /* ---- ② 打包区：自带 → 撤销 ---- */
    let 包 = 工作.join("包");
    let r2 = crate::migrate_root::搬根自带(
        pmm.to_string_lossy().to_string(),
        emm.to_string_lossy().to_string(),
        根表.clone(),
        vec![],
        包.to_string_lossy().to_string(),
        false,
        None,
    )
    .expect("打包迁移应当成功");
    let 包pmm = 包.join(format!("{名}.pmm"));
    let 包emm = 包.join(format!("{名}.emm"));
    println!(
        "  ② 打包区：拷了 {} 个文件 / {:.1} MB；重名冲突 {}",
        r2.拷贝文件,
        r2.拷贝字节 as f64 / 1048576.0,
        r2.重名冲突.len()
    );
    assert!(包pmm.is_file() && 包emm.is_file(), "工程文件要落进包里");
    assert_eq!(fs::read(&pmm).unwrap(), 改前pmm, "自带不写源工程");
    let (旧B, 总B, 在B, 帧B) = 盘上回读(&包, 名, &旧根们, &改前pmm);
    println!("     盘上回读：旧根出现 {旧B:?}（必须全 0）；.emm 绝对路径 {总B} 条、在盘上 {在B} 条；.pmm 长度不变且帧区原样 {帧B}");
    assert!(旧B.iter().all(|(_, n)| *n == 0), "打包区旧根必须归零：{旧B:?}");
    assert_eq!(在B, 总B, "打包区每条绝对路径都要在盘上");
    assert!(帧B, "打包区不许碰帧区");
    打新旧根(&包, 名, &包, &旧根们);
    let 记2 = crate::migrate_root::待撤销().unwrap().expect("打包要落一条记录");
    assert_eq!(记2.动作, "自包含目录");
    let 干2 = crate::migrate_root::撤销工程(true).unwrap();
    assert!(干2.问题.is_empty(), "撤销预检不该有问题：{:?}", 干2.问题);
    assert!(包pmm.is_file(), "干跑不许碰产物");
    let 真2 = crate::migrate_root::撤销工程(false).unwrap();
    assert!(!包pmm.exists() && !包emm.exists(), "撤销要把包里的工程文件删掉");
    assert_eq!(fs::read(&pmm).unwrap(), 改前pmm, "撤销之后源工程依然没被动过");
    assert_eq!(fs::read(&emm).unwrap(), 改前emm, "源 .emm 同样不许动");
    assert!(真2.回读.iter().all(|s| !s.contains("不一致")), "回读不许报不一致：{:?}", 真2.回读);
    println!(
        "     撤销：删掉包里 2 个工程文件、删掉副本目录 {} 个；源工程逐字节没被动过",
        真2.删目录
    );
    println!(
        "  撤销后源工程：.pmm 逐字节没动 = {}；.emm 逐字节没动 = {}",
        fs::read(&pmm).unwrap() == 改前pmm,
        fs::read(&emm).unwrap() == 改前emm
    );
    println!("  ⇒ 两个区的撤销都在**真工程**上过了：{}", 副本.display());
}
