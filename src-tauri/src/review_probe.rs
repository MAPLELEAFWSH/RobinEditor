//! ① 乱码修复的**过目用**量具：拿真素材跑三种功能，把产物与报告落到一个单独目录里，给人过目。
//!
//! 三种功能：① 正文/注释还原（`.fx` 只动注释）② 文件名还原（在副本上改名）③ 还原后再翻中文。
//! **不另写还原算法** —— 全部走 `textenc` 里已在用的那套；翻译走 `translate` 的 MyMemory。
//!
//! 用法：cd src-tauri && cargo test --lib -- --ignored --nocapture 乱码目录_过目用
//!
//! 素材**只读**：所有产物写在 `修复结果_过目用\` 下面的三个子目录里，跟原始素材分开。

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::textenc::{self, NameHit, RenameDone, SegmentReport};
use crate::translate;

/// 只读素材的默认值（换样本用环境变量 `REVIEW_IN`，别改这里）
const 默认输入: &str = r"E:\deepseek-harness\mmd集成工具\实战测试用例\乱码翻译\AnimeScreenTex_v1.0";
/// 产物根的默认值（换样本用 `REVIEW_OUT`，好让每个样本各占一个子目录）
const 默认输出: &str = r"E:\deepseek-harness\mmd集成工具\实战测试用例\乱码翻译\修复结果_过目用";

/// 素材目录：默认那份，`REVIEW_IN` 可以换。
fn 素材() -> String {
    std::env::var("REVIEW_IN").unwrap_or_else(|_| 默认输入.to_string())
}

/// 产物根：默认那层，`REVIEW_OUT` 可以换（换样本时指到它自己的子目录）。
fn 产物() -> String {
    std::env::var("REVIEW_OUT").unwrap_or_else(|_| 默认输出.to_string())
}

const 文本后缀: &[&str] = &["txt", "fx", "fxsub", "conf", "ini", "md", "csv", "x"];

fn 后缀(p: &Path) -> String {
    p.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn 是文本(p: &Path) -> bool {
    文本后缀.contains(&后缀(p).as_str())
}

/// `.fx`/`.fxsub` 只动注释；其余整篇
fn 模式(p: &Path) -> &'static str {
    match 后缀(p).as_str() {
        "fx" | "fxsub" => "fx-comments",
        _ => "whole",
    }
}

/// 有假名 → 基本可以确信是日文正文（乱码里几乎不出假名）
fn 有假名(s: &str) -> bool {
    s.chars().any(|c| {
        let u = c as u32;
        (0x3041..=0x309F).contains(&u) || (0x30A1..=0x30FA).contains(&u) || (0x30FC..=0x30FF).contains(&u)
    })
}

fn 列文件(根: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(根) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            列文件(&p, out);
        } else {
            out.push(p);
        }
    }
}

/// 把整棵树拷到目标目录（保留名字与结构）
fn 拷树(从: &Path, 到: &Path, 累计: &mut usize) {
    fs::create_dir_all(到).ok();
    let Ok(rd) = fs::read_dir(从) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let 名 = e.file_name();
        let 去 = 到.join(&名);
        if p.is_dir() {
            拷树(&p, &去, 累计);
        } else if fs::copy(&p, &去).is_ok() {
            *累计 += 1;
        }
    }
}

fn 段简要(s: &SegmentReport) -> String {
    /* 候选表里同一个结果会重复出现（不同的读法解出同一串），展示前去个重 */
    let mut 见过: Vec<&str> = Vec::new();
    let mut 前三个: Vec<String> = Vec::new();
    for c in &s.候选 {
        if 见过.contains(&c.text.as_str()) {
            continue;
        }
        见过.push(&c.text);
        前三个.push(format!("{}（{}）", c.text, c.via));
        if 前三个.len() == 3 {
            break;
        }
    }
    let 最好 = 前三个.first().cloned().unwrap_or_else(|| "无候选".into());
    let 处置 = if s.applied.is_some() {
        format!("自动改 → {}", s.候选.first().map(|c| c.text.clone()).unwrap_or_default())
    } else if !s.候选.is_empty() {
        format!("够不着门槛，界面给人点「就用这个」：{最好}")
    } else {
        format!("无候选：{}", if s.原因.is_empty() { "——".into() } else { s.原因.clone() })
    };
    format!(
        "`{}` ｜原样 {:.2} ｜门槛 {:.2} ｜增益 {:+.2} ｜假名上升 {:.2} ｜{}",
        s.run, s.base, s.门槛, s.gain, s.假名上升, 处置
    )
}

/// 翻一段：失败就重试，最多两次，中间退避。返回 (译文, 最后一条错)。
///
/// 免费公开接口会返 504 或 `translatedText: null`（服务端抖动），
/// 一次失败就把整篇标成"翻不了"太亏 —— 重试一次划得来，但**不能无限重试**：
/// 逐段翻的时候一次抖动会把耗时翻好几倍（第一次跑就是这么超时的）。
fn 翻一段(文本: &str, 请求计数: &mut usize) -> (Option<String>, String) {
    let mut 最后 = String::new();
    for _试 in 0..2u64 {
        *请求计数 += 1;
        let r = translate::translate_text(
            "mymemory".into(),
            String::new(),
            String::new(),
            String::new(),
            Some(30_000),
            vec![文本.to_string()],
        );
        if r.ok {
            if let Some(t) = r.translations.first() {
                if !t.trim().is_empty() {
                    return (Some(t.clone()), String::new());
                }
                最后 = "返回了空译文".into();
            } else {
                最后 = "没有译文".into();
            }
        } else {
            最后 = r.error.unwrap_or_else(|| "未知".into());
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    (None, 最后)
}

/// 这一段值不值得发出去翻：得是"有文字"的（假名或汉字），纯 ASCII / 纯符号不翻
fn 值得翻(t: &str) -> bool {
    let s = t.trim();
    if s.chars().count() < 2 {
        return false;
    }
    s.chars().any(|c| {
        let u = c as u32;
        有假名(&c.to_string()) || (0x4E00..=0x9FFF).contains(&u) || (0x3000..=0x303F).contains(&u)
    })
}

/// 一次量具里最多发多少次翻译请求（免费公开接口，别把它当自家机器用）
const 请求上限: usize = 60;

#[test]
#[ignore]
fn 乱码目录_过目用() {
    let 输入根 = PathBuf::from(素材());
    assert!(输入根.is_dir(), "素材目录不在：{}", 输入根.display());
    let 输出根 = PathBuf::from(产物());
    let 还原目录 = 输出根.join("还原后");
    let 改名目录 = 输出根.join("改名后");
    let 翻译目录 = 输出根.join("翻译后");
    for d in [&输出根, &还原目录, &改名目录, &翻译目录] {
        fs::create_dir_all(d).expect("建输出目录失败");
    }

    let mut 文件 = Vec::new();
    列文件(&输入根, &mut 文件);
    文件.sort();

    println!("\n【目录情况】{} 个文件", 文件.len());
    for p in &文件 {
        println!(
            "  {:>8} B  {}",
            fs::metadata(p).map(|m| m.len()).unwrap_or(0),
            p.file_name().unwrap_or_default().to_string_lossy()
        );
    }

    // ---------------------------------------------------------------- ① 正文/注释还原
    let mut 报告: Vec<String> = Vec::new();
    let mut 翻译任务: Vec<(PathBuf, String, String, String, Vec<String>)> = Vec::new(); // (原路径, 显示名, 修后文本, 模式, 原注释段)
    let mut 修不了合计 = 0usize;
    let mut 够不着合计 = 0usize;
    let mut 自动改合计 = 0usize;

    for p in &文件 {
        if !是文本(p) {
            continue;
        }
        let 名 = p.file_name().unwrap_or_default().to_string_lossy().to_string();
        let m = 模式(p);
        /* 第三个参数是"操作者指定的目标编码"，探针这边给 None = 自动认（跟它以前的行为一致） */
        let r = match textenc::read_text_fixed(p.to_string_lossy().to_string(), Some(m.into()), None) {
            Ok(r) => r,
            Err(e) => {
                报告.push(format!("### `{名}`\n\n读不了：{e}\n"));
                continue;
            }
        };
        // 产物：按**原名**写进 还原后\（跟素材一一对照）
        let _ = fs::write(还原目录.join(&名), r.text.as_bytes());
        // 翻译时要用的"注释正文"基线：拿它把译文还原回去，就能证明**代码一个字符没动**
        let 片段原文 = textenc::scan_pieces(r.text.clone(), Some(m.into()));

        let 自动: Vec<&SegmentReport> = r.segments.iter().filter(|s| s.applied.is_some()).collect();
        let 够不着: Vec<&SegmentReport> =
            r.segments.iter().filter(|s| s.applied.is_none() && !s.候选.is_empty()).collect();
        let 无候选: Vec<&SegmentReport> =
            r.segments.iter().filter(|s| s.applied.is_none() && s.候选.is_empty()).collect();
        自动改合计 += 自动.len();
        够不着合计 += 够不着.len();
        修不了合计 += 无候选.len();

        let mut 段 = String::new();
        /* 只列"有候选"或"真改了"的段：无候选的段是正常日文/中文，全列出来会把报告淹掉
           （这一批就有 265 段无候选），数字仍照实统计 */
        for s in r.segments.iter().filter(|s| s.applied.is_some() || !s.候选.is_empty()) {
            段.push_str(&format!("  - {}\n", 段简要(s)));
        }
        if 段.is_empty() {
            段.push_str("  - （没有「有候选」或「改了」的段 —— 正文本来就是好的）\n");
        }
        let 用的编码 = {
            let vias: Vec<String> =
                r.segments.iter().filter(|s| s.applied.is_some()).map(|s| s.via.clone()).collect();
            if vias.is_empty() {
                "（没自动改，无）".to_string()
            } else {
                vias.join("、")
            }
        };
        报告.push(format!(
            "### `{名}`（{} 字节 · 模式 `{m}`）\n\n\
             - 识别成什么编码：**{}**（原文件带 BOM：{}）\n\
             - 用了哪种编码组合：{}\n\
             - 是否自动改：{}\n\
             - 段统计：自动改 {} / 够不着门槛 {} / 无候选 {}\n\
             - 产物：`还原后\\{名}`\n\n{}\n",
            fs::metadata(p).map(|x| x.len()).unwrap_or(0),
            r.encoding,
            if r.bom { "是" } else { "否" },
            if 用的编码.is_empty() { "（无）" } else { &用的编码 },
            if r.changed { "**改了**" } else { "没改（正文本来就是好的，或够不着门槛）" },
            自动.len(),
            够不着.len(),
            无候选.len(),
            段
        ));

        if !r.text.trim().is_empty() {
            翻译任务.push((p.clone(), 名.clone(), r.text.clone(), m.to_string(), 片段原文));
        }
    }

    // ---------------------------------------------------------------- ② 名字还原（在副本上改名）
    let 名字 = textenc::scan_names(输入根.to_string_lossy().to_string(), None, None);
    let mut 拷了 = 0usize;
    拷树(&输入根, &改名目录, &mut 拷了);
    let mut 计划: Vec<RenameDone> = Vec::new();
    for h in &名字 {
        if !h.自动可改 {
            continue;
        }
        let 相对 = Path::new(&h.path).strip_prefix(&输入根).unwrap_or(Path::new(""));
        let 副 = 改名目录.join(相对);
        计划.push(RenameDone { from: 副.to_string_lossy().to_string(), to: h.修后名.clone() });
    }
    let 改名结果 = textenc::rename_entries(计划);

    // 第二份：**够不着门槛的那几个，按界面「就用这个」的效果改**（人点一下才走的路，
    // 这里是把"点了以后能成什么样"一并摆出来 —— 光说"有候选"看不出效果）
    let 候选目录 = 输出根.join("改名后_用候选");
    let mut 拷了2 = 0usize;
    拷树(&输入根, &候选目录, &mut 拷了2);
    let mut 计划2: Vec<RenameDone> = Vec::new();
    let mut 人工表: Vec<(String, String)> = Vec::new();
    for h in &名字 {
        if h.自动可改 {
            // 自动能改的，两份里都改
            let 相对 = Path::new(&h.path).strip_prefix(&输入根).unwrap_or(Path::new(""));
            计划2.push(RenameDone {
                from: 候选目录.join(相对).to_string_lossy().to_string(),
                to: h.修后名.clone(),
            });
            continue;
        }
        // 够不着的：走 repair_text_forced（界面「就用这个」那条路）
        let 段 = match textenc::repair_text(h.原名.clone(), None) {
            r => r.segments,
        };
        let 强制: Vec<(usize, usize)> = 段
            .iter()
            .enumerate()
            .filter(|(_, s)| s.applied.is_none() && !s.候选.is_empty())
            .map(|(i, _)| (i, 0))
            .collect();
        if 强制.is_empty() {
            continue;
        }
        let r = textenc::repair_text_forced(h.原名.clone(), 强制, None, None);
        if !r.changed {
            continue;
        }
        let 相对 = Path::new(&h.path).strip_prefix(&输入根).unwrap_or(Path::new(""));
        计划2.push(RenameDone {
            from: 候选目录.join(相对).to_string_lossy().to_string(),
            to: r.fixed.clone(),
        });
        人工表.push((h.原名.clone(), r.fixed));
    }
    let 改名结果2 = textenc::rename_entries(计划2);

    let mut 名字表 = String::from("| 原名 | 修后名 | 自动可改 | 用了哪种编码组合 | 说明 | 候选（前 3） |\n|---|---|---|---|---|---|\n");
    for h in &名字 {
        let via = h
            .候选
            .first()
            .map(|c| c.via.clone())
            .unwrap_or_else(|| "（无候选）".into());
        let 候选 = h
            .候选
            .iter()
            .take(3)
            .map(|c| format!("`{}`", c.text))
            .collect::<Vec<_>>()
            .join("、");
        名字表.push_str(&format!(
            "| `{}` | `{}` | {} | {} | {} | {} |\n",
            h.原名,
            h.修后名,
            if h.自动可改 { "**是**" } else { "否（够不着门槛）" },
            via,
            if h.原因.is_empty() { "—".into() } else { h.原因.clone() },
            if 候选.is_empty() { "—".into() } else { 候选 }
        ));
    }
    名字表.push_str(&format!(
        "\n- 目录里共扫出 **{} 个**名字需要处理；**自动可改 {} 个**；副本里已改名 **{} 个**；失败 {} 个。\n",
        名字.len(),
        名字.iter().filter(|h| h.自动可改).count(),
        改名结果.done.len(),
        改名结果.failed.len()
    ));
    名字表.push_str(&format!(
        "- 第二份副本 `改名后_用候选\\`：**把够不着门槛的那几个按界面「就用这个」的效果也改了** —— 改名 {} 个（人工确认 {} 个）。\n",
        改名结果2.done.len(),
        人工表.len()
    ));
    for (原, 新) in &人工表 {
        名字表.push_str(&format!("- 人工确认（点「就用这个」）：`{原}` → `{新}`\n"));
    }
    for d in &改名结果.done {
        名字表.push_str(&format!(
            "- 改名成功：`{}` → `{}`\n",
            Path::new(&d.from).file_name().unwrap_or_default().to_string_lossy(),
            Path::new(&d.to).file_name().unwrap_or_default().to_string_lossy()
        ));
    }
    for f in &改名结果.failed {
        名字表.push_str(&format!("- 改名失败：`{}` —— {}\n", f.from, f.原因));
    }

    // ---------------------------------------------------------------- ③ 还原后再翻中文
    let mut 翻译报告 = String::new();
    let mut 三行样例: Vec<(String, String, String)> = Vec::new();
    let mut 请求数 = 0usize;
    let mut 翻失败 = 0usize;

    for (原路径, 名, 修后文本, m, 片段原文) in &翻译任务 {
        // 段落切分沿用同一套（.fx 只取注释）
        let 片段 = textenc::scan_pieces(修后文本.clone(), Some(m.clone()));
        if 片段.is_empty() {
            翻译报告.push_str(&format!("### `{名}`\n\n没有可翻的段落（整篇没有注释/正文段落）。\n\n"));
            continue;
        }
        // 还原没成功的段：界面上会让人点「就用这个」的那些 —— 不硬翻
        /* 同上：探针走自动认（None） */
        let 段报 = textenc::read_text_fixed(原路径.to_string_lossy().to_string(), Some(m.clone()), None)
            .map(|r| r.segments)
            .unwrap_or_default();
        let 未还原: Vec<String> = 段报
            .iter()
            .filter(|s| s.applied.is_none() && !s.候选.is_empty())
            .map(|s| s.run.clone())
            .collect();
        let 要翻: Vec<String> = 片段
            .iter()
            .filter(|t| !未还原.iter().any(|u| !u.is_empty() && t.contains(u.as_str())))
            .cloned()
            .collect();
        let 跳过段 = 片段.len() - 要翻.len();

        // 逐段翻：**先去重**（同一个注释会重复出现），只翻值得翻的，并且有全局请求上限。
        // 一段失败只影响这一段，其余照翻；没翻成的原样留着并单独列出来。
        let mut 缓存: Vec<(String, String)> = Vec::new(); // (原文, 译文)
        let mut 译文: Vec<String> = Vec::with_capacity(片段.len());
        let mut 本文件失败: Vec<String> = Vec::new();
        let mut 超出上限 = 0usize;
        for t in &片段 {
            if !要翻.contains(t) || !值得翻(t) {
                译文.push(t.clone()); // 还原没到自动改的程度 / 没文字 → 不翻，原样留着
                continue;
            }
            if let Some((_, y)) = 缓存.iter().find(|(a, _)| a == t) {
                译文.push(y.clone());
                continue;
            }
            if 请求数 >= 请求上限 {
                超出上限 += 1;
                译文.push(t.clone());
                continue;
            }
            match 翻一段(t, &mut 请求数) {
                (Some(x), _) => {
                    缓存.push((t.clone(), x.clone()));
                    译文.push(x);
                }
                (None, e) => {
                    本文件失败.push(format!("`{}` —— {e}", t.trim()));
                    译文.push(t.clone());
                }
            }
        }

        if 译文.iter().all(|t| 片段.contains(t)) && !本文件失败.is_empty() {
            // 一段都没翻成
            翻失败 += 1;
            翻译报告.push_str(&format!(
                "### `{名}`\n\n**这一段翻译全部失败**（{} 段）：\n{}\n\n",
                本文件失败.len(),
                本文件失败.iter().map(|x| format!("  - {x}")).collect::<Vec<_>>().join("\n")
            ));
            continue;
        }

        // 只替换段落内容，其余字节不动
        let 出 = textenc::apply_pieces(修后文本.clone(), Some(m.clone()), 译文.clone());
        match 出 {
            Ok(文本) => {
                let _ = fs::write(翻译目录.join(名), 文本.as_bytes());
                /* "代码一个字符没动"的证明：把译文里的注释正文**换回原文的注释正文**，
                   结果应当与"还原后"那份**逐字符相同** —— 说明差异全在注释正文里 */
                let 代码没动 = matches!(
                    textenc::apply_pieces(文本.clone(), Some(m.clone()), 片段原文.clone()),
                    Ok(x) if &x == 修后文本
                );
                let 对: Vec<String> = 片段
                    .iter()
                    .zip(译文.iter())
                    .filter(|(a, b)| a != b)
                    .map(|(a, b)| format!("  - 日：{}\n    中：{}", a.trim(), b.trim()))
                    .collect();
                翻译报告.push_str(&format!(
                    "### `{名}`\n\n- 段落 {} 个（翻了 {} 个，跳过 {} 个：还原没到自动改的程度）\n\
                     - **代码一个字符没动**：{}\n\
                     - 产物：`翻译后\\{名}`\n{}\n{}\n",
                    片段.len(),
                    要翻.len(),
                    跳过段,
                    if *m == "fx-comments" {
                        if 代码没动 {
                            "**是**（把译文里的注释正文换回原文后，与 `还原后\\` 那份逐字符相同）".to_string()
                        } else {
                            "**否 —— 注释之外也被改了，这条要查！**".to_string()
                        }
                    } else {
                        "（纯文本文件，整篇就是正文）".to_string()
                    },
                    if 对.is_empty() { "  - （译文与原文相同或为空）".into() } else { 对.join("\n") },
                    if 本文件失败.is_empty() && 超出上限 == 0 {
                        String::new()
                    } else {
                        format!(
                            "\n- **没翻成、已原样保留**（{} 段）：{}\n{}",
                            本文件失败.len() + 超出上限,
                            if 超出上限 > 0 { format!("其中 {超出上限} 段是本次量具的请求上限用完了") } else { String::new() },
                            本文件失败.iter().map(|x| format!("  - {x}\n")).collect::<Vec<_>>().join("")
                        )
                    }
                ));
                for (a, b) in 片段.iter().zip(译文.iter()) {
                    if a != b && 三行样例.len() < 12 {
                        let via = 段报
                            .iter()
                            .find(|s| s.applied.is_some())
                            .map(|s| s.via.clone())
                            .unwrap_or_else(|| "正文本来就是好的日文".into());
                        三行样例.push((via, a.trim().to_string(), b.trim().to_string()));
                    }
                }
            }
            Err(e) => {
                翻失败 += 1;
                翻译报告.push_str(&format!("### `{名}`\n\n**写回失败**：{e}\n\n"));
            }
        }
    }

    // ---------------------------------------------------------------- 报告
    let mut 全 = String::from("# ① 乱码修复 · 过目用产物\n\n");
    全.push_str(&format!(
        "- 素材（**只读**）：`{}`\n- 产物：`{}`\n\
         - 三个子目录：`还原后\\`（正文还原，按**原名**，便于与素材一一对照）、\
         `改名后\\`（副本 + 名字还原）、`翻译后\\`（还原后再翻中文）\n\
         - 统计：正文自动改 **{自动改合计}** 段、够不着门槛 **{够不着合计}** 段、无候选 **{修不了合计}** 段；\
         名字自动可改 **{}** 个；翻译请求 **{请求数}** 次、失败 **{翻失败}** 次\n\n",
        输入根.display(),
        输出根.display(),
        名字.iter().filter(|h| h.自动可改).count()
    ));

    全.push_str("## 一、目录里到底是什么情况\n\n");
    let 名字乱 = 名字.iter().filter(|h: &&NameHit| h.自动可改).count();
    全.push_str(&format!(
        "共 {} 个文件；其中**文件名像乱码**的 {} 个（自动可改 {} 个），**正文需要还原**的段 {} 个。\n\
         结论：这一批的乱码主要集中在**文件名**上；正文要按下面的逐文件交代判断。\n\n",
        文件.len(),
        名字.len(),
        名字乱,
        自动改合计
    ));

    全.push_str("## 二、逐文件交代（正文/注释还原）\n\n");
    全.push_str(&报告.join("\n"));

    全.push_str("\n## 三、文件名还原（在副本上改名）\n\n");
    全.push_str(&名字表);

    全.push_str("\n## 四、还原后再翻中文\n\n");
    全.push_str(&翻译报告);

    全.push_str("\n## 五、三行样例（乱码 → 日文 → 中文）\n\n");
    if 三行样例.is_empty() {
        全.push_str("（这一批素材的正文本来就是正常日文，没有出现\"乱码 → 日文\"的正文样例。\
                     下面给的是**文件名**上的真实乱码对照，第三行是它的中文。）\n\n");
    }
    // 名字上的真实乱码 → 日文 → 中文
    let 名任务: Vec<String> = 名字.iter().filter(|h| h.自动可改).map(|h| h.修后名.clone()).collect();
    let 名译 = if 名任务.is_empty() {
        Vec::new()
    } else {
        let r = translate::translate_text(
            "mymemory".into(),
            String::new(),
            String::new(),
            String::new(),
            Some(30_000),
            名任务.clone(),
        );
        if r.ok { r.translations } else { Vec::new() }
    };
    let mut 序 = 0usize;
    for h in 名字.iter().filter(|h| h.自动可改) {
        序 += 1;
        let 中 = 名任务
            .iter()
            .position(|x| *x == h.修后名)
            .and_then(|i| 名译.get(i).cloned())
            .unwrap_or_else(|| "（翻译没拿到）".into());
        全.push_str(&format!(
            "{序}. 乱码：`{}`\n   日文：`{}`\n   中文：`{}`\n   （**自动改**）\n\n",
            h.原名, h.修后名, 中
        ));
    }
    // 够不着门槛的那几个：走「就用这个」之后也能出日文与中文
    let 人工名: Vec<String> = 人工表.iter().map(|(_, 新)| 新.clone()).collect();
    let 人工译 = if 人工名.is_empty() {
        Vec::new()
    } else {
        let mut 出 = Vec::new();
        for 名 in &人工名 {
            let mut 计数 = 0usize;
            match 翻一段(名, &mut 计数) {
                (Some(t), _) => 出.push(t),
                (None, _) => 出.push("（翻译没拿到）".into()),
            }
            std::thread::sleep(Duration::from_millis(150));
        }
        出
    };
    for (原, 新) in 人工表.iter() {
        序 += 1;
        let 中 = 人工译
            .get(序 - 名字.iter().filter(|h| h.自动可改).count() - 1)
            .cloned()
            .unwrap_or_else(|| "（翻译没拿到）".into());
        全.push_str(&format!(
            "{序}. 乱码：`{原}`\n   日文：`{新}`\n   中文：`{中}`\n   （**够不着门槛** —— 界面上摆出候选，人点「就用这个」就成这样）\n\n"
        ));
    }
    for (via, 日, 中) in 三行样例.iter() {
        序 += 1;
        全.push_str(&format!(
            "{序}. 乱码：（这一批的正文没有乱码，是**本来就是好的日文/注释**；还原路线 `{via}`）\n   日文：`{日}`\n   中文：`{中}`\n\n"
        ));
    }

    fs::write(输出根.join("过目报告.md"), 全.as_bytes()).expect("写过目报告失败");
    fs::write(输出根.join("改名对照.md"), 名字表.as_bytes()).expect("写改名对照失败");

    println!("\n【产物】");
    println!("  报告    : {}", 输出根.join("过目报告.md").display());
    println!("  改名对照: {}", 输出根.join("改名对照.md").display());
    println!("  还原后  : {}", 还原目录.display());
    println!("  改名后  : {}（拷了 {拷了} 个文件，改名 {} 个）", 改名目录.display(), 改名结果.done.len());
    println!("  翻译后  : {}", 翻译目录.display());
    println!(
        "\n【统计】正文自动改 {自动改合计} 段 / 够不着 {够不着合计} 段 / 无候选 {修不了合计} 段；\
         名字可改 {}；翻译请求 {请求数} 次、失败 {翻失败} 次",
        名字.iter().filter(|h| h.自动可改).count()
    );
}
