//! LaunchAdapter —— MC 启动内核封装（LightyLauncherLib / Mojang API）。
//!
//! 对应蓝图「四、Core 服务层」的 LaunchAdapter。
//!
//! M3：
//!   - `fetch_version_manifest()` —— 真实拉取 Mojang 官方版本清单（piston-meta），
//!     替代 M1 的硬编码 2 条占位，供「下载页」列出真实版本。
//!   - `build_launch_request()` —— 组装启动结构（M4 接 lighty-launch 真实启动）。
//!
//! M4 再接入 lighty-version 的 install（下载 JAR/库/原生库/assets）+ lighty-launch
//! 的 JRE/JVM 启动（VersionBuilder → Installer → Launch）。本模块先提供清单与结构。

use serde::Deserialize;
use serde::Serialize;

/// Mojang version_manifest_v2.json 顶层（我们只用 versions 列表）
#[derive(Debug, Deserialize)]
struct MojangManifestV2 {
    versions: Vec<MojangVersion>,
}

#[derive(Debug, Deserialize)]
struct MojangVersion {
    id: String,
    #[serde(rename = "type")]
    version_type: String,
    url: String,
    time: String,
}

/// 版本清单条目（对齐 @mc-launcher/shared 的 VersionSchema）
#[derive(Debug, Clone, Serialize)]
pub struct VersionEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    pub url: String,
    pub release_time: String,
    pub java_major: Option<i32>,
}

/// 拉取并解析真实 Mojang 版本清单。
/// 返回精简后的版本列表（最新在前）；网络失败则返回明确错误。
pub fn fetch_version_manifest() -> Result<Vec<VersionEntry>, String> {
    const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

    let resp = reqwest::blocking::Client::new()
        .get(MANIFEST_URL)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .map_err(|e| format!("请求 Mojang 清单失败: {e}"))?;

    let body = resp
        .error_for_status()
        .map_err(|e| format!("Mojang 清单 HTTP 错误: {e}"))?;
    let manifest: MojangManifestV2 = body
        .json()
        .map_err(|e| format!("解析 Mojang 清单失败: {e}"))?;

    // Mojang 清单本身 newest→oldest。不做重排（避免误排序），只截前 N 个。
    let versions: Vec<VersionEntry> = manifest
        .versions
        .into_iter()
        .map(|v| VersionEntry {
            id: v.id,
            version_type: v.version_type,
            url: v.url,
            release_time: v.time,
            java_major: None, // 需进一步拉版本 json 才能得知，骨架留空（M4 补）
        })
        .collect();

    // 只返回前 60 个（最新的），避免列表过长
    Ok(versions.into_iter().take(60).collect())
}

/// M4 起的启动请求结构（骨架占位）。
#[derive(Debug, Serialize)]
pub struct LaunchRequest {
    pub instance_dir: String,
    pub version_id: String,
    pub offline: bool,
}

/// 构造一次启动请求（骨架：仅组装结构，M4 接 lighty-launch 真实启动）。
pub fn build_launch_request(instance_dir: &str, version_id: &str) -> LaunchRequest {
    LaunchRequest {
        instance_dir: instance_dir.to_string(),
        version_id: version_id.to_string(),
        offline: true,
    }
}
