<script setup lang="ts">
/**
 * HomeView —— 首页：小组件面板（M10-1 渲染 + M10-2 编辑管理 + M10-3 自由像素拖拽）。
 *
 * 小组件面板只挂在首页路由：多个 Phase 0 小组件插件贡献的类型（uiStore.widgets）经
 * homeStore 编排成面板上的实例（隐藏哪些 / 自由像素布局 / 文字覆盖），持久化到 localStorage。
 *
 * 编辑态（iPhone 主屏编辑语义）经下拉「首页」格的「编辑」进入（App.vue 切 home.editing）：
 *   - 面板为绝对定位画布：拖动卡片本体改位置（move），拖右下角把手改大小（resize）
 *   - 卡片左上角「−」移除、可编辑文字的小组件显示文字输入框
 *   - 顶部横条：「添加小组件 +」打开小组件库弹层、「完成」退出编辑态
 * 非编辑态卡片锁定但仍按布局绝对定位显示。
 */
import { onMounted, ref, watch } from 'vue'
import { useUiStore } from '../stores/ui'
import { useHomeStore, CANVAS_PAD } from '../stores/home'
import AccountWidget from '../components/AccountWidget.vue'

const uiStore = useUiStore()
const home = useHomeStore()

/** 小组件库弹层是否打开 */
const galleryOpen = ref(false)

/** 拖拽中的状态（mode=移动 / 调整大小，start=起始布局，sx/sy=指针起点） */
const drag = ref<
  | { mode: 'move' | 'resize'; key: string; start: { x: number; y: number; w: number; h: number }; sx: number; sy: number }
  | null
>(null)

const MIN_W = 170
const MIN_H = 86

onMounted(() => {
  if (!uiStore.manifest) uiStore.refresh()
})

// 进入编辑态时，为可编辑文字的小组件预填插件默认文字（此前未编辑过的），
// 让输入框直接显示内容、可实时改。
watch(
  () => home.editing,
  (editing) => {
    if (!editing) return
    for (const w of home.panelWidgets) {
      if (!home.hasEditableText(w.key)) continue
      if (home.textOf(w.key) != null) continue
      const m = w.html.match(/<span class="wt-text"[^>]*>([\s\S]*?)<\/span>/)
      if (m) home.setText(w.key, m[1] ?? '')
    }
  },
)

/** 从插件默认文字（无覆盖时）取当前显示文字，用于非编辑态与输入框展示 */
function displayText(w: { key: string; html: string }): string {
  const t = home.textOf(w.key)
  if (t != null) return t
  const m = w.html.match(/<span class="wt-text"[^>]*>([\s\S]*?)<\/span>/)
  return m?.[1] ?? ''
}

/** 卡片指针按下：编辑态下开始 move / resize 拖拽。 */
function onCardPointerDown(
  w: { key: string },
  e: PointerEvent,
) {
  if (!home.editing) return
  const target = e.target as HTMLElement
  // 命中按钮 / 文字输入框 / 弹层时不进入拖拽
  if (target.closest('.wg-btn, .wt-edit-input, .gallery-overlay, .gallery-panel')) return
  const isResize = !!target.closest('.wg-resize')
  const start = home.layoutOf(w.key)
  drag.value = {
    mode: isResize ? 'resize' : 'move',
    key: w.key,
    start: { ...start },
    sx: e.clientX,
    sy: e.clientY,
  }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
}

/** 拖拽中：根据指针位移更新布局（move 位移左上角；resize 改宽高，双下限约束）。 */
function onDragMove(e: PointerEvent) {
  const d = drag.value
  if (!d) return
  const dx = e.clientX - d.sx
  const dy = e.clientY - d.sy
  if (d.mode === 'move') {
    home.setLayout(d.key, {
      x: Math.max(CANVAS_PAD, d.start.x + dx),
      y: Math.max(CANVAS_PAD, d.start.y + dy),
      w: d.start.w,
      h: d.start.h,
    })
  } else {
    home.setLayout(d.key, {
      x: d.start.x,
      y: d.start.y,
      w: Math.max(MIN_W, d.start.w + dx),
      h: Math.max(MIN_H, d.start.h + dy),
    })
  }
}

/** 拖拽结束：移除全局监听。 */
function onDragEnd() {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  drag.value = null
}
</script>

<template>
  <section class="home-view">
    <!-- 顶部：编辑态横条（仅编辑态显示） -->
    <div v-if="home.editing" class="home-edit-bar">
      <button
        type="button"
        class="editbar-btn primary"
        :disabled="!home.hasRemoved"
        @click="galleryOpen = true"
      >
        添加小组件 +
      </button>
      <span class="editbar-hint">拖动卡片换位置 · 拖右下角改大小 · 「−」移除</span>
      <button type="button" class="editbar-btn" @click="home.exitEditing(); galleryOpen = false">
        完成
      </button>
    </div>

    <!-- 小组件画布：绝对定位层，高随布局内容自适应 -->
    <div
      v-if="home.panelWidgets.length"
      class="widget-canvas"
      :class="{ editing: home.editing }"
      :style="{ height: home.canvasHeight + 'px' }"
    >
      <article
        v-for="w in home.panelWidgets"
        :key="'wg-' + w.key"
        class="widget-card"
        :class="{ editing: home.editing, dragging: !!(drag && drag.key === w.key) }"
        :style="{
          left: home.layoutOf(w.key).x + 'px',
          top: home.layoutOf(w.key).y + 'px',
          width: home.layoutOf(w.key).w + 'px',
          height: home.layoutOf(w.key).h + 'px',
        }"
        @pointerdown="onCardPointerDown(w, $event)"
      >
        <header class="widget-card-head">
          <span class="widget-title">{{ w.title }}</span>

          <!-- 编辑态：左上角「−」移除按钮 -->
          <button
            v-if="home.editing"
            type="button"
            class="wg-btn wg-remove"
            :title="`移除「${w.title}」`"
            @click="home.remove(w.key)"
          >−</button>
        </header>

        <div class="widget-card-body">
          <!-- M10-4：账号小组件是动态数据 + 需交互点选的卡片，特判渲染组件而非 v-html -->
          <AccountWidget v-if="w.key === 'widget-account'" />
          <!-- 其余小组件按插件贡献 html 渲染（含 wt-text 文字覆盖） -->
          <div v-else v-html="home.renderHtml(w.key, w.html)"></div>

          <!-- 编辑态：可编辑文字的小组件 → 文字输入框 -->
          <textarea
            v-if="home.editing && home.hasEditableText(w.key)"
            class="wt-edit-input"
            :value="displayText(w)"
            placeholder="输入文字…"
            @input="home.setText(w.key, ($event.target as HTMLTextAreaElement).value)"
          ></textarea>
        </div>

        <!-- 编辑态：右下角调大小把手 -->
        <div v-if="home.editing" class="wg-resize" title="拖动改变大小"></div>
      </article>
    </div>

    <p v-else class="muted">（主页暂无小组件。可到插件页启用小组件插件后回到这里。）</p>

    <!-- 首页说明 -->
    <div class="home-intro">
      <h1>MikoLauncher</h1>
      <p>在顶部 MikoLauncher 下拉的「编辑」可调整主页小组件的位置、大小与文字。</p>
      <p class="badge">面板小组件由 Phase 0 插件贡献 · 当前 {{ home.panelWidgets.length }} 个在面板</p>
    </div>

    <!-- 小组件库弹层：编辑态点「+」打开，列出被隐藏（可加回）的小组件 -->
    <div v-if="galleryOpen" class="gallery-overlay" @click.self="galleryOpen = false">
      <div class="gallery-panel">
        <header class="gallery-head">
          <span>添加小组件</span>
          <button type="button" class="gallery-close" @click="galleryOpen = false">✕</button>
        </header>
        <ul v-if="home.galleryWidgets.length" class="gallery-list">
          <li v-for="g in home.galleryWidgets" :key="'gal-' + g.key">
            <span class="gallery-title">{{ g.title }}</span>
            <span class="gallery-desc" v-html="g.html"></span>
            <button type="button" class="gallery-add" @click="home.add(g.key)">+</button>
          </li>
        </ul>
        <p v-else class="gallery-empty">面板上已展示全部小组件，无更多可添加。</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-view {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

/* ---- 编辑态顶部横条 ---- */
.home-edit-bar {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.5rem 0.85rem;
  background: var(--bg-elevated, #fdfdfd);
  border: 1px dashed var(--accent, #77636c);
  border-radius: var(--radius, 12px);
}
.editbar-btn {
  padding: 0.35rem 0.85rem;
  font-size: 0.85rem;
  border: 1px solid var(--border, #c9bec3);
  border-radius: var(--radius, 8px);
  background: transparent;
  color: var(--text, #3a3436);
  cursor: pointer;
  white-space: nowrap;
}
.editbar-btn.primary {
  background: var(--accent, #77636c);
  border-color: var(--accent, #77636c);
  color: #fff;
  font-weight: 600;
}
.editbar-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.editbar-hint {
  flex: 1;
  font-size: 0.78rem;
  color: var(--text-dim, #8b8490);
}

/* ---- 小组件画布：绝对定位层（自由像素布局） ---- */
.widget-canvas {
  position: relative;
  min-height: 60vh; /* 空画布也给可拖拽的编辑区域 */
  transition: height 0.12s ease;
}
/* 编辑态画布给一个淡底提示可拖区域 */
.widget-canvas.editing {
  background: repeating-linear-gradient(
    to bottom,
    rgba(119, 99, 108, 0.04) 0,
    rgba(119, 99, 108, 0.04) 23px,
    transparent 23px,
    transparent 24px
  );
  border: 1px dashed rgba(119, 99, 108, 0.35);
  border-radius: var(--radius, 12px);
}

.widget-card {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: var(--bg-elevated, #fdfdfd);
  border: 1px solid var(--border, #d8cdd2);
  border-radius: var(--radius, 12px);
  box-shadow: 0 1px 3px rgba(40, 30, 35, 0.06);
  overflow: hidden;
  transition: border-color 0.15s ease;
}
.widget-card.editing {
  border: 1.5px dashed var(--accent, #77636c);
  cursor: move;
  user-select: none;
}
.widget-card.editing.dragging {
  box-shadow: 0 12px 28px rgba(40, 30, 35, 0.22);
  opacity: 0.9;
}
/* 非编辑态锁定（不捕捉拖拽光标） */
.widget-card:not(.editing) {
  cursor: default;
}

.widget-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  padding: 0.45rem 0.8rem;
  font-size: 0.85rem;
  font-weight: 650;
  color: var(--text-dim, #8b8490);
  border-bottom: 1px solid var(--border, #e6dde0);
  flex-shrink: 0;
}
.widget-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.widget-card-body {
  flex: 1;
  overflow: auto;
  padding: 0.55rem 0.8rem;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--text, #3a3436);
}
.widget-card-body :deep(p) { margin: 0.25rem 0; }

/* ---- 编辑态控件 ---- */
.wg-btn {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
  line-height: 1;
  border: 1px solid var(--accent, #77636c);
  border-radius: 50%;
  background: var(--accent, #77636c);
  color: #fff;
  cursor: pointer;
  transition: transform 0.08s ease, background 0.12s ease;
}
.wg-btn:hover { transform: scale(1.12); }
.wg-remove { background: rgb(214, 78, 96); border-color: rgb(214, 78, 96); }

/* 右下角调大小把手（拖这个改宽高） */
.wg-resize {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 20px;
  height: 20px;
  cursor: nwse-resize;
  touch-action: none;
}
.wg-resize::after {
  content: '';
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 9px;
  height: 9px;
  border-right: 2px solid var(--accent, #77636c);
  border-bottom: 2px solid var(--accent, #77636c);
  border-bottom-right-radius: 2px;
}

/* 文字编辑输入框（编辑态下可编辑文字的小组件） */
.wt-edit-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin-top: 0.5rem;
  padding: 0.35rem 0.5rem;
  font: inherit;
  font-size: 0.85rem;
  line-height: 1.4;
  color: var(--text, #3a3436);
  background: transparent;
  border: 1px dashed var(--accent, #77636c);
  border-radius: 8px;
  resize: vertical;
  outline: none;
  min-height: 44px;
}
.wt-edit-input:focus {
  border-style: solid;
  background: rgba(119, 99, 108, 0.05);
}

/* ---- 首页说明 ---- */
.home-intro h1 { margin: 0.4rem 0 0.2rem; font-size: 1.4rem; }
.home-intro p { margin: 0.25rem 0; color: var(--text, #3a3436); }
.muted { color: var(--text-dim, #8b8490); }
.badge {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  background: var(--accent-soft, rgba(119, 99, 108, 0.14));
  color: var(--accent, #77636c);
  font-size: 0.8rem;
}

/* ---- 小组件库弹层 ---- */
.gallery-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(30, 24, 28, 0.45);
}
.gallery-panel {
  width: min(420px, 88vw);
  max-height: 72vh;
  overflow: auto;
  background: var(--bg-elevated, #fdfdfd);
  border-radius: var(--radius, 16px);
  box-shadow: 0 20px 48px rgba(20, 16, 20, 0.35);
  padding: 0.6rem;
}
.gallery-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.4rem 0.6rem;
  font-weight: 650;
}
.gallery-close {
  border: none;
  background: transparent;
  color: var(--text-dim, #8b8490);
  font-size: 1rem;
  cursor: pointer;
}
.gallery-list { list-style: none; margin: 0; padding: 0; }
.gallery-list li {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.6rem;
  border-radius: 10px;
}
.gallery-list li:hover { background: var(--accent-soft, rgba(119, 99, 108, 0.1)); }
.gallery-title { font-weight: 600; font-size: 0.9rem; white-space: nowrap; }
.gallery-desc { flex: 1; font-size: 0.78rem; color: var(--text-dim, #8b8490); overflow: hidden; }
.gallery-desc :deep(p) { margin: 0; }
.gallery-add {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 50%;
  background: var(--accent, #77636c);
  color: #fff;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
}
.gallery-empty { padding: 0.8rem; color: var(--text-dim, #8b8490); font-size: 0.85rem; }
</style>
