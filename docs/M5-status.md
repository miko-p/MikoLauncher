# M5 — 前端接真实进度 + 具体 loader 版本解析 ✅ 完成

> 目标：把 M4 已打通的**真实启动/下载进度链路接到 UI**（实例页实时进度条、版本清单显示
> Java 版本要求），并补齐**具体 loader 版本解析**（fabric/quilt/neoforge/forge 的真实精确版本，
> 替代 M4 的 `"latest"` 占位 —— 该占位会让 lighty 拼出非法 meta URL 而启动失败）。

## 交付物

| 层 | 改动 | 验证 |
|---|---|---|
| **Rust 内核** | `resolve_loader_version(loader, mc)`：按 loader 从官方 meta/maven 解析精确版本 —— vanilla 空串；fabric/quilt 用 meta JSON 精确取该 MC 第一个版本；forge 用 `maven.minecraftforge.net` maven-metadata 按 MC 前缀精确匹配；neoforge 用 `maven.neoforged.net` 按 MC minor 前缀匹配；`launch_game` 启动前调用并把解析值传入 `VersionBuilder` | `--self-check ⑤Loader版本(1.21.4): [vanilla=∅, fabric=0.19.3, quilt=0.20.0-beta.9, neoforge=21.1.248, forge=1.21.4-54.1.18]` 全 ✓ |
| **前端版本清单** | `versions.ts` store 增补 `javaMajor` 字段；`DownloadView` 展示版本条目的 `Java xx` tag | pnpm build 全绿 ✓ |
| **前端实例页** | `InstancesView`：点「启动」→ 订阅 `download:progress` 实时渲染 lighty 下载/安装进度条（含 target/phase/百分比），按钮显示「启动中…」 | pnpm build 全绿 ✓ |

## 验证详情

### 1. 具体 loader 版本解析（`--self-check ⑤`，真实网络）
```
⑤Loader版本(1.21.4): [vanilla=∅, fabric=0.19.3, quilt=0.20.0-beta.9, neoforge=21.1.248, forge=1.21.4-54.1.18]
```
- fabric `0.19.3`、quilt `0.20.0-beta.9`：官方 meta JSON 首个版本（按 MC 过滤）
- neoforge `21.1.248`：maven.neoforged.net 按 MC minor (`21.`) 匹配最新
- forge `1.21.4-54.1.18`：maven.minecraftforge.net 按 MC 前缀精确匹配最新

### 2. fabric 真实启动冒烟（`--self-check launch smoke-fabric 1.21.4 fabric`）
用解析出的 loader 版本 0.19.3 真实启动 fabric —— 下载 loader + MC + JRE，
进度事件实时回传，随后拉起 JVM（游戏窗口持续运行，靠 shell timeout 限时观察）。

## 踩坑记录

1. **forge 元数据 URL**：`files.minecraftforge.net` 下 404，正确是 `maven.minecraftforge.net`（lighty 的 FORGE_MAVEN 常量即此域名）。
2. **maven-metadata 版本勿做字符串排序**：`"54.0.9"` 与 `"54.0.10"` 字符串排序会错乱；
   列表本身按时间递增，直接取 `last()` 最准。
3. **neoforge/mc minor 前缀匹配**：`1.21.4` → minor `"21"` → 前缀 `"21."`，对齐 NeoForge 版本号规则。
4. **`resolve_loader_version` 是 async**：self-check / 冒烟里需 `tokio::runtime + enable_io + enable_time`
   （`enable_time` 不可缺，否则 HTTP_CLIENT 的 60s 请求超时 timer 报 "timers disabled"）。
5. **前端 invoke 语义**：lighty `run()` 在游戏运行期间不返回，`launchInstance` 的 await 会一直 pending；
   但这是期望行为 —— 进度经 `download:progress` 事件独立推送，不依赖 invoke 返回，UI 不阻塞。

## 尚未完成（M6/后续起点）
- **微软/Microsoft 认证**（lighty-auth 的 Microsoft 流程替换 `OfflineAuth`，实例表补 user 绑定）
- **NeoForge 版本匹配更精确**：当前按 MC minor (`21.`) 前缀匹配，对极少数跨 minor 特例可能取到偏差版本，必要时改用官方版本列表 API
- **前端版本清单分组/筛选 UI**（release/snapshot/loader 过滤）、launcher 版本选择下拉（目前自动取最新）
- **插件化 MVP**：Phase 0 插件装载 + 主题/布局/功能插件走 Cordis（已顺延）
