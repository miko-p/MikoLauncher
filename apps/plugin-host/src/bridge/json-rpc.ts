/**
 * JSON 行 RPC 传输层 —— Node sidecar ⇄ Rust 核心。
 *
 * 对应蓝图「七、IPC 契约」：sidecar stdin/stdout JSON 行协议。
 * 这里 sidecar 是"被拉起"的 Node 进程：从 stdin 读 Rust 转发的请求，
 * 处理后经 stdout 回 JSON 响应（Rust 又转回前端）。同时 sidecar 也
 * 需要一个"向上调用 Rust"的 client（读 host 侧 socket/pipe）——
 * 本骨架聚焦最稳的 stdin/stdout 员工协议（与 M0 V2 一致），
 * 完整 Tauri shell + externalBin 集成留到骨架校验通过后再切。
 */

import { EventEmitter } from 'node:events'

export interface RpcRequest {
  id: number
  apiVersion: number
  method: string
  params?: unknown
}

export interface RpcOkResponse {
  id: number
  ok: true
  data: unknown
}

export interface RpcErrResponse {
  id: number | null
  ok: false
  error: { code: string; message: string; data?: unknown }
}

export type RpcResult = RpcOkResponse | RpcErrResponse

export interface JsonRpcServerOptions {
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
  handler: (req: RpcRequest) => Promise<RpcResult> | RpcResult
}

/**
 * 在 stdin/stdout 上跑一个 JSON 行 RPC server。
 * 支持 LSP 风格头（Content-Length）？—— 不需要，POC V2 定稿为裸 JSON 行。
 */
export class JsonRpcServer extends EventEmitter {
  private buf = ''
  private output: NodeJS.WritableStream

  constructor(private opts: JsonRpcServerOptions) {
    super()
    this.output = opts.output
    opts.input.setEncoding('utf8')
    opts.input.on('data', (chunk: string | Buffer) => this.onData(chunk))
    opts.input.on('end', () => this.emit('closed'))
  }

  private onData(chunk: string | Buffer) {
    this.buf += chunk.toString('utf8')
    let nl: number
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).replace(/\r$/, '')
      this.buf = this.buf.slice(nl + 1)
      if (!line.trim()) continue
      this.handleLine(line)
    }
  }

  private handleLine(line: string) {
    let req: RpcRequest
    try {
      req = JSON.parse(line)
    } catch (e) {
      this.write({ id: null, ok: false, error: { code: 'PARSE_ERROR', message: (e as Error).message } })
      return
    }
    // apiVersion 校验（POC V2：版本不符拒绝）
    if (req.apiVersion !== 1) {
      this.write({
        id: req.id ?? null,
        ok: false,
        error: { code: 'VERSION_MISMATCH', message: `apiVersion ${req.apiVersion} unsupported` },
      })
      return
    }
    Promise.resolve(this.opts.handler(req)).then(
      (res) => this.write(res),
      (e) => this.write({ id: req.id ?? null, ok: false, error: { code: 'INTERNAL_ERROR', message: (e as Error).message } }),
    )
  }

  private write(res: RpcResult) {
    this.output.write(JSON.stringify(res) + '\n')
  }

  close() {
    this.opts.input.removeAllListeners('data')
  }
}
