//! MC Launcher Tauri 后端（Rust 核心）。
//!
//! 职责：暴露给前端的 Tauri command（`invoke`/`emit`），
//! 并把"真正动 JVM / 干重活"的调用交给 Rust 内核（launch）。
//! Node sidecar（Cordis 插件编排）经 core::sidecar 在 M2 接入常驻链路。

pub mod core {
    pub mod launch;
    pub mod sidecar;
}

use serde_json::json;
use serde_json::Value;
use tauri::Emitter;

/// 运行时共享状态。M1 先用固定入口；M2 持常驻 sidecar 连接。
pub struct AppState {
    pub plugin_host_entry: String,
}
// ---- Tauri Commands ----

/// 版本清单 —— 验证「接入 LightyLauncherLib」的骨架落地。
#[tauri::command]
fn version_manifest() -> Result<Value, String> {
    let versions = crate::core::launch::fetch_version_manifest().map_err(|e| e.to_string())?;
    Ok(json!({ "versions": versions }))
}

/// 实例列表 —— M1 骨架先用 Rust 内核返回空清单。
/// M2 起转发 plugin-host（Cordis sidecar 已能处理 instance.list，见 M1 验证）。
#[tauri::command]
fn instance_list() -> Result<Value, String> {
    Ok(json!({ "instances": [] }))
}

/// 创建实例 —— M1 骨架仅校验入参结构；M2 走 sidecar.instance.create。
#[tauri::command]
fn instance_create(name: String, version_id: String, mode_loader: String) -> Result<Value, String> {
    if name.is_empty() || version_id.is_empty() {
        return Err("name / versionId 不能为空".into());
    }
    Ok(json!({
        "instance": {
            "id": "skeleton-pending",
            "name": name,
            "versionId": version_id,
            "modLoader": mode_loader,
            "note": "M2 起由 Rust↔sidecar 创建真实实例"
        }
    }))
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello from Rust core, {name}!")
}

// ---- 启动 ----

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            plugin_host_entry: "apps/plugin-host".into(),
        })
        .invoke_handler(tauri::generate_handler![
            version_manifest,
            instance_list,
            instance_create,
            greet
        ])
        .setup(|app| {
            // 启动后给前端一条就绪事件（验证 Tauri events → 前端订阅）
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(500));
                let _ = app_handle.emit("app/ready", json!({ "core": "mc-launcher-rust" }));
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Rust 内核自检入口（`--self-check`，不进 GUI，供 CI/人工验内核）。
pub fn self_check() -> String {
    match crate::core::launch::fetch_version_manifest() {
        Ok(v) => format!(
            "[self-check] fetch_version_manifest() → {} 个版本条目（骨架数据）",
            v.len()
        ),
        Err(e) => format!("[self-check] 失败: {e}"),
    }
}
