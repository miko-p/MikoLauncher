/**
 * 为 Cordis 的 `Context` 增补本项目的服务类型。
 *
 * Cordis 服务经依赖注入提供 `ctx.<serviceName>`，但基础 `Context` 类型不知道
 * 项目注册了哪些服务。用 TS 模块增强声明 `rustBridge` / `instanceManager`，
 * 使 `ctx.rustBridge` / `ctx.instanceManager` 获得类型安全。
 */

import type { Context } from 'cordis'
import type { RustBridgeService } from './bridge/rust-bridge.js'
import type { InstanceManagerService } from './services/instance-manager.js'

declare module 'cordis' {
  interface Context {
    rustBridge: RustBridgeService
    instanceManager: InstanceManagerService
  }
}
