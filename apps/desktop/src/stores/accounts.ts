/**
 * 账号 store —— MVVM 的 VM 层（对应蓝图「四、ViewModel 层」）。
 * 映射 Rust 账号 service 到 UI 绑定状态（离线/微软账号）。
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Account } from '@miko-launcher/shared'
import { listAccounts, loginOffline, loginMicrosoft, removeAccount } from '../api'

export const useAccountStore = defineStore('accounts', () => {
  const accounts = ref<Account[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const count = computed(() => accounts.value.length)
  /** 离线账号 */
  const offlineAccounts = computed(() => accounts.value.filter((a) => a.type === 'offline'))
  /** 微软账号 */
  const microsoftAccounts = computed(() => accounts.value.filter((a) => a.type === 'microsoft'))

  /** 拉取账号列表。 */
  async function fetchAccounts() {
    loading.value = true
    error.value = null
    try {
      accounts.value = await listAccounts()
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

  /** 微软设备流登录（阻塞直到用户授权；刷新列表）。 */
  async function addMicrosoft() {
    error.value = null
    try {
      await loginMicrosoft()
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
      await fetchAccounts()
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
    fetchAccounts,
    addOffline,
    addMicrosoft,
    remove,
  }
})
