/**
 * 小组件面板管理 store —— 主页小组件的「编辑/管理」状态（M10-2/3）。
 *
 * 语义对齐 iPhone 主屏编辑态：主页小组件可经下拉「首页」格的「编辑」进入编辑模式，
 * 在编辑态中移除(−) / 添加(+) / 拖动调整位置与大小 / 编辑文字。这些「用户对面板的
 * 编排」与插件贡献的小组件类型（uiStore.widgets）分离：
 *   - uiStore.widgets  = 插件贡献的「小组件类型库」（可添加的候选）
 *   - 本 store         = 用户在面板上的「实例化编排」（隐藏 / 自由像素布局 / 文字覆盖）
 *
 * 编排全部经 localStorage 持久化（`miko:home-widgets`），刷新/重启保留。插件本身的
 * 装载/移除仍走 plugin-manager（启停即整插件回归），这里只管面板上的显示编排。
 *
 * 布局语义（M10-3）：自由像素拖拽。面板是绝对定位画布，每张卡片有 `{x,y,w,h}`(px)。
 * 编辑态可拖动本体改位置、拖右下角把手改大小；退出编辑态锁定但保持布局显示。
 * 未显式给定布局的卡片自动级联排布（按 order，y 向上递增）。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { UiWidget } from '@miko-launcher/shared'
import { useUiStore } from './ui'

/** 小组件宽度档（插件声明；仅用于未拖拽时的默认尺寸映射） */
type WidgetWidth = 'auto' | 'half' | 'full'

/** 一张卡片的自由像素布局 */
interface WidgetLayout {
  x: number
  y: number
  w: number
  h: number
}

/** 持久化在 localStorage 里的编排状态 */
interface PersistShape {
  /** 被用户从面板隐藏（移除）的小组件 key */
  hidden: string[]
  /** 用户拖拽后的布局：key → {x,y,w,h}(px)（无条目 = 该卡自动级联布局） */
  layouts: Record<string, WidgetLayout>
  /** 用户编辑的文字覆盖：key → 文字（仅支持文字编辑的小组件有效） */
  texts: Record<string, string>
  /** 账号小组件里点选的「当前账号」id（M10-4，供默认账号/高亮用） */
  currentAccount: string | null
}

const LS_KEY = 'miko:home-widgets'
/** 面板画布内边距（px） */
export const CANVAS_PAD = 12
/** 卡片之间的间隙（px） */
export const CANVAS_GAP = 16
/** 未给定布局时的卡片默认尺寸（px） */
export const DEFAULT_WIDGET_H = 132

/** 宽度档 → 默认宽（px，未拖拽时使用） */
function widthToPx(w: WidgetWidth): number {
  switch (w) {
    case 'half':
      return 380
    case 'full':
      return 720
    default:
      return 230
  }
}

function emptyPersist(): PersistShape {
  return { hidden: [], layouts: {}, texts: {}, currentAccount: null }
}

function loadPersist(): PersistShape {
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (!raw) return emptyPersist()
    const p = JSON.parse(raw) as PersistShape
    return {
      hidden: Array.isArray(p.hidden) ? p.hidden : [],
      layouts: p.layouts && typeof p.layouts === 'object' ? p.layouts : {},
      texts: p.texts && typeof p.texts === 'object' ? p.texts : {},
      currentAccount: typeof p.currentAccount === 'string' ? p.currentAccount : null,
    }
  } catch {
    return emptyPersist()
  }
}

/** HTML 转义（把用户文字安全地放进 innerHTML 位置） */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export const useHomeStore = defineStore('home', () => {
  const ui = useUiStore()

  /** 当前是否处于主页小组件「编辑态」 */
  const editing = ref(false)

  /** 被隐藏（移除出面板）的小组件 key */
  const hidden = ref<Set<string>>(new Set(loadPersist().hidden))
  /** 用户拖拽后的布局 */
  const layouts = ref<Record<string, WidgetLayout>>(loadPersist().layouts)
  /** 用户编辑的文字覆盖 */
  const texts = ref<Record<string, string>>(loadPersist().texts)
  /** 账号小组件点选的「当前账号」id（M10-4；决定账号小组件高亮 + 可作为默认账号基础） */
  const currentAccount = ref<string | null>(loadPersist().currentAccount)

  function persist() {
    try {
      const shape: PersistShape = {
        hidden: [...hidden.value],
        layouts: layouts.value,
        texts: texts.value,
        currentAccount: currentAccount.value,
      }
      window.localStorage.setItem(LS_KEY, JSON.stringify(shape))
    } catch {
      /* localStorage 不可用时静默降级为仅内存态 */
    }
  }

  /** 实际渲染在面板上的小组件（剔除 hidden，按 order 排序） */
  const panelWidgets = computed<UiWidget[]>(() =>
    ui.widgets
      .filter((w) => !hidden.value.has(w.key))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.key.localeCompare(b.key)),
  )

  /** 小组件库：被隐藏、可供「+添加小组件」加回面板的候选 */
  const galleryWidgets = computed<UiWidget[]>(() =>
    ui.widgets
      .filter((w) => hidden.value.has(w.key))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.key.localeCompare(b.key)),
  )

  /** 面板上是否还有可添加的小组件（决定「+」是否有内容可加） */
  const hasRemoved = computed(() => galleryWidgets.value.length > 0)

  /**
   * 某卡片最终布局：有用户拖拽记录用记录；否则按面板顺序自动级联排布
   * （x = 左距，y 依前一张底部 + 间隙递增，宽来自 width 档，高为默认）。
   */
  function layoutOf(key: string): WidgetLayout {
    const saved = layouts.value[key]
    if (saved) return saved
    const list = panelWidgets.value
    const idx = list.findIndex((w) => w.key === key)
    const w = widthToPx((list[idx]?.width ?? 'auto') as WidgetWidth)
    let y = CANVAS_PAD
    for (let i = 0; i < idx; i++) {
      const prev = layouts.value[list[i]!.key] ?? {
        x: CANVAS_PAD,
        w: widthToPx((list[i]!.width ?? 'auto') as WidgetWidth),
        h: DEFAULT_WIDGET_H,
        y: CANVAS_PAD,
      }
      y = Math.max(y, prev.y + prev.h + CANVAS_GAP)
    }
    return { x: CANVAS_PAD, y, w, h: DEFAULT_WIDGET_H }
  }

  /** 面板画布总高：最底部卡片的 y+h + 底距；空面板给一个最小高度。 */
  const canvasHeight = computed<number>(() => {
    let maxY = CANVAS_PAD
    for (const w of panelWidgets.value) {
      const l = layoutOf(w.key)
      maxY = Math.max(maxY, l.y + l.h)
    }
    return maxY + CANVAS_PAD
  })

  /** 写入（或清除）一张卡片的布局；传 null 可回到自动级联。 */
  function setLayout(key: string, layout: WidgetLayout | null) {
    if (layout) layouts.value[key] = layout
    else delete layouts.value[key]
    persist()
  }

  /** 进入/退出编辑态 */
  function toggleEditing() {
    editing.value = !editing.value
  }

  /** 退出编辑态 */
  function exitEditing() {
    editing.value = false
  }

  /** 移除（隐藏出面板）一个小组件，并清掉它的布局/文字记录 */
  function remove(key: string) {
    hidden.value.add(key)
    delete layouts.value[key]
    delete texts.value[key]
    persist()
  }

  /** 加回（取消隐藏）一个小组件到面板 */
  function add(key: string) {
    hidden.value.delete(key)
    persist()
  }

  /** 某卡片是否为可编辑文字类型（html 里含 wt-text 插槽） */
  function hasEditableText(key: string): boolean {
    const w = ui.widgets.find((x) => x.key === key)
    return !!w && w.html.includes('class="wt-text"')
  }

  /** 用户编辑过的文字覆盖（无覆盖为 undefined） */
  function textOf(key: string): string | undefined {
    return texts.value[key]
  }

  /** 写入文字覆盖 */
  function setText(key: string, value: string) {
    texts.value[key] = value
    persist()
  }

  /** 设置「当前账号」（账号小组件点选；为 null 取消选中）。 */
  function setCurrentAccount(id: string | null) {
    currentAccount.value = id
    persist()
  }

  /**
   * 渲染一张卡片的主体 html：若有该卡文字覆盖，把 `.wt-text` span 正文替换为覆盖文字。
   * 无覆盖则原样返回插件 html。Escaped，避免用户文字注入 HTML。
   */
  function renderHtml(key: string, html: string): string {
    const t = texts.value[key]
    if (t == null) return html
    const safe = esc(t)
    return html.replace(
      /<span class="wt-text"[^>]*>[\s\S]*?<\/span>/g,
      () => `<span class="wt-text" data-edit-text="">${safe}</span>`,
    )
  }

  return {
    editing,
    panelWidgets,
    galleryWidgets,
    hasRemoved,
    layoutOf,
    canvasHeight,
    setLayout,
    toggleEditing,
    exitEditing,
    remove,
    add,
    hasEditableText,
    textOf,
    setText,
    renderHtml,
    currentAccount,
    setCurrentAccount,
  }
})
