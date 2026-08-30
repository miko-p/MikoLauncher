# M10 — 小组件面板（Widget）体系（进行中）

> 目标：把主页 `home-widget` 区从「单布局 slot」升级为**小组件面板**——多个独立、可插拔、
> 可经插件页独立启用/禁用的小组件插件，各贡献一块首页卡片。
> 本轮完成 **M10-1 小组件面板骨架 + 首个实例 `widget-text`（文字小组件）**、
> **M10-2 主页小组件编辑态**、
> **M10-3 下拉单列纵排 + 删除示例视图 + 自由像素拖拽布局 + 文字插件可编辑文字**、
> **M10-4 账号小组件（玩家名 + 头像 + 类型徽标 + 点选当前账号）**。

## 交付物

| 目标 | 改动 | 验证 |
|---|---|---|
| **小组件面板契约（M10-1）** | `UiWidgetSchema`（key/title/html/order/width/disabled）并入 `UiManifestSchema.widgets`；sidecar `UiRegistryService` 新增 `registerWidget()`（key 幂等覆盖，卸载 effect 回滚）+ `getManifest` 全量返回 widgets（按 order 排序）；前端 `stores/ui.ts` 加 `widgets` computed（过滤 disabled + 排序） | `pnpm build` 全绿（shared tsc / plugin-host esbuild / desktop vue-tsc + vite）✓；spawn bundle `ui.getManifest` 返回 `widgets(2)` ✓ |
| **主页渲染成小组件网格面板** | `App.vue` 主页顶层渲染 `uiStore.widgets` 响应式卡片网格（`widget-panel` + `.widget-card` + 标题头 + body v-html），`gx-half/gx-full` 宽度档；兼容保留通用 `home-widget` 布局 slot（旧布局插件仍回退显示） | `pnpm build` 全绿 ✓ |
| **首个实例：文字小组件（widget-text）** | 新增 `plugins/widget-text/`（Phase 0 插件，`inject:['uiRegistry']`），`registerWidget` 贡献「文字小组件」卡片（title + 文字正文 + 来源 meta），hash 校验入 manifest | `--self-check ⑧` count=5 含 widget-text hash✓ 已装载 ✓；spawn bundle 面板出现该卡片 ✓ |
| **demo-layout 迁移为小组件示例** | `demo-layout/main.js` 的 `home-widget` 布局贡献改由 `registerWidget` 贡献成小组件卡片（footer 仍走通用布局 slot），manifest hash 同步 | `--self-check ⑧` demo-layout hash✓ ✓ |
| **多小组件并存 + 独立启停** | 改 `getManifest` 打破原「每 slot 单贡献覆盖」（原只回传每 slot 最后一个 layout）→ widgets 域天然多卡片并存 | spawn bundle 双卡片 `[widget-text, demo-layout]` ✓；`plugin.disable(demo-layout)` 后 widgets=`[widget-text]` ✓ |
| **小组件面板移入首页（M10-2）** | `App.vue` 的全局小组件面板移除，移入 `HomeView.vue`（首页路由专属）；`App.vue` 只留全局 footer 布局 slot | `pnpm build` 全绿 ✓；grep 确认 `widget-panel` 仅 HomeView 渲染 |
| **下拉「编辑」独立成格 + 删除示例视图（M10-3）** | `App.vue` 下拉改**单列纵排**（每项一行左对齐），「编辑」独立成格紧跟「主页」正下方（点按先跳首页再切编辑态，编辑中反色显示「完成」）；删除示例视图插件 `plugins/demo-view/`（导航只余 5 内置视图） | `pnpm build` 全绿 ✓；spawn bundle `plugin.list` 只剩 4 个、`views(5)` 全 builtin 无示例视图 ✓ |
| **主页编辑态（iPhone 主屏编辑语义）（M10-2/3）** | 新增 `stores/home.ts`：编辑态 + 面板编排持久化；`HomeView` 编辑态卡片虚线描边 + 左上角「−」移除 + 顶部横条「添加小组件+ / 完成」+ 小组件库弹层（加回被隐藏类型） | `pnpm build` 全绿 ✓ |
| **自由像素拖拽布局引擎（M10-3）** | 面板从 CSS grid 改为**绝对定位画布**（`.widget-canvas` relative，高度随内容）；每卡 `{x,y,w,h}`(px) 经 `layoutOf` 解析（有用户记录用记录，否则按 order 自动级联排布）；编辑态拖卡片本体移动（pointerdown/move/up，位移左上角）+ 拖右下角 `.wg-resize` 把手改宽高（双下限约束）；退出编辑态锁定但仍绝对定位显示；`setLayout` 持久化；未布局卡片自动级联 | `pnpm build` 全绿 ✓（vue-tsc 含 pointer 事件与 layout） |
| **文字小组件编辑文字（M10-3）** | `widget-text` 插件正文改 `<span class="wt-text" data-edit-text>` 可编辑文字插槽（改后同步 hash）；`stores/home.ts` 加 `texts` 覆盖 + `renderHtml`（正则替换 wt-text 正文，escaped）+ `setText`/`textOf`/`hasEditableText`；`HomeView` 编辑态可编辑文字卡片显示 `<textarea>`（进入编辑态预填插件默认文字，实时 @input 写 store） | `pnpm build` 全绿 ✓；spawn bundle `widget-text` html 含 `wt-text插槽=true`/`data-edit-text=true` ✓ |
| **账号小组件（M10-4）** | 新增 `plugins/widget-account/`（registerWidget 占位，title=账号/width=full，hash 校验）；CSP `img-src` 放行 `https://crafatar.com`；新建 `components/AccountWidget.vue`（账号 store `accounts` 列表：微软账号显示真实 Mojang 头像 `crafatar.com/avatars/<mc-uuid>`、离线账号用首位色块占位；类型徽标「离线/微软」；点击 `home.setCurrentAccount(id)` 设当前账号）；`HomeView` 对 `widget-account` key 特判渲染 AccountWidget 组件而非 v-html（动态数据 + 交互点选，纯静态 html 无法承载）；`stores/home.ts` 加 `currentAccount`/`setCurrentAccount`（持久化） | `pnpm build` 全绿 ✓；spawn bundle `plugin.list` 5 个含 widget-account hash✓、`widgets(3)` 含 title=账号 width=full ✓ |
| **回归** | `cargo check/clippy --all-targets` 零告警；`--self-check` 除⑧新增 widget-text 外全部通过 | 见下 |
| **微软登录：官方 client 手动粘为默认 + loopback 备用（M10-5/6）** | 默认登录用官方 Minecraft Launcher client id `00000000402b5328` + `login.live.com` 授权码流（`core/microsoft_oauth.rs`：authorize + code 交换 + Xbox→XSTS→MC→Profile 链；`account_login_microsoft_url` 弹浏览器 / `_code` 粘回 URL 完成）；loopback 全自动实现（v2.0 + 本地 TcpListener 捕获回跳）保留备用——**已实测证实自注册普通应用被 Microsoft Services 租户/allowlist 拒**（AADSTS500200 / login_with_xbox 403），需 Minecraft 认可的 client id；Cargo 加 `base64`、tokio 加 `net`/`io-util` | `cargo test` 10 项通过（含 loopback 捕获模拟）；`cargo check/clippy` 零告警；`pnpm build` 全绿 |

## 设计要点

- **为什么用独立 widgets 域而非继续堆布局 slot**：布局 slot 契约是「每 slot 单贡献覆盖」（`registerLayout` 同 slot 后注册覆盖、`getManifest` 只回传每 slot 最后一个），天然与「多个小组件并存」冲突。把小组件从通用布局语义中**分离成专门域**（`registerWidget` + `manifest.widgets`），让多卡片共存、可独立启停、可独立排版，同时 footer 等通用布局 slot 的语义不被破坏。
- **契约即代码**：`UiWidget` 沿用共享 Zod schema，sidecar 返回、前端 `uiGetManifestDataSchema.parse` 双向校验（`UiManifestSchema` 加了 `widgets`，否则前端 Zod strip 会丢掉该字段）。
- **小组件即 Phase 0 插件**：每个小组件都是 `plugins/<name>/` 目录的独立插件（自己的 `main.js` + `manifest.json` + hash），走既有 plugin-manager 的启动 hash 校验、启用状态持久化（`plugin-state.json`）与 Cordis `ctx.effect` 回滚——「独立启用/禁用」「卸载即移除」天然复用现有机制，无需新增插件级状态。
- **前端**：`App.vue` 主页顶部渲染 `widget-panel`（`repeat(auto-fill, minmax(180px,1fr))` 响应式网格），每张 `.widget-card` 带标题头 + body；通用 `home-widget` 布局 slot 作为兼容回退仍渲染在面板之后（既有布局插件不受影响）。
- **首个实例 widget-text**：就是"文字插件"——贡献一张「文字小组件」卡片显示一段文字，文字内容在 `main.js` 的 `TEXT` 常量可改，改后需同步 manifest.hash。`inject:['uiRegistry']`，`registerWidget` 即 acquire、off 即回滚。
- **M10-2/3 编辑态：类型库 vs 面板实例分离**。`uiStore.widgets` = 插件贡献的**小组件类型库**（候选）；`stores/home.ts` 的 `panelWidgets` = 用户在**面板上的实例化编排**（`hidden` 集合剔除 + `layouts` 自由像素布局 + `texts` 文字覆盖）。二者分离让「添加/移除/调大小/改文字」只动前端面板编排、不碰插件本身；插件启停仍走 plugin-manager（整插件回归）。用户编排统一存 `localStorage`（`miko:home-widgets`），刷新/重启保留。
- **M10-2/3 编辑入口**：下拉「编辑」独立成格（紧跟「主页」下方），点按 `editHome()` 先 `router.push('/')` 再进入编辑态——小组件面板只挂在首页路由，确保跳回首页看得到编辑效果；编辑中该格反色显示「完成」，再次点击/「完成」退出。
- **M10-3 自由像素拖拽布局引擎**（用户选「自由像素拖拽，不受网格约束」）：主页面板从 CSS grid 改为**绝对定位画布**；每卡 `{x,y,w,h}(px)`。编辑态拖**卡片本体**移动（pointerdown 记录起始布局 + 指针起点，move 用 delta 位移左上角，下限 `CANVAS_PAD`）、拖**右下角 `.wg-resize`** 把手调整大小（`w/h` 双下限 `MIN_W/MIN_H`）。只在编辑态可拖，退出后锁定但仍绝对定位显示（iPhone 一致）。未拖过布局的卡片按 order **自动级联**（y 向下递增、x 左距）。所有编排持久化到 `miko:home-widgets`。
- **M10-3 文字插件可编辑文字**：`widget-text` 的正文改为 `<span class="wt-text" data-edit-text="默认">默认</span>` 可编辑插槽；前端 `stores/home.ts` 存 `texts` 覆盖，`renderHtml` 正则替换 wt-text 正文（**ellipsis escaped**，防用户输入注入 HTML）；进入编辑态时预填插件默认文字到输入框，实时 `@input` 写 store。可编辑范围用 html 里是否含 `class="wt-text"` 判断。
- **M10-3 下拉改单列纵排 + 删示例视图**：下拉由 3 列网格改**单列纵排**（图标+文字左对齐，避免旧「内嵌编辑按钮把格子撑成灰色长条块」的 bug）；「编辑」独立成格紧跟「主页」正下方（复用 `.nav-item`，加 `button.nav-item` 清默认样式，active 反色）。删除示例视图插件 `plugins/demo-view/`（导航只余 5 内置视图）。
- **M10-4 动态数据小组件：组件渲染而非 v-html**。账号/头像/交互点选是**运行时动态数据 + 需事件绑定**，纯插件静态 html（v-html + 字符串占位）无法承载。对这类「动态小组件」，前端在 `HomeView` 按 key 特判渲染真实 Vue 组件（目前仅 `widget-account` → `AccountWidget`），插件仍贡献外壳（key/title/order/width + 是否在面板库可见），数据与交互由前端组件提供。这是对「小组件=静态 html」能力的向上扩展，后续时钟/天气等动态小组件走同一通道。
- **M10-4 账号头像**：微软账号 `Account.id` 即 MC uuid → 用 `https://crafatar.com/avatars/<uuid>.png` 取真实 Mojang 头像；离线账号无真实 uuid/头像 → 用「首字母圆形色块」占位（本地，色相由名字散列）。CSP `img-src` 需放行 `https://crafatar.com https://*.crafatar.com`（否则外链头像被拦）。「当前账号」点选存 `home.currentAccount`（持久化），作为将来默认账号/快速启动的基础（当前启动仍以实例绑定账号为准，M9 已定）。
- **M10-5/6 微软登录最终决策：官方 client 手动粘为默认，loopback 全自动备用**。核心事实（已由用户实测确认）：微软 MC 认证需要「被 Minecraft Services 认可」的 client id——自注册普通公共应用会在 **Microsoft Services 租户**被拒（用户跑自注册 `c44b4083...` 实测 `AADSTS500200 Selected user account does not exist in tenant 'Microsoft Services'`；即便过了 OAuth/Xbox，MC 最后一步 `login_with_xbox` 也 403），这是 MC 侧 allowlist 管控，代码不可解，需 Minecraft 团队特批 client id。**故默认登录用官方 Minecraft Launcher client id `00000000402b5328` + `login.live.com`**（实测 authorize 200 + 登录表单）——免注册、能真正登录，代价是 redirect 固定官方桌面 srf、浏览器无法回跳本地 → **手动把地址栏含 code= 的 URL 粘回启动器**（PCL 老式可靠做法，`finish_login`/`account_login_microsoft_url`/`_code`）。
- **M10-5 loopback（备用，需认可 client id）**：v2.0 `TcpListener` 绑定 `127.0.0.1:5599` 捕获浏览器回跳 code + token 交换 + MC 链，实现已在 `core/microsoft_oauth.rs`（`account_login_microsoft_loopback`）保留；只在用户拥有被 Minecraft 认可的 client id 时才能真正全自动（届时配 `MIKO_MS_CLIENT_ID` + Azure redirect `http://127.0.0.1:5599/cb`）。
- **M10-5 Tauri command 必须 async（重要坑）**：`account_login_microsoft` 原同步 command 里 `std::thread::spawn().join()` 长轮询阻塞主事件循环 → `emit` 推不到前端、invoke 不返回（「点了没反应」）。已改 async。凡长轮询/阻塞型 command 一律 async。

## 验证详情

### 1. 全构建
```
$ pnpm run build
packages/shared build: Done
apps/plugin-host build: dist/main.mjs  ✓
apps/desktop build: ✓ 72 modules transformed ✓ built in 1.50s
```
- shared tsc ✓ / plugin-host esbuild ✓ / desktop vue-tsc（含新 `widgets` 字段）+ vite ✓。

### 2. 小组件面板（spawn bundle `dist/main.mjs`，`MIKO_PLUGINS_DIR` 指向 repo plugins/）
```
RESP id=1  ui.getManifest
  widgets(2):
    key=widget-text | title=文字小组件 | width=auto
    key=demo-layout | title=demo-layout 小组件 | width=auto
  views(6) count ok
```
- 5 插件全部 hash✓ 装载（`[stderr][widget-text] 应用：注册文字小组件卡片`）。
- 卸载时 `[widget-text] 卸载：文字小组件卡片已移除`（effect 回滚正常）。

### 3. 多小组件独立启停（spawn bundle，独立 data dir 隔离状态）
```
[最初] widgets = ["widget-text","demo-layout"]
[禁用 demo-layout] {"disabled":true}
[禁用后] widgets = ["widget-text"]
```
- 禁用某小组件插件 → `effect` 回滚 → 面板只留其余卡片；启用同理恢复。

### 4. Rust 回归
```
$ cargo check --all-targets      # Finished dev, 零告警
$ cargo clippy --all-targets     # Finished dev, 零告警
$ HOME=/tmp/x cargo run -- --self-check
[self-check] ⑧插件(M7-5): count=5 [demo-greeter@hash✓[已装载], demo-layout@hash✓[已装载],
  demo-theme@hash✓[已装载], demo-view@hash✓[已装载], widget-text@hash✓[已装载]]
[self-check] ⑨UI(M8-1): theme=demo-theme layout[footer]=✓ 禁用↓=✓回退null=✓ 恢复=✓
[self-check] 读/写/回读全链路通过
```
- ⑧ 从 count=4 → 5（新增 widget-text），全部 hash✓；⑨ 无回归。

## 相关文件
- `packages/shared/src/entities.ts`（`UiWidgetSchema` + `UiManifestSchema.widgets`）
- `apps/plugin-host/src/services/ui-registry.ts`（`registerWidget` + `getManifest` 返回 widgets）
- `apps/desktop/src/stores/ui.ts`（`widgets` computed = 小组件类型库）
- `apps/desktop/src/stores/home.ts`（M10-2/3 面板编排 store：editing / hidden / layouts(自由像素) / texts(文字覆盖) + localStorage 持久化；`layoutOf`/`canvasHeight`/`renderHtml`）
- `apps/desktop/src/views/HomeView.vue`（小组件画布（绝对定位）+ 编辑态：拖拽移动 / `wg-resize` 把手调大小 / −移除 / 文字输入框 / 顶部横条 / 小组件库弹层）
- `apps/desktop/src/App.vue`（下拉单列纵排 + 「编辑」独立成格 + `editHome()`；移除全局小组件面板，仅留 footer 布局 slot）
- `plugins/widget-text/`（文字小组件；正文 `wt-text`/`data-edit-text` 可编辑插槽）
- `plugins/widget-account/`（账号小组件：registerWidget 外壳，前端特判渲染组件）
- `apps/desktop/src/components/AccountWidget.vue`（M10-4 账号列表：头像 / 徽标 / 点选当前账号）
- `apps/desktop/src-tauri/tauri.conf.json`（CSP `img-src` 放行 crafatar.com）
- `apps/desktop/src-tauri/src/core/microsoft_oauth.rs`（M10-5：v2.0 loopback authorize / 本地 TcpListener 捕获回跳 code / token 交换 / Xbox→XSTS→MC→Profile；另含官方 client 手动兜底 `finish_login`）
- `apps/desktop/src-tauri/src/lib.rs`（`account_login_microsoft_loopback` async command + `account_login_microsoft_url`/`_code` 手动兜底 + `open_in_browser`；原设备流 command 改 async）
- `apps/desktop/src-tauri/Cargo.toml`（加 `base64`；tokio 加 `net`/`io-util`）
- `apps/desktop/src/stores/accounts.ts`（`loopbackMicrosoft`/`beginMicrosoftLogin`/`finishMicrosoft`/`msLoginUrl`）
- `apps/desktop/src/views/AccountsView.vue`（登录按钮走 loopback 全自动 + 手动粘 URL 兜底）
- `plugins/demo-layout/main.js`（home-widget 布局贡献 → `registerWidget` 小组件；footer 保持布局 slot）
- （已删除 `plugins/demo-view/` 示例视图插件）

## 尚未完成（M10 后续）
- **更多小组件实例**：时钟、天气、系统监控（CPU/内存）、快捷启动按钮等（动态类走 M10-4 组件渲染通道）。
- **「当前账号」接入启动**：`home.currentAccount` 已持久化，可后续作为「默认账号/快速启动账号」（M9 当前仍以实例绑定账号为准）。
- **小组件卡片内交互深化**：复用 `actions` 通道或 Phase 2 组件级交互（当前卡片为 v-html 静态内容 + 文字插槽 + account 组件）。
- **拖拽对齐吸附**：当前自由像素；如需流畅网格（iPhone widget 吸附整数格）可后续加 snapping 辅助线。
- **小组件编排服务端持久化**：当前面板编排存前端 `localStorage`；如需跨设备/发布版强一致，可迁移到 Rust/SQLite。
- 全局分发演进 Phase 1/2 仍待推进。
