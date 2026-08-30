# 贡献指南

感谢你想为 MikoLauncher 出一份力。在开始之前，请先花几分钟读完这份指南 —— 它总结了整个项目约定，能帮你少走弯路。

## 环境要求

| 工具 | 版本 |
|---|---|
| Node.js | ≥ 26 |
| pnpm | 11 |
| Rust | ≥ 1.95 |
| Tauri 2 Linux 依赖 | `webkit2gtk-4.1` 等（见 [Tauri 官方前置要求](https://tauri.app/start/prerequisites/)） |

## 项目结构

```
apps/
  desktop/       Tauri 应用壳 —— Vue3 前端(src/) + Rust 内核(src-tauri/src/)
  plugin-host/   Node sidecar —— Cordis 插件宿主
packages/
  shared/        Rust↔TS 共享 Zod 契约（唯一事实来源）
plugins/         用户插件装载目录
poc/             早期概念验证脚本
docs/            各里程碑 M1-M6 交付/验证/踩坑
```

## 本地开发

```bash
pnpm install          # 安装依赖（postinstall 需 allowBuilds 放行）
pnpm run build        # 构建 shared 契约(tsc) + 前端(vue-tsc+vite)
pnpm dev:desktop      # 启动 Tauri 桌面应用
```

> Wayland 下 GTK 窗口刚开就退（`Gdk-Message Error 71 ... Wayland display` → sidecar 报 `stdin closed`）：
> `dev:desktop` 已内置 `GDK_BACKEND=x11 WEBKIT_DISABLE_COMPOSITING_MODE=1`。手动跑
> `pnpm --filter @miko-launcher/desktop tauri dev` 时需自行加上这两个 env。

> Rust 内核自检（不进 GUI）：在 `apps/desktop/src-tauri` 下 `cargo run -- --self-check`。

## 架构约定（重要）

- **前后端分离**：前端（Vue3）只做 UI；领域/业务逻辑在服务层；**真重活（下载/启动 JVM/认证）在 Rust 内核**。
- **契约即代码**：任何 Rust↔TS 之间的出入参，先在 `packages/shared` 里用 Zod 定义 schema。两端都用它校验，**别绕开契约**。
- **Cordis effect 规范**：插件用 `inject` 声明依赖、`ctx.effect(() => () => cleanup)` 注册副作用并返回逆操作。卸载时逆操作自动执行 —— **任何插件创建的监听/连接/状态都放进 effect**。
- **里程碑驱动**：新功能往前推进时，参考 `docs/` 下已有里程碑，完成后写一份对应的 `M*-status.md`。

## 提 PR 的流程

1. 从 `master` 切一个分支：`git checkout -b feat/your-feature`
2. 改动后本地跑通：`pnpm run build` 和 Rust `cargo build`（在 `apps/desktop/src-tauri`）
3. commit 信息尽量清晰，能看出做了什么、为什么（参考历史的中文 commit 风格）
4. push 分支并开 Pull Request，描述：
   - 改了什么 / 为什么
   - 怎么验证的（自检输出 / 手动步骤）
   - 是否有契约变更

## 运行时注意

- **微软账号登录**（M10-6 默认）：官方 client id（`00000000402b5328`）+ `login.live.com`，弹浏览器 + 手动粘回地址栏 URL，免注册能登录。loopback 全自动实现需 Minecraft 认可的 client id（自注册普通应用会被 Microsoft Services 租户拒），供有认可 id 时用。离线账号无需配置。
- **Rust 自检需要联网**（拉取 Mojang 版本清单 / loader 版本）。
- 目录改名后若 `cargo build` 报 tauri-build 路径错误，删除 `apps/desktop/src-tauri/target` 重建即可。

## License

[MIT](LICENSE)。你的贡献将按 MIT 许可证授权。
