<div align="center">

# 🚀 MikoLauncher

**一个用 Rust + Vue + Cordis 打造的 Minecraft Java 版启动器**

强调「可定制、可回滚、可扩展」的插件体系，和人类可读的前后端分离架构。

---

</div>

## ✨ 它是什么

MikoLauncher 是一个 Minecraft（Java 版）启动器，围绕两个设计目标构建：

1. **人类可读的架构** —— 前后端分离：UI 只用 MVVM，领域/服务层走传统 OOP + DDD，不把整个应用绑成一个泥潭。新人读代码能快速理解每一层在做什么。
2. **真正可定制、可回滚、可扩展** —— 用 **Cordis** 的「时空可组合」范式做插件宿主：插件在卸载*自动回滚*自己创建的一切（`ctx.effect`），支持依赖注入、热更新。主题、布局、功能都能以插件形式插拔。

> 它不旨在复刻任何既有启动器，而是把「插件范式」「前后端分离」「真实启动能力」这三件自己在意的事做好。

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
- 🔧 **多加载器**：vanilla / fabric / quilt / neoforge / forge，启动前自动解析精确 loader 版本
- 👤 **账号体系**：离线账号 + **微软设备流认证**（OAuth），账号本地持久化，实例绑定账号启动
- 🎛 **实例管理**：创建 / 启动 / 进度渲染，SQLite 持久化（重启存活）
- 🧩 **插件范式（演进中）**：Cordis 骨架就绪，主题 / 布局 / 功能插件走 `ctx.effect` 回滚

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

> 选项：`pnpm dev:host` 单独跑插件宿主；`cargo run -- --self-check`（在 `apps/desktop/src-tauri`）跑 Rust 内核自检（清单 / loader 版本 / 账号 / sidecar 往返）。

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
│  │  └─ src-tauri/src/   #   Rust 内核（core/launch · core/accounts · core/sidecar）
│  └─ plugin-host/        # Node sidecar（Cordis 插件宿主）
├─ packages/
│  └─ shared/             # Rust↔TS 共享 Zod 契约（Single Source of Truth）
├─ plugins/               # 用户插件装载目录（Phase 0）
├─ poc/                   # 早期概念验证脚本
└─ docs/                  # 各里程碑 M1-M6 交付/验证/踩坑
```

---

## 🗺 路线图

- **M1** — 骨架：monorepo · 共享 Zod 契约 · plugin-host(Cordis) · Tauri 壳 ✅
- **M2** — 三端联通：Vue ↔ Rust ↔ sidecar 读/写路径打通 ✅
- **M3** — 真实能力：版本清单 · SQLite 持久化 · 下载进度事件 ✅
- **M4** — 真实启动：lighty pipeline 真启 JVM · 真实进度 · java_major ✅
- **M5** — 前端接真实进度 · 具体 loader 版本解析 ✅
- **M6** — 账号体系 + 微软认证 ✅
- **M7** — 实例账号绑定持久化 · keyring 存 token · 版本/loader 选择 UI · 插件化 MVP ⏳

---

## 📄 License

[MIT](LICENSE) © Miko

---

*Minecraft 是 Mojang Synergies AB 的商标，MikoLauncher 与其无关且未经其认可。*
