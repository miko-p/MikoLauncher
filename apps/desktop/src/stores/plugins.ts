/**
 * 插件 store —— MVVM 的 VM 层（M7-5 Phase0 插件管理）。
 * 把 sidecar 的 plugin.list/enable/disable 映射成 UI 可绑定的状态。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { listPlugins, enablePlugin, disablePlugin } from '../api'

export interface PluginInfo {
  name: string
  version?: string
  loaded: boolean
  hashOk: boolean
  reason?: string
  /** M9-3：持久化的期望启用状态（重启后仍保持；缺省视为启用） */
  enabled?: boolean
}

export const usePluginStore = defineStore('plugins', () => {
  const plugins = ref<PluginInfo[] | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const toggling = ref<string | null>(null)

  async function fetchPlugins() {
    loading.value = true
    error.value = null
    try {
      plugins.value = await listPlugins()
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  /** 启用/禁用插件；成功（含卸载回滚）后刷新列表。 */
  async function toggle(name: string) {
    toggling.value = name
    error.value = null
    try {
      const info = plugins.value?.find((p) => p.name === name)
      if (info?.loaded) {
        await disablePlugin(name)
      } else {
        await enablePlugin(name)
      }
      await fetchPlugins()
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      toggling.value = null
    }
  }

  return { plugins, loading, error, toggling, fetchPlugins, toggle }
})
