/**
 * M0 POC 验证2a：Node sidecar JSON-RPC 协议（纯 Node，不依赖 Tauri）
 * 模拟"Rust 核心 ↔ Node sidecar"的进程间通信：
 *  - sidecar.js = 被拉起的 Node 子进程，从 stdin 读 JSON 行请求，stdout 回 JSON 响应
 *  - host = 模拟 Rust/宿主进程，spawn sidecar，发请求，收响应
 *
 * 验证：
 *  A. Node 子进程可独立 spawn 并走 stdio JSON-RPC
 *  B. 请求/响应带 id + apiVersion，契约可版本化
 *  C. 错误路径（未知 method / 异常）有结构化 error
 *
 * 运行：node poc2-rpc.js
 */

const { spawn } = require('child_process')

// ---------- sidecar 业务逻辑：模拟 Rust 网关的启动请求 ----------
// 这里代表 sidecar 里 Cordis 插件向 Rust 核心发起/转发的一个命令
const SIDECAR_ENTRY = `
process.stdin.setEncoding('utf8')
let buf = ''
function handle(req) {
  const { id, apiVersion, method, params } = req
  // 模拟命令分派（真实场景：转发给 Cordis 插件 or Rust core）
  if (method === 'instance.launch') {
    return { id, ok: true, data: { pid: 4231, java: '17.0.10', args: params.args || [] } }
  }
  if (method === 'echo') {
    return { id, ok: true, data: { echo: params.msg } }
  }
  return { id, ok: false, error: { code: 'METHOD_NOT_FOUND', message: 'unknown method: ' + method } }
}
process.stdin.on('data', (chunk) => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    try {
      const req = JSON.parse(line)
      // 版本校验：apiVersion 不符则拒绝
      if (req.apiVersion !== 1) {
        process.stdout.write(JSON.stringify({ id: req.id, ok: false, error: { code: 'VERSION_MISMATCH', message: 'apiVersion ' + req.apiVersion + ' unsupported' } }) + '\\n')
        continue
      }
      process.stdout.write(JSON.stringify(handle(req)) + '\\n')
    } catch (e) {
      process.stdout.write(JSON.stringify({ id: null, ok: false, error: { code: 'PARSE_ERROR', message: e.message } }) + '\\n')
    }
  }
})
`

// ---------- 简易 JSON-RPC client（模拟 Rust 核心侧） ----------
function callSidecar(child, req) {
  return new Promise((resolve, reject) => {
    const id = req.id
    const onData = (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean)
      for (const line of lines) {
        const res = JSON.parse(line)
        if (res.id === id) { resolve(res); child.stdout.off('data', onData) }
      }
    }
    child.stdout.on('data', onData)
    child.stdin.write(JSON.stringify(req) + '\n')
  })
}

async function main() {
  console.log('[验证2a] 启动 Node sidecar 子进程...')
  const child = spawn(process.execPath, ['-e', SIDECAR_ENTRY], { stdio: ['pipe', 'pipe', 'inherit'] })
  await new Promise((r) => setTimeout(r, 200)) // 等 sidecar 就绪

  const log = (...a) => console.log('[验证2a]', ...a)

  log('① instance.launch 请求（合法 apiVersion=1）→')
  const r1 = await callSidecar(child, { id: 1, apiVersion: 1, method: 'instance.launch', params: { args: ['-Xmx2G', '-jar', 'server.jar'] } })
  log('   响应:', JSON.stringify(r1))

  log('② echo 请求 →')
  const r2 = await callSidecar(child, { id: 2, apiVersion: 1, method: 'echo', params: { msg: 'hello from rust-core' } })
  log('   响应:', JSON.stringify(r2))

  log('③ 未知 method（结构化错误）→')
  const r3 = await callSidecar(child, { id: 3, apiVersion: 1, method: 'nope', params: {} })
  log('   响应:', JSON.stringify(r3))

  log('④ 版本不符 apiVersion=2（拒绝）→')
  const r4 = await callSidecar(child, { id: 4, apiVersion: 2, method: 'instance.launch', params: {} })
  log('   响应:', JSON.stringify(r4))

  child.kill()
  log('验证2a 完成：Node sidecar 可 spawn、JSON-RPC 契约(apiVersion/id/错误码)跑通')
}

main().catch((e) => console.error('ERR', e))
