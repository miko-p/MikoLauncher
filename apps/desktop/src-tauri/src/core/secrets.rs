//! OS keyring 存储（M7-2）—— 微软 refresh_token 的凭据落点。
//!
//! 目标：accounts.json 不再明文存微软凭据。refresh_token 存进 OS keyring：
//!   - Linux  → Secret Service（D-Bus，GNOME Keyring / KWallet）
//!   - macOS  → Keychain
//!   - Windows→ Credential Manager
//!
//! 采用「可选 feature」设计：未启用 `keyring` feature 或进程无可用 keyring
//! 会话（如无 D-Bus 的无头环境）时，存/取/删操作都安全回退到 accounts.json
//! 内置字段，对外 API 不变。
//!
//! keyring 条目约定：service = "miko-launcher:ms-refresh"，username = 账号 id。
//! `AccountEntry.keyring == true` 时，refresh_token 从 keyring 读，accounts.json
//! 里不存明文（写时空串）。

/// 读取刷新令牌。返回 `(bytes, had_keyring)`：
/// had_keyring=true 表示存在 keyring 条目可供删除。
#[cfg(feature = "keyring")]
fn entry(account_id: &str) -> Result<::keyring::Entry, String> {
    const SERVICE: &str = "miko-launcher:ms-refresh";
    ::keyring::Entry::new(SERVICE, account_id).map_err(|e| format!("keyring 条目创建失败: {e}"))
}

/// 把刷新令牌写入 OS keyring。写失败返回 Err（上层决定是否回退到内置字段）。
#[cfg(feature = "keyring")]
pub fn store_secret(account_id: &str, secret: &str) -> Result<(), String> {
    let e = entry(account_id)?;
    e.set_password(secret)
        .map_err(|e| format!("keyring 写失败: {e}"))
}

/// 从 OS keyring 读刷新令牌。无条目返回 Ok(None)。
#[cfg(feature = "keyring")]
pub fn read_secret(account_id: &str) -> Result<Option<String>, String> {
    let e = entry(account_id)?;
    match e.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(::keyring::Error::NoEntry) => Ok(None),
        // 平台凭据未找到（macOS/Windows 也可能返回这种）也视为无条目
        Err(::keyring::Error::PlatformFailure(_)) => Ok(None),
        Err(other) => Err(format!("keyring 读失败: {other}")),
    }
}

/// 从 OS keyring 删除刷新令牌。幂等：无条目视为成功。
#[cfg(feature = "keyring")]
pub fn delete_secret(account_id: &str) -> Result<(), String> {
    let e = entry(account_id)?;
    match e.delete_credential() {
        Ok(()) => Ok(()),
        Err(::keyring::Error::NoEntry) => Ok(()),
        Err(other) => Err(format!("keyring 删除失败: {other}")),
    }
}

// ---- 未启用 keyring 特性时的无操作回退（保证代码无条件编译） ----

#[cfg(not(feature = "keyring"))]
pub fn store_secret(_account_id: &str, _secret: &str) -> Result<(), String> {
    Err("keyring 特性未启用".into())
}

#[cfg(not(feature = "keyring"))]
pub fn read_secret(_account_id: &str) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(not(feature = "keyring"))]
pub fn delete_secret(_account_id: &str) -> Result<(), String> {
    Ok(())
}

/// 当前 build 是否启用 keyring 特性（供日志/状态展示）。
pub fn enabled() -> bool {
    cfg!(feature = "keyring")
}
