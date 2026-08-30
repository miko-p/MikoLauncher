# Changelog

本项目所有值得注意的变更。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，语义版本见 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [未发布]

### M14 已添加
- **实例图标跟随模组包图标**：从 Modrinth 模组包创建实例后，把模组包远程图标下载并转为 data-URI 存进实例 `icon`（新增 Rust `modrinth_download_icon` command 走共享 `HTTP_CLIENT` + base64，前端 CSP 未放行 cdn 故下载放后端）；`instanceStore` 加惰性补齐 `backfillModpackIcons` —— 每次拉列表对「icon 空且 modpack.iconUrl 存在」的实例自动补，存量实例也生效。自定义建实例无该来源，仍用默认占位。
- **Modrinth 项目独立详情页**：新增路由 `/modrinth/:slug` + `views/ModrinthDetailView.vue` —— 展示图标/标题/简介/统计/支持版本，并复用下载页流程选 MC 版本 + 加载器创建实例（模组包绑定 modpack）。供各小组件/下载按钮「直达模组详情」。
- **新增小组件插件**（均按 widget-account 模式：插件壳声明 + HomeView 按 key 特判渲染 Vue 组件）：
  - `widget-download`「下载预览」：把下载页 Modrinth/CurseForge 拉进主页做快速预览 —— 源 tab（CurseForge 仍占位）+ 模组包/模组 tab + 「上一页/下一页」翻页浏览全部（每页条数随组件高度自适应，ResizeObserver 量可用高）；顶栏放大镜按钮跳 `/download?focus=search` 聚焦下载搜索框；点击任一模组直达其 `/modrinth/:slug` 详情。
  - `widget-quick-instances`「快速实例」：把实例列表渲染成苹果 App 库式圆角磁贴（图标 + 名字），点击进实例详情、磁贴上「▶」一键启动、运行中绿点角标。
  - `widget-theme`「主题颜色」：**Adobe Color 风格圆形色块选色**，6 组预设配色；点击后通过覆盖 `:root` 的 `--bg`/`--shell-bg`/`--header-bg`/`--accent`/`--accent-soft`/`--header-text` 整套 CSS 变量即时换肤，选择持久化（`miko:theme-color`），重启保持。仅改视觉样式，不影响布局。
- **文字小组件支持 Markdown 渲染**：`home.ts` 新增安全极简 Markdown 渲染器（标题 `#`、围栏代码块、引用、无序/有序列表、`---`、粗体/斜体/行内代码/链接），内容先 HTML 转义再做结构解析 + 链接 `javascript:` 白名单拦截，杜绝注入；编辑态输入框仍填 Markdown 源码、实时预览。默认提示语改为 Markdown 版操作说明。
- **主页面板布局重构（方案 B 落地）**：需求「窗口调整后组件自动调整、不溢出不留白」；先后尝试栅格流式（方案 A）与网格单元 + 让位拖拽，均因操作手感不佳放弃，最终定为**相对容器缩放（方案 B）**——保留自由像素拖拽（移动/右下把手缩放），新增设计坐标系（`DESIGN_W=1100`）与 `scale = 当前容器宽/DESIGN_W`：窗口宽度变化时卡片**水平坐标与宽度按比例缩放、高度保持**，垂直方向不缩放。修「重开窗口后缩放失效」：RO 首次回调可能不触发导致 `containerW` 停在初始值 → 挂 RO 前先手动量一次 + 改用 `entry.contentRect.width`。持久化从旧三档/网格迁移为绝对坐标 `{x,y,w,h}`（自动级联默认摆位，丢弃不适用布局）。
- **补充**：`widget-text` 默认文案改为 Markdown 操作提示；`tmp-90-mk-bridge-ignore.rules` 未纳入提交。全部插件（下载预览/快速实例/主题颜色/文字/账号）启用状态落 `plugin-state.json`。

### M13 已添加
- **「下载」页回归独立导航 + 「从模组包开始」跳转过去（仿 Modrinth/HMCL）**：M11 曾把下载收进实例弹窗，但模组包浏览页在 modal 里空间不足撑破；现按用户要求**把「下载」导航页加回**（`BUILTIN_VIEWS` 加 `download`、路由 `/download`、新 `views/DownloadView.vue`），「添加实例 → 从模组包开始」改为**关闭弹窗并跳转 `/download`**，浏览页作为页面主体（空间充足，不再用 modal）。DownloadView 内嵌 `components/ModrinthPackBrowser.vue`：**打开即自动加载模组包列表**（不靠搜索）、左上 **Modrinth/CurseForge 源 tab**（CurseForge 未配 API key → 占位提示）、模组包/模组类型 tab、**排序下拉**（相关度/下载量/关注数/最新发布/最近更新）、搜索框、卡片网格（图标/简介/下载量/支持 MC 版本）+「加载更多」；点开 → 详情选 MC 版本/加载器 + 实例名 → 创建实例（绑定 modpack 引用，首次启动 lighty 自动解析 `.mrpack` 装依赖）。新增 Rust `modrinth_search`(含 `index` 排序)/`modrinth_project`/`modrinth_project_versions` command（`src/core/modrinth.rs`，直接调 Modrinth `/v2/search`，因 lighty 无搜索接口）；shared 新增 `ModpackSchema`/`ModrinthProject`/`ModrinthVersion` + `InstanceSchema.modpack?`；DB 加 `modpack` 列；`launch_game` 挂 `with_mod().with_modrinth_modpack(ModrinthPinned)`。启用 `lighty-modsloader`/`lighty-version` 的 `modrinth` feature。CSP `img-src` 放行 `cdn.modrinth.com`。分页改**上一页/下一页**（按 `offset` 页偏移，显示「第 X / N 页」），替代无限加载。**CurseForge 双源延后**（其搜索 API 需个人 key，UI 已有 tab 占位）。另修「search hit 字段缺失（`follows`≠`followers`）致整条反序列化失败 → 列表被静默滤空显示『没有结果』」——所有字段 `#[serde(default)]` + `alias="follows"` + 单测兜底。详见 `docs/` + skill M13。
- **实例内查看模组详情（补全「从模组包开始」链路前端）**：`ModrinthPackBrowser` 创建实例后改用 `store.addModpackInstance()` —— 建实例 → 调新 `modrinth_modpack_files`（Rust `resolve_modpack_files` 下载并解析 `.mrpack` 的 `modrinth.index.json`）→ 经 `modpackFilesToMods` 把文件清单（文件名/size/sha1/归属路径/是否客户端必需）填进实例 `mods` → 新 Rust `instance_update_mods`（转发 sidecar `instance.updateMods`）持久化；详情页「模组」栏渲染文件名 + 「必装」标记 + 大小（MB/KB 自动换算）+ 归属路径 + 短 sha1，并显示模组包来源提示。`ModSchema` 加可选 `path`/`clientRequired`、新增 `ModpackFileSchema`。
- **修复「模组包实例启动不装模组、仍按普通 fabric 启动」**：根因是 `lighty-launch` 未开 `modrinth` feature（只开了 `lighty-version`/`lighty-modsloader` 的）——lighty installer 的 modpack 分支整体被 `#[cfg(any(feature="modrinth","curseforge"))]` 剔除，`resolve_extra_mods` 返回空 Vec、`modpack()` 恒为 `None`，于是模组永不安装（`mods/` 目录空、lighty 也不写 `modpacks` cache）。Cargo.toml 给 `lighty-launch` 加 `features=["events","modrinth"]` 后实测模组真实安装。详见 `docs/` + skill M13。

### M12 已添加
- **修复「新版号方案（26.x 去 1.x 前缀）」启动即崩 natives**：MC 26.x 的 version json 把 `arguments.jvm` 的 natives 改成子目录布局（`-Djava.library.path=${natives_directory}/java`，另加 `jna/lwjgl/netty` 子目录与 `--enable-native-access`），而 lighty 26.5.12 仍把 `.so` 压平抽到 `natives/` 根 → JVM 跑去不存在的 `natives/java` 找 `liblwjgl.so`，窗口未出即崩（26.2 打不开，1.21 正常）。在 `launch_game` 里用 lighty 自带 `with_jvm_options()` 把四个 natives 相关 `-D` 覆写回压平抽取的 `{instance}/natives` 根（对老 1.x 无副作用、对 26.x 纠正到位）。实测复现（`--self-check launch smoke26 26.2 vanilla` 崩溃报告）确认根因并验证修复方向。详见 `docs/` + skill M12。
- **实例级 Java 版本选择（仿 Modrinth）**：实例详情页新增「Java 版本」下拉（自动 / 8/11/17/21/25/26），新建实例表单也可选；`InstanceSchema.javaMajor?` + DB `java_major` 列（`PRAGMA`+`ALTER` 迁移，同 icon 模式）+ sidecar `instance.updateJavaMajor` + Rust `instance_update_java_major` + api/store `setJavaMajor`。**26.x 新建默认 Java 26**（按版本 id 启发式）。注：lighty 26.5.12 用 version json 的 `javaVersion.majorVersion`（26.x→25）决定 JRE，暂无公开覆写接口——该字段已 thread 进 `launch_game` 尾参留待 lighty 支持；真正让 26.x 能启动的是上面 natives 修复。
- **修「启动 26.x / 1.8.9 emit error」的 tokio runtime drop panic**：根因有二，均为「在异步上下文 drop 自建 tokio runtime」→ `Cannot drop a runtime in a context where blocking is not allowed` → 前端 `launch:status` inner error。① `instance_launch` 原 `std::thread + 自建 runtime + block_on`（且`run()`返回后才 drop）→ 改直接在 Tauri async runtime 上 `.await launch_game`；② `launch_game` 内部 `java_major_for_manifest` 用了 `reqwest::blocking::Client`（内部自建 runtime，异步上下文 drop 即崩）→ 改用 lighty 共享 async `HTTP_CLIENT`（新增 `fetch_all_versions_async`/`fetch_java_major_async`）。实测：1.8.9 冒烟 `java=8` 无 panic、26.2 fabric 返回 `exit` 而非 error。

### M10 已添加
- **微软登录：官方 client id + 手动粘 URL 为默认，loopback 全自动需认可 client id（M10-5/6）**：
  - **默认登录（可真正登录）**：用微软官方 Minecraft Launcher client id `00000000402b5328` + `login.live.com` 授权码流（实测 authorize 弹微软登录页），点登录自动弹系统浏览器，授权后把地址栏含 `code=` 的 URL 粘回启动器完成。**免注册、能登录**（PCL 老式可靠做法；官方 id 的 redirect 固定 desktop.srf，浏览器无法自动回跳本地，故需手动粘一次 URL）。
  - **loopback 全自动（实验/备用）**：`core/microsoft_oauth.rs` 含 v2.0 loopback 实现（本地 TcpListener 捕获回跳 code + 自注册公共应用）——**但已证实**：自注册普通 Azure 应用会被 **Microsoft Services 租户/allowlist 拒绝**（用户实测 `AADSTS500200 Selected user account does not exist in tenant 'Microsoft Services'`；MC 最后一步 `login_with_xbox` 还会 403），需 Minecraft 团队特批认可的 client id 才能真正自动登录。故 loopback 保留为「有认可 client id 时使用」的备用（`account_login_microsoft_loopback`/`store.loopbackMicrosoft`），默认登录用官方手动粘。
  - 另修原设备流 command 同步阻塞主线程问题（已改 async）。验证：`cargo test` 10 项通过（含 loopback 捕获模拟单测）、cargo check/clippy 零告警、`pnpm build` 全绿。
- **账号小组件（M10-4）**：新增 `plugins/widget-account/` + `components/AccountWidget.vue` —— 主页面板显示所有账号（微软账号带真实 Mojang 头像（crafatar.com，CSP 已放行）、离线账号用首字母色块占位），玩家名 + 类型徽标（离线/微软），点击某账号设为「当前账号」（`stores/home.ts` 加 `currentAccount` 持久化）。这是首个「动态数据小组件」——账号数据运行时 + 需交互点选，故前端在 `HomeView` 按 `widget-account` key 特判渲染成 Vue 组件而非 v-html（动态类小组件的扩展通道）。
- **主页小组件自由像素拖拽编辑（M10-2/3）**：下拉 MikoLauncher 菜单改**单列纵排**，「编辑」独立成格紧跟「主页」正下方（编辑中反色显示「完成」），并删除示例视图插件 `demo-view`。点「编辑」进入 iPhone 主屏式编辑态——主页面板为**绝对定位画布**：拖动卡片本体移位置、拖右下角把手自由调大小（自由像素，不约束网格），退出编辑态锁定且布局持久化（`miko:home-widgets`）。编辑态卡片虚线描边 + 左上角「−」移除 + 顶部横条「添加小组件 + / 完成」+ 小组件库弹层（加回被移除类型）。「文字小组件」支持**编辑态直接改文字**（插件贡献 `<span class="wt-text" data-edit-text>` 可编辑插槽，前端存文字覆盖并替换渲染）。「小组件类型库 vs 面板实例」分离，编排只动前端、插件启停仍走 plugin-manager。
- **小组件面板体系（M10-1）**：把主页 `home-widget` 区从「单布局 slot」升级为**小组件面板**。新增 `UiWidgetSchema`（key/title/html/order/width/disabled）并入 `UiManifestSchema.widgets`；sidecar `UiRegistryService` 新增 `registerWidget()`（key 幂等覆盖，卸载 effect 回滚）并让 `getManifest` **全量返回** widgets（不被每 slot 的「后注册覆盖」所限 → 多个小组件可并存）；前端 `stores/ui.ts` 加 `widgets` computed，`App.vue` 主页渲染成响应式卡片网格面板（`.widget-panel`，标题头 + body、`gx-half/full` 宽度档，通用 `home-widget` 布局 slot 保留兼容回退）。**小组件即 Phase 0 插件**，复用现有 hash 校验、`plugin-state.json` 持久化与 `ctx.effect` 回滚 → 各小组件天然独立启用/禁用、卸载即移除。示例：新增 `widget-text`「文字小组件」+ 原 `demo-layout` 的 home-widget 贡献迁移为小组件卡片。验证 `ui.getManifest` 返回 `widgets(2)`、禁用 demo-layout 后面板只剩 widget-text、`--self-check` ⑧ count=5 全 hash✓、cargo check/clippy 零告警。详见 `docs/M10-status.md`。

### M9 已添加
- **插件化 UI 骨架（M9-6）**：把顶栏导航 + 页面路由从「前端硬编码五页」升级为由 ui manifest 驱动 —— `UiViewSchema`（key/label/path/order/builtin/type/html/disabled/**actions**）并入 `UiManifestSchema.views`；sidecar `UiRegistryService` 种子化内置五视图 + `registerView()`（插件可**新增/覆盖**导航项与页面，卸载 `effect` 自动移除 builtin 外的视图）；前端 `App.vue` 导航条改由 `uiStore.views` 渲染（过滤 disabled + 按 order 排序）+ `router.addRoute` 动态注册插件视图 → `PluginHtmlView`（v-html 渲染插件内容，与布局 slot 同通道）。示例插件 `demo-view` 贡献一个「示例视图」导航页。**真交互（M9-6b）**：插件视图可声明 `actions`（按钮），点击经 Rust `plugin_view_action` → sidecar 插件 `view.<key>.<action>` handler → 结果回显；方法名限定 `view.*` 命名空间（未知动作拒绝）。dev 误走打包分支已修复（`resolve_plugin_host` 用 `cfg!(debug_assertions)` 排除）。组件级交互（Vue 组件、沙箱）留待分发演进 Phase 2。
- **发布 runtime 收尾（M9-5）**：发布链纳入 GitHub Actions —— `ci.yml` 新增 `Install bun` + `Build sidecar binary (smoke)` 持续验证单文件侧车可产出；新增 `release.yml`（打 tag `v*` 触发）三端矩阵打包（Linux `NO_STRIP=1` 出 deb/rpm/AppImage、macOS universal、Windows msi/nsis），各端 `upload-artifact` 后由 `create-release` 作业汇总成 GitHub Release（draft + 自动 release notes）。`build-binary.sh` 跨平台化：Windows 侧产物带 `.exe` 后缀、落位改 `cp`（POSIX/Git Bash 通用）；`resolve_plugin_host()` 打包分支按 `cfg!(windows)` 找 companion（Windows=`plugin-host.exe`），消除 Windows 装版定位不到 sidecar 的隐患。
- **发布 runtime 选型落地（M9-4）**：方案 A 单文件内嵌定稿——SQLite 从 better-sqlite3 迁移到 Node 内置 `node:sqlite`（去掉 sidecar 唯一原生模块），用 `bun build --compile` 打成一发可执行（内嵌 Bun runtime，无外部 Node 依赖），经 `tauri.conf.json` `bundle.externalBin` 打包进 deb/rpm/AppImage；发布版由 Rust 注入 `MC_LAUNCHER_DATA_DIR`/`MIKO_PLUGINS_DIR` 显式定位数据与插件目录（不依赖二进制反推源码布局，解决 bun 单文件 `import.meta.url` 定位盲区）。修掉 `frontendDist` 路径错位（原本 `tauri build` 找不到前端 dist）、记录 CachyOS 上 AppImage 打包需 `NO_STRIP=1`（linuxdeploy 旧 strip 不认识 `.relr.dyn`）。`apps/plugin-host/build-binary.sh` 一键产 externalBin 二进制。发布版 `--self-check` 全链路通过。
- **SQLite 驱动迁移（better-sqlite3 → node:sqlite）**：`db.ts`/`instance-manager.ts` 改用 Node 26 内置 `DatabaseSync`（pragma 用 `exec`、`@name` 命名绑定兼容），移除 better-sqlite3 依赖与 pnpm allowBuilds 原生编译项。
- **插件启用状态持久化（M9-3）**：`plugin-manager` 新增 `plugin-state.json` 启用状态落盘（缺省全启用）——`enable/disable` 持久化期望状态，`loadAll` 按状态选择性装载（禁用插件重启后不自动加载）；`plugin.list` 返回 `enabled` 字段，前端插件页展示「启用/已停用」徽标 + hover 说明；重启状态保持已用 dev tsx 与生产 bundle 双路径验证。
- **修复 M8-B bundle 路径错位**：`resolveHostRoot()` 兼容 dev（`src/services`）与 bundle（`dist`）两种 `import.meta.url` 形态，修掉生产 bundle 扫不到 `plugins/`、数据目录落到错误路径的潜在缺陷。
- **微软静默刷新失败重登 UI（M9-2）**：`account.refresh` 契约（`needsReauth` 信号）+ Rust `account_refresh` command —— 对指定微软账号显式静默刷新，区分「凭据仍有效」/「已失效需重新登录」（离线账号恒有效）；前端账号页挂载时自动检测各微软账号，失效时醒目「需重新登录」标记 + 失效原因 + 重新登录入口（走设备流），并提供手动「检查」按钮；`--self-check ⑩` 全链路验证 + Rust 单测。
- **Microsoft 账号失效检测**：`accounts.rs` 新增 `refresh_microsoft_account()`（只读检测，不改持久化），单测覆盖「离线恒有效/不存在报错」。

### M8 已添加
- **主题 / 布局插件（M8-1）**：三类插件补齐主题（CSS 变量运行时加载）+ 布局（slot 注入）。`UiRegistryService`（pull-based 镜像 Cordis 回滚：themeStack 弹栈 + per-slot layouts）、`ui.getManifest` 契约、前端 `App.vue` 注入点 + `stores/ui.ts`、示例插件 `demo-theme`/`demo-layout`；`--self-check ⑨` 全链路过
- **sidecar 打包骨架（M8-B）**：esbuild 把 sidecar 打成单文件 `dist/main.mjs`（紧凑 cordis/shared，仅 better-sqlite3 原生模块 external）；`resolve_plugin_host()` 双路径（打包 externalBin / dev tsx）；`BUILD-SIDECAR.md` 记录发布 runtime 选型
- **CSP 安全补丁**：`tauri.conf.json` 从 `csp: null` 收紧为基础策略（`script-src 'self'` 拦内联脚本、`style-src 'unsafe-inline'` 给主题 CSS），为 v-html 引入的必要安全补偿

### M7 已添加
- **实例账号绑定持久化**：`instance.updateAccount` 把 accountId 真实写入实例（SQLite），前端下拉直接持久化；启动用实例绑定账号（替代启动时临时指定）
- **微软凭据落 OS keyring**：refresh_token 存 Secret Service / Keychain / Credential Manager（`keyring` feature 默认开），accounts.json 不再存明文；无 keyring 会话安全回退；删账号连带清理
- **NeoForge 版本精确匹配**：改按官方命名规则的 `{minor}.{patch}.` 精确前缀（修掉误匹配其它 MC patch 的 bug）
- **下载页 UI 增强**：类型分组 tabs + 关键字搜索 + 每版本 loader 下拉「以此版本创建实例」
- **Phase 0 功能插件装载**：`plugins/*/` + hash 校验 + `ctx.plugin()` 走 Cordis（空间可组合注入 / 时间可组合回滚）；`plugin.list/enable/disable` + 插件页；示例插件 `demo-greeter`
- **安全扫描**：`ai-sec-scan` 全仓库 17 项告警逐条核实**全部为误报**（参数化 SQL / 非 SQL 行 / 固定路径），无真实漏洞，详见 `docs/M7-status.md`

### M7 已修复
- **代码审查缺陷修复**：`chrono_now()` 伪日期 → 真 ISO8601（+单测）；accounts.json 写后 `0600`；过时注释更正；DownloadView quickCreate 默认 loader 不一致 + 消 `as any`；plugin-manager 批量加载去重复 `discover` 扫描；清理改名残留旧库 + 自检 create 后即删（不再堆积 `SelfCheckSMP`）

### 计划中（M9）
- 插件市场 / 签名（Phase 1/2）
- 多账号快捷切换
- 插件管理 UI 完善（hash 失败告警到前端已做；后续补齐分发演进）

---

## [0.1.0] - 2026-08-15

### 已添加

#### 账号
- **账号体系**：本地账号存储（JSON 持久化）
- **离线账号**：登录 / 列表 / 删除，稳定 UUID 派生
- **微软账号**：OAuth 设备流认证（`MIKO_MS_CLIENT_ID` 可配），refresh token 静默刷新
- **实例绑定账号**：启动时可选账号（可通过 payload 指定或实例 accountId）

#### 启动
- **真实启动 JVM**：完整 lighty-launch pipeline（metadata → JRE 下载 → 8 桶安装 → spawn JVM）
- **多加载器**：vanilla / fabric / quilt / neoforge / forge，启动前自动解析精确 loader 版本
- **真实下载进度**：JRE / MC 安装进度实时经 `download:progress` 事件回传

#### 核心
- **前后端分离**：Vue3 前端 + Rust 内核 + Node/Cordis 插件宿主三端联通
- **版本清单**：真实 Mojang 版本拉取 + 解析 Java 版本要求（`javaMajor`）
- **实例管理**：创建 / 列表 / 删除，SQLite 持久化（重启存活）
- **共享契约**：Rust↔TS Zod schema（Single Source of Truth，防契约漂移）

#### 插件范式（演进中）
- Cordis 插件宿主骨架（`ctx.effect` 回滚 / 依赖注入 / HMR）

### 项目 / 运维
- Monorepo 初始化（pnpm workspace）
- 项目改名 `mc-launcher` → `MikoLauncher`
- README 项目介绍 + MIT LICENSE
- 各里程碑交付 / 验证 / 踩坑记录于 `docs/M*-status.md`

[0.1.0]: https://github.com/miko-p/MikoLauncher/releases/tag/v0.1.0
