/**
 * RustBridgeService —— Node sidecar 侧的命令分派中心。
 *
 * 作为 Cordis Service 挂载，接收来自 Rust 核心转发的 JSON-RPC 请求。
 * 用 @mc-launcher/shared 的 methodRegistry 做双向 Zod 校验：
 *   - 未知 method → METHOD_NOT_FOUND
 *   - 非法 params → INVALID_PARAMS
 *   - 处理器抛错 → INTERNAL_ERROR
 *
 * 插件把处理器注册到 `ctx.rustBridge.on(method, handler)`，卸载即反注册。
 */

import { Service } from 'cordis'
import { getMethodSchema, makeErr, makeOk } from '@mc-launcher/shared'
import type { RpcRequest } from '../bridge/json-rpc.js'

// 处理器参数用 any：Rust 转发的请求在 registry 层是未知结构，具体类型由各插件收窄。
type Handler = (params: any) => unknown | Promise<unknown>

export class RustBridgeService extends Service {
  private handlers = new Map<string, Handler[]>()

  constructor(ctx: any) {
    super(ctx, 'rustBridge')
  }

  /**
   * 注册一个 method 处理器。返回取消函数（供 ctx.effect 回滚使用）。
   * 同一 method 可注册多个，按注册顺序调用，返回第一个非 undefined 的结果。
   */
  on(method: string, handler: Handler): () => void {
    const list = this.handlers.get(method) ?? []
    list.push(handler)
    this.handlers.set(method, list)
    return () => {
      const idx = list.indexOf(handler)
      if (idx >= 0) list.splice(idx, 1)
    }
  }

  /** 处理一条传入请求（已过 apiVersion 校验），返回响应对象。 */
  async handle(req: RpcRequest) {
    const schema = getMethodSchema(req.method) as
      | { params: { safeParse(v: unknown): { success: boolean; data?: any; error?: any } } }
      | undefined
    if (!schema) {
      return makeErr(req.id, {
        code: 'METHOD_NOT_FOUND',
        message: `unknown method: ${req.method}`,
      })
    }

    // 1) 校验 params
    const parsed = schema.params.safeParse(req.params ?? {})
    if (!parsed.success) {
      return makeErr(req.id, {
        code: 'INVALID_PARAMS',
        message: 'invalid params',
        data: parsed.error?.flatten(),
      })
    }

    // 2) 派发到已注册处理器
    const list = this.handlers.get(req.method) ?? []
    if (list.length === 0) {
      return makeErr(req.id, { code: 'NOT_FOUND', message: `no handler for ${req.method} in plugin-host` })
    }

    try {
      for (const handler of list) {
        const out = await handler(parsed.data)
        if (out !== undefined) return makeOk(req.id, out)
      }
      return makeErr(req.id, { code: 'INTERNAL_ERROR', message: `handlers of ${req.method} returned undefined` })
    } catch (e) {
      return makeErr(req.id, { code: 'INTERNAL_ERROR', message: (e as Error).message })
    }
  }
}
