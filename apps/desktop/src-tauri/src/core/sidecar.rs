//! Node sidecar 宿主管理 —— Rust 核心 ⇄ plugin-host(Cordis) 的 JSON-RPC 链路。
//!
//! 对应蓝图「七、IPC 契约」+ M0 V2 验证的 `std::process` 方案升级版。
//! 骨架阶段用 `std::process::Command` 直接 spawn（语义与 tauri-plugin-shell 的
//! Command 一致）；打包接 externalBin 后换 tauri_plugin_shell 即可，语义不变。
//!
//! 进程布局：
//!   Tauri 后端 ──JSON 行(stdin/stdout)──> Node sidecar (plugin-host)

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

/// 与 plugin-host sidecar 的 JSON-RPC 客户端。
pub struct SidecarClient {
    child: Child,
    stdin: ChildStdin,
    reader: BufReader<ChildStdout>,
    next_id: u64,
}

/// 图灵测试用的结构化错误（对齐 @mc-launcher/shared 的 RpcError）
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
    /// 拉起 Node sidecar。`entry` 是 sidecar 的启动命令 + 参数。
    /// dev 下可用 tsx 直接跑源代码；生产用 pkg/bun 打包的单文件二进制。
    pub fn spawn(node_bin: &str, args: &[&str]) -> std::io::Result<Self> {
        let mut child = Command::new(node_bin)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // sidecar 业务日志走 stderr，stdout 只留纯 JSON 行
            .stderr(Stdio::inherit())
            .spawn()?;
        let stdin = child.stdin.take().expect("sidecar stdin");
        let stdout = BufReader::new(child.stdout.take().expect("sidecar stdout"));
        Ok(Self {
            child,
            stdin,
            reader: stdout,
            next_id: 1,
        })
    }

    /// 发起一次 JSON-RPC 请求，等待响应。返回响应对象的 `data` 字段。
    pub fn call(&mut self, method: &str, params: Value) -> Result<Value, RpcCallError> {
        let id = self.next_id;
        self.next_id += 1;
        let req = json!({ "id": id, "apiVersion": 1, "method": method, "params": params });
        writeln!(self.stdin, "{}", req).map_err(|e| RpcCallError {
            code: "WRITE_FAILED".into(),
            message: e.to_string(),
        })?;
        self.stdin.flush().ok();

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
        let res: Value = serde_json::from_str(&line).map_err(|e| RpcCallError {
            code: "BAD_JSON".into(),
            message: e.to_string(),
        })?;

        if res["ok"] == json!(true) {
            Ok(res["data"].clone())
        } else {
            Err(RpcCallError {
                code: res["error"]["code"].as_str().unwrap_or("RPC_ERROR").into(),
                message: res["error"]["message"]
                    .as_str()
                    .unwrap_or("unknown error")
                    .into(),
            })
        }
    }

    /// 优雅关闭：关 stdin（触发 sidecar 的 dispose/exit）+ 回收进程。
    pub fn shutdown(mut self) -> i32 {
        drop(self.stdin);
        self.child
            .wait()
            .map(|s| s.code().unwrap_or(1))
            .unwrap_or(1)
    }
}
