//! Node sidecar 宿主管理 —— Rust 核心 ⇄ plugin-host(Cordis) 的 JSON-RPC 链路。
//!
//! 对应蓝图「七、IPC 契约」+ M0 V2 验证的 `std::process` 方案。
//!
//! 进程布局：
//!   Tauri 后端 ──JSON 行(stdin/stdout)──> Node sidecar (plugin-host)
//!
//! M2 改动：
//!   - 支持在指定 cwd 通过 shell 命令启动（dev 用本地 tsx 跑 plugin-host 源码）
//!   - `call` 仍是同步阻塞一问一答；多个 command 并发时由调用方用 Mutex 串行。
//!     包一层 `SyncSidecar` 提供 `Mutex<SidecarClient>` 的便捷封装，供 AppState 使用。

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

/// 与 plugin-host sidecar 的 JSON-RPC 客户端（单连接，调用方需保证串行）。
pub struct SidecarClient {
    child: Child,
    stdin: ChildStdin,
    reader: BufReader<ChildStdout>,
    next_id: u64,
}

/// 结构化错误（对齐 @miko-launcher/shared 的 RpcError）
#[derive(Debug)]
pub struct RpcCallError {
    pub code: String,
    pub message: String,
}

impl std::fmt::Display for RpcCallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl SidecarClient {
    /// 直接 spawn 一个命令作为 sidecar（适用于显式可执行路径 / node 直启）。
    pub fn spawn(bin: &str, args: &[&str]) -> std::io::Result<Self> {
        Self::spawn_in(None, bin, args)
    }

    /// 在指定工作目录 `cwd` 下启动 sidecar 命令。
    /// dev 场景：cwd = <repo>/apps/plugin-host，bin = ./node_modules/.bin/tsx（或绝对路径）。
    pub fn spawn_in(cwd: Option<&str>, bin: &str, args: &[&str]) -> std::io::Result<Self> {
        let mut cmd = Command::new(bin);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // sidecar 业务日志走 stderr（与 stdout 严格分离，stdout 只留 JSON 行）
            .stderr(Stdio::inherit());
        if let Some(c) = cwd {
            cmd.current_dir(c);
        }
        let mut child = cmd.spawn()?;
        let stdin = child.stdin.take().expect("sidecar stdin");
        let stdout = BufReader::new(child.stdout.take().expect("sidecar stdout"));
        Ok(Self {
            child,
            stdin,
            reader: stdout,
            next_id: 1,
        })
    }

    /// 发起一次 JSON-RPC 请求，同步等待响应。返回响应对象的 `data` 字段。
    /// 防御性：连续读到非 JSON 或 id 不匹配的行会跳过（防止日志污染 stdout）。
    pub fn call(&mut self, method: &str, params: Value) -> Result<Value, RpcCallError> {
        let id = self.next_id;
        self.next_id += 1;
        let req = json!({ "id": id, "apiVersion": 1, "method": method, "params": params });
        writeln!(self.stdin, "{}", req).map_err(|e| RpcCallError {
            code: "WRITE_FAILED".into(),
            message: e.to_string(),
        })?;
        self.stdin.flush().ok();

        loop {
            let mut line = String::new();
            self.reader.read_line(&mut line).map_err(|e| RpcCallError {
                code: "READ_FAILED".into(),
                message: e.to_string(),
            })?;
            if line.trim().is_empty() {
                return Err(RpcCallError {
                    code: "CONNECTION_CLOSED".into(),
                    message: "sidecar stdout 关闭".into(),
                });
            }
            // 只认 id 与我们请求 id 匹配的 JSON 行；否则跳过（可能是残留 stdout 日志）。
            let res: Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if res.get("id").and_then(|v| v.as_u64()) != Some(id) {
                continue;
            }
            if res["ok"] == json!(true) {
                return Ok(res["data"].clone());
            } else {
                return Err(RpcCallError {
                    code: res["error"]["code"].as_str().unwrap_or("RPC_ERROR").into(),
                    message: res["error"]["message"]
                        .as_str()
                        .unwrap_or("unknown error")
                        .into(),
                });
            }
        }
    }

    /// 关闭 stdin（触发 sidecar 的 dispose/exit）+ 回收进程。
    pub fn shutdown(mut self) -> i32 {
        drop(self.stdin);
        self.child
            .wait()
            .map(|s| s.code().unwrap_or(1))
            .unwrap_or(1)
    }
}

/// 共享 sidecar：用 `Mutex` 包住客户端，使 Tauri command 可并发安全调用。
/// 每次 `call` 会短暂持锁作一问一答（sidecar 处理极快，冲突概率低）。
///
/// 启动失败时可用 `SyncSidecar::degraded(reason)` 得到一个"占位"实例，
/// 任何 `call` 都返回该 reason，UI 可友好提示（而不是让整个应用崩溃）。
pub struct SyncSidecar(Option<std::sync::Mutex<SidecarClient>>, Option<String>);

impl SyncSidecar {
    /// 在指定 cwd 启动 sidecar 并包成共享句柄。
    pub fn start(cwd: &str, bin: &str, args: &[&str]) -> Result<Self, String> {
        let client = SidecarClient::spawn_in(Some(cwd), bin, args).map_err(|e| e.to_string())?;
        Ok(SyncSidecar(Some(std::sync::Mutex::new(client)), None))
    }

    /// 启动失败占位：后续所有调用返回 `reason`。
    pub fn degraded(reason: String) -> Self {
        SyncSidecar(None, Some(reason))
    }

    /// 是否就绪。
    pub fn is_ok(&self) -> bool {
        self.0.is_some()
    }

    /// 并发安全的同步调用。
    pub fn call(&self, method: &str, params: Value) -> Result<Value, RpcCallError> {
        let Some(tx) = &self.0 else {
            let reason = self
                .1
                .clone()
                .unwrap_or_else(|| "sidecar not initialized".into());
            return Err(RpcCallError {
                code: "SIDECAR_UNAVAILABLE".into(),
                message: reason,
            });
        };
        let mut guard = tx.lock().map_err(|_| RpcCallError {
            code: "LOCK_POISONED".into(),
            message: "sidecar mutex poisoned".into(),
        })?;
        guard.call(method, params)
    }
}
