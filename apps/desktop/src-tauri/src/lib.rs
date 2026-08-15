//! MC Launcher Tauri 后端（Rust 核心）。
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

/// 版本清单 —— 骨架用 Rust 内核静态数据；M3 接真实下载。
#[tauri::command]
fn version_manifest() -> Result<Value, String> {
    let versions = crate::core::launch::fetch_version_manifest().map_err(|e| e.to_string())?;
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

/// 启动实例 —— 转发到 sidecar instance.launch（骨架返回结构化 M3 错误）。
#[tauri::command]
fn instance_launch(state: tauri::State<'_, AppState>, payload: Value) -> Result<Value, String> {
    call_sidecar(&state, "instance.launch", payload)
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
                        eprintln!("[mc-launcher] 启动 plugin-host sidecar 失败: {e}");
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
                let _ = handle.emit("app/ready", json!({ "core": "mc-launcher-rust" }));
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
/// 验证：Rust 拉起 Node sidecar，走读(instance.list)+写(instance.create)+读 三阶往返。
pub fn self_check() -> String {
    // 0) 真实版本清单拉取
    let manifest_report = match crate::core::launch::fetch_version_manifest() {
        Ok(v) => format!(
            "清单: {} 个版本，最新 release = {}",
            v.len(),
            v.first().map(|x| x.id.as_str()).unwrap_or("?"),
        ),
        Err(e) => format!("清单: 拉取失败 {e}"),
    };

    let (host_dir, tsx_bin, entry) = resolve_plugin_host();
    let sidecar = match crate::core::sidecar::SyncSidecar::start(&host_dir, &tsx_bin, &[&entry]) {
        Ok(s) => s,
        Err(e) => return format!("[self-check] 无法启动 sidecar: {e}"),
    };

    // 1) 读：list（应为空）
    let list1 = match sidecar.call("instance.list", serde_json::json!({})) {
        Ok(d) => d,
        Err(e) => return format!("[self-check] instance.list 失败: {e}"),
    };
    // 2) 写：create
    let created = match sidecar.call(
        "instance.create",
        serde_json::json!({ "name": "SelfCheckSMP", "versionId": "1.21.4", "modLoader": "fabric" }),
    ) {
        Ok(d) => d,
        Err(e) => return format!("[self-check] instance.create 失败: {e}"),
    };

    // 3) 读：list 应能看到刚创建的实例
    let list2 = match sidecar.call("instance.list", serde_json::json!({})) {
        Ok(d) => d,
        Err(e) => return format!("[self-check] instance.list(2) 失败: {e}"),
    };

    format!(
        "[self-check] ⓪{manifest_report}\n[self-check] ①list={list1}\n[self-check] ②create→{created}\n[self-check] ③list→{list2}\n[self-check] 读/写/回读全链路通过"
    )
}
