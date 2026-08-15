# M4 — 真实启动 ✅ 完成

> 目标：打通「**真能启动 MC**」主线 —— `instance.launch` 用 lighty-launch 完整 pipeline 真实启动，
> 版本清单补全 `java_major`（供启动选 JRE），下载/安装进度从「模拟」换成 lighty 真实进度事件回传。
> 手动确认：游戏窗口真实拉起正常运行。

## 交付物

| 层 | 改动 | 验证 |
|---|---|---|
| **Rust 内核** | `launch.rs` 接入 lighty 完整启动 pipeline：`VersionBuilder → OfflineAuth → launch()`（metadata → JRE 下载 → 8 桶 install → spawn JVM）；新增 `mod_loader_to_loader()` 映射、`enrich_java_major()` 补版本 json、`launch_game()` async、`LaunchContext` 进度桥接（`.with_observer` 供无头验证）、`launch_smoke()`；`instance_launch` command 改为**本地 LaunchAdapter**（不再转发 sidecar），sidecar 仅取实例详情 | `--self-check` 全绿 ✓ |
| **真实进度事件** | 用 `tokio::select!` 同时驱动 launch future + EventBus，把 `JavaEvent::JavaDownload{Started,Progress,Completed}` 和 `LaunchEvent::Install{Started,Progress,Completed}` 实时桥接为 `download:progress`（替换 M3 的模拟 `emit_download_progress`） | 冒烟捕获 **19353 条真实进度事件** ✓ |
| **版本清单 java_major** | `fetch_java_major()` 逐条拉版本 json 解析 `javaVersion.majorVersion`；`version_manifest` command 补全前 20 条 | `⓪清单: 26.3-snapshot-8 (java 25)` ✓ |
| **Cargo 依赖** | 新增 `lighty-loaders`(v+f+q+neo+forge)、`lighty-auth/events`、`lighty-core`、`lighty-event`、`lighty-java`、`lighty-modsloader`、`tokio` | 编译全绿 ✓ |

## 验证详情

### 1. `--self-check`（真实网络）
```
⓪清单: 60 个版本；前3= [26.3-snapshot-8 (java 25), 26.3-snapshot-7 (java 25), 26.3-snapshot-6 (java 25)]
⓪清单: 最新 release = 26.3-snapshot-8（真实拉取）
④Loader映射: [vanilla✓, fabric✓, quilt✓, neoforge✓, forge✓]
①list=... ②create=... ③list=... 读/写/回读全链路通过
```

### 2. 真实下载进度事件回传（`--self-check launch smoke 1.21.4 vanilla`，无 GUI 观察）
```
[launch冒烟] 启动报错: 游戏进程已启动但未捕获到 pid；但观察到真实进度=19353 条
 （示例: ["jre downloading 0/52069757 (0%)", "jre downloading 16384/52069757 (0%)", ...]）
```
证明 lighty 真实下载（JRE 52MB）的 Install/Download 进度被完整实时捕获、桥接。

### 3. 游戏真实启动（GUI 手动确认）
通过 `instance_launch` command 触发完整 pipeline：先下载 JRE + MC 客户端/库/资源，
随后真正拉起 JVM、**游戏窗口正常运行**。

## 踩坑记录

1. **`tokio::spawn` 报 "no reactor running"**：`launch_game` 内 `tokio::spawn` 进度监听 task 在 `Runtime::block_on` 里报此错。
   改用 **`tokio::select!`** 同时驱动 launch future + rx.next()，彻底避免额外 task 依赖 runtime context。
2. **`select!` 需 pin**：`LaunchBuilder::run()` 返回的 future 需 `tokio::pin!(launch_fut)` 才能被 `&mut` poll。
3. **重复 poll 已完成 future 会 panic `async fn resumed after completion`**：lighty `run()` 完成后再 poll 即崩。
   用 `if launch_result.is_none()` **guard** 把已完成分支禁用，不再 poll。
4. **lighty `run()` 在游戏运行期间不返回**：`handle_console_streams` 保持 JVM 进程存活，
   所以 `launch_game` 会阻塞到游戏退出。GUI 场景这是期望行为（游戏窗口出现即算启动成功）；
   self-check 冒烟需靠外层 shell `timeout` 限定观察。
5. **`java_major` 逐条拉 json 慢**：给 `enrich_java_major(entries, limit)` 加 limit（GUI 前 20 条），避免一次 60 个网络请求。
6. **`AppState` 全局只初始化一次**：用 `AtomicBool` guard，进程内防二次 `init()` 失败。
7. **CLI argv 踩坑**：`std::env::args()[0]` 是程序路径，`--self-check launch` 解析要 `skip(1)` 跳过。

## 尚未完成（M5/后续起点）
- **微软/Microsoft 认证**（lighty-auth 的 `Microsoft` 流程，替换 `OfflineAuth`；实例表需 user 字段）
- **具体 loader 版本解析**：`loader_version` 目前 vanilla 用空串、其它用 `"latest"` 占位，需从元数据/用户选择解析精确版本
- **pid 返回竞态**：`Launched` 事件在游戏运行时被后续事件淹没，返回 pid 的时序需在 GUI 真实场景再核对
- 主题切换 MVP / Phase 0 插件装载（架构文档原规划的正统「插件化 MVP」）
- 前端下载页接入真实进度（当前进度事件链路已验证，Vue 绑定待接 `instance_launch` 触发时的真实进度）
