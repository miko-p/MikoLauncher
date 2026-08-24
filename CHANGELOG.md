# Changelog

本项目所有值得注意的变更。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，语义版本见 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [未发布]

### M9 已添加
- **插件化 UI 骨架（M9-6）**：把顶栏导航 + 页面路由从「前端硬编码五页」升级为由 ui manifest 驱动 —— `UiViewSchema`（key/label/path/order/builtin/type/html/disabled/**actions**）并入 `UiManifestSchema.views`；sidecar `UiRegistryService` 种子化内置五视图 + `registerView()`（插件可**新增/覆盖**导航项与页面，卸载 `effect` 自动移除 builtin 外的视图）；前端 `App.vue` 导航条改由 `uiStore.views` 渲染（过滤 disabled + 按 order 排序）+ `router.addRoute` 动态注册插件视图 → `PluginHtmlView`（v-html 渲染插件内容，与布局 slot 同通道）。示例插件 `demo-view` 贡献一个「示例视图」导航页。**真交互（M9-6b）**：插件视图可声明 `actions`（按钮），点击经 Rust `plugin_view_action` → sidecar 插件 `view.<key>.<action>` handler → 结果回显；方法名限定 `view.*` 命名空间（未知动作拒绝）。dev 误走打包分支已修复（`resolve_plugin_host` 用 `cfg!(debug_assertions)` 排除）。组件级交互（Vue 组件、沙箱）留待分发演进 Phase 2。
- **发布 runtime 收尾（M9-5）**：发布链纳入 GitHub Actions —— `ci.yml` 新增 `Install bun` + `Build sidecar binary (smoke)` 持续验证单文件侧车可产出；新增 `release.yml`（打 tag `v*` 触发）三端矩阵打包（Linux `NO_STRIP=1` 出 deb/rpm/AppImage、macOS universal、Windows msi/nsis），各端 `upload-artifact` 后由 `create-release` 作业汇总成 GitHub Release（draft + 自动 release notes）。`build-binary.sh` 跨平台化：Windows 侧产物带 `.exe` 后缀、落位改 `cp`（POSIX/Git Bash 通用）；`resolve_plugin_host()` 打包分支按 `cfg!(windows)` 找 companion（Windows=`plugin-host.exe`），消除 Windows 装版定位不到 sidecar 的隐患。
- **发布 runtime 选型落地（M9-4）**：方案 A 单文件内嵌定稿——SQLite 从 better-sqlite3 迁移到 Node 内置 `node:sqlite`（去掉 sidecar 唯一原生模块），用 `bun build --compile` 打成一发可执行（内嵌 Bun runtime，无外部 Node 依赖），经 `tauri.conf.json` `bundle.externalBin` 打包进 deb/rpm/AppImage；发布版由 Rust 注入 `MC_LAUNCHER_DATA_DIR`/`MIKO_PLUGINS_DIR` 显式定位数据与插件目录（不依赖二进制反推源码布局，解决 bun 单文件 `import.meta.url` 定位盲区）。修掉 `frontendDist` 路径错位（原本 `tauri build` 找不到前端 dist）、记录 CachyOS 上 AppImage 打包需 `NO_STRIP=1`（linuxdeploy 旧 strip 不认识 `.relr.dyn`）。`apps/plugin-host/build-binary.sh` 一键产 externalBin 二进制。发布版 `--self-check` 全链路通过。
- **SQLite 驱动迁移（better-sqlite3 → node:sqlite）**：`db.ts`/`instance-manager.ts` 改用 Node 26 内置 `DatabaseSync`（pragma 用 `exec`、`@name` 命名绑定兼容），移除 better-sqlite3 依赖与 pnpm allowBuilds 原生编译项。
- **插件启用状态持久化（M9-3）**：`plugin-manager` 新增 `plugin-state.json` 启用状态落盘（缺省全启用）——`enable/disable` 持久化期望状态，`loadAll` 按状态选择性装载（禁用插件重启后不自动加载）；`plugin.list` 返回 `enabled` 字段，前端插件页展示「启用/已停用」徽标 + hover 说明；重启状态保持已用 dev tsx 与生产 bundle 双路径验证。
- **修复 M8-B bundle 路径错位**：`resolveHostRoot()` 兼容 dev（`src/services`）与 bundle（`dist`）两种 `import.meta.url` 形态，修掉生产 bundle 扫不到 `plugins/`、数据目录落到错误路径的潜在缺陷。
- **微软静默刷新失败重登 UI（M9-2）**：`account.refresh` 契约（`needsReauth` 信号）+ Rust `account_refresh` command —— 对指定微软账号显式静默刷新，区分「凭据仍有效」/「已失效需重新登录」（离线账号恒有效）；前端账号页挂载时自动检测各微软账号，失效时醒目「需重新登录」标记 + 失效原因 + 重新登录入口（走设备流），并提供手动「检查」按钮；`--self-check ⑩` 全链路验证 + Rust 单测。
- **Microsoft 账号失效检测**：`accounts.rs` 新增 `refresh_microsoft_account()`（只读检测，不改持久化），单测覆盖「离线恒有效/不存在报错」。

### M8 已添加
- **主题 / 布局插件（M8-1）**：三类插件补齐主题（CSS 变量运行时加载）+ 布局（slot 注入）。`UiRegistryService`（pull-based 镜像 Cordis 回滚：themeStack 弹栈 + per-slot layouts）、`ui.getManifest` 契约、前端 `App.vue` 注入点 + `stores/ui.ts`、示例插件 `demo-theme`/`demo-layout`；`--self-check ⑨` 全链路过
- **sidecar 打包骨架（M8-B）**：esbuild 把 sidecar 打成单文件 `dist/main.mjs`（紧凑 cordis/shared，仅 better-sqlite3 原生模块 external）；`resolve_plugin_host()` 双路径（打包 externalBin / dev tsx）；`BUILD-SIDECAR.md` 记录发布 runtime 选型
- **CSP 安全补丁**：`tauri.conf.json` 从 `csp: null` 收紧为基础策略（`script-src 'self'` 拦内联脚本、`style-src 'unsafe-inline'` 给主题 CSS），为 v-html 引入的必要安全补偿

### M7 已添加
- **实例账号绑定持久化**：`instance.updateAccount` 把 accountId 真实写入实例（SQLite），前端下拉直接持久化；启动用实例绑定账号（替代启动时临时指定）
- **微软凭据落 OS keyring**：refresh_token 存 Secret Service / Keychain / Credential Manager（`keyring` feature 默认开），accounts.json 不再存明文；无 keyring 会话安全回退；删账号连带清理
- **NeoForge 版本精确匹配**：改按官方命名规则的 `{minor}.{patch}.` 精确前缀（修掉误匹配其它 MC patch 的 bug）
- **下载页 UI 增强**：类型分组 tabs + 关键字搜索 + 每版本 loader 下拉「以此版本创建实例」
- **Phase 0 功能插件装载**：`plugins/*/` + hash 校验 + `ctx.plugin()` 走 Cordis（空间可组合注入 / 时间可组合回滚）；`plugin.list/enable/disable` + 插件页；示例插件 `demo-greeter`
- **安全扫描**：`ai-sec-scan` 全仓库 17 项告警逐条核实**全部为误报**（参数化 SQL / 非 SQL 行 / 固定路径），无真实漏洞，详见 `docs/M7-status.md`

### M7 已修复
- **代码审查缺陷修复**：`chrono_now()` 伪日期 → 真 ISO8601（+单测）；accounts.json 写后 `0600`；过时注释更正；DownloadView quickCreate 默认 loader 不一致 + 消 `as any`；plugin-manager 批量加载去重复 `discover` 扫描；清理改名残留旧库 + 自检 create 后即删（不再堆积 `SelfCheckSMP`）

### 计划中（M9）
- 插件市场 / 签名（Phase 1/2）
- 多账号快捷切换
- 插件管理 UI 完善（hash 失败告警到前端已做；后续补齐分发演进）

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
