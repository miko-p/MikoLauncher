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
  icon: string | null
  java_major: number | null
  modpack: string | null
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
    icon: r.icon ?? undefined,
    javaMajor: r.java_major ?? undefined,
    modpack: r.modpack ? (JSON.parse(r.modpack) as Instance['modpack']) : undefined,
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
      icon: undefined,
      javaMajor: params.javaMajor,
      modpack: params.modpack,
      createdAt: new Date().toISOString(),
    }
    const validated = InstanceSchema.parse(instance) // 用 shared schema 自检
    this.db.raw
      .prepare(
        `INSERT INTO instances (id, name, version_id, mod_loader, dir, mods, account_id, icon, java_major, modpack, created_at)
         VALUES (@id, @name, @versionId, @modLoader, @dir, @mods, @accountId, @icon, @javaMajor, @modpack, @createdAt)`,
      )
      .run({
        id: validated.id,
        name: validated.name,
        versionId: validated.versionId,
        modLoader: validated.modLoader,
        dir: validated.dir,
        mods: JSON.stringify(validated.mods),
        accountId: validated.accountId ?? null,
        icon: validated.icon ?? null,
        javaMajor: validated.javaMajor ?? null,
        modpack: validated.modpack ? JSON.stringify(validated.modpack) : null,
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

  /**
   * 设置/清除实例自定义图标（M11：data-URI base64）。`icon` 传空串/null → 清理（回退内置土块占位）。
   * 返回更新后的实例；不存在返回 { instance: null }。
   */
  updateIcon(id: string, icon: string | null | undefined) {
    const row = this.db.raw.prepare('SELECT * FROM instances WHERE id = ?').get(id) as
      | InstanceRow
      | undefined
    if (!row) return { instance: null }
    const value = icon && icon.trim() !== '' ? icon : null
    this.db.raw.prepare('UPDATE instances SET icon = ? WHERE id = ?').run(value, id)
    const updated = rowToInstance({ ...row, icon: value } as InstanceRow)
    return { instance: updated }
  }

  /**
   * 设置/清除实例期望的 Java 主版本（M12：实例详情页 Java 版本选择）。
   * `javaMajor` 传 null/undefined → 清除（回退按 MC 版本要求自动选 JRE）。
   * 返回更新后的实例；不存在返回 { instance: null }。
   */
  updateJavaMajor(id: string, javaMajor: number | null | undefined) {
    const row = this.db.raw.prepare('SELECT * FROM instances WHERE id = ?').get(id) as
      | InstanceRow
      | undefined
    if (!row) return { instance: null }
    const value = javaMajor && javaMajor > 0 ? javaMajor : null
    this.db.raw.prepare('UPDATE instances SET java_major = ? WHERE id = ?').run(value, id)
    const updated = rowToInstance({ ...row, java_major: value } as InstanceRow)
    return { instance: updated }
  }

  /**
   * 直接覆写实例的 mods 列表（M13：下载模组包后立即把解析出的模组清单填进实例 mods 展示）。
   * 文件本体仍由首次启动时 lighty 实装；这里只持久化清单（列表展示用）。
   * 返回更新后的实例；不存在返回 { instance: null }。
   */
  updateMods(id: string, mods: unknown[]) {
    const row = this.db.raw.prepare('SELECT * FROM instances WHERE id = ?').get(id) as
      | InstanceRow
      | undefined
    if (!row) return { instance: null }
    const list = Array.isArray(mods) ? mods : []
    this.db.raw.prepare('UPDATE instances SET mods = ? WHERE id = ?').run(JSON.stringify(list), id)
    const updated = rowToInstance({ ...row, mods: JSON.stringify(list) } as InstanceRow)
    return { instance: updated }
  }
}
