// 布局插件：覆盖某 slot，卸载时回滚默认
export const name = 'layout-classic'
export const inject = ['layout']
export const apply = (ctx) => {
  ctx.effect(() => {
    ctx.layout.set('home', 'ClassicHome')
    console.log('[布局插件] classic 布局已设置')
    return () => {
      ctx.layout.restore('home')
      console.log('  ▸ [布局插件] classic 卸载回滚：恢复默认布局')
    }
  })
}
