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
  type Instance,
  type Account,
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
}): Promise<Instance> {
  const data = await call<{ instance: Instance }>('instance_create', { payload })
  return instanceCreateDataSchema.parse(data).instance
}

/** instance.launch —— Rust 本地真实启动，返回结构化数据。 */
export async function launchInstance(payload: {
  instanceId: string
  /** 可选：启动时指定账号 id（否则用实例绑定账号/离线） */
  accountId?: string
  jvmArgs?: string[]
  offline?: boolean
}): Promise<{ pid: number; javaVersion: string; jvmArgs: string[] }> {
  const data = await call<{ pid: number; javaVersion: string; jvmArgs: string[] }>(
    'instance_launch',
    { payload },
  )
  return instanceLaunchDataSchema.parse(data)
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

/** version_manifest —— 真实拉取 Mojang 版本清单（Rust 内核）。 */
export async function fetchVersions(): Promise<
  { id: string; type: string; url: string; releaseTime: string; javaMajor?: number | null }[]
> {
  const data = await call<{ versions: unknown[] }>('version_manifest')
  // 轻量校验：至少要有 versions 数组；条目字段由调用方按需收窄
  if (!data || !Array.isArray(data.versions)) {
    throw new Error('version_manifest 返回异常')
  }
  return data.versions as { id: string; type: string; url: string; releaseTime: string }[]
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

/** account.remove —— 删除账号。 */
export async function removeAccount(id: string): Promise<boolean> {
  const data = await call<{ removed: boolean }>('account_remove', { payload: { id } })
  return accountRemoveDataSchema.parse(data).removed
}

/** plugin.list —— Phase0 插件列表（M7-5）。 */
export async function listPlugins(): Promise<
  { name: string; version: string; loaded: boolean; hashOk: boolean; reason?: string }[]
> {
  const data = await call<{ plugins: never[] }>('plugin_list')
  return (data.plugins ?? []) as { name: string; version: string; loaded: boolean; hashOk: boolean }[]
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
