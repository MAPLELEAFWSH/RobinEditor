# 提改动之前

这个工程原来没有版本控制，一切靠文档；2026-09-25 才初始化 git。
下面几条是这个工程自己吃过的亏，不是通用模板。

## 先跑基线

```powershell
pnpm test                                    # 期望 40/40
pnpm exec svelte-check --threshold warning   # 期望 0 错 0 警
```

`pnpm test` 里包含 `cargo test --lib`（期望 137 passed）。
改完 Rust 也要单跑一遍：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

**`svelte-check` 假红**：受限沙箱下 vite 载 `vite.config.js` 要 spawn 子进程，被挡就是
`spawn EPERM` → 全库预处理失败 → 报「35 errors in 35 files」。
**先找 `EPERM`，别当成代码坏了。**

## 六条硬规矩

1. **`实战测试用例\` 里的原始素材不许改。** 产出写 `实战测试用例\测试效果\`。
   扫语料时必须排除 `测试效果\`，否则会把产物当素材喂进去。
2. **改文本文件只用 read / edit / write 工具**，绝不用 PowerShell 的
   `Set-Content` / `Out-File`。用过一次，给一个 `.svelte` 加了 BOM，靠临时脚本才按字节摘掉。
3. **读像素只走 Rust 的 `read_rgba`。** 画布是**预乘 alpha** 存的，反预乘会弄脏半角像素、
   把全透明像素的 RGB 抹成 0 —— 实测一张原神法线图 98.2% 的像素会中招。
4. **写回要保住原文的编码和 BOM。** 前端拿到的 `text` 是剥过 BOM 的，
   整段重写那条路必须把它接回去（见 `ray/Ray.svelte` 的 `接回BOM`）。
5. **不许分发第三方渲染包**，也不许把它们的代码、注释、手册、界面文案搬进来。
   参数说明只写"是什么、调了会怎样"，不写"它内部怎么算的"。见 `docs/来源与边界.md`。
6. **侧边导航不许出现 ①②③ 序号**，错误显示在侧边导航栏，一个页面只有一颗主按钮。

## 改动怎么留痕

- 开发日志写 `PROGRESS.md`，新一轮加最上面（`## 本轮：…`，旧的改 `## 上一轮：…`）。
- 用户提的每一条要落进 `docs/整改清单.md`，做完了在那一行标 **已修** 并写清**怎么验的**。
- **界面文案和注释按"自己的简短笔记"写**：不辩论、不解释设计意图。

## 提交

```
类型: 一句话说清改了什么
```

类型用 `修` / `加` / `改` / `文档` / `测试` / `构建`（中文，跟这个工程的文档一致）。
正文里如果这条改动是**量出来的**（有探针、有数字），把数字写上。

**别提交构建产物**：`dist/*.exe`、`src-tauri/target/`、`tmp/chrome-audit/`、
`tmp/ilmcheck/data/` 都在 `.gitignore` 里。`tmp/ilmcheck/data/` 的内容来自第三方素材，
**不许发布**。

## 加功能

看 `docs/加新模块.md`。要点：分区组件写成**加载器**（按需拉），
注册表只改 `src/lib/modules/registry.ts` 一个文件，`tmp/perf-guard.test.mjs` 会守住这两条。
