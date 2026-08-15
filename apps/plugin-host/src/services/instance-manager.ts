/**
 * InstanceService —— 实例管理（OOP 领域服务，注入 Cordis）。
 *
 * 骨架阶段：纯内存实现 + in-memory 存储，供 IPC 全链路跑通。
 * M2 起替换为 SQLite + Drizzle 持久化（蓝图「五、数据」）。
 *
 * 以 Cordis Service 形式挂载，任何插件可 `inject: ['instanceManager']`。
 */

import { Service } from 'cordis'
import {
  InstanceSchema,
  type InstanceCreateParams,
} from '@mc-launcher/shared'
import { randomUUID } from 'node:crypto'

export class InstanceManagerService extends Service {
  private instances = new Map<string, Instance>()

  constructor(ctx: any) {
    super(ctx, 'instanceManager')
  }

  /** instance.list */
  list() {
    return { instances: [...this.instances.values()] }
  }

  /** instance.get */
  get(id: string) {
    const instance = this.instances.get(id)
    if (!instance) return { instance: null }
    return { instance }
  }

  /** instance.create — 骨架：内存持久化，返回创建后的实例 */
  create(params: InstanceCreateParams) {
    const id = randomUUID()
    const instance: Instance = {
      id,
      name: params.name,
      versionId: params.versionId,
      modLoader: params.modLoader,
      // 骨架默认目录：<data>/instances/<id>
      dir: `instances/${id}`,
      mods: [],
      accountId: params.accountId,
      createdAt: new Date().toISOString(),
    }
    // 用 shared schema 校验产物（自检）
    const parsed = InstanceSchema.parse(instance)
    this.instances.set(parsed.id, parsed)
    return { instance: parsed }
  }

  /** instance.remove */
  remove(id: string) {
    return { removed: this.instances.delete(id) }
  }
}
