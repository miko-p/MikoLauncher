/**
 * UiRegistryService —— 主题/布局/视图插件贡献的侧车侧镜像（M8-1 / M9-6）。
 *
 * 蓝图「十、三类插件」：主题（CSS 变量）、布局（slot 置换）、功能插件。
 * 由于前端 Vue WebView 是独立进程，插件无法直接操作其 DOM；本服务把这些
 * 贡献**镜像成轻量状态**（activeTheme + per-slot layouts + views），前端经
 * `ui.getManifest` 拉取后自行应用（pull-based，规避 sidecar→Rust 无 push 通道的限制）。
 *
 * Cordis 时空可组合：主题/布局/视图插件的 `apply(ctx)` 里用
 *   `ctx.effect(() => { const off = ctx.uiRegistry.registerTitle(...); return off })`
 * 注册即 acquire、卸载即逆序回滚（弹栈 / 移除条目），与功能插件 handler 同一套范式。
 *
 * 规则：
 *   - 主题多开：`themeStack` 保持启用顺序，active = 最后一个；unregister 弹栈回退前一主题。
 *   - 布局：每 slot 一个列表，同 slot 后注册覆盖（同名幂等替换）；active = 该 slot 最后注册的。
 *   - 视图（M9-6）：`views` 以 key 为索引，宿主内置五视图在构造时种子化；插件可
 *     `registerView` 新增/覆盖（同名幂等）；`getManifest` 返回全部（含 builtin + disabled），
 *     前端按需过滤（disabled 隐藏导航）、按 order 排序。
 */
import { Service } from 'cordis'
import type { UiLayoutSlot, UiManifest, UiTheme, UiView } from '@miko-launcher/shared'
import { ServiceName } from '../context.js'
import type { RustBridgeService } from '../bridge/rust-bridge.js'

/** 宿主内置视图默认集（M9-6）：与前端静态路由对应，作为「插件化 UI」的起始一组视图。 */
const BUILTIN_VIEWS: UiView[] = [
  { key: 'home', label: '首页', path: '/', order: 0, builtin: true, type: 'component' },
  { key: 'download', label: '下载', path: '/download', order: 1, builtin: true, type: 'component' },
  { key: 'instances', label: '实例', path: '/instances', order: 2, builtin: true, type: 'component' },
  { key: 'accounts', label: '账号', path: '/accounts', order: 3, builtin: true, type: 'component' },
  { key: 'plugins', label: '插件', path: '/plugins', order: 4, builtin: true, type: 'component' },
]

export class UiRegistryService extends Service {
  private themeStack: UiTheme[] = []
  private layouts = new Map<string, UiLayoutSlot[]>()
  /** 视图集合：key → UiView（builtin 种子 + 插件贡献）；以 key 幂等覆盖。 */
  private views = new Map<string, UiView>()

  constructor(ctx: any) {
    super(ctx, ServiceName.uiRegistry)
    // M9-6：宿主内置视图作为起始导航集（插件可在此基础上增/删/重排）
    for (const v of BUILTIN_VIEWS) this.views.set(v.key, v)
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

  /**
   * 注册一个视图（导航项 + 页面）；返回注销函数。以 key 幂等覆盖（re-enable 更新）。
   * 插件贡献的视图 `builtin` 应缺省（false）；type='html' 需带 html 内容。
   */
  registerView(view: UiView): () => void {
    // 插件贡献视图强制非 builtin（避免误标宿主内置）
    this.views.set(view.key, { ...view, builtin: view.builtin ?? false })
    return () => {
      // 卸载：若该 key 是插件贡献的（非内置种子），移除；内置则保留（宿主固有）。
      const cur = this.views.get(view.key)
      if (cur && !cur.builtin) this.views.delete(view.key)
    }
  }

  /** 生成前端要渲染的 UI manifest（active theme + 每 slot 最后注册的布局 + 全部视图）。 */
  getManifest(): UiManifest {
    const theme = this.themeStack.length
      ? this.themeStack[this.themeStack.length - 1]
      : null
    const layouts: UiLayoutSlot[] = []
    for (const list of this.layouts.values()) {
      if (list.length) layouts.push(list[list.length - 1])
    }
    const views = [...this.views.values()].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.key.localeCompare(b.key),
    )
    return { theme, layouts, views }
  }

  /** 暴露 RPC（核心方法；schema 已在 shared 注册，走严格校验）。 */
  registerBridge(bridge: RustBridgeService) {
    bridge.on('ui.getManifest', () => this.getManifest())
  }
}
