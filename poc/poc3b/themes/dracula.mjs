// 主题插件：加载时注入 CSS，卸载时经 effect 回滚
export const name = 'theme-dracula'
export const inject = ['theme']
export function apply(ctx) {
  ctx.effect(() => {
    ctx.theme.set({ bg: '#282a36', fg: '#f8f8f2' }, 'dracula')
    console.log('[主题插件] dracula 已应用 (via ctx.effect 包装)')
    return () => {
      ctx.theme.unset('dracula')
      console.log('  ▸ [主题插件] dracula 卸载回滚：CSS 已移除')
    }
  })
}
