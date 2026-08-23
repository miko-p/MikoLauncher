/**
 * SQLite 持久化层 —— node:sqlite（对应蓝图「五、数据」）。
 *
 * 实例/账号等数据落盘，重启侧车后仍在（替代 M2 的纯内存 Map）。
 * DB 路径：优先 env `MC_LAUNCHER_DATA_DIR`，否则 <plugin-host>/data/miko-launcher.db。
 *
 * M9 发布 runtime 落地：从 better-sqlite3 迁移到 Node 26 内置的 `node:sqlite`
 * （DatabaseSync）。目的：去掉 sidecar 唯一的原生 .node 外部依赖，使
 * `bun build --compile` 能打出纯单文件可执行（方案 A 单文件内嵌）。
 * 二者都是同步 SQLite 驱动，API 兼容（prepare/run/get/all/exec）；
 * 差异：pragma 用 exec("PRAGMA ...")，绑定支持 @name / :name 命名参数。
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function defaultDataDir(): string {
  const env = process.env.MC_LAUNCHER_DATA_DIR
  if (env) return env
  const here = dirname(fileURLToPath(import.meta.url))
  // src/services → <root>/apps/plugin-host
  const hostRoot = join(here, '..', '..')
  return join(hostRoot, 'data')
}

export interface Db {
  readonly raw: DatabaseSync
  /**
   * 使服务在卸载/进程退出时关闭连接。返回清理函数（供 ctx.effect 注册）。
   */
  close: () => void
}

let _instance: Db | null = null

/** 获取单例 DB（启动时初始化 schema）。 */
export function getDb(dataDir: string = defaultDataDir()): Db {
  if (_instance) return _instance
  mkdirSync(dataDir, { recursive: true })
  const raw = new DatabaseSync(join(dataDir, 'miko-launcher.db'))
  raw.exec('PRAGMA journal_mode = WAL')
  raw.exec('PRAGMA foreign_keys = ON')
  migrate(raw)
  const db: Db = {
    raw,
    close: () => {
      try {
        raw.close()
      } catch {
        /* already closed */
      }
      _instance = null
    },
  }
  _instance = db
  return db
}

/** 建表（幂等）。 */
function migrate(raw: DatabaseSync) {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS instances (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      version_id  TEXT NOT NULL,
      mod_loader  TEXT NOT NULL,
      dir         TEXT NOT NULL,
      mods        TEXT NOT NULL DEFAULT '[]',
      account_id  TEXT,
      created_at  TEXT NOT NULL
    );
  `)
}

/** 供测试/上下文隔离用：重置单例。 */
export function resetDbForTest() {
  if (_instance) {
    _instance.close()
    _instance = null
  }
}
