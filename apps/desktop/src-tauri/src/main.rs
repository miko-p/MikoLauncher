// MC Launcher 桌面壳入口。
// `--self-check` 时跑 Rust 内核自检，不进 GUI；否则启动 Tauri。

fn main() {
    let check_mode = std::env::args().any(|a| a == "--self-check");
    if check_mode {
        println!("{}", mc_launcher_lib::self_check());
        return;
    }
    mc_launcher_lib::run();
}
