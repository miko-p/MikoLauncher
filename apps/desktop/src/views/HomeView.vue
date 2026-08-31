<script setup lang="ts">
/**
 * HomeView —— 首页：小组件面板（方案 B：相对容器缩放）。
 *
 * 每张卡片用**设计坐标系**里的绝对像素 {x,y,w,h} 存储；渲染时按当前容器宽度相对
 * 设计宽（DESIGN_W=1100）的比例 `scale = curW / DESIGN_W` 整体缩放坐标与尺寸 ——
 * 窗口调整大小时所有卡片一起等比缩放：从大到小不溢出、从小到大不留大空白，且手感
 * 与直觉一致（依旧是自由像素拖拽移动 / 右下把手缩放）。
 *
 * 编辑态（下拉「首页」→「编辑」）：
 *   - 拖动卡片本体 → 改变位置
 *   - 拖右下角把手 → 改变大小（拖拽期间最小尺寸受限）
 *   - 左上「−」移除、右上「＋」放大一档、底部「←/→」调顺序
 *   - 顶部横条：「添加小组件 +」/「重置面板」/「完成」
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useUiStore } from '../stores/ui'
import {
  useHomeStore,
  DESIGN_W,
  MIN_W,
  MIN_H,
  type WidgetLayout,
} from '../stores/home'
import AccountWidget from '../components/AccountWidget.vue'
import QuickInstancesWidget from '../components/QuickInstancesWidget.vue'
import DownloadsWidget from '../components/DownloadsWidget.vue'
import ThemeWidget from '../components/ThemeWidget.vue'

const uiStore = useUiStore()
const home = useHomeStore()

const galleryOpen = ref(false)

/** 画布容器引用 + 当前宽度（ResizeObserver 测量） */
const canvasEl = ref<HTMLElement | null>(null)
const containerW = ref(DESIGN_W)
let ro: ResizeObserver | null = null

/** 当前缩放比（相对设计宽） */
const scale = computed(() => {
  const w = containerW.value
  const s = w / DESIGN_W
  return Math.max(0.4, Math.min(1.6, s))
})

/** 画布高度：垂直方向不缩放，用设计坐标的底部高度原值。 */
const canvasHeight = computed(() => home.canvasHeight)

/** 某卡片渲染用几何：只对水平方向（x/w）应用容器缩放，垂直（y/h）保持设计坐标原值。 */
function rectStyle(l: WidgetLayout) {
  return {
    left: (l.x * scale.value) + 'px',
    top: l.y + 'px',
    width: (l.w * scale.value) + 'px',
    height: l.h + 'px',
  }
}

/** 水平方向的屏幕像素 → 设计坐标（除 scale）；垂直方向不缩放，直接返回 px（1:1）。 */
function toDesignX(px: number): number {
  return px / scale.value
}

/* ---- 拖拽移动 / 缩放（编辑态，自由像素 + 容器缩放） ---- */
type DragMode = 'move' | 'resize'
const drag = ref<{
  mode: DragMode
  uid: string
  start: WidgetLayout
  sx: number
  sy: number
} | null>(null)

function onCardPointerDown(uid: string, e: PointerEvent) {
  if (!home.editing) return
  const target = e.target as HTMLElement
  if (target.closest('.wg-btn, .wg-resize, .wt-edit-input, .gallery-overlay')) return
  const w = home.panelWidgets.find((x) => x.uid === uid)
  if (!w) return
  e.preventDefault()
  drag.value = { mode: 'move', uid, start: { ...w.layout }, sx: e.clientX, sy: e.clientY }
  window.addEventListener('pointermove', onPtrMove)
  window.addEventListener('pointerup', onPtrUp)
}

function onResizePointerDown(uid: string, e: PointerEvent) {
  if (!home.editing) return
  const w = home.panelWidgets.find((x) => x.uid === uid)
  if (!w) return
  e.preventDefault()
  e.stopPropagation()
  drag.value = { mode: 'resize', uid, start: { ...w.layout }, sx: e.clientX, sy: e.clientY }
  window.addEventListener('pointermove', onPtrMove)
  window.addEventListener('pointerup', onPtrUp)
}

function onPtrMove(e: PointerEvent) {
  const d = drag.value
  if (!d) return
  const dx = toDesignX(e.clientX - d.sx)
  const dy = e.clientY - d.sy // 垂直方向不缩放，1:1
  if (d.mode === 'move') {
    home.setLayout(d.uid, {
      x: Math.max(-MIN_W, d.start.x + dx),
      y: Math.max(-MIN_H, d.start.y + dy),
      w: d.start.w,
      h: d.start.h,
    })
  } else {
    home.setLayout(d.uid, {
      x: d.start.x,
      y: d.start.y,
      w: Math.max(MIN_W, d.start.w + dx),
      h: Math.max(MIN_H, d.start.h + dy),
    })
  }
}
function onPtrUp() {
  window.removeEventListener('pointermove', onPtrMove)
  window.removeEventListener('pointerup', onPtrUp)
  drag.value = null
}

/** 右上「＋」：放大一档（宽高各 +0.25 设计宽的比例）。 */
function bumpUp(uid: string) {
  const w = home.panelWidgets.find((x) => x.uid === uid)
  if (!w) return
  home.setLayout(uid, { ...w.layout, w: w.layout.w + Math.round(DESIGN_W * 0.1), h: w.layout.h + 40 })
}

function resetPanelToDefault() {
  if (!window.confirm('恢复为默认面板？将清空当前对小组件位置/大小/文字的调整。')) return
  home.resetLayout()
}

/** 确保 RO 已挂到画布：canvas 可能因 manifest/插件异步加载而延迟挂载，必须等画布真正出现后再量宽 + observe。
  * 否则 RO 在画布尚为 null 时一次性 observe 落空 → containerW 停在 DESIGN_W（scale 恒 1）→ 重开/冷启动缩放失效。 */
function ensureResizeObserver() {
  void nextTick(() => {
    if (!canvasEl.value) return
    containerW.value = canvasEl.value.clientWidth || containerW.value
    if (!ro) {
      ro = new ResizeObserver((entries) => {
        const entry = entries[0]
        const w = entry?.contentRect?.width ?? canvasEl.value?.clientWidth ?? containerW.value
        if (w > 0) containerW.value = w
      })
    }
    ro.observe(canvasEl.value)
  })
}

onMounted(() => {
  if (!uiStore.manifest) uiStore.refresh()
  ensureResizeObserver()
})
onUnmounted(() => ro?.disconnect())

// 画布随小组件出现/插件启停而挂载变化：每次数量变化后重新确保 RO 挂上（observe 同元素幂等）。
watch(
  () => home.panelWidgets.length,
  () => ensureResizeObserver(),
)

watch(
  () => home.editing,
  (editing) => {
    if (!editing) return
    for (const w of home.panelWidgets) {
      if (!home.hasEditableText(w.uid)) continue
      if (home.textOf(w.uid) != null) continue
      const m = w.html.match(/<span class="wt-text"[^>]*>([\s\S]*?)<\/span>/)
      if (m) home.setText(w.uid, m[1] ?? '')
    }
  },
)

function displayText(w: { uid: string; html: string }): string {
  const t = home.textOf(w.uid)
  if (t != null) return t
  const m = w.html.match(/<span class="wt-text"[^>]*>([\s\S]*?)<\/span>/)
  return m?.[1] ?? ''
}
</script>

<template>
  <section class="home-view">
    <!-- 顶部：编辑态横条 -->
    <div v-if="home.editing" class="home-edit-bar">
      <button type="button" class="editbar-btn primary" :disabled="!home.hasRemoved" @click="galleryOpen = true">
        添加小组件 +
      </button>
      <span class="editbar-hint">拖动卡片换位置 · 拖右下角把手改大小 · 窗口变化整体等比缩放</span>
      <button type="button" class="editbar-btn" title="恢复默认面板" @click="resetPanelToDefault()">重置面板</button>
      <button type="button" class="editbar-btn" @click="home.exitEditing(); galleryOpen = false">完成</button>
    </div>

    <!-- 小组件画布：绝对定位，卡片坐标/尺寸按容器宽度等比缩放 -->
    <div
      v-if="home.panelWidgets.length"
      ref="canvasEl"
      class="widget-canvas"
      :class="{ editing: home.editing }"
      :style="{ height: canvasHeight + 'px' }"
    >
      <article
        v-for="w in home.panelWidgets"
        :key="'wg-' + w.uid"
        class="widget-card"
        :class="{ editing: home.editing }"
        :style="rectStyle(w.layout)"
        @pointerdown="onCardPointerDown(w.uid, $event)"
      >
        <!-- 编辑态：左上「−」移除 -->
        <button v-if="home.editing" type="button" class="wg-btn wg-remove wg-remove-float" :title="`移除「${w.title}」`" @click="home.remove(w.uid)">−</button>
        <!-- 编辑态：右上「＋」放大一档 -->
        <button v-if="home.editing" type="button" class="wg-btn wg-size-float" title="放大一档" @click="bumpUp(w.uid)">＋</button>

        <div class="widget-card-body">
          <AccountWidget v-if="w.key === 'widget-account'" />
          <QuickInstancesWidget v-else-if="w.key === 'widget-quick-instances'" />
          <DownloadsWidget v-else-if="w.key === 'widget-download'" />
          <ThemeWidget v-else-if="w.key === 'widget-theme'" />
          <div v-else v-html="home.renderHtml(w.uid)"></div>

          <textarea
            v-if="home.editing && home.hasEditableText(w.uid)"
            class="wt-edit-input"
            :value="displayText(w)"
            placeholder="输入文字…"
            @input="home.setText(w.uid, ($event.target as HTMLTextAreaElement).value)"
          ></textarea>
        </div>

        <!-- 编辑态：右下角拖拽缩放把手 -->
        <div v-if="home.editing" class="wg-resize" title="拖动改变大小" @pointerdown="onResizePointerDown(w.uid, $event)"></div>
      </article>
    </div>

    <p v-else class="muted">（主页暂无小组件。可到插件页启用小组件插件后回到这里。）</p>

    <!-- 小组件库弹层 -->
    <div v-if="galleryOpen" class="gallery-overlay" @click.self="galleryOpen = false">
      <div class="gallery-panel">
        <header class="gallery-head">
          <span>添加小组件</span>
          <button type="button" class="gallery-close" @click="galleryOpen = false">✕</button>
        </header>
        <ul v-if="home.galleryWidgets.length" class="gallery-list">
          <li v-for="g in home.galleryWidgets" :key="'gal-' + g.key + '-' + g.title">
            <span class="gallery-title">{{ g.title }}</span>
            <span class="gallery-desc" v-html="g.html"></span>
            <button type="button" class="gallery-add" @click="home.add(g.key)">+</button>
          </li>
        </ul>
        <p v-else class="gallery-empty">暂无可添加的小组件类型（请先在插件页启用小组件插件）。</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-view { display: flex; flex-direction: column; gap: 0.6rem; }

/* ---- 编辑态顶部横条 ---- */
.home-edit-bar {
  display: flex; align-items: center; gap: 0.7rem; padding: 0.5rem 0.85rem;
  background: var(--bg-elevated, #fdfdfd); border: 1px dashed var(--accent, #77636c);
  border-radius: var(--radius, 12px); flex-wrap: wrap;
}
.editbar-btn {
  padding: 0.35rem 0.85rem; font-size: 0.85rem; border: 1px solid var(--border, #c9bec3);
  border-radius: var(--radius, 8px); background: transparent; color: var(--text, #3a3436);
  cursor: pointer; white-space: nowrap;
}
.editbar-btn.primary { background: var(--accent, #77636c); border-color: var(--accent, #77636c); color: #fff; font-weight: 600; }
.editbar-btn:disabled { opacity: 0.5; cursor: default; }
.editbar-hint { flex: 1; font-size: 0.78rem; color: var(--text-dim, #8b8490); min-width: 180px; }

/* ---- 画布：绝对定位层 ---- */
.widget-canvas { position: relative; min-height: 200px; overflow: visible; }
.widget-canvas.editing {
  background: repeating-linear-gradient(
    to bottom, rgba(119, 99, 108, 0.05) 0, rgba(119, 99, 108, 0.05) 22px, transparent 22px, transparent 23px
  );
  border: 1px dashed rgba(119, 99, 108, 0.35);
  border-radius: var(--radius, 12px);
}

/* ---- 卡片：苹果玻璃，绝对定位 ---- */
.widget-card {
  position: absolute; box-sizing: border-box; display: flex; flex-direction: column;
  background: rgba(255, 255, 255, 0.32);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: var(--radius, 18px);
  box-shadow: 0 6px 22px rgba(40, 30, 35, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.55);
  overflow: hidden;
}
.widget-card.editing { border: 1.5px dashed rgba(255, 255, 255, 0.9); background: rgba(255, 255, 255, 0.28); cursor: move; user-select: none; }

.widget-card-body {
  flex: 1; min-height: 0; overflow: auto; padding: 0.6rem 0.8rem;
  font-size: 0.9rem; line-height: 1.5; color: var(--text, #3a3436);
}
.widget-card-body :deep(p) { margin: 0.35rem 0; }
.widget-card-body :deep(h1), .widget-card-body :deep(h2), .widget-card-body :deep(h3),
.widget-card-body :deep(h4), .widget-card-body :deep(h5), .widget-card-body :deep(h6) {
  margin: 0.5rem 0 0.25rem; line-height: 1.3; font-weight: 700;
}
.widget-card-body :deep(h1) { font-size: 1.2rem; }
.widget-card-body :deep(h2) { font-size: 1.1rem; }
.widget-card-body :deep(h3) { font-size: 1rem; }
.widget-card-body :deep(h4) { font-size: 0.95rem; }
.widget-card-body :deep(h5), .widget-card-body :deep(h6) { font-size: 0.9rem; }
.widget-card-body :deep(ul), .widget-card-body :deep(ol) { margin: 0.3rem 0; padding-left: 1.2rem; }
.widget-card-body :deep(li) { margin: 0.15rem 0; }
.widget-card-body :deep(blockquote) {
  margin: 0.4rem 0; padding: 0.3rem 0.7rem; border-left: 3px solid var(--accent, #77636c);
  color: var(--text-dim, #8b8490); background: var(--accent-soft, rgba(119, 99, 108, 0.08)); border-radius: 0 6px 6px 0;
}
.widget-card-body :deep(blockquote p) { margin: 0.2rem 0; }
.widget-card-body :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.85em;
  background: rgba(119, 99, 108, 0.12); padding: 0.08em 0.35em; border-radius: 4px;
}
.widget-card-body :deep(pre) {
  margin: 0.4rem 0; padding: 0.5rem 0.7rem; background: rgba(40, 30, 35, 0.85); color: #f0ecee;
  border-radius: 8px; overflow: auto; font-size: 0.82rem;
}
.widget-card-body :deep(pre code) { background: transparent; padding: 0; color: inherit; }
.widget-card-body :deep(hr) { border: none; border-top: 1px solid var(--border, #c9bec3); margin: 0.5rem 0; }
.widget-card-body :deep(a) { color: var(--accent, #4a90e2); text-decoration: none; }
.widget-card-body :deep(a:hover) { text-decoration: underline; }

/* ---- 编辑态控件 ---- */
.wg-btn {
  flex-shrink: 0; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center;
  font-size: 0.95rem; line-height: 1; border: 1px solid var(--accent, #77636c); border-radius: 50%;
  background: var(--accent, #77636c); color: #fff; cursor: pointer;
  transition: transform 0.08s ease, background 0.12s ease;
}
.wg-btn:hover { transform: scale(1.12); }
.wg-remove { background: rgb(214, 78, 96); border-color: rgb(214, 78, 96); }
.wg-remove-float { position: absolute; top: 6px; left: 6px; z-index: 3; }
.wg-size-float { position: absolute; top: 6px; right: 6px; z-index: 3; background: rgba(255,255,255,0.55); border-color: rgba(255,255,255,0.8); color: var(--text, #3a3436); font-size: 0.8rem; font-weight: 600; }

/* 右下角拖拽缩放把手（编辑态；加大命中区 + 显眼背景） */
.wg-resize {
  position: absolute; right: 0; bottom: 0; width: 36px; height: 40px; cursor: nwse-resize;
  touch-action: none; z-index: 6;
  display: flex; align-items: flex-end; justify-content: flex-end;
  border-bottom-right-radius: inherit;
  background: linear-gradient(135deg, transparent 40%, rgba(255, 255, 255, 0.35));
}
.wg-resize::after {
  content: ''; margin: 0 8px 8px 0; width: 12px; height: 12px;
  border-right: 2.5px solid var(--accent, #77636c); border-bottom: 2.5px solid var(--accent, #77636c);
  border-bottom-right-radius: 2px;
}
.wg-resize:hover { background: linear-gradient(135deg, transparent 28%, rgba(119, 99, 108, 0.30)); }

.wt-edit-input {
  display: block; width: 100%; box-sizing: border-box; margin-top: 0.5rem; padding: 0.35rem 0.5rem;
  font: inherit; font-size: 0.85rem; line-height: 1.4; color: var(--text, #3a3436); background: transparent;
  border: 1px dashed var(--accent, #77636c); border-radius: 8px; resize: vertical; outline: none; min-height: 44px;
}
.wt-edit-input:focus { border-style: solid; background: rgba(119, 99, 108, 0.05); }

.muted { color: var(--text-dim, #8b8490); }

.gallery-overlay { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; background: rgba(30, 24, 28, 0.45); }
.gallery-panel { width: min(420px, 88vw); max-height: 72vh; overflow: auto; background: var(--bg-elevated, #fdfdfd); border-radius: var(--radius, 16px); box-shadow: 0 20px 48px rgba(20, 16, 20, 0.35); padding: 0.6rem; }
.gallery-head { display: flex; align-items: center; justify-content: space-between; padding: 0.4rem 0.6rem; font-weight: 650; }
.gallery-close { border: none; background: transparent; color: var(--text-dim, #8b8490); font-size: 1rem; cursor: pointer; }
.gallery-list { list-style: none; margin: 0; padding: 0; }
.gallery-list li { display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 0.6rem; border-radius: 10px; }
.gallery-list li:hover { background: var(--accent-soft, rgba(119, 99, 108, 0.1)); }
.gallery-title { font-weight: 600; font-size: 0.9rem; white-space: nowrap; }
.gallery-desc { flex: 1; font-size: 0.78rem; color: var(--text-dim, #8b8490); overflow: hidden; }
.gallery-desc :deep(p) { margin: 0; }
.gallery-add { flex-shrink: 0; width: 26px; height: 26px; border: none; border-radius: 50%; background: var(--accent, #77636c); color: #fff; font-size: 1rem; line-height: 1; cursor: pointer; }
.gallery-empty { padding: 0.8rem; color: var(--text-dim, #8b8490); font-size: 0.85rem; }
</style>
