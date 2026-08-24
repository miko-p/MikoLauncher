# Minecraft 启动器 —— 最终架构蓝图（定稿）

> 项目代号：`miko-launcher`
> 定位：类 PCL / Modrinth App 的 Minecraft Java 版启动器，具备 **MVVM + OOP + 人类可读** 的代码结构，
> 以及**高度可自定义（主题/布局/功能插件）+ 可回滚卸载**的插件体系，底层采用**时空可组合式编程范式（Cordis）**。
> 许可证：**开源**（采用 GPLv3 或 MIT，见文末）。本文件为技术方案定稿，可作为后续开发与评审的单一事实来源（Single Source of Truth）。

---

## 零、决策总览（全部锁定）

| 决策项 | 结论 | 说明 |
|---|---|---|
| 顶层架构 | **路线 A：前后端分离** | UI 层 MVVM，领域/服务层 OOP + DDD，插件层 Cordis |
| 应用壳 | **Tauri 2**（Rust 后端） | 非 Electron；内存小、体积小、Modrinth 已验证 |
| 前端框架 | **Vue 3 + TypeScript** | Composition API；Pinia 做 VM |
| 插件范式 | **时空可组合 = Cordis** | `ctx.effect` 回滚 + 依赖注入 + HMR |
| MC 启动内核 | **LightyLauncherLib**（Rust, MIT） | 复用现成，feature 按需裁剪 |
| 插件宿主 | **混合分层**：Rust 核心 + **Node sidecar** 跑 Cordis | Node 起步，稳定优先 |
| 数据存储 | **SQLite** + Drizzle ORM | Theseus 同款数据库方案 |
| 插件分发 | **Phase 0 起步**：本地目录 + hash 校验 | 后续演进到签名市场 |
| 许可证取向 | **开源** | 内核用 MIT 的 Lighty，无 GPL 传染顾虑 |

---

## 一、现状调研摘要（为什么这么做）

| 启动器 | 技术栈 | 插件系统 | 借鉴点 |
|---|---|---|---|
| PCL | C# / WPF | ❌ 无 | 交互设计 |
| HMCL | Java / JavaFX | ⚠️ 仅主题定制 | 功能广度 |
| Prism | C++ / Qt | ❌ 停滞在 RFC | 实例管理 |
| Modrinth (Theseus) | Rust(Tauri) + Vue | ❌ 无插件 API | 前后端分离范式 |

**差异化机会**：主流启动器要么没插件系统、要么做不出来。我们要做"主题 + 布局 + 功能"三类热插拔可回滚插件，正好是 Cordis 强项。

---

## 二、核心范式：时空可组合（Cordis）

由 [cordiverse/paper](https://github.com/cordiverse/paper) 正式定义，在 **Cordis**（TS/JS）落地，DeepSeek harness 项目 4 年实战验证。

- **时间可组合**：`ctx.effect(cleanupFn)` 注册逆操作，卸载时按逆序回滚该插件创建的状态/监听/连接/内存。
- **空间可组合**：`inject: [...]` 声明依赖，框架自动注入并管理依赖图。
- **显式 DI**：`ctx.plugin(插件)` 代码即插件树，人类可读。
- **HMR**：改插件即时生效，无需重启。

> 代价：Cordis 是 TS/JS，且依赖 Node API → 插件宿主必须是 Node（或 Bun）sidecar，而非内嵌 JS 引擎。

---

## 三、整体架构（混合分层）

```
┌─────────────────────────────────────────────┐
│  前端 WebView  (Vue3 + Pinia)  [MVVM 的 V+VM] │
│  · 页面组件、主题/布局插件 UI                  │
└───────────────┬─────────────────────────────┘
                │ Tauri IPC (invoke + events)
┌───────────────┴─────────────────────────────┐
│  插件宿主  (Node sidecar)  [Cordis]           │
│  · 功能插件注册（下载/实例/账号流程编排）       │
│  · ctx.effect 回滚 · 依赖注入 · HMR            │
└───────────────┬─────────────────────────────┘
                │ JSON-RPC (shell / stdin-stdout / socket)
┌───────────────┴─────────────────────────────┐
│  Rust 核心  (Tauri 后端 + LightyLauncherLib)  │
│  · 真实下载/版本清单解析/启动 JVM/认证/进程管理 │
└─────────────────────────────────────────────┘
```

**分工原则一句话**："给你看/让你摆" 交给前端 + 插件层；"真要动 JVM / 干重活" 交给 Rust 内核。

---

## 四、分层职责（MVVM + OOP 落位）

| 层 | 职责 | 技术 | 说明 |
|---|---|---|---|
| **Domain 层** | 实体：`Version`/`Instance`/`Mod`/`Account`/`ModLoader` | 纯 TS，无副作用 | OOP 稳定内核，可独立单测 |
| **Core 服务层** | `DownloadService`/`AuthService`/`JavaLocator`/`InstanceManager`/`LaunchAdapter` | TS，注入 Cordis | 编排逻辑；真正的重活委托给 Rust |
| **Cordis 轮毂** | 插件注册、依赖图、效果逆操作表、HMR | Cordis | 功能插件的容器与总线 |
| **ViewModel 层** | 每页面一个 VM，把服务状态映射成 UI 绑定状态 | Pinia store | MVVM 的 VM |
| **View 层** | 页面组件 | Vue3 `<script setup>` | MVVM 的 V；主题注入 CSS 变量，布局组件置换 |

> MVVM 只用在 UI 层。领域/服务层用传统 OOP + DDD，桥梁是模块化响应式 VM。这样不会像 HMCL 那样把整个 app 绑成 MVC 泥潭。

---

## 五、技术栈定稿清单

### 运行时与应用壳
- **Tauri 2**（Rust 后端，WebView 前端）
- **Node.js sidecar**（跑 Cordis 插件宿主）+ `pkg`/`bun build` 打包单文件二进制，经 Tauri shell 插件拉起

### 前端（MVVM）
- **Vue 3 + TypeScript**（`<script setup>`）
- **Pinia**（状态管理 = VM）
- **Vue Router**（页面路由，供布局插件挂接）
- **Vite**（构建）

### 插件与范式
- **Cordis**：`cordis`（core）、`@cordisjs/plugin-loader`（运行时插件树/配置）、`@cordisjs/plugin-hmr`（热更新）、`@cordisjs/plugin-group` / `plugin-include`（分组与配置 include）
- 插件配置：**YAML `cordis.yml`** 声明插件树

### 数据
- **SQLite** + **better-sqlite3** / **Drizzle ORM**（类型安全）

### MC 内核
- **LightyLauncherLib**（crates.io `lighty-launcher`），feature 开启所需模块：
  - loaders（vanilla/fabric/quilt/neoforge/forge）、auth（离线/微软）、java（JRE 下载）、launch、modsloader（modrinth/curseforge）、events、keyring

### Rust↔TS 契约
- **JSON-RPC over sidecar** + **Zod schema**（进/出两侧都校验，防契约漂移）

---

## 六、monorepo 目录结构（定稿）

```
miko-launcher/
├─ apps/
│  ├─ desktop/                 # Tauri 壳 (Rust + 前端宿主)
│  │  ├─ src-tauri/            # Rust 后端
│  │  │  ├─ src/               # core bridge（command handlers）
│  │  │  ├─ core/              # LaunchAdapter / config / sidecar 管理
│  │  │  └─ tauri.conf.json    # externalBin 声明 sidecar
│  │  └─ src/                  # 前端 (Vue3)
│  │     ├─ views/             # 页面
│  │     ├─ components/        # 组件（布局插件置换点）
│  │     ├─ stores/            # Pinia (VM)
│  │     └─ themes/            # 内置主题
│  └─ plugin-host/             # Node sidecar (Cordis 宿主)
│     ├─ src/
│     │  ├─ context.ts         # 根 Context + 服务注册
│     │  ├─ services/          # Download/Auth/Instance/LaunchAdapters
│     │  ├─ bridge/            # JSON-RPC client -> Rust
│     │  └─ plugins/           # 内置功能插件
│     ├─ cordis.yml            # 插件树声明
│     └─ package.json
├─ packages/
│  ├─ kernel-rust/             # 对 LightyLauncherLib 的封装（crate）
│  └─ shared/                  # 共享 TS 类型 + Zod schema（IPC 契约）
├─ plugins/                    # 用户插件装载目录 (Phase 0)
├─ docs/                       # 本蓝图 + 开发文档
└─ package.json                # pnpm workspace
```

---

## 七、IPC 契约（Rust ↔ TS，防漂移）

- **契约即代码**：定义于 `packages/shared`，用 **Zod** 描述进/出消息。
- 双向校验：Rust 端用 `zod` 对应的结构校验（或 `ts-rs`/手写 serde），TS 端用 Zod。
- 版本化：所有 method 带 `apiVersion` 字段，不兼容变更需 bump。
- 通信通道：sidecar `stdin/stdout`（JSON 行协议），长耗时进度走 Tauri `events` 推给前端。

示例消息形状（定型将在 starter 阶段细化）：
```ts
// request:  {"id":1,"apiVersion":1,"method":"instance.launch","params":{...}}
// response: {"id":1,"ok":true,"data":{pid:1234}} | {"id":1,"ok":false,"error":{...}}
```

---

## 八、cordis.yml 插件树（起点草案）

以下为**结构骨架示意**，具体内置插件清单在 Starter 阶段精化：

```yaml
# cordis.yml —— 声明插件树（Cordis loader 读取）
# 内置功能插件先于用户插件加载，作为基础服务
plugins:
  include: core.yml            # 拆分子配置文件（core 服务层）
  # 用户插件目录启动时自动扫描加载（Phase 0），此处可覆盖/启用
  group: users:
    # 每个插件一个含 manifest.json 的子目录；以下为示意条目
    # enabled-theme:  {}
    # custom-layout: {}
```

> 说明：Phase 0 下用户插件不写死在 `cordis.yml`，而是由 loader 启动时扫描 `plugins/` 目录 + hash 校验后动态注册；`cordis.yml` 主要承载**内置服务**与**默认启用配置**。完整插件树在 Starter 草案产出。

---

## 九、插件分发：Phase 0 落地（定稿）

**当前阶段只做 Phase 0**（个人/内测）：本地 `plugins/` 目录 + 启动时 SRI-style hash 校验。

- 目录：每个插件一个子目录，含 `manifest.json`（name/version/api/publisher/inject）+ `main.js`（构建产物）+ `hash`。
- 加载：启动时由 Cordis loader 扫描 `plugins/`，按 `manifest` 注册；校验内容 hash 与 manifest 记录一致，不一致则拒绝加载并告警。
- 未来演进路径（非当前范围，记录备查）：
  - Phase 1 → 自建中心仓库 + 内置浏览，发布时自动扫描 + 记录 hash
  - Phase 2 → 发布管道签名（仓库签名 + 发布者签名）+ 安装验签 + 封禁列表 kill-switch（对标 VS Code/Chrome）
  - 沙箱仅作可选实验项，不默认承诺

> 安全基线认知：成熟生态（Obsidian/VS Code/Chrome）都不靠沙箱，而靠"签名 + 自动扫描 + 声誉 + 封禁治理"的信任模型。插件有接近本机的权限，这是特性也是责任。

---

## 十、三类插件落地定义

| 插件类型 | 技术形态 | 回滚示例 |
|---|---|---|
| **主题插件** | `themes/manifest` + `theme.css`（CSS 变量） | `ctx.effect(()=>移除<link>)` |
| **布局插件** | Vue 组件，覆盖某 `slot`/路由 | `ctx.effect(()=>恢复默认组件)` |
| **功能插件** | 注册服务/命令/流程，注入依赖 | `ctx.effect(()=>关闭连接/取消监听)` |

---

## 十一、风险与对策（锁定）

| 风险 | 对策 |
|---|---|
| 插件有接近本机的权限 | Phase 0 用 hash 校验守住"本地文件未被篡改"；后续演进到签名市场 |
| 双运行时体积/内存 | 接受；这是"要 Cordis 范式"的成本；Node sidecar 可用 `--snapshot`/精简启动缓解 |
| Rust↔TS 契约漂移 | 契约即代码（packages/shared + Zod + apiVersion），双向校验 |
| GPL 传染 | 内核用 MIT 的 LightyLauncherLib，项目本身开源无冲突 |
| Cordis 依赖 Node API | 插件宿主定为 Node sidecar（已锁定），不做内嵌引擎 |

---

## 十二、里程碑（可执行）

### M0 — POC 验证 ✅ 已完成
> 三项验证全部跑通，实际执行脚本位于 `poc/` 目录，可随时复跑复现。

| 验证 | 脚本 | 结果 | 关键结论 |
|---|---|---|---|
| **V1 Cordis 传统范式（注入/回滚）** | `poc/poc1-effect-inject.js` | ✅ PASS | ①反序加载 + `inject` 依赖自动激活（顺序无关）；②服务注入生效；③单独 `fiber.dispose()` 只回滚该插件自己的 `ctx.effect`；④整树 dispose 逆序级联回滚。确认 Cordis 4 API（`Service`/`ctx.effect`/`inject`/`ctx.plugin`）。 |
| **V2 进程链路（Rust 宿主↔Node sidecar）** | `poc/poc2-rpc.js`（纯 Node 契约）<br>`poc/poc2-tauri/`（Rust `cargo run`） | ✅ PASS | Rust 宿主能 spawn Node sidecar 并完成 JSON-RPC 往返：带 `id`/`apiVersion` 的请求→结构化 `ok/error` 响应；`apiVersion` 版本校验生效；未知 method 返回结构化错误。部署期换 externalBin 打包即可，链路一致。 |
| **V3 主题插件卸载回滚 + HMR 热替换** | `poc/poc3a-theme-revert.js`（回滚）<br>`poc/poc3b/`（Loader + HMR 机制） | ✅ PASS | ①从 `cordis.yml` 声明式加载插件树，theme/layout 按依赖注入；②动态禁用主题插件 → `ctx.effect` 逆操作自动执行（CSS 1→0）；③重新启用 → 主题重新应用（0→1）。证明 HMR 热替换运行机制成立。 |

#### POC 过程中确认的关键 API（供 M1 使用）

- **服务注册**：`class X extends Service { constructor(ctx){ super(ctx,'name') } }`，`ctx.plugin(X)` 挂载即注册；注册本身是 effect，卸载 provider 即移除服务。
- **依赖注入**：插件对象 `{ name, inject:['svc'], apply(ctx){...} }`；Cordis 持 PENDING 直到依赖就绪，顺序无关；依赖消失时消费者联动卸载。
- **副作用卸载**：`ctx.effect(() => { ...acquire...; return () => { ...release... } })`；`fiber.dispose()` 触发逆操作。
- **HMR 机制**：`@cordisjs/plugin-loader` 的 `entry.update({ disabled })` 触发插件 fiber 卸载/重载并自动回滚 effect；`@cordisjs/plugin-hmr` 只是对文件变更调用同一套 loader API 的文件 watcher 封装。
- **Rust 宿主**：`std::process::Command` spawn Node + stdio 双向 JSON-RPC（后续以 `tauri-plugin-shell` + `externalBin` 替换，语义一致）。
- **环境**：已装 Node 26 / Rust 1.97 (cargo) / pnpm 11 / webkit2gtk-4.1（Tauri 2 Linux 依赖齐全）。

#### 注意点（M1 要规避的坑）
1. 服务在继承链上唯一：`root.extend()` 的子 context 会继承已注册服务，**不能重复注册同名服务**，需 `intercept`/`isolate` 才可覆盖。
2. Plugin 加载后 `entry.name` 为空串，热替换时按 `entry.id`（带子树前缀 `xxx:name`）定位，而非 name。
3. include 插件把 yaml 插件挂到自己的 subtree，遍历需递归 `entry.subtree`。
4. POC 用纯 Node/`std::process` 验证链路（快速），完整 Tauri GUI + shell 插件集成留到 M1。

### M1 — 骨架搭建
1. pnpm monorepo 初始化（apps/desktop、apps/plugin-host、packages/shared）。
2. packages/shared 定义 Zod IPC 契约。
3. Rust 侧接入 LightyLauncherLib（feature 裁剪），暴露 `instance.launch`/`instance.list` 等 command。
4. Tauri 壳 + `externalBin` 打包 Node sidecar（把 M0 V2 的 `std::process` 升级为正式 shell 插件集成）。

### M2 — 首个 MVVM 页面（下载页）
5. Vue3 骨架 + Pinia store + Router。
6. 下载页 VM：连接 Rust 的下载进度事件，展示 Modrinth 源。
7. 内置主题切换 MVP。

### M3 — 插件化 MVP（规划）
8. Phase 0 插件装载（plugins/ + hash 校验）。
9. 主题插件 + 布局插件 + 第一个内置功能插件走通 Cordis。

> 实际执行有演进偏移：M2/M3/M4 已按「联通→真实能力→真实启动」落地，插件化 MVP（上述 8/9）整体顺延。

### M4 — 真实启动 ✅ 已完成（见 `docs/M4-status.md`）
- `instance.launch` 本地真实启动：lighty-launch 完整 pipeline（VersionBuilder + OfflineAuth → metadata → JRE 下载 → 8 桶 install → spawn JVM），`instance_launch` command 不再转发 sidecar。
- 版本清单补全 `java_major`（逐条拉版本 json，前 20 条）。
- 下载/安装真实进度桥接为 `download:progress`（`tokio::select!` 驱动 EventBus），替换 M3 模拟。

### M5 — 前端接真实进度 + 具体 loader 版本 ✅ 已完成（见 `docs/M5-status.md`）
- `resolve_loader_version(loader, mc)`：fabric/quilt(meta JSON)、forge(maven.minecraftforge.net)、neoforge(maven.neoforged.net) 官方解析精确版本，替代 M4 的 `"latest"` 占位（该占位 lighty 无法拼出合法 URL）。
- 前端实例页启动时订阅 `download:progress` 实时渲染下载/安装进度条；版本清单展示 `Java xx` 要求。

### M6 — 账号体系 + 微软认证 ✅ 已完成（见 `docs/M6-status.md`）
- `core/accounts.rs`：AccountStore（JSON 持久化）+ 离线账号（lighty 稳定 UUID）+ 微软账号（`MicrosoftAuth` 设备流 + refresh 静默刷新）+ `AccountIdentity`→launch `UserProfile`。
- 新增 `account.*` command + `account:device-code` 事件；`instance.launch` 用绑定账号（payload/实例 accountId，回退离线 Player）替代硬编码 Player。
- 前端账号页（离线/微软登录 + device-code + 删除）+ 实例启动账号下拉。

### M7 — 账号横切 + UI 增强 + Phase 0 插件 ✅ 已完成（见 `docs/M7-status.md`）
- **实例账号绑定持久化**：`instance.updateAccount` 真实写 SQLite `account_id`；前端下拉直接持久化；启动用实例绑定账号。
- **微软凭据落 OS keyring**：`core/secrets.rs` + `AccountEntry.keyring`；refresh_token 存 Secret Service/Keychain/Credential Manager（默认 feature），无会话回退 accounts.json；删账号连带清理。
- **NeoForge 版本精确匹配**：按官方命名 `{minor}.{patch}.` 精确前缀（修 505 误匹配 bug）。
- **下载页 UI 增强**：类型 tabs + 搜索 + 每版本 loader 下拉建实例。
- **Phase 0 功能插件装载**：`services/plugin-manager.ts`（hash 校验 + `ctx.plugin()` 走 Cordis）；`plugin.list/enable/disable` + 插件页；示例插件 `demo-greeter`。

### M8 — 主题/布局插件 + 打包骨架 + 修复（进行中，见 `docs/M8-status.md`）
- **主题/布局插件（M8-1）**：兑现蓝图「三类插件」—— 主题（CSS 变量运行时加载）+ 布局（slot 注入）。`UiRegistryService`（pull-based 镜像 Cordis 回滚：themeStack 弹栈 + per-slot layouts）；`ui.getManifest` 契约；前端 `App.vue` 注入点 + `stores/ui.ts`；示例 `demo-theme` / `demo-layout`；自检 ⑨ 全链路过。
- **sidecar 打包骨架（M8-B）**：esbuild 把 sidecar 打成单文件 `dist/main.mjs`（紧凑 cordis/shared，仅 better-sqlite3 external）；`resolve_plugin_host()` 双路径（打包 externalBin / dev tsx）；发布 runtime 选型待定（`BUILD-SIDECAR.md`）。
- **CSP 补丁**：`security.csp` 从 `null` 收紧为基础策略（script-src 'self' 拦内联脚本；style-src 'unsafe-inline' 给主题 CSS），为 v-html 的安全补偿。
- **审查修复**：`chrono_now()` 伪日期→真 ISO8601（+单测）；accounts.json `0600`；过时注释；DownloadView loader 不一致；plugin-manager 去重复扫描；自检不再堆积实例 + 清旧库。

---

## 十三、下一步（M9）

M8 已落地：**主题/布局插件**、**sidecar 打包骨架**、**CSP 补丁** 与一批审查修复（完整见 `docs/M8-status.md`）。M9 起点（优先级建议）：
1. **发布 runtime 选型落地** ✅（M9-4，见 `docs/M9-status.md` + `BUILD-SIDECAR.md`）：定稿方案 A 单文件内嵌——SQLite 迁移到 Node 内置 `node:sqlite`、`bun build --compile` 打单文件可执行、`tauri.conf.json` `bundle.externalBin` 打包；发布版由 Rust 注入 env 显式定位数据/插件目录。`tauri build` 已出 deb/rpm/AppImage 三包并验证含 sidecar。**收尾 ✅（M9-5）**：发布链接入 GitHub Actions——`ci.yml` 持续验证 sidecar 单文件构建，新增 `release.yml` 打 tag `v*` 三端矩阵（Linux `NO_STRIP=1` / macOS universal / Windows）打包并汇总 GitHub Release；`resolve_plugin_host()` 跨平台 companion 名（Windows `.exe`）。
2. **微软静默刷新失败后的重登录 UI** ✅ 已完成（M9-2，见 `docs/M9-status.md`）；多账号快捷切换仍待定（当前以实例绑定账号承载）。
3. **插件管理 UI 完善** ✅ 插件启用状态持久化（M9-3，`plugin-state.json`，见 `docs/M9-status.md`）；hash 校验失败告警前端已展示（hash✗）。
4. **插件分发演进**：Phase 1 自建仓库 + 内置浏览；Phase 2 签名 + 验签 + 封禁清单（见 §九）。**M9-6 插件化 UI 骨架 ✅（已落地）**：顶栏导航与页面路由改由 `ui.getManifest.views` 驱动（sidecar `UiRegistryService` 种子化内置五视图 + `registerView()`；前端导航渲染自 manifest + `router.addRoute` 动态注册插件视图 → `PluginHtmlView`）。**交互承载边界**：插件视图当前 `type='html'`（v-html，静态/装饰），组件级交互（Vue 组件、可执行逻辑、调 Rust）留待分发演进 Phase 2（与 §九 Phase 2 的运行时加载 Vue 模块方向一致）。

---

## 十四、许可证与版权（定稿）

- **项目整体：开源**。建议 GPLv3（对齐开源启动器社区惯例，且 Lighty 为 MIT，可自由内嵌）或 MIT（更宽松）。
- 内核 `LightyLauncherLib` 为 MIT，可直接商用/闭源，本开源项目无任何冲突。
- 不引入 GPL-3 的 Theseus 或任何传染性强的依赖。
