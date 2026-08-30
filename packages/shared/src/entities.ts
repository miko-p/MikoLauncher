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
  /** M13：来自 .mrpack 时记录归属路径（如 `mods/sodium.jar` 或 `overrides/...`）。普通安装的模组无此字段。 */
  path: z.string().optional(),
  /** M13：.mrpack 里 client 必需标记（env.client=="required"；旧包无 env 视为必需）。普通安装的模组无此字段。 */
  clientRequired: z.boolean().optional(),
})

export type Mod = z.infer<typeof ModSchema>

/**
 * M13：`.mrpack` 模组包内单个文件的清单元数据（对应 Rust `modrinth_modpack_files` 返回）。
 * 创建模组包实例后，前端把这份清单映射进实例 `mods` 列表展示。
 */
export const ModpackFileSchema = z.object({
  /** 包内路径（如 `mods/sodium.jar` 或 `overrides/...`） */
  path: z.string(),
  /** 文件名（不含目录，供展示/落盘） */
  file_name: z.string(),
  /** 下载 URL（`.mrpack` 里列的第一下载源） */
  url: z.string(),
  sha1: z.string(),
  size: z.number().int().nonnegative(),
  /** 是否客户端必需（env.client=="required"；旧包无 env 视为必需） */
  client_required: z.boolean(),
})

export type ModpackFile = z.infer<typeof ModpackFileSchema>

/**
 * M13：实例绑定的 Modrinth 模组包引用（「从模组包开始」建实例时记录）。
 * 安装时机：首次启动时 lighty 按 `project`+`versionId` 解析 `.mrpack` 并装依赖。
 */
export const ModpackSchema = z.object({
  /** 来源标识，当前仅 modrinth（curseforge 待有 API key 再接） */
  provider: z.enum(['modrinth']),
  /** Modrinth 项目 slug 或 id（拼 ModpackSource::ModrinthPinned.project） */
  project: z.string(),
  /** 项目显示名 */
  title: z.string(),
  /** 项目图标 URL */
  iconUrl: z.string().optional(),
  /** 选定的 Modrinth 版本 id（拼 version） */
  versionId: z.string(),
  /** 版本号（如 1.21.4） */
  versionNumber: z.string(),
  /** 该版本主文件下载 URL（`.mrpack`） */
  fileUrl: z.string().optional(),
})

export type Modpack = z.infer<typeof ModpackSchema>

/** Modrinth 浏览页用的项目/版本类型（前端搜索页渲染）。 */
export const ModrinthProjectSchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  icon_url: z.string().optional(),
  downloads: z.number().optional(),
  followers: z.number().optional(),
  project_type: z.string().optional(),
  categories: z.array(z.string()).optional(),
  /** 已发布 MC 版本 */
  versions: z.array(z.string()).optional(),
  client_side: z.string().optional(),
})

export type ModrinthProject = z.infer<typeof ModrinthProjectSchema>

export const ModrinthVersionSchema = z.object({
  id: z.string(),
  version_number: z.string(),
  game_versions: z.array(z.string()),
  loaders: z.array(z.string()),
  date_published: z.string(),
  version_type: z.string(),
  files: z
    .array(
      z.object({
        url: z.string(),
        filename: z.string(),
        size: z.number().optional(),
        primary: z.boolean().optional(),
      }),
    )
    .optional(),
})

export type ModrinthVersion = z.infer<typeof ModrinthVersionSchema>

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
  /** 实例自定义图标（data-URI，如 data:image/png;base64,....；缺省用内置土块占位） */
  icon: z.string().optional(),
/**
 * 实例期望的 Java 主版本号（可空）。设了则启动时倾向用该版本 JRE；
 * 未设则按 MC 版本自身要求的 Java 主版本（如 1.21→21、26.x→25）。
 */
javaMajor: z.number().int().positive().optional(),
/** M13：实例绑定的 Modrinth 模组包（来自「从模组包开始」；安装于首次启动时 lighty 自动解析）。缺省无。 */
modpack: ModpackSchema.optional(),
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

/** 插件视图贡献的一个可点动作（M9-6 交互插件）：按钮 → sidecar 插件 handler（view.<key>.<action>）。 */
export const UiViewActionSchema = z.object({
  /** 动作 id（对应 sidecar 插件注册的 `view.<viewKey>.<action>` 方法名） */
  id: z.string(),
  /** 按钮显示文本 */
  label: z.string(),
})

export type UiViewAction = z.infer<typeof UiViewActionSchema>

/**
 * 视图插件贡献的一个「导航条目 + 页面」（M9-6 插件化 UI 骨架）。
 *
 * 让插件能新增/重排顶部导航与对应页面，而不必改前端硬编码路由：
 *  - `builtin=true`：宿主内置视图（download/instances/accounts/plugins/home 等），静态路由支持
 *  - `builtin=false`：插件贡献的视图，内容走 `type=html`（v-html slot，与现有布局插件一致）
 *    —— 交互逻辑深化留给后续（运行时加载 Vue 模块，属分发演进 Phase 2）。
 */
export const UiViewSchema = z.object({
  /** 视图/导航条目标识（对应前端组件 key，如 'download'/'instances' 或插件自定义 key） */
  key: z.string(),
  /** 导航显示文本 */
  label: z.string(),
  /** 路由路径（内置视图需与前端静态路由一致；插件视图可为任意唯一路径） */
  path: z.string(),
  /** 导航排序（数字越小越靠前；不提供则按注册序） */
  order: z.number().optional(),
  /** 是否宿主内置视图（非插件贡献）。缺省 false（插件贡献）。 */
  builtin: z.boolean().optional(),
  /** 渲染方式：'component'=前端宿主预设组件（内置视图）；'html'=v-html 内容（插件视图）。缺省 'component'。 */
  type: z.enum(['component', 'html']).optional(),
  /** 插件视图的 HTML 内容（type='html' 时必填） */
  html: z.string().optional(),
  /**
   * 插件视图的可点动作（M9-6 交互）：前端渲染按钮，点击调 `view_action` →
   * sidecar 插件的 `view.<key>.<action>` handler，结果回显页面。让插件页具备真正交互。
   */
  actions: z.array(UiViewActionSchema).optional(),
  /** 是否禁用（隐藏导航项 + 不渲染页面）。 */
  disabled: z.boolean().optional(),
})

export type UiView = z.infer<typeof UiViewSchema>

/**
 * 小组件（widget）插件贡献的一块首页卡片（M10 小组件面板）。
 *
 * 把原 `home-widget` 布局 slot 升级为「小组件面板」：多个独立的小组件插件
 * 各贡献一块带标题的卡片 HTML，前端在主页渲染成响应式网格，各自经插件页
 * 启用/禁用（每个小组件即一个 Phase 0 插件）。
 */
export const UiWidgetSchema = z.object({
  /** 小组件唯一标识（对应插件贡献 key；同一插件可贡献多个时用不同 key） */
  key: z.string(),
  /** 卡片标题（面板内显示） */
  title: z.string(),
  /** 卡片主体 HTML 内容（前端 v-html 渲染） */
  html: z.string(),
  /** 面板内排序（数字越小越靠前；不提供则按注册序） */
  order: z.number().optional(),
  /** 卡片宽度档（对照前端面板网格列数；缺省 'auto' 自适应） */
  width: z.enum(['auto', 'half', 'full']).optional(),
  /** 是否禁用（隐藏该小组件卡片） */
  disabled: z.boolean().optional(),
})

export type UiWidget = z.infer<typeof UiWidgetSchema>

/** ui.getManifest → 前端要渲染的 UI 贡献（theme 单值 active；layouts 按 slot；views 为导航源码） */
export const UiManifestSchema = z.object({
  /** 当前生效主题（无主题插件时为 null） */
  theme: UiThemeSchema.nullable(),
  /** 各 slot 当前生效的布局贡献 */
  layouts: z.array(UiLayoutSlotSchema),
  /** 导航/页面视图集合 = 宿主内置 + 插件贡献（前端据此渲染导航条 + 注册路由） */
  views: z.array(UiViewSchema),
  /** 小组件面板条目（M10）：多个小组件插件各自贡献一块首页卡片 */
  widgets: z.array(UiWidgetSchema),
})

export type UiManifest = z.infer<typeof UiManifestSchema>

export const entities = {
  Version: VersionSchema,
  Account: AccountSchema,
  Mod: ModSchema,
  Modpack: ModpackSchema,
  ModpackFile: ModpackFileSchema,
  ModrinthProject: ModrinthProjectSchema,
  ModrinthVersion: ModrinthVersionSchema,
  Instance: InstanceSchema,
  ModLoader: ModLoaderSchema,
  UiTheme: UiThemeSchema,
  UiLayoutSlot: UiLayoutSlotSchema,
  UiView: UiViewSchema,
  UiViewAction: UiViewActionSchema,
  UiWidget: UiWidgetSchema,
  UiManifest: UiManifestSchema,
}
