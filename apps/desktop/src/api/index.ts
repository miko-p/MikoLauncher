/**
 * 前端 → Rust 的 bridge：封装 `@tauri-apps/api` 的 invoke，并用 shared Zod 契约校验。
 *
 * 每个方法对应一个 Rust Tauri command。响应用 @miko-launcher/shared 里的
 * schema `.parse()` 校验，契约漂移会立刻在调用方暴露（而非最终运行时崩溃）。
 */

import { invoke } from '@tauri-apps/api/core'
import {
  instanceListDataSchema,
  instanceCreateDataSchema,
  instanceUpdateAccountDataSchema,
  instanceLaunchDataSchema,
  accountListDataSchema,
  accountLoginOfflineDataSchema,
  accountLoginMicrosoftDataSchema,
  accountRemoveDataSchema,
  accountRefreshDataSchema,
  uiGetManifestDataSchema,
  viewActionDataSchema,
  type ViewActionData,
  type Instance,
  type Account,
  type UiManifest,
  type ModrinthProject,
  type ModrinthVersion,
  type ModpackFile,
  type Mod,
} from '@miko-launcher/shared'

/** invoke 的强类型返回：失败时抛 Error(带 message)。 */
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args)
}

/** instance.list —— 返回实例数组。 */
export async function listInstances(): Promise<Instance[]> {
  const data = await call<{ instances: Instance[] }>('instance_list')
  return instanceListDataSchema.parse(data).instances
}

/** instance.create —— 入参形状与 shared 契约一致。 */
export async function createInstance(payload: {
  name: string
  versionId: string
  modLoader: 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'
  accountId?: string
  javaMajor?: number
  modpack?: {
    provider: 'modrinth'
    project: string
    title: string
    iconUrl?: string
    versionId: string
    versionNumber: string
    fileUrl?: string
  }
}): Promise<Instance> {
  const data = await call<{ instance: Instance }>('instance_create', { payload })
  return instanceCreateDataSchema.parse(data).instance
}

/** launch:status 事件负载（M11-3：游戏运行状态推前端状态列）。 */
export type LaunchStatusEvent = {
  instanceId: string
  action: 'started' | 'exit' | 'error'
  pid?: number
  message?: string
}

/** instance.launch —— M11-3 非阻塞启动：提交即返回 {started}，运行状态经 launch:status 事件推前端。 */
export async function launchInstance(payload: {
  instanceId: string
  /** 可选：启动时指定账号 id（否则用实例绑定账号/离线） */
  accountId?: string
  jvmArgs?: string[]
  offline?: boolean
}): Promise<{ started: boolean; instanceId: string }> {
  const data = await call<{ started: boolean; instanceId: string }>(
    'instance_launch',
    { payload },
  )
  return instanceLaunchDataSchema.parse(data)
}

/** launch.status —— 查询当前运行中的实例（前端挂载时恢复状态列）。 */
export async function getLaunchStatus(): Promise<{ instanceId: string; pid: number }[]> {
  const data = await call<{ running: { instanceId: string; pid: number }[] }>('launch_status', {})
  return data.running
}

/** instance.updateAccount —— 绑定/解绑实例关联账号（M7 持久化）。accountId 传 undefined 解绑。 */
export async function updateInstanceAccount(
  id: string,
  accountId?: string | null,
): Promise<Instance> {
  const data = await call<{ instance: Instance }>('instance_update_account', {
    payload: { id, accountId },
  })
  return instanceUpdateAccountDataSchema.parse(data).instance
}

/** instance.updateIcon —— 设置/清除实例自定义图标（M11：data-URI base64）。icon 传空/undefined 清除。 */
export async function updateInstanceIcon(
  id: string,
  icon?: string | null,
): Promise<Instance> {
  const data = await call<{ instance: Instance }>('instance_update_icon', {
    payload: { id, icon },
  })
  return instanceUpdateAccountDataSchema.parse(data).instance
}

/** instance.updateJavaMajor —— 设置/清除实例期望的 Java 主版本（M12：实例详情页可选）。javaMajor 传 null/undefined 清除。 */
export async function updateInstanceJavaMajor(
  id: string,
  javaMajor?: number | null,
): Promise<Instance> {
  const data = await call<{ instance: Instance }>('instance_update_java_major', {
    payload: { id, javaMajor },
  })
  return instanceUpdateAccountDataSchema.parse(data).instance
}

/** instance.remove —— 删除实例。返回是否删除成功。 */
export async function removeInstance(id: string): Promise<boolean> {
  const data = await call<{ removed: boolean }>('instance_remove', { payload: { id } })
  return data.removed
}

/** version_list —— 版本下拉用轻量清单（Rust 内核，仅由 main manifest 一次返回，不逐版 enrich，秒开）。 */
export async function fetchVersions(): Promise<
  { id: string; type: string; url: string; releaseTime: string; javaMajor?: number | null }[]
> {
  const data = await call<{ versions: unknown[] }>('version_list')
  // 轻量校验：至少要有 versions 数组；条目字段由调用方按需收窄
  if (!data || !Array.isArray(data.versions)) {
    throw new Error('version_list 返回异常')
  }
  return data.versions as { id: string; type: string; url: string; releaseTime: string }[]
}

/** version.check —— 校验某个版本 id 是否真实存在（在完整 Mojang 清单里精确匹配）。 */
export async function checkVersionExists(
  id: string,
): Promise<{ exists: boolean; version?: { id: string; type: string; url: string; releaseTime: string } }> {
  return call('version_check', { payload: { id } })
}

/** modrinth.search —— 搜索 Modrinth 项目（模组/模组包）。index 排序：relevance/downloads/follows/newest/updated。 */
export async function modrinthSearch(params: {
  query?: string
  projectType?: 'modpack' | 'mod' | 'all'
  index?: 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated'
  limit?: number
  offset?: number
}): Promise<{
  hits: ModrinthProject[]
  total_hits: number
  offset: number
  limit: number
}> {
  const data = await call<{ hits: ModrinthProject[]; total_hits: number; offset: number; limit: number }>(
    'modrinth_search',
    { payload: { query: params.query ?? '', projectType: params.projectType ?? 'modpack', index: params.index ?? 'relevance', limit: params.limit ?? 24, offset: params.offset ?? 0 } },
  )
  return data
}

/** modrinth.project —— 单个 Modrinth 项目详情（按 slug 或 id）。 */
export async function modrinthProject(slug: string): Promise<ModrinthProject> {
  return call<ModrinthProject>('modrinth_project', { payload: { slug } })
}

/** modrinth.projectVersions —— 项目版本列表（选版本建实例）。 */
export async function modrinthProjectVersions(
  slug: string,
  limit = 50,
): Promise<ModrinthVersion[]> {
  return call<ModrinthVersion[]>('modrinth_project_versions', { payload: { slug, limit } })
}

/** modrinth.modpackFiles —— 下载并解析 `.mrpack`（zip），返回模组包文件清单（M13：创建实例后填进实例 mods 展示）。 */
export async function modrinthModpackFiles(fileUrl: string): Promise<ModpackFile[]> {
  const data = await call<unknown[]>('modrinth_modpack_files', { payload: { fileUrl } })
  // 轻量校验：条目为 ModpackFile 形状，字段由调用方按需收窄
  const files =
    data && Array.isArray(data)
      ? (data as ModpackFile[])
      : []
  return files
}

/** modrinth.downloadIcon —— 下载远程图片并编码为 data URI（存实例 icon，模组包实例图标跟随模组包）。 */
export async function downloadIconDataUrl(url: string): Promise<string> {
  return call<string>('modrinth_download_icon', { payload: { url } })
}

/** instance.updateMods —— 直接覆写实例的 mods 列表（M13：模组包文件清单持久化展示）。 */
export async function updateInstanceMods(id: string, mods: Mod[]): Promise<Instance> {
  const data = await call<{ instance: Instance }>('instance_update_mods', {
    payload: { id, mods },
  })
  return instanceUpdateAccountDataSchema.parse(data).instance
}

/** account.list —— 账号列表。 */
export async function listAccounts(): Promise<Account[]> {
  const data = await call<{ accounts: Account[] }>('account_list')
  return accountListDataSchema.parse(data).accounts
}

/** account.loginOffline —— 创建/返回离线账号。 */
export async function loginOffline(name: string): Promise<Account> {
  const data = await call<{ account: Account }>('account_login_offline', { payload: { name } })
  return accountLoginOfflineDataSchema.parse(data).account
}

/** account.loginMicrosoft —— 微软设备流登录（阻塞直到用户授权；device code 经事件推送）。 */
export async function loginMicrosoft(): Promise<Account> {
  const data = await call<{ account: Account }>('account_login_microsoft', {})
  return accountLoginMicrosoftDataSchema.parse(data).account
}

/** M10-4：授权码流（PCL 式）—— 生成微软登录 URL 并自动在系统浏览器打开；返回 url + redirectUri。 */
export async function loginMicrosoftUrl(): Promise<{ url: string; redirectUri: string }> {
  const data = await call<{ url: string; redirectUri: string }>('account_login_microsoft_url', {})
  return data
}

/** M10-4：授权码流 —— 用户粘回授权后的 URL/裸 code，完成登录并返回账号。 */
export async function finishMicrosoftLogin(codeOrUrl: string): Promise<Account> {
  const data = await call<{ account: Account }>('account_login_microsoft_code', {
    codeOrUrl,
  })
  return accountLoginMicrosoftDataSchema.parse(data).account
}

/** M10-5：PCL 式全自动登录（自注册公共应用 + v2.0 loopback 回跳）——点登录自动弹浏览器并在授权后自动捕获完成，返回账号。 */
export async function loginMicrosoftLoopback(): Promise<Account> {
  const data = await call<{ account: Account }>('account_login_microsoft_loopback', {})
  return accountLoginMicrosoftDataSchema.parse(data).account
}

/** account.remove —— 删除账号。 */
export async function removeAccount(id: string): Promise<boolean> {
  const data = await call<{ removed: boolean }>('account_remove', { payload: { id } })
  return accountRemoveDataSchema.parse(data).removed
}

/** account.refresh —— 检测指定 Azure/微软账号的 refresh_token 是否仍有效（M9-2）。 */
export async function refreshAccount(id: string): Promise<{
  account: Account
  needsReauth: boolean
  message?: string | null
}> {
  const data = await call<{
    account: Account
    needsReauth: boolean
    message?: string | null
  }>('account_refresh', { payload: { id } })
  return accountRefreshDataSchema.parse(data)
}

/** plugin.list —— Phase0 插件列表（M7-5）。 */
export async function listPlugins(): Promise<
  {
    name: string
    version: string
    loaded: boolean
    hashOk: boolean
    reason?: string
    /** M9-3：持久化的期望启用状态（重启后仍保持） */
    enabled?: boolean
  }[]
> {
  const data = await call<{ plugins: never[] }>('plugin_list')
  return (data.plugins ?? []) as {
    name: string
    version: string
    loaded: boolean
    hashOk: boolean
    enabled?: boolean
  }[]
}

/** plugin.enable —— 启用插件（M7-5）。 */
export async function enablePlugin(name: string) {
  return call<{ name: string; version?: string; loaded: boolean; hashOk?: boolean }>(
    'plugin_enable',
    { payload: { name } },
  )
}

/** plugin.disable —— 禁用插件（卸载即回滚其 effect，M7-5）。 */
export async function disablePlugin(name: string): Promise<boolean> {
  const data = await call<{ disabled: boolean }>('plugin_disable', { payload: { name } })
  return data.disabled
}

/** ui.getManifest —— 拉取当前生效的主题 + 布局贡献（M8-1）。 */
export async function getUiManifest(): Promise<UiManifest> {
  const data = await call<UiManifest>('ui_get_manifest', {})
  return uiGetManifestDataSchema.parse(data)
}

/** ui.viewAction —— 触发插件视图的一个动作（M9-6 交互插件）。 */
export async function viewAction(payload: {
  key: string
  action: string
  params?: unknown
}): Promise<ViewActionData> {
  const data = await call<ViewActionData>('plugin_view_action', { payload })
  return viewActionDataSchema.parse(data)
}
