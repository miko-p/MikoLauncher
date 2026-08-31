# M15 — UI 打磨（毛玻璃外观 + Minecraft.net 式分组导航 + 苹果划屏）+ 两处卡顿/失效修复

> 目标：把应用界面做一轮「观感 + 手感」打磨，并顺手修掉两个此前遗留的体验问题。
> 交付：① 深紫边框/主体改半透明毛玻璃（亚克力风）+ 内缘厚度阴影；② 顶栏下拉改 Minecraft.net 官方页式**分组导航**（左侧主类别四选 + 竖分隔线 + 右侧内容，主页/编辑同组，纯 hover 跟随）；③ **苹果划屏整页切换**（内容区竖直拖拽 / 键盘 ↑↓ 在五主视图间滑动切换，边界不越界）；④ 修「主页面板重开/冷启动缩放失效」；⑤ 修「进账号页卡顿」（账号改应用启动时全局加载）。

## 交付物

| 目标 | 改动 | 验证 |
|---|---|---|
| **修复「主页面板重开缩放失效」** | `HomeView.vue` 的 `onMounted` 原一次性 `ResizeObserver` observe 落空：manifest 经异步 IPC 拉回前画布 `v-if` 不渲染、`canvasEl` 为 null → RO 错过观察，`containerW` 停在 `DESIGN_W`（scale 恒 1）→ 重开/冷启动缩放失效。改为 `ensureResizeObserver()`：`nextTick` 等 DOM 更新后再量宽 + observe（observe 幂等）；`onMounted` 调一次覆盖「画布立即可见」，再加 `watch(home.panelWidgets.length)` 覆盖「manifest/插件异步致画布延迟挂载」的冷启动场景 | `pnpm run build` ✓（vue-tsc + vite）；实测重开/小窗口缩放正常 |
| **边框/主体半透明毛玻璃** | `App.vue`：`.app-shell` 背景 `color-mix(--shell-bg 90%, transparent)` + `backdrop-filter: blur(30px) saturate(150%)`；`.app-main-rim` 背景 `color-mix(--bg 74%, transparent)` + `blur(40px)`；边框内缘加 `inset 0 0 0 1.5px 细描边 + inset 0 0 32px 18px 光晕` 增强厚度感。颜色取自 `--shell-bg`/`--bg` 随主题换肤自动跟随；极旧 WebKit 用 `@supports not (backdrop-filter...)` 兜底回退实色 | `pnpm run build` ✓ |
| **下拉改分组导航** | `App.vue`：原先单列纵排（每项一行）改为 **Minecraft.net 官方页式**——`.panel-box.drawer` 内「左侧主类别四选（首页/资源/账号/插件）＋ 竖分隔线 `.drawer-divider` ＋ 右侧 `.drawer-main` 显示选中类别内容」。`navGroups` computed 把视图按功能归类（`NAV_GROUPS` + variant），`activeNav`/`currentGroup` 驱动右侧随点选切换；首页类别内含「主页+编辑」两个磁贴同组；形态多样（`variant-home` 左右并排大磁贴 / `variant-list` 列表条 / `variant-card` 整行大色块）；交互改**纯 hover 跟随**（`@mouseenter` 展开、`@mouseleave` 收起，移除原 CSS `:hover/:focus-within`） | `pnpm run build` ✓ |
| **苹果划屏整页切换** | `App.vue`：内容区 `.app-main`（`ref=swipeHost`）挂 `pointerdown`，拖拽时当前页整体 `translateY` 跟手（带阻尼），松手超阈值（90px）按方向 `router.push` 到相邻主视图，未超则弹回。`SWIPE_ORDER` 固定顺序 home→download→instances→accounts→plugins（向上前进、向下返回）；router-view 改 `v-slot + <transition mode="out-in">`，`swipeDir` 决定 `swipe-next`/`swipe-prev` 上下推卡动画；键盘 ↑↓ 同效；详情页（不在序列）不触发；避开可交互元素（按钮/输入/小组件卡片/下拉/弹层等）避免误触；首个/末个页面边界方向**不跟手**（`amt=0`），无越界特效 | `pnpm run build` ✓ |
| **修「进账号页卡顿」** | 账号「拉列表 + 逐微软账号有效性检测」原在 `AccountsView.onMounted` 串行 `await check`（每个都走 Rust 网络 refresh）→ 改为应用启动时全局加载（`App.vue onMounted` 一次 `fetchAccounts()` + 微软账号后台**并行** `void check`），`AccountsView.onMounted` 去掉网络检测、直接读共享 store（只留设备码监听）；「刷新/检查」按钮仍手动可用 | `pnpm run build` ✓ |

## 关键坑

- **Vue 3 scoped 样式 vs `<transition>` 动态 class**：`transition` 运行时给过渡元素动态加的 `enter-from/leave-to/enter-active/leave-active` class **不带 scoped data 属性**，写在 `<style scoped>` 里会被加 `[data-v]` 选择器而永远匹配不上 → 划屏的推卡动画无效。**必须用 `:global(.swipe-next-enter...)` 包裹**这些 transition class 才能命中。这是一个容易忽略、且不报错（build 照过、只是没有动画）的坑。
- **`backdrop-filter` 与透明窗**：`tauri.conf.json` 已开 `transparent: true`，毛玻璃才能透出桌面；若某内核不支持 `backdrop-filter`，半透明背景会**直接透出无模糊的桌面**（难看且不可读）——须用 `@supports not (backdrop-filter: blur(1px))` 把 `.app-shell`/`.app-main-rim`/`.panel-box.drawer` 兜底回退到不透明实色。
- **Mainboard 渲染时序（缩放失效根因）**：`panelWidgets` 依赖 `ui.widgets`（manifest 异步拉回才有值），冷启动时画布 `v-if` 导致 `canvasEl` 延迟出现。一次性挂 RO 会错过。**不要在 `onMounted` 一次性 observe**，要让 RO 观察时机跟随画布真实出现（`watch(panelWidgets.length)` + `nextTick`）。
- **进账号页卡顿**：`AccountsView.onMounted` 对**每个微软账号串行 `await store.check()`**（各走一次 Rust `account_refresh` 网络 refresh，Rust 侧每次还自建 multi-thread tokio runtime 再 `block_on`）——多次往返排队拖住页面首次挂载。改为应用启动时后台并行加载即可显著缓解；若单次 refresh 仍慢，可进一步把 Rust `account_refresh` 从 sync 自建 runtime 改为 Tauri async command 治本（本次未动）。

## 验证详情

```
$ pnpm run build      # shared tsc / plugin-host esbuild / desktop vue-tsc + vite 全绿
```

## 相关文件

- `apps/desktop/src/views/HomeView.vue`（缩放修复：`ensureResizeObserver` + `watch(panelWidgets.length)`）
- `apps/desktop/src/App.vue`（毛玻璃、分组导航下拉、苹果划屏、账号启动加载）
- `apps/desktop/src/views/AccountsView.vue`（onMounted 去掉网络检测、只留设备码监听）

## 尚未完成 / 后续

- 苹果划屏**滚动权衡**：内容区空白处竖直拖拽会触发划屏而非滚动（长页面滚动请用滚轮/滚动条）。如需「先滚动、滚到顶/底再划屏」的边界判定可后续加。
- 苹果划屏首页可划区域较窄（主页大部分是小组件卡片，已排除避免与既有拖拽冲突）；如需更容易划动可缩小排除范围或加专属把手。
- Rust `account_refresh` 仍为 sync command 自建 tokio runtime + `block_on`（M15 未动）；账号多或网络慢时单次 refresh 仍偏慢，可改 async command 治本。
