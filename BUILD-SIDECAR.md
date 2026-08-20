# Sidecar 打包与发布（M8-B 现状）

## 现状（M8-1 骨架已完成并验证）

Rust 核心 `resolve_plugin_host()` 已支持**两层启动**：
1. **打包版（externalBin）**：`current_exe()` 同目录下找 `plugin-host` 可执行文件。
2. **dev（源码）**：本地 tsx 跑 `apps/plugin-host/src/main.ts`。

`tauri.conf.json` 已声明 `bundle.externalBin: ["binaries/plugin-host"]`，产物须放
`src-tauri/binaries/plugin-host-<target-triple>`（当前 `x86_64-unknown-linux-gnu`）。

`apps/plugin-host` 新增 `build` 脚本（esbuild，devDependency）：
```bash
pnpm --filter @miko-launcher/plugin-host build   # 产出 dist/main.mjs（~196KB）
```
esbuild 把 cordis + @miko-launcher/shared + 全部 src 打成单文件 ESM，**仅剩
better-sqlite3（原生 .node 模块）为 external**——它运行时从打包目录 node_modules 加载。
已验证：`node dist/main.mjs` 直接跑通 Cordis 全链路（服务挂载 / instance.* handler /
effect 回滚），输出 `{"ok":true,"data":{instances:[]}}`。

## 卡点：发布版的 Node 运行时来源

esbuild 产物仍需要**一个能跑 better-sqlite3 的 Node 运行时**（better-sqlite3 是
`NODE_MODULE_VERSION` 绑定的原生模块）。当前仓库内的 `binaries/plugin-host-<triple>`
只是**验证用 wrapper**（shebang `#!/usr/bin/env node`，依赖目标机有 node + 源码布局），
**不能作为正式发布产物**。

正式发布需二选一（待拍板）：
- **A（单文件内嵌，推荐，体积最小）**：用 `@yao-pkg/pkg` 或 `bun build --compile` 把
  sidecar 打成一发可执行文件（内嵌 Node，无需目标机装 node）。风险：better-sqlite3 原生
  模块 + Node≥26 的 `NODE_MODULE_VERSION` 匹配，可能需换 `node:sqlite`/重编原生模块，耗时不可控。
- **B（内置 Node 运行时进 externalBin，体积较大）**：externalBin 打包一个 bun/node 可执行
  文件，plugin-host 的 JS + node_modules 作为 `resources` 打包，运行时用打包的 bun 跑
  `dist/main.mjs`。绕开原生模块内嵌难题，但发布体积大几十 MB。

**在选型落地前，externalBin 配置保持现状**（wrapper 让 `cargo check`/`tauri build` 骨架可过），
真正的可分发二进制待选型后替换 `binaries/plugin-host-<triple>`。

## 验证记录
- `cargo check / clippy`：通过，零告警（externalBin 文件在位时）。
- self-check ⑧：有兄弟 `<exe>同目录/plugin-host` → 走打包分支；无 → tsx 回退。
- `node dist/main.mjs` 独立跑：通过。
- 注意：wrapper 被**复制到别处**后其"反推 repo 根"的绝对路径会失效（开发定位 bundle 采用
  `dist/main.mjs` 相对路径或注入环境变量的方式，勿用反推源码布局）。
