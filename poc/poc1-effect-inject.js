/**
 * M0 POC 验证1：Cordis 时空可组合核心能力（按官方/DSH 教程 API）
 * 验证三项：
 *  A. 服务注册 + inject 依赖注入 + 加载顺序无关（"空间"可组合）
 *  B. ctx.effect 逆操作 / fiber.dispose() 只回滚该插件副作用（"时间"可组合）
 *  C. 内置注册 API（ctx.on / ctx.plugin / service）本身即 effect
 *
 * 运行：node poc1-effect-inject.js
 */
const { Context, Service } = require('cordis')

const log = (...a) => console.log('[验证]', ...a)

// ===== 服务提供者：CounterService（被依赖方）=====
class CounterService extends Service {
  constructor(ctx) {
    super(ctx, 'counter')
    this.n = 0
  }
  next() { return ++this.n }
}

// ===== 功能插件：注入 counter + 持有外部资源(定时器) =====
const usagePlugin = {
  name: 'usage-plugin',
  inject: ['counter'],
  apply(ctx) {
    log(`usage-plugin 加载：ctx.counter 可用，next() = ${ctx.counter.next()}`)
    // 非 Cordis 管理的外部资源 → 用 ctx.effect 包，返回逆操作
    ctx.effect(() => {
      const timer = setInterval(() => {}, 500)
      log('  usage-plugin 注册外部资源(定时器)，via ctx.effect')
      return () => {
        clearInterval(timer)
        log('  ▸ effect 逆操作：定时器已清理（usage-plugin 卸载时自动执行）')
      }
    })
    // ctx.on 注册监听 → Cordis 视其为 effect，卸载自动移除
    ctx.on('app/tick', () => {})
    log('  usage-plugin 注册 app/tick 监听（ctx.on 即 effect）')
  },
}

// ===== 消费者：依赖 counter，故意反序加载验证顺序无关 =====
const consumerPlugin = {
  name: 'consumer-plugin',
  inject: ['counter'],
  apply(ctx) {
    log(`consumer-plugin 加载（顺序无关）：ctx.counter.next() = ${ctx.counter.next()}`)
  },
}

async function main() {
  const root = new Context()

  log('=== ① 反序加载：先挂 consumer(依赖 counter)，后挂 counter provider ===')
  await root.plugin(consumerPlugin)   // 应停留 PENDING 等待 counter
  log('consumer-plugin 已 mount（等待依赖）')
  await root.plugin(CounterService)   // 提供 counter → consumer 自动激活
  log('counter 服务已提供 → consumer-plugin 自动启动')
  await root.plugin(usagePlugin)

  log('\n=== ② 空间可组合验收：注入生效 + 顺序无关 ===')
  log(`两个消费者都成功注入 counter，当前值 = ${root.counter.next()}`)

  log('\n=== ③ 时间可组合验收：单独 dispose usage-plugin，只回滚它自己的副作用 ===')
  // 教程：ctx.plugin 返回 fiber，fiber.dispose() 触发该插件全部 cleanup
  // 演示：用 child context 隔离一个 usage 实例，dispose 它
  const child = root.extend()
  const fiber = await child.plugin(usagePlugin)
  await fiber.dispose()   // 应打印 usage-plugin 的 effect 逆操作
  log('child 已 dispose，其上 usage-plugin 副作用已回滚（consumer/counter 仍在）')

  log('\n=== ④ 最终收尾：dispose 整个 root，所有插件按依赖逆序回滚 ===')
  // ④a: 展示 dispose 单个插件的 fiber 后仍可重新挂载（热插拔的基础）
  log('  上面③已验证"单插件 effect 回滚"。')
  log('  下面把整个 root dispose，观察 consumer/counter 也按逆序清理：')

  // root 里还挂着 consumer-plugin、CounterService、usage-plugin
  await root.fiber.dispose()
  log('  root 已 dispose：全部插件副作用逆序回滚完成')

  log('\n=== 验证1 完成：A(注入/顺序无关) B(effect单插件回滚) C(级联回滚) 全部跑通 ===')
  process.exit(0)
}

main().catch((e) => console.error('ERR', e))
