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
- 🎛 **实例管理**：创建 / 启动 / 进度渲染，SQLite 持久化（重启存活），实例账号绑定一键持久化
- 🧩 **插件体系（演进中）**：Phase 0 **功能插件**已可插拔 —— 本地 `plugins/` 目录装载 + SHA-256 哈希校验（防篡改）+ Cordis 承载，启用/禁用即装载/卸载回滚（含示例 `demo-greeter`），**启用状态持久化**（重启后保持，`plugin-state.json`）；**主题 / 布局插件**已可注入（CSS 变量 + slot，示例 `demo-theme` / `demo-layout`）
- 📦 **发布 runtime 落地**：sidecar 用 **bun 打成单文件可执行**（内嵌 runtime，无外部 Node 依赖，SQLite 走 Node 内置 `node:sqlite`），经 Tauri `externalBin` 打包 —— `tauri build` 已能产出 **deb / rpm / AppImage** 安装包

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

**微软账号登录**需先注册 Azure AD 公共客户端应用并获得 Mojang 批准，然后以环境变量提供 client_id：

```bash
export MIKO_MS_CLIENT_ID="your-azure-client-id"
```

（离线账号开箱即用，无需此步骤。）

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
└─ docs/                  # 各里程碑 M1-M9 交付/验证/踩坑
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
- **M9** — 微软刷新失败重登 UI（M9-2 ✅）· 插件启用状态持久化（M9-3 ✅）· 发布 runtime 落地（M9-4 ✅，bun 单文件 + externalBin 出安装包）· 插件分发演进（进行中）

---

## 📄 License

[MIT](LICENSE) © Miko

## 🤝 参与贡献

欢迎任何形式的参与 —— 提 issue、修 bug、加功能都可以。

- 想先了解项目约定，读 [`CONTRIBUTING.md`](CONTRIBUTING.md)
- 了解版本变更历史，看 [`CHANGELOG.md`](CHANGELOG.md)

---

*Minecraft 是 Mojang Synergies AB 的商标，MikoLauncher 与其无关且未经其认可。*
