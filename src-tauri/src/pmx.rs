//! PMX 模型解析 —— 只读到「材质」为止。
//!
//! 为什么不用现成的 crate：PMX 是个位置敏感的二进制格式，中间隔着几十万条
//! 变长顶点记录，任何一处读错位置，后面全是垃圾。自己按规范走一遍反而好排查 ——
//! 每一步都能拿真实模型的材质名去对。
//!
//! 这个模块只服务两件事：
//!   · ⑥ 养乐多上材质：要材质名 + 每个材质用的贴图
//!   · 通道处理 / ILM 的配对检查：要贴图清单
//! 所以读完材质就停，骨骼和物理一律跳过。

use serde::Serialize;
use std::fs;

#[derive(Serialize)]
pub struct PmxMaterial {
    pub index: usize,
    pub name: String,
    pub name_en: String,
    /// 主贴图路径（模型里写的相对路径，可能带反斜杠）
    pub texture: Option<String>,
    pub texture_index: i32,
    pub sphere_texture: Option<String>,
    pub sphere_index: i32,
    /// 0 无 1 乘算 2 加算 3 副贴图
    pub sphere_mode: u8,
    pub toon_index: i32,
    pub toon_shared: bool,
    /// 这个材质占多少个三角面
    pub face_count: i32,
    pub draw_flag: u8,
    pub diffuse: [f32; 4],
    pub specular: [f32; 3],
    pub specular_power: f32,
    pub ambient: [f32; 3],
    pub edge_size: f32,
    /// 材质名归到哪一类，⑥ 拿来挑 fx 模板
    pub kind: String,
}

#[derive(Serialize)]
pub struct PmxInfo {
    pub path: String,
    pub version: f32,
    pub encoding: String,
    pub name: String,
    pub name_en: String,
    pub vertex_count: i32,
    pub face_count: i32,
    pub texture_count: i32,
    pub material_count: i32,
    pub bone_count: i32,
    pub morph_count: i32,
    pub textures: Vec<String>,
    pub materials: Vec<PmxMaterial>,
    /// 解析时记的账：哪儿凑合了、哪儿停了
    pub notes: Vec<String>,
}

struct Cur<'a> {
    b: &'a [u8],
    p: usize,
}

impl<'a> Cur<'a> {
    fn new(b: &'a [u8]) -> Self {
        Cur { b, p: 0 }
    }
    fn need(&self, n: usize) -> Result<(), String> {
        if self.p + n > self.b.len() {
            Err(format!(
                "读到第 {} 字节就没了，还想再要 {} 字节（可能不是 PMX，或者文件损坏了）",
                self.p, n
            ))
        } else {
            Ok(())
        }
    }
    fn u8(&mut self) -> Result<u8, String> {
        self.need(1)?;
        let v = self.b[self.p];
        self.p += 1;
        Ok(v)
    }
    fn i8(&mut self) -> Result<i8, String> {
        Ok(self.u8()? as i8)
    }
    fn u16(&mut self) -> Result<u16, String> {
        self.need(2)?;
        let v = u16::from_le_bytes([self.b[self.p], self.b[self.p + 1]]);
        self.p += 2;
        Ok(v)
    }
    fn i16(&mut self) -> Result<i16, String> {
        Ok(self.u16()? as i16)
    }
    fn i32(&mut self) -> Result<i32, String> {
        self.need(4)?;
        let v = i32::from_le_bytes([
            self.b[self.p],
            self.b[self.p + 1],
            self.b[self.p + 2],
            self.b[self.p + 3],
        ]);
        self.p += 4;
        Ok(v)
    }
    fn f32(&mut self) -> Result<f32, String> {
        self.need(4)?;
        let v = f32::from_le_bytes([
            self.b[self.p],
            self.b[self.p + 1],
            self.b[self.p + 2],
            self.b[self.p + 3],
        ]);
        self.p += 4;
        Ok(v)
    }
    fn skip(&mut self, n: usize) -> Result<(), String> {
        self.need(n)?;
        self.p += n;
        Ok(())
    }
    fn f32s(&mut self, n: usize) -> Result<Vec<f32>, String> {
        let mut v = Vec::with_capacity(n);
        for _ in 0..n {
            v.push(self.f32()?);
        }
        Ok(v)
    }
    /// PMX 的变长索引：size 是字节宽度，有符号（-1 表示"没有"）
    fn index(&mut self, size: u8) -> Result<i32, String> {
        match size {
            1 => Ok(self.i8()? as i32),
            2 => Ok(self.i16()? as i32),
            4 => self.i32(),
            other => Err(format!("索引宽度只能是 1/2/4，读到 {other}")),
        }
    }
    /// TextBuf：i32 字节长度 + 内容
    fn text(&mut self, utf16: bool) -> Result<String, String> {
        let len = self.i32()?;
        if len < 0 {
            return Err(format!("文本长度是负数（{len}）"));
        }
        let len = len as usize;
        self.need(len)?;
        let raw = &self.b[self.p..self.p + len];
        self.p += len;
        Ok(if utf16 {
            let u16s: Vec<u16> = raw
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16_lossy(&u16s)
        } else {
            String::from_utf8_lossy(raw).into_owned()
        })
    }
}

/// 材质名归类。用来挑 fx 模板，所以宁可粗一点也别漏。
fn classify(name: &str) -> &'static str {
    let n = name.to_ascii_lowercase();
    let has = |k: &[&str]| k.iter().any(|s| name.contains(s) || n.contains(s));

    // 顺序有讲究：脸和眼睛先判，不然"表情"里的"体"会被 body 抢走
    if has(&[
        "顔", "脸", "臉", "面", "face", "kao", "表情", "眉", "まゆ", "eye", "瞳", "目", "眼球",
        "hitomi", "アイ", "口", "歯", "舌", "首",
    ]) {
        return "face";
    }
    if has(&["髪", "发", "髮", "hair", "kami", "アホ毛", "前髪", "後髪", "鬓", "鬢"]) {
        return "hair";
    }
    if has(&["肌", "skin", "hada", "素肌", "body", "体", "體", "身体", "からだ"]) {
        return "body";
    }
    if has(&[
        "服", "衣", "cloth", "dress", "skirt", "裙", "shirt", "袖", "sleeve", "コート", "上着",
    ]) {
        return "cloth";
    }
    if has(&["靴", "鞋", "shoe", "boot", "sock", "stocking", "stoking", "袜", "足"]) {
        return "shoe";
    }
    if has(&[
        "金属", "metal", "金具", "belt", "ベルト", "buckle", "剑", "剣", "sword", "blade",
    ]) {
        return "metal";
    }
    if has(&[
        "アクセ", "accessory", "飾", "饰", "リボン", "ribbon", "冠", "帽", "hat", "cap", "耳",
        "しっぽ", "尻尾", "tail", "wing", "翼",
    ]) {
        return "accessory";
    }
    if has(&[
        "透明", "transparent", "glass", "ガラス", "水", "water", "エフェクト", "effect", "光",
        "スフィア", "sphere",
    ]) {
        return "effect";
    }
    if has(&["影", "shadow", "シャドウ", "ゴースト"]) {
        return "shadow";
    }
    "other"
}

#[tauri::command]
pub fn read_pmx(path: String, material_limit: Option<usize>) -> Result<PmxInfo, String> {
    let b = fs::read(&path).map_err(|e| format!("读不了 {path}：{e}"))?;
    if b.len() < 20 || &b[0..4] != b"PMX " {
        return Err("不是 PMX（开头不是 PMX 标记）。PMD 老格式不支持。".into());
    }
    let mut notes: Vec<String> = Vec::new();
    let mut c = Cur::new(&b);

    c.skip(4)?;
    let version = c.f32()?;
    let count = c.u8()? as usize;
    if count < 8 {
        return Err(format!("头部只声明了 {count} 个全局项，规范要求至少 8 个"));
    }
    let globals = {
        c.need(count)?;
        let g = b[c.p..c.p + count].to_vec();
        c.skip(count)?;
        g
    };

    let utf16 = globals[0] == 0;
    let encoding = if utf16 { "utf-16le" } else { "utf-8" }.to_string();
    if globals[0] > 1 {
        notes.push(format!("编码位是 {}，规范里只有 0/1，按 utf-8 试", globals[0]));
    }
    let add_uv = globals[1] as usize;
    /* 三个索引宽度是三件不同的事，别混：
         globals[2] 顶点索引宽度 —— 面的顶点下标用
         globals[3] 贴图索引宽度 —— 材质里的贴图槽用
         globals[5] 骨骼索引宽度 —— **顶点权重里的骨索引用**
       之前权重那里错用了 globals[2]。实测 `Saber\剑.pmx` 头部是 [0,0,2,1,1,1,1,1]：
       顶点索引 2 字节、骨骼索引 1 字节 —— 按 2 去读骨索引，一条顶点就多吃 1 字节，
       整块顶点错位，报出来就是"顶点权重类型 85/128 不认识"。 */
    let v_idx = globals[2];
    let b_idx = globals[5];
    let t_idx = globals[3];
    for (label, w) in [("顶点", v_idx), ("骨骼", b_idx), ("贴图", t_idx)] {
        if !matches!(w, 1 | 2 | 4) {
            return Err(format!("{label}索引宽度是 {w}，不合法，这个文件多半不是 PMX"));
        }
    }
    if add_uv > 4 {
        notes.push(format!("附加 UV 有 {add_uv} 组，规范最多 4 组，按 4 组读"));
    }

    let name = c.text(utf16)?;
    let name_en = c.text(utf16)?;
    let _comment = c.text(utf16)?;
    let _comment_en = c.text(utf16)?;

    // ---- 顶点：整段跳过。每条记录长度可变，只能一条条走
    let vertex_count = c.i32()?;
    if vertex_count < 0 {
        return Err("顶点数是负数".into());
    }
    /* 位置3 + 法线3 + UV2 = 8 个 float；附加 UV 每 16 字节（vec4）。
       实测对得上：`Saber\剑.pmx`（附加 UV 0 组）每条固定段 32 字节，
       `DK万敌.pmx`（附加 UV 1 组）48 字节 —— 两个文件都用"面数必须是 3 的倍数"
       反解过，各只有一个解。 */
    let base_vertex = 8 * 4 + add_uv.min(4) * 4 * 4;
    for vi in 0..vertex_count {
        c.skip(base_vertex)?;
        let t = c.u8()?;
        match t {
            // BDEF1 / BDEF2 / BDEF4 / SDEF / QDEF
            0 => c.skip(b_idx as usize)?,
            1 => c.skip(b_idx as usize * 2 + 4)?,
            2 | 4 => c.skip(b_idx as usize * 4 + 16)?,
            // SDEF：2 个骨头 + 权重 + C/R0/R1 各一个 vec3
            3 => c.skip(b_idx as usize * 2 + 4 + 12 * 3)?,
            other => {
                return Err(format!(
                    "顶点权重类型 {other} 不认识（第 {vi}/{vertex_count} 个顶点，文件偏移 {:#x}/{:#x}，\
                     顶点索引宽度 {v_idx}、骨骼索引宽度 {b_idx}、附加 UV {add_uv} 组、版本 {version}）",
                    c.p,
                    b.len()
                ))
            }
        }
        // 边线倍率：2.0 是 f32，2.1 起是 u8
        if version >= 2.1 {
            c.skip(1)?;
        } else {
            c.skip(4)?;
        }
    }

    // ---- 面
    let face_count = c.i32()?;
    if face_count < 0 {
        return Err("面数（索引数）是负数".into());
    }
    c.skip(face_count as usize * v_idx as usize)?;

    // ---- 贴图表
    let texture_count = c.i32()?;
    let mut textures: Vec<String> = Vec::new();
    for _ in 0..texture_count.max(0) {
        textures.push(c.text(utf16)?);
    }

    // ---- 材质
    let material_count = c.i32()?;
    let cap = material_limit.unwrap_or(usize::MAX);
    let mut materials: Vec<PmxMaterial> = Vec::new();
    for i in 0..material_count.max(0) {
        // 不管要不要这个材质，结构都得走完，否则后面全错位
        let mname = c.text(utf16)?;
        let mname_en = c.text(utf16)?;
        let diffuse = {
            let v = c.f32s(4)?;
            [v[0], v[1], v[2], v[3]]
        };
        let specular = {
            let v = c.f32s(3)?;
            [v[0], v[1], v[2]]
        };
        let specular_power = c.f32()?;
        let ambient = {
            let v = c.f32s(3)?;
            [v[0], v[1], v[2]]
        };
        let draw_flag = c.u8()?;
        c.skip(4 * 4)?; // 描边颜色
        let edge_size = c.f32()?;
        let texture_index = c.index(t_idx)?;
        let sphere_index = c.index(t_idx)?;
        let sphere_mode = c.u8()?;
        let toon_shared = c.u8()? == 0;
        let toon_index = if toon_shared {
            c.u8()? as i32
        } else {
            c.index(t_idx)?
        };
        let _memo = c.text(utf16)?;
        let mface = c.i32()?;

        if i as usize >= cap {
            continue;
        }
        let pick = |idx: i32| -> Option<String> {
            if idx < 0 {
                None
            } else {
                textures.get(idx as usize).cloned()
            }
        };
        materials.push(PmxMaterial {
            index: i as usize,
            kind: classify(&mname).to_string(),
            name: mname,
            name_en: mname_en,
            texture: pick(texture_index),
            texture_index,
            sphere_texture: pick(sphere_index),
            sphere_index,
            sphere_mode,
            toon_index,
            toon_shared,
            face_count: mface / 3,
            draw_flag,
            diffuse,
            specular,
            specular_power,
            ambient,
            edge_size,
        });
    }

    // ---- 骨头段：只读数量，不往下解。
    //
    // 一根骨头记录的长度取决于 12 个 flag 位（尾巴、外部父级、局部轴 X/Z、
    // 外部键、IK 链……），少认一位后面整段错位。实测就是这么栽的：
    // 漏了 flag 0x0002（尾巴存的是坐标而不是骨头索引），
    // 下一个骨头名字就读成了"文本长度是负数"。
    //
    // 材质信息到这儿已经齐了，骨头没人用，硬解一遍风险大于收益。
    let bone_count = c.i32().unwrap_or(-1);
    let morph_count = -1i32;
    if bone_count > 0 {
        notes.push(format!("骨头 {bone_count} 根，解析到材质为止，后面没读"));
    }

    Ok(PmxInfo {
        path,
        version,
        encoding,
        name,
        name_en,
        vertex_count,
        face_count: face_count / 3,
        texture_count,
        material_count,
        bone_count,
        morph_count,
        textures,
        materials,
        notes,
    })
}

/// 只取材质名清单，⑦⑤ 的配对检查要一次跑一堆模型
#[derive(Serialize)]
pub struct MaterialsOnly {
    pub path: String,
    pub model: String,
    pub materials: Vec<String>,
    pub textures: Vec<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn read_pmx_materials(path: String) -> MaterialsOnly {
    match read_pmx(path.clone(), None) {
        Ok(info) => MaterialsOnly {
            path,
            model: info.name,
            materials: info.materials.iter().map(|m| m.name.clone()).collect(),
            textures: info.textures,
            error: None,
        },
        Err(e) => MaterialsOnly {
            path,
            model: String::new(),
            materials: vec![],
            textures: vec![],
            error: Some(e),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 拿真模型对一遍。样本不在的机器上直接跳过，不算失败。
    fn sample(p: &str) -> Option<String> {
        if std::path::Path::new(p).exists() {
            Some(p.to_string())
        } else {
            None
        }
    }

    #[test]
    fn parses_a_real_model() {
        let Some(p) = sample(r"E:\deepseek-harness\mmd集成工具\贴图样本\genshin\木偶\木偶.pmx")
        else {
            eprintln!("样本不在，跳过");
            return;
        };
        let info = read_pmx(p, None).expect("解析失败");
        assert!(info.version >= 2.0 && info.version < 3.0, "版本 {}", info.version);
        assert!(info.vertex_count > 1000, "顶点数 {}", info.vertex_count);
        assert!(info.material_count > 0, "一个材质都没读到，多半是位置错位了");
        assert_eq!(info.materials.len() as i32, info.material_count);

        // 材质名必须是可读的，出现替换符说明编码位读错了
        for m in &info.materials {
            assert!(!m.name.contains('\u{FFFD}'), "材质名解坏了：{:?}", m.name);
            assert!(!m.name.is_empty(), "材质名是空的，位置错位了");
        }
        // 每个材质的贴图索引要么是 -1，要么能对上贴图表
        for m in &info.materials {
            if m.texture_index >= 0 {
                assert!(
                    (m.texture_index as usize) < info.textures.len(),
                    "贴图索引越界：{} / {}",
                    m.texture_index,
                    info.textures.len()
                );
            }
        }
        eprintln!(
            "{}：v{} {} 顶点 {} 面 {} 材质 {} 贴图 {} 骨头",
            info.name, info.version, info.vertex_count, info.face_count,
            info.material_count, info.texture_count, info.bone_count
        );
    }

    /// 材质面数加起来应该等于总面数（每个面只属于一个材质）
    #[test]
    fn material_faces_add_up() {
        let Some(p) = sample(r"E:\deepseek-harness\mmd集成工具\贴图样本\genshin\木偶\木偶.pmx")
        else {
            eprintln!("样本不在，跳过");
            return;
        };
        let info = read_pmx(p, None).expect("解析失败");
        let sum: i64 = info.materials.iter().map(|m| m.face_count as i64).sum();
        let total = info.face_count as i64;
        // 允许 1% 的取整误差（每个材质各自除 3）
        let diff = (sum - total).abs();
        assert!(
            diff * 100 <= total.max(1),
            "材质面数合计 {sum}，总面数 {total}，差 {diff} —— 说明材质段读歪了"
        );
    }

    /// 多几个模型都过一遍，别只对一个文件调通
    #[test]
    fn parses_several_models() {
        let candidates = [
            r"E:\deepseek-harness\mmd集成工具\贴图样本\genshin\木偶\木偶 前发.pmx",
            r"E:\deepseek-harness\mmd集成工具\贴图样本\honkaiSR\爻光\爻光.pmx",
            r"E:\deepseek-harness\mmd集成工具\参考工具样本\Empty.pmx",
        ];
        let mut n = 0;
        for p in candidates {
            let Some(p) = sample(p) else { continue };
            let info = read_pmx(p.clone(), None).unwrap_or_else(|e| panic!("{p} 解析失败：{e}"));
            assert!(info.material_count >= 0);
            eprintln!("{p} → {} 材质 / {} 贴图", info.material_count, info.texture_count);
            n += 1;
        }
        if n == 0 {
            eprintln!("一个样本都没有，跳过");
        }
    }

    /// 真模型库里抽样，要求**全部**解析通过。
    ///
    /// 这条是回归钉子：之前权重段错用了"顶点索引宽度"去读骨索引，
    /// 头部 `[0,0,2,1,1,1,1,1]` 这种（顶点索引 2 字节、骨骼索引 1 字节）的文件
    /// 每条顶点多吃 1 字节，整块错位 —— 实测主流角色 80 个里 24 个失败（30%）。
    /// 老的测试文件抓不住，是因为它们里面骨索引都很小（都能塞进 1 字节，
    /// 按 1 读和按 2 读结果一样）。
    ///
    /// 目录是只读素材库，本测试只读不写。
    #[test]
    fn parses_real_model_library() {
        const ROOT: &str = r"D:\MMD模型动作\模型\【星穹铁道人物】";
        if !std::path::Path::new(ROOT).exists() {
            eprintln!("模型库不在，跳过");
            return;
        }
        let mut checked = 0usize;
        let mut fails: Vec<String> = Vec::new();
        let skip = ["PAToon", "Controller", "僐儞僩儘乕儔乕"];
        for e in fs::read_dir(ROOT).into_iter().flatten().flatten() {
            let sub = e.path();
            if !sub.is_dir() {
                continue;
            }
            for f in fs::read_dir(&sub).into_iter().flatten().flatten() {
                let p = f.path();
                if p.extension().and_then(|s| s.to_str()) != Some("pmx") {
                    continue;
                }
                let flat = p.to_string_lossy().to_string();
                if skip.iter().any(|k| flat.contains(k)) {
                    continue;
                }
                if checked >= 60 {
                    break;
                }
                checked += 1;
                match read_pmx(flat.clone(), None) {
                    Ok(info) => {
                        // 读通了还要看有没有读歪：材质名不该出现替换符
                        for m in &info.materials {
                            assert!(
                                !m.name.contains('\u{FFFD}'),
                                "{flat} 材质名解坏了：{:?}",
                                m.name
                            );
                        }
                    }
                    Err(err) => fails.push(format!("{flat} → {err}")),
                }
            }
            if checked >= 60 {
                break;
            }
        }
        if checked == 0 {
            eprintln!("没扫到 pmx，跳过");
            return;
        }
        eprintln!("扫了 {checked} 个，失败 {} 个", fails.len());
        for f in fails.iter().take(10) {
            eprintln!("  {f}");
        }
        assert!(fails.is_empty(), "{} / {checked} 个真模型解析失败", fails.len());
    }

    #[test]
    fn rejects_non_pmx() {
        let e = read_pmx(r"C:\Windows\notepad.exe".into(), None);
        assert!(e.is_err(), "exe 不该被当成 PMX 解析成功");
    }

    #[test]
    fn classifies_material_names() {
        assert_eq!(classify("顔"), "face");
        assert_eq!(classify("髪"), "hair");
        assert_eq!(classify("肌"), "body");
        assert_eq!(classify("服"), "cloth");
        assert_eq!(classify("靴下"), "shoe");
        assert_eq!(classify("金属"), "metal");
        assert_eq!(classify("アクセサリ"), "accessory");
        assert_eq!(classify("透明"), "effect");
        // "表情" 里有"体"字，但不能被判成 body
        assert_eq!(classify("表情"), "face");
        // 真模型 "木偶.pmx" 第一个材质就叫「面」，是脸不是"表面"
        assert_eq!(classify("面"), "face");
        assert_eq!(classify("口"), "face");
        assert_eq!(classify("材質1"), "other");
    }
}

#[cfg(test)]
mod debug_tests {
    use super::*;

    /// 临时排查用：打印每一步之后的游标位置，看看是在哪一段跑偏的
    #[test]
    #[ignore]
    fn trace_positions() {
        let p = r"E:\deepseek-harness\mmd集成工具\贴图样本\genshin\木偶\木偶.pmx";
        let b = fs::read(p).unwrap();
        let mut c = Cur::new(&b);
        c.skip(4).unwrap();
        let version = c.f32().unwrap();
        let count = c.u8().unwrap() as usize;
        c.skip(count).unwrap();
        eprintln!("after header: p={} version={}", c.p, version);
        let utf16 = b[9] == 0;
        let add_uv = b[10] as usize;
        let v_idx = b[11];
        let t_idx = b[12];
        let b_idx = b[15];
        eprintln!("utf16={utf16} add_uv={add_uv} v_idx={v_idx} t_idx={t_idx} b_idx={b_idx}");
        let n = c.text(utf16).unwrap();
        eprintln!("name={n:?} p={}", c.p);
        let _ = c.text(utf16).unwrap();
        let _ = c.text(utf16).unwrap();
        let _ = c.text(utf16).unwrap();
        eprintln!("after 4 names: p={}", c.p);
        let vc = c.i32().unwrap();
        eprintln!("vertex_count={vc} p={}", c.p);
        let base = 8 * 4 + add_uv * 4 * 4;
        for i in 0..vc {
            c.skip(base).unwrap();
            let t = c.u8().unwrap();
            /* 注意：权重里的骨索引用 **b_idx**，不是 v_idx。
               这段排查代码原来抄的也是生产代码那个错法（用 v_idx），
               所以当初排查时跟着一起走歪了，没能查出问题。 */
            let skip = match t {
                0 => b_idx as usize,
                1 => b_idx as usize * 2 + 4,
                2 | 4 => b_idx as usize * 4 + 16,
                3 => b_idx as usize * 2 + 4 + 36,
                other => panic!("顶点 {i} 的权重类型 {other}"),
            };
            c.skip(skip).unwrap();
            if version >= 2.1 { c.skip(1).unwrap(); } else { c.skip(4).unwrap(); }
        }
        eprintln!("after vertices: p={}", c.p);
        let fc = c.i32().unwrap();
        eprintln!("face_count={fc} p={}", c.p);
        c.skip(fc as usize * v_idx as usize).unwrap();
        eprintln!("after faces: p={}", c.p);
        let tc = c.i32().unwrap();
        eprintln!("texture_count={tc} p={}", c.p);
        for i in 0..tc.max(0) {
            match c.text(utf16) {
                Ok(t) => eprintln!("  tex[{i}]={t}"),
                Err(e) => { eprintln!("  tex[{i}] 失败：{e}"); break; }
            }
        }
        eprintln!("after textures: p={}", c.p);
        match c.i32() {
            Ok(mc) => eprintln!("material_count={mc}  (b.len()={})", b.len()),
            Err(e) => eprintln!("材质数读不了：{e}"),
        }
    }
}
