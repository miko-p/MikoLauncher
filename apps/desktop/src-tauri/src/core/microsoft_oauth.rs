//! Microsoft OAuth —— **授权码流（Authorization Code Flow + 弹系统浏览器）**。
//!
//! 目的：实现 PCL 式微软登录 —— 点「用 Microsoft 账号登录」后在系统浏览器打开微软登录页，
//! 用户在微软页面输账号密码完成授权，再把授权后地址栏里含 `code` 的 URL 粘回启动器，
//! 本模块即完成剩余交换：code → Microsoft token → Xbox → XSTS → Minecraft token → profile。
//!
//! 为什么用 `login.live.com`（老 Live OAuth20）而不是 `login.microsoftonline.com`（v2.0）：
//!  v2.0 端点的 device-code / 授权码流都要求一个**已注册的 Entra 应用 client id**（HMCL/PCL 各自
//!  注册内置，否则报 700016「client not found」）。而 **`login.live.com` 老 OAuth20 端点接受微软官方
//!  Minecraft Launcher 的公共 client id `00000000402b5328`**（实测 authorize 返回登录页，无 AADSTS 错误）
//!  且它是官方提供的、无需用户注册。redirect 同样用官方桌面向 `https://login.live.com/oauth20_desktop.srf`
//! （实测其它 redirect 如 loopback 会被拒：invalid_request）。
//!
//! 已验证（curl 实测）：
//!  - `login.live.com/oauth20_authorize.srf?client_id=00000000402b5328&response_type=code&
//!    scope=XboxLive.signin%20offline_access&redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf`
//!    → HTTP 200 + 登录表单（说明 client id 被接受、能弹登录页）
//!  - redirect_uri 换成 `http://127.0.0.1:PORT/cb` → `invalid_request: redirect_uri is not valid`（被拒）
//!
//! 说明：因 redirect 落在 live.com 域（非 loopback），浏览器授权后无法自动跳回本地，
//! 采用「用户把地址栏含 code 的 URL 粘回启动器」的经典做法（PCL 老式流程；可靠且免注册）。

use serde::Deserialize;
use serde_json::Value;
use std::time::Duration;

use crate::core::accounts::{chrono_now, AccountEntry, AccountType};

/// 微软官方 Minecraft 启动器的公共 client id（login.live.com 老 OAuth20 端点接受，Mojang/Microsoft 提供）。
const OFFICIAL_CLIENT_ID: &str = "00000000402b5328";
/// 官方桌面流 redirect（必须用这个，client id 预注册；换其它会被拒）。
const REDIRECT_URI: &str = "https://login.live.com/oauth20_desktop.srf";
const SCOPE: &str = "XboxLive.signin offline_access";

const AUTHORIZE_URL: &str = "https://login.live.com/oauth20_authorize.srf";
const TOKEN_URL: &str = "https://login.live.com/oauth20_token.srf";
const XBOX_AUTH_URL: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH_URL: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_AUTH_URL: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE_URL: &str = "https://api.minecraftservices.com/minecraft/profile";

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("MikoLauncher/0.1 (microsoft oauth) miko-launcher")
        .timeout(Duration::from_secs(30))
        .build()
        .expect("build reqwest client")
}

/// 生成微软登录 URL（前端/系统浏览器打开它）。返回 (url, redirect_uri)。
pub fn authorize_url() -> (String, String) {
    let url = format!(
        "{AUTHORIZE_URL}?client_id={OFFICIAL_CLIENT_ID}&response_type=code&scope={}&redirect_uri={}",
        urlencoding_scope(SCOPE),
        urlencoding_scope(REDIRECT_URI),
    );
    (url, REDIRECT_URI.to_string())
}

/// 把变量放入 URL query（简单百分号编码，覆盖空格与保留字符）。
fn urlencoding_scope(s: &str) -> String {
    // 只需要编码空格(→+)、:、/、?、&、= 等；用 tiny 实现避免额外依赖 urlencoding crate
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.bytes() {
        match b {
            b' ' => out.push('+'),
            b':' | b'/' | b'?' | b'&' | b'=' | b'%' | b'#' | b'+' => {
                out.push('%');
                out.push_str(&format!("{:02X}", b));
            }
            _ => out.push(b as char),
        }
    }
    out
}

/// 从用户粘贴的「完整 URL 或裸 code」里提取 authorization code。
/// 支持：整段 `https://login.live.com/oauth20_desktop.srf?code=xxx&lc=...` 或裸 `xxx`。
pub fn extract_code(s: &str) -> Result<String, String> {
    let s = s.trim();
    if s.is_empty() {
        return Err("请粘贴浏览器地址栏中授权后的完整 URL（含 code=… ）或直接粘贴 code。".into());
    }
    // 若含 code= 参数则提取
    if let Some(q) = s.split('?').nth(1) {
        for pair in q.split('&') {
            if let Some(v) = pair.strip_prefix("code=") {
                if !v.is_empty() {
                    return Ok(v.to_string());
                }
            }
        }
    }
    // 否则当作裸 code
    Ok(s.to_string())
}

/// 把 authorization code 换成 Microsoft access_token + refresh_token（老 live token 端点）。
#[derive(Deserialize)]
struct LiveTokenResponse {
    access_token: String,
    #[serde(rename = "refresh_token")]
    refresh_token: Option<String>,
    // 错误情况
    error: Option<String>,
    #[serde(rename = "error_description")]
    error_description: Option<String>,
}

async fn exchange_code(code: &str, redirect_uri: &str) -> Result<(String, String), String> {
    let resp = client()
        .post(TOKEN_URL)
        .form(&[
            ("client_id", OFFICIAL_CLIENT_ID),
            ("redirect_uri", redirect_uri),
            ("grant_type", "authorization_code"),
            ("code", code),
            ("scope", SCOPE),
        ])
        .send()
        .await
        .map_err(|e| format!("请求微软 token 端点失败: {e}"))?;

    let status = resp.status();
    let body = resp.text().await.map_err(|e| format!("读取 token 响应失败: {e}"))?;
    let parsed: Result<LiveTokenResponse, _> = serde_json::from_str(&body);
    match parsed {
        Ok(t) => {
            if let Some(err) = t.error {
                return Err(format!(
                    "微软拒绝授权码: {} {}",
                    err,
                    t.error_description.unwrap_or_default()
                ));
            }
            Ok((t.access_token, t.refresh_token.unwrap_or_default()))
        }
        Err(_) => {
            if status.is_success() {
                Err(format!("token 响应无法解析: {body}"))
            } else {
                Err(format!("token 交换失败 (HTTP {status}): {body}"))
            }
        }
    }
}

// ---- 以下 MC 认证链照抄 lighty-auth microsoft.rs 的端点协议（token 链各步） ----

#[derive(Deserialize)]
struct XboxTokenResponse {
    token: String,
    #[serde(rename = "display_claims")]
    display_claims: Option<Value>,
}

async fn get_xbox_token(ms_token: &str) -> Result<XboxTokenResponse, String> {
    let body = serde_json::json!({
        "Properties": {
            "AuthMethod": "RPS",
            "SiteName": "user.auth.xboxlive.com",
            "RpsTicket": format!("d={ms_token}")
        },
        "RelyingParty": "http://auth.xboxlive.com",
        "TokenType": "JWT"
    });
    let resp = client().post(XBOX_AUTH_URL).json(&body).send().await
        .map_err(|e| format!("Xbox 认证失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Xbox 认证返回非成功状态: {}", resp.status()));
    }
    resp.json::<XboxTokenResponse>().await.map_err(|e| format!("解析 Xbox 响应失败: {e}"))
}

async fn get_xsts_token(xbox_token: &str) -> Result<XboxTokenResponse, String> {
    let body = serde_json::json!({
        "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbox_token] },
        "RelyingParty": "rp://api.minecraftservices.com/",
        "TokenType": "JWT"
    });
    let resp = client().post(XSTS_AUTH_URL).json(&body).send().await
        .map_err(|e| format!("XSTS 认证失败: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取 XSTS 响应失败: {e}"))?;
    if !status.is_success() {
        if text.contains("2148916233") {
            return Err("该 Microsoft 账号未拥有 Minecraft".into());
        }
        if text.contains("2148916238") {
            return Err("此账号所在地区/状态不支持 Xbox Live（儿童号需加入家庭组）".into());
        }
        return Err(format!("XSTS 认证失败 ({status}) : {text}"));
    }
    serde_json::from_str::<XboxTokenResponse>(&text)
        .map_err(|e| format!("解析 XSTS 响应失败: {e}"))
}

async fn get_minecraft_token(xsts_token: &str, uhs: &str) -> Result<String, String> {
    let body = serde_json::json!({
        "identityToken": format!("XBL3.0 x={uhs};{xsts_token}")
    });
    let resp = client().post(MC_AUTH_URL).json(&body).send().await
        .map_err(|e| format!("Minecraft token 认证失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Minecraft token 认证返回非成功 (HTTP {})", resp.status()));
    }
    let v = resp.json::<Value>().await.map_err(|e| format!("解析 MC token 响应失败: {e}"))?;
    v.get("access_token")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "MC token 响应缺少 access_token".into())
}

async fn get_minecraft_profile(mc_token: &str) -> Result<(String, String), String> {
    // 返回 (uuid, name)
    let resp = client()
        .get(MC_PROFILE_URL)
        .header("Authorization", format!("Bearer {mc_token}"))
        .send()
        .await
        .map_err(|e| format!("获取 Minecraft profile 失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("获取 Minecraft profile 返回非成功 (HTTP {})", resp.status()));
    }
    let v = resp.json::<Value>().await.map_err(|e| format!("解析 profile 失败: {e}"))?;
    let id = v.get("id").and_then(|x| x.as_str()).unwrap_or_default().to_string();
    let name = v.get("name").and_then(|x| x.as_str()).unwrap_or_default().to_string();
    Ok((id, name))
}

/// 从 MC access_token 的 JWT 提取 xuid（抄 lighty 的简化做法：不验签但校验 alg∈{RS256,HS256}）。
fn decode_xuid_from_jwt(token: &str) -> Option<String> {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    let mut parts = token.split('.');
    let header_b64 = parts.next()?;
    let payload_b64 = parts.next()?;
    // 校验 alg 不在白名单则拒绝（防伪造 token 用异类算法）—— lighty 相同策略
    if let Ok(hdr) = URL_SAFE_NO_PAD.decode(header_b64) {
        if let Ok(v) = serde_json::from_slice::<Value>(&hdr) {
            let alg = v.get("alg").and_then(|x| x.as_str()).unwrap_or_default();
            if alg != "RS256" && alg != "HS256" {
                return None;
            }
        }
    }
    let payload = URL_SAFE_NO_PAD.decode(payload_b64).ok()?;
    let v: Value = serde_json::from_slice(&payload).ok()?;
    v.get("xuid").and_then(|x| x.as_str()).map(|s| s.to_string())
}

/// 把微软 access_token 走 MC 令牌链，构造账号条目（与设备流 login_microsoft 产出同构）。
async fn finalize_mc_profile(ms_token: &str, refresh_token: &str) -> Result<AccountEntry, String> {
    let xbox = get_xbox_token(ms_token).await?;
    let xsts = get_xsts_token(&xbox.token).await?;
    let uhs = xsts
        .display_claims
        .as_ref()
        .and_then(|c| c.get("xui"))
        .and_then(|xui| xui.get(0))
        .and_then(|u| u.get("uhs"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "XSTS 响应缺少 UHS".to_string())?;
    let mc_token = get_minecraft_token(&xsts.token, uhs).await?;
    let xuid = decode_xuid_from_jwt(&mc_token).unwrap_or_default();
    let (uuid, name) = get_minecraft_profile(&mc_token).await?;
    if uuid.is_empty() {
        return Err("无法获取 Minecraft profile（该账号可能有正版但未设置角色，或未拥有正版）".into());
    }

    let mut entry = AccountEntry {
        id: uuid,
        name,
        account_type: AccountType::Microsoft,
        access_token: mc_token,
        refresh_token: String::new(),
        xuid,
        last_used: chrono_now(),
        keyring: false,
    };
    entry.set_ms_refresh_token(refresh_token.to_string());
    Ok(entry)
}

/// 给用户的「登录中状态」文案（弹浏览器后展示引导）。
pub struct LoginSession {
    pub url: String,
    pub redirect_uri: String,
}

/// 生成登录会话（不执行任何网络请求；前端/系统打开 url，用户授权后粘回 code URL）。
pub fn create_login_session() -> LoginSession {
    let (url, redirect_uri) = authorize_url();
    LoginSession { url, redirect_uri }
}

/// 用户粘回含 code 的 URL/裸 code → 完成完整微软登录，返回账号条目。
pub async fn finish_login(code_or_url: &str) -> Result<AccountEntry, String> {
    let code = extract_code(code_or_url)?;
    let (ms_token, refresh_token) = exchange_code(&code, REDIRECT_URI).await?;
    eprintln!("[ms-oauth] code exchange 成功（access_token 长度 {}）", ms_token.len());
    finalize_mc_profile(&ms_token, &refresh_token).await
}

/* ------------------------------------------------------------------ *
 *  PCL 式全自动登录（自注册公共应用 + v2.0 loopback 回跳）               *
 *  客户端先起本地 TcpListener(127.0.0.1:PORT)，弹系统浏览器到 v2.0       *
 *  authorize URL（redirect 指 localhost:PORT），用户授权后浏览器自动    *
 *  回跳到本地，捕获 URL 里的 code，自动完成登录。全程无需手动粘 URL。     *
 *                                                                     *
 *  前置：需在 MIKO_MS_CLIENT_ID 配置一个「已注册 v2.0 公共应用」的       *
 *   Application(client) ID，并在其 Azure App 注册 `http://localhost:PORT/cb`*
 *  作为 redirect URI。                                                  *
 * ------------------------------------------------------------------ */
const V2_AUTHORIZE_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
const V2_TOKEN_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
/// loopback 端口（redirect 需与 Azure App 注册一致）
pub const LOOPBACK_PORT: u16 = 5599;

/// 生成 v2.0 loopback 授权 URL（redirect 指向本地端口）。
pub fn loopback_authorize_url(client_id: &str) -> String {
    format!(
        "{V2_AUTHORIZE_URL}?client_id={}&response_type=code&scope={}&redirect_uri={}&response_mode=query",
        urlencoded(client_id),
        urlencoded(SCOPE),
        urlencoded(&loopback_redirect()),
    )
}

/// 用户授权后浏览器回跳到的本地 redirect（须与 Azure App 注册一致）。
fn loopback_redirect() -> String {
    format!("http://127.0.0.1:{}/cb", LOOPBACK_PORT)
}

/// 百分号编码单个字符串（覆盖空格与保留字符）。
fn urlencoded(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.bytes() {
        match b {
            b' ' => out.push('+'),
            b':' | b'/' | b'?' | b'&' | b'=' | b'%' | b'#' | b'+' | b'@' => {
                out.push('%');
                out.push_str(&format!("{:02X}", b));
            }
            _ => out.push(b as char),
        }
    }
    out
}

/// 从浏览器回跳的 HTTP 请求行里提取 `code` 参数（GET /cb?code=xxx HTTP/1.1）。
fn parse_code_from_request_line(line: &str) -> Option<String> {
    // "GET /cb?code=xxx&lc=... HTTP/1.1"
    let path = line.split_whitespace().nth(1)?;
    let q = path.split('?').nth(1)?;
    for pair in q.split('&') {
        if let Some(v) = pair.strip_prefix("code=") {
            return Some(v.to_string());
        }
    }
    None
}

/// 用 v2.0 端点把 authorization code 换成 Microsoft token（自注册公共应用）。
async fn exchange_code_v2(client_id: &str, code: &str) -> Result<(String, String), String> {
    let resp = client()
        .post(V2_TOKEN_URL)
        .form(&[
            ("client_id", client_id),
            ("redirect_uri", &loopback_redirect()),
            ("grant_type", "authorization_code"),
            ("code", code),
            ("scope", SCOPE),
        ])
        .send()
        .await
        .map_err(|e| format!("请求微软 token 端点失败: {e}"))?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| format!("读取 token 响应失败: {e}"))?;
    let parsed: Result<LiveTokenResponse, _> = serde_json::from_str(&body);
    match parsed {
        Ok(t) => {
            if let Some(err) = t.error {
                return Err(format!("微软拒绝授权码: {} {}", err, t.error_description.unwrap_or_default()));
            }
            Ok((t.access_token, t.refresh_token.unwrap_or_default()))
        }
        Err(_) => {
            if status.is_success() {
                Err(format!("token 响应无法解析: {body}"))
            } else {
                Err(format!("token 交换失败 (HTTP {status}): {body}"))
            }
        }
    }
}

/// 绑定本地 loopback 监听器（绑定、不阻塞）。随后弹浏览器、再 accept 拿 code。
pub async fn bind_loopback() -> Result<tokio::net::TcpListener, String> {
    let addr = format!("127.0.0.1:{LOOPBACK_PORT}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| {
            format!("启动本地回跳监听失败（{addr}）: {e}\n请确认 5599 端口未被占用，且 Azure App 已配 redirect uri=http://127.0.0.1:5599/cb")
        })?;
    eprintln!("[ms-oauth] loopback 监听已启动: {addr}，等待浏览器回跳…");
    Ok(listener)
}

/// 在已绑定的 listener 上 accept 一次，读取浏览器回跳请求里的 code（阻塞直到收到）。
pub async fn wait_loopback_code_on(
    listener: &tokio::net::TcpListener,
) -> Result<String, String> {
    let (mut stream, _) = listener
        .accept()
        .await
        .map_err(|e| format!("loopback accept 失败: {e}"))?;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut buf = [0u8; 2048];
    let n = stream
        .read(&mut buf)
        .await
        .map_err(|e| format!("读取回跳请求失败: {e}"))?;
    let req = String::from_utf8_lossy(&buf[..n]).to_string();
    let line = req.lines().next().unwrap_or("");
    let code = parse_code_from_request_line(line)
        .ok_or_else(|| format!("回跳请求未包含 code: {line}"))?;
    let html = "<html><body style='font-family:sans-serif;margin:3rem'><h3>登录成功</h3><p>你可以关闭此页面，回到启动器。</p></body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );
    let _ = stream.write_all(response.as_bytes()).await;
    eprintln!("[ms-oauth] 已捕获 code（长度 {}）", code.len());
    Ok(code)
}

/// 用 loopback 拿到的 code 完成 v2.0 登录（换 token → MC 链 → 账号条目）。
pub async fn finish_loopback_login(client_id: &str, code: &str) -> Result<AccountEntry, String> {
    let (ms_token, refresh_token) = exchange_code_v2(client_id, code).await?;
    eprintln!("[ms-oauth] v2.0 code exchange 成功（access_token 长度 {}）", ms_token.len());
    finalize_mc_profile(&ms_token, &refresh_token).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_code_from_full_url() {
        let url = "https://login.live.com/oauth20_desktop.srf?code=M.C123_AbC&lc=1033&uaid=xyz";
        assert_eq!(extract_code(url).unwrap(), "M.C123_AbC");
    }

    #[test]
    fn extract_code_from_bare_code() {
        assert_eq!(extract_code("M.Raw_Code_9").unwrap(), "M.Raw_Code_9");
    }

    #[test]
    fn extract_code_empty_rejected() {
        assert!(extract_code("").is_err());
        assert!(extract_code("   ").is_err());
    }

    #[test]
    fn authorize_url_has_official_client_and_desktop_redirect() {
        let (url, redirect) = authorize_url();
        assert!(url.starts_with("https://login.live.com/oauth20_authorize.srf?"));
        assert!(url.contains("client_id=00000000402b5328"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("scope=XboxLive.signin"));
        assert!(url.contains("offline_access"));
        // redirect 必须是官方桌面 srf（实测其它 redirect 被微软拒 invalid_request）
        assert!(url.contains("redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf"));
        assert_eq!(redirect, "https://login.live.com/oauth20_desktop.srf");
    }

    #[tokio::test]
    async fn urlencoding_roundtrip_scopes() {
        // 仅验证百分号编码不破坏必需 token 片段（非网络测试）
        let enc = urlencoding_scope(SCOPE);
        assert_eq!(enc, "XboxLive.signin+offline_access");
        let red = urlencoding_scope(REDIRECT_URI);
        assert!(red.contains("%3A%2F%2F"));
    }

    #[test]
    fn loopback_authorize_url_points_to_local_redirect() {
        let url = loopback_authorize_url("testclient-abc");
        assert!(url.starts_with("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?"));
        assert!(url.contains("client_id=testclient-abc"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("scope=XboxLive.signin+offline_access"));
        // redirect 指向本地 loopback（浏览器会回跳到 127.0.0.1:PORT/cb）
        assert!(url.contains(&format!(
            "redirect_uri=http%3A%2F%2F127.0.0.1%3A{}%2Fcb",
            LOOPBACK_PORT
        )), "url = {url}");
    }

    #[test]
    fn parse_code_from_request_line_works() {
        let line = "GET /cb?code=ABC123&lc=1033&uaid=xyz HTTP/1.1";
        assert_eq!(parse_code_from_request_line(line).unwrap(), "ABC123");
        assert!(parse_code_from_request_line("GET /cb?error=access_denied HTTP/1.1").is_none());
        assert!(parse_code_from_request_line("").is_none());
    }

    /// 端到端验证 loopback 捕获：本地提 listener 后，模拟一个浏览器回跳请求，应能解析出 code。
    #[tokio::test]
    async fn loopback_captures_code_from_simulated_browser() {
        let listener = bind_loopback().await.expect("bind loopback");
        // 模拟系统浏览器在授权后被重定向到 http://127.0.0.1:5599/cb?code=...
        let redirect = format!("http://127.0.0.1:{}/cb?code=LOOP_OK&lc=1033", LOOPBACK_PORT);
        let get_line = format!(
            "GET {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
            redirect, LOOPBACK_PORT
        );
        let handle = tokio::spawn(async move {
            let mut s = tokio::net::TcpStream::connect(format!("127.0.0.1:{}", LOOPBACK_PORT))
                .await
                .expect("connect to loopback");
            use tokio::io::AsyncWriteExt;
            let _ = s.write_all(get_line.as_bytes()).await;
        });
        let code = wait_loopback_code_on(&listener).await.expect("capture code");
        let _ = handle.await;
        assert_eq!(code, "LOOP_OK");
    }
}
