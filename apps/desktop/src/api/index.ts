/**
 * 前端 → Rust 的 bridge：封装 `@tauri-apps/api` 的 invoke，并用 shared Zod 契约校验。
 *
 * 每个方法对应一个 Rust Tauri command。响应用 @mc-launcher/shared 里的
 * schema `.parse()` 校验，契约漂移会立刻在调用方暴露（而非最终运行时崩溃）。
 */

import { invoke } from '@tauri-apps/api/core'
import {
  instanceListDataSchema,
  instanceCreateDataSchema,
  instanceLaunchDataSchema,
  type Instance,
} from '@mc-launcher/shared'

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

/** instance.launch —— 骨架阶段 Rust 侧转发，返回结构化数据（或明确报错）。 */
export async function launchInstance(payload: {
  instanceId: string
  jvmArgs?: string[]
  offline?: boolean
}): Promise<{ pid: number; javaVersion: string; jvmArgs: string[] }> {
  const data = await call<{ pid: number; javaVersion: string; jvmArgs: string[] }>(
    'instance_launch',
    { payload },
  )
  return instanceLaunchDataSchema.parse(data)
}
