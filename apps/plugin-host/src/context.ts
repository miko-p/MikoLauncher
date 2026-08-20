/**
 * 根 Context + 服务注册 —— 对应蓝图「六、apps/plugin-host/src/context.ts」。
 *
 * 复用 M0 已验证的 Cordis 4 API：
 *   - class X extends Service { constructor(ctx){ super(ctx,'name') } } 注册服务
 *   - ctx.plugin(X) 挂载即注册；注册本身是 effect，卸载 provider 即移除服务
 *   - 注意：root.extend() 的子 context 会继承已注册服务，不能重复注册同名服务
 */

import { Context } from 'cordis'

/** 全局根 Context。内置服务与功能插件都挂在这上面。 */
export const root = new Context()

/** 服务名注册表 —— 防止同名服务重复注册（POC 注意点 1） */
export const ServiceName = {
  rustBridge: 'rustBridge',
  instanceManager: 'instanceManager',
  pluginManager: 'pluginManager',
  uiRegistry: 'uiRegistry',
  downloadService: 'downloadService',
  authService: 'authService',
} as const

export type ServiceName = (typeof ServiceName)[keyof typeof ServiceName]

/**
 * sidecar 日志统一走 stderr —— stdout 是 JSON-RPC 通道，绝不能混入业务日志。
 * 任何 .ts 里的 `console.log` 都会污染 stdout、破坏 Rust 端按 JSON 行解析。
 */
export const log = (...args: unknown[]) => {
  process.stderr.write(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n')
}
