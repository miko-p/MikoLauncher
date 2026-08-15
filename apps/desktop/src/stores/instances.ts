/**
 * 实例 store —— MVVM 的 VM 层（对应蓝图「四、ViewModel 层」）。
 * 把 Rust/sidecar 的领域服务状态映射成 UI 可绑定的响应式状态。
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Instance } from '@miko-launcher/shared'
import { listInstances, createInstance, launchInstance } from '../api'

interface CreatePayload {
  name: string
  versionId: string
  modLoader: 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'
}

export const useInstanceStore = defineStore('instances', () => {
  const instances = ref<Instance[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const sidecarReady = ref(false)

  const count = computed(() => instances.value.length)

  /** 拉取实例列表（首次调用即探测 sidecar 是否就绪）。 */
  async function fetchInstances() {
    loading.value = true
    error.value = null
    try {
      instances.value = await listInstances()
      sidecarReady.value = true
    } catch (e) {
      error.value = (e as Error).message
      sidecarReady.value = false
    } finally {
      loading.value = false
    }
  }

  /** 创建实例，成功则刷新列表。 */
  async function addInstance(payload: CreatePayload) {
    error.value = null
    try {
      await createInstance(payload)
      await fetchInstances()
    } catch (e) {
      error.value = (e as Error).message
    }
  }

  /** 启动实例（骨架：M3 起接真实 JVM 启动）。 */
  async function launch(id: string, offline = true) {
    error.value = null
    try {
      return await launchInstance({ instanceId: id, offline })
    } catch (e) {
      error.value = (e as Error).message
      return null
    }
  }

  return { instances, loading, error, sidecarReady, count, fetchInstances, addInstance, launch }
})
