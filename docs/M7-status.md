# M7 — 账号横切 + UI 增强 + Phase 0 插件装载 ✅ 完成

> 目标：补齐 M6 遗留的账号横切（实例账号**持久化绑定** + 微软凭据**落 OS keyring**），
> 精修 NeoForge 版本匹配，增强下载页版本/loader 选择，并落地 **Phase 0 功能插件装载**（原 M3 顺延项）。

## 交付物

| 目标 | 改动 | 验证 |
|---|---|---|
| **实例账号绑定持久化** | 新增 `instance.updateAccount` 契约（shared）+ sidecar `InstanceManagerService.updateAccount`(SQLite `account_id`) + Rust `instance_update_account` command 转发 + 前端下拉直接持久化绑定 | pnpm build 全绿 ✓ |
| **微软凭据落 OS keyring** | 新增 `core/secrets.rs`（keyring crate: Linux Secret Service / macOS Keychain / Windows Credential Manager）+ `AccountEntry.keyring` 标记；refresh_token 存 keyring，accounts.json 不再存明文（无 keyring 会话安全回退）；删账号连带删 keyring 条目；Cargo `default=["keyring"]` | `--self-check ⑦` keyring 写→读→删往返✓ |
| **NeoForge 版本匹配精确化** | 改为官方命名规则的 `{minor}.{patch}.` 精确前缀（MC 1.21.4 ↔ NeoForge `21.4.x`），取代旧只按 `{minor}.` 的宽匹配 | ⑤ loader 解析：neoforge `21.1.248`(旧/错) → `21.4.157`(新/对) ✓ |
| **版本/loader 选择 UI 增强** | 下载页：类型分组 tabs(全部/正式版/快照) + 关键字搜索 + 每版本 loader 下拉「以此版本创建实例」 | vue-tsc + vite build 全绿 ✓ |
| **Phase 0 功能插件装载** | 新增 `services/plugin-manager.ts`：扫描 `plugins/*/`（`manifest.json`+`main.js`+hash）→ **hash 校验**(防篡改) → `ctx.plugin()` 挂 Cordis（空间可组合注入）；`plugin.disable` 走 `fiber.dispose()` 逆序回滚（时间可组合）；Rust `plugin.list/enable/disable` command + PluginsView UI；示例插件 `plugins/demo-greeter/` | `--self-check ⑧` demo-greeter 装载✓；RPC greeter.hello 往返✓ + disable 回滚✓ |

## 验证详情

### 1. 实例账号绑定持久化（端到端）
- `instance.updateAccount {id, accountId}` 真实写 SQLite `account_id`；`accountId` 传空解绑（启动回退离线 Player）。
- **前端行为变化**：实例页账号下拉改为显示**实例已绑定的**账号 (`inst.accountId`)，切换即持久化；启动不再临时指定账号，直接用实例绑定账号。

### 2. 微软凭据 OS keyring（`--self-check ⑦`）
```
⑦keyring: 特性=true → 写→读✓ 删✓ 残留=无 → 往返✓
```
- Linux 走 **Secret Service**（D-Bus）。无 D-Bus 会话时 `store_secret` 返回 Err → `set_ms_refresh_token` 自动回退 accounts.json 明文（
  不阻塞离线/微软流程）。删除账号同步 `delete_secret`（幂等）。
- **安全边界**：lighty-auth 的 `keyring` feature 只把 `access_token`（短命）路由进 keychain；我们自行用 keyring crate 把**长命 refresh_token** 存入 OS keyring，accounts.json 不再落明文 refresh_token。`access_token` 字段仍落 accounts.json（短命、M6 已从公开视图隐藏），可接受。

### 3. NeoForge 精确匹配（`--self-check ⑤`）
```
neoforge=21.4.157   // 之前为 21.1.248（误匹配 MC 1.21.1）
```
- 旧逻辑从前缀 `21.` 宽匹配，误命中其它 MC patch；新逻辑按官方命名（major=MC minor、minor=MC patch）取 `21.4.` 精确前缀，且延续「取时间递增列表最后项」避免字符串排序踩 `21.4.9 v 21.4.58`。

### 4. Phase 0 插件装载（功能插件走通 Cordis）
- **空间可组合**：`inject:['rustBridge']` 由 Cordis 自动注入，`ctx.rustBridge.on('greeter.hello',…)` 注册命令。
- **时间可组合**：`plugin.disable → fiber.dispose()` 逆序回滚 plugin 的 effect（handler 反注册）：
  ```
  [plugin-manager] 已卸载插件「demo-greeter」（effect 已全部回滚）
  [demo-greeter] 卸载：greeter.hello handler 已反注册
  ```
- **hash 校验**：manifest.hash(sha256 of main.js) 不一致 → 拒绝加载并告警。
- **扩展方法**：RustBridge 对非契约方法放开（有 handler 即放行），既保持核心方法严格 Zod，又给插件自定义方法留空间。
- 自检 `⑧插件(M7-5): count=1 [demo-greeter@hash✓[已装载]]`。

## 踩坑记录

1. **`ctx.effect` 用法**（示例插件初版踩坑）：`ctx.effect(() => off())` 会**立即执行** `off()`（回调本身即逆操作）；正确写法是把副作用放 effect 回调里、返回 cleanup：`ctx.effect(() => { const off = on(...); return () => off() })`。
2. **keyring 是运行时依赖不是构建依赖**：`cargo build/clippy/check` 不触发 D-Bus 连接，仅运行 `--self-check ⑦` 才连 Secret Service；无头 CI 编译不受影响。
3. **carco `default=["keyring"]`**：使真实应用默认用 keyring，同时保留 `--no-default-features` 可构建（回退 accounts.json）。
4. **`Service.ctx` 是 `protected`**：PluginManagerService 只能在自身方法内用 `this.ctx`；RustBridge 的 `handle` 增加 `dispatch()` 私有方法封装公共派发逻辑。

## 尚未完成（M8/后续起点）
- **主题/布局插件**：Phase 0 已覆盖功能插件；主题(CSS 变量) / 布局(Vue 组件/路由置换) 需前端注入点（components slot / theme.css 运行时加载），尚未落地。
- 插件市场 / 签名（Phase 1/2）—— 非当前范围，路线见 `MikoLauncher-architecture.md` §九。
- 微软账号**静默刷新失败后的重登录 UI**、多账号快捷切换（M6 遗留）。
- 自检每次运行会新建一个 `SelfCheckSMP` 实例且未清理，长期会堆积 —— 后续加清理。

## 相关文件
- `packages/shared/src/methods.ts`（instance.updateAccount 契约）
- `apps/plugin-host/src/services/instance-manager.ts` / `plugin-manager.ts`
- `apps/plugin-host/src/bridge/rust-bridge.ts`（扩展方法放行）
- `apps/desktop/src-tauri/src/core/secrets.rs`、`core/accounts.rs`、`core/launch.rs`、`lib.rs`
- `apps/desktop/src/views/DownloadView.vue`、`PluginsView.vue`、`InstancesView.vue`、`stores/plugins.ts`
- `plugins/demo-greeter/`（示例功能插件）
