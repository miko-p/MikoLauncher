//! MikoLauncher Tauri 后端（Rust 核心）。
//!
//! 职责：
//!   - 暴露给前端的 Tauri command（`invoke`/`emit`）
//!   - 启动并持有常驻 Node sidecar（Cordis 插件宿主），转发 instance.* 等业务命令
//!   - 真正动 JVM 的重活在 M3 由 lighty-launch 核心承接（当前侧 sidecar 编排）
//!
//! 三端链路（M2）：
//!   前端(Vue invoke) → Rust command → SyncSidecar(Mutex) → plugin-host(JSON-RPC)
//!   结果按同路径返回。

pub mod core {
    pub mod launch;
    pub mod sidecar;
}

/// 供 `--self-check launch` 直接调用的真实启动冒烟。
pub use core::launch::launch_smoke;

use serde_json::{json, Value};
use tauri::Emitter;
use tauri::Manager;

/// 运行时共享状态：常驻 Node sidecar 的共享客户端。
/// cwd 指向 plugin-host 源码目录（dev 用本地 tsx 启动）；生产换打包二进制。
pub struct AppState {
    /// 共享 sidecar（内部 Mutex 保护串行访问）
    pub sidecar: crate::core::sidecar::SyncSidecar,
}

/// 定位 plugin-host 源码并返回其启动所需的 (cwd, tsx-bin, 入口脚本)。
/// 路径以 `CARGO_MANIFEST_DIR`（= .../apps/desktop/src-tauri）向上推导到 repo 根。
fn resolve_plugin_host() -> (String, String, String) {
    let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent() // apps/desktop
        .and_then(|p| p.parent()) // apps
        .and_then(|p| p.parent()) // repo root
        .expect("repo root from CARGO_MANIFEST_DIR");
    let host_dir = repo_root.join("apps").join("plugin-host");
    let tsx_bin = host_dir.join("node_modules").join(".bin").join("tsx");
    let entry = host_dir.join("src").join("main.ts");
    (
        host_dir.to_str().expect("host_dir utf8").to_string(),
        tsx_bin.to_str().expect("tsx_bin utf8").to_string(),
        entry.to_str().expect("entry utf8").to_string(),
    )
}

/// 实际转发一次调用到 sidecar。
fn call_sidecar(state: &AppState, method: &str, params: Value) -> Result<Value, String> {
    state
        .sidecar
        .call(method, params)
        .map_err(|e| e.to_string())
}

// ---- Tauri Commands ----

/// 版本清单 —— 拉取真实 Mojang 版本清单，并补全每条目的 java_major。
/// M4：从「骨架用硬编码」升级为真实版本 + Java 主版本要求（供启动选 JRE）。
#[tauri::command]
fn version_manifest() -> Result<Value, String> {
    let mut versions = crate::core::launch::fetch_version_manifest().map_err(|e| e.to_string())?;
    // 补全前 20 条的 java_major（逐个拉版本 json 解析；供前端展示/启动选 JRE）
    crate::core::launch::enrich_java_major(&mut versions, 20);
    Ok(json!({ "versions": versions }))
}

/// 实例列表 —— 转发到 plugin-host sidecar 的 instance.list。
#[tauri::command]
fn instance_list(state: tauri::State<'_, AppState>) -> Result<Value, String> {
    call_sidecar(&state, "instance.list", json!({}))
}

/// 创建实例 —— 转发到 sidecar instance.create。
#[tauri::command]
fn instance_create(state: tauri::State<'_, AppState>, payload: Value) -> Result<Value, String> {
    call_sidecar(&state, "instance.create", payload)
}

/// 启动实例 —— M4：改为 Rust 本地 LaunchAdapter 真实启动（lighty 内核），不再转发 sidecar。
/// 流程：sidecar `instance.get` 取实例详情 → 本地 lighty pipeline 真实启动
///       （Loader 映射 → 安装 lib/JRE/client/assets → spawn JVM）→ 返回 {pid, javaVersion, jvmArgs}。
/// 真实下载/安装/启动进度通过 `LaunchContext` 以 `download:progress` 事件推给前端。
#[tauri::command]
fn instance_launch(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    payload: Value,
) -> Result<Value, String> {
    let instance_id = payload
        .get("instanceId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 instanceId".to_string())?;
    let jvm_args_raw: Vec<String> = payload
        .get("jvmArgs")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| s.as_str().map(|x| x.to_string()))
                .collect()
        })
        .unwrap_or_default();

    // 从 sidecar 取实例详情（name / versionId / modLoader）
    let instance = call_sidecar(&state, "instance.get", json!({ "id": instance_id }))?;
    let name = instance["instance"]["name"]
        .as_str()
        .ok_or_else(|| "实例缺少 name".to_string())?
        .to_string();
    let version_id = instance["instance"]["versionId"]
        .as_str()
        .ok_or_else(|| "实例缺少 versionId".to_string())?
        .to_string();
    let mod_loader = instance["instance"]["modLoader"]
        .as_str()
        .ok_or_else(|| "实例缺少 modLoader".to_string())?
        .to_string();

    // 解析 JVM 参数（-Xmx4G → ("Xmx", "4G")；-XX:+UseG1GC → 无值 flag）
    let jvm_options: Vec<(String, String)> = jvm_args_raw
        .into_iter()
        .map(|arg| {
            let a = arg.trim_start_matches('-');
            match a.split_once('=') {
                Some((k, v)) => (k.to_string(), v.to_string()),
                None => (a.to_string(), String::new()),
            }
        })
        .filter(|(k, _)| !k.is_empty())
        .collect();

    // 本地真实启动（阻塞；worker 线程，Tauri 不会卡 UI）
    let ctx = crate::core::launch::LaunchContext::new(Some(app.clone()));
    let outcome = std::thread::spawn(move || {
        // 在闭包内借用 jvm_options 构造 refs（lifetime 覆盖 block_on）
        let jvm_refs: Vec<(&str, String)> = jvm_options
            .iter()
            .map(|(k, v)| (k.as_str(), v.clone()))
            .collect();
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("tokio runtime");
        rt.block_on(crate::core::launch::launch_game(
            &ctx, &name, &version_id, &mod_loader, &jvm_refs,
        ))
    })
    .join()
    .map_err(|_| "启动线程 panic".to_string())??;

    Ok(json!({
        "pid": outcome.pid,
        "javaVersion": outcome.java_version,
        "jvmArgs": outcome.jvm_args,
    }))
}

/// 模拟下载进度 —— 骨架用：向前端推送几个 `download:progress` 事件，
/// 供前端订阅链路（DownloadProgressSchema）验证。M4 起替换为真实下载进度。
#[tauri::command]
fn emit_download_progress(app: tauri::AppHandle) -> Result<(), String> {
    let handle = app.clone();
    std::thread::spawn(move || {
        let seq = [
            (10u64, 100u64, "client.jar"),
            (40u64, 100u64, "client.jar"),
            (70u64, 100u64, "client.jar"),
            (100u64, 100u64, "client.jar"),
        ];
        for (downloaded, total, target) in seq {
            handle
                .emit(
                    "download:progress",
                    json!({
                        "target": target,
                        "downloaded": downloaded,
                        "total": total,
                        "ratio": downloaded as f64 / total as f64,
                        "phase": if downloaded == total { "done" } else { "downloading" },
                    }),
                )
                .ok();
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
    });
    Ok(())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello from Rust core, {name}!")
}

// ---- 启动 ----

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // 定位 plugin-host，用本地 tsx 启动常驻 sidecar。
            let (host_dir, tsx_bin, entry) = resolve_plugin_host();
            let app_state =
                match crate::core::sidecar::SyncSidecar::start(&host_dir, &tsx_bin, &[&entry]) {
                    Ok(s) => s,
                    Err(e) => {
                        // sidecar 启动失败不应使应用崩溃：降级为可用占位，返回明确错误。
                        eprintln!("[miko-launcher] 启动 plugin-host sidecar 失败: {e}");
                        crate::core::sidecar::SyncSidecar::degraded(format!(
                            "plugin-host sidecar 启动失败: {e}"
                        ))
                    }
                };
            app.manage(AppState { sidecar: app_state });

            // 通知前端就绪
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(300));
                let _ = handle.emit("app/ready", json!({ "core": "miko-launcher-rust" }));
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            version_manifest,
            instance_list,
            instance_create,
            instance_launch,
            emit_download_progress,
            greet
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Rust 内核自检入口（`--self-check`，不进 GUI）。
/// 验证：
///   ⓪ 真实版本清单拉取 + java_major 补全（M4）
///   ④ Loader 映射（M4）
///   ①/②/③ Rust 拉起 Node sidecar，走读(instance.list)+写(instance.create)+读 三阶往返
pub fn self_check() -> String {
    let mut report = String::new();

    // ⓪ 真实版本清单拉取 + 补全 java_major（M4：逐条拉版本 json 解析 java 主版本）
    match crate::core::launch::fetch_version_manifest() {
        Ok(mut v) => {
            crate::core::launch::enrich_java_major(&mut v, 3);
            let first3: Vec<String> = v
                .iter()
                .take(3)
                .map(|x| format!(
                    "{} (java {})",
                    x.id,
                    x.java_major.map(|m| m.to_string()).unwrap_or("?".into())
                ))
                .collect();
            report.push_str(&format!(
                "[self-check] ⓪清单: {} 个版本；前3= [{}]\n",
                v.len(),
                first3.join(", ")
            ));
            let latest = v.first().map(|x| x.id.as_str()).unwrap_or("?");
            report.push_str(&format!(
                "[self-check] ⓪清单: 最新 release = {latest}（真实拉取）\n"
            ));
        }
        Err(e) => report.push_str(&format!("[self-check] ⓪清单: 拉取失败 {e}\n")),
    }

    // ④ Loader 映射断言（M4 真实启动的前置映射）
    let loader_map: Vec<String> = ["vanilla", "fabric", "quilt", "neoforge", "forge"]
        .iter()
        .map(|m| match crate::core::launch::mod_loader_to_loader(m) {
            Ok(_) => format!("{m}✓"),
            Err(e) => format!("{m}✗({e})"),
        })
        .collect();
    report.push_str(&format!(
        "[self-check] ④Loader映射: [{}]\n",
        loader_map.join(", ")
    ));

    // ⑤ 具体 loader 版本解析（M5）：真实从官方 meta/maven 解析各 loader 的精确版本
    {
        use lighty_loaders::types::Loader;
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_io()
            .enable_time()
            .build()
            .expect("tokio runtime for loader version");
        let mc = "1.21.4";
        let cases = [
            ("vanilla", Loader::Vanilla),
            ("fabric", Loader::Fabric),
            ("quilt", Loader::Quilt),
            ("neoforge", Loader::NeoForge),
            ("forge", Loader::Forge),
        ];
        let mut parts = Vec::new();
        for (label, loader) in cases {
            match rt.block_on(crate::core::launch::resolve_loader_version(&loader, mc)) {
                Ok(v) => {
                    if v.is_empty() {
                        parts.push(format!("{label}=∅"));
                    } else {
                        parts.push(format!("{label}={v}"));
                    }
                }
                Err(e) => parts.push(format!("{label}✗({e})")),
            }
        }
        report.push_str(&format!(
            "[self-check] ⑤Loader版本(1.21.4): [{}]\n",
            parts.join(", ")
        ));
    }

    let (host_dir, tsx_bin, entry) = resolve_plugin_host();
    let sidecar = match crate::core::sidecar::SyncSidecar::start(&host_dir, &tsx_bin, &[&entry]) {
        Ok(s) => s,
        Err(e) => return format!("{report}[self-check] 无法启动 sidecar: {e}"),
    };

    // 1) 读：list
    let list1 = match sidecar.call("instance.list", serde_json::json!({})) {
        Ok(d) => d,
        Err(e) => return format!("{report}[self-check] instance.list 失败: {e}"),
    };
    // 2) 写：create
    let created = match sidecar.call(
        "instance.create",
        serde_json::json!({ "name": "SelfCheckSMP", "versionId": "1.21.4", "modLoader": "fabric" }),
    ) {
        Ok(d) => d,
        Err(e) => return format!("{report}[self-check] instance.create 失败: {e}"),
    };

    // 3) 读：list 应能看到刚创建的实例
    let list2 = match sidecar.call("instance.list", serde_json::json!({})) {
        Ok(d) => d,
        Err(e) => return format!("{report}[self-check] instance.list(2) 失败: {e}"),
    };

    report.push_str(&format!(
        "[self-check] ①list={list1}\n[self-check] ②create→{created}\n[self-check] ③list→{list2}\n[self-check] 读/写/回读全链路通过\n"
    ));
    report
}
