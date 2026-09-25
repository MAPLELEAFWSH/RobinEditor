//! 外接翻译引擎。两条路：
//!
//! 1. **`mymemory`（默认）**：MyMemory 的公开接口，免费、无需 Key（有每日额度）。
//!    它一次只吃一块（约 500 字节），所以按段分块发 —— **切点永远落在字符边界上**。
//! 2. **`custom`**：OpenAI 兼容接口（`POST {base}/chat/completions`），
//!    一个 base URL + 模型名 + Key 盖住本机 Ollama / LM Studio、云端各家与各种中转。
//!
//! 两条路都不引 `tauri-plugin-http`，跟本工程"文件读写自己写命令"一个路子。
//! TLS 走 `native-tls`（Windows 上是 SChannel）：不用 rustls / aws-lc-rs，
//! 那两个在 Windows 上要装 NASM，为几个 GET/POST 不值当。
//!
//! 配置**每次调用传进来**，这边不落盘、不记状态 —— 界面上那几栏才是唯一的事实来源。
//! 界面上那条"再翻成中文"的开关默认关着：**只有用户打开它才会发出请求**。
//!
//! 自定义那条路把段落打包成一块带编号的文本发一次，回来按编号拆。**编号对不上就整批判失败** ——
//! 宁可报错，也不要把译文错位写进用户的文件。MyMemory 没有编号这一说（一段一块），
//! 所以它按段独立拼接。

use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;

/// 系统提示词。
///
/// 要求写死成"只输出译文"：模型爱加"好的，以下是翻译："这种前缀，
/// 那点前缀会原样写进注释里。
const SYSTEM: &str = "\
你在把日文的技术注释翻译成简体中文。规则：
- 只输出译文本身。不要解释、不要加引号、不要在前后加任何说明。
- 我发过去的每一段前面都有一个 <<<数字>>> 标记。**把标记原样保留**，译文放在对应标记下面。
- 一段一段翻，不要合并段落，也不要漏掉任何一段。
- 段落里如果有代码、宏名、路径、数字，原样保留不要翻。
- 保留原有的换行结构：原来几行，译文就几行。";

#[derive(Serialize)]
pub struct TranslateResult {
    pub ok: bool,
    pub translations: Vec<String>,
    pub error: Option<String>,
}

/// 把段落拼成一块。编号是**唯一**能保证"译文不错位"的东西。
fn pack(texts: &[String]) -> String {
    let mut s = String::new();
    for (i, t) in texts.iter().enumerate() {
        s.push_str(&format!("<<<{}>>>\n", i + 1));
        s.push_str(t);
        if !t.ends_with('\n') {
            s.push('\n');
        }
    }
    s
}

/// `<<<3>>>` 这种标记行的编号
fn marker(line: &str) -> Option<usize> {
    let t = line.trim();
    let t = t.strip_prefix("<<<")?.strip_suffix(">>>")?;
    t.trim().parse::<usize>().ok()
}

/// 按编号拆回来。数量或编号对不上就报错 —— 不猜、不补、不重排。
fn unpack(reply: &str, n: usize) -> Result<Vec<String>, String> {
    let mut 段: Vec<(usize, Vec<&str>)> = Vec::new();
    for line in reply.lines() {
        if let Some(k) = marker(line) {
            段.push((k, Vec::new()));
            continue;
        }
        // 第一个标记之前的闲话（"好的"之类）直接丢
        if let Some(last) = 段.last_mut() {
            last.1.push(line);
        }
    }
    if 段.len() != n {
        return Err(format!(
            "引擎回了 {} 段，发过去的是 {} 段 —— 编号对不上，没动文件",
            段.len(),
            n
        ));
    }
    let mut out = Vec::with_capacity(n);
    for (i, (k, lines)) in 段.iter().enumerate() {
        if *k != i + 1 {
            return Err(format!("引擎回的编号乱了：第 {} 段写的是 {} 号", i + 1, k));
        }
        out.push(lines.join("\n"));
    }
    Ok(out)
}

/// 请求体。形状是 OpenAI 那一套，`temperature: 0` —— 翻译要稳定，不要发挥。
fn build_body(model: &str, user: &str) -> Value {
    json!({
        "model": model,
        "messages": [
            { "role": "system", "content": SYSTEM },
            { "role": "user", "content": user }
        ],
        "temperature": 0
    })
}

/// 地址拼接。末尾多个斜杠、或者用户直接把 `/chat/completions` 填进去，都要能认。
fn endpoint(base: &str) -> Result<String, String> {
    let b = base.trim().trim_end_matches('/');
    if b.is_empty() {
        return Err("没填引擎地址".into());
    }
    if b.ends_with("/chat/completions") {
        return Ok(b.to_string());
    }
    Ok(format!("{b}/chat/completions"))
}

/// 错误里给一句人话：这三种是实际会撞上的。
fn hint(status: u16) -> &'static str {
    match status {
        401 | 403 => "（Key 不对或者没权限）",
        404 => "（地址对不上：检查末尾少没少 /v1）",
        429 => "（被限流了）",
        500..=599 => "（服务端自己出错）",
        _ => "",
    }
}

fn 前几个字(s: &str, n: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= n {
        t.to_string()
    } else {
        let mut out: String = t.chars().take(n).collect();
        out.push('…');
        out
    }
}

/// 发一次请求，返回助手那条消息的正文。
/// 建一个会走 TLS 的 agent（两条路共用一份）。
///
/// **必须显式挂 native-tls 连接器**：ureq 的 `native-tls` 特征只是把 crate 编进来，
/// 它自己的 `ureq::get` / `ureq::post` 那条捷径**只用 rustls**；不开 rustls 又不挂连接器，
/// 任何 https 请求都会报 `no TLS backend is configured`（这条实测踩到过：
/// 单测看着全绿，真发一次才发现 —— 所以每条引擎都要有一条 `#[ignore]` 的真请求测试）。
fn 代理(timeout_ms: u64) -> Result<ureq::Agent, String> {
    let 连 = native_tls::TlsConnector::new().map_err(|e| format!("TLS 初始化失败：{e}"))?;
    Ok(ureq::AgentBuilder::new()
        .timeout(Duration::from_millis(timeout_ms.max(1000)))
        .tls_connector(std::sync::Arc::new(连))
        .build())
}

fn chat(url: &str, api_key: &str, model: &str, user: &str, timeout_ms: u64) -> Result<String, String> {
    let agent = 代理(timeout_ms)?;
    let mut req = agent
        .post(url)
        .set("Content-Type", "application/json")
        .set("Accept", "application/json");
    let key = api_key.trim();
    if !key.is_empty() {
        req = req.set("Authorization", &format!("Bearer {key}"));
    }
    let body = build_body(model, user).to_string();

    let resp = match req.send_string(&body) {
        Ok(r) => r,
        Err(ureq::Error::Status(code, r)) => {
            let text = r.into_string().unwrap_or_default();
            return Err(format!("HTTP {code}{}：{}", hint(code), 前几个字(&text, 300)));
        }
        Err(e) => {
            return Err(format!("连不上 {url}：{e}（本机服务起了吗？）"));
        }
    };
    let text = resp
        .into_string()
        .map_err(|e| format!("响应读不出来：{e}"))?;
    let v: Value = serde_json::from_str(&text)
        .map_err(|e| format!("响应不是 JSON（{e}）：{}", 前几个字(&text, 300)))?;

    // 有的服务端把错误塞在 200 里
    if let Some(err) = v.get("error") {
        return Err(format!("引擎报错：{}", 前几个字(&err.to_string(), 300)));
    }
    let content = v
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .ok_or_else(|| format!("响应里没有 choices[0].message.content：{}", 前几个字(&text, 300)))?;
    match content {
        Value::String(s) => Ok(s.clone()),
        // 新版 OpenAI 那种把正文拆成数组的写法
        Value::Array(parts) => {
            let mut s = String::new();
            for p in parts {
                if let Some(t) = p.get("text").and_then(|t| t.as_str()) {
                    s.push_str(t);
                }
            }
            if s.is_empty() {
                return Err(format!("响应里的正文是空的：{}", 前几个字(&text, 300)));
            }
            Ok(s)
        }
        _ => Err(format!("响应里的正文既不是字符串也不是数组：{}", 前几个字(&text, 300))),
    }
}

// ---------------------------------------------------------------- MyMemory（默认引擎）

/// MyMemory 的接口：**免费、无需 Key**（匿名有每日额度）。
const MYMEMORY_接口: &str = "https://api.mymemory.translated.net/get";

/// 单次 `q` 的字节上限。
///
/// 官方说约 500 字节，这里留余量取 480 —— 汉字一个字 3 字节，480 能放 160 个字，
/// 一段注释基本一次就够。
const MYMEMORY_上限: usize = 480;

/// 按字节上限切块，**不许切断多字节字符**。
///
/// 直接按字节下标切会把一个汉字劈成两半，编成 URL 之后就是两个乱码字节，
/// 服务端要么报错要么翻出垃圾 —— 所以切点永远落在**字符边界**上。
/// 能不硬切就不硬切：上限之内有句末（。！？!?；;\n）就切在那儿，译文更连贯。
fn 分块(s: &str, 上限: usize) -> Vec<String> {
    let 上限 = 上限.max(8);
    let mut 出: Vec<String> = Vec::new();
    let mut 起 = 0usize;
    while 起 < s.len() {
        let 剩 = &s[起..];
        if 剩.len() <= 上限 {
            出.push(剩.to_string());
            break;
        }
        // 上限之内最后一个**字符边界**：能安全切到的最大位置
        let mut 安全 = 上限;
        while 安全 > 0 && !s.is_char_boundary(起 + 安全) {
            安全 -= 1;
        }
        let 窗口 = &s[起..起 + 安全];
        let 句末 = 窗口
            .char_indices()
            .filter(|(_, c)| matches!(c, '。' | '！' | '？' | '!' | '?' | '；' | ';' | '\n'))
            .map(|(i, c)| i + c.len_utf8())
            .last();
        // 句末太靠前就不认（否则一块只剩几个字，请求数白涨）
        let 用 = match 句末 {
            Some(p) if p >= 上限 / 3 => p,
            _ => 安全,
        };
        出.push(s[起..起 + 用].to_string());
        起 += 用;
    }
    if 出.is_empty() {
        出.push(String::new());
    }
    出
}

/// URL 查询串的百分号编码。只放行 RFC 3986 的 unreserved，其余一律按字节转义。
///
/// 自己写是因为不引第三方库；这里只做查询串，不需要处理整条 URL。
fn url编码(s: &str) -> String {
    let mut 出 = String::with_capacity(s.len() * 3);
    for b in s.as_bytes() {
        match *b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => 出.push(*b as char),
            _ => 出.push_str(&format!("%{:02X}", b)),
        }
    }
    出
}

/// 从 MyMemory 的响应里取译文。
///
/// **错误原样透出**：额度用满、语言对不支持、翻不出来，是三种不同的事，
/// 用户得能一眼看出是哪种（额度那种要写清"等，或者换引擎"）。
fn 解析_mymemory(v: &Value) -> Result<String, String> {
    let 状态 = v.get("responseStatus").and_then(|s| s.as_i64()).unwrap_or(200);
    let 说明 = v
        .get("responseDetails")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();
    if 状态 != 200 {
        return Err(format!("MyMemory 报错（{状态}）：{说明}"));
    }
    let t = v
        .get("responseData")
        .and_then(|d| d.get("translatedText"))
        .and_then(|t| t.as_str())
        .ok_or_else(|| "响应里没有 responseData.translatedText".to_string())?;
    let t = t.trim();
    if t.is_empty() {
        return Err("MyMemory 返回了空译文".into());
    }
    Ok(t.to_string())
}

/// 发一次 MyMemory 请求（GET，一个 `q` 一块）。
fn mymemory(q: &str, timeout_ms: u64) -> Result<String, String> {
    let url = format!(
        "{}?q={}&langpair={}",
        MYMEMORY_接口,
        url编码(q),
        url编码("ja|zh-CN")
    );
    let agent = 代理(timeout_ms)?;
    let resp = match agent.get(&url).set("Accept", "application/json").call() {
        Ok(r) => r,
        Err(ureq::Error::Status(code, r)) => {
            let text = r.into_string().unwrap_or_default();
            return Err(format!("MyMemory 返回 HTTP {code}：{}", 前几个字(&text, 300)));
        }
        Err(e) => {
            return Err(format!("连不上 MyMemory（{MYMEMORY_接口}）：{e}"));
        }
    };
    let text = resp
        .into_string()
        .map_err(|e| format!("响应读不出来：{e}"))?;
    let v: Value = serde_json::from_str(&text)
        .map_err(|e| format!("响应不是 JSON（{e}）：{}", 前几个字(&text, 300)))?;
    解析_mymemory(&v).map_err(|e| format!("{e}｜原始响应：{}", 前几个字(&text, 300)))
}

/// 翻若干段。空配置直接拒绝 —— 连 DNS 都不查。
#[tauri::command]
pub fn translate_text(
    engine: String,
    base_url: String,
    model: String,
    api_key: String,
    timeout_ms: Option<u64>,
    texts: Vec<String>,
) -> TranslateResult {
    let 失败 = |e: String| TranslateResult { ok: false, translations: vec![], error: Some(e) };

    if texts.is_empty() {
        return 失败("没有要翻的段落".into());
    }
    let 超时 = timeout_ms.unwrap_or(30_000);

    // 默认引擎：MyMemory（免费公开、无需 Key）。它一次只吃一块，所以按段分块发。
    if engine.trim() == "mymemory" {
        let mut 出: Vec<String> = Vec::new();
        for t in &texts {
            let mut 段 = String::new();
            for 块 in 分块(t, MYMEMORY_上限) {
                match mymemory(&块, 超时) {
                    Ok(x) => 段.push_str(&x),
                    Err(e) => return 失败(e),
                }
            }
            出.push(段);
        }
        return TranslateResult { ok: true, translations: 出, error: None };
    }

    // 自定义：OpenAI 兼容接口
    if model.trim().is_empty() {
        return 失败("没填模型名".into());
    }
    let url = match endpoint(&base_url) {
        Ok(u) => u,
        Err(e) => return 失败(e),
    };

    let user = pack(&texts);
    let reply = match chat(&url, &api_key, model.trim(), &user, 超时) {
        Ok(r) => r,
        Err(e) => return 失败(e),
    };
    match unpack(&reply, texts.len()) {
        Ok(translations) => TranslateResult { ok: true, translations, error: None },
        Err(e) => 失败(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 请求体形状：OpenAI 那一套，两条消息、temperature 0。
    /// **不真发网络请求** —— 只查构造出来的 JSON。
    #[test]
    fn body_shape_is_openai_compatible() {
        let b = build_body("qwen2.5:7b", "<<<1>>>\nテクスチャ");
        assert_eq!(b["model"], "qwen2.5:7b");
        assert_eq!(b["temperature"], 0);
        let msgs = b["messages"].as_array().unwrap();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0]["role"], "system");
        assert_eq!(msgs[1]["role"], "user");
        assert_eq!(msgs[1]["content"], "<<<1>>>\nテクスチャ");
        assert!(
            msgs[0]["content"].as_str().unwrap().contains("<<<数字>>>"),
            "系统提示词要教它保住编号标记"
        );
        // 顶层就这三个键，多一个都算形状变了
        let keys: Vec<&String> = b.as_object().unwrap().keys().collect();
        assert_eq!(keys.len(), 3, "实得 {keys:?}");
    }

    /// 打包 → 拆分往返。多段、多行、空段都要对得上。
    #[test]
    fn pack_unpack_round_trip() {
        let 原文 = vec![
            " テクスチャの設定".to_string(),
            " ブロック\n   複数行 ".to_string(),
            "".to_string(),
        ];
        let packed = pack(&原文);
        assert!(packed.contains("<<<1>>>"));
        assert!(packed.contains("<<<3>>>"));
        // 假装这是引擎回的：编号 + 译文
        let reply = "<<<1>>>\n 贴图设置\n<<<2>>>\n 块\n 多行\n<<<3>>>\n\n";
        let out = unpack(reply, 3).unwrap();
        assert_eq!(out[0], " 贴图设置");
        assert_eq!(out[1], " 块\n 多行");
        assert_eq!(out[2], "");
    }

    /// 段数对不上 / 编号乱了 → 报错，不返回半成品
    #[test]
    fn unpack_refuses_mismatched_numbering() {
        let 两段 = "<<<1>>>\n甲\n<<<2>>>\n乙\n";
        assert!(unpack(两段, 2).is_ok());
        let e = unpack(两段, 3).unwrap_err();
        assert!(e.contains("3 段") || e.contains("对不上"), "实得 {e}");

        let 少一段 = "<<<1>>>\n甲\n";
        assert!(unpack(少一段, 2).is_err(), "只有一段却要两段，必须报错");

        let 乱序 = "<<<2>>>\n甲\n<<<1>>>\n乙\n";
        let e = unpack(乱序, 2).unwrap_err();
        assert!(e.contains("编号乱了"), "实得 {e}");

        // 同一编号出现两次也算乱
        assert!(unpack("<<<1>>>\n甲\n<<<1>>>\n乙\n", 2).is_err());
    }

    /// 模型爱在开头加一句废话：标记之前的都丢掉，不影响拆分
    #[test]
    fn unpack_drops_chatter_before_the_first_marker() {
        let reply = "好的，以下是翻译：\n<<<1>>>\n 贴图\n";
        assert_eq!(unpack(reply, 1).unwrap(), vec![" 贴图".to_string()]);
    }

    /// 地址拼接：末尾斜杠、已经带了完整路径，都要认
    #[test]
    fn endpoint_join_is_forgiving() {
        assert_eq!(endpoint("http://127.0.0.1:11434/v1").unwrap(), "http://127.0.0.1:11434/v1/chat/completions");
        assert_eq!(endpoint("http://127.0.0.1:11434/v1/").unwrap(), "http://127.0.0.1:11434/v1/chat/completions");
        assert_eq!(endpoint("  https://api.deepseek.com/v1  ").unwrap(), "https://api.deepseek.com/v1/chat/completions");
        // 用户直接把整条路径填进来
        assert_eq!(
            endpoint("http://localhost:8080/v1/chat/completions").unwrap(),
            "http://localhost:8080/v1/chat/completions"
        );
        assert!(endpoint("").is_err());
        assert!(endpoint("   ").is_err());
    }

    /// 引擎空着 / 模型名空着 → 直接拒绝，不碰网络
    #[test]
    fn empty_config_is_refused_without_any_request() {
        // 自定义引擎：地址或模型名没填就不发
        let r = translate_text("custom".into(), "".into(), "m".into(), "".into(), None, vec!["あ".into()]);
        assert!(!r.ok);
        assert!(r.error.unwrap().contains("没填引擎地址"));

        let r = translate_text(
            "custom".into(),
            "http://127.0.0.1:1/v1".into(),
            "  ".into(),
            "".into(),
            None,
            vec!["あ".into()],
        );
        assert!(!r.ok);
        assert!(r.error.unwrap().contains("没填模型名"));

        // 没有段落也不用发（两种引擎都一样）
        let r = translate_text(
            "custom".into(),
            "http://127.0.0.1:1/v1".into(),
            "m".into(),
            "".into(),
            None,
            vec![],
        );
        assert!(!r.ok);
        assert!(r.error.unwrap().contains("没有要翻的段落"));

        let r = translate_text("mymemory".into(), "".into(), "".into(), "".into(), None, vec![]);
        assert!(!r.ok);
        assert!(r.error.unwrap().contains("没有要翻的段落"));
    }

    /// 分块：**不许切断多字节字符**，每块不超上限，拼回来等于原文。
    ///
    /// 这条是 MyMemory 那条路的命门：切在汉字中间 → URL 里出现半个字符的字节 →
    /// 服务端翻出垃圾，而界面上看起来"翻译成功了"。
    #[test]
    fn 分块_不切断多字节字符() {
        // 每个汉字 3 字节；上限 10 → 每块最多 3 个字（9 字节），第 4 个字放不下
        // 12 个字按"每块 3 字"切 → 正好 4 块
        let s = "材质名测试文本共十六个字";
        assert_eq!(s.chars().count(), 12, "这条断言的数字是按 12 字算的");
        let 块 = 分块(s, 10);
        assert_eq!(块.concat(), s, "拼回来必须等于原文");
        for b in &块 {
            assert!(b.len() <= 10, "块超上限：{b:?} 是 {} 字节", b.len());
            assert!(!b.is_empty(), "不许出现空块");
        }
        assert_eq!(块.len(), 4, "12 字按每块 3 字切应当是 4 块");
        assert!(块.iter().all(|b| b.chars().count() == 3), "每块正好 3 个字");

        // 上限 6：一个汉字 3 字节，正好两块一个字，仍不许切坏
        let 块 = 分块("汉字测试", 6);
        assert_eq!(块.concat(), "汉字测试");
        assert!(块.iter().all(|b| b.len() <= 6));

        // 英文（1 字节）与汉字混排
        let s = "// テクスチャ の設定を変更する abcdefg";
        let 块 = 分块(s, 12);
        assert_eq!(块.concat(), s);
        assert!(块.iter().all(|b| b.len() <= 12));
    }

    /// 分块优先切在句末，且不要切出"几个字一块"的碎块。
    #[test]
    fn 分块_优先在句末切() {
        let s = "第一句。第二句。第三句。";
        let 块 = 分块(s, 24);
        assert_eq!(块.concat(), s);
        assert!(块[0].ends_with('。'), "第一块该切在句末，实得 {:?}", 块[0]);

        // 句末太靠前就不认：上限 30，句末在第 4 字节（< 30/3=10）→ 按边界硬切
        let s = "短。后面是一长串没有标点的日文テクスチャの設定を変更するテスト";
        let 块 = 分块(s, 30);
        assert_eq!(块.concat(), s);
        assert!(块[0].len() <= 30);
    }

    /// URL 编码：汉字按 UTF-8 逐字节转义，空格转 %20（不用 +，避免服务端理解不一致）。
    #[test]
    fn url编码_汉字与空格() {
        assert_eq!(url编码("abc-_.~"), "abc-_.~");
        assert_eq!(url编码(" "), "%20");
        assert_eq!(url编码("テ"), "%E3%83%86");
        assert_eq!(url编码("あい"), "%E3%81%82%E3%81%84");
        assert_eq!(url编码("ja|zh-CN"), "ja%7Czh-CN");
    }

    /// MyMemory 的响应解析：正常译文、额度报错、字段缺失，三种都要说清。
    #[test]
    fn mymemory_解析译文与额度报错() {
        let 好: Value = serde_json::from_str(
            r#"{"responseData":{"translatedText":"更改纹理设置"},"responseStatus":200}"#,
        )
        .unwrap();
        assert_eq!(解析_mymemory(&好).unwrap(), "更改纹理设置");

        // 额度/限流：错误信息必须原样带出来（用户要知道是"等一等"还是"换个引擎"）
        let 额度: Value = serde_json::from_str(
            r#"{"responseData":{"translatedText":""},"responseStatus":403,"responseDetails":"MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY"}"#,
        )
        .unwrap();
        let e = 解析_mymemory(&额度).unwrap_err();
        assert!(e.contains("403"), "实得 {e}");
        assert!(e.contains("ALL AVAILABLE FREE TRANSLATIONS"), "实得 {e}");

        let 空: Value = serde_json::from_str(r#"{"responseStatus":200}"#).unwrap();
        assert!(解析_mymemory(&空).unwrap_err().contains("responseData"));
    }

    /// 连不上时错误里要有地址，用户才知道自己在连哪儿。
    ///
    /// 这条会真去连一次 `127.0.0.1:1`（回环、必被拒、毫秒级返回），
    /// 不是往公网发东西 —— 测试套件仍然可以离线跑。
    #[test]
    fn unreachable_endpoint_reports_the_url() {
        let r = chat("http://127.0.0.1:1/v1/chat/completions", "", "m", "x", 800);
        let e = r.unwrap_err();
        assert!(e.contains("http://127.0.0.1:1/v1/chat/completions"), "实得 {e}");
    }

    #[test]
    fn http_status_hints_are_specific() {
        assert!(hint(401).contains("Key"));
        assert!(hint(404).contains("/v1"));
        assert!(hint(200).is_empty());
    }

    /// 真引擎上跑一次往返：`cargo test --lib -- --ignored --nocapture live_engine`。
    ///
    /// 这条**要本机起了 OpenAI 兼容服务**（默认打 127.0.0.1:11434，也就是 Ollama），
    /// 所以放在 ignored 里手动跑 —— 默认那套测试永远不碰网络。
    ///
    /// 要验的是全链路里唯一没法靠构造 JSON 证明的那一环：**模型到底守不守编号标记**。
    /// 换引擎/换模型：`ROBIN_TEST_MODEL=qwen2.5:7b cargo test ...`
    #[test]
    #[ignore]
    fn live_engine_round_trip() {
        let base = std::env::var("ROBIN_TEST_ENGINE")
            .unwrap_or_else(|_| "http://127.0.0.1:11434/v1".into());
        let model = std::env::var("ROBIN_TEST_MODEL").unwrap_or_else(|_| "qwen3-vl:4b".into());
        let 原文 = vec![
            " テクスチャの設定".to_string(),
            " モデルを黒く塗りつぶすエフェクト".to_string(),
            " ブロック\n   複数行のコメント".to_string(),
        ];
        let r = translate_text(
            "custom".into(),
            base.clone(),
            model.clone(),
            String::new(),
            Some(180_000),
            原文.clone(),
        );
        println!("\n【真引擎往返】{model} @ {base}");
        println!("  ok = {}  error = {:?}", r.ok, r.error);
        for (i, t) in r.translations.iter().enumerate() {
            println!("  {} → {}", 原文.get(i).map(String::as_str).unwrap_or("?"), t);
        }
        assert!(r.ok, "真引擎这条挂了：{:?}", r.error);
        assert_eq!(r.translations.len(), 原文.len(), "段数必须对得上（对不上就该整批报错，而不是走到这里）");
        // 三段都应当被翻掉：日文假名不该原样留着
        for (i, t) in r.translations.iter().enumerate() {
            assert!(
                !t.chars().any(|c| ('\u{3040}'..='\u{30ff}').contains(&c)),
                "第 {} 段没被翻（还留着假名）：{t}",
                i + 1
            );
        }
    }

    /// 真 MyMemory 跑一次：`cargo test --lib -- --ignored --nocapture live_mymemory`。
    ///
    /// 默认引擎（免费公开、无需 Key）—— 这条**要联网**，所以放在 ignored 里手动跑。
    /// 要验的是分块拼回来是否连贯：长句会被切成几块分别请求，结果必须接得上、
    /// 且**不许出现半个汉字**（切坏多字节字符时服务端会返回乱码，这条能抓住）。
    #[test]
    #[ignore]
    fn live_mymemory_round_trip() {
        let 长段 = "テクスチャの設定を変更する。".repeat(40); // 约 560 字节，必然触发分块
        let 原文 = vec!["テクスチャの設定".to_string(), 长段.clone()];
        let r = translate_text(
            "mymemory".into(),
            String::new(),
            String::new(),
            String::new(),
            Some(60_000),
            原文.clone(),
        );
        println!("\n【真 MyMemory】ok = {}  error = {:?}", r.ok, r.error);
        for (i, t) in r.translations.iter().enumerate() {
            println!("  第{}段（{} 字节）→ {}", i + 1, 原文[i].len(), &t[..t.len().min(60)]);
        }
        assert!(r.ok, "MyMemory 这条挂了：{:?}", r.error);
        assert_eq!(r.translations.len(), 原文.len());
        for t in &r.translations {
            assert!(!t.is_empty(), "译文不许为空");
            assert!(
                t.chars().all(|c| c != '\u{fffd}'),
                "译文里出现了替换符（多半是切坏了多字节字符）：{t}"
            );
        }
        assert!(
            !r.translations[0].chars().any(|c| ('\u{3040}'..='\u{30ff}').contains(&c)),
            "第一段没被翻：{}",
            r.translations[0]
        );
        println!("  分块数（长段）= {}", 分块(&长段, MYMEMORY_上限).len());
    }
}
