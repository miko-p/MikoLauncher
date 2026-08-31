<div align="center">

# 🚀 MikoLauncher

**一个用 Rust + Vue + Cordis 打造的 Minecraft Java 版启动器**

强调「可定制、可回滚、可扩展」的插件体系。

[![CI](https://github.com/miko-p/MikoLauncher/actions/workflows/ci.yml/badge.svg)](https://github.com/miko-p/MikoLauncher/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

</div>

## ✨ 它是什么

一个用 **Rust + Vue + Cordis** 写的 Minecraft（Java 版）启动器。

它的主要方向是，在启动器里引入基于 **Cordis**「时空可组合」范式的前后端分离架构 —— 前端负责界面，Rust 内核负责真实的下载与启动，中间用 Cordis 插件宿主连接 —— 让代码结构更清楚一些，也让功能、主题、布局能以插件形式插拔（卸载时 `ctx.effect` 自动回滚）。目前**功能 / 主题 / 布局**三类插件均已能装载运行并支持启用状态持久化，发布版 sidecar 已可打成单文件安装包。

目前还在**逐步演进**中：安装、下载、启动、多加载器、账号等基础能力已联通，插件分发（签名市场）仍在成形。欢迎一起把它做得更好。

> 侧重点在「插件范式 + 前后端分离」
---

## 🧱 架构一览

```
┌───────────────────────────────┐
│  前端 WebView  (Vue3 + Pinia)  │   ← MVVM 的 View + ViewModel
│  · 页面 · 主题/布局插件 UI      │
└──────────────┬────────────────┘
               │  Tauri IPC (invoke + events)
┌──────────────┴────────────────┐
│  插件宿主  (Node sidecar)      │   ← Cordis 时空可组合
│  · 功能插件 · ctx.effect 回滚  │
│  · 依赖注入 · HMR               │
└──────────────┬────────────────┘
               │  JSON-RPC (stdin/stdout)
┌──────────────┴────────────────┐
│  Rust 内核  (Tauri + Lighty)   │   ← 真实重活
│  · 版本安装 · 下载 · 启动 JVM   │
│  · 账号认证（离线/微软）        │
└───────────────────────────────┘
```

**分工**：让你看、让你摆 —— 交给前端与插件层；**真要动 JVM / 干重活** —— 交给 Rust 内核。

技术栈：**Tauri 2**（Rust）· **Vue 3 + TypeScript** · **Cordis**（插件范式）· **LightyLauncherLib**（MC 启动内核，MIT）· **SQLite**

---

## ✅ 已实现能力

- 🌐 **真实版本清单**：从 Mojang 拉取，并解析每个版本的 Java 需求
- 📥 **真实下载 / 安装**：JRE、客户端、库、资源 — 进度实时回传（`download:progress` 事件）
- 🚀 **真实启动 JVM**：完整 lighty-launch pipeline，真正拉起游戏窗口
- 🔧 **多加载器**：vanilla / fabric / quilt / neoforge / forge，启动前自动解析精确 loader 版本（NeoForge 按官方命名 `{minor}.{patch}.` 精确匹配）
- 👤 **账号体系**：离线账号 + **微软设备流认证**（OAuth），微软 refresh_token 落 **OS keyring**（Secret Service / Keychain / 凭据管理器），账号本地持久化，实例**绑定账号启动**
- 🎛 **实例管理**：创建 / 启动 / 进度渲染，SQLite 持久化（重启存活），实例账号绑定一键持久化；实例页为**手机主屏式图标网格**（自定义图标 / 默认土块占位），点卡进**实例详情页**（换图标、启动账号、Java 版本选择、模组列表、删除）
- 🎮 **Modrinth 模组包 / 模组浏览（M13）**：独立「下载」页浏览 Modrinth（搜索/排序/来源 tab/分页/模组包·模组类型），点开选 MC 版本 + 加载器创建实例；创建后立即把 `.mrpack` 文件清单填进实例详情页「模组」栏展示（文件名/大小/必装标记/归属路径/sha1）；**首次启动自动解析 `.mrpack` 并安装全部依赖** —— 「下载 → 建实例 → 看模组 → 启动即装」流水线打通
- 🧩 **插件体系（演进中）**：Phase 0 **功能插件**已可插拔 —— 本地 `plugins/` 目录装载 + SHA-256 哈希校验（防篡改）+ Cordis 承载，启用/禁用即装载/卸载回滚（含示例 `demo-greeter`），**启用状态持久化**（重启后保持，`plugin-state.json`）；**主题 / 布局插件**已可注入（CSS 变量 + slot，示例 `demo-theme` / `demo-layout`）；**插件化 UI 骨架升级（M9-6）**——顶栏导航与页面路由改由 ui manifest 驱动，插件可经 `registerView` 新增/覆盖导航项与页面（示例 `demo-view`），并可声明**可点动作**（`actions` 按钮 → sidecar 插件 handler → 结果回显），「整套界面由插件声明 + 插件页可交互」的框架已立起；**主页小组件面板（M10）**——小组件即插件，自由像素拖拽编辑 / 文字·账号等动态小组件；组件级交互深化待分发演进
- 📦 **发布 runtime 落地**：sidecar 用 **bun 打成单文件可执行**（内嵌 runtime，无外部 Node 依赖，SQLite 走 Node 内置 `node:sqlite`），经 Tauri `externalBin` 打包 —— `tauri build` 已能产出 **deb / rpm / AppImage** 安装包
- 🧩 **主页面板的小组件系列（M14）**：主页小组件面板扩充为多个可并存的独立小组件插件 —— **下载预览**（Modrinth/CurseForge 快速预览 + 翻页浏览 + 放大镜跳下载搜索）、**快速实例**（实例磁贴网格，点击进详情 / 一键启动）、**主题颜色**（Adobe Color 式圆点选色，点击整体换肤并持久化）、**文字小组件**（编辑态输入 **Markdown**，标题/列表/代码等 Obsidian 式渲染）；面板布局采用**相对容器缩放（方案 B）** —— 保留自由像素拖拽摆放，窗口宽度变化时卡片随容器等比缩放、高度保持，不溢出不留白。从 Modrinth 模组包建的实例**图标跟随模组包图标**；支持 `/modrinth/:slug` 项目详情直达页
- 🎛 **UI 打磨 + 苹果划屏（M15）**：应用改为**半透明毛玻璃（亚克力）**外观（深紫边框 + 内部浅粉主体半透明模糊、随主题换肤、内缘厚度阴影）；顶栏下拉改 **Minecraft.net 官方页式分组导航**（左侧首页/资源/账号/插件 ＋ 竖分隔线 ＋ 右侧显示选中类别内容，主页与编辑同组）；新增**苹果划屏整页切换** —— 内容区竖直拖拽 / 键盘 ↑↓ 在五主视图间跟手滑动切换（详情页不参与）；修复主页小组件**重开/冷启动缩放失效**与**进账号页卡顿**（账号改为应用启动时全局加载）

> 每个里程碑的交付、验证、踩坑都记录在 [`docs/`](docs/) 下的 `M*-status.md`，完整技术决策见 [`MikoLauncher-architecture.md`](MikoLauncher-architecture.md)。

---

## 🚀 快速开始（开发）

环境：Node ≥ 26 · Rust ≥ 1.95 · pnpm 11

```bash
# 1. 安装依赖（pnpm workspace monorepo）
pnpm install

# 2. 构建共享契约（Rust↔TS 的 Zod schema）
pnpm run build

# 3. 启动 Tauri 桌面应用（Vue 前端 + Rust 内核 + Node sidecar）
pnpm dev:desktop
```

> 选项：`pnpm dev:host` 单独跑插件宿主；`cargo run -- --self-check`（在 `apps/desktop/src-tauri`）跑 Rust 内核自检（清单 / loader 版本 / 账号 / keyring / 插件装载 / sidecar 往返）。

**构建发布安装包**（需先装 [bun](https://bun.sh)，环境变量注意见下）：

```bash
# 1. 生成 sidecar 单文件可执行（bun 内嵌 runtime，无外部 Node 依赖）
pnpm --filter @miko-launcher/plugin-host build:binary

# 2. 打安装包（deb / rpm / AppImage）
pnpm --filter @miko-launcher/desktop tauri build
# CachyOS / Arch 等滚动发行版打 AppImage 需跳过 strip（linuxdeploy 旧 strip 不认 .relr.dyn）：
NO_STRIP=1 pnpm --filter @miko-launcher/desktop tauri build --bundles appimage
```

产物在 `apps/desktop/src-tauri/target/release/bundle/{deb,rpm,appimage}/`，均含主程序与 `plugin-host` sidecar。发布版数据/插件目录落在系统标准目录（Linux `~/.local/share/miko-launcher/`），由 Rust 端经 env 显式指定。

**跨平台发布（CI）**：发布链已接入 GitHub Actions —— `ci.yml` 每次 push/PR 持续验证含 sidecar 单文件构建；`release.yml` 打 tag `v*` 触发三端矩阵打包（Linux deb+rpm、macOS universal、Windows msi+nsis）并汇总成 GitHub Release：

```bash
git tag v0.1.0 && git push origin v0.1.0
```

> Linux AppImage 因 tauri 已知 CI bug（linuxdeploy 在 ubuntu runner 上失败，#14796）不在 CI 产出，改由本机 `NO_STRIP=1` 打包（见 BUILD-SIDECAR.md）。

**微软账号登录**（M10-6 起默认方式）：点「用 Microsoft 账号登录」自动弹系统浏览器，登录完成后把地址栏含 `code=` 的 URL 粘回启动器即可完成。使用**微软官方 Minecraft Launcher 的 client id**（免注册、免配置），能真正登录。

> 说明：Minecraft 认证的「全自动自动回跳」需一个被 Minecraft Services 认可的应用 client id（HMCL/PCL 是作者各自持有）。自注册普通 Azure 应用会被 `Microsoft Services` 租户拒绝（`AADSTS500200` / `login_with_xbox` 403），无法保证登录。若你后来拥有被认可/特批的 client id，可用仓库里的 loopback 全自动实现（配 `MIKO_MS_CLIENT_ID` + Azure redirect `http://127.0.0.1:5599/cb`）。

离线账号开箱即用，无需任何配置。

---

## 📁 项目结构

```
MikoLauncher/
├─ apps/
│  ├─ desktop/            # Tauri 应用壳（Vue3 前端 + Rust 内核）
│  │  ├─ src/             #   Vue3 前端（views / stores / api / router）
│  │  └─ src-tauri/src/   #   Rust 内核（core/launch · accounts · secrets · sidecar）
│  └─ plugin-host/        # Node sidecar（Cordis 插件宿主 · PluginManager）
├─ packages/
│  └─ shared/             # Rust↔TS 共享 Zod 契约（Single Source of Truth）
├─ plugins/               # 用户插件装载目录（Phase 0，含示例 demo-greeter / demo-theme / demo-layout）
├─ poc/                   # 早期概念验证脚本
└─ docs/                  # 各里程碑 M1-M13 交付/验证/踩坑
```

---

## 🗺 路线图

- **M1** — 骨架：monorepo · 共享 Zod 契约 · plugin-host(Cordis) · Tauri 壳 ✅
- **M2** — 三端联通：Vue ↔ Rust ↔ sidecar 读/写路径打通 ✅
- **M3** — 真实能力：版本清单 · SQLite 持久化 · 下载进度事件 ✅
- **M4** — 真实启动：lighty pipeline 真启 JVM · 真实进度 · java_major ✅
- **M5** — 前端接真实进度 · 具体 loader 版本解析 ✅
- **M6** — 账号体系 + 微软认证 ✅
- **M7** — 实例账号绑定持久化 · keyring 存微软 token · NeoForge 版本精确匹配 · 下载页 UI 增强 · Phase 0 功能插件装载 ✅
- **M8** — 主题 / 布局插件 ✅
- **M9** — 微软刷新失败重登 UI（M9-2 ✅）· 插件启用状态持久化（M9-3 ✅）· 发布 runtime 落地（M9-4 ✅，bun 单文件 + externalBin 出安装包）· 发布收尾（M9-5 ✅，CI 三端打包流水线 + GitHub Release）· 插件化 UI 骨架（M9-6 ✅，导航/页面改由插件驱动）· 插件分发演进（进行中）
- **M10** — 主页小组件面板体系（M10-1 ✅，小组件即插件，自由像素拖拽编辑态持久化、文字/账号小组件）+ 微软登录改官方 client id 手动粘 URL（M10-6 ✅，免注册真登录）· 账号小组件显示真实 Mojang 头像 ✅
- **M11** — 新建实例 ➕ 弹窗三选项 + 版本存在校验（M11 ✅）；实例页改「手机主屏式」图标网格卡片 + 实例详情页（M11-2 ✅，换图标/账号绑定/Java 版本/模组列表/删除）；修复「实例运行中启动器崩溃卡死」（M11-3 ✅，启动非阻塞化 + `launch:status` 状态列）· 下载页曾收进弹窗后又回归独立导航（并入 M13）
- **M12** — 修复 26.x 新版号启动崩溃（natives 子目录布局覆写压平）+ tokio runtime drop panic ✅；实例级 Java 版本选择 ✅
- **M13** — 「下载」页回归独立导航 + **Modrinth 模组包浏览/下载**（搜索/排序/分页/详情选版本建实例）✅；**实例内查看模组详情**（创建后解析 `.mrpack` 清单填进 mods + 详情页展示）✅；**启动时自动安装模组包依赖**（修 `lighty-launch` 缺 `modrinth` feature 致模组不装）✅ — 整条「下载 → 建实例 → 看模组 → 启动即装」流水线打通
- **M14** — 实例图标跟随模组包（Rust 下载转 data-URI + store 惰性补齐）✅；Modrinth 项目独立详情页 `/modrinth/:slug` ✅；新增小组件插件（下载预览 / 快速实例 / 主题颜色 / 文字 Markdown）✅；主页面板方案 B（相对容器缩放，窗口变化卡片随宽度等比缩放、高度保持，修重开失效）✅
- **M15** — UI 打磨 ✅：半透明毛玻璃亚克力外观 + 边框内缘厚度阴影；下拉改 Minecraft.net 官方页式分组导航（左类别四选 + 竖线 + 右内容）；**苹果划屏整页切换**（竖直拖拽 / 键盘 ↑↓ 五主视图滑动切换）；修「主页面板重开/冷启动缩放失效」与「进账号页卡顿（账号改启动即加载）」

---

## 📄 License

[MIT](LICENSE) © Miko

## 🤝 参与贡献

欢迎任何形式的参与 —— 提 issue、修 bug、加功能都可以。

- 想先了解项目约定，读 [`CONTRIBUTING.md`](CONTRIBUTING.md)
- 了解版本变更历史，看 [`CHANGELOG.md`](CHANGELOG.md)

---

*Minecraft 是 Mojang Synergies AB 的商标，MikoLauncher 与其无关且未经其认可。*
