# M2 — 三端联通 ✅ 完成

> 目标：打通「前端(Vue invoke) ↔ Rust(Tauri) ↔ Node sidecar(Cordis)」三端。
> 承接 `docs/M1-status.md`「尚未完成」清单的第一项。

## 交付物

| 层 | 改动 |
|---|---|
| **Rust 核心** | `AppState` 持有常驻 `SyncSidecar`（Mutex 串行 + degraded 降级）；`resolve_plugin_host()` 统一路径推导（3 次 parent 到 repo 根）；command 转发 `instance.list/create/launch` 到 sidecar；`--self-check` 升级为读/写/回读三阶验证 |
| **Sidecar** | `SyncSidecar` 共享包装 + `degraded(reason)` 占位；`call()` 防御性跳过非 JSON / id 不匹配行；日志强制走 stderr 统一 `log()` |
| **前端** | `@tauri-apps/api` invoke 封装（`api/index.ts` on-Zod 校验）；Pinia 实例 store（VM 层）；实例页真实渲染 + 新建表单 + modLoader 下拉 |

## 验证结果（确定性）

### Rust↔sidecar 写路径（`cargo run -- --self-check`）
```text
①list        → {"instances":[]}
②create(SelfCheckSMP,1.21.4,fabric) → {instance:{id:UUID, ...createdAt}}
③list        → 看到刚创建的实例 ✓
读/写/回读全链路通过
```

### 三端读路径（`tauri dev` 实跑 GUI）
- `GDK_BACKEND=x11 WEBKIT_DISABLE_COMPOSITING_MODE=1` 启动成功（Wayland 下 GTK window 需 X11 backend）
- 实例页渲染出「**sidecar 已连接**」徽章 +「还没有实例」空态 → 证明 Vue `onMounted → store.fetchInstances() → invoke('instance_list') → Rust → sidecar → instanceManager → 响应 → 渲染` 实时闭环
- 新建表单可展开（+ 新建实例 → 名称/版本/加载器/创建按钮）

## 踩坑记录

1. **插件日志污染 stdout**：`builtin-instance.ts` 用 `console.log` 打日志，混进 Rust 按 JSON 行解析的 stdout，导致 `BAD_JSON`。修复：所有 sidecar 日志统一走 stderr 的 `log()`（context.ts），并对 Rust 端 `call()` 加了「跳过非 JSON / id 不匹配行」的防御。
2. **CARGO_MANIFEST_DIR 定位层级**：`.../src-tauri` 需 **3 次 parent** 才到 repo 根（src-tauri→desktop→apps→repo）。抽成 `resolve_plugin_host()` 单一入口，run() 与 self_check() 共用。
3. **tauri dev beforeDevCommand 用 `--dir` 相对路径**：从 src-tauri 执行会找不到；改成 pnpm workspace 的 `--filter @mc-launcher/desktop`。
4. **Wayland 下 GTK 窗口报错**：`Gdk-Message Error 71 dispatching to Wayland display` 让窗口刚开就退。用 `GDK_BACKEND=x11` 解决。
5. GUI 写路径（create 提交）自动化难以稳定验证：该 WebKit/AT-SPI 不暴露 input value、无 vision provider、坐标 click 抖动。改用确定性 `--self-check` 三阶往返证明写路径，GUI 读路径已实时渲染验证。

## 尚未完成（M3 起点）
- plugin-host 常驻 + 真实 `instance.launch`（接 lighty-launch 启动内核）
- LightyLauncherLib 真实版本清单 / JVM 下载 / 启动
- SQLite + Drizzle 持久化（当前实例为 sidecar 内存态）
- 下载页接入版本清单 + 下载进度事件
- 主题切换 MVP / 插件装载（Phase 0）
