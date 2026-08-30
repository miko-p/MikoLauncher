/**
 * 账号 store —— MVVM 的 VM 层（对应蓝图「四、ViewModel 层」）。
 * 映射 Rust 账号 service 到 UI 绑定状态（离线/微软账号）。
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Account } from '@miko-launcher/shared'
import {
  listAccounts,
  loginOffline,
  removeAccount,
  refreshAccount,
  loginMicrosoft,
  loginMicrosoftUrl,
  finishMicrosoftLogin,
  loginMicrosoftLoopback,
} from '../api'

export const useAccountStore = defineStore('accounts', () => {
  const accounts = ref<Account[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** M9-2：账号失效标记（id → 失效原因）；微软 refresh 检测失败时记录，前端据此显示「重新登录」。 */
  const invalidated = ref<Record<string, string>>({})

  const count = computed(() => accounts.value.length)
  /** 离线账号 */
  const offlineAccounts = computed(() => accounts.value.filter((a) => a.type === 'offline'))
  /** 微软账号 */
  const microsoftAccounts = computed(() => accounts.value.filter((a) => a.type === 'microsoft'))

  /** 是否已标记为失效（即需重新登录）。 */
  function isInvalidated(id: string): boolean {
    return id in invalidated.value
  }

  /** 拉取账号列表。 */
  async function fetchAccounts() {
    loading.value = true
    error.value = null
    try {
      accounts.value = await listAccounts()
      // 账号被删除后，清除其失效标记
      invalidated.value = Object.fromEntries(
        Object.entries(invalidated.value).filter(([id]) =>
          accounts.value.some((a) => a.id === id),
        ),
      )
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  /** 登录离线账号（创建并刷新列表）。 */
  async function addOffline(name: string) {
    error.value = null
    try {
      await loginOffline(name)
      await fetchAccounts()
    } catch (e) {
      error.value = (e as Error).message
    }
  }

  /** 设备码流登录（M10-6 修正——替代已废弃的「手动粘 URL」）：回调 account_login_microsoft（lighty
   *  device code + consumers 租户）。前端 account:device-code 事件把 user_code + verification_uri 推来展示；
   *  本调用是阻塞式长轮询，等用户在网页授权完成即返回。成功即清失效标记并刷新列表。 */
  async function deviceLogin() {
    error.value = null
    try {
      await loginMicrosoft()
      invalidated.value = {}
      msLoginUrl.value = null
      await fetchAccounts()
    } catch (e) {
      error.value = (e as Error).message
    }
  }

  /** 开始微软登录（授权码流 M10-4，PCL 式）：生成并自动打开系统浏览器登录页，保存 url（供前端引导粘贴 URL）。 */
  const msLoginUrl = ref<string | null>(null)
  async function beginMicrosoftLogin() {
    error.value = null
    try {
      const { url } = await loginMicrosoftUrl()
      msLoginUrl.value = url
    } catch (e) {
      error.value = (e as Error).message
    }
  }

  /** 用户粘回授权后的 URL/裸 code，完成登录并刷新列表。成功即清除失效标记。 */
  async function finishMicrosoft(codeOrUrl: string) {
    error.value = null
    try {
      await finishMicrosoftLogin(codeOrUrl)
      invalidated.value = {}
      msLoginUrl.value = null
      await fetchAccounts()
    } catch (e) {
      error.value = (e as Error).message
    }
  }

  /** M10-5：PCL 式全自动登录（loopback）——阻塞直到浏览器授权回跳并入库。成功即清除失效标记。 */
  async function loopbackMicrosoft() {
    error.value = null
    try {
      await loginMicrosoftLoopback()
      invalidated.value = {}
      msLoginUrl.value = null
      await fetchAccounts()
    } catch (e) {
      error.value = (e as Error).message
    }
  }

  /** 删除账号并刷新。 */
  async function remove(id: string) {
    error.value = null
    try {
      await removeAccount(id)
      delete invalidated.value[id]
      await fetchAccounts()
    } catch (e) {
      error.value = (e as Error).message
    }
  }

  /** M9-2：显式检测单个微软账号的 refresh 凭据是否仍有效；失效则标记 needsReauth。 */
  async function check(id: string) {
    error.value = null
    try {
      const result = await refreshAccount(id)
      if (result.needsReauth) {
        invalidated.value[id] = result.message ?? '微软凭据已过期，请重新登录'
      } else {
        delete invalidated.value[id]
      }
      // 用刷新返回的最新账号对象同步本地（名字等可能变化）
      const idx = accounts.value.findIndex((a) => a.id === id)
      if (idx >= 0) accounts.value[idx] = result.account
    } catch (e) {
      error.value = (e as Error).message
    }
  }

  return {
    accounts,
    loading,
    error,
    count,
    offlineAccounts,
    microsoftAccounts,
    invalidated,
    isInvalidated,
    fetchAccounts,
    addOffline,
    beginMicrosoftLogin,
    deviceLogin,
    finishMicrosoft,
    loopbackMicrosoft,
    msLoginUrl,
    remove,
    check,
  }
})
