# M8 — 主题/布局插件 + 打包骨架 + 安全与缺陷修复 ✅ 进行中

> 目标：落地蓝图「三类插件」中的**主题插件 + 布局插件**（原本 M3 顺延项），为 sidecar 补齐
> **打包发布骨架**（externalBin），并补上一轮代码审查发现的安全/正确性缺陷 + 修复日志中遗留的
> `--self-check` 实例堆积问题。M8 尚有部分项未落地（见「尚未完成」），故标「进行中」。

## 交付物

| 目标 | 改动 | 验证 |
|---|---|---|
| **主题/布局插件（M8-1）** | 契约：`UiTheme/UiLayoutSlot/UiManifest` schema + `ui.getManifest` 方法（shared）；侧车 `UiRegistryService`（themeStack 弹栈回滚 + per-slot layouts，纯 Cordis effect 回滚）；manifest 增 `type(theme/layout)`；前端 `stores/ui.ts` + `App.vue` 注入点（`<style id="plugin-theme">` + 布局 slot v-html）；Rust `ui_get_manifest` command；示例插件 `demo-theme`/`demo-layout` | `--self-check ⑨` theme=demo-theme layout[footer]=✓ 禁用↓✓回退null✓ 恢复✓ |
| **sidecar 打包骨架（M8-B）** | `apps/plugin-host` 新增 `build`（esbuild devDep）：src+cordis+shared bundle 成 `dist/main.mjs`(~200KB)，仅 better-sqlite3 原生模块 external；`resolve_plugin_host()` 双路径：打包版（`current_exe` 同目录找 `plugin-host`）/ dev(tsx 源码)；`BUILD-SIDECAR.md` 记录发布 runtime 选型 | `node dist/main.mjs` 独立跑通 Cordis 全链路 ✓；dev 自检 tsx 回退正常 |
| **CSP 安全补丁** | `tauri.conf.json` 的 `security.csp` 从 `null` 设为基础策略：`script-src 'self'`（拦内联脚本）+ `style-src 'unsafe-inline'`（主题 CSS 需要）+ `connect-src ipc:` 等 | pnpm build 全绿 ✓（v-html 引入后的安全补偿） |
| **审查缺陷修复** | ①`chrono_now()` 伪日期改 `chrono::Utc`（真实 ISO8601）+ 单测；②accounts.json 写后 `chmod 0600`；③过时注释更正；④DownloadView quickCreate 默认 loader 不一致 + 消 `as any`；⑤plugin-manager 批量加载去重复目录扫描；⑥清理改名残留旧库 + 自检 create 后即删（不再堆积 SelfCheckSMP） | 全构建 ✓；self-check ⑥⑦⑧⑨ ✓；实例数 14→14 不增（自检清理生效） |

## 验证详情

### 1. 主题/布局插件（`--self-check ⑨`）
```
⑨UI(M8-1): theme=demo-theme layout[footer]=✓  禁用↓=✓回退null=✓ 恢复=✓
```
- **pull-based**：前端经 `ui.getManifest` 拉取生效的 UI 贡献（theme + layouts），规避 sidecar→Rust 无异步 push 通道的限制。
- **空间可组合**：`inject:['uiRegistry']` 声明依赖；`UiRegistryService` 必须先于 user 插件挂载，否则保持 PENDING。
- **时间可组合**：主题/布局插件的 `registerTheme`/`registerLayout` 是 effect acquire，`plugin.disable` → `fiber.dispose()` 逆序回滚（弹栈/移除条目）→ 主题回退 null。
- 前端 `App.vue`：主题 `<component :is="'style'" id="plugin-theme" v-html>`（非 scoped，覆盖 default.css 的 :root）；布局 slot（footer / home-widget）用 `v-for` + `v-html`。
- 示例插件 hash（sha256(main.js)）全部匹配并通过装载。

### 2. sidecar 打包骨架（M8-B）
- esbuild 把 cordis + @miko-launcher/shared + 全部 src 打成单文件 ESM，**仅剩 better-sqlite3 原生模块 external**（它运行时从打包目录 node_modules 原生加载）。
- `node dist/main.mjs` 直接跑通：Cordis 服务挂载 / instance.* handler / effect 回滚，输出 `{"ok":true,"data":{instances:[]}}`。
- `resolve_plugin_host()` 返回 `(cwd, bin, args)` 三元组：打包版用 `current_exe().parent()/plugin-host`，dev 回退 repo 内 tsx。
- **卡点（尚未拍板）**：正式发布版需一个能跑 better-sqlite3 的 Node 运行时来源，二选一——pkg/bun 内嵌 Node 单文件（体积最小，但 better-sqlite3 + Node≥26 有 NODE_MODULE_VERSION 匹配风险）/ 内置运行时进 externalBin + JS 作 resources（体积大几十 MB）。详 `BUILD-SIDECAR.md`。

### 3. 审查修复要点
- `chrono_now`：原实现把「自 1970 的天数」当年份，输出伪 ISO8601（`20534-xx-xxT…Z`）；改为 `chrono::Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)`，加单测锁定 `YYYY-MM-DDTHH:MM:SS.mmmZ`。
- accounts.json 权限 `644 → 600`（mac/Linux，含凭据本机他人不可读）。
- self-check ②create 后立即 remove，不再往库堆积 `SelfCheckSMP`（实测实例数不增）。
- 清理改名前的旧库 `apps/plugin-host/data/mc-launcher.db`（代码只读 `miko-launcher.db`，确认无引用）。

## 踩坑记录

1. **JsonRpcServer 并发不保序**：独立 `tsx src/main.ts` 一次性喂多个请求会并发处理、stdout 乱序（disable 后立刻 `ui.getManifest` 会读到旧状态）。**生产链路经 Rust `SyncSidecar`（Mutex 串行）无此问题**；独立测试一次会话只发一个请求，或用 self-check ⑨ 这种 Rust 串行链路验证。这是测试方式造成的假象，非生产 bug。
2. **Cordis 服务类型增强**：`ctx.uiRegistry` 需在 `augmentations.d.ts` 声明（服务 type），否则类型报「not exist on Context」；不要用 `context.d.ts`（被同名遮蔽问题）。
3. **esbuild external 策略**：cordis/shared 是纯 JS 可 bundle 进单文件，只有 better-sqlite3（原生 .node）必须 external；bundle 后 sidecar 依赖面从 N 个包缩到 1 个原生模块。
4. **Tauri externalBin 会在 `cargo check` 校验产物存在**：conf 里声明 `externalBin: ["binaries/plugin-host"]` 后，若 `src-tauri/binaries/plugin-host-<triple>` 不存在会报 `resource path ... doesn't exist`（exit 101）。故当前 externalBin 配置在 runtime 选型落地前暂不启用，避免阻塞任何构建。

## 尚未完成（M8 后续 / M9 起点）
- **发布 runtime 选型落地**：正式可分发 sidecar（无用户装 node）需定 pkg/bun 内嵌 或 内置运行时 + resources，再启用 `externalBin` 配置并跑通 `tauri build` 产出安装包。
- **插件管理 UI 完善**：hash 校验失败告警推到前端、插件启用状态持久化到 `cordis.yml`-style 配置。
- **微软静默刷新失败后的重登录 UI**、多账号快捷切换（M6 遗留）。
- 前端主题/布局渲染的**真实 webview 视觉效果**待人工确认（Wayland + WebKit 环境限制，本轮未启动 GUI）。

## 相关文件
- `packages/shared/src/entities.ts`（UiTheme/UiLayoutSlot/UiManifest）、`methods.ts`（ui.getManifest）
- `apps/plugin-host/src/services/ui-registry.ts`、`plugin-manager.ts`（type）、`main.ts`、`context.ts`、`augmentations.d.ts`、`build.mjs`
- `apps/desktop/src-tauri/src/lib.rs`（ui_get_manifest command、resolve_plugin_host）、`tauri.conf.json`（csp）
- `apps/desktop/src/stores/ui.ts`、`App.vue`、`api/index.ts`
- `plugins/demo-theme/`、`plugins/demo-layout/`（示例）
- `BUILD-SIDECAR.md`（打包选型说明）

## 安全（本轮新增）
- 引入 v-html 渲染插件 HTML 后，把 CSP 从 `null` 收紧为基础策略：`script-src 'self'` 阻止内联脚本（v-html 里通过 `onclick=` 等注入的脚本不执行）；`style-src 'unsafe-inline'` 是主题 CSS 机制需要的取舍，仅放宽到 style。这是 v-html 引入的必要安全补偿。
