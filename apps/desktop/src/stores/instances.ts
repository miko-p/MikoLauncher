/**
 * 实例 store —— MVVM 的 VM 层（对应蓝图「四、ViewModel 层」）。
 * 把 Rust/sidecar 的领域服务状态映射成 UI 可绑定的响应式状态。
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { listen } from '@tauri-apps/api/event'
import type { Instance, ModpackFile, Mod } from '@miko-launcher/shared'
import { listInstances, createInstance, launchInstance, updateInstanceAccount, updateInstanceIcon, updateInstanceJavaMajor, removeInstance, getLaunchStatus, checkVersionExists, fetchVersions, modrinthModpackFiles, updateInstanceMods, type LaunchStatusEvent } from '../api'

interface CreatePayload {
  name: string
  versionId: string
  modLoader: 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'
  /** 实例期望的 Java 主版本（可选） */
  javaMajor?: number
  /** M13：创建时绑定 Modrinth 模组包 */
  modpack?: {
    provider: 'modrinth'
    project: string
    title: string
    iconUrl?: string
    versionId: string
    versionNumber: string
    fileUrl?: string
  }
}

/** launch:status 事件监听是否已注册（幂等，避免 App/实例页/详情页重复注册）。 */
let launchEventsInited = false

/**
 * 把 `.mrpack` 文件清单（Rust `modrinth_modpack_files` 返回）映射成实例 `mods` 数组（Mod）。
 * 模组包里的文件只有文件名/size/sha1/url，没有单个模组的 projectName/versionId，
 * 故用 file_name 作为展示名与唯一 id，其余字段原样带上供详情页展示。
 */
export function modpackFilesToMods(files: ModpackFile[]): Mod[] {
  return files
    .filter((f) => f.file_name)
    .map((f) => ({
      id: f.file_name,
      projectName: f.file_name,
      fileName: f.file_name,
      versionId: '',
      source: 'modrinth' as const,
      hash: f.sha1 || undefined,
      size: f.size,
      path: f.path,
      clientRequired: f.client_required,
    }))
}

export const useInstanceStore = defineStore('instances', () => {
  const instances = ref<Instance[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const sidecarReady = ref(false)

  const count = computed(() => instances.value.length)

  /* ── M11：版本清单缓存（懒加载，仅进「自定义」才拉一次，会话内复用） ── */
  /** 缓存已拉取的版本清单（release + snapshot，已按最新在前），避免每次打开弹窗都重新抓清单卡顿。 */
  const versionsRaw = ref<{ id: string; type: string }[]>([])
  const versionsLoading = ref(false)
  const versionsLoaded = ref(false)
  /** 首次调用才抓 Mojang 清单，之后命中内存缓存直接返回。 */
  async function loadVersions(): Promise<{ id: string; type: string }[]> {
    if (versionsLoaded.value) return versionsRaw.value
    if (versionsLoading.value) return [] // 并发进入时等首次加载完成，避免重复拉取
    versionsLoading.value = true
    try {
      const list = await fetchVersions()
      versionsRaw.value = list.filter((v) => v.type === 'release' || v.type === 'snapshot')
      versionsLoaded.value = true
    } finally {
      versionsLoading.value = false
    }
    return versionsRaw.value
  }

  /* ── M11-3：运行中实例状态（供启动按钮禁用 / 底部状态列） ── */
  /** 运行中实例 → pid（0 = 已提交启动、尚未拉到 pid）。由 launch:status 事件 + launch_status 查询维护。 */
  const running = ref<Record<string, number>>({})
  const isRunning = (id: string) => id in running.value

  /** 拉取后端当前运行表（挂载时恢复）。 */
  async function refreshLaunchStatus() {
    try {
      const list = await getLaunchStatus()
      running.value = Object.fromEntries(list.map((r) => [r.instanceId, r.pid]))
    } catch {
      /* 非 Tauri 忽略 */
    }
  }

  /** 监听 launch:status 事件，维护运行状态（幂等：只在首次真正 listen，重复调用不重复注册）。
   *  返回取消函数；供实例页/详情页/App 挂载时调用。 */
  function initLaunchEvents(): (() => void) | undefined {
    if (!launchEventsInited) {
      launchEventsInited = true
      listen<LaunchStatusEvent>('launch:status', (evt) => {
        const { instanceId, action, pid, message } = evt.payload
        if (action === 'started') running.value[instanceId] = pid ?? 0
        else if (action === 'exit' || action === 'error') delete running.value[instanceId]
        // TODO 前端诊断：确认事件到达（发布前移除）
        console.log('[launch:status]', action, instanceId, pid ?? '', message ?? '')
      }).catch(() => {})
    }
    return () => {}
  }

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

  /** 版本校验后创建实例（M11：实例 ➕ 弹窗「自定义」）。先核对版本 id 在完整 Mojang 清单里确实存在，
   *  不存在则返回失败原因（不落库），避免手填版本号创建出不存在的实例。 */
  async function addInstanceVerified(payload: CreatePayload): Promise<{ ok: boolean; reason?: string }> {
    error.value = null
    let exists = false
    try {
      const chk = await checkVersionExists(payload.versionId)
      exists = chk.exists
    } catch (e) {
      return { ok: false, reason: `版本校验失败: ${(e as Error).message}` }
    }
    if (!exists) {
      error.value = `版本 ${payload.versionId} 不存在`
      return { ok: false, reason: error.value }
    }
    try {
      await createInstance(payload)
      await fetchInstances()
      return { ok: true }
    } catch (e) {
      error.value = (e as Error).message
      return { ok: false, reason: error.value }
    }
  }

  /**
   * M13：创建「从模组包开始」的实例（绑定 modpack 引用 + 立即解析 .mrpack 文件清单填进实例 mods）。
   * 文件本体仍由首次启动时 lighty 实装（Rust `launch_game` 的 with_modrinth_modpack）；这里只持久化
   * 清单供实例详情页「模组」栏展示。`fileUrl` 缺省或解析失败时静默跳过填清单（实例仍照常创建）。 */
  async function addModpackInstance(
    payload: CreatePayload,
    fileUrl?: string,
  ): Promise<{ ok: boolean; instance?: Instance; reason?: string }> {
    error.value = null
    let created: Instance | undefined
    try {
      created = await createInstance(payload)
      await fetchInstances()
    } catch (e) {
      error.value = (e as Error).message
      return { ok: false, reason: error.value }
    }
    // 有 .mrpack 下载地址才去解析清单（导入式/无文件时不填）
    if (fileUrl && created) {
      try {
        const files = await modrinthModpackFiles(fileUrl)
        if (files.length) {
          const mods = modpackFilesToMods(files)
          const updated = await updateInstanceMods(created.id, mods)
          const idx = instances.value.findIndex((i) => i.id === created.id)
          if (idx >= 0) instances.value[idx] = updated
        }
      } catch (e) {
        // 清单解析失败不阻塞实例创建；详情页「模组」栏显示「暂无清单」即可
        error.value = `模组清单解析失败：${(e as Error).message}`
      }
    }
    return { ok: true, instance: created }
  }

  /** 启动实例（M11-3 非阻塞）：提交后立即返回 {started}；游戏运行状态经 launch:status 事件维护 running。 */
  async function launch(id: string, accountId?: string, offline = true) {
    error.value = null
    try {
      const res = await launchInstance({ instanceId: id, accountId, offline })
      running.value[id] = 0 // 已提交（pid 由 started 事件回填）
      return res
    } catch (e) {
      error.value = (e as Error).message
      // 强反馈：前端必然看到启动失败原因（诊断 + 用户可读）
      window.alert(`启动失败：${error.value}`)
      return null
    }
  }

  /**
   * 绑定/解绑实例关联账号（M7 持久化）：accountId 传 undefined/null 解绑。
   * 成功后本地列表同步，下次启动即用实例绑定账号。
   */
  async function bindAccount(id: string, accountId?: string | null) {
    const target = accountId && accountId.trim() !== '' ? accountId : null
    error.value = null
    try {
      const updated = await updateInstanceAccount(id, target)
      const idx = instances.value.findIndex((i) => i.id === id)
      if (idx >= 0) instances.value[idx] = updated
    } catch (e) {
      error.value = (e as Error).message
    }
  }

  /** 设置/清除实例自定义图标（M11：data-URI base64）。icon 传空/null 清除。本地列表同步。 */
  async function setIcon(id: string, icon?: string | null) {
    error.value = null
    try {
      const updated = await updateInstanceIcon(id, icon)
      const idx = instances.value.findIndex((i) => i.id === id)
      if (idx >= 0) instances.value[idx] = updated
      return updated
    } catch (e) {
      error.value = (e as Error).message
      return null
    }
  }

  /** 设置/清除实例期望的 Java 主版本（M12：实例详情页选择）。javaMajor 传 null/undefined 清除。本地列表同步。 */
  async function setJavaMajor(id: string, javaMajor?: number | null) {
    error.value = null
    try {
      const updated = await updateInstanceJavaMajor(id, javaMajor)
      const idx = instances.value.findIndex((i) => i.id === id)
      if (idx >= 0) instances.value[idx] = updated
      return updated
    } catch (e) {
      error.value = (e as Error).message
      return null
    }
  }

  /** 删除实例并刷新列表。 */
  async function remove(id: string) {
    error.value = null
    try {
      await removeInstance(id)
      await fetchInstances()
    } catch (e) {
      error.value = (e as Error).message
    }
  }

  return {
    instances,
    loading,
    error,
    sidecarReady,
    count,
    versionsRaw,
    versionsLoading,
    versionsLoaded,
    loadVersions,
    running,
    isRunning,
    fetchInstances,
    refreshLaunchStatus,
    initLaunchEvents,
    addInstance,
    addInstanceVerified,
    addModpackInstance,
    launch,
    bindAccount,
    setIcon,
    setJavaMajor,
    remove,
  }
})
