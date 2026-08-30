# M13 — Modrinth 模组包 / 模组浏览 + 实例内查看模组详情 + 启动自动安装

> 目标：打通「从模组包开始」整条流水线 —— **下载 → 建实例 → 实例内看模组 → 启动即自动安装依赖**。
> 「下载」页回归独立导航（曾因 M11 收进实例弹窗后空间不足，改回页面主体）；浏览 Modrinth 搜索/排序/分页/详情选版本建实例；
> 创建后立即解析 `.mrpack` 文件清单填进实例 mods 展示；**首次启动 lighty 自动解析 `.mrpack` 并安装全部依赖**。

## 为什么
- 用户反馈 M11 把「下载」收进实例弹窗后，模组包浏览页在 modal 里空间不足撑破 → 下载页回归独立导航。
- 且要真正能用模组包：既能浏览/搜索 Modrinth，也能在实例里看到这个模组包包含哪些模组（带详情），更要在启动时真正把模组装上。

## 交付物

| 目标 | 改动 | 验证 |
|---|---|---|
| **下载页回归独立导航** | `BUILTIN_VIEWS` 加 `download`、路由 `/download`、新 `views/DownloadView.vue`；「添加实例 → 从模组包开始」改为关闭弹窗并跳转 `/download`（页面主体，不再用 modal） | self-check ⑨ UI 无回归 ✓；`pnpm build` ✓ |
| **Modrinth 浏览/搜索（M13 核心）** | `views/DownloadView.vue` 内嵌 `components/ModrinthPackBrowser.vue`：打开即自动加载模组包列表、源 tab（Modrinth/CurseForge 占位）、类型 tab、排序下拉（相关度/下载量/关注数/最新发布/最近更新）、搜索、卡片网格 + 上一页/下一页分页；点开详情选 MC 版本/加载器 + 实例名创建（绑定 modpack 引用） | `pnpm build` ✓ + 实测 |
| **Rust 搜索/详情 command** | `src/core/modrinth.rs`：`search`(含 `index` 排序)/`project`/`project_versions` 直接调 Modrinth `/v2/search`+`/v2/project`（lighty 无浏览式搜索接口）；`resolve_modpack_files` 下载并解析 `.mrpack` 的 `modrinth.index.json` 文件清单。一律走 lighty 共享 async `HTTP_CLIENT`（避 M12 异步 drop 坑） | `cargo check/clippy` ✓；`resolve_modpack_files` 实测 FPS 模组包列出 9 个模组 ✓ |
| **契约/DB** | `ModpackSchema`/`ModrinthProject`/`ModrinthVersion`/`ModpackFileSchema` + `InstanceSchema.modpack?`；DB 加 `modpack` 列；CSP `img-src` 放行 `cdn.modrinth.com` | 单测 `search_hit_deserializes`（`follows` alias）✓ |
| **实例内查看模组详情** | 创建实例后 `store.addModpackInstance()`：建实例 → 调 `modrinth.modpackFiles` → `modpackFilesToMods` 把清单（文件名/size/sha1/归属路径/是否客户端必需）填进 `instance.mods` → Rust `instance_update_mods`（转发 sidecar `instance.updateMods`）持久化；详情页「模组」栏渲染文件名 +「必装」标记 + 大小（MB/KB）+ 归属路径 + 短 sha1 + 模组包来源提示 | `pnpm build` ✓ |
| **启动自动安装（关键坑修复）** | `launch_game` 挂 `with_mod().with_modrinth_modpack(ModrinthPinned)`；**修「模组包实例启动不装模组」** —— `lighty-launch` 加 `modrinth` feature（详见「关键坑」） | `cargo check/clippy` ✓；**实测 FPS 实例启动后 mods 真实安装成功** ✓ |
| **sort hit 字段缺失修复** | `follows`≠`followers` 等字段 `#[serde(default)]` + `alias`，避免整条反序列化失败被静默滤空 | 单测 ✓ |

## 设计要点
- **`.mrpack` 文件清单 vs 实例 mods**：`resolve_modpack_files` 拿到的每个文件只有 file_name/size/sha1/url/是否客户端必需，没有单个模组的 projectName/versionId。故创建后**立即**下载并解析清单，映射成 `ModSchema`（用 file_name 作展示名与 id）填入实例 mods，详情页据此展示。文件**本体**仍由首次启动时 lighty 实装（启动那条链路才是真正装模组的地方）。
- **清单解析失败不阻塞建实例**：`addModpackInstance` 里建实例成功后再去解析清单；解析失败只记 error，实例仍照常可用（详情页显示「暂无清单」）。

## 关键坑：`lighty-launch` 缺 `modrinth` feature 致模组永不安装
- **症状**：创建了绑定 modpack 的实例，启动后**跟普通 fabric 一样** —— 游戏里没有 mod，`mods/` 目录为空，lighty 也不写 `modpacks` cache marker。
- **根因**：lighty 的 installer（`src/installer/installer.rs` 的 `resolve_extra_mods` / modpack pipeline）整段被 `#[cfg(any(feature="modrinth","curseforge"))]` 门控。当时 Cargo.toml 只给 `lighty-launch` 开了 `events`，**没开 `modrinth`** → `resolve_extra_mods` 走 no-feature 分支**直接返回空 Vec**、`modpack()` 恒为 `None`，模组包安装环节被编译剔除。之前 `lighty-version`/`lighty-modsloader` 已开 modrinth（所以 `with_modrinth_modpack` 能编译、能拿到引用），**唯独 launcher 这层不消费它**。
- **修复**：`apps/desktop/src-tauri/Cargo.toml` → `lighty-launch = { version = "26.5.12", features = ["events", "modrinth"] }`。
- **验证**：`cargo check/clippy` 全绿 + `cargo tree -e features -p lighty-launch` 确认 `modrinth` feature 激活 + **用户实测 FPS 模组包实例启动后模组真正安装** ✅。

## 验证详情
```
$ pnpm run build               # shared + plugin-host + desktop(vue-tsc + vite) 全绿
$ cargo check / clippy --all-targets   # 零告警
$ cargo tree -e features -p lighty-launch   # 确认 modrinth feature 激活
# 用户实测：模组包实例启动 → 模组 real 安装成功 ✓
```

## 相关文件
- `apps/desktop/src-tauri/src/core/modrinth.rs`（search / project / project_versions / resolve_modpack_files）
- `apps/desktop/src-tauri/src/core/launch.rs`（launch_game 挂 `with_modrinth_modpack`）
- `apps/desktop/src-tauri/src/lib.rs`（`modrinth_*` + `instance_update_mods` command / invoke_handler）
- `apps/desktop/src-tauri/Cargo.toml`（`lighty-launch` 加 `modrinth` feature）
- `apps/desktop/src/views/DownloadView.vue` + `components/ModrinthPackBrowser.vue`（浏览/搜索/创建）
- `apps/desktop/src/stores/instances.ts`（`addModpackInstance` + `modpackFilesToMods`）
- `apps/desktop/src/api/index.ts`（`modrinthModpackFiles` / `updateInstanceMods`）
- `apps/desktop/src/views/InstanceDetailView.vue`（模组详情展示）
- `packages/shared/src/entities.ts`（`ModpackSchema` / `ModpackFileSchema` / `ModSchema` 扩展）

## 尚未完成（M13 后续）
- **CurseForge 双源**：其搜索 API 需个人 API key，UI 已有 tab 占位，待申请 key 后接入。
- **点单个模组进 Modrinth 项目详情页**：当前详情页展示文件清单，未做每个模组的项目详情/二次搜索。
- **「导入」本地 `.minecraft` / 实例目录**：仍为占位（M11 遗留）。
