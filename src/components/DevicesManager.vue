<script setup lang="ts">
import { ref, computed, watch, watchEffect, onBeforeUnmount, onMounted, type ComponentPublicInstance, type VNodeRef } from 'vue'
import { useAuth } from '@clerk/vue'
import { api, type ApiCatalogItemDetails, type ApiCatalogSearchItem } from '../lib/api'
import { useEntitlements } from '@/lib/useEntitlements'
import { guardAiDetection } from '@/lib/aiDetectionGuard'
import { quotaStore } from '@/stores/quota'
import { store, type Device, type DevicePort } from '../store'
import { strings } from '../ui/strings'
import ConfirmDialog from '../ui/ConfirmDialog.vue'
import { useDeviceImages } from '@/composables/useDeviceImages'
import { windowManager } from '@/stores/windowManager'

const props = withDefaults(defineProps<{
  floatingMode?: boolean
  onOpenDetailWindow?: (deviceId: number) => void
  modalOnly?: boolean
  modalMode?: 'add' | 'edit'
  modalDeviceId?: number
  modalParentWindowId?: string
  onRequestCloseModalWindow?: () => void
}>(), {
  floatingMode: false,
  modalOnly: false,
  modalMode: 'add',
  modalDeviceId: 0,
})

const t = strings
const { orgId } = useAuth()
const deviceImages = useDeviceImages()

const searchQuery = ref('')
const isLoading = ref(false)
const isDesktop = ref(window.innerWidth >= 1024)
const { canUseAiDetection, aiMonthlyLimit } = useEntitlements()

const isAiQuotaExceeded = computed(() => {
  return quotaStore.aiDetectionRemaining !== null && quotaStore.aiDetectionRemaining <= 0
})

const aiQuotaLabel = computed(() => {
  const limit = aiMonthlyLimit.value
  if (!limit) return null
  if (quotaStore.aiDetectionUsedToday !== null) {
    return t.devices.aiQuotaUsed(quotaStore.aiDetectionUsedToday, limit)
  }
  if (quotaStore.aiDetectionRemaining !== null) {
    return t.devices.aiQuotaRemaining(quotaStore.aiDetectionRemaining, limit)
  }
  return t.devices.aiQuotaLimit(limit)
})

const aiUploadDisabled = computed(() => {
  return !canUseAiDetection.value || isAiQuotaExceeded.value
})

const aiUploadDisabledReason = computed(() => {
  if (!canUseAiDetection.value) return t.devices.aiNotIncluded
  if (isAiQuotaExceeded.value) return strings.toast.quotaExceeded
  return ''
})

const updateViewport = () => {
  isDesktop.value = window.innerWidth >= 1024
}

const PREFETCH_COUNT = 12
const PREFETCH_IDLE_TIMEOUT = 2000
const OBSERVER_ROOT_MARGIN = '400px 0px'

const observer = ref<IntersectionObserver | null>(null)
const elementToDeviceId = new Map<Element, number>()
let prefetchHandle: ReturnType<typeof setTimeout> | null = null
let lastDeviceImageLog = 0

const registerDeviceCard = (deviceId: number): VNodeRef => (el: Element | ComponentPublicInstance | null) => {
  const currentObserver = observer.value
  if (!currentObserver) return

  const element = el instanceof Element ? el : (el?.$el as Element | null)
  if (!element) return

  for (const [element, id] of elementToDeviceId.entries()) {
    if (id === deviceId) {
      currentObserver.unobserve(element)
      elementToDeviceId.delete(element)
      break
    }
  }

  elementToDeviceId.set(element, deviceId)
  currentObserver.observe(element)
}

const schedulePrefetch = (devices: Device[]) => {
  if (prefetchHandle) {
    window.clearTimeout(prefetchHandle)
    prefetchHandle = null
  }

  const candidates = devices.slice(0, PREFETCH_COUNT)
  const run = () => {
    void deviceImages.prefetch(candidates, orgId.value, { concurrency: 2 })
  }

  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => void }).requestIdleCallback
  if (idle) {
    idle(run, { timeout: PREFETCH_IDLE_TIMEOUT })
  } else {
    prefetchHandle = globalThis.setTimeout(run, PREFETCH_IDLE_TIMEOUT)
  }
}

onMounted(() => {
  window.addEventListener('resize', updateViewport)
  observer.value = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const deviceId = elementToDeviceId.get(entry.target)
      if (!deviceId) continue
      if (!entry.isIntersecting) continue
      const device = store.devices.find(item => item.id === deviceId)
      if (!device) continue
      deviceImages.request(device, orgId.value, { priority: 'high' })
    }
  }, { rootMargin: OBSERVER_ROOT_MARGIN, threshold: 0.01 })
})

const showError = (message: string) => {
  store.pushToast({ type: 'error', message })
}

const filteredDevices = computed(() => {
  if (!searchQuery.value) return store.devices
  const query = searchQuery.value.toLowerCase()
  return store.devices.filter(device =>
    device.name.toLowerCase().includes(query) ||
    device.category.toLowerCase().includes(query) ||
    device.type.toLowerCase().includes(query) ||
    device.ports.some(p => p.label.toLowerCase().includes(query))
  )
})

const selectedDevice = ref<Device | null>(null)
const showAddModal = ref(false)
const addDeviceMode = ref<'manual' | 'ai' | 'catalog'>('manual')
const editingDeviceId = ref<number | null>(null)
const editSnapshot = ref<{ device: { name: string; type: string; category: string }; ports: DevicePort[] } | null>(null)
const deleteTarget = ref<Device | null>(null)
const DRAFT_STORAGE_KEY = 'el-riche.addDeviceDraft'
const LEGACY_DRAFT_STORAGE_KEY = 'pepper.addDeviceDraft'

const deviceCategoryOptions = [
  'MIC',
  'PREAMP',
  'INTERFACE',
  'COMPRESSOR',
  'PATCHPANEL',
  'INSTRUMENT',
  'MONITOR',
  'HEADPHONE_AMP',
  'EQ',
  'MIXER',
  'CONTROLLER',
  'EFFECTS',
  'AMP',
  'REAMP',
  'OTHER',
] as const
const portTypeOptions = Object.keys(t.devices.portTypes) as Array<keyof typeof t.devices.portTypes>
const fallbackDeviceCategory = 'OTHER'
const fallbackDeviceType = 'other'

const newDevice = ref({
  name: '',
  category: fallbackDeviceCategory,
  type: fallbackDeviceType,
})

const newPorts = ref<Array<{ id?: string; label: string; type: 'Input' | 'Output' | 'Other'; patchbayId?: number | null }>>([])

const aiPreviewUrl = ref<string | null>(null)
const aiLoading = ref(false)
const aiStatusMessage = ref<string | null>(null)
const isEditing = computed(() => editingDeviceId.value !== null)
const canUseCatalog = ref(false)
const catalogStatusReason = ref<string | null>(null)
const catalogQuery = ref('')
const catalogResults = ref<ApiCatalogSearchItem[]>([])
const catalogSearchLoading = ref(false)
const catalogSearchError = ref<string | null>(null)
const catalogDetailsLoading = ref(false)
const selectedCatalogExternalId = ref<string | null>(null)
const selectedCatalogItem = ref<ApiCatalogItemDetails | null>(null)
const selectedCatalogSource = ref<{
  provider: string
  externalId: string
  sourceUrl?: string | null
  importedSnapshot: Record<string, unknown>
} | null>(null)

watch(canUseAiDetection, (allowed) => {
  if (!allowed && addDeviceMode.value === 'ai') {
    addDeviceMode.value = 'manual'
  }
})

watch(isEditing, (editing) => {
  if (editing && addDeviceMode.value === 'catalog') {
    addDeviceMode.value = 'manual'
  }
})

watch(canUseCatalog, (available) => {
  if (!available && addDeviceMode.value === 'catalog') {
    addDeviceMode.value = 'manual'
  }
})

// Image upload state
const pendingImageFile = ref<File | null>(null)
const pendingImagePreviewUrl = ref<string | null>(null)
const pendingImageError = ref<string | null>(null)
const isUploadingImage = ref(false)

const aiStep = computed(() => {
  if (!aiPreviewUrl.value) return 'upload'
  if (aiLoading.value) return 'processing'
  if (aiStatusMessage.value) return 'review'
  return 'upload'
})

const addPort = () => {
  newPorts.value.push({
    label: t.devices.addPortLabel(newPorts.value.length + 1),
    type: portTypeOptions[0],
    patchbayId: null,
  })
}

const removePort = (index: number) => {
  newPorts.value.splice(index, 1)
}

const selectDevice = (device: Device) => {
  if (props.floatingMode) {
    props.onOpenDetailWindow?.(device.id)
    return
  }
  selectedDevice.value = device
}

const closeDetail = () => {
  selectedDevice.value = null
}

const normalizeDeviceCategory = (value: string | null | undefined, subtype?: string | null) => {
  const raw = (value || '').trim().toUpperCase()
  if (deviceCategoryOptions.includes(raw as typeof deviceCategoryOptions[number])) return raw
  const token = String(subtype || '').trim().toLowerCase().replace(/[-\s]+/g, '_')
  const map: Record<string, string> = {
    mic: 'MIC',
    preamp: 'PREAMP',
    interface: 'INTERFACE',
    compressor: 'COMPRESSOR',
    patchpanel: 'PATCHPANEL',
    patch_panel: 'PATCHPANEL',
    patchbay: 'PATCHPANEL',
    panel: 'PATCHPANEL',
    instrument: 'INSTRUMENT',
    synth: 'INSTRUMENT',
    drum_machine: 'INSTRUMENT',
    monitor: 'MONITOR',
    headphone_amp: 'HEADPHONE_AMP',
    eq: 'EQ',
    mixer: 'MIXER',
    controller: 'CONTROLLER',
    effects: 'EFFECTS',
    amp: 'AMP',
    reamp: 'REAMP',
  }
  return map[token] || fallbackDeviceCategory
}

const normalizeDeviceType = (value: string | null | undefined, category?: string | null) => {
  const token = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_')
  if (token) {
    if (token === 'patchbay' || token === 'panel' || token === 'patch_panel') return 'patchpanel'
    if (token === 'unknown') return 'other'
    return token
  }
  const defaults: Record<string, string> = {
    MIC: 'mic',
    PREAMP: 'preamp',
    INTERFACE: 'interface',
    COMPRESSOR: 'compressor',
    PATCHPANEL: 'patchpanel',
    INSTRUMENT: 'instrument',
    MONITOR: 'monitor',
    HEADPHONE_AMP: 'headphone_amp',
    EQ: 'eq',
    MIXER: 'mixer',
    CONTROLLER: 'controller',
    EFFECTS: 'effects',
    AMP: 'amp',
    REAMP: 'reamp',
    OTHER: 'other',
  }
  return defaults[String(category || fallbackDeviceCategory)] || fallbackDeviceType
}

const inferCatalogCategory = (item: ApiCatalogItemDetails) => {
  const tokens = [
    item.category_path || '',
    item.title || '',
    item.model || '',
    String(item.specs?.['Type'] || ''),
    String(item.specs?.['Connectivity'] || ''),
  ]
    .join(' ')
    .toLowerCase()

  if (tokens.includes('microphone') || tokens.includes('mic')) return 'MIC'
  if (tokens.includes('preamp')) return 'PREAMP'
  if (tokens.includes('interface')) return 'INTERFACE'
  if (tokens.includes('compressor')) return 'COMPRESSOR'
  if (tokens.includes('patch')) return 'PATCHPANEL'
  if (tokens.includes('monitor')) return 'MONITOR'
  if (tokens.includes('headphone')) return 'HEADPHONE_AMP'
  if (tokens.includes('mixer')) return 'MIXER'
  if (tokens.includes('controller')) return 'CONTROLLER'
  if (tokens.includes('effects')) return 'EFFECTS'
  if (tokens.includes('amp')) return 'AMP'
  return 'OTHER'
}

const clearCatalogSelection = () => {
  selectedCatalogExternalId.value = null
  selectedCatalogItem.value = null
  selectedCatalogSource.value = null
}

const loadCatalogStatus = async () => {
  canUseCatalog.value = false
  catalogStatusReason.value = null
  try {
    const status = await api.getCatalogStatus()
    const ebay = status.providers.find((provider) => provider.provider === 'EBAY')
    canUseCatalog.value = Boolean(status.enabled && ebay?.available)
    catalogStatusReason.value = ebay?.reason || null
  } catch {
    canUseCatalog.value = false
    catalogStatusReason.value = t.devices.catalogUnavailable
  }
}

const searchCatalog = async () => {
  const q = catalogQuery.value.trim()
  if (q.length < 2) {
    catalogResults.value = []
    catalogSearchError.value = t.devices.catalogSearchMin
    return
  }

  catalogSearchLoading.value = true
  catalogSearchError.value = null
  try {
    const response = await api.searchCatalog({ provider: 'EBAY', q, page: 1, page_size: 20 })
    catalogResults.value = response.items
    if (response.items.length === 0) {
      catalogSearchError.value = t.devices.catalogNoResults
    }
  } catch (err: any) {
    if (err?.message === 'AUTH_SERVICE_UNAVAILABLE') {
      catalogSearchError.value = t.devices.catalogUnavailable
    } else {
      catalogSearchError.value = err?.message || t.devices.catalogSearchFailed
    }
  } finally {
    catalogSearchLoading.value = false
  }
}

const applyCatalogItemToForm = (item: ApiCatalogItemDetails) => {
  const category = inferCatalogCategory(item)
  const type = normalizeDeviceType(item.model || '', category)
  const preferredName = [item.brand, item.model].filter(Boolean).join(' ').trim() || item.title

  newDevice.value = {
    name: preferredName || '',
    category,
    type,
  }
  newPorts.value = []
  selectedCatalogSource.value = {
    provider: item.provider,
    externalId: item.external_id,
    sourceUrl: item.source_url,
    importedSnapshot: {
      title: item.title,
      brand: item.brand,
      model: item.model,
      category_path: item.category_path,
      category_id: item.category_id,
      identifiers: item.identifiers || {},
      specs: item.specs || {},
      source_url: item.source_url || null,
    },
  }
}

const selectCatalogItem = async (item: ApiCatalogSearchItem) => {
  selectedCatalogExternalId.value = item.external_id
  catalogDetailsLoading.value = true
  try {
    const details = await api.getCatalogItem(item.provider, item.external_id)
    selectedCatalogItem.value = details
    applyCatalogItemToForm(details)
    addDeviceMode.value = 'manual'
  } catch (err: any) {
    if (err?.message === 'AUTH_SERVICE_UNAVAILABLE') {
      showError(t.devices.catalogUnavailable)
    } else {
      showError(err?.message || t.devices.catalogLoadFailed)
    }
  } finally {
    catalogDetailsLoading.value = false
  }
}

const saveDraft = () => {
  if (isEditing.value) return
  const draft = {
    device: newDevice.value,
    ports: newPorts.value,
  }
  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
}

const loadDraft = () => {
  const raw = localStorage.getItem(DRAFT_STORAGE_KEY) || localStorage.getItem(LEGACY_DRAFT_STORAGE_KEY)
  if (!raw) return
  try {
    const draft = JSON.parse(raw)
    if (draft?.device?.name !== undefined && draft?.device?.type !== undefined) {
      newDevice.value = {
        name: String(draft.device.name ?? ''),
        category: normalizeDeviceCategory(String(draft.device.category ?? ''), String(draft.device.type ?? '')),
        type: normalizeDeviceType(String(draft.device.type ?? fallbackDeviceType), String(draft.device.category ?? fallbackDeviceCategory)),
      }
    }
    if (Array.isArray(draft?.ports)) {
      newPorts.value = draft.ports
        .filter((port: any) => port?.label && port?.type)
        .map((port: any) => ({
          label: String(port.label),
          type: port.type as 'Input' | 'Output' | 'Other',
          patchbayId: port.patchbayId ?? null,
          id: port.id || undefined,
        }))
    }
  } catch (err) {
    console.warn('Failed to load add device draft', err)
  }
}

const clearDraft = () => {
  localStorage.removeItem(DRAFT_STORAGE_KEY)
  localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY)
}

const resetAddForm = (clear = false) => {
  newDevice.value = { name: '', category: fallbackDeviceCategory, type: fallbackDeviceType }
  newPorts.value = []
  addDeviceMode.value = 'manual'
  aiStatusMessage.value = null
  clearCatalogSelection()
  catalogQuery.value = ''
  catalogResults.value = []
  catalogSearchError.value = null
  if (aiPreviewUrl.value) {
    URL.revokeObjectURL(aiPreviewUrl.value)
  }
  aiPreviewUrl.value = null
  clearPendingImage()
  if (clear) {
    clearDraft()
  }
}

const closeAddModal = () => {
  showAddModal.value = false
  if (isEditing.value) {
    editingDeviceId.value = null
    editSnapshot.value = null
    resetAddForm()
  } else {
    saveDraft()
  }
  if (props.modalOnly) {
    props.onRequestCloseModalWindow?.()
  }
}

const openAddModal = () => {
  if (props.floatingMode && !props.modalOnly) {
    const parentId = props.modalParentWindowId || windowManager.getToolWindow('devices')?.id || 'tool:devices'
    windowManager.openChildWindow(
      parentId,
      'devices-add-edit',
      t.devices.addNewDevice,
      { mode: 'add', parentWindowId: parentId },
      { forceUnique: true },
    )
    return
  }
  showAddModal.value = true
  void loadCatalogStatus()
  loadDraft()
}

const openEditModal = (device: Device) => {
  if (props.floatingMode && !props.modalOnly) {
    const parentId = props.modalParentWindowId || windowManager.getToolWindow('devices')?.id || 'tool:devices'
    windowManager.openChildWindow(
      parentId,
      'devices-add-edit',
      t.devices.editDevice,
      { mode: 'edit', deviceId: device.id, parentWindowId: parentId },
      { forceUnique: true },
    )
    return
  }
  editingDeviceId.value = device.id
  editSnapshot.value = {
    device: {
      name: device.name,
      category: normalizeDeviceCategory(device.category, device.type),
      type: normalizeDeviceType(device.type, device.category),
    },
    ports: device.ports.map(port => ({ ...port })),
  }
  newDevice.value = {
    name: device.name,
    category: normalizeDeviceCategory(device.category, device.type),
    type: normalizeDeviceType(device.type, device.category),
  }
  newPorts.value = device.ports.map(port => ({
    id: port.id,
    label: port.label,
    type: port.type,
    patchbayId: port.patchbayId,
  }))
  addDeviceMode.value = 'manual'
  aiStatusMessage.value = null
  clearCatalogSelection()
  showAddModal.value = true
}

const setAiImageFile = (file: File | null) => {
  if (aiPreviewUrl.value) {
    URL.revokeObjectURL(aiPreviewUrl.value)
  }
  aiPreviewUrl.value = file ? URL.createObjectURL(file) : null
}

const setPendingImageFile = (file: File | null) => {
  // Revoke old preview URL to prevent memory leaks
  if (pendingImagePreviewUrl.value) {
    URL.revokeObjectURL(pendingImagePreviewUrl.value)
  }
  
  pendingImageFile.value = file
  pendingImagePreviewUrl.value = file ? URL.createObjectURL(file) : null
  pendingImageError.value = null
  
  // Validate file
  if (file) {
    if (!file.type.startsWith('image/')) {
      pendingImageError.value = 'Invalid file type. Please upload an image file (JPG, PNG, etc.)'
      pendingImageFile.value = null
      pendingImagePreviewUrl.value = null
    } else if (file.size > 12 * 1024 * 1024) {
      pendingImageError.value = 'Image too large. Maximum size is 12MB.'
      pendingImageFile.value = null
      pendingImagePreviewUrl.value = null
    }
  }
}

const clearPendingImage = () => {
  if (pendingImagePreviewUrl.value) {
    URL.revokeObjectURL(pendingImagePreviewUrl.value)
  }
  pendingImageFile.value = null
  pendingImagePreviewUrl.value = null
  pendingImageError.value = null
}

const getDeviceImageState = (device: Device) => {
  return deviceImages.getState(device, orgId.value)
}

const requestDeviceImage = (device: Device) => {
  deviceImages.request(device, orgId.value, { priority: 'high' })
}

const retryDeviceImage = (device: Device) => {
  deviceImages.invalidateDevice(device.id, orgId.value)
  requestDeviceImage(device)
}

const isImageLoading = (state: ReturnType<typeof getDeviceImageState>) => {
  return state.status === 'idle' || state.status === 'loading'
}

const isImageRetryable = (state: ReturnType<typeof getDeviceImageState>) => {
  return ['timeout', 'error', 'unauthorized', 'aborted'].includes(state.status)
}

const imageStatusLabel = (state: ReturnType<typeof getDeviceImageState>) => {
  if (state.status === 'forbidden') return t.devices.imageNoAccess || 'Sin permisos'
  if (state.status === 'not_found') return t.devices.imageMissing || 'Sin imagen'
  if (state.status === 'timeout') return t.devices.imageTimeout || 'Tiempo agotado'
  if (state.status === 'unauthorized') return t.devices.imageUnauthorized || 'Sesión expirada'
  if (state.status === 'error') return t.devices.imageLoadFailed || 'Error al cargar'
  return t.devices.imageLoading || 'Cargando...'
}

watch(filteredDevices, (devices) => {
  const ids = new Set(devices.map(device => device.id))
  deviceImages.abortNotInSet(ids, orgId.value)
  schedulePrefetch(devices)
}, { immediate: true })

watch(() => selectedDevice.value?.id, () => {
  if (selectedDevice.value) {
    requestDeviceImage(selectedDevice.value)
  }
})

watch(() => showAddModal.value, (open) => {
  if (!open) return
  if (isEditing.value && selectedDevice.value?.imageUrl) {
    requestDeviceImage(selectedDevice.value)
  }
})

watch(() => store.activeTab, (tab) => {
  if (props.floatingMode) return
  if (tab !== 'devices') {
    deviceImages.abortAll()
  }
})

watchEffect(() => {
  if (!import.meta.env.DEV) return
  deviceImages.version.value
  const now = Date.now()
  if (now - lastDeviceImageLog > 30000) {
    lastDeviceImageLog = now
    console.debug('[DeviceImages]', deviceImages.getStats())
  }
})

const handleResetForm = () => {
  if (isEditing.value && editSnapshot.value) {
    newDevice.value = { ...editSnapshot.value.device }
    newPorts.value = editSnapshot.value.ports.map(port => ({
      id: port.id,
      label: port.label,
      type: port.type,
      patchbayId: port.patchbayId,
    }))
    aiStatusMessage.value = null
    clearCatalogSelection()
    return
  }
  resetAddForm(true)
}

const handleAiFileChange = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  const allowed = guardAiDetection({
    enabled: canUseAiDetection.value,
    remaining: quotaStore.aiDetectionRemaining,
    onEntitlement: () => showError(t.devices.aiNotIncluded),
    onQuota: () => showError(strings.toast.quotaExceeded),
  })
  if (!allowed) return

  setAiImageFile(file)
  // Also set as pending image for auto-attach
  setPendingImageFile(file)
  selectedCatalogSource.value = null
  aiStatusMessage.value = null
  aiLoading.value = true

  try {
    const { device, headers } = await api.parseDeviceFromImageWithMeta(file)
    const quotaUpdated = quotaStore.updateFromQuotaHeaders(headers)
    if (!quotaUpdated) {
      quotaStore.recordAiDetectionSuccess()
    }
    newDevice.value = {
      name: device.name || '',
      category: normalizeDeviceCategory(device.category, device.type),
      type: normalizeDeviceType(device.type, device.category),
    }
    newPorts.value = device.ports.map((port) => ({
      label: port.label,
      type: port.type,
      patchbayId: null,
    }))
    aiStatusMessage.value = t.devices.aiDraftReady
  } catch (err: any) {
    if (err?.message === 'ENTITLEMENT_REQUIRED') {
      showError(strings.toast.entitlementRequired)
    } else if (err?.message === 'QUOTA_EXCEEDED' || err?.message === 'LIMIT_REACHED') {
      showError(strings.toast.quotaExceeded)
    } else if (err?.message === 'PAYMENT_REQUIRED') {
      showError(strings.toast.paymentRequired)
    } else {
      showError(err.message || strings.toast.imageParseFailed)
    }
    console.error('Error parsing device image:', err)
  } finally {
    aiLoading.value = false
  }
}

const handleManualImageChange = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  
  setPendingImageFile(file)
}

const handleAddDevice = async () => {
  if (newPorts.value.length === 0) {
    showError(t.devices.validation.addPortFirst)
    return
  }
  if (!newDevice.value.name.trim()) {
    showError(t.devices.validation.nameRequired)
    return
  }

  isLoading.value = true

  try {
    const ports: DevicePort[] = newPorts.value.map((p) => ({
      id: p.id || '',
      label: p.label,
      type: p.type,
      patchbayId: p.patchbayId ?? null,
    }))

    let deviceId: number

    if (isEditing.value && editingDeviceId.value !== null) {
      const updated = await store.updateDevice(editingDeviceId.value, {
        name: newDevice.value.name,
        category: newDevice.value.category,
        type: newDevice.value.type,
        ports,
      })
      deviceId = updated.id
      
      // Update selectedDevice reference
      if (selectedDevice.value?.id === deviceId) {
        selectedDevice.value = updated
      }
    } else {
      const created = await store.addDevice({
        name: newDevice.value.name,
        category: newDevice.value.category,
        type: newDevice.value.type,
        ports,
        catalogSource: selectedCatalogSource.value
          ? {
              provider: selectedCatalogSource.value.provider,
              externalId: selectedCatalogSource.value.externalId,
              sourceUrl: selectedCatalogSource.value.sourceUrl,
              importedSnapshot: selectedCatalogSource.value.importedSnapshot,
            }
          : null,
      })
      deviceId = created.id
    }

    // Upload image if one is pending
    if (pendingImageFile.value) {
      try {
        isUploadingImage.value = true
        const updatedDevice = await store.uploadDeviceImage(deviceId, pendingImageFile.value)
        
        // Update selectedDevice reference if needed
        if (selectedDevice.value?.id === deviceId) {
          selectedDevice.value = updatedDevice
        }
        requestDeviceImage(updatedDevice)
      } catch (imgErr: any) {
        showError(`Device saved, but image upload failed: ${imgErr.message || 'Unknown error'}`)
        console.error('Error uploading device image:', imgErr)
      } finally {
        isUploadingImage.value = false
      }
    }

    store.pushToast({ type: 'success', message: strings.toast.deviceSaved })
    showAddModal.value = false
    editingDeviceId.value = null
    editSnapshot.value = null
    resetAddForm(true)
  } catch (err: any) {
    showError(err.message || strings.toast.deviceSaveFailed)
    console.error('Error saving device:', err)
  } finally {
    isLoading.value = false
  }
}

const requestDeleteDevice = (device: Device) => {
  if (props.floatingMode) {
    const parentId = props.modalParentWindowId || windowManager.getToolWindow('devices')?.id || 'tool:devices'
    windowManager.openChildWindow(
      parentId,
      'devices-delete-confirm',
      t.confirm.deleteDeviceTitle,
      {
        deviceId: device.id,
        deviceName: device.name,
        sourceWindowId: props.modalOnly ? parentId : null,
      },
      { forceUnique: true },
    )
    return
  }
  deleteTarget.value = device
}

const confirmDeleteDevice = async () => {
  if (!deleteTarget.value) return
  isLoading.value = true
  try {
    await store.deleteDevice(deleteTarget.value.id)
    store.pushToast({ type: 'success', message: strings.toast.deviceDeleted })
    if (selectedDevice.value?.id === deleteTarget.value.id) {
      closeDetail()
    }
  } catch (err: any) {
    showError(err.message || strings.toast.deviceDeleteFailed)
    console.error('Error deleting device:', err)
  } finally {
    isLoading.value = false
    deleteTarget.value = null
  }
}

const cancelDeleteDevice = () => {
  deleteTarget.value = null
}

const isPortConnected = (port: DevicePort) => port.patchbayId !== null

const linkPortToPatchbay = (port: DevicePort) => {
  if (!selectedDevice.value) return
  store.startLinkingPort(
    {
      portId: port.id,
      deviceId: selectedDevice.value.id,
      deviceName: selectedDevice.value.name,
      portLabel: port.label,
    },
    {
      returnTab: 'devices',
      returnPayload: { deviceId: selectedDevice.value.id },
    },
  )
}

const unlinkPortFromDevice = async (port: DevicePort) => {
  if (!selectedDevice.value) return
  await store.unlinkPort(selectedDevice.value.id, port.id)
}

const goToPatchPoint = (port: DevicePort) => {
  if (port.patchbayId === null) return
  store.patchbayFocusId = port.patchbayId
  store.setTab('patchbay')
}

const patchTargetLabel = (port: DevicePort) => {
  if (port.patchbayId === null) return ''
  return t.devices.goToPatch(port.patchbayId)
}

const deviceClassificationLabel = (device: Device) => {
  const subtype = normalizeDeviceType(device.type, device.category)
  if (!subtype || subtype === 'other') return device.category
  return `${device.category} · ${subtype}`
}

watch([newDevice, newPorts], () => {
  if (showAddModal.value && !isEditing.value) {
    saveDraft()
  }
}, { deep: true })

watch(() => store.focusDeviceId, (deviceId) => {
  if (!deviceId) return
  const device = store.devices.find((item) => item.id === deviceId)
  if (device) {
    if (props.floatingMode) {
      props.onOpenDetailWindow?.(device.id)
    } else {
      selectedDevice.value = device
    }
  }
  store.clearDeviceFocus()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateViewport)
  if (observer.value) {
    observer.value.disconnect()
  }
  elementToDeviceId.clear()
  if (aiPreviewUrl.value) {
    URL.revokeObjectURL(aiPreviewUrl.value)
  }
  if (pendingImagePreviewUrl.value) {
    URL.revokeObjectURL(pendingImagePreviewUrl.value)
  }
})

onMounted(() => {
  if (!props.modalOnly) return
  if (props.modalMode === 'edit' && props.modalDeviceId) {
    const device = store.devices.find((item) => item.id === props.modalDeviceId)
    if (device) {
      openEditModal(device)
      return
    }
  }
  openAddModal()
})
</script>

<template>
  <div class="devices-container" :class="{ 'floating-mode': props.floatingMode, 'modal-only': props.modalOnly }">
    <template v-if="!props.modalOnly">
    <div class="header">
      <div class="title-block">
        <h2>{{ t.devices.title }}</h2>
        <span v-if="isLoading" class="status-pill">{{ t.devices.saving }}</span>
      </div>
      <div class="header-actions">
        <input
          v-model="searchQuery"
          :placeholder="t.devices.searchPlaceholder"
          class="search-input"
        />
        <button class="add-btn" @click="openAddModal">{{ t.devices.addDevice }}</button>
      </div>
    </div>
    </template>

    <div v-if="!props.modalOnly" class="devices-layout">
      <div class="devices-list">
        <div
          v-for="device in filteredDevices"
          :key="device.id"
          class="device-card"
          :class="{ active: selectedDevice?.id === device.id }"
          :ref="registerDeviceCard(device.id)"
          @click="selectDevice(device)"
        >
          <div v-if="device.imageUrl" class="device-thumbnail">
            <img
              v-if="getDeviceImageState(device).status === 'loaded' && getDeviceImageState(device).src"
              :src="getDeviceImageState(device).src || ''"
              :alt="device.name"
              loading="lazy"
            />
            <div
              v-else
              class="device-thumbnail-placeholder"
              :class="{ 'is-loading': isImageLoading(getDeviceImageState(device)) }"
            >
              <div v-if="isImageLoading(getDeviceImageState(device))" class="image-skeleton"></div>
              <div v-else class="image-fallback">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <circle cx="8.5" cy="8.5" r="1.5"></circle>
                  <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
                <span class="image-status">{{ imageStatusLabel(getDeviceImageState(device)) }}</span>
                <button
                  v-if="isImageRetryable(getDeviceImageState(device))"
                  class="retry-btn"
                  type="button"
                  @click.stop="retryDeviceImage(device)"
                >
                  {{ t.app.retry }}
                </button>
              </div>
            </div>
          </div>
          <div v-else class="device-thumbnail-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
          </div>
          <div class="device-header">
            <h3>{{ device.name }}</h3>
            <div class="device-meta">
              <span class="device-type">{{ deviceClassificationLabel(device) }}</span>
              <button class="edit-btn" @click.stop="openEditModal(device)" :aria-label="t.devices.editDevice">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 16.25V20h3.75L19.81 7.94l-3.75-3.75L4 16.25zm14.71-9.46a1 1 0 0 0 0-1.41l-1.09-1.09a1 1 0 0 0-1.41 0l-1.13 1.13 3.75 3.75 1.88-1.88z"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="device-info">
            <span>{{ t.devices.portsCount(device.ports.length) }}</span>
          </div>
        </div>
      </div>

      <div v-if="selectedDevice && isDesktop && !props.floatingMode" class="device-detail-panel">
        <div class="panel-header">
          <div class="panel-title">
            <h3>{{ selectedDevice.name }}</h3>
            <span class="device-type">{{ deviceClassificationLabel(selectedDevice) }}</span>
          </div>
          <div class="panel-actions">
            <button class="ghost-btn" @click="openEditModal(selectedDevice)">{{ t.devices.editDevice }}</button>
            <button class="ghost-btn" @click="closeDetail">{{ t.devices.closeDetail }}</button>
          </div>
        </div>

        <div class="device-details">
          <div v-if="selectedDevice.imageUrl" class="device-detail-image">
            <img
              v-if="getDeviceImageState(selectedDevice).status === 'loaded' && getDeviceImageState(selectedDevice).src"
              :src="getDeviceImageState(selectedDevice).src || ''"
              :alt="selectedDevice.name"
            />
            <div
              v-else
              class="device-detail-placeholder"
              :class="{ 'is-loading': isImageLoading(getDeviceImageState(selectedDevice)) }"
            >
              <div v-if="isImageLoading(getDeviceImageState(selectedDevice))" class="image-skeleton"></div>
              <div v-else class="image-fallback">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <circle cx="8.5" cy="8.5" r="1.5"></circle>
                  <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
                <span class="image-status">{{ imageStatusLabel(getDeviceImageState(selectedDevice)) }}</span>
                <button
                  v-if="isImageRetryable(getDeviceImageState(selectedDevice))"
                  class="retry-btn"
                  type="button"
                  @click.stop="retryDeviceImage(selectedDevice)"
                >
                  {{ t.app.retry }}
                </button>
              </div>
            </div>
          </div>
          
          <p><strong>{{ t.devices.typeLabel }}:</strong> {{ deviceClassificationLabel(selectedDevice) }}</p>
          <p><strong>{{ t.devices.idLabel }}:</strong> {{ selectedDevice.id }}</p>

          <h4>{{ t.devices.portsConfig }}</h4>
          <div class="ports-list">
            <div v-for="port in selectedDevice.ports" :key="port.id" class="port-item">
              <div class="port-info">
                <span class="port-label">{{ port.label }}</span>
                <span class="port-type">{{ t.devices.portTypes[port.type] }}</span>
              </div>

              <div class="port-actions">
                <span class="port-connection" :class="{ empty: !isPortConnected(port) }">
                  {{ isPortConnected(port) ? t.devices.connected : t.devices.notConnected }}
                </span>
                <button
                  v-if="port.patchbayId === null"
                  class="link-action-btn link"
                  type="button"
                  @click="linkPortToPatchbay(port)"
                >
                  {{ t.devices.link }}
                </button>
                <button
                  v-else
                  class="link-action-btn ghost"
                  type="button"
                  @click="goToPatchPoint(port)"
                >
                  {{ patchTargetLabel(port) }}
                </button>
                <button
                  v-if="port.patchbayId !== null"
                  class="link-action-btn unlink"
                  type="button"
                  @click="unlinkPortFromDevice(port)"
                >
                  {{ t.devices.unlink }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="panel-footer">
          <button class="delete-btn" @click="requestDeleteDevice(selectedDevice)">{{ t.devices.deleteDevice }}</button>
        </div>
      </div>
    </div>

    <div v-if="selectedDevice && !isDesktop && !props.floatingMode" class="modal-overlay" @click="closeDetail">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h2>{{ selectedDevice.name }}</h2>
          <button class="close-btn" @click="closeDetail">{{ t.app.closeSymbol }}</button>
        </div>

        <div class="device-details">
          <div v-if="selectedDevice.imageUrl" class="device-detail-image">
            <img
              v-if="getDeviceImageState(selectedDevice).status === 'loaded' && getDeviceImageState(selectedDevice).src"
              :src="getDeviceImageState(selectedDevice).src || ''"
              :alt="selectedDevice.name"
            />
            <div
              v-else
              class="device-detail-placeholder"
              :class="{ 'is-loading': isImageLoading(getDeviceImageState(selectedDevice)) }"
            >
              <div v-if="isImageLoading(getDeviceImageState(selectedDevice))" class="image-skeleton"></div>
              <div v-else class="image-fallback">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <circle cx="8.5" cy="8.5" r="1.5"></circle>
                  <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
                <span class="image-status">{{ imageStatusLabel(getDeviceImageState(selectedDevice)) }}</span>
                <button
                  v-if="isImageRetryable(getDeviceImageState(selectedDevice))"
                  class="retry-btn"
                  type="button"
                  @click.stop="retryDeviceImage(selectedDevice)"
                >
                  {{ t.app.retry }}
                </button>
              </div>
            </div>
          </div>
          
          <p><strong>{{ t.devices.typeLabel }}:</strong> {{ deviceClassificationLabel(selectedDevice) }}</p>
          <p><strong>{{ t.devices.idLabel }}:</strong> {{ selectedDevice.id }}</p>

          <h3>{{ t.devices.portsConfig }}</h3>
          <div class="ports-list">
            <div v-for="port in selectedDevice.ports" :key="port.id" class="port-item">
              <div class="port-info">
                <span class="port-label">{{ port.label }}</span>
                <span class="port-type">{{ t.devices.portTypes[port.type] }}</span>
              </div>

              <div class="port-actions">
                <span class="port-connection" :class="{ empty: !isPortConnected(port) }">
                  {{ isPortConnected(port) ? t.devices.connected : t.devices.notConnected }}
                </span>
                <button
                  v-if="port.patchbayId === null"
                  class="link-action-btn link"
                  type="button"
                  @click="linkPortToPatchbay(port)"
                >
                  {{ t.devices.link }}
                </button>
                <button
                  v-else
                  class="link-action-btn ghost"
                  type="button"
                  @click="goToPatchPoint(port)"
                >
                  {{ patchTargetLabel(port) }}
                </button>
                <button
                  v-if="port.patchbayId !== null"
                  class="link-action-btn unlink"
                  type="button"
                  @click="unlinkPortFromDevice(port)"
                >
                  {{ t.devices.unlink }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-actions">
          <button class="delete-btn" @click="requestDeleteDevice(selectedDevice)">{{ t.devices.deleteDevice }}</button>
        </div>
      </div>
    </div>

    <div
      v-if="showAddModal"
      :class="props.modalOnly ? 'modal-inline-host' : 'modal-overlay'"
      @click="!props.modalOnly && closeAddModal()"
    >
      <div class="modal-content small add-device-modal" @click.stop>
        <div class="modal-header">
          <h2>{{ isEditing ? t.devices.editDevice : t.devices.addNewDevice }}</h2>
          <button class="close-btn" @click="closeAddModal">{{ t.app.closeSymbol }}</button>
        </div>
        <div class="add-device-tabs">
          <button
            class="tab-btn"
            :class="{ active: addDeviceMode === 'manual' }"
            @click="addDeviceMode = 'manual'"
          >
            {{ t.devices.tabManual }}
          </button>
          <button
            class="tab-btn"
            :class="{ active: addDeviceMode === 'ai', disabled: !canUseAiDetection }"
            :disabled="!canUseAiDetection"
            :title="!canUseAiDetection ? t.devices.aiNotIncluded : ''"
            @click="addDeviceMode = 'ai'"
          >
            {{ t.devices.tabAutoDetect }}
          </button>
          <button
            v-if="!isEditing"
            class="tab-btn"
            :class="{ active: addDeviceMode === 'catalog', disabled: !canUseCatalog }"
            :disabled="!canUseCatalog"
            :title="!canUseCatalog ? (catalogStatusReason || t.devices.catalogUnavailable) : ''"
            @click="addDeviceMode = 'catalog'"
          >
            {{ t.devices.tabCatalog }}
          </button>
        </div>
        <div class="form-content">
          <div v-if="addDeviceMode === 'manual'" class="manual-form">
            <div class="form-group">
              <label>{{ t.devices.nameLabel }}</label>
              <input v-model="newDevice.name" :placeholder="t.devices.namePlaceholder" />
            </div>
            <div class="form-group">
              <label>{{ t.devices.categoryLabel || 'Category' }}</label>
              <select v-model="newDevice.category">
                <option v-for="option in deviceCategoryOptions" :key="option" :value="option">
                  {{ option }}
                </option>
              </select>
            </div>
            <div class="form-group">
              <label>{{ t.devices.typeLabel }}</label>
              <input v-model="newDevice.type" :placeholder="t.devices.subtypePlaceholder || 'Subtype'" />
            </div>
            <p v-if="selectedCatalogSource && newPorts.length === 0" class="help-text">
              {{ t.devices.catalogPortsHint }}
            </p>
            <div class="form-group">
              <label>Device Image (optional)</label>
              <p class="help-text">Maximum 12MB. Supported formats: JPG, PNG, WebP</p>
              <label class="ai-upload-btn">
                {{ pendingImagePreviewUrl || (isEditing && selectedDevice?.imageUrl) ? 'Change Image' : 'Upload Image' }}
                <input 
                  type="file" 
                  accept="image/*" 
                  @change="handleManualImageChange"
                  class="ai-file-input"
                />
              </label>
              <div v-if="pendingImageError" class="error-text">{{ pendingImageError }}</div>
              <div v-if="pendingImagePreviewUrl" class="ai-preview">
                <img :src="pendingImagePreviewUrl" alt="Preview" />
              </div>
              <div v-else-if="isEditing && selectedDevice?.imageUrl && !pendingImageFile" class="ai-preview">
                <img
                  v-if="getDeviceImageState(selectedDevice).status === 'loaded' && getDeviceImageState(selectedDevice).src"
                  :src="getDeviceImageState(selectedDevice).src || ''"
                  :alt="selectedDevice.name"
                />
                <div
                  v-else
                  class="device-detail-placeholder"
                  :class="{ 'is-loading': isImageLoading(getDeviceImageState(selectedDevice)) }"
                >
                  <div v-if="isImageLoading(getDeviceImageState(selectedDevice))" class="image-skeleton"></div>
                  <div v-else class="image-fallback">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                      <circle cx="8.5" cy="8.5" r="1.5"></circle>
                      <polyline points="21 15 16 10 5 21"></polyline>
                    </svg>
                    <span class="image-status">{{ imageStatusLabel(getDeviceImageState(selectedDevice)) }}</span>
                    <button
                      v-if="isImageRetryable(getDeviceImageState(selectedDevice))"
                      class="retry-btn"
                      type="button"
                      @click.stop="retryDeviceImage(selectedDevice)"
                    >
                      {{ t.app.retry }}
                    </button>
                  </div>
                </div>
              </div>
              <button v-if="pendingImagePreviewUrl" class="ghost-btn" @click="clearPendingImage" type="button" style="margin-top: 8px;">Remove Image</button>
            </div>
            <div class="form-group ports-section">
              <div class="ports-header">
                <label>{{ t.devices.portsLabel }}</label>
                <button class="add-port-btn" @click="addPort">{{ t.devices.addPort }}</button>
              </div>
              <div class="ports-editor">
                <div v-for="(port, index) in newPorts" :key="index" class="port-edit-row">
                  <input v-model="port.label" :placeholder="t.devices.portNamePlaceholder" class="port-name-input" />
                  <select v-model="port.type" class="port-type-select">
                    <option v-for="option in portTypeOptions" :key="option" :value="option">
                      {{ t.devices.portTypes[option] }}
                    </option>
                  </select>
                  <button class="remove-port-btn" @click="removePort(index)">{{ t.devices.removePort }}</button>
                </div>
                <div v-if="newPorts.length === 0" class="ports-empty">
                  {{ t.devices.noPorts }}
                </div>
              </div>
            </div>
          </div>

          <div v-else-if="addDeviceMode === 'ai'" class="ai-form">
            <div class="ai-stepper">
              <span :class="{ active: aiStep === 'upload' }">{{ t.devices.aiSteps.upload }}</span>
              <span :class="{ active: aiStep === 'processing' }">{{ t.devices.aiSteps.processing }}</span>
              <span :class="{ active: aiStep === 'review' }">{{ t.devices.aiSteps.review }}</span>
            </div>
            <p class="ai-help">{{ t.devices.aiHelp }}</p>
            <label class="ai-upload-btn" :class="{ disabled: aiUploadDisabled }" :title="aiUploadDisabledReason">
              {{ t.devices.aiUpload }}
              <input
                class="ai-file-input"
                type="file"
                accept="image/*"
                capture="environment"
                @change="handleAiFileChange"
                :disabled="aiUploadDisabled"
              />
            </label>
            <p v-if="aiQuotaLabel" class="ai-quota">{{ aiQuotaLabel }}</p>
            <div v-if="aiPreviewUrl" class="ai-preview">
              <img :src="aiPreviewUrl" alt="Device preview" />
              <p class="help-text">This image will be attached to the device when you save.</p>
            </div>
            <div v-if="aiLoading" class="ai-progress">
              <span class="spinner"></span>
              <span>{{ t.devices.aiProcessing }}</span>
            </div>
            <div v-if="aiStatusMessage" class="ai-status">
              {{ aiStatusMessage }}
              <button class="ghost-btn" @click="addDeviceMode = 'manual'">
                {{ t.devices.aiReviewDraft }}
              </button>
            </div>
          </div>
          <div v-else class="catalog-form">
            <p class="help-text">{{ t.devices.catalogHelp }}</p>
            <div class="catalog-search-row">
              <input
                v-model="catalogQuery"
                class="search-input"
                :placeholder="t.devices.catalogSearchPlaceholder"
                @keyup.enter="searchCatalog"
              />
              <button class="add-btn" type="button" @click="searchCatalog" :disabled="catalogSearchLoading">
                {{ catalogSearchLoading ? t.devices.catalogSearching : t.devices.catalogSearchAction }}
              </button>
            </div>
            <p v-if="catalogSearchError" class="error-text">{{ catalogSearchError }}</p>
            <div class="catalog-results">
              <button
                v-for="item in catalogResults"
                :key="item.external_id"
                type="button"
                class="catalog-result-card"
                :class="{ active: selectedCatalogExternalId === item.external_id }"
                @click="selectCatalogItem(item)"
              >
                <img v-if="item.thumbnail" :src="item.thumbnail" :alt="item.title" />
                <div class="catalog-result-body">
                  <strong>{{ item.title }}</strong>
                  <span v-if="item.brand || item.model">{{ [item.brand, item.model].filter(Boolean).join(' ') }}</span>
                  <small v-if="item.short_specs?.length">{{ item.short_specs.join(' • ') }}</small>
                </div>
              </button>
            </div>
            <p v-if="catalogDetailsLoading" class="help-text">{{ t.devices.catalogLoadingDetails }}</p>
            <p v-if="selectedCatalogItem" class="help-text">
              {{ t.devices.catalogSelectedHint }}
            </p>
          </div>
        </div>
        <div class="form-footer">
          <button class="reset-btn" @click="handleResetForm" type="button">{{ t.devices.resetForm }}</button>
          <button 
            class="save-btn" 
            @click="handleAddDevice" 
            :disabled="!newDevice.name || newPorts.length === 0 || isUploadingImage"
          >
            <span v-if="isUploadingImage">Uploading image...</span>
            <span v-else>{{ isEditing ? t.devices.updateDevice : t.devices.createDevice }}</span>
          </button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      v-if="deleteTarget && !props.floatingMode"
      :title="t.confirm.deleteDeviceTitle"
      :message="t.confirm.deleteDeviceMessage(deleteTarget.name)"
      @confirm="confirmDeleteDevice"
      @cancel="cancelDeleteDevice"
    />
  </div>
</template>

<style scoped>
.devices-container {
  padding: var(--space-5);
  color: var(--text-primary);
  height: 100%;
  overflow: auto;
  background: var(--surface-1);
  border-radius: var(--radius-3);
  border: 1px solid var(--border-default);
  box-shadow: var(--shadow-1);
}

.devices-container.floating-mode {
  padding: 0;
  background: transparent;
  border: none;
  box-shadow: none;
}

.devices-container.modal-only {
  overflow: visible;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-4);
  flex-wrap: wrap;
  gap: var(--space-3);
}

.title-block {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.status-pill {
  padding: 4px 10px;
  border-radius: var(--radius-round);
  background: rgba(212, 154, 79, 0.2);
  border: 1px solid rgba(212, 154, 79, 0.5);
  color: var(--warning);
  font-size: 0.8rem;
}

.header-actions {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.search-input {
  padding: 8px 12px;
  background-color: var(--surface-2);
  border: 1px solid var(--border-default);
  color: var(--text-primary);
  border-radius: var(--radius-2);
  min-width: 220px;
}

.add-btn {
  background-color: var(--accent);
  color: #0f120e;
  border: none;
  padding: 8px 16px;
  border-radius: var(--radius-2);
  cursor: pointer;
  font-weight: 600;
}

.devices-layout {
  display: grid;
  grid-template-columns: minmax(280px, 360px) 1fr;
  gap: var(--space-4);
}

.devices-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.device-card {
  background-color: var(--surface-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-3);
  padding: var(--space-3);
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
}

.device-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-1);
}

.device-card.active {
  border-color: rgba(61, 122, 88, 0.6);
}

.device-header {
  display: flex;
  justify-content: space-between;
  align-items: start;
  margin-bottom: var(--space-2);
}

.device-header h3 {
  margin: 0;
  font-size: 1.1rem;
  color: var(--text-primary);
}

.device-type {
  font-size: 0.8rem;
  background-color: var(--surface-3);
  padding: 2px 8px;
  border-radius: var(--radius-2);
  color: var(--text-secondary);
}

.device-meta {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.edit-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-2);
  border: 1px solid var(--border-default);
  background-color: var(--surface-1);
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.edit-btn svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
}

.edit-btn:hover {
  border-color: var(--accent);
  color: var(--text-primary);
}

.device-info {
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.device-detail-panel {
  background: var(--surface-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-3);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 360px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
}

.panel-title h3 {
  margin: 0 0 4px;
}

.panel-actions {
  display: flex;
  gap: var(--space-2);
}

.device-details h4 {
  margin-top: var(--space-4);
}

.ports-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.port-item {
  background-color: var(--surface-1);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-2);
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 1px solid var(--border-default);
}

.port-info {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.port-label {
  font-weight: 600;
  color: var(--text-primary);
}

.port-type {
  font-size: 0.75rem;
  padding: 2px 6px;
  border-radius: var(--radius-1);
  text-transform: uppercase;
  background: var(--surface-3);
  color: var(--text-muted);
}

.port-actions {
  display: flex;
  align-items: center;
}

.port-connection {
  font-size: 0.85rem;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.port-connection.empty {
  color: var(--text-muted);
  font-style: italic;
}

.link-action-btn {
  padding: 4px 8px;
  border-radius: var(--radius-1);
  border: none;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 600;
}

.link-action-btn.link {
  background-color: var(--accent);
  color: #0f120e;
}

.link-action-btn.unlink {
  background-color: var(--danger);
  color: #fef7ee;
}

.link-action-btn.ghost {
  background: transparent;
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
}

.panel-footer {
  display: flex;
  justify-content: flex-end;
}

.delete-btn {
  background-color: var(--danger);
  color: #fef7ee;
  border: none;
  padding: 8px 16px;
  border-radius: var(--radius-2);
  cursor: pointer;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(7, 6, 5, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-inline-host {
  position: relative;
  display: block;
  background: transparent;
}

.modal-content {
  background-color: var(--surface-2);
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  border-radius: var(--radius-3);
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-2);
  border: 1px solid var(--border-default);
}

.modal-content.small {
  max-width: 420px;
}

.modal-content.add-device-modal {
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  max-width: 520px;
}

.modal-content.add-device-modal .form-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
}

.manual-form,
.ai-form {
  padding: var(--space-4);
}

.catalog-form {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.catalog-search-row {
  display: flex;
  gap: var(--space-2);
}

.catalog-search-row .search-input {
  flex: 1;
  min-width: 0;
}

.catalog-results {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-height: 260px;
  overflow: auto;
}

.catalog-result-card {
  width: 100%;
  display: flex;
  gap: var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  background: var(--surface-1);
  color: var(--text-primary);
  padding: var(--space-2);
  cursor: pointer;
  text-align: left;
}

.catalog-result-card.active {
  border-color: var(--accent);
}

.catalog-result-card img {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: var(--radius-1);
}

.catalog-result-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.add-device-tabs {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--border-default);
  background-color: var(--surface-2);
}

.tab-btn {
  flex: 1;
  padding: 8px 10px;
  border-radius: var(--radius-2);
  border: 1px solid var(--border-default);
  background-color: var(--surface-1);
  color: var(--text-secondary);
  font-weight: 600;
  cursor: pointer;
}

.tab-btn.active {
  background-color: var(--accent);
  color: #0f120e;
  border-color: var(--accent);
}

.tab-btn.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.form-footer {
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border-default);
  background-color: var(--surface-2);
  display: flex;
  gap: var(--space-2);
}

.form-footer .save-btn {
  flex: 1;
  margin-top: 0;
}

.reset-btn {
  background-color: var(--surface-3);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  padding: 10px;
  border-radius: var(--radius-2);
  cursor: pointer;
  font-weight: 600;
  flex: 1;
}

.modal-header {
  padding: var(--space-4);
  border-bottom: 1px solid var(--border-default);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header h2 {
  margin: 0;
  color: var(--text-primary);
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.5rem;
  cursor: pointer;
}

.device-details {
  padding: var(--space-4);
  overflow-y: auto;
}

.modal-actions {
  padding: var(--space-4);
  border-top: 1px solid var(--border-default);
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.form-content {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.form-group label {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.form-group input,
.form-group select {
  padding: 8px;
  background-color: var(--surface-1);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  color: var(--text-primary);
}

.ai-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.ai-stepper {
  display: flex;
  gap: var(--space-2);
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-muted);
}

.ai-stepper span.active {
  color: var(--accent-2);
}

.ai-help {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.ai-upload-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 12px;
  border-radius: var(--radius-2);
  border: 1px dashed var(--border-default);
  background-color: var(--surface-1);
  color: var(--text-primary);
  cursor: pointer;
  font-weight: 600;
}

.ai-upload-btn.disabled {
  opacity: 0.6;
  cursor: not-allowed;
  border-color: var(--border-subtle);
  color: var(--text-tertiary);
}

.ai-file-input {
  display: none;
}

.ai-quota {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 0.85rem;
}

.ai-preview {
  border-radius: var(--radius-2);
  border: 1px solid var(--border-default);
  overflow: hidden;
  max-height: 200px;
}

.ai-preview img {
  width: 100%;
  height: auto;
  display: block;
  object-fit: cover;
}

.ai-progress {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-secondary);
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-default);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.ai-status {
  color: var(--accent-2);
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.save-btn {
  background-color: var(--accent);
  color: #0f120e;
  border: none;
  padding: 10px;
  border-radius: var(--radius-2);
  cursor: pointer;
  font-weight: 600;
  margin-top: 10px;
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ports-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-height: 200px;
  overflow-y: auto;
  padding-right: 4px;
}

.ports-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.ports-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.ports-header .add-port-btn {
  margin: 0;
  padding: 4px 10px;
  font-size: 0.85rem;
}

.ports-empty {
  color: var(--text-muted);
  font-style: italic;
  text-align: center;
  padding: var(--space-4);
  background-color: var(--surface-1);
  border-radius: var(--radius-2);
  border: 1px dashed var(--border-default);
}

.port-edit-row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.port-name-input {
  flex: 1;
  padding: 6px 8px;
  background-color: var(--surface-1);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  color: var(--text-primary);
}

.port-type-select {
  padding: 6px 8px;
  background-color: var(--surface-1);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  color: var(--text-primary);
  min-width: 90px;
}

.remove-port-btn {
  background-color: var(--danger);
  color: #fef7ee;
  border: none;
  padding: 6px 8px;
  border-radius: var(--radius-2);
  cursor: pointer;
  font-size: 0.8rem;
}

.add-port-btn {
  background-color: var(--surface-3);
  color: var(--text-primary);
  border: 1px dashed var(--border-default);
  padding: 8px;
  border-radius: var(--radius-2);
  cursor: pointer;
  margin-top: 4px;
}

.ghost-btn {
  background: transparent;
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
  padding: 6px 12px;
  border-radius: var(--radius-2);
  cursor: pointer;
  font-weight: 600;
}

/* Device image styles */
.device-thumbnail {
  width: 100%;
  height: 100px;
  overflow: hidden;
  border-radius: var(--radius-2);
  margin-bottom: var(--space-2);
}

.device-thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.device-thumbnail-placeholder {
  width: 100%;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--surface-3);
  border-radius: var(--radius-2);
  margin-bottom: var(--space-2);
  color: var(--text-muted);
}

.device-thumbnail-placeholder svg {
  width: 32px;
  height: 32px;
  stroke-width: 1.5;
}

.device-detail-placeholder {
  width: 100%;
  height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--surface-2);
  border-radius: var(--radius-2);
  border: 1px solid var(--border-default);
}

.image-skeleton {
  width: 100%;
  height: 100%;
  border-radius: var(--radius-2);
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.06) 25%, rgba(255, 255, 255, 0.14) 50%, rgba(255, 255, 255, 0.06) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}

.image-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
}

.image-fallback svg {
  width: 32px;
  height: 32px;
  stroke-width: 1.5;
}

.image-status {
  font-size: 12px;
  text-align: center;
}

.retry-btn {
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-secondary);
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  cursor: pointer;
}

.device-thumbnail-placeholder.is-loading,
.device-detail-placeholder.is-loading {
  padding: 0;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.device-detail-image {
  width: 100%;
  max-width: 400px;
  margin-bottom: var(--space-4);
  border-radius: var(--radius-2);
  overflow: hidden;
  border: 1px solid var(--border-default);
}

.device-detail-image img {
  width: 100%;
  height: auto;
  display: block;
}

.image-preview {
  margin-top: var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-2);
  padding: var(--space-2);
  background-color: var(--surface-1);
}

.image-preview img {
  width: 100%;
  max-width: 300px;
  height: auto;
  display: block;
  margin-bottom: var(--space-2);
  border-radius: var(--radius-2);
}

.help-text {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-top: 4px;
  margin-bottom: 0;
}

.error-text {
  font-size: 0.85rem;
  color: var(--danger);
  margin-top: 4px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1024px) {
  .devices-layout {
    grid-template-columns: 1fr;
  }

  .device-detail-panel {
    display: none;
  }
}
</style>
