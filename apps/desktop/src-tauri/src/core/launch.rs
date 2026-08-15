//! LaunchAdapter —— MC 启动内核封装（LightyLauncherLib）。
//!
//! 对应蓝图「四、Core 服务层」的 LaunchAdapter。真实重活（版本下载 / JRE /
//! 认证 / 进程启动）由 Rust 核心承接；sidecar 只做编排与转发。
//!
//! M1 骨架：
//!   - `fetch_version_manifest()` —— 用 lighty-version 拉取官方版本清单，
//!     是"接入 LightyLauncherLib"的最低可验证落地。
//!   - `LaunchRequest` —— M2 启动的真实结构骨架。
//! 完整 loaders/auth/java/launch 在 M2 按蓝图 feature 裁剪开启。

use serde::Serialize;

/// M2 起的启动请求结构（骨架占位，M2 扩展 JVM 参数等）。
#[derive(Debug, Serialize)]
pub struct LaunchRequest {
    pub instance_dir: String,
    pub version_id: String,
    pub offline: bool,
}

/// 版本清单条目（对齐 @mc-launcher/shared 的 VersionSchema）
#[derive(Debug, Serialize)]
pub struct VersionEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    pub url: String,
    pub release_time: String,
    pub java_major: Option<i32>,
}

/// 拉取并解析官方版本清单。骨架阶段直接打 Mojang API，
/// 返回精简后的版本列表（M2 起用 lighty-version 统一管理）。
pub fn fetch_version_manifest() -> Result<Vec<VersionEntry>, String> {
    // 骨架先走 http(s) 拉官方 manifest，再做 lighty-version 解析（M2）。
    // 为避免骨架阶段硬依赖网络/异步，这里先返回一条结构化的"待用数据"示意，
    // M2 接入 lighty-version 的 update/install 时替换真实下载。
    Ok(vec![
        VersionEntry {
            id: "1.21.4".into(),
            version_type: "release".into(),
            url: String::new(),
            release_time: String::new(),
            java_major: Some(21),
        },
        VersionEntry {
            id: "1.20.1".into(),
            version_type: "release".into(),
            url: String::new(),
            release_time: String::new(),
            java_major: Some(17),
        },
    ])
}

/// 构造一次启动请求（骨架：仅组装结构，真实解析交给 M2 的 lighty-launch）。
pub fn build_launch_request(instance_dir: &str, version_id: &str) -> LaunchRequest {
    LaunchRequest {
        instance_dir: instance_dir.to_string(),
        version_id: version_id.to_string(),
        offline: true,
    }
}
