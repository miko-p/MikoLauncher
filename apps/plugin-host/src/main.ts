/**
 * plugin-host 主入口 —— Node sidecar (Cordis 宿主)。
 *
 * 启动流程：
 *   1. 建立根 Context (root)
 *   2. 挂载内置服务（InstanceManagerService 等）+ 内置功能插件
 *   3. 启动 JSON-RPC server，监听 stdin，经 RustBridgeService 分派
 *   4. 退出信号时整树 dispose，逆序回滚所有插件 effect（Cordis 保证）
 *
 * 手动运行（避开 pnpm 的 build-check，直接调本地 tsx）：
 *   ./node_modules/.bin/tsx src/main.ts
 * 骨架自检（注意 stdout 只走 JSON，业务日志走 stderr）：
 *   echo '{"id":1,"apiVersion":1,"method":"instance.list","params":{}}' \
 *     | ./node_modules/.bin/tsx src/main.ts
 */

import { root, ServiceName } from './context.js'
import { JsonRpcServer } from './bridge/json-rpc.js'
import { RustBridgeService } from './bridge/rust-bridge.js'
import { InstanceManagerService } from './services/instance-manager.js'
import { PluginManagerService } from './services/plugin-manager.js'
import * as builtinInstance from './plugins/builtin-instance.js'
import type { RpcRequest } from './bridge/json-rpc.js'

async function main() {
  process.stderr.write('[plugin-host] === MC-Launcher plugin-host (Cordis) starting ===\n')

  // ── 挂载服务（Cordis Service；注册本身即 effect，dispose 自动移除）──
  // ctx.plugin 返回 fiber。await 保证依赖图先就绪再开 RPC server。
  const srvFiber = await root.plugin(RustBridgeService)
  await root.plugin(InstanceManagerService)
  const pluginSvc = await root.plugin(PluginManagerService)
  process.stderr.write(
    `[plugin-host] services mounted: ${ServiceName.instanceManager}, ${ServiceName.rustBridge}, ${ServiceName.pluginManager}\n`,
  )

  // ── 挂载内置功能插件（复用 M0 验证的 {name,inject,apply} 范式）──
  const instFiber = await root.plugin(builtinInstance)
  process.stderr.write('[plugin-host] builtin-instance plugin mounted\n')

  // ── M7-5：Phase 0 用户插件装载（plugins/ + hash 校验，走 Cordis）──
  // 先注册 plugin.* RPC（让前端/自检能查/启用/禁用），再装载所有 hash 通过的插件
  root.pluginManager.registerBridge(root.rustBridge)
  const loaded = await root.pluginManager.loadAll()
  const okCount = loaded.filter((p) => p.loaded).length
  const badCount = loaded.filter((p) => !p.loaded).length
  process.stderr.write(
    `[plugin-host] Phase0 插件: 目录=${root.pluginManager.list().length} 候选，装载 ${okCount} 个，跳过 ${badCount} 个\n`,
  )

  // ── JSON-RPC server：从 stdin 读请求 → RustBridgeService 分派 → stdout 响应 ──
  const rpc = new JsonRpcServer({
    input: process.stdin,
    output: process.stdout,
    handler: (req: RpcRequest) => root.rustBridge.handle(req),
  })

  rpc.on('closed', () => {
    process.stderr.write('[plugin-host] stdin closed, disposing root context...\n')
    root.fiber.dispose().then(() => {
      // 也单独演示单插件 fiber.dispose()（热卸载/重载的基础）
      void srvFiber
      void instFiber
      void pluginSvc
      process.stderr.write('[plugin-host] === plugin-host stopped (all plugin effects rolled back) ===\n')
      process.exit(0)
    })
  })

  process.stderr.write('[plugin-host] ready, waiting for RPC on stdin\n')
}

main().catch((e) => {
  console.error('[plugin-host] fatal:', e)
  process.exit(1)
})
