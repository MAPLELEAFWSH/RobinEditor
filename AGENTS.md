# RobinEditor — 接手须知

MMD 轻量化集成处理工具（Tauri 2 + SvelteKit 2 + Svelte 5 + TS）。
**2026-09-26 起有 git 了**（`main`，两个远端 github / gitee，**一次都没推过**）。
但"记清楚为什么这么改"这件事还是靠文档 —— 提交信息写不下的都在这几份里。

## 接手第一步（照做，别跳）

1. **读 `docs/交接-20261006-工程状态与拖放记工程.md`** —— **最新的那一份，先看它**。
   里面是"到那一刻为止的事实 + 还没做的"，开头有三十秒上手和基线。
   `docs/` 下还有更早的 `交接-*.md`，当历史看。
2. **读 `docs/工作交接.md`** —— 老入口，9 节，讲这个工程是怎么长起来的。当背景读。
3. **读 `docs/整改清单.md`** —— **当前作业单**。里面的账这一批已经对平过两轮
   （§J-10 那张表：`ikclut:530` / `ikclut:867` 已修、`mstoon:1087` 作废；§K 是 2026-10-07 那四条）。
   看的时候注意每行结尾"怎么验的"那一列 —— **没写验法的就是没验过**。
4. **跑基线**，回到全绿再动手：
   ```powershell
   pnpm test                                    # 期望 40/40 全绿（38 套前端 + ilmcheck + cargo，cargo 137 passed）
   pnpm exec svelte-check --threshold warning   # 期望 0 错 0 警
   ```
   单跑一套：`node --import ./tmp/register-loader.mjs tmp\xxx.test.mjs`；
   ⑤ 那套 `node tmp/ilmcheck/run.mjs`（它自己会挂 loader，不用带 `--import`）。
   **两套基准数据不在仓库里**（`tmp/ilmcheck/data`、`tmp/normalcheck/data` 都是第三方素材解出来的像素）——
   新机器上这两套会因为缺 `sizes.json` **退码 1**，按提示先跑
   `node tmp/ilmcheck/dump-vivian.mjs` 与 `node tmp/normalcheck/dump-normal.mjs`。
   **`svelte-check` 假红**：受限沙箱下 vite 载 `vite.config.js` 要 spawn 子进程，被挡就是
   `spawn EPERM` → 全库预处理失败 → 报「35 errors in 35 files」。**先找 `EPERM`，别当成代码坏了。**
5. **动手前先跟用户确认。** 用户说"别开应用窗口"时**就别开**（`pnpm tauri dev` / 截图都算）——
   那种情况下界面的"看得见、点得动"要写成"没验过"，别含糊过去。

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
- **本工程前端自己的一套技能**（2026-10-07 从代码与文档里提炼的，装在 `~\.claude\skills\`，
  **新开会话才出现在技能目录里**）：`robin-frontend`（总入口：不变量与交付契约）
  + `robin-frontend-shell`（壳/注册表/令牌/偏好）+ `robin-frontend-pages`（一页：槽位/落点/组件/预览预算）
  + `robin-frontend-motion`（曲线/时长/过冲禁令/档位）+ `robin-frontend-verify`（基线/量具/探针/体检/打包核对）。
  改界面前先加载 `robin-frontend`；它带的 `references/file-map.md` 是仓库地图与命令速查。
- 视觉：`mcp__vision-mmd__*`（`describe_image` / `compare_images` / `vision_status`），自检 `node tools\test-vision-mcp.mjs`
- 用户手敲的命令：`/improve-codebase-architecture`、`/handoff`
