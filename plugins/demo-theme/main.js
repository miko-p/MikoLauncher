/**
 * demo-theme —— M8-1 示例主题插件（Phase 0）。
 *
 * 演示 Cordis 时空可组合 + UiRegistryService：
 *   - inject: ['uiRegistry']：空间可组合，声明依赖。
 *   - 读取自身 theme.css，把「覆盖 CSS 变量的样式文本」注册进 uiRegistry。
 *   - ctx.effect(acquire => cleanup)：注册是 acquire，返回的注销函数是 cleanup
 *     （卸载/禁用时 Cordis 逆序调用 → 弹栈回退到前一主题）。这是唯一正确的 effect 用法。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'demo-theme'
export const version = '1.0.0'
export const inject = ['uiRegistry']

export function apply(ctx) {
  ctx.effect(() => {
    const here = dirname(fileURLToPath(import.meta.url))
    const css = readFileSync(join(here, 'theme.css'), 'utf-8')
    const off = ctx.uiRegistry.registerTheme({ name, css })
    process.stderr.write(`[demo-theme] 应用：已注入主题「${name}」(${css.length} 字符)\n`)
    return () => {
      off()
      process.stderr.write(`[demo-theme] 卸载：主题已弹栈（回退）\n`)
    }
  })
}
