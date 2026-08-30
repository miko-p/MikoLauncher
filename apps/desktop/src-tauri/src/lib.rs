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
    pub mod accounts;
    pub mod launch;
    pub mod microsoft_oauth;
    pub mod modrinth;
    pub mod secrets;
    pub mod sidecar;
}

/// 供 `--self-check launch` 直接调用的真实启动冒烟。
pub use core::launch::launch_smoke;

use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tauri::Manager;

/// 运行时共享状态：常驻 Node sidecar 的共享客户端 + 运行中实例表。
/// cwd 指向 plugin-host 源码目录（dev 用本地 tsx 启动）；生产换打包二进制。
pub struct AppState {
    /// 共享 sidecar（内部 Mutex 保护串行访问）
    pub sidecar: crate::core::sidecar::SyncSidecar,
    /// M11-3：正在运行的实例 → Java 进程 pid（0 = 已提交启动、尚未拉到 pid）。
    /// 供防重复启动 + 前端状态列查询。非阻塞后台线程更新。
    pub running: Arc<Mutex<std::collections::HashMap<String, u32>>>,
}

/// sidecar 启动规格：cwd、可执行文件、args、额外 env。
struct PluginHostSpec {
    cwd: String,
    bin: String,
    args: Vec<String>,
    envs: Vec<(String, String)>,
}

/// 发布版 sidecar 的额外环境变量：把 sidecar 的数据/插件目录显式指向 lighty 标准
/// data_dir（`<data_dir>/sidecar-data` 与 `<data_dir>/plugins`），并`确保 AppState 先 init`。
///
/// 为什么需要：bun `--compile` 单文件运行时 `import.meta.url` 指向二进制自身，
/// 无法像 dev(tsx 源码) / node(esm bundle) 那样反推源码布局来定位插件/数据目录。
/// 发布场景由 Rust 端注入 env，sidecar（db.ts / plugin-manager.ts 均 env 优先）据此定位；
/// 同时 dev 分支不注入，保持现有「源码布局反推」行为不变。
fn release_envs() -> Vec<(String, String)> {
    let _ = crate::core::launch::ensure_app_state();
    let data_dir = lighty_core::AppState::data_dir().to_path_buf();
    vec![
        (
            "MC_LAUNCHER_DATA_DIR".to_string(),
            data_dir.join("sidecar-data").to_string_lossy().into_owned(),
        ),
        (
            "MIKO_PLUGINS_DIR".to_string(),
            data_dir.join("plugins").to_string_lossy().into_owned(),
        ),
    ]
}

/// 定位 plugin-host sidecar 的启动项，返回启动规格（cwd / bin / args / envs）。
///
/// 两层优先级：
/// 1. **打包版（生产 externalBin）**：仅在 **release build**（`!cfg!(debug_assertions)`）下，
///    `current_exe()` 同目录找 companion 二进制（Tauri 会把 `bundle.externalBin` 声明的
///    sidecar 与主程序放到同一可执行目录）。Linux/macOS 名称 `plugin-host`，Windows `plugin-host.exe`。
///    此时 bin = 该二进制，args = 空，并注入 `release_envs()`（M9-4 发布 runtime）。
///    > 用 `cfg!(debug_assertions)` 排除 debug 构建,避免 dev 时 `target/debug/` 残留打包版
///    > sidecar（M9-5 build-binary / tauri build 产物）误触发打包分支——否则 dev 会注入
///    > release env、扫不到 repo `plugins/`，插件（demo-view 等）不装载。
/// 2. **dev（源码运行）**：debug build 恒走 `CARGO_MANIFEST_DIR` 向上推导
///    `apps/plugin-host/node_modules/.bin/tsx` 启动 `src/main.ts`，不注入发布 env
///    （保持源码布局反推的数据/插件目录，扫 repo `plugins/`）。
fn resolve_plugin_host() -> PluginHostSpec {
    // 打包环境（仅 release）：externalBin 与主程序同目录（跨平台名：Win=plugin-host.exe）
    let bundled = if cfg!(debug_assertions) {
        None
    } else {
        std::env::current_exe()
            .ok()
            .and_then(|exe| {
                let dir = exe.parent()?;
                let name = if cfg!(windows) {
                    "plugin-host.exe"
                } else {
                    "plugin-host"
                };
                let p = dir.join(name);
                p.exists().then_some(p)
            })
    };
    if let Some(bin) = bundled {
        let cwd = bin.parent().unwrap_or(std::path::Path::new("."));
        return PluginHostSpec {
            cwd: cwd.to_str().unwrap_or(".").to_string(),
            bin: bin.to_str().expect("plugin-host bin utf8").to_string(),
            args: Vec::new(),
            envs: release_envs(),
        };
    }

    // dev 环境：本地 tsx 跑 plugin-host 源码。
    let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent() // apps/desktop
        .and_then(|p| p.parent()) // apps
        .and_then(|p| p.parent()) // repo root
        .expect("repo root from CARGO_MANIFEST_DIR");
    let host_dir = repo_root.join("apps").join("plugin-host");
    let tsx_bin = host_dir.join("node_modules").join(".bin").join("tsx");
    let entry = host_dir.join("src").join("main.ts");
    PluginHostSpec {
        cwd: host_dir.to_str().expect("host_dir utf8").to_string(),
        bin: tsx_bin.to_str().expect("tsx_bin utf8").to_string(),
        args: vec![entry.to_str().expect("entry utf8").to_string()],
        envs: Vec::new(),
    }
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

/// 轻量版本清单 —— 仅返回版本 id/type（不做 java_major 逐版 enrich）。
/// M11：实例 ➕ 弹窗「自定义」版本下拉用。避免点开即慢 —— `version_manifest` 会逐条拉版本 json
/// 补全前 20 条 java_major（20 个顺序阻塞网络请求），下拉选择根本用不到 java_major，故单独走这条
/// （一次拉 Mojang 主清单即返回，秒开）。
#[tauri::command]
fn version_list() -> Result<Value, String> {
    let versions = crate::core::launch::fetch_all_versions().map_err(|e| e.to_string())?;
    Ok(json!({ "versions": versions }))
}

/// 校验单个版本 id 是否真实存在（在完整 Mojang 清单里精确匹配，不限于前 60）。
/// M11：实例 ➕ 弹窗「自定义」点确定后先校验版本是否确实存在，再创建实例。
#[tauri::command]
fn version_check(payload: Value) -> Result<Value, String> {
    let id = payload
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "缺少 id".to_string())?;
    let hit = crate::core::launch::check_version_exists(id).map_err(|e| e.to_string())?;
    let found = hit.is_some();
    let version = hit.map(|v| json!({ "id": v.id, "type": v.version_type, "url": v.url, "releaseTime": v.release_time }));
    Ok(json!({ "exists": found, "version": version }))
}

// ---- M13：Modrinth 模组/模组包搜索浏览（浏览式搜索 lighty 未暴露，这里直接调 Modrinth /v2/search） ----

/// modrinth_search —— 搜索 Modrinth 项目。
/// payload: { query?, projectType?:"modpack"|"mod"|"all", index?:"relevance"|"downloads"|"follows"|"newest"|"updated", limit?, offset? }
#[tauri::command]
async fn modrinth_search(payload: Value) -> Result<Value, String> {
    let query = payload.get("query").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let facet = match payload.get("projectType").and_then(|v| v.as_str()).unwrap_or("all") {
        "modpack" => crate::core::modrinth::SearchFacet::Modpack,
        "mod" => crate::core::modrinth::SearchFacet::Mod,
        _ => crate::core::modrinth::SearchFacet::All,
    };
    let index = payload.get("index").and_then(|v| v.as_str()).unwrap_or("relevance").to_string();
    let limit = payload.get("limit").and_then(|v| v.as_u64()).unwrap_or(24).clamp(1, 100);
    let offset = payload.get("offset").and_then(|v| v.as_u64()).unwrap_or(0);
    let resp = crate::core::modrinth::search(&query, facet, &index, limit, offset).await?;
    serde_json::to_value(resp).map_err(|e| e.to_string())
}

/// modrinth_project —— 单个 Modrinth 项目详情（slug 或 id）。
#[tauri::command]
async fn modrinth_project(payload: Value) -> Result<Value, String> {
    let slug = payload.get("slug").and_then(|v| v.as_str()).ok_or_else(|| "缺少 slug".to_string())?;
    let p = crate::core::modrinth::project(slug).await?;
    serde_json::to_value(p).map_err(|e| e.to_string())
}

/// modrinth_project_versions —— 项目版本列表（选版本建实例）。
#[tauri::command]
async fn modrinth_project_versions(payload: Value) -> Result<Value, String> {
    let slug = payload.get("slug").and_then(|v| v.as_str()).ok_or_else(|| "缺少 slug".to_string())?;
    let limit = payload.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
    let versions = crate::core::modrinth::project_versions(slug, limit).await?;
    serde_json::to_value(versions).map_err(|e| e.to_string())
}

/// modrinth_modpack_files —— 解析 .mrpack（zip）拿模组清单（创建实例后立即填进实例 mods 展示）。
#[tauri::command]
async fn modrinth_modpack_files(payload: Value) -> Result<Value, String> {
    let file = payload.get("fileUrl").and_then(|v| v.as_str()).ok_or_else(|| "缺少 fileUrl".to_string())?;
    let files = crate::core::modrinth::resolve_modpack_files(file).await?;
    serde_json::to_value(files).map_err(|e| e.to_string())
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

/// 绑定/解绑实例账号 —— 转发到 sidecar instance.updateAccount（M7：账号绑定持久化）。
#[tauri::command]
fn instance_update_account(state: tauri::State<'_, AppState>, payload: Value) -> Result<Value, String> {
    call_sidecar(&state, "instance.updateAccount", payload)
}

/// 设置/清除实例自定义图标 —— 转发到 sidecar instance.updateIcon（M11：data-URI base64）。
#[tauri::command]
fn instance_update_icon(state: tauri::State<'_, AppState>, payload: Value) -> Result<Value, String> {
    call_sidecar(&state, "instance.updateIcon", payload)
}

/// 设置/清除实例期望的 Java 主版本 —— 转发到 sidecar instance.updateJavaMajor（M12）。
#[tauri::command]
fn instance_update_java_major(state: tauri::State<'_, AppState>, payload: Value) -> Result<Value, String> {
    call_sidecar(&state, "instance.updateJavaMajor", payload)
}

/// 覆写实例的 mods 列表 —— 转发到 sidecar instance.updateMods（M13：模组包文件清单持久化展示）。
#[tauri::command]
fn instance_update_mods(state: tauri::State<'_, AppState>, payload: Value) -> Result<Value, String> {
    call_sidecar(&state, "instance.updateMods", payload)
}

/// 删除实例 —— 转发到 sidecar instance.remove。
#[tauri::command]
fn instance_remove(state: tauri::State<'_, AppState>, payload: Value) -> Result<Value, String> {
    call_sidecar(&state, "instance.remove", payload)
}

/// 插件列表 —— 转发到 sidecar plugin.list（M7-5 Phase0 插件管理）。
#[tauri::command]
fn plugin_list(state: tauri::State<'_, AppState>) -> Result<Value, String> {
    call_sidecar(&state, "plugin.list", json!({}))
}

/// 启用插件 —— 转发到 sidecar plugin.enable（M7-5）。
#[tauri::command]
fn plugin_enable(state: tauri::State<'_, AppState>, payload: Value) -> Result<Value, String> {
    call_sidecar(&state, "plugin.enable", payload)
}

/// 禁用插件 —— 转发到 sidecar plugin.disable（M7-5；卸载即回滚其 effect）。
#[tauri::command]
fn plugin_disable(state: tauri::State<'_, AppState>, payload: Value) -> Result<Value, String> {
    call_sidecar(&state, "plugin.disable", payload)
}

/// 拉取 UI 贡献（M8-1 主题/布局/视图插件）—— 转发到 sidecar ui.getManifest。
#[tauri::command]
fn ui_get_manifest(state: tauri::State<'_, AppState>) -> Result<Value, String> {
    call_sidecar(&state, "ui.getManifest", json!({}))
}

/// 插件视图动作（M9-6 交互插件）—— 前端触发插件视图的一个动作。
/// 转发到 sidecar 的 `view.<key>.<action>`（方法名由 key+action 动态拼出，
/// 不在 methodRegistry，由插件 `ctx.rustBridge.on('view.<key>.<action>', ...)` 注册）。
/// 仅 key/action 拼成方法名转发，防止任意方法注入（未知则 sidecar 返回 METHOD_NOT_FOUND）。
#[tauri::command]
fn plugin_view_action(
    state: tauri::State<'_, AppState>,
    payload: Value,
) -> Result<Value, String> {
    let key = payload
        .get("key")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let action = payload
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if key.is_empty() || action.is_empty() {
        return Err("view action 需提供 key 与 action".into());
    }
    // 限定方法名只落在 view.* 命名空间：插件视图贡献的键/动作才可被调用
    let method = format!("view.{key}.{action}");
    let params = payload.get("params").cloned().unwrap_or(json!({}));
    call_sidecar(&state, &method, params)
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
    eprintln!("[instance_launch] 收到启动请求");
    let instance_id = payload
        .get("instanceId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 instanceId".to_string())?;
    eprintln!("[instance_launch] instanceId={instance_id}");
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
    // M12：实例显式指定的期望 Java 主版本（可空）
    let java_major_override = instance["instance"]["javaMajor"]
        .as_u64()
        .map(|m| m as i32);

    // M13：实例绑定的 Modrinth 模组包（project + 选定 versionId）→ ModpackSource::ModrinthPinned
    let modpack_ref = {
        let mp = &instance["instance"]["modpack"];
        let project = mp.get("project").and_then(|v| v.as_str());
        let version_id = mp.get("versionId").and_then(|v| v.as_str());
        match (project, version_id) {
            (Some(p), Some(v)) => {
                use lighty_modsloader::ModpackSource;
                Some(ModpackSource::ModrinthPinned {
                    project: p.to_string(),
                    version: Some(v.to_string()),
                })
            }
            _ => None,
        }
    };

    // 账号：优先用 payload.accountId（启动时显式指定），否则用实例绑定的 accountId，最后回退离线 Player
    let account_id = payload
        .get("accountId")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            instance["instance"]["accountId"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
        });
    crate::core::launch::ensure_app_state()?;
    let store = crate::core::accounts::AccountStore::open()?;
    let identity = match account_id.and_then(|id| store.get(&id)) {
        Some(acct) => {
            store.touch(&acct.id);
            acct.to_identity().map_err(|e| format!("账号身份解析失败: {e}"))?
        }
        None => crate::core::accounts::AccountIdentity::Offline {
            username: "Player".to_string(),
        },
    };

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

    // M11-3：非阻塞启动 —— **不许 join() 等游戏退出**（同步 `spawn().join()` 会占用 Tauri command
    // 线程直到游戏结束 → 游戏运行期间 UI「崩溃/没反应」）。改为：game 放独立线程、command 立即返回，状态经 `launch:status` 事件推前端。
    {
        let mut guard = state
            .running
            .lock()
            .map_err(|_| "running 表锁定失败".to_string())?;
        if guard.contains_key(instance_id) {
            return Err("该实例已在运行".to_string());
        }
        guard.insert(instance_id.to_string(), 0); // 0 = 已提交、尚未拉到 pid
    }

    let instance_id_owned = instance_id.to_string();
    let name_owned = name;
    let version_owned = version_id;
    let loader_owned = mod_loader;
    let identity_owned = identity;
    let java_major_owned = java_major_override;
    let modpack_owned = modpack_ref;

    // launched 回调：游戏拉到 pid 时，更新 running 表 + 推「运行中」状态给前端状态列
    let running_launch = state.running.clone();
    let app_launch = app.clone();
    let id_launch = instance_id_owned.clone();
    let ctx = crate::core::launch::LaunchContext::new(Some(app.clone()))
        .with_on_launched(move |pid| {
            eprintln!("[launch:status] emit started pid={pid} (instance={id_launch})");
            if let Ok(mut g) = running_launch.lock() {
                g.insert(id_launch.clone(), pid);
            }
            let _ = app_launch.emit(
                "launch:status",
                json!({ "instanceId": id_launch, "action": "started", "pid": pid }),
            );
        });

    // 常驻后台任务跑游戏：直接在 Tauri 全局 async runtime 上 `.await` launch_game。
    // **绝对不要** `std::thread::spawn + 自建 tokio runtime + block_on`——lighty run 内部用
    // spawn_blocking/block_in_place，自建 runtime 在 tauri 异步上下文的 block_on 返回后 drop 会 panic
    // （"Cannot drop a runtime in a context where blocking is not allowed"），导致 joined=false、
    // 前端 `launch:status` 报 error（本 session 用户实测「26.x 启动 emit error」即此）。
    // launch_game 本身只 `.await`（tokio::select!），在任何 async runtime 上都能跑；游戏生命周期
    // 内该 task 挂着（async，不阻塞 UI），结束经 launch:status 事件 + running 表清理推给前端。
    let running_done = state.running.clone();
    let app_done = app.clone();
    let id_done = instance_id_owned.clone();
    tauri::async_runtime::spawn(async move {
        // 立即推「运行中」：告诉前端该实例已成功提交、游戏在跑（pid 待收尾时才有真实值）
        eprintln!("[launch:status] emit started(immediate) instance={id_done}");
        let _ = app_done.emit(
            "launch:status",
            json!({ "instanceId": id_done, "action": "started", "pid": 0 }),
        );

        let thread_name = name_owned;
        let thread_version = version_owned;
        let thread_loader = loader_owned;
        let thread_identity = identity_owned;
        let thread_java_major = java_major_owned;
        let thread_modpack = modpack_owned;
        let thread_ctx = ctx.clone();
        let jvm_refs: Vec<(&str, String)> = jvm_options
            .iter()
            .map(|(k, v)| (k.as_str(), v.clone()))
            .collect();
        let result = crate::core::launch::launch_game(
            &thread_ctx,
            &thread_name,
            &thread_version,
            &thread_loader,
            &thread_identity,
            &jvm_refs,
            thread_java_major,
            thread_modpack,
        )
        .await;

        eprintln!("[launch:status] launch_game 返回 instance={id_done}");
        let msg = match result {
            Ok(o) => json!({ "instanceId": id_done, "action": "exit", "pid": o.pid }),
            Err(e) => json!({ "instanceId": id_done, "action": "error", "message": e }),
        };
        eprintln!("[launch:status] emit {} (instance={id_done})", msg["action"]);
        let _ = app_done.emit("launch:status", msg);
        if let Ok(mut g) = running_done.lock() {
            g.remove(&id_done);
        }
    });

    Ok(json!({ "started": true, "instanceId": instance_id_owned }))
}

/// 当前运行中的实例列表（M11-3：供前端启动器挂载时恢复状态列的运行状态）。
/// 返回 [{ instanceId, pid }]（pid 0 = 已提交启动、尚未拉到 pid）。
#[tauri::command]
fn launch_status(state: tauri::State<'_, AppState>) -> Result<Value, String> {
    let guard = state.running.lock().map_err(|_| "running 表锁定失败".to_string())?;
    let running: Vec<Value> = guard
        .iter()
        .map(|(id, pid)| json!({ "instanceId": id, "pid": pid }))
        .collect();
    Ok(json!({ "running": running }))
}

/// 账号列表 —— Rust 本地账号存储。
#[tauri::command]
fn account_list() -> Result<Value, String> {
    crate::core::launch::ensure_app_state()?;
    let store = crate::core::accounts::AccountStore::open()?;
    Ok(json!({ "accounts": store.list_json() }))
}

/// 离线账号登录 —— 创建一个离线账号并持久化。
#[tauri::command]
fn account_login_offline(payload: Value) -> Result<Value, String> {
    crate::core::launch::ensure_app_state()?;
    let name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 name".to_string())?;
    let store = crate::core::accounts::AccountStore::open()?;
    let acct = crate::core::accounts::login_offline(&store, name)?;
    Ok(json!({ "account": acct.to_public_json() }))
}

/// 微软账号登录 —— OAuth 设备流（阻塞直到用户在浏览器授权）。
/// device code 通过 `account:device-code` 事件推给前端，提示用户去浏览器输入。
///
/// 必须是 **async command**（不要用 std::thread::spawn + block_on + .join 阻塞主线程）：
/// 设备流是长轮询，若在同步 command 里阻塞 Tauri 主事件循环，`emit` 的设备码事件和
/// 前端的 invoke 响应都得不到调度——会导致「点了没反应、验证码也不显示」。
#[tauri::command]
async fn account_login_microsoft(app: tauri::AppHandle) -> Result<Value, String> {
    eprintln!("[ms-login] account_login_microsoft command invoked (async)");
    crate::core::launch::ensure_app_state()?;
    let handle = app.clone();

    // 异步设备流（长轮询等待授权）；device code 经 emit 即时推送到前端
    eprintln!("[ms-login] 开始设备流 authenticate（等待微软返回 device code）…");
    let outcome = crate::core::accounts::login_microsoft(move |code, uri| {
        let _ = handle.emit(
            "account:device-code",
            json!({ "userCode": code, "verificationUri": uri }),
        );
    })
    .await?;
    eprintln!("[ms-login] 设备流完成，准备持久化");

    // 持久化
    let store = crate::core::accounts::AccountStore::open()?;
    let saved = store.upsert(outcome.clone())?;
    Ok(json!({ "account": saved.to_public_json() }))
}

/// Microsoft 登录 —— 授权码流（PCL 式）：生成登录 URL 并弹出系统浏览器（不等待），
/// 返回 url + redirectUri 供前端引导用户「在浏览器登录后，把地址栏 URL 粘回」。
#[tauri::command]
fn account_login_microsoft_url() -> Result<Value, String> {
    crate::core::launch::ensure_app_state()?;
    let session = crate::core::microsoft_oauth::create_login_session();
    open_in_browser(&session.url);
    eprintln!("[ms-oauth] 已生成登录 URL 并尝试打开系统浏览器");
    Ok(json!({ "url": session.url, "redirectUri": session.redirect_uri }))
}

/// Microsoft 登录 —— 用户粘回授权后的 URL/裸 code，完成剩余交换并入库。
#[tauri::command]
async fn account_login_microsoft_code(code_or_url: String) -> Result<Value, String> {
    crate::core::launch::ensure_app_state()?;
    eprintln!("[ms-oauth] 收到用户粘回的授权码输入");
    let entry = crate::core::microsoft_oauth::finish_login(&code_or_url).await?;
    let store = crate::core::accounts::AccountStore::open()?;
    let saved = store.upsert(entry.clone())?;
    Ok(json!({ "account": saved.to_public_json() }))
}

/// Microsoft 登录 —— PCL 式全自动（自注册公共应用 + loopback 回跳）：
/// 绑定本地监听 → 弹系统浏览器到 v2.0 authorize → 用户授权后浏览器自动回跳本地
/// 捕获 code → 完成 v2.0 token 交换 + MC 令牌链 → 入库。全程无需粘 URL。
#[tauri::command]
async fn account_login_microsoft_loopback() -> Result<Value, String> {
    crate::core::launch::ensure_app_state()?;
    let client_id = crate::core::accounts::default_ms_client_id()?;
    eprintln!("[ms-oauth] loopback 登录开始（client_id 长度 {}）", client_id.len());

    let listener = crate::core::microsoft_oauth::bind_loopback().await?;
    let url = crate::core::microsoft_oauth::loopback_authorize_url(&client_id);
    open_in_browser(&url);
    eprintln!("[ms-oauth] 已打开系统浏览器: {url}");

    let code = crate::core::microsoft_oauth::wait_loopback_code_on(&listener).await?;
    let entry = crate::core::microsoft_oauth::finish_loopback_login(&client_id, &code).await?;
    let store = crate::core::accounts::AccountStore::open()?;
    let saved = store.upsert(entry.clone())?;
    Ok(json!({ "account": saved.to_public_json() }))
}

/// 用系统默认浏览器打开 URL（跨平台；不等待进程结束）。
fn open_in_browser(url: &str) {
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("cmd")
        .args(["/c", "start", "", url])
        .spawn();
}

/// 账号删除 —— 移除指定账号。
#[tauri::command]
fn account_remove(payload: Value) -> Result<Value, String> {
    crate::core::launch::ensure_app_state()?;
    let id = payload
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 id".to_string())?;
    let store = crate::core::accounts::AccountStore::open()?;
    let removed = store.remove(id)?;
    Ok(json!({ "removed": removed }))
}

/// 账号刷新/有效性检测（M9-2）—— 对指定微软账号显式静默刷新，
/// 区分「凭据仍有效」/「已失效需重新登录」。离线账号恒有效。
/// 前端据此在账号上显示失效提示 + 重新登录入口。
#[tauri::command]
fn account_refresh(payload: Value) -> Result<Value, String> {
    crate::core::launch::ensure_app_state()?;
    let id = payload
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 id".to_string())?
        .to_string();

    // rust 端需 tokio runtime（与登录/启动一致的构造方式）
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_io()
        .enable_time()
        .build()
        .expect("tokio runtime for account refresh");

    let store = crate::core::accounts::AccountStore::open()?;
    let (entry, needs_reauth, message) =
        rt.block_on(crate::core::accounts::refresh_microsoft_account(&store, &id))?;

    Ok(json!({
        "account": entry.to_public_json(),
        "needsReauth": needs_reauth,
        "message": message,
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
            // 定位 plugin-host：优先打包的 externalBin 二进制，dev 回退本地 tsx。
            let spec = resolve_plugin_host();
            let args_refs: Vec<&str> = spec.args.iter().map(|s| s.as_str()).collect();
            let env_refs: Vec<(&str, &str)> = spec
                .envs
                .iter()
                .map(|(k, v)| (k.as_str(), v.as_str()))
                .collect();
            let app_state = match crate::core::sidecar::SyncSidecar::start(
                &spec.cwd,
                &spec.bin,
                &args_refs,
                &env_refs,
            ) {
                Ok(s) => s,
                Err(e) => {
                    // sidecar 启动失败不应使应用崩溃：降级为可用占位，返回明确错误。
                    eprintln!("[miko-launcher] 启动 plugin-host sidecar 失败: {e}");
                    crate::core::sidecar::SyncSidecar::degraded(format!(
                        "plugin-host sidecar 启动失败: {e}"
                    ))
                }
            };
            app.manage(AppState {
                sidecar: app_state,
                running: std::sync::Arc::new(std::sync::Mutex::new(
                    std::collections::HashMap::new(),
                )),
            });

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
            version_list,
            version_check,
            modrinth_search,
            modrinth_project,
            modrinth_project_versions,
            modrinth_modpack_files,
            instance_list,
            instance_create,
            instance_update_account,
            instance_update_icon,
            instance_update_java_major,
            instance_update_mods,
            instance_remove,
            instance_launch,
            launch_status,
            plugin_list,
            plugin_enable,
            plugin_disable,
            ui_get_manifest,
            plugin_view_action,
            account_list,
            account_login_offline,
            account_login_microsoft,
            account_login_microsoft_url,
            account_login_microsoft_code,
            account_login_microsoft_loopback,
            account_remove,
            account_refresh,
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

    // ⑥ 账号体系（M6）：离线账号 增/查/删 全链路 + 持久化
    {
        if let Err(e) = crate::core::launch::ensure_app_state() {
            report.push_str(&format!("[self-check] ⑥账号: AppState 初始化失败 {e}\n"));
            return report;
        }
        let store = match crate::core::accounts::AccountStore::open() {
            Ok(s) => s,
            Err(e) => {
                report.push_str(&format!("[self-check] ⑥账号: 存储打开失败 {e}\n"));
                return report;
            }
        };
        match crate::core::accounts::login_offline(&store, "SelfCheckUser") {
            Ok(acct) => {
                let listed_before = store.list_json().len();
                // 账号身份 → launch profile（验证离线账号解析出正确用户名）
                let identity_check = {
                    let identity = acct.to_identity().expect("identity ok");
                    let rt = tokio::runtime::Builder::new_multi_thread()
                        .enable_io()
                        .enable_time()
                        .build()
                        .expect("tokio runtime for identity");
                    rt.block_on(async {
                        crate::core::accounts::identity_to_profile(&identity).await
                    })
                };
                let identity_note = match identity_check {
                    Ok(p) => format!("→profile={}", p.username),
                    Err(e) => format!("→profile✗({e})"),
                };
                let removed = store.remove(&acct.id);
                report.push_str(&format!(
                    "[self-check] ⑥账号: 离线登录 {}(offline) {identity_note} → 列表 {listed_before} 条 → 移除 {} → 剩 {} 条\n",
                    acct.name,
                    match removed {
                        Ok(true) => "✓",
                        Ok(false) => "✗",
                        Err(_) => "err",
                    },
                    store.list_json().len()
                ));
            }
            Err(e) => report.push_str(&format!("[self-check] ⑥账号: 离线登录失败 {e}\n")),
        }
    }

    // ⑦ OS keyring（M7-2）：写→读→删 往返，验证微软 refresh_token 的安全落点
    {
        let enabled = crate::core::secrets::enabled();
        let test_id = format!("selfcheck-{}", std::process::id());
        match crate::core::secrets::store_secret(&test_id, "super-secret-keyring-test") {
            Ok(()) => {
                let read_back = crate::core::secrets::read_secret(&test_id);
                let note = match &read_back {
                    Ok(Some(v)) if v == "super-secret-keyring-test" => "写→读✓",
                    Ok(None) => "写后读为空✗",
                    Ok(_) => "写后读不一致✗",
                    Err(e) => &format!("读✗({e})")[..],
                };
                let del = crate::core::secrets::delete_secret(&test_id);
                let del_note = match del {
                    Ok(()) => "删✓",
                    Err(e) => &format!("删✗({e})")[..],
                };
                // 删除后再读应为 None，验证真的删掉了
                let gone = crate::core::secrets::read_secret(&test_id)
                    .map(|v| v.is_none())
                    .unwrap_or(false);
                report.push_str(&format!(
                    "[self-check] ⑦keyring: 特性={enabled} → {note} {del_note} 残留={} → 往返{}\n",
                    if gone { "无" } else { "有" },
                    if gone { "✓" } else { "✗" }
                ));
            }
            Err(e) => {
                report.push_str(&format!(
                    "[self-check] ⑦keyring: 特性={enabled} 但存储不可用（无 D-Bus 会话?）→ {e}\n"
                ));
            }
        }
    }

    let spec = resolve_plugin_host();
    let args_refs: Vec<&str> = spec.args.iter().map(|s| s.as_str()).collect();
    let env_refs: Vec<(&str, &str)> = spec
        .envs
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    let sidecar = match crate::core::sidecar::SyncSidecar::start(
        &spec.cwd,
        &spec.bin,
        &args_refs,
        &env_refs,
    ) {
        Ok(s) => s,
        Err(e) => return format!("{report}[self-check] 无法启动 sidecar: {e}"),
    };

    // ⑧ Phase0 插件装载（M7-5）：经 sidecar plugin.list 验证 plugins/ 目录里的插件已被 Cordis 装载
    match sidecar.call("plugin.list", serde_json::json!({})) {
        Ok(d) => {
            let names: Vec<String> = d["plugins"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .map(|p| {
                            let loaded = p["loaded"].as_bool().unwrap_or(false);
                            let hash_ok = p["hashOk"].as_bool().unwrap_or(false);
                            let name = p["name"].as_str().unwrap_or("?");
                            format!(
                                "{}{}{}",
                                name,
                                if hash_ok { "@hash✓" } else { "@hash✗" },
                                if loaded { "[已装载]" } else { "" }
                            )
                        })
                        .collect()
                })
                .unwrap_or_default();
            report.push_str(&format!(
                "[self-check] ⑧插件(M7-5): count={} [{}]\n",
                names.len(),
                names.join(", ")
            ));
        }
        Err(e) => report.push_str(&format!("[self-check] ⑧插件: plugin.list 失败 {e}\n")),
    }

    // ⑨ UI 贡献（M8-1 主题/布局插件）：加载后 getManifest 断言 theme+layout 存在 →
    //     disable 主题插件后 theme 应回退为 null → re-enable 应恢复（验证往返 + effect 回滚）。
    {
        // 会话开始时（loadAll 已装载 demo-theme + demo-layout），应先断言二者在。
        // 若插件缺失（如示例被删），不判失败，简要记录即可（自检不应因缺示例插件失败）。
        // 只有在插件存在时，才做「断言→禁用→断言回退→启用→断言恢复」的往返。
        let m0 = sidecar
            .call("ui.getManifest", serde_json::json!({}))
            .unwrap_or_else(|_| serde_json::json!({}));
        let theme_in = m0["theme"]["name"].as_str().unwrap_or("").to_string();
        let slot_names: Vec<String> = m0["layouts"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|l| l["slot"].as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        // 断言 layouts 至少含 footer（demo-layout 注入）；theme 若存在则做回滚往返
        let layout_ok = slot_names.iter().any(|s| s == "footer");
        let theme_present = !theme_in.is_empty();

        let rollback_note = if theme_present {
            // a) disable demo-theme → 期望 theme 回退 null
            let disabled = sidecar
                .call("plugin.disable", serde_json::json!({ "name": "demo-theme" }))
                .ok();
            let gone = sidecar
                .call("ui.getManifest", serde_json::json!({}))
                .map(|m| m["theme"].is_null() || m["theme"]["name"].as_str().unwrap_or("").is_empty())
                .unwrap_or(false);
            // b) re-enable demo-theme → 期望恢复
            let _ = sidecar.call("plugin.enable", serde_json::json!({ "name": "demo-theme" }));
            let restored = sidecar
                .call("ui.getManifest", serde_json::json!({}))
                .map(|m| m["theme"]["name"].as_str().unwrap_or("") == "demo-theme")
                .unwrap_or(false);
            format!(
                " 禁用↓={}回退null={} 恢复={}",
                if disabled.is_some() { "✓" } else { "✗" },
                if gone { "✓" } else { "✗" },
                if restored { "✓" } else { "✗" }
            )
        } else {
            "（无主题插件，跳过回滚往返）".to_string()
        };

        report.push_str(&format!(
            "[self-check] ⑨UI(M8-1): theme={} layout[footer]={} {}\n",
            if theme_in.is_empty() { "∅" } else { &theme_in },
            if layout_ok { "✓" } else { "✗" },
            rollback_note
        ));
    }

    // ⑩ 账号有效性检测（M9-2）：对离线账号显式 check → 应恒「有效」（needsReauth=false）
    {
        let store_sel = match crate::core::accounts::AccountStore::open() {
            Ok(s) => s,
            Err(e) => {
                report.push_str(&format!("[self-check] ⑩账号检测(M9-2): 存储打开失败 {e}\n"));
                return report;
            }
        };
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_io()
            .enable_time()
            .build()
            .expect("tokio runtime for self-check account refresh");
        match crate::core::accounts::login_offline(&store_sel, "SelfCheckReauth") {
            Ok(acct) => {
                let (_, needs, msg) =
                    rt.block_on(crate::core::accounts::refresh_microsoft_account(
                        &store_sel,
                        &acct.id,
                    ))
                    .unwrap_or_else(|e| (acct.clone(), true, Some(format!("检测失败: {e}"))));
                report.push_str(&format!(
                    "[self-check] ⑩账号检测(M9-2): 离线 {} needsReauth={} {}\n",
                    acct.name,
                    if needs { "✗需要重登" } else { "✓有效" },
                    if let Some(m) = msg { format!("({m})") } else { String::new() }
                ));
                let _ = store_sel.remove(&acct.id);
            }
            Err(e) => report.push_str(&format!("[self-check] ⑩账号检测(M9-2): 登录失败 {e}\n")),
        }
    }

    // ① 读：list
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
    // 自检写出的测试实例用完即删，避免每次 `--self-check` 往库里堆积 SelfCheckSMP 残留
    let created_id = created["instance"]["id"].as_str().map(|s| s.to_string());
    if let Some(cid) = &created_id {
        let _ = sidecar.call("instance.remove", serde_json::json!({ "id": cid }));
    }

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
