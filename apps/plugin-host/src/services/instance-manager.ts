/**
 * InstanceService —— 实例管理（OOP 领域服务，注入 Cordis）。
 *
 * M3 起用 SQLite 持久化（better-sqlite3，见 db.ts），替代 M2 的纯内存 Map：
 *   - 启动时从库加载实例
 *   - list/get 直接读库
 *   - create/remove 写库
 *   - 重启侧车后数据仍在
 */

import { Service } from 'cordis'
import { InstanceSchema, type Instance, type InstanceCreateParams } from '@miko-launcher/shared'
import { randomUUID } from 'node:crypto'
import { getDb, type Db } from './db.js'

interface InstanceRow {
  id: string
  name: string
  version_id: string
  mod_loader: string
  dir: string
  mods: string
  account_id: string | null
  created_at: string
}

function rowToInstance(r: InstanceRow): Instance {
  return {
    id: r.id,
    name: r.name,
    versionId: r.version_id,
    modLoader: r.mod_loader as Instance['modLoader'],
    dir: r.dir,
    mods: JSON.parse(r.mods),
    accountId: r.account_id ?? undefined,
    createdAt: r.created_at,
  }
}

export class InstanceManagerService extends Service {
  private db: Db

  constructor(ctx: any) {
    super(ctx, 'instanceManager')
    this.db = getDb()
    // DB 连接是副作用：卸载服务时关闭（Cordis 时间可组合）
    ctx.effect(() => () => this.db.close())
  }

  /** 全部实例（按创建时间倒序）。 */
  list() {
    const rows = this.db.raw
      .prepare('SELECT * FROM instances ORDER BY created_at DESC')
      .all() as unknown as InstanceRow[]
    return { instances: rows.map(rowToInstance) }
  }

  /** 单个实例；不存在返回 instance:null。 */
  get(id: string) {
    const row = this.db.raw.prepare('SELECT * FROM instances WHERE id = ?').get(id) as
      | InstanceRow
      | undefined
    return { instance: row ? rowToInstance(row) : null }
  }

  /** 创建实例并落库。 */
  create(params: InstanceCreateParams) {
    const id = randomUUID()
    const instance: Instance = {
      id,
      name: params.name,
      versionId: params.versionId,
      modLoader: params.modLoader,
      dir: `instances/${id}`,
      mods: [],
      accountId: params.accountId,
      createdAt: new Date().toISOString(),
    }
    const validated = InstanceSchema.parse(instance) // 用 shared schema 自检
    this.db.raw
      .prepare(
        `INSERT INTO instances (id, name, version_id, mod_loader, dir, mods, account_id, created_at)
         VALUES (@id, @name, @versionId, @modLoader, @dir, @mods, @accountId, @createdAt)`,
      )
      .run({
        id: validated.id,
        name: validated.name,
        versionId: validated.versionId,
        modLoader: validated.modLoader,
        dir: validated.dir,
        mods: JSON.stringify(validated.mods),
        accountId: validated.accountId ?? null,
        createdAt: validated.createdAt,
      })
    return { instance: validated }
  }

  /** 删除实例；返回是否删除成功。 */
  remove(id: string) {
    const info = this.db.raw.prepare('DELETE FROM instances WHERE id = ?').run(id)
    return { removed: info.changes > 0 }
  }

  /**
   * 绑定/解绑实例关联账号（M7：实例账号绑定持久化）。
   * `accountId` 传 null/空串 → 解绑（启动时回退离线 Player）。
   * 返回更新后的实例；不存在返回 { instance: null }。
   */
  updateAccount(id: string, accountId: string | null | undefined) {
    const row = this.db.raw.prepare('SELECT * FROM instances WHERE id = ?').get(id) as
      | InstanceRow
      | undefined
    if (!row) return { instance: null }
    const bound = accountId && accountId.trim() !== '' ? accountId : null
    this.db.raw
      .prepare('UPDATE instances SET account_id = ? WHERE id = ?')
      .run(bound, id)
    const updated = rowToInstance({
      ...row,
      account_id: bound,
    } as InstanceRow)
    return { instance: updated }
  }
}
