<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import AdminSegmentedTabs from '@/components/admin/AdminSegmentedTabs.vue'
import { store, type PatchBayNode } from '@/store'
import { windowManager } from '@/stores/windowManager'
import { strings } from '@/ui/strings'

const props = withDefaults(defineProps<{ floatingMode?: boolean }>(), {
  floatingMode: false,
})

const MIN_PANEL_SCALE = 0.35
const MAX_PANEL_SCALE = 2.5
const DEFAULT_PANEL_SCALE = 1
const DEFAULT_PANEL_PAN = { x: 40, y: 40 }
const PANEL_CELL_W = 52
const PANEL_CELL_H = 36
const PANEL_GRID_GAP = 4
const PANEL_ROW_LABEL_W = 46
const PANEL_COL_LABEL_H = 24

const t = strings
const gridSearchQuery = ref('')
const localRows = ref(store.patchbayRows)
const localCols = ref(store.patchbayCols)
const isSavingLayout = ref(false)
const inlineDeleteTarget = ref<PatchBayNode | null>(null)
const inlineDeleteConfirmInput = ref('')
const inlineDeleteLoading = ref(false)
const inlineCanConfirmDelete = computed(() => {
  return !!inlineDeleteTarget.value && !inlineDeleteLoading.value && inlineDeleteConfirmInput.value.trim() === t.confirm.deleteKeyword
})

const showForm = ref(false)
const formMode = ref<'add' | 'edit'>('add')
const formState = reactive({
  id: 0,
  name: '',
  description: '',
  type: 'standard',
  panel: '',
  connector: '',
  tag: '',
})
const tagInput = ref('')
const tagDraftColor = ref('#4f6f95')
const tagFieldRef = ref<HTMLElement | null>(null)
const tagDropdownOpen = ref(false)
const tagDropdownIndex = ref(0)
const TAG_SWATCHES = ['#4f6f95', '#3d7a58', '#d49a4f', '#b04b3d', '#8f5ab6', '#2f8898', '#9c6b43', '#6f7f2e']
const panelViewportRef = ref<HTMLElement | null>(null)
const panelScale = ref(store.patchbayPanelZoom)
const panelPan = reactive({ x: store.patchbayPanelPan.x, y: store.patchbayPanelPan.y })
const isSpacePressed = ref(false)
const isPanning = ref(false)
const movedDuringPan = ref(false)
const suppressCellClickOnce = ref(false)
const panState = ref<null | { startClientX: number; startClientY: number; startPanX: number; startPanY: number }>(null)
let panelPersistTimer: number | null = null

const nodes = computed(() => store.patchbayNodes)
const viewMode = computed(() => store.patchbayView)

const selectionBannerText = computed(() => {
  if (store.pendingLink) {
    return t.patchbay.linkingBanner(store.pendingLink.deviceName, store.pendingLink.portLabel)
  }
  return t.patchbay.linkingFallback
})

const columnLabels = computed(() => Array.from({ length: store.patchbayCols }, (_, index) => index + 1))
const rowIndexes = computed(() => Array.from({ length: store.patchbayRows }, (_, index) => index))
const patchbayViewTabs = computed(() => [
  { id: 'panel', label: t.patchbay.viewPanel },
  { id: 'list', label: t.patchbay.viewList },
])

const tagColorByName = computed(() => {
  const out: Record<string, string> = {}
  for (const tag of store.patchbayTags) {
    out[tag.name.trim().toLowerCase()] = tag.color
  }
  return out
})

const panelOrderedNodes = computed(() => {
  return [...nodes.value].sort((a, b) => a.id - b.id)
})

const panelSlots = computed(() => {
  const total = store.patchbayRows * store.patchbayCols
  return Array.from({ length: total }, (_, index) => panelOrderedNodes.value[index] || null)
})

const overflowCount = computed(() => {
  const overflow = panelOrderedNodes.value.length - panelSlots.value.length
  return overflow > 0 ? overflow : 0
})

const filteredListNodes = computed(() => {
  const query = gridSearchQuery.value.trim().toLowerCase()
  const sorted = [...nodes.value].sort((a, b) => a.id - b.id)
  if (!query) return sorted
  return sorted.filter((node) => {
    const connection = getConnection(node.id)
    const terms = [
      String(node.id),
      node.name,
      node.description,
      node.type,
      node.panel || '',
      node.connector || '',
      node.tag || '',
      connection?.device.name || '',
      connection?.port.label || '',
    ].join(' ').toLowerCase()
    return terms.includes(query)
  })
})

const knownTagNames = computed(() => store.patchbayTags.map((item) => item.name))
const filteredTagNames = computed(() => {
  const token = tagInput.value.trim().toLowerCase()
  if (!token) return knownTagNames.value
  return knownTagNames.value.filter((name) => name.toLowerCase().includes(token))
})
const hasTagMatches = computed(() => filteredTagNames.value.length > 0)
const selectedExistingTag = computed(() => store.getPatchbayTag(tagInput.value))
const canCreateTag = computed(() => {
  const token = tagInput.value.trim().toLowerCase()
  if (!token) return false
  return !store.patchbayTags.some((tag) => tag.name.trim().toLowerCase() === token)
})
const previewTagColor = computed(() => selectedExistingTag.value?.color || tagDraftColor.value)
const panelZoomPercent = computed(() => `${Math.round(panelScale.value * 100)}%`)
const panelStageStyle = computed(() => ({
  transform: `translate(${panelPan.x}px, ${panelPan.y}px) scale(${panelScale.value})`,
}))

watch(
  () => [store.patchbayRows, store.patchbayCols] as const,
  ([rows, cols]) => {
    localRows.value = rows
    localCols.value = cols
  },
  { immediate: true },
)

watch(
  () => [store.patchbayPanelZoom, store.patchbayPanelPan.x, store.patchbayPanelPan.y] as const,
  ([zoom, panX, panY]) => {
    panelScale.value = zoom
    panelPan.x = panX
    panelPan.y = panY
  },
  { immediate: true },
)

watch(() => store.patchbayFocusId, async (focusId) => {
  if (!focusId) return
  await nextTick()
  const target = document.querySelector(`[data-patch-id="${focusId}"]`) as HTMLElement | null
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
  }
  store.patchbayFocusId = null
})

watch(filteredTagNames, (items) => {
  if (items.length === 0) {
    tagDropdownIndex.value = 0
    return
  }
  if (tagDropdownIndex.value >= items.length) {
    tagDropdownIndex.value = items.length - 1
  }
})

const getConnection = (patchbayId: number) => store.getDeviceByPatchbayId(patchbayId)
const isLinked = (patchbayId: number) => !!getConnection(patchbayId)
const isHighlightedConnection = (patchbayId: number) => store.highlightedPatchIds.includes(patchbayId)

const isMatch = (node: PatchBayNode | null) => {
  if (!node || !gridSearchQuery.value.trim()) return false
  const query = gridSearchQuery.value.toLowerCase()
  if (node.name.toLowerCase().includes(query)) return true
  if ((node.tag || '').toLowerCase().includes(query)) return true
  const connection = getConnection(node.id)
  if (connection) {
    if (connection.device.name.toLowerCase().includes(query)) return true
    if (connection.port.label.toLowerCase().includes(query)) return true
  }
  return false
}

const getTagColor = (tag: string | null | undefined): string | null => {
  const token = String(tag || '').trim().toLowerCase()
  if (!token) return null
  return tagColorByName.value[token] || null
}

const tagStyle = (tag: string | null | undefined): Record<string, string> => {
  const color = getTagColor(tag)
  if (!color) return {}
  return { '--tag-color': color }
}

const tagInitials = (tag: string | null | undefined) => {
  const token = String(tag || '').trim()
  if (!token) return ''
  const words = token.split(/\s+/).filter(Boolean)
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase()
}

const getCellTooltip = (node: PatchBayNode | null) => {
  if (!node) return ''
  const connection = getConnection(node.id)
  if (!connection) return node.name
  return t.patchbay.tooltip(connection.device.name, connection.port.label)
}

const getRowLabel = (rowIndex: number) => {
  if (rowIndex < 26) return String.fromCharCode(65 + rowIndex)
  return `R${rowIndex + 1}`
}

const openPointDetail = (patchbayId: number) => {
  const parentWindowId = windowManager.getToolWindow('patchbay')?.id || 'tool:patchbay'
  windowManager.openChildWindow(
    parentWindowId,
    'patchbay-point-detail',
    t.patchbay.patchPointTitle(patchbayId),
    { patchbayId, parentWindowId },
    { id: `patchbay-point-detail:${patchbayId}` },
  )
}

const openLinkSearch = (patchbayId: number) => {
  const parentWindowId = windowManager.getToolWindow('patchbay')?.id || 'tool:patchbay'
  windowManager.openChildWindow(
    parentWindowId,
    'patchbay-link-search',
    t.patchbay.linkDeviceTitle(patchbayId),
    { patchbayId, parentWindowId },
    { id: `patchbay-link-search:${patchbayId}` },
  )
}

const handleCellClick = async (node: PatchBayNode | null) => {
  if (suppressCellClickOnce.value) {
    suppressCellClickOnce.value = false
    return
  }
  if (!node) return
  const parentWindowId = windowManager.getToolWindow('patchbay')?.id || 'tool:patchbay'
  if (store.selectionMode) {
    const existing = getConnection(node.id)
    if (existing) {
      windowManager.openChildWindow(
        parentWindowId,
        'patchbay-overwrite-confirm',
        t.confirm.overwriteTitle,
        {
          patchbayId: node.id,
          deviceName: existing.device.name,
          portLabel: existing.port.label,
        },
        { forceUnique: true },
      )
      return
    }
    await store.completeLink(node.id)
    return
  }
  openPointDetail(node.id)
}

const saveLayout = async () => {
  const rows = Math.max(1, Math.min(24, Number(localRows.value) || 6))
  const cols = Math.max(1, Math.min(96, Number(localCols.value) || 48))
  isSavingLayout.value = true
  try {
    await store.savePatchbayViewConfig(rows, cols, viewMode.value, {
      zoom: panelScale.value,
      panX: panelPan.x,
      panY: panelPan.y,
    })
    store.pushToast({ type: 'success', message: `${t.patchbay.rows}: ${rows}, ${t.patchbay.cols}: ${cols}` })
  } catch (err: any) {
    store.pushToast({ type: 'error', message: err?.message || t.toast.loadFailed })
  } finally {
    isSavingLayout.value = false
  }
}

const switchView = async (target: 'panel' | 'list') => {
  if (viewMode.value === target) return
  store.setPatchbayView(target)
  try {
    await store.savePatchbayViewConfig(store.patchbayRows, store.patchbayCols, target, {
      zoom: panelScale.value,
      panX: panelPan.x,
      panY: panelPan.y,
    })
  } catch (err: any) {
    store.pushToast({ type: 'error', message: err?.message || t.toast.loadFailed })
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const syncPanelTransformToStore = () => {
  store.patchbayPanelZoom = panelScale.value
  store.patchbayPanelPan = { x: panelPan.x, y: panelPan.y }
}

const persistPanelTransform = async () => {
  syncPanelTransformToStore()
  try {
    await store.savePatchbayViewConfig(store.patchbayRows, store.patchbayCols, store.patchbayView, {
      zoom: panelScale.value,
      panX: panelPan.x,
      panY: panelPan.y,
    })
  } catch (err: any) {
    store.pushToast({ type: 'error', message: err?.message || t.toast.loadFailed })
  }
}

const schedulePanelTransformPersist = () => {
  syncPanelTransformToStore()
  if (panelPersistTimer) window.clearTimeout(panelPersistTimer)
  panelPersistTimer = window.setTimeout(() => {
    void persistPanelTransform()
  }, 320)
}

const adjustScaleAt = (nextScaleRaw: number, clientX: number, clientY: number) => {
  const viewport = panelViewportRef.value
  if (!viewport) return
  const rect = viewport.getBoundingClientRect()
  const cursorX = clientX - rect.left
  const cursorY = clientY - rect.top
  const nextScale = clamp(nextScaleRaw, MIN_PANEL_SCALE, MAX_PANEL_SCALE)
  if (Math.abs(nextScale - panelScale.value) < 0.0001) return
  const worldX = (cursorX - panelPan.x) / panelScale.value
  const worldY = (cursorY - panelPan.y) / panelScale.value
  panelScale.value = nextScale
  panelPan.x = cursorX - worldX * nextScale
  panelPan.y = cursorY - worldY * nextScale
  schedulePanelTransformPersist()
}

const onPanelWheel = (event: WheelEvent) => {
  if (!(event.ctrlKey || event.metaKey)) return
  event.preventDefault()
  const zoomFactor = event.deltaY > 0 ? 0.92 : 1.08
  adjustScaleAt(panelScale.value * zoomFactor, event.clientX, event.clientY)
}

const beginPan = (event: PointerEvent) => {
  isPanning.value = true
  movedDuringPan.value = false
  panState.value = {
    startClientX: event.clientX,
    startClientY: event.clientY,
    startPanX: panelPan.x,
    startPanY: panelPan.y,
  }
}

const onPanelPointerDown = (event: PointerEvent) => {
  const shouldPanWithLeft = event.button === 0 && isSpacePressed.value
  const shouldPanWithMiddle = event.button === 1
  if (!(shouldPanWithLeft || shouldPanWithMiddle)) return
  event.preventDefault()
  beginPan(event)
}

const onGlobalPointerMove = (event: PointerEvent) => {
  if (!isPanning.value || !panState.value) return
  const dx = event.clientX - panState.value.startClientX
  const dy = event.clientY - panState.value.startClientY
  panelPan.x = panState.value.startPanX + dx
  panelPan.y = panState.value.startPanY + dy
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedDuringPan.value = true
}

const onGlobalPointerUp = () => {
  if (!isPanning.value) return
  isPanning.value = false
  panState.value = null
  if (movedDuringPan.value) {
    suppressCellClickOnce.value = true
  }
  movedDuringPan.value = false
  schedulePanelTransformPersist()
}

const onGlobalKeyDown = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement | null
  if (
    target &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  ) {
    return
  }
  if (event.code === 'Space') {
    isSpacePressed.value = true
    event.preventDefault()
  }
}

const onGlobalKeyUp = (event: KeyboardEvent) => {
  if (event.code === 'Space') {
    isSpacePressed.value = false
  }
}

const zoomIn = () => {
  const viewport = panelViewportRef.value
  if (!viewport) return
  const rect = viewport.getBoundingClientRect()
  adjustScaleAt(panelScale.value * 1.08, rect.left + rect.width / 2, rect.top + rect.height / 2)
}

const zoomOut = () => {
  const viewport = panelViewportRef.value
  if (!viewport) return
  const rect = viewport.getBoundingClientRect()
  adjustScaleAt(panelScale.value * 0.92, rect.left + rect.width / 2, rect.top + rect.height / 2)
}

const resetPanelView = () => {
  panelScale.value = DEFAULT_PANEL_SCALE
  panelPan.x = DEFAULT_PANEL_PAN.x
  panelPan.y = DEFAULT_PANEL_PAN.y
  schedulePanelTransformPersist()
}

const fitPanelToViewport = () => {
  const viewport = panelViewportRef.value
  if (!viewport) return
  const rect = viewport.getBoundingClientRect()
  const gridWidth = PANEL_ROW_LABEL_W + store.patchbayCols * PANEL_CELL_W + store.patchbayCols * PANEL_GRID_GAP
  const gridHeight = PANEL_COL_LABEL_H + store.patchbayRows * PANEL_CELL_H + store.patchbayRows * PANEL_GRID_GAP
  const padding = 24
  const targetScale = clamp(
    Math.min((rect.width - padding * 2) / gridWidth, (rect.height - padding * 2) / gridHeight),
    MIN_PANEL_SCALE,
    MAX_PANEL_SCALE,
  )
  panelScale.value = targetScale
  panelPan.x = (rect.width - gridWidth * targetScale) / 2
  panelPan.y = (rect.height - gridHeight * targetScale) / 2
  schedulePanelTransformPersist()
}

const openTagDropdown = () => {
  tagDropdownOpen.value = true
  tagDropdownIndex.value = 0
}

const closeTagDropdown = () => {
  tagDropdownOpen.value = false
}

const selectTag = (name: string) => {
  tagInput.value = name
  formState.tag = name
  const existing = store.getPatchbayTag(name)
  if (existing?.color) {
    tagDraftColor.value = existing.color
  }
  closeTagDropdown()
}

const handleTagKeydown = (event: KeyboardEvent) => {
  if (!tagDropdownOpen.value && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
    openTagDropdown()
  }
  if (!tagDropdownOpen.value) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (!filteredTagNames.value.length) return
    tagDropdownIndex.value = Math.min(tagDropdownIndex.value + 1, filteredTagNames.value.length - 1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (!filteredTagNames.value.length) return
    tagDropdownIndex.value = Math.max(tagDropdownIndex.value - 1, 0)
    return
  }
  if (event.key === 'Enter' && filteredTagNames.value.length) {
    event.preventDefault()
    const chosen = filteredTagNames.value[tagDropdownIndex.value]
    if (chosen) selectTag(chosen)
    return
  }
  if (event.key === 'Escape') {
    closeTagDropdown()
  }
}

const handleOutsideClick = (event: Event) => {
  const target = event.target as Node | null
  if (!target) return
  if (!tagFieldRef.value?.contains(target)) {
    closeTagDropdown()
  }
}

onMounted(() => {
  window.addEventListener('pointerdown', handleOutsideClick)
  window.addEventListener('pointermove', onGlobalPointerMove)
  window.addEventListener('pointerup', onGlobalPointerUp)
  window.addEventListener('keydown', onGlobalKeyDown)
  window.addEventListener('keyup', onGlobalKeyUp)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', handleOutsideClick)
  window.removeEventListener('pointermove', onGlobalPointerMove)
  window.removeEventListener('pointerup', onGlobalPointerUp)
  window.removeEventListener('keydown', onGlobalKeyDown)
  window.removeEventListener('keyup', onGlobalKeyUp)
  if (panelPersistTimer) window.clearTimeout(panelPersistTimer)
})

const resetForm = () => {
  formState.id = 0
  formState.name = ''
  formState.description = ''
  formState.type = 'standard'
  formState.panel = ''
  formState.connector = ''
  formState.tag = ''
  tagInput.value = ''
  tagDraftColor.value = TAG_SWATCHES[0]
  closeTagDropdown()
}

const openAdd = () => {
  if (props.floatingMode) {
    const parentWindowId = windowManager.getToolWindow('patchbay')?.id || 'tool:patchbay'
    windowManager.openChildWindow(
      parentWindowId,
      'patchbay-point-add-edit',
      t.patchbay.addPoint,
      { mode: 'add', parentWindowId },
      { id: 'patchbay-point-add-edit:add' },
    )
    return
  }
  formMode.value = 'add'
  resetForm()
  showForm.value = true
}

const openEdit = (node: PatchBayNode) => {
  if (props.floatingMode) {
    const parentWindowId = windowManager.getToolWindow('patchbay')?.id || 'tool:patchbay'
    windowManager.openChildWindow(
      parentWindowId,
      'patchbay-point-add-edit',
      `${t.patchbay.editPoint} #${node.id}`,
      { mode: 'edit', patchbayId: node.id, parentWindowId },
      { id: `patchbay-point-add-edit:${node.id}` },
    )
    return
  }
  formMode.value = 'edit'
  formState.id = node.id
  formState.name = node.name
  formState.description = node.description
  formState.type = node.type
  formState.panel = node.panel || ''
  formState.connector = node.connector || ''
  formState.tag = node.tag || ''
  tagInput.value = node.tag || ''
  tagDraftColor.value = getTagColor(node.tag) || TAG_SWATCHES[0]
  closeTagDropdown()
  showForm.value = true
}

const createTagFromInput = async () => {
  const token = tagInput.value.trim()
  if (!token) return
  try {
    const created = await store.ensurePatchbayTag(token, tagDraftColor.value)
    formState.tag = created?.name || token
    tagInput.value = formState.tag
    closeTagDropdown()
  } catch (err: any) {
    store.pushToast({ type: 'error', message: err?.message || t.toast.loadFailed })
  }
}

const saveForm = async () => {
  if (!formState.name.trim()) {
    store.pushToast({ type: 'error', message: 'Name is required.' })
    return
  }
  const payload = {
    name: formState.name.trim(),
    description: formState.description.trim(),
    type: formState.type.trim() || 'standard',
    panel: formState.panel.trim() || null,
    connector: formState.connector.trim() || null,
    tag: (formState.tag || tagInput.value).trim() || null,
  }
  if (payload.tag) {
    await store.ensurePatchbayTag(payload.tag, tagDraftColor.value)
  }
  try {
    if (formMode.value === 'add') {
      await store.createPatchbayPoint(payload)
      store.pushToast({ type: 'success', message: t.toast.patchbayPointCreated })
    } else {
      await store.updatePatchbayPoint(formState.id, payload)
      store.pushToast({ type: 'success', message: t.toast.patchbayPointUpdated })
    }
    showForm.value = false
  } catch (err: any) {
    store.pushToast({ type: 'error', message: err?.message || t.toast.loadFailed })
  }
}

const removePoint = async (node: PatchBayNode) => {
  if (props.floatingMode) {
    const parentWindowId = windowManager.getToolWindow('patchbay')?.id || 'tool:patchbay'
    windowManager.openChildWindow(
      parentWindowId,
      'patchbay-point-delete-confirm',
      t.confirm.deletePatchbayPointTitle,
      {
        patchbayId: node.id,
        patchbayName: node.name,
      },
      { id: `patchbay-point-delete-confirm:${node.id}` },
    )
    return
  }
  inlineDeleteTarget.value = node
  inlineDeleteConfirmInput.value = ''
}

const closeInlineDeleteModal = () => {
  inlineDeleteTarget.value = null
  inlineDeleteConfirmInput.value = ''
}

const confirmInlineDelete = async () => {
  if (!inlineDeleteTarget.value || !inlineCanConfirmDelete.value) return
  inlineDeleteLoading.value = true
  try {
    const result = await store.deletePatchbayPoint(inlineDeleteTarget.value.id)
    if (result.deleted) {
      store.pushToast({ type: 'success', message: t.toast.patchbayPointDeleted })
      closeInlineDeleteModal()
      return
    }
    if (result.blocked) {
      store.pushToast({ type: 'error', message: t.patchbay.deleteBlocked })
      return
    }
    store.pushToast({ type: 'error', message: result.message || t.toast.patchbayPointDeleteFailed })
  } catch (err: any) {
    store.pushToast({ type: 'error', message: err?.message || t.toast.patchbayPointDeleteFailed })
  } finally {
    inlineDeleteLoading.value = false
  }
}

const unlinkFromList = async (patchbayId: number) => {
  const link = getConnection(patchbayId)
  if (!link) return
  await store.unlinkPort(link.device.id, link.port.id)
}

const onPatchbayViewChange = (value: string) => {
  if (value === 'panel' || value === 'list') {
    switchView(value)
  }
}
</script>

<template>
  <div class="main-container" :class="{ 'selection-mode': store.selectionMode, 'floating-mode': props.floatingMode }">
    <div class="top-controls">
      <div v-if="store.selectionMode" class="selection-banner">
        <span>{{ selectionBannerText }}</span>
        <button @click="store.cancelLinking()">{{ t.patchbay.cancel }}</button>
      </div>

      <div v-if="store.highlightedPatchIds.length > 0" class="highlight-banner">
        <span>{{ t.patchbay.showingConnection(store.highlightedPatchIds[0], store.highlightedPatchIds[1]) }}</span>
        <button @click="store.highlightedPatchIds = []">{{ t.patchbay.clearHighlights }}</button>
      </div>

      <div class="toolbar">
        <div class="view-picker">
          <AdminSegmentedTabs
            :items="patchbayViewTabs"
            :model-value="viewMode"
            size="sm"
            @change="onPatchbayViewChange"
          />
        </div>

        <div class="layout-controls">
          <div class="layout-capsule">
            <label class="layout-field">
              <span class="layout-label">{{ t.patchbay.rows }}</span>
              <input v-model.number="localRows" type="number" min="1" max="24" />
            </label>
            <label class="layout-field">
              <span class="layout-label">{{ t.patchbay.cols }}</span>
              <input v-model.number="localCols" type="number" min="1" max="96" />
            </label>
            <button class="layout-save" :disabled="isSavingLayout" @click="saveLayout">{{ t.patchbay.saveLayout }}</button>
          </div>
        </div>

        <input v-model="gridSearchQuery" :placeholder="t.patchbay.searchPlaceholder" class="grid-search-input" />
      </div>
    </div>

    <div v-if="viewMode === 'panel'" class="panel-view">
      <div class="panel-canvas-controls">
        <p class="panel-canvas-hint">Space+drag or middle-drag to pan. Ctrl/Cmd+wheel to zoom.</p>
        <div class="zoom-controls">
          <button class="ghost-btn" @click="zoomOut">-</button>
          <span class="zoom-label">{{ panelZoomPercent }}</span>
          <button class="ghost-btn" @click="zoomIn">+</button>
          <button class="ghost-btn" @click="resetPanelView">Reset</button>
          <button class="ghost-btn" @click="fitPanelToViewport">Fit</button>
        </div>
      </div>
      <div v-if="overflowCount > 0" class="overflow-warning">
        {{ overflowCount }} points are outside the current {{ store.patchbayRows }}x{{ store.patchbayCols }} layout.
      </div>
      <div
        ref="panelViewportRef"
        class="panel-viewport"
        :class="{ panning: isPanning || isSpacePressed }"
        @wheel="onPanelWheel"
        @pointerdown="onPanelPointerDown"
      >
        <div class="panel-stage" :style="panelStageStyle">
          <div class="panel-grid" :style="{ '--cols': String(store.patchbayCols) }">
            <div class="grid-corner"></div>
            <div v-for="col in columnLabels" :key="`head-col-${col}`" class="grid-col-label">{{ col }}</div>

            <template v-for="rowIndex in rowIndexes" :key="`row-${rowIndex}`">
              <div class="grid-row-label">{{ getRowLabel(rowIndex) }}</div>
              <div
                v-for="col in columnLabels"
                :key="`cell-${rowIndex}-${col}`"
                class="grid-cell"
                :class="{
                  linked: isLinked(panelSlots[rowIndex * store.patchbayCols + (col - 1)]?.id || -1),
                  open: !isLinked(panelSlots[rowIndex * store.patchbayCols + (col - 1)]?.id || -1),
                  empty: !panelSlots[rowIndex * store.patchbayCols + (col - 1)],
                  'highlight-match': isMatch(panelSlots[rowIndex * store.patchbayCols + (col - 1)] || null),
                  'highlight-connection': isHighlightedConnection(panelSlots[rowIndex * store.patchbayCols + (col - 1)]?.id || -1),
                }"
                :style="tagStyle(panelSlots[rowIndex * store.patchbayCols + (col - 1)]?.tag)"
                :data-patch-id="panelSlots[rowIndex * store.patchbayCols + (col - 1)]?.id || null"
                :data-tooltip="getCellTooltip(panelSlots[rowIndex * store.patchbayCols + (col - 1)] || null) || null"
                @click="handleCellClick(panelSlots[rowIndex * store.patchbayCols + (col - 1)] || null)"
              >
                <span class="cell-text">
                  {{ panelSlots[rowIndex * store.patchbayCols + (col - 1)]?.id || '-' }}
                </span>
                <span
                  v-if="panelSlots[rowIndex * store.patchbayCols + (col - 1)]?.tag"
                  class="tag-pill"
                >
                  {{ tagInitials(panelSlots[rowIndex * store.patchbayCols + (col - 1)]?.tag) }}
                </span>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="list-view">
      <div class="list-header">
        <h3>{{ t.patchbay.listTitle }}</h3>
        <button @click="openAdd">{{ t.patchbay.addPoint }}</button>
      </div>

      <table class="patchbay-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>{{ t.patchbay.fullName }}</th>
            <th>{{ t.patchbay.typeLabel }}</th>
            <th>Panel</th>
            <th>Connector</th>
            <th>{{ t.patchbay.tagLabel }}</th>
            <th>Status</th>
            <th>{{ t.patchbay.connectedToLabel }}</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="node in filteredListNodes" :key="node.id">
            <td>#{{ node.id }}</td>
            <td>{{ node.name }}</td>
            <td>{{ node.type }}</td>
            <td>{{ node.panel || '-' }}</td>
            <td>{{ node.connector || '-' }}</td>
            <td>
              <span v-if="node.tag" class="tag-chip" :style="tagStyle(node.tag)">{{ node.tag }}</span>
              <span v-else>-</span>
            </td>
            <td>{{ isLinked(node.id) ? t.patchbay.connectedStatus : t.patchbay.openStatus }}</td>
            <td>
              <template v-if="getConnection(node.id)">
                {{ getConnection(node.id)?.device.name }} · {{ getConnection(node.id)?.port.label }}
              </template>
              <template v-else>-</template>
            </td>
            <td class="row-actions">
              <button @click="openPointDetail(node.id)">View</button>
              <button @click="openEdit(node)">{{ t.patchbay.editPoint }}</button>
              <button v-if="!isLinked(node.id)" @click="openLinkSearch(node.id)">{{ t.patchbay.linkDevice }}</button>
              <button v-else @click="unlinkFromList(node.id)">{{ t.patchbay.unlink }}</button>
              <button class="danger" @click="removePoint(node)">{{ t.patchbay.deletePoint }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="showForm && viewMode === 'list'" class="modal-backdrop" @click.self="showForm = false">
      <div class="modal">
        <h3>{{ formMode === 'add' ? t.patchbay.addPoint : `${t.patchbay.editPoint} #${formState.id}` }}</h3>
        <div class="form-grid">
          <label>Name <input v-model="formState.name" /></label>
          <label>Type <input v-model="formState.type" /></label>
          <label>Panel <input v-model="formState.panel" /></label>
          <label>Connector <input v-model="formState.connector" /></label>
          <div class="tag-field" ref="tagFieldRef">
            <label>
              {{ t.patchbay.tagLabel }}
              <input
                v-model="tagInput"
                :placeholder="t.patchbay.newTagPlaceholder"
                @focus="openTagDropdown"
                @input="() => { formState.tag = tagInput; openTagDropdown() }"
                @keydown="handleTagKeydown"
              />
            </label>
            <div v-if="tagDropdownOpen && hasTagMatches" class="tag-dropdown">
              <button
                v-for="(tagName, idx) in filteredTagNames"
                :key="tagName"
                type="button"
                class="tag-option"
                :class="{ active: idx === tagDropdownIndex }"
                @click="selectTag(tagName)"
                @mouseenter="tagDropdownIndex = idx"
              >
                <span class="tag-dot" :style="{ background: getTagColor(tagName) || '#4f6f95' }"></span>
                <span>{{ tagName }}</span>
              </button>
            </div>
            <button v-if="canCreateTag" type="button" class="secondary tag-create-btn" @click="createTagFromInput">
              {{ t.patchbay.createTag }} "{{ tagInput }}"
            </button>
            <div class="tag-color-controls">
              <span class="tag-color-label">Color</span>
              <div class="tag-swatches">
                <button
                  v-for="color in TAG_SWATCHES"
                  :key="color"
                  type="button"
                  class="tag-swatch"
                  :class="{ active: tagDraftColor.toLowerCase() === color.toLowerCase() }"
                  :style="{ background: color }"
                  @click="tagDraftColor = color"
                ></button>
              </div>
              <div class="tag-color-custom">
                <input v-model="tagDraftColor" type="color" />
                <span class="tag-preview-chip" :style="{ '--tag-color': previewTagColor }">{{ tagInput.trim() || 'Tag' }}</span>
              </div>
            </div>
          </div>
          <label class="full">Description <textarea v-model="formState.description" rows="3"></textarea></label>
        </div>
        <div class="form-actions">
          <button class="secondary" @click="showForm = false">{{ t.confirm.cancel }}</button>
          <button @click="saveForm">{{ t.confirm.confirm }}</button>
        </div>
      </div>
    </div>

    <div v-if="inlineDeleteTarget && viewMode === 'list'" class="modal-backdrop" @click.self="closeInlineDeleteModal">
      <div class="modal delete-modal">
        <h3>{{ t.confirm.deletePatchbayPointTitle }}</h3>
        <p>{{ t.confirm.deletePatchbayPointMessage(inlineDeleteTarget.name, inlineDeleteTarget.id) }}</p>
        <p class="delete-help">{{ t.confirm.deleteTypeToConfirm }}</p>
        <input
          v-model="inlineDeleteConfirmInput"
          class="delete-confirm-input"
          :placeholder="t.confirm.deleteInputPlaceholder"
          :disabled="inlineDeleteLoading"
        />
        <div class="form-actions">
          <button class="secondary" :disabled="inlineDeleteLoading" @click="closeInlineDeleteModal">{{ t.confirm.cancel }}</button>
          <button class="danger-action" :disabled="!inlineCanConfirmDelete" @click="confirmInlineDelete">
            {{ inlineDeleteLoading ? t.confirm.deleting : t.confirm.confirm }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.main-container {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
  background-color: var(--surface-1);
  width: 100%;
  height: 100%;
  border-radius: var(--radius-3);
  border: 1px solid var(--border-default);
  box-shadow: var(--shadow-1);
  overflow: auto;
  min-height: 0;
}

.main-container.floating-mode {
  background: transparent;
  border: none;
  box-shadow: none;
  border-radius: 0;
  padding: var(--space-3);
}

.selection-mode {
  border: 2px solid rgba(61, 122, 88, 0.9);
  box-shadow: 0 0 0 2px rgba(61, 122, 88, 0.2);
}

.selection-banner,
.highlight-banner {
  padding: var(--space-2) var(--space-3);
  text-align: center;
  font-weight: 500;
  display: flex;
  justify-content: center;
  gap: var(--space-3);
  align-items: center;
  border-radius: var(--radius-2);
}

.selection-banner {
  background-color: rgba(61, 122, 88, 0.2);
  border: 1px solid rgba(61, 122, 88, 0.4);
}

.highlight-banner {
  background: linear-gradient(120deg, rgba(61, 122, 88, 0.3), rgba(212, 154, 79, 0.25));
  border: 1px solid rgba(212, 154, 79, 0.3);
}

.toolbar {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
  align-items: center;
}

.view-picker,
.layout-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}

.view-picker {
  align-items: stretch;
}

.selection-banner button,
.highlight-banner button {
  border: 1px solid var(--border-default);
  background: var(--surface-2);
  color: var(--text-primary);
  border-radius: var(--radius-2);
  padding: 6px 10px;
  cursor: pointer;
}

.layout-controls {
  flex: 0 0 auto;
}

.layout-capsule {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  border-radius: calc(var(--radius-2) + 4px);
  border: 1px solid color-mix(in oklab, var(--border-default) 86%, white 6%);
  background:
    linear-gradient(180deg, color-mix(in oklab, var(--surface-2) 90%, white 2%), color-mix(in oklab, var(--surface-2) 96%, black 2%));
  box-shadow:
    inset 0 1px 0 color-mix(in oklab, white 10%, transparent),
    inset 0 -1px 0 color-mix(in oklab, black 10%, transparent);
}

.layout-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: var(--radius-2);
  background: color-mix(in oklab, var(--surface-1) 60%, transparent);
  border: 1px solid color-mix(in oklab, var(--border-default) 70%, transparent);
}

.layout-label {
  font-size: 0.73rem;
  line-height: 1;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--text-secondary);
  text-transform: uppercase;
}

.layout-field input {
  width: 58px;
  min-width: 0;
  border: 1px solid color-mix(in oklab, var(--border-default) 84%, white 6%);
  background: color-mix(in oklab, var(--surface-1) 92%, white 2%);
  color: var(--text-primary);
  border-radius: 10px;
  padding: 6px 8px;
  font-size: 0.84rem;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.layout-field input:focus {
  outline: none;
  border-color: color-mix(in oklab, var(--accent) 58%, white 12%);
  box-shadow: 0 0 0 2px color-mix(in oklab, var(--accent) 18%, transparent);
}

.layout-save,
.selection-banner button,
.highlight-banner button {
  border: 1px solid var(--border-default);
  background: var(--surface-2);
  color: var(--text-primary);
  border-radius: var(--radius-2);
  padding: 6px 10px;
  cursor: pointer;
}

.layout-save {
  border-radius: 999px;
  padding: 7px 12px;
  background:
    linear-gradient(180deg, color-mix(in oklab, var(--accent) 90%, white 6%), color-mix(in oklab, var(--accent) 85%, black 8%));
  border-color: color-mix(in oklab, var(--accent) 65%, black 5%);
  color: #11130f;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  box-shadow:
    0 5px 14px color-mix(in oklab, var(--accent) 14%, transparent),
    inset 0 1px 0 color-mix(in oklab, white 22%, transparent);
}

.layout-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  box-shadow: none;
}

.grid-search-input {
  flex: 1;
  min-width: 220px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background: var(--surface-2);
  color: var(--text-primary);
  padding: 8px 10px;
}

@media (max-width: 820px) {
  .layout-capsule {
    flex-wrap: wrap;
    gap: 6px;
  }
}

.panel-view {
  display: grid;
  gap: var(--space-2);
  min-height: 420px;
}

.panel-canvas-controls {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.panel-canvas-hint {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.zoom-controls {
  display: flex;
  gap: 6px;
  align-items: center;
}

.zoom-label {
  min-width: 58px;
  text-align: center;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.ghost-btn {
  border: 1px solid var(--border-default);
  background: var(--surface-2);
  color: var(--text-primary);
  border-radius: var(--radius-2);
  padding: 5px 10px;
  cursor: pointer;
}

.panel-viewport {
  position: relative;
  overflow: hidden;
  min-height: 420px;
  height: calc(100vh - 320px);
  max-height: 760px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background:
    radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--border-default) 55%, transparent) 1px, transparent 0) 0 0 / 16px 16px,
    var(--surface-1);
  cursor: default;
}

.panel-viewport.panning {
  cursor: grab;
}

.panel-stage {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  width: max-content;
}

.overflow-warning {
  color: var(--warning);
  font-size: 0.9rem;
}

.panel-grid {
  --cell-w: 52px;
  --row-label-w: 46px;
  display: grid;
  gap: 4px;
  grid-template-columns: var(--row-label-w) repeat(var(--cols), var(--cell-w));
  align-items: center;
  width: max-content;
}

.grid-corner,
.grid-col-label,
.grid-row-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  text-align: center;
}

.grid-cell {
  position: relative;
  min-height: 36px;
  width: var(--cell-w);
  border-radius: var(--radius-2);
  border: 1px solid var(--border-default);
  background: var(--surface-2);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.grid-cell.empty {
  cursor: default;
  opacity: 0.55;
}

.grid-cell.linked {
  border-color: rgba(61, 122, 88, 0.65);
}

.grid-cell.open {
  border-color: var(--border-default);
}

.grid-cell.highlight-match {
  box-shadow: 0 0 0 2px rgba(212, 154, 79, 0.3);
}

.grid-cell.highlight-connection {
  box-shadow: 0 0 0 2px rgba(99, 138, 193, 0.35);
}

.grid-cell[style*="--tag-color"] {
  background: color-mix(in srgb, var(--tag-color) 18%, var(--surface-2));
}

.cell-text {
  font-size: 0.82rem;
}

.tag-pill {
  position: absolute;
  top: 2px;
  right: 3px;
  font-size: 0.64rem;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--tag-color, #4f6f95) 24%, #fff);
}

.list-view {
  display: grid;
  gap: var(--space-3);
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.patchbay-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}

.patchbay-table th,
.patchbay-table td {
  border: 1px solid var(--border-default);
  padding: 6px 8px;
  text-align: left;
  vertical-align: top;
}

.row-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.row-actions button,
.list-header button {
  border: 1px solid var(--border-default);
  background: var(--surface-2);
  border-radius: var(--radius-2);
  color: var(--text-primary);
  padding: 4px 8px;
  cursor: pointer;
}

.row-actions button.danger {
  border-color: rgba(176, 75, 61, 0.45);
  color: var(--danger);
}

.tag-chip {
  display: inline-flex;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--tag-color, #4f6f95) 24%, #fff);
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}

.modal {
  width: min(760px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  overflow: auto;
  background: var(--surface-1);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-3);
  padding: var(--space-4);
  display: grid;
  gap: var(--space-3);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.form-grid label {
  display: grid;
  gap: 6px;
  font-size: 0.85rem;
}

.tag-field {
  position: relative;
  display: grid;
  gap: 8px;
}

.form-grid .full {
  grid-column: 1 / -1;
}

.form-grid input,
.form-grid textarea {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background: var(--surface-2);
  color: var(--text-primary);
  padding: 8px 10px;
}

.form-grid .secondary {
  border: 1px solid var(--border-default);
  background: var(--surface-2);
  border-radius: var(--radius-2);
  color: var(--text-primary);
  padding: 8px 10px;
  cursor: pointer;
  text-align: left;
}

.tag-create-btn {
  width: fit-content;
}

.tag-dropdown {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background: var(--surface-1);
  box-shadow: var(--shadow-1);
  z-index: 20;
  max-height: 220px;
  overflow: auto;
}

.tag-option {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  border: none;
  border-bottom: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  padding: 8px 10px;
  cursor: pointer;
}

.tag-option:last-child {
  border-bottom: none;
}

.tag-option:hover,
.tag-option.active {
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-1));
}

.tag-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  display: inline-block;
}

.tag-color-controls {
  display: grid;
  gap: 8px;
}

.tag-color-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.tag-swatches {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.tag-swatch {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 2px solid transparent;
  cursor: pointer;
}

.tag-swatch.active {
  border-color: var(--text-primary);
}

.tag-color-custom {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tag-color-custom input[type='color'] {
  width: 34px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background: transparent;
}

.tag-preview-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 0.78rem;
  background: color-mix(in srgb, var(--tag-color, #4f6f95) 24%, #fff);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.form-actions button {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  padding: 8px 12px;
  background: var(--surface-2);
  color: var(--text-primary);
  cursor: pointer;
}

.delete-modal {
  width: min(520px, calc(100vw - 32px));
}

.delete-help {
  margin: 0;
  color: var(--text-secondary);
}

.delete-confirm-input {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background: var(--surface-2);
  color: var(--text-primary);
  padding: 8px 10px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.danger-action {
  border-color: rgba(176, 75, 61, 0.45) !important;
  background: rgba(176, 75, 61, 0.9) !important;
  color: #fff !important;
}

.danger-action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

@media (max-width: 980px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
