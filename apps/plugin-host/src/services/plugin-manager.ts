/**
 * PluginManagerService —— Phase 0 插件装载（M7-5，蓝图「九、插件分发」）。
 *
 * 职责（Cordis 时空可组合范式落地）：
 *   - 扫描本地 `plugins/` 目录，每个插件一个子目录：`manifest.json` + `main.js` + `hash`
 *   - **hash 校验**：加载前校验 `main.js` 的内容哈希与 manifest.hash 一致，不一致则拒绝加载（防篡改）
 *   - **空间可组合**：动态 `import()` 插件 `main.js` 的 `{name, inject, apply(ctx)}`，
 *     经 `ctx.plugin()` 挂到根 context，依赖靠 inject 由 Cordis 自动解析/激活
 *   - **时间可组合**：`disable()` 调 `fiber.dispose()`，Cordis 自动逆序回滚该插件的所有 `ctx.effect`
 *   - 给前端/RPC 暴露 `plugin.list` / `plugin.enable` / `plugin.disable`
 *
 * 插件 `main.js` 形态（ESM，可 src 编译产物或用 bundler 打包）：
 *   ```js
 *   export const name = 'my-plugin'
 *   export const inject = ['rustBridge']
 *   export async function apply(ctx) {
 *     const off = ctx.rustBridge.on('my.command', (p) => ({ ok: true, p }))
 *     ctx.effect(() => off)      // 卸载时反注册 handler
 *   }
 *   ```
 */

import { Service } from 'cordis'
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ServiceName, log } from '../context.js'
import type { RustBridgeService } from '../bridge/rust-bridge.js'

/** 插件 manifest（蓝图 §九：name/version/api/publisher/hash；M8-1 增 type/slot） */
export interface PluginManifest {
  name: string
  version: string
  /** 插件 API 版本；与宿主约定的 API 兼容性级别（当前恒 1） */
  api: number
  publisher?: string
  /** 插件类型（M8-1）：functional=功能 / theme=主题 / layout=布局。缺省视为 functional */
  type?: 'functional' | 'theme' | 'layout'
  /** 布局插件：作用到的 slot 名（type=layout 时可选；用于 UI 层路由） */
  slot?: string
  /** main.js 的 SHA-256 十六进制，启动校验用 */
  hash: string
}

/** 一个已注册的插件运行时状态 */
export interface PluginRuntimeInfo {
  name: string
  version: string
  dir: string
  loaded: boolean
  hashOk: boolean
  reason?: string
  /** M8-1：插件类型（缺省 functional） */
  type?: 'functional' | 'theme' | 'layout'
}

/** 从 src 向上定位 <repo>/plugins 目录（dev 下即用户插件装载目录） */
function defaultPluginsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  // src/services → <plugin-host>/src → repo root → plugins
  const repoRoot = join(here, '..', '..', '..', '..')
  return join(repoRoot, 'plugins')
}

interface PendingPlugin {
  manifest: PluginManifest
  dir: string
  mainPath: string
  fiber: { dispose: () => Promise<void> } | null
}

export class PluginManagerService extends Service {
  /** 插件目录（可用 env MIKO_PLUGINS_DIR 覆盖，便于测试隔离） */
  private readonly pluginsDir: string
  private pending = new Map<string, PendingPlugin>()
  private started = false

  constructor(ctx: any) {
    super(ctx, ServiceName.pluginManager)
    this.pluginsDir = process.env.MIKO_PLUGINS_DIR ?? defaultPluginsDir()
    // 卸载服务时：把所有已加载插件 fiber 依次 dispose（时间可组合性全局回滚）
    ctx.effect(() => () => {
      for (const p of [...this.pending.values()]) void p.fiber?.dispose()
      this.pending.clear()
    })
  }

  private sha256(file: string): string {
    return createHash('sha256').update(readFileSync(file)).digest('hex')
  }

  /** 扫描插件目录，返回所有候选（含 hash 校验结果、是否可加载）。 */
  discover(): PluginRuntimeInfo[] {
    if (!existsSync(this.pluginsDir)) {
      log(`[plugin-manager] 插件目录不存在: ${this.pluginsDir}`)
      return []
    }
    const out: PluginRuntimeInfo[] = []
    for (const dirName of readdirSync(this.pluginsDir, { withFileTypes: true })) {
      if (!dirName.isDirectory() || dirName.name.startsWith('.')) continue
      const dir = join(this.pluginsDir, dirName.name)
      const manifestPath = join(dir, 'manifest.json')
      const mainPath = join(dir, 'main.js')
      if (!existsSync(manifestPath) || !existsSync(mainPath)) continue

      let manifest: PluginManifest
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as PluginManifest
      } catch {
        out.push({ name: dirName.name, version: '?', dir, loaded: false, hashOk: false, reason: 'manifest.json 解析失败' })
        continue
      }
      if (!manifest.name || !manifest.version) {
        out.push({ name: dirName.name, version: '?', dir, loaded: false, hashOk: false, reason: 'manifest 缺 name/version' })
        continue
      }

      let hashOk = false
      let reason: string | undefined
      try {
        const actual = this.sha256(mainPath)
        hashOk = !!manifest.hash && actual === manifest.hash
        if (!hashOk) {
          reason = `hash 不匹配（防篡改；期望 ${manifest.hash ?? '空'}，实际 ${actual.slice(0, 12)}…）`
        }
      } catch (e) {
        reason = `读取 main.js 失败: ${(e as Error).message}`
      }

      out.push({
        name: manifest.name,
        version: manifest.version,
        dir,
        loaded: this.pending.has(manifest.name),
        hashOk,
        reason,
        type: manifest.type ?? 'functional',
      })
    }
    return out
  }

  /** 加载单个插件（hash 通过才装载）。重复对同一 name 加载是幂等。 */
  async enable(name: string, pre?: PluginRuntimeInfo): Promise<PluginRuntimeInfo> {
    const existing = this.pending.get(name)
    if (existing?.fiber) {
      return { name, version: existing.manifest.version, dir: existing.dir, loaded: true, hashOk: true }
    }
    // 复用已 discover 的信息（loadAll 批量时避免对每个插件重复整目录扫描）
    const info = pre ?? this.discover().find((i) => i.name === name)
    if (!info) return { name, version: '?', dir: '', loaded: false, hashOk: false, reason: '未找到插件' }
    if (!info.hashOk) return { ...info, loaded: false, reason: info.reason ?? 'hash 校验失败' }

    const dir = info.dir
    const mainPath = join(dir, 'main.js')
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8')) as PluginManifest

    try {
      // 动态 import 插件 main.js（ESM）。用带 cache-busting query 防旧模块缓存。
      const mod = await import(`${mainPath}?v=${Date.now()}`)
      const pluginDef = mod.default
        ? // 默认导出对象 `{ name, inject, apply }`
          typeof mod.default?.apply === 'function' || typeof mod.default === 'function'
          ? mod.default
          : mod
        : mod

      // 挂到根 context —— 空间可组合：inject 依赖由 Cordis 自动解析，不满足则保持 PENDING
      const fiber = (await (this.ctx as any).plugin(pluginDef, { name })) as {
        dispose: () => Promise<void>
      }
      this.pending.set(name, { manifest, dir, mainPath, fiber })
      log(`[plugin-manager] 已装载插件「${name}@${manifest.version}」(hash✓)`)
      return { name, version: manifest.version, dir, loaded: true, hashOk: true }
    } catch (e) {
      log(`[plugin-manager] 插件「${name}」装载失败: ${(e as Error).message}`)
      return { name, version: manifest.version, dir, loaded: false, hashOk: true, reason: (e as Error).message }
    }
  }

  /** 卸载插件：fiber.dispose() 逆序回滚其所有 effect（时间可组合性）。 */
  async disable(name: string): Promise<boolean> {
    const p = this.pending.get(name)
    if (!p?.fiber) return false
    await p.fiber.dispose()
    this.pending.delete(name)
    log(`[plugin-manager] 已卸载插件「${name}」（effect 已全部回滚）`)
    return true
  }

  /** 启动时加载当前 `plugins/` 下所有 hash 通过的插件。幂等。 */
  async loadAll(): Promise<PluginRuntimeInfo[]> {
    if (this.started) return this.list()
    this.started = true
    const results: PluginRuntimeInfo[] = []
    for (const info of this.discover()) {
      if (info.hashOk) results.push(await this.enable(info.name, info))
      else results.push(info)
    }
    return results
  }

  list(): PluginRuntimeInfo[] {
    const discovered = this.discover()
    return discovered.map((d) => ({
      ...d,
      loaded: d.loaded || this.pending.has(d.name),
    }))
  }

  /** 注册 RPC：plugin.list / plugin.enable / plugin.disable */
  registerBridge(bridge: RustBridgeService) {
    bridge.on('plugin.list', () => ({ plugins: this.list() }))
    bridge.on('plugin.enable', async (params: { name: string }) => this.enable(params.name))
    bridge.on('plugin.disable', async (params: { name: string }) => ({
      disabled: await this.disable(params.name),
    }))
  }
}
