/**
 * 版本 store —— MVVM 的 VM 层。
 * 拉取真实 Mojang 版本清单（经 Rust 内核），供下载页选择。
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { fetchVersions } from '../api'

export interface VersionInfo {
  id: string
  type: 'release' | 'snapshot' | string
  url: string
  releaseTime: string
}

export const useVersionStore = defineStore('versions', () => {
  const versions = ref<VersionInfo[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const refreshedAt = ref<string | null>(null)

  const releases = computed(() => versions.value.filter((v) => v.type === 'release'))
  const snapshots = computed(() => versions.value.filter((v) => v.type === 'snapshot'))

  async function refresh() {
    loading.value = true
    error.value = null
    try {
      versions.value = await fetchVersions()
      refreshedAt.value = new Date().toLocaleTimeString()
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  return { versions, loading, error, refreshedAt, releases, snapshots, refresh }
})
