/**
 * # IPC 契约 — 方法与事件 (methods)
 *
 * 首批领域命令 / 事件，对应蓝图 M1 交付物 2：
 *   - instance.launch / instance.list / instance.remove
 *   - 下载进度事件（前端订阅，后端推送 progress）
 *
 * 每个方法断言 params / data 结构。转发给 Rust 核心或由 sidecar 处理。
 */

import { z } from 'zod'
import { AccountSchema, InstanceSchema, ModpackSchema, UiManifestSchema } from './entities.js'

/* ------------------------------------------------------------------ *
 *  方法名表（注册点）                                                  *
 * ------------------------------------------------------------------ */

export const Method = {
  instanceList: 'instance.list',
  instanceGet: 'instance.get',
  instanceCreate: 'instance.create',
  instanceRemove: 'instance.remove',
  instanceUpdateAccount: 'instance.updateAccount',
  instanceUpdateJavaMajor: 'instance.updateJavaMajor',
  instanceLaunch: 'instance.launch',
  accountList: 'account.list',
  accountLoginOffline: 'account.loginOffline',
  accountLoginMicrosoft: 'account.loginMicrosoft',
  accountRemove: 'account.remove',
  accountRefresh: 'account.refresh',
  uiGetManifest: 'ui.getManifest',
} as const

export type MethodName = (typeof Method)[keyof typeof Method]

/* ------------------------------------------------------------------ *
 *  instance.list                                                      *
 * ------------------------------------------------------------------ */

export const instanceListParamsSchema = z.object({}).nullable().optional()

export const instanceListDataSchema = z.object({
  instances: z.array(InstanceSchema),
})

export type InstanceListData = z.infer<typeof instanceListDataSchema>

/* ------------------------------------------------------------------ *
 *  instance.get                                                       *
 * ------------------------------------------------------------------ */

export const instanceGetParamsSchema = z.object({
  id: z.string(),
})

export const instanceGetDataSchema = z.object({
  instance: InstanceSchema,
})

/* ------------------------------------------------------------------ *
 *  instance.create                                                    *
 * ------------------------------------------------------------------ */

export const instanceCreateParamsSchema = z.object({
  name: z.string().min(1),
  versionId: z.string().min(1),
  modLoader: z.enum(['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']),
  /** 可选：创建时即关联账号 */
  accountId: z.string().optional(),
  /** 可选：创建时即设实例期望 Java 主版本 */
  javaMajor: z.number().int().positive().optional(),
  /** 可选：创建时即绑定 Modrinth 模组包（「从模组包开始」；安装于首次启动） */
  modpack: ModpackSchema.optional(),
})

export type InstanceCreateParams = z.infer<typeof instanceCreateParamsSchema>

export const instanceCreateDataSchema = z.object({
  instance: InstanceSchema,
})

/* ------------------------------------------------------------------ *
 *  instance.remove                                                    *
 * ------------------------------------------------------------------ */

export const instanceRemoveParamsSchema = z.object({
  id: z.string(),
})

export const instanceRemoveDataSchema = z.object({
  removed: z.boolean(),
})

/* ------------------------------------------------------------------ *
 *  instance.updateAccount                                             *
 * ------------------------------------------------------------------ */

export const instanceUpdateAccountParamsSchema = z.object({
  id: z.string(),
  /** 绑定/解绑账号 id；传 null 或空串解绑（回到离线 Player） */
  accountId: z.string().nullable().optional(),
})

export type InstanceUpdateAccountParams = z.infer<typeof instanceUpdateAccountParamsSchema>

export const instanceUpdateAccountDataSchema = z.object({
  instance: InstanceSchema,
})

/* ------------------------------------------------------------------ *
 *  instance.updateJavaMajor                                            *
 * ------------------------------------------------------------------ */

export const instanceUpdateJavaMajorParamsSchema = z.object({
  id: z.string(),
  /** 期望的 Java 主版本；传 null/空 清除（回退按 MC 版本要求自动选） */
  javaMajor: z.number().int().positive().nullable().optional(),
})

export type InstanceUpdateJavaMajorParams = z.infer<typeof instanceUpdateJavaMajorParamsSchema>

export const instanceUpdateJavaMajorDataSchema = z.object({
  instance: InstanceSchema,
})

/* ------------------------------------------------------------------ *
 *  instance.launch                                                    *
 * ------------------------------------------------------------------ */

export const instanceLaunchParamsSchema = z.object({
  instanceId: z.string(),
  /** 额外 JVM 参数（如 -Xmx2G） */
  jvmArgs: z.array(z.string()).optional(),
  /** 是否离线启动（默认按实例账号，无则离线） */
  offline: z.boolean().optional(),
})

export type InstanceLaunchParams = z.infer<typeof instanceLaunchParamsSchema>

export const instanceLaunchDataSchema = z.object({
  /** M11-3：启动已提交（非阻塞；游戏进程 pid/运行状态经 `launch:status` 事件 + `launch_status` 查询推送） */
  started: z.boolean(),
  instanceId: z.string(),
})

export type InstanceLaunchData = z.infer<typeof instanceLaunchDataSchema>

/* ------------------------------------------------------------------ *
 *  account.list                                                       *
 * ------------------------------------------------------------------ */

export const accountListParamsSchema = z.object({}).nullable().optional()

export const accountListDataSchema = z.object({
  accounts: z.array(AccountSchema),
})

export type AccountListData = z.infer<typeof accountListDataSchema>

/* ------------------------------------------------------------------ *
 *  account.loginOffline                                               *
 * ------------------------------------------------------------------ */

export const accountLoginOfflineParamsSchema = z.object({
  /** 离线用户名（3-16 位字母数字下划线） */
  name: z.string().min(3).max(16),
})

export type AccountLoginOfflineParams = z.infer<typeof accountLoginOfflineParamsSchema>

export const accountLoginOfflineDataSchema = z.object({
  account: AccountSchema,
})

/* ------------------------------------------------------------------ *
 *  account.loginMicrosoft                                             *
 * ------------------------------------------------------------------ */

export const accountLoginMicrosoftParamsSchema = z.object({}).nullable().optional()

export type AccountLoginMicrosoftParams = z.infer<typeof accountLoginMicrosoftParamsSchema>

export const accountLoginMicrosoftDataSchema = z.object({
  account: AccountSchema,
})

/* ------------------------------------------------------------------ *
 *  account.remove                                                     *
 * ------------------------------------------------------------------ */

export const accountRemoveParamsSchema = z.object({
  id: z.string(),
})

export const accountRemoveDataSchema = z.object({
  removed: z.boolean(),
})

/* ------------------------------------------------------------------ *
 *  account.refresh（M9-2 微软刷新失败重登）                             *
 *  对指定微软账号显式触发一次静默刷新检测，区分「凭据仍有效」/「已失效     *
 *  需重新登录」。前端据此在账号上显示失效提示与重新登录入口。            *
 * ------------------------------------------------------------------ */

export const accountRefreshParamsSchema = z.object({
  id: z.string(),
})

export type AccountRefreshParams = z.infer<typeof accountRefreshParamsSchema>

export const accountRefreshDataSchema = z.object({
  /** 刷新后的账号（离线/未变时传原样；access_token 不导出） */
  account: AccountSchema,
  /** true = refresh_token 已失效，需用户重新登录（前端显示重登按钮） */
  needsReauth: z.boolean(),
  /** 失效/异常时的人类可读原因（有效或无异常时为 null / 缺省） */
  message: z.string().nullish(),
})

export type AccountRefreshData = z.infer<typeof accountRefreshDataSchema>

/* ------------------------------------------------------------------ *
 *  ui.getManifest（M8-1 主题/布局插件）                                *
 *  前端拉取当前生效的 UI 贡献（active theme + per-slot layouts）。      *
 * ------------------------------------------------------------------ */

export const uiGetManifestParamsSchema = z.object({}).nullable().optional()

export const uiGetManifestDataSchema = UiManifestSchema

export type UiGetManifestData = z.infer<typeof uiGetManifestDataSchema>

/* ------------------------------------------------------------------ *
 *  ui.viewAction（M9-6 交互插件）                                      *
 *  前端触发插件视图的一个动作：Rust 转发到 sidecar 的 view.<key>.<action> *
 *  （该 sidecar 方法名动态，不在 methodRegistry，由插件 rustBridge.on 注册） *
 * ------------------------------------------------------------------ */

export const viewActionParamsSchema = z.object({
  /** 视图 key（对应插件贡献的 view.key） */
  key: z.string(),
  /** 动作 id（对应插件注册的 view.<key>.<action> 中的 action） */
  action: z.string(),
  /** 传给插件 handler 的参数（可选，任意 JSON） */
  params: z.unknown().optional(),
})

export type ViewActionParams = z.infer<typeof viewActionParamsSchema>

/** 动作结果：任意 JSON（由插件 handler 决定形状；前端不强制 schema，契约宽松） */
export const viewActionDataSchema = z.unknown()

export type ViewActionData = z.infer<typeof viewActionDataSchema>

/* ------------------------------------------------------------------ *
 *  微软登录事件（device code 提示，Rust → 前端）                         *
 * ------------------------------------------------------------------ */

export const AccountDeviceCodeEventName = 'account:device-code' as const

/** 微软设备流登录时推给前端，提示用户去浏览器输入 code */
export const AccountDeviceCodeSchema = z.object({
  /** 一次性验证码 */ 
  userCode: z.string(),
  /** 验证网址（如 https://microsoft.com/link） */
  verificationUri: z.string(),
})

export type AccountDeviceCode = z.infer<typeof AccountDeviceCodeSchema>

/* ------------------------------------------------------------------ *
 *  下载进度事件（Tauri events，Rust → 前端）                            *
 * ------------------------------------------------------------------ */

export const DownloadEventName = 'download:progress' as const

/** 下载进度事件负载 —— 长耗时进度走 Tauri events 推给前端 */
export const DownloadProgressSchema = z.object({
  /** 关联实例 id（可为空表示全局清单下载） */
  instanceId: z.string().optional(),
  /** 文件/资源标识 */
  target: z.string(),
  /** 已下载字节 */
  downloaded: z.number().int().nonnegative(),
  /** 总字节 */
  total: z.number().int().nonnegative(),
  /** 0..1 */
  ratio: z.number().min(0).max(1),
  /** 状态阶段：正在下载 / 完成 / 失败 */
  phase: z.enum(['downloading', 'done', 'error']),
  /** phase=error 时的错误码 */
  errorCode: z.string().optional(),
})

export type DownloadProgress = z.infer<typeof DownloadProgressSchema>

/* ------------------------------------------------------------------ *
 *  注册表：method → (params, data) 断言                                *
 * ------------------------------------------------------------------ */

export const methodRegistry = {
  [Method.instanceList]: {
    params: instanceListParamsSchema,
    data: instanceListDataSchema,
  },
  [Method.instanceGet]: {
    params: instanceGetParamsSchema,
    data: instanceGetDataSchema,
  },
  [Method.instanceCreate]: {
    params: instanceCreateParamsSchema,
    data: instanceCreateDataSchema,
  },
  [Method.instanceRemove]: {
    params: instanceRemoveParamsSchema,
    data: instanceRemoveDataSchema,
  },
  [Method.instanceUpdateAccount]: {
    params: instanceUpdateAccountParamsSchema,
    data: instanceUpdateAccountDataSchema,
  },
  [Method.instanceLaunch]: {
    params: instanceLaunchParamsSchema,
    data: instanceLaunchDataSchema,
  },
  [Method.accountList]: {
    params: accountListParamsSchema,
    data: accountListDataSchema,
  },
  [Method.accountLoginOffline]: {
    params: accountLoginOfflineParamsSchema,
    data: accountLoginOfflineDataSchema,
  },
  [Method.accountLoginMicrosoft]: {
    params: accountLoginMicrosoftParamsSchema,
    data: accountLoginMicrosoftDataSchema,
  },
  [Method.accountRemove]: {
    params: accountRemoveParamsSchema,
    data: accountRemoveDataSchema,
  },
  [Method.accountRefresh]: {
    params: accountRefreshParamsSchema,
    data: accountRefreshDataSchema,
  },
  [Method.uiGetManifest]: {
    params: uiGetManifestParamsSchema,
    data: uiGetManifestDataSchema,
  },
} as const

export type MethodRegistry = typeof methodRegistry

/**
 * 从方法名解析该方法的 params / data schema。
 * 未知方法返回 undefined → 上层可抛 METHOD_NOT_FOUND。
 */
export const getMethodSchema = (method: string) =>
  (methodRegistry as Record<string, unknown>)[method]
