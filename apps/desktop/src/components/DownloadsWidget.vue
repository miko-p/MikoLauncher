<script setup lang="ts">
/**
 * DownloadsWidget —— 主页「下载预览」小组件内容组件。
 *
 * 把下载页的 Modrinth / CurseForge 拉进主页做快速预览：
 *  - Modrinth：浏览全部模组包/模组，一页条数**随组件高度自适应**（ResizeObserver 量可用高度
 *    决定每页能放几条），列表区可滚动、顶/底固定 tab 与分页条；
 *    点击某项直达其详情页（/modrinth/:slug）。
 *  - CurseForge：其搜索 API 需个人 key，暂为占位提示（同下载页浏览器一致）。
 *
 * 布局：负 margin 抵消宿主卡片 .widget-card-body 的 padding，让本组件精确填满卡片可用区，
 * 再用内部 flex 三栏 —— 上部 tab（flex-shrink:0）+ 中部列表（flex:1, overflow:auto）+ 下部分页（flex-shrink:0）。
 * 这样无论用户把小组件拖多高，tab 与分页始终分别贴顶/底部，中间列表随可用高度显示更多条目。
 *
 * 由插件 `widget-download` 贡献外壳（key='widget-download'），宿主前端 HomeView 对
 * key 特判渲染本组件（同 widget-account 模式）。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { modrinthSearch } from '../api'
import type { ModrinthProject } from '@miko-launcher/shared'

const router = useRouter()

const source = ref<'modrinth' | 'curseforge'>('modrinth')
const tab = ref<'modpack' | 'mod'>('modpack')
const hits = ref<ModrinthProject[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

/** 单行大约高度（含上下 padding 与行间距），用于由可用高算出每页条数 */
const ROW_H = 50
/** 每页条数：初始占位 8，ResizeObserver 量到列表区高度后更新 */
const pageSize = ref(8)
const page = ref(1)
const total = ref(0)

/** 总页数（向上取整；0 命中无页） */
const totalPages = computed(() => (total.value <= 0 ? 0 : Math.ceil(total.value / pageSize.value)))
const hasPrev = computed(() => page.value > 1)
const hasNext = computed(() => page.value < totalPages.value)

/** 列表容器（测量可用高度） */
const listEl = ref<HTMLElement | null>(null)
let ro: ResizeObserver | null = null

async function runSearch(targetPage = 1) {
  if (source.value === 'curseforge') {
    hits.value = []
    total.value = 0
    loading.value = false
    error.value = null
    return
  }
  loading.value = true
  error.value = null
  try {
    const off = (targetPage - 1) * pageSize.value
    const res = await modrinthSearch({ projectType: tab.value, index: 'downloads', limit: pageSize.value, offset: off })
    hits.value = res.hits
    total.value = res.total_hits
    page.value = targetPage
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

/** 源/类型变化：回到第 1 页重载。 */
function reload() {
  hits.value = []
  total.value = 0
  page.value = 1
  void runSearch(1)
}

function goPrev() {
  if (loading.value || !hasPrev.value) return
  void runSearch(page.value - 1)
}
function goNext() {
  if (loading.value || !hasNext.value) return
  void runSearch(page.value + 1)
}

onMounted(() => {
  ro = new ResizeObserver(() => {
    const el = listEl.value
    if (!el) return
    const size = Math.max(1, Math.floor(el.clientHeight / ROW_H))
    if (size !== pageSize.value) {
      pageSize.value = size
      // 高度变化 → 重拉当前页，让每页条数与新高度一致
      void runSearch(page.value)
    }
  })
  if (listEl.value) ro.observe(listEl.value)
  void runSearch(1)
})
onUnmounted(() => ro?.disconnect())

function openDetail(p: ModrinthProject) {
  void router.push(`/modrinth/${p.slug}`)
}

/** 左上/右上控件：清空当前 total 展示，放大镜按钮跳到下载页搜索栏。 */
function goSearch() {
  void router.push({ path: '/download', query: { focus: 'search' } })
}

function fmt(n: number | undefined): string {
  if (n == null) return ''
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}
</script>

<template>
  <div class="dw-widget">
    <!-- 顶栏（固定顶部，不随内容滚动/被顶出） -->
    <div class="dw-tabs">
      <button :class="{ active: source === 'modrinth' }" @click="source = 'modrinth'; reload()">Modrinth</button>
      <button :class="{ active: source === 'curseforge' }" @click="source = 'curseforge'; reload()">CurseForge</button>
      <button class="dw-tabtype" :class="{ active: tab === 'modpack' }" @click="tab = 'modpack'; reload()">模组包</button>
      <button class="dw-tabtype" :class="{ active: tab === 'mod' }" @click="tab = 'mod'; reload()">模组</button>
      <!-- 放大镜：跳到下载页搜索栏 -->
      <button class="dw-search" title="到下载页搜索" @click="goSearch">🔍</button>
    </div>

    <!-- 中部：占位提示 / 结果列表（自适应滚动的区域） -->
    <div ref="listEl" class="dw-body">
      <p v-if="source === 'curseforge'" class="dw-note">CurseForge 的 API 需个人 key（console.curseforge.com 申请）后可用，暂为占位。</p>
      <p v-else-if="error" class="dw-note">⚠ {{ error }}</p>
      <p v-else-if="loading && !hits.length" class="dw-note">加载中…</p>

      <div v-if="hits.length" class="dw-list">
        <button
          v-for="p in hits"
          :key="p.slug"
          class="dw-row"
          :title="`打开 ${p.title} 详情`"
          @click="openDetail(p)"
        >
          <img v-if="p.icon_url" class="dw-thumb" :src="p.icon_url" :alt="p.title" loading="lazy" />
          <div v-else class="dw-thumb dw-thumb-fallback">{{ tab === 'modpack' ? '▤' : '🧩' }}</div>
          <div class="dw-info">
            <strong class="dw-title">{{ p.title }}</strong>
            <span class="dw-desc">{{ p.description }}</span>
            <span class="dw-meta">
              <span v-if="p.downloads != null">↓ {{ fmt(p.downloads) }}</span>
              <span v-if="p.followers != null">· ★ {{ fmt(p.followers) }}</span>
              <span v-if="p.versions?.length">· {{ p.versions.slice(-2).join(', ') }}</span>
            </span>
          </div>
          <span class="dw-go">›</span>
        </button>
      </div>
      <p v-else-if="!loading && !error && source === 'modrinth'" class="dw-note empty">暂无可展示的项目。</p>
    </div>

    <!-- 分页条（dw-widget 直接子级，固定底部、不随列表滚动） -->
    <div v-if="source === 'modrinth' && totalPages > 0" class="dw-pager">
      <button class="dw-pgbtn" :disabled="loading || !hasPrev" @click="goPrev">← 上一页</button>
      <span class="dw-pageof">{{ page }} / {{ totalPages }}</span>
      <button class="dw-pgbtn" :disabled="loading || !hasNext" @click="goNext">下一页 →</button>
    </div>
  </div>
</template>

<style scoped>
/* 负 margin 抵消宿主 .widget-card-body 的 padding → 精确撑满卡片可用区，内部三栏布局 */
.dw-widget {
  box-sizing: border-box;
  height: 100%;
  margin: -0.55rem -0.8rem;
  padding: 0.55rem 0.8rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
}
.dw-note { margin: 0; font-size: 0.8rem; color: var(--text-dim, #8b8490); }
.dw-note.empty { margin: 0.2rem 0; }

/* 顶栏：固定 */
.dw-tabs { display: flex; gap: 0.35rem; flex-wrap: wrap; align-items: center; flex-shrink: 0; }
.dw-tabs button {
  padding: 0.25rem 0.6rem;
  font-size: 0.72rem;
  border: 1px solid var(--border, #c9bec3);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.4);
  color: var(--text, #3a3436);
  cursor: pointer;
  font-family: inherit;
}
.dw-tabs button.active { background: var(--accent, #77636c); color: #fff; border-color: transparent; }
.dw-tabtype.active { background: var(--accent, #39c5bb); color: #111; }
/* 放大镜按钮：顶栏右端，小号圆钮 */
.dw-search {
  margin-left: auto;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  line-height: 1;
  border: 1px solid var(--border, #c9bec3);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.5);
  color: var(--text, #3a3436);
  cursor: pointer;
  font-family: inherit;
  transition: background 0.12s ease, transform 0.12s ease;
}
.dw-search:hover { background: rgba(255, 255, 255, 0.8); transform: scale(1.08); }

/* 中部：自适应 + 内部滚动（flex:1, min-height:0, overflow:auto） */
.dw-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

/* 结果行 */
.dw-list { display: flex; flex-direction: column; gap: 0.4rem; }
.dw-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  text-align: left;
  padding: 0.45rem 0.6rem;
  border: 1px solid rgba(255, 255, 255, 0.45);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.35);
  color: var(--text, #3a3436);
  cursor: pointer;
  font-family: inherit;
  flex-shrink: 0;
  transition: background 0.12s ease, transform 0.12s ease;
}
.dw-row:hover { background: rgba(255, 255, 255, 0.55); transform: translateY(-1px); }
.dw-thumb { width: 34px; height: 34px; border-radius: 9px; object-fit: cover; flex-shrink: 0; }
.dw-thumb-fallback { background: var(--shell-bg, #77636c); color: #fff; font-size: 0.95rem;
  display: flex; align-items: center; justify-content: center; }
.dw-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.05rem; }
.dw-title { font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dw-desc { font-size: 0.72rem; color: var(--text-dim, #8b8490); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dw-meta { font-size: 0.7rem; color: var(--text-dim, #8b8490); display: flex; gap: 0.5rem; }
.dw-go { flex-shrink: 0; color: var(--text-dim, #8b8490); font-size: 1.1rem; }

/* 分页条：固定底部，做矮紧凑（更少垂直占用） */
.dw-pager {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
  flex-shrink: 0;
  margin-top: auto;
  min-height: 22px;
}
.dw-pgbtn {
  padding: 0.12rem 0.5rem;
  font-size: 0.7rem;
  border: 1px solid var(--border, #c9bec3);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.4);
  color: var(--text, #3a3436);
  cursor: pointer;
  font-family: inherit;
  line-height: 1.3;
}
.dw-pgbtn:disabled { opacity: 0.45; cursor: default; }
.dw-pageof { font-size: 0.68rem; color: var(--text-dim, #8b8490); }
</style>
