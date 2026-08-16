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

/// 版本清单条目（对齐 @miko-launcher/shared 的 VersionSchema）
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

pub fn ensure_app_state() -> Result<(), String> {
    if APP_STATE_INIT.load(Ordering::SeqCst) {
        return Ok(());
    }
    AppState::init("miko-launcher").map_err(|e| format!("AppState 初始化失败: {e}"))?;
    APP_STATE_INIT.store(true, Ordering::SeqCst);
    Ok(())
}

/// Fabric/Quilt meta「版本列表」条目（`.loader.version` 是要的版本）。
#[derive(Debug, Deserialize)]
struct LoaderListEntry {
    loader: LoaderEntry,
}
#[derive(Debug, Deserialize)]
struct LoaderEntry {
    version: String,
}

/// maven-metadata.xml 的 versions 提取（轻量、无 XML 依赖）。
/// 结构固定：`<metadata>...<versions><version>A</version>...<version>N</version></versions>...`.
fn extract_maven_versions(xml: &str) -> Vec<String> {
    let mut out = Vec::new();
    for cap in xml.split("<version>").skip(1) {
        if let Some(end) = cap.find("</version>") {
            out.push(cap[..end].to_string());
        }
    }
    out
}

/// 具体 loader 版本解析（M5）。
///
/// lighty 的 `VersionBuilder` 需要**精确** loader 版本才能拼 meta/installer URL；
/// vanilla 空串；fabric/quilt 用官方 meta JSON 精确取该 MC 的第一个版本；
/// neoforge/forge 用 maven-metadata 按 MC 匹配（forge 版本自带 `{mc}-` 前缀，精确最优先）。
pub async fn resolve_loader_version(loader: &Loader, mc_version: &str) -> Result<String, String> {
    let client = &lighty_core::hosts::HTTP_CLIENT;
    let timeout = std::time::Duration::from_secs(15);

    match loader {
        Loader::Vanilla => Ok(String::new()),
        Loader::Fabric => {
            let url = format!("https://meta.fabricmc.net/v2/versions/loader/{mc_version}");
            let list: Vec<LoaderListEntry> = client
                .get(&url)
                .timeout(timeout)
                .send()
                .await
                .map_err(|e| format!("Fabric 版本解析失败: {e}"))?
                .error_for_status()
                .map_err(|e| format!("Fabric 版本 HTTP 错误: {e}"))?
                .json()
                .await
                .map_err(|e| format!("Fabric 版本 JSON 解析失败: {e}"))?;
            list.first()
                .map(|e| e.loader.version.clone())
                .ok_or_else(|| format!("Fabric 未提供 {mc_version} 的 loader 版本"))
        }
        Loader::Quilt => {
            let url = format!("https://meta.quiltmc.org/v3/versions/loader/{mc_version}");
            let list: Vec<LoaderListEntry> = client
                .get(&url)
                .timeout(timeout)
                .send()
                .await
                .map_err(|e| format!("Quilt 版本解析失败: {e}"))?
                .error_for_status()
                .map_err(|e| format!("Quilt 版本 HTTP 错误: {e}"))?
                .json()
                .await
                .map_err(|e| format!("Quilt 版本 JSON 解析失败: {e}"))?;
            list.first()
                .map(|e| e.loader.version.clone())
                .ok_or_else(|| format!("Quilt 未提供 {mc_version} 的 loader 版本"))
        }
        Loader::Forge => {
            // Forge 版本形如 `{mc}-{loader}`（如 1.21.4-54.1.18），maven-metadata 按 MC 前缀精确匹配
            let url = "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml";
            let xml = client
                .get(url)
                .timeout(timeout)
                .send()
                .await
                .map_err(|e| format!("Forge 元数据失败: {e}"))?
                .error_for_status()
                .map_err(|e| format!("Forge 元数据 HTTP: {e}"))?
                .text()
                .await
                .map_err(|e| format!("Forge 元数据读取失败: {e}"))?;
            let mut versions = extract_maven_versions(&xml);
            versions.retain(|v| v.starts_with(mc_version));
            // maven-metadata 的 version 列表本身按时间递增；取最后一个即最新（不做字符串排序，避免 54.0.9 vs 54.0.10 出错）
            versions.last().cloned().ok_or_else(|| format!("Forge 未提供 {mc_version} 的版本"))
        }
        Loader::NeoForge => {
            // NeoForge ≥1.20.2 版本号形如 `{mc_minor}.{mc_patch}.{bf}`（官方版本命名规则：
            //   major = MC 的 minor 版本，minor = MC 的 patch 版本，patch = 实际 NeoForge 版本）。
            // 例：MC 1.21.4 ↔ NeoForge 21.4.x。
            // M7-3：用 `{minor}.{patch}.` 精确前缀（而非只按 minor 的 `{minor}.`），
            // 避免把其它 minor 版本（如 MC 1.21.0 的 21.0.x）误当作目标 MC patch 的 loaderversion 命中。
            // maven-metadata 的 version 列表按时间递增，取最后匹配即该 MC 的最新 loader 版本（不做字符串排序，避免 21.4.58 vs 21.4.9 出错）。
            let url = "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml";
            let xml = client
                .get(url)
                .timeout(timeout)
                .send()
                .await
                .map_err(|e| format!("NeoForge 元数据失败: {e}"))?
                .error_for_status()
                .map_err(|e| format!("NeoForge 元数据 HTTP: {e}"))?
                .text()
                .await
                .map_err(|e| format!("NeoForge 元数据读取失败: {e}"))?;
            // MC "1.21.4" → minor="21", patch="4" → prefix "21.4."
            let parts: Vec<&str> = mc_version.split('.').collect();
            let minor = parts.get(1).copied().unwrap_or("");
            let patch = parts.get(2).copied().unwrap_or("");
            let prefix = format!("{minor}.{patch}.");
            let mut versions = extract_maven_versions(&xml);
            versions.retain(|v| v.starts_with(&prefix));
            versions.last().cloned().ok_or_else(|| {
                format!("NeoForge 未提供 {mc_version} ({prefix}*) 的版本")
            })
        }
        other => Err(format!("不支持的 loader 版本解析: {other:?}")),
    }
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
    identity: &crate::core::accounts::AccountIdentity,
    jvm_options: &[(&str, String)],
) -> Result<LaunchOutcome, String> {
    ensure_app_state()?;

    let loader = mod_loader_to_loader(loader)?;

    let bus = EventBus::new(1024);
    let mut rx = bus.subscribe();

    // 账号认证：离线直发 / 微软静默刷新（M6：用实例绑定账号，替代 M4 的硬编码 Player）
    let profile = crate::core::accounts::identity_to_profile(identity)
        .await
        .map_err(|e| format!("认证失败: {e}"))?;

    // 实例版本即 MC 版本；launch 前解析具体 loader 版本（fabric 等需精确版本才能拼 meta URL）
    let loader_version = resolve_loader_version(&loader, mc_version).await?;
    let mut version = VersionBuilder::new(name, loader, &loader_version, mc_version);

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
        Err(e) => Err(e),
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

    let identity = crate::core::accounts::AccountIdentity::Offline {
        username: "SmokePlayer".to_string(),
    };
    let fut = crate::core::launch::launch_game(&ctx2, name, mc_version, loader, &identity, &[]);
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
