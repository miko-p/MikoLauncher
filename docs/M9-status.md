# M9 — 发布 runtime + 账号失效重登 + 插件管理（进行中）

> 目标：落地 M9 起点清单（见 `MikoLauncher-architecture.md` §十三）。
> 本轮完成 **M9-2 微软静默刷新失败后的重登录 UI**、**M9-3 插件启用状态持久化**、
> **M9-4 发布 runtime 选型落地（方案 A 单文件内嵌，跑通 `tauri build` 出安装包）**、
> **M9-5 发布 runtime 收尾（CI 纳入 sidecar 构建 + 跨平台三端打包流水线）**；
> 其余项（多账号快捷切换、插件分发演进）仍待后续推进。

## 交付物

| 目标 | 改动 | 验证 |
|---|---|---|
| **微软静默刷新失败重登（M9-2）** | 契约：`account.refresh` + `needsReauth` 信号（shared）；Rust `account_refresh` command + `accounts.rs` `refresh_microsoft_account()`（只读检测，离线恒有效 / 微软静默刷新区分失效）；前端账号页挂载自动检测 + 失效「需重新登录」标记/原因/入口 + 手动「检查」按钮 | `--self-check ⑩` ✓；Rust 单测 ✓；`pnpm build` 全绿 ✓；clippy 零告警 ✓ |
| **插件启用状态持久化（M9-3）** | `plugin-manager` 新增 `plugin-state.json` 启用状态落盘（缺省全启用）；`enable/disable` 持久化期望状态；`loadAll` 按状态选择性装载（禁用插件重启后不自动加载）；`plugin.list` 返回 `enabled`；前端插件页展示「启用/已停用」徽标 + hover 说明 | dev tsx ✓ + 生产 bundle ✓ 双路径「禁用→重启→不加载→启用→重启→恢复」往返；self-check ⑧⑨✓ |
| **发布 runtime 选型落地（M9-4）** | 方案 A 单文件内嵌：SQLite 迁移到 Node 内置 `node:sqlite`（去原生模块）→ `bun build --compile` 打单文件可执行 → `tauri.conf.json` `bundle.externalBin` 打包；Rust `release_envs()` 注入 `MC_LAUNCHER_DATA_DIR`/`MIKO_PLUGINS_DIR` 显式定位数据/插件目录；`apps/plugin-host/build-binary.sh` 一键产出；修掉 `frontendDist` 路径错位 | `target/release/miko-launcher --self-check` 打包分支 + env 注入全链路 ✓；deb/rpm/AppImage 三包均含 `plugin-host` sidecar ✓；AppImage 解包 `AppRun --self-check` ✓ |
| **修复 M8-B bundle 路径错位** | `resolveHostRoot()` 兼容 dev（`src/services`）与 bundle（`dist`）两种 `import.meta.url` 形态 | 生产 `dist/main.mjs` 能扫到 `plugins/` + 数据目录 ✓（原为扫不到/落错目录） |
| **发布 runtime 收尾（M9-5）** | `build-binary.sh` 跨平台（Windows `.exe` + 落位改 `cp`）；`resolve_plugin_host()` 打包分支按 `cfg!(windows)` 找 companion；`ci.yml` 加 sidecar smoke（bun 常驻）；新增 `release.yml` 三端矩阵（Linux `NO_STRIP=1` 出 deb/rpm/AppImage、macOS universal、Windows msi/nsis）打 tag 打包并由 create-release 作业汇总 GitHub Release | YAML 校验 ✓；Linux 本机 `build-binary.sh` 复跑 ✓（单文件 ~65MB 可执行）；`--self-check` 兼容 ✓ |

## 设计要点

- **「失效」的可操作路径**：此前微软 refresh_token 过期时，启动仅返回笼统「认证失败…需要重新登录」，用户无入口。M9-2 把它变成显式、可操作的流程：
  - `account.refresh`（`{ id }` → `{ account, needsReauth, message? }`）对指定微软账号做一次静默刷新检测，`needsReauth` 结构化区分「仍有效」/「已失效」。
  - 账号页挂载时自动对各微软账号检测；失效账号显示醒目「需重新登录」badge + 失效原因 + 「重新登录」按钮（走设备流重授权）+ 每账号手动「检查」。
- **只读检测**：`refresh_microsoft_account` 不修改持久化状态（不写 access_token）；需要写时才由调用方决定 upsert。避免“每次打开账号页都覆盖凭据”的副作用。
- **重登后状态**：设备流登录成功即代表凭据新鲜，store 清除全部失效标记；`check()` 成功也清除该账号标记。
- **契约即代码**：`needsReauth` 走 `packages/shared` 的 `accountRefreshDataSchema`，前端用 `.parse()` 校验，防 Rust↔TS 漂移。
- **M9-3 插件启用状态持久化**：`plugin-state.json`（`{ enabled: { name: bool } }`），缺省视为「全启用」与旧行为一致。
  - `enable/disable` RPC 在装载/卸载同时写期望状态到文件；`loadAll` 启动时只装载「启用且 hash 通过」的插件，禁用插件跳过并记日志。
  - `plugin.list` 附带 `enabled` 字段，前端据此显示「启用/已停用」，与 `loaded`（实际运行态）区分开。
  - 状态文件落在数据目录（env `MC_LAUNCHER_DATA_DIR` 或 `<plugin-host>/data`，gitignore 覆盖），不污染仓库。
- **M9-3 bundle 路径修复**：`resolveHostRoot()` 用 `import.meta.url` 目录名判断 dev（`src/services`）/ bundle（`dist`）形态，统一回到 `<plugin-host>` 根，再推导 `plugins/` 与 `data/`。修掉 M8-B 生产 bundle 原本扫不到插件、数据目录错位的缺陷。
- **M9-4 发布 runtime（方案 A 单文件内嵌）**：
  - **去原生模块**：SQLite 从 better-sqlite3 迁移到 Node 26 内置 `node:sqlite`（`DatabaseSync`），sidecar 无任何 native 依赖 → 可被 bun 干净内嵌。
  - **bun `--compile`**：`apps/plugin-host/build-binary.sh` 用 `bun build dist/main.mjs --compile` 打成一发可执行（内嵌 Bun runtime，体积 ~65MB），产物放 `src-tauri/binaries/plugin-host-<triple>`，经 `bundle.externalBin` 打包。
  - **发布定位盲区与解法**：bun 单文件运行时 `import.meta.url` 指向二进制自身，无法反推源码布局来定位数据/插件目录。Rust `release_envs()` 在打包分支注入 `MC_LAUNCHER_DATA_DIR`（`<lighty data_dir>/sidecar-data`）与 `MIKO_PLUGINS_DIR`（`<lighty data_dir>/plugins`），sidecar 端（db.ts / plugin-manager.ts）env 优先据此定位；dev 分支不注入保持源码反推。数据统一落 lighty 标准 data_dir（`~/.local/share/miko-launcher/`），与 accounts.json 一致。
  - **顺带修复**：`frontendDist` 从 `../desktop/dist` 改为 `../dist`（相对 `src-tauri/` 解析，原路径导致 `tauri build` 找不到前端产物）；CachyOS 上 AppImage 打包需 `NO_STRIP=1`（linuxdeploy 旧 strip 不认识新工具链的 `.relr.dyn`）。

## 验证详情

### 1. `--self-check` ⑩（新增）
```
[self-check] ⑩账号检测(M9-2): 离线 SelfCheckReauth needsReauth=✓有效
```
- 离线账号恒「有效」（`needsReauth=false`），无 message；测试账号用完即删（不堆积）。

### 2. Rust 单测
```
test core::accounts::tests::refresh_offline_account_is_never_reauth ... ok
```
- 覆盖：不存在账号报错「账号不存在」；离线账号 `needsReauth=false`、`message=None`、类型正确。

### 3. 全构建
- `pnpm run build`：shared tsc ✓ / desktop `vue-tsc --noEmit` + vite ✓ / plugin-host esbuild ✓。
- `cargo check / clippy`：零告警；`cargo test`：2 通过。

### 4. M9-3 持久化往返（dev tsx + 生产 bundle 双路径）
```
S1: plugin.disable("demo-greeter") → plugin.list: loaded=false, enabled=false
    状态文件: {"enabled":{"demo-greeter":false}}
S2: 重启 sidecar（同数据目录）→ plugin.list: demo-greeter loaded=false （不自动装载）✓
S3: plugin.enable("demo-greeter") → 状态文件 enabled=true
S4: 再次重启 → demo-greeter loaded=true（恢复装载）✓
```
- 生产 bundle（`dist/main.mjs`）同样跑通（修 `resolveHostRoot()` 后能扫到 plugins/ + 数据目录）。
- self-check ⑧⑨ 全绿（⑨ 的 demo-theme 禁用/启用往返也走持久化，最终回到 enabled 默认态）。

### 5. M9-4 发布 runtime 选型验证

**驱动迁移（better-sqlite3 → node:sqlite）**：
```
$ pnpm typecheck                      # 0 错误
$ node verify-migrate.mjs             # spawn bundle: create→list→get→updateAccount→remove→未知method 全 ✓
```
实测 `node:sqlite` 支持 `@name` 命名绑定与 `?` 位置绑定，`get()` 无行返 `undefined`，`all()` 返数组；`pragma` 需 `exec("PRAGMA ...")`（无 `db.pragma()`）。

**bun 单文件 sidecar**：
```
$ pnpm build:binary                   # esbuild → bun --compile → binaries/plugin-host-x86_64-unknown-linux-gnu
```
产物 ~65MB（内嵌 Bun runtime），无任何外部 Node 依赖；`node dist/main.mjs` 与单文件均能独立跑 CRUD + plugin.list。

**发布版 self-check（target/release，兄弟 plugin-host 在位）**：
```
HOME=/tmp/x ./miko-launcher --self-check
[plugin-manager] 插件目录不存在: /tmp/x/.local/share/miko-launcher/plugins   ← env 注入生效
[self-check] ⓪④⑤⑥⑦⑧⑨⑩ + ①②③ 读/写/回读 全链路通过
```

**tauri build 出三包（含 sidecar）**：
```
target/release/bundle/appimage/MikoLauncher_0.1.0_amd64.AppImage  ~125MB (NO_STRIP=1)
target/release/bundle/deb/  MikoLauncher_0.1.0_amd64.deb          ~29MB
target/release/bundle/rpm/  MikoLauncher-0.1.0-1.x86_64.rpm       ~29MB
```
三者均验证含 `usr/bin/miko-launcher` + `usr/bin/plugin-host`；AppImage 解包后 `AppRun --self-check` 同样通过（最终发布形态）。

### 6. M9-5 跨平台 CI 端到端（Release #4 全绿）

打 tag `v0.1.0` 触发 `release.yml`，三端真实 runner 并行打包，**全部 4 个 job 成功**，create-release 汇总成 draft Release：

| 平台 | runner | 产物 | 状态 |
|---|---|---|---|
| Linux | ubuntu-22.04 | `MikoLauncher_0.1.0_amd64.deb`、`MikoLauncher-0.1.0-1.x86_64.rpm` | ✅ |
| macOS | macos-14 (universal) | `MikoLauncher_0.1.0_universal.dmg` | ✅ |
| Windows | windows-2022 | `MikoLauncher_0.1.0_x64_en-US.msi`、`MikoLauncher_0.1.0_x64-setup.exe` | ✅ |

draft Release 带 5 个产物（deb/rpm/dmg/exe/msi）已可认领发布。

**过程中修掉的三个真实根因**（三端各自报错，targeted 修复）：
- **Windows**：`RC2175 ... icon.ico is not in 3.00 format` —— 原 `icon.ico`/`icon.icns` 是 15/16 字节占位符文本（`PLACEHOLDER`），非合法 ICO/ICNS；用 `tauri icon` 从真实 `icon.png`（512²）重新生成全套图标（含 Store/Android/iOS）。
- **macOS**：`Failed to copy external binaries: binaries/plugin-host-universal-apple-darwin doesn't exist` —— Tauri universal target 需要 lipo 合并后的 universal sidecar，而非两个分离 darwin triple；workflow 加 `lipo -create` 合并。
- **Linux AppImage**：`failed to run linuxdeploy`（deb/rpm 同 run 成功）—— GitHub Actions ubuntu runner 上 tauri 已知未解决 bug（#14796，`libfuse2` + `APPIMAGE_EXTRACT_AND_RUN=1` 均无效）。**决策：Linux CI 只出 deb+rpm，AppImage 改由本机（Arch/CachyOS `NO_STRIP=1`）产出**（见 BUILD-SIDECAR.md）。

另修：`identifier "dev.mikolauncher.app"` 尾部 `.app` 与 macOS bundle 扩展名冲突（tauri 警告），改 `dev.mikolauncher`。


## 相关文件
- `packages/shared/src/methods.ts`（`account.refresh` Method + params/data schema + registry）
- `apps/desktop/src-tauri/src/core/accounts.rs`（`refresh_microsoft_account()`）、`lib.rs`（`account_refresh` command + self-check ⑩ + `resolve_plugin_host()`/`release_envs()`/`PluginHostSpec`）
- `apps/desktop/src/api/index.ts`（`refreshAccount`）、`stores/accounts.ts`（`check`/`isInvalidated`/`invalidated`）、`views/AccountsView.vue`（失效标记 + 重登/检查按钮 + 挂载自动检测）
- `apps/plugin-host/src/services/plugin-manager.ts`（启用状态持久化 + `resolveHostRoot()` bundle 修复）
- `apps/desktop/src/api/index.ts`（`listPlugins` 返回 `enabled`）、`stores/plugins.ts`、`views/PluginsView.vue`（「启用/已停用」徽标）
- **M9-4**：`apps/plugin-host/src/services/db.ts` + `services/instance-manager.ts`（better-sqlite3 → node:sqlite）、`apps/plugin-host/build.mjs` + `build-binary.sh`（bun 单文件）、`apps/plugin-host/package.json`（`build:binary`）、`apps/desktop/src-tauri/src/core/sidecar.rs`（spawn 支持 env）、`tauri.conf.json`（`bundle.externalBin` + `frontendDist` 修复）、`.gitignore`、`BUILD-SIDECAR.md`
- **M9-5**：`.github/workflows/release.yml`（三端打包 + GitHub Release）、`.github/workflows/ci.yml`（sidecar smoke）、`build-binary.sh`（Windows `.exe` + `cp` 落位）、`apps/desktop/src-tauri/src/lib.rs`（`resolve_plugin_host()` 跨平台 companion 名）、`apps/desktop/src-tauri/icons/`（`tauri icon` 重新生成全套真图标）、`tauri.conf.json`（`identifier` 去 `.app` 后缀）

## 尚未完成（M9 后续）
- **多账号快捷切换**：当前以「实例绑定账号」承载（InstancesView 每行账号下拉）；全局「默认账号」概念待定。
- **插件分发演进**：Phase 1/2（签名 + 验签 + 内建浏览）。
- ~~发布 runtime 收尾~~ ✅ 已落地（M9-5 见上）——`ci.yml` 加 sidecar smoke、新增 `release.yml` 三端（Linux/macOS universal/Windows）打 tag 打包并汇总 GitHub Release；`resolve_plugin_host()` 跨平台 companion 名（Windows `.exe`）。mac/win 安装包需在对应 GitHub runner 上产出（本地仅 Linux 已验证三包）。
