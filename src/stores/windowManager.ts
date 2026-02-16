import { reactive } from 'vue'

export type ToolWindowKind = 'patchbay' | 'devices' | 'graph' | 'portability' | 'admin'
export type ChildWindowKind =
  | 'device-detail'
  | 'devices-add-edit'
  | 'patchbay-point-detail'
  | 'patchbay-link-search'
  | 'patchbay-overwrite-confirm'
  | 'graph-add-node'
  | 'graph-connect-node'
  | 'portability-replace-confirm'
  | 'devices-delete-confirm'
export type WindowKind = ToolWindowKind | ChildWindowKind
export type WindowState = 'normal' | 'minimized' | 'maximized'

export interface WindowRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ManagedWindow {
  id: string
  kind: WindowKind
  title: string
  parentId: string | null
  state: WindowState
  rect: WindowRect
  previousRect: WindowRect | null
  zIndex: number
  createdAt: number
  updatedAt: number
  payload: Record<string, unknown>
}

interface PersistedLayout {
  windows: Array<{
    id: string
    kind: WindowKind
    title: string
    parentId: string | null
    state: WindowState
    rect: WindowRect
    previousRect: WindowRect | null
    payload: Record<string, unknown>
    createdAt: number
    updatedAt: number
  }>
}

const STORAGE_PREFIX = 'pepper.windowLayout.v2'
const MIN_WIDTH = 300
const MIN_HEIGHT = 180
const MAX_DEVICE_DETAIL_WINDOWS = 3
const CHILD_KIND_LIMIT = 3
const NON_RESTORABLE_CHILD_KINDS = new Set<ChildWindowKind>([
  'devices-add-edit',
  'devices-delete-confirm',
  'patchbay-link-search',
  'patchbay-overwrite-confirm',
  'graph-add-node',
  'graph-connect-node',
  'portability-replace-confirm',
])

interface OpenChildWindowOptions {
  id?: string
  forceUnique?: boolean
}

const TOOL_DEFAULT_RECTS: Record<ToolWindowKind, WindowRect> = {
  patchbay: { x: 40, y: 24, width: 980, height: 700 },
  devices: { x: 120, y: 60, width: 980, height: 640 },
  graph: { x: 220, y: 86, width: 980, height: 680 },
  portability: { x: 140, y: 54, width: 1060, height: 700 },
  admin: { x: 180, y: 40, width: 980, height: 700 },
}

function cloneRect(rect: WindowRect): WindowRect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

function clampRect(rect: WindowRect, viewportWidth: number, viewportHeight: number): WindowRect {
  const width = Math.min(Math.max(rect.width, MIN_WIDTH), Math.max(MIN_WIDTH, viewportWidth - 16))
  const height = Math.min(Math.max(rect.height, MIN_HEIGHT), Math.max(MIN_HEIGHT, viewportHeight - 16))
  const x = Math.max(8, Math.min(rect.x, Math.max(8, viewportWidth - width - 8)))
  const y = Math.max(8, Math.min(rect.y, Math.max(8, viewportHeight - height - 8)))
  return { x, y, width, height }
}

function safePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export const windowManager = reactive({
  windows: [] as ManagedWindow[],
  nextZIndex: 1500,
  viewport: {
    width: 1440,
    height: 900,
  },
  storageScope: 'anonymous',
  hydrated: false,

  get storageKey() {
    return `${STORAGE_PREFIX}:${this.storageScope}`
  },

  setScope(scope: string) {
    const normalized = scope || 'anonymous'
    if (this.storageScope === normalized && this.hydrated) return
    this.storageScope = normalized
    this.hydrate()
  },

  setViewport(width: number, height: number) {
    this.viewport.width = Math.max(width, 480)
    this.viewport.height = Math.max(height, 320)
    this.windows = this.windows.map((window) => {
      if (window.state === 'maximized') return window
      return { ...window, rect: clampRect(window.rect, this.viewport.width, this.viewport.height) }
    })
  },

  getWindow(windowId: string) {
    return this.windows.find((window) => window.id === windowId) || null
  },

  getToolWindow(kind: ToolWindowKind) {
    return this.windows.find((window) => window.kind === kind) || null
  },

  openTool(kind: ToolWindowKind, title: string) {
    const existing = this.getToolWindow(kind)
    if (existing) {
      this.restoreWindow(existing.id)
      this.focusWindow(existing.id)
      return existing
    }

    const defaultRect = clampRect(TOOL_DEFAULT_RECTS[kind], this.viewport.width, this.viewport.height)
    const window: ManagedWindow = {
      id: `tool:${kind}`,
      kind,
      title,
      parentId: null,
      state: 'normal',
      rect: defaultRect,
      previousRect: null,
      zIndex: this.nextZIndex++,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      payload: {},
    }
    this.windows.push(window)
    this.persist()
    return window
  },

  openDeviceDetail(deviceId: number, title: string, parentId: string | null) {
    const id = `device-detail:${deviceId}`
    const existing = this.getWindow(id)
    if (existing) {
      existing.title = title
      this.restoreWindow(existing.id)
      this.focusWindow(existing.id)
      this.persist()
      return existing
    }

    const detailWindows = this.windows
      .filter((window) => window.kind === 'device-detail')
      .sort((a, b) => a.updatedAt - b.updatedAt)
    if (detailWindows.length >= MAX_DEVICE_DETAIL_WINDOWS) {
      this.closeWindow(detailWindows[0].id)
    }

    const offset = this.windows.filter((window) => window.kind === 'device-detail').length
    const baseRect: WindowRect = {
      x: 280 + (offset % 3) * 36,
      y: 96 + (offset % 3) * 26,
      width: 520,
      height: 520,
    }
    const window: ManagedWindow = {
      id,
      kind: 'device-detail',
      title,
      parentId,
      state: 'normal',
      rect: clampRect(baseRect, this.viewport.width, this.viewport.height),
      previousRect: null,
      zIndex: this.nextZIndex++,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      payload: { deviceId },
    }
    this.windows.push(window)
    this.persist()
    return window
  },

  openChildWindow(
    parentId: string,
    kind: ChildWindowKind,
    title: string,
    payload: Record<string, unknown>,
    options?: OpenChildWindowOptions,
  ) {
    const baseId = options?.id || `${kind}:${Date.now()}`
    const id = options?.forceUnique ? `${baseId}:${Math.random().toString(16).slice(2, 8)}` : baseId

    if (!options?.forceUnique) {
      const existing = this.getWindow(id)
      if (existing) {
        existing.title = title
        existing.payload = payload
        existing.parentId = parentId
        this.restoreWindow(existing.id)
        this.focusWindow(existing.id)
        this.persist()
        return existing
      }
    }

    const siblings = this.windows
      .filter((window) => window.parentId === parentId && window.kind === kind)
      .sort((a, b) => a.updatedAt - b.updatedAt)
    if (siblings.length >= CHILD_KIND_LIMIT) {
      this.closeWindow(siblings[0].id)
    }

    const offset = siblings.length
    const baseRect: WindowRect = {
      x: 240 + (offset % 3) * 30,
      y: 70 + (offset % 3) * 22,
      width: 560,
      height: 520,
    }

    const window: ManagedWindow = {
      id,
      kind,
      title,
      parentId,
      state: 'normal',
      rect: clampRect(baseRect, this.viewport.width, this.viewport.height),
      previousRect: null,
      zIndex: this.nextZIndex++,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      payload: safePayload(payload),
    }
    this.windows.push(window)
    this.persist()
    return window
  },

  focusWindow(windowId: string) {
    const window = this.getWindow(windowId)
    if (!window) return
    window.zIndex = this.nextZIndex++
    window.updatedAt = Date.now()
    this.persist()
  },

  moveWindow(windowId: string, x: number, y: number) {
    const window = this.getWindow(windowId)
    if (!window || window.state === 'maximized') return
    window.rect = clampRect({ ...window.rect, x, y }, this.viewport.width, this.viewport.height)
    window.updatedAt = Date.now()
    this.persist()
  },

  resizeWindow(windowId: string, rect: WindowRect) {
    const window = this.getWindow(windowId)
    if (!window || window.state === 'maximized') return
    window.rect = clampRect(rect, this.viewport.width, this.viewport.height)
    window.updatedAt = Date.now()
    this.persist()
  },

  minimizeWindow(windowId: string) {
    const window = this.getWindow(windowId)
    if (!window) return
    window.state = 'minimized'
    window.updatedAt = Date.now()
    this.persist()
  },

  maximizeWindow(windowId: string) {
    const window = this.getWindow(windowId)
    if (!window) return
    if (window.state !== 'maximized') {
      window.previousRect = cloneRect(window.rect)
      window.state = 'maximized'
    } else {
      window.state = 'normal'
      if (window.previousRect) {
        window.rect = clampRect(window.previousRect, this.viewport.width, this.viewport.height)
      }
      window.previousRect = null
    }
    window.updatedAt = Date.now()
    this.focusWindow(windowId)
    this.persist()
  },

  restoreWindow(windowId: string) {
    const window = this.getWindow(windowId)
    if (!window) return
    if (window.state === 'maximized') {
      window.state = 'normal'
      if (window.previousRect) {
        window.rect = clampRect(window.previousRect, this.viewport.width, this.viewport.height)
      }
      window.previousRect = null
    } else if (window.state === 'minimized') {
      window.state = 'normal'
    }
    window.updatedAt = Date.now()
    this.persist()
  },

  closeWindow(windowId: string) {
    const target = this.getWindow(windowId)
    if (!target) return
    const idsToClose = new Set<string>([windowId])
    for (const window of this.windows) {
      if (window.parentId && idsToClose.has(window.parentId)) {
        idsToClose.add(window.id)
      }
    }
    let hasExpanded = true
    while (hasExpanded) {
      hasExpanded = false
      for (const window of this.windows) {
        if (window.parentId && idsToClose.has(window.parentId) && !idsToClose.has(window.id)) {
          idsToClose.add(window.id)
          hasExpanded = true
        }
      }
    }
    this.windows = this.windows.filter((window) => !idsToClose.has(window.id))
    this.persist()
  },

  closeTool(kind: ToolWindowKind) {
    const window = this.getToolWindow(kind)
    if (!window) return
    this.closeWindow(window.id)
  },

  clearAll() {
    this.windows = []
    this.persist()
  },

  hydrate() {
    this.windows = []
    this.hydrated = true
    try {
      const raw = localStorage.getItem(this.storageKey)
      if (!raw) return
      const parsed = JSON.parse(raw) as PersistedLayout
      if (!parsed || !Array.isArray(parsed.windows)) return
      const loaded: ManagedWindow[] = []
      for (const entry of parsed.windows) {
        if (!entry?.id || !entry?.kind || !entry?.title) continue
        if (NON_RESTORABLE_CHILD_KINDS.has(entry.kind as ChildWindowKind)) continue
        const rect = clampRect(entry.rect, this.viewport.width, this.viewport.height)
        loaded.push({
          id: String(entry.id),
          kind: entry.kind,
          title: String(entry.title),
          parentId: entry.parentId ? String(entry.parentId) : null,
          state: entry.state === 'minimized' || entry.state === 'maximized' ? entry.state : 'normal',
          rect,
          previousRect: entry.previousRect
            ? clampRect(entry.previousRect, this.viewport.width, this.viewport.height)
            : null,
          zIndex: this.nextZIndex++,
          createdAt: Number(entry.createdAt || Date.now()),
          updatedAt: Number(entry.updatedAt || Date.now()),
          payload: safePayload(entry.payload),
        })
      }
      this.windows = loaded
      if (!this.windows.length) return
      const topZ = Math.max(...this.windows.map((window) => window.zIndex))
      this.nextZIndex = Math.max(this.nextZIndex, topZ + 1)
    } catch {
      localStorage.removeItem(this.storageKey)
    }
  },

  persist() {
    try {
      const payload: PersistedLayout = {
        windows: this.windows.map((window) => ({
          id: window.id,
          kind: window.kind,
          title: window.title,
          parentId: window.parentId,
          state: window.state,
          rect: window.rect,
          previousRect: window.previousRect,
          payload: window.payload,
          createdAt: window.createdAt,
          updatedAt: window.updatedAt,
        })),
      }
      localStorage.setItem(this.storageKey, JSON.stringify(payload))
    } catch {
      // ignore quota and serialization errors
    }
  },
})
