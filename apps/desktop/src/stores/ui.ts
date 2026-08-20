/**
 * UI store —— MVVM 的 VM 层（M8-1 主题/布局插件）。
 *
 * 把侧车 UiRegistryService 提供的 UI 贡献（activeTheme + per-slot layouts）
 * 映射成前端可绑定的响应式状态。前端引用本 store 渲染主题 <style> 和布局 slot。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { UiManifest, UiLayoutSlot } from '@miko-launcher/shared'
import { getUiManifest } from '../api'

export const useUiStore = defineStore('ui', () => {
  /** 当前生效的 UI manifest（null = 尚未拉取 / 拉取失败） */
  const manifest = ref<UiManifest | null>(null)
  const error = ref<string | null>(null)

  /** 当前生效主题（无主题插件为 null） */
  const theme = computed(() => manifest.value?.theme ?? null)

  /** 按 slot 取布局贡献（同一 slot 插件可能贡献多个时，取已生效 manifest 里的） */
  const layoutsFor = (slot: string): UiLayoutSlot[] =>
    (manifest.value?.layouts ?? []).filter((l) => l.slot === slot)

  /** 所有 slot 名（前端的注入点枚举用） */
  const activeSlots = computed(() => [...new Set((manifest.value?.layouts ?? []).map((l) => l.slot))])

  /** 拉取最新的 UI 贡献（前端在启用/禁用插件后调用）。 */
  async function refresh() {
    error.value = null
    try {
      manifest.value = await getUiManifest()
    } catch (e) {
      error.value = (e as Error).message
    }
  }

  return { manifest, theme, error, layoutsFor, activeSlots, refresh }
})
