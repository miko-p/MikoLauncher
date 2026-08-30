/**
 * widget-text —— M10 首个小组件插件（文字小组件）。
 *
 * 往主页「小组件面板」贡献一块文字卡片：显示一段文字内容。
 * 走 UiRegistryService.registerWidget，卸载即移除（effect 回滚）。
 *
 * 文字内容在下方 `TEXT` 处修改即可；改后需同步 manifest.json 的 hash
 * （main.js 的 SHA-256，插件管理器启动时校验，防篡改不一致会拒绝装载）。
 *
 * M10-3 起支持编辑文字：正文用 `<span class="wt-text" data-edit-text="...">` 作为
 * 「可编辑文字插槽」。宿主前端在编辑态识别 `data-edit-text` 属性提供输入框，用户输入
 * 会作为「面板实例的文字覆盖」替换该 span 的正文（见 stores/home.ts 的 renderHtml）。
 * 这里保留插件端默认文字（data-edit-text 也承载默认值，供输入框回填）。
 */
export const name = 'widget-text'
export const version = '1.0.0'
export const inject = ['uiRegistry']

const TEXT =
  '## 主页小组件\n' +
  '\n' +
  '在顶部 **MikoLauncher** 下拉选「编辑」，可调整主页小组件的位置、大小与文字：\n' +
  '\n' +
  '- **拖动卡片** — 换位置\n' +
  '- **拖右下角把手** — 改大小\n' +
  '- **右上「+」** — 添加小组件\n'

export function apply(ctx) {
  ctx.effect(() => {
    const off = ctx.uiRegistry.registerWidget({
      key: 'widget-text',
      title: '文字小组件',
      order: 0,
      width: 'half',
      html:
        '<div class="widget-text">' +
        `<span class="wt-text">${TEXT}</span>` +
        '</div>',
    })
    process.stderr.write('[widget-text] 应用：注册文字小组件卡片\n')
    return () => {
      off()
      process.stderr.write('[widget-text] 卸载：文字小组件卡片已移除\n')
    }
  })
}
