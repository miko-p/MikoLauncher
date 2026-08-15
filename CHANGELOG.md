# Changelog

本项目所有值得注意的变更。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，语义版本见 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [未发布]

### 计划中
- 实例账号绑定持久化（`instance.updateAccount`）
- 微软 access token 改用 OS keyring 存储
- NeoForge 版本匹配改用官方版本列表 API
- 版本 / loader 选择 UI 增强（分组筛选、启动前可选 loader 版本）
- 插件化 MVP：Phase 0 插件装载 + 主题 / 布局 / 功能插件走 Cordis

---

## [0.1.0] - 2026-08-15

### 已添加

#### 账号
- **账号体系**：本地账号存储（JSON 持久化）
- **离线账号**：登录 / 列表 / 删除，稳定 UUID 派生
- **微软账号**：OAuth 设备流认证（`MIKO_MS_CLIENT_ID` 可配），refresh token 静默刷新
- **实例绑定账号**：启动时可选账号（可通过 payload 指定或实例 accountId）

#### 启动
- **真实启动 JVM**：完整 lighty-launch pipeline（metadata → JRE 下载 → 8 桶安装 → spawn JVM）
- **多加载器**：vanilla / fabric / quilt / neoforge / forge，启动前自动解析精确 loader 版本
- **真实下载进度**：JRE / MC 安装进度实时经 `download:progress` 事件回传

#### 核心
- **前后端分离**：Vue3 前端 + Rust 内核 + Node/Cordis 插件宿主三端联通
- **版本清单**：真实 Mojang 版本拉取 + 解析 Java 版本要求（`javaMajor`）
- **实例管理**：创建 / 列表 / 删除，SQLite 持久化（重启存活）
- **共享契约**：Rust↔TS Zod schema（Single Source of Truth，防契约漂移）

#### 插件范式（演进中）
- Cordis 插件宿主骨架（`ctx.effect` 回滚 / 依赖注入 / HMR）

### 项目 / 运维
- Monorepo 初始化（pnpm workspace）
- 项目改名 `mc-launcher` → `MikoLauncher`
- README 项目介绍 + MIT LICENSE
- 各里程碑交付 / 验证 / 踩坑记录于 `docs/M*-status.md`

[0.1.0]: https://github.com/miko-p/MikoLauncher/releases/tag/v0.1.0
