//! AccountService —— 账号体系（Rust 内核，对应蓝图「五、数据」的 Account）。
//!
//! 职责：
//!   - 本地持久化账号（离线 + 微软），存于 AppState data_dir 的 accounts.json
//!   - 离线账号：随时创建（离线 UUID v5 稳定）
//!   - 微软账号：OAuth 设备流登录（device code 推给前端），存 refresh_token 供静默刷新
//!   - 为 launch 提供凭据（launch 时离线直发 OfflineAuth / 微软走 refresh 静默刷新）
//!
//! 安全（M7-2）：微软 refresh_token 优先存 OS keyring（Secret Service/Keychain/Credential Manager），
//!   accounts.json 不落明文；仅在未启用 keyring feature 或无可用 keyring 会话时回退到该文件。
//!   账号文件本身权限收紧为 0600。access_token（短期有效）/xuid 等非长期凭据仍存于该文件。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use lighty_auth::offline::OfflineAuth;
use lighty_auth::{generate_offline_uuid, Authenticator};
// secrecy 由 lighty_auth 转发导出
use lighty_auth::{ExposeSecret, SecretString};

/// 账号类型（对齐 shared AccountSchema 的 type）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccountType {
    Offline,
    Microsoft,
}

/// 持久化账号条目。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountEntry {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub account_type: AccountType,
    /// 微软 MC access_token（离线空串；不导出给前端）
    #[serde(default)]
    pub access_token: String,
    /// 微软 refresh_token（离线空）；`keyring == true` 时存 OS keyring，此字段为空
    #[serde(default)]
    pub refresh_token: String,
    /// 微软 xuid（离线空）
    #[serde(default)]
    pub xuid: String,
    /// 最后使用时间 ISO8601
    #[serde(default)]
    pub last_used: String,
    /// M7-2：refresh_token 是否存于 OS keyring（accounts.json 不存明文）
    #[serde(default)]
    pub keyring: bool,
}

impl AccountEntry {
    /// 转成 JSON（给前端 account.list；隐藏 refresh_token）
    pub fn to_public_json(&self) -> Value {
        serde_json::json!({
            "id": self.id,
            "name": self.name,
            "type": match self.account_type {
                AccountType::Offline => "offline",
                AccountType::Microsoft => "microsoft",
            },
            "accessToken": "",
            "refreshToken": "",
            "xuid": self.xuid,
            "lastUsed": self.last_used,
        })
    }

    /// 读取本账号的微软 refresh_token：keyring 优先，回退内置字段。
    /// 离线账号返回空串。
    pub fn ms_refresh_token_in(&self) -> String {
        if self.account_type != AccountType::Microsoft {
            return String::new();
        }
        if self.keyring {
            crate::core::secrets::read_secret(&self.id)
                .ok()
                .flatten()
                .unwrap_or_else(|| {
                    eprintln!(
                        "[miko-launcher] keyring 读取失败或已删除，回退到 accounts.json 内置（如有）"
                    );
                    self.refresh_token.clone()
                })
        } else {
            self.refresh_token.clone()
        }
    }

    /// 把 refresh_token 写入存储（keyring 生效时优先），并同步 keyring 标记。
    pub fn set_ms_refresh_token(&mut self, token: String) {
        if token.is_empty() {
            self.refresh_token.clear();
            self.keyring = false;
            return;
        }
        // 优先 OS keyring；失败（feature 关闭 / 无 D-Bus）回退 accounts.json 明文
        match crate::core::secrets::store_secret(&self.id, &token) {
            Ok(()) => {
                self.refresh_token.clear();
                self.keyring = true;
            }
            Err(e) => {
                eprintln!("[miko-launcher] keyring 存失败，回退 accounts.json 明文: {e}");
                self.refresh_token = token;
                self.keyring = false;
            }
        }
    }
}

/// launch 用的凭据身份（不含存储；lighty 认证重建用）
#[derive(Debug, Clone)]
pub enum AccountIdentity {
    Offline { username: String },
    Microsoft { client_id: String, refresh_token: String },
}

/// 线程安全的账号存储。
pub struct AccountStore {
    path: std::path::PathBuf,
    /// id -> entry
    inner: Arc<Mutex<HashMap<String, AccountEntry>>>,
}

const ACCOUNT_FILE: &str = "accounts.json";

impl AccountStore {
    /// 打开/创建账号存储（路径 = AppState data_dir 下 accounts.json）。
    pub fn open() -> Result<Self, String> {
        let dir = lighty_core::AppState::data_dir().to_path_buf();
        let path = dir.join(ACCOUNT_FILE);
        // 读取已有账号
        let existing: HashMap<String, AccountEntry> = match std::fs::read_to_string(&path) {
            Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
            Err(_) => HashMap::new(),
        };
        let store = AccountStore {
            path,
            inner: Arc::new(Mutex::new(existing)),
        };
        // 确保目录存在
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建账号目录失败: {e}"))?;
        store.save()?;
        Ok(store)
    }

    fn save(&self) -> Result<(), String> {
        let data = {
            let guard = self.inner.lock().unwrap();
            serde_json::to_string_pretty(&*guard).map_err(|e| format!("序列化账号失败: {e}"))?
        };
        std::fs::write(&self.path, data).map_err(|e| format!("写入账号文件失败: {e}"))?;
        // 凭据文件仅当前用户可读写（本机其他用户不可读）。
        #[cfg(unix)]
        self.restrict_file_permissions();
        Ok(())
    }

    /// 把账号文件权限收紧为 0600（仅 owner 可读写）。
    /// macOS/Linux 下 accounts.json 含账号凭据，不应允许本机其他用户读取。
    #[cfg(unix)]
    fn restrict_file_permissions(&self) {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o600));
    }

    /// 全部账号（按最后使用时间倒序），转公开 JSON 数组。
    pub fn list_json(&self) -> Vec<Value> {
        let mut accounts: Vec<AccountEntry> = {
            let guard = self.inner.lock().unwrap();
            guard.values().cloned().collect()
        };
        accounts.sort_by(|a, b| b.last_used.cmp(&a.last_used));
        accounts.iter().map(|a| a.to_public_json()).collect()
    }

    /// 按 id 取账号。
    pub fn get(&self, id: &str) -> Option<AccountEntry> {
        self.inner.lock().unwrap().get(id).cloned()
    }

    /// 新增/更新账号并落盘；更新 last_used。
    pub fn upsert(&self, entry: AccountEntry) -> Result<AccountEntry, String> {
        let mut guard = self.inner.lock().unwrap();
        guard.insert(entry.id.clone(), entry.clone());
        drop(guard);
        self.save()?;
        Ok(entry)
    }

    /// 删除账号；返回是否删除成功。若该账号 refresh_token 存于 keyring，一并删除。
    pub fn remove(&self, id: &str) -> Result<bool, String> {
        let (removed, was_keyring) = {
            let mut guard = self.inner.lock().unwrap();
            let existed = guard.get(id).cloned();
            let removed = guard.remove(id).map(|_| ()).is_some();
            (removed, existed.map(|e| e.keyring).unwrap_or(false))
        };
        if removed {
            self.save()?;
            // M7-2：微软账号若用 keyring 存 refresh_token，删除账号时一并清理
            if was_keyring {
                let _ = crate::core::secrets::delete_secret(id);
            }
        }
        Ok(removed)
    }

    /// 记忆使用：更新 last_used。
    pub fn touch(&self, id: &str) {
        let ts = chrono_now();
        let mut guard = self.inner.lock().unwrap();
        if let Some(e) = guard.get_mut(id) {
            e.last_used = ts;
        }
        drop(guard);
        let _ = self.save();
    }
}

// 当前 UTC 时间戳（ISO8601，毫秒精度；用 chrono 保证真实年月日，供排序与展示。）
fn chrono_now() -> String {
    use chrono::{SecondsFormat, Utc};
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// 创建离线账号（返回账号条目；不落盘，调用方决定 upsert）。
pub fn create_offline_account(name: &str) -> Result<AccountEntry, String> {
    if name.len() < 3 || name.len() > 16 {
        return Err("离线用户名需 3-16 位".into());
    }
    let uuid = generate_offline_uuid(name); // 与 lighty 一致的稳定 UUID v5
    Ok(AccountEntry {
        id: uuid,
        name: name.to_string(),
        account_type: AccountType::Offline,
        access_token: String::new(),
        refresh_token: String::new(),
        xuid: String::new(),
        last_used: chrono_now(),
        keyring: false,
    })
}

/// 离线登录：创建并落盘（若已存在同名则返回已有）。
pub fn login_offline(store: &AccountStore, name: &str) -> Result<AccountEntry, String> {
    let entry = create_offline_account(name)?;
    // 若同名账号已存在，直接返回它（避免重复）
    let existing = {
        let guard = store.inner.lock().unwrap();
        guard
            .values()
            .find(|a| a.name == entry.name && a.account_type == AccountType::Offline)
            .cloned()
    };
    if let Some(e) = existing {
        store.touch(&e.id);
        return Ok(e);
    }
    store.upsert(entry.clone())?;
    Ok(entry)
}

fn default_ms_client_id() -> Result<String, String> {
    std::env::var("MIKO_MS_CLIENT_ID").map_err(|_| {
        "未配置微软 client_id：请注册 Azure AD 公共客户端应用（获得 Mojang 批准），\
         并设置环境变量 MIKO_MS_CLIENT_ID".to_string()
    })
}

/// 微软账号设备流登录（阻塞直到用户在浏览器授权）。
/// `emit_device_code` 回调把 (code, verification_uri) 推给前端展示。
/// 返回微软账号条目（含 refresh_token，可用于后续静默刷新）。
pub async fn login_microsoft<F>(emit_device_code: F) -> Result<AccountEntry, String>
where
    F: Fn(&str, &str) + Send + Sync + 'static,
{
    let client_id = default_ms_client_id()?;
    let mut auth = lighty_auth::microsoft::MicrosoftAuth::new(client_id.clone());
    auth.set_device_code_callback(move |code, url| emit_device_code(code, url));

    let profile = auth.authenticate(None::<&lighty_event::EventBus>).await.map_err(|e| {
        format!("微软认证失败: {e}")
    })?;

    // 从 UserProfile 提取凭据
    let refresh_token = match &profile.provider {
        lighty_auth::AuthProvider::Microsoft { refresh_token, .. } => {
            ref_to_string(refresh_token)
        }
        _ => String::new(),
    };

    // M7-2：把 refresh_token 优先写入 OS keyring（feature 关闭/无 D-Bus 时回退 accounts.json 明文）
    let mut entry = AccountEntry {
        id: profile.uuid,
        name: profile.username,
        account_type: AccountType::Microsoft,
        access_token: token_to_string(&profile.access_token),
        refresh_token: String::new(),
        xuid: profile.xuid.unwrap_or_default(),
        last_used: chrono_now(),
        keyring: false,
    };
    entry.set_ms_refresh_token(refresh_token);
    Ok(entry)
}

/// 用微软 refresh_token 静默刷新，返回新的 UserProfile（供 launch）。
pub async fn refresh_microsoft_identity(
    client_id: &str,
    refresh_token: &str,
) -> Result<lighty_auth::UserProfile, String> {
    let mut auth = lighty_auth::microsoft::MicrosoftAuth::new(client_id.to_string());
    let secret = SecretString::from(refresh_token.to_string());
    auth.authenticate_with_refresh_token(&secret, None::<&lighty_event::EventBus>)
        .await
        .map_err(|e| format!("微软 refresh 失败（可能已过期，需重新登录）: {e}"))
}

/// 根据账号构建 launch 用的身份（离线直发 / 微软尝试静默刷新）。
/// 返回 launch 可直接用的 lighty UserProfile。
pub async fn identity_to_profile(identity: &AccountIdentity) -> Result<lighty_auth::UserProfile, String> {
    match identity {
        AccountIdentity::Offline { username } => {
            let mut auth = OfflineAuth::new(username.clone());
            auth.authenticate(None::<&lighty_event::EventBus>)
                .await
                .map_err(|e| format!("离线认证失败: {e}"))
        }
        AccountIdentity::Microsoft { client_id, refresh_token } => {
            refresh_microsoft_identity(client_id, refresh_token).await
        }
    }
}

// util: AccountIdentity 从存储 entry 构建
impl AccountEntry {
    /// 该账号对应的 launch 身份（微软需 client_id 配置）。
    pub fn to_identity(&self) -> Result<AccountIdentity, String> {
        match self.account_type {
            AccountType::Offline => Ok(AccountIdentity::Offline {
                username: self.name.clone(),
            }),
            AccountType::Microsoft => {
                let client_id = default_ms_client_id()?;
                // M7-2：refresh_token 从 OS keyring 读（无则回退内置字段）
                Ok(AccountIdentity::Microsoft {
                    client_id,
                    refresh_token: self.ms_refresh_token_in(),
                })
            }
        }
    }
}

// secrecy SecretString <-> String
fn ref_to_string(s: &Option<SecretString>) -> String {
    s.as_ref().map(|x| x.expose_secret().to_string()).unwrap_or_default()
}
fn token_to_string(s: &Option<SecretString>) -> String {
    s.as_ref().map(|x| x.expose_secret().to_string()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::chrono_now;

    #[test]
    fn chrono_now_is_valid_iso8601_utc() {
        let s = chrono_now();
        let b = s.as_bytes();
        // YYYY-MM-DDTHH:MM:SS.mmmZ（至少 24 字符）
        assert!(s.len() >= 24, "date too short: {s}");
        assert_eq!(b[4], b'-', "year-month sep");
        assert_eq!(b[7], b'-', "month-day sep");
        assert_eq!(b[10], b'T', "date-time sep");
        assert_eq!(b[13], b':', "hour-minute sep");
        assert_eq!(b[16], b':', "minute-second sep");
        assert!(s.ends_with('Z'), "should be UTC (Z suffix): {s}");
        // 年份应是公历合理范围（而非自 1970 的天数这类伪日期）
        let year: i32 = s[0..4].parse().expect("4-digit year");
        assert!((2000..2100).contains(&year), "year out of range: {year}");
    }
}
