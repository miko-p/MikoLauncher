/**
 * 内置功能插件 —— 实例管理 (instance.*) 命令接线。
 *
 * 把 @miko-launcher/shared 里定义的 instance.* 方法映射到实例管理服务。
 * Cordis 功能插件范式（M0 已验证）：
 *   - inject 声明依赖（空间可组合）
 *   - ctx.effect 注册副作用并返回逆操作（时间可组合，卸载自动回滚）
 *   - 卸载时 handler 自动反注册
 */

import type { Context } from 'cordis'
import { ServiceName, log } from '../context.js'
import type { RustBridgeService } from '../bridge/rust-bridge.js'

export interface Config {}

export const name = 'builtin-instance'

export const inject = [ServiceName.rustBridge, ServiceName.instanceManager]

export function apply(ctx: Context) {
  const bridge = ctx.rustBridge as RustBridgeService

  // 把所有 instance.* 方法集中到一个 effect 里，卸载整体回滚
  ctx.effect(() => {
    const offs: Array<() => void> = []

    offs.push(
      bridge.on('instance.list', () => ctx.instanceManager.list()),
      bridge.on('instance.get', (params: { id: string }) => ctx.instanceManager.get(params.id)),
      bridge.on('instance.create', (params: any) => ctx.instanceManager.create(params)),
      bridge.on('instance.remove', (params: { id: string }) => ctx.instanceManager.remove(params.id)),
      bridge.on('instance.updateAccount', (params: { id: string; accountId?: string | null }) =>
        ctx.instanceManager.updateAccount(params.id, params.accountId),
      ),
      bridge.on('instance.updateIcon', (params: { id: string; icon?: string | null }) =>
        ctx.instanceManager.updateIcon(params.id, params.icon),
      ),
      bridge.on('instance.updateJavaMajor', (params: { id: string; javaMajor?: number | null }) =>
        ctx.instanceManager.updateJavaMajor(params.id, params.javaMajor),
      ),
      bridge.on('instance.updateMods', (params: { id: string; mods?: unknown[] }) =>
        ctx.instanceManager.updateMods(params.id, params.mods ?? []),
      ),
      // launch 骨架：委托实例管理（M2 起换 Rust LaunchAdapter 真实启动）
      bridge.on('instance.launch', () => {
        throw new Error('instance.launch 尚未接入 Rust 启动内核（M2）')
      }),
    )

    log(`[builtin-instance] 注册 ${offs.length} 个 instance.* handler`)
    return () => {
      for (const off of offs) off()
      log('[builtin-instance] 卸载：instance.* handler 已全部反注册（effect 回滚）')
    }
  })
}
