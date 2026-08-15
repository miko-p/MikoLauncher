// MikoLauncher 桌面壳入口。
// `--self-check` 跑 Rust 内核自检（清单/映射/sidecar 往返），不进 GUI；
// `--self-check launch` 额外跑一次真实启动冒烟（有界下载+进度观察）。
// 否则启动 Tauri。

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let check_mode = args.iter().any(|a| a == "--self-check");
    if check_mode {
        let launch_mode = args.iter().any(|a| a == "launch");
        if launch_mode {
            // `--self-check launch <name> <version> <loader>`（跳过 argv[0]=程序路径）
            let pos: Vec<&String> = args
                .iter()
                .skip(1) // argv[0]
                .filter(|a| *a != "--self-check" && *a != "launch")
                .collect();
            let name = pos.first().map(|s| s.as_str()).unwrap_or("smoke");
            let ver = pos.get(1).map(|s| s.as_str()).unwrap_or("1.21.4");
            let loader = pos.get(2).map(|s| s.as_str()).unwrap_or("vanilla");
            println!("{}", miko_launcher_lib::launch_smoke(name, ver, loader));
        } else {
            println!("{}", miko_launcher_lib::self_check());
        }
        return;
    }
    miko_launcher_lib::run();
}
