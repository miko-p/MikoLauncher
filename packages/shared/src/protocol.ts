/**
 * # IPC 契约 — 协议底座 (protocol)
 *
 * 定义 Rust 核心 ↔ Node sidecar ↔ 前端 之间 JSON-RPC 的通用信封。
 * 契约即代码：双向都用同一套 Zod schema 校验，防漂移。
 *
 * 消息形状（与 M0 POC V2 验证一致）：
 *   request:  {"id":1,"apiVersion":1,"method":"instance.launch","params":{...}}
 *   response: {"id":1,"ok":true,"data":{...}} | {"id":1,"ok":false,"error":{...}}
 *
 * 版本化：所有请求必须带 apiVersion，不兼容变更需 bump。
 */

import { z } from 'zod'

/** 当前 API 版本。不兼容变更时递增。 */
export const API_VERSION = 1 as const

export const apiVersionSchema = z.literal(1)

/** 结构化错误码 —— POC V2 已定型的错误分类 */
export const ErrorCodeSchema = z.enum([
  'PARSE_ERROR',
  'METHOD_NOT_FOUND',
  'VERSION_MISMATCH',
  'INVALID_PARAMS',
  'INTERNAL_ERROR',
  // 领域错误
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'UNAUTHORIZED',
])

export type ErrorCode = z.infer<typeof ErrorCodeSchema>

export const RpcErrorSchema = z.object({
  /** 机器可读错误码 */
  code: ErrorCodeSchema,
  /** 人类可读信息 */
  message: z.string(),
  /** 可选额外上下文（字段级错误等） */
  data: z.unknown().optional(),
})

export type RpcError = z.infer<typeof RpcErrorSchema>

/** JSON-RPC 请求信封 */
export interface RpcRequestBase {
  id: number
  apiVersion: typeof API_VERSION
  method: string
  params?: unknown
}

export const rpcOkSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ id: z.number(), apiVersion: apiVersionSchema, ok: z.literal(true), data })

export const rpcErrSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ id: z.number().nullable(), apiVersion: apiVersionSchema, ok: z.literal(false), error: RpcErrorSchema, data })

/**
 * 构建一个带版本文号的请求信封。
 */
export const makeRequest = (
  id: number,
  method: string,
  params: unknown = {},
): RpcRequestBase => ({ id, apiVersion: API_VERSION, method, params })

/**
 * 构建成功响应。
 */
export const makeOk = <T>(id: number, data: T) => ({
  id,
  apiVersion: API_VERSION,
  ok: true as const,
  data,
})

/**
 * 构建结构化错误响应。
 */
export const makeErr = (id: number | null, error: Partial<RpcError>) => ({
  id,
  apiVersion: API_VERSION,
  ok: false as const,
  error: { code: 'INTERNAL_ERROR', message: 'unknown error', ...error } as RpcError,
})
