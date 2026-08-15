# M6 — 账号体系 + 微软认证 ✅ 完成

> 目标：接入账号体系 —— **离线账号 + 微软 OAuth 设备流认证**，账号本地持久化，`instance.launch`
> 使用绑定账号（替代 M4/M5 的硬编码 `Player`）。

## 交付物

| 层 | 改动 | 验证 |
|---|---|---|
| **shared 契约** | `Account` 实体扩展（uuid/xuid/refreshToken/lastUsed）；新增 `account.*` 方法（list/loginOffline/loginMicrosoft/remove）+ `account:device-code` 事件 | pnpm build 全绿 ✓ |
| **Rust 内核** | 新增 `core/accounts.rs`：`AccountStore`（JSON 持久化到 `~/.local/share/miko-launcher/accounts.json`）、离线账号（lighty 稳定 UUID v5）、微软账号（`MicrosoftAuth` 设备流 + refresh token 静默刷新）、`AccountIdentity`→`UserProfile`；新增 4 个 account command；`instance.launch` 改从 payload/实例 accountId 取账号构建 launch 身份（替代硬编码 Player） | `--self-check ⑥` 全绿 ✓ |
| **微软认证** | client_id 从环境变量 `MIKO_MS_CLIENT_ID` 读取（需用户注册 Azure AD 公共客户端应用 + Mojang 批准），`device-code` 事件把 (code, url) 推给前端展示 | 待真实微软账号验证（前置：注册 client_id） |
| **前端** | 新增 `AccountsView.vue` 账号页（离线登录表单 / 微软登录按钮 + device-code 展示 / 账号列表 / 删除）、`accounts` store、路由；`InstancesView` 加启动账号下拉（默认/离线/微软账号） | pnpm build 全绿 ✓ |

## 验证详情

### 1. 账号全链路（`--self-check ⑥`）
```
⑥账号: 离线登录 SelfCheckUser(offline) →profile=SelfCheckUser → 列表 1 条 → 移除 ✓ → 剩 0 条
```
- **→profile=SelfCheckUser**：验证账号身份正确解析为 launch 用的 username（而非硬编码 Player）
- 读写删全链路 + JSON 持久化（`accounts.json` 落盘确认）

### 2. 持久化
`~/.local/share/miko-launcher/accounts.json` 真实写入（当前 `{}`，self-check 已清理测试账号）。

### 3. 启动用账号
`instance.launch` 优先 `payload.accountId` → 实例 `instance.accountId` → 回退离线 Player；离线走 `OfflineAuth::new(username)`，微软走 `MicrosoftAuth::authenticate_with_refresh_token`（静默刷新）。

## 踩坑记录

1. **目录重命名残留**：把项目从 `mc-launcher` 改名 `MikoLauncher` 后，`src-tauri/target` 里旧的构建缓存仍引用旧绝对路径，导致 `tauri-build` 报错（`failed to read plugin permissions ... mc-launcher/...`）。`rm -rf target` 重建即修复。
2. **lighty-auth 的 secrecy 由 `lighty_auth` re-export**：`lighty_auth::{ExposeSecret, SecretString}` 直接用，无需新增 dependency。
3. **`UserProfile.access_token` / provider 里的 refresh_token 是 `Option<SecretString>`**：用 `.expose_secret().to_string()` 取明文（`&str` 而非 `String`）。
4. **微软认证需要 Azure client_id**：`MicrosoftAuth` 设备流走真实 Microsoft/Xbox/MC 链路，必须合法 client_id（且 Mojang 批准才能调 MC token）；未配置时返回明确错误提示，不阻塞离线账号。
5. **`ensure_app_state()` 在 self-check 里不能用 `?`**（self_check 返回 String），需 `if let Err(e) = ... { return report }`。

## 尚未完成（M7/后续起点）
- **微软 account 绑定到实例持久化**：当前启动时从 payload 临时指定账号；正式把 accountId 持久化到实例（`instance.updateAccount` 之类）待接
- **微软 token 用 OS keyring 存储**（当前 accounts.json 明文，安全性 M6 已标注）
- **账号体系前端完善**：微软账号静默刷新失败后的重登录 UI、多账号切换快捷键
- **插件化 MVP**：Phase 0 插件装载 + 主题/布局/功能插件走 Cordis（已顺延）
