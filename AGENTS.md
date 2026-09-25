# RobinEditor — 接手须知

MMD 轻量化集成处理工具（Tauri 2 + SvelteKit 2 + Svelte 5 + TS）。
**没有 git**，没有版本控制，一切靠文档。改任何东西之前先想清楚怎么记。

## 接手第一步（照做，别跳）

1. **读 `docs/工作交接.md`** —— 这是入口，9 节。按它第 0 节的顺序继续读。
2. **读 `docs/整改清单.md`** —— **当前作业单**，用户 2026-09-19 提的 12 条，
   开头写了执行顺序。里面「待办」的还没做，别当成做完了。
3. **读 `docs/架构复查-20260919.md`** —— 34 组发现，其中 **8 条是真 bug**（A 节 + G1）。
4. **跑基线**，回到全绿再动手：
   ```powershell
   pnpm test            # 18 套 + ilmcheck + cargo，一条命令，20 项
   pnpm exec svelte-check --threshold warning
   ```
   期望：`pnpm test` 20/20 通过（前端 + ilmcheck 共 1329 条断言、cargo 36 passed）、svelte-check 0 错 0 警。
   单跑一套：`node --import ./tmp/register-loader.mjs tmp\xxx.test.mjs`；
   ⑤ 那套 `node tmp/ilmcheck/run.mjs`（它自己会挂 loader，不用带 `--import`）。
   **`svelte-check` 假红**：受限沙箱下 vite 载 `vite.config.js` 要 spawn 子进程，被挡就是
   `spawn EPERM` → 全库预处理失败 → 报「35 errors in 35 files」。**先找 `EPERM`，别当成代码坏了。**
5. **动手前先跟用户确认。**

## 三条必须记住的

**① 配对是唯一能出事实的东西。** 同一目录、同一套 UV 的"输入 → 产物"才是地面真值。拿错参照会得出自信的错误结论——这个工程为它吃过两轮亏。

**② 视觉模型不可靠。** `qwen3-vl:4b` 对尺寸、计数、逐行结构经常是照着文件名在推、不是真在看。定性看可以，**承重事实必须用像素测量复核**。

**③ 别拿探测超时下"连不通"的结论。** `Invoke-WebRequest -Method Head` 对 github / CDN / ollama registry 全超时，但其中有的实际通（ollama registry 实测 13 MB/s 能拉）。**要用真客户端跑一次再判断。**

## 硬规矩

- `E:\deepseek-harness\mmd集成工具\实战测试用例\` 里的**原始素材不许改**；**产出写 `实战测试用例\测试效果\`**（2026-09-19 起，之前几轮的在兄弟目录 `实战测试用例_效果\`，留着当历史别动）。**扫语料时必须排除 `测试效果\`**，否则会把产物当素材喂进去。
- `D:\MMD模型动作\模型\{…}` 三个库**只读**
- **改文本文件只用 read/edit/write 工具**，绝不用 PowerShell 的 `Set-Content` / `Out-File`（会加 BOM、转 CRLF、中文乱码）
- 侧边导航**不许出现 ①②③ 序号**；错误显示在侧边导航栏
- 动效不许有过冲
- 注释和界面文案按"开发者自己的简短笔记"写，不辩论、不解释设计意图
- 开发日志写 `PROGRESS.md`，新一轮加最上面（`## 本轮：…`，旧的改 `## 上一轮：…`）
- 模型一律装 `E:\AI_models`（`OLLAMA_MODELS` 已固定），**C: 只剩约 4 GB**
- **本工程不含、不分发任何第三方渲染包或工具；未复制其代码；规格来源只有两条 —— 公开文档 + 本工程自己对着素材量的实测。** 别人的代码、注释、手册、界面文案、操作方式都不许搬进来；参数说明只写"是什么、调了会怎样"，不写"它内部怎么算的"。详见 `docs/来源与边界.md`

## 可用工具

- 技能：`codebase-design` / `domain-modeling` / `grilling`（模型可调）；`find-skills`
- 视觉：`mcp__vision-mmd__*`（`describe_image` / `compare_images` / `vision_status`），自检 `node tools\test-vision-mcp.mjs`
- 用户手敲的命令：`/improve-codebase-architecture`、`/handoff`
