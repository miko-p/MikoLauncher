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

/** 账号（离线 / 微软） */
export const AccountSchema = z.object({
  /** 稳定 id（离线=UUID v5 from name；微软=MC uuid） */
  id: z.string(),
  /** 显示名（离线=用户名；微软=MC 角色名） */
  name: z.string(),
  /** offline | microsoft */
  type: z.enum(['offline', 'microsoft']),
  /** 微软账号的 MC accessToken（offline 为空串；不导出供前端，仅内部） */
  accessToken: z.string().optional(),
  /** 微软账号的 refreshToken（供静默刷新，不放前端显示；offline 空） */
  refreshToken: z.string().optional(),
  /** 微软 xuid（offline 空） */
  xuid: z.string().optional(),
  /** 最后使用时间 ISO（排序/记忆用） */
  lastUsed: z.string().optional(),
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

/* ------------------------------------------------------------------ *
 *  UI 贡献（M8-1 主题/布局插件）                                       *
 *  侧车 UiRegistryService 把插件的 UI 贡献镜像成轻量契约，前端拉取应用。*
 * ------------------------------------------------------------------ */

/** 主题插件贡献：一段覆盖 CSS 变量的样式文本（由插件 theme.css 读出） */
export const UiThemeSchema = z.object({
  /** 主题名（对应插件 manifest.name，或自定义展示名） */
  name: z.string(),
  /** 主题 CSS 内容（覆盖 :root CSS 变量；前端注入到 <style id="plugin-theme">） */
  css: z.string(),
})

export type UiTheme = z.infer<typeof UiThemeSchema>

/** 布局插件贡献：往某个 slot 插入一段 HTML（蓝图「十、布局插件」） */
export const UiLayoutSlotSchema = z.object({
  /** 插入点 slot 名（如 app-shell / home-widget / footer） */
  slot: z.string(),
  /** 布局/组件名 */
  name: z.string(),
  /** 渲染到该 slot 的 HTML 内容（前端 v-html 应用） */
  html: z.string(),
})

export type UiLayoutSlot = z.infer<typeof UiLayoutSlotSchema>

/** ui.getManifest → 前端要渲染的 UI 贡献（theme 单值 active；layouts 按 slot） */
export const UiManifestSchema = z.object({
  /** 当前生效主题（无主题插件时为 null） */
  theme: UiThemeSchema.nullable(),
  /** 各 slot 当前生效的布局贡献 */
  layouts: z.array(UiLayoutSlotSchema),
})

export type UiManifest = z.infer<typeof UiManifestSchema>

export const entities = {
  Version: VersionSchema,
  Account: AccountSchema,
  Mod: ModSchema,
  Instance: InstanceSchema,
  ModLoader: ModLoaderSchema,
  UiTheme: UiThemeSchema,
  UiLayoutSlot: UiLayoutSlotSchema,
  UiManifest: UiManifestSchema,
}
