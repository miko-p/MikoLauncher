/**
 * 小组件面板管理 store —— 主页小组件的「编辑/管理」状态（方案 B：相对容器缩放）。
 *
 * 布局模型：每张卡片用**绝对像素坐标** `{x,y,w,h}` 表示，但在一个统一的**设计坐标系**
 * 里（设计画布宽 `DESIGN_W=1100`，左上为原点）。宿主前端渲染时把每张卡片的坐标/尺寸乘以
 * 当前容器宽度相对设计宽的缩放比 `scale = curW / DESIGN_W` —— 于是窗口调整大小时，
 * 所有卡片的位置和大小**按比例整体缩放**：从大到小卡片一起缩小（不溢出）、从小到大
 * 一起放大（不留大空白）。坐标仍是自由像素，操作手感与直觉一致（随便拖、随手拉大小）。
 *
 *   - uiStore.widgets   = 插件贡献的「小组件类型库」（可添加的候选）
 *   - 本 store           = 用户在面板上的「实例化编排」（哪些实例 / 坐标 / 顺序 / 文字覆盖）
 *
 * 支持「同类型多实例」。编排经 localStorage 持久化（`miko:home-widgets`），刷新/重启保留。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { UiWidget } from '@miko-launcher/shared'
import { useUiStore } from './ui'

/** 设计画布宽度（px）：这是卡片坐标存取的基准；渲染时按当前容器宽缩放。 */
export const DESIGN_W = 1100
/** 空白卡片默认宽/高（px，设计坐标） */
export const DEFAULT_W = 260
export const DEFAULT_H = 150
/** 卡片之间默认间隙（px，设计坐标） */
export const GAP = 18
/** 画布内边距（px，设计坐标） */
export const PAD = 16
/** 卡片尺寸下限（px，设计坐标） */
export const MIN_W = 120
export const MIN_H = 80

/** 一张卡片的自由像素布局（设计坐标系） */
export interface WidgetLayout {
  x: number
  y: number
  w: number
  h: number
}

/** 面板上一张卡片的实例（uid 唯一；key 指向插件贡献的类型；layout = 位置大小） */
interface PanelInstance {
  uid: string
  key: string
  title: string
  html: string
  layout: WidgetLayout
}

/** 持久化在 localStorage 里的编排状态 */
interface PersistShape {
  instances: { uid: string; key: string; layout: WidgetLayout }[]
  /** 用户编辑的文字覆盖：uid → 文字（仅支持文字编辑的小组件有效） */
  texts: Record<string, string>
  /** 账号小组件里点选的「当前账号」id（M10-4，供默认账号/高亮用） */
  currentAccount: string | null
}

/** 历史结构（类型去重 / 三档 size / 网格 col-rows / 自由像素），用于迁移 */
interface LegacyShape {
  hidden?: string[]
  layouts?: unknown
  texts?: Record<string, string>
  currentAccount?: string | null
}

const LS_KEY = 'miko:home-widgets'
/** 实例计数器（生成唯一 uid 时用）；当前会话自增，前缀取时间戳避免历史冲突 */
let uidSeq = 0

function nextUid(): string {
  uidSeq += 1
  return `${Date.now().toString(36)}-${uidSeq}`
}

/** 归一化一个布局（必须是完整合法的矩形；缺省回退默认大小、给定位置）。 */
function normLayout(l: unknown, fallbackXY: { x?: number; y?: number } = {}): WidgetLayout {
  if (l && typeof l === 'object') {
    const o = l as WidgetLayout
    const w = typeof o.w === 'number' && o.w > 0 ? o.w : DEFAULT_W
    const h = typeof o.h === 'number' && o.h > 0 ? o.h : DEFAULT_H
    return {
      x: typeof o.x === 'number' ? o.x : (fallbackXY.x ?? 0),
      y: typeof o.y === 'number' ? o.y : (fallbackXY.y ?? 0),
      w: Math.max(MIN_W, w),
      h: Math.max(MIN_H, h),
    }
  }
  return { x: fallbackXY.x ?? 0, y: fallbackXY.y ?? 0, w: DEFAULT_W, h: DEFAULT_H }
}

/** 给一批实例生成默认级联布局（纵向依次排列，超出一行则换行）。 */
function cascadeLayouts(widgets: { uid: string; key: string }[]): WidgetLayout[] {
  const out: WidgetLayout[] = []
  const rowH = DEFAULT_H + GAP
  const colW = DEFAULT_W + GAP
  const maxCol = Math.floor((DESIGN_W - PAD * 2 + GAP) / colW) || 1
  widgets.forEach((_, i) => {
    const col = i % maxCol
    const row = Math.floor(i / maxCol)
    out.push({ x: PAD + col * colW, y: PAD + row * rowH, w: DEFAULT_W, h: DEFAULT_H })
  })
  return out
}

/** 从 localStorage 读取。兼容历史结构迁移到现代（instances + layout）。 */
function loadShape(types: UiWidget[]): {
  instances: { uid: string; key: string; layout: WidgetLayout }[]
  texts: Record<string, string>
  currentAccount: string | null
} {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(LS_KEY)
  } catch {
    /* ignore */
  }
  if (!raw) {
    const defs = cascadeLayouts(types.map((t) => ({ uid: t.key, key: t.key })))
    return {
      instances: types.map((t, i) => ({ uid: t.key, key: t.key, layout: defs[i] })),
      texts: {},
      currentAccount: null,
    }
  }
  try {
    const p = JSON.parse(raw) as PersistShape & LegacyShape
    // 现代结构（含 layout）
    if (Array.isArray(p.instances)) {
      const list = p.instances.filter(
        (i) => i && typeof i.uid === 'string' && typeof i.key === 'string',
      ) as { uid: string; key: string; layout?: unknown }[]
      return {
        instances: list.map((i, idx) => ({
          uid: i.uid,
          key: i.key,
          layout: normLayout(i.layout, { x: PAD + (idx % 4) * (DEFAULT_W + GAP), y: PAD + Math.floor(idx / 4) * (DEFAULT_H + GAP) }),
        })),
        texts: p.texts && typeof p.texts === 'object' ? p.texts : {},
        currentAccount: typeof p.currentAccount === 'string' ? p.currentAccount : null,
      }
    }
    // 旧版（hidden + 各类布局）：面板 = 可用类型剔除 hidden；布局不适用则级联默认
    const hiddenSet = new Set(Array.isArray(p.hidden) ? p.hidden : [])
    const available = types.filter((t) => !hiddenSet.has(t.key))
    const defs = cascadeLayouts(available.map((t) => ({ uid: t.key, key: t.key })))
    const texts = p.texts && typeof p.texts === 'object' ? p.texts : {}
    return {
      instances: available.map((t, i) => ({ uid: t.key, key: t.key, layout: defs[i] })),
      texts,
      currentAccount: typeof p.currentAccount === 'string' ? p.currentAccount : null,
    }
  } catch {
    return { instances: [], texts: {}, currentAccount: null }
  }
}

/** HTML 转义（把用户文字安全地放进 innerHTML 位置） */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;')
}

/** 从插件 html 里取 wt-text 可编辑插槽的默认正文（无用户覆盖时展示用）。 */
function defaultText(html: string): string | undefined {
  const m = html.match(/<span class="wt-text"[^>]*>([\s\S]*?)<\/span>/)
  return m?.[1]
}

/** 行内 Markdown 处理：先 HTML 转义再解析行内语法（代码 / 粗体 / 斜体 / 链接）。 */
function inlineMd(s: string): string {
  const base = esc(s)
  const codes: string[] = []
  let text = base.replace(/`([^`]+)`/g, (_m, c: string) => {
    const tok = `\u0001C${codes.length}\u0001`
    codes.push(c)
    return tok
  })
  text = text.replace(/\*\*([^*]+)\*\*/g, (_m, x: string) => `<strong>${x}</strong>`)
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, (_m, pre, x: string) => `${pre}<em>${x}</em>`)
  text = text.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, t: string, u: string) => {
    const safe = /^(https?:\/\/|\/|#)/.test(u) ? u : '#'
    return `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${t}</a>`
  })
  text = text.replace(/\u0001C(\d+?)\u0001/g, (_m, idx: string) => `<code>${codes[Number(idx)]}</code>`)
  return text
}

/**
 * 极简安全 Markdown → HTML（Obsidian 核心语法子集）：
 * `#`~`######` 标题、围栏代码块、引用、无序/有序列表、分隔线、粗体/斜体/行内代码/链接、段落。
 * 先按行解析块结构（原始前缀，如 `>` `#` `-`），内容经 inlineMd 整体转义，杜绝注入。
 */
function renderMarkdown(md: string): string {
  const lines = md.trim().split('\n')
  const out: string[] = []
  let inCode = false
  let i = 0
  const flush = () => {
    while (out.length && out[out.length - 1] === '') out.pop()
  }
  while (i < lines.length) {
    const raw = lines[i] ?? ''
    if (/^\s*```/.test(raw)) {
      if (inCode) {
        out.push('</code></pre>')
        inCode = false
      } else {
        out.push('<pre><code>')
        inCode = true
      }
      i++
      continue
    }
    if (inCode) {
      out.push(esc(raw))
      i++
      continue
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) {
      flush()
      out.push('<hr>')
      i++
      continue
    }
    const h = raw.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      const n = h[1]!.length
      out.push(`<h${n}>${inlineMd(h[2] ?? '')}</h${n}>`)
      i++
      continue
    }
    if (/^\s*>+\s?/.test(raw)) {
      const q = [raw.replace(/^\s*>+\s?/, '')]
      while (i + 1 < lines.length && /^\s*>+\s?/.test(lines[i + 1]!)) {
        i++
        q.push(lines[i]!.replace(/^\s*>+\s?/, ''))
      }
      out.push('<blockquote>', ...q.map((l) => `<p>${inlineMd(l) || ''}</p>`), '</blockquote>')
      i++
      continue
    }
    const ul = raw.match(/^\s*[-*+]\s+(.*)$/)
    if (ul) {
      const items = [ul[1]!]
      while (i + 1 < lines.length && /^\s*[-*+]\s+/.test(lines[i + 1]!)) {
        i++
        items.push(lines[i]!.replace(/^\s*[-*+]\s+/, ''))
      }
      out.push('<ul>' + items.map((it) => `<li>${inlineMd(it)}</li>`).join('') + '</ul>')
      i++
      continue
    }
    const ol = raw.match(/^\s*\d+\.\s+(.*)$/)
    if (ol) {
      const items = [ol[1]!]
      while (i + 1 < lines.length && /^\s*\d+\.\s+/.test(lines[i + 1]!)) {
        i++
        items.push(lines[i]!.replace(/^\s*\d+\.\s+/, ''))
      }
      out.push('<ol>' + items.map((it) => `<li>${inlineMd(it)}</li>`).join('') + '</ol>')
      i++
      continue
    }
    if (raw.trim() === '') {
      flush()
      out.push('')
      i++
      continue
    }
    out.push(`<p>${inlineMd(raw.trim())}</p>`)
    i++
  }
  if (inCode) out.push('</code></pre>')
  flush()
  return out.join('\n')
}

export const useHomeStore = defineStore('home', () => {
  const ui = useUiStore()

  /** 当前是否处于主页小组件「编辑态」 */
  const editing = ref(false)

  /** 面板实例引用（有序；持久化 uid+key+layout）；渲染时回填 title/html */
  const instances = ref<{ uid: string; key: string; layout: WidgetLayout }[]>([])
  /** 用户编辑的文字覆盖（uid → 文字） */
  const texts = ref<Record<string, string>>({})
  /** 账号小组件点选的「当前账号」id（M10-4） */
  const currentAccount = ref<string | null>(null)

  function hydrate(uid: string, key: string, layout: WidgetLayout): PanelInstance | null {
    const t = ui.widgets.find((x) => x.key === key)
    if (!t) return null
    return { uid, key, title: t.title, html: t.html, layout }
  }

  function init() {
    const shape = loadShape(ui.widgets)
    instances.value = shape.instances
    texts.value = shape.texts
    currentAccount.value = shape.currentAccount
  }
  init()

  function persist() {
    try {
      const shape: PersistShape = {
        instances: instances.value,
        texts: texts.value,
        currentAccount: currentAccount.value,
      }
      window.localStorage.setItem(LS_KEY, JSON.stringify(shape))
    } catch {
      /* localStorage 不可用时静默降级为仅内存态 */
    }
  }

  /** 实际渲染在面板上的小组件实例（孤立类型自动剔除） */
  const panelWidgets = computed<PanelInstance[]>(() =>
    instances.value
      .map((r) => hydrate(r.uid, r.key, r.layout))
      .filter((w): w is PanelInstance => w !== null),
  )

  /** 小组件库：所有可添加的类型（支持同类型添加多份） */
  const galleryWidgets = computed<UiWidget[]>(() => ui.widgets)

  /** 是否还有可添加的小组件类型（决定「+」是否可用） */
  const hasRemoved = computed(() => ui.widgets.length > 0)

  /** 面板画布总高（设计坐标）：最底部卡片的 y+h + 底距。 */
  const canvasHeight = computed<number>(() => {
    let maxY = PAD
    for (const w of panelWidgets.value) maxY = Math.max(maxY, w.layout.y + w.layout.h)
    return maxY + PAD
  })

  function toggleEditing() {
    editing.value = !editing.value
  }

  function exitEditing() {
    editing.value = false
  }

  /** 按类型 key 添加一个新实例（同类型可添加多份）；自动放在面板底部空位。 */
  function add(key: string): string {
    const uid = nextUid()
    let top = PAD
    for (const w of panelWidgets.value) top = Math.max(top, w.layout.y + w.layout.h + GAP)
    instances.value.push({ uid, key, layout: { x: PAD, y: top, w: DEFAULT_W, h: DEFAULT_H } })
    persist()
    return uid
  }

  /** 移除（删除）一个实例，并清掉它的文字记录。 */
  function remove(uid: string) {
    instances.value = instances.value.filter((r) => r.uid !== uid)
    delete texts.value[uid]
    persist()
  }

  /** 写入某实例的布局（拖动移动/缩放）。 */
  function setLayout(uid: string, layout: WidgetLayout) {
    const it = instances.value.find((r) => r.uid === uid)
    if (!it) return
    it.layout = { ...layout }
    persist()
  }

  /** 上移/下移某实例（改变面板顺序：仅调整数组顺序，不影响坐标）。 */
  function move(uid: string, dir: -1 | 1) {
    const idx = instances.value.findIndex((r) => r.uid === uid)
    if (idx < 0) return
    const target = idx + dir
    if (target < 0 || target >= instances.value.length) return
    const arr = instances.value.slice()
    ;[arr[idx], arr[target]] = [arr[target], arr[idx]]
    instances.value = arr
    persist()
  }

  /** 某卡片是否为可编辑文字类型（其实例 html 含 wt-text 插槽） */
  function hasEditableText(uid: string): boolean {
    const w = panelWidgets.value.find((x) => x.uid === uid)
    return !!w && w.html.includes('class="wt-text"')
  }

  function textOf(uid: string): string | undefined {
    return texts.value[uid]
  }

  function setText(uid: string, value: string) {
    texts.value[uid] = value
    persist()
  }

  /** 设置「当前账号」（账号小组件点选；为 null 取消选中）。 */
  function setCurrentAccount(id: string | null) {
    currentAccount.value = id
    persist()
  }

  /** 重置面板为默认（等价于全新用户首次打开）：每个可用类型级联摆放、清空文字/当前账号。 */
  function resetLayout() {
    const avail = ui.widgets.map((t) => ({ uid: t.key, key: t.key }))
    const defs = cascadeLayouts(avail)
    instances.value = avail.map((t, i) => ({ uid: t.uid, key: t.key, layout: defs[i] }))
    texts.value = {}
    currentAccount.value = null
    persist()
  }

  /** 渲染某实例卡片的主体 html（文字小组件走 Markdown），覆盖文字优先、否则默认正文。 */
  function renderHtml(uid: string): string {
    const w = panelWidgets.value.find((x) => x.uid === uid)
    if (!w) return ''
    const t = texts.value[uid]
    const isText = w.html.includes('class="wt-text"')
    if (isText) {
      const src = t != null ? t : (defaultText(w.html) ?? '')
      const rendered = renderMarkdown(src)
      return w.html.replace(/<span class="wt-text"[^>]*>[\s\S]*?<\/span>/g, () => `<span class="wt-text">${rendered}</span>`)
    }
    if (t == null) return w.html
    const safe = esc(t)
    return w.html.replace(/<span class="wt-text"[^>]*>[\s\S]*?<\/span>/g, () => `<span class="wt-text" data-edit-text="">${safe}</span>`)
  }

  function htmlOf(uid: string): string {
    return panelWidgets.value.find((x) => x.uid === uid)?.html ?? ''
  }

  return {
    editing,
    panelWidgets,
    galleryWidgets,
    hasRemoved,
    canvasHeight,
    toggleEditing,
    exitEditing,
    remove,
    add,
    setLayout,
    move,
    hasEditableText,
    textOf,
    setText,
    renderHtml,
    htmlOf,
    currentAccount,
    setCurrentAccount,
    resetLayout,
  }
})
