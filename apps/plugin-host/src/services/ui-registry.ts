/**
 * UiRegistryService —— 主题/布局插件贡献的侧车侧镜像（M8-1）。
 *
 * 蓝图「十、三类插件」：主题（CSS 变量）与布局（slot 置换）由插件贡献。
 * 由于前端 Vue WebView 是独立进程，插件无法直接操作其 DOM；本服务把这些
 * 贡献**镜像成轻量状态**（activeTheme + per-slot layouts），前端经 `ui.getManifest`
 * 拉取后自行应用（pull-based，规避 sidecar→Rust 无 push 通道的限制）。
 *
 * Cordis 时空可组合：主题/布局插件的 `apply(ctx)` 里用
 *   `ctx.effect(() => { const off = ctx.uiRegistry.registerTheme(...); return off })`
 * 注册即 acquire、卸载即逆序回滚（弹栈 / 移除条目），与功能插件 handler 同一套范式。
 *
 * 规则：
 *   - 主题多开：`themeStack` 保持启用顺序，active = 最后一个；unregister 弹栈回退前一主题。
 *   - 布局：每 slot 一个列表，同 slot 后注册覆盖（同名幂等替换）；active = 该 slot 最后注册的。
 */
import { Service } from 'cordis'
import type { UiLayoutSlot, UiManifest, UiTheme } from '@miko-launcher/shared'
import { ServiceName } from '../context.js'
import type { RustBridgeService } from '../bridge/rust-bridge.js'

export class UiRegistryService extends Service {
  private themeStack: UiTheme[] = []
  private layouts = new Map<string, UiLayoutSlot[]>()

  constructor(ctx: any) {
    super(ctx, ServiceName.uiRegistry)
  }

  /** 注册一个主题贡献；返回注销函数（供插件 ctx.effect 回滚用）。 */
  registerTheme(theme: UiTheme): () => void {
    this.themeStack.push(theme)
    return () => {
      const i = this.themeStack.lastIndexOf(theme)
      if (i >= 0) this.themeStack.splice(i, 1)
    }
  }

  /** 注册一个布局贡献到指定 slot；返回注销函数。同 slot+name 幂等（re-enable 覆盖）。 */
  registerLayout(slot: UiLayoutSlot): () => void {
    const list = this.layouts.get(slot.slot) ?? []
    const idx = list.findIndex((l) => l.name === slot.name)
    if (idx >= 0) list[idx] = slot
    else list.push(slot)
    this.layouts.set(slot.slot, list)
    return () => {
      const cur = this.layouts.get(slot.slot) ?? []
      const j = cur.findIndex((l) => l.name === slot.name)
      if (j >= 0) cur.splice(j, 1)
      if (cur.length === 0) this.layouts.delete(slot.slot)
      else this.layouts.set(slot.slot, cur)
    }
  }

  /** 生成前端要渲染的 UI manifest（active theme + 每 slot 最后注册的布局）。 */
  getManifest(): UiManifest {
    const theme = this.themeStack.length
      ? this.themeStack[this.themeStack.length - 1]
      : null
    const layouts: UiLayoutSlot[] = []
    for (const list of this.layouts.values()) {
      if (list.length) layouts.push(list[list.length - 1])
    }
    return { theme, layouts }
  }

  /** 暴露 RPC（核心方法；schema 已在 shared 注册，走严格校验）。 */
  registerBridge(bridge: RustBridgeService) {
    bridge.on('ui.getManifest', () => this.getManifest())
  }
}
