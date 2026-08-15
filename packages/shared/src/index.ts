/**
 * @miko-launcher/shared — 共享 TS 类型 + Zod schema
 *
 * Rust↔TS 双向 IPC 契约的单一事实来源。进出两侧都用这里定义的
 * schema 校验，任何一端的结构变化都会被另一端的校验抓住（防契约漂移）。
 */

export * from './protocol.js'
export * from './entities.js'
export * from './methods.js'
