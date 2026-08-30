# M11 — 下载页重做：收进实例的 ➕ 弹窗（三选项入口）

> 目标：用户反馈下载页「要等抓版本清单才能加载完、且只做了无 mod 的情况」。决定把「下载」从独立导航页
> **移除**，收进**实例页的 ➕ 弹窗**，仿 Modrinth 新建弹窗给出三个来源选项：
> 1. 导入　2. 从模组包开始　3. 自定义。
> 本轮先把**弹窗三选项骨架**立起来；「导入」「从模组包开始」子流程后续实现。**自定义**做成
> 「手填版本 + 选加载器 → 点确定时校验该版本确实存在再创建」（不预抓清单，避免慢）。

## 为什么
- 下载页 `DownloadView.vue` 在 `onMounted` 立刻 `store.refresh()`（抓 Mojang 清单），打开即慢。
- 且只能建「无 mod」的原始实例，能力单一。
- 与 Modrinth/主流启动器对齐：新建实例的入口应统一到一个弹窗、按「从何而来」分三种，而不是独立页面。

## 交付物

| 目标 | 改动 | 验证 |
|---|---|---|
| **后端版本存在校验（version_check）** | `launch.rs` 把 `fetch_version_manifest` 拆出 `fetch_all_versions()`（**全量**清单、不取前 60）+ 新 `check_version_exists(id)`（在完整清单精确匹配 → 老版本如 1.8.9 也能验）；`lib.rs` 新 `version_check` command，返回 `{exists, version}`，注册进 invoke_handler | `cargo check` ✓ |
| **移除下载导航/路由/页面** | sidecar `ui-registry.ts` 的 `BUILTIN_VIEWS` 去掉 `download`（剩 home/instances/accounts/plugins 4 个）；`router/index.ts` 删 `/download` 路由；删除 `views/DownloadView.vue`；删 `stores/versions.ts`（唯一消费方 gone） | self-check ⑨ UI 无回归 ✓；`pnpm build` 无 DownloadView 引用 ✓ |
| **实例 ➕ 弹窗三选项（M11 核心）** | `InstancesView.vue` 重写：顶部「＋ 新建实例」→ 打开居中模态弹窗，`stage` 三阶段——`pick`（三选项卡片：导入/从模组包开始/自定义，单列纵排、图标+标题+简述）、`custom`（自定义表单）、`dev`（导入/模组包占位：提示开发中） | `pnpm build`（vue-tsc）✓ |
| **自定义：确定时校验版本** | `stores/instances.ts` 新 `addInstanceVerified(payload)`：先 `checkVersionExists`（api `checkVersionExists` → `version_check`），版本不存在返回失败原因、**不落库**；存在才 `createInstance`。UI 就地红字提示「版本 X 不存在」，成功关闭弹窗 | `pnpm build` ✓ |
| **回归** | cargo check/clippy + pnpm build + self-check 全绿 | 见下 |

## 设计要点
- **版本校验用完整清单，不用前 60**：`fetch_version_manifest` 只返回最新 60 个，若用它校验手填老版本会误判「不存在」。故拆出全量 `fetch_all_versions`，`check_version_exists` 在完整清单里精确匹配。清单是 Mojang 全量版本 JSON，本身就是全的。
- **弹窗三阶段 UI**：`stage: 'pick'|'custom'|'dev'`。`pick` 三选项大卡片（仿 Modrinth）；点「自定义」进 `custom`（实例名+版本+loader，底部「返回/确定」）；点「导入」或「从模组包开始」进 `dev` 占位（顶部返回 + 提示开发中）。
- **「自定义确定后才校验」**：不预抓清单（避免下载页那种打开即慢）。点确定 → `addInstanceVerified` 内联校验版本 → 就地反馈。
- **导入/模组包本轮只占位**：后端无实例导入接口、无 modpack 解析器，子流程留待 M11 后续。

## 验证详情
```
$ cargo check                  # Finished dev, 零告警（edition 误报是独立 lint 检查器没读 Cargo.toml，勿信）
$ cargo clippy --all-targets   # 零告警
$ pnpm run build               # shared + plugin-host + desktop(vue-tsc + vite) 全绿
$ HOME=/tmp/x cargo run -- --self-check
  ⑧插件 count=5 全 hash✓装载
  ⑨UI(theme=demo-theme layout[footer]=✓ 禁用↓回退 null 恢复✓)   # 移除 download 视图无回归
  ①/②/③ sidecar 读写正常
```

## 相关文件
- `apps/desktop/src-tauri/src/core/launch.rs`（`fetch_all_versions` / `check_version_exists`）
- `apps/desktop/src-tauri/src/lib.rs`（`version_check` command + invoke_handler）
- `apps/plugin-host/src/services/ui-registry.ts`（BUILTIN_VIEWS 去 download）
- `apps/desktop/src/router/index.ts`（删 `/download`）
- `apps/desktop/src/views/InstancesView.vue`（➕ 弹窗三选项 + 自定义表单）
- `apps/desktop/src/stores/instances.ts`（`addInstanceVerified`）
- `apps/desktop/src/api/index.ts`（`checkVersionExists`）
- 已删除：`apps/desktop/src/views/DownloadView.vue`、`apps/desktop/src/stores/versions.ts`

## 尚未完成（M11 后续）
- 「导入」：选本地已存在的 `.minecraft` 文件夹 / 实例目录 → 建实例。需后端实例导入接口（复制/软链目录 + 解析 version）。
- 「从模组包开始」：解析 `.mrpack`（Modrinth）/ `.zip`（CurseForge）模组包 → 下载依赖 + 建实例。需后端 modpack 解析器。
- 「自定义」可选加分：弹一层「从列表选版本」（懒加载清单）作为「手填」的补充。

---

## M11-2（追加）—— 实例页改「手机主屏式图标网格」+ 实例详情页

> 目标（用户语义）：像 Modrinth 一样，实例页所有实例做成「手机应用图标」样式的卡片网格——大正方形图标 + 名字。
> 未设自定义图标用**默认 MC 土方块 2D 占位**（本轮先用简化色块/SVG 占位，贴图后定）。
> 交互：点 **🚀 = 启动**；点**名字/图标以外 = 进实例详情**；卡片可**换自定义图标**（file input 选本地图 → base64）。

### 交付物

| 目标 | 改动 | 验证 |
|---|---|---|
| **InstanceSchema 加 icon 字段** | `shared/entities.ts` `InstanceSchema.icon?: string`（data-URI base64） | build shared ✓ |
| **DB 加 icon 列（安全迁移）** | `db.ts` migrate：`CREATE TABLE IF NOT EXISTS` 后 `PRAGMA table_info` 检查，缺则 `ALTER TABLE ADD COLUMN icon`（旧库升级保留数据） | 隔离脚本验证 MIGRATE_OK + 旧数据保留 ✓ |
| **sidecar 实例模型支持 icon** | `instance-manager.ts`：`InstanceRow.icon`、`rowToInstance`、`create` 写入、新 `updateIcon(id,icon)`（空串→清除回退占位） | build plugin-host ✓ |
| **注册 instance.updateIcon** | `builtin-instance.ts` 挂 `bridge.on('instance.updateIcon')` | — |
| **前端 updateIcon / remove 链路** | Rust 新 command `instance_update_icon`/`instance_remove`（转发 sidecar）；`api/index.ts` `updateInstanceIcon`/`removeInstance`；`stores/instances.ts` `setIcon`/`remove` | cargo check/clippy ✓ |
| **实例页图标网格卡片（M11-2 核心）** | `InstancesView.vue`：列表改 `repeat(auto-fill, minmax(118px,1fr))` 网格；每卡 = 大图标(`<img :src=icon>` 无则默认土块 SVG)+名字+`🚀`启动+`✎`换图标；点卡片空白/名字 → `/instances/:id`；`file input` 读 base64 → setIcon（>512KB 拒绝） | pnpm build(vue-tsc) ✓ |
| **默认土块占位图标** | 内置 `DIRT_ICON`（内联 SVG data-URI：三面土块明暗 + 颗粒斑点，占位用） | — |
| **实例详情页** | 新 `InstanceDetailView.vue` + 路由 `/instances/:id`：返回、大图标、名字、版本/loader/模组数 tags、创建时间、🚀启动、更换图标、删除(confirm)、启动账号绑定、模组列表 | pnpm build ✓ |

### 设计要点
- **图标存 data-URI**：前端 `<input type="file" accept="image/*">` → FileReader.readAsDataURL → base64 存 DB `icon` 列。**无需 rfd/tauri-plugin-dialog 依赖**（WebView 原生 file input 即可拿本地图 base64）。限制 >512KB 拒绝，避免撑爆 SQLite。
- **默认土块占位**：无 icon 时前端回退内联 SVG 土方块（用户本轮要「简单色块占位」，贴图资源后定）。详情页回退用 ⛏️ emoji。
- **DB 迁移关键**：`CREATE TABLE IF NOT EXISTS` 不给已有表加列 → 必须显式 `PRAGMA table_info` + `ALTER TABLE ADD COLUMN icon`，否则旧库启动即报「no such column: icon」。已隔离验证。
- **交互（用户明确）**：点 🚀 = 启动；点卡片空白/名字 = 进详情；✎ = 选图标。卡片 hover 微浮起。

### 验证
```
cargo check / clippy --all-targets   零告警
pnpm run build                       全绿（73→76 modules，含 InstanceDetailView）
HOME=/tmp/x cargo run -- --self-check ⑧⑨⑩ + ①/②/③ sidecar 读写正常；②create 返回实例无 icon(None 省略) 前端 optional 通过
一次性 node 脚本验证旧库 ALTER 补 icon 列 MIGRATE_OK + 旧数据保留
```

---

## M11-3（追加）—— 修复「实例运行中启动器崩溃卡死」+ 启动状态列

> 症状（用户实测）：只要实例运行，启动器就崩溃/没反应；启动时报 `invalid_type expected number/string/array received undefined at pid/javaVersion/jvmArgs`；第二次启动实例无反应。

### 根因（两处叠加）
1. **崩溃卡死**：`instance_launch` 是**同步 command**，内部 `std::thread::spawn(...).join()` 阻塞到**游戏退出**才返回
   ——`launch_game`（lighty run future）一直跑满整个游戏生命周期。同步 command + `block_on().join()` 长时间占用
   Tauri 的 command worker 线程 → 游戏运行期间 UI 事件循环调度被占 → 「崩溃/没反应」。这正是 skill 反复点名的坑
   （「长轮询/阻塞型 command 必须 async，勿在同步 command 里 spawn().join()」）——**但 instance_launch 一直踩着没被发现**，
   因为此前从没在游戏真正运行期间操作过 UI。
2. **启动报 zod 错 + 第二次无反应**：launch 非阻塞化后返回值不再是 `{pid,javaVersion,jvmArgs}`，前端老 schema 校验挂；
   且后端 running 表防重复启动，第一次失败但后端已在跑 → 第二次被拒「该实例已在运行」（前端没显示 → 无反应）。

### 修复（M11-3）
- **`instance_launch` 非阻塞化**：不 `join()` 等退出。校验后把 `running[id]=0` 入表（防重复启动），开**独立后台线程**跑
  `launch_game`（自带 tokio runtime，不 join），**command 立即返回 `{started, instanceId}`**。游戏生命周期状态经
  **新事件 `launch:status`** 推前端：`started`（拿到 pid 时，用 `LaunchContext.with_on_launched` 回调触发）、
  `exit`（游戏退出）、`error`（启动/运行失败）。游戏线程结束清 `running` 表（Rust 端 `AppState.running:
  Arc<Mutex<HashMap<instanceId,pid>>>`）。
- **新增 `launch_status` command**：返回当前 running 表，供前端挂载时恢复状态列。
- **契约更新**：`instanceLaunchDataSchema` → `{started: boolean, instanceId: string}`（不再含 pid/javaVersion/jvmArgs，
  那些经事件推送）。前端 `launchInstance`/`store.launch` 同步；`store` 加 `running`/`isRunning`/`refreshLaunchStatus`/
  `initLaunchEvents()`（监听 launch:status 维护 running）。
- **启动按钮**：🚀 由 `store.isRunning(id)` 置灰（运行中显示 ⟳），杜绝重复启动。
- **底部状态列（用户要求）**：`App.vue` 内容区底部加**圆角长条视窗** `.run-status`（蓝底圆角长条），v-for 运行中实例
  显示 ● 状态点 + 实例名 + 「启动中…」/「运行中 · PID n」。全局监听，切页也在。

### 验证
```
cargo check / clippy --all-targets   零告警
pnpm run build                       全绿（契约+状态列+playwright 无）
--self-check ⑧⑨⑩ + ①/②/③ sidecar 读写正常（⑧⑨⑩ 不受 launch 改动影响）
```
> 注：真实启动崩溃的根治需用户实机重测——启动后 UI 应不再卡死、下方出现状态列、运行中按钮置灰、游戏退出后状态列消失且可再次启动。
