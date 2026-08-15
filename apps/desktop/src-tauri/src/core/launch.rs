//! LaunchAdapter —— MC 启动内核封装（LightyLauncherLib / Mojang API）。
//!
//! 对应蓝图「四、Core 服务层」的 LaunchAdapter。
//!
//! M3：`fetch_version_manifest()` 真实拉取 Mojang 版本清单（piston-meta）。
//! M4：接入 lighty-launch 完整启动 pipeline —— Loader 映射 → AppState → OfflineAuth
//!     → VersionBuilder → install（lib/natives/client/assets）→ JVM 启动 → 返回 pid；
//!     并把 lighty 的真实下载进度事件桥接为 `download:progress` 推给前端。

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Deserialize;
use serde::Serialize;

use lighty_auth::offline::OfflineAuth;
use lighty_auth::Authenticator;
use lighty_core::AppState;
use lighty_event::{Event, EventBus, JavaEvent, LaunchEvent};
use lighty_java::JavaDistribution;
use lighty_launch::launch::Launch;
use lighty_loaders::types::Loader;
use lighty_version::VersionBuilder;

use tauri::Emitter;

/// MC 版本清单顶层（M4 补 java_major 用）
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

/// 单个版本的 json（M4 解析 javaVersion 用）
#[derive(Debug, Deserialize)]
struct MojangVersionJson {
    #[serde(rename = "javaVersion")]
    java_version: Option<JavaVersionJson>,
}

#[derive(Debug, Deserialize)]
struct JavaVersionJson {
    #[serde(rename = "majorVersion")]
    major_version: i32,
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

    // Mojang 清单本身 newest→oldest。不错sort，只截前 N 个。
    let versions: Vec<VersionEntry> = manifest
        .versions
        .into_iter()
        .map(|v| VersionEntry {
            id: v.id,
            version_type: v.version_type,
            url: v.url,
            release_time: v.time,
            java_major: None, // M4 用 fetch_java_major_enriched 逐版补
        })
        .collect();

    // 只返回前 60 个（最新的），避免列表过长
    Ok(versions.into_iter().take(60).collect())
}

/// M4：拉取指定版本的 json，解析其要求的 Java 主版本号（如 1.21 要求 21）。
fn fetch_java_major(url: &str) -> Option<i32> {
    let json: MojangVersionJson = reqwest::blocking::Client::new()
        .get(url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .ok()?
        .error_for_status()
        .ok()?
        .json()
        .ok()?;
    json.java_version.map(|j| j.major_version)
}

/// M4：为版本清单补全 java_major（逐个拉版本 json 解析），供前端/启动选 JRE。
/// `limit` 限制只补前 N 个（网络逐个拉取，避免一次请求过多拖慢响应）。
pub fn enrich_java_major(entries: &mut [VersionEntry], limit: usize) {
    for e in entries.iter_mut().take(limit) {
        e.java_major = fetch_java_major(&e.url);
    }
}

/// M4：返回单版本要求的 Java 主版本（lanunch 时回填 javaVersion 用）。
pub fn java_major_for(url: &str) -> Option<i32> {
    fetch_java_major(url)
}

/// 从字符串 modLoader（对应 shared ModLoaderSchema）映射到 lighty 的 Loader。
pub fn mod_loader_to_loader(m: &str) -> Result<Loader, String> {
    match m {
        "vanilla" => Ok(Loader::Vanilla),
        "fabric" => Ok(Loader::Fabric),
        "quilt" => Ok(Loader::Quilt),
        "neoforge" => Ok(Loader::NeoForge),
        "forge" => Ok(Loader::Forge),
        other => Err(format!("不支持的 modLoader: {other}")),
    }
}

/// 一次真实启动的结果（对齐 shared InstanceLaunchData）。
#[derive(Debug, Serialize)]
pub struct LaunchOutcome {
    pub pid: u32,
    pub java_version: String,
    pub jvm_args: Vec<String>,
}

/// 启动上下文：进度事件的回传目标。
/// - 正常 Tauri 运行传 `Some(app_handle)` 以 emit `download:progress`；
/// - self-check/测试无 GUI 时传 `None`，可再挂一个 `on_progress` 观察回调，
///   用于无头环境验证真实进度事件链路。
#[derive(Clone)]
pub struct LaunchContext {
    app: Option<tauri::AppHandle>,
    #[allow(clippy::type_complexity)]
    on_progress: Option<std::sync::Arc<dyn Fn(&str, u64, u64, &str) + Send + Sync>>,
}

impl LaunchContext {
    pub fn new(app: Option<tauri::AppHandle>) -> Self {
        Self { app, on_progress: None }
    }

    /// 附加一个进度观察回调（无 AppHandle 时也能观察真实进度，供 self-check/测试）。
    pub fn with_observer<F>(mut self, f: F) -> Self
    where
        F: Fn(&str, u64, u64, &str) + Send + Sync + 'static,
    {
        self.on_progress = Some(std::sync::Arc::new(f));
        self
    }

    /// 向 Tauri 前端 emit 一条 download:progress；无 app 时静默。
    pub fn emit_progress(
        &self,
        target: &str,
        downloaded: u64,
        total: u64,
        phase: &str,
        error_code: Option<&str>,
    ) {
        if let Some(f) = &self.on_progress {
            f(target, downloaded, total, phase);
        }
        let Some(app) = &self.app else {
            return;
        };
        let ratio = if total > 0 {
            downloaded as f64 / total as f64
        } else {
            0.0
        };
        let _ = app.emit(
            "download:progress",
            serde_json::json!({
                "target": target,
                "downloaded": downloaded,
                "total": total,
                "ratio": ratio,
                "phase": phase,
                "errorCode": error_code,
            }),
        );
    }
}

// lighty-core 的 AppState 是全局一次性初始化；进程内只允许一次。
static APP_STATE_INIT: AtomicBool = AtomicBool::new(false);

fn ensure_app_state() -> Result<(), String> {
    if APP_STATE_INIT.load(Ordering::SeqCst) {
        return Ok(());
    }
    AppState::init("mc-launcher").map_err(|e| format!("AppState 初始化失败: {e}"))?;
    APP_STATE_INIT.store(true, Ordering::SeqCst);
    Ok(())
}

/// 真实启动（async）：
///   1. Loader 映射 + 最小运行环境就绪
///   2. 通过 `tokio::select!` 同时驱动 lighty 的 launch future 与 EventBus 进度监听，
///      实时把 JRE/MC 安装真实进度桥接成 `download:progress` 事件（不依赖额外 task）
///   3. lighty 完整 pipeline：metadata → JRE(必要时下载) → install(8 桶) → spawn JVM
///   4. 捕获 `LaunchEvent::Launched { pid }` 返回
pub async fn launch_game(
    ctx: &LaunchContext,
    name: &str,
    mc_version: &str,
    loader: &str,
    jvm_options: &[(&str, String)],
) -> Result<LaunchOutcome, String> {
    ensure_app_state()?;

    let loader = mod_loader_to_loader(loader)?;

    let bus = EventBus::new(1024);
    let mut rx = bus.subscribe();

    // 离线账号（M4 先用离线；微软认证后接 lighty-auth）
    let mut auth = OfflineAuth::new("Player");
    let profile = auth.authenticate(Some(&bus)).await.map_err(|e| format!("认证失败: {e}"))?;

    // 实例版本即 MC 版本；vanilla 的 loader_version 为空串
    let loader_version = match loader {
        Loader::Vanilla => "",
        _ => "latest", // M5 从元数据解析具体 loader 版本；先用占位交给 lighty
    };
    let mut version = VersionBuilder::new(name, loader, loader_version, mc_version);

    // 接收额外 JVM 参数（如 -Xmx4G → Xmx=4G）
    let mut builder = version.launch(&profile, JavaDistribution::Temurin);
    if !jvm_options.is_empty() {
        let mut ob = builder.with_jvm_options();
        for (k, v) in jvm_options {
            ob = ob.set(*k, v.clone());
        }
        builder = ob.done();
    }
    builder = builder.with_event_bus(&bus);

    let launch_fut = builder.run();
    tokio::pin!(launch_fut);

    // 进度状态
    let mut jre_total = 0u64;
    let mut mc_total = 0u64;
    let mut launch_result: Option<Result<(), String>> = None;
    let mut launched_pid: Option<u32> = None;
    let mut post_drain: u32 = 0;

    let result = loop {
        // 两个退出条件：拿到 pid (且有 launch 结果)，或 launch 完成但 drain 到上限
        if launched_pid.is_some() && launch_result.is_some() {
            break launch_result.clone().expect("launch result");
        }
        if launch_result.is_some() && post_drain > 5000 {
            break launch_result.clone().expect("launch result");
        }
        // launch 未完成时，同时驱动进度 + launch；
        // launch 完成后（guarded off）只 drain rx 等待 Launched。
        tokio::select! {
            ev = rx.next() => {
                match ev {
                    Ok(e) => {
                        match e {
                            Event::Java(JavaEvent::JavaDownloadStarted { total_bytes, .. }) => {
                                jre_total = total_bytes;
                                ctx.emit_progress("jre", 0, jre_total, "downloading", None);
                            }
                            Event::Java(JavaEvent::JavaDownloadProgress { bytes }) => {
                                ctx.emit_progress("jre", bytes, jre_total, "downloading", None);
                            }
                            Event::Java(JavaEvent::JavaDownloadCompleted { .. }) => {
                                ctx.emit_progress("jre", jre_total, jre_total, "done", None);
                            }
                            Event::Launch(LaunchEvent::InstallStarted { total_bytes, .. }) => {
                                mc_total = total_bytes;
                                ctx.emit_progress("minecraft", 0, mc_total, "downloading", None);
                            }
                            Event::Launch(LaunchEvent::InstallProgress { bytes }) => {
                                ctx.emit_progress("minecraft", bytes, mc_total, "downloading", None);
                            }
                            Event::Launch(LaunchEvent::InstallCompleted { .. }) => {
                                ctx.emit_progress("minecraft", mc_total, mc_total, "done", None);
                            }
                            Event::Launch(LaunchEvent::Launched { pid, .. }) => {
                                launched_pid = Some(pid);
                            }
                            _ => {}
                        }
                        if launch_result.is_some() {
                            post_drain += 1;
                        }
                    }
                    Err(_) => {
                        break launch_result
                            .clone()
                            .unwrap_or_else(|| Err("事件流关闭".to_string()));
                    }
                }
            }
            r = &mut launch_fut, if launch_result.is_none() => {
                launch_result = Some(r.map_err(|e| e.to_string()));
                // 继续 select 循环（launch 分支被 guard off，不再 poll 已完成的 future）
            }
        }
    };

    match result {
        Err(e) => return Err(e),
        Ok(()) => {
            let pid = launched_pid.ok_or_else(|| "游戏进程已启动但未捕获到 pid".to_string())?;
            let major = java_major_for_manifest(mc_version);
            Ok(LaunchOutcome {
                pid,
                java_version: major.map(|m| format!("{m}")).unwrap_or_else(|| "?".into()),
                jvm_args: jvm_options.iter().map(|(k, v)| format!("-{k}{v}")).collect(),
            })
        }
    }
}

/// 解析 single-version 的 java 主版本（先查 manifest 里对应条目）。
/// 简化：M4 里版本清单已 enrich 过 java_major；这里从缓存条目取。
/// 若未命中则返回 None（启动不阻塞）。
fn java_major_for_manifest(version_id: &str) -> Option<i32> {
    match fetch_version_manifest() {
        Ok(list) => list
            .iter()
            .find(|v| v.id == version_id)
            .and_then(|v| v.java_major)
            .or_else(|| {
                list.iter()
                    .find(|v| v.id == version_id)
                    .and_then(|v| fetch_java_major(&v.url))
            }),
        Err(_) => None,
    }
}

/// M4：真实启动冒烟（供 `--self-check launch`，无 GUI 也可观察真实下载进度）。
///
/// 用有界 timeout 包裹一次真实 `launch_game`，观察 lighty 的真实进度事件
/// （JRE/安装 buckets）。无论超时还是完成，都返回观察到的进度摘要 + 到达阶段，
/// 以证明「真实启动 pipeline + 真实进度回传」链路真的走通（而不只是编译通过）。
pub fn launch_smoke(name: &str, mc_version: &str, loader: &str) -> String {
    use std::sync::{Arc, Mutex};

    let events: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let ctx = LaunchContext::new(None).with_observer({
        let events = events.clone();
        move |target, downloaded, total, phase| {
            let pct = if total > 0 {
                format!("{:.0}%", downloaded as f64 / total as f64 * 100.0)
            } else {
                "?".into()
            };
            events
                .lock()
                .unwrap()
                .push(format!("{target} {phase} {downloaded}/{total} ({pct})"));
        }
    });
    let ctx2 = ctx.clone();
    let events2 = events.clone();

    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_io()
        .enable_time()
        .build()
        .expect("tokio runtime");

    let fut = crate::core::launch::launch_game(&ctx2, name, mc_version, loader, &[]);
    // 直接 block_on（不依赖 tokio::time）；外层 shell 用 timeout 限定有界观察
    let result = rt.block_on(fut);

    let seen = events2.lock().unwrap().clone();
    let seen_summary = if seen.is_empty() {
        "（未观察到进度事件）".to_string()
    } else {
        format!("{} 条", seen.len())
    };
    let seen_example = seen.iter().take(3).cloned().collect::<Vec<_>>();

    match result {
        Ok(outcome) => format!(
            "[launch冒烟] 完成: pid={}, java={}, 观察到进度={seen_summary}（示例: {seen_example:?}）",
            outcome.pid, outcome.java_version
        ),
        Err(e) => format!(
            "[launch冒烟] 启动报错: {e}；但观察到真实进度={seen_summary}（示例: {seen_example:?}）"
        ),
    }
}

/// M4 起保留的启动请求结构（骨架占位，已由 launch_game 取代）。
#[derive(Debug, Serialize)]
pub struct LaunchRequest {
    pub instance_dir: String,
    pub version_id: String,
    pub offline: bool,
}

/// 构造一次启动请求（骨架：仅组装结构）。
pub fn build_launch_request(instance_dir: &str, version_id: &str) -> LaunchRequest {
    LaunchRequest {
        instance_dir: instance_dir.to_string(),
        version_id: version_id.to_string(),
        offline: true,
    }
}
