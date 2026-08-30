<script setup lang="ts">
/**
 * ThemeWidget —— 主页「主题颜色」小组件内容组件。
 *
 * Adobe Color 风格：几个圆形色块，点击某个 → 通过覆盖 :root CSS 变量把整个应用主题
 * （背景 --bg、包裹边框/头栏 --shell-bg/--header-bg、强调 --accent、文字等）切换为对应
 * 一套配色。仅作用于主题视觉，不影响布局与功能。
 *
 * 选择经 localStorage 持久化（`miko:theme-color`），主页加载时自动恢复。
 *
 * 由插件 `widget-theme` 贡献外壳（key='widget-theme'），宿主前端 HomeView 对 key 特判
 * 渲染本组件（同 widget-account 模式）。
 */
import { ref } from 'vue'

const LS_KEY = 'miko:theme-color'

/** 一套配色的 CSS 变量（覆盖 :root 同名变量即可换肤） */
interface Palette {
  name: string
  /** 色块主色（Adobe 圆的渐变主色） */
  main: string
  bg: string
  border: string
  shell: string
  accent: string
  accentSoft: string
  headerText: string
}

/** 预设配色（Adobe Color 环状取点般的几组） */
const PALETTES: Palette[] = [
  { name: '紫罗兰', main: '#77636c', bg: '#c9bdc5', border: '#dcd1d7', shell: '#77636c', accent: '#77636c', accentSoft: 'rgba(119,99,108,0.14)', headerText: '#f5f1f3' },
  { name: '湖蓝', main: '#3d6fb4', bg: '#bccde5', border: '#ccd8ea', shell: '#3d6fb4', accent: '#3d6fb4', accentSoft: 'rgba(61,111,180,0.14)', headerText: '#eef3fb' },
  { name: '森林绿', main: '#3a8f6b', bg: '#b9d8c8', border: '#c8e0d3', shell: '#3a8f6b', accent: '#3a8f6b', accentSoft: 'rgba(58,143,107,0.14)', headerText: '#eefaf3' },
  { name: '珊瑚橙', main: '#c05a3f', bg: '#eccfc3', border: '#ecd8cd', shell: '#c05a3f', accent: '#c05a3f', accentSoft: 'rgba(192,90,63,0.14)', headerText: '#fdf2ec' },
  { name: '莓粉', main: '#c0487a', bg: '#e9c5d2', border: '#ecd0db', shell: '#c0487a', accent: '#c0487a', accentSoft: 'rgba(192,72,122,0.14)', headerText: '#fceef4' },
  { name: '墨灰', main: '#3a3a44', bg: '#c6c6cd', border: '#d2d2d7', shell: '#2e2e34', accent: '#6b6b78', accentSoft: 'rgba(107,107,120,0.16)', headerText: '#f5f5f8' },
]

const activeIdx = ref(-1)

function applyPalette(p: Palette, idx: number, persist = true) {
  const root = document.documentElement
  root.style.setProperty('--bg', p.bg)
  root.style.setProperty('--border', p.border)
  root.style.setProperty('--shell-bg', p.shell)
  root.style.setProperty('--header-bg', p.shell)
  root.style.setProperty('--accent', p.accent)
  root.style.setProperty('--accent-soft', p.accentSoft)
  root.style.setProperty('--header-text', p.headerText)
  activeIdx.value = idx
  if (persist) {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(p))
    } catch {
      /* ignore */
    }
  }
}

/** 恢复上次选择的配色（主页加载时）。 */
function restore() {
  let saved: Palette | null = null
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (raw) saved = JSON.parse(raw) as Palette
  } catch {
    /* ignore */
  }
  if (saved && saved.name && saved.main) {
    const idx = PALETTES.findIndex((p) => p.name === saved!.name)
    applyPalette({ ...PALETTES[idx], ...saved }, idx, false)
    return
  }
  // 无选择：标记当前生效主题为默认（紫罗兰），不覆盖（沿用 builtin/demo-theme）
  activeIdx.value = -1
}
restore()
</script>

<template>
  <div class="theme-widget">
    <p class="theme-label">主题颜色</p>
    <div class="theme-swatches">
      <button
        v-for="(p, i) in PALETTES"
        :key="p.name"
        class="theme-dot"
        :class="{ active: activeIdx === i }"
        :style="{ background: `radial-gradient(circle at 32% 30%, #ffffffcc, ${p.main})` }"
        :title="`切换「${p.name}」主题`"
        @click="applyPalette(p, i)"
      ></button>
    </div>
  </div>
</template>

<style scoped>
.theme-widget { display: flex; flex-direction: column; gap: 0.4rem; }
.theme-label {
  margin: 0;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-dim, #8b8490);
}
.theme-swatches { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }
.theme-dot {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.75);
  box-shadow: 0 2px 8px rgba(30, 20, 25, 0.20);
  cursor: pointer;
  padding: 0;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
.theme-dot:hover { transform: scale(1.12); }
.theme-dot.active {
  box-shadow: 0 0 0 3px var(--text, #3a3436), 0 3px 10px rgba(30, 20, 25, 0.28);
  transform: scale(1.08);
}
</style>
