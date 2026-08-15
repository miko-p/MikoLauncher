# M3 — 真实能力增强 ✅ 完成

> 目标：把 M2 的"联通骨架"升级为真实能力 —— 真实版本清单、SQLite 持久化、下载进度事件。
> `instance.launch` 真实启动内核（lighty-launch 完整 pipeline）按 scope 留到 M4。

## 交付物

| 层 | 改动 | 验证 |
|---|---|---|
| **Rust 内核** | `launch.rs` 真实拉取 Mojang `version_manifest_v2.json`（reqwest blocking），替代 M1 硬编码 2 条；`version_manifest` command 返回 60 个真实版本；新增 `emit_download_progress` command（模拟下载进度 → emit `download:progress` 事件） | `--self-check ⓪清单: 60 个版本` ✓ |
| **plugin-host** | 新增 `services/db.ts`（better-sqlite3 SQLite 持久化，WAL）；`InstanceManagerService` 从内存 Map 改为落库（list/get 读库，create/remove 写库，卸载时 db.close 作 effect 回滚）；新增 `augmentations.d.ts` 给 Context 注入 rustBridge/instanceManager 类型 | typecheck 全绿 ✓；重启后实例仍在 ✓ |
| **前端** | 新增 `stores/versions.ts` + `api.fetchVersions()` + `DownloadView`（真实版本列表 + 刷新 + 模拟下载进度按钮 + progress 条订阅） | GUI 事件流水线端到端 ✓ |

## 验证详情

### 1. 真实版本清单（`--self-check ⓪`）
```
清单: 60 个版本，最新 release = 26.3-snapshot-8   (Mojang 实时拉取)
```

### 2. SQLite 持久化（重启存活）
```
RUN1: instance.create(PersistTest,1.21.4,fabric) → id b111755f-...
      （进程退出，数据落盘 data/mc-launcher.db）
RUN2: 全新进程 → instance.list 仍返回 PersistTest  ✓   ← 证明跨重启持久化
```

### 3. 下载进度事件流水线（GUI 实跑）
点「模拟下载进度」→ AX 树实时渲染：
```
"下载中：client.jar done"
"100 / 100 (100.0%)"
<progress> 条
```
证明：click → invoke('emit_download_progress') → Rust emit ×4 → 前端 listen('download:progress') → Vue 绑定更新 全链路通。

## 踩坑记录

1. **better-sqlite3 11 不兼容 Node 26 的 V8**（`v8::Object::GetPrototype`/`Context::GetIsolate` 已移除）。升级到 **13.0.3**（Node>=22, 2026-08 发版，支持 Node 26）后编译通过。
2. **cordis 4.0.0-rc.8 的 .d.ts 在 `moduleResolution: NodeNext` 下报 `relative import paths need explicit extensions`**（其 `export * from './service'` 无后缀）。改用 **`moduleResolution: Bundler`**（与 tsx/esbuild 运行时一致）解决。
3. **Context 服务类型增强文件名不能与 `context.ts` 同名**：`src/context.d.ts` 会被视为 `context.ts` 的声明文件而被遮蔽。改名 `augmentations.d.ts` 后生效。
4. **Rust 转发 schema 类型**用显式类型断言（`as {params:{safeParse...}}`）+ Handler 参数改 `any` 收窄。

## 尚未完成（M4 起点）
- **`instance.launch` 真实启动**：lighty-launch 的 `VersionBuilder → Installer → LaunchBuilder(JRE/参数/实例控制)` 完整 pipeline
- 下载进度事件从"模拟"换成真实 `Installer` 进度回传
- 版本清单项补 `java_major`（需拉每个版本 json），供启动选 JRE
- 账号/微软认证（lighty-auth）
- 主题切换 MVP / Phase 0 插件装载
