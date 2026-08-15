// M0 POC2b：Rust 宿主（即未来 Tauri 后端）拉起 Node sidecar 并完成 JSON-RPC 往返。
// 目标：证明「Rust 后端可作为宿主 spawn 一个 Node 子进程，用 stdin/stdout 走
//        JSON-RPC 契约」这条核心链路成立 —— 这是 Tauri 后端 + Node sidecar(Cordis)
//        混合架构的根基。
//
// 说明：POC 阶段用 std::process（语义与 tauri_plugin_shell 的 Command 一致，
//       后者只是多了 externalBin 打包与生命周期管理）。真正接入 Tauri 在 M1 骨架。
// 运行：cargo run --release

use serde_json::json;
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

// 被拉起的 Node sidecar 逻辑：stdin 读 JSON 行 → stdout 回 pong
const SIDECAR: &str = r#"
process.stdin.setEncoding('utf8');
let buf = '';
process.stdin.on('data', (c) => {
  buf += c;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line) continue;
    const req = JSON.parse(line);
    if (req.method === 'ping') {
      process.stdout.write(JSON.stringify({ id: req.id, apiVersion: 1, ok: true, data: { pong: 'from-node-sidecar' } }) + '\n');
    } else if (req.method === 'info') {
      process.stdout.write(JSON.stringify({ id: req.id, apiVersion: 1, ok: true, data: { node: process.version, plugins: req.params.plugins || [] } }) + '\n');
    }
  }
});
process.stdin.on('end', () => process.exit(0));
"#;

fn main() {
    println!("[POC2b] Rust 宿主 → Node sidecar JSON-RPC 往返验证开始...");

    // 1) 充当未来 Tauri Rust 后端：spawn Node sidecar 子进程
    let mut child = Command::new("node")
        .args(["-e", SIDECAR])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("无法拉起 node sidecar —— 请确认 node 在 PATH");

    let mut stdin = child.stdin.take().expect("sidecar stdin");
    let stdout = child.stdout.take().expect("sidecar stdout");
    let mut reader = BufReader::new(stdout);

    // 需要跨多次读的简单 helper：写一行，读一行
    fn rpc(stdin: &mut std::process::ChildStdin, reader: &mut BufReader<std::process::ChildStdout>,
           id: u64, method: &str, params: serde_json::Value) -> serde_json::Value {
        let req = json!({ "id": id, "apiVersion": 1, "method": method, "params": params });
        writeln!(stdin, "{}", req).expect("写请求失败");
        stdin.flush().expect("flush 失败");
        let mut line = String::new();
        reader.read_line(&mut line).expect("读响应失败");
        serde_json::from_str(&line).expect("响应非合法 JSON")
    }

    // 2) 发 ping
    let r1 = rpc(&mut stdin, &mut reader, 1, "ping", json!({}));
    println!("[POC2b] ping 响应: {}", r1);
    assert_eq!(r1["ok"], json!(true));
    assert_eq!(r1["data"]["pong"], json!("from-node-sidecar"));

    // 3) 发 info（携带插件清单，模拟未来向 sidecar 声明已装插件）
    let r2 = rpc(&mut stdin, &mut reader, 2, "info", json!({ "plugins": ["theme-dracula", "layout-classic"] }));
    println!("[POC2b] info 响应: {}", r2);
    assert_eq!(r2["ok"], json!(true));
    assert_eq!(r2["data"]["plugins"], json!(["theme-dracula", "layout-classic"]));

    // 4) 优雅结束
    drop(stdin);
    let _ = child.wait();

    println!("[POC2b] 通过：Rust 宿主成功拉起 Node sidecar 并完成两条 JSON-RPC 往返。");
    println!("[POC2b] 结论：Tauri 后端 + Node sidecar(Cordis) 混合架构的进程链路可行。");
}
