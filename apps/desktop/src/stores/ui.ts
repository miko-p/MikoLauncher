/**
 * UI store —— MVVM 的 VM 层（M8-1 主题/布局插件）。
 *
 * 把侧车 UiRegistryService 提供的 UI 贡献（activeTheme + per-slot layouts）
 * 映射成前端可绑定的响应式状态。前端引用本 store 渲染主题 <style> 和布局 slot。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { UiManifest, UiLayoutSlot, UiView, UiWidget } from '@miko-launcher/shared'
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

  /**
   * M9-6：导航/页面视图集合（已过滤 disabled，按 order 排序）。
   * 由宿主内置视图 + 插件贡献的视图合并（sidecar UiRegistryService 已种子化内置五视图）。
   */
  const views = computed<UiView[]>(() =>
    (manifest.value?.views ?? [])
      .filter((v) => !v.disabled)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.key.localeCompare(b.key)),
  )

  /** M9-6：仅插件贡献的视图（builtin=false，用于前端动态注册路由）。 */
  const pluginViews = computed<UiView[]>(() => views.value.filter((v) => !v.builtin))

  /** M10：小组件面板条目（过滤 disabled，按 order 排序），前端渲染成主页卡片网格。 */
  const widgets = computed<UiWidget[]>(() =>
    (manifest.value?.widgets ?? [])
      .filter((w) => !w.disabled)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.key.localeCompare(b.key)),
  )

  /** 拉取最新的 UI 贡献（前端在启用/禁用插件后调用）。 */
  async function refresh() {
    error.value = null
    try {
      manifest.value = await getUiManifest()
    } catch (e) {
      error.value = (e as Error).message
    }
  }

  return { manifest, theme, error, layoutsFor, activeSlots, views, pluginViews, widgets, refresh }
})
