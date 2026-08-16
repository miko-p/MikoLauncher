/**
 * demo-greeter —— M7-5 示例功能插件（Phase 0 走 Cordis）。
 *
 * 演示时空可组合范式：
 *   - `inject: ['rustBridge']`：空间可组合，声明依赖，由 Cordis 自动注入
 *   - `ctx.effect(acquire => cleanup)`：时间可组合。acquire 里 `rustBridge.on(...)`
 *     注册 handler，返回的 cleanup 在插件卸载时自动执行（反注册）。这是唯一正确的
 *     effect 用法 —— 副作用在 acquire 里，逆操作作为返回值。
 */
export const name = 'demo-greeter'
export const version = '1.0.0'
export const inject = ['rustBridge']

export function apply(ctx) {
  // 副作用（acquire）+ 逆操作（返回的 cleanup）放在同一个 effect 里
  ctx.effect(() => {
    process.stderr.write(`[demo-greeter] apply 运行，注册 greeter.hello handler\n`)
    const off = ctx.rustBridge.on('greeter.hello', ({ who }) => ({
      message: `你好，${who ?? '世界'}！来自 Phase0 插件 ${name}`,
    }))
    return () => {
      off()
      process.stderr.write(`[demo-greeter] 卸载：greeter.hello handler 已反注册\n`)
    }
  })
}
