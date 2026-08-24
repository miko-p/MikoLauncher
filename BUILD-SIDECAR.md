# Sidecar 打包与发布（M9 已定稿：方案 A 单文件内嵌）

## 总览

Rust 核心两层启动 `resolve_plugin_host()`：
1. **打包版（externalBin）**：`current_exe()` 同目录下找 `plugin-host`。
2. **dev（源码）**：本地 tsx 跑 `apps/plugin-host/src/main.ts`。

`tauri.conf.json` 已声明 `bundle.externalBin: ["binaries/plugin-host"]`，产物须放
`src-tauri/binaries/plugin-host-<target-triple>`（当前 `x86_64-unknown-linux-gnu`）。

## 发布 runtime 选型：方案 A（单文件内嵌，已定稿）

**决策（M9-4）**：用 **bun `build --compile`** 把 sidecar 打成一发单文件可执行
（内嵌 Bun runtime，体积 ~65MB），`externalBin` 打包。不再需要目标机安装 Node。

### 为什么能内嵌

历史上卡点是 **better-sqlite3（原生 .node 模块）** 无法 bundle 进 JS，`NODE_MODULE_VERSION`
绑定让 pkg/bun 内嵌困难。M9 起把 SQLite 迁移到 **Node 内置的 `node:sqlite`**（
`DatabaseSync`），sidecar **不再有任何原生外部依赖** → 纯 JS 单文件 → bun 干净内嵌。

### 构建链

```
apps/plugin-host/build-binary.sh [triple]   # 一步出 externalBin 产物
  1. node build.mjs        # esbuild → dist/main.mjs（纯 ESM，无 external）
  2. bun build --compile   # 内嵌 runtime → .build/plugin-host-<triple>
  3. install               # → apps/desktop/src-tauri/binaries/plugin-host-<triple>
```

对照 `pnpm --filter @miko-launcher/plugin-host build:binary`。

triple → bun target 映射见脚本内 case（linux/darwin/windows 各架构）。

### 发布版数据/插件目录定位（关键）

bun `--compile` 单文件运行时 `import.meta.url` 指向**二进制自身**，无法像 dev
（tsx 源码）/ node（esm bundle）那样反推源码布局来定位插件/数据目录。因此：

- **Rust 端 `release_envs()`** 在打包分支注入两个 env（`ensure_app_state()` 后取
  `lighty_core::AppState::data_dir()`）：
  - `MC_LAUNCHER_DATA_DIR` = `<lighty data_dir>/sidecar-data`（实例 DB + 插件状态文件）
  - `MIKO_PLUGINS_DIR`    = `<lighty data_dir>/plugins`（用户插件目录）
- sidecar 端（`db.ts` / `plugin-manager.ts`）二者均 **env 优先**，据此定位。
- dev 分支不注入 env，保持源码布局反推（`apps/plugin-host` 与 repo `plugins/`）。

这样 dev 与发布行为一致、数据都落在 lighty 标准 data_dir（Linux `~/.local/share/miko-launcher/`），
且不依赖二进制复制后的位置。

### 禁止事项

- 勿在 bun 单文件里依赖 `import.meta.url` 反推源码布局（会错位）。
- wrapper 已被真实二进制取代；旧「shebang 依赖外部 node」的验证性 wrapper 不再使用。
- `.build/` 与 `apps/desktop/src-tauri/binaries/` 均被 gitignore（发布产物，不入库）。
- **Windows 侧产物名带 `.exe`**：`build-binary.sh` 对 `x86_64-pc-windows-msvc` 输出
  `plugin-host-<triple>.exe`（供 Tauri externalBin 识别）；落位用 `cp`（POSIX/Git Bash 通用）
  而非 `install -m`，以免 Windows runner 权限语义差异。

### AppImage 打包需 `NO_STRIP=1`（CachyOS/新工具链）

Tauri 捆绑的 linuxdeploy（2024 版）自带旧 binutils `strip`，无法识别新工具链产物里
的 `.relr.dyn` 相对重定位 section，会导致 AppImage 打包失败
（`Strip call failed: ... unknown type [0x13] section '.relr.dyn'`）。
**在 Arch/CachyOS 等滚动发行版上构建 AppImage 时，须加 `NO_STRIP=1`** 跳过该 strip 步骤：

```bash
NO_STRIP=1 pnpm --filter @miko-launcher/desktop tauri build --bundles appimage
```

deb/rpm 不受影响（不经过 linuxdeploy strip）。

## CI / 跨平台打包（M9 收尾）

发布链已纳入 GitHub Actions，分两条流水线：

- **`ci.yml`（每次 push/PR 到 master）**：沿用既有门禁（build + typecheck + cargo check/clippy），
  新增 `Install bun` + `Build sidecar binary (smoke)` 两步 —— 持续跑通
  `build-binary.sh`，确保 sidecar 单文件可执行在 CI 上能正常产出。
- **`release.yml`（打 tag `v*` 触发）**：三端矩阵打包 + 汇总成 GitHub Release：
  - **Linux（ubuntu-22.04）**：sidecar `x86_64-unknown-linux-gnu` → `tauri build` 出 **deb + rpm**
    （**不含 AppImage**——`failed to run linuxdeploy` 是 tauri 在 GitHub Actions ubuntu runner
    上的已知未解决 bug（tauri-apps/tauri#14796，已试 libfuse2 + `APPIMAGE_EXTRACT_AND_RUN=1` 均无效；
    deb/rpm 同一 run 成功）。AppImage 改由**本机**（Arch/CachyOS，`NO_STRIP=1`）产出，见上文。）
  - **macOS（macos-14，universal）**：sidecar 打 `aarch64-apple-darwin` + `x86_64-apple-darwin` 两支，
    `rustup target add` 两个 Darwin 架构，`tauri build --target universal-apple-darwin` 出 dmg/app。
  - **Windows（windows-2022）**：sidecar `x86_64-pc-windows-msvc`（带 `.exe`），`tauri build` 出 msi / nsis。
  - 各端产物 `upload-artifact` 后由 `create-release` 作业用 `softprops/action-gh-release` 汇总到
    GitHub Release（draft，`generate_release_notes`）。

**跨平台 Rust 侧配套**：`resolve_plugin_host()` 打包分支以 `cfg!(windows)` 决定 companion 名
（非 Windows=`plugin-host`，Windows=`plugin-host.exe`），确保 Windows 安装版也能定位 sidecar。

触发发布示例：
```bash
git tag v0.1.0 && git push origin v0.1.0
```

> 注：macOS/Windows 的 `tauri build` 需对应平台 runner 上的系统工具（NSIS/WiX/dmg 等由 Tauri CLI 自动处理）。
> Linux 本地可出 deb/rpm/AppImage 三包；release.yml 三端 CI 端到端已跑通（见「验证记录」）。

## 验证记录

- **release.yml 三端端到端（tag `v0.1.0` → Release #4 全绿）**：
  Linux deb+rpm / macOS universal dmg / Windows msi+nsis 全部成功，create-release 汇总成
  draft Release（5 个资产：deb/rpm/dmg/exe/msi）。修因见 `docs/M9-status.md` §6。
- `cargo check / clippy`：通过，零告警（externalBin 产物在位时）。
- `cargo test`：2 通过（accounts 单测）。
- `node dist/main.mjs` 独立跑：通过（实例 CRUD 全链路，node:sqlite）。
- bun 单文件独立跑：通过（instance CRUD + plugin.list，bun 内嵌 runtime）。
- **发布版 self-check**（`target/release/miko-launcher --self-check`，兄弟 `plugin-host` 二进制在位）：
  打包分支命中、`MIKO_PLUGINS_DIR` env 注入生效（指向 `<data_dir>/plugins`）、
  实例 CRUD / 清单 / 账号 / keyring 全链路通过。
- **tauri build 产物**（`target/release/bundle/`）：
  `MikoLauncher_0.1.0_amd64.AppImage`（~125MB，NO_STRIP=1）、
  `MikoLauncher_0.1.0_amd64.deb`（~29MB）、`MikoLauncher-0.1.0-1.x86_64.rpm`（~29MB）。
  三者均验证包含 `usr/bin/miko-launcher` 与 `usr/bin/plugin-host`两个可执行。
- `--self-check`：见 lib.rs ⑧ plugin 装载（发布版经 env 注入定位 plugins 目录）。

