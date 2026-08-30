<script setup lang="ts">
/**
 * ModrinthDetailView —— Modrinth 项目详情页（/modrinth/:slug）。
 *
 * 供「下载预览」小组件（widget-download）和外部跳转直达某个模组/模组包详情：
 * 展示图标/标题/简介/统计/分类/支持版本，并照下载页流程选 MC 版本 + 加载器创建实例
 * （模组包依赖在首次启动时 lighty 自动安装）。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { modrinthProject, modrinthProjectVersions } from '../api'
import { useInstanceStore } from '../stores/instances'
import type { ModrinthProject, ModrinthVersion } from '@miko-launcher/shared'

const route = useRoute()
const router = useRouter()
const store = useInstanceStore()

const slug = computed(() => String(route.params.slug ?? ''))

const p = ref<ModrinthProject | null>(null)
const versions = ref<ModrinthVersion[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const selectedVersionId = ref('')
const instanceName = ref('')
const creating = ref(false)
const createErr = ref<string | null>(null)

const selectedVersion = computed<ModrinthVersion | undefined>(() =>
  versions.value.find((v) => v.id === selectedVersionId.value),
)

function primaryFile(v: ModrinthVersion | undefined) {
  if (!v) return undefined
  return v.files?.find((f) => f.primary) ?? v.files?.[0]
}

async function load() {
  loading.value = true
  error.value = null
  try {
    p.value = await modrinthProject(slug.value)
    const v = await modrinthProjectVersions(slug.value, 40)
    versions.value = v
    if (v.length) selectedVersionId.value = v[0]!.id
    else if (!v.length) error.value = '该项目暂无版本'
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

onMounted(load)

function fmt(n: number | undefined): string {
  if (n == null) return ''
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function isModpack(): boolean {
  return p.value?.project_type === 'modpack'
}

async function createFromProject() {
  const v = selectedVersion.value
  if (!p.value || !v) return
  if (!instanceName.value.trim()) {
    createErr.value = '请填写实例名'
    return
  }
  const mcVersion = v.game_versions?.[0]
  if (!mcVersion) {
    createErr.value = '该版本未标注支持的 MC 版本'
    return
  }
  const loader = (v.loaders?.[0] as 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'vanilla') || 'fabric'
  const file = primaryFile(v)
  creating.value = true
  createErr.value = null
  try {
    const ok = await store.addModpackInstance(
      {
        name: instanceName.value.trim(),
        versionId: mcVersion,
        modLoader: loader,
        ...(p.value?.project_type === 'modpack'
          ? {
              modpack: {
                provider: 'modrinth' as const,
                project: p.value.slug,
                title: p.value.title,
                iconUrl: p.value.icon_url,
                versionId: v.id,
                versionNumber: v.version_number,
                fileUrl: file?.url,
              },
            }
          : {}),
      },
      file?.url,
    )
    if (ok.ok) {
      void router.push('/instances')
    } else {
      createErr.value = ok.reason ?? store.error
    }
  } catch (e) {
    createErr.value = (e as Error).message
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <section class="mod-detail">
    <div class="row">
      <button class="ghost" @click="router.back()">← 返回</button>
      <span v-if="error" class="err">⚠ {{ error }}</span>
    </div>

    <p v-if="loading && !p" class="muted">加载中…</p>
    <p v-if="!loading && !p && error" class="muted">无法载入该项目。</p>

    <template v-if="p">
      <div class="head">
        <img v-if="p.icon_url" class="d-icon" :src="p.icon_url" :alt="p.title" />
        <div v-else class="d-icon fallback">{{ isModpack() ? '▤' : '🧩' }}</div>
        <div class="d-info">
          <h2>{{ p.title }}</h2>
          <span class="pill-type">{{ isModpack() ? '模组包' : '模组' }}</span>
          <p class="d-desc">{{ p.description }}</p>
          <span class="muted meta" v-if="p.downloads != null || p.followers != null">
            <template v-if="p.downloads != null">下载 {{ fmt(p.downloads) }}</template>
            <template v-if="p.followers != null"> · 关注 {{ fmt(p.followers) }}</template>
          </span>
          <span v-if="p.versions?.length" class="muted meta">支持 {{ p.versions.slice(-3).join(', ') }}</span>
        </div>
      </div>

      <div class="form">
        <label class="field"><span>实例名</span><input v-model="instanceName" :placeholder="p.title" /></label>
        <label class="field"><span>版本</span>
          <select v-model="selectedVersionId">
            <option v-for="v in versions" :key="v.id" :value="v.id">
              {{ v.version_number }} · {{ v.game_versions?.[0] ?? '?' }} ({{ v.loaders?.[0] ?? 'vanilla' }})
            </option>
          </select>
        </label>
        <p v-if="createErr" class="form-err">⚠ {{ createErr }}</p>
        <div class="actions">
          <button class="primary" :disabled="creating" @click="createFromProject">
            {{ creating ? '创建实例…' : '创建实例' }}
          </button>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.mod-detail { display: flex; flex-direction: column; gap: 0.9rem; }
.row { display: flex; align-items: center; gap: 0.8rem; }
.row h2 { margin: 0; }
.err { color: var(--danger, #e5484d); margin: 0; }
.muted { color: var(--text-dim, #8b8490); margin: 0; }

.head { display: flex; gap: 1rem; align-items: flex-start; }
.d-icon { width: 84px; height: 84px; border-radius: 18px; object-fit: cover; flex-shrink: 0; }
.d-icon.fallback { background: var(--shell-bg, #77636c); color: #fff; font-size: 2rem;
  display: flex; align-items: center; justify-content: center; }
.d-info { display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
.d-info h2 { margin: 0; font-size: 1.25rem; }
.d-desc { margin: 0; font-size: 0.88rem; color: var(--text, #3a3436); }
.pill-type { align-self: flex-start; padding: 0.05rem 0.55rem; border-radius: 999px; font-size: 0.75rem;
  background: rgba(74, 144, 226, 0.15); color: #4a90e2; }
.meta { font-size: 0.8rem; }

.form { display: flex; flex-direction: column; gap: 0.7rem; max-width: 420px; }
.field { display: flex; flex-direction: column; gap: 0.3rem; }
.field span { font-size: 0.85rem; color: var(--text-dim, #8b8490); }
.field input, .field select { background: var(--bg, #b6abb0); color: var(--text, #3a3436);
  border: 1px solid var(--border, #c9bec3); padding: 0.45rem 0.6rem; border-radius: 8px; font-size: 0.9rem; }
.form-err { color: var(--danger, #e5484d); margin: 0; font-size: 0.85rem; }
.actions { display: flex; justify-content: flex-end; }
.actions .primary { background: var(--accent, #39c5bb); color: #111; border: none;
  padding: 0.45rem 1.1rem; border-radius: 8px; cursor: pointer; }
.actions .primary:disabled { opacity: 0.5; cursor: default; }
.ghost { background: transparent; color: var(--text, #3a3436); border: 1px solid var(--border, #c9bec3);
  padding: 0.35rem 0.9rem; border-radius: 8px; cursor: pointer; }
</style>
