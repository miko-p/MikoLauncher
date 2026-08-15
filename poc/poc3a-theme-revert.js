/**
 * M0 POC 验证3a：主题插件卸载回滚（时间可组合在"主题插件"场景的落地）
 * 场景：一个主题插件加载时注入一套 CSS 变量（模拟换肤），
 *      卸载时经 ctx.effect 的逆操作把 CSS 移除 —— 界面恢复默认，"不留垃圾"。
 *
 * 抽象为真实启动器里的动作：DOM 注入 <style> / 切换 CSS 变量
 * 用变量容器模拟"CSS 环境"。
 *
 * 运行：node poc3a-theme-revert.js
 */
const { Context, Service } = require('cordis')

const log = (...a) => console.log('[验证3a]', ...a)

// ===== 主题管理服务：维护当前生效的主题样式（模拟 DOM/CSS 环境）=====
class ThemeService extends Service {
  constructor(ctx) {
    super(ctx, 'theme')
    this.activeTheme = null        // 当前生效主题名
    this.appliedCss = ''           // 注入的 CSS
    global.__themeChanges = []     // 记录变更日志，便于断言
  }
  applyTheme(name, css) {
    this.activeTheme = name
    this.appliedCss = css
    global.__themeChanges.push(`APPLY:${name}`)
    log(`  主题生效 → "${name}"（CSS 已注入：${css}）`)
  }
  removeTheme(name) {
    this.activeTheme = null
    this.appliedCss = ''
    global.__themeChanges.push(`REMOVE:${name}`)
    log(`  主题已移除 → "${name}"（CSS 逆操作：<style> 被移除）`)
  }
}

// ===== 一个主题插件（dracula）=====
const draculaTheme = {
  name: 'theme-dracula',
  provide: 'theme', // 提供 theme 服务
  apply(ctx) {
    // 注：真实场景主题由内置 ThemeService 提供；这里演示"插件既可以是服务提供者，
    //    也可以是消费者"。为清晰，主题插件设计成消费 theme 服务。
  },
}

// ===== 主题插件的形式（B方案）：主题插件直接提供 theme 服务 =====
// 说明：验证场景中，我们用内置 ThemeService 作为基础设施，下面的"功能插件"
//  模拟"用户启用了 dracula 主题"这件事本身是可插拔的能力。

function makeThemePlugin(name, css) {
  return {
    name: `active-${name}`,
    inject: ['theme'],
    apply(ctx) {
      log(`插件 [${name}] 加载：应用主题`)
      // 应用主题
      ctx.theme.applyTheme(name, css)
      // 关键：把"应用主题"包成 effect，注册逆操作 = 恢复默认
      ctx.effect(() => {
        // 卸载该主题插件时，自动执行 → 移除该主题的 CSS
        return () => {
          ctx.theme.removeTheme(name)
          log(`  ▸ [${name}] 卸载回滚：CSS 已移除，回到默认主题`)
        }
      })
    },
  }
}

async function main() {
  const root = new Context()
  const changes = (global.__themeChanges = [])

  log('=== 内置 ThemeService 上线 ===')
  await root.plugin(ThemeService)

  log('\n=== ① 启用 dracula 主题插件 ===')
  const draculaFiber = await root.plugin(makeThemePlugin('dracula', '--bg:#282a36;--fg:#f8f8f2'))
  log(`当前生效主题: ${root.theme.activeTheme}`)

  log('\n=== ② 换主题：卸载 dracula，启用 nord（互斥替换）===')
  await draculaFiber.dispose()          // 触发 dracula 的 effect 逆操作
  const nordFiber = await root.plugin(makeThemePlugin('nord', '--bg:#2e3440;--fg:#d8dee9'))
  log(`当前生效主题: ${root.theme.activeTheme}`)

  log('\n=== ③ 卸载 nord（比如用户关插件）===')
  await nordFiber.dispose()
  log(`卸载后生效主题: ${root.theme.activeTheme ?? '(无 - 回到默认)'}`)

  log('\n=== 断言：effect 逆操作真的把 CSS 清掉了 ===')
  if (root.theme.appliedCss === '' && root.theme.activeTheme === null) {
    log('  ✓ 通过：主题卸载后 CSS 归零，无残留副作用')
  } else {
    log('  ✗ 失败：仍有残留')
  }

  log('\n变更日志（应体现 APPLY:nord → REMOVE:nord 成对出现）：')
  changes.forEach((c) => log('  ' + c))

  log('\n=== 验证3a 完成：主题插件可回滚卸载，不留垃圾 ===')
  process.exit(0)
}

main().catch((e) => console.error('ERR', e))
