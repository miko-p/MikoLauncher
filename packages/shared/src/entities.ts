/**
 * # IPC 契约 — 领域实体 (entities)
 *
 * 对应蓝图「四、分层职责」的 Domain 层纯 TS 实体：
 * Version / Instance / Mod / Account / ModLoader。
 * 只声明数据结构（无副作用），供入参/返回值/事件两用。
 */

import { z } from 'zod'

/** 启动器类型 —— MC 1.6+ 的发布类型 */
export const VersionTypeSchema = z.enum([
  'release',
  'snapshot',
  'old_beta',
  'old_alpha',
])

export type VersionType = z.infer<typeof VersionTypeSchema>

/** Mod 加载器 */
export const ModLoaderSchema = z.enum(['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'])

export type ModLoader = z.infer<typeof ModLoaderSchema>

/** 一个 MC 版本清单条目（来自 version_manifest） */
export const VersionSchema = z.object({
  /** 形如 "1.21.4" / "1.20.1" */
  id: z.string(),
  type: VersionTypeSchema,
  /** version_manifest json 的 url */
  url: z.string(),
  /** 版本发布时间（ISO 8601） */
  releaseTime: z.string(),
  /** 该版本对应 Java 主版本要求（可选，客户端常见为 17/21） */
  javaMajor: z.number().int().positive().optional(),
})

export type Version = z.infer<typeof VersionSchema>

/** 用户名（离线）/ 微软账号 uuid */
export const AccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** offline | microsoft */
  type: z.enum(['offline', 'microsoft']),
  /** 微软账号的 accessToken（offline 为空串） */
  accessToken: z.string().optional(),
})

export type Account = z.infer<typeof AccountSchema>

/** 模组 / 资源包 / 光影 —— 由 modrinth/curseforge 源提供的条目 */
export const ModSchema = z.object({
  id: z.string(),
  projectName: z.string(),
  fileName: z.string(),
  versionId: z.string(),
  source: z.enum(['modrinth', 'curseforge']),
  /** sha1 或 sha512 hash，Phase 0 插件校验用 */
  hash: z.string().optional(),
  /** 字节大小，进度计算用 */
  size: z.number().int().nonnegative().optional(),
})

export type Mod = z.infer<typeof ModSchema>

/** 一个游戏实例（可独立启动的版本 + 加载器 + 模组集） */
export const InstanceSchema = z.object({
  id: z.string(),
  name: z.string(),
  versionId: z.string(),
  modLoader: ModLoaderSchema,
  /** 实例目录相对路径 */
  dir: z.string(),
  /** 已安装的模组 */
  mods: z.array(ModSchema),
  /** 关联的账号 id */
  accountId: z.string().optional(),
  createdAt: z.string(),
})

export type Instance = z.infer<typeof InstanceSchema>

export const entities = {
  Version: VersionSchema,
  Account: AccountSchema,
  Mod: ModSchema,
  Instance: InstanceSchema,
  ModLoader: ModLoaderSchema,
}
