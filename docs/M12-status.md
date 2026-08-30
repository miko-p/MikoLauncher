# M12 — 26.x 新版号启动修复 + 实例级 Java 版本选择

> 目标：让新版号方案（Minecraft 26.x，去 1.x 前缀）真正能启动，并给实例提供独立的 Java 版本选择。

## 交付物

| 目标 | 改动 | 验证 |
|---|---|---|
| **修「26.x 启动即崩 natives」** | MC 26.x 的 version json 把 `arguments.jvm` 的 natives 改成子目录布局（`-Djava.library.path=${natives_directory}/java`，另加 jna/lwjgl/netty 子目录），而 lighty 26.5.12 仍把 `.so` 压平抽到 `natives/` 根 → JVM 去不存在的目录找 `liblwjgl.so` 崩溃。在 `launch_game` 用 `with_jvm_options()` 把四个 natives `-D` 覆写回压平抽取目录（对老 1.x 无副作用） | `--self-check launch smoke26 26.2 vanilla` 复现→修复方向 ✓ |
| **实例级 Java 版本选择（仿 Modrinth）** | 实例详情页「Java 版本」下拉（自动/8/11/17/21/25/26）+ 新建表单可选；`InstanceSchema.javaMajor?` + DB `java_major` 列（`PRAGMA`+`ALTER` 迁移）+ sidecar `instance.updateJavaMajor` + Rust `instance_update_java_major` + api/store `setJavaMajor`。26.x 新建默认 Java 26（版本 id 启发式） | `pnpm build` ✓ |
| **修「启动 emit error」tokio runtime drop panic** | 两处「异步上下文 drop 自建 tokio runtime」：① `instance_launch` 的 `std::thread + 自建 runtime + block_on` 改直接 Tauri async runtime `.await`；② `java_major_for_manifest` 的 `reqwest::blocking::Client` 改 lighty 共享 async `HTTP_CLIENT` | 1.8.9 `java=8` 无 panic、26.2 fabric 返回 `exit` ✓ |

## 关键坑（M12）
- **lighty 26.5.12 用 version json 的 `javaVersion.majorVersion`（26.x→25）决定 JRE，暂无公开覆写接口**——实例 `javaMajor` 字段虽已 thread 进 `launch_game` 尾参，但真正让 26.x 能启动的是 natives 修复，不是 JRE 覆写。instance Java 选择标注「自动」时按版本官方要求选 JRE。
- **async 上下文绝不能用 `reqwest::blocking::Client`**（内部自建 runtime，drop 即 panic）；必须用 lighty 共享 async `HTTP_CLIENT`。

## 验证详情
```
cargo check / clippy --all-targets  零告警
pnpm run build                      全绿
--self-check ⑧⑨⑩ + ①/②/③          正常
1.8.9 冒烟 java=8 无 panic；26.2 fabric 返回 exit（非 error）
```

## 相关文件
- `apps/desktop/src-tauri/src/core/launch.rs`（natives 覆写 + async HTTP_CLIENT + java_major 尾参）
- `apps/desktop/src-tauri/src/lib.rs`（`instance_update_java_major` command + `instance_launch` 非阻塞 async）
- `apps/desktop/src/views/InstanceDetailView.vue` / `InstancesView.vue`（Java 下拉）
- `apps/plugin-host/src/services/instance-manager.ts`（`updateJavaMajor` + DB 迁移）
- `packages/shared/src/entities.ts`（`InstanceSchema.javaMajor?`）

## 尚未完成（M12 后续）
- lighty 支持 JRE 覆写后，让实例显式 Java 主版本真正接管 JRE 选择（当前仅「自动」生效，显式值不覆盖）。
