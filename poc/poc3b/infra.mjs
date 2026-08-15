// 基础设施服务：提供 ctx.theme 与 ctx.layout，供主题/布局插件消费。
// 用 Cordis 官方 Service 机制（super(ctx, 'theme') 注册 → 任何插件经 inject 注入）
import { Service } from 'cordis'

export const name = 'infra'

class ThemeService extends Service {
  constructor(ctx) {
    super(ctx, 'theme')            // 注册为 ctx.theme
    this.state = {}
  }
  set(v, from) { this.state[from] = v; console.log(`  [theme] 应用 ${from}:`, JSON.stringify(v)) }
  unset(from) { if (this.state[from]) console.log(`  [theme] 移除 ${from} 的 CSS`); delete this.state[from] }
  get size() { return Object.keys(this.state).length }
}

class LayoutService extends Service {
  constructor(ctx) {
    super(ctx, 'layout')           // 注册为 ctx.layout
    this.overrides = new Map()
  }
  set(slot, comp) { this.overrides.set(slot, comp); console.log(`  [layout] slot=${slot} → ${comp}`) }
  restore(slot) { this.overrides.delete(slot); console.log(`  [layout] slot=${slot} 恢复默认`) }
}

export function apply(ctx) {
  // 服务类本身即是插件（类形态），挂载即注册服务
  ctx.plugin(ThemeService)
  ctx.plugin(LayoutService)
}
