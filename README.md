# RobinEditor

把 MMD 的贴图杂活收进一个窗口。Tauri 2 + SvelteKit，装完就能跑，不需要本地开发环境。

给用户看的那份在 `dist\说明.txt`（更短，没术语）。这一份是给开发和接手的人看的。

## 它做七件事

编号沿用最初列需求的顺序。**④ msToon 与 ⑧ Ramp 都已删**（⑧ 2026-09-23、④ 2026-09-26），
号留着不补 —— 文档和用户还在按这些号指模块。

| | 功能 | 说明 |
|---|---|---|
| ① | 日文乱码修复 | 日文被按 GBK 读成 `僐儞僩儘乕儔乕` 这种，还原回 `コントローラー`。能整目录批处理，也能只改 `.fx` 里的注释不动代码，还能还原文件/目录名里的乱码 |
| ② | ikClut 调色 | 调曝光对比饱和色相，烘成 1024×32 的 CLUT；也能把 1 / 2 / 4 张现成 LUT 混成一张 |
| ③ | Ray 编辑器 | 把 `ray.conf` 的 `#define` 做成界面，改了先出 diff 再写盘。贴图路径能点选，也能拖到那一行上 |
| ⑤ | 绝区零贴图合成 | `_A` / `_M` / `_N` 拼成 LM（只管这一个游戏这一种排法），还有「配对检查」对着材质文件核一遍 |
| ⑥ | 养乐多上材质 | 读 PMX 的材质名分类，对着渲染包的 fx 模板填参数，写出 `.fx`。贴图能拖进输入框 |
| ⑦ | 贴图通道处理 | 通道提取、RGBA 拆合、自己排 R/G/B/A、图层蒙版、调整、24 种混合、整目录批量；里面还有三条 msToon 控制图打包模板 |
| ⑨ | 工程迁移 | `.pmm` / `.emm` 里的文件被挪走了，指回新根；或连文件一起打包成一个自包含目录 |

工作区那一组只有**总览**一页（「最近工程」「快捷动作」两页 2026-10-07 删了；
记录本身还在 —— 底部状态栏那条「当前工程」读的就是它。顶栏右上角原来那颗同名胶囊也删了）。

**渲染包不内置也不分发。** Ray、养乐多、ikClut、msToon 的版权归各自作者，
工具只在你指定的路径上读写文件。

**本项目不含、不分发任何第三方渲染包或工具，也未复制其代码。**
规格来源只有两条：公开文档，以及本项目自己对着素材量出来的实测。
详见 `docs/来源与边界.md`。

## 开发

```powershell
pnpm install
pnpm dev              # 浏览器里调界面，http://127.0.0.1:1420
pnpm tauri dev        # 真桌面窗口，能测后端
pnpm test             # 全量：tmp/*.test.mjs + ilmcheck + cargo，期望 40/40
pnpm exec svelte-check --threshold warning   # 期望 0 错 0 警
pnpm build            # 前端出到 build\
pnpm tauri build      # 出安装包
```

`pnpm test` 里两套是这一轮新加的守卫：`tmp/ui-text.test.mjs`（模板里不许有 `**` 这种
Markdown 残留）和 `tmp/perf-guard.test.mjs`（注册表不许静态 import 分区组件、
进场观察的回调里不许全文档查询）。两条都做过破坏性试验。

体积和按需加载有两把尺子，改完前端跑一下：

```powershell
node tools/bundle-report.mjs build        # 首屏链多少 KB、最大 chunk 里装着谁
node tools/check-lazy-chunks.mjs build    # 按 URL 把按需 chunk 取一遍
node tools/exe-frontend-check.mjs         # 打好的 exe 里嵌的是不是刚构建那份前端
node tools/icon-report.mjs                # 图标体检：每档真尺寸 + 清晰度（任务栏糊了先跑这个）
node tools/make-app-icon.mjs --write      # 重做 icon.ico（13 档）+ 任务栏专用 48² 小图
node tools/cdp-shot.mjs tmp/x.png 800 "http://localhost:1420/"   # 真机截图，动效要眼看
```

**图标这块的背景**：屏幕 150% 缩放时任务栏那一格要 **36px**，所以 `icon.ico` 里必须真的有
36 这一档（现在 13 档：16/20/24/30/32/36/40/48/60/64/96/128/256）。
而**窗口图标**（任务栏上"正在运行"那个按钮用的）由 `src-tauri/src/lib.rs` 里的 `set_icon`
显式设成 `icons/icon-taskbar.rgba` —— 48² 裸 RGBA，`Image::new_owned` 直接吃，
不用开 `image-png`。**Tauri v2 的 `WindowConfig` 没有 `icon` 字段**（查过
`@tauri-apps/cli/config.schema.json`），别指望在 `tauri.conf.json` 里配。
小尺寸要看得清，靠的是 `make-app-icon.mjs` 按显著性裁到人物主体 + Lanczos 重采样。

现状（真机上量的，2026-09-19）：

- **首屏 204.3 KB / 22 个 js**（改之前首屏链 641.9 KB），按需 chunk 25/25 取得到。
  报表里那个 149.1 KB 是**静态 import 链**；204.3 KB 是打包版真机上
  `decodedBodySize` 的实测，多出来的是客户端路由加载的 `nodes/*.js`。**对外引 204.3。**
- 首屏那条链上**一个功能模块都没有** —— 分区的界面是打开哪个拉哪个。
  打包版实测：点 ③ 只多 89.6 KB、⑦ 86.3 KB、④ 52.3 KB、⑧ 41.5 KB…，
  每个数都跟报表里那个 chunk 的字节数对得上。

> **2026-10-07 重打包后的报表数（同一把尺子，换了一批模块）**：
> `node tools/bundle-report.mjs build` → 入口那条链 **158.8 KB / 10 个 chunk**、
> 首屏链上 0 个模块、按需 chunk 19 个 URL 全取得到；`check-lazy-chunks.mjs build` 0 个取不到。
> **上面那个"打包版真机 204.3 KB"这一轮没重量**（这一轮没开应用窗口），
> 别把 2026-09-19 那个数当成现在就准。

真机怎么再验一遍（改完前端值得跑）：

```powershell
# dev：能直接认出"这一趟拉了哪个模块"
node tools/cdp-lazy-check.mjs
# 打包版：按字节看，点侧栏走真实路径
node tools/cdp-packaged-check.mjs 9223
```

**前提：测试实例要有自己的 WebView2 用户目录。** 用户自己开着这个应用时，
第二个进程会挂到已有的浏览器进程上，`--remote-debugging-port` 不生效（调试端口连不上）：

```powershell
$env:WEBVIEW2_USER_DATA_FOLDER="$env:TEMP\robin-cdp-profile"
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
pnpm tauri dev
```

浏览器里能调界面，但 `①③⑥` 和所有真文件读写要走 Rust，
在浏览器里会明说"这个功能要在桌面端跑"。要测这些得开 `pnpm tauri dev`。

发行前记得：`pnpm tauri build` → 把两个产物拷进 `dist\`（见 `docs/工作交接.md` 第 1 节）
→ 核对 `dist\说明.txt` 里的体积数字。**`build\` 是构建产物，改了源码不重建的话，
`dist\` 里那两个 exe 还是旧的。**

当前这一版（2026-10-07 打包）：安装包 **5.11 MB**、绿色版 **8.08 MB**，
拷完用 `node tools/exe-frontend-check.mjs` 核一遍包里嵌的前端是不是刚构建那份。
**判据是"build\ 里的 chunk 名全中"，不是"中一个"**：这一版是 **36/36**
（删掉工作区那两页之后 chunk 少了几个，所以不再是 42）。chunk 名是内容哈希，
**没改过的文件名字不变**，所以一个旧包照样能中一大半 —— 这个工具的结论原来写成 `hit > 0`，
2026-09-26 抓过它一次**假的绿**（旧包 25/42，它照样报"就是刚构建那一份"）——
现在只中一部分就报"这是个旧包"，退出码 1。要核别的产物就把它当第一个参数传（如
`node tools/exe-frontend-check.mjs src-tauri\target\release\robin-editor.exe`）。
**绿色版正在运行的时候拷不进去**（文件被占用），得先关掉应用。

真窗口里跑脚本验证后端（工具都在 `tools/`，用法见各自文件头）：

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
pnpm tauri dev
node tmp/cdp.mjs <一段表达式.js>          # 在当前页执行
node tools/cdp-nav.mjs "<url>"            # 导航
node tools/cdp-run.mjs <注入.js> <url> <结果全局名>   # 注入 + 跨导航 + 取结果
node tools/cdp-audit.mjs                  # 所有路由跑一遍，抓运行时错误 + 正文里的 ** 和脏字
node tools/cdp-ripple-probe.mjs           # 点击涟漪量一遍（配 cdp-ripple-diff.py / -layer.py）
```

> **CDP 探针的坑**：HMR 之后应用引的是 `…?t=…` 那个 URL，探针直接 import 裸路径会拿到
> **另一个空实例**（落点表/注册表全是空的）。要 import 就先从
> `performance.getEntriesByType('resource')` 里把带时戳的 URL 找出来。

> 用户在前台全屏游戏时**别弹 dev 窗口**。改成按需加载之后，"点开一个功能"这条路的
> 真机验证仍然要开窗口，那种时候先跟用户说一声。

## 结构

```
src/
  lib/
    modules/
      registry.ts        模块注册表 —— 加功能只改这一个文件（分区组件写成加载器，按需拉）
      channels/          ⑦ 贴图通道处理（ops.ts 里还有 msToon 打包模板 GAMES）
      ilm/               ⑤ 绝区零贴图合成
      migrate/           ⑨ 工程迁移
      ikclut/            ② ikClut 调色
      glitch/            ① 日文乱码修复
      ray/               ③ Ray 编辑器
      yaku/              ⑥ 养乐多上材质
    components/wb/       工作台公共件（图片槽、渐变条、提示条）
    io.ts                文件读写、对话框、后端调用
    img.ts               像素运算（通道、打包、缩放、曲线、LUT、Sobel、距离场）
    drop.ts              拖放落点判断（纯函数，能单测）
    dropzones.svelte.ts  通用落点：不只图片槽的地方也能接拖进来的文件
    drag-dom.ts          窗口级拖放接线（原生 + HTML5 两条路）
    perf.svelte.ts       全站唯一那条 rAF + 帧时间统计
    prefs.svelte.ts      界面偏好，只往 :root 写 CSS 变量（低配档也在这儿）
    wb.svelte.ts         图片槽状态
  styles/
    tokens.css           设计令牌
    wb.css               工作台公共样式
src-tauri/src/
  fsops.rs               扫描、图片解码、写盘与备份
  textenc.rs             编码识别与乱码修复
  pmx.rs                 PMX 二进制解析
```

加新功能看 `docs/加新模块.md`。动效数值的来路看 `docs/动效口径.md`。
做了什么、量到了什么看 `PROGRESS.md`。

## 文档在哪

| 想干什么 | 看这份 |
|---|---|
| 跑起来、改代码、加功能、发版 | `docs/开发者指南.md` |
| 提改动前要守的规矩 | `CONTRIBUTING.md` |
| 接手这个工程 | `AGENTS.md` → `docs/工作交接.md` |
| 界面长什么样、文案怎么写 | `docs/工作区界面规范.md` |
| 每个改动量到了什么 | `PROGRESS.md` |
| 当前作业单与未修项 | `docs/整改清单.md` |
| 为什么只有这些功能、边界在哪 | `docs/来源与边界.md` |
| 给用户看的（没术语） | `docs/使用说明-新手向.md`、`dist/说明.txt` |

## 已知边界

写在关于页里，也在这儿留一份：

- 跨模型套用学到的规律是负收益，所以没有"照着别的模型猜"这种按钮
- PMX 里材质级的 UV 边界不如按图自动分块准，所以默认不读材质划分
- ⑦ 里那三条 msToon 控制图模板是照素材里真实产物的配对对出来的（原神 100% 逐像素、星铁只差 1 级）
- ⑦ 的法线那一套：重建 Z 的算式在素材两对真配对上是逐像素相同的；但 **AG 打包（粉）与 RG 双通道
  这两条本库 567 张法线里一张实例都没有**，判据按公开约定写、界面上如实标着
- ⑦ 的放大核：数据贴图（法线、材质 ID、遮罩）该用最邻近 —— 双线性会把 4 种材质 ID 插成 13 种
- ⑥ 生成的 fx 是**起手参数不是成品效果**，子材质槽位顺序也读不到，只能按材质顺序排
- ① 的「.fx 注释」一次最多扫 400 个文件，超出的部分界面上写明"还剩多少没碰"
- 面部没有校准（脸的 lightmap 走 FaceSDF，是另一张图）
- 绝区零那块不吃 diffuse：它的 ILM 由 `_A` 的 G、`_N` 的 B、`_M` 的 B 打包而成（逐像素验过）

## 低配机器

重点在**首屏**和**常驻开销**两处：

- 首屏那条链只剩 149.1 KB（各功能的代码是打开哪个拉哪个）
- 进场的观察和尾栏统计都不再全文档扫
- 外观面板底部有「一键低配」：动效轻、毛玻璃关、背景换纯代码、壁纸柔化关、尾栏帧率关。
  这五项每一项都能再单独调回来
- 头一次打开的机器如果 `hardwareConcurrency ≤ 4` 或 `deviceMemory ≤ 4`，自动按低配档起，
  面板里会写明是自动起的

壁纸是 9 张 1920 宽的 JPEG（共约 2.5 MB，含缩略图），选哪张才加载哪张；
低配档用纯代码背景，一张都不解。

