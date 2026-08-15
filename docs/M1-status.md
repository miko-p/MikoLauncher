# M1 — 骨架搭建 ✅ 完成

> 对应 `mc-launcher-architecture.md`「十三、下一步（M1）」。
> 交付物全部落地并逐一验证通过。

## 交付物与验证状态

| 交付物 | 状态 | 验证命令 / 结果 |
|---|---|---|
| 1. pnpm monorepo（desktop / plugin-host / shared / plugins） | ✅ | `pnpm install` 干净通过 |
| 2. packages/shared 首批 Zod IPC 契约 | ✅ | `tsc -p tsconfig.json` 构建通过 |
| 3. Rust 侧 LightyLauncherLib command 骨架 | ✅ | `cargo check` 零警告；`cargo run -- --self-check` 返回 2 个版本条目 |
| 4. Node plugin-host 骨架（复用 M0 Cordis API） | ✅ | 见下方 IPC 全链路验证 |

## 验证详情

### 2. shared Zod 契约（packages/shared/src）
- `protocol.ts` — JSON-RPC 信封 + `API_VERSION` + 错误码 + `makeRequest/makeOk/makeErr`
- `entities.ts` — Version / Instance / Mod / Account / ModLoader（对齐蓝图 Domain 层）
- `methods.ts` — instance.list/get/create/remove/launch + 下载进度事件(DownloadProgressSchema) + `methodRegistry`

### 4. plugin-host IPC 全链路（apps/plugin-host）
管道喂入 7 条请求逐一验证：

```text
instance.list   → ok:true, instances:[]
instance.create → ok:true, 返回 UUID/版本/加载器实例
instance.list   → ok:true, 能看到刚创建的实例（内存态保持）
instance.get    → ok:true, 不存在时 instance:null
instance.launch → ok:false INTERNAL_ERROR「M2 接入 Rust 内核」
unknown.method  → ok:false METHOD_NOT_FOUND
apiVersion=2    → ok:false VERSION_MISMATCH
```
- 退出路径：stdin 关闭 → Cordis 整树 dispose → 所有插件 effect 逆序回滚（实测输出 `instance.* handler 已全部反注册`）。
- stdout 只走 JSON 行，业务日志走 stderr（干净分离，供 Rust 宿主解析）。

### 3. Rust 内核（apps/desktop/src-tauri）
- `cargo run -- --self-check` → `fetch_version_manifest() → 2 个版本条目（骨架数据）`
- 前端：`pnpm --filter @mc-launcher/desktop build` → vue-tsc 类型检查 + vite 生产构建通过
- Tauri 2 + lighty-launch + lighty-version + tauri-plugin-shell 全部编译零警告

## 关键决策 / 踩坑记录
1. **pnpm 11 构建脚本策略**：`onlyBuiltDependencies` 已弃用；改为 pnpm-workspace.yaml 里 `allowBuilds: { esbuild: true, vue-demi: true }`。否则 esbuild 不装原生二进制、且每次 `pnpm run` 都被 reinstall-check 卡住。
2. **cordis 版本锁定** `4.0.0-rc.8`（与 POC 一致；`^4.0.0` 需显式 rc）。
3. Tauri 2 窗口 config 无 `icon` 字段（会解析报错）；应用图标由 `bundle.icon` 提供。
4. `@tauri-apps/cli` 版本需与 `tauri-build` 匹配，否则配置解析报 unknown field。
5. plugin-host 的 `inject` 用 `ServiceName.xxx` 常量表，避免同名服务重复注册（POC 注意点 1）。

## 尚未完成（M2 起点）
- 完整 Tauri GUI `tauri dev` 实跑（前端 invoke ↔ Rust ↔ sidecar 三端联通）
- sidecar 常驻连接（当前 Rust 端 instance.* 为骨架占位，M2 转发 plugin-host）
- LightyLauncherLib 真实下载 / 版本清单线上拉取 / JVM 启动
- SQLite + Drizzle 持久化
