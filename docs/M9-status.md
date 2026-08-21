# M9 — 发布 runtime + 账号失效重登 + 插件管理（进行中）

> 目标：落地 M9 起点清单（见 `MikoLauncher-architecture.md` §十三）。
> 本轮完成 **M9-2 微软静默刷新失败后的重登录 UI**；其余项（发布 runtime 选型、
> 多账号快捷切换、插件管理 UI 完善、插件分发演进）仍待后续推进。

## 交付物

| 目标 | 改动 | 验证 |
|---|---|---|
| **微软静默刷新失败重登（M9-2）** | 契约：`account.refresh` + `needsReauth` 信号（shared）；Rust `account_refresh` command + `accounts.rs` `refresh_microsoft_account()`（只读检测，离线恒有效 / 微软静默刷新区分失效）；前端账号页挂载自动检测 + 失效「需重新登录」标记/原因/入口 + 手动「检查」按钮 | `--self-check ⑩` ✓；Rust 单测 ✓；`pnpm build` 全绿 ✓；clippy 零告警 ✓ |

## 设计要点

- **「失效」的可操作路径**：此前微软 refresh_token 过期时，启动仅返回笼统「认证失败…需要重新登录」，用户无入口。M9-2 把它变成显式、可操作的流程：
  - `account.refresh`（`{ id }` → `{ account, needsReauth, message? }`）对指定微软账号做一次静默刷新检测，`needsReauth` 结构化区分「仍有效」/「已失效」。
  - 账号页挂载时自动对各微软账号检测；失效账号显示醒目「需重新登录」badge + 失效原因 + 「重新登录」按钮（走设备流重授权）+ 每账号手动「检查」。
- **只读检测**：`refresh_microsoft_account` 不修改持久化状态（不写 access_token）；需要写时才由调用方决定 upsert。避免“每次打开账号页都覆盖凭据”的副作用。
- **重登后状态**：设备流登录成功即代表凭据新鲜，store 清除全部失效标记；`check()` 成功也清除该账号标记。
- **契约即代码**：`needsReauth` 走 `packages/shared` 的 `accountRefreshDataSchema`，前端用 `.parse()` 校验，防 Rust↔TS 漂移。

## 验证详情

### 1. `--self-check` ⑩（新增）
```
[self-check] ⑩账号检测(M9-2): 离线 SelfCheckReauth needsReauth=✓有效
```
- 离线账号恒「有效」（`needsReauth=false`），无 message；测试账号用完即删（不堆积）。

### 2. Rust 单测
```
test core::accounts::tests::refresh_offline_account_is_never_reauth ... ok
```
- 覆盖：不存在账号报错「账号不存在」；离线账号 `needsReauth=false`、`message=None`、类型正确。

### 3. 全构建
- `pnpm run build`：shared tsc ✓ / desktop `vue-tsc --noEmit` + vite ✓ / plugin-host esbuild ✓。
- `cargo check / clippy`：零告警；`cargo test`：2 通过。

## 相关文件
- `packages/shared/src/methods.ts`（`account.refresh` Method + params/data schema + registry）
- `apps/desktop/src-tauri/src/core/accounts.rs`（`refresh_microsoft_account()`）、`lib.rs`（`account_refresh` command + self-check ⑩）
- `apps/desktop/src/api/index.ts`（`refreshAccount`）、`stores/accounts.ts`（`check`/`isInvalidated`/`invalidated`）、`views/AccountsView.vue`（失效标记 + 重登/检查按钮 + 挂载自动检测）

## 尚未完成（M9 后续）
- **发布 runtime 选型落地**：定 pkg/bun 内嵌 或 内置运行时+externalBin，启用 `externalBin` 配置并跑通 `tauri build` 出安装包。
- **多账号快捷切换**：当前以「实例绑定账号」承载（InstancesView 每行账号下拉）；全局「默认账号」概念待定。
- **插件管理 UI 完善**：插件启用状态持久化到 `cordis.yml`-style 配置。
- **插件分发演进**：Phase 1/2（签名 + 验签 + 内建浏览）。
